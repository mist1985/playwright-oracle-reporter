/**
 * Report module interfaces and contracts
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * Defines the boundaries between the reporter core and the report generation modules.
 * All report generators must implement these interfaces to ensure consistent behavior.
 *
 * @module report/interfaces
 */

import type { NormalizedSystemMetrics } from "../telemetry/collectors/common";
import type { Finding, RulesOutput, PatternOutput, TelemetrySummaryOutput } from "../types";
import type { OpenAIResponse } from "../ai/openai/types";

/**
 * Test summary data for report rendering.
 * These fields are the subset of test results needed by report generators.
 */
export interface TestSummary {
  readonly testId: string;
  readonly title: string;
  readonly file: string;
  line: number;
  readonly column: number;
  readonly status: string;
  readonly duration: number;
  readonly startTime: number;
  error?: {
    readonly message: string;
    readonly stack?: string;
  };
  readonly attachments: Array<{
    name: string;
    path: string;
    contentType: string;
  }>;
  readonly retries: number;
}

/**
 * Run-level summary data for report rendering.
 */
export interface RunSummary {
  startTime: string;
  endTime?: string;
  duration: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  label?: string;
}

/**
 * Aggregated context for report generation.
 * All data the report generators need, grouped into a single structure.
 */
export interface ReportContext {
  readonly tests: ReadonlyArray<TestSummary>;
  readonly runSummary: RunSummary;
  readonly metrics: ReadonlyArray<NormalizedSystemMetrics>;
  readonly analysis: RulesOutput | null;
  readonly patterns: PatternOutput | null;
  readonly telemetrySummary: TelemetrySummaryOutput | null;
  readonly correlations: ReadonlyArray<Finding>;
  readonly openaiResponse: OpenAIResponse | null;
  readonly config: ReportConfig;
}

/**
 * Report configuration for output generation.
 */
export interface ReportConfig {
  readonly outputDir: string;
  readonly telemetryInterval: number;
  readonly aiMode: "auto" | "rules" | "openai" | "off";
  readonly openaiConfigured: boolean;
  readonly openaiAttempted: boolean;
}

/**
 * Contract for HTML report generation.
 */
export interface IHtmlReportGenerator {
  generate(context: ReportContext): Promise<string>;
}

/**
 * Contract for Markdown report generation.
 */
export interface IMarkdownReportGenerator {
  generate(context: ReportContext): Promise<string>;
}

/**
 * Contract for artifact copying.
 */
export interface IArtifactCopier {
  copyArtifacts(tests: ReadonlyArray<TestSummary>, outputDir: string): Promise<void>;
}

/**
 * Contract for console/terminal output.
 */
export interface ITerminalPresenter {
  printBanner(): void;
  printTestStart(index: number, total: number, file: string, line: number, title: string): void;
  printTestStep(title: string): void;
  printTestFailure(test: TestSummary): void;
  printSummary(runSummary: RunSummary, reportPath: string): void;
  printFlakinessAnalysis(patterns: PatternOutput, openaiResponse: OpenAIResponse | null): void;
  printFailedTestsArtifacts(tests: ReadonlyArray<TestSummary>): void;
}
