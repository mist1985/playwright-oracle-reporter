/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { NormalizedSystemMetrics } from "./collectors/common";
import { TelemetrySummaryOutput, SCHEMA_VERSION, THRESHOLDS } from "../types";

/**
 * Telemetry Summarizer
 * Enterprise principle: pure function, deterministic, safe.
 */
export class TelemetrySummarizer {
  /**
   * Summarize telemetry samples into aggregated metrics and detect spikes
   * Calculates max/avg CPU load, memory pressure, disk usage, and identifies anomalies
   *
   * @param metrics - Array of raw telemetry samples collected during test execution
   * @returns Summarized telemetry output with aggregated stats and spike detections
   */
  static summarize(metrics: NormalizedSystemMetrics[]): TelemetrySummaryOutput {
    if (metrics.length === 0) {
      return this.emptyOutput();
    }

    const loads = metrics.map((m) => m.cpu?.load1 || 0);
    const steals = metrics.map((m) => m.cpu?.stealPct || 0);
    const iowaits = metrics.map((m) => m.cpu?.iowaitPct || 0);
    const rss = metrics.map((m) => m.process?.rssMb || 0);
    const pressures = metrics.map((m) => m.memory?.pressurePct || 0);
    const disks = metrics.map((m) => m.disk?.freeGb || 9999);

    // Detect spikes
    const spikes = this.detectSpikes(metrics);

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      samples: metrics.length,
      cpu: {
        maxLoad1: this.round(Math.max(...loads)),
        avgLoad1: this.round(loads.reduce((a, b) => a + b, 0) / loads.length),
        maxStealPct: this.round(Math.max(...steals)),
        maxIowaitPct: this.round(Math.max(...iowaits)),
      },
      memory: {
        maxRssMb: this.round(Math.max(...rss)),
        maxPressurePct: this.round(Math.max(...pressures)),
      },
      disk: {
        minFreeGb: this.round(Math.min(...disks)),
      },
      spikes,
    };
  }

  private static emptyOutput(): TelemetrySummaryOutput {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      samples: 0,
      cpu: { maxLoad1: 0, avgLoad1: 0, maxStealPct: 0, maxIowaitPct: 0 },
      memory: { maxRssMb: 0, maxPressurePct: 0 },
      disk: { minFreeGb: 0 },
      spikes: [],
    };
  }

  private static detectSpikes(
    metrics: NormalizedSystemMetrics[],
  ): TelemetrySummaryOutput["spikes"] {
    const spikes: TelemetrySummaryOutput["spikes"] = [];
    const maxSpikes = 10; // Cap

    for (const m of metrics) {
      if (spikes.length >= maxSpikes) break;

      if ((m.cpu?.load1 || 0) > THRESHOLDS.LOAD1) {
        spikes.push({
          timestamp: m.timestamp,
          metric: "cpu.load1",
          value: m.cpu.load1,
        });
      }
      if ((m.memory?.pressurePct || 0) > THRESHOLDS.PRESSURE_PCT) {
        spikes.push({
          timestamp: m.timestamp,
          metric: "memory.pressure",
          value: m.memory.pressurePct || 0,
        });
      }
      if ((m.cpu?.stealPct || 0) > THRESHOLDS.STEAL_PCT) {
        spikes.push({
          timestamp: m.timestamp,
          metric: "cpu.steal",
          value: m.cpu.stealPct || 0,
        });
      }
      if ((m.cpu?.iowaitPct || 0) > THRESHOLDS.IOWAIT_PCT) {
        spikes.push({
          timestamp: m.timestamp,
          metric: "cpu.iowait",
          value: m.cpu.iowaitPct || 0,
        });
      }
    }

    return spikes.slice(0, maxSpikes);
  }

  private static round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
