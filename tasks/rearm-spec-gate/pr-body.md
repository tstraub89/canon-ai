## Summary

- Make `human_spec_gate` settable via `canon task set <id> human_spec_gate true|false` (case-insensitive), so the gate can be re-armed without hand-editing `status.json`.
- Arming on a full-send task also clears `full_send` in the same atomic write and prints how to re-enable it (`canon run --full-send <id>`); a re-armed gate never fires on a full-send task otherwise. Arming on a task whose `spec_review` is already done prints a note that the gate only fires again after a full-tier `canon run --reroute <id>`.
- Disarming (`false`) is refused on delicate tasks and points at `canon run --full-send --force <id>`, so the only sanctioned gate skip there stays behind `--force`.
- Correct the `full_send` refusal message (it persists in `status.json` until `--reroute` or arming the gate clears it), and have `canon task new` point at `canon task set` instead of editing `status.json`.
- Update `docs/pipeline-orchestrator.md`, `docs/decisions.md`, and the `canon-spec` skill (plus `templates/` mirrors) to the new contract; the skill now uses `canon task set` / `canon task phase` instead of manual edits.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (1,349 passed, 0 failed, 1 skipped: the linked-worktree `REPO_ROOT` test, which needs `.git/` writes the sandbox restricts)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt and committed `dist/`)

## Notes

- No orchestrator changes: the gate's firing and consumption are untouched. A new preflight test pins that a re-armed gate halts after an approved full-tier reroute review.
- Once `spec_review` is done, the generic "takes effect on the next canon run" warning is suppressed for both values: arming prints the reroute note, disarming prints nothing.
- Known gaps, accepted as low severity and worth follow-up issues: the completed-review note advertises a full-tier reroute that isn't admitted right after the gate halts (and prints for fast-tier tasks); and `delicate false` → gate `false` → `delicate true` sidesteps the delicate disarm refusal, since the guard only checks the task's state at the gate call.
- Manual check: `canon task set` on a throwaway task covering arm with full-send, disarm, delicate refusal, and the `full_send` refusal wording.
