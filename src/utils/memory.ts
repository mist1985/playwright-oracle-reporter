/**
 * Memory monitoring and optimization for large test suites
 */

import * as os from "os";

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  percentUsed: number;
  systemFree: number;
  systemTotal: number;
}

export interface MemorySummary {
  samples: number;
  heap: { min: string; max: string; avg: string };
  rss: { min: string; max: string; avg: string };
}

export class MemoryMonitor {
  private samples: MemoryStats[] = [];
  private warningThreshold: number = 0.85; // 85% memory usage
  private criticalThreshold: number = 0.95; // 95% memory usage
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Get current memory statistics
   */
  static getStats(): MemoryStats {
    const mem = process.memoryUsage();
    const systemTotal = os.totalmem();
    const systemFree = os.freemem();

    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
      percentUsed: (mem.heapUsed / mem.heapTotal) * 100,
      systemFree,
      systemTotal,
    };
  }

  /**
   * Format bytes to human-readable string
   */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  /**
   * Start monitoring memory usage
   */
  startMonitoring(intervalMs: number = 5000): void {
    this.checkInterval = setInterval(() => {
      const stats = MemoryMonitor.getStats();
      this.samples.push(stats);

      // Keep only last 100 samples to avoid memory leak
      if (this.samples.length > 100) {
        this.samples.shift();
      }

      // Check thresholds
      const systemUsagePercent = (stats.systemTotal - stats.systemFree) / stats.systemTotal;

      if (systemUsagePercent >= this.criticalThreshold) {
        console.error(
          `🚨 CRITICAL: System memory usage at ${(systemUsagePercent * 100).toFixed(1)}%`,
        );
        console.error(
          `   Heap: ${MemoryMonitor.formatBytes(stats.heapUsed)} / ${MemoryMonitor.formatBytes(stats.heapTotal)}`,
        );
        console.error(
          `   System: ${MemoryMonitor.formatBytes(stats.systemTotal - stats.systemFree)} / ${MemoryMonitor.formatBytes(stats.systemTotal)}`,
        );
        this.triggerGarbageCollection();
      } else if (systemUsagePercent >= this.warningThreshold) {
        console.warn(
          `⚠️  WARNING: System memory usage at ${(systemUsagePercent * 100).toFixed(1)}%`,
        );
      }
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get memory usage summary
   */
  getSummary(): MemorySummary | null {
    if (this.samples.length === 0) {
      return null;
    }

    const heapUsages = this.samples.map((s) => s.heapUsed);
    const rssUsages = this.samples.map((s) => s.rss);

    return {
      samples: this.samples.length,
      heap: {
        min: MemoryMonitor.formatBytes(Math.min(...heapUsages)),
        max: MemoryMonitor.formatBytes(Math.max(...heapUsages)),
        avg: MemoryMonitor.formatBytes(heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length),
      },
      rss: {
        min: MemoryMonitor.formatBytes(Math.min(...rssUsages)),
        max: MemoryMonitor.formatBytes(Math.max(...rssUsages)),
        avg: MemoryMonitor.formatBytes(rssUsages.reduce((a, b) => a + b, 0) / rssUsages.length),
      },
    };
  }

  /**
   * Trigger garbage collection if available
   */
  private triggerGarbageCollection(): void {
    if (global.gc) {
      console.log("🧹 Triggering garbage collection...");
      global.gc();
    } else {
      console.log("💡 Tip: Run with --expose-gc flag to enable manual GC");
    }
  }
}

/**
 * Data chunking utilities for processing large test suites
 */
export class DataChunker<T> {
  private chunkSize: number;

  constructor(chunkSize: number = 100) {
    this.chunkSize = chunkSize;
  }

  /**
   * Split array into chunks
   */
  chunk(items: T[]): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += this.chunkSize) {
      chunks.push(items.slice(i, i + this.chunkSize));
    }
    return chunks;
  }

  /**
   * Process items in chunks with callback
   */
  async processChunks(
    items: T[],
    processor: (chunk: T[], index: number) => Promise<void>,
  ): Promise<void> {
    const chunks = this.chunk(items);

    for (let i = 0; i < chunks.length; i++) {
      await processor(chunks[i], i);

      // Small delay between chunks to allow GC
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  /**
   * Process items in chunks and collect results
   */
  async mapChunks<R>(
    items: T[],
    mapper: (chunk: T[], index: number) => Promise<R[]>,
  ): Promise<R[]> {
    const results: R[] = [];
    const chunks = this.chunk(items);

    for (let i = 0; i < chunks.length; i++) {
      const chunkResults = await mapper(chunks[i], i);
      results.push(...chunkResults);

      // Small delay between chunks
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    return results;
  }
}

/**
 * Object pool for reusing objects and reducing GC pressure
 */
export class ObjectPool<T> {
  private available: T[] = [];
  private factory: () => T;
  private reset: (obj: T) => void;

  constructor(factory: () => T, reset: (obj: T) => void, initialSize: number = 10) {
    this.factory = factory;
    this.reset = reset;

    // Pre-populate pool
    for (let i = 0; i < initialSize; i++) {
      this.available.push(factory());
    }
  }

  /**
   * Acquire object from pool
   */
  acquire(): T {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    return this.factory();
  }

  /**
   * Release object back to pool
   */
  release(obj: T): void {
    this.reset(obj);
    this.available.push(obj);
  }

  /**
   * Get pool size
   */
  size(): number {
    return this.available.length;
  }

  /**
   * Clear pool
   */
  clear(): void {
    this.available = [];
  }
}
