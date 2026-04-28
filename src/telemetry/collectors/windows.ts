/**
 * Playwright Oracle Reporter - Windows Telemetry Collector
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * Enterprise-grade Windows system metrics collection with:
 * - Cross-platform command execution with timeouts
 * - Structured logging for diagnostics
 * - Type-safe error handling
 * - Constant-based configuration
 *
 * @module telemetry/collectors/windows
 */

import { MetricsPatch } from "./common";
import { executeCommand, isWindows } from "../../common/platform";
import { getLogger } from "../../common/logger";
import { TelemetryError } from "../../common/errors";
import { TIMEOUTS, BYTES } from "../../common/constants";

const logger = getLogger();

/**
 * CPU usage estimation factors for Windows
 * Windows WMIC provides total CPU load, we estimate user/system split
 */
const CPU_ESTIMATION = {
  SYSTEM_FACTOR: 0.2, // Assume 20% system overhead for high load
  USER_FACTOR: 0.8, // Remaining 80% assumed user processes
} as const;

/**
 * Collects Windows-specific system metrics
 *
 * @returns Metrics patch containing CPU, memory, and disk usage
 * @remarks Uses WMIC commands which are available on all Windows versions
 */
export async function collectWindowsMetrics(): Promise<MetricsPatch> {
  // Skip silently if not running on Windows (called every sample interval)
  if (!isWindows()) {
    return {};
  }

  logger.debug("Starting Windows metrics collection");

  const patch: MetricsPatch = {
    cpu: {},
    disk: {},
    memory: {},
  };

  try {
    // 1. Disk Usage - Query C: drive free space
    try {
      logger.debug("Collecting Windows disk metrics");
      const result = await executeCommand(
        "wmic logicaldisk where \"DeviceID='C:'\" get FreeSpace /Value",
        TIMEOUTS.SHELL_COMMAND_MS,
      );

      if (result.exitCode === 0) {
        const match = result.stdout.match(/FreeSpace=(\d+)/);

        if (match?.[1]) {
          const freeBytes = parseInt(match[1], 10);
          if (!isNaN(freeBytes)) {
            patch.disk = {
              freeGb: Math.round((freeBytes / BYTES.GB) * 100) / 100,
            };
            logger.debug("Windows disk metrics collected", {
              freeGb: patch.disk.freeGb,
            });
          }
        }
      } else {
        logger.warn("WMIC disk query failed", { stderr: result.stderr });
      }
    } catch (error) {
      logger.warn("Failed to collect Windows disk metrics", { error });
      // Continue to next metric
    }

    // 2. CPU Usage - Query CPU load percentage
    try {
      logger.debug("Collecting Windows CPU metrics");
      const result = await executeCommand(
        "wmic cpu get LoadPercentage /Value",
        TIMEOUTS.SHELL_COMMAND_MS,
      );

      if (result.exitCode === 0) {
        const match = result.stdout.match(/LoadPercentage=(\d+)/);

        if (match?.[1]) {
          const loadPct = parseInt(match[1], 10);
          if (!isNaN(loadPct)) {
            // Approximate sys/user split since WMIC only gives total load
            const systemPct = Math.round(loadPct * CPU_ESTIMATION.SYSTEM_FACTOR);
            const userPct = Math.round(loadPct * CPU_ESTIMATION.USER_FACTOR);
            const idlePct = 100 - loadPct;

            patch.cpu = {
              userPct,
              systemPct,
              idlePct,
            };
            logger.debug("Windows CPU metrics collected", patch.cpu);
          }
        }
      } else {
        logger.warn("WMIC CPU query failed", { stderr: result.stderr });
      }
    } catch (error) {
      logger.warn("Failed to collect Windows CPU metrics", { error });
      // Continue to next metric
    }

    // 3. Memory - Query free physical memory
    try {
      logger.debug("Collecting Windows memory metrics");
      const result = await executeCommand(
        "wmic OS get FreePhysicalMemory /Value",
        TIMEOUTS.SHELL_COMMAND_MS,
      );

      if (result.exitCode === 0) {
        const match = result.stdout.match(/FreePhysicalMemory=(\d+)/); // Returns in KB

        if (match?.[1]) {
          const freeKb = parseInt(match[1], 10);
          if (!isNaN(freeKb)) {
            patch.memory = {
              freeMb: Math.round(freeKb / BYTES.KB),
            };
            logger.debug("Windows memory metrics collected", {
              freeMb: patch.memory.freeMb,
            });
          }
        }
      } else {
        logger.warn("WMIC memory query failed", { stderr: result.stderr });
      }
    } catch (error) {
      logger.warn("Failed to collect Windows memory metrics", { error });
      // Continue to next metric
    }

    logger.info("Windows metrics collection completed", patch);
  } catch (error) {
    logger.error("Windows metrics collection failed globally", { error });
    throw new TelemetryError(
      "Failed to collect Windows telemetry metrics",
      error instanceof Error ? error.message : String(error),
    );
  }

  return patch;
}
