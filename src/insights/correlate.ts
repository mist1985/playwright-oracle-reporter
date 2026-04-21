/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { NormalizedSystemMetrics } from "../telemetry/collectors/common";
import { Finding, TestResultLite, TelemetryWindow, CAPS, THRESHOLDS } from "../types";

/**
 * Correlation Engine
 * Enterprise principle: pure function, correlation language (not causation), capped.
 */
export class CorrelationEngine {
  /**
   * Correlate failed tests with telemetry windows to identify infrastructure issues
   * Detects elevated CPU load, memory pressure, CPU steal, and I/O wait during test failures
   *
   * @param failedTests - Array of failed test results
   * @param telemetry - Array of system telemetry samples
   * @returns Array of correlation findings (not causation - requires human interpretation)
   */
  static correlate(failedTests: TestResultLite[], telemetry: NormalizedSystemMetrics[]): Finding[] {
    const findings: Finding[] = [];
    if (telemetry.length === 0 || failedTests.length === 0) return findings;

    for (const test of failedTests) {
      if (test.status !== "failed" && test.status !== "timedOut") continue;
      if (test.startTimeMs === null) continue; // Need timestamps

      const window = this.getWindow(test, telemetry);
      if (!window || window.samples.length === 0) continue;

      // Check for correlations
      const maxLoad = Math.max(...window.samples.map((m) => m.cpu.load1));
      const maxPressure = Math.max(...window.samples.map((m) => m.memory.pressurePct ?? 0));
      const maxSteal = Math.max(...window.samples.map((m) => m.cpu.stealPct ?? 0));
      const _maxIowait = Math.max(...window.samples.map((m) => m.cpu.iowaitPct ?? 0));

      if (maxLoad > THRESHOLDS.LOAD1) {
        findings.push({
          id: "telemetry-cpu-load",
          scope: "test",
          kind: "telemetry",
          title: "Elevated CPU Load Correlated with Failure",
          confidence: 0.6,
          summary: `Test "${test.title}" failed during period of high CPU load (${String(maxLoad.toFixed(1))}).`,
          details: `Window: ${String(window.samples.length)} samples. Max load1: ${String(maxLoad.toFixed(2))}.`,
          evidenceRefs: [
            `test: ${test.testId}`,
            `cpu.load1: ${String(maxLoad.toFixed(2))}`,
            `window: ${String(window.samples.length)} samples`,
          ],
          recommendedActions: [
            "Reduce parallel test workers.",
            "Check for resource-intensive background processes.",
            "Consider running tests on a more powerful machine.",
          ],
        });
      }

      if (maxPressure > THRESHOLDS.PRESSURE_PCT) {
        findings.push({
          id: "telemetry-memory-pressure",
          scope: "test",
          kind: "telemetry",
          title: "Memory Pressure Correlated with Failure",
          confidence: 0.7,
          summary: `Test "${test.title}" failed during period of memory pressure (${String(maxPressure)}%).`,
          details: `Window: ${String(window.samples.length)} samples. Max pressure: ${String(maxPressure)}%.`,
          evidenceRefs: [`test: ${test.testId}`, `memory.pressure: ${String(maxPressure)}%`],
          recommendedActions: [
            "Increase available memory.",
            "Check for memory leaks in tests or application.",
            "Reduce number of parallel workers.",
          ],
        });
      }

      if (maxSteal > THRESHOLDS.STEAL_PCT) {
        findings.push({
          id: "telemetry-cpu-steal",
          scope: "test",
          kind: "telemetry",
          title: "CPU Steal (Noisy Neighbor) Correlated with Failure",
          confidence: 0.5,
          summary: `Test "${test.title}" failed during period of high CPU steal (${String(maxSteal.toFixed(1))}%).`,
          details: "High steal time indicates the host is overcommitted or sharing resources.",
          evidenceRefs: [`test: ${test.testId}`, `cpu.steal: ${String(maxSteal.toFixed(1))}%`],
          recommendedActions: [
            "Retry on a different CI runner.",
            "Request dedicated/reserved resources.",
            "Check VM/container resource limits.",
          ],
        });
      }

      // Cap findings
      if (findings.length >= 10) break;
    }

    return findings;
  }

  /**
   * Get telemetry window for a test.
   */
  static getWindowSummary(
    test: TestResultLite,
    telemetry: NormalizedSystemMetrics[],
  ): TelemetryWindow | null {
    const window = this.getWindow(test, telemetry);
    if (!window || window.samples.length === 0) return null;

    return {
      startMs: test.startTimeMs!,
      endMs: test.endTimeMs ?? test.startTimeMs! + test.durationMs,
      samples: window.samples.length,
      maxLoad1: Math.max(...window.samples.map((m) => m.cpu.load1)),
      maxPressurePct: Math.max(...window.samples.map((m) => m.memory.pressurePct ?? 0)),
      maxIowaitPct: Math.max(...window.samples.map((m) => m.cpu.iowaitPct ?? 0)),
      maxStealPct: Math.max(...window.samples.map((m) => m.cpu.stealPct ?? 0)),
    };
  }

  private static getWindow(
    test: TestResultLite,
    telemetry: NormalizedSystemMetrics[],
  ): { samples: NormalizedSystemMetrics[] } | null {
    if (test.startTimeMs === null) return null;

    const start = test.startTimeMs - CAPS.TELEMETRY_CORRELATION_BUFFER_MS;
    const end =
      (test.endTimeMs ?? test.startTimeMs + test.durationMs) + CAPS.TELEMETRY_CORRELATION_BUFFER_MS;

    const samples = telemetry.filter((m) => m.timestamp >= start && m.timestamp <= end);
    return { samples };
  }
}
