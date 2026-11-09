# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Spec nit (spec-review): Judgment Calls row 1 mentions admin bypass while Known Risks/Human Test Plan require the human to swap ruleset checks before merge (`--ship` uses plain `gh pr merge`). Interpretation: follow Known Risks; docs/handoff must not describe an admin bypass for this PR; QA done.md lists the ruleset swap as a pending human step before `--ship`. Spec not edited.
- [plan] Task dir already held handoff.md/done.md/review.md/pr-body.md from an earlier attempt while plan.md was the stub; left untouched, treated as stale.
- [plan] AC-5 drift test reads package.json via process.cwd(), not REPO_ROOT (worktree stale-copy pitfall in docs/patterns.md).

[implement] The synchronous `registerHooks` loader in `tests/md-loader-register.mjs` and `tests/md-loader-hooks.mjs` passed the full test suite under Node 24.21.0 and 26.13.0; Node 26 emitted no `DEP0205` warnings.
[implement] The full suite skipped `REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree` because `.git/` writes are restricted in this sandbox/worktree; it reported zero failures on both runtimes.
