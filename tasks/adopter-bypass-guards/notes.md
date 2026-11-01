# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- spec (rev 1): spec_review flagged custom `CANON_WORKTREES_ROOT` worktrees as a bypass. Chose structural anchoring (the file's own git working-tree root + a `.canon/` marker) over reading `CANON_WORKTREES_ROOT` in the hook: it covers default, custom and pre-layout worktrees without depending on the hook process's env. Reviewer asked for env semantics; this is a deliberate substitute — reviewer may disagree.
- spec (rev 2): spec_review blocked on porting the private `canon_cmd.py` parser (not in repo). Chose the reviewer's second option: a self-contained, binding "Command parsing contract" section restating that parser's behavior (separators, `2>&1`, quotes/escapes, comments, heredocs, wrapper-skipping invocation detection, redirect targets, accepted gaps), plus new AC-2/AC-3 cases pinning each. The source was read locally; nothing private is copied into the repo.
- spec (operator, post auto-block round 3): PowerShell finding resolved by scope narrowing per the human's decision — shell rules are Bash-tool-only; PowerShell sessions get only the Edit/Write status.json rule; README and decision entry state it (Non-Goals, Decision 5, AC-12). Supporting PowerShell syntax was rejected as disproportionate.
- spec (rev 3): applied the PowerShell scope narrowing to ACs — AC-8 now verifies the README scope statement and pins the matcher to Bash|Edit|Write|MultiEdit (no PowerShell); added a Known Risk for the accepted Windows gap.
- spec (operator, post auto-block round 4): applied the reviewer's fix — the status.json root lookup runs from the target's nearest existing ancestor, not the payload cwd; other git lookups keep cwd. Resumed with MAX_REVIEW_LOOPS=5.
- spec (rev 4): verified the operator-applied round-4 fix (Decision 1 ancestor-cwd lookup) is consistent with Decision 2, AC-2 absolute/relative external-worktree cases, and the Path anchoring risk; only the status line changed.
- [plan] AC-10 grep pattern `migrate .status.json. manually` cannot match the current text (`migrate status.json manually`, no backticks) or the doc's "migrating" wording — vacuous. Plan still rewords both per Decision 6 and adds a supplementary `status\.json.? manually` zero-match grep. Spec not changed.
- [plan] AC-4 implicit-branch case uses a real temp git repo on `task/foo` instead of a git PATH shim (stricter); `gh` is shimmed. Adds test seams `CANON_GUARD_GH_TIMEOUT_MS` and `CANON_GUARD_TEST_THROW` in the hook.
- [plan] main.ts:1996 "open + merge a PR (gh pr create …)": plan drops "+ merge" (hand-merging a task PR is what Rule 4 denies; --ship merges the open PR) and appends "then re-run --ship" per Decision 6.
- [plan] assertNoOpenPRForTask (main.ts:2162) has no task id in scope; plan prefers id-free "re-run --ship" wording over widening its signature.
