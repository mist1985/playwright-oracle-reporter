/**
 * Unit tests for memory monitoring
 */

import { MemoryMonitor, DataChunker, ObjectPool } from "../src/utils/memory";

describe("Memory Utilities", () => {
  describe("MemoryMonitor", () => {
    it("should get current memory stats", () => {
      const stats = MemoryMonitor.getStats();

      expect(stats.heapUsed).toBeGreaterThan(0);
      expect(stats.heapTotal).toBeGreaterThan(0);
      expect(stats.percentUsed).toBeGreaterThan(0);
      expect(stats.percentUsed).toBeLessThan(100);
      expect(stats.systemTotal).toBeGreaterThan(0);
      expect(stats.systemFree).toBeGreaterThan(0);
    });

    it("should format bytes correctly", () => {
      expect(MemoryMonitor.formatBytes(512)).toBe("512 B");
      expect(MemoryMonitor.formatBytes(1024)).toBe("1.00 KB");
      expect(MemoryMonitor.formatBytes(1024 * 1024)).toBe("1.00 MB");
      expect(MemoryMonitor.formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    });

    it("should start and stop monitoring", () => {
      const monitor = new MemoryMonitor();

      monitor.startMonitoring(100);
      expect(monitor["checkInterval"]).not.toBeNull();

      monitor.stopMonitoring();
      expect(monitor["checkInterval"]).toBeNull();
    });

    it("should collect memory samples", (done) => {
      const monitor = new MemoryMonitor();

      monitor.startMonitoring(50);

      setTimeout(() => {
        monitor.stopMonitoring();
        const summary = monitor.getSummary();

        expect(summary).not.toBeNull();
        expect(summary!.samples).toBeGreaterThan(0);
        expect(summary!.heap).toBeTruthy();
        expect(summary!.rss).toBeTruthy();

        done();
      }, 150);
    });
  });

  describe("DataChunker", () => {
    it("should chunk array into specified size", () => {
      const chunker = new DataChunker(3);
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const chunks = chunker.chunk(items);

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual([1, 2, 3]);
      expect(chunks[1]).toEqual([4, 5, 6]);
      expect(chunks[2]).toEqual([7, 8, 9]);
    });

    it("should handle remainder correctly", () => {
      const chunker = new DataChunker(3);
      const items = [1, 2, 3, 4, 5];
      const chunks = chunker.chunk(items);

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual([1, 2, 3]);
      expect(chunks[1]).toEqual([4, 5]);
    });

    it("should process chunks with callback", async () => {
      const chunker = new DataChunker(2);
      const items = [1, 2, 3, 4];
      let processedCount = 0;

      await chunker.processChunks(items, async () => {
        processedCount++;
      });

      expect(processedCount).toBe(2); // 2 chunks
    });

    it("should map chunks and collect results", async () => {
      const chunker = new DataChunker<number>(2);
      const items = [1, 2, 3, 4];

      const results = await chunker.mapChunks<number>(items, async (chunk) => {
        return chunk.map((x: any) => x * 2);
      });

      expect(results).toEqual([2, 4, 6, 8]);
    });
  });

  describe("ObjectPool", () => {
    it("should create and reuse objects", () => {
      let created = 0;
      const pool = new ObjectPool(
        () => ({ id: created++, value: 0 }),
        (obj) => {
          obj.value = 0;
        },
        2,
      );

      expect(pool.size()).toBe(2);

      const obj1 = pool.acquire();
      expect(pool.size()).toBe(1);

      obj1.value = 42;
      pool.release(obj1);
      expect(pool.size()).toBe(2);

      const obj2 = pool.acquire();
      expect(obj2.value).toBe(0); // Should be reset
    });

    it("should create new object if pool is empty", () => {
      let created = 0;
      const pool = new ObjectPool(
        () => ({ id: created++ }),
        () => {},
        0,
      );

      expect(pool.size()).toBe(0);

      const obj = pool.acquire();
      expect(obj.id).toBe(0);
      expect(pool.size()).toBe(0);
    });

    it("should clear pool", () => {
      const pool = new ObjectPool(
        () => ({}),
        () => {},
        5,
      );

      expect(pool.size()).toBe(5);
      pool.clear();
      expect(pool.size()).toBe(0);
    });
  });
});
