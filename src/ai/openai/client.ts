/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { OpenAIConfig } from "./types";
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

export class OpenAIClient {
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private requestCount: number = 0;
  private errorCount: number = 0;
  /** Set on non-recoverable errors (bad key, missing model) so remaining calls fail fast. */
  private fatalError: string | null = null;
  private circuitWarningShown = false;

  constructor(private config: OpenAIConfig) {
    // Rate limit: 50 requests per 5 seconds (conservative for tier 1)
    this.rateLimiter = new RateLimiter(50, 10);
    this.circuitBreaker = new CircuitBreaker();
  }

  /**
   * Get usage statistics
   */
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

    // Acquire rate limit token
    await this.rateLimiter.acquire();

    // Use circuit breaker
    return this.circuitBreaker
      .execute(async () => {
        return this._executeRequest(payload, signal);
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
              "⚠️  OpenAI circuit breaker triggered - falling back to rules-based analysis",
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
  private async _executeRequest(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    this.requestCount++;

    const url = "https://api.openai.com/v1/chat/completions";

    const body = {
      model: this.config.model,
      messages: [
        { role: "system", content: getAnalysisSystemPrompt("json") },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      max_tokens: this.config.maxTokens,
      temperature: 0.1,
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
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: serializedBody,
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "Unable to read error");

          if (res.status === 429 || res.status >= 500) {
            // Rate limit or server error - exponential backoff (honouring Retry-After)
            attempts++;
            lastError = `HTTP ${String(res.status)}`;
            if (attempts > this.config.retries) break;
            const backoff = computeBackoffMs(attempts, retryAfterFromResponse(res));
            if (res.status === 429) {
              console.warn(
                `⚠️  OpenAI rate limit hit, retrying in ${String(backoff)}ms (attempt ${String(attempts)}/${String(this.config.retries)})`,
              );
            } else {
              console.warn(
                `⚠️  OpenAI server error (${String(res.status)}), retrying in ${String(backoff)}ms`,
              );
            }
            await abortableSleep(backoff, signal);
            continue;
          }

          if (res.status === 401 || res.status === 403) {
            this.fatalError = `HTTP ${String(res.status)}`;
            console.error(
              res.status === 401
                ? "❌ OpenAI API key is invalid"
                : "❌ OpenAI API key does not have permission for this request",
            );
            return null;
          }

          if (res.status === 404) {
            this.fatalError = "HTTP 404";
            console.error(
              `❌ OpenAI model or endpoint not found (model=${this.config.model}):`,
              errorBody,
            );
            return null;
          }

          if (res.status === 400) {
            console.error("❌ OpenAI request was invalid:", errorBody);
            return null;
          }

          // Other permanent errors
          console.error(`❌ OpenAI API error ${String(res.status)}:`, errorBody);
          return null;
        }

        // Body read is still covered by the request timeout.
        const data = (await res.json()) as Record<string, unknown>;
        const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
        const content = choices?.[0]?.message?.content;
        return content ? JSON.parse(content) : null;
      } catch (e: unknown) {
        if (signal?.aborted) throw new RequestAbortedError();

        attempts++;

        const message = e instanceof Error ? e.message : String(e);
        const name = e instanceof Error ? e.name : "";
        lastError = message;

        // External aborts were handled above, so an aborted controller here means timeout.
        if (controller.signal.aborted || name === "AbortError") {
          console.warn(`⚠️  OpenAI request timeout after ${String(this.config.timeoutMs)}ms`);
        } else if (message.includes("fetch")) {
          console.warn(`⚠️  Network error calling OpenAI: ${message}`);
        } else {
          console.warn(`⚠️  OpenAI request failed: ${message}`);
        }

        if (attempts > this.config.retries) break;

        await abortableSleep(computeBackoffMs(attempts), signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onExternalAbort);
      }
    }

    if (signal?.aborted) throw new RequestAbortedError();
    console.error(`❌ OpenAI request failed after ${String(this.config.retries)} retries`);
    throw new RequestFailedError(`OpenAI request failed: ${lastError}`);
  }
}
