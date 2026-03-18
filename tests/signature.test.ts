/**
 * Unit tests for error signature generation
 */

import { SignatureGenerator } from "../src/ai/rules/signature";

describe("SignatureGenerator", () => {
  describe("normalize", () => {
    it("should replace UUIDs with stable token", () => {
      const result = SignatureGenerator.normalize(
        "Error in session 550e8400-e29b-41d4-a716-446655440000",
        null,
      );
      expect(result).toContain("<UUID>");
      expect(result).not.toContain("550e8400");
    });

    it("should replace long hex hashes with stable token", () => {
      const result = SignatureGenerator.normalize("Object aabbccddeeff00112233445566778899", null);
      expect(result).toContain("<HASH>");
    });

    it("should replace durations with stable token", () => {
      const result = SignatureGenerator.normalize("Timeout after 30000ms", null);
      expect(result).toContain("<DUR>ms");
      expect(result).not.toContain("30000");
    });

    it("should replace timestamps with stable token", () => {
      const result = SignatureGenerator.normalize("Error at 2025-01-15T10:30:00.000Z", null);
      expect(result).toContain("<TIME>");
    });

    it("should replace macOS user paths with ~", () => {
      const result = SignatureGenerator.normalize("at /Users/john/project/src/test.ts", null);
      expect(result).toContain("~");
      expect(result).not.toContain("/Users/john");
    });

    it("should replace Linux user paths with ~", () => {
      const result = SignatureGenerator.normalize("at /home/runner/project/test.ts", null);
      expect(result).toContain("~");
      expect(result).not.toContain("/home/runner");
    });

    it("should replace line and column numbers", () => {
      const result = SignatureGenerator.normalize("file.ts:42:10", null);
      expect(result).toContain(":L:C");
      expect(result).not.toContain(":42:10");
    });

    it("should strip ANSI escape codes", () => {
      const result = SignatureGenerator.normalize("\x1b[31mRed error\x1b[0m", null);
      expect(result).toBe("Red error");
    });

    it("should cap total length", () => {
      const longMessage = "x".repeat(2000);
      const result = SignatureGenerator.normalize(longMessage, null);
      expect(result.length).toBeLessThanOrEqual(1000 + 1); // +1 for newline
    });

    it("should handle null message and null stack", () => {
      const result = SignatureGenerator.normalize(null, null);
      expect(result).toBe("");
    });
  });

  describe("hash", () => {
    it("should produce an 8-char hex string", () => {
      const hash = SignatureGenerator.hash("test input");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("should produce identical hashes for identical input", () => {
      const hash1 = SignatureGenerator.hash("same input");
      const hash2 = SignatureGenerator.hash("same input");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different input", () => {
      const hash1 = SignatureGenerator.hash("input A");
      const hash2 = SignatureGenerator.hash("input B");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("extractSnippetLines", () => {
    it("should extract non-empty lines", () => {
      const lines = SignatureGenerator.extractSnippetLines("Line 1\n\nLine 3", null);
      expect(lines).toEqual(["Line 1", "Line 3"]);
    });

    it("should cap at MAX_SNIPPET_LINES", () => {
      const message = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n");
      const lines = SignatureGenerator.extractSnippetLines(message, null);
      expect(lines.length).toBeLessThanOrEqual(10);
    });

    it("should combine message and stack", () => {
      const lines = SignatureGenerator.extractSnippetLines("Error msg", "at test.ts:42");
      expect(lines).toContain("Error msg");
      expect(lines).toContain("at test.ts:42");
    });
  });

  describe("normalizeError", () => {
    it("should produce stable hashes for equivalent errors", () => {
      const result1 = SignatureGenerator.normalizeError(
        "Timeout 5000ms at /Users/alice/test.ts:10:5",
        null,
      );
      const result2 = SignatureGenerator.normalizeError(
        "Timeout 8000ms at /Users/bob/test.ts:10:5",
        null,
      );
      expect(result1.signatureHash).toBe(result2.signatureHash);
    });

    it("should return a NormalizedError with all fields", () => {
      const result = SignatureGenerator.normalizeError("Error msg", "at stack");
      expect(result.signature).toBeTruthy();
      expect(result.signatureHash).toMatch(/^[0-9a-f]{8}$/);
      expect(result.snippetLines.length).toBeGreaterThan(0);
    });
  });
});
