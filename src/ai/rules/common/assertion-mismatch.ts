/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Assertion Mismatch Rule
 * Covers: expect().toBe*, toContain, toHaveText, toHaveValue, etc.
 */
export class AssertionMismatchRule implements Rule {
  id = "assertion-mismatch";
  priority = 85;
  kind: Finding["kind"] = "assertion";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      (msg.includes("expect") || msg.includes("Expected")) &&
      (msg.includes("Received") ||
        msg.includes("received") ||
        msg.includes("to be") ||
        msg.includes("to equal") ||
        msg.includes("to contain") ||
        msg.includes("to have"))
    );
  }

  build(ctx: RuleContext): Finding[] {
    const msg = ctx.test.error.message || "";
    let details = "Assertion comparison failed.";

    // Try to extract expected/received
    const expectedMatch = msg.match(/Expected[:\s]+(.{1,100})/i);
    const receivedMatch = msg.match(/Received[:\s]+(.{1,100})/i);

    if (expectedMatch && receivedMatch) {
      details = `Expected: ${expectedMatch[1].trim()}\nReceived: ${receivedMatch[1].trim()}`;
    }

    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: "Assertion Failed",
        confidence: 0.95,
        summary: "A test assertion did not match the expected value.",
        details,
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: [
          "Review the expected vs received values in the error.",
          "Check if test data/fixtures are correct.",
          "Verify the application logic has not changed.",
          "Use toMatchSnapshot() for complex object comparisons.",
          "Consider using soft assertions for non-critical checks.",
        ],
      },
    ];
  }
}
