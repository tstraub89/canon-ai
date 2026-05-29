# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `CliArgs` is defined in `scripts/run-task/types.ts`; `scripts/run-task/cli.ts` only imports it. Specs that add CLI fields need `types.ts` in Affected Files or type-checking will block implementation.

[spec_review] `findMergedPRNumber(branch, baseBranch)` proves some exact-head/base PR is merged, not necessarily the just-attempted `prNum`; merge-failure tolerance must bind confirmation to the attempted PR.

[implement] Adding a `CliArgs` field also requires updating parser shape tests in `tests/run-task-cli.test.ts`; otherwise the full suite fails even though that file is outside this task's Affected Files table.

