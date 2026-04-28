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
import { execSync } from "child_process";
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
  TestStep,
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

// ── Report modules (extracted) ─────────────────────────────
import { HtmlReportGenerator } from "./report/html/html-report-generator";
import { MarkdownReportGenerator } from "./report/markdown-generator";
import { ArtifactCopier } from "./report/artifact-copier";
import { TerminalPresenter } from "./report/terminal-presenter";
import type { TestSummary, RunSummary, ReportContext } from "./report/interfaces";

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

/** Promise that rejects after the given timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${String(ms)}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface AIEnrichmentResult {
  provider: AIProvider | null;
  response: AIResponse | null;
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
  private startTime = 0;
  private readonly tests: TestSummary[] = [];
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
      aiTimeoutMs:
        PlaywrightOracleReporter.parseEnvInt("AI_TIMEOUT_MS") ??
        options.aiTimeoutMs ??
        DEFAULT_AI_TIMEOUT_MS,
    };

    this.runSummary = {
      startTime: new Date().toISOString(),
      duration: 0,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      label: this.config.runLabel,
    };

    this.sampler = new TelemetrySampler(this.config.telemetryInterval);
    this.historyStore = new HistoryStore(this.config.historyDir);

    // ── Graceful shutdown: finalize report on early termination ──
    this.installSignalHandlers();

    if (this.isDebugEnabled()) {
      this.safeLog(
        `[PW-AI] Reporter config: outputDir=${this.config.outputDir}, openReport=${String(this.config.openReport)}, aiMode=${this.config.aiMode}, aiTimeoutMs=${String(this.config.aiTimeoutMs)}`,
      );
      this.safeLog(
        `[PW-AI] Env: PW_ORACLE_OPEN_REPORT=${String(process.env.PW_ORACLE_OPEN_REPORT ?? "(unset)")}, CI=${String(process.env.CI ?? "(unset)")}, ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? "set" : "(unset)"}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════
  //  Playwright lifecycle hooks
  // ═══════════════════════════════════════════════════════

  /** Called once before running tests. */
  onBegin(_config: FullConfig, suite: Suite): void {
    this.startTime = Date.now();
    this.runSummary.startTime = new Date(this.startTime).toISOString();
    this.sampler.start();
    this.totalTests = suite.allTests().length;
    this.terminal.printBanner();
  }

  /** Called when a test starts. */
  onTestBegin(test: TestCase, _result: TestResult): void {
    this.currentTestIndex++;
    this.terminal.printTestStart(
      this.currentTestIndex,
      this.totalTests,
      path.relative(process.cwd(), test.location.file),
      test.location.line,
      test.title,
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
      this.tests.push(summary);
      this.updateRunSummary(result);

      if (result.status === "failed" || result.status === "timedOut") {
        this.terminal.printTestFailure(summary);
      }
    } catch (error) {
      this.safeLog(
        `⚠️  Error processing test result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Called after all tests complete.  Orchestrates report generation. */
  async onEnd(_result: FullResult): Promise<void> {
    // Store the promise so signal handlers can await it
    this.onEndPromise = this.onEndInner();
    return this.onEndPromise;
  }

  private async onEndInner(): Promise<void> {
    try {
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
    }
  }

  /**
   * Install SIGTERM/SIGINT handlers that finalize the report
   * if the process is killed before onEnd completes (e.g. global-teardown).
   */
  private installSignalHandlers(): void {
    const handler = (signal: string) => {
      this.safeLog(`\n⚡ Received ${signal} — finalizing report…`);

      // If onEnd already ran and finalized, just exit
      if (this.reportFinalized) {
        process.exit(signal === "SIGTERM" ? 143 : 130);
        return;
      }

      // If onEnd is in progress, wait for it (with a hard 5s cap)
      if (this.onEndPromise) {
        const forceTimer = setTimeout(() => process.exit(1), 5000);
        this.onEndPromise
          .catch(() => {})
          .finally(() => {
            clearTimeout(forceTimer);
            process.exit(signal === "SIGTERM" ? 143 : 130);
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
      process.exit(signal === "SIGTERM" ? 143 : 130);
    };

    process.once("SIGTERM", () => handler("SIGTERM"));
    process.once("SIGINT", () => handler("SIGINT"));

    // Safety net: if process.exit() is called externally (e.g. global-teardown),
    // log a warning so the user knows the reporter was interrupted.
    process.once("exit", (code) => {
      if (!this.reportFinalized) {
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
            `\n⚠️  [PW-AI] Process exited (code ${String(code)}) before AI enrichment finished.`,
          );
          console.log(`   Fix: increase global-teardown timeout or set FORCE_EXIT_DELAY_MS=120000`);
        } catch {
          // Best-effort
        }
      }
    });
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
      this.writeJSON("data/tests.json", this.tests),
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
    await fs.promises.writeFile(path.join(this.config.outputDir, "index.html"), html, "utf-8");

    this.safeLog(`📄 Base report generated: ${path.join(this.config.outputDir, "index.html")}`);

    // Write a debug log file for post-mortem diagnostics
    if (this.isDebugEnabled()) {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        version: "1.1.5",
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

    try {
      this.safeLog(`🧠 Starting AI enrichment (timeout: ${String(this.config.aiTimeoutMs)}ms)…`);
      const enrichmentResult = await withTimeout(
        this.tryAIEnrichment(metrics, patterns),
        this.config.aiTimeoutMs,
        "AI enrichment",
      );
      aiProvider = enrichmentResult.provider;
      aiResponse = enrichmentResult.response;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.safeLog(`⚠️  AI enrichment aborted: ${msg}`);
    }

    if (!aiResponse) {
      this.safeLog("📄 Report ready (without AI enrichment).");
      return null;
    }

    // Persist enrichment JSON
    await this.writeJSON("data/ai.enrichment.json", {
      provider: aiProvider,
      response: aiResponse,
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
    await fs.promises.writeFile(
      path.join(this.config.outputDir, "index.html"),
      htmlWithAI,
      "utf-8",
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
          ? await new OpenAIEnricher(apiKey).enrich({
              run: this.runSummary,
              tests: this.tests,
              telemetry: metrics,
              patterns: patterns.flakyTests as unknown[],
            })
          : await new ClaudeEnricher(apiKey).enrich({
              run: this.runSummary,
              tests: this.tests,
              telemetry: metrics,
              patterns: patterns.flakyTests as unknown[],
            });

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
  private static buildTestSummary(test: TestCase, result: TestResult): TestSummary {
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
    };

    if (result.error) {
      summary.error = {
        message: result.error.message ?? "Unknown error",
        stack: result.error.stack,
      };
      const loc = (result.error as Record<string, unknown>).location;
      if (loc && typeof loc === "object" && "line" in (loc as Record<string, unknown>)) {
        summary.line = (loc as { line: number }).line;
      }
    }

    return summary;
  }

  /** Increment pass/fail/skip/flaky counters from a test result. */
  private updateRunSummary(result: TestResult): void {
    this.runSummary.totalTests++;

    switch (result.status) {
      case "passed":
        this.runSummary.passed++;
        if (result.retry > 0) this.runSummary.flaky++;
        break;
      case "failed":
      case "timedOut":
      case "interrupted":
        this.runSummary.failed++;
        break;
      case "skipped":
        this.runSummary.skipped++;
        break;
    }
  }

  /** Finalise timing on the run summary. */
  private finaliseRunSummary(): void {
    const endTime = Date.now();
    this.runSummary.endTime = new Date(endTime).toISOString();
    this.runSummary.duration = endTime - this.startTime;
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
        acc[t.testId] = {
          status: t.status,
          durationMs: t.duration,
          signatureHash: null,
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
      projectName: null,
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
  <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px;">${
    error instanceof Error ? error.message : String(error)
  }</pre>
  <p><strong>Tests Summary:</strong> ${String(this.runSummary.totalTests)} total, ${String(this.runSummary.passed)} passed, ${String(this.runSummary.failed)} failed</p>
  <footer style="margin-top: 4rem; padding: 2.5rem 1rem 1.5rem; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 0.875rem;">
    <div style="margin-bottom: 0.625rem; font-weight: 600; color: #1e293b;">
      <strong>Playwright Oracle Reporter</strong> v1.0.0
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
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
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

      if (process.platform === "darwin") {
        execSync(`open "${reportPath}"`, { stdio: "ignore" });
      } else if (process.platform === "linux") {
        execSync(`xdg-open "${reportPath}"`, { stdio: "ignore" });
      } else if (process.platform === "win32") {
        execSync(`start "" "${reportPath}"`, { stdio: "ignore" });
      }
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
