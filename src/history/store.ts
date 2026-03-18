/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { HistoryRecord, CAPS } from "../types";

// Re-export for backward compatibility
export { HistoryRecord };

/**
 * Legacy TestPattern interface (kept for HTML rendering compatibility)
 */
export interface TestPattern {
  testId: string;
  flakeRate: number;
  failureRate: number;
  avgDuration: number;
  durationTrend: "stable" | "slower" | "faster";
  lastStatus: string;
  commonSignature?: string;
}

/**
 * History Store
 * Enterprise principle: append-only, bounded window, crash-safe.
 *
 * Newer versions store one JSON file per run to avoid write contention in CI.
 * Legacy `runs.jsonl` history is still read and pruned for backwards compatibility.
 */
export class HistoryStore {
  private readonly historyDir: string;
  private readonly legacyRunsFile: string;
  private readonly runsDir: string;

  /**
   * Initialize the history store
   *
   * @param historyDir - Directory path for storing test history
   */
  constructor(historyDir: string) {
    this.historyDir = historyDir;
    this.legacyRunsFile = path.join(historyDir, "runs.jsonl");
    this.runsDir = path.join(historyDir, "runs");
  }

  /**
   * Save a test run to history storage.
   *
   * Uses atomic write + rename into a run-specific file to reduce CI contention.
   *
   * @param entry - Test run record with results, timestamps, and metadata
   */
  async saveRun(entry: HistoryRecord): Promise<void> {
    this.ensureDir();

    const fileName = `${entry.timestamp}-${randomUUID()}.json`;
    const finalPath = path.join(this.runsDir, fileName);
    const tempPath = `${finalPath}.tmp`;

    await fs.promises.writeFile(tempPath, JSON.stringify(entry), "utf-8");
    await fs.promises.rename(tempPath, finalPath);

    await this.prune();
  }

  /**
   * Get raw entries for the last N days.
   */
  async getEntries(days: number = CAPS.HISTORY_WINDOW_DAYS): Promise<HistoryRecord[]> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const entries: HistoryRecord[] = [];

    for (const { entry } of await this.loadRunFiles()) {
      if (entry.timestamp >= cutoff) {
        entries.push(entry);
      }
    }

    for (const entry of await this.loadLegacyEntries(days)) {
      if (entry.timestamp >= cutoff) {
        entries.push(entry);
      }
    }

    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Remove entries older than the retention window.
   */
  private async prune(): Promise<void> {
    try {
      const cutoff = Date.now() - CAPS.HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

      for (const { entry, filePath } of await this.loadRunFiles()) {
        if (entry.timestamp < cutoff) {
          await fs.promises.unlink(filePath).catch(() => undefined);
        }
      }

      if (fs.existsSync(this.legacyRunsFile)) {
        const legacyEntries = await this.loadLegacyEntries(CAPS.HISTORY_WINDOW_DAYS);

        if (legacyEntries.length === 0) {
          await fs.promises.unlink(this.legacyRunsFile).catch(() => undefined);
        } else {
          const lines = legacyEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
          await fs.promises.writeFile(this.legacyRunsFile, lines, "utf-8");
        }
      }
    } catch {
      // Ignore prune errors
    }
  }

  private async loadRunFiles(): Promise<Array<{ entry: HistoryRecord; filePath: string }>> {
    if (!fs.existsSync(this.runsDir)) return [];

    const fileNames = await fs.promises.readdir(this.runsDir);
    const entries: Array<{ entry: HistoryRecord; filePath: string }> = [];

    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = path.join(this.runsDir, fileName);
      try {
        const raw = await fs.promises.readFile(filePath, "utf-8");
        const entry = JSON.parse(raw) as HistoryRecord;
        entries.push({ entry, filePath });
      } catch {
        // Ignore corrupt files
      }
    }

    return entries;
  }

  private async loadLegacyEntries(days: number): Promise<HistoryRecord[]> {
    if (!fs.existsSync(this.legacyRunsFile)) return [];

    const entries: HistoryRecord[] = [];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const fileStream = fs.createReadStream(this.legacyRunsFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      try {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as HistoryRecord;

        if (entry.timestamp >= cutoff) {
          entries.push(entry);
        }
      } catch {
        // Ignore corrupt lines
      }
    }

    return entries;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }

    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }
  }
}
