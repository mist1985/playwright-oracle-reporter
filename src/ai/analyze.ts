/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { RuleRegistry } from "./rules/registry";
import { SignatureGenerator } from "./rules/signature";
import {
  RuleContext,
  Finding,
  RulesOutput,
  TestResultLite,
  NormalizedError,
  RunMeta,
  TelemetryWindow,
  HistoryHints,
  SCHEMA_VERSION,
  CAPS,
} from "../types";
import { normalizeSupportedPlatform } from "../common/platform";

/**
 * Rules-based Analyzer
 * Enterprise principle: deterministic, evidence-backed, capped.
 */
export class RulesAnalyzer {
  private registry: RuleRegistry;
  private runMeta: RunMeta;

  /**
   * Initialize the rules-based analyzer
   *
   * @param runMeta - Metadata about the current test run (runId, OS, timestamp, browsers)
   */
  constructor(runMeta?: Partial<RunMeta>) {
    this.registry = new RuleRegistry();
    this.runMeta = {
      runId: runMeta?.runId || "unknown",
      os: runMeta?.os !== undefined ? runMeta.os : normalizeSupportedPlatform(),
      timestamp: runMeta?.timestamp || Date.now(),
      browsers: runMeta?.browsers || [],
    };
  }

  /**
   * Analyze tests using rule-based pattern matching to detect common failure patterns
   *
   * @param tests - Array of test results to analyze
   * @param telemetryWindows - Optional telemetry data windows for each test
   * @param historyHintsMap - Optional historical pattern hints for each test
   * @returns Complete rules analysis output with findings and test-level details
   */
  analyze(
    tests: TestResultLite[],
    telemetryWindows?: Map<string, TelemetryWindow>,
    historyHintsMap?: Map<string, HistoryHints>,
  ): RulesOutput {
    const testsOutput: RulesOutput["tests"] = {};
    const runFindings: Finding[] = [];
    let failureCount = 0;
    let timeoutCount = 0;

    for (const test of tests) {
      if (test.status !== "failed" && test.status !== "timedOut") continue;
      failureCount++;
      if (test.status === "timedOut") timeoutCount++;

      // Normalize error
      const normalizedError: NormalizedError = SignatureGenerator.normalizeError(
        test.error?.message || null,
        test.error?.stack || null,
      );

      // Build context
      const ctx: RuleContext = {
        test,
        normalizedError,
        runMeta: this.runMeta,
        telemetryWindow: telemetryWindows?.get(test.testId) || null,
        historyHints: historyHintsMap?.get(test.testId) || null,
      };

      // Evaluate rules
      const findings = this.registry.evaluate(ctx);

      testsOutput[test.testId] = {
        testId: test.testId,
        status: test.status,
        findings,
      };
    }

    // Generate PM summary
    const pmSummary = this.generatePMSummary(failureCount, timeoutCount, tests.length);

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      pmSummary,
      tests: testsOutput,
      runFindings,
    };
  }

  /**
   * Generate a PM-friendly summary.
   */
  private generatePMSummary(failed: number, timedOut: number, total: number): string {
    if (failed === 0) {
      return `All ${total} tests passed successfully.`;
    }

    if (timedOut > failed / 2) {
      return `Heavy instability: ${timedOut} of ${failed} failures are timeouts. Investigate infrastructure or slow services.`;
    }

    if (failed === 1) {
      return `1 test failed. See findings below for root cause.`;
    }

    return `${failed} tests failed out of ${total}. Review individual test findings for specific fixes.`;
  }

  /**
   * Get rule count for documentation.
   */
  getRuleCount(): number {
    return this.registry.getRuleCount();
  }
}
