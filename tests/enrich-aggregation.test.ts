/**
 * Aggregation of per-test AI analyses into one run-level response.
 */

import { ClaudeEnricher } from "../src/ai/claude/enrich";
import { OpenAIEnricher } from "../src/ai/openai/enrich";
import type { TestSummary } from "../src/report/interfaces";

function failed(id: string): TestSummary {
  return {
    testId: id,
    title: `test ${id}`,
    file: "a.spec.ts",
    line: 1,
    column: 1,
    status: "failed",
    duration: 1,
    startTime: 0,
    retries: 0,
    attachments: [],
    error: { message: "boom" },
  };
}

function analysis(n: number, verdict: string) {
  return {
    pm_summary: `summary ${String(n)}`,
    triage_verdict: verdict,
    top_findings: [
      { title: n === 1 ? "dup" : `finding ${String(n)}`, confidence: "high", evidence: [] },
    ],
    root_cause_hypotheses: [
      {
        hypothesis: "shared hypothesis",
        confidence: "medium",
        evidence: [],
        why_not_others: "",
        next_experiments: [],
      },
    ],
    recommended_fixes: [{ area: "waits", steps: ["same step"], expected_impact: "x", risk: "low" }],
    os_diff_notes: n === 2 ? "" : `os ${String(n)}`,
    telemetry_notes: `tel ${String(n)}`,
    algorithmic_findings_review: [
      {
        test_id: `t${String(n)}`,
        finding_type: "flaky",
        ai_verdict: "confirmed",
        ai_confidence: "high",
        ai_reasoning: "r",
      },
    ],
  };
}

const ctx = (count: number) => ({
  run: {
    startTime: "",
    duration: 1,
    totalTests: count,
    passed: 0,
    failed: count,
    skipped: 0,
    flaky: 0,
  },
  tests: Array.from({ length: count }, (_, i) => failed(`t${String(i)}`)),
  telemetry: [],
  patterns: [],
});

describe("enricher aggregation", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, PW_ORACLE_CLAUDE_CONCURRENCY: "1" };
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockSequence(bodies: unknown[], wrap: (b: unknown) => unknown) {
    const fetchMock = jest.fn();
    for (const b of bodies) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => wrap(b),
      } as unknown as Response);
    }
    global.fetch = fetchMock as unknown as typeof fetch;
  }

  const claudeWrap = (b: unknown) => ({
    content: [{ type: "tool_use", name: "record_analysis", input: b }],
  });
  const openaiWrap = (b: unknown) => ({ choices: [{ message: { content: JSON.stringify(b) } }] });

  it.each([
    ["Claude", () => new ClaudeEnricher("k"), claudeWrap],
    ["OpenAI", () => new OpenAIEnricher("k"), openaiWrap],
  ] as const)(
    "%s merges, de-duplicates and picks the majority verdict",
    async (_name, make, wrap) => {
      mockSequence([analysis(1, "app"), analysis(2, "test"), analysis(3, "test")], wrap);

      const result = await make().enrich(ctx(3));

      expect(result).not.toBeNull();
      expect(result!.pm_summary).toBe("summary 1 | summary 2 | summary 3");
      expect(result!.triage_verdict).toBe("test");
      expect(result!.top_findings.map((f) => f.title)).toEqual(["dup", "finding 2", "finding 3"]);
      expect(result!.root_cause_hypotheses).toHaveLength(1);
      expect(result!.recommended_fixes).toHaveLength(1);
      expect(result!.os_diff_notes).toBe("os 1 | os 3");
      expect(result!.telemetry_notes).toBe("tel 1 | tel 2 | tel 3");
      expect(result!.algorithmic_findings_review).toHaveLength(3);
    },
  );

  it.each([
    ["Claude", () => new ClaudeEnricher("k")],
    ["OpenAI", () => new OpenAIEnricher("k")],
  ] as const)(
    "%s returns null and reports nothing analysed when there are no failures",
    async (_n, make) => {
      global.fetch = jest.fn() as unknown as typeof fetch;
      const enricher = make();
      const result = await enricher.enrich({ ...ctx(0), tests: [] });
      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(enricher.getPartialResults()).toEqual({
        response: null,
        analyzedCount: 0,
        totalCount: 0,
      });
    },
  );

  it("skips tests whose payload exceeds the input limit", async () => {
    process.env.PW_ORACLE_OPENAI_MAX_INPUT_CHARS = "10";
    global.fetch = jest.fn() as unknown as typeof fetch;
    const result = await new OpenAIEnricher("k").enrich(ctx(2));
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("stops scheduling at the soft deadline of the time budget", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    // A budget at or below the 2s safety margin leaves no time to start any request.
    const result = await new ClaudeEnricher("k").enrich(ctx(3), { budgetMs: 1000 });
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("analyses flaky tests via their last failed attempt", async () => {
    mockSequence([analysis(1, "test")], claudeWrap);
    const flaky: TestSummary = {
      ...failed("f"),
      status: "passed",
      retries: 1,
      error: undefined,
      previousAttempts: [
        {
          retry: 0,
          status: "failed",
          duration: 3,
          startTime: 0,
          error: { message: "first try" },
          attachments: [],
        },
      ],
    };

    const result = await new ClaudeEnricher("k").enrich({ ...ctx(0), tests: [flaky] });

    expect(result).not.toBeNull();
    const body = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body)) as {
      messages: Array<{ content: string }>;
    };
    const payload = JSON.parse(body.messages[0].content) as {
      test: { status: string; error: string };
    };
    expect(payload.test.status).toBe("flaky");
    expect(payload.test.error).toBe("first try");
  });
});
