# Implementation Handoff: adopter-agent-file-redesign

> Author: Codex | Spec: `tasks/adopter-agent-file-redesign/spec.md` | Plan: `tasks/adopter-agent-file-redesign/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `.claude/skills/canon-init/SKILL.md` | Dropped the agent-file read instruction, kept the adopter-owned detection note, and pointed the related reference at built-in `/init`. |
| `.claude/skills/canon-init/write-guide.md` | Reworded the adopter-owned agent-file section so it no longer tells canon to read or rewrite adopter agent files. |
| `.claude/skills/canon-pipeline/SKILL.md` | Removed the stale `CLAUDE.md` operator-context reference from the related list. |
| `.claude/skills/canon-spec-review/SKILL.md` | Removed the stale `CLAUDE.md` operator-context reference from the related list. |
| `.claude/skills/canon-spec/SKILL.md` | Removed `AGENTS.md` / `CLAUDE.md` load instructions, kept the Validation Matrix pointer, and dropped the stale related reference. |
| `AGENTS.md` | Rewritten as the shared project overview: roles, shared cross-review / communication norms, pipeline phases, commands, conventions, deeper-doc map, and operational notes. |
| `CLAUDE.md` | Reduced to `@AGENTS.md` plus the four conversational operator norms. |
| `README.md` | Reframed the bootstrap story around built-in `/init`, updated the discovery nudge guidance, and removed stale canon-owns-agent-file language. |
| `dist/cli/index.js` | Rebuilt the CLI help text to point reroute users at `docs/pipeline-orchestrator.md`. |
| `dist/scripts/run-task.js` | Rebuilt the run-task banner text to point reroute users at `docs/pipeline-orchestrator.md`. |
| `docs/codebase-map.md` | Updated the Claude-guide row, the protected-docs preamble, and the doctor summary to match the new agent-file and JIT-rule story. |
| `docs/decisions.md` | Corrected the existing vacate decision text and added the new decision that agent files come from built-in `/init`, not canon scaffolding. |
| `docs/patterns.md` | Reworded the layering / pitfall guidance to match the auto-load + JIT model and repointed the lint/type-safety trigger cell. |
| `docs/pipeline-orchestrator.md` | Clarified that the pipeline reads the protected `docs/*` corpus and JIT guidance, not adopter agent files. |
| `docs/product-context.md` | Reframed the product story so agent files are adopter-owned `/init` output, not canon-managed rule homes. |
| `scripts/run-task/cli.ts` | Repointed the reroute usage banner at `docs/pipeline-orchestrator.md`. |
| `src/cli/commands/doctor.ts` | Added the absent-files `/init` warning branch while keeping the silent-files warn path and pass path unchanged. |
| `src/cli/commands/init.ts` | Reworded the existing-agent-file notice to say adopter-owned / no-read instead of project-context read semantics. |
| `src/cli/index.ts` | Repointed the reroute help text at `docs/pipeline-orchestrator.md`. |
| `tasks/adopter-agent-file-redesign/notes.md` | Appended the validation note about using `WORKTREE_ROOT` for root-file assertions in linked-worktree runs. |
| `tasks/adopter-agent-file-redesign/status.json` | Advanced the task metadata from implement in-progress to code_review when the implement phase closed. |
| `templates/.claude/skills/canon-init/SKILL.md` | Mirrored the root `canon-init` skill change. |
| `templates/.claude/skills/canon-init/write-guide.md` | Mirrored the root `canon-init` write-guide change. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirrored the root `canon-pipeline` skill change. |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Mirrored the root `canon-spec-review` skill change. |
| `templates/.claude/skills/canon-spec/SKILL.md` | Mirrored the root `canon-spec` skill change. |
| `templates/docs/pipeline-orchestrator.md` | Mirrored the orchestrator-doc clarification about the protected `docs/*` corpus and JIT guidance. |
| `tests/cli.test.ts` | Updated the doctor/init assertions, added a root `AGENTS.md` / `CLAUDE.md` split test, and fixed that test to read the active worktree root instead of `REPO_ROOT`. |

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

Canon now treats adopter agent files as built-in `/init` output instead of canon-managed surfaces. The shared overview moved into `AGENTS.md`, `CLAUDE.md` became a thin Claude-only addendum, and the surrounding docs, skills, banners, and tests now say the same thing. The `doctor` and `init` command changes keep the runtime guidance aligned with that story, while the build output and template mirrors keep the shipped artifacts and sync checks consistent.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Repointed the reroute help/banner citations to `docs/pipeline-orchestrator.md` instead of the older section title used in the plan. | That is the current source of truth for reroute mechanics, so the runtime pointer now lands in the right doc. | None |
| Added a root-file regression test in `tests/cli.test.ts` and made it read `WORKTREE_ROOT` instead of `REPO_ROOT`. | The linked-worktree test run exposed the supervising-checkout trap, and the new test is what verifies the audience split in the active checkout. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: strip the remaining `AGENTS.md` / `CLAUDE.md` references so only allow-listed operational, decision, test, and owner descriptions survive | Met | Ran the structural grep over the full tree and rewrote the non-allow-listed references in docs, skills, and runtime banners. |
| AC-2: reframe prose that still implies agent files are canon rule-homes or pipeline read targets | Met | Updated `README.md`, `docs/product-context.md`, `docs/patterns.md`, and `docs/pipeline-orchestrator.md` to the auto-load + JIT model. |
| AC-3: scope `/canon-init` to the docs corpus and stop claiming it generates or reads agent files | Met | Corrected the `canon-init` skill, write guide, and README to point to built-in `/init` for agent-file creation. |
| AC-4: README recommends built-in `/init` and documents the optional `CLAUDE.md = @AGENTS.md` consolidation | Met | README now tells adopters to generate agent files with built-in `/init`; the existing nudge drift test still passes. |
| AC-5: `checkCanonDiscoveryNudge` has distinct warn states for absent files vs. silent files | Met | `src/cli/commands/doctor.ts` now warns with `/init` guidance when neither file exists, and the tests cover both warn branches plus the pass branch. |
| AC-6: canon-ai dogfoods the audience split, with shared overview in `AGENTS.md` and Claude-only norms in `CLAUDE.md` | Met | Rewrote both root files and added a test that asserts the split in the active worktree. |

## Edge Cases Considered

- The linked-worktree test harness still points `REPO_ROOT` at the supervising checkout, so the new root-agent-file assertion had to read `WORKTREE_ROOT` instead.
- `sync-templates:check` validates the hidden `templates/.claude/skills/*` mirrors as well as the visible `templates/docs/*` mirrors, so both copies had to stay in sync.
- `dist/` is tracked here, so the build output for the CLI help/banner changes needed to be rebuilt and kept in the diff.

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
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Re-ran after the final test fix and root-agent-file rewrite. |
| `type-check` (`npm run type-check`) | Pass | Re-ran after the final test fix and root-agent-file rewrite. |
| `unit tests` (`npm test`) | Pass | Final suite passed after fixing the root-file assertion to read `WORKTREE_ROOT`. |
| `build` (`npm run build`) | Pass | Rebuilt the tracked `dist/` bundles for the CLI/help-banner changes. |
| `docs-refs` (`npm run docs-refs-check`) | Pass | Clean after the doc/skill reference sweep. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | Clean after syncing the root skills and their mirrors. |
| `E2E` — N/A: no UI/runtime surface. | not_configured | Spec marks this as not applicable. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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
| `.claude/skills/canon-init/SKILL.md` | Removed the dangling claim that `write-guide.md` covers how to use adopter-owned agent files as context. |
| `templates/.claude/skills/canon-init/SKILL.md` | Mirrored the root `canon-init` cross-reference fix. |

### Findings addressed

- _correctness bug:_ dangling Phase 4 cross-reference to removed adopter-agent-file guidance in `canon-init` → fixed at `.claude/skills/canon-init/SKILL.md:108` and `templates/.claude/skills/canon-init/SKILL.md:108`

### AC deltas (if any)

- None. AC-3 remained Met; this was a pointer-cleanup regression in the shipped skill text.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `docs-refs` (`npm run docs-refs-check`) | Pass | Passed after removing the stale handoff section-title suffix that tripped the docs ref parser. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | Root skill and template mirror stayed aligned. |

## Iteration 3 — addressing human-review amendment round 1

### Changes

| File | What Changed |
|---|---|
| `AGENTS.md` | Added the canon opener, the stack signal, the managed-set caveat, the `src/lib/canon-owned.ts` pointer, and the `docs/release-process.md` pointer. |
| `README.md` | Added the built-in `/init` agent-file recommendation with optional `CLAUDE.md = @AGENTS.md` consolidation guidance and the deeper-doc pointer list. |
| `tests/cli.test.ts` | Added assertions for the new AGENTS opener, stack line, managed-set caveat, canon-owned pointer, release-process pointer, and README consolidation / deeper-doc guidance. |

### Findings addressed

- _spec gap:_ A1 README consolidation guidance was absent even though the earlier pass had marked AC-4 met → added the `@AGENTS.md` consolidation block in `README.md` and re-grepped it.
- _spec gap:_ A2 opener lacked the product / stack / self-hosting orientation → added the opening canon description in `AGENTS.md`.
- _spec gap:_ A3 managed-set caveat was missing → restored the note that `AGENTS.md` / `CLAUDE.md` are not managed and need no sync.
- _spec gap:_ A4 stack signal was missing → added the npm command one-liner in `AGENTS.md`.
- _spec gap:_ A5 release-process pointer was missing → added `docs/release-process.md` to the deeper-doc map.
- _spec gap:_ A6 canon-owned pointer was missing → restored the `src/lib/canon-owned.ts` pointer.

### AC deltas (if any)

- A1: new amendment AC, now Met
- A2: new amendment AC, now Met
- A3: new amendment AC, now Met
- A4: new amendment AC, now Met
- A5: new amendment AC, now Met
- A6: new amendment AC, now Met

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Re-ran after the amendment edits. |
| `type-check` (`npm run type-check`) | Pass | Re-ran after the amendment edits. |
| `unit tests` (`npm test`) | Pass | Re-ran after the amendment edits; includes the new README/AGENTS assertions. |
| `build` (`npm run build`) | Pass | Re-ran after the amendment edits. |
| `docs-refs` (`npm run docs-refs-check`) | Pass | Re-ran after the amendment edits. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | Re-ran after the amendment edits. |
| `A1 grep` (`git grep -n '@AGENTS\\.md' README.md`) | Pass | Confirms the consolidation guidance appears in README beyond the discovery-nudge block. |
| `AC-1 strip grep` (`git grep -nE 'AGENTS\\.md|CLAUDE\\.md' -- AGENTS.md README.md`) | Pass | Confirmed the new opener didn’t reintroduce read/rule-home framing. |

## Iteration 4 — addressing review round 3

### Changes

| File | What Changed |
|---|---|
| `tests/cli.test.ts` | Strengthened the AGENTS/CLAUDE audience-split test to assert the four operator norm texts are absent, not just the retired section heading. |

### Findings addressed

- _correctness bug:_ the AGENTS audience-split test only guarded the old `Always-On Operator Norms` heading and could miss a reintroduced operator norm string → added four `doesNotMatch` assertions for the actual norm texts in `tests/cli.test.ts`.

### AC deltas (if any)

- AC-6: the test now verifies the absence of the four operator norms themselves, not just the retired heading; content was already correct, but the regression guard is now complete.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Re-ran after the test coverage tightening. |
| `type-check` (`npm run type-check`) | Pass | Re-ran after the test coverage tightening. |
| `unit tests` (`npm test`) | Pass | Re-ran after the test coverage tightening. |
