## Summary

- Fix `canon run <id> --reroute` orphaning: bare `--reroute` now auto-detaches before entering the phase loop, so rerouted pipelines survive operator-session kills exactly like a plain `canon run`.
- Extract `isSynchronousMode()` into an exported, unit-tested predicate in `cli.ts`; strip `--reroute` from the re-exec child argv in `detach.ts` so the detached child resumes from the reset phase without re-running the reroute guard.
- Update `docs/pipeline-orchestrator.md` and `CLAUDE.md` to reflect the new detach behavior and replace the two-command stepped reroute sequence with a single combined `--reroute --step --expect <phase>` command.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/scripts/run-task.js`; `dist/cli/index.js` unchanged)

## Notes

The central hazard was the re-exec double-reroute: `detachAndExit` re-execs the original argv (including `--reroute`) with `CANON_DETACHED=1`. A naive "remove `reroute` from the synchronous-mode predicate" would replace the orphan bug with an instant-death bug, because the child would re-enter `rerouteFromHumanReview()` and abort on the "requires human_review" guard. The fix strips `--reroute` from the child argv rather than relying on `CANON_DETACHED` as a guard — `CANON_DETACHED=1` is inherited by all subprocess children and would have incorrectly suppressed the reroute reset in those contexts.

The doc update also removes the previously-documented two-command reroute sequence (`canon run <id> --reroute` then a separate `canon run <id> --step --expect <phase>`). After this change, the first command detaches and keeps running, so issuing the second command would launch two orchestrators against one worktree. The single combined form (`--reroute --step --expect <phase>`) is the replacement.
