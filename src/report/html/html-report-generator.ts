/**
 * HTML Report Generator - main class
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * @module report/html/html-report-generator
 */

import type { IHtmlReportGenerator, ReportContext, TestSummary } from "../interfaces";
import type { NormalizedSystemMetrics } from "../../telemetry/collectors/common";
import type { Finding, RulesOutput, PatternOutput, TelemetrySummaryOutput } from "../../types";
import type { OpenAIResponse } from "../../ai/openai/types";
import { escapeHtml, getAttachmentIcon, getAttachmentClass } from "../html-utils";
import { getHtmlStyles } from "./styles";
import { getClientScript } from "./client-script";

/**
 * Generates the complete self-contained HTML report.
 */
export class HtmlReportGenerator implements IHtmlReportGenerator {
  async generate(context: ReportContext): Promise<string> {
    const {
      tests,
      runSummary,
      metrics,
      analysis,
      patterns,
      telemetrySummary,
      correlations,
      openaiResponse,
      config,
    } = context;

    const { grade, gradeColor, healthScore } = this.computeHealthScore(
      runSummary.totalTests,
      runSummary.passed,
      runSummary.flaky,
    );

    return this.buildHtml({
      tests: tests as TestSummary[],
      runSummary,
      metrics: metrics as NormalizedSystemMetrics[],
      analysis,
      patterns,
      telemetrySummary,
      correlations: correlations as Finding[],
      openaiResponse,
      config,
      grade,
      gradeColor,
      healthScore,
    });
  }

  private computeHealthScore(
    total: number,
    passed: number,
    flaky: number,
  ): { grade: string; gradeColor: string; healthScore: number } {
    let healthScore = total > 0 ? (passed / total) * 100 : 100;
    healthScore -= flaky * 5;
    if (healthScore < 0) healthScore = 0;

    let grade = "F";
    let gradeColor = "var(--color-danger)";
    if (healthScore >= 95) {
      grade = "A+";
      gradeColor = "var(--color-success)";
    } else if (healthScore >= 90) {
      grade = "A";
      gradeColor = "var(--color-success)";
    } else if (healthScore >= 80) {
      grade = "B";
      gradeColor = "var(--color-info)";
    } else if (healthScore >= 70) {
      grade = "C";
      gradeColor = "var(--color-warning)";
    }

    return { grade, gradeColor, healthScore };
  }

  private buildHtml(params: {
    tests: TestSummary[];
    runSummary: ReportContext["runSummary"];
    metrics: NormalizedSystemMetrics[];
    analysis: RulesOutput | null;
    patterns: PatternOutput | null;
    telemetrySummary: TelemetrySummaryOutput | null;
    correlations: Finding[];
    openaiResponse: OpenAIResponse | null;
    config: ReportContext["config"];
    grade: string;
    gradeColor: string;
    healthScore: number;
  }): string {
    const {
      tests,
      runSummary,
      metrics,
      analysis,
      patterns,
      telemetrySummary,
      correlations,
      openaiResponse,
      config,
      grade,
      gradeColor,
      healthScore,
    } = params;

    return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playwright Oracle Report</title>
  <style>
${getHtmlStyles(gradeColor)}
  </style>
</head>
<body>
  ${this.renderSidebar(grade, healthScore)}
  <main class="main">
    <div class="content-wrapper">
      ${this.renderHeader(runSummary)}
      ${this.renderOverviewView(tests, runSummary)}
      ${this.renderTestsView(tests, runSummary)}
      ${this.renderInsightsView(openaiResponse, patterns, analysis)}
      ${this.renderTelemetryView(metrics, telemetrySummary, correlations, config)}
      ${this.renderFooter()}
    </div>
  </main>
  ${this.renderModal()}
  <script>
    const tests = ${JSON.stringify(tests)};
    const metrics = ${JSON.stringify(metrics)};
${getClientScript()}
  </script>
</body>
</html>`;
  }

  private renderSidebar(grade: string, healthScore: number): string {
    return `
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-icon">🎭</div>
      <span>Playwright Oracle Reporter</span>
    </div>
    <div class="nav-section">
      <div class="nav-section-title">Navigation</div>
      <div class="nav-item active" onclick="switchView('overview')">
        <span class="nav-icon">📊</span> Overview
      </div>
      <div class="nav-item" onclick="switchView('tests')">
        <span class="nav-icon">🧪</span> Tests
      </div>
      <div class="nav-item" onclick="switchView('insights')">
        <span class="nav-icon">🧠</span> AI Insights
      </div>
      <div class="nav-item" onclick="switchView('telemetry')">
        <span class="nav-icon">📈</span> Telemetry
      </div>
    </div>
    <div class="health-card">
      <div class="health-label">Suite Health</div>
      <div class="health-score">${grade}</div>
      <div class="health-score-value">${Math.round(healthScore)}/100</div>
    </div>
  </aside>`;
  }

  private renderHeader(runSummary: ReportContext["runSummary"]): string {
    return `
      <div class="header-bar">
        <div class="header-title">
          <h1 id="page-title">Dashboard Overview</h1>
          <div class="header-meta">
            <span class="header-meta-item">📅 ${new Date(runSummary.startTime).toLocaleString()}</span>
            <span class="header-meta-item">⏱️ ${(runSummary.duration / 1000).toFixed(2)}s</span>
            <span class="header-meta-item">🧪 ${runSummary.totalTests} tests</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn" onclick="toggleTheme()">
            <span>🌓</span> Theme
          </button>
        </div>
      </div>`;
  }

  private renderOverviewView(
    tests: TestSummary[],
    runSummary: ReportContext["runSummary"],
  ): string {
    const failedTests = tests.filter((t) => t.status === "failed" || t.status === "timedOut");

    return `
      <div id="view-overview" class="view-section active">
        <div class="grid">
          <div class="card stat-card" style="--stat-color: var(--color-danger)">
            <div class="stat-label">❌ Failed</div>
            <div class="stat-value" style="color: var(--color-danger)">${runSummary.failed}</div>
            ${runSummary.totalTests > 0 ? `<div class="stat-change">${((runSummary.failed / runSummary.totalTests) * 100).toFixed(1)}% of total</div>` : ""}
          </div>
          <div class="card stat-card" style="--stat-color: var(--color-success)">
            <div class="stat-label">✅ Passed</div>
            <div class="stat-value" style="color: var(--color-success)">${runSummary.passed}</div>
            ${runSummary.totalTests > 0 ? `<div class="stat-change positive">${((runSummary.passed / runSummary.totalTests) * 100).toFixed(1)}% of total</div>` : ""}
          </div>
          <div class="card stat-card" style="--stat-color: var(--color-flaky)">
            <div class="stat-label">⚠️ Flaky</div>
            <div class="stat-value" style="color: var(--color-flaky)">${runSummary.flaky}</div>
            ${runSummary.flaky > 0 ? '<div class="stat-change negative">Needs attention</div>' : '<div class="stat-change positive">None detected</div>'}
          </div>
          <div class="card stat-card" style="--stat-color: var(--brand-primary)">
            <div class="stat-label">📊 Total</div>
            <div class="stat-value">${runSummary.totalTests}</div>
            <div class="stat-change">${Math.round(runSummary.duration / (runSummary.totalTests || 1))}ms avg</div>
          </div>
        </div>
        ${this.renderQuickInsights(tests, runSummary)}
        ${failedTests.length > 0 ? this.renderRecentFailures(failedTests) : this.renderAllPassed()}
      </div>`;
  }

  private renderQuickInsights(
    tests: TestSummary[],
    runSummary: ReportContext["runSummary"],
  ): string {
    if (tests.length === 0) return "";
    const slowest = tests.reduce((p, c) => (c.duration > p.duration ? c : p), tests[0]);
    const flakiest = tests.reduce((p, c) => (c.retries > p.retries ? c : p), tests[0]);
    const passRate =
      runSummary.totalTests > 0
        ? ((runSummary.passed / runSummary.totalTests) * 100).toFixed(1)
        : "0";

    return `
      <div class="insights-grid">
        <div class="insight-card" style="--insight-color: var(--color-warning);">
          <div class="insight-header">
            <div>
              <div class="insight-title">🐌 Slowest Test</div>
              <div class="insight-value">${slowest.duration}ms</div>
              <div class="insight-subtitle">${escapeHtml(slowest.title.substring(0, 40))}${slowest.title.length > 40 ? "..." : ""}</div>
            </div>
            <div class="insight-icon">⏱️</div>
          </div>
        </div>
        <div class="insight-card" style="--insight-color: var(--color-flaky);">
          <div class="insight-header">
            <div>
              <div class="insight-title">⚠️ Most Retried</div>
              <div class="insight-value">${flakiest.retries}</div>
              <div class="insight-subtitle">${flakiest.retries > 0 ? escapeHtml(flakiest.title.substring(0, 40)) + (flakiest.title.length > 40 ? "..." : "") : "No retries needed"}</div>
            </div>
            <div class="insight-icon">🔄</div>
          </div>
        </div>
        <div class="insight-card" style="--insight-color: ${parseFloat(passRate) >= 90 ? "var(--color-success)" : parseFloat(passRate) >= 70 ? "var(--color-warning)" : "var(--color-danger)"};">
          <div class="insight-header">
            <div>
              <div class="insight-title">📊 Pass Rate</div>
              <div class="insight-value">${passRate}%</div>
              <div class="insight-subtitle">${runSummary.passed} of ${runSummary.totalTests} passed</div>
            </div>
            <div class="insight-icon">${parseFloat(passRate) >= 90 ? "🎯" : parseFloat(passRate) >= 70 ? "📈" : "📉"}</div>
          </div>
        </div>
      </div>`;
  }

  private renderRecentFailures(failedTests: TestSummary[]): string {
    return `
        <div class="card">
          <h2>❌ Recent Failures</h2>
          <div class="test-list">
            ${failedTests
              .slice(0, 10)
              .map(
                (t) => `
              <div class="test-card failed" onclick="openTestModal('${t.testId}')">
                <div class="test-header">
                  <div class="test-title">${escapeHtml(t.title)}</div>
                  <span class="badge badge-danger">FAILED</span>
                </div>
                <div class="test-meta">
                  <span class="test-meta-item">📄 ${escapeHtml(t.file.split("/").pop() || t.file)}</span>
                  <span class="test-meta-item">⏱️ ${t.duration}ms</span>
                  ${t.retries > 0 ? `<span class="test-meta-item">🔄 ${t.retries} retries</span>` : ""}
                </div>
              </div>
            `,
              )
              .join("")}
          </div>
          ${failedTests.length > 10 ? `<p style="text-align: center; margin-top: 1rem; color: var(--text-secondary);">Showing 10 of ${failedTests.length} failures. View all in Tests tab.</p>` : ""}
        </div>`;
  }

  private renderAllPassed(): string {
    return `
        <div class="card" style="text-align: center; padding: 3rem; background: var(--color-success-light); border: 2px solid var(--color-success);">
          <div style="font-size: 4rem; margin-bottom: 1rem;">🎉</div>
          <h2 style="color: var(--color-success); margin-bottom: 0.5rem;">All Tests Passed!</h2>
          <p style="color: var(--text-secondary);">Great job! Your test suite is healthy.</p>
        </div>`;
  }

  private renderTestsView(tests: TestSummary[], runSummary: ReportContext["runSummary"]): string {
    return `
      <div id="view-tests" class="view-section">
        <div class="filter-bar">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" id="testSearch" placeholder="Search tests..." onkeyup="filterTests()">
          </div>
          <div class="filter-group">
            <div class="filter-chip active" data-filter="all" onclick="filterByStatus('all')">All (${runSummary.totalTests})</div>
            <div class="filter-chip" data-filter="failed" onclick="filterByStatus('failed')">Failed (${runSummary.failed})</div>
            <div class="filter-chip" data-filter="passed" onclick="filterByStatus('passed')">Passed (${runSummary.passed})</div>
            ${runSummary.flaky > 0 ? `<div class="filter-chip" data-filter="flaky" onclick="filterByStatus('flaky')">Flaky (${runSummary.flaky})</div>` : ""}
          </div>
        </div>
        <div class="test-list" id="testList">
          ${tests
            .map(
              (t) => `
            <div class="test-card ${t.status === "failed" || t.status === "timedOut" ? "failed" : t.status === "passed" ? "passed" : "flaky"}" data-status="${t.status}" data-title="${escapeHtml(t.title).toLowerCase()}" onclick="openTestModal('${t.testId}')">
              <div class="test-header">
                <div class="test-title">${escapeHtml(t.title)}</div>
                <span class="badge ${t.status === "failed" || t.status === "timedOut" ? "badge-danger" : t.status === "passed" ? "badge-success" : "badge-flaky"}">${t.status.toUpperCase()}</span>
              </div>
              <div class="test-meta">
                <span class="test-meta-item">📄 ${escapeHtml(t.file.split("/").pop() || t.file)}</span>
                <span class="test-meta-item">⏱️ ${t.duration}ms</span>
                ${t.retries > 0 ? `<span class="test-meta-item">🔄 ${t.retries} ${t.retries === 1 ? "retry" : "retries"}</span>` : ""}
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>`;
  }

  private renderInsightsView(
    openaiResponse: OpenAIResponse | null,
    patterns: PatternOutput | null,
    analysis: RulesOutput | null,
  ): string {
    const openaiSection = openaiResponse
      ? this.renderOpenAISection(openaiResponse)
      : `<div class="card" style="text-align: center; padding: 3rem">
           <div style="font-size: 3rem; margin-bottom: 1rem;">🤖</div>
           <h3>No AI Analysis Available</h3>
           <p style="color: var(--text-secondary); margin-top: 0.5rem;">Set OPENAI_API_KEY environment variable to enable AI-powered insights.</p>
         </div>`;

    return `
      <div id="view-insights" class="view-section">
        ${openaiSection}
        ${this.renderPatternsSection(patterns)}
        ${analysis ? this.renderFailedTestsSection(analysis) : ""}
      </div>`;
  }

  private renderOpenAISection(data: OpenAIResponse): string {
    return `
      <div class="section">
        <h2 style="display: flex; align-items: center; gap: 0.5rem;">🤖 AI Troubleshooter</h2>
        <div class="ai-summary" style="border-left-color: var(--brand-primary); background: var(--bg-secondary);">
          <h3>🔮 Root Cause Investigation</h3>
          <p>${escapeHtml(data.pm_summary)}</p>
          ${data.triage_verdict !== "unknown" ? `<div style="margin-top: 1rem; font-weight: bold; color: var(--text-primary);">VERDICT: <span style="text-transform: uppercase;">${data.triage_verdict}</span></div>` : ""}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 1.5rem;">
          <div>
            <h3>🔍 Top Findings</h3>
            ${data.top_findings
              .map(
                (f) => `
              <div class="pattern-card" style="margin-bottom: 0.5rem; border-left: 3px solid ${f.confidence === "high" ? "var(--color-success)" : "var(--color-warning)"};">
                <h4>${escapeHtml(f.title)}</h4>
                <ul style="font-size: 0.85rem; color: var(--text-secondary); padding-left: 1.2rem;">${f.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
              </div>
            `,
              )
              .join("")}
          </div>
          <div>
            <h3>🧪 Hypotheses</h3>
            ${data.root_cause_hypotheses
              .map(
                (h) => `
              <div class="pattern-card" style="margin-bottom: 0.5rem;">
                <h4 style="color: var(--brand-primary);">${escapeHtml(h.hypothesis)}</h4>
                <p style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-primary);">${escapeHtml(h.why_not_others)}</p>
                <div style="background: var(--bg-primary); padding: 0.5rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--border-color);">
                  <strong style="color: var(--text-primary);">Next Experiments:</strong>
                  <ul style="padding-left: 1rem; margin: 0; color: var(--text-secondary);">${h.next_experiments.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
                </div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
        <div style="margin-top: 1.5rem;">
          <h3>🛠️ Recommended Fix Plan</h3>
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
            ${data.recommended_fixes
              .map(
                (fix, i) => `
              <div style="padding: 1rem; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                  <strong style="color: var(--text-primary);">STEP ${i + 1}: ${fix.area.toUpperCase()} Check</strong>
                  <span class="confidence-badge" style="background: ${fix.risk === "high" ? "rgba(239, 68, 68, 0.1)" : "var(--bg-primary)"}; color: ${fix.risk === "high" ? "var(--color-danger)" : "var(--text-secondary)"};">Risk: ${fix.risk}</span>
                </div>
                <ol style="padding-left: 1.2rem; color: var(--text-secondary); margin-bottom: 0.5rem;">${fix.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">Expected Impact: ${escapeHtml(fix.expected_impact)}</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
        ${
          data.os_diff_notes || data.telemetry_notes
            ? `
           <div style="margin-top: 1rem; padding: 1rem; background: rgba(237, 137, 54, 0.08); border-left: 4px solid var(--color-warning); font-size: 0.9rem; border-radius: 4px;">
             ${data.os_diff_notes ? `<p style="color: var(--text-primary); margin-bottom: 0.5rem;"><strong>OS Notes:</strong> ${escapeHtml(data.os_diff_notes)}</p>` : ""}
             ${data.telemetry_notes ? `<p style="color: var(--text-primary); margin: 0;"><strong>Telemetry:</strong> ${escapeHtml(data.telemetry_notes)}</p>` : ""}
           </div>`
            : ""
        }
      </div>`;
  }

  private renderPatternsSection(patterns: PatternOutput | null): string {
    if (!patterns) return "";
    const flaky = patterns.flakyTests || [];
    const slow = patterns.regressions || [];
    if (flaky.length === 0 && slow.length === 0) return "";

    return `
      <div class="section">
        <h2 style="color: var(--color-warning);">📉 History Patterns (Last 7 Days)</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
          ${
            flaky.length > 0
              ? `<div><h3>⚠️ Unstable Tests (Flaky)</h3>${flaky
                  .slice(0, 5)
                  .map(
                    (p: { testId: string; flakeRate: number }) => `
            <div class="pattern-card"><div style="display:flex; justify-content:space-between;"><strong>${escapeHtml(p.testId.slice(0, 30))}...</strong><span class="badge warning">Flake: ${(p.flakeRate * 100).toFixed(0)}%</span></div></div>
          `,
                  )
                  .join("")}</div>`
              : ""
          }
          ${
            slow.length > 0
              ? `<div><h3>🐢 Performance Regressions</h3>${slow
                  .slice(0, 5)
                  .map(
                    (r: { testId: string; avgDurationMs: number; increasePercent: number }) => `
            <div class="pattern-card"><div style="display:flex; justify-content:space-between;"><strong>${escapeHtml(r.testId.slice(0, 30))}...</strong><span class="badge error">+${r.increasePercent}% slower</span></div><div style="font-size: 0.8rem; color: #718096; margin-top: 0.2rem;">Avg Duration: ${(r.avgDurationMs / 1000).toFixed(2)}s</div></div>
          `,
                  )
                  .join("")}</div>`
              : ""
          }
        </div>
      </div>`;
  }

  private renderFailedTestsSection(analysis: RulesOutput): string {
    const failedTestIds = Object.keys(analysis.tests).filter(
      (id) => analysis.tests[id].status === "failed" || analysis.tests[id].status === "timedOut",
    );
    if (failedTestIds.length === 0) return "";

    return `
      <div class="section">
        <h2>❌ Rule-Based Analysis</h2>
        ${failedTestIds
          .map((testId) => {
            const entry = analysis.tests[testId];
            return `
            <div class="test-item failed">
              <div class="test-title">${escapeHtml(testId)}</div>
              ${entry.findings
                .map(
                  (f: Finding) => `
                <div class="cause-card">
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                    <strong style="color: var(--text-primary);">${escapeHtml(f.title)}</strong>
                    <span class="confidence-badge ${f.confidence > 0.8 ? "confidence-high" : "confidence-med"}">${(f.confidence * 100).toFixed(0)}% Confidence</span>
                  </div>
                  <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem;">${escapeHtml(f.summary)}</p>
                  ${
                    f.recommendedActions.length > 0
                      ? `
                    <div style="background: var(--bg-secondary); padding: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color);">
                      <strong style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary);">Recommended Fixes:</strong>
                      <ul style="padding-left: 1.25rem; margin: 0; font-size: 0.875rem; color: var(--text-primary);">${f.recommendedActions.map((a: string) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
                    </div>`
                      : ""
                  }
                </div>
              `,
                )
                .join("")}
            </div>`;
          })
          .join("")}
      </div>`;
  }

  private renderTelemetryView(
    metrics: NormalizedSystemMetrics[],
    telemetrySummary: TelemetrySummaryOutput | null,
    correlations: Finding[],
    config: ReportContext["config"],
  ): string {
    const insightsSection = this.renderTelemetryInsights(correlations, telemetrySummary);

    if (metrics.length === 0) {
      return `
      <div id="view-telemetry" class="view-section">
        ${insightsSection}
        <div class="card" style="text-align: center; padding: 3rem">
          <h3>No Telemetry Data</h3>
          <p style="color: var(--text-secondary);">Telemetry collection was not enabled for this test run.</p>
        </div>
      </div>`;
    }

    return `
      <div id="view-telemetry" class="view-section">
        ${insightsSection}
        <div class="grid" style="margin-top: 2rem;">
          <div class="card">
            <div class="stat-label">🔴 Peak CPU Load</div>
            <div class="stat-value" style="color: ${telemetrySummary && telemetrySummary.cpu.maxLoad1 > 4 ? "var(--color-danger)" : "var(--color-success)"}">${telemetrySummary ? telemetrySummary.cpu.maxLoad1.toFixed(2) : "0"}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">Avg: ${telemetrySummary ? telemetrySummary.cpu.avgLoad1.toFixed(2) : "0"}</div>
          </div>
          <div class="card">
            <div class="stat-label">🟣 Peak Memory</div>
            <div class="stat-value" style="color: var(--brand-primary)">${telemetrySummary ? telemetrySummary.memory.maxRssMb.toFixed(0) : "0"} MB</div>
          </div>
          <div class="card">
            <div class="stat-label">💾 Disk Free</div>
            <div class="stat-value" style="color: var(--color-info)">${telemetrySummary?.disk ? telemetrySummary.disk.minFreeGb.toFixed(1) : "N/A"} GB</div>
          </div>
          <div class="card">
            <div class="stat-label">⏱️ Duration</div>
            <div class="stat-value">${metrics.length > 1 ? ((metrics[metrics.length - 1].timestamp - metrics[0].timestamp) / 1000).toFixed(1) : "0"}s</div>
          </div>
        </div>
        <div class="card" style="margin-top: 2rem">
           <h2>🔴 CPU Load Over Time</h2>
           <div class="chart-container" style="height: 250px;"><canvas id="cpuChart"></canvas></div>
        </div>
        <div class="card" style="margin-top: 2rem">
           <h2>🟣 Memory Usage Over Time</h2>
           <div class="chart-container" style="height: 250px;"><canvas id="memoryChart"></canvas></div>
        </div>
        <div class="card" style="margin-top: 2rem">
           <h2>📋 Detailed Metrics Table</h2>
           <div style="overflow-x: auto; margin-top: 1rem;">
             <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
               <thead>
                 <tr style="border-bottom: 2px solid var(--border-color);">
                   <th style="padding: 0.75rem; text-align: left;">Date & Time</th>
                   <th style="padding: 0.75rem; text-align: right;">CPU Load</th>
                   <th style="padding: 0.75rem; text-align: right;">User%</th>
                   <th style="padding: 0.75rem; text-align: right;">System%</th>
                   <th style="padding: 0.75rem; text-align: right;">Memory MB</th>
                   <th style="padding: 0.75rem; text-align: left;">Status</th>
                 </tr>
               </thead>
               <tbody id="metricsTableBody"></tbody>
             </table>
           </div>
        </div>
      </div>`;
  }

  private renderTelemetryInsights(
    findings: Finding[],
    summary: TelemetrySummaryOutput | null,
  ): string {
    const hasCorrelations = findings.length > 0;
    const hasHighLoad = summary ? summary.cpu.maxLoad1 > 4 : false;
    const hasSteal = summary ? summary.cpu.maxStealPct > 5 : false;
    const hasPressure = summary ? summary.memory.maxPressurePct > 0 : false;
    const hasAnyIssue = summary && (hasHighLoad || hasSteal || hasPressure);

    if (!hasCorrelations && !hasAnyIssue) return "";

    return `
      <div class="section">
        <h2 style="color: var(--color-danger);">📊 System Insights & Correlations</h2>
        ${
          summary
            ? `
          <div class="pattern-card">
            <h4>System Metrics Summary</h4>
            <div style="display: flex; gap: 2rem; flex-wrap: wrap;">
               <div>🔴 CPU Max Load: <strong>${summary.cpu.maxLoad1.toFixed(2)}</strong></div>
               <div>🟣 Mem Max RSS: <strong>${summary.memory.maxRssMb.toFixed(0)} MB</strong></div>
               ${summary.disk ? `<div>💾 Disk Free: <strong>${summary.disk.minFreeGb.toFixed(2)} GB</strong></div>` : ""}
            </div>
            ${hasSteal ? `<div style="color: var(--color-danger); font-weight:bold; margin-top:0.5rem;">⚠️ High CPU Steal Detected (${summary.cpu.maxStealPct}%) - Noisy Neighbor</div>` : ""}
            ${hasPressure ? `<div style="color: var(--color-danger); font-weight:bold; margin-top:0.5rem;">⚠️ Memory Pressure Detected (${summary.memory.maxPressurePct}%)</div>` : ""}
          </div>`
            : ""
        }
        ${
          hasCorrelations
            ? `
           <h3 style="margin-top: 1.5rem;">🔗 Failure Correlations</h3>
           ${findings
             .map(
               (f) => `
             <div class="pattern-card" style="border-left: 4px solid var(--color-danger);">
               <h4>${escapeHtml(f.title)}</h4>
               <ul style="font-size: 0.9rem; color: var(--text-secondary);">${f.evidenceRefs.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
               <div style="margin-top:0.5rem; font-size:0.85rem; color: var(--brand-primary);"><strong>Action:</strong> ${f.recommendedActions.join(", ")}</div>
             </div>
           `,
             )
             .join("")}`
            : ""
        }
      </div>`;
  }

  private renderModal(): string {
    return `
  <div id="detail-modal" class="modal-overlay" onclick="closeModal(event)">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="modal-title">Test Details</h3>
        <button class="btn" onclick="document.getElementById('detail-modal').classList.remove('open')">Close</button>
      </div>
      <div class="modal-body" id="modal-body"></div>
    </div>
  </div>`;
  }

  private renderFooter(): string {
    return `
     <footer class="footer">
       <div class="footer-brand"><strong>Playwright Oracle Reporter</strong> v1.0.0</div>
       <div class="footer-copyright">© 2026 Mihajlo Stojanovski. All rights reserved.</div>
     </footer>`;
  }
}
