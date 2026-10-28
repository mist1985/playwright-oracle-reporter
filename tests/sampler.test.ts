jest.mock("../src/telemetry/collectors/common", () => ({
  collectCommonMetrics: jest.fn(),
}));
jest.mock("../src/telemetry/collectors/mac", () => ({
  collectMacMetrics: jest.fn(async () => ({})),
}));
jest.mock("../src/telemetry/collectors/windows", () => ({
  collectWindowsMetrics: jest.fn(async () => ({})),
}));
jest.mock("../src/telemetry/collectors/linux", () => ({
  LinuxCollector: jest.fn().mockImplementation(() => ({ collect: jest.fn(async () => ({})) })),
}));

import { collectCommonMetrics } from "../src/telemetry/collectors/common";
import { TelemetrySampler } from "../src/telemetry/sampler";

const sample = () => ({
  timestamp: Date.now(),
  os: "linux",
  cpu: {
    load1: 1,
    load5: 1,
    load15: 1,
    stealPct: null,
    iowaitPct: null,
    userPct: null,
    systemPct: null,
    idlePct: null,
  },
  process: { rssMb: 1 },
  memory: { totalMb: 1, freeMb: 1, pressurePct: null },
  disk: { freeGb: null },
});

describe("TelemetrySampler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("never runs overlapping samples when collection is slower than the interval", async () => {
    let resolveSample: (v: unknown) => void = () => {};
    (collectCommonMetrics as jest.Mock).mockImplementation(
      () => new Promise((r) => (resolveSample = r)),
    );

    const sampler = new TelemetrySampler(1);
    sampler.start();
    jest.advanceTimersByTime(5000);
    expect(collectCommonMetrics).toHaveBeenCalledTimes(1);

    resolveSample(sample());
    await jest.runOnlyPendingTimersAsync();
    sampler.stop();
  });

  it("discards samples that resolve after stop()", async () => {
    let resolveSample: (v: unknown) => void = () => {};
    (collectCommonMetrics as jest.Mock).mockImplementation(
      () => new Promise((r) => (resolveSample = r)),
    );

    const sampler = new TelemetrySampler(1);
    sampler.start();
    const metrics = sampler.stop();
    resolveSample(sample());
    await Promise.resolve();
    await Promise.resolve();
    expect(metrics).toHaveLength(0);
  });

  it("falls back to the default interval for 0, negative or NaN", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const sampler = new TelemetrySampler(bad);
      expect((sampler as unknown as { intervalMs: number }).intervalMs).toBe(3000);
    }
  });
});
