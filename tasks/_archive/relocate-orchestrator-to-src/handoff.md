# Implementation Handoff: relocate-orchestrator-to-src

> Author: Codex | Spec: `tasks/relocate-orchestrator-to-src/spec.md` | Plan: `tasks/relocate-orchestrator-to-src/plan.md`
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
| [scripts/run-task/canon-snapshot.ts](scripts/run-task/canon-snapshot.ts), `src/orchestrator/canon-snapshot.ts` | Relocated orchestrator module. |
| [scripts/run-task/check-phase-gate.ts](scripts/run-task/check-phase-gate.ts), `src/orchestrator/check-phase-gate.ts` | Relocated the manual phase-gate entry point unchanged. |
| [scripts/run-task/cli.ts](scripts/run-task/cli.ts), `src/orchestrator/cli.ts` | Relocated orchestrator module. |
| [scripts/run-task/context.ts](scripts/run-task/context.ts), `src/orchestrator/context.ts` | Relocated orchestrator module. |
| [scripts/run-task/detach.ts](scripts/run-task/detach.ts), `src/orchestrator/detach.ts` | Relocated module and updated its source-path header. |
| [scripts/run-task/env.ts](scripts/run-task/env.ts), `src/orchestrator/env.ts` | Relocated module and corrected the policy-matrix operator hint while preserving the two-level repo-root fallback. |
| [scripts/run-task/git.ts](scripts/run-task/git.ts), `src/orchestrator/git.ts` | Relocated orchestrator module. |
| [scripts/run-task/heartbeat.ts](scripts/run-task/heartbeat.ts), `src/orchestrator/heartbeat.ts` | Relocated module and updated its source-path header. |
| [scripts/run-task/main.ts](scripts/run-task/main.ts), `src/orchestrator/main.ts` | Relocated the orchestrator core and updated internal path comments only. |
| [scripts/run-task/markdown-table.ts](scripts/run-task/markdown-table.ts), `src/orchestrator/markdown-table.ts` | Relocated orchestrator module. |
| [scripts/run-task/metrics.ts](scripts/run-task/metrics.ts), `src/orchestrator/metrics.ts` | Relocated module and aligned the generated metrics header with the live artifact. |
| [scripts/run-task/policy.ts](scripts/run-task/policy.ts), `src/orchestrator/policy.ts` | Relocated module and re-pointed the shared policy import. |
| [scripts/run-task/quality-log.ts](scripts/run-task/quality-log.ts), `src/orchestrator/quality-log.ts` | Relocated module and re-pointed its type-only policy import. |
| [scripts/run-task/review-loop.ts](scripts/run-task/review-loop.ts), `src/orchestrator/review-loop.ts` | Relocated orchestrator module. |
| [scripts/run-task/run-context.ts](scripts/run-task/run-context.ts), `src/orchestrator/run-context.ts` | Relocated orchestrator module. |
| [scripts/run-task/signals.ts](scripts/run-task/signals.ts), `src/orchestrator/signals.ts` | Relocated module and updated entry-point comments. |
| [scripts/run-task/state.ts](scripts/run-task/state.ts), `src/orchestrator/state.ts` | Relocated orchestrator module. |
| [scripts/run-task/types.ts](scripts/run-task/types.ts), `src/orchestrator/types.ts` | Relocated module and re-pointed its type-only policy import. |
| [scripts/run-task/validation.ts](scripts/run-task/validation.ts), `src/orchestrator/validation.ts` | Relocated orchestrator module. |
| [scripts/run-task/worktree.ts](scripts/run-task/worktree.ts), `src/orchestrator/worktree.ts` | Relocated orchestrator module. |
| [scripts/run-task/agents/claude.ts](scripts/run-task/agents/claude.ts), `src/orchestrator/agents/claude.ts` | Relocated agent runner. |
| [scripts/run-task/agents/codex.ts](scripts/run-task/agents/codex.ts), `src/orchestrator/agents/codex.ts` | Relocated agent runner and updated its policy error path. |
| [scripts/run-task/agents/stream.ts](scripts/run-task/agents/stream.ts), `src/orchestrator/agents/stream.ts` | Relocated agent stream helper and corrected the signal-module comment. |
| [scripts/run-task/phases/code-review.ts](scripts/run-task/phases/code-review.ts), `src/orchestrator/phases/code-review.ts` | Relocated phase handler and re-pointed its task helper import. |
| [scripts/run-task/phases/implement.ts](scripts/run-task/phases/implement.ts), `src/orchestrator/phases/implement.ts` | Relocated phase handler, re-pointed its task helper import, and updated its source-path comment. |
| [scripts/run-task/phases/plan.ts](scripts/run-task/phases/plan.ts), `src/orchestrator/phases/plan.ts` | Relocated phase handler and re-pointed its task helper import. |
| [scripts/run-task/phases/qa.ts](scripts/run-task/phases/qa.ts), `src/orchestrator/phases/qa.ts` | Relocated phase handler and re-pointed its task helper import. |
| [scripts/run-task/phases/spec-review.ts](scripts/run-task/phases/spec-review.ts), `src/orchestrator/phases/spec-review.ts` | Relocated phase handler and re-pointed its task helper import. |
| [scripts/run-task/phases/spec.ts](scripts/run-task/phases/spec.ts), `src/orchestrator/phases/spec.ts` | Relocated phase handler and re-pointed its task helper import. |
| [scripts/run-task/prompts/helpers.ts](scripts/run-task/prompts/helpers.ts), `src/orchestrator/prompts/helpers.ts` | Relocated prompt helper. |
| [scripts/run-task/prompts/index.ts](scripts/run-task/prompts/index.ts), `src/orchestrator/prompts/index.ts` | Relocated prompt builder. |
| [scripts/run-task/prompts/md-modules.d.ts](scripts/run-task/prompts/md-modules.d.ts), `src/orchestrator/prompts/md-modules.d.ts` | Relocated Markdown module declaration. |
| [scripts/run-task/prompts/render.ts](scripts/run-task/prompts/render.ts), `src/orchestrator/prompts/render.ts` | Relocated prompt renderer. |
| [scripts/run-task/prompts/templates/code-review-foreman.md](scripts/run-task/prompts/templates/code-review-foreman.md), `src/orchestrator/prompts/templates/code-review-foreman.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/implement-reroute.md](scripts/run-task/prompts/templates/implement-reroute.md), `src/orchestrator/prompts/templates/implement-reroute.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/implement-revisions.md](scripts/run-task/prompts/templates/implement-revisions.md), `src/orchestrator/prompts/templates/implement-revisions.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/implement.md](scripts/run-task/prompts/templates/implement.md), `src/orchestrator/prompts/templates/implement.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/plan-reroute.md](scripts/run-task/prompts/templates/plan-reroute.md), `src/orchestrator/prompts/templates/plan-reroute.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/plan.md](scripts/run-task/prompts/templates/plan.md), `src/orchestrator/prompts/templates/plan.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/qa.md](scripts/run-task/prompts/templates/qa.md), `src/orchestrator/prompts/templates/qa.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/spec-review-reroute.md](scripts/run-task/prompts/templates/spec-review-reroute.md), `src/orchestrator/prompts/templates/spec-review-reroute.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/spec-review.md](scripts/run-task/prompts/templates/spec-review.md), `src/orchestrator/prompts/templates/spec-review.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/spec-revision.md](scripts/run-task/prompts/templates/spec-revision.md), `src/orchestrator/prompts/templates/spec-revision.md` | Relocated prompt template unchanged. |
| [scripts/run-task/prompts/templates/spec.md](scripts/run-task/prompts/templates/spec.md), `src/orchestrator/prompts/templates/spec.md` | Relocated prompt template unchanged. |
| [scripts/run-task.ts](scripts/run-task.ts), `src/orchestrator/run-task.ts` | Relocated the entry point into the module tree and re-pointed its sibling imports. |
| [scripts/pipeline-policy.ts](scripts/pipeline-policy.ts), `src/lib/pipeline-policy.ts` | Relocated the pure shared policy module alongside the other shared library modules. |
| `tsup.config.ts`, `tsconfig.json`, `package.json` | Re-pointed the build entry, narrowed TypeScript includes, and limited packaged tooling to the postinstall script. |
| `src/cli/commands/run-task.ts`, `src/cli/commands/doctor.ts`, `src/cli/commands/watch.ts`, `src/cli/commands/stop.ts`, `src/cli/commands/update.ts`, `src/task/index.ts` | Re-pointed the runtime spawn bridge and all importers outside the moved tree. |
| `scripts/sync-canon-templates.mjs` | Moved the internal-path prefix and template discovery to the new orchestrator subtree. |
| `scripts/docs-refs-check.mjs`, `templates/scripts/docs-refs-check.mjs` | Updated the source-path comment and regenerated its canon-managed mirror. |
| `scripts/normalize-dist-paths.mjs` | Updated the worktree source reference and corrected its stale line number. |
| `docs/codebase-map.md`, `docs/patterns.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/product-context.md`, `docs/harness-audit-2026-06.md`, `docs/BACKLOG.md`, `README.md`, `.canon/hooks/README.md` | Swept documentation references, corrected the authored architecture passages, aligned the diagram, and closed the backlog item. |
| `.github/workflows/ci.yml`, `.github/pull_request_template.md` | Re-pointed the installed-package smoke test and simplified the build checklist. |
| `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-harness.test.ts`, `tests/sync-canon-templates.test.ts`, `tests/run-task-signals.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-canon-snapshot.test.ts`, `tests/run-task-ship.test.ts`, `tests/cli.test.ts`, `tests/run-task-counter-schema.test.ts`, `tests/run-task-parse-porcelain.test.ts`, `tests/task-cli.test.ts`, `tests/watch.test.ts`, `tests/detach.test.ts`, `tests/md-loader-register.mjs`, `tests/pipeline-policy.test.ts`, `tests/run-task-quality-log.test.ts`, `tests/heartbeat.test.ts`, `tests/markdown-table.test.ts`, `tests/run-context.test.ts`, `tests/run-task-cli.test.ts`, `tests/run-task-extract-verdict.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/stop.test.ts`, `tests/validation-matrix-sync.test.ts` | Re-pointed imports and fixture paths; added the exact eight-member non-empty internal-template discovery regression. |
| `dist/cli/index.js` | Rebuilt the CLI bundle with relocated source paths and spawn target. |
| [dist/scripts/run-task.js](dist/scripts/run-task.js), `dist/orchestrator/run-task.js` | Rebuilt the orchestrator bundle at its new published path. |

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

Relocated the shipped orchestrator into `src/orchestrator/` without changing its control flow, and moved the pure routing policy into `src/lib/`. All source import edges, runtime string bridges, fixture paths, package/build configuration, generated bundles, and current documentation now use the new layout. The internal-template discovery assertion pins the verified eight-file baseline so a future missing directory cannot silently disable the leak gate.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Used filesystem moves rather than `git mv`. | The pipeline owns the Git index and explicitly forbids agent staging; plain moves preserve content and Git can detect the renames when the orchestrator stages them. | None; both rename sides are declared and the dirty/spec reconciliation is exact. |
| Added an implementation amendment for `tests/run-task-ship.test.ts`. | The resumed implementation instruction authorized finishing the previously blocked path-only fixture update; the original manifest omitted its split-token old path. | Restores AC-4 and keeps Gate 3's allow-list complete. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Old source paths and `dist/scripts/` are absent; `scripts/` contains exactly the six allowed tooling files. |
| AC-2 | Met | All four retired literal families return zero hits outside the named buckets; the preserved `stop.ts:32` regex line is unchanged. |
| AC-3 | Met | The fallback expression is unchanged, the two-level layout is preserved, and direct bundle help exits 0. |
| AC-4 | Met | Full suite passes after the authorized path-only ship fixture update. |
| AC-5 | Met | Gate prefix/directory moved; exact non-empty eight-template regression passes; template sync is clean. |
| AC-6 | Met | `node dist/cli/index.js run --help` reaches orchestrator usage and exits 0. |
| AC-7 | Met | Dry-run package contents include exactly `scripts/install-git-hooks.mjs`, no other `scripts/` file, and no raw orchestrator TypeScript. |
| AC-8 | Met | Docs reference gate passes. |
| AC-9 | Met | Build-contract and leak-gate decision passages were rewritten for subtree specificity. |
| AC-10 | Met | The orchestrator diagram box is aligned to 77 characters on every row. |
| AC-11 | Met | Hook dispatch, policy hint, and metrics header references now name their actual owners. |
| AC-12 | Met | Backlog references were swept and the migration item is checked complete with the task/version pointer. |
| AC-13 | Met | The docs-ref checker mirror was regenerated and byte-matches its source. |
| AC-14 | Met | Spec parser reports 145 files, zero malformed rows, all 94 rename sides, and the source dirty set matches it exactly. |
| AC-15 | Met | Zero old policy specifiers and exactly three new specifiers in the moved tree; type-check passes. |

## Edge Cases Considered

- Preserved `resolveRepoRoot()`'s exact `path.resolve(__dirname, '../..')` fallback and verified both source and bundle stay two levels deep.
- Updated string-generated subprocess fixtures, escaped-path assertions, and worktree-local test paths that static TypeScript resolution cannot protect.
- Verified the template leak gate against the exact eight-name baseline rather than only checking one representative member.
- Confirmed the generated build removes the old bundle directory and remains idempotent on a second build.
- Used a task-scoped npm cache for the package dry run after the host cache refused writes.

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
| `npm run lint` | Pass | Final run clean. |
| `npm run type-check` | Pass | Final run clean; covers erased type-only policy imports. |
| `npm test` | Pass | 1,147 passed, 1 skipped, 0 failed after the authorized ship fixture path update. |
| `npm run build` | Pass | Idempotent rebuild emitted only the two expected bundles; `dist/scripts/` remained absent. |
| `npm run sync-templates:check` | Pass | All managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `node dist/orchestrator/run-task.js --help` | Pass | Exit 0 with orchestrator usage. |
| Built CLI spawn bridge | Pass | `node dist/cli/index.js run --help` reached the same usage and exited 0. |
| `npm pack --dry-run --json` | Pass | Task-scoped cache used; exactly one packaged `scripts/` file and zero raw orchestrator TypeScript files. |
| `parseAffectedFilesFromSpec` | Pass | 145 files, zero malformed cells, all 94 rename-side paths present. |
| Dirty tree vs. spec manifest | Pass | 145 source dirty paths; zero outside spec and zero declared-but-clean paths. |
| AC-2 structural searches | Pass | Zero results for all four retired literal families outside permitted buckets. |
| AC-15 policy import search | Pass | Zero old specifiers; exactly three new specifiers. |

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

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Resolve the linked-worktree regression module from the active checkout while preserving the supervising-root assertion. |
| `tests/cli.test.ts` | Scan adopter-shipped bundles from `WORKTREE_ROOT` and fail closed when any declared shipped path is absent. |
| `tests/run-task-harness.test.ts` | Declared the Iteration 1 root-resolution mechanism change: loader, inline-import, and subprocess paths intentionally use the active checkout so worktree tests exercise this task's code. No additional source edit in this iteration. |
| `src/orchestrator/agents/stream.ts` | Use the repo-root-relative signal-module comment form; the required rebuild produced no additional bundle-byte delta. |
| `docs/BACKLOG.md` | Correct the prompt-template packaging claim: templates are bundled into the orchestrator artifact rather than shipped as raw source entries. |

### Findings addressed

- _correctness bug (CB-1):_ the linked-worktree regression loaded `env.ts` from the supervising checkout → module URL now starts at `process.cwd()` in `tests/run-task-safety.test.ts`.
- _correctness bug (CB-2):_ the adopter-leak guard skipped a missing relocated bundle → shipped paths now resolve from `WORKTREE_ROOT` and require existence in `tests/cli.test.ts`.
- _correctness bug (CB-3):_ the correct active-checkout mechanism change in `tests/run-task-harness.test.ts` was under-declared → explicitly declared above with its rationale; the full suite was rerun and its current result is recorded below.
- _risk/guardrail (RG-1):_ the signal-module comment used a grep-invisible file-relative form → changed to `src/orchestrator/signals.ts` and rebuilt the bundle.
- _risk/guardrail (RG-2):_ the backlog claimed raw prompt templates ship in the npm package → corrected to the verified bundled-artifact behavior.
- _pipeline artifact hygiene:_ Round 1 introduced nine checker-invalid backtick references in `review.md`, which broke both `docs-refs-check` and six full-suite subprocess cases. Changed only their carrier/path spelling (deleted paths to markdown links; live directory/file refs to valid slash/extension forms), without altering findings or verdict.
- _optional cleanup/nit:_ all optional items deferred to preserve the review's explicit four-file implementation scope.

### AC deltas (if any)

- AC-4: was Fail in Round 1 → now Met. The full suite exits 0; active-checkout module and bundle paths no longer read or skip the supervising checkout. The `.git`-writing linked-worktree case remains conditionally skipped in this sandbox, as designed, and is structurally re-pointed to `process.cwd()` for writable review/QA environments.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after both TypeScript test fixes and the source-comment correction. |
| `npm run type-check` | Pass | Clean. |
| `npm test` | Pass | 1,147 passed, 1 sandbox-conditional skip, 0 failed. The adopter-leak guard ran and passed; the linked-worktree case skipped because `.git` writes are restricted. |
| `npm run build` | Pass | Rebuilt both bundles after the source-comment correction. |
| `npm run docs-refs-check` | Pass | All refs OK after the formatting-only reviewer-artifact repair. |
| `node dist/orchestrator/run-task.js --help` | Pass | Exit 0 after the rebuild. |
| `parseAffectedFilesFromSpec` | Pass | 145 files and zero malformed cells. |

### Blockers

- None.
