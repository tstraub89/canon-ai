# Completion Summary: agent-backend-role-routing — Route pipeline phases through role-keyed agent backends

> For the human. This is what you need to know.

## What Changed

Pipeline phases no longer name Claude or Codex when they run an agent. Each phase asks for the agent that fills its role (author, spec reviewer, implementer, reviewer, cold reviewer, QA), and a backend module owns the vendor details. Under today's assignment, every command the orchestrator builds is unchanged: same binary, flags, model, effort, budget, working directory and prompt. Session IDs are now stored under role names (`author`, `spec_reviewer`, `implementer`, `reviewer`). Existing tasks keep resuming from their old slot names, and clearing a session on reset or reroute removes both the role and the old name. Two deliberate behavior fixes ride along: tasks whose phase entry was created by `canon task` now store, resume and retry sessions the same way template-created entries do, and QA's `done.md` recovery reads the agent's final text before the raw output. This is groundwork for a later Claude-only provider mode. It adds no provider setting.

## Files Changed

Source and tests:

- `src/lib/pipeline-policy.ts` — role model, phase-to-role and phase-to-slot maps, role-to-backend map, derived required binaries (all pure).
- `src/orchestrator/agents/backend.ts` — new. Backend interface, normalized session result, role resolver.
- `src/orchestrator/agents/claude.ts` — new. Claude backend around the existing runner; argv unchanged.
- `src/orchestrator/agents/codex.ts` — new. Codex backend around the existing runners; argv unchanged.
- `src/orchestrator/types.ts` — role session slots, optional legacy fields, agent record.
- `src/orchestrator/policy.ts` — re-exports the role policy.
- `src/orchestrator/state.ts` — role-first reads with legacy fallback, role-only writes, paired clears.
- `src/orchestrator/phases/spec.ts`, `plan.ts`, `spec-review.ts`, `implement.ts`, `code-review.ts`, `qa.ts` — call backends by role; QA salvage order changed.
- `src/orchestrator/main.ts` — storage by phase, retry and fix-ups by role, reroute clears, agent record, derived binary checks.
- `src/task/index.ts` — `reset-spec-review` and `reset-code-review` clear both slot names.
- `src/cli/deps.ts`, `src/cli/commands/doctor.ts` — required binaries derived from the role map; doctor still runs every check.
- `tests/agent-backend.test.ts` (new), `tests/pipeline-policy.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-validation.test.ts`.

Built output and docs:

- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.
- `docs/pipeline-orchestrator.md` and its mirror `templates/docs/pipeline-orchestrator.md` — role slots, legacy fallback, paired clears.
- `docs/patterns.md` — worktree recovery advice clears both names.
- `docs/codebase-map.md` — adds the backend entry point.
- `docs/decisions.md` — records role routing and the rule that a session ID belongs to the backend that created it.

I checked `docs/architecture.md` (its session-resumption paragraph names no slot keys) and found no stale slot names in the docs. QA made no docs edits.

## How to Test

1. Run a small task from spec through QA on the new build. Expected: the same agents, models and costs as before, and the task reaches human review. The only visible change in the log is the new slot names on "session stored" lines.
2. Open that task's status file. Expected: stored sessions use the role names, and each agent phase records which agent ran it.
3. Resume a task that was mid-flight before the upgrade, such as one waiting in code review. Expected: it resumes its previous review session instead of starting cold.
4. Send a task back from code review with a reroute, then resume it. Expected: the review starts a fresh session.
5. Run the environment doctor. Expected: it still checks for both agent tools, the Claude version and the Codex project trust.
6. Create a task with `canon task`, then run it. Expected: its spec session is stored and its implement retry resumes the stored session. Before this change, neither happened.

## Test Results

These are the results from the handoff's final validation run (iteration 2). QA did not rerun them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| Unit tests (`npm test`) | Pass — 1793 tests, 1792 passed, 0 failed, 1 skipped |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| E2E tests | N/A — not configured; the spec marks E2E N/A (no UI surface) |

The handoff reports one skipped test and does not name it or say why it skips.

## Human Verification Required

None.

Pre-merge checklist, none of which can be confirmed yet:

- [ ] Version correct (canon's release step decides the bump; not set by this task)
- [ ] Changelog updated if needed (release step, after human review)
- [ ] PR body current (`tasks/agent-backend-role-routing/pr-body.md` is drafted; no PR is open yet)
- [ ] Final CI/CD checks green (no PR yet)
- [ ] Final diff matches spec intent (human review)

The spec's Human Test Plan (the six-step list above) needs a live credentialed run. The handoff says no live Claude or Codex session was run. The fake-binary tests cover how commands are built, not the agents' real responses.

## Proposed Changelog

Entry text only. The release step picks the version and bump tier.

- **Tasks created with `canon task` now store, resume and retry agent sessions.** Their phase entries used to skip session storage and resume, so an implement retry started cold. They now behave like tasks created from the template.
- **QA recovers a `done.md` that the agent wrote only into its final message.** Recovery now reads the agent's text before the raw output, so a summary that appeared only in the final message is no longer lost.
- **New tasks store agent sessions under role names** (`author`, `spec_reviewer`, `implementer`, `reviewer`). Tasks that are already in flight keep resuming from their old names, and reset and reroute clear both names.

## Decisions Made

- **Session slot follows the phase, not the role.** Spec and plan share the `author` role, but only spec stores a session, so plan's one-off run cannot overwrite spec's session. (spec §Decision 3; AC-1(c), AC-4)
- **`phases[].agent` records the backend that ran the phase's primary role.** For code review that is the reviewer backend, not the cold lens. A preflight rejection records nothing and leaves the field unchanged. (spec AC-6(c)–(d))
- **QA salvage tries the agent's text first, then raw stdout.** The fallback uses `||` because the summary extractor returns an empty string on no match, not `null`. This is the fix for the Partial finding in code review round 1.
- **Red-first tests** for the empty-agent cases, and for the QA salvage case, run against the pre-change code and fail by assertion. The AC-6(a) test was also re-run against an isolated copy with only the legacy-slot seed. Handoff records the details.
- **Legacy-slot fallback is read-only.** Old keys are never written. Writes go only to role keys, and no bulk migration runs. (spec §Decision 3)
- **Config resolution is phase-aware.** Spec and plan get their own model pins (`CLAUDE_MODEL_SPEC`, `CLAUDE_MODEL_PLAN`) even though they share a role. (spec AC-3)

## Open Questions

- **Mixed-version downgrade (accepted, not handled).** An older canon engine that clears legacy keys leaves role keys alone. A newer engine can then resume a stale role-key session. The code-review cold lens flagged this as a non-blocking note. The spec sets forward compatibility only for newer engines reading older state. Confirm that is the intended boundary.
- **Session IDs are not tagged by backend (spec Decision 6, Known Risks).** Nothing stops a future assignment change from resuming a Codex session with Claude. The follow-up provider-mode task must pin the provider per task when the task is created. Still open for that task.
- **Live smoke run.** See Human Verification Required.

Maintenance: lessons-learned.md plus this task's fragment have 21 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 1
- Validation gaps: 0
- Notes: Code review round 1 found AC-8's stdout fallback unreachable (`??` on an empty-string extractor); fixed in iteration 2 and verified by fake-CLI tests.
