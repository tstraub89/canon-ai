# Implementation Handoff: archive-review-on-reroute

> Author: Codex | Spec: `tasks/archive-review-on-reroute/spec.md` | Plan: `tasks/archive-review-on-reroute/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/review-archive.ts` | Added the shared numeric highest-plus-one archive allocator, newest-archive lookup, and single filename convention used by reset, reroute, and prompts. |
| `src/orchestrator/main.ts` | Added a fail-closed archive pass before all reroute status writes, archive reporting, and unconditional stale `claude_review` session cleanup. |
| `src/task/index.ts` | Replaced `reset-code-review`'s lowest-unused rename loop with the shared monotonic allocator while preserving all other reset behavior and output wording. |
| `src/orchestrator/prompts/index.ts` | Repointed both non-advancing exempt-sibling findings lines through a render-time numeric newest-archive lookup with the original bare-review fallback when no archive exists. |
| `tests/run-task-reroute-preflight.test.ts` | Added red-first wedge/evidence regressions plus allocator, stub, repeat-reroute, session, production-prompt, and atomic archive-failure coverage. |
| `tests/task-cli.test.ts` | Added the worktree-canonical reroute archive companion test without changing existing reset-code-review tests. |
| `tests/run-task-prompts.test.ts` | Updated both static exempt-finding assertions to seed and require the archived review pointer. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented monotonic reroute archival, the template-stub exception, fail-closed ordering, session cleanup, and binding archived findings; synchronized the managed mirror. |
| `dist/orchestrator/run-task.js`, `dist/cli/index.js` | Rebuilt the tracked runtime bundles from the updated source. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Reroute now removes real prior review evidence before reopening review state. The durable archive is allocated monotonically from the numeric maximum, so a later cold process can locate the exact newest findings even after an older archive was manually deleted or numbering reaches two digits. The archive pass completes for the whole bundle before the first status write; a failure therefore preserves every status byte and reports any earlier successful renames. Template-only reviews remain in place because they contain no findings or stale round verdict. Both exempt-sibling prompt surfaces resolve the archive from the worktree-canonical task directory at render time, preserving resumability without new in-memory or schema state.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Used new `src/orchestrator/review-archive.ts` instead of adding the helper to `state.ts`; updated the spec Affected Files row accordingly. | The plan's accepted substitution avoids a `state.ts` → `validation.ts` reverse dependency because stub detection reuses `isTemplateUnfilled`. | AC-2 met; no import cycle. |
| Archive directory scans and reroute stub reads propagate errors instead of converting every read failure to “nothing to archive.” | Missing `review.md` still returns `null`, but an unreadable task directory or present artifact is unknown/unsafe and must abort before status mutation. | Strengthens AC-10's fail-closed contract. |
| `skipUnfilledTemplate` is opt-in only at reroute; `reset-code-review` still archives an existing template. | Incorporates the spec-review nit and preserves the reset command's shipped behavior. | AC-3 and AC-4 met. |
| Interpreted AC-3's “no test file edits” as preserving existing reset-code-review test bodies while adding AC-6's separate required test in the same file. | This is the plan's documented nit resolution; the existing test range has no changed assertions. | AC-3 and AC-6 met. |
| Golden regeneration produced no `tests/run-task-prompts.golden.json` diff. | Existing recorded golden fixtures contain no non-advancing exempt sibling; the changed lines are pinned by static and production-sequence tests instead. | AC-8 met; AC-12's permitted empty golden diff observed. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Append-style fresh round-1 review passes `checkPhaseGate`; pre-fix run failed with stale `changes_requested` mismatch. |
| AC-2 | Met | Shared module owns constant, allocator, and numeric lookup; gapped `2`/`10` fixture creates and returns `11` without altering older bytes. Structural `review-prior-` grep has only the shared module plus permitted `spec-review-prior-` hits. |
| AC-3 | Met | Existing reset tests pass unchanged; only its archive call/allocator changed. |
| AC-4 | Met | Pristine scaffold remains byte-identical and creates no archive. |
| AC-5 | Met | Three real reroutes create archives 1, 2, then 3 after archive 1 is deleted; archive 2 remains byte-identical. |
| AC-6 | Met | Real linked-worktree fixture archives only the worktree review and leaves the supervising copy byte-identical. |
| AC-7 | Met | Full- and fast-tier fixtures drop `claude_review`; full tier still drops and fast tier still preserves `codex_spec_review`. |
| AC-8 | Met | Mixed spec-gap production sequence allocates `review-prior-11.md`; both rendered prompts name 11 and reject 10 and the bare review path. Static assertions cover both verdict variants. |
| AC-9 | Met | With stale archival disabled, the regression observed `advanced: true`; with the archive pass restored it reports missing/template evidence and leaves code review pending. |
| AC-10 | Met | Injected second-task rename failure leaves both status files byte-identical, reports task B plus task A's completed archive, preserves task A's content, and leaves task B's source review intact. |
| AC-11 | Met | Human Reroute docs and managed mirror cover numbering, stub skip, two-pass failure behavior, session drop, and binding archived findings. |
| AC-12 | Met | Both dist bundles rebuilt; template mirror is synchronized; golden update run produced the expected empty diff. |
| AC-13 | Met | Lint, type-check, full test suite, build, docs refs, and template sync all pass. |

## Edge Cases Considered

- Non-contiguous and two-digit archive numbering.
- Missing review, pristine scaffold, filled single-round review, and stale multi-round review.
- Repeated reroutes after manual deletion of an older archive.
- Bundle failure after an earlier member has already been archived.
- Full-tier versus fast-tier session cleanup.
- Cold prompt rendering after the process that performed the reset has exited.
- Worktree and supervising checkout both containing same-named task artifacts.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| Red-first stale-round regression | Pass | Pre-fix scoped run: `node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-reroute-preflight.test.ts`; 42 passed / 1 failed as expected with `verdict mismatch: status.json wants 'approved', review.md has 'changes_requested'`. Fixed focused suite: 49 passed. |
| Red-first stale-evidence regression | Pass | Discriminating run with only the new archive pass removed: `node --test --test-name-pattern='reroute removes stale approved review evidence' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-reroute-preflight.test.ts`; failed as expected because evidence advanced (`true !== false`). Restored-fix rerun passed. |
| `npm run lint` | Pass | ESLint completed cleanly after final source/test changes. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full suite: 1,175 tests; 1,174 passed, 0 failed, 1 environment skip. |
| `npm run build` | Pass | Fresh tsup build emitted both tracked bundles; postbuild normalization completed. |
| `npm run docs-refs-check` | Pass | `All refs OK`, including the updated spec manifest and managed docs. |
| `npm run sync-templates:check` | Pass | `All canon-managed files in sync`. |
| Golden regeneration | Pass | `UPDATE_GOLDENS=1` prompt suite passed 35/35 and left the golden JSON byte-unchanged. |
| `git diff --check` | Pass | No whitespace errors after the final grounding pass. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
