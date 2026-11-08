# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[spec_review] Revision handoffs preserve earlier evidence and append only the delta (`src/orchestrator/prompts/templates/implement-revisions.md:25`). The proposed whole-handoff contradiction check needs explicit historical-evidence supersession or iteration scoping; otherwise later tests can contradict a previously valid baseline N/A, and an appended correction leaves the original false claim active.
[spec] Round-1 spec_review finding (historical Self-Check evidence) resolved with a latest-filled-row-wins effective record: Iteration rows restate whole-branch evidence and supersede earlier versions; superseded rows are never judged. Rejected alternative: judging each block against its own iteration's diff (needs per-round commit archaeology). A stale effective row is kept as a Stage 1 contradiction (one appended row fixes it). Both judgment calls recorded as Author in spec.md.
[plan] No spec contradictions found. Observations (not scope changes): `validateHandoff` has zero callers in src/ or tests/ (only a comment at src/orchestrator/main.ts:3435); the live gate is `classifyPreflightBlockers`. docs/architecture.md still names `validateHandoff()` as the pre-review gate; plan adds the Self-Check item there and a one-clause pointer, no rewrite. main.ts:3436 comment restates the pre-flight list but is a source comment outside Affected Files — left alone.
[plan] Parser reuses exported `scanSpecManifest` + `scanTableBlocks` (markdown-table.ts is outside Affected Files, so no new generic export); baseline section ends at the next H1/H2 (not H3) to avoid false missing-row rejections when an author adds a sub-heading.
[plan] Resume prompt renders `selfCheck: false`, so its handoff summary line is the only Self-Check instruction that session sees — plan makes the line name the three rows and the N/A form.
