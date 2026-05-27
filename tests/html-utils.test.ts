/**
 * Unit tests for HTML utility functions
 */

import {
  escapeHtml,
  safeJsonForScript,
  getAttachmentIcon,
  getAttachmentClass,
} from "../src/report/html-utils";

describe("HTML Utilities", () => {
  describe("escapeHtml", () => {
    it("should escape ampersand", () => {
      expect(escapeHtml("A & B")).toBe("A &amp; B");
    });

    it("should escape < and >", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
      );
    });

    it("should escape double and single quotes", () => {
      expect(escapeHtml("\"hello\" & 'world'")).toBe("&quot;hello&quot; &amp; &#039;world&#039;");
    });

    it("should return unchanged string when no special chars", () => {
      expect(escapeHtml("hello world 123")).toBe("hello world 123");
    });

    it("should handle empty string", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("should handle multiple special chars in sequence", () => {
      expect(escapeHtml("<<>>&&")).toBe("&lt;&lt;&gt;&gt;&amp;&amp;");
    });
  });

  describe("safeJsonForScript", () => {
    it("should escape < to prevent </script> injection", () => {
      const result = safeJsonForScript({ title: "</script><script>alert(1)</script>" });
      expect(result).not.toContain("</script>");
      expect(result).toContain("\\u003c");
      expect(result).toContain("\\u003e");
    });

    it("should escape & characters", () => {
      const result = safeJsonForScript({ name: "AT&T" });
      expect(result).not.toContain("&T");
      expect(result).toContain("\\u0026");
    });

    it("should escape Unicode line separator U+2028", () => {
      const ls = String.fromCharCode(0x2028);
      const result = safeJsonForScript({ text: "before" + ls + "after" });
      expect(result).not.toContain(ls);
      expect(result).toContain("\\u2028");
    });

    it("should escape Unicode paragraph separator U+2029", () => {
      const ps = String.fromCharCode(0x2029);
      const result = safeJsonForScript({ text: "x" + ps + "y" });
      expect(result).not.toContain(ps);
      expect(result).toContain("\\u2029");
    });

    it("should produce parseable JSON", () => {
      const input = { title: "test <b>bold</b> & more", count: 42 };
      const raw = safeJsonForScript(input);
      const parsed = JSON.parse(raw) as typeof input;
      expect(parsed.title).toBe(input.title);
      expect(parsed.count).toBe(42);
    });

    it("should handle null and undefined-free values", () => {
      expect(() => safeJsonForScript(null)).not.toThrow();
      expect(() => safeJsonForScript([])).not.toThrow();
      expect(() => safeJsonForScript({})).not.toThrow();
    });
  });

  describe("getAttachmentIcon", () => {
    it("should return trace icon for trace file", () => {
      expect(getAttachmentIcon("trace.zip", "application/zip")).toBe("🔍");
    });

    it("should return screenshot icon for image", () => {
      expect(getAttachmentIcon("screenshot.png", "image/png")).toBe("📸");
    });

    it("should return video icon for video", () => {
      expect(getAttachmentIcon("recording.webm", "video/webm")).toBe("🎥");
    });

    it("should return generic icon for unknown type", () => {
      expect(getAttachmentIcon("data.json", "application/json")).toBe("📎");
    });

    it("should match by name even with generic content type", () => {
      expect(getAttachmentIcon("my-trace-file", "application/octet-stream")).toBe("🔍");
      expect(getAttachmentIcon("test-screenshot-1", "application/octet-stream")).toBe("📸");
      expect(getAttachmentIcon("test-video-output", "application/octet-stream")).toBe("🎥");
    });
  });

  describe("getAttachmentClass", () => {
    it("should return trace class for trace attachments", () => {
      expect(getAttachmentClass("trace.zip", "application/zip")).toBe("trace");
    });

    it("should return screenshot class for image attachments", () => {
      expect(getAttachmentClass("screenshot.png", "image/png")).toBe("screenshot");
    });

    it("should return video class for video attachments", () => {
      expect(getAttachmentClass("recording.webm", "video/webm")).toBe("video");
    });

    it("should return empty string for unknown types", () => {
      expect(getAttachmentClass("data.json", "application/json")).toBe("");
    });
  });
});
