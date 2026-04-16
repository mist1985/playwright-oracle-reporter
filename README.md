# Playwright Oracle Reporter

Playwright Oracle Reporter is an npm package for teams that want better failure analysis than the default Playwright output. It adds rule-based diagnostics, flakiness tracking, telemetry correlation, HTML reporting, and optional OpenAI or Claude enrichment for failed runs.

<img width="2547" height="1163" alt="image" src="https://github.com/user-attachments/assets/6938cc48-cd12-43db-a0a4-052268df623c" />

## Table of Contents

- [What It Does](#what-it-does)
- [Install](#install)
- [Quick Start](#quick-start)
- [CI/CD Usage](#cicd-usage)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [CLI](#cli)
- [Report Output](#report-output)
- [AI Enrichment](#ai-enrichment)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What It Does

- Diagnoses common Playwright failures with built-in rules
- Tracks flaky and repeated failures across runs
- Captures local telemetry such as CPU, memory, and disk pressure
- Produces an HTML report and structured JSON data
- Optionally enriches failures with OpenAI or Claude analysis

The package is local-first by default. AI provider usage is optional.

## Install

### Requirements

- Node.js `18+`
- `@playwright/test` `>=1.40.0 <2`

### npm

```bash
npm install --save-dev playwright-oracle-reporter
```

### pnpm

```bash
pnpm add -D playwright-oracle-reporter
```

### yarn

```bash
yarn add -D playwright-oracle-reporter
```

## Quick Start

### `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    [
      "playwright-oracle-reporter",
      {
        aiMode: "auto",
      },
    ],
  ],
});
```

### Run tests

```bash
npx playwright test
```

### Open the latest report

```bash
npx playwright-oracle-reporter open
```

Short alias:

```bash
npx pw-oracle open
```

## CI/CD Usage

Default behavior is CI-safe:

- local runs: report auto-open is enabled
- CI runs: report auto-open is disabled

In CI, install the package normally and upload the generated report directory as an artifact.

### GitHub Actions example

```yaml
name: playwright

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - run: npx playwright install --with-deps

      - name: Run Playwright with Oracle Reporter
        run: npx playwright test
        env:
          PW_ORACLE_OUTPUT_DIR: playwright-oracle-report
          PW_ORACLE_HISTORY_DIR: .playwright-oracle-history
          PW_ORACLE_OPEN_REPORT: "false"
          PW_ORACLE_AI_MODE: rules

      - name: Upload Oracle report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-oracle-report
          path: |
            playwright-oracle-report/
            .playwright-oracle-history/
```

### CI recommendations

- Set a deterministic `PW_ORACLE_OUTPUT_DIR`
- Upload `playwright-oracle-report/` as an artifact
- Give each shard a unique output directory if you shard Playwright across jobs
- Keep `PW_ORACLE_OPEN_REPORT=false` in CI unless you explicitly want browser-launch behavior

## Configuration

Reporter options:

```ts
type ReporterOptions = {
  outputDir?: string;
  historyDir?: string;
  openReport?: boolean;
  runLabel?: string;
  telemetryInterval?: number;
  aiMode?: "auto" | "rules" | "openai" | "claude" | "off";
};
```

Example:

```ts
import { defineConfig } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  reporter: [
    [
      "playwright-oracle-reporter",
      {
        outputDir: isCI ? "artifacts/oracle-report" : "playwright-oracle-report",
        historyDir: ".cache/oracle-history",
        openReport: !isCI,
        telemetryInterval: 5,
        aiMode: "rules",
        runLabel: process.env.GITHUB_RUN_ID || "local",
      },
    ],
  ],
});
```

## Environment Variables

Supported environment variables:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `PW_ORACLE_OUTPUT_DIR`
- `PW_ORACLE_HISTORY_DIR`
- `PW_ORACLE_OPEN_REPORT`
- `PW_ORACLE_RUN_LABEL`
- `PW_ORACLE_TELEMETRY_INTERVAL`
- `PW_ORACLE_AI_MODE`
- `PW_ORACLE_LOG_LEVEL`
- `PW_ORACLE_OPENAI_MODEL`
- `PW_ORACLE_OPENAI_MAX_TOKENS`
- `PW_ORACLE_OPENAI_TIMEOUT_MS`
- `PW_ORACLE_CLAUDE_MODEL`
- `PW_ORACLE_CLAUDE_MAX_TOKENS`
- `PW_ORACLE_CLAUDE_TIMEOUT_MS`

Defaults:

- Output directory: `playwright-oracle-report`
- History directory: `.playwright-oracle-history`
- Auto-open report: `true` locally, `false` in CI
- Telemetry interval: `3`
- AI mode: `auto`

## CLI

The package ships with a CLI for report-related tasks.

```bash
npx playwright-oracle-reporter help
```

Available commands:

- `open`: open the latest generated HTML report
- `doctor`: validate config and local environment
- `help`: print CLI usage

Examples:

```bash
npx playwright-oracle-reporter doctor
npx playwright-oracle-reporter open
```

## Report Output

By default the package writes:

- `playwright-oracle-report/index.html`
- `playwright-oracle-report/data/*`
- `playwright-oracle-report/assets/*`
- `.playwright-oracle-history/runs/*`

The HTML report is intended for local inspection or CI artifact upload. History is stored as run-scoped files to make repeated runs and CI usage safer than a shared append-only file.

## AI Enrichment

OpenAI and Claude integrations are optional. If enabled, the reporter can add higher-level analysis on top of the built-in rule engine.

`aiMode: "auto"` prefers OpenAI when `OPENAI_API_KEY` is set, otherwise Claude when `ANTHROPIC_API_KEY` is set. If neither key is available, the reporter stays on local rules-based analysis.

### OpenAI example

In a project `.env` file:

```bash
OPENAI_API_KEY=your_api_key
PW_ORACLE_AI_MODE=openai
PW_ORACLE_OPENAI_MODEL=gpt-4o-mini
```

Or export the same variables in your shell before running Playwright:

```bash
export OPENAI_API_KEY="your_api_key"
export PW_ORACLE_AI_MODE="openai"
export PW_ORACLE_OPENAI_MODEL="gpt-4o-mini"
```

### Claude example

```bash
ANTHROPIC_API_KEY=your_api_key
PW_ORACLE_AI_MODE=claude
PW_ORACLE_CLAUDE_MODEL=claude-sonnet-4-20250514
```

Or export the same variables in your shell before running Playwright:

```bash
export ANTHROPIC_API_KEY="your_api_key"
export PW_ORACLE_AI_MODE="claude"
export PW_ORACLE_CLAUDE_MODEL="claude-sonnet-4-20250514"
```

If no matching API key is set, the reporter falls back to local rules-based analysis. Provider enrichment only runs for failed or flaky runs.

## Development

```bash
npm install
npm run verify
```

Useful scripts:

- `npm run build`
- `npm run test`
- `npm run lint`
- `npm run format:check`
- `npm run verify`

## Troubleshooting

### The CLI cannot find a report

Run your Playwright suite first, then open the report again:

```bash
npx playwright test
npx playwright-oracle-reporter open
```

### I want to verify my setup

```bash
npx playwright-oracle-reporter doctor
```

### AI mode is not being used

Check that:

- `PW_ORACLE_AI_MODE` matches the provider you want: `openai`, `claude`, or `auto`
- `OPENAI_API_KEY` is set for OpenAI mode
- `ANTHROPIC_API_KEY` is set for Claude mode
- your `.env` file is in the project root if you rely on file-based env loading
- your environment is available to the Playwright process that runs the reporter
- the run had at least one failed or flaky test, because successful runs do not call the provider APIs

### CI report directories are overwriting each other

Assign a unique `PW_ORACLE_OUTPUT_DIR` per shard or workflow leg.

## License

[MIT](./LICENSE)
