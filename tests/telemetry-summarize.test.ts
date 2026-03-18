/**
 * Unit tests for telemetry summarizer
 */

import { TelemetrySummarizer } from "../src/telemetry/summarize";
import { NormalizedSystemMetrics } from "../src/telemetry/collectors/common";

/** Build a minimal NormalizedSystemMetrics sample */
function makeSample(
  overrides: Partial<{
    load1: number;
    stealPct: number;
    iowaitPct: number;
    rssMb: number;
    pressurePct: number;
    freeGb: number;
    timestamp: number;
  }> = {},
): NormalizedSystemMetrics {
  return {
    timestamp: overrides.timestamp ?? Date.now(),
    os: "darwin",
    cpu: {
      load1: overrides.load1 ?? 1.0,
      load5: 0.8,
      load15: 0.5,
      stealPct: overrides.stealPct ?? 0,
      iowaitPct: overrides.iowaitPct ?? 0,
      userPct: null,
      systemPct: null,
      idlePct: null,
    },
    memory: {
      totalMb: 16000,
      freeMb: 8000,
      pressurePct: overrides.pressurePct ?? 0,
    },
    process: {
      rssMb: overrides.rssMb ?? 100,
    },
    disk: {
      freeGb: overrides.freeGb ?? 50,
    },
  };
}

describe("TelemetrySummarizer", () => {
  describe("summarize", () => {
    it("should return empty output for empty metrics", () => {
      const result = TelemetrySummarizer.summarize([]);
      expect(result.samples).toBe(0);
      expect(result.cpu.maxLoad1).toBe(0);
      expect(result.cpu.avgLoad1).toBe(0);
      expect(result.memory.maxRssMb).toBe(0);
      expect(result.disk.minFreeGb).toBe(0);
      expect(result.spikes).toHaveLength(0);
    });

    it("should compute correct sample count", () => {
      const result = TelemetrySummarizer.summarize([makeSample(), makeSample(), makeSample()]);
      expect(result.samples).toBe(3);
    });

    it("should compute max and avg CPU load", () => {
      const result = TelemetrySummarizer.summarize([
        makeSample({ load1: 2.0 }),
        makeSample({ load1: 4.0 }),
        makeSample({ load1: 6.0 }),
      ]);
      expect(result.cpu.maxLoad1).toBe(6.0);
      expect(result.cpu.avgLoad1).toBe(4.0);
    });

    it("should compute max RSS memory", () => {
      const result = TelemetrySummarizer.summarize([
        makeSample({ rssMb: 100 }),
        makeSample({ rssMb: 300 }),
        makeSample({ rssMb: 200 }),
      ]);
      expect(result.memory.maxRssMb).toBe(300);
    });

    it("should compute max steal and iowait", () => {
      const result = TelemetrySummarizer.summarize([
        makeSample({ stealPct: 5, iowaitPct: 15 }),
        makeSample({ stealPct: 12, iowaitPct: 25 }),
      ]);
      expect(result.cpu.maxStealPct).toBe(12);
      expect(result.cpu.maxIowaitPct).toBe(25);
    });

    it("should compute max memory pressure", () => {
      const result = TelemetrySummarizer.summarize([
        makeSample({ pressurePct: 5 }),
        makeSample({ pressurePct: 20 }),
      ]);
      expect(result.memory.maxPressurePct).toBe(20);
    });

    it("should compute min free disk", () => {
      const result = TelemetrySummarizer.summarize([
        makeSample({ freeGb: 50 }),
        makeSample({ freeGb: 10 }),
        makeSample({ freeGb: 30 }),
      ]);
      expect(result.disk.minFreeGb).toBe(10);
    });

    it("should detect CPU load spikes", () => {
      const result = TelemetrySummarizer.summarize([
        makeSample({ load1: 5.0 }), // Above THRESHOLDS.LOAD1 (default 4.0)
      ]);
      expect(result.spikes.some((s) => s.metric === "cpu.load1")).toBe(true);
    });

    it("should detect steal spikes", () => {
      const result = TelemetrySummarizer.summarize([
        makeSample({ stealPct: 15 }), // Above THRESHOLDS.STEAL_PCT (default 10)
      ]);
      expect(result.spikes.some((s) => s.metric === "cpu.steal")).toBe(true);
    });

    it("should cap spikes at 10", () => {
      // Create many samples with high load
      const samples = Array.from({ length: 20 }, () =>
        makeSample({ load1: 10, stealPct: 20, pressurePct: 50, iowaitPct: 30 }),
      );
      const result = TelemetrySummarizer.summarize(samples);
      expect(result.spikes.length).toBeLessThanOrEqual(10);
    });

    it("should include schemaVersion and generatedAt", () => {
      const result = TelemetrySummarizer.summarize([makeSample()]);
      expect(result.schemaVersion).toBeTruthy();
      expect(result.generatedAt).toBeTruthy();
      expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
    });
  });
});
