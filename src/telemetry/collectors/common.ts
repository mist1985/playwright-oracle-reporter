/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import * as os from "os";
import * as process from "process";

/**
 * Normalized Telemetry Schema (Enterprise Compliant)
 * All fields must be present. Missing data = null.
 * Units: MB, GB, Percentage (0-100).
 */
export interface NormalizedSystemMetrics {
  timestamp: number; // ms since epoch
  os: "darwin" | "linux";
  cpu: {
    load1: number;
    load5: number;
    load15: number;
    stealPct: number | null; // Linux
    iowaitPct: number | null; // Linux
    userPct: number | null; // macOS, Linux
    systemPct: number | null; // macOS, Linux
    idlePct: number | null; // macOS, Linux
  };
  process: {
    rssMb: number;
  };
  memory: {
    totalMb: number;
    freeMb: number;
    pressurePct: number | null; // Linux PSI or macOS vm_stat
  };
  disk: {
    freeGb: number | null;
  };
}

/**
 * Partial update from an OS collector.
 * Only specific sections can be updated.
 */
export type MetricsPatch = {
  cpu?: Partial<NormalizedSystemMetrics["cpu"]>;
  memory?: Partial<NormalizedSystemMetrics["memory"]>;
  disk?: Partial<NormalizedSystemMetrics["disk"]>;
  process?: Partial<NormalizedSystemMetrics["process"]>;
};

/**
 * Collects common system metrics and normalizes them.
 */
export async function collectCommonMetrics(): Promise<NormalizedSystemMetrics> {
  const loadAvg = os.loadavg(); // [1, 5, 15]
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsage = process.memoryUsage();

  return {
    timestamp: Date.now(),
    os: process.platform === "linux" ? "linux" : "darwin", // simplified for known platforms
    cpu: {
      load1: loadAvg[0],
      load5: loadAvg[1],
      load15: loadAvg[2],
      stealPct: null,
      iowaitPct: null,
      userPct: null,
      systemPct: null,
      idlePct: null,
    },
    process: {
      rssMb: toMb(memUsage.rss),
    },
    memory: {
      totalMb: toMb(totalMem),
      freeMb: toMb(freeMem),
      pressurePct: null,
    },
    disk: {
      freeGb: null,
    },
  };
}

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}
