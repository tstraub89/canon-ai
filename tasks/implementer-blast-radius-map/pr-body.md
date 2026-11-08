# PR Body: implementer-blast-radius-map - Implementer pre-handoff self-check and blast-radius map

## Summary

- Adds a pre-handoff self-check to the implement prompts (fresh, park-resume, revision, reroute). After making its changes and before validation, the implementer checks that its new tests would fail if the change were reverted, sweeps for other places that restate a changed contract, and checks the parallel paths of each new guard.
- Fresh and rerouted implement prompts now include a bounded, paths-only "blast-radius" list: files that reference the task's Affected Files, and files that contain the identifiers and flags the spec names. Generated files marked `linguist-generated` are left out. The list is for checking; editing outside Affected Files still needs a Blocker.
- The map builder lives in `src/orchestrator/blast-radius.ts` and fails open: if git is unavailable or a command fails, the block is omitted and the prompt still renders.
- Adds `.gitattributes` marking `dist/**` and the managed template mirrors as generated, and documents the map in the pipeline orchestrator guide (mirror kept in sync).

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Test integrity is a reasoning check on each new or changed test, with an optional cheap run against the base. Red-first ACs keep their executed checkpoint. I did not require running every changed test against the base, because that would add cost to every task.
- The self-check runs after the edits and before validation, so anything the restatement and sibling sweeps change gets validated.
- The self-check appears in fresh, park-resume, revision, and reroute prompts. The map appears in fresh, park-resume, and reroute prompts. Interrupted-resume prompts get neither, because they authorize no code changes.
- Affected Files are left out of the references list, since the implement prompt already preloads them.
- Identifiers come from amendment sections first (newest first), then Design, then Acceptance Criteria, filtered by shape. I did not search every backticked token in the spec, because Problem and Known Risks cite incidental symbols that would use up the token cap.
- If the map fails for any reason, the block is left out rather than failing the phase.
- `CANON_BLAST_RADIUS_ROOT` is a test-only override for the prompt goldens. The code honors it unconditionally, so it is a real environment variable; the source comment is the only thing marking it test-only.
- Known gaps: a single capitalized word such as `Widget` is not searched (it is searched when written as `Widget()`). A new Affected File that does not exist yet gets no references list.
