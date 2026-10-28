/**
 * Claude API client backed by Anthropic's Messages API.
 */

import {
  CircuitBreaker,
  RateLimiter,
  RequestAbortedError,
  RequestFailedError,
  abortableSleep,
  computeBackoffMs,
  retryAfterFromResponse,
} from "../common/client-guards";
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
  /** Set on non-recoverable errors (bad key, missing model) so remaining calls fail fast. */
  private fatalError: string | null = null;
  private circuitWarningShown = false;

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

  /**
   * Whether further requests can succeed. False after a fatal error
   * (e.g. invalid API key) or while the circuit breaker is open.
   */
  isAvailable(): boolean {
    return this.fatalError === null && !this.circuitBreaker.isOpen();
  }

  async complete(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.fatalError !== null || signal?.aborted) {
      return null;
    }

    await this.rateLimiter.acquire();

    return this.circuitBreaker
      .execute(async () => {
        return this.executeRequest(payload, signal);
      })
      .catch((err: unknown) => {
        if (err instanceof RequestAbortedError) {
          return null;
        }
        this.errorCount++;
        if (err instanceof Error && err.message.includes("Circuit breaker")) {
          if (!this.circuitWarningShown) {
            this.circuitWarningShown = true;
            console.warn(
              "⚠️  Claude circuit breaker triggered - falling back to rules-based analysis",
            );
          }
        }
        return null;
      });
  }

  /**
   * Execute one logical request with retries.
   *
   * Resolves with the parsed analysis, or `null` for non-retryable request errors.
   * Throws {@link RequestFailedError} when retries are exhausted (counted by the
   * circuit breaker) and {@link RequestAbortedError} when `signal` aborts.
   */
  private async executeRequest(payload: unknown, signal?: AbortSignal): Promise<unknown> {
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
    const serializedBody = JSON.stringify(body);

    let attempts = 0;
    let lastError = "unknown error";
    while (attempts <= this.config.retries) {
      if (signal?.aborted) throw new RequestAbortedError();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const onExternalAbort = () => controller.abort();
      signal?.addEventListener("abort", onExternalAbort, { once: true });

      try {
        if (debug) {
          console.log(
            `[PW-AI] Claude request attempt ${String(attempts + 1)}/${String(this.config.retries + 1)} (model=${this.config.model}, payloadChars=${String(serializedBody.length)}, timeoutMs=${String(this.config.timeoutMs)})`,
          );
        }

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": this.config.anthropicVersion,
          },
          body: serializedBody,
          signal: controller.signal,
        });

        if (debug) {
          console.log(
            `[PW-AI] Claude response status=${String(res.status)} elapsedMs=${String(Date.now() - startedAt)}`,
          );
        }

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "Unable to read error");

          if (res.status === 429 || res.status === 529 || res.status >= 500) {
            attempts++;
            lastError = `HTTP ${String(res.status)}`;
            if (attempts > this.config.retries) break;
            const backoff = computeBackoffMs(attempts, retryAfterFromResponse(res));
            if (res.status === 429 || res.status === 529) {
              console.warn(
                `⚠️  Claude rate limit or overload hit, retrying in ${String(backoff)}ms (attempt ${String(attempts)}/${String(this.config.retries)})`,
              );
            } else {
              console.warn(
                `⚠️  Claude server error (${String(res.status)}), retrying in ${String(backoff)}ms`,
              );
            }
            await abortableSleep(backoff, signal);
            continue;
          }

          if (res.status === 401 || res.status === 403) {
            this.fatalError = `HTTP ${String(res.status)}`;
            console.error(
              res.status === 401
                ? "❌ Claude API key is invalid"
                : "❌ Claude API key does not have permission for this request",
            );
            return null;
          }

          if (res.status === 404) {
            this.fatalError = "HTTP 404";
            console.error(
              `❌ Claude model or endpoint not found (model=${this.config.model}):`,
              errorBody,
            );
            return null;
          }

          if (res.status === 400) {
            console.error("❌ Claude request was invalid:", errorBody);
            return null;
          }

          console.error(`❌ Claude API error ${String(res.status)}:`, errorBody);
          return null;
        }

        // Body read is still covered by the request timeout.
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
        if (signal?.aborted) throw new RequestAbortedError();

        attempts++;

        const message = e instanceof Error ? e.message : String(e);
        const name = e instanceof Error ? e.name : "";
        lastError = message;

        // External aborts were handled above, so an aborted controller here means timeout.
        if (controller.signal.aborted || name === "AbortError") {
          console.warn(`⚠️  Claude request timeout after ${String(this.config.timeoutMs)}ms`);
        } else if (message.includes("fetch")) {
          console.warn(`⚠️  Network error calling Claude: ${message}`);
        } else {
          console.warn(`⚠️  Claude request failed: ${message}`);
        }

        if (attempts > this.config.retries) break;

        await abortableSleep(computeBackoffMs(attempts), signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onExternalAbort);
      }
    }

    if (signal?.aborted) throw new RequestAbortedError();
    console.error(`❌ Claude request failed after ${String(this.config.retries)} retries`);
    throw new RequestFailedError(`Claude request failed: ${lastError}`);
  }
}
