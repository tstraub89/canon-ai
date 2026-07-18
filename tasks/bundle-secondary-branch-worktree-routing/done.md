# Completion Summary: bundle-secondary-branch-worktree-routing — Fix bundle secondary's branch write landing in main instead of the worktree

> For the human. This is what you need to know.

## What Changed

When you run two or more tasks together as a "bundle" with worktree isolation on, canon creates one shared working area named after the first ("leader") task and expects every member's branch to be recorded there. Instead, the second and later ("secondary") members' branch bookkeeping was silently landing back in the main project folder instead of the shared working area — leaving the main checkout dirty and the orchestrator's own log line claiming (falsely) that the main folder was untouched. This fixes the routing so a secondary's branch is always recorded in the shared working area, adds a real-git regression test that reproduces the bug before the fix and proves it after, and hardens the underlying lookup so it can never again fall back to guessing from a stale main-folder hint — it now fails loudly instead of silently misrouting when it can't determine ownership cleanly.

## Files Changed

- `scripts/run-task/state.ts` — added a fail-closed worktree scan that resolves a bundle secondary to its owning worktree by matching each candidate's own content (its `worktree` flag + its own checked-out branch), instead of relying on a main-checkout branch hint.
- `scripts/run-task/git.ts` — first-implement bootstrap now writes every bundle member's branch directly to the resolved worktree (or override destination) — secondaries first, leader last — never through the resolver, and never to main.
- `tests/run-task-safety.test.ts` — added the real-git wrong-main-write regression test (red-first) plus negative/fail-closed tests: inherited directory, `worktree: false` on either side, multi-match, enumeration failure, malformed JSON, and schema-invalid candidates.
- `docs/patterns.md` — new pitfall entry documenting bundle-secondary content resolution, the fail-closed scan, and why it must not read the main checkout's branch.
- `dist/cli/index.js`, `dist/scripts/run-task.js` — regenerated to include the resolver and bootstrap changes (both entry points bundle the affected source).

## How to Test

1. Start two tasks that will run together as a bundle, with worktree isolation left on (the default).
2. Run them together in one bundle invocation so they share a single working area.
3. When implementation begins, check the main project folder's status — it should show no pending changes to either task's tracking file.
4. Look inside the shared working area — both tasks' tracking files should show the same shared branch name.
5. Confirm the run's log message about recording the branch is accurate (it should not claim the main folder was untouched while actually changing it).
6. Expected: the secondary task behaves exactly like the leader — its branch is recorded in the shared working area, the main folder stays clean, and the rest of the run (review, QA) proceeds normally without the main folder accumulating stray edits to the secondary's tracking file.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (992/992, including new real-git regression + fail-closed negative tests) |
| E2E tests | N/A (no E2E suite for this project) |
| Build | Pass (both dist entry points regenerated, byte-stable repeat build) |

Code review synthesized three independent lenses (anchored Claude, cold Claude, cold Codex). Anchored and cold-Codex approved outright; cold Claude requested changes over the fail-closed global-`die()` tradeoff and several nits — all verified against the code and dismissed as the spec's own deliberate, documented decision (not a code bug or spec gap), since cold-Codex did not independently corroborate any of them. Final verdict: **approved with nits** — see `review.md` for the full findings and dismissal rationale.

## Human Verification Required

None. All required validation checks resolved to `Pass`; no `human_pending` items remain in `handoff.md`.

Handoff pre-merge checklist:
- [x] Version correct — N/A this task; version/changelog bump happens at the release step, not per task (`docs/decisions.md` §"Versioning and release policy").
- [ ] Changelog updated — not yet; see Proposed Changelog below for the human to finalize.
- [ ] PR body current — drafted in `pr-body.md`, not yet opened as a PR.
- [ ] Final CI/CD checks green — not yet run; no PR opened yet.
- [x] Final diff matches spec intent — confirmed in code review (all 10 ACs Met, Stage 1 gate passed).

## Proposed Changelog

- **A multi-task bundle running in worktree mode no longer writes a secondary task's branch into the main checkout.** First-implement bootstrap created one shared working area named after the bundle's leader task, then looped over every member to record its branch — but a secondary's branch write resolved through the same lookup used everywhere else, which (before any worktree copy carried a branch yet) fell back to reading the main checkout's copy and wrote there instead of the shared working area. This left the main checkout dirty with a stray branch write, the shared working area's copy for that secondary still blank, and the orchestrator's own log line falsely claiming the main checkout was untouched. The bootstrap now writes every bundle member directly to its resolved worktree (or override destination) without going through the lookup, and task-state resolution gains a fail-closed, content-based scan so any future resolution of a secondary matches the worktree that actually owns its branch — it never again infers ownership from a mutable main-checkout hint, and fails loudly (rather than silently falling back) when ownership can't be determined cleanly.

## Decisions Made

- **Two complementary changes over one.** Considered legitimizing the main-checkout write by committing every member's branch into main *before* creating the worktree (avoids new scan machinery). Rejected: it creates a crash-window "wedge" state (base commit recorded a branch with no worktree on disk yet, hard-blocking recovery) and flips two load-bearing first-implement gates before the branch/worktree actually exist. The chosen approach's own crash window degrades to the pre-fix behavior in an already-deferred corner case, rather than hard-blocking.
- **Bootstrap writes secondaries first, leader last.** The leader's worktree `branch` field doubles as the durable "bootstrap complete" marker elsewhere in the codebase; writing it last is a zero-cost ordering choice that narrows (but does not eliminate) the mid-loop-crash exposure window.
- **Present-but-unreadable candidate status fails closed (`die()`), never silently skipped.** A candidate that can't be safely interpreted (malformed JSON or a schema-invalid field like a non-string `branch`) means ownership can't be determined; skipping it would risk silently re-dirtying main. Code review confirmed this is the spec's explicit tradeoff, not a defect.
- **Orphan-worktree `die()` detection is intentionally weaker for secondaries.** When the scan succeeds but finds zero matches, resolution now falls through to the main-checkout default rather than dying, because dying on an empty branch would break legitimate pre-implement resolution (before any worktree exists yet). The leader retains its existing detection.
- **The bundle bootstrap's separate crash-consistency hole is out of scope and deferred.** A mid-loop process exit stranding a blank secondary behind an already-set leader branch was traced to source but not reproduced; per canon's reproduce-before-fix rule it's tracked as a follow-up (already recorded in `docs/BACKLOG.md` by a prior commit) rather than fixed here.

## Open Questions

- **Resolved worktree path canonicalization is inconsistent across resolution branches (low severity, flagged by code review).** The new content-scan match returns git's realpath-canonicalized worktree path, while the pre-existing leader/by-id path returns a non-canonicalized join. On a filesystem with a symlinked worktrees root (e.g. macOS `/tmp` → `/private/tmp`) these can be different strings for the same directory. No current caller does exact string-equality between two resolved cwds, so this is latent only — flagged so a future "same worktree?" comparison doesn't get written against it. Left open per reviewer (optional fix: canonicalize both sides, or neither).
- Several other low-severity/nit findings from code review were left open as optional (not addressed): parse-before-disqualify ordering could narrow the fail-closed blast radius; a redundant defensive guard in the match condition; unreachable `break` statements after `die()`; a bootstrap `ENOENT` on a never-committed bundle member throws a bare error instead of an actionable `die()` message; the worktree-enumeration REPO_ROOT filter uses exact string comparison rather than realpath. None block shipping — human can decide whether any warrant a follow-up.
- The deferred crash-consistency follow-up (blank-secondary stranding on mid-loop crash) is tracked in `docs/BACKLOG.md` but not yet filed as its own canon task — human should decide if/when to spec it.
