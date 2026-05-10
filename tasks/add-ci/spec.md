# Spec: Add GitHub Actions CI workflow

**Task ID**: add-ci
**Size**: M
**Delicate**: false

> Written by: Claude | Review by: Codex

---

## Problem

No CI is configured. Validation (`npm test`, `npm run type-check`) runs manually before commits. A broken push to `main` or `dev` is not caught until someone manually runs the suite. `docs/architecture.md` calls this out as a tracked gap.

Additionally, the `test` script in `package.json` uses `tests/**/*.test.ts`, which relies on zsh's globstar expansion (the default on macOS where `/bin/sh` is zsh). On ubuntu (GitHub Actions), `/bin/sh` is dash, which does not support `**` as a recursive glob — it falls back to passing the literal string to node, causing the test run to fail. This must be fixed before CI can work.

---

## Decision

**1. Create `.github/workflows/ci.yml`** — a GitHub Actions workflow that runs `npm run type-check` and `npm test` on every push to `main` or `dev` and on every pull request targeting those branches, in a matrix across Node 22.x and 24.x (the two versions declared in `package.json` `engines`).

Workflow shape:
```yaml
name: CI

on:
  push:
    branches: [main, dev]
    paths-ignore:
      - 'AGENTS.md'
      - 'CLAUDE.md'
      - 'CODEX.md'
      - 'docs/**'
      - 'tasks/**'
      - 'scripts/task.sh'
      - '.agent/**'
      - '.github/**/*.md'
  pull_request:
    branches: [main, dev]
    paths-ignore:
      - 'AGENTS.md'
      - 'CLAUDE.md'
      - 'CODEX.md'
      - 'docs/**'
      - 'tasks/**'
      - 'scripts/task.sh'
      - '.agent/**'
      - '.github/**/*.md'

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    name: test (${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ['22.x', '24.x']
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm audit --omit=dev
      - run: npm run lint
      - run: npm run type-check
      - run: npm test
```

Rationale for key choices:
- `npm ci` over `npm install` — deterministic, respects `package-lock.json`.
- `cache: 'npm'` on `setup-node` — caches the npm cache directory; reduces CI time at no extra cost.
- `permissions: contents: read` — principle of least privilege; this workflow only reads code and runs tests.
- Single job per matrix cell (audit + lint + type-check + test in sequence) — all checks are fast; parallel jobs add orchestration overhead for no meaningful benefit.
- `paths-ignore` — skips CI for doc-only and pipeline-artifact commits (specs, plans, task logs, markdown). Canon generates many such commits; skipping saves CI minutes with no quality tradeoff.
- `concurrency` group — cancels redundant runs on the same ref when a new push lands. PR runs and branch runs are grouped separately via `github.ref`.
- `npm audit --omit=dev` — flags vulnerable production dependencies; dev-only vulnerabilities are excluded since they don't ship.

**2. Fix `package.json` `test` script** — change `tests/**/*.test.ts` to `tests/*.test.ts`. All current test files live directly in `tests/` with no subdirectories; single-star glob is POSIX-universal and correct here.

**3. Update `docs/architecture.md`** — three edits, since CI staleness appears in three places in this file:
   - Tech Stack bullet (line 32, `**CI**: none currently configured...`): rewrite to point at the new workflow file and triggers.
   - Dedicated `## CI` section: replace with a description of the new workflow (file location, triggers, matrix, what to configure to block merges).
   - Validation table Cross-platform row: currently says "future CI should run on both" — update to reflect that CI now does.

**4. Update `docs/codebase-map.md`** — add `.github/workflows/ci.yml` to the Configuration table.

---

## Non-Goals

- Changing the lint configuration — CI runs the existing `npm run lint` as-is.
- Configuring GitHub branch protection rules — requires GitHub UI, not a code change. See Human Test Plan for follow-up steps.
- Any CI check beyond `audit`, `lint`, `type-check`, and `test` (e.g., no build, no E2E, no coverage gates).
- Test coverage reporting or badge generation.

---

## Acceptance Criteria

- [ ] `.github/workflows/ci.yml` exists and is valid YAML.
- [ ] Workflow triggers on push to `main` and `dev`, and on PRs targeting `main` and `dev`. No other branches trigger CI.
- [ ] Workflow runs a strategy matrix across Node `22.x` and `24.x`.
- [ ] Each matrix job runs `npm ci`, then `npm audit --omit=dev`, then `npm run lint`, then `npm run type-check`, then `npm test` — in that order.
- [ ] Workflow has a `concurrency` group keyed on `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`.
- [ ] `push` and `pull_request` triggers both have `paths-ignore` covering `docs/**`, `tasks/**`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `scripts/task.sh`, `.agent/**`, `.github/**/*.md`.
- [ ] Actions use `actions/checkout@v6` and `actions/setup-node@v6` (not deprecated v4).
- [ ] `package.json` `test` script uses `tests/*.test.ts` (single-star glob) instead of `tests/**/*.test.ts`.
- [ ] `docs/architecture.md` Tech Stack bullet for CI (line 32 area, currently `**CI**: none currently configured...`) is rewritten to describe the new workflow.
- [ ] `docs/architecture.md` `## CI` section describes the new workflow (file location, triggers, matrix, checks run, what to configure to block merges) and no longer says "no CI configured."
- [ ] `docs/architecture.md` Validation table Cross-platform row updated: "future CI should run on both" → references the CI matrix in `.github/workflows/ci.yml`.
- [ ] `docs/architecture.md` no longer contains the strings "none currently configured" or "no CI configured" anywhere in the file.
- [ ] `docs/codebase-map.md` Configuration table includes an entry for `.github/workflows/ci.yml`.
- [ ] `npm audit --omit=dev` passes locally (no high/critical vulnerabilities in production deps).
- [ ] `npm run lint` passes locally.
- [ ] `npm run type-check` passes locally.
- [ ] `npm test` passes locally after the `package.json` change (test count unchanged — currently 58).

---

## Affected Files

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Create — new file, new directory |
| `package.json` | `test` script: `tests/**/*.test.ts` → `tests/*.test.ts` |
| `docs/architecture.md` | Tech Stack CI bullet rewrite; `## CI` section rewrite; Validation table Cross-platform row update |
| `docs/codebase-map.md` | Add `.github/workflows/ci.yml` row to Configuration table |

---

## Validation Required

| Category | Required? | Command |
|---|---|---|
| Dependency audit | Yes | `npm audit --omit=dev` |
| Linting | Yes | `npm run lint` |
| Type checking | Yes | `npm run type-check` |
| Unit tests | Yes | `npm test` |
| Full build | N/A | No build step |
| End-to-end | N/A | No UI surface |

Audit and lint are required because the workflow runs them before type-check and test — local green is the floor for CI to be green.

---

## Known Risks

- **Single-star glob and future test subdirectories**: `tests/*.test.ts` matches only files directly in `tests/`. If subdirectory-scoped test files are added later, the script must be updated. Acceptable now; worth noting for when the test tree grows.
- **`package-lock.json` sync**: `npm ci` requires `package-lock.json` committed and consistent with `package.json`. Both currently exist and are in sync. If they drift, CI fails with a clear error.
- **Branch protection not yet configured**: After the workflow is merged, status checks do not automatically block merges — that requires a separate GitHub repository settings step (see Human Test Plan). Until configured, CI is informational only.

---

## Docs Impact

- `docs/architecture.md` — CI section (explicit); Validation table Cross-platform row
- `docs/codebase-map.md` — Configuration table

---

## Human Test Plan

1. After the PR is opened against `dev`, navigate to the GitHub repository's **Actions** tab. Verify the "CI" workflow appears and is running.
2. Confirm both matrix jobs appear: `test (22.x)` and `test (24.x)`.
3. Confirm both jobs complete green.
4. Confirm the test count reported in the CI output matches the local count (58 tests).
5. **Configure branch protection** (one-time, done after the workflow is verified green):
   - GitHub → Settings → Branches → Add rule for `main` and `dev`.
   - Enable "Require status checks to pass before merging."
   - Add required checks: `test (22.x)` and `test (24.x)` (each covers lint + type-check + test).
   - This is what makes CI a hard gate rather than informational.
