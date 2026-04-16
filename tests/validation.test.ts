/**
 * Unit tests for input validation utilities
 */

import {
  validateInteger,
  parseIntSafe,
  validateNonEmptyString,
  validateAIMode,
  validateTelemetryInterval,
  validateOpenAIKey,
  validateClaudeKey,
  sanitizeFilePath,
  validatePercentage,
  validateNodeVersion,
  validateRequiredKeys,
  validateTimeout,
  validatePort,
  validateURL,
  validateEmail,
} from "../src/common/validation";
import { ValidationError } from "../src/common/errors";

describe("Validation Utilities", () => {
  describe("validateInteger", () => {
    it("should accept valid integers", () => {
      expect(validateInteger(42, "field")).toBe(42);
      expect(validateInteger("99", "field")).toBe(99);
      expect(validateInteger(0, "field")).toBe(0);
    });

    it("should throw for NaN", () => {
      expect(() => validateInteger(NaN, "field")).toThrow(ValidationError);
      expect(() => validateInteger("abc", "field")).toThrow(ValidationError);
    });

    it("should throw for non-integers", () => {
      expect(() => validateInteger(3.14, "field")).toThrow(ValidationError);
    });

    it("should enforce min/max bounds", () => {
      expect(validateInteger(5, "field", 1, 10)).toBe(5);
      expect(() => validateInteger(0, "field", 1, 10)).toThrow(ValidationError);
      expect(() => validateInteger(11, "field", 1, 10)).toThrow(ValidationError);
    });
  });

  describe("parseIntSafe", () => {
    it("should return parsed value for valid input", () => {
      expect(parseIntSafe("42", 0)).toBe(42);
    });

    it("should return default for undefined", () => {
      expect(parseIntSafe(undefined, 99)).toBe(99);
    });

    it("should return default for invalid input", () => {
      expect(parseIntSafe("abc", 99)).toBe(99);
    });

    it("should return default when out of range", () => {
      expect(parseIntSafe("100", 0, 1, 50)).toBe(0);
    });
  });

  describe("validateNonEmptyString", () => {
    it("should accept valid strings", () => {
      expect(validateNonEmptyString("hello", "field")).toBe("hello");
    });

    it("should trim whitespace", () => {
      expect(validateNonEmptyString("  hello  ", "field")).toBe("hello");
    });

    it("should throw for empty string", () => {
      expect(() => validateNonEmptyString("", "field")).toThrow(ValidationError);
      expect(() => validateNonEmptyString("   ", "field")).toThrow(ValidationError);
    });

    it("should throw for non-string", () => {
      expect(() => validateNonEmptyString(42, "field")).toThrow(ValidationError);
    });

    it("should enforce maxLength", () => {
      expect(() => validateNonEmptyString("toolong", "field", 3)).toThrow(ValidationError);
    });
  });

  describe("validateAIMode", () => {
    it("should accept valid modes", () => {
      expect(validateAIMode("auto")).toBe("auto");
      expect(validateAIMode("rules")).toBe("rules");
      expect(validateAIMode("openai")).toBe("openai");
      expect(validateAIMode("claude")).toBe("claude");
    });

    it("should throw for invalid mode", () => {
      expect(() => validateAIMode("invalid")).toThrow(ValidationError);
    });
  });

  describe("validateTelemetryInterval", () => {
    it("should accept valid intervals", () => {
      expect(validateTelemetryInterval(5)).toBe(5);
    });

    it("should reject out-of-range intervals", () => {
      expect(() => validateTelemetryInterval(0)).toThrow(ValidationError);
    });
  });

  describe("validateOpenAIKey", () => {
    it("should accept valid key format", () => {
      const result = validateOpenAIKey("sk-" + "a".repeat(45));
      expect(result.valid).toBe(true);
      expect(result.value).toBeTruthy();
    });

    it("should reject empty key", () => {
      const result = validateOpenAIKey("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject key not starting with sk-", () => {
      const result = validateOpenAIKey("pk-" + "a".repeat(45));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("sk-");
    });

    it("should reject suspiciously short keys", () => {
      const result = validateOpenAIKey("sk-short");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("suspicious");
    });
  });

  describe("sanitizeFilePath", () => {
    it("should accept clean paths", () => {
      expect(sanitizeFilePath("/tmp/report.html")).toBe("/tmp/report.html");
    });

    it("should throw on directory traversal", () => {
      expect(() => sanitizeFilePath("../../etc/passwd")).toThrow(ValidationError);
    });

    it("should throw on null bytes", () => {
      expect(() => sanitizeFilePath("/tmp/file\0.txt")).toThrow(ValidationError);
    });
  });

  describe("validateClaudeKey", () => {
    it("should accept valid key format", () => {
      const result = validateClaudeKey("sk-ant-api03-" + "a".repeat(40));
      expect(result.valid).toBe(true);
      expect(result.value).toBeTruthy();
    });

    it("should reject empty key", () => {
      const result = validateClaudeKey("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject key not starting with sk-ant-", () => {
      const result = validateClaudeKey("sk-live-" + "a".repeat(40));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("sk-ant-");
    });

    it("should reject suspiciously short keys", () => {
      const result = validateClaudeKey("sk-ant-short");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("suspicious");
    });
  });

  describe("validatePercentage", () => {
    it("should accept 0-100 range", () => {
      expect(validatePercentage(0, "cpu")).toBe(0);
      expect(validatePercentage(50, "cpu")).toBe(50);
      expect(validatePercentage(100, "cpu")).toBe(100);
    });

    it("should reject out-of-range values", () => {
      expect(() => validatePercentage(-1, "cpu")).toThrow(ValidationError);
      expect(() => validatePercentage(101, "cpu")).toThrow(ValidationError);
    });

    it("should reject NaN", () => {
      expect(() => validatePercentage(NaN, "cpu")).toThrow(ValidationError);
    });
  });

  describe("validateNodeVersion", () => {
    it("should accept sufficient versions", () => {
      expect(validateNodeVersion("v18.12.0", 18)).toBe(true);
      expect(validateNodeVersion("v20.0.0", 18)).toBe(true);
    });

    it("should reject insufficient versions", () => {
      expect(validateNodeVersion("v16.0.0", 18)).toBe(false);
    });

    it("should handle invalid version strings", () => {
      expect(validateNodeVersion("invalid", 18)).toBe(false);
    });
  });

  describe("validateRequiredKeys", () => {
    it("should pass when all keys present", () => {
      expect(() => validateRequiredKeys({ a: 1, b: 2 }, ["a", "b"], "config")).not.toThrow();
    });

    it("should throw when keys are missing", () => {
      expect(() => validateRequiredKeys({ a: 1 }, ["a", "b", "c"], "config")).toThrow(
        ValidationError,
      );
    });
  });

  describe("validateTimeout", () => {
    it("should accept valid timeouts", () => {
      expect(validateTimeout(5000, "timeout")).toBe(5000);
    });

    it("should reject too-low timeouts", () => {
      expect(() => validateTimeout(100, "timeout")).toThrow(ValidationError);
    });
  });

  describe("validatePort", () => {
    it("should accept valid ports", () => {
      expect(validatePort(8080, "port")).toBe(8080);
      expect(validatePort(443, "port")).toBe(443);
    });

    it("should reject invalid ports", () => {
      expect(() => validatePort(0, "port")).toThrow(ValidationError);
      expect(() => validatePort(70000, "port")).toThrow(ValidationError);
    });
  });

  describe("validateURL", () => {
    it("should accept valid URLs", () => {
      const url = validateURL("https://example.com", "endpoint");
      expect(url.hostname).toBe("example.com");
    });

    it("should throw for invalid URLs", () => {
      expect(() => validateURL("not-a-url", "endpoint")).toThrow(ValidationError);
    });
  });

  describe("validateEmail", () => {
    it("should accept valid emails", () => {
      expect(validateEmail("user@example.com", "email")).toBe("user@example.com");
    });

    it("should lowercase emails", () => {
      expect(validateEmail("User@Example.COM", "email")).toBe("user@example.com");
    });

    it("should reject invalid emails", () => {
      expect(() => validateEmail("not-an-email", "email")).toThrow(ValidationError);
      expect(() => validateEmail("@example.com", "email")).toThrow(ValidationError);
    });
  });
});
