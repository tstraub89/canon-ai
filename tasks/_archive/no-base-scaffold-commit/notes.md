# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Collision-set clearing is scoped to `tasks/` (spec Implementation Notes `-- tasks/`), though the Decision bullet states the set without a path limit. Interpretation: never delete an operator's untracked non-task file; a non-`tasks/` collision keeps git's own refusal.
- [plan] Contradiction, not resolved: `src/cli/index.ts` and `src/orchestrator/cli.ts` `--ship` help text ("… archive the task dir, and pull the base branch") is outside Affected Files. It names neither the scaffold nor the full-send push, so it was left unchanged.
- [plan] AC-11 abort hint uses a scoped `process.on('exit')` hook armed after the base checkout (die() calls process.exit). The hint says `git checkout task/<id>`, not `git checkout task/<id> -- tasks/<id>`, which would stage task files onto base.
- [plan] Verified `git clean -f -- tasks/<id>` on git 2.55: it removes untracked files and subdirs under the pathspec and keeps gitignored runtime files. The no-PR banner's remove-then-merge step uses it.

[implement] Red-first real squash fixtures confirmed the untracked overwrite refusal for AC-7(a–d) and the post-merge-sync fast-forward path; its reset path hit the existing untracked-clobber guard. The non-worktree success path already worked; the abort recovery message was missing.

[implement] The collision helper is limited to tasks/ per the spec's Implementation Notes and plan. The broader Decision wording could include non-task untracked source files; those remain protected by git's refusal rather than being deleted.

[implement] A recorded branch with no worktree cannot enter ensureBranch through the runtime readStatus resolver, which aborts before attachment. Bootstrap now explicitly reads the REPO_ROOT backup only for a missing/incomplete recorded worktree, then returns to ordinary worktree routing. Reattachment also skips writing a status whose branch is already correct, preserving committed bytes.

[implement] Exit cleanup removes pid/heartbeat files even after a failed ship, so ignored-file preservation is asserted using .canon-run.log; the bootstrap fixture separately asserts .canon-pid and .heartbeat.json are not copied. Files absent after cleanup cannot establish whether collision clearing touched them.

[implement] The scope cap excludes src/cli/index.ts and src/orchestrator/cli.ts, whose --ship help still lists teardown/archive before pull. The plan called this out; left unchanged and carried to the handoff as a scope blocker against the broad restatement AC.

- [code_review] Round 1 foreman: changes_requested (4 code-bugs). Open question for human: amend spec Affected Files to add src/cli/index.ts and src/orchestrator/cli.ts so the stale --ship / post-merge-sync help text (AC-13) can be fixed; implement was told not to touch them until then.

[implement-revision] Round 1 tracked-base task regression reproduced before production edits in five real-git cases: modified/staged status, staged spec deletion, clean base status hiding an untracked plan, and a bundle secondary. A guard now probes all members before creating a fresh branch, refuses lost files without a force exemption, and fails closed on probe errors. Existing task branches remain canonical for reattachment.

[implement-revision] The AC-7(e) fixture now leaves main one commit behind a real squash from another clone while main HEAD already tracks the task. Git argv logging proves collision probes ran and nothing was removed. Temporarily removing the fast-forward clearing call made the test fail on its missing-probe assertion; restoring it passed.

[implement-revision] Both divergence hints now put scoped removal of already-merged task backups before rebase. Real-git fixtures execute the clean/rebase steps and retain operator source commits. The two excluded CLI help renderers still require the spec amendment identified in review; no source-scope expansion was made.
- [code_review] Round 2 foreman: changes_requested (guard false positive on staged-new / non-base HEAD; recovery.md bare-rebase line). Spec Gap 1 still needs a human amendment: add src/cli/index.ts, src/orchestrator/cli.ts, src/orchestrator/validation.ts to Affected Files.

[implement-revision] Round 2's over-refusal reproduced before production edits: a staged new spec absent from base, task files tracked/modified only on another checkout branch, and a dirty file already matching declared base were all refused. The guard now classifies only base-inherited differences and files hidden by an inherited marker; ordinary staged/new task files remain copyable.

[implement-revision] The two refusal classes now have independent path lists and recovery text. Hidden plans/artifacts are explicitly kept, not reverted/deleted. Tests pin hidden-only and inherited-only messages with opposite presence/absence assertions, plus existing force and probe-error behavior.

[implement-revision] The recovery-doc sibling of the code's cleanup-before-rebase hints was still stale. Its own divergent-base section now includes scoped cleanup, and the regression reads that exact section so the earlier manual-merge section cannot satisfy it accidentally. The newly identified outdated comment in src/orchestrator/validation.ts is outside Affected Files and stays in the scope blocker with the two CLI help sources.
- [code_review] Round 3 foreman: spec_gap. (1) Spec Gap 1 carried 3 rounds — add src/cli/index.ts, src/orchestrator/cli.ts, src/orchestrator/validation.ts to Affected Files. (2) New: base-tracked tasks/<id>/ (e.g. spec merged via PR first) is refused at implement with an unpushable-on-protected-base remedy; human picks (a) keep refusal + document, or (b) fresh-branch bootstrap overwrites base-inherited task files from REPO_ROOT.

[human_review] 2026-10-24: ABANDONED after code_review round 3 spec_gap (parked-spec case). Cost of removing the base scaffold commit (ship-time clear/restore paths) outweighed one manual push. Replaced by a smaller task: --pr pushes the scaffold base commits like full-send does. PR-only-main repos: use an integration branch as base_branch. This spec + review.md are the design record if a trunk-only adopter needs it.
- [retired 2026-10-31] Abandoned at code_review, never shipped. The vetted scaffold push now runs on every `--pr`/`--push`, and parked specs already commit `tasks/<id>/` to base, so "no canon commits to base" stopped paying for its complexity. Protected-base follow-up lives in docs/BACKLOG.md; implementation stays on branch `task/no-base-scaffold-commit`.
