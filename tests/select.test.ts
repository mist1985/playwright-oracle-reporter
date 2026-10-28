import { selectTestsForAnalysis } from "../src/ai/select";
import type { TestSummary } from "../src/report/interfaces";

function summary(overrides: Partial<TestSummary>): TestSummary {
  return {
    testId: "t",
    title: "t",
    file: "f",
    line: 1,
    column: 1,
    status: "passed",
    duration: 1,
    startTime: 0,
    retries: 0,
    attachments: [],
    ...overrides,
  };
}

describe("selectTestsForAnalysis", () => {
  it("selects failed and timed-out tests as-is", () => {
    const failed = summary({ testId: "a", status: "failed" });
    const timedOut = summary({ testId: "b", status: "timedOut" });
    expect(selectTestsForAnalysis([failed, timedOut])).toEqual([failed, timedOut]);
  });

  it("represents a flaky test by its last failed attempt", () => {
    const flaky = summary({
      testId: "f",
      status: "passed",
      retries: 2,
      previousAttempts: [
        {
          retry: 0,
          status: "failed",
          duration: 5,
          startTime: 1,
          error: { message: "first" },
          attachments: [],
        },
        {
          retry: 1,
          status: "timedOut",
          duration: 9,
          startTime: 2,
          error: { message: "second" },
          attachments: [],
        },
      ],
    });

    const [selected] = selectTestsForAnalysis([flaky]);
    expect(selected.status).toBe("flaky");
    expect(selected.error?.message).toBe("second");
    expect(selected.duration).toBe(9);
    expect(selected.previousAttempts).toBeUndefined();
  });

  it("skips passed, skipped and interrupted tests", () => {
    expect(
      selectTestsForAnalysis([
        summary({ status: "passed" }),
        summary({ status: "skipped" }),
        summary({ status: "interrupted" }),
      ]),
    ).toEqual([]);
  });
});
