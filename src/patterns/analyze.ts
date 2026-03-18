/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { HistoryRecord, PatternOutput, SCHEMA_VERSION, CAPS, AggregatedTestStat } from "../types";
import { FlakinessAnalyzer, TestStatistics } from "../insights/flakiness-analyzer";
import type { TestSummary } from "../report/interfaces";

/**
 * Pattern Analyzer
 * Enterprise principle: pure function, deterministic, capped.
 */
export class PatternAnalyzer {
  /**
   * Analyze historical test run records to detect patterns
   * Identifies flaky tests, recurring failures, performance regressions, and OS-specific issues
   *
   * @param records - Array of historical test run records (typically last 7 days)
   * @param currentTests - Optional current test results for enhanced context
   * @returns Pattern analysis output with detected issues (capped at 20 per category)
   */
  static async analyze(
    records: HistoryRecord[],
    currentTests?: TestSummary[],
  ): Promise<PatternOutput> {
    if (records.length === 0) {
      return this.emptyOutput();
    }

    // Aggregate test stats
    const testStats = this.aggregateTestStats(records);

    // Compute patterns
    const flakyTests = await this.detectFlakyTests(testStats, currentTests);
    const recurringFailures = this.detectRecurringFailures(testStats);
    const regressions = this.detectRegressions(testStats);
    const osDiffs = this.detectOSDiffs(records);

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      flakyTests: flakyTests.slice(0, 20), // Cap
      recurringFailures: recurringFailures.slice(0, 20),
      regressions: regressions.slice(0, 20),
      osDiffs: osDiffs.slice(0, 20),
    };
  }

  private static emptyOutput(): PatternOutput {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      flakyTests: [],
      recurringFailures: [],
      regressions: [],
      osDiffs: [],
    };
  }

  private static aggregateTestStats(records: HistoryRecord[]): Map<string, AggregatedTestStat> {
    const stats: Map<string, AggregatedTestStat> = new Map();

    for (const record of records) {
      for (const [testId, result] of Object.entries(record.tests)) {
        let stat = stats.get(testId);
        if (!stat) {
          stat = {
            total: 0,
            failed: 0,
            flaky: 0,
            durations: [],
            statuses: [],
            signatures: new Map(),
            byOS: new Map(),
          };
          stats.set(testId, stat);
        }

        stat.total++;
        stat.durations.push(result.durationMs);
        stat.statuses.push(result.status);

        if (result.status === "failed" || result.status === "timedOut") {
          stat.failed++;
          if (result.signatureHash) {
            stat.signatures.set(
              result.signatureHash,
              (stat.signatures.get(result.signatureHash) || 0) + 1,
            );
          }
        }

        if (result.status === "passed" && result.retries > 0) {
          stat.flaky++;
        }

        // OS tracking
        const os = record.os || "unknown";
        if (!stat.byOS.has(os)) {
          stat.byOS.set(os, []);
        }
        stat.byOS.get(os)!.push(result.status);
      }
    }

    return stats;
  }

  private static async detectFlakyTests(
    stats: Map<string, AggregatedTestStat>,
    currentTests?: TestSummary[],
  ): Promise<PatternOutput["flakyTests"]> {
    const results: PatternOutput["flakyTests"] = [];

    for (const [testId, stat] of stats.entries()) {
      if (stat.total < 2) continue;

      // Flaky if: passed after retry OR alternating statuses
      const flakeRate = stat.flaky / stat.total;
      const hasAlternating = this.hasAlternatingStatuses(stat.statuses);

      if (flakeRate > 0 || hasAlternating) {
        // Advanced: Inject file/line from current test run if available
        const currentTest = currentTests?.find((t) => t.testId === testId);

        // NEW: Deep analysis using FlakinessAnalyzer
        const deepAnalysis = await FlakinessAnalyzer.analyze({
          testId,
          total: stat.total,
          failed: stat.failed,
          flaky: stat.flaky,
          durations: stat.durations,
          statuses: stat.statuses,
          file: currentTest?.file,
          line: currentTest?.line,
        } as TestStatistics);

        results.push({
          testId,
          flakeRate: Math.max(flakeRate, hasAlternating ? 0.5 : 0),
          recentStatuses: stat.statuses.slice(-5),
          // NEW: Include deep analysis results
          rootCauses: deepAnalysis.findings,
          suggestedFixes: deepAnalysis.suggestions,
          overallConfidence: deepAnalysis.overallConfidence,
        });
      }
    }

    return results.sort((a, b) => b.flakeRate - a.flakeRate);
  }

  private static hasAlternatingStatuses(statuses: string[]): boolean {
    if (statuses.length < 3) return false;
    let changes = 0;
    for (let i = 1; i < statuses.length; i++) {
      if (statuses[i] !== statuses[i - 1]) changes++;
    }
    return changes >= 2;
  }

  private static detectRecurringFailures(
    stats: Map<string, AggregatedTestStat>,
  ): PatternOutput["recurringFailures"] {
    const sigCounts: Map<string, { count: number; testIds: Set<string> }> = new Map();

    for (const [testId, stat] of stats.entries()) {
      for (const [sig, count] of stat.signatures.entries()) {
        if (!sigCounts.has(sig)) {
          sigCounts.set(sig, { count: 0, testIds: new Set() });
        }
        const entry = sigCounts.get(sig)!;
        entry.count += count;
        entry.testIds.add(testId);
      }
    }

    const results: PatternOutput["recurringFailures"] = [];
    for (const [signatureHash, data] of sigCounts.entries()) {
      if (data.count > 1) {
        results.push({
          signatureHash,
          count: data.count,
          testIds: Array.from(data.testIds).slice(0, 10),
        });
      }
    }

    return results.sort((a, b) => b.count - a.count);
  }

  private static detectRegressions(
    stats: Map<string, AggregatedTestStat>,
  ): PatternOutput["regressions"] {
    const results: PatternOutput["regressions"] = [];

    for (const [testId, stat] of stats.entries()) {
      if (stat.durations.length < 5) continue;

      const mid = Math.floor(stat.durations.length / 2);
      const firstHalf = stat.durations.slice(0, mid);
      const secondHalf = stat.durations.slice(mid);

      const avgFirst = firstHalf.reduce((a: number, b: number) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a: number, b: number) => a + b, 0) / secondHalf.length;

      const increasePct = ((avgSecond - avgFirst) / avgFirst) * 100;
      const absoluteIncrease = avgSecond - avgFirst;

      // Threshold: +30% AND +2000ms absolute
      if (increasePct >= 30 && absoluteIncrease >= 2000) {
        results.push({
          testId,
          avgDurationMs: Math.round(avgSecond),
          previousAvgMs: Math.round(avgFirst),
          increasePercent: Math.round(increasePct),
        });
      }
    }

    return results.sort((a, b) => b.increasePercent - a.increasePercent);
  }

  private static detectOSDiffs(records: HistoryRecord[]): PatternOutput["osDiffs"] {
    // Group by testId and OS
    const byTestAndOS: Map<string, Map<string, string[]>> = new Map();

    for (const record of records) {
      const os = record.os || "unknown";
      for (const [testId, result] of Object.entries(record.tests)) {
        if (!byTestAndOS.has(testId)) {
          byTestAndOS.set(testId, new Map());
        }
        const osMap = byTestAndOS.get(testId)!;
        if (!osMap.has(os)) {
          osMap.set(os, []);
        }
        osMap.get(os)!.push(result.status);
      }
    }

    const results: PatternOutput["osDiffs"] = [];

    for (const [testId, osMap] of byTestAndOS.entries()) {
      const darwinStatuses = osMap.get("darwin") || [];
      const linuxStatuses = osMap.get("linux") || [];

      if (darwinStatuses.length === 0 || linuxStatuses.length === 0) continue;

      const darwinFailRate =
        darwinStatuses.filter((s) => s === "failed" || s === "timedOut").length /
        darwinStatuses.length;
      const linuxFailRate =
        linuxStatuses.filter((s) => s === "failed" || s === "timedOut").length /
        linuxStatuses.length;

      // Significant diff: one passes mostly, other fails mostly
      if (
        (darwinFailRate < 0.2 && linuxFailRate > 0.5) ||
        (linuxFailRate < 0.2 && darwinFailRate > 0.5)
      ) {
        results.push({
          testId,
          darwinStatus: darwinFailRate < 0.2 ? "mostly passing" : "mostly failing",
          linuxStatus: linuxFailRate < 0.2 ? "mostly passing" : "mostly failing",
        });
      }
    }

    return results;
  }
}
