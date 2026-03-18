/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Execution Context Destroyed Rule
 * Covers: context destroyed, frame detached, element not attached
 */
export class ContextDestroyedRule implements Rule {
  id = "context-destroyed";
  priority = 90;
  kind: Finding["kind"] = "infra";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      msg.includes("Execution context was destroyed") ||
      msg.includes("frame was detached") ||
      msg.includes("Element is not attached") ||
      msg.includes("Target closed") ||
      msg.includes("Target crashed")
    );
  }

  build(ctx: RuleContext): Finding[] {
    const msg = ctx.test.error.message || "";
    const isFrameDetached = msg.includes("frame");
    const isCrash = msg.includes("crashed");

    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: isCrash ? "Browser/Target Crashed" : "Execution Context Destroyed",
        confidence: 0.85,
        summary: isCrash
          ? "The browser or page crashed during test execution."
          : "The page or frame was navigated away or closed during an operation.",
        details: isFrameDetached
          ? "A frame was detached, likely due to navigation or removal from DOM."
          : "The execution context (page/frame) is no longer available.",
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: isCrash
          ? [
              "Check for memory leaks or excessive resource usage.",
              "Reduce parallel workers to decrease resource pressure.",
              "Update browser/Playwright to latest version.",
              "Check system logs for OOM killer events.",
            ]
          : [
              "Avoid triggering navigation during element interactions.",
              "Use await before interacting with elements after navigation.",
              "Check for auto-redirects or page refreshes.",
              "Use page.waitForNavigation() when navigation is expected.",
            ],
      },
    ];
  }
}
