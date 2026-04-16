/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import type { NormalizedSystemMetrics } from "../../telemetry/collectors/common";
import type { RunSummary, TestSummary } from "../../report/interfaces";
import { PayloadSanitizer } from "./sanitize";
import { OpenAIClient } from "./client";
import { SchemaValidator } from "./schema";
import { OpenAIResponse, OpenAIConfig } from "./types";
import { CONFIG_DEFAULTS, getEnvVar } from "../../common/constants";

export interface EnrichmentContext {
  run: RunSummary;
  tests: TestSummary[];
  telemetry: NormalizedSystemMetrics[];
  patterns: unknown[];
}

/**
 * OpenAIEnricher
 *
 * Provides AI-powered analysis and troubleshooting using OpenAI's API.
 * Sanitizes payloads, validates responses, and handles retries.
 */
export class OpenAIEnricher {
  private config: OpenAIConfig;

  /**
   * Initialize the OpenAI enricher
   *
   * @param apiKey - OpenAI API key for authentication
   */
  constructor(apiKey: string) {
    this.config = {
      apiKey,
      model: getEnvVar("OPENAI_MODEL") || CONFIG_DEFAULTS.OPENAI_MODEL,
      timeoutMs: parseInt(
        getEnvVar("OPENAI_TIMEOUT_MS") || String(CONFIG_DEFAULTS.OPENAI_TIMEOUT_MS),
        10,
      ),
      maxTokens: parseInt(
        getEnvVar("OPENAI_MAX_TOKENS") || String(CONFIG_DEFAULTS.OPENAI_MAX_TOKENS),
        10,
      ),
      maxInputChars: parseInt(
        getEnvVar("OPENAI_MAX_INPUT_CHARS") || String(CONFIG_DEFAULTS.OPENAI_MAX_INPUT_CHARS),
        10,
      ),
      retries: parseInt(getEnvVar("OPENAI_RETRIES") || String(CONFIG_DEFAULTS.OPENAI_RETRIES), 10),
    };
  }

  /**
   * Enrich test analysis with AI-powered insights
   * Sanitizes input, calls OpenAI API, validates response schema
   *
   * @param context - Test run context including tests, telemetry, and patterns
   * @returns AI-generated analysis response, or null if enrichment fails/skipped
   */
  async enrich(context: EnrichmentContext): Promise<OpenAIResponse | null> {
    try {
      // 1. Sanitize
      const payload = PayloadSanitizer.sanitize(context);

      // 2. Size Check
      const payloadStr = JSON.stringify(payload);
      if (payloadStr.length > this.config.maxInputChars) {
        // Truncate logic could go here, but for now we fallback
        console.warn(`PW-AI: Payload too large (${payloadStr.length} chars). Skipping AI.`);
        return null;
      }

      // 3. Call API
      const client = new OpenAIClient(this.config);
      const rawResult = await client.complete(payload);

      if (!rawResult) return null;

      // 4. Validate
      const validated = SchemaValidator.validate(rawResult);
      if (!validated) {
        // We could dump rawResult to a file for debug here if reporter had FS access passed in
        return null;
      }

      return validated;
    } catch (e) {
      return null;
    }
  }
}
