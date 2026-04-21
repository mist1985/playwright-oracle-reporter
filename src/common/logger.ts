/**
 * Structured logging system for Playwright Oracle Reporter
 * Copyright (c) 2026 Mihajlo Stojanovski
 */

import { formatError } from "./errors";
import { getEnvVar } from "./constants";

/**
 * Log levels (ordered by severity)
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: unknown;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  minLevel: LogLevel;
  silent: boolean;
  prettyPrint: boolean;
}

/**
 * Structured logger with proper error handling
 */
export class Logger {
  private static instance: Logger | undefined;
  private config: LoggerConfig;

  private constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      minLevel: this.getLogLevelFromEnv(),
      silent: getEnvVar("SILENT") === "true",
      prettyPrint: process.env.NODE_ENV !== "production",
      ...config,
    };
  }

  /**
   * Get singleton logger instance
   */
  static getInstance(config?: Partial<LoggerConfig>): Logger {
    Logger.instance ??= new Logger(config);
    return Logger.instance;
  }

  /**
   * Parse log level from environment variable
   */
  private getLogLevelFromEnv(): LogLevel {
    const level = (getEnvVar("LOG_LEVEL") ?? "INFO").toUpperCase();
    switch (level) {
      case "DEBUG":
        return LogLevel.DEBUG;
      case "INFO":
        return LogLevel.INFO;
      case "WARN":
        return LogLevel.WARN;
      case "ERROR":
        return LogLevel.ERROR;
      case "FATAL":
        return LogLevel.FATAL;
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return !this.config.silent && level >= this.config.minLevel;
  }

  /**
   * Format log entry for output
   */
  private format(entry: LogEntry): string {
    if (this.config.prettyPrint) {
      const levelStr = LogLevel[entry.level].padEnd(5);
      const time = new Date(entry.timestamp).toISOString();
      let msg = `[${time}] ${levelStr} ${entry.message}`;

      if (entry.context && Object.keys(entry.context).length > 0) {
        msg += `\n  Context: ${JSON.stringify(entry.context, null, 2)}`;
      }

      if (entry.error) {
        msg += `\n  Error: ${formatError(entry.error)}`;
      }

      return msg;
    }

    // JSON format for production
    return JSON.stringify(entry);
  }

  /**
   * Write log entry
   */
  private write(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error,
    };

    const output = this.format(entry);

    // Write to appropriate stream
    if (level >= LogLevel.ERROR) {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.write(LogLevel.DEBUG, message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.write(LogLevel.INFO, message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.write(LogLevel.WARN, message, context);
  }

  /**
   * Log error message
   */
  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.write(LogLevel.ERROR, message, context, error);
  }

  /**
   * Log fatal error (terminates process)
   */
  fatal(message: string, error?: unknown, context?: Record<string, unknown>): never {
    this.write(LogLevel.FATAL, message, context, error);
    process.exit(1);
  }

  /**
   * Create a child logger with additional context
   */
  child(baseContext: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, baseContext);
  }
}

/**
 * Child logger that inherits parent configuration with additional context
 */
export class ChildLogger {
  constructor(
    private parent: Logger,
    private baseContext: Record<string, unknown>,
  ) {}

  private mergeContext(context?: Record<string, unknown>): Record<string, unknown> {
    return { ...this.baseContext, ...context };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, this.mergeContext(context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.parent.error(message, error, this.mergeContext(context));
  }

  fatal(message: string, error?: unknown, context?: Record<string, unknown>): never {
    return this.parent.fatal(message, error, this.mergeContext(context));
  }
}

/**
 * Get default logger instance
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}

/**
 * Create logger with specific config
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
  return Logger.getInstance(config);
}
