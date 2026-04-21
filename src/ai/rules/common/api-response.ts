/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * API Response Error Rule
 * Covers: HTTP 4xx errors, API failures
 */
export class ApiResponseRule implements Rule {
  id = "api-response-error";
  priority = 65;
  kind: Finding["kind"] = "data";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      /\b(400|401|403|404|405|422)\b/.test(msg) ||
      (msg.includes("API") && (msg.includes("failed") || msg.includes("error")))
    );
  }

  build(ctx: RuleContext): Finding[] {
    const msg = ctx.test.error.message ?? "";
    let title = "API Response Error";
    let summary = "An API request returned an error response.";

    if (msg.includes("401")) {
      title = "Unauthorized (401)";
      summary = "Authentication required or token expired.";
    } else if (msg.includes("403")) {
      title = "Forbidden (403)";
      summary = "Access denied. User lacks required permissions.";
    } else if (msg.includes("404")) {
      title = "Not Found (404)";
      summary = "The requested resource does not exist.";
    } else if (msg.includes("422")) {
      title = "Validation Error (422)";
      summary = "The request payload failed server-side validation.";
    }

    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title,
        confidence: 0.85,
        summary,
        details: "Check API endpoint, authentication, and request payload.",
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: [
          "Review the API endpoint URL.",
          "Check authentication tokens and credentials.",
          "Verify request payload matches API specification.",
          "Check API logs for detailed error messages.",
        ],
      },
    ];
  }
}
