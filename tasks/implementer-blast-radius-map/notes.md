# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Spec's non-binding `git check-attr --stdin` note is infeasible in scope: `gitSafeAt*` uses `stdio: ['ignore', …]` and `src/orchestrator/git.ts` is not in Affected Files. Plan passes paths as args in chunks of 200 instead.
- [plan] `getActiveCwd` can `die()` (process.exit) on a missing expected worktree, so the map can't fail-open around it; `buildKnownPitfalls` already calls it unguarded in the same render, so no new exit path. Accepted.
- [plan] Interpretation: PascalCase = ≥2 humps (single capitalized words like `Widget` not searched); revision prompt's "per-round steps" = the hasReviewFindings/hasPreflightFindings sections, self-check placed before them.
- [plan] Spec-review nit (park-resume map coverage) addressed by an explicit assertion in plan Step 7.
