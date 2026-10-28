# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [1.1.14] - 2026-10-28

### Fixed

- **Retried tests were counted once per attempt.**
  Playwright calls `onTestEnd` for every attempt. A test that failed and then passed on retry was counted as failed *and* passed, inflated the total, appeared twice in the HTML report, and triggered AI analysis for a run that ultimately passed. Each test is now one entry describing its final attempt; earlier attempts are kept in a new optional `previousAttempts` field (with their errors and attachments) and shown in the test detail modal. Run totals now match Playwright's own `expected`/`unexpected`/`flaky`/`skipped` counts.

- **Artifacts of retried attempts overwrote each other.**
  Attempt N's `trace.zip`/screenshot was copied over attempt N-1's file. Retried attempts now use a `-retryN` suffix (first attempts keep their existing file names), and failed attempts of flaky tests now have their artifacts copied too. Body attachments with the same name within one attempt no longer overwrite each other.

- **Ctrl+C discarded every reporter's output.**
  The reporter's SIGINT handler called `process.exit()` before Playwright could interrupt the run gracefully, so neither this report nor other reporters (`html`, `json`, `junit`) were written. The first Ctrl+C is now left to Playwright, which finalizes all reporters; a second Ctrl+C still forces an exit after saving emergency data. Signal and exit listeners are installed only for the duration of a run and removed afterwards (no leaked listeners when the reporter is instantiated without running tests).

- **Process could hang after the AI timeout.**
  The overall AI timeout did not cancel in-flight HTTP requests or retry waits. Requests are now cancelled when the timeout fires, the per-request timeout also covers reading the response body, and retry timers no longer keep the process alive.

- **Invalid API key caused one failing request per failed test.**
  401/403/404 responses now stop further requests for the run. The circuit breaker never opened before (request errors were swallowed before it could count them) and counted non-consecutive failures; it now opens after 5 consecutive failed requests and re-opens if its recovery probe fails. `Retry-After` headers on 429/503 are honoured (capped at 30s), and no wait happens after the final attempt. OpenAI now reuses one client for the whole run.

- **`PW_ORACLE_HISTORY_DAYS` and `PW_ORACLE_THRESHOLD_*` were ignored when set in `.env`.**
  These values were read when the module was imported, before `.env` was loaded. They are now read at use time. Invalid threshold values fall back to defaults instead of silently disabling detection.

- **Invalid numeric AI settings broke AI analysis.**
  A non-numeric `PW_ORACLE_CLAUDE_TIMEOUT_MS`/`*_RETRIES`/`*_MAX_TOKENS` (and OpenAI equivalents) produced `NaN`, which aborted every request instantly or skipped the request entirely. Invalid values now fall back to defaults.

- **Anthropic API keys were not redacted from AI payloads.**
  The redaction pattern stopped at the hyphen in `sk-ant-…`. Redaction now also covers stack traces, bearer tokens, JWTs, URL credentials, common cloud/VCS tokens, `password=`/`token=`-style pairs and Windows home directories, and replaces every home-directory occurrence rather than only the first.

- **Windows: console spam and WMIC dependency.**
  The Windows collector logged at INFO level every sample interval and shelled out to `wmic` (removed on recent Windows 11 builds) three times per sample. It now uses Node.js APIs only, and reports real user/system/idle CPU percentages instead of an estimated split. Disk space is measured on the drive containing the working directory.

- **Process crash when the browser opener is missing.**
  If `xdg-open` (or equivalent) was not installed, the asynchronous spawn error was unhandled and could crash the Playwright process at the end of the run. It is now ignored (logged in debug mode).

- **Unescaped error text in the fallback HTML report.**

- **Telemetry hardening.** Samples no longer overlap when collection is slower than the interval, late samples after the run are discarded, the sampling timer no longer keeps the process alive, subprocesses have a 5s timeout, and a `0`/invalid interval no longer causes a busy loop.

- **`REPORTER_VERSION` was out of sync** with the published package version (a test now enforces this).

- **Error line pointed into the wrong file.** The reported line is only moved to the error location when that location is in the test's own file.

### Added

- **Errors outside of tests are reported.** Configuration errors, files that fail to load, and worker crashes (`Reporter.onError`) are printed to the terminal, stored in `data/run.json` as `globalErrors`, and shown as a banner in the HTML report. Previously a run where no test could load looked like an empty, healthy run.
- `data/run.json` now includes the overall Playwright run `status`, and test entries include `projectName` when the test belongs to a named project.
- The Flaky filter in the HTML report now works (it previously matched nothing), and the Failed filter includes interrupted tests.
- Report JSON and HTML files are written atomically, so a killed process never leaves a half-written file.

### Changed

- History pruning uses the timestamp encoded in each run file name instead of reading every file, removes orphaned temp files from crashed writes, and ignores files that are not valid history records.
- `PW_ORACLE_AI_TIMEOUT_MS` is no longer written to `process.env` during the run.

## [1.1.13] - 2026-07-10

### Added

- **Configurable flakiness history window.**
  Set `PW_ORACLE_HISTORY_DAYS` to control how many days of flakiness history are retained (default: `7`). Invalid or missing values safely fall back to the default.

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
