/**
 * Global constants for Playwright Oracle Reporter
 * Copyright (c) 2026 Mihajlo Stojanovski
 */

/**
 * System Requirements
 */
export const SYSTEM_REQUIREMENTS = {
  /** Minimum Node.js major version */
  MIN_NODE_VERSION: 18,
  /** Minimum Node.js version string for display */
  MIN_NODE_VERSION_STRING: "18.0.0" /** Minimum free memory in bytes (512MB) */,
  MIN_FREE_MEMORY_BYTES: 512 * 1024 * 1024,
  /** Minimum CPU cores recommended */
  MIN_CPU_CORES: 2,
} as const;

/**
 * Configuration Defaults
 */
export const CONFIG_DEFAULTS = {
  /** Default output directory name */
  OUTPUT_DIR: "playwright-oracle-report",
  /** Default history directory name */
  HISTORY_DIR: ".playwright-oracle-history",
  /** Default telemetry sampling interval in seconds */
  TELEMETRY_INTERVAL_SECONDS: 3,
  /** Default AI analysis mode */
  AI_MODE: "auto",
  /** Default OpenAI model */
  OPENAI_MODEL: "gpt-4o",
  /** Default OpenAI max tokens */
  OPENAI_MAX_TOKENS: 4000,
  /** Default OpenAI timeout in milliseconds */
  OPENAI_TIMEOUT_MS: 30000,
  /** Default OpenAI retry attempts */
  OPENAI_RETRIES: 3,
  /** Default max sanitized payload size for OpenAI */
  OPENAI_MAX_INPUT_CHARS: 15000,
  /** Default Claude model */
  CLAUDE_MODEL: "claude-sonnet-4-20250514",
  /** Default Claude max tokens */
  CLAUDE_MAX_TOKENS: 4000,
  /** Default Claude timeout in milliseconds */
  CLAUDE_TIMEOUT_MS: 30000,
  /** Default Claude retry attempts */
  CLAUDE_RETRIES: 3,
  /** Default max sanitized payload size for Claude */
  CLAUDE_MAX_INPUT_CHARS: 15000,
  /** HTML report filename */
  REPORT_FILENAME: "index.html",
} as const;

/**
 * Validation Constraints
 */
export const VALIDATION_CONSTRAINTS = {
  /** Valid AI modes */
  AI_MODES: {
    AUTO: "auto",
    RULES: "rules",
    OPENAI: "openai",
    CLAUDE: "claude",
  },
  /** Minimum recommended telemetry interval in seconds */
  MIN_TELEMETRY_INTERVAL: 1,
  /** Maximum recommended telemetry interval in seconds */
  MAX_TELEMETRY_INTERVAL: 60,
  /** Telemetry interval constraints */
  TELEMETRY_INTERVAL: {
    MIN: 1,
    MAX: 60,
  },
  /** Minimum free memory warning threshold in bytes */
  MIN_FREE_MEMORY_BYTES: 512 * 1024 * 1024, // 512 MB
  /** System memory warning threshold (percentage) */
  MEMORY_WARNING_THRESHOLD: 0.85, // 85%
  /** System memory critical threshold (percentage) */
  MEMORY_CRITICAL_THRESHOLD: 0.95, // 95%
} as const;

/**
 * Rate Limiting Configuration
 */
export const RATE_LIMIT_CONFIG = {
  /** Token bucket max capacity */
  MAX_TOKENS: 50,
  /** Token refill rate per second */
  REFILL_RATE: 10,
  /** Circuit breaker failure threshold */
  CIRCUIT_BREAKER_THRESHOLD: 5,
  /** Circuit breaker reset timeout in milliseconds */
  CIRCUIT_BREAKER_RESET_MS: 60000, // 1 minute
} as const;

/**
 * Memory Optimization
 */
export const MEMORY_CONFIG = {
  /** Default chunk size for batch processing */
  DEFAULT_CHUNK_SIZE: 100,
  /** Maximum samples to keep in memory monitor */
  MAX_MEMORY_SAMPLES: 100,
  /** Memory monitoring interval in milliseconds */
  MONITORING_INTERVAL_MS: 5000,
  /** Default object pool size */
  DEFAULT_POOL_SIZE: 10,
} as const;

/**
 * Byte Conversion Constants
 */
export const BYTES = {
  /** Bytes per kilobyte */
  KB: 1024,
  /** Bytes per megabyte */
  MB: 1024 * 1024,
  /** Bytes per gigabyte */
  GB: 1024 * 1024 * 1024,
} as const;

/**
 * Platform-Specific Constants
 */
export const PLATFORM_COMMANDS = {
  /** Command to open files on macOS */
  MACOS_OPEN: "open",
  /** Command to open files on Linux */
  LINUX_OPEN: "xdg-open",
  /** Command to open files on Windows */
  WINDOWS_OPEN: "start",
} as const;

/**
 * Environment Variable Names
 */
export const ENV_VARS = {
  OPENAI_API_KEY: "OPENAI_API_KEY",
  ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  OUTPUT_DIR: "PW_ORACLE_OUTPUT_DIR",
  HISTORY_DIR: "PW_ORACLE_HISTORY_DIR",
  OPEN_REPORT: "PW_ORACLE_OPEN_REPORT",
  RUN_LABEL: "PW_ORACLE_RUN_LABEL",
  TELEMETRY_INTERVAL: "PW_ORACLE_TELEMETRY_INTERVAL",
  AI_MODE: "PW_ORACLE_AI_MODE",
  OPENAI_MODEL: "PW_ORACLE_OPENAI_MODEL",
  OPENAI_MAX_TOKENS: "PW_ORACLE_OPENAI_MAX_TOKENS",
  OPENAI_TIMEOUT_MS: "PW_ORACLE_OPENAI_TIMEOUT_MS",
  OPENAI_RETRIES: "PW_ORACLE_OPENAI_RETRIES",
  OPENAI_ENABLED: "PW_ORACLE_OPENAI_ENABLED",
  CLAUDE_MODEL: "PW_ORACLE_CLAUDE_MODEL",
  CLAUDE_MAX_TOKENS: "PW_ORACLE_CLAUDE_MAX_TOKENS",
  CLAUDE_TIMEOUT_MS: "PW_ORACLE_CLAUDE_TIMEOUT_MS",
  CLAUDE_RETRIES: "PW_ORACLE_CLAUDE_RETRIES",
  CLAUDE_MAX_INPUT_CHARS: "PW_ORACLE_CLAUDE_MAX_INPUT_CHARS",
  LOG_LEVEL: "PW_ORACLE_LOG_LEVEL",
  SILENT: "PW_ORACLE_SILENT",
  THRESHOLD_LOAD1: "PW_ORACLE_THRESHOLD_LOAD1",
  THRESHOLD_PRESSURE: "PW_ORACLE_THRESHOLD_PRESSURE",
  THRESHOLD_IOWAIT: "PW_ORACLE_THRESHOLD_IOWAIT",
  THRESHOLD_STEAL: "PW_ORACLE_THRESHOLD_STEAL",
  OPENAI_MAX_INPUT_CHARS: "PW_ORACLE_OPENAI_MAX_INPUT_CHARS",
} as const;

type EnvVarKey = keyof typeof ENV_VARS;

export function getEnvVar(key: EnvVarKey): string | undefined {
  return process.env[ENV_VARS[key]];
}

export function getBooleanEnvVar(key: EnvVarKey): boolean | undefined {
  const raw = getEnvVar(key);

  if (typeof raw !== "string") {
    return undefined;
  }

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

/**
 * Valid AI modes
 */
export const AI_MODES = ["auto", "rules", "openai", "claude"] as const;
export type AIMode = (typeof AI_MODES)[number];

/**
 * Supported platforms
 */
export const SUPPORTED_PLATFORMS = ["darwin", "linux", "win32"] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

/**
 * Exit Codes
 */
export const EXIT_CODES = {
  /** Success */
  SUCCESS: 0,
  /** General error */
  ERROR: 1,
  /** Configuration invalid */
  CONFIG_INVALID: 2,
  /** Invalid configuration (alias for backwards compatibility) */
  INVALID_CONFIG: 2,
  /** File not found */
  FILE_NOT_FOUND: 3,
  /** Command not supported */
  NOT_SUPPORTED: 4,
  /** Unexpected/unhandled error */
  UNEXPECTED_ERROR: 5,
} as const;

/**
 * Timeout values for various operations
 */
export const TIMEOUTS = {
  /** Shellcommand execution timeout in milliseconds */
  SHELL_COMMAND_MS: 10000, // 10 seconds
  /** File operation timeout in milliseconds */
  FILE_OPERATION_MS: 5000, // 5 seconds
  /** Network request timeout in milliseconds */
  NETWORK_REQUEST_MS: 30000, // 30 seconds
} as const;

/**
 * CPU Usage Estimation (for Windows)
 */
export const CPU_ESTIMATION = {
  /** Estimated system CPU percentage multiplier */
  SYSTEM_MULTIPLIER: 0.2,
  /** Estimated user CPU percentage multiplier */
  USER_MULTIPLIER: 0.8,
} as const;
