# Implementation Handoff: canon-spec-review-rename

> Author: Codex | Spec: `tasks/canon-spec-review-rename/spec.md` | Plan: `tasks/canon-spec-review-rename/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| [.claude/skills/canon-spec-review/SKILL.md](.claude/skills/canon-spec-review/SKILL.md) | Renamed the skill from `canon-review` to `canon-spec-review` and updated the trigger text, H1, usage line, and report header. |
| [.claude/skills/canon-review/SKILL.md](.claude/skills/canon-review/SKILL.md) | Deleted the old live skill directory/file after the rename. |
| [.claude/skills/canon-init/SKILL.md](.claude/skills/canon-init/SKILL.md) | Updated the grant snippet to `Skill(canon-spec-review)` / `Skill(canon-spec-review:*)`. |
| [.claude/skills/canon-pipeline/SKILL.md](.claude/skills/canon-pipeline/SKILL.md) | Repointed the pre-pipeline review link to `/canon-spec-review`. |
| [.claude/skills/canon-spec/SKILL.md](.claude/skills/canon-spec/SKILL.md) | Repointed the pre-pipeline review link to `/canon-spec-review`. |
| [.claude/skills/canon-status/SKILL.md](.claude/skills/canon-status/SKILL.md) | Repointed the pre-flight review link to `/canon-spec-review`. |
| [.claude/settings.json](.claude/settings.json) | Swapped the local Claude permission grants to `Skill(canon-spec-review)` forms. |
| [README.md](README.md) | Renamed the user-facing skill catalog row, installed-skills prose, and allowlist grants to `canon-spec-review`. |
| [src/lib/canon-owned.ts](src/lib/canon-owned.ts) | Pointed `CANON_OWNED` at `.claude/skills/canon-spec-review/SKILL.md`. |
| [src/cli/commands/doctor.ts](src/cli/commands/doctor.ts) | Updated `skillNames` and `RECOMMENDED_ALLOW` to the renamed skill. |
| [CHANGELOG.md](CHANGELOG.md) | Added an `[Unreleased]` rename note with adopter cleanup guidance. |
| [docs/pipeline-invocations.md](docs/pipeline-invocations.md) | Auto-appended pipeline telemetry from this session's validation and phase-command runs. |
| [docs/pipeline-orchestrator.md](docs/pipeline-orchestrator.md) | Replaced the three `/canon-review` references with `/canon-spec-review`. |
| [docs/decisions.md](docs/decisions.md) | Updated the forward-looking backlog mention to `/canon-spec-review`. |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Updated the forward-looking `/canon-review` prose references to `/canon-spec-review`. |
| [tests/cli.test.ts](tests/cli.test.ts) | Updated the all-skills-present fixture to include `canon-spec-review`. |
| [dist/cli/index.js](dist/cli/index.js) | Rebuilt from source so the bundled allowlist, skill list, and CANON_OWNED entry match the rename. |
| [templates/.claude/skills/canon-spec-review/SKILL.md](templates/.claude/skills/canon-spec-review/SKILL.md) | New sync-generated mirror of the renamed skill. |
| [templates/.claude/skills/canon-review/SKILL.md](templates/.claude/skills/canon-review/SKILL.md) | Removed the orphaned old template mirror directory/file. |
| [templates/.claude/skills/canon-init/SKILL.md](templates/.claude/skills/canon-init/SKILL.md) | Re-synced mirror of the grant-snippet change. |
| [templates/.claude/skills/canon-pipeline/SKILL.md](templates/.claude/skills/canon-pipeline/SKILL.md) | Re-synced mirror of the cross-link change. |
| [templates/.claude/skills/canon-spec/SKILL.md](templates/.claude/skills/canon-spec/SKILL.md) | Re-synced mirror of the cross-link change. |
| [templates/.claude/skills/canon-status/SKILL.md](templates/.claude/skills/canon-status/SKILL.md) | Re-synced mirror of the cross-link change. |
| [templates/docs/pipeline-orchestrator.md](templates/docs/pipeline-orchestrator.md) | Re-synced mirror of the orchestrator doc rename references. |
| [tasks/canon-spec-review-rename/notes.md](tasks/canon-spec-review-rename/notes.md) | Appended an implement note about the orphaned template mirror deletion. |
| [tasks/canon-spec-review-rename/status.json](tasks/canon-spec-review-rename/status.json) | Recorded the implement→done phase transition. |
| [tasks/canon-spec-review-rename/handoff.md](tasks/canon-spec-review-rename/handoff.md) | Wrote the implementation handoff and validation record. |

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

Pure rename: replace the old `canon-review` skill name everywhere it is load-bearing, keep the behavior unchanged, and regenerate the derived mirrors and CLI bundle so shipped surfaces and health checks stay in lockstep. The orphaned old `templates/.claude/skills/canon-review/` mirror had to be removed explicitly because the sync tool only rewrites paths it knows about and does not prune orphaned directories.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: Skill renamed at source | Met | `.claude/skills/canon-spec-review/SKILL.md` now carries the new frontmatter name, trigger text, H1, usage line, and report header; `.claude/skills/canon-review/` is deleted. |
| AC-2: Manifest + templates mirror | Met | `src/lib/canon-owned.ts` now points at `.claude/skills/canon-spec-review/SKILL.md`; `npm run sync-templates:check` passes; the new template mirror exists and the orphaned old mirror is removed. |
| AC-3: doctor presence check | Met | `src/cli/commands/doctor.ts` checks for `canon-spec-review`, and `tests/cli.test.ts` now exercises the all-skills-present path with the renamed skill. |
| AC-4: Permission grant lockstep | Met | `src/cli/commands/doctor.ts`, `README.md`, and `.claude/settings.json` all carry `Skill(canon-spec-review)` / `Skill(canon-spec-review:*)`. |
| AC-5: README user-facing refs | Met | The README catalog row and installed-skills prose now say `/canon-spec-review`; the only remaining `canon-review` text is historical or task-local. |
| AC-6: dist rebuilt | Met | `npm run build` regenerated `dist/cli/index.js` with the renamed skill entries. _See the AC-6 ambiguity note in Blockers for the pre-commit `git diff --exit-code -- dist/` interpretation._ |
| AC-7: Shipped cross-references | Met | `.claude/skills/canon-init/SKILL.md`, `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-spec/SKILL.md`, `.claude/skills/canon-status/SKILL.md`, and `docs/pipeline-orchestrator.md` now point at `/canon-spec-review`; the matching templates were regenerated. |
| AC-8: Forward-looking dev docs + local settings | Met | `docs/decisions.md`, `docs/BACKLOG.md`, and `.claude/settings.json` now use the renamed skill. |
| AC-9: Structural grep gate | Met | `git grep -n 'canon-review'` returns only the allowed historical/task-local hits in `CHANGELOG.md` and `tasks/canon-spec-review-rename/**`. |
| AC-10: Adopter guidance in CHANGELOG | Met | `CHANGELOG.md` now includes the `[Unreleased]` rename note and the manual cleanup guidance for `.claude/skills/canon-review/`. |
| AC-11: Full validation green | Met | Lint, type-check, tests, build, sync-templates check, and docs-refs-check all passed. |

## Edge Cases Considered

- The orphaned `templates/.claude/skills/canon-review/` directory does not disappear on its own because sync is path-based and non-pruning.
- The README allowlist block and `RECOMMENDED_ALLOW` had to move together or the CLI test would fail.
- The dist bundle had to be rebuilt from source instead of hand-edited so the shipped CLI and the tests stay aligned.
- Historical `canon-review` mentions in `CHANGELOG.md` and the task-local artifacts are intentionally preserved by spec.

## Blockers

- [ambiguity] AC-6's `git diff --exit-code -- dist/` sentence is a CI/staging gate, not a pure source-to-bundle check. In this pre-commit worktree the exact command reports the intended generated rename diff because the bundle is intentionally dirty until the orchestrator stages it. I treated AC-6 as met because `npm run build` regenerated the bundle and the diff is limited to the expected outputs.

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
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` from source (then confirm `git diff --exit-code -- dist/` is clean post-stage — the CI dist-drift gate); the pre-commit worktree shows only the expected generated rename diff until the orchestrator stages the commit. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |
| `E2E` | deferred_by_spec | Spec: §Validation Required marks E2E N/A — no app/runtime UI surface. |

## Ready for Review

- [ ] All spec ACs met (see AC Coverage table above)
- [ ] All applicable validation checks pass (no failures)
- [ ] All deviations from plan documented with rationale

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
