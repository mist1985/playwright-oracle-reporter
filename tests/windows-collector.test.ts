import type * as os from "os";
import { computeCpuPercentages, readCpuTimes } from "../src/telemetry/collectors/windows";

function cpu(user: number, sys: number, idle: number, nice = 0, irq = 0): os.CpuInfo {
  return { model: "x", speed: 1, times: { user, nice, sys, idle, irq } };
}

describe("Windows CPU metrics", () => {
  it("sums times across cores", () => {
    expect(readCpuTimes([cpu(10, 5, 85), cpu(20, 10, 70, 1, 2)])).toEqual({
      user: 31,
      sys: 17,
      idle: 155,
      total: 203,
    });
  });

  it("computes utilisation from the delta between two snapshots", () => {
    const prev = { user: 100, sys: 50, idle: 850, total: 1000 };
    const next = { user: 160, sys: 70, idle: 970, total: 1200 };
    expect(computeCpuPercentages(prev, next)).toEqual({ userPct: 30, systemPct: 10, idlePct: 60 });
  });

  it("returns null when no CPU time elapsed", () => {
    const snap = { user: 1, sys: 1, idle: 1, total: 3 };
    expect(computeCpuPercentages(snap, snap)).toBeNull();
  });
});
