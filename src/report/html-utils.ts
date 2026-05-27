/**
 * HTML utility functions for safe rendering
 * Copyright (c) 2026 Mihajlo Stojanovski
 *
 * @module report/html-utils
 */

/**
 * Escape HTML special characters to prevent XSS vulnerabilities.
 *
 * @param text - Raw text to escape
 * @returns HTML-safe escaped text
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Serialize a value to JSON that is safe for embedding inside a <script> tag.
 *
 * Standard JSON.stringify can produce strings such as </script> which would
 * terminate the enclosing script block mid-document.  The five substitutions
 * below prevent that while keeping the output valid JSON — the browser's
 * JSON.parse handles these Unicode escapes transparently.
 *
 * @param value - Any JSON-serialisable value
 * @returns A string safe to place between <script> and </script>
 */
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Get an emoji icon for an attachment based on its type.
 *
 * @param name - Attachment filename
 * @param contentType - MIME type of the attachment
 * @returns Emoji representing the attachment type
 */
export function getAttachmentIcon(name: string, contentType: string): string {
  if (name.includes("trace") || contentType.includes("zip")) return "🔍";
  if (name.includes("screenshot") || contentType.includes("image")) return "📸";
  if (name.includes("video") || contentType.includes("video")) return "🎥";
  return "📎";
}

/**
 * Get a CSS class for an attachment based on its type.
 *
 * @param name - Attachment filename
 * @param contentType - MIME type of the attachment
 * @returns CSS class name for styling
 */
export function getAttachmentClass(name: string, contentType: string): string {
  if (name.includes("trace") || contentType.includes("zip")) return "trace";
  if (name.includes("screenshot") || contentType.includes("image")) return "screenshot";
  if (name.includes("video") || contentType.includes("video")) return "video";
  return "";
}
