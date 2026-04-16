/**
 * Unit tests for HTML report generator AI empty states.
 */

import { HtmlReportGenerator } from "../src/report/html/html-report-generator";
import type { ReportContext } from "../src/report/interfaces";

function createContext(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    tests: [],
    runSummary: {
      startTime: "2026-03-19T10:00:00.000Z",
      endTime: "2026-03-19T10:01:00.000Z",
      duration: 60000,
      totalTests: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      flaky: 0,
    },
    metrics: [],
    analysis: null,
    patterns: null,
    telemetrySummary: null,
    correlations: [],
    aiResponse: null,
    config: {
      outputDir: "playwright-oracle-report",
      telemetryInterval: 3,
      aiMode: "openai",
      openaiConfigured: true,
      claudeConfigured: false,
      aiAttempted: false,
      aiProvider: null,
    },
    ...overrides,
  };
}

describe("HtmlReportGenerator", () => {
  it("explains that AI is skipped when there are no failed or flaky tests", async () => {
    const generator = new HtmlReportGenerator();

    const html = await generator.generate(createContext());

    expect(html).toContain(
      "AI analysis was skipped because there were no failed or flaky tests in this run.",
    );
  });

  it("explains when OpenAI was attempted but did not return analysis", async () => {
    const generator = new HtmlReportGenerator();

    const html = await generator.generate(
      createContext({
        runSummary: {
          startTime: "2026-03-19T10:00:00.000Z",
          endTime: "2026-03-19T10:01:00.000Z",
          duration: 60000,
          totalTests: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          flaky: 0,
        },
        config: {
          outputDir: "playwright-oracle-report",
          telemetryInterval: 3,
          aiMode: "openai",
          openaiConfigured: true,
          claudeConfigured: false,
          aiAttempted: true,
          aiProvider: "openai",
        },
      }),
    );

    expect(html).toContain(
      "OpenAI analysis was attempted, but the request failed or timed out. The report still includes rules-based findings.",
    );
  });

  it("explains how to enable Claude mode when its API key is missing", async () => {
    const generator = new HtmlReportGenerator();

    const html = await generator.generate(
      createContext({
        config: {
          outputDir: "playwright-oracle-report",
          telemetryInterval: 3,
          aiMode: "claude",
          openaiConfigured: false,
          claudeConfigured: false,
          aiAttempted: false,
          aiProvider: null,
        },
      }),
    );

    expect(html).toContain("Set ANTHROPIC_API_KEY to enable Claude-powered insights");
  });
});
