# Completion Summary: review-verdict-freshness-guard — Reject stale review verdicts from crashed agent invocations

> For the human. This is what you need to know.

## What Changed

The pipeline's crash recovery had a real bug: when a Codex `spec_review` invocation crashed (out-of-credits, auth, network, or an MCP error) after exiting non-zero without finishing, the orchestrator's recovery path read whatever verdict happened to still be sitting in the shared review artifact from the *prior* round and advanced the phase as if that crash-round review had actually happened — inflating the durable iteration counters and, in a live incident, false-triggering the auto-block on a revision that had never been reviewed. This task closes that hole with a fail-closed fix: the orchestrator now parks (halts with an actionable message) whenever a Codex `spec_review` exits non-zero without reaching `done` on its own, instead of trusting the on-disk artifact. No verdict is read, no counters move, and no retry is attempted. Every other recovery path — a `spec_review` that completed and self-bookkept despite a noisy non-zero exit, a clean-exit `spec_review` that skipped bookkeeping but has a fresh verdict, and all `code_review`/`plan`/`implement`/`qa` recovery — is unchanged. The design went through three spec_review rounds: rounds 1 and 2 each rejected a mechanism that tried to prove the on-disk verdict was fresh, for structural reasons tied to the review artifact's loose format and its append-only history; round 3 pivoted away from that approach entirely to the simpler fail-closed park, which sidesteps all of those objections by never reading the artifact on a crash.

## Files Changed

- `scripts/run-task/main.ts` — Added the `spec_review`-scoped crashed-review park check and the fail-closed halt (before recovery/retry) in the orchestrator's routing logic.
- `tests/run-task-safety.test.ts` — New regressions: stale-verdict park + counter protection (red-first), actionable park message, done-phase/clean-exit paths unaffected, `spec_review`-only scoping.
- `docs/pipeline-orchestrator.md` — Documents the park behavior, the fail-closed rationale, the operator re-run flow, and the deliberate benign-sub-case tradeoff.
- `templates/docs/pipeline-orchestrator.md` — Regenerated canon-managed mirror of the above (auto-synced).
- `docs/patterns.md` — New Known Pitfall: a non-zero agent exit is not a completed review; recovery must park before reading the artifact.
- `docs/BACKLOG.md` — Cross-references this fix from the existing "no agent CLI exit may kill the orchestrator" bug under a shared "agent-failure ≠ phase success" theme, and records the deferred in-band per-invocation verdict-freshness follow-up.
- `dist/scripts/run-task.js` — Regenerated bundle; build is byte-stable on repeat. `dist/cli/index.js` unchanged.

## How to Test

1. Start a task and let it reach a spec review step that has already gone one round (so a prior round's verdict is on record).
2. Simulate the review tool being unavailable for the next round — e.g., exhaust the reviewer's credits — and let the pipeline run that review step.
3. Expected (after this fix): the pipeline stops with a clear message saying the review did not actually run, names the likely cause (out of credits / auth / network), and tells you to fix it and re-run. It must **not** report a review result, must **not** advance to the next step, and must **not** count that round against the review limit.
4. Restore the reviewer (e.g. add credits) and re-run. Expected: the review now runs for real and produces a genuine result; the round count reflects only real review rounds, not the outage.
5. Confirm the round counter shown for the task did not increase during the outage.

The live incident that motivated this task — a reroute amendment review that ran out of Codex credits twice, inflating the loop counter to the auto-block cap before the revised work was ever reviewed — is the real-world version of this scenario.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit/integration tests (980: 979 pass, 1 expected environment skip) | Pass |
| Build (byte-stable rebuild; only declared bundle changed) | Pass |
| `docs-refs-check` | Pass |
| `sync-templates:check` | Pass |
| Code review (3-lens: anchored Claude, cold Claude, cold Codex) | Approved with nits — all 9 ACs met, no correctness bugs, no risk/guardrail findings, no spec gaps. One non-blocking cosmetic nit: a crashed review now prints its exit status in two log lines instead of one — not addressed. |

## Human Verification Required

None. All validation checks resolved to `Pass`; no `human_pending` rows in the handoff's Validation Outcomes table.

One thing the automated checklist can't confirm yet: **final CI/CD checks green** — no PR is open yet, so there's no CI run to point to. Confirm CI is green after `--pr` opens the draft PR, before merging.

## Proposed Changelog

**`canon run` no longer fabricates a `spec_review` verdict when Codex crashes mid-review.** When a Codex `spec_review` invocation exited non-zero without completing — out-of-credits, auth, network, or an MCP crash — the orchestrator's recovery path read whatever verdict was still sitting in the cumulative review artifact from the *prior* round and advanced the phase anyway, silently inflating the durable iteration counters. Confirmed live: two consecutive out-of-credits crashes during a reroute re-review each recorded a phantom `changes_requested`, pushing the loop counter to the auto-block cap before the revised work had actually been reviewed. `checkAndRoute()` now parks on a crashed Codex `spec_review` instead of advancing — no verdict is read, no counters move — and prints an actionable message naming the exit code, the likely recoverable cause, and the re-run command. The park applies only to Codex `spec_review`; every clean-exit and `code_review` recovery path is unchanged. Ships to adopters via `canon upgrade`.

## Decisions Made

- **Design pivoted away from in-band verdict freshness to a fail-closed park (spec revision round 3).** Rounds 1 and 2 each rejected a mechanism that tried to make the on-disk artifact prove its own freshness (a whole-file fingerprint, then invalidating the latest reviewed section), for structural reasons rooted in the same conflict: any such mechanism fights the artifact's loose parsing rules and its requirement to preserve prior-round history. Round 3 dropped that approach entirely in favor of reading no artifact at all on a crash — every prior objection evaporates by construction. General "prove the verdict is fresh" checking is deferred to `docs/BACKLOG.md` as a distinct, larger follow-up.
- **Deliberate behavior change, already surfaced to a human before implementation (spec Known Risks, human spec gate):** a genuine `spec_review` verdict produced *and then* a non-zero exit (e.g., MCP shutdown noise) *and* skipped self-bookkeeping now **parks** for a manual re-run instead of auto-advancing as it did before. The old auto-advance for this case was never actually sound — the orchestrator can't tell it apart from the crash-with-stale-verdict bug this task fixes — so parking is the fail-closed correction, at the cost of an occasional manual re-run in the rare benign case. `status.json` shows `human_spec_gate: false`, meaning this gate already fired and was consumed during the spec_review rounds, per the single-use-latch semantics in `docs/pipeline-orchestrator.md`.
- **Test placement deviated from the plan's suggested new file.** Tests landed in the existing `tests/run-task-safety.test.ts` (which already runs this logic in isolated subprocesses) rather than a new file, because that isolation is what's needed to exercise the real halt behavior without leaking state between tests. No effect on what's covered.

## Open Questions

None requiring a decision — the core product tradeoff (benign sub-case now parks instead of auto-advancing) was already raised in the spec's Known Risks and passed through the human spec gate before implementation. Worth a final skim at `human_review`: the new recovery section in `docs/pipeline-orchestrator.md`, since it's the operator-facing description of what to expect the next time a Codex `spec_review` crashes.

Maintenance: lessons-learned.md has 16 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
