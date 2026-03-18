# Contributing to Playwright Oracle Reporter

This project accepts improvements to the reporter, CLI, telemetry collectors, docs, and tests.

## Development Setup

```bash
git clone https://github.com/mist1985/playwright-oracle-reporter.git
cd playwright-oracle-reporter
npm install
npm run verify
```

## Expected Checks

Run this before opening a pull request:

```bash
npm run verify
```

That command runs:

- lint
- format check
- TypeScript build
- test suite

## Working Guidelines

- Keep changes scoped to the problem you are solving.
- Add or update tests when behavior changes.
- Preserve CI-safe behavior. Do not introduce browser-only assumptions into the default reporter flow.
- Avoid committing generated artifacts such as coverage output, packed `.tgz` files, or report folders.

## Project Layout

```text
src/
  index.ts                Reporter entry point
  cli.ts                  CLI entry point
  ai/                     Rule-based and OpenAI analysis
  common/                 Shared helpers
  config/                 Config validation
  history/                Run history storage
  insights/               Correlation and analysis
  patterns/               Pattern detection
  report/                 HTML, markdown, and terminal output
  telemetry/              System metric collection
  types/                  Shared types
tests/                    Unit tests
```

## Pull Requests

1. Branch from `main`.
2. Make the smallest coherent change that solves the problem.
3. Run `npm run verify`.
4. Update documentation if public behavior changed.
5. Open the pull request with a clear summary of the change and its impact.

## Commit Messages

Conventional Commits are preferred:

- `feat:` new behavior
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` internal restructuring
- `test:` test changes
- `chore:` maintenance

## Reporting Issues

Include:

- Node.js version
- Playwright version
- operating system
- a minimal reproduction
- expected behavior
- actual behavior
- relevant logs or screenshots

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
