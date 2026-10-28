/**
 * Playwright Oracle Reporter
 *
 * A cross-platform Playwright test reporter providing:
 * - Intelligent rule-based failure analysis
 * - AI-powered root-cause investigation (OpenAI)
 * - System telemetry correlation (CPU, memory, disk)
 * - Historical flakiness & regression detection
 * - Rich HTML dashboard with charts and filtering
 * - Markdown executive summaries
 *
 * Copyright (c) 2025 Mihajlo Stojanovski. All rights reserved.
 *
 * @module index
 */
import { spawn } from "child_process";
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
  TestStep,
  TestError,
} from "@playwright/test/reporter";
import * as fs from "fs";
import * as path from "path";

// ── Internal modules ───────────────────────────────────────
import { TelemetrySampler } from "./telemetry/sampler";
import type { NormalizedSystemMetrics } from "./telemetry/collectors/common";
import { RulesAnalyzer } from "./ai/analyze";
import { HistoryStore } from "./history/store";
import { ClaudeEnricher } from "./ai/claude/enrich";
import { OpenAIEnricher } from "./ai/openai/enrich";
import type { AIProvider, AIResponse } from "./ai/types";
import { PatternAnalyzer } from "./patterns/analyze";
import { TelemetrySummarizer } from "./telemetry/summarize";
import { CorrelationEngine } from "./insights/correlate";
import {
  type TestResultLite,
  type PatternOutput,
  type HistoryRecord,
  SCHEMA_VERSION,
} from "./types";
import { CONFIG_DEFAULTS, getEnvVar } from "./common/constants";
import { loadDotenvIfAvailable } from "./common/env";
import { normalizeSupportedPlatform, shouldAutoOpenReport } from "./common/platform";
import { REPORTER_VERSION } from "./version";
import { SignatureGenerator } from "./ai/rules/signature";
import { selectTestsForAnalysis } from "./ai/select";
import { stripAnsi } from "./ai/redact";
import { escapeHtml } from "./report/html-utils";

// ── Report modules (extracted) ─────────────────────────────
import { HtmlReportGenerator } from "./report/html/html-report-generator";
import { MarkdownReportGenerator } from "./report/markdown-generator";
import { ArtifactCopier } from "./report/artifact-copier";
import { TerminalPresenter } from "./report/terminal-presenter";
import type { TestSummary, AttemptSummary, RunSummary, ReportContext } from "./report/interfaces";

// ═══════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════

/** Reporter configuration with sane defaults. */
interface OracleReporterConfig {
  /** Directory for generated report output. @default "playwright-oracle-report" */
  outputDir: string;
  /** Directory for history storage. @default ".playwright-oracle-history" */
  historyDir: string;
  /** Whether to open the HTML report automatically. Defaults to true locally and false in CI. */
  openReport: boolean;
  /** Optional human-readable label for this run. */
  runLabel?: string;
  /** Telemetry sampling interval in seconds. @default 3 */
  telemetryInterval: number;
  /** AI analysis mode. @default "auto" */
  aiMode: "auto" | "rules" | "openai" | "claude" | "off";
  /** Hard timeout for AI enrichment in milliseconds. @default 90000 */
  aiTimeoutMs: number;
}

/** Default AI enrichment timeout (90 seconds). */
const DEFAULT_AI_TIMEOUT_MS = 90_000;

/** Maximum auto AI timeout when not explicitly configured (10 minutes). */
const MAX_AUTO_AI_TIMEOUT_MS = 600_000;

/**
 * Promise that rejects after the given timeout.
 * `onTimeout` runs when the timeout wins, so callers can cancel the underlying work
 * (otherwise in-flight requests and retry timers would keep the process alive).
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // Cancellation is best-effort
      }
      reject(new Error(`${label} timed out after ${String(ms)}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Process-level listeners registered by any reporter instance (used to detect foreign listeners). */
const ownSignalListeners = new Set<(...args: unknown[]) => void>();

interface AIEnrichmentResult {
  provider: AIProvider | null;
  response: AIResponse | null;
  analyzedCount?: number;
  totalCount?: number;
}

// ═══════════════════════════════════════════════════════════
//  Reporter
// ═══════════════════════════════════════════════════════════

/**
 * Playwright Oracle Reporter — main entry point.
 *
 * Implements the Playwright {@link Reporter} interface.  All heavy
 * lifting (HTML rendering, markdown generation, artifact copying,
 * terminal output) is delegated to dedicated modules under `src/report/`.
 */
export default class PlaywrightOracleReporter implements Reporter {
  // ── Configuration & state ──────────────────────────────
  private readonly config: OracleReporterConfig;
  private readonly aiTimeoutExplicit: boolean;
  private startTime = 0;
  /** One entry per test (final attempt); retries are folded into `previousAttempts`. */
  private tests: TestSummary[] = [];
  /** test.id → index into `tests`, used to fold retries into a single entry. */
  private readonly testIndexById = new Map<string, number>();
  private globalErrors: Array<{ message: string; stack?: string }> = [];
  private runSummary: RunSummary;
  private readonly sampler: TelemetrySampler;
  private readonly historyStore: HistoryStore;
  private totalTests = 0;
  private currentTestIndex = 0;
  private aiAttempted = false;
  private aiProvider: AIProvider | null = null;
  private baseReportOpened = false;
  private reportFinalized = false;
  private onEndPromise: Promise<void> | null = null;
  /** Cancels AI enrichment when the overall AI timeout fires. */
  private aiAbortController = new AbortController();
  /** Effective overall AI budget for the current run (ms). */
  private aiBudgetMs: number | undefined;

  /** Active enricher instance, kept for partial result recovery on timeout. */
  private activeEnricher: ClaudeEnricher | OpenAIEnricher | null = null;

  /** Process listeners installed by this instance, removed once the report is final. */
  private readonly processListeners: Array<{
    event: "SIGINT" | "SIGTERM" | "exit";
    listener: (...args: unknown[]) => void;
  }> = [];
  /** SIGINTs deferred to Playwright's own graceful-interrupt handling. */
  private deferredSigints = 0;

  private isDebugEnabled(): boolean {
    const logLevel = (getEnvVar("LOG_LEVEL") ?? "").toUpperCase();
    return logLevel === "DEBUG" || process.env.PW_AI_DEBUG === "true";
  }

  // ── Delegates ──────────────────────────────────────────
  private readonly htmlGenerator = new HtmlReportGenerator();
  private readonly markdownGenerator = new MarkdownReportGenerator();
  private readonly artifactCopier = new ArtifactCopier();
  private readonly terminal = new TerminalPresenter();

  // ─────────────────────────────────────────────────────

  /**
   * @param options - Partial configuration; missing keys fall back to
   *                  environment variables then hard-coded defaults.
   */
  constructor(options: Partial<OracleReporterConfig> = {}) {
    loadDotenvIfAvailable();

    const envAiTimeoutMs = PlaywrightOracleReporter.parseEnvInt("AI_TIMEOUT_MS");
    this.aiTimeoutExplicit = envAiTimeoutMs !== undefined;
    const optionAiTimeoutMs = options.aiTimeoutMs;
    if (optionAiTimeoutMs !== undefined) {
      this.aiTimeoutExplicit = true;
    }

    this.config = {
      outputDir: getEnvVar("OUTPUT_DIR") ?? options.outputDir ?? CONFIG_DEFAULTS.OUTPUT_DIR,
      historyDir: getEnvVar("HISTORY_DIR") ?? options.historyDir ?? CONFIG_DEFAULTS.HISTORY_DIR,
      openReport: shouldAutoOpenReport(options.openReport),
      runLabel: getEnvVar("RUN_LABEL") ?? options.runLabel,
      telemetryInterval:
        PlaywrightOracleReporter.parseEnvInt("TELEMETRY_INTERVAL") ??
        options.telemetryInterval ??
        CONFIG_DEFAULTS.TELEMETRY_INTERVAL_SECONDS,
      aiMode:
        (PlaywrightOracleReporter.isValidAiMode(getEnvVar("AI_MODE"))
          ? (getEnvVar("AI_MODE") as OracleReporterConfig["aiMode"])
          : undefined) ??
        options.aiMode ??
        CONFIG_DEFAULTS.AI_MODE,
      aiTimeoutMs: envAiTimeoutMs ?? optionAiTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    };

    this.runSummary = this.createRunSummary();

    this.sampler = new TelemetrySampler(this.config.telemetryInterval);
    this.historyStore = new HistoryStore(this.config.historyDir);

    // Signal handlers are installed in onBegin (only once a run actually starts)
    // and removed when the report is final, so idle/extra instances never
    // intercept signals or leak listeners.

    if (this.isDebugEnabled()) {
      this.safeLog(
        `[PW-AI] Reporter config: outputDir=${this.config.outputDir}, openReport=${String(this.config.openReport)}, aiMode=${this.config.aiMode}, aiTimeoutMs=${String(this.config.aiTimeoutMs)}`,
      );
      this.safeLog(
        `[PW-AI] Env: PW_ORACLE_OPEN_REPORT=${String(process.env.PW_ORACLE_OPEN_REPORT ?? "(unset)")}, CI=${String(process.env.CI ?? "(unset)")}, ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? "set" : "(unset)"}`,
      );
    }
  }

  private createRunSummary(): RunSummary {
    return {
      startTime: new Date().toISOString(),
      duration: 0,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      label: this.config.runLabel,
    };
  }

  private computeAutoAiTimeoutMs(failedTestsCount: number): number {
    // Goal: keep UX bounded but avoid premature aborts when many failures exist.
    // We estimate time as "waves" of requests based on concurrency.
    const concurrency = Math.max(1, parseInt(getEnvVar("CLAUDE_CONCURRENCY") ?? "3", 10) || 3);

    // Per-test budget: per-request timeout with a small overhead.
    // (Retries/backoffs are handled internally; if they happen, we may still hit the cap.)
    const perRequestTimeoutMs =
      PlaywrightOracleReporter.parseEnvInt("CLAUDE_TIMEOUT_MS") ??
      CONFIG_DEFAULTS.CLAUDE_TIMEOUT_MS;

    const waves = Math.max(1, Math.ceil(failedTestsCount / concurrency));
    const baseOverheadMs = 15_000;
    const perWaveBudgetMs = Math.min(45_000, Math.round(perRequestTimeoutMs * 1.15));

    const estimate = baseOverheadMs + waves * perWaveBudgetMs;
    return Math.min(MAX_AUTO_AI_TIMEOUT_MS, Math.max(DEFAULT_AI_TIMEOUT_MS, estimate));
  }

  // ═══════════════════════════════════════════════════════
  //  Playwright lifecycle hooks
  // ═══════════════════════════════════════════════════════

  /** Called once before running tests. */
  onBegin(_config: FullConfig, suite: Suite): void {
    // Reset per-run state so a reused instance never mixes runs.
    this.tests = [];
    this.testIndexById.clear();
    this.globalErrors = [];
    this.currentTestIndex = 0;
    this.aiAttempted = false;
    this.aiProvider = null;
    this.activeEnricher = null;
    this.aiAbortController = new AbortController();
    this.aiBudgetMs = undefined;
    this.reportFinalized = false;
    this.onEndPromise = null;
    this.deferredSigints = 0;
    this.runSummary = this.createRunSummary();
    if (this.processListeners.length === 0) {
      this.installSignalHandlers();
    }

    this.startTime = Date.now();
    this.runSummary.startTime = new Date(this.startTime).toISOString();
    this.sampler.start();
    this.totalTests = suite.allTests().length;
    this.terminal.printBanner();
  }

  /** Called when a test starts. */
  onTestBegin(test: TestCase, result: TestResult): void {
    // Retries are not new tests: keep the counter within [1, totalTests].
    if (result.retry === 0) {
      this.currentTestIndex++;
    }
    this.terminal.printTestStart(
      Math.min(Math.max(this.currentTestIndex, 1), Math.max(this.totalTests, 1)),
      this.totalTests,
      path.relative(process.cwd(), test.location.file),
      test.location.line,
      result.retry > 0 ? `${test.title} (retry #${String(result.retry)})` : test.title,
    );
  }

  /** Called when a test step begins. */
  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.category === "test.step") {
      this.terminal.printTestStep(step.title);
    }
  }

  /** Called for each test result. */
  onTestEnd(test: TestCase, result: TestResult): void {
    try {
      const summary = PlaywrightOracleReporter.buildTestSummary(test, result);

      // Write body-only attachments (no path) to the artifacts dir so they appear in the report
      const usedNames = new Set<string>();
      for (let i = 0; i < result.attachments.length; i++) {
        const att = result.attachments[i];
        if (!att.path && Buffer.isBuffer(att.body)) {
          try {
            const ext = PlaywrightOracleReporter.extFromContentType(att.contentType);
            const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const safeId = test.id.replace(/[^a-zA-Z0-9_-]/g, "_");
            // Retries and repeated attachment names must not overwrite each other.
            // The first attempt keeps the historical `${id}-${name}${ext}` name.
            const base = result.retry > 0 ? `${safeId}-retry${String(result.retry)}` : safeId;
            let fileName = `${base}-${safeName}${ext}`;
            for (let n = 2; usedNames.has(fileName); n++) {
              fileName = `${base}-${safeName}-${String(n)}${ext}`;
            }
            usedNames.add(fileName);
            const artifactsDir = path.join(this.config.outputDir, "artifacts");
            this.ensureDir(artifactsDir);
            fs.writeFileSync(path.join(artifactsDir, fileName), att.body);
            summary.attachments[i].path = `artifacts/${fileName}`;
          } catch {
            // Non-fatal: best-effort only, never break Playwright
          }
        }
      }

      this.recordTestResult(test.id, summary);

      if (result.status === "failed" || result.status === "timedOut") {
        this.terminal.printTestFailure(summary);
      }
    } catch (error) {
      this.safeLog(
        `⚠️  Error processing test result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Called on errors that are not attributed to a single test (config, load, worker crashes). */
  onError(error: TestError): void {
    try {
      const message = stripAnsi(error.message ?? error.value ?? "Unknown error");
      const stack = error.stack ? stripAnsi(error.stack) : undefined;
      // Cap to keep run.json bounded even for pathological runs
      if (this.globalErrors.length < 50) {
        this.globalErrors.push({ message, stack });
      }
      this.safeLog(`\n❌ Error outside of tests: ${message}`);
    } catch {
      // Never break Playwright
    }
  }

  /** Called after all tests complete.  Orchestrates report generation. */
  async onEnd(result: FullResult): Promise<void> {
    // Store the promise so signal handlers can await it
    this.onEndPromise = this.onEndInner(result);
    return this.onEndPromise;
  }

  private async onEndInner(result?: FullResult): Promise<void> {
    try {
      if (result?.status) {
        this.runSummary.status = result.status;
      }
      this.finaliseRunSummary();
      const metrics = this.sampler.stop();

      // ── History ───────────────────────────────────────
      const historyEntry = this.buildHistoryRecord();
      await this.historyStore.saveRun(historyEntry);

      const historyEntries = await this.historyStore.getEntries();
      const patterns = await PatternAnalyzer.analyze(historyEntries, this.tests);

      // ── Analysis & report ─────────────────────────────
      const aiResponse = await this.generateReport(metrics, patterns);

      // ── Mark finalized BEFORE terminal output ─────────
      this.reportFinalized = true;

      // ── Terminal summary ──────────────────────────────
      const reportPath = path.join(this.config.outputDir, "index.html");
      if (this.config.openReport) {
        this.openReportInBrowser(path.resolve(reportPath));
      }
      this.terminal.printSummary(this.runSummary, reportPath);

      if (this.runSummary.flaky > 0 || patterns.flakyTests.length > 0) {
        this.terminal.printFlakinessAnalysis(patterns, aiResponse);
      }

      if (this.runSummary.failed > 0) {
        this.terminal.printFailedTestsArtifacts(this.tests);
      }
    } catch (error) {
      this.safeLog(
        `⚠️  Error generating report: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.generateFallbackReport(error);
      this.reportFinalized = true;
    } finally {
      // Report is final: hand signal handling back to Node.js/Playwright defaults.
      this.removeProcessListeners();
    }
  }

  /**
   * Install SIGTERM/SIGINT/exit handlers that finalize the report
   * if the process is killed before onEnd completes (e.g. CI cancellation).
   *
   * SIGINT is normally owned by Playwright, which interrupts the run gracefully
   * and still calls `onEnd` for every reporter. Exiting from our own handler
   * would pre-empt that and lose every reporter's output, so the first SIGINT is
   * deferred whenever another listener (Playwright) is present. A second SIGINT,
   * or a SIGINT with no other listener, is handled here as a forced stop.
   *
   * SIGTERM is not handled by Playwright's runner (Node would terminate
   * immediately), so it is always handled here.
   */
  private installSignalHandlers(): void {
    const onSigint = () => {
      const foreignListeners = process
        .listeners("SIGINT")
        .filter((l) => !ownSignalListeners.has(l as (...args: unknown[]) => void)).length;
      if (foreignListeners > 0 && this.deferredSigints === 0) {
        this.deferredSigints++;
        return;
      }
      this.handleTerminationSignal("SIGINT");
    };
    const onSigterm = () => this.handleTerminationSignal("SIGTERM");

    // Safety net: if process.exit() is called externally (e.g. global-teardown),
    // log a warning so the user knows the reporter was interrupted.
    const onExit = (code: unknown) => {
      // Only relevant once a run has actually started.
      if (this.reportFinalized || this.startTime === 0) return;
      try {
        // Synchronous writes only — async is not allowed in 'exit' handler
        this.ensureDir(this.config.outputDir);
        this.ensureDir(path.join(this.config.outputDir, "data"));
        const exitDiag = {
          warning: "Process exited before reporter finished (likely global-teardown force-exit)",
          exitCode: code,
          reportFinalized: this.reportFinalized,
          timestamp: new Date().toISOString(),
          hint: "Increase FORCE_EXIT_DELAY_MS or remove process.exit() from global-teardown",
        };
        fs.writeFileSync(
          path.join(this.config.outputDir, "data", "exit-diagnostic.json"),
          JSON.stringify(exitDiag, null, 2),
          "utf-8",
        );
        console.log(
          `\n⚠️  [PW-AI] Process exited (code ${String(code)}) before the Oracle report was finalized.`,
        );
        console.log(`   Fix: increase global-teardown timeout or set FORCE_EXIT_DELAY_MS=120000`);
      } catch {
        // Best-effort
      }
    };

    this.addProcessListener("SIGINT", onSigint);
    this.addProcessListener("SIGTERM", onSigterm);
    this.addProcessListener("exit", onExit as (...args: unknown[]) => void);
  }

  private addProcessListener(
    event: "SIGINT" | "SIGTERM" | "exit",
    listener: (...args: unknown[]) => void,
  ): void {
    ownSignalListeners.add(listener);
    this.processListeners.push({ event, listener });
    process.on(event, listener);
  }

  private removeProcessListeners(): void {
    for (const { event, listener } of this.processListeners) {
      process.removeListener(event, listener);
      ownSignalListeners.delete(listener);
    }
    this.processListeners.length = 0;
  }

  /** Finalize what we can, then exit with the conventional signal exit code. */
  private handleTerminationSignal(signal: "SIGINT" | "SIGTERM"): void {
    const exitCode = signal === "SIGTERM" ? 143 : 130;
    this.safeLog(`\n⚡ Received ${signal} — finalizing report…`);

    // If onEnd already ran and finalized, just exit
    if (this.reportFinalized) {
      process.exit(exitCode);
      return;
    }

    // If onEnd is in progress, wait for it (with a hard 5s cap)
    if (this.onEndPromise) {
      const forceTimer = setTimeout(() => process.exit(1), 5000);
      this.onEndPromise
        .catch(() => {})
        .finally(() => {
          clearTimeout(forceTimer);
          process.exit(exitCode);
        });
      return;
    }

    // onEnd never started — write whatever we have synchronously
    try {
      this.finaliseRunSummary();
      this.sampler.stop();
      this.ensureDir(this.config.outputDir);
      this.ensureDir(path.join(this.config.outputDir, "data"));
      fs.writeFileSync(
        path.join(this.config.outputDir, "data", "run.json"),
        JSON.stringify(this.runSummary, null, 2),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(this.config.outputDir, "data", "tests.json"),
        JSON.stringify(this.tests, null, 2),
        "utf-8",
      );
      this.safeLog(
        `📄 Emergency report data saved to: ${path.join(this.config.outputDir, "data")}`,
      );
    } catch {
      // Best-effort only
    }
    process.exit(exitCode);
  }

  // ═══════════════════════════════════════════════════════
  //  Report generation (orchestration only)
  // ═══════════════════════════════════════════════════════

  /**
   * Generate the complete report: analysis → JSON → artifacts → HTML → Markdown.
   *
   * @returns AI response if provider enrichment was invoked successfully, otherwise `null`.
   */
  private async generateReport(
    metrics: NormalizedSystemMetrics[],
    patterns: PatternOutput,
  ): Promise<AIResponse | null> {
    // Ensure output dirs
    this.ensureDir(this.config.outputDir);
    this.ensureDir(path.join(this.config.outputDir, "data"));
    this.ensureDir(path.join(this.config.outputDir, "assets"));

    const testLites = this.mapToTestLites();

    // ── Rule-based analysis ─────────────────────────────
    const analyzer = new RulesAnalyzer({
      os: normalizeSupportedPlatform(),
    });
    const analysis = analyzer.analyze(testLites);

    // ── Telemetry summary & correlation ─────────────────
    const telemetrySummary = TelemetrySummarizer.summarize(metrics);
    const correlations = CorrelationEngine.correlate(testLites, metrics);

    // ── Persist JSON data (base report, no AI enrichment yet) ─────────────
    await Promise.all([
      this.writeJSON("data/run.json", this.runSummary),
      this.writeJSON("data/telemetry.json", metrics),
      this.writeJSON("data/ai.json", analysis),
      this.writeJSON("data/patterns.json", patterns),
      this.writeJSON("data/telemetry.summary.json", telemetrySummary),
    ]);

    await this.writeJSON("data/ai.final.json", {
      schemaVersion: SCHEMA_VERSION,
      meta: { mode: this.config.aiMode, generatedAt: new Date().toISOString() },
      pmSummary: analysis.pmSummary,
      tests: analysis.tests,
      patterns,
      telemetrySummary,
      runFindings: correlations,
      enrichment: {
        provider: null,
        enabled: false,
        success: false,
        pmSummary: null,
        hypotheses: [],
        flakyTestsReview: [],
      },
    });

    // ── Artifacts ────────────────────────────────────────
    await this.artifactCopier.copyArtifacts(this.tests, this.config.outputDir);
    // Write tests.json after copyArtifacts so attachment paths are already relative
    await this.writeJSON("data/tests.json", this.tests);

    // ── HTML report ─────────────────────────────────────
    const context: ReportContext = {
      tests: this.tests,
      runSummary: this.runSummary,
      metrics,
      analysis,
      patterns,
      telemetrySummary,
      correlations,
      aiResponse: null,
      config: {
        outputDir: this.config.outputDir,
        telemetryInterval: this.config.telemetryInterval,
        aiMode: this.config.aiMode,
        openaiConfigured: !!process.env.OPENAI_API_KEY,
        claudeConfigured: !!process.env.ANTHROPIC_API_KEY,
        aiAttempted: false,
        aiProvider: null,
      },
    };

    const html = await this.htmlGenerator.generate(context);
    await PlaywrightOracleReporter.writeFileAtomic(
      path.join(this.config.outputDir, "index.html"),
      html,
    );

    this.safeLog(`📄 Base report generated: ${path.join(this.config.outputDir, "index.html")}`);

    // Write a debug log file for post-mortem diagnostics
    if (this.isDebugEnabled()) {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        version: REPORTER_VERSION,
        config: { aiMode: this.config.aiMode, aiTimeoutMs: this.config.aiTimeoutMs },
        envKeys: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
            ? `set (${String(process.env.ANTHROPIC_API_KEY.length)} chars)`
            : "NOT SET",
          OPENAI_API_KEY: process.env.OPENAI_API_KEY
            ? `set (${String(process.env.OPENAI_API_KEY.length)} chars)`
            : "NOT SET",
        },
        runSummary: { failed: this.runSummary.failed, flaky: this.runSummary.flaky },
      };
      fs.writeFileSync(
        path.join(this.config.outputDir, "data", "debug.json"),
        JSON.stringify(debugInfo, null, 2),
        "utf-8",
      );
    }

    // ── AI enrichment (optional; done after base report so report is always available) ─────
    let aiProvider: AIProvider | null = null;
    let aiResponse: AIResponse | null = null;
    let isPartialResult = false;
    let partialAnalyzedCount = 0;
    let partialTotalCount = 0;

    try {
      const failedTestsCount = selectTestsForAnalysis(this.tests).length;
      const effectiveAiTimeoutMs = this.aiTimeoutExplicit
        ? this.config.aiTimeoutMs
        : this.computeAutoAiTimeoutMs(failedTestsCount);

      this.aiBudgetMs = effectiveAiTimeoutMs;

      if (this.isDebugEnabled() && !this.aiTimeoutExplicit) {
        this.safeLog(
          `[PW-AI] Auto AI timeout selected: failedTests=${String(failedTestsCount)} => aiTimeoutMs=${String(effectiveAiTimeoutMs)}`,
        );
      }

      this.safeLog(`🧠 Starting AI enrichment (timeout: ${String(effectiveAiTimeoutMs)}ms)…`);
      const enrichmentResult = await withTimeout(
        this.tryAIEnrichment(metrics, patterns),
        effectiveAiTimeoutMs,
        "AI enrichment",
        // Cancel in-flight requests and retry waits so nothing outlives the timeout.
        () => this.aiAbortController.abort(),
      );
      aiProvider = enrichmentResult.provider;
      aiResponse = enrichmentResult.response;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // ── Attempt to recover partial results from the active enricher ──
      if (this.activeEnricher) {
        const partial = this.activeEnricher.getPartialResults();
        if (partial.response) {
          aiProvider = this.aiProvider;
          aiResponse = partial.response;
          isPartialResult = true;
          partialAnalyzedCount = partial.analyzedCount;
          partialTotalCount = partial.totalCount;
          // Prepend a partial-results note to the PM summary
          const partialNote = `⚠️ PARTIAL RESULTS: Only ${String(partial.analyzedCount)}/${String(partial.totalCount)} failed tests were analyzed before the AI timeout was reached. Increase PW_ORACLE_AI_TIMEOUT_MS to analyze all tests.`;
          aiResponse.pm_summary = `${partialNote}\n\n${aiResponse.pm_summary}`;
          this.safeLog(
            `⚠️  AI enrichment timed out — using partial results (${String(partial.analyzedCount)}/${String(partial.totalCount)} tests analyzed)`,
          );
        } else {
          this.safeLog(`⚠️  AI enrichment aborted: ${msg}`);
        }
      } else {
        this.safeLog(`⚠️  AI enrichment aborted: ${msg}`);
      }
    }

    if (!aiResponse) {
      this.safeLog("📄 Report ready (without AI enrichment).");
      return null;
    }

    // Persist enrichment JSON
    await this.writeJSON("data/ai.enrichment.json", {
      provider: aiProvider,
      response: aiResponse,
      isPartial: isPartialResult,
      analyzedCount: isPartialResult ? partialAnalyzedCount : undefined,
      totalCount: isPartialResult ? partialTotalCount : undefined,
    });

    // Update final composite JSON with enrichment
    await this.writeJSON("data/ai.final.json", {
      schemaVersion: SCHEMA_VERSION,
      meta: { mode: this.config.aiMode, generatedAt: new Date().toISOString() },
      pmSummary: analysis.pmSummary,
      tests: analysis.tests,
      patterns,
      telemetrySummary,
      runFindings: correlations,
      enrichment: {
        provider: aiProvider,
        enabled: true,
        success: true,
        isPartial: isPartialResult,
        analyzedCount: isPartialResult ? partialAnalyzedCount : undefined,
        totalCount: isPartialResult ? partialTotalCount : undefined,
        pmSummary: aiResponse.pm_summary,
        hypotheses: aiResponse.root_cause_hypotheses.map((h) => h.hypothesis),
        flakyTestsReview: aiResponse.algorithmic_findings_review,
      },
    });

    // Regenerate HTML so AI appears in the report
    const htmlWithAI = await this.htmlGenerator.generate({
      ...context,
      aiResponse,
      config: {
        ...context.config,
        aiAttempted: this.aiAttempted,
        aiProvider,
      },
    });
    await PlaywrightOracleReporter.writeFileAtomic(
      path.join(this.config.outputDir, "index.html"),
      htmlWithAI,
    );

    // ── Markdown report ─────────────────────────────────
    const md = await this.markdownGenerator.generate({
      ...context,
      aiResponse,
    });
    await fs.promises.writeFile(path.join(this.config.outputDir, "ai-analysis.md"), md, "utf-8");
    this.safeLog(`✨ AI Analysis saved to: ${path.join(this.config.outputDir, "ai-analysis.md")}`);

    return aiResponse;
  }

  // ═══════════════════════════════════════════════════════
  //  Private helpers
  // ═══════════════════════════════════════════════════════

  /** Try to enrich analysis with an external AI provider; returns null on skip/failure. */
  private async tryAIEnrichment(
    metrics: NormalizedSystemMetrics[],
    patterns: PatternOutput,
  ): Promise<AIEnrichmentResult> {
    const hasFailures = this.runSummary.failed > 0 || this.runSummary.flaky > 0;

    this.aiAttempted = false;
    this.aiProvider = null;

    if (this.config.aiMode === "off" || this.config.aiMode === "rules") {
      this.safeLog(`🧠 AI enrichment skipped (aiMode=${this.config.aiMode}).`);
      return { provider: null, response: null };
    }

    if (!hasFailures) {
      this.safeLog("🧠 AI analysis skipped because there were no failed or flaky tests.");
      return { provider: null, response: null };
    }

    const providers = this.resolveAIProviders();
    if (this.isDebugEnabled()) {
      this.safeLog(`[PW-AI] Resolved AI providers: ${JSON.stringify(providers)}`);
    }

    for (const provider of providers) {
      const apiKey = this.getProviderApiKey(provider);
      if (this.isDebugEnabled()) {
        const envVar = this.getProviderKeyEnvVar(provider);
        const rawVal = process.env[envVar];
        this.safeLog(
          `[PW-AI] ${provider}: env ${envVar}=${rawVal ? `set (${String(rawVal.length)} chars)` : "(undefined)"}`,
        );
      }
      if (!apiKey) {
        this.safeLog(
          `🧠 ${this.getProviderLabel(provider)} skipped — ${this.getProviderKeyEnvVar(provider)} is not set.`,
        );
        continue;
      }

      this.aiAttempted = true;
      this.aiProvider = provider;
      this.safeLog(
        `🧠 Connecting to ${this.getProviderLabel(provider)} for root cause analysis...`,
      );

      const response =
        provider === "openai"
          ? await this.enrichWithOpenAI(apiKey, metrics, patterns)
          : await this.enrichWithClaude(apiKey, metrics, patterns);

      if (response) {
        this.safeLog(`✅ ${this.getProviderLabel(provider)} analysis complete.`);
        return { provider, response };
      }

      this.safeLog(
        `⚠️  ${this.getProviderLabel(provider)} analysis failed or timed out (skipping)`,
      );
    }

    if (!this.aiAttempted && this.config.aiMode === "auto") {
      this.safeLog(
        "🧠 AI analysis skipped because neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set.",
      );
    }

    return { provider: this.aiProvider, response: null };
  }

  /** Create an OpenAI enricher, store it for partial-result recovery, and run enrichment. */
  private async enrichWithOpenAI(
    apiKey: string,
    metrics: NormalizedSystemMetrics[],
    patterns: PatternOutput,
  ): Promise<AIResponse | null> {
    const enricher = new OpenAIEnricher(apiKey);
    this.activeEnricher = enricher;
    return enricher.enrich(
      {
        run: this.runSummary,
        tests: this.tests,
        telemetry: metrics,
        patterns: patterns.flakyTests as unknown[],
      },
      { signal: this.aiAbortController.signal, budgetMs: this.aiBudgetMs },
    );
  }

  /** Create a Claude enricher, store it for partial-result recovery, and run enrichment. */
  private async enrichWithClaude(
    apiKey: string,
    metrics: NormalizedSystemMetrics[],
    patterns: PatternOutput,
  ): Promise<AIResponse | null> {
    const enricher = new ClaudeEnricher(apiKey);
    this.activeEnricher = enricher;
    return enricher.enrich(
      {
        run: this.runSummary,
        tests: this.tests,
        telemetry: metrics,
        patterns: patterns.flakyTests as unknown[],
      },
      { signal: this.aiAbortController.signal, budgetMs: this.aiBudgetMs },
    );
  }

  private resolveAIProviders(): AIProvider[] {
    switch (this.config.aiMode) {
      case "openai":
        return ["openai"];
      case "claude":
        return ["claude"];
      case "auto":
        return ["openai", "claude"];
      default:
        return [];
    }
  }

  private getProviderApiKey(provider: AIProvider): string | undefined {
    return provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  }

  private getProviderKeyEnvVar(provider: AIProvider): "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" {
    return provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  }

  private getProviderLabel(provider: AIProvider): "OpenAI" | "Claude" {
    return provider === "openai" ? "OpenAI" : "Claude";
  }

  /** Build a TestSummary from Playwright's native types. */
  private static extFromContentType(contentType: string): string {
    const ct = contentType.split(";")[0].trim().toLowerCase();
    const map: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "text/plain": ".txt",
      "application/json": ".json",
      "application/zip": ".zip",
      "video/webm": ".webm",
      "video/mp4": ".mp4",
    };
    return map[ct] ?? "";
  }

  /** Playwright project name for a test, if any (tolerates partial test doubles). */
  private static projectNameOf(test: TestCase): string | undefined {
    try {
      const parent = test.parent as Suite | undefined;
      const name = parent?.project()?.name;
      // Empty project names are treated as "no project"
      return name !== undefined && name.length > 0 ? name : undefined;
    } catch {
      return undefined;
    }
  }

  private static buildTestSummary(test: TestCase, result: TestResult): TestSummary {
    const projectName = PlaywrightOracleReporter.projectNameOf(test);
    const summary: TestSummary = {
      testId: test.id,
      title: test.title,
      file: test.location.file,
      line: test.location.line,
      column: test.location.column,
      status: result.status,
      duration: result.duration,
      attachments: result.attachments.map((att) => ({
        name: att.name,
        path: att.path ?? "",
        contentType: att.contentType,
      })),
      retries: result.retry,
      startTime: result.startTime.getTime(),
      ...(projectName ? { projectName } : {}),
    };

    if (result.error) {
      summary.error = {
        message: result.error.message ?? "Unknown error",
        stack: result.error.stack,
      };
      // Point at the failing line, but only when it is in the test's own file;
      // a location inside a helper file would not match `file`.
      const loc = (result.error as Record<string, unknown>).location as
        | { file?: unknown; line?: unknown }
        | undefined;
      if (
        loc &&
        typeof loc === "object" &&
        typeof loc.line === "number" &&
        (loc.file === undefined || loc.file === test.location.file)
      ) {
        summary.line = loc.line;
      }
    }

    return summary;
  }

  /**
   * Record a test result, folding retries of the same test into one entry.
   *
   * Playwright calls `onTestEnd` once per attempt. Counting each attempt would
   * report a flaky test as failed *and* passed, inflate the total, and list the
   * test twice. The final attempt defines the test's status; earlier attempts are
   * kept in `previousAttempts` so their errors and artifacts are not lost.
   */
  private recordTestResult(testId: string, summary: TestSummary): void {
    const existingIndex = this.testIndexById.get(testId);

    if (existingIndex === undefined) {
      this.testIndexById.set(testId, this.tests.length);
      this.tests.push(summary);
      this.countTest(summary, 1);
      return;
    }

    const previous = this.tests[existingIndex];
    const { previousAttempts: earlier, ...previousAttempt } = previous;
    const attempt: AttemptSummary = {
      retry: previousAttempt.retries,
      status: previousAttempt.status,
      duration: previousAttempt.duration,
      startTime: previousAttempt.startTime,
      error: previousAttempt.error,
      attachments: previousAttempt.attachments,
    };
    const merged: TestSummary = {
      ...summary,
      previousAttempts: [...(earlier ?? []), attempt],
    };

    this.countTest(previous, -1);
    this.tests[existingIndex] = merged;
    this.countTest(merged, 1);
  }

  /** Add (`delta = 1`) or remove (`delta = -1`) a test's contribution to the run counters. */
  private countTest(test: TestSummary, delta: 1 | -1): void {
    this.runSummary.totalTests += delta;

    switch (test.status) {
      case "passed":
        this.runSummary.passed += delta;
        if (test.retries > 0) this.runSummary.flaky += delta;
        break;
      case "failed":
      case "timedOut":
      case "interrupted":
        this.runSummary.failed += delta;
        break;
      case "skipped":
        this.runSummary.skipped += delta;
        break;
    }
  }

  /** Finalise timing on the run summary. */
  private finaliseRunSummary(): void {
    const endTime = Date.now();
    this.runSummary.endTime = new Date(endTime).toISOString();
    this.runSummary.duration = endTime - this.startTime;
    if (this.globalErrors.length > 0) {
      this.runSummary.globalErrors = [...this.globalErrors];
    }
  }

  /** Build a HistoryRecord for the JSONL store. */
  private buildHistoryRecord(): HistoryRecord {
    return {
      timestamp: this.startTime,
      runId: this.startTime.toString(),
      os: normalizeSupportedPlatform(),
      projectName: null,
      totals: {
        passed: this.runSummary.passed,
        failed: this.runSummary.failed,
        flaky: this.runSummary.flaky,
        skipped: this.runSummary.skipped,
      },
      tests: this.tests.reduce<HistoryRecord["tests"]>((acc, t) => {
        const needsSignature = t.status === "failed" || t.status === "timedOut";
        const signatureHash = needsSignature
          ? SignatureGenerator.normalizeError(t.error?.message ?? null, t.error?.stack ?? null)
              .signatureHash
          : null;
        acc[t.testId] = {
          status: t.status,
          durationMs: t.duration,
          signatureHash,
          retries: t.retries,
          attempt: 1,
        };
        return acc;
      }, {}),
    };
  }

  /** Map TestSummary[] → TestResultLite[] for analysis APIs. */
  private mapToTestLites(): TestResultLite[] {
    return this.tests.map((t) => ({
      testId: t.testId,
      title: t.title,
      file: t.file || null,
      projectName: t.projectName ?? null,
      status: t.status as TestResultLite["status"],
      durationMs: t.duration,
      retries: t.retries,
      attempt: 1,
      startTimeMs: t.startTime,
      endTimeMs: t.startTime + t.duration,
      error: {
        message: t.error?.message ?? null,
        stack: t.error?.stack ?? null,
      },
      attachments: {
        tracePath: t.attachments.find((a) => a.name === "trace")?.path ?? null,
        screenshotPath: t.attachments.find((a) => a.contentType.includes("image"))?.path ?? null,
        videoPath: t.attachments.find((a) => a.contentType.includes("video"))?.path ?? null,
      },
    }));
  }

  /** Generate a minimal fallback report when normal generation fails. */
  private async generateFallbackReport(error: unknown): Promise<void> {
    try {
      this.ensureDir(this.config.outputDir);
      const html = `<!DOCTYPE html>
<html><head><title>Playwright Oracle Report - Error</title></head>
<body style="font-family: system-ui; padding: 2rem; max-width: 800px; margin: 0 auto;">
  <h1>⚠️ Report Generation Error</h1>
  <p>The reporter encountered an error but did not break your tests.</p>
  <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px;">${escapeHtml(
    error instanceof Error ? error.message : String(error),
  )}</pre>
  <p><strong>Tests Summary:</strong> ${String(this.runSummary.totalTests)} total, ${String(this.runSummary.passed)} passed, ${String(this.runSummary.failed)} failed</p>
  <footer style="margin-top: 4rem; padding: 2.5rem 1rem 1.5rem; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 0.875rem;">
    <div style="margin-bottom: 0.625rem; font-weight: 600; color: #1e293b;">
      <strong>Playwright Oracle Reporter</strong> v${REPORTER_VERSION}
    </div>
    <div>© 2026 Mihajlo Stojanovski. All rights reserved.</div>
  </footer>
</body></html>`;
      await fs.promises.writeFile(path.join(this.config.outputDir, "index.html"), html, "utf-8");
    } catch (fallbackError) {
      this.safeLog(
        `⚠️  Could not generate fallback report: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      );
    }
  }

  // ── Utilities ─────────────────────────────────────────

  /** Write JSON data to the report output directory. */
  private async writeJSON(relativePath: string, data: unknown): Promise<void> {
    const filePath = path.join(this.config.outputDir, relativePath);
    await PlaywrightOracleReporter.writeFileAtomic(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Write via temp file + rename so readers (CI artifact upload, dashboards)
   * never observe a half-written file if the process is killed mid-write.
   * Falls back to a direct write when rename is not possible (e.g. Windows locks).
   */
  private static async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.${String(process.pid)}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, content, "utf-8");
      await fs.promises.rename(tempPath, filePath);
    } catch {
      await fs.promises.unlink(tempPath).catch(() => undefined);
      await fs.promises.writeFile(filePath, content, "utf-8");
    }
  }

  /** Ensure a directory exists, creating recursively if needed. */
  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** Log without ever throwing (reporter must never break Playwright). */
  private safeLog(message: string): void {
    try {
      console.log(message);
    } catch {
      // Silent — never break Playwright
    }
  }

  /** Open the HTML report in the default browser. */
  private openReportInBrowser(reportPath: string): void {
    try {
      if (!fs.existsSync(reportPath)) {
        if (this.isDebugEnabled()) {
          this.safeLog(`[PW-AI] Auto-open skipped (file not found): ${reportPath}`);
        }
        return;
      }

      let child;
      if (process.platform === "darwin") {
        child = spawn("open", [reportPath], { detached: true, stdio: "ignore" });
      } else if (process.platform === "linux") {
        child = spawn("xdg-open", [reportPath], { detached: true, stdio: "ignore" });
      } else if (process.platform === "win32") {
        child = spawn("cmd", ["/c", "start", "", reportPath], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        return;
      }
      // spawn reports failures (e.g. xdg-open not installed) asynchronously via
      // 'error'; without a listener that event would crash the Playwright process.
      child.on("error", (error: Error) => {
        if (this.isDebugEnabled()) {
          this.safeLog(`[PW-AI] Auto-open failed: ${error.message}`);
        }
      });
      child.unref();
    } catch (error: unknown) {
      // Opening browser is a nice-to-have, not critical
      if (this.isDebugEnabled()) {
        const message = error instanceof Error ? error.message : String(error);
        this.safeLog(`[PW-AI] Auto-open failed: ${message}`);
      }
    }
  }

  // ── Static helpers ────────────────────────────────────

  /** Parse an integer from process.env, returning `undefined` on failure. */
  private static parseEnvInt(key: Parameters<typeof getEnvVar>[0]): number | undefined {
    const raw = getEnvVar(key);
    if (!raw) return undefined;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Type-guard for valid AI mode strings. */
  private static isValidAiMode(value: unknown): value is OracleReporterConfig["aiMode"] {
    return (
      typeof value === "string" && ["auto", "rules", "openai", "claude", "off"].includes(value)
    );
  }
}
