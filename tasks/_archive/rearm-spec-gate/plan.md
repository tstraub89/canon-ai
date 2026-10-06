# Plan: rearm-spec-gate

> Written by: Claude | Implemented by: Codex
> Spec: `tasks/rearm-spec-gate/spec.md` (review verdict: approved, no nits)

## Approach

Make `human_spec_gate` a settable field in `taskSet()` (`src/task/index.ts`). Arming (`true`) also clears `full_send` in the same single `writeStatusAtomic` write. Disarming (`false`) is refused on delicate tasks before any write. Correct the `full_send` refusal text, update `printCreatedTask()`, add tests, then update docs and skill text. No orchestrator source changes (AC-11).

### Feasibility check

- **Exists:** `SETTABLE_FIELDS`, `REDIRECT_MESSAGES`, `taskSetValue()`, `taskSet()`, `taskHasStarted()`, `printCreatedTask()` (`src/task/index.ts` lines ~27-32, 162, 1446-1550); `writeStatusAtomic()` (line 110) already calls `deriveTopLevelStatus` (AC-1 "re-derive status" is free). Tests: `captureStdout`, `withTasksRoot`, `writeTask`, `makeStatus`, `readStatusFile` in `tests/task-cli.test.ts`; `makeRerouteStatus`, `runCheckAndRoute`, `readStatus` in `tests/run-task-reroute-preflight.test.ts`. The full-tier banner is `SPEC GATE — Human review required before planning.` (`main.ts` ~3360).
- **Real path:** `canon task set` → `taskCmd` → `taskSet(args)`. Resolves cwd via `resolveTaskCwd` (worktree routing already handled), reads status, then `SETTABLE_FIELD_SET.has(field)` → `taskSetValue` → `writeStatusAtomic` → generic warning if `taskHasStarted`. The `full_send`/`human_spec_gate` redirect branches sit after that block. The orchestrator gate path (`main.ts` full-tier post-`spec_review`) is untouched.
- **Callers:** `taskSetValue` has one caller (`taskSet`). `printCreatedTask` has one caller (`taskNew`, line ~239; `id` is in scope there). `REDIRECT_MESSAGES.full_send` is used only through `taskSetRedirectMessage` in `taskSet`. Other mentions of the old text: only `tests/task-cli.test.ts:603` (`Re-run \`canon run <id>\``) and docs. Grep `src/` for `self-clearing` and `not durable metadata` finds only `REDIRECT_MESSAGES`; re-grep after editing.
- **Tests that can fail:** AC-1/2/3/4/6 tests fail without the change because `human_spec_gate` currently throws the redirect error. AC-5 fails because the old text contains `not durable metadata`. AC-9 fails on the current "Edit … status.json" line. AC-8 passes with no source change (it pins existing behavior) — to make sure it is not vacuous, the fixture must have `humanSpecGate: true`, `taskSize: 'M'` (full tier), `full_send: false`, `specReview: { status: 'done', verdict: 'approved' }`, and a non-`every`-full-send state; the assertions on the banner and on `human_spec_gate: false` can only hold if the gate path ran.
- **Predicates:** `value` parse is `toLowerCase()` ∈ {`true`,`false`}; anything else (`yes`, `1`, empty string) throws `Must be true or false`. The delicate refusal reads `status.delicate === true` (absent/undefined → not delicate). `full_send` check is `status.full_send === true` (absent → no note). The spec_review-done note: `status.phases.spec_review?.status === 'done'` (missing phase entry → not done). `taskHasStarted` = any phase not `pending`. The note/warning matrix (AC-6): arm + spec_review done → note only; arm + started but spec_review not done → generic warning; arm + unstarted → nothing; disarm + anything → generic warning only if started, never the note. Note the AC-6 case "false on spec_review-done task prints neither this note nor the generic warning" conflicts with the generic-warning rule: a spec_review-done task is necessarily started, so for `false` the existing generic warning would print. Spec text says neither. Resolution: for `human_spec_gate`, suppress the generic warning when `spec_review` is done (both values); the arm-case prints the note instead, the disarm-case prints nothing. Recorded in notes as a `[plan]` interpretation.
- **Scope:** every file below is in the spec's Affected Files (`src/task/index.ts`, two test files, `dist/cli/index.js`, `dist/orchestrator/run-task.js`, `docs/pipeline-orchestrator.md` + `templates/` mirror, `docs/decisions.md` (root-only, no mirror — it is not in `CANON_OWNED`), `.claude/skills/canon-spec/SKILL.md` + `templates/` mirror). Do not touch `src/orchestrator/**` or `src/lib/pipeline-policy.ts`.
- **Async/stateful:** synchronous CLI, one read-modify-write. The delicate refusal and invalid-value throw happen before `writeStatusAtomic`, so a refused call leaves the file byte-identical. `full_send` clearing and `human_spec_gate` are set on the same `status` object, so one atomic write. Worktree routing is inherited from `resolveTaskCwd`/`taskStatusFileForCwd`.

## Steps

### 1. `src/task/index.ts` — settable field

1. `SETTABLE_FIELDS`: append `'human_spec_gate'` → `['title', 'task_size', 'delicate', 'worktree', 'base_branch', 'human_spec_gate']`. The unknown-field error's "Settable fields:" list is derived from this array, so AC-7's list update is automatic.
2. `REDIRECT_MESSAGES`: delete the `human_spec_gate` entry. Replace the `full_send` text with something like:
   `'persisted in status.json until `canon run --reroute` clears it (or arming the gate with `canon task set <id> human_spec_gate true` does). Use `canon run --full-send <id>` to enable it; that also clears the spec gate and enforces the delicate→`--force` guard.'`
   It must contain `canon run --full-send` and `--reroute`, and must not contain `not durable metadata`.
3. Delete the `if (field === 'human_spec_gate') { throw … }` branch in `taskSet()`.
4. Make `taskSetValue` return `string[]` of notes to print (default `[]`), or compute from before/after state in `taskSet()` — implementer's choice; the constraints are one `writeStatusAtomic` call and throws before any write. Suggested: return notes.
   Add a case:
   ```ts
   case 'human_spec_gate': {
       const normalized = value.toLowerCase();
       if (normalized !== 'true' && normalized !== 'false') {
           throw new Error(`Error: invalid ${field} '${value}'. Must be true or false.`);
       }
       if (normalized === 'false') {
           if (status.delicate === true) {
               throw new Error(
                   `Error: human_spec_gate cannot be disarmed on delicate task ${taskId}. ` +
                   `Use \`canon run --full-send --force ${taskId}\` to skip the spec gate on a delicate task, ` +
                   `or re-run \`canon run ${taskId}\` to proceed past a gate that already halted.`,
               );
           }
           status.human_spec_gate = false;
           return [];
       }
       status.human_spec_gate = true;
       if (status.full_send === true) {
           status.full_send = false;
           return [`Note: full-send was cleared on task ${taskId} because arming the spec gate re-introduces a human checkpoint. Run \`canon run --full-send ${taskId}\` to re-enable it.`];
       }
       return [];
   }
   ```
   Use the `Must be true or false` wording the existing `delicate`/`worktree` case uses (shared regex in tests). Confirm `StatusJson` types `full_send`/`human_spec_gate` as optional booleans; if `full_send` is missing from the type, check `.canon/templates/status.json` and the interface, but do not add schema fields.
5. In `taskSet()`'s settable branch, after the write, print notes, then the warning logic:
   ```ts
   const specReviewDone = status.phases.spec_review?.status === 'done';
   if (field === 'human_spec_gate' && specReviewDone) {
       if (status.human_spec_gate === true) {
           console.log(`Note: spec_review is already done on task ${id}, so the spec gate fires only if spec_review runs again — via a full-tier \`canon run --reroute ${id}\`.`);
       }
   } else if (taskHasStarted(status)) {
       console.log(`Warning: ${field} on task ${id} takes effect on the next canon run.`);
   }
   ```
   The note text must contain `full-tier` and `canon run --reroute <id>`, must not contain `reset-spec-review`, and the full-send note prints before it. Keep the write before any console output.
6. `printCreatedTask(taskDir, baseBranch)` → add an `id` param (update the one call at ~239). Replace the `Edit ${taskDir}/status.json …` line with `` `  Adjust with: canon task set ${id} <field> <value>` `` (names no `status.json` edit). The defaults line stays. Check that every field named in "Defaults" is settable (`task_size`, `delicate`, `human_spec_gate`, `base_branch` — yes, base_branch only before branching, which is true at creation).

### 2. `tests/task-cli.test.ts`

- Update the refusal test (~line 596-618): remove the `human_spec_gate` assertion; add `assert.throws(() => taskSet([taskId, 'full_send', 'true']), /--reroute/)` and `assert.doesNotMatch(message, /not durable metadata/)` (catch the error and inspect its message); change the unknown-field regex to `/Settable fields: title, task_size, delicate, worktree, base_branch, human_spec_gate/`.
- New tests (use `withTasksRoot`, `writeTask`, `makeStatus`, `captureStdout`, `readStatusFile`):
  1. AC-1: non-delicate task, `human_spec_gate` set to `true`, then `FALSE`/`TRUE` casing → file value, `updated` stamped, `status` derived; `yes` throws `/Must be true or false/` and file is byte-identical.
  2. AC-2: `full_send: true` + arm → `human_spec_gate: true`, `full_send: false`; stdout matches `/full-send was cleared/` and `/canon run --full-send <id>/` with the real id. `full_send: false` + arm → stdout has no `full-send`.
  3. AC-3: `full_send: true` + `false` → `full_send` still `true`, `human_spec_gate: false`.
  4. AC-4: `delicate: true` + `false` → throws matching `canon run --full-send --force <id>`, file byte-identical; `true` on delicate succeeds.
  5. AC-6 (four cases): spec_review `done` + arm → note with `full-tier` and `canon run --reroute <id>`, no `reset-spec-review`, no `takes effect on the next canon run`; spec_review `done` + disarm → neither note nor warning; started task with spec_review not `done` (e.g. `implement: in_progress` w/ spec_review pending) + both values → generic warning; unstarted → neither.
  6. Worktree routing for the new field (patterns.md companion rule): follow `task set routes writes to the task worktree status.json` (~line 469) with `human_spec_gate`, asserting only the worktree copy changes.
  7. AC-9: in the `task new` test (or a sibling), capture `taskNew` stdout and assert it matches `/canon task set new-task <field> <value>/` and does not match `/status\.json/`.
- Shape fixtures with explicit `phases` as the existing `task set warns only after a task has started` test does.

### 3. `tests/run-task-reroute-preflight.test.ts` (AC-8)

Add, right after the `checkAndRoute lets approved reroute spec_review flow through…` test (~line 1594), a sibling test: same `makeRerouteStatus(taskId, 'task/task-a', 1, { worktree: false, humanSpecGate: true, specReview: { status: 'done', verdict: 'approved' }, plan: { status: 'pending' }, implement: { status: 'pending', rerouted: true } })`. Assert `result.status === 0`, `result.stdout` matches `/SPEC GATE — Human review required before planning\./`, and `readStatus(...).human_spec_gate === false`. `makeRerouteStatus` already sets `full_send: false`. Must pass with no orchestrator change; if it does not, stop and record a `[plan]`/`[implement]` note rather than editing `src/orchestrator/`.

### 4. Docs and skills (edit root copies only)

- `docs/pipeline-orchestrator.md`:
  - `set` row (line ~120): add `human_spec_gate` as settable (`true` arms the gate and clears `full_send` with a note; `false` disarms and is refused on delicate tasks, which must use `canon run --full-send --force`); remove `human_spec_gate → re-run canon run` from the Redirected list; update the `full_send` redirect wording to match.
  - `human_spec_gate` field row (line ~188): a human can re-arm with `canon task set`, so `false` means "fired, pre-cleared, or disarmed".
  - §"Spec gate is a single-use latch" (~355-367): same `false` semantics; add that a human can re-arm with `canon task set <id> human_spec_gate true`; an armed latch halts after a full-tier reroute's amendment review and never fires on a fast-tier reroute (fast-tier reroutes re-enter at `implement`).
  - Reroute paragraph (line ~473): "…flows through to `plan` without re-arming the human spec gate…" → say it flows through unless the operator re-armed the gate first, in which case it halts at the gate.
- `docs/decisions.md` (root-only; no mirror): full-send Decision sentence → "…cleared by `--reroute` or by arming the gate via `canon task set`."
- `.claude/skills/canon-spec/SKILL.md`: Phase 5 step 2 → `canon task set TASK-ID task_size <XS|S|M|L|XL>` / `canon task set TASK-ID delicate <true|false>`, no `human_spec_gate` edit (the `canon task new` default is already `true`); step 4 → `canon task phase TASK-ID spec done`; Phase 6 XS step 3 → replace the trailing "set `human_spec_gate: false` in `status.json`" sentence with a `canon task set TASK-ID human_spec_gate false` command in the bash block. Verify with `grep -nE 'Edit .*status\.json|in .status\.json' .claude/skills/canon-spec/SKILL.md` → no results.
- Then `npm run sync-templates` and `npm run sync-templates:check`. Mirrors needed: `templates/docs/pipeline-orchestrator.md`, `templates/.claude/skills/canon-spec/SKILL.md`. Do not add a mirror for `docs/decisions.md`.

### 5. Build and validate

Run `npm run build` (updates `dist/cli/index.js` and `dist/orchestrator/run-task.js`), then `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`. Greps: `grep -rn "not durable metadata" src/` and `grep -n "self-clearing" src/` → empty. `git diff --name-only main` must list nothing under `src/orchestrator/` and not `src/lib/pipeline-policy.ts` (AC-11). In a Claude worktree, `npm ci` first; `run-task-safety` may have one known unrelated failure (linked-worktree guard message) only if untouched. A `skipped` worktree test in the handoff counts as unverified, not passing.

## Handoff Changes table notes

List the two `templates/` mirrors and both `dist/` bundles in the handoff Changes table (per patterns.md mirror rule). `docs/decisions.md` has no mirror row.
