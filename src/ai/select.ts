/**
 * Selection of tests that are sent for AI root-cause analysis.
 *
 * @module ai/select
 */

import type { TestSummary } from "../report/interfaces";

function isFailedStatus(status: string): boolean {
  return status === "failed" || status === "timedOut";
}

/**
 * Tests worth analysing: every test whose final attempt failed, plus flaky
 * tests (passed on retry), represented by their most recent failed attempt
 * with `status: "flaky"` so the model knows the test eventually passed.
 */
export function selectTestsForAnalysis(tests: ReadonlyArray<TestSummary>): TestSummary[] {
  const selected: TestSummary[] = [];

  for (const test of tests) {
    if (isFailedStatus(test.status)) {
      selected.push(test);
      continue;
    }

    if (test.status === "passed" && test.previousAttempts?.length) {
      const lastFailed = [...test.previousAttempts]
        .reverse()
        .find((attempt) => isFailedStatus(attempt.status));
      if (lastFailed) {
        selected.push({
          ...test,
          status: "flaky",
          duration: lastFailed.duration,
          startTime: lastFailed.startTime,
          error: lastFailed.error,
          attachments: lastFailed.attachments,
          previousAttempts: undefined,
        });
      }
    }
  }

  return selected;
}
