/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Page/Browser Closed Rule
 * Covers: page closed, browser closed, context closed
 */
export class PageClosedRule implements Rule {
  id = "page-closed";
  priority = 75;
  kind: Finding["kind"] = "infra";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      msg.includes("page has been closed") ||
      msg.includes("browser has been closed") ||
      msg.includes("context has been closed") ||
      msg.includes("Page closed")
    );
  }

  build(ctx: RuleContext): Finding[] {
    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: "Page or Browser Closed",
        confidence: 0.9,
        summary: "An operation was attempted on a closed page, context, or browser.",
        details:
          "This typically occurs when a test continues after the browser/page has been closed, or during cleanup.",
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: [
          "Ensure page/browser is not closed before all operations complete.",
          "Check for race conditions in test cleanup.",
          "Review afterEach/afterAll hooks for premature closures.",
          "Use try/finally to handle cleanup properly.",
        ],
      },
    ];
  }
}
