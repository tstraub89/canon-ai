# Implementation Handoff: no-base-scaffold-commit

> Author: Codex | Spec: `tasks/no-base-scaffold-commit/spec.md` | Plan: `tasks/no-base-scaffold-commit/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/git.ts` | Remove base artifact commits and safe-push classification; copy trackable task backups without clobbering; share fail-closed incoming collision clearing. |
| `src/orchestrator/phases/implement.ts` | Start implement by ensuring the branch; remove pre-implement commits and push hints. |
| `src/orchestrator/worktree.ts` | Remove the unused artifact filename registry; keep local-base branch creation unchanged. |
| `src/orchestrator/main.ts` | Remove full-send base pushes; clear task collisions after merge and before both pulls; print manual merge steps and non-worktree abort recovery. |
| `src/orchestrator/state.ts` | Update the REPO_ROOT-only caller comment. |
| `src/task/index.ts` | Use shared collision clearing before fast-forward and the reset clobber guard; update sync guidance. |
| `src/cli/commands/watch.ts` | Describe the scaffold-copy pre-agent window. |
| `src/orchestrator/prompts/templates/qa.md` | State that task artifacts first commit to the task branch at QA end. |
| `tests/run-task-safety.test.ts` | Replace obsolete commit/push tests with bootstrap, resumption, ordering, QA commit, divergence and manual-merge coverage. |
| `tests/run-task-ship.test.ts` | Add actual origin squash merges and collision, failed-merge, tracked-file and non-worktree recovery cases. |
| `tests/task-cli.test.ts` | Exercise stale task copies through both sync paths, retaining an unmerged backup. |
| `tests/run-task-validation.test.ts` | Use an operator subject in the unchanged divergence fixtures. |
| `tests/run-task-prompts.golden.json` | Regenerate only promptQa and promptQa_withTemplate. |
| `tests/watch.test.ts` | Update the pre-agent setup comment. |
| `README.md` | Describe full-send without a base push. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document untracked bootstrap, QA commit ownership, post-merge clearing and ship order; sync managed mirror. |
| `docs/patterns.md` | Update bundle bootstrap and explain cold-lens visibility after the QA commit. |
| `docs/decisions.md` | Amend worktree-canonical state with the untracked backup/copy decision; root-only edit. |
| `docs/BACKLOG.md` | Remove the obsolete commit-time telemetry gate and update retirement candidates. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Explain current bootstrap and pull guidance; sync managed mirror. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Add stale-copy recovery and qualify old-engine artifact conflicts; sync managed mirror. |
| `dist/orchestrator/run-task.js`, `dist/cli/index.js` | Rebuild both published bundles. |
| `tasks/no-base-scaffold-commit/notes.md` | Record observed resolver, cleanup, red-first and scope behavior. |
| `tasks/no-base-scaffold-commit/handoff.md` | Record implementation evidence, validation, deviations and remaining scope blocker. |
| `tasks/no-base-scaffold-commit/status.json` | Pipeline-owned phase state; already dirty on entry, closed with the required phase command. |

## Canon Governance

The authoritative provenance is `tasks/no-base-scaffold-commit/status.json` → canon.

| Field | Source |
|---|---|
| Upstream repo | status.json.canon.upstream_repo |
| Upstream commit | status.json.canon.upstream_commit |
| Orchestrator commit | status.json.canon.orchestrator_commit |
| Codex CLI | status.json.canon.codex_cli |
| Claude Code | status.json.canon.claude_code |

## Intent & Rationale

Keep pre-merge bookkeeping off base. Copy only git-trackable task files into a worktree whose status marker is absent, preserving existing destinations and writing the marker last. Keep the REPO_ROOT backup until the incoming merged tree needs those paths. First commit the artifacts through the existing QA-end path.

Both ship pulls and post-merge-sync use one collision helper, restricted to task paths. It completes all NUL-delimited git probes before deleting anything, excludes HEAD-tracked and ignored files, and reports each removal, including partial cleanup before an error. No changes to divergence/drift gate behavior, archive commit ownership, dependencies or schema.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Added a bootstrap-only status reader inside `src/orchestrator/git.ts` and reused branch-recording on reattachment. | Runtime resolution aborts on a missing recorded worktree, or reads a missing marker in an incomplete registered worktree. Read the backup only for initialization, then use normal routing; record every copied bundle member before returning. | Completes AC-4 and recorded-branch attachment. |
| Skip status writes when branch already matches. | Rewriting parsed JSON would change committed status bytes even though the copy correctly skipped that member. | Preserves AC-4(a) exactly. |
| Arm the non-worktree exit hook before checkout, and emit only while task status is absent. | Covers checkout throws and every later die/throw without widening the warning to normal successful archival. | AC-11 preserved. |
| Ignored-file ship sentinel is .canon-run.log instead of .heartbeat.json. | Normal exit cleanup independently removes heartbeat/pid files on failures, so their disappearance cannot test collision clearing. Bootstrap separately tests both ignored files. | AC-7 runtime-file preservation tested without a cleanup false positive. |
| Non-worktree success was green before production changes. | The plan predicted a refusal there, but the corrected actual-squash fixture already completed. Kept the success regression and added only the required abort guidance. | AC-11 is not a red-first AC in the spec; no wrong-premise success fix invented. |
| Left two out-of-scope CLI help strings unchanged. | The Affected Files cap excludes their source files. | AC-13 remains Partial; see Blockers. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Real-git single-task and two-task implement runs without a tasks override preserve base SHA and the complete all-refs commit set; REPO_ROOT task files stay untracked and telemetry remains dirty. |
| AC-2 | Met | Trackable bytes reach the leader worktree untracked; ignored pid/heartbeat files are absent; committed diff is empty. Instrumented real bootstrap proves status-copy ordering and secondary-before-leader branch writes. Status bytes match at copy time, before required branch/phase updates. |
| AC-3 | Met | Worktree argv remains local release/v1 with no fetch; the existing non-worktree release-base test passes. |
| AC-4 | Met | Real-git committed, torn-down, interrupted, recorded-branch and recorded-interrupted fixtures pass. Existing committed status bytes are preserved. |
| AC-5 | Met | Two non-worktree implement invocations leave task history empty and artifacts untracked on the task branch. |
| AC-6 | Met | Actual QA-end commit path first tracks spec, plan and status in the copied worktree; only the QA commit appears above base. |
| AC-7 | Met | Real squash fixtures cover single/bundle merge, already-merged fast-forward and another merged-but-unshipped task. Merged content is archived, ignored log survives, removed paths print, and unmerged copies survive. Tracked files and failed merges cause no clearing. |
| AC-8 | Met | Both post-merge-sync fast-forward and reset fixtures restore merged content and retain the unmerged backup. |
| AC-9 | Met | Unpushed-state main invocation and formatter assertions check scoped clean, merge/push and ship steps. Real git refuses the merge before the printed clean and accepts it afterward; ignored runtime file remains. |
| AC-10 | Met | Existing divergence and bypass tests pass with operator subjects. Full-send clean control opens a PR without pushing base; an operator commit blocks at the same divergence gate with no base push. |
| AC-11 | Met | Actual squash ship succeeds for a non-worktree task. A forced merge abort prints the task-branch checkout command, and running it restores status. |
| AC-12 | Met | Exact required git grep returned exit 1 with empty stdout/stderr after rebuilding dist, meaning zero hits. |
| AC-13 | Partial | All in-scope restatements, mirrors and the full lexical sweep are aligned; two CLI help renderers outside Affected Files still list the old ship order. See [scope] Blocker. |
| AC-14 | Met | QA ownership text and the two QA golden entries updated; full npm test passes. |

## Edge Cases Considered

- Existing task status skips the whole copy; existing individual destination files win on interrupted copies.
- Missing source status is an error. Deleted source index entries do not become phantom files in the worktree.
- All bundle copies finish before branch writes; secondaries are written before the leader.
- Tasks-dir overrides skip copying; all new copy-regression fixtures omit that override.
- Incoming-tree ownership clears other merged tasks, never merely another task ID. Ignored liveness/log files and unmerged task copies remain.
- A bad collision probe removes nothing. Partial filesystem deletion reports completed paths before aborting.
- Merge failures return before collision clearing. The non-worktree recovery command switches branches rather than staging task files onto base.
- Archive commits and pushes remain the existing post-merge behavior.

## Blockers

- [scope] AC-13 broadly requires every ship-order restatement to change, but `src/cli/index.ts`:103 and `src/orchestrator/cli.ts`:147 still say “down the worktree, archive the task dir, and pull the base branch.” Neither source file is in the spec's Affected Files. The plan already identified this contradiction. They remain untouched; completing this wording needs an authorized scope amendment. All in-scope implementation and checks are complete.
- [ambiguity] The Decision describes a collision set without a path restriction; Implementation Notes and the plan restrict it to tasks/. Chosen interpretation: delete only task-path collisions, allowing git to refuse non-task collisions. This preserves operator source files and is pinned by the shared helper's pathspecs.
- [ambiguity] AC-2 asks for identical source bytes while also requiring worktree branch metadata. Chosen interpretation: copy bytes identically first, then perform required branch/phase writes. The instrumented copy test checks identical status bytes before recording branches; other source artifact bytes are compared after implement.

## Red-First Evidence

All rows below ran before any non-test code changed, against the task base shown. The four required AC-7 cases each reached the real pull refusal; fake gh performed actual squash commits and pushes in local fixture repositories. Corrected fixture issues before the final red run: use a surviving ignored log sentinel and maintain fake PR state across a successful merge.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-7(a) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='stale|non-worktree real squash' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `91742919a0f48fbde61034308b7a5af1e42e933e` | Single worktree ship: git pull origin main refused: “untracked working tree files would be overwritten by merge”. | Pass in targeted green run and full suite. |
| AC-7(b) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='stale|non-worktree real squash' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `91742919a0f48fbde61034308b7a5af1e42e933e` | Two-task ship: same refusal, listing both tasks’ files. | Pass in targeted green run and full suite. |
| AC-7(c) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='stale|non-worktree real squash' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `91742919a0f48fbde61034308b7a5af1e42e933e` | Already-merged ship: git pull --ff-only refused with the same untracked overwrite error. | Pass in targeted green run and full suite. |
| AC-7(d) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='stale|non-worktree real squash' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `91742919a0f48fbde61034308b7a5af1e42e933e` | Shipping B after A merged: git pull refused on stale copies; unmerged third task was present. | Pass in targeted green run and full suite. |
| AC-8 fast-forward | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='stale|non-worktree real squash' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `91742919a0f48fbde61034308b7a5af1e42e933e` | post-merge-sync reached git pull --ff-only, which printed the untracked overwrite refusal and threw git pull failed. | Pass in targeted green run and full suite. |
| AC-8 reset | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='stale|non-worktree real squash' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `91742919a0f48fbde61034308b7a5af1e42e933e` | post-merge-sync refused: “local files (untracked or gitignored) match paths tracked in origin/main”; tasks/merged-task/spec.md was listed. | Pass in targeted green run and full suite. |
| AC-11 (additional plan evidence) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='stale|non-worktree real squash' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `91742919a0f48fbde61034308b7a5af1e42e933e` | Success case already passed after correcting fake PR-state handling; forced abort failed its assertion because no branch-restoration hint existed. No spec-mandated red-first success claim. | Success and abort recovery both pass; printed checkout command executed. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final ESLint run clean after all test assertions. |
| `npm run type-check` | Pass | Final TypeScript check clean. |
| `npm test` | Pass | Final full suite: 1,606 tests; 1,605 passed, 0 failed, 1 skipped. An earlier full suite also passed. |
| `npm run build` | Pass | Both dist bundles rebuilt after final source edits. |
| `npm run sync-templates:check` | Pass | All managed root/mirror pairs aligned. |
| `npm run docs-refs-check` | Pass | All refs OK before handoff; rechecked after artifact creation. |
| Targeted actual-squash ship/sync regressions | Pass | All 12 cases selected by the red-first command passed after fixes. Tracked-task case subsequently passed as well. |
| Targeted bootstrap/recovery/ordering tests | Pass | New single/bundle copy, teardown, committed-state preservation, recorded/incomplete attachment, branch-write ordering and QA commit checks pass in full suite. |
| Targeted complete-state/banner checks | Pass | 15 selected tests passed after adding assertions to the actual unpushed-state main invocation. |
| AC-12 deleted-symbol sweep | Pass | Required exact git grep over src/tests/dist/templates/docs/.claude/.canon/README returned no hits (exit 1). |
| AC-13 lexical sweep | Pass | Every remaining hit is listed with disposition below. Separate scope blocker covers the help-order restatements outside that lexical pattern. |
| `git diff --check` | Pass | No whitespace errors. |
| Affected Files cap | Pass | Every changed non-task-artifact file is declared in the spec table; no scope expansion. |
| Golden delta inspection | Pass | Only promptQa and promptQa_withTemplate changed. |

## AC-13 Sweep Disposition

Reviewed `git grep -niE 'scaffold|pre-implement|pushes unpushed base' -- docs templates .claude src README.md`. Each row identifies one matching source line; generated mirrors were verified by template sync. “Unrelated” means the hit describes init/template scaffolding or another mechanism, not base bookkeeping.

| File | Line | Disposition |
|---|---|---|
| `.claude/skills/canon-init/SKILL.md` | 3 | Unrelated init/upgrade or destination-safety scaffolding. |
| `.claude/skills/canon-init/SKILL.md` | 11 | Unrelated init/upgrade or destination-safety scaffolding. |
| `.claude/skills/canon-init/SKILL.md` | 176 | Unrelated init/upgrade or destination-safety scaffolding. |
| `.claude/skills/canon-init/write-guide.md` | 3 | Unrelated init/upgrade or destination-safety scaffolding. |
| `.claude/skills/canon-pipeline/SKILL.md` | 183 | Current backup/pull guidance or unrelated canon-init pointer. |
| `.claude/skills/canon-pipeline/SKILL.md` | 192 | Current backup/pull guidance or unrelated canon-init pointer. |
| `.claude/skills/canon-pipeline/recovery.md` | 91 | Accurate: stale-copy recovery or explicitly old-engine history. |
| `.claude/skills/canon-pipeline/recovery.md` | 110 | Accurate: stale-copy recovery or explicitly old-engine history. |
| `.claude/skills/canon-status/SKILL.md` | 23 | Accurate: REPO_ROOT is still the stale pre-implement backup. |
| `README.md` | 23 | Unrelated init/package scaffold description or future proposal. |
| `README.md` | 136 | Unrelated init/package scaffold description or future proposal. |
| `README.md` | 270 | Unrelated init/package scaffold description or future proposal. |
| `README.md` | 350 | Unrelated init/package scaffold description or future proposal. |
| `README.md` | 375 | Unrelated init/package scaffold description or future proposal. |
| `README.md` | 420 | Unrelated init/package scaffold description or future proposal. |
| `docs/BACKLOG.md` | 25 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 127 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 154 | Updated: removed telemetry absorption is retired. |
| `docs/BACKLOG.md` | 182 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 183 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 189 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 240 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 288 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 326 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 328 | Unrelated future proposal or explicitly historical init framing. |
| `docs/BACKLOG.md` | 434 | Unrelated future proposal or explicitly historical init framing. |
| `docs/architecture.md` | 128 | Accurate: pre-implement REPO_ROOT vs active-worktree state. |
| `docs/architecture.md` | 159 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/codebase-map.md` | 78 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/decisions.md` | 65 | Current worktree-canonical state/copy decision. |
| `docs/decisions.md` | 67 | Current worktree-canonical state/copy decision. |
| `docs/decisions.md` | 390 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/decisions.md` | 392 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/harness-audit-2026-06.md` | 19 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/harness-audit-2026-06.md` | 31 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/harness-audit-2026-06.md` | 33 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/patterns.md` | 70 | Accurate schema, pre-implement ownership or template-mirror guidance. |
| `docs/patterns.md` | 148 | Accurate schema, pre-implement ownership or template-mirror guidance. |
| `docs/patterns.md` | 212 | Accurate schema, pre-implement ownership or template-mirror guidance. |
| `docs/pipeline-orchestrator.md` | 117 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `docs/pipeline-orchestrator.md` | 124 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `docs/pipeline-orchestrator.md` | 191 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `docs/pipeline-orchestrator.md` | 292 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `docs/pipeline-orchestrator.md` | 302 | Updated: untracked copy and backup lifetime. |
| `docs/pipeline-orchestrator.md` | 306 | Updated: untracked copy and backup lifetime. |
| `docs/pipeline-orchestrator.md` | 487 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `docs/product-context.md` | 57 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/product-context.md` | 58 | Unrelated init/template, reasoning, or comment scaffolding. |
| `docs/task-quality-log.md` | 61 | Historical task outcome; retained unchanged. |
| `docs/task-quality-log.md` | 91 | Historical task outcome; retained unchanged. |
| `docs/task-quality-log.md` | 123 | Historical task outcome; retained unchanged. |
| `docs/task-quality-log.md` | 125 | Historical task outcome; retained unchanged. |
| `docs/task-quality-log.md` | 137 | Historical task outcome; retained unchanged. |
| `src/cli/commands/doctor.ts` | 304 | Unrelated missing initial docs scaffold diagnosis. |
| `src/cli/commands/init.ts` | 15 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 47 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 50 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 53 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 64 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 67 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 75 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 99 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 100 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 101 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/init.ts` | 159 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/upgrade.ts` | 8 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/upgrade.ts` | 93 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/upgrade.ts` | 342 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/upgrade.ts` | 399 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/upgrade.ts` | 412 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/upgrade.ts` | 447 | Unrelated init/upgrade or destination-safety scaffolding. |
| `src/cli/commands/watch.ts` | 19 | Updated: synchronous setup copies task files. |
| `src/cli/commands/watch.ts` | 532 | Updated: synchronous setup copies task files. |
| `src/cli/index.ts` | 55 | Unrelated task-new template scaffolding (ship-order gap recorded above). |
| `src/orchestrator/git.ts` | 274 | Accurate: current untracked-copy helper or call site. |
| `src/orchestrator/git.ts` | 280 | Accurate: current untracked-copy helper or call site. |
| `src/orchestrator/git.ts` | 281 | Accurate: current untracked-copy helper or call site. |
| `src/orchestrator/git.ts` | 292 | Accurate: current untracked-copy helper or call site. |
| `src/orchestrator/git.ts` | 399 | Accurate: current untracked-copy helper or call site. |
| `src/orchestrator/git.ts` | 427 | Accurate: current untracked-copy helper or call site. |
| `src/orchestrator/main.ts` | 30 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2867 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2869 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2891 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2892 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2895 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2896 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2897 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2898 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2900 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2904 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/main.ts` | 2906 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/markdown-table.ts` | 245 | Unrelated init/template, reasoning, or comment scaffolding. |
| `src/orchestrator/phases/code-review.ts` | 261 | Unrelated init/template, reasoning, or comment scaffolding. |
| `src/orchestrator/prompts/index.ts` | 531 | Unrelated init/template, reasoning, or comment scaffolding. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | 16 | Accurate: REPO_ROOT is still the stale pre-implement backup. |
| `src/orchestrator/review-archive.ts` | 4 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 72 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 98 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 100 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 101 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 106 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 114 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 124 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 131 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 138 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 140 | Unrelated review-artifact template regeneration. |
| `src/orchestrator/review-archive.ts` | 143 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 7 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1132 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1133 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1134 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1135 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1136 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1137 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1139 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1143 | Unrelated review-artifact template regeneration. |
| `src/task/index.ts` | 1145 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 5 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 7 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 24 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 42 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 45 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 58 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 59 | Unrelated review-artifact template regeneration. |
| `src/task/templates.ts` | 61 | Unrelated review-artifact template regeneration. |
| `templates/.claude/skills/canon-init/SKILL.md` | 3 | Unrelated init/upgrade or destination-safety scaffolding. |
| `templates/.claude/skills/canon-init/SKILL.md` | 11 | Unrelated init/upgrade or destination-safety scaffolding. |
| `templates/.claude/skills/canon-init/SKILL.md` | 176 | Unrelated init/upgrade or destination-safety scaffolding. |
| `templates/.claude/skills/canon-init/write-guide.md` | 3 | Unrelated init/upgrade or destination-safety scaffolding. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | 183 | Current backup/pull guidance or unrelated canon-init pointer. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | 192 | Current backup/pull guidance or unrelated canon-init pointer. |
| `templates/.claude/skills/canon-pipeline/recovery.md` | 91 | Accurate: stale-copy recovery or explicitly old-engine history. |
| `templates/.claude/skills/canon-pipeline/recovery.md` | 110 | Accurate: stale-copy recovery or explicitly old-engine history. |
| `templates/.claude/skills/canon-status/SKILL.md` | 23 | Accurate: REPO_ROOT is still the stale pre-implement backup. |
| `templates/docs/pipeline-orchestrator.md` | 117 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `templates/docs/pipeline-orchestrator.md` | 124 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `templates/docs/pipeline-orchestrator.md` | 191 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `templates/docs/pipeline-orchestrator.md` | 292 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `templates/docs/pipeline-orchestrator.md` | 302 | Updated: untracked copy and backup lifetime. |
| `templates/docs/pipeline-orchestrator.md` | 306 | Updated: untracked copy and backup lifetime. |
| `templates/docs/pipeline-orchestrator.md` | 487 | Accurate task/template creation or review regeneration; no base-commit claim. |
| `templates/scripts/docs-refs-check.mjs` | 15 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 16 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 702 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 704 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 705 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 713 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 720 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 842 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 843 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 845 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 846 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 851 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 898 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 899 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 902 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 903 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 910 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-check.mjs` | 911 | Unrelated adopter-doc scaffold resolution/config. |
| `templates/scripts/docs-refs-config.mjs` | 2 | Unrelated adopter-doc scaffold resolution/config. |

## Ready for Review

- [ ] All spec ACs met — AC-13 retains the out-of-scope CLI help wording blocker.
- [x] All required validation checks pass.
- [x] Deviations and ambiguity interpretations documented.
- [x] Working-tree files only; repository staging/commit/push remains orchestrator-owned.


## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/git.ts` | Before creating a fresh task branch, probe every bundle member for tracked task edits and files an inherited status marker would hide; refuse before branch/worktree creation, including on probe errors and under --force. Existing task branches retain their canonical artifacts on reattachment. |
| `src/orchestrator/main.ts` | Diverged-base recovery now orders scoped cleanup of already-merged task backups before rebase. |
| `src/task/index.ts` | Add the same cleanup-before-rebase order to post-merge-sync's source-divergence guidance. |
| `tests/run-task-safety.test.ts` | Add real-git tracked-base refusal cases (modified, staged, staged deletion, missing plan, bundle secondary, force), a probe-error case, and an identical-tracked-scaffold control. |
| `tests/run-task-ship.test.ts` | Make AC-7(e) run clearing while local main is behind a real incoming squash and already tracks the task; log probes and verify no deletion. Exercise ship's cleanup/rebase guidance. |
| `tests/task-cli.test.ts` | Exercise post-merge-sync's cleanup/rebase guidance against real git and retain the operator source commit. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Describe the task-file guard and acknowledge that stale-copy deletion precedes the ungated fast-forward and forge-proof gate; regenerate the managed mirror. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Add clearing to both ship-order descriptions and give the bootstrap/backup paragraph its own heading; regenerate the managed mirror. |
| `dist/orchestrator/run-task.js`, `dist/cli/index.js` | Rebuild both published bundles. |
| `tasks/no-base-scaffold-commit/notes.md`, `tasks/no-base-scaffold-commit/handoff.md` | Append revision observations, findings dispositions, evidence and validation. |

### Findings addressed

1. **Correctness Bug 1 — tracked-base bootstrap loss:** fixed in `src/orchestrator/git.ts`. All task-file probes run before a fresh branch is created. Tracked edits and source files absent from a base-tracked member's inherited marker tree are named in the refusal; recovery says to commit to the declared base or revert. The guard has no force exemption, and a probe error refuses without creating branch/worktree state. The copy condition itself is unchanged. Five original variants were red before production changes; all eight guard/control cases now pass. Committed-artifact and interrupted-copy reattachment tests remain green.
2. **Correctness Bug 2 — vacuous AC-7(e):** fixed in `tests/run-task-ship.test.ts`. The fixture asserts that main HEAD tracks the task, creates an actual squash in a second clone, asserts main is one commit behind, and verifies collision-probe argv during the fast-forward. The archive contains the incoming content and no removal line prints. Removing the clearing call makes this test fail; see test-integrity evidence below.
3. **Correctness Bug 3 — rebase hints blocked by backups:** fixed in `src/orchestrator/main.ts` and `src/task/index.ts`. Both hints now require scoped cleanup of only already-merged tasks before rebase. The tests execute the printed command template with their merged task ID, then rebase successfully while retaining operator source work.
4. **Correctness Bug 4 — stale in-scope restatements:** fixed in `docs/pipeline-orchestrator.md` and `.claude/skills/canon-pipeline/SKILL.md`, with their managed mirrors regenerated. The fast-forward description explicitly identifies deletion before the proof gate. Both skill ship-order descriptions include clearing, and bootstrap guidance is under a heading.
5. **Spec Gap 1 — excluded CLI help:** remains blocked by the file cap. No amendment to the Affected Files table is present. `src/cli/index.ts` and `src/orchestrator/cli.ts` remain untouched, as the review explicitly directs.
6. **Spec Gap 2 — task-path collision scope:** retain the review's accepted interpretation; no change to the task-only collision set.

### AC deltas

| AC | Status after this revision | Evidence |
|---|---|---|
| AC-4 | Met, with tracked-base safety strengthened | Guard refuses the lost-file states before creation; existing committed/interrupted reattachment tests still pass. |
| AC-7 | Met | The (e) fixture now reaches clearing and can fail when wiring is removed; other ship cases pass in the full suite. |
| AC-9 | Met | Both divergent-base paths give cleanup before rebase; real-git command execution succeeds. |
| AC-13 | Partial | All four in-scope restatement locations and mirrors fixed. Two out-of-scope CLI renderers still require an amendment. |

Other AC behavior is unchanged; the complete test suite and deleted-symbol sweep were re-run.

### Blockers

- [scope] **Spec Gap 1 remains:** `src/cli/index.ts`:76–79 still omits task-file divergence/clearing in post-merge-sync help, and `src/cli/index.ts`:102–106 plus `src/orchestrator/cli.ts`:146–150 still list the old ship order. Neither source file is authorized by the spec's Affected Files table. The reviewer explicitly prohibited changing them before an amendment; this headless revision completes all authorized work and carries the scope question forward instead of widening scope.
- [ambiguity] “First-creation worktree path” is interpreted as creation of a fresh task branch from base. Existing task branches keep their committed worktree artifacts canonical when reattached (AC-4(a)); the new guard runs before creating a fresh branch, so a refusal cannot leave a newly-created branch that skips the guard on retry. No copy predicate was changed.

### Non-blocking risk / guardrail dispositions

Round 1 explicitly labels these as non-blocking and permits follow-ups. They remain visible here; no accepted contract was silently broadened to resolve them.

| Review risk | Disposition |
|---|---|
| Non-colliding backup files can enter the archive commit | Deferred. The spec mandates deleting exactly incoming collisions and retaining the archive path; discarding or relocating other backup files needs a separate archive/backup policy. |
| Fetch-then-pull race | Retained limitation. The spec explicitly uses pull after probing the fetched ref; a concurrent incoming change can refuse safely, and rerunning ship retries with a fresh collision set. |
| File/directory or case-only collisions | Retained fail-closed behavior. The accepted collision set is an exact-path intersection; extending it needs explicit deletion semantics. |
| Backup lingers after another clone already archived the task | Deferred lifecycle case. The incoming archive path does not collide with the local active-task backup, so the prescribed helper intentionally leaves it. |
| Orphaned recorded branch no longer exists locally | Deferred legacy/hand-edited-state recovery. This revision keeps existing reattachment semantics and does not broaden fresh-branch creation from that state. |
| post-merge-sync invoked from a subdirectory | Deferred fail-safe usability issue. Run from the repository root; cwd-relative probes otherwise leave the collision for git to refuse. |

Other optional nits were left unchanged; the skill paragraph placement was fixed with Correctness Bug 4.

### Red-First Evidence

The regressions below ran with only test changes applied, before this round's production edits. The pre-fix commit is the task HEAD at revision entry, not main.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-4 / Correctness Bug 1 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='base-tracked task disagreement|does not clear task files' tests/run-task-safety.test.ts tests/run-task-ship.test.ts` | `cbb448bd85352a62a51b9389d2264887125c3b77` | All five original disagreement cases incorrectly exited 0 and printed “Branch recorded”; the new refusal assertion failed. The corrected tracked-file ship fixture passed. | The five cases, added force case, probe-error case and clean-tracked control pass. |
| AC-9 / Correctness Bug 3 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='divergence hint cleans' tests/run-task-ship.test.ts tests/task-cli.test.ts` | `cbb448bd85352a62a51b9389d2264887125c3b77` | Both fixtures reached their divergence path but failed the cleanup-before-rebase clause assertion; the old hints still advertised a bare rebase. | Both clauses pass, and scoped clean followed by rebase preserves merged artifacts and operator source commits. |

### Test-integrity verification

AC-7(e) is explicitly exempt from spec-mandated red-first failure. Its old fixture was vacuous; the revised fixture is a control case that should pass with correct wiring. On the final fixture, temporarily removing the fast-forward's `clearStaleTaskCopiesBeforePull` call made `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='does not clear task files' tests/run-task-ship.test.ts` exit 1 on the missing `ls-files -z --others --exclude-standard -- tasks/` probe assertion. Restoring the call returned the test to green. The temporary mutation was restored byte-for-byte; it is absent from the diff.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-run after the final fixture change; no errors. |
| `npm run type-check` | Pass | Re-run after the final fixture change; no errors. |
| `npm test` | Pass | 1,616 tests: 1,615 pass, 0 fail, 1 skipped. The final real-squash tracked-file fixture was also re-run separately and passed. |
| `npm run build` | Pass | Both dist entry points rebuilt from the current source. |
| `npm run sync-templates:check` | Pass | Managed root copies and regenerated mirrors match. |
| `npm run docs-refs-check` | Pass | All refs OK; rechecked with the appended handoff. |
| Targeted bootstrap/recovery/ordering tests | Pass | Thirteen combined targeted cases plus eight guard/control cases passed. |
| Targeted actual-squash ship/sync regressions | Pass | Corrected tracked-file fixture passes with main behind an actual squash and clearing probes observed. |
| AC-12 deleted-symbol sweep | Pass | Exact spec pathspec and pattern still return no hits. |
| AC-13 lexical sweep | Pass | Repeated across all prescribed surfaces. Original dispositions remain valid; changed hit locations are listed below. CLI help exclusions remain the explicit scope blocker. |
| `git diff --check` | Pass | No whitespace errors. |
| Affected Files cap | Pass | All changed non-task-artifact files are in scope; excluded CLI help files untouched. |
| Cumulative Changes-table coverage | Pass | Every path in git diff main...HEAD --name-only is declared in a Changes table across the two iterations. |

### Lexical-sweep delta

Repeated the same AC-13 lexical sweep. Baseline rows above are the Iteration 1 snapshot; these rows identify matching source lines whose text or location changed in this revision. All other matches retain their previous disposition.

| File | Current line | Disposition |
|---|---|---|
| `.claude/skills/canon-pipeline/SKILL.md` | 185 | Accurate current backup/copy guidance or unrelated init pointer; paragraph now under a heading. |
| `.claude/skills/canon-pipeline/SKILL.md` | 194 | Accurate current backup/copy guidance or unrelated init pointer; paragraph now under a heading. |
| `docs/pipeline-orchestrator.md` | 308 | Current task/template/bootstrap description; line moved with guard documentation. |
| `docs/pipeline-orchestrator.md` | 489 | Current task/template/bootstrap description; line moved with guard documentation. |
| `src/orchestrator/git.ts` | 307 | Current untracked-copy helper or call site, relocated by the new safety guard. |
| `src/orchestrator/git.ts` | 313 | Current untracked-copy helper or call site, relocated by the new safety guard. |
| `src/orchestrator/git.ts` | 314 | Current untracked-copy helper or call site, relocated by the new safety guard. |
| `src/orchestrator/git.ts` | 325 | Current untracked-copy helper or call site, relocated by the new safety guard. |
| `src/orchestrator/git.ts` | 432 | Current untracked-copy helper or call site, relocated by the new safety guard. |
| `src/orchestrator/git.ts` | 463 | Current untracked-copy helper or call site, relocated by the new safety guard. |
| `src/orchestrator/main.ts` | 2870 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2872 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2894 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2895 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2898 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2899 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2900 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2901 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2903 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2907 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `src/orchestrator/main.ts` | 2909 | Unrelated review-artifact regeneration; line shifted by recovery guidance. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | 185 | Accurate current backup/copy guidance or unrelated init pointer; paragraph now under a heading. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | 194 | Accurate current backup/copy guidance or unrelated init pointer; paragraph now under a heading. |
| `templates/docs/pipeline-orchestrator.md` | 308 | Current task/template/bootstrap description; line moved with guard documentation. |
| `templates/docs/pipeline-orchestrator.md` | 489 | Current task/template/bootstrap description; line moved with guard documentation. |

### Ready for re-review

- [x] Correctness Bugs 1–4 addressed within the authorized file cap.
- [x] Required validation passes and cumulative file coverage verified.
- [ ] All spec ACs met — AC-13 still needs the documented CLI help scope amendment.


## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/git.ts` | Remove the unconditional HEAD-dirty refusal. Classify only differing base-inherited paths and artifacts hidden by an inherited status marker; print distinct path lists and recovery text for each class. Parse the source listing once. |
| `tests/run-task-safety.test.ts` | Add staged-new, other-HEAD and matching-base success regressions; pin inherited-only and hidden-only refusal guidance; move the failed-probe fake to the retained declared-base diff; check cleanup-before-rebase in the recovery doc's own section. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Add scoped cleanup before rebase to the divergent-base recovery entry; regenerate its managed mirror. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Align the guard description and its two remedies with the corrected predicate; name the guard in the force-exclusion row; regenerate the mirror. |
| `dist/orchestrator/run-task.js` | Rebuild the published orchestrator bundle. The CLI bundle is byte-unchanged this iteration. |
| `tasks/no-base-scaffold-commit/notes.md`, `tasks/no-base-scaffold-commit/handoff.md` | Append the reproduced false positives, revised message behavior, evidence and scope blocker. |

### Findings addressed

1. **Finding 1 — valid bootstraps refused:** fixed. The guard no longer folds every HEAD-relative dirty task path into its refusal. New staged task files absent from the declared base and task files tracked/modified only on a different supervising branch now copy successfully, with the task branch still cut from the declared local base. A third control proves that a working file already matching base is allowed even when it differs from the supervising branch's HEAD.

   The retained classifications are the declared-base diff intersected with inherited paths, and files hidden by an inherited status marker. Inherited conflicts can be committed intentionally or restored when unintended; hidden artifacts receive a separate instruction to keep and commit them alongside status.json, explicitly prohibiting deletion to bypass the marker. Tests assert opposite clause presence in inherited-only and hidden-only states. Existing staged-deletion, mixed bundle, force-refusal, clean-tracked, probe-error, and committed/interrupted reattachment coverage remains green. No copy condition, branch start point, commit boundary or force bypass changed.

2. **Finding 2 — recovery doc's bare-rebase advice:** fixed in the root recovery file and synced to its mirror. The divergent-base section now orders scoped cleanup of only already-merged tasks before rebase, preserves ignored runtime files, excludes other in-flight tasks, and names the canon recovery commands afterward. The regression reads only that section so the earlier manual-merge instructions cannot make it pass accidentally.

3. **Spec Gap 1 — excluded restatements:** still blocked by scope; extended to include the verified stale source comment in `src/orchestrator/validation.ts`. None of the three excluded files was edited.

### AC deltas

| AC | Status | Delta |
|---|---|---|
| AC-4 | Met | Guard permits copyable task files while retaining inherited-conflict refusal and resumable/no-clobber behavior. |
| AC-9 | Met | The doc sibling now gives the same cleanup-before-rebase order as the already-fixed code hints. |
| AC-13 | Partial | In-scope guard/recovery restatements and mirrors are aligned. The two help renderers and one source comment remain outside the authorized file cap. |

Other ACs are unchanged; the full validation matrix was re-run.

### Blockers

- [scope] **Round 2 Spec Gap 1:** `src/cli/index.ts`:76–79 and :102–106, `src/orchestrator/cli.ts`:146–150, and `src/orchestrator/validation.ts`:1436–1437 contain outdated post-merge-sync/ship descriptions or the old base-artifact-commit description. The spec has no amendment adding these files to Affected Files, and Round 2 explicitly prohibits editing them until an amendment. AC-13 cannot be completed within the current file cap. All authorized fixes, checks and phase closure are complete; these three files remain untouched.

### Risk / guardrail dispositions

The reviewer explicitly marks these non-blocking. Preserve the earlier accepted/deferred dispositions; this tightening round does not alter their behavior.

| Round 2 risk | Disposition |
|---|---|
| Recorded/orphaned branch with missing local branch skips guards | Deferred legacy/hand-edited-state recovery, as accepted in the previous round. This guard correction does not change recorded-branch routing. |
| Re-entry may restamp members after bundle composition changes | Deferred: identified as operator misuse and low-confidence/unverified in review. No bundle-composition contract changed. |
| Unregistered leftover worktree directory may be populated | Deferred: depends on the pre-existing early return from worktree setup. Resolving registration/leftover-directory ownership requires a separate recovery change. |
| Round 1 risks carried forward | Existing dispositions remain: exact collision keying and cleanup order follow the spec; fetch/pull races, archive leftovers, external-ship backups and cwd/fetch recovery remain documented follow-ups. |

Optional nits are deferred except for naming the unchanged force exclusion in the already-edited doc row and parsing the source listing once within the guard fix.

### Red-First Evidence

Only test files changed before the red run. The source commit at revision entry is recorded below. These are additional review-directed regressions; the original AC-7/AC-8 red-first evidence remains unchanged and was accepted in Round 2.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-4 / Finding 1 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='base will not hide\|base-tracked task disagreement\|task-file guard fails\|recovery document orders' tests/run-task-safety.test.ts` | `f374f50d9a44419e14f6317f4e9acfa3d28eafb4` | All three valid-bootstrap cases exited 1 with the old “Commit these task files to the declared base … or revert” refusal instead of succeeding. The six existing refusal cases also failed their new class-specific message assertions. The probe-error control passed. | All pass. The added inherited-only case also passes in the full suite. |
| AC-9 / AC-13 / Finding 2 | Same command as above | `f374f50d9a44419e14f6317f4e9acfa3d28eafb4` | The divergent-base recovery section lacked the cleanup-before-rebase clause; its scoped assertion failed despite cleanup guidance elsewhere in the doc. | Scoped doc assertion passes. |

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint clean. |
| `npm run type-check` | Pass | TypeScript clean. |
| `npm test` | Pass | 1,621 tests: 1,620 passed, 0 failed, 1 skipped. Includes the final inherited-only message case. |
| `npm run build` | Pass | Fresh build; only the orchestrator bundle changed. |
| `npm run sync-templates:check` | Pass | Both edited root/mirror pairs match. |
| `npm run docs-refs-check` | Pass | All refs OK; rechecked with this appended artifact. |
| Targeted bootstrap/recovery/ordering tests | Pass | 17 targeted cases passed before the additional inherited-only control; that final control passes in the full suite. |
| AC-12 deleted-symbol sweep | Pass | Exact prescribed pattern and pathspec return exit 1 with zero hits. |
| AC-13 lexical sweep | Pass | All 161 matches rechecked; prior dispositions remain valid, with shifted source locations below. Additional out-of-pattern stale comment is explicitly blocked by scope. |
| `git diff --check` | Pass | No whitespace errors. |
| Affected Files cap | Pass | No out-of-scope source edits. |
| Cumulative Changes-table coverage | Pass | All paths in git diff main...HEAD --name-only are covered by the union of Changes tables. |

### Lexical-sweep delta

Repeated `git grep -niE 'scaffold|pre-implement|pushes unpushed base' -- docs templates .claude src README.md`. Earlier tables remain snapshots; these are the matching lines relocated or changed by this revision. Other dispositions remain unchanged.

| File | Current line | Disposition |
|---|---|---|
| `src/orchestrator/git.ts` | 323 | Current untracked-copy helper or call site; line relocated by the corrected guard. |
| `src/orchestrator/git.ts` | 329 | Current untracked-copy helper or call site; line relocated by the corrected guard. |
| `src/orchestrator/git.ts` | 330 | Current untracked-copy helper or call site; line relocated by the corrected guard. |
| `src/orchestrator/git.ts` | 341 | Current untracked-copy helper or call site; line relocated by the corrected guard. |
| `src/orchestrator/git.ts` | 448 | Current untracked-copy helper or call site; line relocated by the corrected guard. |
| `src/orchestrator/git.ts` | 479 | Current untracked-copy helper or call site; line relocated by the corrected guard. |

### Ready for re-review

- [x] Round 2 Findings 1–2 fixed within scope.
- [x] Required validation passes; cumulative file coverage verified.
- [ ] All spec ACs met — AC-13 retains the three-file scope blocker above.
