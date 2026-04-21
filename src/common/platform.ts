/**
 * Cross-platform utilities for OS-specific operations
 * Copyright (c) 2026 Mihajlo Stojanovski
 */

import { exec, ExecOptions } from "child_process";
import * as os from "os";
import { promisify } from "util";
import {
  getBooleanEnvVar,
  PLATFORM_COMMANDS,
  TIMEOUTS,
  SUPPORTED_PLATFORMS,
  SupportedPlatform,
} from "./constants";
import { PlatformError } from "./errors";
import { getLogger } from "./logger";

const execAsync = promisify(exec);
const logger = getLogger();

/**
 * Command execution result
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Check if current platform is supported
 */
export function isSupportedPlatform(
  platform: string = process.platform,
): platform is SupportedPlatform {
  return SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform);
}

/**
 * Get current platform
 */
export function getPlatform(): SupportedPlatform {
  const platform = process.platform;

  if (!isSupportedPlatform(platform)) {
    throw new PlatformError(
      `Platform ${platform} is not supported`,
      platform,
      "platform detection",
    );
  }

  return platform;
}

/**
 * Normalize a Node.js platform value to a supported reporter platform.
 */
export function normalizeSupportedPlatform(
  platform: string = process.platform,
): SupportedPlatform | null {
  return isSupportedPlatform(platform) ? platform : null;
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Check if running on macOS
 */
export function isMac(): boolean {
  return process.platform === "darwin";
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === "linux";
}

/**
 * Execute shell command with timeout and proper error handling
 *
 * @param command - Command to execute
 * @param timeout - Timeout in milliseconds (default: 10 seconds)
 * @returns Command result
 * @throws {PlatformError} If command fails or times out
 */
export async function executeCommand(
  command: string,
  timeout: number = TIMEOUTS.SHELL_COMMAND_MS,
): Promise<CommandResult> {
  try {
    logger.debug("Executing command", { command, timeout });

    const options: ExecOptions = {
      timeout,
      maxBuffer: 1024 * 1024, // 1MB buffer
      windowsHide: true, // Hide console window on Windows
    };

    const { stdout, stderr } = await execAsync(command, options);

    logger.debug("Command completed successfully", { command });

    return {
      stdout: String(stdout).trim(),
      stderr: String(stderr).trim(),
      exitCode: 0,
    };
  } catch (error: unknown) {
    logger.error("Command execution failed", error as Error, { command });

    const execError = error as {
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };

    // Check if it's a timeout
    if (execError.killed && execError.signal === "SIGTERM") {
      throw new PlatformError(
        `Command timed out after ${String(timeout)}ms: ${command}`,
        process.platform,
        "command execution",
      );
    }

    // Return error with exit code
    return {
      stdout: execError.stdout ? String(execError.stdout).trim() : "",
      stderr: execError.stderr ? String(execError.stderr).trim() : (execError.message ?? ""),
      exitCode: execError.code ?? 1,
    };
  }
}

/**
 * Get platform-specific command to open files
 *
 * @returns Command string (without arguments)
 */
export function getOpenCommand(): string {
  const platform = getPlatform();

  switch (platform) {
    case "darwin":
      return PLATFORM_COMMANDS.MACOS_OPEN;
    case "linux":
      return PLATFORM_COMMANDS.LINUX_OPEN;
    case "win32":
      return PLATFORM_COMMANDS.WINDOWS_OPEN;
    default:
      throw new PlatformError(
        `No open command available for platform: ${String(platform)}`,
        platform,
        "file opening",
      );
  }
}

/**
 * Open file with default application
 *
 * @param filePath - Absolute path to file
 * @throws {PlatformError} If opening fails
 */
export async function openFile(filePath: string): Promise<void> {
  const platform = getPlatform();
  const command = getOpenCommand();

  // Platform-specific command construction
  let fullCommand: string;

  if (isWindows()) {
    // Windows: start "" "path" (empty title required)
    fullCommand = `${command} "" "${filePath}"`;
  } else if (isMac() || isLinux()) {
    // macOS/Linux: command "path"
    fullCommand = `${command} "${filePath}"`;
  } else {
    throw new PlatformError(`Cannot open file on platform: ${platform}`, platform, "file opening");
  }

  logger.info("Opening file", { filePath, platform, command: fullCommand });

  const result = await executeCommand(fullCommand);

  if (result.exitCode !== 0) {
    throw new PlatformError(
      `Failed to open file: ${result.stderr !== "" ? result.stderr : "Unknown error"}`,
      platform,
      "file opening",
    );
  }
}

/**
 * Normalize path separators for current platform
 *
 * @param filePath - Path to normalize
 * @returns Normalized path
 */
export function normalizePath(filePath: string): string {
  if (isWindows()) {
    return filePath.replace(/\//g, "\\");
  }
  return filePath.replace(/\\/g, "/");
}

/**
 * Escape path for shell command
 *
 * @param filePath - Path to escape
 * @returns Escaped path safe for shell execution
 */
export function escapeShellPath(filePath: string): string {
  if (isWindows()) {
    // Windows: wrap in quotes and escape internal quotes
    return `"${filePath.replace(/"/g, '""')}"`;
  }
  // Unix: escape special characters
  return filePath.replace(/(["\s'$`\\])/g, "\\$1");
}

/**
 * Check if command is available on system
 *
 * @param command - Command name to check
 * @returns True if command exists
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const checkCommand = isWindows() ? `where ${command}` : `which ${command}`;

    const result = await executeCommand(checkCommand, 5000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get platform-specific environment separator
 *
 * @returns Path separator (: for Unix, ; for Windows)
 */
export function getPathSeparator(): string {
  return isWindows() ? ";" : ":";
}

/**
 * Get platform information for diagnostics
 */
export interface PlatformInfo {
  platform: SupportedPlatform;
  arch: string;
  release: string;
  nodeVersion: string;
  isCI: boolean;
  [key: string]: unknown; // Make indexable for logging
}

/**
 * Get comprehensive platform information
 *
 * @returns Platform diagnostics
 */
export function getPlatformInfo(): PlatformInfo {
  return {
    platform: getPlatform(),
    arch: process.arch,
    release: os.release(),
    nodeVersion: process.version,
    isCI: isCI(),
  };
}

/**
 * Detect if running in CI environment
 *
 * @returns True if running in CI
 */
export function isCI(): boolean {
  return !!(
    process.env.CI ??
    process.env.CONTINUOUS_INTEGRATION ??
    process.env.BUILD_NUMBER ??
    process.env.GITHUB_ACTIONS ??
    process.env.GITLAB_CI ??
    process.env.CIRCLECI ??
    process.env.TRAVIS ??
    process.env.JENKINS_URL ??
    process.env.TEAMCITY_VERSION
  );
}

/**
 * Get CI environment name
 *
 * @returns CI platform name or 'local'
 */
export function getCIEnvironment(): string {
  if (process.env.GITHUB_ACTIONS) return "GitHub Actions";
  if (process.env.GITLAB_CI) return "GitLab CI";
  if (process.env.CIRCLECI) return "CircleCI";
  if (process.env.TRAVIS) return "Travis CI";
  if (process.env.JENKINS_URL) return "Jenkins";
  if (process.env.TEAMCITY_VERSION) return "TeamCity";
  if (process.env.CI) return "Generic CI";
  return "Local";
}

/**
 * Decide whether browser-opening behavior should be enabled.
 *
 * Local runs default to enabled for convenience.
 * CI runs default to disabled unless explicitly forced on.
 */
export function shouldAutoOpenReport(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }

  const envValue = getBooleanEnvVar("OPEN_REPORT");
  if (typeof envValue === "boolean") {
    return envValue;
  }

  return !isCI();
}
