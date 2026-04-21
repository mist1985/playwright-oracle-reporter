/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import * as fs from "fs";
import { CodeAnalysisFinding } from "../types";

/**
 * CodeAnalyzer
 *
 * Statically analyzes test source code to detect common anti-patterns:
 * - Missing await on async operations
 * - Hardcoded timeouts (waitForTimeout)
 * - Race conditions (action immediately followed by assertion)
 * - Anti-patterns (force: true)
 */
export class CodeAnalyzer {
  /**
   * Analyze test source code around a failing line
   *
   * @param filePath - Path to the test file
   * @param failingLine - Line number where the test failed
   * @returns Array of code analysis findings with suggestions and fixes
   */
  static async analyze(filePath: string, failingLine: number): Promise<CodeAnalysisFinding[]> {
    try {
      if (!fs.existsSync(filePath)) return [];

      const content = await fs.promises.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const findings: CodeAnalysisFinding[] = [];

      // Analyze around the failing line (+/- 5 lines)
      const start = Math.max(0, failingLine - 6);
      const end = Math.min(lines.length, failingLine + 4);
      const subLines = lines.slice(start, end);
      const context = subLines.join("\n");

      // 1. Detect missing await
      const asyncMethods = [
        "click",
        "fill",
        "press",
        "check",
        "uncheck",
        "selectOption",
        "waitForSelector",
        "waitForResponse",
        "waitForNavigation",
        "goto",
      ];

      subLines.forEach((line, idx) => {
        const trimmed = line.trim();
        asyncMethods.forEach((method) => {
          const methodCall = `page.${method}(`;
          if (
            trimmed.includes(methodCall) &&
            !trimmed.includes(`await ${methodCall}`) &&
            !trimmed.startsWith("//")
          ) {
            findings.push({
              type: "missing-await",
              line: start + idx + 1,
              snippet: trimmed,
              suggestion: `Missing await for asynchronous call: ${methodCall}`,
              fix: trimmed.replace(methodCall, `await ${methodCall}`),
            });
          }
        });
      });

      // 2. Detect hardcoded timeouts
      const timeoutMatch = context.match(/waitForTimeout\((\d+)\)/);
      if (timeoutMatch) {
        findings.push({
          type: "hardcoded-timeout",
          line: failingLine,
          snippet: timeoutMatch[0],
          suggestion:
            "Avoid hardcoded timeouts. Use explicit waits (e.g., waitForSelector, waitForResponse).",
        });
      }

      // 3. Potential Race Condition: Action followed by immediate assertion
      const nonAttrLines = subLines
        .map((l, i) => ({ text: l.trim(), originalIdx: i }))
        .filter((l) => l.text.length > 0 && !l.text.startsWith("//"));

      const actionIdx = nonAttrLines.findIndex(
        (l) =>
          (l.text.includes(".click(") || l.text.includes(".fill(") || l.text.includes(".press(")) &&
          l.text.includes("await "),
      );
      const expectIdx = nonAttrLines.findIndex(
        (l) => l.text.includes("expect(") && l.text.includes("await "),
      );

      if (
        actionIdx !== -1 &&
        expectIdx !== -1 &&
        expectIdx > actionIdx &&
        expectIdx <= actionIdx + 2
      ) {
        const actionLine = nonAttrLines[actionIdx];
        findings.push({
          type: "race-condition",
          line: start + actionLine.originalIdx + 1,
          snippet: `${actionLine.text}\n${nonAttrLines[expectIdx].text}`,
          suggestion:
            "Potential race condition. If the action triggers a network request or async state change, wait for it before asserting.",
          fix: `${actionLine.text}\n    await page.waitForLoadState('networkidle');\n    ${nonAttrLines[expectIdx].text}`,
        });
      }

      // 4. Detect anti-pattern: force: true
      subLines.forEach((line, idx) => {
        if (
          line.includes("force: true") &&
          (line.includes(".click") || line.includes(".fill") || line.includes(".check"))
        ) {
          findings.push({
            type: "anti-pattern",
            line: start + idx + 1,
            snippet: line.trim(),
            suggestion:
              "Avoid using { force: true }. It bypasses actionability checks and can hide underlying issues like elements being covered or not yet interactive.",
          });
        }
      });

      return findings;
    } catch {
      return [];
    }
  }
}
