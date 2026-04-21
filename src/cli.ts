#!/usr/bin/env node
/**
 * Playwright Oracle Reporter CLI
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * Enterprise-grade command-line interface with:
 * - Cross-platform file opening
 * - Comprehensive error handling
 * - Configuration validation
 * - Structured logging
 */

import * as fs from "fs";
import * as path from "path";
import { validateConfig, printValidationResults } from "./config/validator";
import { openFile, getPlatformInfo } from "./common/platform";
import { getLogger } from "./common/logger";
import { CONFIG_DEFAULTS, ENV_VARS, EXIT_CODES, getEnvVar } from "./common/constants";
import { loadDotenvIfAvailable } from "./common/env";
import {
  FileSystemError,
  getErrorMessage,
  isReporterError,
  isError,
  formatError,
} from "./common/errors";

const logger = getLogger();

// Load environment variables if dotenv is available (optional)
if (loadDotenvIfAvailable()) {
  logger.debug("Loaded environment variables from .env");
} else {
  // dotenv not installed - user can set env vars directly
  logger.debug("dotenv not available, using system environment variables");
}

/**
 * CLI command handlers
 */
const commands = {
  /**
   * Validate reporter configuration and system requirements
   */
  doctor: (): void => {
    try {
      logger.info("Running configuration diagnostics...");

      const result = validateConfig();
      printValidationResults(result);

      if (!result.valid) {
        logger.error("Configuration validation failed");
        process.exit(EXIT_CODES.CONFIG_INVALID);
      }

      logger.info("Configuration validation passed");
    } catch (error) {
      logger.error("Doctor command failed", error);
      console.error(`❌ Error: ${getErrorMessage(error)}`);
      process.exit(EXIT_CODES.ERROR);
    }
  },

  /**
   * Open the latest HTML report in default browser
   */
  open: async (): Promise<void> => {
    try {
      const outputDir = getEnvVar("OUTPUT_DIR") ?? CONFIG_DEFAULTS.OUTPUT_DIR;
      const reportPath = path.resolve(outputDir, CONFIG_DEFAULTS.REPORT_FILENAME);

      logger.info("Attempting to open report", { reportPath });

      // Check if report exists
      if (!fs.existsSync(reportPath)) {
        throw new FileSystemError("Report file not found", "read", reportPath);
      }

      console.log(`📂 Opening report: ${reportPath}`);

      // Get platform info for diagnostics
      const platformInfo = getPlatformInfo();
      logger.debug("Platform info", platformInfo);

      // Open file using cross-platform utility
      await openFile(reportPath);

      console.log("✅ Report opened successfully");
      logger.info("Report opened successfully");
    } catch (error) {
      if (error instanceof FileSystemError) {
        console.error(`❌ Report not found: ${error.filePath}`);
        console.log("💡 Run your Playwright tests first to generate a report");
        logger.error("Report file not found", error);
        process.exit(EXIT_CODES.FILE_NOT_FOUND);
      }

      // Platform or other errors
      console.error(`❌ Failed to open report: ${getErrorMessage(error)}`);
      const outputDir = getEnvVar("OUTPUT_DIR") ?? CONFIG_DEFAULTS.OUTPUT_DIR;
      const reportPath = path.resolve(outputDir, CONFIG_DEFAULTS.REPORT_FILENAME);
      console.log(`📄 Report location: ${reportPath}`);

      logger.error("Failed to open report", error);
      process.exit(EXIT_CODES.ERROR);
    }
  },

  /**
   * Display help information
   */
  help: (): void => {
    console.log(`
🔮 Playwright Oracle Reporter CLI

Usage: npx playwright-oracle-reporter <command>

Commands:
  doctor    Run comprehensive configuration and system diagnostics
  open      Open the latest HTML report in your default browser
  help      Display this help message

Examples:
  npx playwright-oracle-reporter doctor   # Validate configuration
  npx playwright-oracle-reporter open     # Open latest report
  npx pw-oracle doctor                    # Short alias

Environment Variables:
  ${ENV_VARS.OPENAI_API_KEY}          OpenAI API key for enhanced analysis (optional)
  ${ENV_VARS.ANTHROPIC_API_KEY}       Anthropic API key for Claude analysis (optional)
  ${ENV_VARS.OUTPUT_DIR}         Report output directory (default: ${CONFIG_DEFAULTS.OUTPUT_DIR})
  ${ENV_VARS.HISTORY_DIR}        History directory (default: ${CONFIG_DEFAULTS.HISTORY_DIR})
  ${ENV_VARS.OPEN_REPORT}        Auto-open report after runs (default: true locally, false in CI)
  ${ENV_VARS.RUN_LABEL}          Label for test run (optional)
  ${ENV_VARS.TELEMETRY_INTERVAL} Sampling interval in seconds (default: ${String(CONFIG_DEFAULTS.TELEMETRY_INTERVAL_SECONDS)})
  ${ENV_VARS.AI_MODE}            AI mode: auto|rules|openai|claude (default: ${CONFIG_DEFAULTS.AI_MODE})
  ${ENV_VARS.LOG_LEVEL}          Log level: DEBUG|INFO|WARN|ERROR (default: INFO)

Documentation:
  GitHub: https://github.com/mist1985/playwright-oracle-reporter
`);
  },
};

/**
 * Main CLI entry point with proper async handling and error types
 */
async function main(): Promise<void> {
  const command = process.argv[2];

  // Default to help if no command or help flags provided
  if (!command || command === "help" || command === "--help" || command === "-h") {
    commands.help();
    return;
  }

  // Validate command exists
  if (!(command in commands)) {
    logger.error(`Unknown command: ${command}`);
    logger.info('Run "npx playwright-oracle-reporter help" for usage information');
    process.exit(EXIT_CODES.INVALID_CONFIG);
  }

  // Execute command with proper error handling
  try {
    await (commands as Record<string, () => void | Promise<void>>)[command]();
  } catch (error) {
    if (isReporterError(error)) {
      logger.error(`Command failed: ${error.message}`, { code: error.code });
    } else if (isError(error)) {
      logger.error(`Command failed: ${error.message}`);
    } else {
      logger.error(`Command failed: ${String(error)}`);
    }
    process.exit(EXIT_CODES.UNEXPECTED_ERROR);
  }
}

// Execute main function
main().catch((error) => {
  logger.fatal("Fatal error in CLI", { error: formatError(error) });
  process.exit(EXIT_CODES.UNEXPECTED_ERROR);
});
