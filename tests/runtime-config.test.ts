import * as fs from "fs";
import * as path from "path";
import { CAPS, THRESHOLDS } from "../src/types";
import { REPORTER_VERSION } from "../src/version";

describe("runtime configuration", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reads env-backed caps lazily (after module import, e.g. from .env)", () => {
    process.env = { ...originalEnv, PW_ORACLE_HISTORY_DAYS: "14" };
    expect(CAPS.HISTORY_WINDOW_DAYS).toBe(14);
    process.env = { ...originalEnv, PW_ORACLE_HISTORY_DAYS: "nonsense" };
    expect(CAPS.HISTORY_WINDOW_DAYS).toBe(7);
    process.env = { ...originalEnv, PW_ORACLE_HISTORY_DAYS: "0" };
    expect(CAPS.HISTORY_WINDOW_DAYS).toBe(7);
  });

  it("reads thresholds lazily and falls back to defaults for invalid values", () => {
    process.env = { ...originalEnv, PW_ORACLE_THRESHOLD_LOAD1: "8.5" };
    expect(THRESHOLDS.LOAD1).toBe(8.5);
    process.env = { ...originalEnv, PW_ORACLE_THRESHOLD_LOAD1: "high" };
    expect(THRESHOLDS.LOAD1).toBe(4);
    process.env = { ...originalEnv };
    delete process.env.PW_ORACLE_THRESHOLD_STEAL;
    expect(THRESHOLDS.STEAL_PCT).toBe(10);
  });

  it("keeps REPORTER_VERSION in sync with package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    ) as { version: string };
    expect(REPORTER_VERSION).toBe(pkg.version);
  });
});
