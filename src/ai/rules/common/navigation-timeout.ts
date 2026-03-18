/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Navigation Timeout Rule
 * Covers: page.goto(), navigation timeout, networkidle issues
 */
export class NavigationTimeoutRule implements Rule {
  id = "navigation-timeout";
  priority = 95;
  kind: Finding["kind"] = "timeout";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      (msg.includes("page.goto") && msg.includes("Timeout")) ||
      msg.includes("Navigation timeout") ||
      (msg.includes("Timeout") && msg.includes("networkidle"))
    );
  }

  build(ctx: RuleContext): Finding[] {
    const msg = ctx.test.error.message || "";
    const isNetworkIdle = msg.includes("networkidle");

    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: "Navigation Timeout",
        confidence: 0.85,
        summary: isNetworkIdle
          ? "Page never reached networkidle state. Likely ongoing background requests."
          : "Page navigation did not complete within timeout.",
        details: `Navigation to target URL exceeded timeout. Duration: ${ctx.test.durationMs}ms.`,
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: isNetworkIdle
          ? [
              'Use waitUntil: "domcontentloaded" instead of "networkidle".',
              "Check for polling requests (analytics, websockets) that never complete.",
              'Use page.waitForLoadState("domcontentloaded") after goto.',
            ]
          : [
              "Verify the target URL is accessible.",
              "Check network connectivity and DNS resolution.",
              "Increase navigation timeout if server is slow.",
              "Check for redirects that might cause delays.",
            ],
      },
    ];
  }
}
