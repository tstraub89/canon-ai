# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Dedicated sync-plan additions can break `tests/sync-canon-templates.test.ts` exact drift assertions unless the fixture seeds the new path or the expectations include it.

[spec_review] Revised AC-13 makes root `.gitignore` behave like a sync source, which conflicts with AC-7's constant-source `templates/.gitignore` model; choose one before implementation.

[implement] In linked worktree test runs, `REPO_ROOT` resolves to the supervising checkout by design; root-file self-hosting guards should read the active checkout root when validating files changed by the task branch.
