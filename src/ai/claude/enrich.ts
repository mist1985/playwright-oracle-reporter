/**
 * Claude-powered enrichment using Anthropic's Messages API.
 */

import type { NormalizedSystemMetrics } from "../../telemetry/collectors/common";
import type { RunSummary, TestSummary } from "../../report/interfaces";
import { PayloadSanitizer } from "../openai/sanitize";
import { SchemaValidator } from "../openai/schema";
import type { ClaudeConfig, ClaudeResponse } from "./types";
import { ClaudeClient } from "./client";
import { CONFIG_DEFAULTS, getEnvVar } from "../../common/constants";

export interface EnrichmentContext {
  run: RunSummary;
  tests: TestSummary[];
  telemetry: NormalizedSystemMetrics[];
  patterns: unknown[];
}

export class ClaudeEnricher {
  private config: ClaudeConfig;
  private debug: boolean = false;

  constructor(apiKey: string) {
    this.config = {
      apiKey,
      model: getEnvVar("CLAUDE_MODEL") ?? CONFIG_DEFAULTS.CLAUDE_MODEL,
      timeoutMs: parseInt(
        getEnvVar("CLAUDE_TIMEOUT_MS") ?? String(CONFIG_DEFAULTS.CLAUDE_TIMEOUT_MS),
        10,
      ),
      maxTokens: parseInt(
        getEnvVar("CLAUDE_MAX_TOKENS") ?? String(CONFIG_DEFAULTS.CLAUDE_MAX_TOKENS),
        10,
      ),
      maxInputChars: parseInt(
        getEnvVar("CLAUDE_MAX_INPUT_CHARS") ?? String(CONFIG_DEFAULTS.CLAUDE_MAX_INPUT_CHARS),
        10,
      ),
      retries: parseInt(getEnvVar("CLAUDE_RETRIES") ?? String(CONFIG_DEFAULTS.CLAUDE_RETRIES), 10),
      anthropicVersion: "2023-06-01",
    };
    const logLevel = (getEnvVar("LOG_LEVEL") ?? "").toUpperCase();
    this.debug = logLevel === "DEBUG" || process.env.PW_AI_DEBUG === "true";
  }

  async enrich(context: EnrichmentContext): Promise<ClaudeResponse | null> {
    try {
      // Get failed tests
      const failedTests = context.tests.filter(
        (t) => t.status === "failed" || t.status === "timedOut",
      );

      if (failedTests.length === 0) {
        return null;
      }

      if (this.debug) {
        console.log(`[PW-AI] Analyzing ${String(failedTests.length)} failed tests individually`);
      }

      // Analyze each test individually, but with bounded concurrency and partial-progress preservation.
      // Important: reuse a single client so rate limiting + circuit breaker are effective.
      const client = new ClaudeClient(this.config);

      const concurrency = Math.max(1, parseInt(getEnvVar("CLAUDE_CONCURRENCY") ?? "3", 10) || 3);
      const startedAt = Date.now();
      // Soft deadline: stop scheduling new work once we are close to the configured AI timeout.
      // (The outer layer may still enforce a hard timeout, but this prevents wasted work.)
      const overallBudgetMsRaw = parseInt(getEnvVar("AI_TIMEOUT_MS") ?? "", 10);
      const overallBudgetMs = Number.isFinite(overallBudgetMsRaw) ? overallBudgetMsRaw : 0;
      const softDeadlineMs =
        overallBudgetMs > 0
          ? startedAt + Math.max(0, overallBudgetMs - 2_000)
          : Number.POSITIVE_INFINITY;

      if (this.debug) {
        console.log(`[PW-AI] Claude concurrency=${String(concurrency)}`);
        if (Number.isFinite(softDeadlineMs)) {
          console.log(
            `[PW-AI] Claude enrichment soft-deadline enabled (budgetMs=${String(overallBudgetMs)})`,
          );
        }
      }

      const responses: ClaudeResponse[] = [];
      let nextIndex = 0;

      const worker = async (): Promise<void> => {
        while (nextIndex < failedTests.length) {
          const i = nextIndex++;

          if (Date.now() >= softDeadlineMs) {
            if (this.debug) {
              console.warn(
                `[PW-AI] Reached soft deadline; stopping new test analyses at ${String(i)}/${String(failedTests.length)}`,
              );
            }
            return;
          }

          const test = failedTests[i];
          if (this.debug) {
            console.log(
              `[PW-AI] Analyzing test ${String(i + 1)}/${String(failedTests.length)}: ${test.title}`,
            );
          }

          const singleTestPayload = PayloadSanitizer.sanitizeSingleTest(
            test,
            context.run,
            context.telemetry,
            context.patterns,
          );
          const payloadStr = JSON.stringify(singleTestPayload);

          if (this.debug) {
            console.log(
              `[PW-AI] Claude payload size=${String(payloadStr.length)} chars (limit=${String(this.config.maxInputChars)}), model=${this.config.model}, maxTokens=${String(this.config.maxTokens)}, timeoutMs=${String(this.config.timeoutMs)}`,
            );
            console.log(
              "[PW-AI] Note: attachments (trace.zip/screenshots) are NOT uploaded; only sanitized error text + metadata is sent.",
            );
          }

          if (payloadStr.length > this.config.maxInputChars) {
            if (this.debug) {
              console.warn(
                `[PW-AI] Single test payload too large (${String(payloadStr.length)} chars), skipping: ${test.title}`,
              );
            }
            continue;
          }

          const rawResult = await client.complete(singleTestPayload);
          if (!rawResult) {
            if (this.debug) {
              console.warn(`[PW-AI] No response for test: ${test.title}`);
            }
            continue;
          }

          const validated = SchemaValidator.validate(rawResult);
          if (validated) {
            responses.push(validated);
            console.log(`[PW-AI] ✓ Analyzed: ${test.title}`);
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, failedTests.length) }, () =>
        worker(),
      );
      await Promise.all(workers);

      if (responses.length === 0) {
        return null;
      }

      // Aggregate responses
      const aggregated = this.aggregateResponses(responses);

      console.log(
        `[PW-AI] Successfully analyzed ${String(responses.length)}/${String(failedTests.length)} failed tests`,
      );

      return aggregated;
    } catch (e) {
      console.error("[PW-AI] Error during enrichment:", e);
      return null;
    }
  }

  private aggregateResponses(responses: ClaudeResponse[]): ClaudeResponse {
    if (responses.length === 0) {
      return {
        pm_summary: "No analysis available",
        triage_verdict: "unknown",
        top_findings: [],
        root_cause_hypotheses: [],
        recommended_fixes: [],
        os_diff_notes: "",
        telemetry_notes: "",
      };
    }

    if (responses.length === 1) {
      return responses[0];
    }

    // Aggregate PM summaries
    const pmSummaries = responses.map((r) => r.pm_summary).filter(Boolean);
    const pmSummary =
      pmSummaries.length > 0
        ? pmSummaries.join(" | ")
        : "Multiple errors detected across test suite";

    // Determine most common triage verdict
    const verdictCounts = responses.reduce<Record<string, number>>((acc, r) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const verdict = r.triage_verdict ?? "unknown";
      acc[verdict] = (acc[verdict] ?? 0) + 1;
      return acc;
    }, {});
    const triageVerdict = (Object.entries(verdictCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ??
      "unknown") as "infra" | "app" | "test" | "unknown";

    // Aggregate top findings (deduplicate by title)
    const findingsMap = new Map<string, (typeof responses)[0]["top_findings"][0]>();
    for (const response of responses) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      for (const finding of response.top_findings ?? []) {
        const key = finding.title;
        if (!findingsMap.has(key)) {
          findingsMap.set(key, finding);
        }
      }
    }
    const topFindings = Array.from(findingsMap.values()).slice(0, 10);

    // Aggregate root cause hypotheses (deduplicate by hypothesis text)
    const hypothesesMap = new Map<string, (typeof responses)[0]["root_cause_hypotheses"][0]>();
    for (const response of responses) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      for (const hyp of response.root_cause_hypotheses ?? []) {
        const key = hyp.hypothesis;
        if (!hypothesesMap.has(key)) {
          hypothesesMap.set(key, hyp);
        }
      }
    }
    const rootCauseHypotheses = Array.from(hypothesesMap.values()).slice(0, 10);

    // Aggregate recommended fixes (deduplicate by area + steps)
    const fixesMap = new Map<string, (typeof responses)[0]["recommended_fixes"][0]>();
    for (const response of responses) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      for (const fix of response.recommended_fixes ?? []) {
        const key = `${fix.area}:${fix.steps.join(",")}`;
        if (!fixesMap.has(key)) {
          fixesMap.set(key, fix);
        }
      }
    }
    const recommendedFixes = Array.from(fixesMap.values()).slice(0, 10);

    // Combine notes
    const osDiffNotes = responses
      .map((r) => r.os_diff_notes)
      .filter(Boolean)
      .join(" | ");
    const telemetryNotes = responses
      .map((r) => r.telemetry_notes)
      .filter(Boolean)
      .join(" | ");

    // Combine algorithmic findings review

    const algorithmicFindingsReview = responses
      .flatMap((r) => r.algorithmic_findings_review ?? [])
      .slice(0, 20);

    return {
      pm_summary: pmSummary,
      triage_verdict: triageVerdict,
      top_findings: topFindings,
      root_cause_hypotheses: rootCauseHypotheses,
      recommended_fixes: recommendedFixes,
      os_diff_notes: osDiffNotes,
      telemetry_notes: telemetryNotes,
      algorithmic_findings_review:
        algorithmicFindingsReview.length > 0 ? algorithmicFindingsReview : undefined,
    };
  }
}
