/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { OpenAIConfig } from "./types";

/**
 * Rate limiter to prevent API abuse
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number = 50, refillRate: number = 10) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    while (this.tokens < 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      this.refill();
    }

    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Circuit breaker to prevent cascading failures
 */
class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private readonly threshold: number = 5;
  private readonly resetTimeout: number = 60000; // 1 minute

  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.state === "open") {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeout) {
        this.state = "half-open";
        this.failures = 0;
      } else {
        throw new Error("Circuit breaker is OPEN - too many failures");
      }
    }

    try {
      const result = await fn();
      if (this.state === "half-open") {
        this.state = "closed";
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.threshold) {
        this.state = "open";
      }

      throw error;
    }
  }

  getState(): string {
    return this.state;
  }
}

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

    // Strict JSON schema prompt
    const systemPrompt = `
You are a Senior QA Engineer. Analyze these Playwright test failures.
Do not invent facts. Use only evidence in payload.
Every hypothesis must cite evidence references (testId, errorSnippet, telemetryWindow).

IMPORTANT: The payload includes "flakiness_analysis" - these are algorithmic findings from 
deterministic pattern detection (race conditions, timing issues, etc.). Your task:
1. Review "algorithmicFindings" for each flaky test.
2. CONFIRM or REFUTE each finding based on actual test data evidence.
3. ENHANCE with context (why it happens) and additional causes the algorithm missed.
4. If a finding is refuted, explain why and provide a better hypothesis.

Return ONLY valid JSON matching this schema:
{
  "pm_summary": "string max 800 chars",
  "triage_verdict": "infra|app|test|unknown",
  "top_findings": [{"title": "string", "confidence": "high|medium|low", "evidence": ["string"]}],
  "root_cause_hypotheses": [{"hypothesis": "string", "confidence": "high|medium|low", "evidence": ["string"], "why_not_others": "string", "next_experiments": ["string"]}],
  "recommended_fixes": [{"area": "selectors|waits|data|env|network|infra|unknown", "steps": ["string"], "expected_impact": "string", "risk": "low|medium|high"}],
  "os_diff_notes": "string",
  "telemetry_notes": "string",
  "algorithmic_findings_review": [{
    "test_id": "string",
    "finding_type": "string",
    "ai_verdict": "confirmed|refuted|partially-confirmed|uncertain",
    "ai_confidence": "high|medium|low",
    "ai_reasoning": "string explaining why you agree/disagree",
    "ai_enhancement": "optional string with additional context or fixes"
  }]
}`;

    const body = {
      model: this.config.model,
      messages: [
        { role: "system", content: systemPrompt },
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
