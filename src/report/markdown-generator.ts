/**
 * Markdown Report Generator - produces AI analysis markdown summaries
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * @module report/markdown-generator
 */

import type { IMarkdownReportGenerator, ReportContext } from "./interfaces";
import type { AIResponse } from "../ai/types";

/**
 * Generates a markdown summary of the AI analysis,
 * including executive summary, root cause hypotheses, and recommended fixes.
 */
export class MarkdownReportGenerator implements IMarkdownReportGenerator {
  /**
   * Generate a complete markdown report from the report context.
   *
   * @param context - Aggregated report data
   * @returns The markdown string
   */
  async generate(context: ReportContext): Promise<string> {
    const { aiResponse, runSummary, patterns } = context;

    if (!aiResponse) {
      return "";
    }

    return this.buildMarkdown(aiResponse, runSummary.failed, runSummary.flaky, patterns);
  }

  private buildMarkdown(
    ai: AIResponse,
    failedCount: number,
    flakyCount: number,
    patterns: ReportContext["patterns"],
  ): string {
    let md = `# 🧠 AI Root Cause Analysis\n\n`;
    md += `**Generated**: ${new Date().toISOString()}\n`;
    md += `**Status**: ${failedCount} Failed, ${flakyCount} Flaky\n\n`;

    md += `## 📋 Executive Summary\n\n`;
    md += `${ai.pm_summary}\n\n`;

    if (ai.root_cause_hypotheses.length > 0) {
      md += `## 🔍 Root Cause Hypotheses\n\n`;
      ai.root_cause_hypotheses.forEach((h, i) => {
        md += `### ${i + 1}. ${h.hypothesis}\n`;
        md += `- **Confidence**: ${h.confidence.toUpperCase()}\n`;
        md += `- **Evidence**: ${h.evidence.join(", ")}\n`;
        md += `- **Next Experiments**:\n${h.next_experiments.map((e) => `  - ${e}`).join("\n")}\n\n`;
      });
    }

    if (ai.algorithmic_findings_review && ai.algorithmic_findings_review.length > 0) {
      md += `## 🤖 Algorithmic Analysis Review\n\n`;
      ai.algorithmic_findings_review.forEach((review) => {
        const icon =
          review.ai_verdict === "confirmed" ? "✅" : review.ai_verdict === "refuted" ? "❌" : "⚠️";
        md += `### ${icon} ${review.finding_type} (${review.ai_verdict.toUpperCase()})\n`;
        md += `**Test ID**: \`${review.test_id}\`\n\n`;
        md += `**Reasoning**: ${review.ai_reasoning}\n\n`;
        if (review.ai_enhancement) {
          md += `**💡 Enhancement**: ${review.ai_enhancement}\n\n`;
        }
      });
    }

    if (ai.recommended_fixes.length > 0) {
      md += `## 🛠️ Recommended Fixes\n\n`;
      ai.recommended_fixes.forEach((fix) => {
        md += `### Area: ${fix.area}\n`;
        md += `${fix.steps.map((s) => `- ${s}`).join("\n")}\n`;
        md += `**Impact**: ${fix.expected_impact}\n\n`;
      });
    }

    return md;
  }
}
