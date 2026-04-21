/**
 * Claude-powered enrichment using Anthropic's Messages API.
 */

import type { NormalizedSystemMetrics } from "../../telemetry/collectors/common";
import type { RunSummary, TestSummary } from "../../report/interfaces";
import { PayloadSanitizer } from "../openai/sanitize";
import { SchemaValidator } from "../openai/schema";
import type { ClaudeConfig, ClaudeResponse } from "./types";
import { ClaudeClient } from "./client";
import { CONFIG_DEFAULTS, getEnvVar } from "../../common/constants";

export interface EnrichmentContext {
  run: RunSummary;
  tests: TestSummary[];
  telemetry: NormalizedSystemMetrics[];
  patterns: unknown[];
}

export class ClaudeEnricher {
  private config: ClaudeConfig;

  constructor(apiKey: string) {
    this.config = {
      apiKey,
      model: getEnvVar("CLAUDE_MODEL") ?? CONFIG_DEFAULTS.CLAUDE_MODEL,
      timeoutMs: parseInt(
        getEnvVar("CLAUDE_TIMEOUT_MS") ?? String(CONFIG_DEFAULTS.CLAUDE_TIMEOUT_MS),
        10,
      ),
      maxTokens: parseInt(
        getEnvVar("CLAUDE_MAX_TOKENS") ?? String(CONFIG_DEFAULTS.CLAUDE_MAX_TOKENS),
        10,
      ),
      maxInputChars: parseInt(
        getEnvVar("CLAUDE_MAX_INPUT_CHARS") ?? String(CONFIG_DEFAULTS.CLAUDE_MAX_INPUT_CHARS),
        10,
      ),
      retries: parseInt(getEnvVar("CLAUDE_RETRIES") ?? String(CONFIG_DEFAULTS.CLAUDE_RETRIES), 10),
      anthropicVersion: "2023-06-01",
    };
  }

  async enrich(context: EnrichmentContext): Promise<ClaudeResponse | null> {
    try {
      const payload = PayloadSanitizer.sanitize(context);
      const payloadStr = JSON.stringify(payload);

      if (payloadStr.length > this.config.maxInputChars) {
        console.warn(`PW-AI: Payload too large (${String(payloadStr.length)} chars). Skipping AI.`);
        return null;
      }

      const client = new ClaudeClient(this.config);
      const rawResult = await client.complete(payload);

      if (!rawResult) return null;

      return SchemaValidator.validate(rawResult);
    } catch {
      return null;
    }
  }
}
