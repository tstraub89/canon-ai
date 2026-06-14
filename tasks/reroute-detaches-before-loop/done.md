# Completion Summary: reroute-detaches-before-loop — Detach --reroute before the phase loop so rerouted runs survive harness kills

> For the human. This is what you need to know.

## What Changed

`canon run <id> --reroute` now auto-detaches and runs the phase loop in a `setsid()`'d child process — the same way a plain `canon run` works. Previously, bare `--reroute` was incorrectly classified as a synchronous one-shot mode and ran the long-running phase loop in the foreground. When the operator session or parent shell was killed, the rerouted pipeline was orphaned mid-phase (observed as `reason=death` in `canon watch`).

The fix extracts the synchronous-mode decision into a testable `isSynchronousMode()` function in `cli.ts` (covering `--pr`, `--push`, `--ship`, `--step`, `--expect`, but not `--reroute`), wires it into the detach gate in `main.ts`, and strips `--reroute` from the re-exec child's argv in `detach.ts` so the child resumes from the reset phase without re-running the reroute reset.

The reroute reset banner and any invalid-reroute errors still fire in the foreground parent before detaching — so the terminal feedback operators rely on is preserved. `--reroute --step` stays foreground as the stepped escape hatch. The operator docs are updated throughout: bare `--reroute` now says "auto-detaches (monitor with `canon watch`)" and the previously-documented two-command reroute sequence is replaced with a single combined `--reroute --step --expect <phase>` command.

## Files Changed

- `scripts/run-task/cli.ts` — new exported `isSynchronousMode(args)` predicate
- `scripts/run-task/main.ts` — detach gate calls `isSynchronousMode()`; detach comment updated; `rerouteFromHumanReview()` stays before the gate
- `scripts/run-task/detach.ts` — strips `--reroute` from detached child argv
- `tests/detach.test.ts` — unit tests for predicate rows and child argv stripping
- `CLAUDE.md` — updated "Reroute step guards" quick-ref
- `templates/CLAUDE.md` — auto-synced mirror
- `docs/pipeline-orchestrator.md` — removed `--reroute` from synchronous-mode list; collapsed two-command stepped examples to single combined commands
- `templates/docs/pipeline-orchestrator.md` — auto-synced mirror
- `dist/scripts/run-task.js` — rebuilt bundle

## How to Test

1. Take a task to `human_review` (or to a `code_review` `spec_gap` block). Run `canon run <id> --reroute` from an operator session.
2. Confirm the reset banner ("Rerouting: … → …", "Status reset…") prints inline, then the orchestrator reports it's detached — PID and log path shown.
3. While the detached run is active, kill or close the operator session/terminal.
4. Expected: the rerouted pipeline keeps running. `canon watch <id>` reports progress and reaches its next checkpoint or completion instead of dying. Previously this kill caused `reason=death`.
5. For a full-tier task, run `canon run <id> --reroute --step --expect spec_review`. Confirm it runs exactly one phase in the foreground and exits — stepped behavior unchanged.
6. Attempt a reroute on a task not at `human_review` (or missing the required Amendment section). Confirm it fails inline with a non-zero exit and does **not** detach.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (865 pass, 1 skipped, 0 fail) | Pass |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| E2E | deferred_by_spec (no E2E surface for orchestrator; spec §Validation Required marks it n/a) |

## Human Verification Required

None.

## Decisions Made

**argv-strip over CANON_DETACHED env guard**: The spec offered two mechanisms for preventing the re-exec child from re-running the reroute reset: (a) guard `rerouteFromHumanReview()` with `if (process.env.CANON_DETACHED !== '1')`, or (b) strip `--reroute` from the child argv in `detachAndExit()`. The implementation chose (b). `CANON_DETACHED=1` is inherited by every subprocess the orchestrator spawns — agent runners, test processes — so an env-only guard would incorrectly suppress the reroute reset whenever `main()` is re-entered in those contexts. The argv-strip is scoped precisely to the re-exec child created by `detachAndExit()`.

## Open Questions

None.

## Proposed Changelog

**Version bump**: 1.12.1 (patch) — bug fix only, no new features.

```markdown
### Fixed

- **`canon run <id> --reroute` now auto-detaches**, so rerouted pipelines survive operator-session kills, SSH disconnects, and harness process-group kills. Previously, bare `--reroute` ran the phase loop in the foreground and was orphaned on any parent kill — each orphan required a manual `canon run` recovery. The reset banner and invalid-reroute errors still print inline before detaching; monitor the rerouted run with `canon watch`. The stepped escape hatch is now a single combined command: `canon run <id> --reroute --step --expect <phase>` (full tier: `spec_review`; fast tier: `implement`). The previously-documented two-command sequence is removed — it would now launch two orchestrators on one worktree.
```
