/**
 * Shared AI provider types.
 */

export type AIProvider = "openai" | "claude";

export interface AICompletionConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  maxInputChars: number;
  retries: number;
}

export type Confidence = "high" | "medium" | "low";

export interface Finding {
  title: string;
  confidence: Confidence;
  evidence: string[];
}

export interface RootCauseHypothesis {
  hypothesis: string;
  confidence: Confidence;
  evidence: string[];
  why_not_others: string;
  next_experiments: string[];
}

export interface RecommendedFix {
  area: "selectors" | "waits" | "data" | "env" | "network" | "infra" | "unknown";
  steps: string[];
  expected_impact: string;
  risk: Confidence;
}

export interface AlgorithmicFindingReview {
  test_id: string;
  finding_type: string;
  ai_verdict: "confirmed" | "refuted" | "partially-confirmed" | "uncertain";
  ai_confidence: Confidence;
  ai_reasoning: string;
  ai_enhancement?: string;
}

export interface AIResponse {
  pm_summary: string;
  triage_verdict: "infra" | "app" | "test" | "unknown";
  top_findings: Finding[];
  root_cause_hypotheses: RootCauseHypothesis[];
  recommended_fixes: RecommendedFix[];
  os_diff_notes: string;
  telemetry_notes: string;
  algorithmic_findings_review?: AlgorithmicFindingReview[];
}
