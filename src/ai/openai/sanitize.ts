/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import type { NormalizedSystemMetrics } from "../../telemetry/collectors/common";
import type { TelemetrySanitizedSummary } from "../../types";
import type { RunSummary, TestSummary } from "../../report/interfaces";

export interface SanitizeInput {
  run: RunSummary;
  tests: TestSummary[];
  telemetry: NormalizedSystemMetrics[];
  patterns: unknown[];
}

export class PayloadSanitizer {
  static sanitize(input: SanitizeInput): Record<string, unknown> {
    const failedTests = input.tests
      .filter((t) => t.status === "failed" || t.status === "timedOut")
      .slice(0, 10); // Cap at 10

    const sanitizedTests = failedTests.map((t) => ({
      testId: t.testId,
      title: t.title,
      file: this.redactPath(t.file),
      error: this.cleanError(t.error?.message ?? ""),
      snippet: this.cleanStack(t.error?.stack ?? ""),
      duration: t.duration,
    }));

    // NEW: Prepare flakiness analysis for AI review
    interface PatternEntry {
      testId?: string;
      flakeRate?: number;
      failureRate?: number;
      recentStatuses?: string[];
      rootCauses?: Array<{
        type: string;
        confidence: number;
        description: string;
        evidence: unknown;
      }>;
      suggestedFixes?: Array<{
        description: string;
        codeExample?: string;
        expectedImpact: string;
        risk: string;
      }>;
      overallConfidence?: number;
    }
    const typedPatterns = input.patterns as PatternEntry[];
    const flakyTestsWithAnalysis = typedPatterns
      .filter((p) => p.flakeRate && p.flakeRate > 0)
      .slice(0, 5) // Cap at 5 flaky tests
      .map((p) => ({
        testId: p.testId,
        flakeRate: p.flakeRate,
        recentStatuses: p.recentStatuses,
        // Include algorithmic findings for AI to review
        algorithmicFindings: {
          rootCauses: (p.rootCauses ?? []).map((rc) => ({
            type: rc.type,
            confidence: rc.confidence,
            description: rc.description,
            evidence: rc.evidence,
          })),
          suggestedFixes: (p.suggestedFixes ?? []).map((sf) => ({
            description: sf.description,
            codeExample: sf.codeExample,
            expectedImpact: sf.expectedImpact,
            risk: sf.risk,
          })),
          overallConfidence: p.overallConfidence,
        },
      }));

    return {
      run: {
        duration: input.run.duration,
        passed: input.run.passed,
        failed: input.run.failed,
        flaky: input.run.flaky,
      },
      tests: sanitizedTests,
      telemetry_summary: this.summarizeTelemetry(input.telemetry),
      history_patterns: typedPatterns
        .filter((p) => (p.failureRate ?? 0) > 0 || (p.flakeRate ?? 0) > 0)
        .slice(0, 5),
      // NEW: Flakiness analysis for AI confirmation
      flakiness_analysis:
        flakyTestsWithAnalysis.length > 0
          ? {
              instruction:
                "IMPORTANT: Review 'algorithmicFindings' for each flaky test. These are deterministic findings from statistical analysis. Your task: CONFIRM (if evidence supports), REFUTE (if evidence contradicts), or ENHANCE (add context/additional causes). Do not blindly accept - validate against test data.",
              flaky_tests: flakyTestsWithAnalysis,
            }
          : null,
    };
  }

  private static redactPath(path: string): string {
    if (!path) return "";
    // Replace user home with ~
    return path.replace(/\/Users\/[^\/]+/, "~").replace(/\/home\/[^\/]+/, "~");
  }

  private static cleanError(msg: string): string {
    if (!msg) return "";
    let clean = msg.replace(/\x1b\[[0-9;]*m/g, ""); // Remove ansi colors
    // Redact potential API keys (sk-...)
    clean = clean.replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_KEY]");
    return clean.slice(0, 500); // Cap length
  }

  private static cleanStack(stack: string): string {
    if (!stack) return "";
    const clean = stack.replace(/\x1b\[[0-9;]*m/g, "");
    const lines = clean.split("\n");
    // Keep first 3 relevant lines
    return lines.slice(0, 5).join("\n").slice(0, 1000);
  }

  /**
   * Sanitize a single test for individual AI analysis
   * Focused payload for faster processing per test
   *
   * @param test - Single test to analyze
   * @param run - Run context for comparison
   * @param telemetry - Telemetry metrics
   * @param patterns - Patterns for this specific test
   * @returns Sanitized payload for single-test analysis
   */
  static sanitizeSingleTest(
    test: TestSummary,
    run: RunSummary,
    telemetry: NormalizedSystemMetrics[],
    patterns: unknown[],
  ): Record<string, unknown> {
    // Find patterns for this specific test
    interface PatternEntry {
      testId?: string;
      flakeRate?: number;
      failureRate?: number;
      recentStatuses?: string[];
      rootCauses?: Array<{
        type: string;
        confidence: number;
        description: string;
        evidence: unknown;
      }>;
      suggestedFixes?: Array<{
        description: string;
        codeExample?: string;
        expectedImpact: string;
        risk: string;
      }>;
      overallConfidence?: number;
    }

    const typedPatterns = patterns as PatternEntry[];
    const testPattern = typedPatterns.find((p) => p.testId === test.testId);

    return {
      context: {
        run: {
          totalTests: run.totalTests,
          passed: run.passed,
          failed: run.failed,
          flaky: run.flaky,
        },
        testNumber: `${String(run.passed + run.failed)} of ${String(run.totalTests)}`,
      },
      test: {
        testId: test.testId,
        title: test.title,
        file: this.redactPath(test.file),
        error: this.cleanError(test.error?.message ?? ""),
        stackTrace: this.cleanStack(test.error?.stack ?? ""),
        duration: test.duration,
        status: test.status,
      },
      telemetry: this.summarizeTelemetry(telemetry),
      history: testPattern
        ? {
            flakeRate: testPattern.flakeRate,
            failureRate: testPattern.failureRate,
            recentStatuses: testPattern.recentStatuses,
          }
        : null,
      algorithmicAnalysis: testPattern
        ? {
            rootCauses: (testPattern.rootCauses ?? []).map((rc) => ({
              type: rc.type,
              confidence: rc.confidence,
              description: rc.description,
            })),
            suggestedFixes: (testPattern.suggestedFixes ?? []).map((sf) => ({
              description: sf.description,
              expectedImpact: sf.expectedImpact,
              risk: sf.risk,
            })),
            overallConfidence: testPattern.overallConfidence,
          }
        : null,
    };
  }

  private static summarizeTelemetry(
    metrics: NormalizedSystemMetrics[],
  ): TelemetrySanitizedSummary | null {
    if (metrics.length === 0) return null;

    // Simple stats
    const maxCpu = Math.max(...metrics.map((m) => m.cpu.load1));
    const maxRss = Math.max(...metrics.map((m) => m.process.rssMb));
    const avgLoad = metrics.reduce((a, b) => a + b.cpu.load1, 0) / metrics.length;

    // Checks for Linux constraints
    const hasPressure = metrics.some((m) => (m.memory.pressurePct ?? 0) > 0);
    const hasSteal = metrics.some((m) => (m.cpu.stealPct ?? 0) > 5);

    return {
      samples: metrics.length,
      cpu_max_load1: String(maxCpu.toFixed(2)),
      cpu_avg_load1: String(avgLoad.toFixed(2)),
      mem_max_rss_mb: String(maxRss.toFixed(0)),
      pressure_detected: hasPressure,
      cpu_steal_detected: hasSteal,
    };
  }
}
