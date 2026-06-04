# Code Review: retire-release-init

> Reviewer: Claude | Spec: `tasks/retire-release-init/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

---

## Pre-Flight Rejection — handoff rejected before review (no Claude session ran)

### Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**

- Validation Required item missing from handoff.md: `npm run typecheck` (tsc --noEmit) — confirms no dangling reference to the deleted symbols/type. Handoff has rows for: lint, type-check, test, build, dist/, sync-templates:check, 'release-init. (Required canonicalized to: 'typecheck'.)

### Verdict

- [~] **Changes requested** — fix the above and resubmit handoff. *(resolved in Iteration 1)*

---

## Stage 1 — Spec Compliance (gate)

> Round 1 — full review after Iteration 1 (handoff-metadata fix)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (`lint`, `typecheck`, `test`, `build`, `git diff --exit-code -- dist/`, `sync-templates:check` — all present and Pass)
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Command removed from dispatch | Met | `case 'release-init':` arm deleted from `taskCmd` in `src/task/index.ts` (diff confirmed). Running the built CLI now falls through to the unknown-subcommand path. |
| AC-2: Implementation and private helpers removed | Met | `taskReleaseInit`, `insertChangelogBlock`, `updatePackageVersion`, `defaultPush`, and `ReleaseInitOptions` are all gone from `src/task/index.ts` (diff confirmed). `writeJsonAtomic` and `readJsonFile` both remain (confirmed via `git show HEAD:src/task/index.ts`). |
| AC-3: Tests removed, suite green | Met | No `taskReleaseInit`, `release-init`, or `releaseInit` references remain in `tests/task-cli.test.ts` (confirmed via grep on committed file). Handoff reports `npm test` passed. |
| AC-4: Help text removed | Met | `src/cli/index.ts` `--help` string and `src/task/index.ts` `usage()` both have the `release-init` line deleted (diff confirmed for both). |
| AC-5: `dist/` rebuilt and committed | Met | `dist/cli/index.js` in the diff shows the compiled dispatch and help text no longer reference `release-init`. `git grep -n 'release-init' -- dist/` returns no matches (handoff confirmed; patterns verified via grep on templates/ and src/ too). |
| AC-6: No live reference survives outside the allow-list | Met (with spec gap noted in Stage 2) | All non-allow-listed live files are clean. `CHANGELOG.md`, `docs/BACKLOG.md`, and `tasks/**` contain only expected historical/record references. `templates/` returns zero matches. One allow-list omission noted: `docs/pipeline-invocations.md` contains `retire-release-init` task-ID rows (substring match on `release-init`); this is telemetry data written by the pipeline, not a command reference — see Spec Gaps. |
| AC-7: Doc/skill sweep complete | Met | All listed files verified: `docs/release-process.md` has zero `release-init` matches (confirmed via `git show HEAD`); `tests/fixtures/canon-dev-tokens.json` comment no longer mentions the command (confirmed); diff confirms correct rewording in `README.md`, `docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/SKILL.md`, and `.claude/skills/canon-changelog/SKILL.md`. Prose reads coherently in all changed files. |
| AC-8: BACKLOG entries resolved, not orphaned | Met | Both entries are checked (`- [x]`) with the required closure note `Closed — release-init retired entirely in v1.9; see tasks/retire-release-init.` (diff confirmed). No open `- [ ]` release-init items remain. |
| AC-9: Canon-owned mirror synced | Met | `templates/` returns zero `release-init` matches (confirmed via grep). Handoff reports `npm run sync-templates:check` passed. Three template mirrors are listed in the Changes table and updated. |
| AC-10: CHANGELOG entry added | Met | `## [Unreleased]` block now contains a `### Removed` subsection with the `canon task release-init` removal bullet (confirmed via `git show HEAD:CHANGELOG.md`). |

### Dropped Sections Check

- [x] Non-goals respected — no replacement script created; `auto-release.yml` untouched; historical CHANGELOG entries unmodified; `docs/release-process.md` manual steps intact; `writeJsonAtomic` preserved; `canon task new` base-branch detection unaffected.
- [x] Known Risks addressed — stale `dist/` mitigated by explicit AC-5; incomplete grep allow-list risk materialized in `docs/pipeline-invocations.md` (spec gap, not blocking); dangling cross-references checked and prose reads coherently; templates drift verified via `sync-templates:check`.
- [x] Human Test Plan is satisfiable — the implementation leaves no `release-init` in CLI, docs, or skills; manual steps in `docs/release-process.md` are intact; BACKLOG items are visibly closed; CHANGELOG has the removal note.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

This is a clean, thorough removal. The scope was wide (CLI dispatch, source, compiled bundle, 5+ docs, 2 skills, 2 template mirrors, tests, BACKLOG, CHANGELOG) and every surface was hit. The implementation caught a subtle shared-helper dependency (`readJsonFile`) that a mechanical deletion would have missed — lint surfaced it and the fix was immediate. No dead code or half-removed fragments visible in the diff.

### Findings

#### Correctness Bugs

None.

#### Risk / Guardrails

None.

#### Optional Cleanup / Nit

None.

#### Spec Gaps

`spec gap` — **AC-6 allow-list omits `docs/pipeline-invocations.md` (telemetry file).** The AC-6 grep pattern `release-init|releaseInit` matches `retire-release-init` (the task ID) in `docs/pipeline-invocations.md`. That file now contains two committed rows (spec_review and plan phases) and will accumulate more as the pipeline runs. The spec author correctly flagged this risk ("may miss... telemetry docs") and mandated that spec_review regenerate the allow-list from `git grep` — but the allow-list in the shipped spec was never updated to include this file. The implementation cannot fix this (the entries are written by the pipeline, not the implementer), and the intent of AC-6 is fully satisfied — no command references survive. Future large-removal specs should add `docs/pipeline-invocations.md` to the allow-list when the task ID contains the retiring symbol.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

> The sole finding is a spec gap in the AC-6 allow-list that cannot be addressed at implementation time. All ACs are met, all validation checks passed, no correctness or risk issues. Ready to ship.
