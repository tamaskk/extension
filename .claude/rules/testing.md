---
paths:
  - "**/*.test.{ts,tsx,mjs}"
  - "**/*.spec.{ts,tsx}"
  - "apps/*/tests/**"
  - "apps/*/vitest.config.*"
---

# Testing

- `apps/tokenleads`: Vitest, tests in `apps/tokenleads/tests/`, database tests on `mongodb-memory-server`. Run `npm --prefix apps/tokenleads run test`.
- `apps/web`: `node:test` + `node:assert` for pure modules, next to the module (`lib/organize.test.mjs`). Run `node --test apps/web/lib/<name>.test.mjs`. Do not add Vitest to web without asking.
- `packages/scoring/leadScore.test.ts` has no runner wired. Do not rely on it.
- There are no end-to-end tests and no test framework for the extensions.
- Test pure logic: scoring, organizing, token spending, masking. Do not write tests that need the real Atlas database or a third-party API.
- Structure every test as Arrange-Act-Assert, with a blank line between the three parts.
- Test names state the behaviour: `keeps the stored phone when the synced one is empty`.
- A bug fix in pure logic starts with a failing test that reproduces the bug.
- Deterministic tests: fixed time, seeded data, no order dependence, no network.
- A task is not done while tests of the app you touched fail.
