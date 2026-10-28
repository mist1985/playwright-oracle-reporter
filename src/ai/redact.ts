/**
 * Redaction helpers applied to every string sent to an external AI provider.
 *
 * Error messages and stack traces routinely contain credentials (API keys in
 * request URLs, bearer tokens in logged headers, passwords in connection
 * strings) and machine-specific paths. Everything leaving the machine is run
 * through these helpers first.
 *
 * @module ai/redact
 */

export const REDACTED = "[REDACTED]";

/** Ordered list of [pattern, replacement] pairs. Order matters: specific before generic. */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Credentials embedded in URLs: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${REDACTED}@`],
  // Authorization header values
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  // OpenAI / Anthropic style keys (sk-..., sk-proj-..., sk-ant-api03-...)
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]"],
  // GitHub tokens
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g, REDACTED],
  // Slack tokens
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  // AWS access key IDs
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  // Google API keys
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  // key=value / key: value pairs for well-known secret names
  [
    /\b(password|passwd|pwd|secret|client_secret|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|session[_-]?id|cookie)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    `$1$2${REDACTED}`,
  ],
];

/**
 * Remove well-known secret formats from free text.
 */
export function redactSecrets(text: string): string {
  if (!text) return "";
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Replace user home directories with `~` (macOS, Linux and Windows layouts).
 */
export function redactPaths(text: string): string {
  if (!text) return "";
  return text
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/\/home\/[^/\s]+/g, "~")
    .replace(/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+/gi, "~");
}

/** Strip ANSI colour codes. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Full redaction pipeline for free text (messages, stacks). */
export function redactText(text: string): string {
  if (!text) return "";
  return redactPaths(redactSecrets(stripAnsi(text)));
}
