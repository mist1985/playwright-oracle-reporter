/**
 * End-to-end tests for the reporter lifecycle (onBegin → onTestEnd → onEnd).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

// Telemetry spawns OS commands; it is covered by its own tests.
jest.mock("../src/telemetry/sampler", () => ({
  TelemetrySampler: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(() => []),
  })),
}));

import PlaywrightOracleReporter from "../src/index";
import type { TestSummary, RunSummary } from "../src/report/interfaces";

const TEST_FILE = "/repo/tests/example.spec.ts";

function makeTest(id: string, title: string, project = "chromium"): TestCase {
  return {
    id,
    title,
    location: { file: TEST_FILE, line: 10, column: 5 },
    parent: { project: () => ({ name: project }) },
  } as unknown as TestCase;
}

function makeResult(
  status: TestResult["status"],
  retry = 0,
  extra: Partial<TestResult> = {},
): TestResult {
  return {
    status,
    retry,
    duration: 100 + retry,
    startTime: new Date(1_700_000_000_000 + retry * 1000),
    attachments: [],
    errors: [],
    steps: [],
    stdout: [],
    stderr: [],
    workerIndex: 0,
    parallelIndex: 0,
    annotations: [],
    ...(status === "failed" || status === "timedOut"
      ? { error: { message: `boom on attempt ${String(retry)}`, stack: "Error: boom\n    at x" } }
      : {}),
    ...extra,
  } as TestResult;
}

function makeSuite(count: number): Suite {
  return { allTests: () => new Array<TestCase>(count) } as unknown as Suite;
}

function readJson<T>(dir: string, rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dir, rel), "utf-8")) as T;
}

describe("PlaywrightOracleReporter", () => {
  let outputDir: string;
  let historyDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pw-oracle-reporter-"));
    outputDir = path.join(root, "report");
    historyDir = path.join(root, "history");
    process.env = { ...originalEnv, PW_ORACLE_OPEN_REPORT: "false" };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PW_ORACLE_OUTPUT_DIR;
    delete process.env.PW_ORACLE_HISTORY_DIR;
    delete process.env.PW_ORACLE_AI_MODE;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    fs.rmSync(path.dirname(outputDir), { recursive: true, force: true });
  });

  function createReporter() {
    return new PlaywrightOracleReporter({
      outputDir,
      historyDir,
      openReport: false,
      aiMode: "off",
    });
  }

  it("folds retries into one test and counts flaky tests correctly", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(4));

    const stable = makeTest("t-pass", "passes");
    const flaky = makeTest("t-flaky", "flaky");
    const broken = makeTest("t-broken", "broken");
    const skipped = makeTest("t-skip", "skipped");

    reporter.onTestEnd(stable, makeResult("passed"));
    reporter.onTestEnd(flaky, makeResult("failed", 0));
    reporter.onTestEnd(broken, makeResult("failed", 0));
    reporter.onTestEnd(flaky, makeResult("passed", 1));
    reporter.onTestEnd(broken, makeResult("timedOut", 1));
    reporter.onTestEnd(broken, makeResult("failed", 2));
    reporter.onTestEnd(skipped, makeResult("skipped"));

    await reporter.onEnd({ status: "failed" } as FullResult);

    const run = readJson<RunSummary>(outputDir, "data/run.json");
    expect(run).toMatchObject({
      totalTests: 4,
      passed: 2,
      failed: 1,
      skipped: 1,
      flaky: 1,
      status: "failed",
    });

    const tests = readJson<TestSummary[]>(outputDir, "data/tests.json");
    expect(tests.map((t) => t.testId)).toEqual(["t-pass", "t-flaky", "t-broken", "t-skip"]);

    const flakyEntry = tests.find((t) => t.testId === "t-flaky")!;
    expect(flakyEntry.status).toBe("passed");
    expect(flakyEntry.retries).toBe(1);
    expect(flakyEntry.projectName).toBe("chromium");
    expect(flakyEntry.previousAttempts).toHaveLength(1);
    expect(flakyEntry.previousAttempts![0]).toMatchObject({
      retry: 0,
      status: "failed",
      error: { message: "boom on attempt 0" },
    });

    const brokenEntry = tests.find((t) => t.testId === "t-broken")!;
    expect(brokenEntry.status).toBe("failed");
    expect(brokenEntry.error?.message).toBe("boom on attempt 2");
    expect(brokenEntry.previousAttempts!.map((a) => a.status)).toEqual(["failed", "timedOut"]);

    const stableEntry = tests.find((t) => t.testId === "t-pass")!;
    expect(stableEntry.previousAttempts).toBeUndefined();
  });

  it("marks flaky cards in the HTML report so the Flaky filter works", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(2));
    reporter.onTestEnd(makeTest("a", "flaky one"), makeResult("failed", 0));
    reporter.onTestEnd(makeTest("a", "flaky one"), makeResult("passed", 1));
    reporter.onTestEnd(makeTest("b", "stable one"), makeResult("passed", 0));
    await reporter.onEnd({ status: "passed" } as FullResult);

    const html = fs.readFileSync(path.join(outputDir, "index.html"), "utf-8");
    expect(html).toContain('data-flaky="true"');
    expect(html).toContain('data-flaky="false"');
    expect(html).toContain("card.dataset.flaky === 'true'");
  });

  it("records the final attempt in history (one record per test)", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(1));
    reporter.onTestEnd(makeTest("h", "history"), makeResult("failed", 0));
    reporter.onTestEnd(makeTest("h", "history"), makeResult("passed", 1));
    await reporter.onEnd({ status: "passed" } as FullResult);

    const runsDir = path.join(historyDir, "runs");
    const [file] = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
    const record = readJson<{ totals: Record<string, number>; tests: Record<string, unknown> }>(
      runsDir,
      file,
    );
    expect(record.totals).toEqual({ passed: 1, failed: 0, flaky: 1, skipped: 0 });
    expect(record.tests.h).toMatchObject({ status: "passed", retries: 1 });
  });

  it("captures global errors in run.json and the HTML report", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(0));
    reporter.onError({ message: "\u001b[31mSyntaxError: Unexpected token\u001b[39m" });
    await reporter.onEnd({ status: "failed" } as FullResult);

    const run = readJson<RunSummary>(outputDir, "data/run.json");
    expect(run.globalErrors).toEqual([{ message: "SyntaxError: Unexpected token" }]);

    const html = fs.readFileSync(path.join(outputDir, "index.html"), "utf-8");
    expect(html).toContain("error outside of tests");
    expect(html).toContain("SyntaxError: Unexpected token");
  });

  it("escapes HTML in the global error banner", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(0));
    reporter.onError({ message: "<img src=x onerror=alert(1)>" });
    await reporter.onEnd({ status: "failed" } as FullResult);

    const html = fs.readFileSync(path.join(outputDir, "index.html"), "utf-8");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("gives body attachments unique names across retries and duplicate names", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(1));
    const body = (text: string) => ({
      name: "log",
      contentType: "text/plain",
      body: Buffer.from(text),
    });
    const test = makeTest("att", "attachments");

    reporter.onTestEnd(
      test,
      makeResult("failed", 0, { attachments: [body("first-a"), body("first-b")] }),
    );
    reporter.onTestEnd(test, makeResult("failed", 1, { attachments: [body("second")] }));
    await reporter.onEnd({ status: "failed" } as FullResult);

    const tests = readJson<TestSummary[]>(outputDir, "data/tests.json");
    const entry = tests[0];
    const finalPath = entry.attachments[0].path;
    const firstPaths = entry.previousAttempts![0].attachments.map((a) => a.path);

    expect(firstPaths).toEqual(["artifacts/att-log.txt", "artifacts/att-log-2.txt"]);
    expect(finalPath).toBe("artifacts/att-retry1-log.txt");
    expect(fs.readFileSync(path.join(outputDir, firstPaths[0]), "utf-8")).toBe("first-a");
    expect(fs.readFileSync(path.join(outputDir, firstPaths[1]), "utf-8")).toBe("first-b");
    expect(fs.readFileSync(path.join(outputDir, finalPath), "utf-8")).toBe("second");
  });

  it("copies file attachments of each failed attempt without overwriting", async () => {
    const reporter = createReporter();
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-oracle-src-"));
    const trace0 = path.join(srcDir, "a0", "trace.zip");
    const trace1 = path.join(srcDir, "a1", "trace.zip");
    fs.mkdirSync(path.dirname(trace0));
    fs.mkdirSync(path.dirname(trace1));
    fs.writeFileSync(trace0, "attempt-0");
    fs.writeFileSync(trace1, "attempt-1");

    try {
      reporter.onBegin({} as FullConfig, makeSuite(1));
      const test = makeTest("tr", "traced");
      const trace = (p: string) => ({ name: "trace", contentType: "application/zip", path: p });
      reporter.onTestEnd(test, makeResult("failed", 0, { attachments: [trace(trace0)] }));
      reporter.onTestEnd(test, makeResult("passed", 1, { attachments: [] }));
      reporter.onTestEnd(makeTest("tr2", "traced 2"), makeResult("failed", 0));
      await reporter.onEnd({ status: "failed" } as FullResult);

      const tests = readJson<TestSummary[]>(outputDir, "data/tests.json");
      const flakyAttempt = tests[0].previousAttempts![0];
      expect(flakyAttempt.attachments[0].path).toBe("artifacts/tr-trace.zip");
      expect(fs.readFileSync(path.join(outputDir, "artifacts/tr-trace.zip"), "utf-8")).toBe(
        "attempt-0",
      );

      // Two failed attempts with the same basename land in distinct files
      const reporter2 = createReporter();
      reporter2.onBegin({} as FullConfig, makeSuite(1));
      reporter2.onTestEnd(test, makeResult("failed", 0, { attachments: [trace(trace0)] }));
      reporter2.onTestEnd(test, makeResult("failed", 1, { attachments: [trace(trace1)] }));
      await reporter2.onEnd({ status: "failed" } as FullResult);

      const tests2 = readJson<TestSummary[]>(outputDir, "data/tests.json");
      expect(tests2[0].attachments[0].path).toBe("artifacts/tr-retry1-trace.zip");
      expect(tests2[0].previousAttempts![0].attachments[0].path).toBe("artifacts/tr-trace.zip");
      expect(fs.readFileSync(path.join(outputDir, "artifacts/tr-retry1-trace.zip"), "utf-8")).toBe(
        "attempt-1",
      );
      expect(fs.readFileSync(path.join(outputDir, "artifacts/tr-trace.zip"), "utf-8")).toBe(
        "attempt-0",
      );
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it("only installs process listeners during a run and removes them after onEnd", async () => {
    const before = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
      exit: process.listenerCount("exit"),
    };

    const reporter = createReporter();
    expect(process.listenerCount("SIGINT")).toBe(before.SIGINT);

    reporter.onBegin({} as FullConfig, makeSuite(0));
    expect(process.listenerCount("SIGINT")).toBe(before.SIGINT + 1);
    expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM + 1);
    expect(process.listenerCount("exit")).toBe(before.exit + 1);

    await reporter.onEnd({ status: "passed" } as FullResult);
    expect(process.listenerCount("SIGINT")).toBe(before.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM);
    expect(process.listenerCount("exit")).toBe(before.exit);
  });

  it("defers the first SIGINT to Playwright when it is listening", async () => {
    const reporter = createReporter();
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const playwrightHandler = jest.fn();
    process.on("SIGINT", playwrightHandler);

    try {
      reporter.onBegin({} as FullConfig, makeSuite(0));
      process.emit("SIGINT", "SIGINT");

      expect(playwrightHandler).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(outputDir, "data", "run.json"))).toBe(false);

      // A second Ctrl+C is a forced stop: emergency data is written and we exit.
      process.emit("SIGINT", "SIGINT");
      expect(exitSpy).toHaveBeenCalledWith(130);
      expect(fs.existsSync(path.join(outputDir, "data", "run.json"))).toBe(true);
    } finally {
      process.removeListener("SIGINT", playwrightHandler);
      await reporter.onEnd({ status: "interrupted" } as FullResult);
    }
  });

  it("handles SIGTERM before onEnd by writing emergency data and exiting with 143", async () => {
    const reporter = createReporter();
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    reporter.onBegin({} as FullConfig, makeSuite(1));
    reporter.onTestEnd(makeTest("s", "sig"), makeResult("passed"));
    process.emit("SIGTERM", "SIGTERM");

    expect(exitSpy).toHaveBeenCalledWith(143);
    const tests = readJson<TestSummary[]>(outputDir, "data/tests.json");
    expect(tests).toHaveLength(1);

    await reporter.onEnd({ status: "interrupted" } as FullResult);
  });

  it("does not write an exit diagnostic when no run was started", () => {
    const reporter = createReporter();
    expect(reporter).toBeDefined();
    process.emit("exit", 0);
    expect(fs.existsSync(path.join(outputDir, "data", "exit-diagnostic.json"))).toBe(false);
  });

  it("resets state when onBegin is called again on the same instance", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(1));
    reporter.onTestEnd(makeTest("x", "first run"), makeResult("failed"));
    await reporter.onEnd({ status: "failed" } as FullResult);

    reporter.onBegin({} as FullConfig, makeSuite(1));
    reporter.onTestEnd(makeTest("y", "second run"), makeResult("passed"));
    await reporter.onEnd({ status: "passed" } as FullResult);

    const run = readJson<RunSummary>(outputDir, "data/run.json");
    expect(run).toMatchObject({ totalTests: 1, passed: 1, failed: 0 });
    const tests = readJson<TestSummary[]>(outputDir, "data/tests.json");
    expect(tests.map((t) => t.testId)).toEqual(["y"]);
  });

  it("only moves the reported line when the error is in the test's own file", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(2));
    reporter.onTestEnd(
      makeTest("own", "own file"),
      makeResult("failed", 0, {
        error: { message: "x", location: { file: TEST_FILE, line: 42, column: 1 } },
      }),
    );
    reporter.onTestEnd(
      makeTest("helper", "helper file"),
      makeResult("failed", 0, {
        error: { message: "x", location: { file: "/repo/helpers.ts", line: 7, column: 1 } },
      }),
    );
    await reporter.onEnd({ status: "failed" } as FullResult);

    const tests = readJson<TestSummary[]>(outputDir, "data/tests.json");
    expect(tests.find((t) => t.testId === "own")!.line).toBe(42);
    expect(tests.find((t) => t.testId === "helper")!.line).toBe(10);
  });

  it("leaves no temp files behind after writing the report", async () => {
    const reporter = createReporter();
    reporter.onBegin({} as FullConfig, makeSuite(0));
    await reporter.onEnd({ status: "passed" } as FullResult);

    const leftovers = [
      ...fs.readdirSync(outputDir),
      ...fs.readdirSync(path.join(outputDir, "data")),
    ].filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("does not mutate process.env during AI enrichment", async () => {
    const reporter = new PlaywrightOracleReporter({
      outputDir,
      historyDir,
      openReport: false,
      aiMode: "rules",
    });
    reporter.onBegin({} as FullConfig, makeSuite(1));
    reporter.onTestEnd(makeTest("e", "env"), makeResult("failed"));
    await reporter.onEnd({ status: "failed" } as FullResult);

    expect(process.env.PW_ORACLE_AI_TIMEOUT_MS).toBeUndefined();
  });
});
