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
import { OpenAIEnricher } from "./ai/openai/enrich";
import type { OpenAIResponse } from "./ai/openai/types";
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
  aiMode: "auto" | "rules" | "openai" | "off";
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
  private openAIAttempted = false;

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
      outputDir: getEnvVar("OUTPUT_DIR") || options.outputDir || CONFIG_DEFAULTS.OUTPUT_DIR,
      historyDir: getEnvVar("HISTORY_DIR") || options.historyDir || CONFIG_DEFAULTS.HISTORY_DIR,
      openReport: shouldAutoOpenReport(options.openReport),
      runLabel: getEnvVar("RUN_LABEL") || options.runLabel,
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
      this.safeLog(`⚠️  Error processing test result: ${error}`);
    }
  }

  /** Called after all tests complete.  Orchestrates report generation. */
  async onEnd(_result: FullResult): Promise<void> {
    try {
      this.finaliseRunSummary();
      const metrics = this.sampler.stop();

      // ── History ───────────────────────────────────────
      const historyEntry = this.buildHistoryRecord();
      await this.historyStore.saveRun(historyEntry);

      const historyEntries = await this.historyStore.getEntries();
      const patterns = await PatternAnalyzer.analyze(historyEntries, this.tests);

      // ── Analysis & report ─────────────────────────────
      const openAiResponse = await this.generateReport(metrics, patterns);

      // ── Terminal summary ──────────────────────────────
      const reportPath = path.join(this.config.outputDir, "index.html");
      if (this.config.openReport) {
        this.openReportInBrowser(path.resolve(reportPath));
      }
      this.terminal.printSummary(this.runSummary, reportPath);

      if (this.runSummary.flaky > 0 || patterns.flakyTests.length > 0) {
        this.terminal.printFlakinessAnalysis(patterns, openAiResponse);
      }

      if (this.runSummary.failed > 0) {
        this.terminal.printFailedTestsArtifacts(this.tests);
      }
    } catch (error) {
      this.safeLog(`⚠️  Error generating report: ${error}`);
      await this.generateFallbackReport(error);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  Report generation (orchestration only)
  // ═══════════════════════════════════════════════════════

  /**
   * Generate the complete report: analysis → JSON → artifacts → HTML → Markdown.
   *
   * @returns OpenAI response if AI was invoked, otherwise `null`.
   */
  private async generateReport(
    metrics: NormalizedSystemMetrics[],
    patterns: PatternOutput,
  ): Promise<OpenAIResponse | null> {
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

    // ── OpenAI (optional) ───────────────────────────────
    const openAiResponse = await this.tryOpenAIEnrichment(metrics, patterns);

    // ── Persist JSON data ───────────────────────────────
    await Promise.all([
      this.writeJSON("data/run.json", this.runSummary),
      this.writeJSON("data/tests.json", this.tests),
      this.writeJSON("data/telemetry.json", metrics),
      this.writeJSON("data/ai.json", analysis),
      this.writeJSON("data/patterns.json", patterns),
      this.writeJSON("data/telemetry.summary.json", telemetrySummary),
      ...(openAiResponse ? [this.writeJSON("data/ai.openai.json", openAiResponse)] : []),
    ]);

    await this.writeJSON("data/ai.final.json", {
      schemaVersion: SCHEMA_VERSION,
      meta: { mode: this.config.aiMode, generatedAt: new Date().toISOString() },
      pmSummary: analysis.pmSummary,
      tests: analysis.tests,
      patterns,
      telemetrySummary,
      runFindings: correlations,
      openai: {
        enabled: !!openAiResponse,
        success: !!openAiResponse,
        pmSummary: openAiResponse?.pm_summary ?? null,
        hypotheses: openAiResponse?.root_cause_hypotheses.map((h) => h.hypothesis) ?? [],
        flakyTestsReview: openAiResponse?.algorithmic_findings_review ?? [],
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
      openaiResponse: openAiResponse ?? null,
      config: {
        outputDir: this.config.outputDir,
        telemetryInterval: this.config.telemetryInterval,
        aiMode: this.config.aiMode,
        openaiConfigured: !!process.env.OPENAI_API_KEY,
        openaiAttempted: this.openAIAttempted,
      },
    };

    const html = await this.htmlGenerator.generate(context);
    await fs.promises.writeFile(path.join(this.config.outputDir, "index.html"), html, "utf-8");

    // ── Markdown report ─────────────────────────────────
    if (openAiResponse) {
      const md = await this.markdownGenerator.generate({
        ...context,
        openaiResponse: openAiResponse,
      });
      await fs.promises.writeFile(path.join(this.config.outputDir, "ai-analysis.md"), md, "utf-8");
      this.safeLog(
        `✨ AI Analysis saved to: ${path.join(this.config.outputDir, "ai-analysis.md")}`,
      );
    }

    return openAiResponse;
  }

  // ═══════════════════════════════════════════════════════
  //  Private helpers
  // ═══════════════════════════════════════════════════════

  /** Try to enrich analysis with OpenAI; returns null on skip/failure. */
  private async tryOpenAIEnrichment(
    metrics: NormalizedSystemMetrics[],
    patterns: PatternOutput,
  ): Promise<OpenAIResponse | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    const supportsOpenAI = this.config.aiMode === "openai" || this.config.aiMode === "auto";
    const hasFailures = this.runSummary.failed > 0 || this.runSummary.flaky > 0;

    this.openAIAttempted = false;

    if (this.config.aiMode === "off") {
      return null;
    }

    if (!supportsOpenAI) {
      return null;
    }

    if (!apiKey) {
      if (this.config.aiMode === "openai") {
        this.safeLog("🧠 OpenAI analysis skipped because OPENAI_API_KEY is not set.");
      }
      return null;
    }

    if (!hasFailures) {
      this.safeLog("🧠 OpenAI analysis skipped because there were no failed or flaky tests.");
      return null;
    }

    this.openAIAttempted = true;
    this.safeLog("🧠 Connecting to OpenAI for root cause analysis...");
    const enricher = new OpenAIEnricher(apiKey);
    const response = await enricher.enrich({
      run: this.runSummary,
      tests: this.tests,
      telemetry: metrics,
      patterns: patterns.flakyTests as unknown[],
    });

    if (!response) {
      this.safeLog("⚠️  OpenAI analysis failed or timed out (skipping)");
    }
    return response;
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
        path: att.path || "",
        contentType: att.contentType,
      })),
      retries: result.retry,
      startTime: result.startTime.getTime(),
    };

    if (result.error) {
      summary.error = {
        message: result.error.message || "Unknown error",
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
      startTimeMs: t.startTime ?? null,
      endTimeMs: t.startTime ? t.startTime + t.duration : null,
      error: {
        message: t.error?.message ?? null,
        stack: t.error?.stack ?? null,
      },
      attachments: {
        tracePath: t.attachments.find((a) => a.name === "trace")?.path ?? null,
        screenshotPath: t.attachments.find((a) => a.contentType?.includes("image"))?.path ?? null,
        videoPath: t.attachments.find((a) => a.contentType?.includes("video"))?.path ?? null,
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
  <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px;">${String(error)}</pre>
  <p><strong>Tests Summary:</strong> ${this.runSummary.totalTests} total, ${this.runSummary.passed} passed, ${this.runSummary.failed} failed</p>
  <footer style="margin-top: 4rem; padding: 2.5rem 1rem 1.5rem; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 0.875rem;">
    <div style="margin-bottom: 0.625rem; font-weight: 600; color: #1e293b;">
      <strong>Playwright Oracle Reporter</strong> v1.0.0
    </div>
    <div>© 2026 Mihajlo Stojanovski. All rights reserved.</div>
  </footer>
</body></html>`;
      await fs.promises.writeFile(path.join(this.config.outputDir, "index.html"), html, "utf-8");
    } catch (fallbackError) {
      this.safeLog(`⚠️  Could not generate fallback report: ${fallbackError}`);
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
      const { execSync } = require("child_process");
      if (process.platform === "darwin") {
        execSync(`open "${reportPath}"`, { stdio: "ignore" });
      } else if (process.platform === "linux") {
        execSync(`xdg-open "${reportPath}"`, { stdio: "ignore" });
      } else if (process.platform === "win32") {
        execSync(`start "" "${reportPath}"`, { stdio: "ignore", shell: true });
      }
    } catch {
      // Opening browser is a nice-to-have, not critical
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
    return typeof value === "string" && ["auto", "rules", "openai", "off"].includes(value);
  }
}
