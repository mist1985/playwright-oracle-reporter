/**
 * Unit tests for Claude enrichment via Anthropic's Messages API.
 */

import { ClaudeEnricher } from "../src/ai/claude/enrich";

function buildContext() {
  return {
    run: {
      startTime: "2026-04-16T10:00:00.000Z",
      endTime: "2026-04-16T10:00:10.000Z",
      duration: 10000,
      totalTests: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      flaky: 0,
    },
    tests: [
      {
        testId: "test-1",
        title: "shows the dashboard",
        file: "/Users/mihajlo/project/tests/dashboard.spec.ts",
        line: 12,
        column: 4,
        status: "failed",
        duration: 2000,
        startTime: Date.now(),
        retries: 0,
        attachments: [],
        error: {
          message: "locator.waitFor: Timeout 5000ms exceeded",
          stack:
            "locator.waitFor: Timeout 5000ms exceeded\n at tests/dashboard.spec.ts:12:4\n at step",
        },
      },
    ],
    telemetry: [],
    patterns: [],
  };
}

function buildClaudeSuccessResponse() {
  return {
    content: [
      {
        type: "tool_use",
        name: "record_analysis",
        input: {
          pm_summary: "The dashboard assertion timed out waiting for a locator.",
          triage_verdict: "test",
          top_findings: [
            {
              title: "Locator timeout",
              confidence: "high",
              evidence: ["testId:test-1", "errorSnippet:Timeout 5000ms exceeded"],
            },
          ],
          root_cause_hypotheses: [
            {
              hypothesis: "The selector is racing the UI render.",
              confidence: "high",
              evidence: ["testId:test-1"],
              why_not_others: "There is no infrastructure or network evidence in the payload.",
              next_experiments: ["Add an assertion on the preceding loading state."],
            },
          ],
          recommended_fixes: [
            {
              area: "waits",
              steps: ["Wait for the dashboard shell before asserting the widget."],
              expected_impact: "Reduce timing-related failures.",
              risk: "low",
            },
          ],
          os_diff_notes: "",
          telemetry_notes: "",
        },
      },
    ],
  };
}

describe("ClaudeEnricher", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
    process.env.PW_ORACLE_CLAUDE_RETRIES = "0";
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("calls Anthropic Messages API and validates the structured tool response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => buildClaudeSuccessResponse(),
    } as Response);

    const enricher = new ClaudeEnricher("sk-ant-api03-" + "a".repeat(40));
    const result = await enricher.enrich(buildContext());

    expect(result).not.toBeNull();
    expect(result!.pm_summary).toContain("dashboard assertion timed out");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, request] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-api-key": "sk-ant-api03-" + "a".repeat(40),
      "anthropic-version": "2023-06-01",
    });

    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_analysis" });
    expect(body.tools[0].name).toBe("record_analysis");

    const payload = JSON.parse(body.messages[0].content);
    expect(payload.tests[0].file).toBe("~/project/tests/dashboard.spec.ts");
  });

  it("returns null when Claude does not return a usable tool payload", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "not valid json" }],
      }),
    } as Response);

    const enricher = new ClaudeEnricher("sk-ant-api03-" + "b".repeat(40));
    const result = await enricher.enrich(buildContext());

    expect(result).toBeNull();
  });
});
