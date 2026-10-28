import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { HistoryStore, type HistoryRecord } from "../src/history/store";

function createEntry(timestamp: number, runId: string): HistoryRecord {
  return {
    timestamp,
    runId,
    os: "linux",
    projectName: null,
    totals: {
      passed: 1,
      failed: 0,
      flaky: 0,
      skipped: 0,
    },
    tests: {},
  };
}

describe("HistoryStore", () => {
  let historyDir: string;

  beforeEach(() => {
    historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-oracle-history-"));
  });

  afterEach(() => {
    fs.rmSync(historyDir, { recursive: true, force: true });
  });

  it("stores runs as individual JSON files", async () => {
    const store = new HistoryStore(historyDir);

    await store.saveRun(createEntry(Date.now(), "run-1"));
    await store.saveRun(createEntry(Date.now() + 1, "run-2"));

    const runsDir = path.join(historyDir, "runs");
    const files = fs.readdirSync(runsDir).filter((file) => file.endsWith(".json"));

    expect(files).toHaveLength(2);

    const entries = await store.getEntries();
    expect(entries.map((entry) => entry.runId)).toEqual(["run-1", "run-2"]);
  });

  it("still reads legacy runs.jsonl history", async () => {
    const legacyEntry = createEntry(Date.now(), "legacy-run");
    fs.writeFileSync(
      path.join(historyDir, "runs.jsonl"),
      `${JSON.stringify(legacyEntry)}\n`,
      "utf-8",
    );

    const store = new HistoryStore(historyDir);
    const entries = await store.getEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.runId).toBe("legacy-run");
  });

  it("prunes expired runs by file-name timestamp without reading them", async () => {
    const store = new HistoryStore(historyDir);
    const runsDir = path.join(historyDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });

    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    // Deliberately not valid JSON: pruning must not depend on parsing it.
    fs.writeFileSync(path.join(runsDir, `${String(old)}-old.json`), "{corrupt");

    await store.saveRun(createEntry(Date.now(), "fresh"));

    const files = fs.readdirSync(runsDir);
    expect(files.some((f) => f.startsWith(String(old)))).toBe(false);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("removes orphaned temp files older than an hour but keeps recent ones", async () => {
    const store = new HistoryStore(historyDir);
    const runsDir = path.join(historyDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });

    const stale = path.join(runsDir, "1-stale.json.tmp");
    const recent = path.join(runsDir, "2-recent.json.tmp");
    fs.writeFileSync(stale, "x");
    fs.writeFileSync(recent, "x");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stale, twoHoursAgo, twoHoursAgo);

    await store.saveRun(createEntry(Date.now(), "run"));

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it("ignores run files that are not valid history records", async () => {
    const store = new HistoryStore(historyDir);
    const runsDir = path.join(historyDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, "foreign.json"), JSON.stringify({ hello: "world" }));
    fs.writeFileSync(path.join(runsDir, "null.json"), "null");

    await store.saveRun(createEntry(Date.now(), "valid"));
    const entries = await store.getEntries();

    expect(entries.map((e) => e.runId)).toEqual(["valid"]);
  });

  it("honours PW_ORACLE_HISTORY_DAYS set after module load (e.g. from .env)", async () => {
    const original = process.env.PW_ORACLE_HISTORY_DAYS;
    process.env.PW_ORACLE_HISTORY_DAYS = "30";
    try {
      const store = new HistoryStore(historyDir);
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      await store.saveRun(createEntry(tenDaysAgo, "ten-days"));
      await store.saveRun(createEntry(Date.now(), "now"));

      const entries = await store.getEntries();
      expect(entries.map((e) => e.runId)).toEqual(["ten-days", "now"]);
    } finally {
      if (original === undefined) delete process.env.PW_ORACLE_HISTORY_DAYS;
      else process.env.PW_ORACLE_HISTORY_DAYS = original;
    }
  });
});
