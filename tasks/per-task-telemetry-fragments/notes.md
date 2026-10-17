# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `promptQa()` exposes task identity only through formatted strings, not a task-id field or per-task Mustache list. AC-3's substituted lesson paths require changing `src/orchestrator/prompts/index.ts` as well as the QA template; the builder is absent from Affected Files (F1).
[spec] Round 2: accepted spec_review F1 (verified: `promptQa()` in src/orchestrator/prompts/index.ts passes only formatted `taskLines`/`taskScope`). Added the builder to Affected Files; AC-3 now pins single-task and bundle substitution and forbids literal `<id>` / empty-id paths.
[plan] Fold ignores CANON_METRICS_FILE_OVERRIDE / CANON_QUALITY_LOG_FILE_OVERRIDE and always targets REPO_ROOT/docs/*: the overrides redirect run-time writers only, the archive commit stages REPO_ROOT/docs paths, and ship tests' runCanon always sets the metrics override (honoring it would break AC-4(a)/(e)).
[plan] A malformed fragment or an unparseable shared log aborts --ship (fail closed, docs and fragments unchanged) rather than being skipped; spec says compute failures abort.
[plan] AC-2 wording vs. existing semantics: today's upsert lets a QA-supplied non-empty Spec verdict win; earliest-wins applies only when QA omits it (which the QA prompt instructs on re-runs). Writer kept unchanged; AC-2 test's second pass omits Spec verdict. The --ship fold reconciles shared+fragment rows with reconcileHistory, so the earliest verdict wins there (AC-4(b)).
[plan] writeQualityLogForTask keeps its signature (caller src/task/index.ts is outside Affected Files); fragment path derives from path.dirname(donePath). Override parents are not auto-created (preserves the existing unwritable-log-task warning test).
[plan] AC-10's grep criterion also requires editing the "writes or updates this task's row in place" line in docs/task-quality-log.md and its template (same files as the header blockquote).
[plan] --pr drift warning fires on --pr only (createPR), not --push, per spec wording.
[plan] Lessons fold "standard skeleton" is a minimal constant in code; the init scaffold under templates/ is not a runtime path for adopters.
[plan] docs/patterns.md may want a pitfall update about telemetry dirt now being fragment-based — outside Affected Files; QA to check per spec Docs Impact.
