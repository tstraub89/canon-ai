# QA Summary: add-ci — Add GitHub Actions CI workflow

> Written by: Claude | Phase: QA

---

## What Changed

Four files were created or modified:

- **`.github/workflows/ci.yml`** (new): GitHub Actions workflow that triggers on push and PR to `main`/`dev`. Runs a 2×Node matrix (22.x, 24.x). Each job runs `npm ci` → `npm audit --omit=dev` → `npm run lint` → `npm run type-check` → `npm test` in order. Includes `concurrency` group for cancel-in-progress, `paths-ignore` for doc-only commits, and `permissions: contents: read`.

- **`package.json`**: `test` script glob changed from `tests/**/*.test.ts` to `tests/*.test.ts`. The double-star glob relied on zsh globstar expansion (macOS); POSIX sh (ubuntu/CI) doesn't support it. Single-star is correct for the current flat `tests/` structure.

- **`docs/architecture.md`**: Three stale CI references updated — Tech Stack CI bullet, dedicated `## CI` section (both previously said "no CI configured"), and Validation table Cross-platform row. Unit-tests binding also updated to match the new glob.

- **`docs/codebase-map.md`**: Added `.github/workflows/ci.yml` row to the Configuration table.

---

## Test Results

All four required validation checks passed locally:

| Check | Result |
|---|---|
| `npm audit --omit=dev` | Pass — 0 vulnerabilities |
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 69 tests (spec noted 58; count was already stale before this task; glob change did not alter the suite) |

---

## How to Test

1. Push this branch (or open a PR against `dev`). Navigate to the **Actions** tab in the GitHub repository.
2. Confirm the "CI" workflow appears and is running.
3. Confirm both matrix jobs appear: `test (22.x)` and `test (24.x)`.
4. Confirm both jobs complete green, with 69 tests reported.
5. **Configure branch protection** (one-time follow-up, requires GitHub UI):
   - Settings → Branches → Add rule for `main` and `dev`.
   - Enable "Require status checks to pass before merging."
   - Add required checks: `test (22.x)` and `test (24.x)`.
   - Until this is done, CI runs are informational only — they don't block merges.

---

## Decisions Made

- **`tests/*.test.ts` (single-star) over updating the runner**: The `**` glob was a macOS-ism with no current need for subdirectory tests. Fixing the glob at the source is cleaner than adding a workaround in CI.
- **Actions at `@v6`**: Spec required `checkout@v6` and `setup-node@v6` explicitly; both used as specified.
- **`paths-ignore` covers doc/task artifacts**: Canon generates many spec/plan/handoff commits that don't touch runnable code. Skipping CI for those saves minutes with no quality tradeoff.

---

## Open Questions

- **Branch protection**: Not a code change — must be done in GitHub UI after the workflow is verified green (see Human Test Plan above). CI is informational until this is done.
- **Test count**: `npm test` currently reports 69 tests; `spec.md` says 58. The spec count was stale before this task. Worth updating as a nit in a future spec or noting as a docs freshness gap.
- **Single-star glob**: If `tests/` ever gains subdirectories, the `test` script must be updated. The glob is correct for today's flat structure.

---

## Proposed Changelog

This is a **minor** bump: new capability (CI workflow) added without breaking existing usage or requiring adopters to change anything.

**Proposed version**: `0.3.0`

**Rationale**: New pipeline infrastructure (GitHub Actions CI) and a cross-platform fix to the test script — both additions, no behavior broken for existing adopters.

**Draft entry for `CHANGELOG.md`**:

```markdown
## [0.3.0] — 2026-05-09

### Added

- GitHub Actions CI workflow (`.github/workflows/ci.yml`): runs on push and PR to `main`/`dev`, matrix across Node 22.x and 24.x, with `npm audit --omit=dev`, `npm run lint`, `npm run type-check`, and `npm test` in order. Includes cancel-in-progress concurrency and `paths-ignore` for doc-only commits. Configure branch protection status checks (`test (22.x)`, `test (24.x)`) to make CI a hard merge gate.

### Fixed

- `npm test` glob changed from `tests/**/*.test.ts` to `tests/*.test.ts` so `npm test` works under POSIX shells (`/bin/sh` on ubuntu/CI). The double-star glob relied on zsh globstar expansion available on macOS but not in CI environments.
```

Human finalizes copy and version bump.
