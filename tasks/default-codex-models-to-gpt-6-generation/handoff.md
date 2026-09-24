# Implementation Handoff: default-codex-models-to-gpt-6-generation

> Author: Codex | Spec: `tasks/default-codex-models-to-gpt-6-generation/spec.md` | Plan: `tasks/default-codex-models-to-gpt-6-generation/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

> **Never backtick a bare directory path** anywhere in this file (e.g. write "the app source tree (apps/app/src)", not `` `apps/app/src` ``). `docs-refs-check` treats a backticked path as a file reference and aborts the pipeline's auto-commit with "missing file" when it is a directory. Backtick only real files.

| File | What Changed |
|---|---|
| `src/orchestrator/env.ts` | Updated Codex mini/full fallback defaults to GPT-6 Luna/Sol. |
| `src/orchestrator/policy.ts` | Updated duplicated Codex fallback defaults to GPT-6 Luna/Sol. |
| `src/orchestrator/prompts/helpers.ts` | Added headless and narrowly scoped ask/approval guidance; replaced obsolete branch-sync instruction. |
| `src/orchestrator/prompts/templates/implement.md` | Clarified scope-gap and wrong-premise handling so implementation continues through handoff and phase command. |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Clarified wrong-premise handling through handoff and phase command. |
| `src/lib/pipeline-policy.ts` | Updated the pending model-generation re-evaluation comment. |
| `tests/run-task-prompts.test.ts` | Added resume-stripping coverage and updated the structural assertion for branch-state guidance. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt snapshots for startup and template wording changes. |
| `dist/cli/index.js` | Rebuilt generated CLI bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt generated orchestrator bundle. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Updated documented defaults and synchronized managed mirror. |
| `docs/product-context.md` | Updated the GPT-6 re-evaluation pointer. |
| `docs/decisions.md` | Added the dated GPT-6 model-generation re-baseline decision. |

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

Brief explanation of the approach taken and why.

Updated both fallback config copies and all current-state model references, then hardened shared Codex startup and implement-phase guidance. Added a regression test for startup-block removal in resumed prompts and regenerated the prompt goldens.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Updated the existing structural assertion in `tests/run-task-prompts.test.ts` to assert the replacement branch-state instruction. | The old assertion required `pull --rebase`, which contradicted AC-5 after removing the dead branch-sync text; the replacement assertion pins the new rule. | No AC change; strengthens AC-5 verification. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1: Defaults bumped in both config copies | Met | Both fallback chains now end in `gpt-6-luna` / `gpt-6-sol`; override precedence is unchanged. |
| AC-2: No current-state surface names retired defaults | Met | Targeted grep returned no retired defaults; docs table and managed mirror show GPT-6 defaults. |
| AC-3: Headless paragraph in Codex startup | Met | Covers non-interactivity, artifact-based ambiguity handling, authorized scope, and required phase completion. |
| AC-4: Narrow ask/approval precedence | Met | Applies only when guidance says to ask or wait for approval; no adopter instruction filenames are named. |
| AC-5: Dead branch-sync instruction replaced | Met | Startup says orchestrator manages branch state; obsolete fetch/pull wording is absent. |
| AC-6: Three stop instructions mean stop the edit | Met | Each records the labelled Blocker and continues remaining work through handoff and phase command. |
| AC-7: Resume stripping works | Met | New test confirms startup removal and resumed banner for spec review, fresh implement, and implement revisions. |
| AC-8: Stale generation pointers updated | Met | Product-context and pipeline-policy now name GPT-6-generation re-evaluation. |
| AC-9: Dated decision entry | Met | Added decision with default rationale, Astra rejection, Luna trade-off/follow-up/rollback, prompt audit, and separate effort-tier follow-up. |
| AC-10: Build and goldens current | Met | Goldens regenerated; standard suite passes; fresh build updated both declared bundles. |

## Edge Cases Considered

- Preserved the exact leading/trailing edges of `CODEX_STARTUP`; resume stripping is explicitly tested on three prompt types.

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
> A `Fail` row whose cause lies outside this task's diff: name the result `Fail – unrelated` explicitly, and Notes must cite a specific file reference outside this task's affected files (a sibling worktree path, a fixed-port test's own file, an unrelated spec's path) — the code reviewer only accepts `Fail – unrelated` when Notes names such a reference credibly. Pre-flight's own check is textual — naming a changed file in that row, even to say it passed, can reclassify the whole row as task-owned and reject the handoff. Don't rely on an unqualified filename escaping the check; keep Notes free of any path from this task's diff.
> Record every check in spec.md's Validation Required section here, plus any extra checks you ran. Required checks should not be marked `N/A` or `not_configured` — run the check or adjust the spec; the code reviewer verifies coverage against the spec. The `Check` cell is for human readability (the pre-flight gate no longer string-matches it against the spec), so write whatever names the check clearly — but keep a check's label identical across a baseline row and any later `### Re-run validation` row so its result updates in place.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `UPDATE_GOLDENS=1 npm test` | Pass | 1,222 passed, 1 skipped; regenerated prompt snapshots. |
| `npm test` | Pass | 1,222 passed, 1 skipped. |
| `npm run build` | Pass | Fresh build updated `dist/cli/index.js` and `dist/orchestrator/run-task.js`. |
| E2E | N/A | Spec explicitly marks E2E N/A for this repo. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

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
