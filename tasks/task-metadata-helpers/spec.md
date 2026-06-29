# Spec: task-metadata-helpers — `canon task set` metadata helper

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`status.json` carries several task fields an operator legitimately wants to change after `canon task new` — most commonly `task_size` (resize after scoping), `delicate`, `worktree`, `base_branch`, and `title`. None of these has a `canon task` helper. The only existing way to change them is to hand-edit `status.json`, which directly contradicts the project's "prefer `canon task` helpers over hand-editing `status.json`" rule (AGENTS.md, `docs/pipeline-orchestrator.md`).

The gap also has a sharper edge: when an operator reaches for a hand-edit on a field that is *not* freely settable — a guarded run-stance (`full_send`), a self-clearing latch (`human_spec_gate`), a derived pointer (`status`), or orchestrator-owned nested state (`phases`/`sessions`/`canon`) — there is no helper to steer them to the sanctioned mechanism, so they edit raw JSON and risk bypassing the guard that the sanctioned path enforces. Concretely, `full_send` set by hand skips the delicate→`--force` acknowledgment that lives only in the `canon run --full-send` invocation path ([main.ts:3268](../../scripts/run-task/main.ts:3268)), and `enableFullSend()` ([main.ts:1072](../../scripts/run-task/main.ts:1072)) couples `full_send=true` with `human_spec_gate=false` — a raw write desyncs that pair.

This is a new-subcommand feature, not a bug fix; there is no failure mechanism to reproduce.

## Decision

Add a `canon task set <id> <field> <value>` subcommand that operates on **flat top-level scalar fields** of `status.json`. Every field falls into exactly one of three outcomes; the field's name alone determines which:

1. **Settable** — `title`, `task_size`, `delicate`, `worktree`, `base_branch`. The value is validated, then written via the existing atomic writer. These are durable, freely-mutable metadata with no runtime guard.
2. **Recognized → refused with guidance** — the command exits non-zero, writes nothing, and prints the sanctioned mechanism for that field:
   - `full_send` → "a per-run stance, not durable metadata. Enable it with `canon run --full-send <id>`, which also clears the spec gate and enforces the delicate→`--force` guard."
   - `human_spec_gate` → "the spec gate is self-clearing. Re-run `canon run <id>` to proceed past it, or `canon run --full-send <id>` to skip it entirely."
   - `status` → "derived from phase states. Use `canon task phase <id> <phase> <status>`."
   - `branch` → "load-bearing git identity; retargeting it desyncs the worktree. Not settable via `canon task set`."
   - `phases`, `sessions`, `canon`, `escalations` → "nested orchestrator-owned state. Use `canon task phase` / `reset-spec-review` / `reset-code-review` / `accept`; review/iteration counters are durable signal and must not be hand-reset."
3. **Immutable → refused** — `id`, `created`, `updated`, and any `_`-prefixed inline-doc key. Refused with a terse "field is immutable / not editable" message.

Any other (unknown) field name produces a generic error that lists the settable field names and notes the redirected ones exist. The redirect map is the load-bearing value: whatever field an operator reaches for, `set` either does it or names the correct command — nobody is bounced to a raw `status.json` edit.

When the target task has progressed past `pending` (any phase `in_progress` or `done`), a settable write still succeeds but prints a warning that metadata is read at dispatch time and the change will not take effect until the next `canon run`.

## Non-Goals

- **No new `status.json` fields and no schema change.** This only reads/writes existing top-level fields.
- **No nested/dotted-path support** (`set <id> phases.spec_review.iterations 0` is not supported). The flat-scalar contract is what keeps the field taxonomy bounded; nested objects are owned by dedicated commands.
- **No write path for any redirected or immutable field**, including via `--force`. `set` never becomes an alternate route into guarded state. (Enabling full-send stays `canon run --full-send`; clearing the gate stays the self-clearing re-run.)
- **No retroactive re-dispatch.** Changing `task_size`/`delicate` mid-pipeline does not re-run completed phases; the warning documents this and that is the whole mitigation.
- Not building `canon task accept-spec` (removed from the backlog — the gate is self-clearing, see Interaction Dependencies).

## Acceptance Criteria

- [ ] AC-1: `canon task set <id> task_size L` updates `task_size` to `L` in `tasks/<id>/status.json`, re-derives the top-level `status` pointer, and refreshes the top-level `updated` timestamp to `today()` — matching every other mutator in `src/task/index.ts` ([index.ts:226,438,534,737,954,1044,1087](../../src/task/index.ts)) — via the existing atomic write path (`writeStatusAtomic`). Verified by a test that runs the handler against a fixture task and asserts the on-disk field changed, `status.status` stays consistent with phase state, and `status.updated` was set to today's stamp.
- [ ] AC-2: Each settable field validates its value: `task_size` is rejected unless it is one of `XS`/`S`/`M`/`L`/`XL` (reuse the `TaskSize` domain from `scripts/pipeline-policy.ts`); `delicate` and `worktree` accept only `true`/`false` (case-insensitive) and reject anything else; `base_branch` reuses the existing branch-name validation shape — the rejections in `validateBranchField` (`scripts/run-task/state.ts:117-130`): leading-dash (flag-like), control characters / whitespace, and the `:` refspec separator — **and additionally rejects an empty/whitespace-only string** (unlike the parse-time validator, which tolerates empty as "default base"); `title` rejects an embedded newline (mirroring `taskNew`'s single-line rule). Verified by tests asserting a descriptive throw/non-zero exit for each invalid value — including a `base_branch` case for each rejected shape (empty, leading-dash, embedded space, embedded `:`) — and a successful write for a valid one.
- [ ] AC-3: The guarded run-stance/gate fields — `canon task set <id> full_send true` and `canon task set <id> human_spec_gate false` — each exit non-zero, write nothing to `status.json`, and print a message naming the sanctioned mechanism (`canon run --full-send` / re-run `canon run`). Verified by tests asserting the file is byte-unchanged **and** the message contains the named redirect target. (Called out separately from AC-4 because these are the fields whose raw write would bypass a guard.)
- [ ] AC-4: The remaining recognized fields refuse with a **category-correct message**, not merely a no-op:
  - Redirect group (`status` → `task phase`, `branch` → git-identity/not-via-set, and `phases`/`sessions`/`canon`/`escalations` → their owning commands): each exits non-zero, writes nothing, and the message names the correct sanctioned command for that group.
  - Immutable group (`id`, plus one of `created`/`updated`/a `_`-prefixed key): each exits non-zero, writes nothing, and the message states the field is immutable/not editable — text that is **distinct from** the redirect guidance.
  Verified by tests per representative field asserting both the file is byte-unchanged AND the message matches the category's expected contract (redirect target named vs. immutable reason named), so an implementation that prints a generic or wrong-category message fails.
- [ ] AC-5: An unknown field (`canon task set <id> nope 1`) exits non-zero with a message that lists the settable field names. Verified by a test asserting the error text enumerates `task_size`/`delicate`/`worktree`/`base_branch`/`title`.
- [ ] AC-6: Setting a settable field on a task whose top-level `status` is past `pending` (e.g. `implement` in progress) still writes the value but emits a warning that it takes effect on the next `canon run`; setting it on a `pending` task emits no such warning. Verified by two tests (warning present / absent) capturing stdout.
- [ ] AC-7: `set` is registered: it appears in `taskCmd()`'s dispatch and in `usage()` (`src/task/index.ts`), and in the `canon task` help text (`src/cli/index.ts`). Verified by a test asserting the dispatcher routes `set` to the handler, plus the structural doc/help assertions below.
- [ ] AC-8: Operator-facing surfaces document the new subcommand: the task-subcommand table in `docs/pipeline-orchestrator.md` gains a `set` row (covering the three-category behavior and the redirect rationale), and the command list in `AGENTS.md` (line 37) adds `set`. The generated mirror `templates/docs/pipeline-orchestrator.md` is regenerated by the pre-commit sync hook and declared as a generated artifact.
- [ ] AC-9: Full suite green: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (committed `dist/` matches a fresh build), `npm run sync-templates:check`, `npm run docs-refs-check`.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/task/index.ts` | Add `taskSet(args)` handler implementing the three-category field taxonomy + value validation + past-`pending` warning + `updated`-timestamp refresh (`status.updated = today()`); add a `case 'set':` branch in `taskCmd()`; add the `set <TASK-ID> <field> <value>` line to `usage()`. Reuse `writeStatusAtomic`, the `TaskSize` domain, `today()`, and the existing `readJsonFile<StatusJson>` pattern. |
| `scripts/run-task/state.ts` | `validateBranchField` (lines 117-130) is currently module-private. To reuse it for `base_branch` validation (AC-2), export it (or extract a shared validator); the `set` handler must apply the same leading-dash / control-char / `:` rejections plus an empty-string rejection. If the implementer mirrors the logic inline instead of exporting, the duplication must be justified — prefer export to keep a single validation home. |
| `src/cli/index.ts` | Add `canon task set` to the `canon task subcommands` help block. |
| `tests/task-cli.test.ts` | Add tests covering AC-1 through AC-7 using the existing `withTasksRoot` / `makeStatus` / `captureStdout` harness (direct handler calls). |
| `tests/cli.test.ts` | Extend the top-level `canon --help` test to assert the new `set <id> <field> <value>` subcommand is listed (AC-7 CLI-help registration). |
| `docs/pipeline-orchestrator.md` | Add a `set` row to the task-subcommand reference table (near the `reset-spec-review` / `reset-code-review` rows ~line 119). |
| `AGENTS.md` | Add `set` to the `canon task` command list (line 37). Not canon-managed — no template mirror. |
| `templates/docs/pipeline-orchestrator.md` | Generated artifact — regenerated by the pre-commit sync hook from the `docs/` edit. Declared here and in the handoff Changes table per managed-doc mirror rule. |
| `dist/cli/index.js` | Generated artifact — `npm run build` rewrites it from the `src/**` changes. |

### Interaction Dependencies

- **`human_spec_gate` lifecycle** — the gate is a self-clearing one-shot latch: the orchestrator sets it `false` itself when it halts at the spec gate ([main.ts:3017](../../scripts/run-task/main.ts:3017), [spec-review.ts:59](../../scripts/run-task/phases/spec-review.ts:59)) and the operator resumes by re-running `canon run`. `set` must therefore *redirect* on `human_spec_gate`, never write it. This is why the originally-paired `canon task accept-spec` subcommand was dropped.
- **`full_send` guard + coupling** — `enableFullSend()` couples `full_send=true` with `human_spec_gate=false`, the delicate→`--force` guard lives in the `--full-send` invocation path, and `full_send` auto-clears on reroute ([main.ts:2407](../../scripts/run-task/main.ts:2407)). `set` redirects rather than forking that safety surface (patterns.md "route through the existing safety queue").
- **Mid-pipeline reads** — `task_size`/`delicate`/`worktree`/`base_branch` are read into pipeline state at dispatch; the past-`pending` warning exists because a late edit is silently inert until the next run.
- **`canon` provenance stamp (sibling task `canon-snapshot-robustness`)** — the nested `canon` block (including `upstream_repo`) is auto-stamped by `captureCanonSnapshot()` and, per the sibling task, becomes overridable via the `CANON_UPSTREAM_REPO` env var. `set` therefore refuses `canon` as nested orchestrator-owned state and never offers a write path into it; an operator wanting to correct `upstream_repo` uses the env override, not `set`. The two tasks both write `status.json` but touch disjoint regions (flat top-level scalars vs. the nested `canon` stamp) and do not collide.

### Data Model Changes

None. No new fields, no shape changes. Reads and writes existing top-level `status.json` scalars only.

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| Canon-managed template sync | sync-templates:check |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — `src/**` change rewrites `dist/cli/index.js`; committed `dist/` must match a fresh build
- [x] `npm run sync-templates:check` — `docs/pipeline-orchestrator.md` is canon-managed; mirror must stay aligned
- [x] `npm run docs-refs-check` — touches `docs/` and `AGENTS.md`

## Docs Impact

- `docs/pipeline-orchestrator.md` — the task-subcommand reference table goes stale without the `set` row (updated in this task, not deferred to QA).
- Other protected docs (`architecture.md`, `codebase-map.md`, `decisions.md`, `patterns.md`, `product-context.md`): no impact — `codebase-map.md` already points task helpers at `src/task/index.ts`, and no new pattern/decision is introduced.

## Known Risks

- **`worktree` flip after a worktree exists** — setting `worktree false` (or `true`) on a task that has already created its worktree sibling does not move or clean up the existing worktree; the field only affects the next dispatch. The past-`pending` warning covers this, but a `worktree` change specifically can strand a worktree directory. The warning text should be general (covers all settable fields); operators flipping `worktree` mid-task own the git consequence, exactly as they do today when hand-editing.
- **Boolean parsing strictness** — accepting only `true`/`false` (not `1`/`yes`/`on`) is intentional to match the JSON shape; tests must assert the rejected forms so the parser doesn't silently widen.
- **Redirect/immutable list drift** — if a future `status.json` field is added, it falls through to the generic unknown-field error until it is categorized. That is a safe default (no write), but the redirect list should be reviewed when the schema grows. Not a regression risk for this task.

## Human Test Plan

1. Create a task and check its size, then change it: run the size-set command and confirm the task now reports the new size in `canon task status`.
2. Try to set an invalid size (e.g. "Medium"): confirm the command refuses with a clear message and the task is unchanged.
3. Try to turn on full-send through the setter: confirm it refuses and tells you to use the full-send run flag instead, and the task is unchanged.
4. Try to set the task's status or id: confirm it refuses and points you at the right command (or says the field can't be changed).
5. Change a task's size after it has already started running: confirm the change is accepted but you're warned it won't take effect until the next run.
6. Expected: every field you reach for is either changed for you or answered with the correct alternative — you never have to hand-edit the raw task settings yourself.

## Amendment

Two PR-level Codex reviews (PR #184) surfaced distinct-class edge cases the original "settable" model under-specified: (1) extra positional args were silently dropped (`canon task set <id> title New title` wrote `title="New"` and discarded the rest), and (2) flipping `worktree` after a branch is recorded bricks the task — `resolveTaskCwd` (`scripts/run-task/state.ts`) `die()`s with "Worktree … expected but missing" when it sees `worktree:true` + a recorded `branch` + no on-disk worktree, blocking every later `canon task`/`canon run`. Rather than patch field-by-field, this amendment refines the field-mutation safety model into two classes.

### Refined field-mutation model

Settable fields split by whether a change is safe once the task's topology is committed (`status.branch` is non-empty):

- **Metadata (safe anytime)** — `title`, `task_size`, `delicate`: freely settable; the existing past-`pending` soft warning stands (read at dispatch; a stale edit only fails to apply until the next run — recoverable, non-corrupting).
- **Topology (locked once branched)** — `worktree`, `base_branch`: settable only while `status.branch` is empty (the pre-branch config window). Once a branch is recorded, a `set` on these fields is **rejected** (no write): a `worktree` flip bricks `resolveTaskCwd`; a `base_branch` change retargets `--pr`/`--ship` away from the base the branch was cut from (wrong-base PR / base-drift).

### Lookup path and scope (resolves the amendment-review finding)

The guard reads `status.branch` from the same `status.json` that `canon task set` already resolves for the task — the resolution `taskSet` performs today (`resolveTaskCwd` → REPO_ROOT for a non-worktree task, or the existing worktree for a worktree task). This read is reachable for every state `set` can legitimately operate on, because the guard **rejects the topology change before writing**: a `set`-guarded task therefore never transitions *into* the unresolvable `worktree:true` + recorded-branch + no-worktree state. In the pre-transition state the field still holds its old value, so `resolveTaskCwd` does not `die()` and the guard runs.

The lock is **scoped to reachable tasks**. A task already hand-edited into the unresolvable state (precisely the state `set` exists to prevent) cannot be resolved by `resolveTaskCwd` and is out of scope for `set`-based recovery — `canon task set` is not the recovery tool for it (restore `status.json` by hand or recreate the task). AC-A2 guarantees `set` never *creates* the bricked combination; it does not claim to *un-brick* a hand-corrupted one. This deliberately does not widen `taskSet`'s status lookup or touch `resolveTaskCwd` — keeping the change to the field-mutation guard, not the resolver (the resolver's bundle-secondary behavior is a separate tracked issue).

### Amended Acceptance Criteria

- [ ] AC-A1: `canon task set` rejects more than three positional args (`args.length > 3`) with an "unexpected argument" error hinting to quote multi-word values — matching `taskNew`'s reject-unexpected-positional contract — instead of silently writing a truncated value. Verified by a test asserting the throw and that `status.json` is byte-unchanged.
- [ ] AC-A2: For a **reachable** task (one `resolveTaskCwd` resolves — i.e. every state reachable without a prior hand-edit into the bricked combination, per "Lookup path and scope"), setting a **topology field** (`worktree`, `base_branch`) when `status.branch` is non-empty exits non-zero, writes nothing, and prints an error naming the field, the recorded branch, and why it is locked (topology committed once branched; recovery is recreate-the-task or manual migration). Because the rejection happens before the write, the guarded transition (e.g. `worktree:false → true` on a branched task) cannot itself create the unresolvable state. Verified by per-field tests: rejected when `branch` is set, still succeeds when `branch` is empty (pre-branch window).
- [ ] AC-A3: Metadata fields (`title`, `task_size`, `delicate`) remain settable regardless of `branch`, retaining the past-`pending` warning. Verified by a test setting one on a branch-recorded task (succeeds + warns).
- [ ] AC-A4: The topology guard is evaluated **before** value parsing, so a locked field is rejected even when the value is valid (e.g. `set worktree true` on a branched task returns the lock error, not a success). Redirect/immutable/unknown-field behavior (AC-3/AC-4/AC-5) and value-validation (AC-2) are otherwise unchanged. Verified by a test.
- [ ] AC-A5: The `set` row in `docs/pipeline-orchestrator.md` (+ `templates/` mirror) documents the two-class model (topology fields lock once a branch is recorded). Full suite green: lint, type-check, test, build (+ `dist/` matches), docs-refs-check, sync-templates:check.

### Affected Files (amendment delta)

| File | Change |
|---|---|
| `src/task/index.ts` | Add the topology-field lock (reject `worktree`/`base_branch` when `status.branch` is non-empty), evaluated before value application in `taskSet`/`taskSetValue`. Retain the `args.length > 3` rejection. |
| `tests/task-cli.test.ts` | Add topology-lock tests (AC-A2/A3/A4); arg-count rejection (AC-A1) already covered. |
| `docs/pipeline-orchestrator.md` | Note topology-field locking in the `set` row. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror — regenerated by the sync hook. |
| `dist/cli/index.js` | Rebuilt. |
