/**
 * Custom error classes for type-safe error handling
 * Copyright (c) 2026 Mihajlo Stojanovski
 */

/**
 * Base error class for all reporter errors
 */
export class ReporterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Configuration validation error
 */
export class ConfigurationError extends ReporterError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIG_ERROR", context);
  }
}

/**
 * File system operation error
 */
export class FileSystemError extends ReporterError {
  constructor(
    message: string,
    public readonly operation: "read" | "write" | "delete" | "access",
    public readonly filePath: string,
    cause?: Error,
  ) {
    super(message, "FILESYSTEM_ERROR", {
      operation,
      filePath,
      cause: cause?.message,
    });
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Platform compatibility error
 */
export class PlatformError extends ReporterError {
  constructor(
    message: string,
    public readonly platform: string,
    public readonly feature: string,
  ) {
    super(message, "PLATFORM_ERROR", { platform, feature });
  }
}

/**
 * OpenAI API error
 */
export class OpenAIError extends ReporterError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly apiMessage?: string,
  ) {
    super(message, "OPENAI_ERROR", { statusCode, apiMessage });
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends ReporterError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message, "RATE_LIMIT_ERROR", { retryAfter });
  }
}

/**
 * Circuit breaker open error
 */
export class CircuitBreakerError extends ReporterError {
  constructor(
    message: string,
    public readonly resetTime: Date,
  ) {
    super(message, "CIRCUIT_BREAKER_OPEN", {
      resetTime: resetTime.toISOString(),
    });
  }
}

/**
 * Telemetry collection error
 */
export class TelemetryError extends ReporterError {
  constructor(
    message: string,
    public readonly platform: string,
    cause?: Error,
  ) {
    super(message, "TELEMETRY_ERROR", { platform, cause: cause?.message });
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Memory error (out of memory, etc.)
 */
export class MemoryError extends ReporterError {
  constructor(
    message: string,
    public readonly usedBytes: number,
    public readonly totalBytes: number,
  ) {
    super(message, "MEMORY_ERROR", { usedBytes, totalBytes });
  }
}

/**
 * Input validation error
 */
export class ValidationError extends ReporterError {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown,
  ) {
    super(message, "VALIDATION_ERROR", { field, value });
  }
}

/**
 * Test execution error
 */
export class TestExecutionError extends ReporterError {
  constructor(
    message: string,
    public readonly testId: string,
    cause?: Error,
  ) {
    super(message, "TEST_EXECUTION_ERROR", { testId, cause: cause?.message });
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Type guard to check if error is a ReporterError
 */
export function isReporterError(error: unknown): error is ReporterError {
  return error instanceof ReporterError;
}

/**
 * Type guard to check if error is a standard Error
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Safe error message extraction
 */
export function getErrorMessage(error: unknown): string {
  if (isReporterError(error)) {
    return error.message;
  }
  if (isError(error)) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

/**
 * Safe error code extraction
 */
export function getErrorCode(error: unknown): string {
  if (isReporterError(error)) {
    return error.code;
  }
  if (isError(error)) {
    return error.name;
  }
  return "UNKNOWN_ERROR";
}

/**
 * Format error for logging
 */
export function formatError(error: unknown): string {
  if (isReporterError(error)) {
    return JSON.stringify(error.toJSON(), null, 2);
  }
  if (isError(error)) {
    return `${error.name}: ${error.message}\n${error.stack || ""}`;
  }
  return String(error);
}
