/**
 * Shared AI analysis prompts.
 */

const RESPONSE_SCHEMA = `{
  "pm_summary": "string max 800 chars",
  "triage_verdict": "infra|app|test|unknown",
  "top_findings": [{"title": "string", "confidence": "high|medium|low", "evidence": ["string"]}],
  "root_cause_hypotheses": [{"hypothesis": "string", "confidence": "high|medium|low", "evidence": ["string"], "why_not_others": "string", "next_experiments": ["string"]}],
  "recommended_fixes": [{"area": "selectors|waits|data|env|network|infra|unknown", "steps": ["string"], "expected_impact": "string", "risk": "low|medium|high"}],
  "os_diff_notes": "string",
  "telemetry_notes": "string",
  "algorithmic_findings_review": [{
    "test_id": "string",
    "finding_type": "string",
    "ai_verdict": "confirmed|refuted|partially-confirmed|uncertain",
    "ai_confidence": "high|medium|low",
    "ai_reasoning": "string explaining why you agree/disagree",
    "ai_enhancement": "optional string with additional context or fixes"
  }]
}`;

export function getAnalysisSystemPrompt(outputMode: "json" | "tool"): string {
  const outputInstruction =
    outputMode === "tool"
      ? `Call the record_analysis tool exactly once and populate it with fields matching this schema:\n${RESPONSE_SCHEMA}`
      : `Return ONLY valid JSON matching this schema:\n${RESPONSE_SCHEMA}`;

  return `
You are a Senior QA Engineer. Analyze these Playwright test failures.
Do not invent facts. Use only evidence in payload.
Every hypothesis must cite evidence references (testId, errorSnippet, telemetryWindow).

IMPORTANT: The payload includes "flakiness_analysis" - these are algorithmic findings from
deterministic pattern detection (race conditions, timing issues, etc.). Your task:
1. Review "algorithmicFindings" for each flaky test.
2. CONFIRM or REFUTE each finding based on actual test data evidence.
3. ENHANCE with context (why it happens) and additional causes the algorithm missed.
4. If a finding is refuted, explain why and provide a better hypothesis.

${outputInstruction}`;
}
