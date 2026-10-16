# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

- [spec_review] Telemetry admission precedes managed-doc admission: a read-only call to buildHumanReviewStagePaths with an empty doc set and dirty docs/lessons-learned.md still selected that file. A configured flag-only telemetry doc also conflicts with QA's unconditional lessons-buffer append instruction; spec-review F1 requests an explicit overlap policy.
- [spec] Revision 2 (spec-review F1): chose "reject" — telemetry files and `tasks/` paths are invalid anywhere in `docs_freshness` (protected, paths values, flag_only), not just flag_only, because a protected telemetry file would also flip `--ship` classification from preserve to abort. Keeps task artifacts / telemetry / configured docs disjoint. N1 adopted: run-start check validates the main checkout for `--ship`, the worktree (if any) otherwise; AC-3 pins both directions.
- [plan] `tests/run-task-code-review.test.ts` (the code_review pre-flight harness) is not in Affected Files. The plan routes pre-flight and full-send admission through a shared `buildAdmittedAllowlist(taskIds, configRoot)` in validation.ts and tests it in run-task-validation.test.ts. The existing code-review tests stay unedited and should pass: their temp activeCwd has no config, and the defaults cover the docs they use.
- [plan] AC-4's `--ship` consumer test can't go through `main()`: the run-start check reads the same main-checkout config and prints the same message first. The plan exports `classifyAndPreserveSharedDocDirt` from main.ts (in scope) and tests it directly in a subprocess.
- [plan] Docs Impact names a likely `docs/decisions.md` entry, but decisions.md isn't in Affected Files. The plan doesn't edit it; QA can, since it's protected and admitted under canon-ai's own config.
- [plan] Open question: a doc path written `./docs/x.md` isn't in the spec's exhaustive malformed list, but it never equals a porcelain path, so it would silently never admit. The plan keeps the spec's list as written.
- [plan] Glob syntax chosen: `**`, `*`, `?`, `{a,b}` (one level), all dot-matching, everything else literal. An in-repo matcher, not path.matchesGlob.
- [plan] Verified empirically: a docs-refs-check fixture built from a copy of `templates/`, plus `src/lib/canon-owned.ts` and `.claude/settings.json`, returns no findings on the current tree. A backticked `.canon/config.json` appended to the fixture's `.canon/README.md` produces a `missing file` finding, so the AC-12 test can go red.
