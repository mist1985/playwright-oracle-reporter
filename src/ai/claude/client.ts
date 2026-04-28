/**
 * Claude API client backed by Anthropic's Messages API.
 */

import { CircuitBreaker, RateLimiter } from "../common/client-guards";
import { getAnalysisSystemPrompt } from "../prompts";
import type { ClaudeConfig } from "./types";
import { getEnvVar } from "../../common/constants";

interface ClaudeContentBlock {
  type?: string;
  name?: string;
  text?: string;
  input?: unknown;
}

interface ClaudeMessageResponse {
  content?: ClaudeContentBlock[];
}

function buildAnalysisTool() {
  return {
    name: "record_analysis",
    description: "Return the structured QA analysis for the supplied Playwright failures.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "pm_summary",
        "triage_verdict",
        "top_findings",
        "root_cause_hypotheses",
        "recommended_fixes",
        "os_diff_notes",
        "telemetry_notes",
      ],
      properties: {
        pm_summary: { type: "string", maxLength: 800 },
        triage_verdict: {
          type: "string",
          enum: ["infra", "app", "test", "unknown"],
        },
        top_findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "confidence", "evidence"],
            properties: {
              title: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              evidence: { type: "array", items: { type: "string" } },
            },
          },
        },
        root_cause_hypotheses: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "hypothesis",
              "confidence",
              "evidence",
              "why_not_others",
              "next_experiments",
            ],
            properties: {
              hypothesis: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              evidence: { type: "array", items: { type: "string" } },
              why_not_others: { type: "string" },
              next_experiments: { type: "array", items: { type: "string" } },
            },
          },
        },
        recommended_fixes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["area", "steps", "expected_impact", "risk"],
            properties: {
              area: {
                type: "string",
                enum: ["selectors", "waits", "data", "env", "network", "infra", "unknown"],
              },
              steps: { type: "array", items: { type: "string" } },
              expected_impact: { type: "string" },
              risk: { type: "string", enum: ["high", "medium", "low"] },
            },
          },
        },
        os_diff_notes: { type: "string" },
        telemetry_notes: { type: "string" },
        algorithmic_findings_review: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["test_id", "finding_type", "ai_verdict", "ai_confidence", "ai_reasoning"],
            properties: {
              test_id: { type: "string" },
              finding_type: { type: "string" },
              ai_verdict: {
                type: "string",
                enum: ["confirmed", "refuted", "partially-confirmed", "uncertain"],
              },
              ai_confidence: { type: "string", enum: ["high", "medium", "low"] },
              ai_reasoning: { type: "string" },
              ai_enhancement: { type: "string" },
            },
          },
        },
      },
    },
  };
}

export class ClaudeClient {
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private requestCount = 0;
  private errorCount = 0;

  constructor(private config: ClaudeConfig) {
    this.rateLimiter = new RateLimiter(50, 10);
    this.circuitBreaker = new CircuitBreaker();
  }

  getStats() {
    return {
      requests: this.requestCount,
      errors: this.errorCount,
      successRate:
        this.requestCount > 0
          ? (((this.requestCount - this.errorCount) / this.requestCount) * 100).toFixed(1) + "%"
          : "N/A",
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  async complete(payload: unknown): Promise<unknown> {
    await this.rateLimiter.acquire();

    return this.circuitBreaker
      .execute(async () => {
        return this.executeRequest(payload);
      })
      .catch((err: unknown) => {
        this.errorCount++;
        if (err instanceof Error && err.message.includes("Circuit breaker")) {
          console.warn(
            "⚠️  Claude circuit breaker triggered - falling back to rules-based analysis",
          );
        }
        return null;
      });
  }

  private async executeRequest(payload: unknown): Promise<unknown> {
    this.requestCount++;

    const logLevel = (getEnvVar("LOG_LEVEL") ?? "").toUpperCase();
    const debug = logLevel === "DEBUG" || process.env.PW_AI_DEBUG === "true";
    const startedAt = Date.now();

    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: 0.1,
      system: getAnalysisSystemPrompt("tool"),
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      tools: [buildAnalysisTool()],
      tool_choice: { type: "tool", name: "record_analysis" },
    };

    let attempts = 0;
    while (attempts <= this.config.retries) {
      try {
        if (debug) {
          const size = (() => {
            try {
              return JSON.stringify(payload).length;
            } catch {
              return -1;
            }
          })();
          console.log(
            `[PW-AI] Claude request attempt ${String(attempts + 1)}/${String(this.config.retries + 1)} (model=${this.config.model}, payloadChars=${String(size)}, timeoutMs=${String(this.config.timeoutMs)})`,
          );
        }

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": this.config.anthropicVersion,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(id);

        if (debug) {
          console.log(
            `[PW-AI] Claude response status=${String(res.status)} elapsedMs=${String(Date.now() - startedAt)}`,
          );
        }

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "Unable to read error");

          if (res.status === 429 || res.status === 529) {
            attempts++;
            const backoff = Math.min(1000 * Math.pow(2, attempts), 10000);
            console.warn(
              `⚠️  Claude rate limit or overload hit, retrying in ${String(backoff)}ms (attempt ${String(attempts)}/${String(this.config.retries)})`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }

          if (res.status >= 500) {
            attempts++;
            const backoff = Math.min(1000 * Math.pow(2, attempts), 10000);
            console.warn(
              `⚠️  Claude server error (${String(res.status)}), retrying in ${String(backoff)}ms`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }

          if (res.status === 401) {
            console.error("❌ Claude API key is invalid");
            return null;
          }

          if (res.status === 400) {
            console.error("❌ Claude request was invalid:", errorBody);
            return null;
          }

          console.error(`❌ Claude API error ${String(res.status)}:`, errorBody);
          return null;
        }

        const data = ((await res.json()) as ClaudeMessageResponse | null) ?? {};
        const toolUse = data.content?.find(
          (block) => block.type === "tool_use" && block.name === "record_analysis",
        );
        if (toolUse?.input) {
          return toolUse.input;
        }

        const text = data.content
          ?.filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("");

        return text ? JSON.parse(text) : null;
      } catch (e: unknown) {
        attempts++;

        const message = e instanceof Error ? e.message : String(e);
        const name = e instanceof Error ? e.name : "";

        if (name === "AbortError") {
          console.warn(`⚠️  Claude request timeout after ${String(this.config.timeoutMs)}ms`);
        } else if (message.includes("fetch")) {
          console.warn(`⚠️  Network error calling Claude: ${message}`);
        } else {
          console.warn(`⚠️  Claude request failed: ${message}`);
        }

        if (attempts > this.config.retries) {
          console.error(`❌ Claude request failed after ${String(this.config.retries)} retries`);
          return null;
        }

        const backoff = Math.min(1000 * Math.pow(2, attempts), 10000);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    return null;
  }
}
