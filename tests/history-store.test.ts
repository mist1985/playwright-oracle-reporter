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
});
