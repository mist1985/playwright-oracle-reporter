/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import * as crypto from "crypto";
import { NormalizedError, CAPS } from "../../types";

/**
 * Signature generator for deterministic error grouping.
 * Enterprise principle: stable, reproducible, capped.
 */
export class SignatureGenerator {
  /**
   * Normalize error message and stack to remove volatile tokens.
   */
  static normalize(message: string | null, stack: string | null): string {
    let combined = (message ?? "") + "\n" + (stack ?? "");

    // Cap total length
    if (combined.length > CAPS.MAX_STACK_LENGTH) {
      combined = combined.substring(0, CAPS.MAX_STACK_LENGTH);
    }

    // Remove ANSI codes
    combined = combined.replace(/\x1b\[[0-9;]*m/g, "");

    // Remove UUIDs
    combined = combined.replace(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
      "<UUID>",
    );

    // Remove long hex hashes (24+ chars)
    combined = combined.replace(/[0-9a-fA-F]{24,}/g, "<HASH>");

    // Remove timestamps/durations
    combined = combined.replace(/\d+ms/g, "<DUR>ms");
    combined = combined.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, "<TIME>");

    // Remove line/column numbers
    combined = combined.replace(/:\d+:\d+/g, ":L:C");

    // Remove absolute paths (macOS)
    combined = combined.replace(/\/Users\/[^\/\s]+/g, "~");
    // Remove absolute paths (Linux)
    combined = combined.replace(/\/home\/[^\/\s]+/g, "~");
    // Remove temp paths
    combined = combined.replace(/\/var\/folders\/[^\s]+/g, "<TEMP>");
    combined = combined.replace(/\/tmp\/[^\s]+/g, "<TEMP>");

    // Remove session/request IDs
    combined = combined.replace(/session[_-]?id[=:][^\s]+/gi, "session_id=<ID>");
    combined = combined.replace(/request[_-]?id[=:][^\s]+/gi, "request_id=<ID>");

    return combined.trim();
  }

  /**
   * Generate stable 8-char hash from normalized signature.
   */
  static hash(normalized: string): string {
    return crypto.createHash("sha256").update(normalized).digest("hex").substring(0, 8);
  }

  /**
   * Extract snippet lines from error for evidence.
   */
  static extractSnippetLines(message: string | null, stack: string | null): string[] {
    const combined = (message ?? "") + "\n" + (stack ?? "");
    const lines = combined.split("\n").filter((l) => l.trim().length > 0);
    return lines.slice(0, CAPS.MAX_SNIPPET_LINES);
  }

  /**
   * Full normalization producing NormalizedError.
   */
  static normalizeError(message: string | null, stack: string | null): NormalizedError {
    const signature = this.normalize(message, stack);
    return {
      signature,
      signatureHash: this.hash(signature),
      snippetLines: this.extractSnippetLines(message, stack),
    };
  }
}
