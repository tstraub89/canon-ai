# Plan: Add GitHub Actions CI workflow

**Task ID**: add-ci
**Spec verdict**: Approved

---

## Context

No spec gaps or changes-requested items. The spec is implementable as written. One spec_review note flagged a perceived "lint scope contradiction" — it is not a contradiction: the spec's Non-Goals reads "Any CI check beyond `audit`, `lint`, `type-check`, and `test`," explicitly naming lint as in scope. Implement lint as specified.

---

## Step 1 — Fix `package.json` test script glob

**File**: `package.json`, line 11

Change:
```
"test": "node --test --import tsx tests/**/*.test.ts",
```
To:
```
"test": "node --test --import tsx tests/*.test.ts",
```

Rationale: `**` is not a POSIX glob; dash (GitHub Actions' `/bin/sh`) does not expand it recursively. All current test files live directly in `tests/`; `*.test.ts` is sufficient and portable. This must happen before the workflow is created so `npm test` works in CI.

---

## Step 2 — Create `.github/workflows/ci.yml`

Create the directory `.github/workflows/` and write `ci.yml` with this exact content:

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

No deviations from the spec YAML. The `actions/checkout@v6` and `actions/setup-node@v6` versions are correct per the ACs.

---

## Step 3 — Update `docs/architecture.md` Tech Stack CI bullet

**File**: `docs/architecture.md`, line 32

Replace:
```
- **CI**: none currently configured. `npm test` and `npm run type-check` are run manually before commits. Adding GitHub Actions is a tracked future task — see `STATUS.md`.
```
With:
```
- **CI**: GitHub Actions — `.github/workflows/ci.yml`. Triggers on push and PR to `main` and `dev`. Runs a Node 22.x × 24.x matrix: `npm audit --omit=dev`, `npm run lint`, `npm run type-check`, `npm test`.
```

---

## Step 4 — Update `docs/architecture.md` Validation table Cross-platform row

**File**: `docs/architecture.md`, line 141

Replace:
```
| Cross-platform | Node 22.x and 24.x are the supported versions (declared in `package.json` `engines`). Tests are run on whichever is on the developer's machine; future CI should run on both. |
```
With:
```
| Cross-platform | Node 22.x and 24.x (declared in `package.json` `engines`). CI runs both via the matrix in `.github/workflows/ci.yml`. Locally, tests run on whichever version is installed. |
```

---

## Step 5 — Rewrite `docs/architecture.md` `## CI` section

**File**: `docs/architecture.md`, lines 145–149

Replace the entire `## CI` section:
```
## CI

No CI is configured. Validation runs manually: `npm test` and `npm run type-check` before commits. PRs are reviewed locally.

This is a tracked gap. Adding GitHub Actions to run `npm test` + `npm run type-check` on every push is a candidate future task — when added, this section should describe the workflow files in `.github/workflows/` and which gates block merges.
```
With:
```
## CI

CI is configured via `.github/workflows/ci.yml`.

**Triggers**: push to `main` or `dev`; pull requests targeting `main` or `dev`. Doc-only commits (`docs/**`, `tasks/**`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `scripts/task.sh`, `.agent/**`, `.github/**/*.md`) are skipped via `paths-ignore`.

**Matrix**: Node 22.x and Node 24.x (both declared in `package.json` `engines`).

**Each job runs in order**: `npm ci` → `npm audit --omit=dev` → `npm run lint` → `npm run type-check` → `npm test`.

**Concurrency**: runs on the same `github.ref` cancel any in-flight run when a new push lands.

**To make CI a hard merge gate**: in GitHub → Settings → Branches, add a protection rule for `main` and `dev` with required status checks `test (22.x)` and `test (24.x)`. Until configured, CI is informational only.
```

After making this edit, verify the file no longer contains the strings `"none currently configured"` or `"no CI configured"` anywhere.

---

## Step 6 — Update `docs/codebase-map.md` Configuration table

**File**: `docs/codebase-map.md`, Configuration table (lines 91–101)

Add a new row to the Configuration table:
```
| GitHub Actions CI workflow | `.github/workflows/ci.yml` | Triggers, matrix, checks — see `docs/architecture.md` `## CI` |
```

Insert after the `package.json` row (currently the first row in the table) or at the end — end of table is simplest.

---

## Step 7 — Run validation

Run all four required checks in sequence and confirm they pass. All must be green before writing the handoff:

```
npm audit --omit=dev
npm run lint
npm run type-check
npm test
```

For `npm test`, confirm the test count is 58 (unchanged — no tests are added or removed by this task).

---

## Affected files summary

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Create (new directory + file) |
| `package.json` | `test` script glob: `tests/**/*.test.ts` → `tests/*.test.ts` |
| `docs/architecture.md` | Tech Stack CI bullet (line 32); Cross-platform Validation row (line 141); `## CI` section (lines 145–149) |
| `docs/codebase-map.md` | Add `.github/workflows/ci.yml` row to Configuration table |
