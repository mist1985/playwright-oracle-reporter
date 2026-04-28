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
    this.debug = process.env.PW_AI_DEBUG === "true";
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
        console.log(`[PW-AI] Analyzing ${failedTests.length} failed tests individually`);
      }

      // Analyze each test individually
      const responses: ClaudeResponse[] = [];
      for (let i = 0; i < failedTests.length; i++) {
        const test = failedTests[i];
        if (this.debug) {
          console.log(`[PW-AI] Analyzing test ${i + 1}/${failedTests.length}: ${test.title}`);
        }

        const singleTestPayload = PayloadSanitizer.sanitizeSingleTest(
          test,
          context.run,
          context.telemetry,
          context.patterns,
        );
        const payloadStr = JSON.stringify(singleTestPayload);

        if (payloadStr.length > this.config.maxInputChars) {
          if (this.debug) {
            console.warn(
              `[PW-AI] Single test payload too large (${payloadStr.length} chars), skipping: ${test.title}`,
            );
          }
          continue;
        }

        const client = new ClaudeClient(this.config);
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
          if (this.debug) {
            console.log(`[PW-AI] ✓ Analyzed: ${test.title}`);
          }
        }
      }

      if (responses.length === 0) {
        return null;
      }

      // Aggregate responses
      const aggregated = this.aggregateResponses(responses);

      if (this.debug) {
        console.log(
          `[PW-AI] Successfully analyzed ${responses.length}/${failedTests.length} failed tests`,
        );
      }

      return aggregated;
    } catch (e) {
      if (this.debug) {
        console.error("[PW-AI] Error during enrichment:", e);
      }
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
    const verdictCounts = responses.reduce(
      (acc, r) => {
        const verdict = r.triage_verdict || "unknown";
        acc[verdict] = (acc[verdict] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const triageVerdict = (Object.entries(verdictCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ||
      "unknown") as "infra" | "app" | "test" | "unknown";

    // Aggregate top findings (deduplicate by title)
    const findingsMap = new Map<string, (typeof responses)[0]["top_findings"][0]>();
    for (const response of responses) {
      for (const finding of response.top_findings || []) {
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
      for (const hyp of response.root_cause_hypotheses || []) {
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
      for (const fix of response.recommended_fixes || []) {
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
      .flatMap((r) => r.algorithmic_findings_review || [])
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
