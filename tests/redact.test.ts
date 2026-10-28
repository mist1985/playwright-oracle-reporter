import { redactPaths, redactSecrets, redactText } from "../src/ai/redact";
import { PayloadSanitizer } from "../src/ai/openai/sanitize";

describe("redactSecrets", () => {
  it.each([
    ["Anthropic key", "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", "sk-ant-api03"],
    ["OpenAI project key", "sk-proj-abcdefghijklmnopqrstuvwxyz0123", "abcdefghijklmnop"],
    ["legacy OpenAI key", "sk-abcdefghijklmnopqrstuvwxyz0123", "abcdefghijklmnop"],
    ["Bearer token", "Authorization: Bearer abc.def-ghi_jkl123", "abc.def-ghi_jkl123"],
    [
      "JWT",
      "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      "eyJhbGciOiJIUzI1NiJ9",
    ],
    ["URL credentials", "postgres://admin:hunter2@db.local:5432/app", "hunter2"],
    ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghij"],
    ["AWS key", "AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["password pair", 'password="hunter2"', "hunter2"],
    ["api_key pair", "api_key: 12345secret", "12345secret"],
    ["token query param", "GET https://x.test/cb?token=abc123xyz&x=1", "abc123xyz"],
  ])("redacts %s", (_label, input, secret) => {
    expect(redactSecrets(input)).not.toContain(secret);
  });

  it("does not treat syntax errors mentioning 'token' as secrets", () => {
    const msg = "SyntaxError: Unexpected token '<'";
    expect(redactSecrets(msg)).toBe(msg);
  });

  it("leaves ordinary Playwright errors untouched", () => {
    const msg =
      "locator.click: Timeout 5000ms exceeded.\nwaiting for getByRole('button', { name: 'Password' })";
    expect(redactSecrets(msg)).toBe(msg);
  });

  it("preserves URL host and scheme while removing credentials", () => {
    expect(redactSecrets("https://user:pass@example.com/x")).toBe(
      "https://[REDACTED]@example.com/x",
    );
  });
});

describe("redactPaths", () => {
  it("replaces every home directory occurrence on all platforms", () => {
    expect(redactPaths("/Users/alice/a.ts and /Users/alice/b.ts")).toBe("~/a.ts and ~/b.ts");
    expect(redactPaths("/home/bob/project/x.ts")).toBe("~/project/x.ts");
    expect(redactPaths("C:\\Users\\Carol\\repo\\x.spec.ts")).toBe("~\\repo\\x.spec.ts");
  });
});

describe("redactText", () => {
  it("strips ANSI codes before redacting", () => {
    expect(redactText("\u001b[31msk-ant-api03-abcdefghijklmnopqrstuvwxyz\u001b[39m")).toBe(
      "[REDACTED_KEY]",
    );
  });
});

describe("PayloadSanitizer redaction", () => {
  it("redacts secrets and home paths in both message and stack", () => {
    const payload = PayloadSanitizer.sanitizeSingleTest(
      {
        testId: "t",
        title: "t",
        file: "C:\\Users\\dave\\repo\\a.spec.ts",
        line: 1,
        column: 1,
        status: "failed",
        duration: 1,
        startTime: 0,
        retries: 0,
        attachments: [],
        error: {
          message: "request failed with Bearer abcdefghijklmnop",
          stack: "Error\n    at /Users/dave/repo/a.spec.ts:1:1 token=supersecretvalue",
        },
      },
      { startTime: "", duration: 0, totalTests: 1, passed: 0, failed: 1, skipped: 0, flaky: 0 },
      [],
      [],
    ) as { test: { file: string; error: string; stackTrace: string } };

    expect(payload.test.file).toBe("~\\repo\\a.spec.ts");
    expect(payload.test.error).not.toContain("abcdefghijklmnop");
    expect(payload.test.stackTrace).not.toContain("supersecretvalue");
    expect(payload.test.stackTrace).not.toContain("/Users/dave");
  });
});
