# Completion Summary: watch-crash-not-step-done — Watch reports a crashed full-auto run as death, not step_done

> For the human. This is what you need to know.

## What Changed

`canon watch` could report a crashed detached run as a finished step. When a full-auto run died right after a phase finished (for example the planning session failed on an expired login), watch printed `state=plan reason=step_done` and exited 0, so whoever was waiting on it assumed the phase had completed. Watch now checks for crash evidence before it calls a run `step_done`. A run counts as crashed when the run log's last exit line is non-zero (including a run stopped by a signal), or when the run's runtime files survive a dead process. Those cases print `reason=death` and exit 4. The crash reason goes to stderr as a separate `canon watch:` line, and the stdout summary line keeps its existing shape. A clean `--step` finish and a clean stop at a human gate (exit 0) still report `step_done`.

Known gap, deliberately left out of scope: a `canon watch` started after the run has already died still reports `nothing_to_watch` (exit 2). The fix only applies when watch was attached before the run exited. See Open Questions.

## Files Changed

- `src/cli/commands/watch.ts` — idle classification checks crash evidence before returning `step_done`; the `death` result carries the exit reason; `watchCmd` prints it to stderr.
- `src/orchestrator/run-context.ts` — one exported helper reads the last exit line from the bounded tail of `.canon-run.log`.
- `tests/watch.test.ts` — regression tests for the crash shape (written red first), clean and stale-marker cases, tolerance boundary, marker parsing, and `watchCmd` stdout/stderr/exit code.
- `docs/pipeline-orchestrator.md` — exit-code table rows for `0` and `4`, plus a sentence on the stderr reason, placed after the summary-line block.
- `templates/docs/pipeline-orchestrator.md` — regenerated mirror of the doc above (not hand-edited).
- `dist/cli/index.js` — rebuilt bundle. It is a working-tree change until the pipeline commits it.

## How to Test

1. Start a full-auto `canon run` on a scratch task and make the planning step fail partway through (for example, break the agent's login for that session).
2. Run `canon watch` on that task while it is still running, and let the run die.
3. Expected: watch exits with code 4. Its last stdout line reads `reason=death`, and stderr shows one `canon watch:` line naming the failure reason and suggesting `canon run <id>` to resume. It does not say "step done."
4. Run a single phase in step mode (`canon run --step`) on another scratch task and watch it afterwards.
5. Expected: watch reports a normal step completion (`reason=step_done`, exit 0).
6. Optional: stop a running task with `canon stop`. Expected: watch reports `reason=death` with a termination reason, not `step_done`.

## Test Results

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass (implement phase; not re-run in QA) |
| Type-check (`npm run type-check`) | Pass (implement phase; not re-run in QA) |
| Unit tests (`npm test`) | Pass — QA re-run: 1492 tests, 0 failing. Implement phase had one failure in `tests/run-task-signals.test.ts:314` (SIGTERM exit-marker test) that passed on the QA re-run and on an isolated run; not investigated further |
| Watch test file (`npx tsx --test tests/watch.test.ts`) | Pass — 46 tests (implement phase) |
| Build (`npm run build`) | Pass (implement phase, run twice with stable output) |
| Template sync (`npm run sync-templates:check`) | Pass (implement phase) |
| Docs refs (`npm run docs-refs-check`) | Pass (implement phase) |
| E2E | Not in the spec's validation list; not run |

## Human Verification Required

None.

Handoff pre-merge checklist (items not yet confirmed):
- [ ] Version correct: not set here. Versioning happens at the release step, per `docs/decisions.md` §"Versioning and release policy".
- [ ] Changelog updated: proposed text is below; the human finalizes it at the release step.
- [x] PR body current: `tasks/watch-crash-not-step-done/pr-body.md` drafted.
- [ ] Final CI/CD checks green: not run; `--pr` has not been run.
- [ ] Final diff matches spec intent: AC-11 is still open. After the pipeline commits `dist/cli/index.js`, run `npm run build && git diff --exit-code -- dist/` to confirm the committed bundle is fresh.

## Proposed Changelog

- **`canon watch` reports a crashed detached run as a death, not a finished step.** A full-auto run that exited with an error right after a phase finished used to show `reason=step_done` and exit 0. It now shows `reason=death` and exits 4 when the run log's last exit line is non-zero, including a run stopped by a signal, or when the run's runtime files survive. The reason prints to stderr; the summary line is unchanged. A clean `--step` finish and a clean stop at a gate still report `step_done`. Watch must be attached before the run exits to see this; a watch started after the crash still reports `nothing_to_watch`.

Scope: a `### Fixed` entry. Watch's exit code and reason change for crashed runs, which users and scripts can see. The `docs/pipeline-orchestrator.md` wording change is guidance. The version tier is the release step's decision.

## Decisions Made

- **Reason on stderr, summary line unchanged.** The stdout summary contract is stable for agents that parse it, so the crash reason goes to a separate stderr line. Chosen in spec review round 1.
- **Signal-terminated runs count as crashes.** A `signal:<NAME>` exit line is non-zero, so `canon stop` and Ctrl-C during a phase now report `death`, not `step_done`. The spec calls this intended; it is a visible behavior change, and the stop reason is printed.
- **Marker parsing is tail-anchored.** The writer emits no leading newline, so a marker can follow unterminated agent output. The regex matches anywhere and requires the ISO timestamp to end the line or file. Chosen in the spec's Round 2 amendment after code review.
- **Only the last 64 KiB of the run log is read.** Bounds the cost on long detached logs.
- **Tolerance boundary.** A marker up to 1000 ms older than the `status.json` mtime still counts as a crash; anything older counts as stale. Timestamp granularity makes the boundary fuzzy, and the spec prefers reporting a crash.
- **Pid evidence requires the pid to be dead.** The planning-stage check treats surviving runtime files as crash evidence only when the pid is not alive. Added at plan time to match the spec's "pid dead" premise.
- **Code review spec_gap accepted by the operator.** Code review's only surviving finding is the attach-time gap described above. It is a spec Non-Goal, so the operator accepted it with `canon task accept` as sanctioned. Notes say a follow-up issue was filed; the issue number is not recorded in the task files.

## Open Questions

- **Attach-time crash.** Should a `canon watch` that starts after a run has already died report `death` (exit 4), not `nothing_to_watch` (exit 2)? That path (`classifyAttach`) is a Non-Goal of this task. Doing it needs the exit-marker check and dead-pid evidence on the attach path too. Decide: follow-up task or this release.
- **Stop shows as death.** Is `canon stop` (and Ctrl-C mid-phase) reporting `death` with exit 4 the behavior you want? Spec says yes; please confirm.
- **Flaky test.** `tests/run-task-signals.test.ts:314` failed once during implement and passed on the QA re-run. Not investigated. Worth a look if it recurs.
- **Changelog version.** Bump tier and version number are for the release step.

Maintenance: lessons-learned.md plus this task's fragment have 16 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: First spec_review was changes_requested (round 1, AC-8 had no output channel); code_review spec_gap on attach-time gap sanctioned by operator; AC-11 dist freshness check pending the pipeline commit.
