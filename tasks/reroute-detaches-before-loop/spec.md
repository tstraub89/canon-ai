# Spec: reroute-detaches-before-loop — Detach `--reroute` before the phase loop so rerouted runs survive harness kills

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`canon run <id> --reroute` runs the long-running phase loop in the **foreground** and gets orphaned when the parent process group is killed.

The detach decision in `scripts/run-task/main.ts` (≈line 3234) classifies `--reroute` as a synchronous mode:

```js
const isSynchronousMode =
    cliArgs.pr || cliArgs.push || cliArgs.reroute || cliArgs.ship ||
    cliArgs.step || cliArgs.expectPhase != null;
if (!isSynchronousMode && shouldAutoDetach()) { detachAndExit({ ... }); }
```

The justifying comment (≈3207–3231) claims `--pr / --push / --reroute / --ship` are "one-shot operations, complete in seconds, operator wants the result inline." That is true for pr/push/ship (a push/PR/merge — seconds) but **false for `--reroute`**.

Verified against the code:
- `rerouteFromHumanReview()` (`main.ts:2202`) returns `void` — it has **no `process.exit`**. After it returns (called at `main.ts:3189`), control falls through the detach gate (3241) into the `while (true)` phase loop (3270).
- This holds for **both tiers**: fast-tier reroute resets to `implement` and runs implement → code_review → qa; full-tier reroute resets to `spec_review` and runs spec_review → plan → implement → … . Neither resets-and-exits; both enter the long-running loop.

Because reroute skips `detachAndExit`, the orchestrator is never `setsid()`'d into its own session, so a harness process-group kill (Claude Code operator-session resume, SIGKILL of the parent shell, SSH disconnect) reaches into it and orphans the run mid-phase. A plain `canon run` detaches + setsid's and survives the same kill.

**Observed impact**: a fast-tier `--reroute` was orphaned twice at the `code_review` phase (`canon watch` reported `state=code_review reason=death`) solely because the foreground parent was killed. Each recovery required re-running plain `canon run <id>`. Rerouted runs are fragile exactly when they shouldn't be.

## Decision

Stop classifying `--reroute` as a synchronous mode. A bare `canon run <id> --reroute` (no `--step`) must **detach before entering the phase loop**, in both tiers, exactly like a plain `canon run` — so the rerouted pipeline runs in the `setsid()`'d child and survives a harness pgroup-kill.

Two behaviors must be preserved across the detach boundary:

1. **The reroute reset and amendment-validation stay in the foreground parent**, printed inline to the operator, before detaching. The reset banner (`Rerouting: … → …`, `Status reset…`) and any "amendment required" / wrong-phase failure must reach the operator's terminal (not only the run log), and an invalid reroute must fail fast inline with a non-zero exit and **not** detach. (This is already the source order — `rerouteFromHumanReview` at 3189 runs before the detach gate at 3241 — and must remain so.)

2. **The detached child must not re-run the reroute reset.** `detachAndExit` re-execs the original argv (including `--reroute`) with `CANON_DETACHED=1`. Without a guard, the child re-enters `main()`, calls `rerouteFromHumanReview()` a second time, and aborts on the `--reroute requires … human_review` guard (`main.ts:2211`) because the parent already advanced the phase. The detached child must instead **resume the rerouted pipeline from the reset phase** without re-running the reset.

`--step` remains synchronous, which gives the foreground escape hatch by composition: `canon run <id> --reroute --step --expect spec_review` stays in the foreground (because `--step` is still in the synchronous set), runs the reset + exactly one phase, and exits. This is the documented full-tier stepped reroute, now expressed as a **single** command.

The justifying comment and the operator docs are updated to match: bare `--reroute` detaches (monitor with `canon watch`); the full-tier stepped path is the single combined `--reroute --step --expect spec_review` command; the previously-documented two-command sequence (`--reroute` then a *separate* `--step …`) is removed, because after this change it would launch two orchestrators against one worktree.

**Mechanics deferred to plan, with a recommended default**: how the detached child skips the reset is the implementer's choice, but the spec recommends the **localized `CANON_DETACHED` env-guard** on the `main.ts:3188` reroute call (`if (cliArgs.reroute && process.env.CANON_DETACHED !== '1')`) over stripping `--reroute` from the child argv in `detachAndExit`. Rationale: on this delicate surface, the env-guard is contained to the single reroute call site, whereas the argv-strip modifies `detachAndExit` — a shared chokepoint every detached run flows through — for a reroute-only concern. The argv-strip is acceptable only if the plan gives an explicit reason the env-guard is unworkable. Either way, the behavioral contract is AC-4.

## Non-Goals

- **Not** changing the classification of `--pr`, `--push`, `--ship`, `--step`, or `--expect <phase>` — those remain synchronous/foreground and are correct as-is.
- **Not** changing fast-tier's single-command reroute UX. Bare `canon run <id> --reroute` stays one command; it just detaches now.
- **Not** adding a guard that refuses to start when an orchestrator is already live on the worktree. Concurrent-launch protection is a pre-existing gap and out of scope; canon's standing "one pipeline per worktree" rule plus the doc update (which removes the two-command sequence) are the mitigation here.
- **Not** making `--reroute` reset-and-exit (a different design that would turn fast-tier reroute into two commands). Scope is the single change: reroute detaches like a normal run.
- **Not** touching `scripts/docs-refs-check.mjs` or the docs-refs validation logic.

## Acceptance Criteria

- [ ] AC-1: After this change, the synchronous-mode decision does **not** treat `--reroute` as synchronous. Structural check: the predicate that gates `detachAndExit` references `pr`, `push`, `ship`, `step`, and `expectPhase`, and **does not reference `reroute`**. (Grep the predicate source; `reroute` must not appear in it.)
- [ ] AC-2: The synchronous-mode decision is extracted from the inline expression at `main.ts:≈3234` into a **pure, exported, unit-testable function** that takes the parsed CLI args and returns a boolean. (Location deferred to plan — e.g. alongside `parseArgs` in `scripts/run-task/cli.ts`.) The detach gate in `main()` calls this function.
- [ ] AC-3: A unit test in `tests/detach.test.ts` (node:test) asserts the extracted predicate: `{reroute:true}` alone → `false` (not synchronous); each of `{pr:true}`, `{push:true}`, `{ship:true}`, `{step:true}` → `true`; `{expectPhase:'spec_review'}` → `true`; `{reroute:true, step:true}` → `true` (step dominates); a bare `{}` → `false`.
- [ ] AC-4: The detached reroute child resumes the rerouted pipeline from the reset phase and does **not** re-execute the reroute reset — i.e. it does not abort with the `--reroute requires … human_review` guard. Verifiable contract: with `CANON_DETACHED=1` set, re-entering the reroute code path is a no-op (the reset is parent-only). A unit/fixture test asserts that the reroute reset does not run (does not `die`) when `CANON_DETACHED=1` and the phase is already past `human_review`/`code_review`.
- [ ] AC-5: The reroute reset and amendment-validation run in the **foreground parent** before any detach. Source-order check: `rerouteFromHumanReview()` is invoked before the detach gate, so the reset banner and any amendment/phase failure (`die`) are emitted inline and an invalid reroute exits non-zero without detaching. (No code reordering may move the reset after the detach gate.)
- [ ] AC-6: The detach justifying comment in `main.ts` (≈3207–3231) no longer lists `--reroute` among "one-shot operations, complete in seconds." It states that `--reroute` detaches because it enters the long-running phase loop in both tiers, and that `--reroute --step` stays foreground as the stepped escape hatch. (Grep the comment block: it must not group `--reroute` with the one-shot ops.)
- [ ] AC-7: Operator docs are updated at **all three** touchpoints where they currently describe reroute as foreground/synchronous or as a two-command sequence:
  - **(a)** `docs/pipeline-orchestrator.md` "Monitoring detached runs" (≈line 21): the sentence listing `--step`, `--expect`, `--push`, `--pr`, `--reroute`, `--ship` as modes that "stay in the foreground … all run synchronously" must **remove `--reroute`** from that list and state that bare `--reroute` now auto-detaches (monitor with `canon watch`). (Grep: `--reroute` must not appear in that synchronous-modes sentence.)
  - **(b)** `docs/pipeline-orchestrator.md` "Stepped runs must expect…" block (≈lines 433–444): both the full-tier and fast-tier examples must change from a two-command sequence (`canon run <id> --reroute` then a *separate* `canon run <id> --step --expect <phase>`) to a **single** combined command (`canon run <id> --reroute --step --expect spec_review` for full tier; `canon run <id> --reroute --step --expect implement` for fast tier). (Grep: no surviving code block runs bare `--reroute` on one line followed by a separate `--step --expect` invocation on the next.)
  - **(c)** `CLAUDE.md` "Reroute step guards" quick-ref: replace the "use `canon run <id> --step --expect spec_review` after `--reroute`" phrasing with the single-combined-command form for both tiers, and note bare `--reroute` now detaches.
- [ ] AC-8: The `templates/` mirrors of both edited canon-managed docs are synced and staged: `templates/CLAUDE.md` and `templates/docs/pipeline-orchestrator.md` match their roots (the pre-commit hook runs `sync-canon-templates`; `npm run sync-templates:check` passes).
- [ ] AC-9: `dist/scripts/run-task.js` is rebuilt from source and committed so `npm run build && git diff --exit-code -- dist/` is clean.
- [ ] AC-10: Full validation suite passes: `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run sync-templates:check`, `npm run docs-refs-check`.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Remove `cliArgs.reroute` from the synchronous-mode decision and replace the inline expression with a call to the extracted predicate (AC-1, AC-2). Ensure the detached child does not re-run the reroute reset (AC-4 — mechanism deferred to plan; if chosen as the `CANON_DETACHED` guard it lands here at ≈3188). Rewrite the detach justifying comment (AC-6). The `rerouteFromHumanReview()` call must remain before the detach gate (AC-5). |
| `scripts/run-task/cli.ts` | Add the pure, exported synchronous-mode predicate (e.g. `isSynchronousMode(cliArgs)`) alongside `parseArgs`/`CliArgs` (AC-2). Exact home deferred to plan; this is the natural one. |
| `scripts/run-task/detach.ts` | **Only if** the plan chooses the argv-strip mechanism for AC-4 (strip `--reroute` from the child argv). If the `CANON_DETACHED`-guard mechanism is chosen instead, no change here. |
| `tests/detach.test.ts` | Add unit tests for the extracted predicate (AC-3) and the parent-only-reset contract (AC-4). |
| `CLAUDE.md` | Update the "Reroute step guards" quick-ref per AC-7. |
| `templates/CLAUDE.md` | Auto-synced mirror of `CLAUDE.md` (pre-commit hook); declared so the base-drift gate accepts it (AC-8). |
| `docs/pipeline-orchestrator.md` | Update per AC-7 at two spots: the "Monitoring detached runs" synchronous-modes sentence (≈line 21, remove `--reroute`) and the "Stepped runs must expect…" code block (≈433–444, collapse both tiers' two-command sequences to single combined commands). |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror of `docs/pipeline-orchestrator.md` (AC-8). |
| `dist/scripts/run-task.js` | Rebuilt bundle for the `scripts/run-task.ts` entry point (AC-9). Only this dist artifact contains the changed code — `dist/cli/index.js` does not bundle `run-task` internals (verified). |

### Interaction Dependencies

- `detachAndExit` / `shouldAutoDetach` (`scripts/run-task/detach.ts`) — the detach machinery this change routes reroute through. `shouldAutoDetach` already returns `false` under `node --test` and when `CANON_DETACHED=1`, so unit tests target the extracted pure predicate, not an end-to-end fork.
- `rerouteFromHumanReview` (`main.ts:2202`) — its `die()` paths (wrong phase, missing Amendment section) must continue to fire in the foreground parent.
- The full-tier reroute → `spec_review` block-to-human flow: after detaching, a `changes_requested` block surfaces via the run log / `canon watch`, same as a normal detached full-tier run. No capability is lost; only the inline per-phase progress moves (the reset banner stays inline per AC-5).

### Data Model Changes

None. No `status.json` schema changes, no new CLI flags, no new persistent fields.

## Validation Required

- [x] `npm run lint` (= `eslint scripts/ tests/ src/`)
- [x] `npm run type-check` (= `tsc -p tsconfig.json --noEmit`)
- [x] `npm test` (= `node --test --import tsx tests/*.test.ts`) — full suite runs clean; this task also adds predicate tests
- [x] `npm run build` (= `tsup` + postbuild) — required: changes `scripts/run-task/**`, which bundles into `dist/scripts/run-task.js`
- [x] `npm run sync-templates:check` — required: edits canon-managed `CLAUDE.md` and `docs/pipeline-orchestrator.md`
- [x] `npm run docs-refs-check` — required: edits `docs/` and root agent file `CLAUDE.md`
- [ ] E2E — n/a (no E2E surface for the orchestrator)

## Docs Impact

`CLAUDE.md` and `docs/pipeline-orchestrator.md` are updated as part of this task (AC-7) and their `templates/` mirrors synced (AC-8) — intrinsic to the change, not incidental. No other protected docs need updating: `docs/product-context.md`'s delicate-surface list already covers orchestrator process-lifecycle; `docs/decisions.md` background-mode design is unchanged (this is a classification fix within the existing detach design, not a new decision).

## Known Risks

- **Re-exec double-reroute (the central hazard).** `detachAndExit` re-execs `process.argv` (including `--reroute`) with `CANON_DETACHED=1`. If the detached child re-runs `rerouteFromHumanReview()`, it dies on the `requires … human_review` guard and the rerouted pipeline never runs — i.e. the naive "just drop reroute from the predicate" change would replace the orphan bug with an instant-death bug. AC-4 is the guard against this. Both candidate mechanisms (CANON_DETACHED guard at `main.ts:3188`, or stripping `--reroute` from the child argv) are acceptable; the plan must pick one and the AC-4 test must cover it. The reviewer should specifically confirm the detached child advances past the reset phase rather than aborting.
- **Two orchestrators on one worktree.** After this change, bare `--reroute` detaches and keeps running. An operator who then launches a *second* command against the same task/worktree while the detached run is alive hits canon's "two invocations on the same branch and folder corrupt each other's git state" failure. The doc update (AC-7) removes the previously-documented two-command sequences (both tiers) that would have caused exactly this; the mitigation is the single combined `--reroute --step` command and `canon watch` for monitoring. **Timing delta worth naming**: under bare `--reroute`, the foreground reset completes and returns the prompt to the operator *while the detached loop keeps running* — which makes a manual second invocation more tempting than under a plain `canon run` (where nothing returns to the prompt until detach). This is the specific behavioral change the doc-only mitigation must counter, hence AC-7's emphasis on the single-command form. No new concurrent-launch guard (non-goal).
- **Visibility shift.** Detaching moves the rerouted loop's per-phase progress to the run log / `canon watch` instead of the operator's terminal — the same trade every detached `canon run` already makes. AC-5 preserves the part operators most need inline: the reset banner and reroute-rejection errors.
- **Delicate surface.** This is orchestrator process-lifecycle logic; a regression re-orphans every rerouted run or makes every detached reroute child die on the guard. Hence `delicate: true` and the XL review bucket. The change is small in LOC but the correctness reasoning (both-tier loop behavior, re-exec, foreground/parent ordering) is the load-bearing part.
- **Canon-managed doc edit mid-pipeline.** `CLAUDE.md` is edited in the worktree; worktree isolation means the supervising orchestrator (running from the main checkout) is unaffected, and later phases in the worktree correctly read the edited copy. This is the intended dogfood asymmetry, not a bug.

## Human Test Plan

1. Take a small task to a state where it can be rerouted — for example, reject it at human review, or amend its spec after a code-review spec-gap.
2. From a non-interactive context (the way the operator session invokes canon — not an attached terminal), reroute the task with the plain reroute command.
3. Confirm canon prints the reroute reset summary **inline** (the "rerouting / status reset" messages), and then reports that the run has **detached** — showing a PID and a log path.
4. While the rerouted run is working, kill or resume the operator session (the action that previously orphaned the run).
5. Expected: the rerouted run keeps going to its next checkpoint or completion instead of dying; you can follow its progress with `canon watch`. Previously it died mid-phase and required a manual re-run.
6. Separately, for a larger task, run the single stepped reroute command (reroute + step + expect the review phase) and confirm it runs exactly one phase in the foreground and then stops — the stepped behavior is unchanged.
7. Confirm an *invalid* reroute (e.g. one attempted without the required amendment) still fails immediately and visibly in the foreground, without detaching.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (grep/structural checks, unit-test assertions, source-order checks, suite pass)
- [x] Affected Files lists specific files with specific change descriptions (incl. dist artifact and template mirrors)
- [x] Plan steps (fast tier) reference actual function/file names — n/a (full tier; plan is a pipeline phase), but ACs reference real symbols (`rerouteFromHumanReview`, `detachAndExit`, `shouldAutoDetach`, `CANON_DETACHED`, line anchors)
- [x] Known Risks covers failure modes for the trickiest ACs (re-exec double-reroute, two-orchestrator collision, visibility, delicate)
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one `- [x]` entry
- [x] Symbols named in ACs exist in the codebase — verified by direct read (`isSynchronousMode` inline at main.ts:3234; `rerouteFromHumanReview` main.ts:2202; guard at 2211; `detachAndExit`/`shouldAutoDetach` in detach.ts; `CANON_DETACHED` flag; dist artifact `dist/scripts/run-task.js`)
