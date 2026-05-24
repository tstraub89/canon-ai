# Archive Notes: scope-pr-auto-commit-to-affected-files (v1, abandoned)

> Archived 2026-05-22 after 5 spec_review CRs in a row, each catching a new shape error. Replaced by `scope-pr-auto-commit-to-affected-files-v2` with a simpler design.

## What this task tried to do

Tighten the `--pr` commit allow-list AND downgrade today's hard-die at [main.ts:938](../../../scripts/run-task/main.ts:938) to a warn-and-skip for out-of-scope dirty files, so the PR would open with only in-scope content and the operator could reconcile the leftover by hand.

## Why it didn't ship

The warn-and-skip behavior interacted with `commitHumanReviewFiles`'s gate state machine in too many places. Each spec_review iteration discovered a new gate or side-effect the spec hadn't enumerated:

1. **Iter 1** — missed the staged-vs-unstaged distinction at line 938 (operator's pre-staged out-of-scope files vs sync-leaked unstaged out-of-scope files have different semantics).
2. **Iter 2** — used `indexStatus === ''` as the predicate, but `parsePorcelainEntries()` at [git.ts:285](../../../scripts/run-task/git.ts:285) stores the literal porcelain column character (`' '` for unstaged tracked, `'?'` for untracked).
3. **Iter 3** — missed the empty-stagePaths case at line 949: after warn-and-skip filters out all dirty entries, `stagePaths.size === 0` triggers a separate die contradicting AC-5's "function returns" claim.
4. **Iter 4** — the "return cleanly" fix for the empty-stagePaths case was structurally wrong: `commitHumanReviewFiles` owns push + `reportOrCreatePR` side effects, and the outer `--pr` caller exits immediately. Returning early skips the push/PR entirely. The fix would have had to inline the push + PR sequence into the empty-set branch.
5. **Iter 5** — auto-blocked before running.

## Lesson

The warn-and-skip ergonomic was BACKLOG line 461's stated preference, but the implementation cost in a tightly-coupled function with four gates and inline side effects was much higher than the operator-facing benefit. The simpler design (preserve die at all gates, just tighten the allow-list) catches contamination loudly and unambiguously without touching the state machine.

v2 ships the allow-list narrowing + better error message + the AC-6 advisory warning (the cheap nudge for same-file overlap). All gates keep die semantics.

## Durable signal

`status.json.phases.spec_review.iterations_total = 5` records that the warn-and-skip design specifically failed the cross-review gate after 5 mechanical revisions. The counter is preserved (not reset) per the never-reset-iteration-counters memory — it's stale relative to v2's different design, but it's the truthful record of what happened.
