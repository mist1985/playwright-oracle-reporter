/**
 * Playwright Oracle Reporter - Configuration Validator
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * Enterprise-grade configuration validation with:
 * - System requirements verification
 * - Cross-platform compatibility checks
 * - Resource availability validation
 * - Structured error reporting
 *
 * @module config/validator
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  CONFIG_DEFAULTS,
  SYSTEM_REQUIREMENTS,
  VALIDATION_CONSTRAINTS,
  BYTES,
  ENV_VARS,
  getBooleanEnvVar,
  getEnvVar,
} from "../common/constants";
import { isCI, shouldAutoOpenReport } from "../common/platform";
import {
  validateInteger,
  validateAIMode,
  validateTelemetryInterval,
  validateOpenAIKey,
  validateClaudeKey,
  validateNodeVersion,
} from "../common/validation";
import { getLogger } from "../common/logger";
// Removed unused errors import

const logger = getLogger();

/** System memory info for validation display. */
interface MemoryInfo {
  total: string;
  free: string;
  usage: string;
}

/**
 * Configuration validation result
 * @interface ValidationResult
 */
export interface ValidationResult {
  /** Whether configuration is valid and ready for use */
  valid: boolean;
  /** Critical errors that prevent reporter operation */
  errors: string[];
  /** Non-critical warnings that may affect performance */
  warnings: string[];
  /** Detected configuration and system information */
  info: Record<string, string | number | boolean | null | MemoryInfo>;
}

/**
 * Configuration options for the reporter
 * @interface ConfigOptions
 */
export interface ConfigOptions {
  /** Output directory for HTML reports */
  outputDir?: string;
  /** History directory for tracking flaky tests */
  historyDir?: string;
  /** Whether to auto-open the report after the run finishes */
  openReport?: boolean;
  /** AI analysis mode: auto, rules, openai, or claude */
  aiMode?: string;
  /** Telemetry collection interval in seconds */
  telemetryInterval?: number;
  /** OpenAI API key for GPT-based analysis */
  openaiApiKey?: string;
  /** Anthropic API key for Claude-based analysis */
  claudeApiKey?: string;
}

/**
 * Validates the reporter configuration and system requirements
 * @param options - Configuration options to validate
 * @returns Validation result with errors, warnings, and detected info
 * @throws {ConfigurationError} When critical validation fails
 */
export function validateConfig(options: ConfigOptions = {}): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    info: {},
  };

  logger.debug("Starting configuration validation", { options });

  try {
    // Get config from options or env with defaults
    const outputDir = options.outputDir ?? getEnvVar("OUTPUT_DIR") ?? CONFIG_DEFAULTS.OUTPUT_DIR;
    const historyDir =
      options.historyDir ?? getEnvVar("HISTORY_DIR") ?? CONFIG_DEFAULTS.HISTORY_DIR;
    const openReport =
      typeof options.openReport === "boolean" ? options.openReport : shouldAutoOpenReport();
    const aiMode = options.aiMode ?? getEnvVar("AI_MODE") ?? CONFIG_DEFAULTS.AI_MODE;
    const telemetryIntervalStr =
      getEnvVar("TELEMETRY_INTERVAL") ?? String(CONFIG_DEFAULTS.TELEMETRY_INTERVAL_SECONDS);
    const telemetryInterval =
      options.telemetryInterval ??
      validateInteger(telemetryIntervalStr, "telemetryInterval", 1, 60);
    const openaiApiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
    const claudeApiKey = options.claudeApiKey ?? process.env.ANTHROPIC_API_KEY;

    // Validate Node.js version
    const nodeVersion = process.versions.node;
    const isValidNodeVersion = validateNodeVersion(
      nodeVersion,
      SYSTEM_REQUIREMENTS.MIN_NODE_VERSION,
    );
    result.info.nodeVersion = nodeVersion;

    if (!isValidNodeVersion) {
      result.valid = false;
      result.errors.push(
        `Node.js version ${nodeVersion} is not supported. Minimum required: ${SYSTEM_REQUIREMENTS.MIN_NODE_VERSION_STRING}`,
      );
      logger.error("Node.js version validation failed", { nodeVersion });
    }

    // Validate AI mode using utility function
    try {
      validateAIMode(aiMode);
      result.info.aiMode = aiMode;
    } catch (_error) {
      result.valid = false;
      result.errors.push(
        `Invalid AI mode: ${aiMode}. Valid options: ${Object.values(VALIDATION_CONSTRAINTS.AI_MODES).join(", ")}`,
      );
      result.info.aiMode = aiMode;
    }

    result.info.openReport = openReport;

    if (isCI() && getBooleanEnvVar("OPEN_REPORT") === true) {
      result.warnings.push(
        `${ENV_VARS.OPEN_REPORT}=true enables browser-launch behavior in CI. Leave it unset or false for non-interactive runners.`,
      );
    }

    // Validate telemetry interval using utility function
    try {
      validateTelemetryInterval(telemetryInterval);
      result.info.telemetryInterval = telemetryInterval;
    } catch (_error) {
      result.warnings.push(
        `Telemetry interval ${String(telemetryInterval)}s is outside recommended range (${String(VALIDATION_CONSTRAINTS.TELEMETRY_INTERVAL.MIN)}-${String(VALIDATION_CONSTRAINTS.TELEMETRY_INTERVAL.MAX)}). May impact performance.`,
      );
      result.info.telemetryInterval = telemetryInterval;
    }

    // Validate OpenAI API key if using OpenAI mode
    if (aiMode === "openai") {
      if (!openaiApiKey) {
        result.warnings.push(
          `AI mode is "openai" but ${ENV_VARS.OPENAI_API_KEY} is not set. Falling back to rules-based analysis.`,
        );
        logger.warn("OpenAI mode selected but API key not configured");
      } else {
        const keyValidation = validateOpenAIKey(openaiApiKey);
        if (!keyValidation.valid) {
          result.warnings.push(
            `${ENV_VARS.OPENAI_API_KEY} format appears invalid (should start with "sk-").`,
          );
          logger.warn("OpenAI API key format validation failed", {
            error: keyValidation.error,
          });
        }
      }
    }

    if (aiMode === "claude") {
      if (!claudeApiKey) {
        result.warnings.push(
          `AI mode is "claude" but ${ENV_VARS.ANTHROPIC_API_KEY} is not set. Falling back to rules-based analysis.`,
        );
        logger.warn("Claude mode selected but API key not configured");
      } else {
        const keyValidation = validateClaudeKey(claudeApiKey);
        if (!keyValidation.valid) {
          result.warnings.push(
            `${ENV_VARS.ANTHROPIC_API_KEY} format appears invalid (should start with "sk-ant-").`,
          );
          logger.warn("Claude API key format validation failed", {
            error: keyValidation.error,
          });
        }
      }
    }

    // Validate directories are writable
    try {
      const outputPath = path.resolve(outputDir);
      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
        result.info.outputDirCreated = true;
        logger.debug("Created output directory", { outputPath });
      }
      fs.accessSync(outputPath, fs.constants.W_OK);
      result.info.outputDir = outputPath;
    } catch (err) {
      result.valid = false;
      result.errors.push(`Output directory ${outputDir} is not writable: ${String(err)}`);
      logger.error("Output directory validation failed", {
        outputDir,
        error: err,
      });
    }

    try {
      const historyPath = path.resolve(historyDir);
      if (!fs.existsSync(historyPath)) {
        fs.mkdirSync(historyPath, { recursive: true });
        result.info.historyDirCreated = true;
        logger.debug("Created history directory", { historyPath });
      }
      fs.accessSync(historyPath, fs.constants.W_OK);
      result.info.historyDir = historyPath;
    } catch (err) {
      result.warnings.push(
        `History directory ${historyDir} is not writable. History tracking disabled.`,
      );
      logger.warn("History directory validation failed", {
        historyDir,
        error: err,
      });
    }

    // Check available memory using constants
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsagePercent = ((totalMem - freeMem) / totalMem) * 100;

    result.info.memory = {
      total: `${(totalMem / BYTES.GB).toFixed(2)} GB`,
      free: `${(freeMem / BYTES.GB).toFixed(2)} GB`,
      usage: `${memUsagePercent.toFixed(1)}%`,
    };

    if (freeMem < SYSTEM_REQUIREMENTS.MIN_FREE_MEMORY_BYTES) {
      result.warnings.push(
        `Low available memory (< ${String(SYSTEM_REQUIREMENTS.MIN_FREE_MEMORY_BYTES / BYTES.MB)}MB). Reporter may experience performance issues with large test suites.`,
      );
      logger.warn("Low available memory detected", {
        freeMem,
        threshold: SYSTEM_REQUIREMENTS.MIN_FREE_MEMORY_BYTES,
      });
    }

    // Check CPU cores using constants
    const cpuCount = os.cpus().length;
    result.info.cpuCores = cpuCount;

    if (cpuCount < SYSTEM_REQUIREMENTS.MIN_CPU_CORES) {
      result.warnings.push(
        `Only ${String(cpuCount)} CPU core(s) available. Telemetry collection may impact test performance.`,
      );
      logger.warn("Low CPU core count detected", {
        cpuCount,
        threshold: SYSTEM_REQUIREMENTS.MIN_CPU_CORES,
      });
    }

    // Check platform
    result.info.platform = process.platform;
    result.info.arch = process.arch;

    logger.debug("Configuration validation completed", {
      valid: result.valid,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
    });
    return result;
  } catch (error) {
    logger.error("Configuration validation failed with exception", { error });
    result.valid = false;
    result.errors.push(
      `Validation error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result;
  }
}

/**
 * Prints validation results to console in a user-friendly format
 * @param result - The validation result to display
 * @remarks Uses console output for user-facing information, not structured logging
 */
export function printValidationResults(result: ValidationResult): void {
  console.log("\n🔮 Playwright Oracle Reporter - Configuration Validation\n");

  if (result.errors.length > 0) {
    console.log("❌ Errors:");
    result.errors.forEach((err) => console.log(`   • ${err}`));
    console.log("");
  }

  if (result.warnings.length > 0) {
    console.log("⚠️  Warnings:");
    result.warnings.forEach((warn) => console.log(`   • ${warn}`));
    console.log("");
  }

  console.log("ℹ️  Configuration:");
  console.log(`   • Node.js: ${String(result.info.nodeVersion)}`);
  console.log(`   • Platform: ${String(result.info.platform)} (${String(result.info.arch)})`);
  console.log(`   • CPU Cores: ${String(result.info.cpuCores)}`);
  const mem = result.info.memory as MemoryInfo | undefined;
  if (mem) {
    console.log(`   • Memory: ${mem.free} free of ${mem.total} (${mem.usage} used)`);
  }
  console.log(`   • AI Mode: ${String(result.info.aiMode)}`);
  console.log(`   • Auto Open Report: ${String(result.info.openReport)}`);
  console.log(`   • Telemetry Interval: ${String(result.info.telemetryInterval)}s`);
  console.log(`   • Output Dir: ${String(result.info.outputDir)}`);
  if (result.info.historyDir) {
    console.log(`   • History Dir: ${String(result.info.historyDir)}`);
  }

  if (result.valid) {
    console.log("\n✅ Configuration valid - ready to run\n");
  } else {
    console.log("\n❌ Configuration invalid - please fix errors above\n");
  }
}
