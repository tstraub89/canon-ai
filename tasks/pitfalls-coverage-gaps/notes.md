# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Spec says strip "the tables directly under the H2"; `knownPitfallsIndexTables` with no H3 returns every table in the section. Plan strips exactly that function's output so area-index rows never duplicate into the prose. Not a contradiction, chosen interpretation.
- [plan] `docs-freshness.ts` is outside Affected Files, so the directory-glob test is built on exported `matchesDocsGlob` applied per single segment.
- [plan] Pre-existing `handoff.md`, `review.md`, `done.md`, `pr-body.md`, `metrics.md` were already present in the task dir when planning began (status was plan/in_progress); ignored.
