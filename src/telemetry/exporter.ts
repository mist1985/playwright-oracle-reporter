/**
 * Telemetry data exporter for CI/CD environments
 * Supports JSON and CSV formats
 */

import * as fs from "fs";
import * as path from "path";

export interface TelemetryExportOptions {
  format: "json" | "csv";
  outputPath: string;
  includeRaw?: boolean;
}

export class TelemetryExporter {
  /**
   * Detect if running in CI environment
   */
  static isCI(): boolean {
    return !!(
      process.env.CI ??
      process.env.CONTINUOUS_INTEGRATION ??
      process.env.BUILD_NUMBER ??
      process.env.GITHUB_ACTIONS ??
      process.env.GITLAB_CI ??
      process.env.CIRCLECI ??
      process.env.TRAVIS ??
      process.env.JENKINS_URL ??
      process.env.TEAMCITY_VERSION
    );
  }

  /**
   * Get CI environment name
   */
  static getCIEnvironment(): string {
    if (process.env.GITHUB_ACTIONS) return "GitHub Actions";
    if (process.env.GITLAB_CI) return "GitLab CI";
    if (process.env.CIRCLECI) return "CircleCI";
    if (process.env.TRAVIS) return "Travis CI";
    if (process.env.JENKINS_URL) return "Jenkins";
    if (process.env.TEAMCITY_VERSION) return "TeamCity";
    if (process.env.CI) return "Generic CI";
    return "Local";
  }

  /**
   * Export telemetry data to JSON
   */
  static exportJSON(data: Record<string, unknown>, outputPath: string): void {
    const exportData = {
      exportedAt: new Date().toISOString(),
      environment: this.getCIEnvironment(),
      isCI: this.isCI(),
      ...data,
    };

    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    console.log(`✅ Telemetry exported to: ${outputPath}`);
  }

  /**
   * Export telemetry data to CSV
   */
  static exportCSV(data: Record<string, unknown>, outputPath: string): void {
    const telemetry = data.telemetry as Record<string, unknown> | undefined;
    const samples = (telemetry?.samples ?? []) as Array<Record<string, unknown>>;

    if (samples.length === 0) {
      console.warn("⚠️  No telemetry samples to export");
      return;
    }

    // CSV header
    const headers = [
      "timestamp",
      "cpu_load_avg",
      "memory_used_mb",
      "memory_total_mb",
      "memory_percent",
    ];

    const rows = samples.map((sample: Record<string, unknown>) => {
      const cpu = sample.cpu as Record<string, unknown> | undefined;
      const memory = sample.memory as Record<string, unknown> | undefined;
      return [
        new Date(sample.timestamp as number).toISOString(),
        typeof cpu?.loadAverage === "number" ? cpu.loadAverage.toFixed(2) : "N/A",
        typeof memory?.used === "number" ? (memory.used / 1024 / 1024).toFixed(2) : "N/A",
        typeof memory?.total === "number" ? (memory.total / 1024 / 1024).toFixed(2) : "N/A",
        typeof memory?.percent === "number" ? memory.percent.toFixed(2) : "N/A",
      ];
    });

    const csv = [headers.join(","), ...rows.map((row: string[]) => row.join(","))].join("\n");

    fs.writeFileSync(outputPath, csv);
    console.log(`✅ Telemetry CSV exported to: ${outputPath} (${String(rows.length)} samples)`);
  }

  /**
   * Auto-export based on environment
   */
  static autoExport(data: Record<string, unknown>, baseDir: string): void {
    if (!this.isCI()) {
      return; // Skip export in local development
    }

    const exportDir = path.join(baseDir, "telemetry-exports");
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = path.join(exportDir, `telemetry-${timestamp}.json`);
    const csvPath = path.join(exportDir, `telemetry-${timestamp}.csv`);

    this.exportJSON(data, jsonPath);
    this.exportCSV(data, csvPath);
  }
}

/**
 * Streaming telemetry writer for memory-efficient collection
 */
export class StreamingTelemetryWriter {
  private stream: fs.WriteStream | null = null;
  private sampleCount: number = 0;
  private firstSample: boolean = true;

  constructor(private outputPath: string) {}

  /**
   * Start streaming telemetry to file
   */
  start(): void {
    const dir = path.dirname(this.outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.stream = fs.createWriteStream(this.outputPath, { flags: "w" });
    this.stream.write('{"samples":[');
    this.firstSample = true;
    this.sampleCount = 0;
  }

  /**
   * Write a telemetry sample
   */
  write(sample: unknown): void {
    if (!this.stream) return;

    if (!this.firstSample) {
      this.stream.write(",");
    }

    this.stream.write(JSON.stringify(sample));
    this.firstSample = false;
    this.sampleCount++;
  }

  /**
   * Finish streaming and close file
   */
  finish(metadata: Record<string, unknown> = {}): void {
    if (!this.stream) return;

    this.stream.write("],");
    this.stream.write(
      `"metadata":${JSON.stringify({
        ...metadata,
        sampleCount: this.sampleCount,
        exportedAt: new Date().toISOString(),
        environment: TelemetryExporter.getCIEnvironment(),
      })}`,
    );
    this.stream.write("}");
    this.stream.end();

    console.log(`✅ Streamed ${String(this.sampleCount)} telemetry samples to: ${this.outputPath}`);
    this.stream = null;
  }

  /**
   * Get sample count
   */
  getCount(): number {
    return this.sampleCount;
  }
}
