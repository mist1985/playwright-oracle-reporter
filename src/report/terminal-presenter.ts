/**
 * Terminal Presenter - console output formatting for the reporter
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * @module report/terminal-presenter
 */

import * as fs from "fs";
import * as path from "path";
import type { ITerminalPresenter, TestSummary, RunSummary } from "./interfaces";
import type { PatternOutput } from "../types";
import type { AIResponse } from "../ai/types";
import { getAttachmentIcon } from "./html-utils";

/**
 * Handles all console/terminal output for the reporter.
 * Produces coloured, formatted output with clickable links in supported terminals.
 */
export class TerminalPresenter implements ITerminalPresenter {
  printBanner(): void {
    this.safeLog("\n🔮 \x1b[1m\x1b[36mPlaywright Oracle Reporter\x1b[0m\n");
  }

  printTestStart(index: number, total: number, file: string, line: number, title: string): void {
    const relativeFile = path.relative(process.cwd(), file);
    this.safeLog(`  \x1b[2m[${index}/${total}]\x1b[0m ${relativeFile}:${line} › ${title}`);
  }

  printTestStep(title: string): void {
    this.safeLog(`  - ${title}`);
  }

  printTestFailure(test: TestSummary): void {
    this.safeLog("");
    this.safeLog(`  ❌ ${test.title}`);
    this.safeLog(
      `     ${this.createTerminalLink(test.file, `${path.relative(process.cwd(), test.file)}:${test.line}`)}`,
    );

    if (test.attachments.length > 0) {
      this.safeLog("");
      for (const attachment of test.attachments) {
        if (attachment.path) {
          const icon = getAttachmentIcon(attachment.name, attachment.contentType);
          const label = attachment.name || path.basename(attachment.path);
          const link = this.createTerminalLink(attachment.path, attachment.path);
          this.safeLog(`     ${icon} ${label}: ${link}`);
        }
      }
    }
    this.safeLog("");
  }

  printSummary(runSummary: RunSummary, reportPath: string): void {
    this.safeLog("\n" + "─".repeat(60));
    this.safeLog("\n✨ \x1b[1m\x1b[34mPlaywright Oracle Reporter\x1b[0m");
    this.safeLog(`   \x1b[36mOpening report:\x1b[0m ${reportPath}`);

    const failedColor = runSummary.failed > 0 ? "\x1b[31m" : "\x1b[90m";
    const passedColor = runSummary.passed > 0 ? "\x1b[32m" : "\x1b[90m";
    const flakyColor = runSummary.flaky > 0 ? "\x1b[33m" : "\x1b[90m";

    this.safeLog(
      `   ${failedColor}✗ ${runSummary.failed} failed\x1b[0m  │  ${passedColor}✓ ${runSummary.passed} passed\x1b[0m  │  ${flakyColor}⚠ ${runSummary.flaky} flaky\x1b[0m`,
    );
    this.safeLog("\n" + "─".repeat(60) + "\n");
  }

  printFlakinessAnalysis(patterns: PatternOutput, aiResponse: AIResponse | null): void {
    if (!patterns.flakyTests || patterns.flakyTests.length === 0) return;

    this.safeLog("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    this.safeLog("🔄 Advanced Flakiness Analysis");
    this.safeLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    patterns.flakyTests.slice(0, 5).forEach((test, index) => {
      this.safeLog(`${index + 1}. 🧪 ${test.testId.split("-")[0]}...`);
      this.safeLog(
        `   Flake Rate: ${(test.flakeRate * 100).toFixed(0)}% (${test.recentStatuses.join(", ")})`,
      );

      if (test.rootCauses && test.rootCauses.length > 0) {
        this.safeLog("\n   🔍 Root Cause Analysis:");

        test.rootCauses.forEach((rc) => {
          const confidenceColor = rc.confidence > 80 ? "🟢" : rc.confidence > 50 ? "🟡" : "🔴";
          this.safeLog(
            `\n   ${confidenceColor} ${rc.type.toUpperCase()} (${rc.confidence}% confidence)`,
          );
          this.safeLog(`   Algorithmic Finding: ${rc.description}`);
          if (rc.evidence.value) {
            this.safeLog(`   Evidence: ${rc.evidence.metric}: ${rc.evidence.value}`);
          }

          if (aiResponse?.algorithmic_findings_review) {
            const review = aiResponse.algorithmic_findings_review.find(
              (r) => r.test_id === test.testId && r.finding_type === rc.type,
            );

            if (review) {
              const verdictIcon =
                review.ai_verdict === "confirmed"
                  ? "✅"
                  : review.ai_verdict === "refuted"
                    ? "❌"
                    : "⚠️";
              this.safeLog(
                `\n   ${verdictIcon} AI ${review.ai_verdict.toUpperCase()} (${review.ai_confidence} confidence)`,
              );
              this.safeLog(`   AI Reasoning: ${review.ai_reasoning}`);
              if (review.ai_enhancement) {
                this.safeLog(`   AI Enhancement: ${review.ai_enhancement}`);
              }
            }
          }
        });
      }

      if (test.suggestedFixes && test.suggestedFixes.length > 0) {
        this.safeLog("\n   💡 Suggested Fixes:");
        test.suggestedFixes.forEach((fix) => {
          this.safeLog(`\n   ▸ ${fix.description}`);
          if (fix.codeExample) {
            this.safeLog("     " + fix.codeExample.split("\n").join("\n     "));
          }
          this.safeLog(`     Impact: ${fix.expectedImpact} (Risk: ${fix.risk})`);
        });
      }
      this.safeLog("");
    });

    this.safeLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }

  printFailedTestsArtifacts(tests: ReadonlyArray<TestSummary>): void {
    const failedTests = tests.filter((t) => t.status === "failed" || t.status === "timedOut");

    if (failedTests.length === 0) return;

    this.safeLog("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    this.safeLog("📋 Failed Tests - Quick Access to Artifacts");
    this.safeLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    failedTests.forEach((test, index) => {
      this.safeLog(`${index + 1}. ❌ ${test.title}`);
      this.safeLog(
        `   📄 ${this.createTerminalLink(test.file, `${path.relative(process.cwd(), test.file)}:${test.line}`)}`,
      );

      const hasArtifacts = test.attachments.some((a) => a.path);
      if (hasArtifacts) {
        this.safeLog("   Artifacts:");
        test.attachments.forEach((attachment) => {
          if (attachment.path) {
            const icon = getAttachmentIcon(attachment.name, attachment.contentType);
            const label = attachment.name || path.basename(attachment.path);
            const link = this.createTerminalLink(attachment.path, attachment.path);
            this.safeLog(`   ${icon} ${label}: ${link}`);
          }
        });
      }
      this.safeLog("");
    });

    this.safeLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }

  /**
   * Safely log to console. Never throws.
   */
  private safeLog(message: string): void {
    try {
      console.log(message);
    } catch {
      // Silent failure - never break Playwright
    }
  }

  /**
   * Creates clickable terminal hyperlinks using OSC 8 escape sequences.
   */
  private createTerminalLink(filepath: string, label: string): string {
    try {
      const absolutePath = path.isAbsolute(filepath)
        ? filepath
        : path.resolve(process.cwd(), filepath);

      if (!fs.existsSync(absolutePath)) return label;

      const fileUrl = `file://${absolutePath}`;
      return `\x1b]8;;${fileUrl}\x1b\\${label}\x1b]8;;\x1b\\`;
    } catch {
      return label;
    }
  }
}
