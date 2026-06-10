# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [1.1.12] - 2026-06-10

### Fixed

- **Test TypeScript configuration in editors.**
  Added a test-local TypeScript config so Jest globals are resolved correctly across the `tests/` folder without changing the production build config.

- **Noisy memory monitor test output on low-memory machines.**
  Memory monitor tests now use stable mocked memory stats where sampling is required, avoiding environment-dependent critical memory logs during verification.

## [1.1.11] - 2026-05-27

### Fixed

- **`data/tests.json` contained stale absolute attachment paths.**
  The JSON file was serialised inside a `Promise.all` block that ran concurrently with — and therefore before — the `copyArtifacts` step that rewrites attachment paths to relative form. The HTML report was already correct because it reads the in-memory state after mutation. `data/tests.json` now reflects the same relative paths as the HTML report by being written after `copyArtifacts` completes.

- **Body-only attachments silently discarded.**
  Attachments created via `testInfo.attach(name, { body: buffer, contentType })` (no file path) were mapped to an empty string path, appearing as a dead unclickable link in the test detail modal and carrying no usable data in `data/tests.json`. These attachments are now written to the report's `artifacts/` directory during `onTestEnd` and their paths stored as relative references, making them fully clickable in the HTML report and correctly represented in the JSON output.

## [1.1.10] - 2026-05-26

### Fixed

- **`aiMode: "off"` rejected as invalid by `validateConfig()` and the `doctor` command.**
  `"off"` is a documented mode that disables all AI enrichment, but the internal `AI_MODES` constant was missing the value, so `validateConfig({ aiMode: "off" })` incorrectly returned an error. It is now accepted alongside `"auto"`, `"rules"`, `"openai"`, and `"claude"`.

- **XSS in HTML report `<script>` block.**
  Test titles, error messages, and attachment metadata are serialised with `JSON.stringify` and embedded in an inline `<script>` tag. A title or error containing `</script>` would have broken out of the script context. All values embedded in `<script>` are now serialised with `safeJsonForScript`, which escapes `<`, `>`, `&`, and the Unicode line/paragraph separators (U+2028, U+2029) to their `\uXXXX` forms before embedding.

- **XSS in test detail modal.**
  The modal that appears when clicking a failed test was built by concatenating raw test data (error message, stack trace, attachment names, and attachment paths) into an `innerHTML` string. These values are now rendered exclusively with DOM APIs (`createElement` + `textContent`), preventing any HTML injection. Attachment links also now have `rel="noopener noreferrer"` and a `javascript:` protocol guard on the `href`.

- **Shell injection surface in report auto-open.**
  The browser-open helper was built with `execSync(\`open "${reportPath}"\`)`, passing the output path through a shell string. It now uses `spawn` with an explicit argument array (`spawn("open", [reportPath])`), eliminating the shell as an intermediary regardless of what the output path contains.

- **Stale version strings in generated reports.**
  The debug log file, fallback error report, and HTML footer each hard-coded old version strings (`"1.1.5"`, `"v1.0.0"`). All three now read from a single `src/version.ts` constant that matches the package version.

- **Recurring failure detection was silently disabled.**
  `buildHistoryRecord()` stored `signatureHash: null` for every test, making the pattern analyser unable to group errors across runs. Failed and timed-out tests now have their `signatureHash` computed from the normalised error message and stack before being written to history. The `recurringFailures` field in the patterns output will now correctly surface tests that keep failing with the same root cause across runs.

## [1.1.9] - 2026-05-14

### Changed

- Raised the maximum auto-scaling limit for `PW_ORACLE_AI_TIMEOUT_MS` from 5 minutes to 10 minutes to better support test suites with many failures.
- Preserves partial AI enrichment results when the timeout is hit, ensuring completed test analyses are included in the report with a warning indicator.
### Added

- Claude API integration for test failure analysis via Anthropic's Messages API
- Support for `aiMode: "claude"` to use Claude instead of OpenAI
- Support for `aiMode: "auto"` to automatically prefer OpenAI when available, fall back to Claude if only ANTHROPIC_API_KEY is set
- Environment variables for Claude configuration: `ANTHROPIC_API_KEY`, `PW_ORACLE_CLAUDE_MODEL`, `PW_ORACLE_CLAUDE_MAX_TOKENS`, `PW_ORACLE_CLAUDE_TIMEOUT_MS`
- Shared AI provider infrastructure including `RateLimiter` and `CircuitBreaker` for request resilience
- Unified AI types and system prompts for consistent analysis across providers
- Comprehensive test suite for Claude enrichment with mock and real API verification

### Changed

- Refactored OpenAI types and prompts into shared `src/ai/types.ts` and `src/ai/prompts.ts` for provider-agnostic design
- Updated all internal AI response references from `openaiResponse` to `aiResponse` for consistency
- Made report auto-open local-only by default and disabled it automatically in CI
- Switched history storage from a shared JSONL file to per-run files for safer CI usage
- Updated the package metadata for public npm publishing and added a `verify` script
- Reworked the README and contribution docs for current package and CI behavior
- Renamed internal reporter/config identifiers from `AI` naming to `Oracle` naming for consistency

### Fixed

- Removed stale documentation references and outdated packaging artifacts
- Corrected the Jest coverage config key from `coverageThresholds` to `coverageThreshold`

### Removed

- Removed the legacy `pw-ai` CLI alias; supported binaries are now `playwright-oracle-reporter` and `pw-oracle`
- Removed support for legacy `PW_AI_*` environment variables in favor of `PW_ORACLE_*` only
- Deleted the obsolete `src/index.ts.bak` backup source file

## [1.1.7] - 2026-05-01

### Added

- `PW_ORACLE_CLAUDE_CONCURRENCY` to limit parallel Claude requests (bounded concurrency for per-test analysis)

### Changed

- AI enrichment timeout handling: overall timeout can auto-scale with failure count unless `PW_ORACLE_AI_TIMEOUT_MS` is explicitly set
- Claude enrichment now reuses a single client across tests for better rate limiting / circuit breaker behavior
- Claude enrichment preserves partial progress when the overall enrichment budget is reached

## [1.0.0] - 2026-03-18

### Added

- Playwright reporter with root-cause analysis for failed tests
- rule-based failure diagnosis
- optional OpenAI enrichment
- HTML report output with structured JSON data
- historical flakiness tracking
- system telemetry collection for macOS, Linux, and Windows
- CLI commands for diagnostics and opening reports
