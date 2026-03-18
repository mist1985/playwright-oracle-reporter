/**
 * Unit tests for custom error classes and error utilities
 */

import {
  ReporterError,
  ConfigurationError,
  FileSystemError,
  PlatformError,
  OpenAIError,
  RateLimitError,
  ValidationError,
  MemoryError,
  isReporterError,
  isError,
  getErrorMessage,
  getErrorCode,
  formatError,
} from "../src/common/errors";

describe("Error Classes", () => {
  describe("ReporterError", () => {
    it("should set name, code, and context", () => {
      const error = new ReporterError("Test error", "TEST_CODE", { key: "val" });
      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.context).toEqual({ key: "val" });
      expect(error.name).toBe("ReporterError");
    });

    it("should have a stack trace", () => {
      const error = new ReporterError("msg", "CODE");
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("ReporterError");
    });

    it("toJSON should include name, message, code, context, and stack", () => {
      const error = new ReporterError("msg", "CODE", { x: 1 });
      const json = error.toJSON();
      expect(json.name).toBe("ReporterError");
      expect(json.message).toBe("msg");
      expect(json.code).toBe("CODE");
      expect(json.context).toEqual({ x: 1 });
      expect(json.stack).toBeDefined();
    });
  });

  describe("ConfigurationError", () => {
    it("should have CONFIG_ERROR code", () => {
      const error = new ConfigurationError("bad config");
      expect(error.code).toBe("CONFIG_ERROR");
      expect(error.name).toBe("ConfigurationError");
    });
  });

  describe("FileSystemError", () => {
    it("should include operation and filePath", () => {
      const error = new FileSystemError("read failed", "read", "/tmp/file.txt");
      expect(error.code).toBe("FILESYSTEM_ERROR");
      expect(error.operation).toBe("read");
      expect(error.filePath).toBe("/tmp/file.txt");
    });

    it("should append caused-by stack when cause is provided", () => {
      const cause = new Error("ENOENT");
      const error = new FileSystemError("read failed", "read", "/tmp/file.txt", cause);
      expect(error.stack).toContain("Caused by:");
      expect(error.context?.cause).toBe("ENOENT");
    });
  });

  describe("PlatformError", () => {
    it("should include platform and feature", () => {
      const error = new PlatformError("unsupported", "win32", "telemetry");
      expect(error.code).toBe("PLATFORM_ERROR");
      expect(error.platform).toBe("win32");
      expect(error.feature).toBe("telemetry");
    });
  });

  describe("OpenAIError", () => {
    it("should include status code and API message", () => {
      const error = new OpenAIError("API failed", 429, "rate limited");
      expect(error.code).toBe("OPENAI_ERROR");
      expect(error.statusCode).toBe(429);
      expect(error.apiMessage).toBe("rate limited");
    });
  });

  describe("RateLimitError", () => {
    it("should include retryAfter", () => {
      const error = new RateLimitError("slow down", 30);
      expect(error.code).toBe("RATE_LIMIT_ERROR");
      expect(error.retryAfter).toBe(30);
    });
  });

  describe("ValidationError", () => {
    it("should include field and value", () => {
      const error = new ValidationError("bad field", "age", -1);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("age");
      expect(error.value).toBe(-1);
    });
  });

  describe("MemoryError", () => {
    it("should include used and total bytes", () => {
      const error = new MemoryError("OOM", 1000, 1024);
      expect(error.code).toBe("MEMORY_ERROR");
      expect(error.usedBytes).toBe(1000);
      expect(error.totalBytes).toBe(1024);
    });
  });
});

describe("Error Utilities", () => {
  describe("isReporterError", () => {
    it("should return true for ReporterError instances", () => {
      expect(isReporterError(new ReporterError("msg", "CODE"))).toBe(true);
      expect(isReporterError(new ConfigurationError("msg"))).toBe(true);
      expect(isReporterError(new ValidationError("msg", "f", null))).toBe(true);
    });

    it("should return false for non-ReporterError", () => {
      expect(isReporterError(new Error("msg"))).toBe(false);
      expect(isReporterError("string")).toBe(false);
      expect(isReporterError(null)).toBe(false);
    });
  });

  describe("isError", () => {
    it("should return true for Error instances", () => {
      expect(isError(new Error("msg"))).toBe(true);
      expect(isError(new ReporterError("msg", "CODE"))).toBe(true);
    });

    it("should return false for non-Error", () => {
      expect(isError("string")).toBe(false);
      expect(isError(42)).toBe(false);
      expect(isError(undefined)).toBe(false);
    });
  });

  describe("getErrorMessage", () => {
    it("should extract message from ReporterError", () => {
      expect(getErrorMessage(new ConfigurationError("bad config"))).toBe("bad config");
    });

    it("should extract message from plain Error", () => {
      expect(getErrorMessage(new Error("oops"))).toBe("oops");
    });

    it("should return string as-is", () => {
      expect(getErrorMessage("raw error")).toBe("raw error");
    });

    it("should return fallback for unknown types", () => {
      expect(getErrorMessage(42)).toBe("An unknown error occurred");
      expect(getErrorMessage(null)).toBe("An unknown error occurred");
    });
  });

  describe("getErrorCode", () => {
    it("should return code from ReporterError", () => {
      expect(getErrorCode(new ConfigurationError("msg"))).toBe("CONFIG_ERROR");
    });

    it("should return name from plain Error", () => {
      expect(getErrorCode(new TypeError("msg"))).toBe("TypeError");
    });

    it("should return UNKNOWN_ERROR for non-Error", () => {
      expect(getErrorCode("string")).toBe("UNKNOWN_ERROR");
    });
  });

  describe("formatError", () => {
    it("should format ReporterError as JSON", () => {
      const formatted = formatError(new ConfigurationError("bad"));
      const parsed = JSON.parse(formatted);
      expect(parsed.name).toBe("ConfigurationError");
      expect(parsed.code).toBe("CONFIG_ERROR");
    });

    it("should format plain Error with name, message, stack", () => {
      const formatted = formatError(new Error("oops"));
      expect(formatted).toContain("Error: oops");
    });

    it("should stringify non-Error values", () => {
      expect(formatError(42)).toBe("42");
      expect(formatError("raw")).toBe("raw");
    });
  });
});
