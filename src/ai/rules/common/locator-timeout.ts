/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Locator/Selector Timeout Rule
 * Covers: waitForSelector, expect(locator).toBe*, toHaveText, strict mode
 */
export class LocatorTimeoutRule implements Rule {
  id = "locator-timeout";
  priority = 100;
  kind: Finding["kind"] = "timeout";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      msg.includes("waiting for selector") ||
      msg.includes("waiting for locator") ||
      (msg.includes("Timeout") && msg.includes("locator")) ||
      msg.includes("strict mode violation")
    );
  }

  build(ctx: RuleContext): Finding[] {
    const msg = ctx.test.error.message || "";
    let details = "Element not found or not visible within timeout.";

    // Extract selector if possible
    const selectorMatch = msg.match(/selector\s+"([^"]+)"/);
    if (selectorMatch) {
      details = `Stuck waiting for: ${selectorMatch[1]}`;
    }

    const isStrictMode = msg.includes("strict mode");

    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: isStrictMode ? "Strict Mode Violation" : "Locator Timeout",
        confidence: 0.96,
        summary: isStrictMode
          ? "Multiple elements matched the selector. Use a more specific locator."
          : "Element did not appear within the timeout period.",
        details,
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: isStrictMode
          ? [
              "Use page.getByRole() or page.getByTestId() for unique selection.",
              "Add :nth-child() or .first() to narrow selection.",
              "Review DOM for duplicate elements.",
            ]
          : [
              "Verify the element exists in the DOM using browser DevTools.",
              'Check if element is hidden (use { state: "attached" } instead of "visible").',
              "Increase timeout if app rendering is slow.",
              "Use page.pause() to debug interactively.",
            ],
      },
    ];
  }
}
