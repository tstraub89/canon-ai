# Plan: reroute-detaches-before-loop

> Written by: Claude (pipeline session)

## Overview

The change is small in LOC but the correctness reasoning is load-bearing. Three
interlocking concerns:

1. Remove `--reroute` from the synchronous-mode predicate so the detach gate
   fires for rerouted runs (AC-1, AC-2).
2. Guard the reroute-reset call with `CANON_DETACHED` so the re-exec'd child
   skips the reset and falls straight into the phase loop (AC-4).
3. Source order is preserved: the reset call at `main.ts:3188` stays before the
   detach gate (AC-5). This is already the case — do not reorder.

The spec recommends the `CANON_DETACHED`-env guard over the argv-strip
mechanism. This plan follows that recommendation: the guard is contained to the
single reroute call site; `detachAndExit` is not modified.

## Affected Files (note on spec-review nit)

The spec Affected Files table is complete with one addition: the nit noted that
AC-4's parent-only-reset test is closer to `tests/run-task-reroute-preflight.test.ts`
(which already has `makeRerouteStatus()`, `runMain()`, fake agent binaries, and
worktree fixtures) than to `tests/detach.test.ts`. This plan places the AC-4
test in `run-task-reroute-preflight.test.ts` and adds it to the handoff Changes
table. AC-3 predicate tests stay in `tests/detach.test.ts` per spec.

## Step 1 — `scripts/run-task/cli.ts`: export `isSynchronousMode` (AC-2)

Add an exported pure function `isSynchronousMode` immediately after the
`validateTaskId` function at the bottom of the file. It accepts a structural
subset of `CliArgs` (only the five fields it actually checks) so it can be
unit-tested without constructing the full args object:

```typescript
export function isSynchronousMode(
    args: Pick<CliArgs, 'pr' | 'push' | 'ship' | 'step' | 'expectPhase'>,
): boolean {
    return !!(args.pr || args.push || args.ship || args.step || args.expectPhase != null);
}
```

`reroute` is intentionally absent from the Pick type and the expression body
(AC-1 structural requirement). No other changes to `cli.ts`.

## Step 2 — `scripts/run-task/main.ts`: three edits

### 2a — Add `DETACH_CHILD_FLAG` to the existing `detach.ts` import (line 22)

Current:
```typescript
import { detachAndExit, removeCanonPid, shouldAutoDetach } from './detach.js';
```
Change to:
```typescript
import { detachAndExit, DETACH_CHILD_FLAG, removeCanonPid, shouldAutoDetach } from './detach.js';
```

### 2b — Add `CANON_DETACHED` guard on the reroute-reset call (AC-4, AC-5)

Current block at `main.ts:≈3188`:
```typescript
if (cliArgs.reroute) {
    rerouteFromHumanReview(cliArgs.taskIds);
}
```
Change to:
```typescript
if (cliArgs.reroute && process.env[DETACH_CHILD_FLAG] !== '1') {
    rerouteFromHumanReview(cliArgs.taskIds);
}
```

The position of this block must remain before the detach gate — do not move it.
This preserves AC-5 (reset fires inline in the parent, before detach) and
satisfies AC-4 (detached child re-enters with `CANON_DETACHED=1`, skips the
reset, proceeds to the phase loop).

### 2c — Replace the inline predicate with `splitCli.isSynchronousMode()` and rewrite the comment (AC-1, AC-2, AC-6)

The block at `main.ts:≈3207–3247` contains a long justifying comment (lines
3207–3231) and the inline `const isSynchronousMode = cliArgs.pr || ... ||
cliArgs.reroute || ...` expression followed by the detach gate call. Replace the
entire comment-plus-const-plus-gate block with:

```typescript
    // Detach AFTER all validation has surfaced any errors to the operator.
    // Once we detach, the parent exits and any later die() in the child only
    // hits the log file — operators wouldn't see it inline. shouldAutoDetach()
    // returns true when stdout is not a TTY AND CANON_NO_DETACH is not set
    // AND we aren't already the detached child. The detached child runs
    // setsid()'d into its own session so harness pgroup-kill (Claude Code
    // operator-session resume, SSH disconnect, etc.) cannot reach it.
    //
    // Only detach when entering the long-running phase loop. Synchronous
    // control modes stay foreground so the operator gets the exit status
    // they're waiting on:
    //   - --pr / --push / --ship — one-shot operations, complete in seconds,
    //     operator wants the result inline.
    //   - --step — runs one phase then exits with a status that signals
    //     "phase advanced" (0) or "phase didn't advance / sub-agent
    //     failed" (1). Backgrounding would make scripts/operators see
    //     exit 0 from the parent before the phase actually ran, hiding
    //     the real result.
    //   - --expect <phase> — fail-fast guard that dies if current phase
    //     doesn't match. Detaching turns "fail fast" into "fail silently
    //     in the log," which is exactly the misuse this flag exists to
    //     prevent. (Codex PR #112 P2 finding.)
    //   - --dry-run — exits even earlier (line ~2451) so this branch is
    //     unreachable for it; kept in the predicate defensively.
    //
    // --reroute alone DETACHES: rerouteFromHumanReview() (above) runs in the
    // parent to print the reset banner and validate the amendment, then the
    // parent detaches and the child inherits the rerouted pipeline from the
    // new phase. Both tiers enter the long-running loop — fast-tier runs
    // implement → code_review → qa; full-tier runs spec_review → plan →
    // implement → … Neither resets-and-exits. Use `canon watch <id>` after
    // a bare `--reroute` to follow progress.
    //
    // --reroute --step stays foreground because --step is in the synchronous
    // set. That is the stepped escape hatch:
    //   Full tier: canon run <id> --reroute --step --expect spec_review
    //   Fast tier: canon run <id> --reroute --step --expect implement
    //
    // See scripts/run-task/detach.ts and docs/BACKLOG.md "Orchestrator dies
    // silently in background mode" for the failure-mode story.
    if (!splitCli.isSynchronousMode(cliArgs) && shouldAutoDetach()) {
        detachAndExit({
            taskIds,
            resolveTaskDir: heartbeatDirResolver,
            argv: process.argv,
        });
    }
```

Structural checks after edit:
- `reroute` must not appear in the predicate expression (AC-1 grep check)
- `--reroute` must not appear in the "one-shot operations, complete in seconds"
  portion of the comment (AC-6 grep check)

## Step 3 — Tests (AC-3 in `detach.test.ts`, AC-4 in `run-task-reroute-preflight.test.ts`)

### AC-3: `isSynchronousMode` predicate tests in `tests/detach.test.ts`

Add an import for `isSynchronousMode` from `'../scripts/run-task/cli.js'` at
the top of `detach.test.ts` alongside the existing detach imports.

Add a new test group (after the existing `shouldAutoDetach` tests, before
`detachAndExit`). Build a base object and spread truthy cases over it:

```typescript
const base = { pr: false, push: false, ship: false, step: false, expectPhase: null };

// AC-3 rows (all required):
// {reroute:true} alone → false  — pass base (reroute not in Pick type; absence == false)
// {pr:true} → true
// {push:true} → true
// {ship:true} → true
// {step:true} → true
// {expectPhase:'spec_review'} → true
// {reroute:true, step:true} → true  (step dominates; pass {...base, step: true})
// bare {} → false
```

The "reroute alone → false" row: because `isSynchronousMode` only accepts
`Pick<CliArgs, 'pr'|'push'|'ship'|'step'|'expectPhase'>`, pass `base` directly
(no `reroute` key is accepted). The assertion is `isSynchronousMode(base) ===
false` — this proves the predicate returns `false` when none of the five keys
are truthy, confirming `reroute` has no effect on the predicate.

For the "step dominates reroute" row: pass `{...base, step: true}`. The test
name should say "reroute+step → true (step dominates)" to make the intent
visible.

### AC-4: parent-only-reset test in `tests/run-task-reroute-preflight.test.ts`

Declare this file in the handoff Changes table (per spec-review nit — nit
explicitly allows this path).

The test verifies: when the detached child re-enters `main()` with `--reroute`
and `CANON_DETACHED=1` already in env, the `rerouteFromHumanReview` guard is
NOT triggered (i.e., the process does not `die()` on the "requires human_review"
guard).

Pattern to follow: look at the existing subprocess tests in this file that use
`runMain()` or `spawnSync` with a fake status. The key setup:

1. Build a task at a post-reroute phase (`spec_review` pending, or `implement`
   pending for fast tier) using `makeRerouteStatus` with appropriate options.
   This simulates the state after the parent already ran the reroute reset.
2. Spawn `main.ts` (via `runMain()` or equivalent) with:
   - argv including `--reroute` (to reach the reroute block)
   - env including `CANON_DETACHED=1` (child flag — suppresses the reset)
   - env including `CANON_NO_DETACH=1` (prevents the child from trying to
     re-detach, since stdout won't be a TTY in test subprocess)
3. Assert: the process output does NOT match the reroute guard error messages
   (`--reroute requires.*human_review` or `--reroute aborted`).
4. Assert: the process either attempts the phase loop (and fails for an
   expected reason like "no agent binary") or exits cleanly — i.e., it
   progressed past the reroute guard without aborting.

The test name should make the contract explicit:
`"CANON_DETACHED=1 suppresses reroute reset — detached child does not abort on guard"`.

## Step 4 — `docs/pipeline-orchestrator.md`: two touchpoints (AC-7a, AC-7b)

Read the exact current text before editing; the line numbers in the spec are
approximate anchors.

### 4a — "Monitoring detached runs" sentence (≈line 21): remove `--reroute`

The current sentence lists `--reroute` among the modes that "all run
synchronously." Remove `--reroute` from that list and add a clause noting bare
`--reroute` auto-detaches:

After edit the sentence must NOT contain `--reroute` in the same clause as
`--step`, `--expect`, `--push`, `--pr`, `--ship` (AC-7a structural grep check).
Add something like: "Bare `--reroute` auto-detaches like a plain `canon run`;
use `canon watch <id>` to follow its progress."

### 4b — "Stepped runs must expect…" block (≈lines 433–444): single combined commands

Current code blocks:
```bash
# Full tier
canon run <id> --reroute
canon run <id> --step --expect spec_review

# Fast tier
canon run <id> --reroute
canon run <id> --step --expect implement
```

Replace with:
```bash
# Full tier (stepped foreground reroute — both flags in one invocation)
canon run <id> --reroute --step --expect spec_review

# Fast tier
canon run <id> --reroute --step --expect implement
```

Update the surrounding prose to note that bare `--reroute` (without `--step`)
auto-detaches and runs the complete rerouted pipeline in the background.

AC-7b structural grep check: after edit, no code block in
`pipeline-orchestrator.md` may have a bare `--reroute` invocation on one line
immediately followed by a separate `--step --expect` invocation on the next.

## Step 5 — `CLAUDE.md`: update "Reroute step guards" quick-ref (AC-7c)

Line 60 of `CLAUDE.md` currently contains (paraphrased):
> "full-tier reroute re-enters at `spec_review`, so use `canon run <id> --step
> --expect spec_review` **after** `--reroute`"

Replace the opening clause with the single-combined-command form. The updated
entry should:
- State bare `--reroute` auto-detaches (monitor with `canon watch`)
- Give the single combined command for each tier:
  full: `canon run <id> --reroute --step --expect spec_review`
  fast: `canon run <id> --reroute --step --expect implement`
- Preserve the rest of the entry unchanged (amendment heading rules, allowed
  phases for `--reroute`, Amendment section invariant)

## Step 6 — Template sync (AC-8)

After editing `CLAUDE.md` and `docs/pipeline-orchestrator.md`, run:
```bash
npm run sync-templates
```
This updates `templates/CLAUDE.md` and `templates/docs/pipeline-orchestrator.md`.

Declare BOTH mirrors in the handoff Changes table — the pre-flight diff gate
reconciles the branch diff against the handoff, and an auto-synced mirror that
isn't declared causes a gate rejection (see `docs/lessons-learned.md`
"Declare both the canon-managed root doc AND its templates/ mirror" entry).

The pre-commit hook also auto-syncs on `git commit`, so the templates will be
staged automatically. Codex must still declare them.

## Step 7 — Rebuild dist (AC-9)

```bash
npm run build
```
Only `dist/scripts/run-task.js` changes (the `scripts/run-task/**` entry point
bundles into it; `dist/cli/index.js` does not bundle run-task internals). Verify
with `npm run build && git diff --exit-code -- dist/` returning clean.

## Step 8 — Validate (AC-10)

Run in order:
```bash
npm run lint
npm run type-check
npm test
npm run build
npm run sync-templates:check
npm run docs-refs-check
```

All must pass before closing the handoff.

## Summary of Changes per Acceptance Criterion

| AC | File(s) | Mechanism |
|---|---|---|
| AC-1 | `scripts/run-task/cli.ts`, `main.ts` | `isSynchronousMode` has no `reroute` field; `main.ts` calls it |
| AC-2 | `scripts/run-task/cli.ts` | `export function isSynchronousMode(Pick<CliArgs,...>)` after `validateTaskId` |
| AC-3 | `tests/detach.test.ts` | Unit tests for `isSynchronousMode` covering 8 input rows |
| AC-4 | `main.ts` (CANON_DETACHED guard); `tests/run-task-reroute-preflight.test.ts` (subprocess test) | Guard at the reroute call; test with `CANON_DETACHED=1` in child env |
| AC-5 | `main.ts` | No reordering — reset call stays before detach gate |
| AC-6 | `main.ts` comment block | `--reroute` removed from one-shot list; comment states it detaches + enters phase loop |
| AC-7a | `docs/pipeline-orchestrator.md` ≈line 21 | `--reroute` removed from synchronous-modes sentence; note added that it auto-detaches |
| AC-7b | `docs/pipeline-orchestrator.md` ≈lines 433–444 | Two-command sequences → single combined-command form |
| AC-7c | `CLAUDE.md` line 60 | "after `--reroute`" two-step phrasing → single combined-command form for both tiers |
| AC-8 | `templates/CLAUDE.md`, `templates/docs/pipeline-orchestrator.md` | `npm run sync-templates` + both mirrors declared in handoff |
| AC-9 | `dist/scripts/run-task.js` | `npm run build` |
| AC-10 | — | Full suite: lint, type-check, test, build, sync-templates:check, docs-refs-check |
