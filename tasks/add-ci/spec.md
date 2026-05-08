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
  pull_request:
    branches: [main, dev]

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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run type-check
      - run: npm test
```

Rationale for key choices:
- `npm ci` over `npm install` — deterministic, respects `package-lock.json`.
- `cache: 'npm'` on `setup-node` — caches the npm cache directory; reduces CI time at no extra cost.
- `permissions: contents: read` — principle of least privilege; this workflow only reads code and runs tests.
- Single job per matrix cell (type-check + test in sequence) — both checks are fast; parallel jobs add orchestration overhead for no meaningful benefit.
- No concurrency group — keep v1 simple; add if queued redundant runs become a problem.

**2. Fix `package.json` `test` script** — change `tests/**/*.test.ts` to `tests/*.test.ts`. All current test files live directly in `tests/` with no subdirectories; single-star glob is POSIX-universal and correct here.

**3. Update `docs/architecture.md`** — replace the "No CI configured" section with a description of the new workflow (file location, triggers, matrix, what to configure to block merges). Also update the Validation table's Cross-platform row, which currently says "future CI should run on both" — update to reflect that CI now does.

**4. Update `docs/codebase-map.md`** — add `.github/workflows/ci.yml` to the Configuration table.

---

## Non-Goals

- Adding a linter — linting is marked N/A in `docs/architecture.md`; not changed here.
- Configuring GitHub branch protection rules — requires GitHub UI, not a code change. See Human Test Plan for follow-up steps.
- Any CI check beyond `type-check` and `test`.
- Test coverage reporting or badge generation.

---

## Acceptance Criteria

- [ ] `.github/workflows/ci.yml` exists and is valid YAML.
- [ ] Workflow triggers on push to `main` and `dev`, and on PRs targeting `main` and `dev`. No other branches trigger CI.
- [ ] Workflow runs a strategy matrix across Node `22.x` and `24.x`.
- [ ] Each matrix job runs `npm ci`, then `npm run type-check`, then `npm test` — in that order.
- [ ] `package.json` `test` script uses `tests/*.test.ts` (single-star glob) instead of `tests/**/*.test.ts`.
- [ ] `docs/architecture.md` CI section describes the new workflow (file location, triggers, matrix, what to configure to block merges) and no longer says "no CI configured."
- [ ] `docs/architecture.md` Validation table Cross-platform row updated: "future CI should run on both" → references the CI matrix in `.github/workflows/ci.yml`.
- [ ] `docs/codebase-map.md` Configuration table includes an entry for `.github/workflows/ci.yml`.
- [ ] `npm test` passes locally after the `package.json` change (test count unchanged — currently 58).
- [ ] `npm run type-check` passes locally.

---

## Affected Files

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Create — new file, new directory |
| `package.json` | `test` script: `tests/**/*.test.ts` → `tests/*.test.ts` |
| `docs/architecture.md` | CI section rewrite; Validation table Cross-platform row update |
| `docs/codebase-map.md` | Add `.github/workflows/ci.yml` row to Configuration table |

---

## Validation Required

| Category | Required? | Command |
|---|---|---|
| Type checking | Yes | `npm run type-check` |
| Unit tests | Yes | `npm test` |
| Full build | N/A | No build step |
| End-to-end | N/A | No UI surface |

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
   - Add required checks: `test (22.x)` and `test (24.x)`.
   - This is what makes CI a hard gate rather than informational.
