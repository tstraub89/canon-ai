# PR Body: provider-pin-agent-free-paths - Don't let an invalid provider pin block agent-free paths

## Summary

- `canon run <id> --ship` no longer resolves task provider pins. A task whose saved provider value was hand-edited to something invalid, or a bundle whose tasks disagree on provider, now merges and archives like any other task. Shipping starts no agent, so the pin never mattered on that path.
- `--ship` still reads and validates each task's status file at startup, so a malformed status file keeps refusing cleanly with no stack trace.
- `--dry-run` and `--ship --dry-run` keep the startup refusal for invalid pins and mixed bundles, with the same message and exit code.
- `canon doctor` with an invalid `CANON_PROVIDER` skips the Codex binary and Codex project-trust checks. The provider line still fails, and the Claude Code check still runs.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The ship and doctor fixes are covered by red-first tests: the invalid-pin and mixed-bundle ship tests and the invalid-setting doctor test each failed on the pre-fix code.
- The full suite had one timing flake, `shutdown waits for resistant descendant after leader exit before cleanup`. It passed on rerun.
- Docs describing the startup provider check now say `--ship` without `--dry-run` skips it: `docs/pipeline-orchestrator.md` (and its template mirror), `docs/architecture.md`, and `docs/decisions.md`.
- Manual check to run before merge: ship a finished task with a made-up provider value, then confirm it archives. Confirm a dry run of the same task still refuses.
