# Spec: rearm-spec-gate — Make the spec gate settable via canon task set

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

There is no command that turns the human spec gate back on for a task. `human_spec_gate` is a single-use latch: the orchestrator flips it to `false` when the gate halts (`src/orchestrator/main.ts` full-tier post-`spec_review` check; `src/orchestrator/phases/spec-review.ts` fast-tier entry check), and `canon run --full-send` pre-clears it via `enableFullSend()`. The only way to arm it again is to hand-edit `status.json`, because `canon task set <id> human_spec_gate …` is refused by `taskSet()` in `src/task/index.ts` with a redirect message ("the spec gate is self-clearing…") that only covers the clearing direction.

Canon's own `canon-spec` skill depends on hand edits of `status.json`: Phase 5 step 2 tells the author to edit it to set `task_size`, `delicate`, and `human_spec_gate: true` (the first two are already settable via `canon task set`; the third is already the `canon task new` default); Phase 5 step 4 tells the author to set `spec.status` to `"done"` by hand (`canon task phase <id> spec done` already does this); and Phase 6 "XS tasks" step 3 tells the author to hand-edit `human_spec_gate: false`. `canon task new` also tells the operator to "Edit tasks/<id>/status.json to adjust before running the pipeline."

Re-arming alone is not sufficient. `full_send` is persisted in `status.json` and is cleared only by `--reroute` (`main.ts`, the full_send-cleared branch in the reroute path). Both gate checks skip the gate when every task in the invocation has `full_send === true`, so a re-armed gate on a full-send task never fires. `full_send` cannot be cleared via `task set` either — its refusal message in `REDIRECT_MESSAGES` claims it is "a per-run stance, not durable metadata," which is false. One concrete way to land in that state by accident: `canon run --full-send <id>` on a delicate task without `--force` dies at the delicate guard *after* `enableFullSend()` has already persisted `full_send: true` / `human_spec_gate: false` (`main.ts`, the `--full-send on delicate task … requires --force` check), leaving the task gate-less with no command to undo it.

The main real-world use is re-arming before a full-tier `canon run --reroute`: the reroute resets `spec_review` to pending and the amended spec flows back through the same full-tier post-`spec_review` gate check (which has no reroute-specific skip), so an armed latch halts after the amendment's review. Today that is reachable only by hand-editing.

## Decision

`human_spec_gate` becomes a settable field of `canon task set`, accepting `true` / `false` (case-insensitive, same parsing as `delicate`).

- `true` arms the gate. If the task has `full_send: true`, the same write also sets `full_send: false` and prints a note saying full-send was cleared because arming the gate re-introduces a human checkpoint, and that `canon run --full-send <id>` re-enables it. (Arming the gate exits full-send entirely — the qa→draft-PR auto-open tail and other `full_send` readers stop applying too — consistent with how `--reroute` already clears `full_send` with a warning.)
- When `true` is set on a task whose `spec_review` phase is already `done`, the command prints a note instead of the generic "takes effect on the next canon run" warning: `spec_review` is already done, so the gate fires only if `spec_review` runs again — via a full-tier `canon run --reroute <id>`. The write still happens. The note names no other recovery command.
- `false` disarms the gate and changes nothing else — **except on a delicate task, where `false` is refused** and the file is left unchanged. The refusal points at `canon run --full-send --force <id>` as the sanctioned way to skip the gate on a delicate task, and at re-running `canon run <id>` to proceed past a gate that already halted. This keeps today's friction: the only sanctioned gate skip on a delicate task stays behind `--force`. (The only in-repo caller of `false` — the `canon-spec` XS step — is non-delicate by definition.)
- The `full_send` refusal message is corrected to describe `full_send` as persisted in `status.json` until `--reroute` clears it (or arming the gate does), still redirecting enable-side writes to `canon run --full-send <id>`.

## Non-Goals

- No way to set `full_send` via `canon task set` — `canon run --full-send` remains the only enable path, and clearing stays a side effect of `--reroute` or arming the gate. AC-4 pins the refusal.
- No change to when or how the orchestrator fires or consumes the gate, and no fix to the delicate guard's persist-before-die ordering: no edits to `src/orchestrator/main.ts`, `src/orchestrator/phases/spec-review.ts`, or `src/lib/pipeline-policy.ts` (AC-11). Arming via `task set` is the recovery for that state.
- No approval record, approver identity, or spec digest for the gate (BACKLOG item "Bind the human spec gate to an explicit approval record and spec digest").
- No fast-tier reroute re-arming: fast-tier reroutes re-enter at `implement` and never reach the gate; that stays as-is and is documented, not changed.
- No new `status.json` fields and no schema change.

## Acceptance Criteria

- [ ] AC-1: `canon task set <id> human_spec_gate true` and `… false` (any case, e.g. `TRUE`) on a non-delicate task write the boolean to the task's `status.json` (the worktree copy when the task lives in a worktree, same routing as other settable fields), stamp `updated`, and re-derive top-level `status`. An invalid value (e.g. `yes`) throws `Must be true or false` and leaves the file byte-identical. Verified by new unit tests in `tests/task-cli.test.ts`.
- [ ] AC-2: Setting `human_spec_gate true` on a task with `full_send: true` leaves `human_spec_gate: true` and `full_send: false` in the same write, and stdout contains a note that full-send was cleared and names `canon run --full-send <id>` (with the real task id) as the way to re-enable it. Setting `true` on a task with `full_send: false` prints no full-send note. Verified by unit tests asserting both file state and captured stdout.
- [ ] AC-3: Setting `human_spec_gate false` on a non-delicate task with `full_send: true` leaves `full_send: true` untouched. Verified by unit test.
- [ ] AC-4: Setting `human_spec_gate false` on a task with `delicate: true` throws, leaves the file byte-identical, and the error names `canon run --full-send --force <id>` (real id). Setting `human_spec_gate true` on a delicate task succeeds. Verified by unit tests.
- [ ] AC-5: `canon task set <id> full_send <any>` is still refused and leaves the file unchanged. The message contains `canon run --full-send` and `--reroute` and no longer contains `not durable metadata`; `grep -rn "not durable metadata" src/` returns no results. Verified by updating the existing refusal test (`task set rejects guarded, redirected, immutable, and unknown fields with category-correct messages`) plus the grep.
- [ ] AC-6: Setting `human_spec_gate true` on a task whose `phases.spec_review.status` is `done` prints a note containing `full-tier` and `canon run --reroute <id>` (real id), does not contain `reset-spec-review`, and does not print the generic `takes effect on the next canon run` warning. Setting `human_spec_gate false` on such a task prints neither this note nor the generic warning. Setting either value on a started task whose `spec_review` is not `done` prints the existing generic warning; on an unstarted task neither prints. Verified by unit tests covering these four cases.
- [ ] AC-7: `human_spec_gate` no longer appears in `REDIRECT_MESSAGES` or in any refusal branch of `taskSet()` other than the AC-4 delicate refusal, and the unknown-field error's "Settable fields:" list includes `human_spec_gate`. The existing refusal test is updated accordingly (its `human_spec_gate` assertion and its `Settable fields:` regex). Verified by unit test and by `grep -n "self-clearing" src/` returning no results.
- [ ] AC-8: A new test in `tests/run-task-reroute-preflight.test.ts`, sibling to `checkAndRoute lets approved reroute spec_review flow through to plan without re-arming the spec gate`, builds the same rerouted-and-approved `spec_review` state but with the gate armed, and asserts `checkAndRoute` prints the full-tier `SPEC GATE` banner, exits 0, and leaves `human_spec_gate: false`. This pins the behavior the docs will advertise; it must pass with no orchestrator source change.
- [ ] AC-9: `canon task new` output no longer tells the operator to edit `status.json`; it points to `canon task set <id> <field> <value>` (with the real id) for adjusting the listed defaults. Verified by an assertion in `tests/task-cli.test.ts` on captured `taskNew` stdout.
- [ ] AC-10: Docs and skills restate the new contract with no stale text:
  - `docs/pipeline-orchestrator.md` `set` row lists `human_spec_gate` as settable (with the `full_send`-clearing side effect on `true` and the delicate refusal on `false`) and drops the `human_spec_gate → re-run canon run` redirect; the `human_spec_gate` field row and §"Spec gate is a single-use latch" say a human can re-arm the latch with `canon task set`, so `false` means "fired, pre-cleared, or disarmed" rather than proof the gate fired; the latch section notes that an armed latch halts after a full-tier reroute's amendment review and never fires on a fast-tier reroute; the reroute paragraph ("…flows through to `plan` without re-arming the human spec gate…") says it halts if the operator re-armed the gate first.
  - `docs/decisions.md` §"Full-send mode collapses the spec gate and human_review stop behind one explicit flag" Decision says `full_send` is cleared by `--reroute` or by arming the gate via `canon task set`.
  - `.claude/skills/canon-spec/SKILL.md`: Phase 5 step 2 uses `canon task set` for `task_size` / `delicate` and drops the `human_spec_gate: true` edit; Phase 5 step 4 uses `canon task phase <id> spec done`; Phase 6 "XS tasks" step 3 uses `canon task set <id> human_spec_gate false`. Structural check: `grep -nE 'Edit .*status\.json|in .status\.json' .claude/skills/canon-spec/SKILL.md` returns no results.
  - `templates/` mirrors are synced: `npm run sync-templates:check` passes.
- [ ] AC-11: Scope bound: `git diff --name-only main` lists no file under `src/orchestrator/` and no `src/lib/pipeline-policy.ts`.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/task/index.ts` | Add `human_spec_gate` to `SETTABLE_FIELDS` with a `taskSetValue` case (true/false; `true` clears `full_send` and reports it; `false` refused on delicate tasks); spec_review-done note on `true` in `taskSet()`; remove `human_spec_gate` redirect entry + refusal branch; correct `full_send` redirect text; `printCreatedTask()` hint points at `canon task set <id>` (needs the task id passed in) |
| `tests/task-cli.test.ts` | Update the guarded-fields refusal test; add tests for AC-1/2/3/4/6/9 |
| `tests/run-task-reroute-preflight.test.ts` | Add armed-gate reroute halt test (AC-8) |
| `dist/cli/index.js` | Rebuilt output of `src/task/index.ts` changes |
| `dist/orchestrator/run-task.js` | Rebuilt output — this bundle also inlines `src/task/index.ts` |
| `docs/pipeline-orchestrator.md` | `set` row, `human_spec_gate` field row, §"Spec gate is a single-use latch", reroute paragraph (AC-10) |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror |
| `docs/decisions.md` | Full-send decision: clearing paths (AC-10) |
| `.claude/skills/canon-spec/SKILL.md` | Phase 5 steps 2 and 4, Phase 6 "XS tasks" step 3 use canon commands (AC-10) |
| `templates/.claude/skills/canon-spec/SKILL.md` | Synced mirror |

### Interaction Dependencies

- Orchestrator gate checks (full-tier post-`spec_review` in `main.ts`, fast-tier entry in `phases/spec-review.ts`) read the latch; unchanged, but their behavior is what this field now controls.
- `full_send` readers (code_review scope, qa→PR tail, spec-review prompt variant) stop applying when arming clears `full_send` — intended.
- `/canon-status` and `/canon-spec-review` skills read `human_spec_gate`; their rows remain accurate.

### Data Model Changes

None. Both fields already exist in `status.json`.

### Implementation Notes (non-binding; owned by plan/implement)

`taskSetValue` currently returns `void` and the generic warning lives in `taskSet()`; the note/side-effect reporting can be returned from the case or computed in `taskSet()` from before/after state — implementer's choice, provided the write is a single atomic `writeStatusAtomic` call and the delicate refusal throws before any write.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` (commit `dist/` deltas)
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A, no UI surface

## Docs Impact

`docs/decisions.md` changes in this task (AC-10). `docs/codebase-map.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/product-context.md`: none expected.

## Known Risks

- **Clearing `full_send` is broader than the gate.** It also stops the auto-open draft PR after QA and changes code_review's full-send scope. Intended (approved in scoping); the printed note must make the exit from full-send explicit so it isn't a silent stance change.
- **Inert arming.** Arming on a task past `spec_review` does nothing until a full-tier reroute; on a fast-tier task it never fires again. The note (AC-6) must name only the full-tier reroute — `reset-spec-review` is excluded because on a task past `plan` it re-reviews the spec but leaves plan/implement marked done, so the re-reviewed spec would not be re-implemented.
- **Gate-skip friction on delicate tasks.** Without the AC-4 refusal, `false` would be a no-`--force` way for an agent (with `Bash(canon *)` pre-approved) to skip the only human checkpoint on a delicate task. The refusal must throw before any write.
- **Doc semantics of `false`.** The latch section currently says `false` proves the gate fired. After this change, `false` may also mean a human disarmed it; stale wording there would mislead operators auditing a task (AC-10).
- **Bundles.** Arming one task in a bundle re-engages the gate for the whole invocation (gate check is `some`, full-send skip is `every`); clearing that task's `full_send` is what makes this effective in an otherwise all-full-send bundle. Existing documented bundle rule covers it.

## Human Test Plan

1. Create a throwaway non-delicate task, start a full-send run on it, and stop the run once it begins spec review. Then turn the spec gate back on with the task set command.
2. Expected: the command says full-send was turned off and how to turn it back on; the task now shows the gate on and full-send off.
3. Turn the gate off again with the same command. Expected: gate off, nothing else changes.
4. Mark the task delicate and try to turn the gate off. Expected: refused, pointing at the forced full-send run as the only way to skip the gate on a delicate task.
5. On a task whose spec review already finished, turn the gate on. Expected: a note explains the gate only stops the run again on a full-tier reroute.
6. Try to set full-send with the task set command. Expected: refused, pointing at the full-send run option, with wording that says full-send stays on until a reroute (or arming the gate) clears it.
7. Create a new task. Expected: the output points at the task set command for adjusting defaults, not at editing the status file.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — feature gap
- [x] (Refactors) N/A
