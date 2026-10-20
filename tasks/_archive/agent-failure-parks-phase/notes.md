# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[spec_review] Executed a temporary two-member spec_review fixture: A done/approved, B in_progress. autoBlockPhase([A, B], 'spec_review', ...) reopened A as blocked. Preserving A and parking only B made the next bundled main() --step exit 1 at assertSamePhase (A: plan, B: spec_review), before any agent ran. The spec's full-bundle park, completed-member preservation, and plain-rerun requirements need a consistent policy (B1 in spec-review.md).

[spec] Revision 1 (B1): chose atomic bundle reopening over preserve-and-split-resume. Every AgentSessionError throw site (phase-runner sessions, retryAgentForPhase from the per-member loop at the top of checkAndRoute) precedes routing writes, so a completed member has only gained its <currentPhase> done flag + artifact/verdict/counters; reopening loses no routing state. Split-resume would need a main-loop mode the same-phase check refuses and bundle routing doesn't support. Decision 7 + AC-13 added; counter double-count on a reopened review member recorded as an accepted quirk. Open question for the human gate: OK to redo a completed member's phase on bundle re-run?

[plan] Judgment calls (plan.md "Judgment calls"): (1) the cold-Codex throw uses kind 'exit_code' with no code. runColdCodexReview reports only success, and the spec fixes the kind union, so it is not widened. (2) The park's recovery hint is agent-aware: Claude gets "raise CLAUDE_BUDGET", Codex gets "credits/quota". (3) The wrappers drop setExitReason in the converted branches, because main's catch owns the exit reason. (4) The crashed-spec_review warn and escalation name the full bundle (`canon run A B`).

[plan] Re-entry trace: every runner sets in_progress before its agent, and no entry path refuses `blocked`. One degradation is outside scope: implement.ts:81 `wasImplementInProgress` gates resuming the stored codex session, so a parked (blocked) implement re-runs with the fresh prompt instead of resuming. This only matters when an implement retry crashes after a stored session. implement.ts is not in Affected Files, so it is left unchanged. Possible follow-up: treat `blocked` like `in_progress` there.

[plan] AC-6 is not red-first against pre-fix code: pre-fix also exits before the salvage. It guards against a return-instead-of-throw fix. The spec does not claim red-first for AC-6.

[implement] Red-first regressions reproduced the described failures: Claude exit-1 and Codex stall/signal exited the orchestrator with code 1; a returning non-zero Codex after member A completed left A done instead of blocked. The cold-review test observed process.exit rather than a typed rejection. After the fix, targeted tests passed for durable parks, plan/bundle reruns, QA salvage prevention, metrics, typed-only catching, and worktree-only status writes.

[implement] The existing fake-agent completer omitted plan from its derived-status mapping. A successful plan recovery therefore had plan done but stale top-level status plan in the fixture; added the plan -> implement mapping in the in-scope test helper. No production status derivation change was needed.

[implement] Re-entry trace confirmed all agent-run phases reset blocked to in_progress before the session. code_review's reviewer-block check runs later, inside checkAndRoute, so a crash-parked review re-enters normally. Review loop caps still apply, including the spec's accepted counter quirk when a completed bundle member is reopened. No agent calls occur after checkAndRoute begins verdict routing.
