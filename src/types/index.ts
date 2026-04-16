/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { getEnvVar, type SupportedPlatform } from "../common/constants";
import type { AIProvider } from "../ai/types";

/**
 * Schema version for all AI output artifacts.
 * Increment on breaking schema changes.
 */
export const SCHEMA_VERSION = "1.0.0";

/**
 * Caps and limits for Enterprise-grade safety.
 */
export const CAPS = {
  MAX_ERROR_MESSAGE_LENGTH: 500,
  MAX_STACK_LENGTH: 1000,
  MAX_SNIPPET_LINES: 10,
  MAX_FINDINGS_PER_TEST: 3,
  MAX_EVIDENCE_REFS: 5,
  MAX_RECOMMENDED_ACTIONS: 5,
  MAX_TESTS_IN_HISTORY: 500,
  HISTORY_WINDOW_DAYS: 7,
  TELEMETRY_CORRELATION_BUFFER_MS: 5000,
};

/**
 * Thresholds for telemetry correlation.
 * Can be overridden via environment variables.
 */
export const THRESHOLDS = {
  LOAD1: parseFloat(getEnvVar("THRESHOLD_LOAD1") || "4.0"),
  PRESSURE_PCT: parseFloat(getEnvVar("THRESHOLD_PRESSURE") || "10"),
  IOWAIT_PCT: parseFloat(getEnvVar("THRESHOLD_IOWAIT") || "20"),
  STEAL_PCT: parseFloat(getEnvVar("THRESHOLD_STEAL") || "10"),
};

/**
 * Lite test result for analysis (no `any`).
 */
export interface TestResultLite {
  testId: string;
  title: string;
  file: string | null;
  projectName: string | null;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  durationMs: number;
  retries: number;
  attempt: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  error: {
    message: string | null;
    stack: string | null;
  };
  attachments: {
    tracePath: string | null;
    screenshotPath: string | null;
    videoPath: string | null;
  };
}

/**
 * Finding kind enumeration.
 */
export type FindingKind =
  | "timeout"
  | "network"
  | "assertion"
  | "infra"
  | "data"
  | "flaky"
  | "regression"
  | "telemetry"
  | "unknown";

/**
 * Finding scope.
 */
export type FindingScope = "test" | "run";

/**
 * Generic finding structure (evidence-first).
 */
export interface Finding {
  id: string;
  scope: FindingScope;
  kind: FindingKind;
  title: string;
  confidence: number; // 0.0 to 1.0
  summary: string;
  details: string;
  evidenceRefs: string[];
  recommendedActions: string[];
}

/**
 * Normalized error for analysis.
 */
export interface NormalizedError {
  signature: string;
  signatureHash: string;
  snippetLines: string[];
}

export type ReporterOS = SupportedPlatform | null;

/**
 * Run metadata for context.
 */
export interface RunMeta {
  runId: string;
  os: ReporterOS;
  timestamp: number;
  browsers: string[];
}

/**
 * History hints for a test.
 */
export interface HistoryHints {
  seenBeforeCount: number;
  flakeRate: number;
  lastStatuses: string[];
  osDiff: boolean;
}

/**
 * Telemetry window for a test.
 */
export interface TelemetryWindow {
  startMs: number;
  endMs: number;
  samples: number;
  maxLoad1: number;
  maxPressurePct: number;
  maxIowaitPct: number;
  maxStealPct: number;
}

/**
 * Rule context passed to each rule.
 */
export interface RuleContext {
  test: TestResultLite;
  normalizedError: NormalizedError;
  runMeta: RunMeta;
  telemetryWindow: TelemetryWindow | null;
  historyHints: HistoryHints | null;
}

/**
 * Rule interface.
 */
export interface Rule {
  id: string;
  priority: number;
  kind: FindingKind;
  match(ctx: RuleContext): boolean;
  build(ctx: RuleContext): Finding[];
}

/**
 * History record for pattern analysis.
 */
export interface HistoryRecord {
  timestamp: number;
  runId: string;
  os: ReporterOS;
  projectName: string | null;
  totals: {
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
  };
  tests: Record<
    string,
    {
      status: string;
      durationMs: number;
      signatureHash: string | null;
      retries: number;
      attempt: number;
    }
  >;
}

export interface CodeAnalysisFinding {
  type: "race-condition" | "missing-await" | "hardcoded-timeout" | "anti-pattern";
  line: number;
  snippet: string;
  suggestion: string;
  fix?: string;
}

/**
 * Pattern analysis output.
 */
export interface PatternOutput {
  schemaVersion: string;
  generatedAt: string;
  flakyTests: Array<{
    testId: string;
    flakeRate: number;
    recentStatuses: string[];
    // Advanced flakiness analysis
    rootCauses?: Array<{
      type:
        | "race-condition"
        | "timing-issue"
        | "network-timing"
        | "state-dependency"
        | "animation-timing"
        | "resource-contention"
        | "unknown";
      confidence: number;
      description: string;
      evidence: {
        metric?: string;
        value?: number | string;
        context?: string;
      };
    }>;
    suggestedFixes?: Array<{
      description: string;
      codeExample?: string;
      expectedImpact: string;
      risk: "low" | "medium" | "high";
    }>;
    overallConfidence?: number;
  }>;
  recurringFailures: Array<{
    signatureHash: string;
    count: number;
    testIds: string[];
  }>;
  regressions: Array<{
    testId: string;
    avgDurationMs: number;
    previousAvgMs: number;
    increasePercent: number;
  }>;
  osDiffs: Array<{
    testId: string;
    darwinStatus?: string;
    linuxStatus?: string;
    win32Status?: string;
  }>;
}

/**
 * Telemetry summary output.
 */
export interface TelemetrySummaryOutput {
  schemaVersion: string;
  generatedAt: string;
  samples: number;
  cpu: {
    maxLoad1: number;
    avgLoad1: number;
    maxStealPct: number;
    maxIowaitPct: number;
  };
  memory: {
    maxRssMb: number;
    maxPressurePct: number;
  };
  disk: {
    minFreeGb: number;
  };
  spikes: Array<{
    timestamp: number;
    metric: string;
    value: number;
  }>;
}

/**
 * Rules analysis output.
 */
export interface RulesOutput {
  schemaVersion: string;
  generatedAt: string;
  pmSummary: string;
  tests: Record<
    string,
    {
      testId: string;
      status: string;
      findings: Finding[];
    }
  >;
  runFindings: Finding[];
}

/**
 * Final merged output.
 */
export interface AIFinalOutput {
  schemaVersion: string;
  generatedAt: string;
  mode: string;
  pmSummary: string;
  tests: Record<
    string,
    {
      testId: string;
      status: string;
      signatureHash: string | null;
      findings: Finding[];
    }
  >;
  patterns: PatternOutput;
  telemetrySummary: TelemetrySummaryOutput;
  runFindings: Finding[];
  enrichment: {
    provider: AIProvider | null;
    enabled: boolean;
    success: boolean;
    pmSummary: string | null;
    hypotheses: string[];
    flakyTestsReview?: AlgorithmicFindingReview[];
  };
}

/**
 * AI review of an algorithmic finding.
 */
export interface AlgorithmicFindingReview {
  test_id: string;
  finding_type: string;
  ai_verdict: "confirmed" | "refuted" | "partially-confirmed" | "uncertain";
  ai_confidence: "high" | "medium" | "low";
  ai_reasoning: string;
  ai_enhancement?: string;
}

/**
 * Aggregated test statistics for pattern analysis.
 */
export interface AggregatedTestStat {
  total: number;
  failed: number;
  flaky: number;
  durations: number[];
  statuses: string[];
  signatures: Map<string, number>;
  byOS: Map<string, string[]>;
}

/**
 * Single flaky test entry from pattern analysis.
 */
export type FlakyTestPattern = PatternOutput["flakyTests"][number];

/**
 * Telemetry summary produced by sanitizer for AI payload.
 */
export interface TelemetrySanitizedSummary {
  samples: number;
  cpu_max_load1: string;
  cpu_avg_load1: string;
  mem_max_rss_mb: string;
  pressure_detected: boolean;
  cpu_steal_detected: boolean;
}
