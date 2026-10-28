/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { collectCommonMetrics, NormalizedSystemMetrics } from "./collectors/common";
import { collectMacMetrics } from "./collectors/mac";
import { LinuxCollector } from "./collectors/linux";
import { collectWindowsMetrics } from "./collectors/windows";

/**
 * TelemetrySampler
 *
 * Collects system metrics at regular intervals during test execution.
 * Provides cross-platform telemetry data for CPU, memory, disk, and network metrics.
 */
export class TelemetrySampler {
  private intervalId: NodeJS.Timeout | null = null;
  private metrics: NormalizedSystemMetrics[] = [];
  /** True while a sample is being collected; prevents overlapping (piled-up) samples. */
  private sampling = false;
  /** Whether the sampler is running; samples resolving after stop() are discarded. */
  private running = false;
  private readonly intervalMs: number;
  private linuxCollector: LinuxCollector;

  /**
   * Initialize the telemetry sampler
   *
   * @param intervalSeconds - Sampling interval in seconds (default: 3)
   */
  constructor(intervalSeconds: number = 3) {
    // Guard against 0, negative or NaN intervals, which would busy-loop setInterval.
    const seconds = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 3;
    this.intervalMs = seconds * 1000;
    this.linuxCollector = new LinuxCollector();
  }

  /**
   * Start collecting telemetry metrics at the configured interval
   * Performs an immediate sample, then continues sampling on the interval
   */
  start(): void {
    if (this.intervalId) return;
    this.running = true;
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.intervalMs);
    // Never keep the Node.js process alive just for telemetry.
    this.intervalId.unref();
  }

  /** Start a sample unless the previous one is still in flight. */
  private tick(): void {
    if (this.sampling) return;
    this.sampling = true;
    this.sample()
      .catch(() => {})
      .finally(() => {
        this.sampling = false;
      });
  }

  /**
   * Stop collecting telemetry metrics and return all collected data
   *
   * @returns Array of all collected system metrics
   */
  stop(): NormalizedSystemMetrics[] {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    return this.metrics;
  }

  /**
   * Safe sampling with deep merge and validation
   */
  private async sample(): Promise<void> {
    try {
      // 1. Base (Full schema with defaults)
      const common = await collectCommonMetrics();

      // 2. Patches
      const macPatch = await collectMacMetrics();
      const linuxPatch = await this.linuxCollector.collect();
      const winPatch = await collectWindowsMetrics();

      // 3. Deep Merge (Enterprise Safe)
      const merged: NormalizedSystemMetrics = {
        ...common,
        // OS
        os: common.os, // Locked by common

        // CPU
        cpu: {
          ...common.cpu,
          ...(macPatch.cpu ?? {}),
          ...(linuxPatch.cpu ?? {}),
          ...(winPatch.cpu ?? {}),
        },

        // Process
        process: {
          ...common.process,
          ...(macPatch.process ?? {}),
          ...(linuxPatch.process ?? {}),
          ...(winPatch.process ?? {}),
        },

        // Memory
        memory: {
          ...common.memory,
          ...(macPatch.memory ?? {}),
          ...(linuxPatch.memory ?? {}),
          ...(winPatch.memory ?? {}),
        },

        // Disk
        disk: {
          ...common.disk,
          ...(macPatch.disk ?? {}),
          ...(linuxPatch.disk ?? {}),
          ...(winPatch.disk ?? {}),
        },
      };

      // 4. Validate (Non-blocking)
      this.validate(merged);

      if (this.running) {
        this.metrics.push(merged);
      }
    } catch {
      // Silent fail - never crash reporter
      // console.error(error); // Debug only
    }
  }

  private validate(m: NormalizedSystemMetrics) {
    // Sanity check: ensure no keys are accidentally undefined due to partial merge failure
    // If strict mode is on, we could throw, but for Enterprise style we just log once if needed.
    // For this implementation, the type system + deep merge guarantees presence.
    // We check critical fields just in case.
    if (m.cpu.load1 === (undefined as unknown) || m.memory.totalMb === (undefined as unknown)) {
      console.warn("PW-AI: Telemetry schema violation detected in sample");
    }
  }
}
