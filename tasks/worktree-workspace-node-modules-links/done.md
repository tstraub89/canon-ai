# Done: worktree-workspace-node-modules-links

## Summary

canon-ai's task worktrees used to link only the repo-root `node_modules` into a new worktree. In an npm-workspaces monorepo (a repo whose root `package.json` declares `"workspaces": ["apps/*", "packages/*"]`), individual workspace folders can carry their own `node_modules` for packages npm didn't hoist to the root — those were never linked, so a task worktree was silently missing dependencies until someone ran a full install by hand. This was confirmed on a real adopter repo (GalleryPlanner). This task teaches canon to discover every eligible workspace directory from the root `package.json` and link each workspace's `node_modules` the same way it already links the root's, and widens the QA-end and human-review dirty-tree gates so a verified per-workspace symlink is exempt the same way the root symlink already was — but only while a distinct task worktree is active. Two safety properties were added along the way: a workspace path must be contained inside the repo on the source side *and* inside the worktree on the destination side (a task branch can commit a symlink where the main checkout has an ordinary directory, and checking only one side lets a write escape the worktree), and any dirty path whose final segment is exactly `node_modules` is now rejected before staging, everywhere, regardless of whether the repo declares workspaces.

This took six rounds of code review plus one spec amendment. The linker half (workspace discovery, containment, per-workspace linking) has been stable and correct since round 2. Nearly all of the churn was in the gate-widening half: three separate rounds (1, 2, 4) found a new way for a non-exempt `node_modules` path to ride a directory-form Affected Files prefix into a commit instead of aborting. Round 4 diagnosed this as a structural problem — the same invariant enforced across three functions that each normalized paths differently — and round 5 replaced the three-surface patching with one shared classifier (`classifyHumanReviewPath`). Round 6 confirmed that structural fix, plus a human-approved spec amendment resolving a genuine contradiction between AC-8 (every non-exempt `node_modules` entry aborts) and AC-10 (no-workspaces repos see no behavior change), holds under direct comparison against pre-task behavior.

## Files Changed

| File | What Changed |
|---|---|
| `scripts/run-task/worktree.ts` | Workspace resolver (`resolveWorkspaceDirs`), shared containment helper (`isContainedIn` / `resolveContainedPath`), a generalized `probeNodeModulesEntry` that takes an explicit expected-target path, and per-workspace linking + missing-link repair in `ensureWorktree()`. |
| `scripts/run-task/main.ts` | Widened the QA-end and human-review dirty-tree gate exemptions to verified per-workspace symlinks (worktree-active only), and consolidated the human-review allowlist/staging decision behind one classifier (`classifyHumanReviewPath`) that rejects any final-segment `node_modules` path before either decision runs. |
| `tests/run-task-safety.test.ts` | Resolver, containment, linking, repair, gate, porcelain-visibility, prefix-staging, no-worktree, and teardown regression coverage — 185 new/changed tests in this file. |
| `docs/pipeline-orchestrator.md` + `templates/docs/pipeline-orchestrator.md` | Reworded the `node_modules` carveout to cover verified per-workspace symlinks; mirror regenerated. |
| `dist/scripts/run-task.js` | Regenerated build artifact. `dist/cli/index.js` was rebuilt but is byte-identical, so it's not part of the task diff. |

## How to Test

1. In a monorepo project that uses canon (one with sub-apps that each keep some of their own dependencies), start a new task so canon creates its isolated working copy.
2. In that working copy, run the project's usual dev checks (build or tests for one of the sub-apps) **without** running any install step.
3. Expected: the sub-app finds all its dependencies — no "module not found" errors — because canon connected each sub-app's dependency folder automatically.
4. Confirm nothing was created outside the isolated working copy: the project's main folder and its neighbouring folders look exactly as they did before the task started.
5. Repeat on a branch where one of the sub-app folders is a shortcut pointing somewhere outside the project rather than a real folder. Expected: canon reports that it is skipping that sub-app by name, finishes normally, links the other sub-apps, and leaves the folder the shortcut points at completely untouched.
6. Let the task run through to the point where canon commits and pushes its results.
7. Expected: canon completes without complaining about unexpected dependency-folder files, and nothing dependency-related shows up in the task's changes.

This human test plan requires a real adopter monorepo and was not executable by an agent; it was called out as out-of-scope-for-agent-execution in the plan's Testing Plan.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-run at code_review round 6. |
| `npm run type-check` | Pass | Re-run at code_review round 6. |
| `npm test` | Pass | 1,144 tests, 1,144 passed, 0 failed (foreman's independent re-run at round 6; handoff's own run reported 1,143 passed + 1 expected sandbox skip for restricted `.git` writes — immaterial difference, no sandbox present in the foreman's environment). |
| `npm run build` | Pass | `dist/scripts/run-task.js` reproduces byte-identical; `dist/cli/index.js` confirmed outside the task diff. |
| `npm run sync-templates:check` | Pass | Root and template managed files in sync. |
| `npm run docs-refs-check` | Pass | Extra check beyond the spec's required list; clean. |
| `git diff --check main...HEAD` | Pass | No whitespace errors in the cumulative branch diff. |

## Human Verification Required

None of the spec's required validation checks are `human_pending` — the latest Validation Outcomes table in `handoff.md` has no pending rows.

Two items from the standard pre-merge checklist can't be confirmed until the PR is opened:
- **Final CI/CD checks green** — not yet observable; no PR has been opened for this task yet. Confirm CI is green after `canon run --pr` (or manual push) before merging.
- **Changelog updated** — intentionally not done yet. Per canon's versioning policy, the changelog edit and version bump happen at the release step (`/canon-changelog`), not in QA. See *Proposed Changelog* below for the draft entry text.

Everything else on the checklist is confirmed: version bump is not this task's concern (per-task versioning is a release-step activity), the PR body is drafted in `tasks/worktree-workspace-node-modules-links/pr-body.md`, and the final diff was independently re-verified against spec intent at code_review round 6 (`git diff main...HEAD --name-only` matches the Changes table exactly, six paths).

## Decisions Made During Implementation

- **Containment is checked twice, against two different roots, using one shared helper.** A workspace path is validated as contained inside `REPO_ROOT` (source side, inside the resolver, so no consumer can bypass it) *and* inside the worktree/`cwd` (destination side, at each consumer). The two can diverge because a task branch can commit a workspace path as a symlink pointing outside the worktree while the main checkout has an ordinary directory there — checking only the source side (round 1 of the spec's own ground-truth work) let a write escape onto disk outside the worktree in a reproduced fixture.
- **The workspace-level gate exemption only applies when a distinct task worktree is active.** With `worktree: false`, comparing `cwd` against `REPO_ROOT` degenerates into comparing a path with itself, which would exempt an adopter-created symlink canon never wrote. The pre-existing root-entry tautology in that mode is left untouched by design (out of scope for this task).
- **The gate-widening half was restructured around one shared classifier (`classifyHumanReviewPath`) after three review rounds (1, 2, 4) each found a new way for the same invariant — "no `node_modules` path is ever staged or committed, and any non-exempt one aborts" — to leak through a different one of three functions that each normalized paths differently.** Patching the leaking surface each round kept reopening the hole in a new shape; round 5 replaced the three-surface patching with a single chokepoint, and round 6 confirmed it holds by direct before/after comparison against pre-task behavior across eight porcelain shapes.
- **A spec amendment resolved a real AC-8/AC-10 contradiction rather than another implementation round.** AC-8 required every non-exempt `node_modules` entry to abort; AC-10 required no-workspaces repos to see zero behavior change. For a final-segment-`node_modules` path in a no-workspaces repo, those two requirements directly conflict, and code_review round 5 correctly returned `spec_gap` instead of forcing a sixth implementation pass at an unresolvable contradiction. The human-approved amendment named the final-segment rejection as a deliberate, strictly-safer exception to AC-10 (it can only newly *reject* paths pre-task code would have silently staged, never newly *admit* one) — verified directly against pre-task behavior across eight constructed porcelain shapes in round 6, not just read.
- **AC-8's "real directory" fixture parenthetical was corrected to match the fixture the suite actually needed, rather than chased for a fifth round.** Under `git status --porcelain=v1 -uall`, git always expands an untracked directory into its contents — there is no `.gitignore` rule that produces a single bare `<ws>/node_modules` porcelain line for a real directory. The amendment named the constructible shape (an untracked file inside the real directory) that the suite had been using as evidence since round 2.

## Open Questions Needing Human Input

- **The spec's Amendment states `docs/BACKLOG.md` records the round-4 chokepoint-refactor follow-up plus the accumulated non-blocking nits (`R2-6` through `R2-14`, `R4-5`) — it does not.** Foreman-verified at round 6: `docs/BACKLOG.md` has no entry for this task and the file's last commit is unrelated. Codex correctly declined to write it (the file is neither an AC target nor in Affected Files, so touching it would trip base-drift/auto-commit gates) — this is a human-side action, one line, outside the pipeline. The candidate entry: the `humanReviewAllowedPath` → `buildHumanReviewStagePaths` → `git add` triad's cross-cutting `node_modules` invariant (now unified behind `classifyHumanReviewPath`, but worth a BACKLOG note in case a future change reintroduces a second surface), plus the accumulated non-blocking review nits.
- **Several non-blocking operator-experience gaps carried through to the final `approved_with_nits` verdict, worth a small follow-up task if picked up:** the human-review abort message for a rejected `node_modules` path (`main.ts` around the die site) still describes the older directory-prefix remedy and never names the actual rule, offering no path forward for a categorical rejection; the root `node_modules` link is never repaired on worktree reuse (only workspace links are), so a rerun can print "Worktree ready" while the root link is still missing; and repair mode is silent (no warning) when it declines to fix a stale link whose source vanished, or a wrong-target link found on reuse. None of these commit bad data or bypass a safety gate — they're all operator-signal gaps in an otherwise fail-closed system.
- **Final verdict is `Approved with nits`, not `Approved`** — the two nits above are exactly the `docs/BACKLOG.md` gap and the operator-messaging cluster; code review explicitly recommends shipping as-is and treating both as follow-up rather than another review round.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 4 (AC-3, AC-4, AC-8, AC-10 — each was `Partial` or `Not Met` at one or more code_review rounds before reaching `Met`; AC-10's final gap in round 5 was a spec contradiction rather than an implementation defect, resolved by the human-approved amendment)
- Validation gaps: 0
- Notes: 6 rounds of code_review (one `spec_gap` halt) plus 1 implement reroute for a human-approved spec amendment; the gate-widening half needed a structural single-classifier rewrite after the same invariant leaked 3 times across 3 different functions; final verdict approved_with_nits with a `docs/BACKLOG.md` entry still owed by the human.
