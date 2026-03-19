/**
 * Unit tests for optional dotenv loading.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("loadDotenvIfAvailable", () => {
  const originalCwd = process.cwd();
  const originalEnv = process.env;

  let tempDir = "";

  beforeEach(() => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-oracle-env-"));
    process.chdir(tempDir);
    process.env = { ...originalEnv };
    process.env.DOTENV_CONFIG_QUIET = "true";
    delete process.env.OPENAI_API_KEY;
    delete process.env.PW_ORACLE_AI_MODE;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads environment variables from a local .env file", () => {
    fs.writeFileSync(
      path.join(tempDir, ".env"),
      "OPENAI_API_KEY=sk-test-key\nPW_ORACLE_AI_MODE=openai\n",
      "utf-8",
    );

    const { loadDotenvIfAvailable } = require("../src/common/env");

    expect(loadDotenvIfAvailable()).toBe(true);
    expect(process.env.OPENAI_API_KEY).toBe("sk-test-key");
    expect(process.env.PW_ORACLE_AI_MODE).toBe("openai");
  });
});
