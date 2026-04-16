/**
 * Unit tests for configuration validator
 */

import { validateConfig, printValidationResults } from "../src/config/validator";
import * as os from "os";

describe("Configuration Validator", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("validateConfig", () => {
    it("should pass validation with default config", () => {
      const result = validateConfig();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect invalid AI mode", () => {
      const result = validateConfig({ aiMode: "invalid-mode" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((err) => err.includes("Invalid AI mode"))).toBe(true);
    });

    it("should warn about telemetry interval out of range", () => {
      const result = validateConfig({ telemetryInterval: 100 });
      expect(result.warnings.some((warn) => warn.includes("outside recommended range"))).toBe(true);
    });

    it("should warn when OpenAI mode is set but API key is missing", () => {
      delete process.env.OPENAI_API_KEY;
      const result = validateConfig({ aiMode: "openai" });
      expect(result.warnings.some((warn) => warn.includes("OPENAI_API_KEY is not set"))).toBe(true);
    });

    it("should warn when Claude mode is set but API key is missing", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const result = validateConfig({ aiMode: "claude" });
      expect(result.warnings.some((warn) => warn.includes("ANTHROPIC_API_KEY is not set"))).toBe(
        true,
      );
    });

    it("should warn about invalid API key format", () => {
      const result = validateConfig({
        aiMode: "openai",
        openaiApiKey: "invalid-key",
      });
      expect(result.warnings.some((warn) => warn.includes("format appears invalid"))).toBe(true);
    });

    it("should warn about invalid Claude API key format", () => {
      const result = validateConfig({
        aiMode: "claude",
        claudeApiKey: "invalid-key",
      });
      expect(result.warnings.some((warn) => warn.includes("sk-ant-"))).toBe(true);
    });

    it("should include system info", () => {
      const result = validateConfig();
      expect(result.info.nodeVersion).toBeTruthy();
      expect(result.info.platform).toBeTruthy();
      expect(result.info.cpuCores).toBeGreaterThan(0);
      expect(result.info.memory).toBeTruthy();
    });

    it("should create output directory if not exists", () => {
      const result = validateConfig({ outputDir: "test-output-dir" });
      expect(result.info.outputDir).toContain("test-output-dir");
      expect(result.valid).toBe(true);
    });
  });

  describe("printValidationResults", () => {
    it("should print results without throwing", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const result = validateConfig();
      printValidationResults(result);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
