# Completion Summary: preroute-review-loop-autoblock — Auto-block review loops before the next revision cycle, not after

> For the human. This is what you need to know.

## What Changed

Canon's `spec_review` and `code_review` review-loop auto-blocks used to trip only when the review phase was re-entered — which happens only *after* a `changes_requested` verdict had already routed the pipeline back to a fresh spec-writing or re-implementation session. So every time a loop was about to hit its cap, the pipeline burned one more full revision cycle before a human ever got a chance to intervene. This task moves the cap check to the entry of the revision phase itself (`spec` / `implement`), before any agent is spawned or side effects run, and keeps the old review-phase check as a defense-in-depth backstop. Both checkpoints now share one evaluator per loop so they can never disagree on the threshold, the counter formula, or the wording — including the trickiest part, which is that the two checkpoints persist *different* states, so "what runs first when you resume" has to be derived from state rather than asserted as a blanket promise. Along the way, three related consumer-side gaps got closed: `canon task accept --force` now correctly completes the deferred phase instead of leaving it pending, `canon watch` no longer misreports a live cap-raised resume as blocked (or a genuine block as settled), and a malformed `MAX_REVIEW_LOOPS` value now warns and falls back to the default instead of silently disabling the guard.

Getting there took a four-round spec (each round Codex found a real gap in the previous round's mechanism — a missing continuation path, a reset command that would throw from the new state, a resume-order message that lied at the backstop) and a code-review cycle that itself ran three rounds after an initial `spec_gap` verdict flagged the three consumer-side gaps above, which became a spec Amendment. Two Stage-2 correctness findings survived that amendment round (an undisclosed state write in the reset commands' recovery text, and a resume-order promise that lied in one state); both were fixed in a following round by extracting one shared, parameterized recovery-text helper rather than patching each surface individually. Final code-review verdict: **Approved with nits** — all 24 ACs met, full validation gate green, zero surviving correctness or spec-gap findings.

## Files Changed

- `scripts/run-task/review-loop.ts` (new) — shared per-loop cap evaluators: threshold, per-task combined-attempt formula, state-derived recovery reasons, zero-cap support, and the (now `--step`-free) cap-raise command.
- `scripts/run-task/phases/spec.ts` — new `spec_review` loop-cap checkpoint before either `runClaude` call.
- `scripts/run-task/phases/implement.ts` — new `code_review` loop-cap checkpoint before branch/worktree setup or artifact commit.
- `scripts/run-task/phases/spec-review.ts`, `scripts/run-task/phases/code-review.ts` — review-entry backstop checks now route through the shared evaluators instead of their own inline logic.
- `src/task/index.ts` — `reset-code-review` accepts the one new blocked-at-`implement` state and discloses the `implement → done` write; `accept --force`'s "Next phase" message is derived from actual state and completes the deferred predecessor phase; bundle-divergent accepts are refused atomically.
- `src/cli/commands/watch.ts` — block/settlement classification gated on orchestrator process liveness instead of which phase is blocked or current; ambiguous-PID checked first.
- `scripts/run-task/env.ts`, `scripts/run-task/policy.ts` — `MAX_REVIEW_LOOPS` raw-string validation shared across both config surfaces; malformed/negative values warn and fall back to the default, `0` stays a valid immediate-block override.
- `tests/run-task-safety.test.ts`, `tests/run-task-code-review.test.ts`, `tests/task-cli.test.ts`, `tests/watch.test.ts`, `tests/pipeline-policy.test.ts`, `tests/run-task-harness.test.ts` — new coverage for every AC, including invocation-logging fake agents and real-git subprocess fixtures.
- `.claude/skills/canon-pipeline/recovery.md` + `templates/` mirror — "Phase mismatch" section no longer prescribes a counter reset.
- `docs/architecture.md`, `docs/product-context.md` — reworded to describe the revision-entry checkpoint and both reset commands' predecessor-accepting write.
- `docs/pipeline-orchestrator.md` + `templates/` mirror — auto-block timing, recovery block, and cap-raise command (no more `--step`) updated.
- `docs/BACKLOG.md` — new entry recording (not fixing) a pre-existing `promptSpecRevision`-unreachable-on-resume defect.
- `dist/scripts/run-task.js`, `dist/cli/index.js` — rebuilt; `git diff --exit-code -- dist/` clean.

## How to Test

1. Start a task and drive `spec_review` to repeated change requests (or set a low cap) until the loop hits its limit.
2. On the round that hits the cap, confirm the pipeline stops immediately with an auto-block message and that no new spec-writing session starts — the rejected round's work is left untouched.
3. Read the message: it should lead with raising the review-loop limit and continuing, offer a single named `canon task reset-spec-review <id>` command as the rescope fallback (never a hand-edit instruction), and say which step actually runs first if you resume.
4. Resume without raising the limit — confirm it stops again immediately, still without starting a revision session.
5. Raise the limit and resume — confirm the spec revision runs first, and only then does review run again.
6. Instead, run the reset command exactly as printed — confirm it's accepted from the blocked state, archives the old review write-up, and the next round produces a fresh review of the same spec rather than another revision.
7. Repeat steps 1–6 for the `code_review` loop (repeated implementation change requests): confirm no re-implementation starts at the block, the message leads with raising the limit and names `reset-code-review` as the fallback, a raised-limit resume re-implements first and reviews second, and the reset command is accepted and archives the old review.
8. While a cap-raised resume is running, run `canon watch <id>` in another terminal — confirm it reports the resume as in progress, not blocked, and that `--until` doesn't report "settled" before the resumed work has actually run.
9. Expected: in both loops, the work product is untouched by the round that hits the cap, resuming is never a silent extra cycle, every recovery option the message prints works from the state you're actually in, and `canon watch` tracks reality rather than the last-written status field.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (1099/1099, 0 fail — independently re-run by code review across all 3 rounds, not just taken from the handoff) |
| E2E tests | N/A — no UI/runtime surface |
| Build | Pass (`dist/` rebuilds byte-identical to a fresh build) |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| `git diff --check` | Pass |
| Red-first regression tests (per-AC) | Pass — every AC's red-first fixture confirmed to fail pre-fix and pass post-fix |

## Human Verification Required

None. The latest Validation Outcomes table (handoff.md, Iteration 3) shows no `human_pending` rows — every required check ran and passed, independently re-verified by 3 rounds of code review.

**Handoff Validation pre-merge checklist:**
- [x] Version correct — N/A, version/changelog are decided at the release step, not per-task.
- [ ] Changelog updated if needed — draft proposed below; human finalizes via `/canon-changelog`.
- [x] PR body current — drafted in `tasks/preroute-review-loop-autoblock/pr-body.md`.
- [ ] Final CI/CD checks green — no hosted CI observed in this environment; all checks above were run and independently re-verified locally, three separate times, by code review.
- [x] Final diff matches spec intent — confirmed by 3 rounds of code review against all 24 ACs; final verdict Approved with nits, zero surviving correctness or spec-gap findings.

## Proposed Changelog

### Fixed

- **The `spec_review` and `code_review` auto-block on a runaway review loop now fires before the next revision starts, not after burning one more full cycle.** Previously the loop-cap check only ran when the review phase was re-entered — which happens only after a `changes_requested` verdict had already routed the pipeline back to a fresh spec-writing or re-implementation session, so hitting the cap always cost one more wasted revision first. The check now also fires at the revision phase's own entry (`spec` / `implement`), before any agent is spawned or side effects run; the existing review-phase check remains as a defense-in-depth backstop. The auto-block message now says which phase actually runs first if you resume — the deferred revision at the new checkpoint, or the review directly at the backstop — instead of an unconditional promise that doesn't hold in both states. `canon task reset-spec-review`/`reset-code-review` now discloses that resetting accepts the current spec/implementation as-is for a fresh review, rather than requesting another revision pass; `reset-code-review` now also works directly from this new blocked state. `canon task accept --force` and a plain (no `--step`) resume after raising `MAX_REVIEW_LOOPS` both now correctly complete the deferred phase instead of leaving it pending. Ships to adopters via `canon upgrade`.
- **`canon watch` no longer misreports a healthy cap-raised resume as blocked, or a stale auto-block marker as still settled.** Block and settlement classification (`classifyAttach`, `classifyIdle`, `orchestratorStillProgressing`, and `--until`) used to key off which phase carried a `blocked` status rather than whether the orchestrator process was actually still running — so a live resume mid-revision could be reported as terminally blocked, and separately, `--until <phase>` could report "settled" against a stale blocked marker before the resumed work had actually run. Classification is now gated on orchestrator process liveness, with an ambiguous-PID state checked first. Ships to adopters via `canon upgrade`.
- **`MAX_REVIEW_LOOPS` now rejects malformed override values with a warning instead of silently truncating them or disabling the auto-block guard.** A decimal, trailing-junk, or negative value (e.g. `1.5`, `2junk`, `-1`) used to parse into something that silently weakened or disabled the loop-cap guard with no signal to the operator; invalid raw values now fall back to the normal size-aware default and print a warning naming the rejected value. `MAX_REVIEW_LOOPS=0` remains valid as an explicit "block immediately" override. Ships to adopters via `canon upgrade`.

## Decisions Made

- **Relocate the checkpoint, don't gate `checkAndRoute()`.** The first spec design tried adding the cap check inside `checkAndRoute()` and skipping `routeBackTo`. Codex correctly rejected that shape (it leaves the wrong phase "current" after a block, so the documented recovery would re-review unchanged work forever). The shipped design instead moves the checkpoint to the revision phase's own entry and leaves `checkAndRoute()`/`routeBackTo` untouched — `routeBackTo` is what persists the continuation, not an obstacle to route around.
- **Two different "authoritative current state" rules for two different consumer families.** State-derivation consumers (`reset-code-review`'s precondition, `accept --force`'s message/write) trust `deriveTopLevelStatus()` — the derived current phase. Watcher consumers (`canon watch`'s block/settlement classifiers) trust orchestrator process liveness instead, because a revision-entry block and a review-entry backstop block persist different phase-current states, and gating the watcher on phase identity would silently stop reporting one of the two shapes.
- **Widen `reset-code-review`'s precondition by exactly one state**, mirroring `taskResetSpecReview()`'s existing no-precondition `spec → done` write, rather than inventing a different recovery path — proven a no-op on every state the command accepts today.
- **Drop `--step` from both recovery commands.** Under the relocation, `--step` runs only the deferred revision and stops, so the backstop re-blocks on the very next invocation unless the operator re-exports the variable. A plain `MAX_REVIEW_LOOPS=<n> canon run <ids>` now runs the revision and the following review in one process.
- **`MAX_REVIEW_LOOPS=0` stays a valid "block on the very next attempt" sentinel**, not folded into a first-pass exemption — it's an existing, intentionally-tested override, and the spec explicitly carves it out by name.
- **Repeated no-op resumes are never deduplicated** — each one appends a fresh `escalations` entry and increments `auto_block_count`, consistent with this project's "never reset or suppress counters" rule, even though it means the array grows on every reflexive re-run.
- **Deferred, not fixed: the `promptSpecRevision` unreachability bug.** Traced during spec authoring (a deferred spec revision receives the first-write prompt, not a resume prompt, because `routeBackTo('spec')` clears the verdict the prompt-selection logic keys on) and confirmed live in this task's own run log. Recorded in `docs/BACKLOG.md` rather than fixed — it's a separate defect class (prompt selection, not loop-cap timing) that would need its own red-first test. Code review flagged across all three rounds that this deferral now materially degrades this task's own headline recovery path on the spec loop (see Open Questions).

## Open Questions

1. **The spec loop's cap-raise recovery is degraded by the deferred `promptSpecRevision` bug.** This task's headline promise — "raise the cap → the deferred spec revision runs first" — currently has that deferred revision receive the first-write prompt with no resumed session, so Claude re-authors the spec from scratch rather than addressing the review findings. (The code loop is unaffected — `shouldUseImplementRevision()` already keys off counters.) This was a known, human-approved deferral before this task started, but code review flagged across all three rounds that this task increases exposure to it and recommends promoting its priority above "adjacent defect found while tracing" in `docs/BACKLOG.md`.
2. **`canon watch --until <review-phase>` reports a phase that never ran as "settled"** for the window after a cap-raised `--step` resume completes the revision but before the review phase itself starts (spec-mandated, not a bug — but flagged by both Claude and Codex review lenses across two rounds as confusing). Mitigating: `--step` runs synchronously in the foreground and the orchestrator doc already says a foreground `--step` needs no `canon watch`. Reviewer recommendation: a backlog entry, not a spec amendment.
3. **`docs/pipeline-invocations.md` is currently dirty** with telemetry rows from this task's own pipeline runs. It must land or be reverted before `canon run --pr`'s base-drift gate — it's the only non-`tasks/` file left dirty outside this diff.
4. **Doc nit not fixed by QA (outside the five protected docs):** `docs/pipeline-orchestrator.md`'s `reset-code-review` command-table row (~line 122) still doesn't mention the `implement → done` write this task adds to that command (code review's N21, called out as "the one item I would fold in during QA" — but `pipeline-orchestrator.md` isn't one of the five docs QA's freshness pass is scoped to touch). One sentence plus `npm run sync-templates` would close it.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: 4-round spec + 3-round code review (1 spec_gap on consumer-side gaps, then 2 correctness rounds); converged by extracting shared evaluators/recovery-text helpers instead of patching per call site; final verdict approved_with_nits, all 24 ACs met.
