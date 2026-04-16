/**
 * Live Claude API test - verifies real API calls work
 */
import { ClaudeEnricher } from "./dist/ai/claude/enrich.js";

const context = {
  run: {
    startTime: "2026-04-16T10:00:00.000Z",
    endTime: "2026-04-16T10:00:10.000Z",
    duration: 10000,
    totalTests: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    flaky: 0,
  },
  tests: [
    {
      testId: "login-test",
      title: "should login successfully",
      file: "tests/auth.spec.ts",
      line: 10,
      column: 4,
      status: "failed",
      duration: 5000,
      startTime: Date.now(),
      retries: 0,
      attachments: [],
      error: {
        message: "locator.click: Timeout 5000ms exceeded waiting for element",
        stack: "locator.click: Timeout 5000ms exceeded\n at tests/auth.spec.ts:10:4",
      },
    },
  ],
  telemetry: [],
  patterns: [],
};

async function testClaudeAPI() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  console.log("🔌 Testing Claude API with real credentials...");
  console.log("📤 API Key:", apiKey.substring(0, 20) + "...");
  console.log("📋 Context: 1 failed test\n");

  try {
    const enricher = new ClaudeEnricher(apiKey);
    const start = Date.now();
    
    const result = await enricher.enrich(context);
    const elapsed = Date.now() - start;

    if (!result) {
      console.error("❌ Claude returned null (API call failed or timed out)");
      process.exit(1);
    }

    console.log("✅ SUCCESS! Claude API responded\n");
    console.log("📊 Response (took", elapsed, "ms):");
    console.log(JSON.stringify(result, null, 2));
    
    // Validate structure
    const required = ["pm_summary", "triage_verdict", "top_findings", "root_cause_hypotheses"];
    const missing = required.filter(k => !(k in result));
    
    if (missing.length > 0) {
      console.error("\n⚠️  Missing required fields:", missing);
      process.exit(1);
    }
    
    console.log("\n✅ All required fields present");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

testClaudeAPI();
