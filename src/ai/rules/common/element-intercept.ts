/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Element Intercept Rule
 * Covers: element intercepted, click intercepted by overlay
 */
export class ElementInterceptRule implements Rule {
  id = "element-intercept";
  priority = 60;
  kind: Finding["kind"] = "timeout";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      msg.includes("intercept") ||
      msg.includes("pointer events") ||
      msg.includes("obscured") ||
      msg.includes("covered by")
    );
  }

  build(ctx: RuleContext): Finding[] {
    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: "Element Intercepted",
        confidence: 0.85,
        summary: "Click was intercepted by another element (overlay, modal, tooltip).",
        details:
          "The target element exists but is covered by another element that received the click.",
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: [
          "Use { force: true } if intentional (not recommended).",
          "Wait for overlays/modals to close before clicking.",
          "Check for cookie banners, tooltips, or loading overlays.",
          "Use page.locator().scrollIntoViewIfNeeded() before clicking.",
        ],
      },
    ];
  }
}
