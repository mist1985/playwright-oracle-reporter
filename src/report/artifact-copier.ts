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

    for (const test of tests) {
      if (test.status !== "failed" && test.status !== "timedOut") continue;

      for (const attachment of test.attachments) {
        if (!attachment.path || !fs.existsSync(attachment.path)) continue;

        try {
          const fileName = path.basename(attachment.path);
          const destPath = path.join(artifactsDir, `${test.testId}-${fileName}`);
          fs.copyFileSync(attachment.path, destPath);
          // Update attachment path to relative for the report
          attachment.path = `artifacts/${test.testId}-${fileName}`;
        } catch (error: unknown) {
          logger.warn("Could not copy artifact", {
            path: attachment.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
