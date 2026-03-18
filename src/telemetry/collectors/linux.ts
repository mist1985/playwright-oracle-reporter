/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { MetricsPatch } from "./common";

const execAsync = promisify(exec);

export interface CpuState {
  total: number;
  steal: number;
  iowait: number;
  user: number;
  system: number;
  idle: number;
}

export interface ComputedCpuStats {
  stealPct: number | null;
  iowaitPct: number | null;
  userPct: number | null;
  systemPct: number | null;
  idlePct: number | null;
}

/**
 * Pure function to parse /proc/stat line
 */
export function parseCpuLine(line: string): CpuState | null {
  const parts = line
    .split(/\s+/)
    .slice(1)
    .map((x) => parseInt(x, 10));
  if (parts.length < 8) return null;

  // /proc/stat columns (0-indexed after cpu):
  // 0: user, 1: nice, 2: system, 3: idle, 4: iowait, 5: irq, 6: softirq, 7: steal
  const user = parts[0] + parts[1]; // user + nice
  const system = parts[2] + parts[5] + parts[6]; // system + irq + softirq
  const idle = parts[3];
  const iowait = parts[4];
  const steal = parts[7];

  const total = parts.reduce((a, b) => a + b, 0);

  return { total, iowait, steal, user, system, idle };
}

/**
 * Pure function to compute stats from two states
 */
export function computeCpuStats(current: CpuState, previous: CpuState): ComputedCpuStats {
  const deltaTotal = current.total - previous.total;
  const deltaIowait = current.iowait - previous.iowait;
  const deltaSteal = current.steal - previous.steal;

  if (deltaTotal <= 0) {
    return { stealPct: null, iowaitPct: null, userPct: null, systemPct: null, idlePct: null };
  }

  // Calculate percentages
  const deltaUser = current.user - previous.user;
  const deltaSystem = current.system - previous.system;
  const deltaIdle = current.idle - previous.idle;

  return {
    iowaitPct: Number(((deltaIowait / deltaTotal) * 100).toFixed(2)),
    stealPct: Number(((deltaSteal / deltaTotal) * 100).toFixed(2)),
    userPct: Number(((deltaUser / deltaTotal) * 100).toFixed(2)),
    systemPct: Number(((deltaSystem / deltaTotal) * 100).toFixed(2)),
    idlePct: Number(((deltaIdle / deltaTotal) * 100).toFixed(2)),
  };
}

export class LinuxCollector {
  private lastCpuState: CpuState | null = null;

  constructor(private readonly platform: string = process.platform) {}

  async collect(): Promise<MetricsPatch> {
    if (this.platform !== "linux") {
      return {};
    }

    const patch: MetricsPatch = {
      cpu: {},
      memory: {},
      disk: {},
    };

    try {
      // 1. CPU Steal/Iowait (Delta based)
      const statContent = await this.readProcStat();
      if (statContent) {
        const cpuLine = statContent.split("\n").find((l) => l.startsWith("cpu "));
        if (cpuLine) {
          const currentState = parseCpuLine(cpuLine);
          if (currentState) {
            if (this.lastCpuState) {
              const stats = computeCpuStats(currentState, this.lastCpuState);
              patch.cpu = stats;
            }
            this.lastCpuState = currentState;
          }
        }
      }

      // 2. Memory Pressure
      const psiContent = await this.readProcPressure();
      if (psiContent) {
        const match = psiContent.match(/avg10=([\d.]+)/);
        if (match) {
          patch.memory = {
            pressurePct: parseFloat(match[1]),
          };
        }
      }

      // 3. Disk Usage (df -k)
      try {
        const { stdout } = await execAsync("df -k .");
        const lines = stdout.trim().split("\n");
        if (lines.length >= 2) {
          // Filesystem 1k-blocks Used Available Use% Mounted on
          // parts split by whitespace
          const parts = lines[1].split(/\s+/);
          // Available is typically index 3 (0-based)
          // standard: FS(0) Blocks(1) Used(2) Avail(3)
          if (parts.length >= 4) {
            const availKb = parseInt(parts[3], 10);
            if (!isNaN(availKb)) {
              patch.disk = {
                freeGb: Math.round((availKb / 1024 / 1024) * 100) / 100, // KB -> GB
              };
            }
          }
        }
      } catch (e) {
        // Disk check failed
      }
    } catch (e) {
      // Best effort
    }

    return patch;
  }

  protected async readProcStat(): Promise<string> {
    try {
      return await fs.readFile("/proc/stat", "utf-8");
    } catch {
      return "";
    }
  }

  protected async readProcPressure(): Promise<string> {
    try {
      return await fs.readFile("/proc/pressure/memory", "utf-8");
    } catch {
      return "";
    }
  }
}
