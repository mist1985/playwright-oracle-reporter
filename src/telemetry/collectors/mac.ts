/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { MetricsPatch } from "./common";

const execAsync = promisify(exec);

/**
 * Collects macOS specific metrics.
 */
export async function collectMacMetrics(): Promise<MetricsPatch> {
  if (process.platform !== "darwin") {
    return {};
  }

  const patch: MetricsPatch = {
    cpu: {},
    disk: {},
    memory: {},
  };

  try {
    // 1. Disk Usage
    let freeBytes: number | null = null;

    // Try Node.js 18.15+ native API
    if (
      typeof (
        fs as typeof fs & {
          statfsSync?: (path: string) => { bavail: number; bsize: number };
        }
      ).statfsSync === "function"
    ) {
      try {
        const statfsSync = (
          fs as typeof fs & {
            statfsSync: (path: string) => { bavail: number; bsize: number };
          }
        ).statfsSync;
        const stats = statfsSync(process.cwd());
        freeBytes = stats.bavail * stats.bsize;
      } catch {}
    }

    // Fallback to df
    if (freeBytes === null) {
      try {
        const { stdout } = await execAsync("df -k .");
        const lines = stdout.trim().split("\n");
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          if (parts.length >= 4) {
            const available = parseInt(parts[3], 10) * 1024;
            if (!isNaN(available)) freeBytes = available;
          }
        }
      } catch {}
    }

    if (freeBytes !== null) {
      patch.disk = {
        freeGb: Math.round((freeBytes / 1024 / 1024 / 1024) * 100) / 100,
      };
    }

    // 2. CPU Usage (top -l 1)
    try {
      const { stdout } = await execAsync('top -l 1 -n 0 | grep "CPU usage"');
      const userMatch = stdout.match(/([\d.]+)% user/);
      const sysMatch = stdout.match(/([\d.]+)% sys/);
      const idleMatch = stdout.match(/([\d.]+)% idle/);

      if (userMatch && sysMatch && idleMatch) {
        patch.cpu = {
          userPct: parseFloat(userMatch[1]),
          systemPct: parseFloat(sysMatch[1]),
          idlePct: parseFloat(idleMatch[1]),
        };
      }
    } catch {}
  } catch {
    // Ignore global errors
  }

  return patch;
}
