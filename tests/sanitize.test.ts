import { PayloadSanitizer } from "../src/ai/openai/sanitize";
import type { NormalizedSystemMetrics } from "../src/telemetry/collectors/common";
import type { TestSummary, RunSummary } from "../src/report/interfaces";

const run: RunSummary = {
  startTime: "",
  duration: 1234,
  totalTests: 3,
  passed: 1,
  failed: 2,
  skipped: 0,
  flaky: 1,
};

function test(id: string, status: string, message = "boom"): TestSummary {
  return {
    testId: id,
    title: `title ${id}`,
    file: "/home/ci/repo/a.spec.ts",
    line: 1,
    column: 1,
    status,
    duration: 5,
    startTime: 0,
    retries: 0,
    attachments: [],
    error: { message, stack: "Error\n1\n2\n3\n4\n5\n6\n7" },
  };
}

function metric(load1: number, rssMb: number, pressurePct: number | null, stealPct: number | null) {
  return {
    timestamp: 0,
    os: "linux",
    cpu: {
      load1,
      load5: 0,
      load15: 0,
      stealPct,
      iowaitPct: null,
      userPct: null,
      systemPct: null,
      idlePct: null,
    },
    process: { rssMb },
    memory: { totalMb: 1, freeMb: 1, pressurePct },
    disk: { freeGb: null },
  } as NormalizedSystemMetrics;
}

const flakyPattern = {
  testId: "a",
  flakeRate: 0.4,
  failureRate: 0.2,
  recentStatuses: ["passed", "failed"],
  rootCauses: [{ type: "timing", confidence: 0.8, description: "race", evidence: ["x"] }],
  suggestedFixes: [
    { description: "wait", codeExample: "await x", expectedImpact: "high", risk: "low" },
  ],
  overallConfidence: 0.7,
};

describe("PayloadSanitizer.sanitize", () => {
  it("includes only failed tests, capped at 10, with redacted fields", () => {
    const tests = [
      test("p", "passed"),
      ...Array.from({ length: 12 }, (_, i) => test(`f${String(i)}`, i % 2 ? "timedOut" : "failed")),
    ];
    const out = PayloadSanitizer.sanitize({ run, tests, telemetry: [], patterns: [] }) as {
      tests: Array<{ file: string; snippet: string }>;
      run: Record<string, number>;
      telemetry_summary: unknown;
      flakiness_analysis: unknown;
    };

    expect(out.tests).toHaveLength(10);
    expect(out.tests[0].file).toBe("~/repo/a.spec.ts");
    expect(out.tests[0].snippet.split("\n")).toHaveLength(5);
    expect(out.run).toEqual({ duration: 1234, passed: 1, failed: 2, flaky: 1 });
    expect(out.telemetry_summary).toBeNull();
    expect(out.flakiness_analysis).toBeNull();
  });

  it("caps long error messages at 500 characters", () => {
    const out = PayloadSanitizer.sanitize({
      run,
      tests: [test("a", "failed", "x".repeat(2000))],
      telemetry: [],
      patterns: [],
    }) as { tests: Array<{ error: string }> };
    expect(out.tests[0].error).toHaveLength(500);
  });

  it("includes flaky-pattern findings for AI review and summarises telemetry", () => {
    const out = PayloadSanitizer.sanitize({
      run,
      tests: [test("a", "failed")],
      telemetry: [metric(2, 100, null, null), metric(6, 300, 12, 8)],
      patterns: [flakyPattern, { testId: "b", flakeRate: 0, failureRate: 0 }],
    }) as {
      telemetry_summary: Record<string, unknown>;
      history_patterns: unknown[];
      flakiness_analysis: {
        flaky_tests: Array<{ algorithmicFindings: { rootCauses: unknown[] } }>;
      };
    };

    expect(out.telemetry_summary).toEqual({
      samples: 2,
      cpu_max_load1: "6.00",
      cpu_avg_load1: "4.00",
      mem_max_rss_mb: "300",
      pressure_detected: true,
      cpu_steal_detected: true,
    });
    expect(out.history_patterns).toHaveLength(1);
    expect(out.flakiness_analysis.flaky_tests).toHaveLength(1);
    expect(out.flakiness_analysis.flaky_tests[0].algorithmicFindings.rootCauses).toHaveLength(1);
  });
});

describe("PayloadSanitizer.sanitizeSingleTest", () => {
  it("attaches the matching history pattern and algorithmic analysis", () => {
    const out = PayloadSanitizer.sanitizeSingleTest(
      test("a", "failed"),
      run,
      [],
      [flakyPattern],
    ) as {
      history: { flakeRate: number };
      algorithmicAnalysis: { suggestedFixes: Array<Record<string, unknown>> };
      context: { testNumber: string };
    };
    expect(out.history.flakeRate).toBe(0.4);
    expect(out.algorithmicAnalysis.suggestedFixes[0]).toEqual({
      description: "wait",
      expectedImpact: "high",
      risk: "low",
    });
    expect(out.context.testNumber).toBe("3 of 3");
  });

  it("handles tests without errors or patterns", () => {
    const t = { ...test("z", "failed"), error: undefined, file: "" };
    const out = PayloadSanitizer.sanitizeSingleTest(t, run, [], []) as {
      test: { error: string; stackTrace: string; file: string };
      history: unknown;
      algorithmicAnalysis: unknown;
    };
    expect(out.test).toMatchObject({ error: "", stackTrace: "", file: "" });
    expect(out.history).toBeNull();
    expect(out.algorithmicAnalysis).toBeNull();
  });
});
