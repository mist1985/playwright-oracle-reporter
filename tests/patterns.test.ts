import { PatternAnalyzer } from "../src/patterns/analyze";
import type { HistoryRecord } from "../src/types";

function createRecord(
  testId: string,
  os: HistoryRecord["os"],
  status: HistoryRecord["tests"][string]["status"],
  timestamp: number,
): HistoryRecord {
  return {
    timestamp,
    runId: `${testId}-${os ?? "unknown"}-${timestamp}`,
    os,
    projectName: null,
    totals: {
      passed: status === "passed" ? 1 : 0,
      failed: status === "failed" ? 1 : 0,
      flaky: 0,
      skipped: status === "skipped" ? 1 : 0,
    },
    tests: {
      [testId]: {
        status,
        durationMs: 100,
        signatureHash: null,
        retries: 0,
        attempt: 1,
      },
    },
  };
}

describe("PatternAnalyzer", () => {
  it("surfaces Windows-specific failures in osDiffs", async () => {
    const records: HistoryRecord[] = [
      createRecord("test-1", "linux", "passed", 1),
      createRecord("test-1", "win32", "failed", 2),
    ];

    const result = await PatternAnalyzer.analyze(records);

    expect(result.osDiffs).toContainEqual({
      testId: "test-1",
      linuxStatus: "mostly passing",
      win32Status: "mostly failing",
    });
  });
});
