/**
 * Input validation and sanitization utilities
 * Copyright (c) 2026 Mihajlo Stojanovski
 */

import { ValidationError } from "./errors";
import { AI_MODES, AIMode, VALIDATION_CONSTRAINTS } from "./constants";

/**
 * Validation result
 */
export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

/**
 * Validate integer within range
 *
 * @param value - Value to validate
 * @param fieldName - Field name for error messages
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive)
 * @returns Validated integer
 * @throws {ValidationError} If validation fails
 */
export function validateInteger(
  value: unknown,
  fieldName: string,
  min?: number,
  max?: number,
): number {
  // Handle string input
  const num = typeof value === "string" ? parseInt(value, 10) : Number(value);

  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new ValidationError(`${fieldName} must be a valid integer`, fieldName, value);
  }

  if (min !== undefined && num < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`, fieldName, value);
  }

  if (max !== undefined && num > max) {
    throw new ValidationError(`${fieldName} must be at most ${max}`, fieldName, value);
  }

  return num;
}

/**
 * Safely parse integer with default value
 *
 * @param value - Value to parse
 * @param defaultValue - Default if invalid
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Parsed integer or default
 */
export function parseIntSafe(
  value: string | undefined,
  defaultValue: number,
  min?: number,
  max?: number,
): number {
  if (!value) {
    return defaultValue;
  }

  try {
    return validateInteger(value, "value", min, max);
  } catch {
    return defaultValue;
  }
}

/**
 * Validate string is not empty
 *
 * @param value - Value to validate
 * @param fieldName - Field name for error messages
 * @param maxLength - Maximum length (optional)
 * @returns Validated string
 * @throws {ValidationError} If validation fails
 */
export function validateNonEmptyString(
  value: unknown,
  fieldName: string,
  maxLength?: number,
): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`, fieldName, value);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName, value);
  }

  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new ValidationError(
      `${fieldName} must be at most ${maxLength} characters`,
      fieldName,
      value,
    );
  }

  return trimmed;
}

/**
 * Validate AI mode
 *
 * @param value - Value to validate
 * @returns Validated AI mode
 * @throws {ValidationError} If invalid mode
 */
export function validateAIMode(value: string): AIMode {
  if (!AI_MODES.includes(value as AIMode)) {
    throw new ValidationError(`AI mode must be one of: ${AI_MODES.join(", ")}`, "aiMode", value);
  }

  return value as AIMode;
}

/**
 * Validate telemetry interval
 *
 * @param value - Value to validate
 * @returns Validated interval in seconds
 * @throws {ValidationError} If invalid
 */
export function validateTelemetryInterval(value: number): number {
  return validateInteger(
    value,
    "telemetryInterval",
    VALIDATION_CONSTRAINTS.MIN_TELEMETRY_INTERVAL,
    VALIDATION_CONSTRAINTS.MAX_TELEMETRY_INTERVAL,
  );
}

/**
 * Validate OpenAI API key format
 *
 * @param value - API key to validate
 * @returns Validation result
 */
export function validateOpenAIKey(value: string): ValidationResult<string> {
  if (!value || value.trim().length === 0) {
    return {
      valid: false,
      error: "API key is empty",
    };
  }

  // OpenAI keys start with 'sk-'
  if (!value.startsWith("sk-")) {
    return {
      valid: false,
      error: 'API key should start with "sk-"',
    };
  }

  // Reasonable length check (OpenAI keys are ~48-51 chars)
  if (value.length < 20 || value.length > 100) {
    return {
      valid: false,
      error: "API key length is suspicious",
    };
  }

  return {
    valid: true,
    value: value.trim(),
  };
}

/**
 * Validate Anthropic API key format.
 *
 * @param value - API key to validate
 * @returns Validation result
 */
export function validateClaudeKey(value: string): ValidationResult<string> {
  if (!value || value.trim().length === 0) {
    return {
      valid: false,
      error: "API key is empty",
    };
  }

  // Anthropic keys start with 'sk-ant-'
  if (!value.startsWith("sk-ant-")) {
    return {
      valid: false,
      error: 'API key should start with "sk-ant-"',
    };
  }

  if (value.length < 20 || value.length > 160) {
    return {
      valid: false,
      error: "API key length is suspicious",
    };
  }

  return {
    valid: true,
    value: value.trim(),
  };
}

/**
 * Sanitize file path to prevent directory traversal
 *
 * @param filePath - Path to sanitize
 * @returns Sanitized path
 * @throws {ValidationError} If path contains suspicious patterns
 */
export function sanitizeFilePath(filePath: string): string {
  const normalized = filePath.trim();

  // Check for directory traversal patterns
  if (normalized.includes("..")) {
    throw new ValidationError(
      'File path cannot contain ".." (directory traversal)',
      "filePath",
      filePath,
    );
  }

  // Check for null bytes
  if (normalized.includes("\0")) {
    throw new ValidationError("File path cannot contain null bytes", "filePath", filePath);
  }

  return normalized;
}

/**
 * Validate percentage value (0-100)
 *
 * @param value - Value to validate
 * @param fieldName - Field name for error messages
 * @returns Validated percentage
 * @throws {ValidationError} If invalid
 */
export function validatePercentage(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new ValidationError(`${fieldName} must be between 0 and 100`, fieldName, value);
  }

  return value;
}

/**
 * Validate Node.js version
 *
 * @param version - Version string (e.g., "18.12.0")
 * @param minMajor - Minimum major version
 * @returns True if version is sufficient
 */
export function validateNodeVersion(version: string, minMajor: number): boolean {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    return false;
  }

  const major = parseInt(match[1], 10);
  return major >= minMajor;
}

/**
 * Validate object has required keys
 *
 * @param obj - Object to validate
 * @param requiredKeys - Array of required key names
 * @param objectName - Name for error messages
 * @throws {ValidationError} If keys are missing
 */
export function validateRequiredKeys(
  obj: Record<string, unknown>,
  requiredKeys: string[],
  objectName: string,
): void {
  const missing = requiredKeys.filter((key) => !(key in obj));

  if (missing.length > 0) {
    throw new ValidationError(
      `${objectName} is missing required keys: ${missing.join(", ")}`,
      objectName,
      obj,
    );
  }
}

/**
 * Validate timeout value
 *
 * @param value - Timeout in milliseconds
 * @param fieldName - Field name for error messages
 * @param min - Minimum timeout (default: 1000ms)
 * @param max - Maximum timeout (default: 300000ms)
 * @returns Validated timeout
 * @throws {ValidationError} If invalid
 */
export function validateTimeout(
  value: number,
  fieldName: string,
  min: number = 1000,
  max: number = 300000,
): number {
  return validateInteger(value, fieldName, min, max);
}

/**
 * Validate port number
 *
 * @param value - Port number
 * @param fieldName - Field name for error messages
 * @returns Validated port
 * @throws {ValidationError} If invalid
 */
export function validatePort(value: number, fieldName: string): number {
  return validateInteger(value, fieldName, 1, 65535);
}

/**
 * Validate URL format
 *
 * @param value - URL string
 * @param fieldName - Field name for error messages
 * @returns Validated URL
 * @throws {ValidationError} If invalid
 */
export function validateURL(value: string, fieldName: string): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new ValidationError(`${fieldName} is not a valid URL`, fieldName, value);
  }
}

/**
 * Validate email format (basic)
 *
 * @param value - Email string
 * @param fieldName - Field name for error messages
 * @returns Validated email
 * @throws {ValidationError} If invalid
 */
export function validateEmail(value: string, fieldName: string): string {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(value)) {
    throw new ValidationError(`${fieldName} is not a valid email address`, fieldName, value);
  }

  return value.toLowerCase();
}
