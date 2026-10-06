# Completion Summary: rearm-spec-gate — Make the spec gate settable via canon task set

> For the human. This is what you need to know.

## What Changed

`canon task set <id> human_spec_gate true|false` now works, so the human spec gate can be turned back on (or off) without hand-editing `status.json`. Arming the gate on a task that is in full-send also turns full-send off in the same write and prints how to re-enable it, because a re-armed gate never fires on a full-send task. Arming on a task whose spec review is already done prints a note that the gate only fires again after a full-tier `canon run --reroute <id>`. Turning the gate off is refused on delicate tasks (pointing at `canon run --full-send --force <id>`), preserving today's friction. The `full_send` refusal message no longer claims full-send is "not durable metadata"; it now says it persists until `--reroute` (or arming the gate) clears it. `canon task new` now points at `canon task set` instead of telling operators to edit `status.json`, and the `canon-spec` skill uses `canon task set` / `canon task phase` instead of manual edits. No orchestrator source changed.

## Files Changed

- `src/task/index.ts` — `human_spec_gate` settable; delicate disarm refusal; full-send clearing note; spec_review-done note; corrected `full_send` refusal; `task new` hint
- `tests/task-cli.test.ts` — tests for AC-1/2/3/4/5/6/7/9 and worktree routing
- `tests/run-task-reroute-preflight.test.ts` — armed gate halts after approved full-tier reroute review (AC-8)
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles
- `docs/pipeline-orchestrator.md` (+ `templates/` mirror) — `set` row, field row, single-use latch section, reroute paragraph
- `docs/decisions.md` — full-send clearing paths
- `.claude/skills/canon-spec/SKILL.md` (+ `templates/` mirror) — canon commands replace manual status edits

## How to Test

1. In a throwaway non-delicate task with `full_send: true`, run `canon task set <id> human_spec_gate true`.
2. Expected: gate on, `full_send` off, and a note naming `canon run --full-send <id>`.
3. Run `canon task set <id> human_spec_gate false`. Expected: gate off, nothing else changes.
4. Mark the task delicate and try `false` again. Expected: refused, naming `canon run --full-send --force <id>`; file unchanged.
5. On a task whose spec review is done, set `true`. Expected: note about the full-tier `canon run --reroute <id>`; no generic "next canon run" warning.
6. Run `canon task set <id> full_send true`. Expected: refused with corrected wording.
7. Run `canon task new` for a new task. Expected: output points at `canon task set <id> <field> <value>`.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,349 passed, 0 failed, 1 skipped (linked-worktree `REPO_ROOT` test, skipped because `.git/` writes are restricted in the sandbox — unverified, not passing) |
| `npm run build` | Pass | Both declared `dist/` bundles rebuilt |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| E2E | N/A | No UI surface (spec) |
| Structural greps / scope check | Pass | No `not durable metadata` / `self-clearing` in `src/`; no `src/orchestrator/` or `pipeline-policy.ts` in the diff |

## Human Verification Required

None.

Pre-merge checklist items not confirmable from this session:
- [ ] PR body current (`pr-body.md` drafted this phase)
- [ ] Final CI/CD checks green (no PR opened yet)
- [ ] Final diff matches spec intent (code review approved with nits)
- Version/changelog: decided at the release step, not here.

## Decisions Made

- AC-6 says disarming a spec_review-done task prints neither the reroute note nor the generic warning, though such a task is always "started". Implemented as: once `spec_review` is done, the generic warning is suppressed for both values; arming prints the reroute note, disarming prints nothing.
- Code review round 1 requested changes (weak AC-5 test assertion; latch section lacked reroute behavior). Both fixed in iteration 2; round 2 approved with nits.
- Two low-severity spec-gaps accepted as non-blocking by code review (see Open Questions).

## Open Questions

- The spec-mandated completed-review note advertises a full-tier `--reroute`, which isn't admitted right after the gate halts, and also prints for fast-tier tasks. Wording is AC-6-mandated; consider a follow-up issue.
- Delicate friction can be bypassed by `delicate false` → gate `false` → `delicate true`; AC-4 guards only the gate setter. Consider a follow-up issue to guard `delicate` mutations.
- Nits left: reroute paragraph in `docs/pipeline-orchestrator.md` joins clauses with semicolons; the latch section doesn't say a reroute never re-arms an already-consumed latch.

## Proposed Changelog

### Added

- **`canon task set <id> human_spec_gate true|false` re-arms or disarms the human spec gate.** Arming a task that is in full-send also turns full-send off (with a note on how to re-enable it), since full-send skips the gate. Arming a task whose spec review is already done notes that the gate only fires again on a full-tier `canon run --reroute`. Disarming a delicate task is refused; use `canon run --full-send --force <id>` instead.

### Changed

- **The `full_send` refusal and `canon task new` output give accurate guidance.** `canon task set <id> full_send` now says full-send persists until `--reroute` (or arming the gate) clears it, and `canon task new` points at `canon task set` instead of telling you to edit `status.json`. `/canon-spec` uses `canon task set` and `canon task phase` instead of manual edits; run `canon upgrade` to pick it up.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: Round 1 code review caught a weak AC-5 test and a missing latch-section doc clause (fixed in iteration 2); two low-severity spec-gaps (completed-review note wording, delicate toggle bypass) accepted; one worktree test skipped in sandbox.
