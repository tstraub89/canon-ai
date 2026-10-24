# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[spec_review] AC-12's broad `Full-send tail aborted` grep also matches the unrelated multi-branch guard in `src/orchestrator/main.ts:3126`; removing the old base-push helper alone cannot satisfy it. AC-10 also freezes a success-message assertion that the new output contract requires changing. See spec-review.md.

[spec_review] The working tree initially contained only the untracked task directory. A later status check also showed a modification to `docs/BACKLOG.md`; this review did not edit or revert that file.

[spec] Round 2 (edge-fine-tune, not scope-expansion): spec_review finding 1 narrowed the already-covered missing-remote case. Chose "create the base at the pinned local tip" over "block" for the empty-range case: it publishes no new commit and the PR needs the target; the override never bypasses a missing base or a rejected creation push (AC-4b). Findings 2/3: AC-10 now allows the first full-send test's success-line literal to change; AC-12 grep narrowed to the push-path dies so the multi-branch guard (main.ts:3126) stays.

[plan] Interpretations (no spec contradictions found): (1) re-list only after a successful push, as `<pushedSha>..<base>` (not the tracking ref); no push → first list feeds the gate. (2) local `<base>` missing on both sides now dies via the list-failure message instead of warn-skip. (3) after creating a missing base, concurrent commits go through the ordinary gate, where the flag applies. (4) list-failure die keeps "git error checking base divergence" and adds "could not list unpushed <base> commits", so AC-10's probe-error literal is unchanged; prefix becomes mode-derived (`--push aborted:` for --push). (5) `src/cli/index.ts` has no `--allow-divergent-base` help line today; plan adds one.
[plan] Verified live: `ls-remote` tail-matches patterns (`ls-remote origin x` printed refs/heads/feat/x) — the probe must match the exact `refs/heads/<base>` line; exit 2 = missing, 128 = unreachable. A SHA push updates refs/remotes/origin/<base>.
