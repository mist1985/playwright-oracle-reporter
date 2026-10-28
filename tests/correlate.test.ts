import { CorrelationEngine } from "../src/insights/correlate";
import type { NormalizedSystemMetrics } from "../src/telemetry/collectors/common";
import type { TestResultLite } from "../src/types";

const T0 = 1_700_000_000_000;

function sample(
  offsetMs: number,
  overrides: {
    load1?: number;
    pressurePct?: number | null;
    stealPct?: number | null;
    iowaitPct?: number | null;
  } = {},
): NormalizedSystemMetrics {
  return {
    timestamp: T0 + offsetMs,
    os: "linux",
    cpu: {
      load1: overrides.load1 ?? 1,
      load5: 1,
      load15: 1,
      stealPct: overrides.stealPct ?? null,
      iowaitPct: overrides.iowaitPct ?? null,
      userPct: null,
      systemPct: null,
      idlePct: null,
    },
    process: { rssMb: 100 },
    memory: { totalMb: 1000, freeMb: 500, pressurePct: overrides.pressurePct ?? null },
    disk: { freeGb: null },
  };
}

function lite(overrides: Partial<TestResultLite> = {}): TestResultLite {
  return {
    testId: "t1",
    title: "checkout",
    file: "a.spec.ts",
    projectName: null,
    status: "failed",
    durationMs: 1000,
    retries: 0,
    attempt: 1,
    startTimeMs: T0,
    endTimeMs: T0 + 1000,
    error: { message: "x", stack: null },
    attachments: { tracePath: null, screenshotPath: null, videoPath: null },
    ...overrides,
  };
}

describe("CorrelationEngine.correlate", () => {
  it("returns nothing without telemetry or failures", () => {
    expect(CorrelationEngine.correlate([], [sample(0)])).toEqual([]);
    expect(CorrelationEngine.correlate([lite()], [])).toEqual([]);
  });

  it("flags high CPU load, memory pressure and CPU steal inside the test window", () => {
    const findings = CorrelationEngine.correlate(
      [lite()],
      [sample(500, { load1: 9, pressurePct: 40, stealPct: 25, iowaitPct: 50 })],
    );
    expect(findings.map((f) => f.id)).toEqual([
      "telemetry-cpu-load",
      "telemetry-memory-pressure",
      "telemetry-cpu-steal",
    ]);
    expect(findings[0].summary).toContain("checkout");
    expect(findings[0].evidenceRefs).toContain("test: t1");
  });

  it("ignores samples outside the window (beyond the 5s buffer)", () => {
    expect(CorrelationEngine.correlate([lite()], [sample(20_000, { load1: 50 })])).toEqual([]);
  });

  it("includes samples within the buffer before the test started", () => {
    const findings = CorrelationEngine.correlate([lite()], [sample(-4_000, { load1: 50 })]);
    expect(findings).toHaveLength(1);
  });

  it("uses duration when endTimeMs is missing", () => {
    const findings = CorrelationEngine.correlate(
      [lite({ endTimeMs: null, durationMs: 10_000 })],
      [sample(12_000, { load1: 50 })],
    );
    expect(findings).toHaveLength(1);
  });

  it("skips passed tests and tests without timestamps", () => {
    const hot = [sample(0, { load1: 50 })];
    expect(CorrelationEngine.correlate([lite({ status: "passed" })], hot)).toEqual([]);
    expect(CorrelationEngine.correlate([lite({ startTimeMs: null })], hot)).toEqual([]);
  });

  it("stays quiet under normal load", () => {
    expect(CorrelationEngine.correlate([lite()], [sample(0)])).toEqual([]);
  });

  it("caps findings at roughly 10", () => {
    const tests = Array.from({ length: 20 }, (_, i) => lite({ testId: `t${String(i)}` }));
    const findings = CorrelationEngine.correlate(tests, [
      sample(0, { load1: 50, pressurePct: 50, stealPct: 50 }),
    ]);
    expect(findings.length).toBeLessThanOrEqual(12);
    expect(findings.length).toBeGreaterThanOrEqual(10);
  });

  it("honours threshold overrides from the environment", () => {
    const original = process.env.PW_ORACLE_THRESHOLD_LOAD1;
    process.env.PW_ORACLE_THRESHOLD_LOAD1 = "100";
    try {
      expect(CorrelationEngine.correlate([lite()], [sample(0, { load1: 50 })])).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.PW_ORACLE_THRESHOLD_LOAD1;
      else process.env.PW_ORACLE_THRESHOLD_LOAD1 = original;
    }
  });
});

describe("CorrelationEngine.getWindowSummary", () => {
  it("summarises the window", () => {
    const summary = CorrelationEngine.getWindowSummary(lite(), [
      sample(0, { load1: 2, pressurePct: 5, stealPct: 1, iowaitPct: 3 }),
      sample(800, { load1: 6 }),
    ]);
    expect(summary).toEqual({
      startMs: T0,
      endMs: T0 + 1000,
      samples: 2,
      maxLoad1: 6,
      maxPressurePct: 5,
      maxIowaitPct: 3,
      maxStealPct: 1,
    });
  });

  it("returns null with no samples or no start time", () => {
    expect(CorrelationEngine.getWindowSummary(lite(), [])).toBeNull();
    expect(CorrelationEngine.getWindowSummary(lite({ startTimeMs: null }), [sample(0)])).toBeNull();
  });
});
