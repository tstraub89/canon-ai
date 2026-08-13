# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] Root `.canon/README.md` changes are mirrored into `templates/.canon/README.md` by the wholesale sync path. The spec needs to declare the mirror explicitly or `npm run sync-templates:check` will fail against the final diff.
[spec_review] `canon task new` resolves the override root through `CANON_TASKS_DIR_OVERRIDE` via `tasksRoot()` / `taskTemplateOverrideRoot()`, so a literal `tasks/_templates/` path in the nudge spec misses a supported override layout.
[spec] Addressed the above: spec now defines "override root" = `taskTemplateOverrideRoot()` (honors `CANON_TASKS_DIR_OVERRIDE`), ACs generalized off the literal, added AC-12 pinning env-var resolution, added `src/task/index.ts` to Affected Files (export `taskTemplateOverrideRoot()` — export-only, no behavior change), added Known Risk for the resolution drift + the absolute-env `path.resolve` hazard. Verified no import cycle: `upgrade → task/index → scripts/run-task/*`, none of which import `commands/upgrade`.

[implement-revision] AC-13 force-path needed the reported changed set to switch to `pending` only for apply-mode force writes; `--check` still uses `clean` so dry-run reporting stays unchanged. The new nudge header wording also had to avoid implying the overrides themselves were updated.

[implement-reroute] AC-14 exposed a dirty-refusal edge case where `staleOverrides` could reflect a clean would-change template even though the run returned `upgraded: []`; the amended contract now requires the refusal-path return to force `staleOverrides: []`.

