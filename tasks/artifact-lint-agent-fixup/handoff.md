# Implementation Handoff: artifact-lint-agent-fixup

> Author: Codex | Spec: `tasks/artifact-lint-agent-fixup/spec.md` | Plan: `tasks/artifact-lint-agent-fixup/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

> **Directory paths:** backticking a path to an existing directory is fine — `docs-refs-check` accepts it. A backticked directory path that no longer exists (for example, one this task deleted) can be reported as a missing reference, so describe removed directories in prose or use the markdown-link form above.

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Added the bounded implement and QA artifact fix-up flow, content scope guard, and wiring at both implement commit entries and QA-end commit. |
| `src/orchestrator/validation.ts` | Added docs-refs output parsing, artifact filtering, and a checker CLI runner. |
| `src/orchestrator/prompts/index.ts` | Added the fix-up prompt builder and shared canonical citation rule. |
| `src/orchestrator/prompts/templates/implement.md` | Added full repository path and missing-file citation guidance. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Added full repository path and missing-file citation guidance. |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Replaced the deleted-file guidance with the shared citation rule and retained the Changes-table restriction. |
| `src/orchestrator/prompts/templates/qa.md` | Added full repository path and missing-file citation guidance. |
| `docs/architecture.md` | Documented implement artifact checking before auto-commit. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented implement and QA fix-up behavior, fallback, scope guard, and in-process QA resumption; synced the managed mirror. |
| `docs/decisions.md` | Clarified that the orchestrator may resume implement to repair handoff references before its commit. |
| `tests/run-task-safety.test.ts` | Added docs-refs parsing/filtering/snapshot tests and implement, review-entry, and QA fix-up integration fixtures. |
| `tests/run-task-prompts.test.ts` | Pinned citation guidance and added implement/QA fix-up prompt goldens. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt snapshots for citation guidance and fix-up prompts. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled orchestrator output. |

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

Before implement auto-commit and QA-end artifact commit, the orchestrator runs the shipped docs-refs checker in the tree being committed. Findings are limited to artifacts written by that phase and can resume the existing author session twice. Each resume is scope-guarded by content and status snapshots; unsuccessful or remaining lint findings preserve the prior commit behavior with a warning.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Render the fix-up prompt directly in `promptArtifactFixup` instead of adding `artifact-fixup.md`. | The new internal template caused `tests/sync-canon-templates.test.ts` to fail its pinned inventory assertion, but that file is outside the spec's Affected Files. Inline rendering preserves the prompt contract without widening scope. | No AC impact; both fix-up prompt goldens cover the rendered text. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1: implement fix-up succeeds | Partial | Green integration coverage exercises initial implement, stored session resume, artifact repair, and transition to code_review. The red-first variant did not reproduce the specified `Auto-commit failed:` result because the fixture's custom pre-commit hook did not reject; see Blockers. |
| AC-2: bounded fallback | Partial | The loop caps attempts at two and warns before the unchanged auto-commit path, but the never-fixed plus rejecting-hook integration case is not covered. |
| AC-3: no fix-up for clean, absent, missing-session, or unrelated findings | Partial | Checker absence/clean and artifact filtering are implemented; all four zero-invocation integration cases are not covered. |
| AC-4: review-entry retry | Met | Integration test verifies one resume with the stored Codex session, repair in the task tree, commit retry, and code_review continuation. |
| AC-5: scope guard | Partial | Snapshot and diff logic covers content, status columns, newly dirty paths, and each bundle member's status.json; adversarial implement/QA scope-violation integration cases are not covered. |
| AC-6: failed fix session never parks | Partial | AgentSessionError is caught locally and Codex non-zero exits are treated as failure; explicit non-zero implement/QA regression cases are not covered. |
| AC-7: QA fix-up | Partial | Green test asserts the fixed committed done.md and resumed Claude session. Red-first run confirmed the baseline commits the broken backtick reference. Never-fixed and no-session cases are not covered. |
| AC-8: prompt guidance | Met | All four phase templates contain the exact shared sentence; fix-up prompts have golden snapshots and phase-lock assertions. |
| AC-9: restatements updated | Met | Architecture, pipeline docs and managed mirror, and decisions entry updated. |
| AC-10: build and checks | Met | Full required validation matrix passed; E2E is N/A per spec. |

## Edge Cases Considered

- Snapshot inputs include all paths in porcelain entries (including rename sides), plus each bundle member's status.json even when clean.
- Canon-written metrics and heartbeat/run metadata are exempt from the scope comparison; task artifacts outside the phase-owned allowlist remain guarded.

## Blockers

- [wrong-premise] AC-1 red-first fixture: temporarily disabling the implement fix-up produced a successful auto-commit rather than the specified `Auto-commit failed:`. The fixture custom hook did not reject during the run, although the green fix-up integration did resume Codex and repair the artifact. The pre-fix failure path remains unconfirmed.
- [validation] AC-2, AC-3, AC-5, AC-6, and the QA no-session/never-fixed branches are implemented but lack their specified integration cases. Treat these cases as unverified until covered.

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
> A `Fail` row whose cause lies outside this task's diff: name the result `Fail – unrelated` explicitly, and Notes must cite a specific file reference outside this task's affected files (a sibling worktree path, a fixed-port test's own file, an unrelated spec's path) — the code reviewer only accepts `Fail – unrelated` when Notes names such a reference credibly. Pre-flight's own check is textual — naming a changed file in that row, even to say it passed, can reclassify the whole row as task-owned and reject the handoff. Don't rely on an unqualified filename escaping the check; keep Notes free of any path from this task's diff.
> Record every check in spec.md's Validation Required section here, plus any extra checks you ran. Required checks should not be marked `N/A` or `not_configured` — run the check or adjust the spec; the code reviewer verifies coverage against the spec. The `Check` cell is for human readability (the pre-flight gate no longer string-matches it against the spec), so write whatever names the check clearly — but keep a check's label identical across a baseline row and any later `### Re-run validation` row so its result updates in place.

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | ESLint completed with no errors. |
| `type-check` (`npm run type-check`) | Pass | TypeScript completed with no errors. |
| `unit tests` (`npm test`) | Pass | Full suite: 1,525 passed, 0 failed, 1 skipped. |
| `build` (`npm run build`) | Pass | Rebuilt `dist/cli/index.js` and `dist/orchestrator/run-task.js`. |
| `docs references` (`npm run docs-refs-check`) | Pass | All refs OK. |
| `template sync` (`npm run sync-templates:check`) | Pass | All canon-managed files in sync. |
| `E2E` | N/A | Spec AC-10 explicitly marks E2E as N/A. |

## Ready for Review

- [ ] All spec ACs met (see AC Coverage table above)
- [ ] All applicable validation checks pass (no failures)
- [ ] All deviations from plan documented with rationale

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

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Canonicalized the checker path in the pre-commit fixture so its direct-run guard works when the temp directory is reached through macOS's `/var` alias; the implement happy path now asserts the fixed handoff and source blob landed in the commit. |
| `src/orchestrator/main.ts` | Corrected the implement fallback warning to name the always-present `--pr` gate and describe a hook as optional. |
| `src/orchestrator/prompts/templates/qa.md` | Moved citation guidance after the PR-template conditional so it applies to both QA artifacts. |
| `tests/run-task-prompts.golden.json` | Regenerated the QA prompt golden after moving its guidance. |
| `dist/orchestrator/run-task.js` | Rebuilt for the runtime warning text change. |

### Findings addressed

- _correctness bug:_ The docs-refs pre-commit fixture invoked the checker through a non-canonical temp path on macOS, bypassing its direct-run guard. The fixture now resolves the checker with `fs.realpathSync`; focused implement and review-entry fix-up tests pass.
- _correctness bug:_ The implement green test did not prove auto-commit landed. It now verifies both the fixed committed handoff and the committed source blob with `git show`.
- _risk/guardrail:_ The fallback warning implied canon installs a docs-refs hook. It now identifies the `--pr` gate and says an adopter hook may also reject the commit.
- _optional cleanup/nit:_ QA citation guidance now follows the complete conditional PR-template section and applies to both output artifacts.
- _optional cleanup/nit:_ Deferred the stacked bold-label cleanup in the revisions prompt; it has no behavior impact and was not required to close the blocking findings.
- _optional cleanup/nit:_ The scope-guard stop remains non-sticky across a later run, matching the spec's stated run-stop contract; persisting a block would expand the spec.

### AC deltas (if any)

- AC-1: the implement happy path now asserts the fixed handoff and source blob in the commit, and the hook fixture is active. The required pre-change `Auto-commit failed:` run was not reproduced in this iteration; the prior `[wrong-premise]` conclusion is withdrawn because the fixture path was invalid, and this red-first proof remains unresolved.
- AC-8: the QA guidance placement was corrected and its golden regenerated; wording and the other prompt contracts are unchanged.
- AC-10: all required checks were rerun and pass (results below).

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | ESLint completed with no errors. |
| `type-check` (`npm run type-check`) | Pass | TypeScript completed with no errors. |
| `unit tests` (`npm test`) | Pass | Full suite: 1,525 passed, 0 failed, 1 skipped; the final implement assertion was rerun in its focused test afterward. |
| `build` (`npm run build`) | Pass | Rebuilt distribution output. |
| `docs references` (`npm run docs-refs-check`) | Pass | All refs OK. |
| `template sync` (`npm run sync-templates:check`) | Pass | All canon-managed files in sync. |
| Focused fix-up tests | Pass | Implement, review-entry, and QA happy paths passed. |

### Blockers

- [validation] The review-required integration coverage remains incomplete: AC-2's never-fixed bounded fallback; all four AC-3 zero-invocation cases; AC-4's failed review-entry session; AC-5's dirty source, status.json, and QA non-artifact edits; both AC-6 non-zero-session cases; and AC-7's never-fixed and no-session branches are not exercised by this revision. AC-1's pre-change failure also remains unverified. The existing implementation paths were not changed for these cases, but they remain unverified until integration fixtures cover them.

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Added bounded implement fallback, no-resume conditions, absent-checker runner behavior, implement and QA scope violations, failed sessions at implement, review-entry, and QA, plus QA never-fixed and no-session cases. Documented the test-only handoff self-listing row. |
| `src/orchestrator/prompts/templates/qa.md` | Moved citation guidance after step 4 so it is outside the single-task PR-body instructions and applies to QA summaries for bundles too. |
| `tests/run-task-prompts.golden.json` | Regenerated the QA prompt snapshots. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled QA prompt. |

### Findings addressed

- _spec gap / code-bug:_ Added AC-2 two-attempt fallback coverage; it verifies two resumes, the remaining finding warning, the hook's `Auto-commit failed:` outcome, implement remains done, and review counters remain zero.
- _spec gap / code-bug:_ Added AC-3 integration coverage for a clean artifact with an unrelated failing hook, no stored session, and findings only in review.md; each asserts zero resume calls. The absent-checker result is covered at the `runDocsRefsCheck` boundary with a missing script path.
- _spec gap / code-bug:_ Added AC-4 review-entry failure coverage; a non-zero Codex fix session falls back and the review-entry retry continues.
- _spec gap / code-bug:_ Added AC-5 scope-stop coverage for an already-dirty source file, status.json, and a QA source-file edit; each proves the run stops before the commit.
- _spec gap / code-bug:_ Added AC-6 non-zero implement and QA resume coverage; implement remains done and QA completes instead of parking.
- _spec gap / code-bug:_ Added AC-7 never-fixed and no-session cases, checking the warnings, attempt counts, completed QA state, and committed done.md.
- _spec gap:_ The Round 2 reviewer reports a red-first scratch-copy reproduction: with `fixUpImplementArtifactRefs` disabled, the focused AC-1 test fails with `Auto-commit failed: tasks/artifact-fixup-implement/handoff.md:16: … — missing file`. The exact scratch-copy shell command was not preserved in review.md. The corrected green test asserts both the committed fixed handoff and source blob.
- _correctness bug, low:_ Moved QA citation guidance out of numbered step 4 and regenerated the prompt golden.
- _optional cleanup/nit:_ Added a comment that the handoff self-listing row exists only in the fixture to assert the committed artifact blob.
- _follow-up, outside scope:_ The Round 2 reviewer also identified a symlink invocation blind spot in the checker's entry guard. It predates this task and is outside Affected Files; left for a separate task.

### AC deltas (if any)

- AC-1: Partial → Met. Round 2's anchored reviewer confirmed the red-first scratch-copy failure; the corrected green fixture asserts the fixed committed handoff and source blob.
- AC-2: Not Met → Met. The two-resume, warning, rejecting-hook, status, and counter assertions are in `tests/run-task-safety.test.ts`.
- AC-3: Not Met → Partial. Clean/unrelated-hook, missing-session, and review-only findings each show zero resumes. The missing-checker path is tested at the checker runner boundary, not through a `main()` integration fixture: production fix-up passes the package's absolute `REPO_ROOT/scripts/docs-refs-check.mjs` path, so the CLI integration cannot make that script absent without mutating the package under test.
- AC-4: Partial → Met. The failed review-entry resume falls back without crashing.
- AC-5: Not Met → Met. Both implement violations and the QA violation stop before commit.
- AC-6: Not Met → Met. Non-zero implement and QA resumes are locally contained.
- AC-7: Partial → Met. Never-fixed and no-session QA cases warn, finish QA, and commit the artifact.
- AC-8: Met. Citation guidance now stands outside the single-task step and applies to bundle QA as well.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | ESLint completed with no errors. |
| `type-check` (`npm run type-check`) | Pass | TypeScript completed with no errors. |
| `unit tests` (`npm test`) | Fail – unrelated | 1,530 passed, 1 failed, 1 skipped. The failure is `tests/run-task-ship.test.ts:1529`, outside this task's Affected Files: fixture setup's `git clone` exited 128 in `simulateMergeOnOrigin`; rerun that ship test to check whether the clone failure is transient. All 257 safety tests (256 passed, 1 skipped) and all 53 prompt tests passed separately. |
| `build` (`npm run build`) | Pass | Rebuilt distribution output. |
| `docs references` (`npm run docs-refs-check`) | Pass | All refs OK. |
| `template sync` (`npm run sync-templates:check`) | Pass | All canon-managed files in sync. |

### Blockers

- [validation] AC-3's absent-checker zero-invocation behavior has only a runner-level test. A `main()` integration case would need a checker-path injection seam or to remove the package's own checker during the test; neither is in the spec, and mutating the package script from a test risks parallel suite runs. The safe boundary test asserts `runDocsRefsCheck(..., missingPath)` returns `absent`.

## Iteration 4 — addressing review round 3

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Added a `main()` integration variant with the fixture checker absent, asserting zero resumes and a successful normal commit. Strengthened the QA failed-resume case to assert top-level `human_review` and committed `done.md`; tightened bounded-fallback counters/HEAD assertions and review-only finding evidence. Removed unused fixture handling and the fake agent's unsupported `--resume=*` form. |

### Findings addressed

- _spec gap / code-bug:_ AC-3's absent-checker case now runs through `main()` with a broken handoff and stored Codex session; it asserts no resume invocation and that the normal implement commit lands. This resolves the prior Iteration 3 `[validation]` blocker and corrects its stated rationale.
- _spec gap / code-bug:_ AC-6's failed QA resume now proves continuation to `status.status === 'human_review'` and checks the committed `done.md` blob, beyond the pre-fix-up QA phase status.
- _optional cleanup/nit:_ AC-2 now checks zero counters without defaulting missing values to zero and confirms HEAD is unchanged. The review-only case asserts the reported review artifact finding. Removed the unused `void root`, QA `fix` option, and fake `--resume=*` acceptance.

### AC deltas (if any)

- AC-2: bounded fallback assertions now require actual zero counters and unchanged HEAD.
- AC-3: Partial → Met; absent-checker path is integrated through `main()` and confirms a normal commit with zero resumes.
- AC-6: QA failed-resume case now confirms human-review state and committed artifact after the local catch.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| Focused regression tests | Pass | The absent-checker integration and QA failed-resume tests passed. |
| `unit tests` (`tests/run-task-safety.test.ts`) | Pass | 256 passed, 0 failed, 1 skipped. |
| `lint` (`npm run lint`) | Pass | ESLint completed with no errors. |
| `type-check` (`npm run type-check`) | Pass | TypeScript completed with no errors. |

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Added `HEAD` to each scope snapshot; failed HEAD probes stop fix-up before the agent session. |
| `src/orchestrator/prompts/index.ts` | Told both implement and QA fix-up sessions not to run `git add` or `git commit`. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Clarified that the guard compares Git-reported dirty tracked paths, non-ignored untracked paths, task status files, and `HEAD`; synced the managed mirror. |
| `tests/run-task-safety.test.ts` | Added snapshot coverage and a main integration case where the fix session commits an edit to a previously clean tracked file; verified the guard stops before canon adds another commit. |
| `tests/run-task-prompts.golden.json` | Regenerated the QA fix-up prompt golden for the no-commit instruction. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt distribution output. |

### Findings addressed

- _correctness bug:_ A fix session could commit a clean tracked file without changing porcelain state, bypassing the scope guard. The snapshot now records the resolved `HEAD`; an integration test confirms a session-created commit triggers the stop and no later commit is made.
- _risk/guardrail:_ QA fix-up now receives the same explicit no-commit instruction as implement fix-up; the prompt golden pins it.
- _risk/guardrail:_ The scope-guard docs now describe its actual inputs: tracked paths Git reports as changed, non-ignored untracked paths in the active checkout, each bundle member's `status.json`, and `HEAD`.

### AC deltas (if any)

- AC-5: the scope guard now detects commits made by a fix session, including an edit to a previously clean tracked path.
- AC-8: both phase fix-up prompts prohibit `git add` and `git commit`; the QA golden was regenerated.
- AC-9: the scope description is bounded to the snapshot's actual path and HEAD probes in both documentation copies.
- AC-10: build output and all required validation checks pass.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| Focused scope-guard test | Pass | The clean-file commit scenario stops on `[git HEAD]`; the agent's commit is the only commit after the fixture baseline. |
| Prompt tests (`tests/run-task-prompts.test.ts`) | Pass | 53 passed, 0 failed; QA fix-up golden regenerated. |
| Full suite (`npm test`) | Pass | 1,531 passed, 0 failed, 1 skipped. |
| `lint` (`npm run lint`) | Pass | ESLint completed with no errors. |
| `type-check` (`npm run type-check`) | Pass | TypeScript completed with no errors. |
| `build` (`npm run build`) | Pass | Rebuilt `dist/cli/index.js` and `dist/orchestrator/run-task.js`. |
| `docs references` (`npm run docs-refs-check`) | Pass | All refs OK. |
| `template sync` (`npm run sync-templates:check`) | Pass | All canon-managed files in sync. |
