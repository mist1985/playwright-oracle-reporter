# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Made report auto-open local-only by default and disabled it automatically in CI
- Switched history storage from a shared JSONL file to per-run files for safer CI usage
- Updated the package metadata for public npm publishing and added a `verify` script
- Reworked the README and contribution docs for current package and CI behavior

### Fixed

- Removed stale documentation references and outdated packaging artifacts
- Corrected the Jest coverage config key from `coverageThresholds` to `coverageThreshold`

## [1.0.0] - 2026-03-18

### Added

- Playwright reporter with root-cause analysis for failed tests
- rule-based failure diagnosis
- optional OpenAI enrichment
- HTML report output with structured JSON data
- historical flakiness tracking
- system telemetry collection for macOS, Linux, and Windows
- CLI commands for diagnostics and opening reports
