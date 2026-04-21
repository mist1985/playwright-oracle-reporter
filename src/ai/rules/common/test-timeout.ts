/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Test Timeout Rule
 * Covers: Test timeout exceeded, overall test timeout
 */
export class TestTimeoutRule implements Rule {
  id = "test-timeout";
  priority = 80;
  kind: Finding["kind"] = "timeout";

  match(ctx: RuleContext): boolean {
    // Only match if status is timedOut OR if message explicitly mentions test timeout
    if (ctx.test.status === "timedOut") {
      return true;
    }

    const msg = ctx.normalizedError.signature;
    // Be more specific to avoid false positives
    return msg.includes("Test timeout of") && msg.includes("exceeded");
  }

  build(ctx: RuleContext): Finding[] {
    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: "Test Timeout Exceeded",
        confidence: 0.95,
        summary: `Test exceeded the configured timeout of ${String(ctx.test.durationMs)}ms.`,
        details:
          "The test did not complete within the allowed time. This may indicate a hang or very slow operations.",
        evidenceRefs: [
          `Duration: ${String(ctx.test.durationMs)}ms`,
          ...ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS - 1),
        ],
        recommendedActions: [
          "Identify the slowest step using trace viewer.",
          "Check for infinite loops or unresolved promises.",
          "Review network requests for slow responses.",
          "Split large tests into smaller focused tests.",
          "Increase test.setTimeout() only if justified.",
        ],
      },
    ];
  }
}
