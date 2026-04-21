/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import type { AIResponse, Confidence } from "../types";

export class SchemaValidator {
  static validate(json: unknown): AIResponse | null {
    try {
      if (!json || typeof json !== "object") return null;
      const obj = json as Record<string, unknown>;

      // pm_summary
      if (typeof obj.pm_summary !== "string") return null;
      if (obj.pm_summary.length > 800) obj.pm_summary = obj.pm_summary.substring(0, 800);

      // triage_verdict
      if (!["infra", "app", "test", "unknown"].includes(obj.triage_verdict as string)) {
        obj.triage_verdict = "unknown"; // fallback safe
      }

      // top_findings
      if (!Array.isArray(obj.top_findings)) return null;
      obj.top_findings = (obj.top_findings as Record<string, unknown>[]).map((f) => ({
        title: String(f.title ?? "Untitled"),
        confidence: this.validateConfidence(f.confidence),
        evidence: Array.isArray(f.evidence) ? f.evidence.map(String) : [],
      }));

      // root_cause_hypotheses
      if (!Array.isArray(obj.root_cause_hypotheses)) return null;
      obj.root_cause_hypotheses = (obj.root_cause_hypotheses as Record<string, unknown>[]).map(
        (h) => ({
          hypothesis: String(h.hypothesis ?? "Unknown"),
          confidence: this.validateConfidence(h.confidence),
          evidence: Array.isArray(h.evidence) ? h.evidence.map(String) : [],
          why_not_others: String(h.why_not_others ?? ""),
          next_experiments: Array.isArray(h.next_experiments) ? h.next_experiments.map(String) : [],
        }),
      );

      // recommended_fixes
      if (!Array.isArray(obj.recommended_fixes)) return null;
      obj.recommended_fixes = (obj.recommended_fixes as Record<string, unknown>[]).map((f) => ({
        area: ["selectors", "waits", "data", "env", "network", "infra", "unknown"].includes(
          f.area as string,
        )
          ? f.area
          : "unknown",
        steps: Array.isArray(f.steps) ? f.steps.map(String) : [],
        expected_impact: String(f.expected_impact ?? ""),
        risk: this.validateConfidence(f.risk),
      }));

      // notes
      obj.os_diff_notes = String(obj.os_diff_notes ?? "");
      obj.telemetry_notes = String(obj.telemetry_notes ?? "");

      // algorithmic_findings_review
      if (obj.algorithmic_findings_review) {
        if (!Array.isArray(obj.algorithmic_findings_review)) {
          obj.algorithmic_findings_review = [];
        } else {
          obj.algorithmic_findings_review = (
            obj.algorithmic_findings_review as Record<string, unknown>[]
          ).map((r) => ({
            test_id: String(r.test_id ?? ""),
            finding_type: String(r.finding_type ?? ""),
            ai_verdict: ["confirmed", "refuted", "partially-confirmed", "uncertain"].includes(
              r.ai_verdict as string,
            )
              ? r.ai_verdict
              : "uncertain",
            ai_confidence: this.validateConfidence(r.ai_confidence),
            ai_reasoning: String(r.ai_reasoning ?? ""),
            ai_enhancement: r.ai_enhancement ? String(r.ai_enhancement) : undefined,
          }));
        }
      }

      return obj as unknown as AIResponse;
    } catch {
      return null;
    }
  }

  private static validateConfidence(c: unknown): Confidence {
    if (["high", "medium", "low"].includes(c as string)) return c as Confidence;
    return "low";
  }
}
