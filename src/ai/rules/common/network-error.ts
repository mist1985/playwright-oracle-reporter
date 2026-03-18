/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Network Error Rule
 * Covers: ERR_*, DNS, connection refused, SSL, HTTP 4xx/5xx
 */
export class NetworkErrorRule implements Rule {
  id = "network-error";
  priority = 88;
  kind: Finding["kind"] = "network";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      msg.includes("ERR_CONNECTION_REFUSED") ||
      msg.includes("ERR_NAME_NOT_RESOLVED") ||
      msg.includes("ERR_CONNECTION_RESET") ||
      msg.includes("ERR_SSL") ||
      msg.includes("ERR_CERT") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("getaddrinfo") ||
      /\b(500|502|503|504)\b/.test(msg)
    );
  }

  build(ctx: RuleContext): Finding[] {
    const msg = ctx.test.error.message || "";

    let title = "Network Error";
    let summary = "A network-level error occurred.";
    let recommendations: string[] = [];

    if (msg.includes("CONNECTION_REFUSED") || msg.includes("ECONNREFUSED")) {
      title = "Connection Refused";
      summary = "The target server refused the connection. Server may not be running.";
      recommendations = [
        "Verify the backend server is running.",
        "Check if the server port is correct.",
        "Ensure no firewall is blocking the connection.",
      ];
    } else if (msg.includes("NAME_NOT_RESOLVED") || msg.includes("ENOTFOUND")) {
      title = "DNS Resolution Failed";
      summary = "Could not resolve the hostname. Check URL or DNS.";
      recommendations = [
        "Verify the URL is correct.",
        "Check DNS configuration.",
        "Try using IP address directly to isolate DNS issues.",
      ];
    } else if (msg.includes("SSL") || msg.includes("CERT")) {
      title = "SSL/Certificate Error";
      summary = "SSL handshake failed or certificate is invalid.";
      recommendations = [
        "Check if the certificate is valid and not expired.",
        "Use { ignoreHTTPSErrors: true } for self-signed certs in tests.",
        "Verify SSL configuration on the server.",
      ];
    } else if (/\b(500|502|503|504)\b/.test(msg)) {
      title = "Server Error (5xx)";
      summary = "The server returned an error response.";
      recommendations = [
        "Check server logs for errors.",
        "Verify backend dependencies are healthy.",
        "Check for deployment issues or resource exhaustion.",
      ];
    }

    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title,
        confidence: 0.9,
        summary,
        details: `Network error detected in test ${ctx.test.title}.`,
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: recommendations.slice(0, CAPS.MAX_RECOMMENDED_ACTIONS),
      },
    ];
  }
}
