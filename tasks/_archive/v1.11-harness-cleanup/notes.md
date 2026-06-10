# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `recordPinnedPRNumber()` no-ops when the PR number is already pinned, so a blanket `[skip ci]` on the artifacts commit would strand a dirty-tree `--pr` rerun with no follow-up commit.
[implement] The clean-tree `--pr` rerun path is not a stable HEAD-SHA invariant: the first open-PR pass can still emit the pin commit, so the safe regression is “tree stays clean and head stays unmarked,” not “HEAD never changes.”
[implement-reroute] The `.pr-number` sidecar has to be ignored in the fixture repo too (`makeGitFixture`), or the `git status --porcelain` assertions in the `--pr` tests false-negative on the new file instead of validating the sidecar flow.
[implement-revision] Pre-flight rejected the handoff because `docs/pipeline-invocations.md` was missing from the Changes table; the current reroute snapshot no longer has the older pipeline-orchestrator doc paths in its live diff.
[implement-revision] The pre-flight rejection was really about committed diff coverage: `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` were in the branch diff and needed explicit handoff rows even though they were not part of the live worktree diff.
[implement-reroute] `--ship` on an orphaned worktree still needs the tracked `tasks/<id>/status.json` mirror restored to `HEAD` before switching base branches; the fake-git safety fixture rejects `checkout -f`, so the safe path is a selective status-file restore plus the normal checkout.
[implement-revision] `earlyHeartbeatResolver` needs the same `cliArgs.ship` guard as the ship-path status fallback, or detached non-ship runs would incorrectly prefer the repo-root task mirror and starve `canon watch` of the live heartbeat.
[implement-revision] Round 2 review only surfaced nits: the latent `readSidecarPRNumber(taskId, taskDir = taskDirFor(taskId))` default-expression hazard, the extra ship-path status reread, and the S-delicate test-coverage gap. Deferred all three per round-3 tightening.
[implement-revision] Round 3 needed a distinct override tasks tree in the ship-path fixture, not the repo's own `tasks/`, or the override assertion could not distinguish the alternate path from the normal checkout. Moved `taskStatuses` above `readShipStatus` to remove the TDZ hazard if the pre-switch snapshot ever has to fall back.










