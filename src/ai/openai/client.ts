/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { OpenAIConfig } from "./types";
import { CircuitBreaker, RateLimiter } from "../common/client-guards";
import { getAnalysisSystemPrompt } from "../prompts";

export class OpenAIClient {
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private requestCount: number = 0;
  private errorCount: number = 0;

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

  async complete(payload: unknown): Promise<unknown> {
    // Acquire rate limit token
    await this.rateLimiter.acquire();

    // Use circuit breaker
    return this.circuitBreaker
      .execute(async () => {
        return this._executeRequest(payload);
      })
      .catch((err) => {
        this.errorCount++;
        if (err.message.includes("Circuit breaker")) {
          console.warn(
            "⚠️  OpenAI circuit breaker triggered - falling back to rules-based analysis",
          );
        }
        return null;
      });
  }

  private async _executeRequest(payload: unknown): Promise<unknown> {
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

    let attempts = 0;
    while (attempts <= this.config.retries) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(id);

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "Unable to read error");

          if (res.status === 429) {
            // Rate limit - exponential backoff
            attempts++;
            const backoff = Math.min(1000 * Math.pow(2, attempts), 10000);
            console.warn(
              `⚠️  OpenAI rate limit hit, retrying in ${backoff}ms (attempt ${attempts}/${this.config.retries})`,
            );
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }

          if (res.status >= 500) {
            // Server error - retry with backoff
            attempts++;
            const backoff = Math.min(1000 * Math.pow(2, attempts), 10000);
            console.warn(`⚠️  OpenAI server error (${res.status}), retrying in ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }

          if (res.status === 401) {
            console.error("❌ OpenAI API key is invalid");
            return null;
          }

          if (res.status === 400) {
            console.error("❌ OpenAI request was invalid:", errorBody);
            return null;
          }

          // Other permanent errors
          console.error(`❌ OpenAI API error ${res.status}:`, errorBody);
          return null;
        }

        const data = (await res.json()) as Record<string, unknown>;
        const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
        const content = choices?.[0]?.message?.content;
        return content ? JSON.parse(content) : null;
      } catch (e: unknown) {
        attempts++;

        const message = e instanceof Error ? e.message : String(e);
        const name = e instanceof Error ? e.name : "";

        if (name === "AbortError") {
          console.warn(`⚠️  OpenAI request timeout after ${this.config.timeoutMs}ms`);
        } else if (message?.includes("fetch")) {
          console.warn(`⚠️  Network error calling OpenAI: ${message}`);
        } else {
          console.warn(`⚠️  OpenAI request failed: ${message}`);
        }

        if (attempts > this.config.retries) {
          console.error(`❌ OpenAI request failed after ${this.config.retries} retries`);
          return null;
        }

        const backoff = Math.min(1000 * Math.pow(2, attempts), 10000);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    return null;
  }
}
