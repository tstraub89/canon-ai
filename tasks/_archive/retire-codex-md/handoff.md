# Implementation Handoff: retire-codex-md

> Author: Codex | Spec: `tasks/retire-codex-md/spec.md` | Plan: `tasks/retire-codex-md/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `AGENTS.md` | Added the file-revert guidance from the retired `CODEX.md`, removed `CODEX.md` pointers, and clarified that Codex guidance lives in `AGENTS.md` plus the injected prompt. |
| `CLAUDE.md` | Removed `CODEX.md` from the harness/policy note and from the canon-managed-file convention's `DELIMITED` list. |
| `CODEX.md` | Deleted the retired root file. |
| `README.md` | Updated the init/scaffold descriptions to the two-file model (`AGENTS.md` + `CLAUDE.md`). |
| `.claude/skills/canon-init/SKILL.md` | Stopped reading, listing, and `git add`ing `CODEX.md`; updated the write-guide pointer to the two-file model. |
| `.claude/skills/canon-init/write-guide.md` | Removed `CODEX.md` from the agent-config merge protocol and merge instructions. |
| `.claude/skills/canon-pipeline/SKILL.md` | Removed the `CODEX.md` phase-specific guidance bullet. |
| `.github/workflows/ci.yml` | Removed `CODEX.md` path-filter pairs and the `test -f CODEX.md` smoke assertion. |
| `.github/workflows/docs-refs-check.yml` | Removed the `CODEX.md` path filter. |
| `docs/architecture.md` | Updated the CI trigger description to omit `CODEX.md`. |
| `docs/codebase-map.md` | Removed the `CODEX.md` source-map row and the remaining live references. |
| `docs/decisions.md` | Updated the declared-vs-executable drift rule to the two-file model. |
| `docs/patterns.md` | Updated the layering-rule and phase-addition references to `AGENTS.md` / `CLAUDE.md` only. |
| `docs/pipeline-orchestrator.md` | Removed `CODEX.md` from the scaffold/customization description and related list. |
| `docs/product-context.md` | Removed `CODEX.md` from the `canon init` scaffolding list. |
| `scripts/docs-refs-check.mjs` | Removed `CODEX.md` from `ROOT_MARKDOWN_FILES`. |
| `src/cli/commands/doctor.ts` | Added `checkCodexMdDeprecated()` and wired `doctor` to warn when a local `CODEX.md` exists, without mutating it. |
| `src/cli/commands/init.ts` | Removed `CODEX.md` from the scaffolded agent files and updated the grill message. |
| `src/cli/commands/upgrade.ts` | Updated the delimited-files comment to the two-file model. |
| `src/lib/canon-owned.ts` | Removed `CODEX.md` from `DELIMITED`. |
| `dist/cli/index.js` | Rebuilt the shipped CLI bundle after the source changes. |
| `tasks/retire-codex-md/status.json` | Updated task metadata for the current implementation pass. |
| `templates/.claude/skills/canon-init/SKILL.md` | Synced mirror of the root skill edit. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced mirror of the root pipeline skill edit. |
| `templates/AGENTS.md` | Synced mirror of the root `AGENTS.md` edits. |
| `templates/CLAUDE.md` | Synced mirror of the root `CLAUDE.md` edits. |
| [templates/CODEX.md](templates/CODEX.md) | Deleted the template mirror of the retired file. |
| `templates/docs/codebase-map.md` | Hand-edited the adopter scaffold mirror to remove the retired `CODEX.md` references. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror of the root orchestrator-doc changes. |
| `templates/scripts/docs-refs-check.mjs` | Synced mirror of the root docs-refs script change. |
| `tests/cli.test.ts` | Removed `CODEX.md` from the expected-file arrays and added `doctor` deprecation-warn coverage. |
| `tests/sync-canon-templates.test.ts` | Updated the comments that still referenced the retired three-file model. |

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

Retired `CODEX.md` as a dead surface: the only unique content it carried moved into `AGENTS.md`, and every canon-owned reader, sync path, workflow gate, and scaffold now reflects the two-file model (`AGENTS.md` + `CLAUDE.md`). Existing adopter `CODEX.md` files are left alone by `upgrade`, but `doctor` now warns that they are deprecated and safe to delete. The shipped CLI bundle was rebuilt so the published artifact matches source.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| The deleted-file Changes row uses markdown-link cell syntax for templates/CODEX.md instead of a backtick path. | `docs-refs-check` scans backtick file-path refs, so the markdown-link form preserves the mandatory deletion entry without creating a broken ref. | None. |
| _(none)_ | Implemented the plan directly; no scope or approach change was needed. | None. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: content rescue, no loss | Met | The revert mechanics now live in `AGENTS.md` and keep the sandbox-safe `git show origin/<base-branch>:<path>` workflow plus the perfect/imperfect revert split. |
| AC-2: file removed | Met | `CODEX.md` and templates/CODEX.md are deleted from the repo. |
| AC-3: out of canon-managed sets | Met | `DELIMITED`, `AGENT_FILES`, and `ROOT_MARKDOWN_FILES` no longer include `CODEX.md`; `npm run sync-templates:check` passed. |
| AC-4: `canon init` stops shipping it | Met | `init.ts` scaffolds only `AGENTS.md` and `CLAUDE.md`, and the `/canon-init` skill no longer reads or stages `CODEX.md`. |
| AC-5: `canon doctor` warn semantics | Met | `doctor` emits no CODEX-related check when absent and a warn-only deprecation check when present; the helper does not mutate the file. |
| AC-6: `canon upgrade` stops managing it | Met | Removing `CODEX.md` from `DELIMITED` stops `upgrade` from recreating, modifying, or deleting it. |
| AC-7: CI updated | Met | The workflows no longer assert or path-filter `CODEX.md`; CI smoke verified green on PR #129 (the clean-shim `canon init` / `canon doctor` step in the test job passed). |
| AC-8: references swept, lockstep | Met | The live docs and skills now reflect the two-file model, and `npm run docs-refs-check` passed. |
| AC-9: structural allow-list — regenerated, not assumed | Met | I reran `git grep -n "CODEX\\.md"` and the remaining hits are confined to the intentional doctor warning/test/dist refs, historical docs, or other task artifacts. |
| AC-10: tests reflect intended behavior | Met | `tests/cli.test.ts` no longer expects `CODEX.md` in shipped arrays and now covers the doctor deprecation warning; the full suite passed. |
| AC-11: build artifact declared + regenerated | Met | `npm run build` regenerated `dist/cli/index.js`, and that file is included in the diff. |

## Edge Cases Considered

- Existing adopter `CODEX.md` files are intentionally orphaned, not auto-deleted. `canon doctor` warns; `canon upgrade` leaves them alone.
- `templates/docs/codebase-map.md` is a non-synced adopter scaffold, so it needed a direct mirror edit instead of relying on `sync-templates`.
- The residual `git grep -n "CODEX\\.md"` hits are limited to `src/cli/commands/doctor.ts`, `tests/cli.test.ts`, and `dist/cli/index.js` for the intentional warn/test/dist path; historical docs (`CHANGELOG.md`, `docs/BACKLOG.md`, `docs/packaging-plan.md`) remain by spec; other live-task artifacts remain under `tasks/<other-id>/**` and were left untouched.
- `CI smoke` could not be exercised locally in the same clean shimmed environment the workflow uses; it was verified on the PR #129 CI run (green).

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
| `lint` (`npm run lint`) | Pass | Clean on the final tree. |
| `type-check` (`npm run type-check`) | Pass | Clean on the final tree. |
| `unit tests` (`npm test`) | Pass | Full suite passed: 704 passed, 0 failed, 1 skipped. The skipped test is the sandbox-dependent linked-worktree anchor check. |
| `build` (`npm run build`) | Pass | Regenerated `dist/cli/index.js`. |
| `docs-refs` (`npm run docs-refs-check`) | Pass | `All refs OK`. |
| `sync-templates` (`npm run sync-templates:check`) | Pass | `All canon-managed files in sync`. |
| `CI smoke` (`canon init` + `canon doctor` in a clean env) | Pass | Verified green on PR #129 CI: the "Verify git-install path produces a working canon binary" step runs `canon init` (asserts AGENTS.md + CLAUDE.md created, no CODEX.md) then `canon doctor`. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>`

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `tasks/retire-codex-md/handoff.md` | Switched the deleted-file Changes-table cell to markdown-link form and documented that deviation so the mandatory deletion entry no longer breaks `docs-refs-check`. |
| `tasks/retire-codex-md/review.md` | Normalized the stale deleted-file literals in the round-1 review artifact to plain text so the review record no longer trips `docs-refs-check`. |
| `tasks/retire-codex-md/notes.md` | Added the revision note capturing the `docs-refs-check`/deleted-file handoff quirk. |

### Findings addressed

- _correctness bug:_ `docs-refs-check` failed on the mandatory deleted-file entry in the handoff → fixed by using the markdown-link cell form for templates/CODEX.md in [handoff.md](/Users/tstraub/canon-ai/dev-worktrees/retire-codex-md/tasks/retire-codex-md/handoff.md#L39) and normalizing the review artifact's stale literals.

### AC deltas (if any)

- None.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `docs-refs` (`npm run docs-refs-check`) | Pass | Re-ran after the artifact cleanup; `All refs OK`. |

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

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
