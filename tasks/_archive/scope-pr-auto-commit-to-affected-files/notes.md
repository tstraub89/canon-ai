# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `docs/pipeline-orchestrator.md` has a concrete human_review `--push`/`--pr` auto-commit sentence that goes stale when the managed-doc allow-list is narrowed; specs changing this path should list/update it.

[spec_review] `commitHumanReviewFiles()` has a second staged-files allow-list die after the dirty-tree gate; warn-and-skip semantics need an explicit staged-file policy.

[spec_review] `parsePorcelainEntries()` preserves the literal porcelain index column (`' '` for unstaged tracked, `'?'` for untracked); specs partitioning staged vs unstaged must not use `indexStatus === ''`.

[spec_review] Warn-and-skip out-of-scope dirty behavior must define the `stagePaths.size === 0` path in `commitHumanReviewFiles()`; current code dies after skipping every dirty entry.

[spec_review] `commitHumanReviewFiles()` owns push/PR side effects; an early return from an empty-stage-set branch will not be followed by caller-level push/PR.
