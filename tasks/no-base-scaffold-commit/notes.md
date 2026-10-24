# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Collision-set clearing is scoped to `tasks/` (spec Implementation Notes `-- tasks/`), though the Decision bullet states the set without a path limit. Interpretation: never delete an operator's untracked non-task file; a non-`tasks/` collision keeps git's own refusal.
- [plan] Contradiction, not resolved: `src/cli/index.ts` and `src/orchestrator/cli.ts` `--ship` help text ("… archive the task dir, and pull the base branch") is outside Affected Files. It names neither the scaffold nor the full-send push, so it was left unchanged.
- [plan] AC-11 abort hint uses a scoped `process.on('exit')` hook armed after the base checkout (die() calls process.exit). The hint says `git checkout task/<id>`, not `git checkout task/<id> -- tasks/<id>`, which would stage task files onto base.
- [plan] Verified `git clean -f -- tasks/<id>` on git 2.55: it removes untracked files and subdirs under the pathspec and keeps gitignored runtime files. The no-PR banner's remove-then-merge step uses it.
