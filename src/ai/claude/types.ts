/**
 * Claude provider types.
 */

import type { AICompletionConfig, AIResponse } from "../types";

export interface ClaudeConfig extends AICompletionConfig {
  anthropicVersion: string;
}

export type ClaudeResponse = AIResponse;
