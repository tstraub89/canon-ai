# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `getAffectedFiles()` uses three-dot diff semantics (`base...HEAD`), so it does not report files changed only on an advanced base branch; specs that want true base-drift detection must not rely on that helper unchanged.

[spec_review] Changes to `src/**` or `scripts/run-task/**` require updated tracked `dist/` outputs for CI; specs must list the concrete `dist/` files when build output is in scope.

[implement] `commitHumanReviewFiles()` reads the module-level `cliArgs`; direct helper tests cannot set `--force` unless they route through `main()` first.

