/**
 * Playwright Oracle Reporter - Windows Telemetry Collector
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * Collects Windows metrics with Node.js APIs only — no subprocesses.
 *
 * Earlier versions shelled out to `wmic` three times per sample. WMIC is
 * deprecated and no longer installed by default on recent Windows 11 builds,
 * and spawning processes every few seconds adds measurable overhead to the
 * very test runs being observed. Node.js exposes the same data directly:
 *
 * - CPU: user/system/idle split from `os.cpus()` time deltas between samples
 *   (real values instead of the old estimated 80/20 user/system split)
 * - Memory: `os.freemem()` (already provided by the common collector)
 * - Disk: `fs.statfsSync()` on the drive holding the working directory
 *
 * @module telemetry/collectors/windows
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MetricsPatch } from "./common";
import { isWindows } from "../../common/platform";
import { getLogger } from "../../common/logger";
import { BYTES } from "../../common/constants";

const logger = getLogger();

/** Aggregate CPU times across all cores. */
export interface CpuTimes {
  user: number;
  sys: number;
  idle: number;
  total: number;
}

/** Previous CPU snapshot, used to compute utilisation over the sampling interval. */
let previousCpuTimes: CpuTimes | null = null;

/**
 * Sum `os.cpus()` times across all cores.
 */
export function readCpuTimes(cpus: ReadonlyArray<os.CpuInfo> = os.cpus()): CpuTimes {
  const acc: CpuTimes = { user: 0, sys: 0, idle: 0, total: 0 };
  for (const cpu of cpus) {
    const { user, nice, sys, idle, irq } = cpu.times;
    acc.user += user + nice;
    acc.sys += sys + irq;
    acc.idle += idle;
    acc.total += user + nice + sys + idle + irq;
  }
  return acc;
}

/**
 * Compute user/system/idle percentages between two CPU snapshots.
 * Returns `null` when the interval is empty (no elapsed CPU time).
 */
export function computeCpuPercentages(
  prev: CpuTimes,
  next: CpuTimes,
): { userPct: number; systemPct: number; idlePct: number } | null {
  const total = next.total - prev.total;
  if (!(total > 0)) return null;
  const round = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
  return {
    userPct: round(((next.user - prev.user) / total) * 100),
    systemPct: round(((next.sys - prev.sys) / total) * 100),
    idlePct: round(((next.idle - prev.idle) / total) * 100),
  };
}

/** Free space (GB) on the drive containing the working directory, or null. */
function readDiskFreeGb(): number | null {
  const statfsSync = (
    fs as typeof fs & {
      statfsSync?: (p: string) => { bavail: number; bsize: number };
    }
  ).statfsSync;
  if (typeof statfsSync !== "function") return null;

  try {
    const stats = statfsSync(path.parse(process.cwd()).root || process.cwd());
    const freeBytes = stats.bavail * stats.bsize;
    if (!Number.isFinite(freeBytes)) return null;
    return Math.round((freeBytes / BYTES.GB) * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Collects Windows-specific system metrics.
 *
 * @returns Metrics patch containing CPU and disk usage
 */
export function collectWindowsMetrics(): Promise<MetricsPatch> {
  // Skip silently if not running on Windows (called every sample interval)
  if (!isWindows()) {
    return Promise.resolve({});
  }

  const patch: MetricsPatch = {
    cpu: {},
    disk: {},
    memory: {},
  };

  try {
    const current = readCpuTimes();
    if (previousCpuTimes) {
      const pct = computeCpuPercentages(previousCpuTimes, current);
      if (pct) patch.cpu = pct;
    }
    previousCpuTimes = current;
  } catch (error) {
    logger.debug("Failed to collect Windows CPU metrics", { error });
  }

  const freeGb = readDiskFreeGb();
  if (freeGb !== null) {
    patch.disk = { freeGb };
  }

  return Promise.resolve(patch);
}

/** @internal Reset the CPU baseline (tests only). */
export function resetWindowsCpuBaseline(): void {
  previousCpuTimes = null;
}
