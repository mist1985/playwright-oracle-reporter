/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

/**
 * Advanced Flakiness Analyzer
 *
 * Algorithmic analysis to detect root causes of test flakiness:
 * - Race conditions
 * - Timing issues
 * - Network dependencies
 * - State pollution
 *
 * Results are sent to AI for confirmation/enhancement.
 */

/**
 * Root cause types for flakiness
 */
export type FlakinessRootCauseType =
  | "race-condition"
  | "timing-issue"
  | "network-timing"
  | "state-dependency"
  | "animation-timing"
  | "resource-contention"
  | "unknown";

/**
 * Root cause finding
 */
export interface RootCauseFinding {
  type: FlakinessRootCauseType;
  confidence: number; // 0-100
  description: string;
  evidence: {
    metric?: string;
    value?: number | string;
    context?: string;
  };
}

/**
 * Suggested fix
 */
export interface SuggestedFix {
  description: string;
  codeExample?: string;
  expectedImpact: string;
  risk: "low" | "medium" | "high";
}

/**
 * Flakiness analysis result
 */
export interface FlakinessAnalysis {
  testId: string;
  overallConfidence: number;
  findings: RootCauseFinding[];
  suggestions: SuggestedFix[];
}

/**
 * Test statistics for analysis
 */
export interface TestStatistics {
  testId: string;
  total: number;
  failed: number;
  flaky: number;
  durations: number[];
  statuses: string[];
  file?: string;
  line?: number;
}

/**
 * Statistical utilities
 */
class Stats {
  static mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  static stdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const avg = this.mean(values);
    const squareDiffs = values.map((value) => Math.pow(value - avg, 2));
    const avgSquareDiff = this.mean(squareDiffs);
    return Math.sqrt(avgSquareDiff);
  }

  static coefficientOfVariation(values: number[]): number {
    const avg = this.mean(values);
    if (avg === 0) return 0;
    return this.stdDev(values) / avg;
  }

  static percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

import { CodeAnalyzer } from "./code-analyzer";

/**
 * Advanced Flakiness Analyzer
 */
export class FlakinessAnalyzer {
  /**
   * Analyze a flaky test to determine root causes
   */
  static async analyze(stats: TestStatistics): Promise<FlakinessAnalysis> {
    const findings: RootCauseFinding[] = [];
    const suggestions: SuggestedFix[] = [];

    // Run all detectors
    const timingFindings = this.detectTimingIssues(stats);
    const raceFindings = this.detectRaceConditions(stats);
    const networkFindings = this.detectNetworkIssues(stats);

    findings.push(...timingFindings, ...raceFindings, ...networkFindings);

    // Advanced: Run code analysis if file/line is available
    if (stats.file && stats.line) {
      const codeFindings = await CodeAnalyzer.analyze(stats.file, stats.line);

      for (const cf of codeFindings) {
        // Map code findings to root causes
        const typeMap: Record<string, FlakinessRootCauseType> = {
          "race-condition": "race-condition",
          "missing-await": "timing-issue",
          "hardcoded-timeout": "timing-issue",
          "anti-pattern": "unknown",
        };
        findings.push({
          type: typeMap[cf.type] ?? "unknown",
          confidence: 90, // High confidence for code patterns
          description: `${cf.suggestion} Found in: ${cf.snippet}`,
          evidence: {
            metric: "code_pattern",
            context: cf.snippet,
          },
        });

        if (cf.fix) {
          suggestions.push({
            description: `Fix ${cf.type}: ${cf.suggestion}`,
            codeExample: cf.fix,
            expectedImpact: "Should fix the identified anti-pattern",
            risk: "low",
          });
        }
      }
    }

    // Generate suggestions based on findings
    for (const finding of findings) {
      const suggestionsForFinding = this.generateSuggestions(finding, stats);
      suggestions.push(...suggestionsForFinding);
    }

    // Calculate overall confidence
    const overallConfidence =
      findings.length > 0 ? Math.max(...findings.map((f) => f.confidence)) : 0;

    return {
      testId: stats.testId,
      overallConfidence,
      findings: findings.slice(0, 5), // Cap at 5 findings
      suggestions: suggestions.slice(0, 5), // Cap at 3+ suggestions now
    };
  }

  /**
   * Detect timing issues from duration variance
   */
  private static detectTimingIssues(stats: TestStatistics): RootCauseFinding[] {
    const findings: RootCauseFinding[] = [];

    if (stats.durations.length < 3) {
      return findings;
    }

    const mean = Stats.mean(stats.durations);
    const stdDev = Stats.stdDev(stats.durations);
    const cv = Stats.coefficientOfVariation(stats.durations);
    const p95 = Stats.percentile(stats.durations, 95);
    const p50 = Stats.percentile(stats.durations, 50);
    const min = Math.min(...stats.durations);
    const max = Math.max(...stats.durations);

    // High variance indicates timing sensitivity
    if (cv > 0.5) {
      const confidence = Math.min(cv * 100, 95);

      findings.push({
        type: "timing-issue",
        confidence: Math.round(confidence),
        description: `Test duration is highly variable (CV=${cv.toFixed(2)}). This suggests timing-dependent behavior.`,
        evidence: {
          metric: "duration_variance",
          value: `${min}ms - ${max}ms (median: ${p50}ms, p95: ${p95}ms)`,
          context: `High coefficient of variation (${(cv * 100).toFixed(0)}%) indicates unreliable timing`,
        },
      });
    }

    // Very long p95 suggests occasional slowness
    if (p95 > mean * 2 && p95 > 3000) {
      findings.push({
        type: "resource-contention",
        confidence: 75,
        description:
          "Test occasionally takes much longer than average, suggesting resource contention or slow network.",
        evidence: {
          metric: "p95_duration",
          value: `${p95}ms vs avg ${Math.round(mean)}ms`,
          context: "P95 is more than 2x the average duration",
        },
      });
    }

    return findings;
  }

  /**
   * Detect race conditions from failure patterns
   */
  private static detectRaceConditions(stats: TestStatistics): RootCauseFinding[] {
    const findings: RootCauseFinding[] = [];

    // Pattern: alternating pass/fail suggests race condition
    let consecChanges = 0;
    for (let i = 1; i < stats.statuses.length; i++) {
      if (stats.statuses[i] !== stats.statuses[i - 1]) {
        consecChanges++;
      }
    }

    const changeRate = consecChanges / (stats.statuses.length - 1);

    // High change rate (> 60%) suggests non-deterministic behavior
    if (changeRate > 0.6 && stats.statuses.length >= 5) {
      findings.push({
        type: "race-condition",
        confidence: Math.min(Math.round(changeRate * 100), 92),
        description:
          "Test results alternate between pass and fail, indicating a race condition or timing-dependent behavior.",
        evidence: {
          metric: "status_change_rate",
          value: `${(changeRate * 100).toFixed(0)}%`,
          context: `Recent statuses: ${stats.statuses.slice(-5).join(", ")}`,
        },
      });
    }

    // Flaky rate between 20-80% is the "classic" race condition range
    const flakeRate = stats.flaky / stats.total;
    if (flakeRate >= 0.2 && flakeRate <= 0.8) {
      findings.push({
        type: "race-condition",
        confidence: 85,
        description:
          "Flake rate in the 20-80% range is characteristic of race conditions where timing matters.",
        evidence: {
          metric: "flake_rate",
          value: `${(flakeRate * 100).toFixed(0)}%`,
          context: `${stats.flaky} flaky out of ${stats.total} runs`,
        },
      });
    }

    return findings;
  }

  /**
   * Detect network-related timing issues
   */
  private static detectNetworkIssues(stats: TestStatistics): RootCauseFinding[] {
    const findings: RootCauseFinding[] = [];

    // If durations are long and variable, might be network-dependent
    const mean = Stats.mean(stats.durations);
    const cv = Stats.coefficientOfVariation(stats.durations);

    if (mean > 2000 && cv > 0.4) {
      findings.push({
        type: "network-timing",
        confidence: 70,
        description:
          "Long, variable test duration suggests dependency on external network requests.",
        evidence: {
          metric: "avg_duration",
          value: `${Math.round(mean)}ms with high variance`,
          context: "Tests depending on real network calls are inherently flaky",
        },
      });
    }

    return findings;
  }

  /**
   * Generate actionable suggestions based on findings
   */
  private static generateSuggestions(
    finding: RootCauseFinding,
    stats: TestStatistics,
  ): SuggestedFix[] {
    const suggestions: SuggestedFix[] = [];

    switch (finding.type) {
      case "timing-issue":
        const p95 = Stats.percentile(stats.durations, 95);
        const recommendedTimeout = Math.ceil(p95 * 1.5);

        suggestions.push({
          description: "Increase timeout to accommodate duration variance",
          codeExample: `await expect(locator).toBeVisible({ timeout: ${recommendedTimeout} });`,
          expectedImpact: "Should reduce timeout failures by ~70%",
          risk: "low",
        });
        break;

      case "race-condition":
        suggestions.push({
          description: "Add explicit wait for state change before assertions",
          codeExample: `// After action, wait for state change\nawait page.waitForResponse(resp => resp.url().includes('/api/'));\n// Then assert\nawait expect(locator).toBeVisible();`,
          expectedImpact: "Should eliminate race condition if root cause is async state",
          risk: "low",
        });

        suggestions.push({
          description: "Ensure test waits for network idle",
          codeExample: `await page.waitForLoadState('networkidle');`,
          expectedImpact: "Ensures all network requests complete before assertions",
          risk: "medium",
        });
        break;

      case "network-timing":
        suggestions.push({
          description: "Mock network requests for deterministic tests",
          codeExample: `await page.route('**/api/**', route => {\n  route.fulfill({ status: 200, body: mockData });\n});`,
          expectedImpact: "Eliminates network variability entirely",
          risk: "medium",
        });

        suggestions.push({
          description: "Add explicit wait for critical network requests",
          codeExample: `await Promise.all([\n  page.waitForResponse('/api/critical'),\n  page.click('button')\n]);`,
          expectedImpact: "Ensures critical requests complete",
          risk: "low",
        });
        break;

      case "resource-contention":
        suggestions.push({
          description: "Reduce test parallelism or increase resources",
          codeExample: `// In playwright.config.ts\nworkers: Math.max(1, os.cpus().length / 2)`,
          expectedImpact: "Reduces resource contention",
          risk: "low",
        });
        break;
    }

    return suggestions;
  }
}
