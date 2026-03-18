"use strict";
/**
 * Performance benchmarks for Playwright Oracle Reporter
 *
 * Run with: node --expose-gc benchmarks/performance.js
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var perf_hooks_1 = require("perf_hooks");
var memory_js_1 = require("../dist/utils/memory.js");
var fs = __importStar(require("fs"));
var Benchmark = /** @class */ (function () {
    function Benchmark() {
        this.results = [];
    }
    Benchmark.prototype.run = function (name_1, fn_1) {
        return __awaiter(this, arguments, void 0, function (name, fn, iterations) {
            var memBefore, start, i, end, memAfter, result;
            if (iterations === void 0) { iterations = 1; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // Force GC if available
                        if (global.gc) {
                            global.gc();
                        }
                        memBefore = process.memoryUsage().heapUsed;
                        start = perf_hooks_1.performance.now();
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < iterations)) return [3 /*break*/, 4];
                        return [4 /*yield*/, fn()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        i++;
                        return [3 /*break*/, 1];
                    case 4:
                        end = perf_hooks_1.performance.now();
                        memAfter = process.memoryUsage().heapUsed;
                        result = {
                            name: name,
                            duration: end - start,
                            memoryBefore: memBefore,
                            memoryAfter: memAfter,
                            memoryDelta: memAfter - memBefore,
                            opsPerSecond: iterations > 1 ? iterations / ((end - start) / 1000) : undefined,
                        };
                        this.results.push(result);
                        return [2 /*return*/, result];
                }
            });
        });
    };
    Benchmark.prototype.printResults = function () {
        console.log("\n📊 Performance Benchmark Results\n");
        console.log("═".repeat(80));
        this.results.forEach(function (result) {
            console.log("\n".concat(result.name));
            console.log("─".repeat(80));
            console.log("Duration:        ".concat(result.duration.toFixed(2), "ms"));
            if (result.opsPerSecond) {
                console.log("Ops/sec:         ".concat(result.opsPerSecond.toFixed(0)));
            }
            console.log("Memory Before:   ".concat(memory_js_1.MemoryMonitor.formatBytes(result.memoryBefore)));
            console.log("Memory After:    ".concat(memory_js_1.MemoryMonitor.formatBytes(result.memoryAfter)));
            console.log("Memory Delta:    ".concat(memory_js_1.MemoryMonitor.formatBytes(Math.abs(result.memoryDelta)), " ").concat(result.memoryDelta >= 0 ? "↑" : "↓"));
        });
        console.log("\n" + "═".repeat(80) + "\n");
    };
    Benchmark.prototype.exportMarkdown = function (filePath) {
        var md = "# Performance Benchmark Results\n\n";
        md += "Generated: ".concat(new Date().toISOString(), "\n\n");
        md += "| Benchmark | Duration (ms) | Ops/sec | Memory Delta |\n";
        md += "|-----------|--------------|---------|-------------|\n";
        this.results.forEach(function (result) {
            md += "| ".concat(result.name, " ");
            md += "| ".concat(result.duration.toFixed(2), " ");
            md += "| ".concat(result.opsPerSecond ? result.opsPerSecond.toFixed(0) : "N/A", " ");
            md += "| ".concat(memory_js_1.MemoryMonitor.formatBytes(Math.abs(result.memoryDelta)), " ").concat(result.memoryDelta >= 0 ? "↑" : "↓", " |\n");
        });
        fs.writeFileSync(filePath, md);
        console.log("\u2705 Benchmark results exported to: ".concat(filePath));
    };
    return Benchmark;
}());
// Benchmark scenarios
function runBenchmarks() {
    return __awaiter(this, void 0, void 0, function () {
        var bench, totalDuration, avgDuration;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    bench = new Benchmark();
                    console.log("🏃 Starting performance benchmarks...\n");
                    // 1. Test data processing speed
                    return [4 /*yield*/, bench.run("Process 100 test results", function () {
                            var tests = Array.from({ length: 100 }, function (_, i) { return ({
                                id: "test-".concat(i),
                                title: "Test ".concat(i),
                                status: Math.random() > 0.9 ? "failed" : "passed",
                                duration: Math.random() * 1000,
                            }); });
                            var failed = tests.filter(function (t) { return t.status === "failed"; });
                            // Processed for benchmark
                        }, 100)];
                case 1:
                    // 1. Test data processing speed
                    _a.sent();
                    // 2. Telemetry collection overhead
                    return [4 /*yield*/, bench.run("Collect 1000 telemetry samples", function () {
                            var samples = Array.from({ length: 1000 }, function (_, i) { return ({
                                timestamp: Date.now() + i * 1000,
                                cpu: { loadAverage: Math.random() * 4 },
                                memory: {
                                    used: Math.random() * 8 * 1024 * 1024 * 1024,
                                    total: 8 * 1024 * 1024 * 1024,
                                    percent: Math.random() * 100,
                                },
                            }); });
                            // Samples collected for benchmark
                        }, 10)];
                case 2:
                    // 2. Telemetry collection overhead
                    _a.sent();
                    // 3. Data chunking performance
                    return [4 /*yield*/, bench.run("Chunk 10,000 items (size 100)", function () { return __awaiter(_this, void 0, void 0, function () {
                            var chunker, items, chunks;
                            return __generator(this, function (_a) {
                                chunker = new memory_js_1.DataChunker(100);
                                items = Array.from({ length: 10000 }, function (_, i) { return i; });
                                chunks = chunker.chunk(items);
                                return [2 /*return*/];
                            });
                        }); }, 50)];
                case 3:
                    // 3. Data chunking performance
                    _a.sent();
                    // 4. Large test suite simulation (1000 tests)
                    return [4 /*yield*/, bench.run("Process 1000 test results", function () {
                            var tests = Array.from({ length: 1000 }, function (_, i) { return ({
                                id: "test-".concat(i),
                                title: "Test ".concat(i),
                                status: Math.random() > 0.95 ? "failed" : "passed",
                                duration: Math.random() * 5000,
                                error: Math.random() > 0.95
                                    ? { message: "Test failed", stack: "Error at line 123" }
                                    : undefined,
                            }); });
                            var failed = tests.filter(function (t) { return t.status === "failed"; });
                            var avgDuration = tests.reduce(function (sum, t) { return sum + t.duration; }, 0) / tests.length;
                            // Processed for benchmark
                        }, 10)];
                case 4:
                    // 4. Large test suite simulation (1000 tests)
                    _a.sent();
                    // 5. Memory monitoring overhead
                    return [4 /*yield*/, bench.run("Memory monitoring (10 samples)", function () { return __awaiter(_this, void 0, void 0, function () {
                            var monitor, summary;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        monitor = new memory_js_1.MemoryMonitor();
                                        monitor.startMonitoring(10);
                                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 100); })];
                                    case 1:
                                        _a.sent();
                                        monitor.stopMonitoring();
                                        summary = monitor.getSummary();
                                        return [2 /*return*/];
                                }
                            });
                        }); }, 5)];
                case 5:
                    // 5. Memory monitoring overhead
                    _a.sent();
                    // Print results
                    bench.printResults();
                    // Export to markdown
                    bench.exportMarkdown("benchmarks/BENCHMARK_RESULTS.md");
                    totalDuration = bench.results.reduce(function (sum, r) { return sum + r.duration; }, 0);
                    avgDuration = totalDuration / bench.results.length;
                    console.log("📝 Summary:");
                    console.log("   Total benchmarks: ".concat(bench.results.length));
                    console.log("   Total duration: ".concat(totalDuration.toFixed(2), "ms"));
                    console.log("   Average duration: ".concat(avgDuration.toFixed(2), "ms"));
                    console.log("");
                    return [2 /*return*/];
            }
        });
    });
}
// Run benchmarks
runBenchmarks().catch(console.error);
