/**
 * Unit tests for OpenAI schema validator
 */

import { SchemaValidator } from "../src/ai/openai/schema";

/** Minimal valid response for testing */
function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    pm_summary: "Test summary",
    triage_verdict: "test",
    top_findings: [{ title: "Finding 1", confidence: "high", evidence: ["e1"] }],
    root_cause_hypotheses: [
      {
        hypothesis: "Root cause",
        confidence: "medium",
        evidence: ["e1"],
        why_not_others: "reason",
        next_experiments: ["exp1"],
      },
    ],
    recommended_fixes: [
      {
        area: "selectors",
        steps: ["step1"],
        expected_impact: "high",
        risk: "low",
      },
    ],
    os_diff_notes: "",
    telemetry_notes: "",
    ...overrides,
  };
}

describe("SchemaValidator", () => {
  describe("validate", () => {
    it("should accept a valid response", () => {
      const result = SchemaValidator.validate(validResponse());
      expect(result).not.toBeNull();
      expect(result!.pm_summary).toBe("Test summary");
      expect(result!.triage_verdict).toBe("test");
    });

    it("should return null for null input", () => {
      expect(SchemaValidator.validate(null)).toBeNull();
    });

    it("should return null for non-object input", () => {
      expect(SchemaValidator.validate("string")).toBeNull();
      expect(SchemaValidator.validate(42)).toBeNull();
      expect(SchemaValidator.validate(undefined)).toBeNull();
    });

    it("should return null when pm_summary is missing", () => {
      const input = validResponse();
      delete (input as Record<string, unknown>).pm_summary;
      expect(SchemaValidator.validate(input)).toBeNull();
    });

    it("should truncate pm_summary to 800 chars", () => {
      const result = SchemaValidator.validate(validResponse({ pm_summary: "x".repeat(1000) }));
      expect(result).not.toBeNull();
      expect(result!.pm_summary.length).toBe(800);
    });

    it("should default invalid triage_verdict to unknown", () => {
      const result = SchemaValidator.validate(validResponse({ triage_verdict: "invalid-value" }));
      expect(result).not.toBeNull();
      expect(result!.triage_verdict).toBe("unknown");
    });

    it("should return null when top_findings is not an array", () => {
      expect(SchemaValidator.validate(validResponse({ top_findings: "not array" }))).toBeNull();
    });

    it("should return null when root_cause_hypotheses is not an array", () => {
      expect(SchemaValidator.validate(validResponse({ root_cause_hypotheses: null }))).toBeNull();
    });

    it("should return null when recommended_fixes is not an array", () => {
      expect(SchemaValidator.validate(validResponse({ recommended_fixes: 42 }))).toBeNull();
    });

    it("should coerce invalid confidence values to low", () => {
      const result = SchemaValidator.validate(
        validResponse({
          top_findings: [{ title: "F1", confidence: "INVALID", evidence: [] }],
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.top_findings[0].confidence).toBe("low");
    });

    it("should default finding title to Untitled when missing", () => {
      const result = SchemaValidator.validate(
        validResponse({
          top_findings: [{ confidence: "high", evidence: [] }],
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.top_findings[0].title).toBe("Untitled");
    });

    it("should default invalid fix area to unknown", () => {
      const result = SchemaValidator.validate(
        validResponse({
          recommended_fixes: [{ area: "INVALID", steps: [], expected_impact: "", risk: "low" }],
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.recommended_fixes[0].area).toBe("unknown");
    });

    it("should handle algorithmic_findings_review when present", () => {
      const result = SchemaValidator.validate(
        validResponse({
          algorithmic_findings_review: [
            {
              test_id: "t1",
              finding_type: "timing",
              ai_verdict: "confirmed",
              ai_confidence: "high",
              ai_reasoning: "matches pattern",
            },
          ],
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.algorithmic_findings_review).toHaveLength(1);
      expect(result!.algorithmic_findings_review![0].ai_verdict).toBe("confirmed");
    });

    it("should default invalid ai_verdict to uncertain", () => {
      const result = SchemaValidator.validate(
        validResponse({
          algorithmic_findings_review: [
            {
              test_id: "t1",
              finding_type: "timing",
              ai_verdict: "WRONG",
              ai_confidence: "high",
              ai_reasoning: "reason",
            },
          ],
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.algorithmic_findings_review![0].ai_verdict).toBe("uncertain");
    });

    it("should coerce non-array algorithmic_findings_review to empty array", () => {
      const result = SchemaValidator.validate(
        validResponse({ algorithmic_findings_review: "not-array" }),
      );
      expect(result).not.toBeNull();
      expect(result!.algorithmic_findings_review).toEqual([]);
    });
  });
});
