/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Unknown Error Fallback Rule
 * Always matches as fallback when no other rule applies.
 */
export class UnknownErrorRule implements Rule {
  id = "unknown-error";
  priority = 0; // Lowest priority
  kind: Finding["kind"] = "unknown";

  match(_ctx: RuleContext): boolean {
    // Always matches as fallback
    return true;
  }

  build(ctx: RuleContext): Finding[] {
    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: "Unclassified Error",
        confidence: 0.3,
        summary: "This error does not match known patterns. Manual investigation required.",
        details: ctx.normalizedError.snippetLines.slice(0, 3).join("\n"),
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: [
          "Review the full error message and stack trace.",
          "Check application logs for related errors.",
          "Use npx playwright show-trace to inspect the failure.",
          "Search for similar errors in project issues or documentation.",
        ],
      },
    ];
  }
}
