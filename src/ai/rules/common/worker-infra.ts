/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../../types";

/**
 * Worker/Infra Error Rule
 * Covers: worker shutdown, browser crash, process errors
 */
export class WorkerInfraRule implements Rule {
  id = "worker-infra";
  priority = 70;
  kind: Finding["kind"] = "infra";

  match(ctx: RuleContext): boolean {
    const msg = ctx.normalizedError.signature;
    return (
      (msg.includes("worker") && (msg.includes("exited") || msg.includes("shutdown"))) ||
      msg.includes("Browser process") ||
      msg.includes("process exited") ||
      msg.includes("SIGTERM") ||
      msg.includes("SIGKILL")
    );
  }

  build(ctx: RuleContext): Finding[] {
    return [
      {
        id: this.id,
        scope: "test",
        kind: this.kind,
        title: "Worker or Infrastructure Error",
        confidence: 0.8,
        summary: "A test worker or browser process terminated unexpectedly.",
        details:
          "This may indicate resource exhaustion, external termination, or infrastructure issues.",
        evidenceRefs: ctx.normalizedError.snippetLines.slice(0, CAPS.MAX_EVIDENCE_REFS),
        recommendedActions: [
          "Check system resources (memory, CPU) during test execution.",
          "Reduce number of parallel workers.",
          "Review for memory leaks in tests or application.",
          "Check CI/CD resource limits.",
          "Ensure browser binaries are correctly installed.",
        ],
      },
    ];
  }
}
