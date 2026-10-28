/**
 * Reliability tests for the AI provider clients and enrichers:
 * fail-fast on fatal errors, cancellation, Retry-After and the circuit breaker.
 */

import { ClaudeEnricher } from "../src/ai/claude/enrich";
import { OpenAIEnricher } from "../src/ai/openai/enrich";
import { ClaudeClient } from "../src/ai/claude/client";
import { OpenAIClient } from "../src/ai/openai/client";
import type { TestSummary } from "../src/report/interfaces";

function failedTest(id: string): TestSummary {
  return {
    testId: id,
    title: `test ${id}`,
    file: "/repo/tests/a.spec.ts",
    line: 1,
    column: 1,
    status: "failed",
    duration: 10,
    startTime: 0,
    retries: 0,
    attachments: [],
    error: { message: "boom", stack: "Error: boom" },
  };
}

function context(count: number) {
  return {
    run: {
      startTime: "2026-01-01T00:00:00.000Z",
      duration: 1,
      totalTests: count,
      passed: 0,
      failed: count,
      skipped: 0,
      flaky: 0,
    },
    tests: Array.from({ length: count }, (_, i) => failedTest(`t${String(i)}`)),
    telemetry: [],
    patterns: [],
  };
}

const validAnalysis = {
  pm_summary: "summary",
  triage_verdict: "test",
  top_findings: [],
  root_cause_hypotheses: [],
  recommended_fixes: [],
  os_diff_notes: "",
  telemetry_notes: "",
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A fetch that never settles until its signal aborts (like a hung connection). */
function hangingFetch() {
  return jest.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  });
}

describe("AI provider reliability", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PW_ORACLE_AI_TIMEOUT_MS;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("fail-fast on fatal errors", () => {
    it.each([401, 403, 404])(
      "Claude stops after HTTP %i instead of calling once per test",
      async (status) => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(status, { error: "x" }));
        process.env.PW_ORACLE_CLAUDE_CONCURRENCY = "1";

        const result = await new ClaudeEnricher("key").enrich(context(5));

        expect(result).toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
      },
    );

    it.each([401, 403, 404])(
      "OpenAI stops after HTTP %i instead of calling once per test",
      async (status) => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(status, { error: "x" }));

        const result = await new OpenAIEnricher("key").enrich(context(5));

        expect(result).toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
      },
    );

    it("keeps going after a per-request 400 (bad payload is not fatal)", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(400, { error: "bad" }))
        .mockResolvedValue(
          jsonResponse(200, { choices: [{ message: { content: JSON.stringify(validAnalysis) } }] }),
        );

      const result = await new OpenAIEnricher("key").enrich(context(3));

      expect(result).not.toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("cancellation", () => {
    it("Claude enrichment settles promptly when the signal aborts mid-request", async () => {
      global.fetch = hangingFetch() as unknown as typeof fetch;
      process.env.PW_ORACLE_CLAUDE_TIMEOUT_MS = "60000";
      const controller = new AbortController();

      const started = Date.now();
      const pending = new ClaudeEnricher("key").enrich(context(4), { signal: controller.signal });
      setTimeout(() => controller.abort(), 20);
      const result = await pending;

      expect(result).toBeNull();
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it("OpenAI enrichment stops scheduling new tests after abort", async () => {
      global.fetch = hangingFetch() as unknown as typeof fetch;
      process.env.PW_ORACLE_OPENAI_TIMEOUT_MS = "60000";
      const controller = new AbortController();

      const pending = new OpenAIEnricher("key").enrich(context(4), { signal: controller.signal });
      setTimeout(() => controller.abort(), 20);
      await pending;

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("keeps results that completed before the abort available as partial results", async () => {
      let call = 0;
      global.fetch = jest.fn((_url: string, init?: RequestInit) => {
        call++;
        if (call === 1) {
          return Promise.resolve(
            jsonResponse(200, {
              content: [{ type: "tool_use", name: "record_analysis", input: validAnalysis }],
            }),
          );
        }
        return hangingFetch()(_url, init);
      }) as unknown as typeof fetch;
      process.env.PW_ORACLE_CLAUDE_CONCURRENCY = "1";
      const controller = new AbortController();
      const enricher = new ClaudeEnricher("key");

      const pending = enricher.enrich(context(3), { signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      await pending;

      const partial = enricher.getPartialResults();
      expect(partial.analyzedCount).toBe(1);
      expect(partial.totalCount).toBe(3);
      expect(partial.response?.pm_summary).toBe("summary");
    });

    it("per-request timeout still covers a hung connection", async () => {
      global.fetch = hangingFetch() as unknown as typeof fetch;
      const client = new OpenAIClient({
        apiKey: "k",
        model: "m",
        timeoutMs: 20,
        maxTokens: 1,
        maxInputChars: 1000,
        retries: 0,
      });

      await expect(client.complete({})).resolves.toBeNull();
    });
  });

  describe("retries", () => {
    it("honours Retry-After on 429", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0" }))
        .mockResolvedValue(
          jsonResponse(200, {
            content: [{ type: "tool_use", name: "record_analysis", input: validAnalysis }],
          }),
        );
      const client = new ClaudeClient({
        apiKey: "k",
        model: "m",
        timeoutMs: 1000,
        maxTokens: 1,
        maxInputChars: 1000,
        retries: 2,
        anthropicVersion: "2023-06-01",
      });

      const started = Date.now();
      const result = await client.complete({});

      expect(result).toEqual(validAnalysis);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      // Exponential backoff would wait 2s; Retry-After: 0 retries immediately.
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it("does not sleep after the final failed attempt", async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(503, {}));
      const client = new OpenAIClient({
        apiKey: "k",
        model: "m",
        timeoutMs: 1000,
        maxTokens: 1,
        maxInputChars: 1000,
        retries: 0,
      });

      const started = Date.now();
      await expect(client.complete({})).resolves.toBeNull();
      expect(Date.now() - started).toBeLessThan(500);
    });
  });

  describe("circuit breaker", () => {
    it("opens after consecutive exhausted failures and skips remaining tests", async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(500, {}));
      process.env.PW_ORACLE_OPENAI_RETRIES = "0";

      await new OpenAIEnricher("key").enrich(context(10));

      // Threshold is 5 consecutive failures; the rest are skipped without network calls.
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });
  });

  describe("configuration parsing", () => {
    it("falls back to defaults for invalid numeric env values", async () => {
      process.env.PW_ORACLE_CLAUDE_TIMEOUT_MS = "abc";
      process.env.PW_ORACLE_CLAUDE_RETRIES = "not-a-number";
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          content: [{ type: "tool_use", name: "record_analysis", input: validAnalysis }],
        }),
      );

      // With NaN config the request would abort instantly or never be sent.
      const result = await new ClaudeEnricher("key").enrich(context(1));

      expect(result).not.toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
