/**
 * Performance benchmarks for Playwright Oracle Reporter
 *
 * Run with: node --expose-gc benchmarks/performance.js
 */

import { performance } from "perf_hooks";
import { MemoryMonitor, DataChunker } from "../dist/utils/memory.js";
import * as fs from "fs";

interface BenchmarkResult {
  name: string;
  duration: number;
  memoryBefore: number;
  memoryAfter: number;
  memoryDelta: number;
  opsPerSecond?: number;
}

class Benchmark {
  results: BenchmarkResult[] = [];

  async run(
    name: string,
    fn: () => Promise<void> | void,
    iterations: number = 1,
  ): Promise<BenchmarkResult> {
    // Force GC if available
    if (global.gc) {
      global.gc();
    }

    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await fn();
    }

    const end = performance.now();
    const memAfter = process.memoryUsage().heapUsed;

    const result: BenchmarkResult = {
      name,
      duration: end - start,
      memoryBefore: memBefore,
      memoryAfter: memAfter,
      memoryDelta: memAfter - memBefore,
      opsPerSecond:
        iterations > 1 ? iterations / ((end - start) / 1000) : undefined,
    };

    this.results.push(result);
    return result;
  }

  printResults(): void {
    console.log("\n📊 Performance Benchmark Results\n");
    console.log("═".repeat(80));

    this.results.forEach((result) => {
      console.log(`\n${result.name}`);
      console.log("─".repeat(80));
      console.log(`Duration:        ${result.duration.toFixed(2)}ms`);
      if (result.opsPerSecond) {
        console.log(`Ops/sec:         ${result.opsPerSecond.toFixed(0)}`);
      }
      console.log(
        `Memory Before:   ${MemoryMonitor.formatBytes(result.memoryBefore)}`,
      );
      console.log(
        `Memory After:    ${MemoryMonitor.formatBytes(result.memoryAfter)}`,
      );
      console.log(
        `Memory Delta:    ${MemoryMonitor.formatBytes(Math.abs(result.memoryDelta))} ${result.memoryDelta >= 0 ? "↑" : "↓"}`,
      );
    });

    console.log("\n" + "═".repeat(80) + "\n");
  }

  exportMarkdown(filePath: string): void {
    let md = "# Performance Benchmark Results\n\n";
    md += `Generated: ${new Date().toISOString()}\n\n`;
    md += "| Benchmark | Duration (ms) | Ops/sec | Memory Delta |\n";
    md += "|-----------|--------------|---------|-------------|\n";

    this.results.forEach((result) => {
      md += `| ${result.name} `;
      md += `| ${result.duration.toFixed(2)} `;
      md += `| ${result.opsPerSecond ? result.opsPerSecond.toFixed(0) : "N/A"} `;
      md += `| ${MemoryMonitor.formatBytes(Math.abs(result.memoryDelta))} ${result.memoryDelta >= 0 ? "↑" : "↓"} |\n`;
    });

    fs.writeFileSync(filePath, md);
    console.log(`✅ Benchmark results exported to: ${filePath}`);
  }
}

// Benchmark scenarios
async function runBenchmarks() {
  const bench = new Benchmark();

  console.log("🏃 Starting performance benchmarks...\n");

  // 1. Test data processing speed
  await bench.run(
    "Process 100 test results",
    () => {
      const tests = Array.from({ length: 100 }, (_, i) => ({
        id: `test-${i}`,
        title: `Test ${i}`,
        status: Math.random() > 0.9 ? "failed" : "passed",
        duration: Math.random() * 1000,
      }));

      const failed = tests.filter((t) => t.status === "failed");
      // Processed for benchmark
    },
    100,
  );

  // 2. Telemetry collection overhead
  await bench.run(
    "Collect 1000 telemetry samples",
    () => {
      const samples = Array.from({ length: 1000 }, (_, i) => ({
        timestamp: Date.now() + i * 1000,
        cpu: { loadAverage: Math.random() * 4 },
        memory: {
          used: Math.random() * 8 * 1024 * 1024 * 1024,
          total: 8 * 1024 * 1024 * 1024,
          percent: Math.random() * 100,
        },
      }));

      // Samples collected for benchmark
    },
    10,
  );

  // 3. Data chunking performance
  await bench.run(
    "Chunk 10,000 items (size 100)",
    async () => {
      const chunker = new DataChunker(100);
      const items = Array.from({ length: 10000 }, (_, i) => i);
      const chunks = chunker.chunk(items);
      // Chunks created for benchmark
    },
    50,
  );

  // 4. Large test suite simulation (1000 tests)
  await bench.run(
    "Process 1000 test results",
    () => {
      const tests = Array.from({ length: 1000 }, (_, i) => ({
        id: `test-${i}`,
        title: `Test ${i}`,
        status: Math.random() > 0.95 ? "failed" : "passed",
        duration: Math.random() * 5000,
        error:
          Math.random() > 0.95
            ? { message: "Test failed", stack: "Error at line 123" }
            : undefined,
      }));

      const failed = tests.filter((t) => t.status === "failed");
      const avgDuration =
        tests.reduce((sum, t) => sum + t.duration, 0) / tests.length;

      // Processed for benchmark
    },
    10,
  );

  // 5. Memory monitoring overhead
  await bench.run(
    "Memory monitoring (10 samples)",
    async () => {
      const monitor = new MemoryMonitor();
      monitor.startMonitoring(10);

      await new Promise((resolve) => setTimeout(resolve, 100));

      monitor.stopMonitoring();
      const summary = monitor.getSummary();
      // Summary collected for benchmark
    },
    5,
  );

  // Print results
  bench.printResults();

  // Export to markdown
  bench.exportMarkdown("benchmarks/BENCHMARK_RESULTS.md");

  // Summary
  const totalDuration = bench.results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / bench.results.length;

  console.log("📝 Summary:");
  console.log(`   Total benchmarks: ${bench.results.length}`);
  console.log(`   Total duration: ${totalDuration.toFixed(2)}ms`);
  console.log(`   Average duration: ${avgDuration.toFixed(2)}ms`);
  console.log("");
}

// Run benchmarks
runBenchmarks().catch(console.error);
