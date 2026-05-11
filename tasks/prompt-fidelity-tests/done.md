# QA Summary: prompt-fidelity-tests — Prompt-fidelity regression test suite rebuild

## What Changed

The prompt-builder regression suite — deleted during the module-split refactor because it had three portability failures — is fully rebuilt with portable infrastructure that can run on any machine and survive doc sweeps.

**Root cause of original deletion**: goldens contained the local worktree path, `buildKnownPitfalls()` read the live `docs/patterns.md` at test time, and `taskDirFor()` derived the task directory from `REPO_ROOT` at module-load time so fixture writes to temp dirs didn't redirect the reads.

**What was built**: Two env-var escape hatches added to the harness — `CANON_TASKS_DIR_OVERRIDE` (redirects all task-dir reads) and `CANON_PATTERNS_MD_PATH` (redirects the `buildKnownPitfalls` doc read). Both are checked at call time, not module-load time, to avoid ESM caching issues. A new test suite covers all 10 prompt-builder calls, creates a temp fixture task, normalizes the live `REPO_ROOT` to `<REPO_ROOT>` before comparing, and tears down in a `finally` block. A fixed-content stub makes `buildKnownPitfalls` output deterministic regardless of what the real `docs/patterns.md` contains. Run `UPDATE_GOLDENS=1 npm test` to regenerate the goldens when a template change is intentional.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/state.ts` | `taskDirFor()` and `statusFileFor()` honor `CANON_TASKS_DIR_OVERRIDE` at call time |
| `scripts/run-task/context.ts` | `buildKnownPitfalls()` honors `CANON_PATTERNS_MD_PATH` when set |
| `tests/run-task-prompts.test.ts` | New — 10-case prompt-builder regression suite |
| `tests/run-task-prompts.golden.json` | New — committed normalized snapshots, no absolute paths |
| `tests/fixtures/patterns.stub.md` | New — deterministic stub for `buildKnownPitfalls` in tests |

## How to Test

1. Run `npm test` — all existing tests plus the 10 new prompt-fidelity cases pass.
2. Open any file under `scripts/run-task/prompts/templates/` and make a trivial whitespace change.
3. Run `npm test` — the prompt-fidelity test for that template fails with a diff showing the whitespace change.
4. Run `UPDATE_GOLDENS=1 npm test` — goldens regenerate, `npm test` passes.
5. Revert the template edit, run `npm test` — fails again (golden reflects the whitespace edit). Run `UPDATE_GOLDENS=1 npm test` to restore.
6. Inspect `tests/run-task-prompts.golden.json` — confirm no line contains `/Users/`, `/tmp/`, or any other absolute path.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (goldens bootstrapped with `UPDATE_GOLDENS=1` before final clean run) |
| E2E tests | N/A — not required by spec |
| Build | N/A — not required by spec |

## Decisions Made

- **`statusFileFor()` gets its own override branch** rather than delegating to `taskDirFor()`. Necessary because `getBaseBranch()` → `readStatus()` → `statusFileFor()` bypasses `taskDirFor()` entirely; without the dedicated branch, `promptCodeReview` would crash looking for the fixture task.
- **Fixture spec includes a real `## Validation Required` section** (not empty) so `promptImplement*` snapshots exercise `extractValidationChecks()` and reflect a real task's prompt shape.
- **Golden snapshot path uses `path.resolve` relative to `process.cwd()`**, not `REPO_ROOT` — `REPO_ROOT` resolves to the canonical checkout root, not the writable worktree, so the golden would be written to the wrong location if `REPO_ROOT` were used.

## Review Notes

Three review rounds:
- **Round 1**: Inline fix — Codex formatted the Validation Outcomes check names as raw command strings (`` `npm run lint` ``) instead of spec-name form (`` `lint` (`npm run lint`) ``), causing pre-flight to misfire. Renamed inline; trivial fix exception applied.
- **Round 2**: Pre-flight caught `handoff.md` and `review.md` appearing in the diff but missing from the Changes table. Codex added them (commit `37513a1`).
- **Round 3**: Full Stage 2 review — no correctness bugs or spec gaps. Approved.

## Open Questions

None. All ACs met; no blockers.

---

## Proposed Changelog

**Proposed version bump**: `0.3.0` → `0.4.0` (minor — new test infrastructure)

**Rationale**: The two new env-var hooks and rebuilt test suite are additive, not breaking. Minor bump is appropriate; patch would understate the scope of restored coverage.

```markdown
## [0.4.0] — 2026-05-11

### Added

- Prompt-fidelity regression suite (`tests/run-task-prompts.test.ts`) covers all 10 prompt-builder
  calls. Goldens committed with `<REPO_ROOT>` placeholders — no machine-specific paths. Run
  `UPDATE_GOLDENS=1 npm test` after intentional template changes to regenerate.
- `CANON_TASKS_DIR_OVERRIDE` env var: when set, `taskDirFor()` and `statusFileFor()` route reads
  through the specified directory instead of the normal worktree-aware path. Enables test fixtures
  in temp dirs without touching the real task directory.
- `CANON_PATTERNS_MD_PATH` env var: when set, `buildKnownPitfalls()` reads from this path instead
  of `docs/patterns.md`. Makes prompt-snapshot tests immune to lessons-learned doc sweeps.
```

Human finalizes content and version number.
