/**
 * Artifact Copier - copies failed test artifacts into the report directory
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * @module report/artifact-copier
 */

import * as fs from "fs";
import * as path from "path";
import type { IArtifactCopier, TestSummary } from "./interfaces";
import { getLogger } from "../common/logger";

const logger = getLogger();

function isFailedStatus(status: string): boolean {
  return status === "failed" || status === "timedOut";
}

/**
 * Copies test artifacts (traces, screenshots, videos) for failed tests
 * into the report output directory so they are self-contained.
 */
export class ArtifactCopier implements IArtifactCopier {
  /**
   * Copy artifacts for failed tests into the report output directory.
   *
   * @param tests - All test summaries (only failed tests' artifacts are copied)
   * @param outputDir - Path to the report output directory
   */
  async copyArtifacts(tests: ReadonlyArray<TestSummary>, outputDir: string): Promise<void> {
    const artifactsDir = path.join(outputDir, "artifacts");
    this.ensureDir(artifactsDir);

    const counters = { copied: 0, missing: 0 };

    for (const test of tests) {
      // Final attempt: only failed tests carry their artifacts into the report
      if (isFailedStatus(test.status)) {
        this.copyAttachmentList(
          test.testId,
          test.retries,
          test.attachments,
          artifactsDir,
          counters,
        );
      }

      // Earlier failed attempts (retries): keeps flaky-test evidence (trace, screenshot)
      for (const attempt of test.previousAttempts ?? []) {
        if (!isFailedStatus(attempt.status)) continue;
        this.copyAttachmentList(
          test.testId,
          attempt.retry,
          attempt.attachments,
          artifactsDir,
          counters,
        );
      }
    }

    logger.debug("Artifact copy complete", { outputDir, artifactsDir, ...counters });
  }

  private copyAttachmentList(
    testId: string,
    retry: number,
    attachments: TestSummary["attachments"],
    artifactsDir: string,
    counters: { copied: number; missing: number },
  ): void {
    for (const attachment of attachments) {
      if (!attachment.path) {
        counters.missing++;
        continue;
      }
      // Already a relative path — body attachment was materialized directly into artifacts dir
      if (!path.isAbsolute(attachment.path)) {
        continue;
      }
      if (!fs.existsSync(attachment.path)) {
        counters.missing++;
        continue;
      }

      try {
        // Retries get their own prefix so attempt N never overwrites attempt N-1's
        // trace.zip / screenshot. Attempt 0 keeps the historical name.
        const prefix = retry > 0 ? `${testId}-retry${String(retry)}` : testId;
        const fileName = `${prefix}-${path.basename(attachment.path)}`;
        fs.copyFileSync(attachment.path, path.join(artifactsDir, fileName));
        // Update attachment path to relative for the report
        attachment.path = `artifacts/${fileName}`;
        counters.copied++;
      } catch (error: unknown) {
        logger.warn("Could not copy artifact", {
          path: attachment.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
