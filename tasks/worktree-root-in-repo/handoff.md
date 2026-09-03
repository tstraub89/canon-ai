# Implementation Handoff: worktree-root-in-repo

> Author: Codex | Spec: `tasks/worktree-root-in-repo/spec.md` | Plan: `tasks/worktree-root-in-repo/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `.gitignore`, `templates/.gitignore`, `src/lib/canon-block.ts` | Added `.canon/worktrees/` to the managed runtime ignore block and regenerated the template mirror. |
| `src/orchestrator/env.ts` | Changed the default worktree root to `<repo>/.canon/worktrees`; retained relative override anchoring on `REPO_ROOT`. |
| `src/orchestrator/worktree.ts` | Added fail-soft `git worktree prune` before worktree lookup/reuse. |
| `src/orchestrator/state.ts`, `src/orchestrator/main.ts` | Added the pre-phase `canon run` out-of-root refusal, with the tasks-dir override and `--ship` exemptions; added repo-wide refusal for missing registered `task/*` worktrees, with dry-run/ship/override exemptions and fail-closed enumeration; appended the prior-default migration sentence to the existing invocation-root refusal. Resolution logic and classifier logic remain unchanged. |
| `src/orchestrator/git.ts` | Reworded the worktree-isolation comment to remove the legacy default name. |
| `tests/run-task-safety.test.ts`, `tests/cli.test.ts` | Added coverage for the new default, nested-root classification, prune ordering, in-repo lifecycle, location-blind resolution, run guard boundaries, invocation-root behavior, state routing, missing registered-worktree refusal/remedies, repo-wide bundle detection, entry ordering/exemptions, fail-closed enumeration, and the new ignore-pattern doctor warning. Updated existing fixtures whose assumptions were invalidated by the new default. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented the in-repo layout, tooling/cleaning trade-offs, migration behavior, and missing-registration refusal; regenerated the managed mirror. |
| `docs/patterns.md` | Updated the bundle leader worktree path. |
| `docs/codebase-map.md` | Annotated canon-ai's retained legacy permission grant. |
| `CHANGELOG.md` | Added the Unreleased breaking-adopter migration note, including the amended missing-registration contract. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt generated bundles after the amended entry guard. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The default now keeps task worktrees inside the adopter repository and ignores that runtime directory through the existing canon-managed block. A fail-soft prune remains inside the create/reuse path for AC-5, but the entry no longer treats pruning as recovery. Before resolving any task cwd, qualifying `canon run` invocations enumerate all registered `task/*` worktrees and refuse if any registration points to a missing directory, preserving the registration and giving explicit restore/discard commands. The existing out-of-root guard remains location-blind and task-specific; `--ship`, `--dry-run`, and the established test tasks-directory override retain their documented exemptions.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| The docs table renders the default as plain .canon/worktrees rather than a backticked path. | `docs-refs-check` treats a backticked runtime directory that is created at runtime, rather than tracked as a file, as a broken reference. The rendered operator-facing value is unchanged and the layout section still uses the canonical path notation. | AC-9 met; docs reference validation passes. |
| Two existing test fixtures were adapted to run the relevant production helper in a child process or to set `CANON_TASKS_DIR_OVERRIDE`. | The new default is resolved at module import and the new invocation-root guard intentionally changes which earlier guard fires for a linked worktree. These changes preserve the original assertions' intended branches without changing production behavior or weakening the new guard. | AC-2/AC-7/AC-13 met; full suite passes. |
| Entry recovery is a refusal rather than an automatic prune/recreation. | The amendment supersedes the original operator-facing recovery promise: pruning before resolution can erase the only evidence of a canonical worktree and silently route blank-branch state to `REPO_ROOT`; recreating from the branch cannot restore uncommitted post-implement artifacts. The existing create-path prune remains unchanged for AC-5. | AC-5 and AC-14–AC-16 met. |
| The amendment tests use a small fake-git fixture that provides repository-root and active-toplevel answers. | Those responses are required because `REPO_ROOT` and invocation-root classification are resolved at module load; without them the subprocess would exercise the supervising repository instead of the fixture. | AC-16 met; no production behavior change. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Unset-env test asserts `WORKTREES_ROOT`, `effectiveWorktreesRoot()`, and `worktreePath()` all resolve under the active repository's .canon/worktrees. |
| AC-2 | Met | Existing relative-anchor regression remains unmodified and passes in the full suite. |
| AC-3 | Met | Added pure main/nested/prefix-sibling cases and a real-git main plus nested-worktree invocation test; comparisons canonicalize both sides. |
| AC-4 | Met | Real-git lifecycle test verifies intermediate-directory creation, linked runtime entries, registration, clean main checkout, and teardown. |
| AC-5 | Met | Red-first test reproduced the stale returned-path failure before the fix; after the fail-soft pre-lookup prune, the recreated path exists and is non-prunable. |
| AC-6 | Met | Real-git test proves an out-of-root registered worktree is still returned by `resolveTaskCwd()`; existing bundle-secondary, stale-worktree, and relative-override tests pass unchanged. No containment logic was added to resolution. |
| AC-7 | Met | Four real-git boundary tests cover refusal before runtime files, `--ship`, an in-root custom-name worktree, and a fresh no-worktree task. The guard is immediately before dependency/heartbeat/concurrency/dry-run handling. |
| AC-8 | Met | Added the managed ignore pattern, regenerated the mirror, and added the pre-3.0.0 doctor warning test. |
| AC-9 | Met | Updated both pipeline-orchestrator copies, patterns, and codebase-map documentation; sync and docs-reference checks pass. |
| AC-10 | Met | `rg 'dev-worktrees' src/` is empty; both rebuilt dist bundles report zero matches. |
| AC-11 | Met | The repository-wide remaining occurrences match the spec's permitted settings, docs, script-comment, task, and fixture locations. |
| AC-12 | Met | Unreleased `### Changed` contains the required `Breaking (adopters)` callout, migration paths, prune behavior, ship behavior, tooling/clean caveats, and main-checkout instruction. |
| AC-13 | Met | Real-git tests cover the existing refusal from inside an unmigrated worktree and mutation of only the resolved old-worktree status from the main checkout; pure classifier tests remain unchanged. |
| AC-14 | Met | Red-first real-git fixture bootstraps through `ensureBranch()`, confirms blank main versus branch-bearing worktree status, advances both post-implement and rerouted states, deletes the directory, and verifies clean refusal, both remedies, no runtime files, and preserved registration. |
| AC-15 | Met | Tests cover restore, discard, orphan branch without registration, intact in-root worktree, non-task branch, unrelated missing task branch, and intact/deleted bundle leader with both bundle and secondary-only invocations. |
| AC-16 | Met | Fake-git tests prove dry-run/ship skip detection and entry prune, invocation-root ordering, and fail-closed list failure with git stderr and no runtime files. `listWorktreesWithBranches()` now exports additive stderr detail while its resolver consumer remains unchanged. |

## Edge Cases Considered

- Canonicalized `/var` versus `/private/var` paths on macOS for every new filesystem comparison.
- Prefix siblings such as .canon/worktrees-evil, custom directory names inside the managed root, bundle secondary resolution, missing worktrees, `--dry-run`, `--ship`, and `CANON_TASKS_DIR_OVERRIDE`.
- Prune failure is warning-only, so a git probe failure does not turn the lifecycle change into a new hard failure.
- A registered but missing directory is detected repo-wide, including an unrelated task branch and a bundle leader when only the secondary is invoked; non-task registrations are ignored by the new detector.
- Restoring with `git worktree add -f` clears the refusal without claiming to restore uncommitted artifacts; discarding with `git worktree remove --force` clears the registration.
- The documented consequences of root-walking tooling and `git clean -ffdx`/`.canon` removal are included in both operator docs and the changelog.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Record every check in spec.md's Validation Required section here, plus any extra checks you ran. Required checks should not be marked `N/A` or `not_configured` — run the check or adjust the spec; the code reviewer verifies coverage against the spec. The `Check` cell is for human readability (the pre-flight gate no longer string-matches it against the spec), so write whatever names the check clearly — but keep a check's label identical across a baseline row and any later `### Re-run validation` row so its result updates in place.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | TypeScript completed cleanly. |
| `npm test` | Pass | 1,201 passed, 0 failed, 1 expected environment skip. |
| `npm run build` | Pass | Both declared dist bundles rebuilt successfully. A second rebuild produced identical hashes. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |
| `npm run docs-refs-check` | Pass | All references are valid. |
| E2E | deferred_by_spec | Spec: Validation Required — no UI surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Red-first evidence

Before adding the prune call, this command was run against the pre-fix implementation:

`node --test --test-name-pattern='ensureWorktree prunes a hand-deleted|worktree roots default' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-safety.test.ts`

It failed at the second ensure assertion because the stale branch lookup returned the hand-deleted path (`false !== true` for path existence). After adding prune before lookup, the focused regression passed, and the full suite passed.

For amendment AC-14, this command was run after adding the new test but before adding entry detection:

`node --test --test-name-pattern='canon run refuses a hand-deleted registered canon worktree' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-safety.test.ts`

It failed because the pre-amendment entry path exited successfully instead of refusing the missing registered worktree (`actual 0`, expected non-zero). After adding `assertNoMissingCanonWorktrees()` before task resolution, the same test passed.

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration, or a comma-separated list when files are tightly coupled — see the baseline Changes note above for the grouping guidance and token format. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
