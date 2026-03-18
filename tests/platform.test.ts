import { shouldAutoOpenReport } from "../src/common/platform";

describe("shouldAutoOpenReport", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.PW_ORACLE_OPEN_REPORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to enabled outside CI", () => {
    expect(shouldAutoOpenReport()).toBe(true);
  });

  it("defaults to disabled in CI", () => {
    process.env.CI = "true";

    expect(shouldAutoOpenReport()).toBe(false);
  });

  it("allows CI override through environment variable", () => {
    process.env.CI = "true";
    process.env.PW_ORACLE_OPEN_REPORT = "true";

    expect(shouldAutoOpenReport()).toBe(true);
  });

  it("prioritizes explicit config over environment", () => {
    process.env.CI = "true";
    process.env.PW_ORACLE_OPEN_REPORT = "false";

    expect(shouldAutoOpenReport(true)).toBe(true);
  });
});
