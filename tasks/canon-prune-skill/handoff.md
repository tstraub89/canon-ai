# Implementation Handoff: canon-prune-skill

> Author: implementer | Spec: `tasks/canon-prune-skill/spec.md` | Plan: `tasks/canon-prune-skill/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.claude/skills/canon-prune/SKILL.md`, `templates/.claude/skills/canon-prune/SKILL.md` | Added the human-invoked permanent-doc prune workflow, evidence protocol, four verdicts, implement-prompt guard, triage/apply flow, and drafted git-history record. |
| `.claude/skills/canon-sweep/SKILL.md`, `templates/.claude/skills/canon-sweep/SKILL.md` | Added the recurrence check for permanent rules removed by a prune. |
| `.claude/skills/docs-audit/SKILL.md` | Added a canon-managed-set prune pass, verdict reporting, individual triage, and prompt-template follow-up handling. |
| `src/lib/canon-owned.ts` | Registered the new shipped skill. |
| `src/cli/commands/doctor.ts` | Added the new recommended permission entries and skill check. |
| `dist/cli/index.js` | Rebuilt the generated CLI bundle. |
| `tests/cli.test.ts` | Added canon-prune doctor coverage and updated the skill-count test. |
| `README.md` | Added the skill listing and allowlist entries, install listing, and high-level canon guidance. |
| `.claude/skills/canon-init/SKILL.md`, `templates/.claude/skills/canon-init/SKILL.md` | Added permission entries and high-level canon guidance for adopter-owned agent files. |
| `.claude/settings.json` | Added the two canon-prune permission entries. |
| `docs/lessons-learned.md`, `templates/docs/lessons-learned.md` | Added the human-invoked permanent-doc pruning sentence. |
| `CHANGELOG.md` | Added the unreleased canon-prune and sweep recurrence entries. |
| `tasks/canon-prune-skill/handoff.md` | Recorded implementation, AC coverage, self-check, and validation. |

## Intent & Rationale

Added the prune workflow as a shipped skill, connected it to existing install, upgrade, doctor, permissions, and template-sync paths, and extended the local docs audit for canon-ai's own managed files as specified. Canon-managed adopter files remain excluded from the shipped prune skill.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Used the repository's resolvable section-reference form for `Known Pitfalls` after `docs-refs-check` rejected literal backticked heading text. | The checker resolves `docs/patterns.md` §"Known Pitfalls" and catches invalid section references; the literal `##` form was parsed as a missing symbol. | None; intended scope and discovery behavior are unchanged. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Frontmatter names canon-prune; description is human-invoked, monthly/model-change cadence, permanent-doc scope, and lessons-buffer exclusion. Allowed tools include required agent, question, file, task-list, and git-read tools. canon-sweep remains lessons-buffer-only. |
| AC-2 | Met | Six numbered workflow steps appear in order; preflight points to canon-sweep §"Preconditions". Scope discovers routed pitfall docs from the table and excludes lessons and managed files. |
| AC-3 | Met | Managed set is named by kind and never read/inventoried/edited. High-level-only rule and keep/delete/mixed examples are present. No canon-ai-specific branch. |
| AC-4 | Met | Three default groups use concurrent read-only agents and a light model; output includes location, form, gist, six evidence items, and proposed verdict/text. |
| AC-5 | Met | Comparison is limited to rule-form entries; candidates are source-confirmed; home selection references canon-sweep; cluster merge replaces member verdicts. |
| AC-6 | Met | Exactly delete, relocate, merge, keep are defined; project duplicates are merge, never delete. No demote mention. |
| AC-7 | Met | Implement-prompt removals and path-citation stripping get the required guard tag; pitfall merge keeps a path-citing H3 home. |
| AC-8 | Met | Removal is the default without proof of unneededness; ablation is optional and human-requested. Measurement uses the prune record and sweep history check. |
| AC-9 | Met | Triage is batched by group with merges last and individual approvals; application is file-disjoint; docs checks always run, full validation for non-doc changes; no commit. |
| AC-10 | Met | Draft message has fixed prefix, per-verdict reasons and Reviewed and kept entries. Start lookup, matching, evidence-change re-proposal, skip summary, and no-log-file rule are specified. |
| AC-11 | Met | canon-sweep Stage B recurrence bullet has one added clause; template mirror synced. |
| AC-12 | Met | Only `src/lib/canon-owned.ts` and `src/cli/commands/doctor.ts` changed outside `dist/`; doctor edits are limited to `RECOMMENDED_ALLOW` and `checkSkills`. No config parser or command registration edits. |
| AC-13 | Met | `npm run sync-templates:check` and `npm run docs-refs-check` pass; manual adopter-scope read found no internal source paths or unsupported path assumptions in the shipped skill. |
| AC-14 | Met | New skill is in CANON_OWNED, doctor checks and recommends it, README/init/settings allowlists include both entries, and CLI tests cover present/missing cases. Repo-wide canon-sweep listing search reviewed. |
| AC-15 | Met | Local docs-audit covers markdown root copies in CANON_OWNED, applies the shared verdict/guard contract by reference, adds PRUNE rows to individual triage, and leaves prompt-template candidates as follow-ups. docs-audit is not CANON_OWNED. |
| AC-16 | Met | Exactly one canon-prune sentence appears in each lessons-learned file's usage section. |
| AC-17 | Met | Unreleased changelog describes skill behavior, adopter doctor warnings and upgrade/settings action, plus sweep recurrence check. |
| AC-18 | Met | README and canon-init carry the identical canonical sentence; init root and mirror are synced. Nudge text and RECOMMENDED_NUDGE were not changed. |

## Edge Cases Considered

- Pointer and index rows are excluded from cross-doc duplicate matching and are not deleted merely for summarizing rules.
- A rule's project-document duplicate cannot be deleted independently; a confirmed cluster uses one merge verdict.
- A previous Reviewed and kept rule is skipped unless its text or recorded evidence changes; gist is the fallback locator.
- Canon-managed files and the lessons buffer remain outside the shipped skill's read and edit scope.
- Verified docs-refs-check resolves skill-to-skill heading references: changing §"Preconditions" to §"PreconditionsX" produced a missing-heading error; restoring it passed.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| None — no red-first ACs | | | | |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | Updated `tests/cli.test.ts`: missing canon-prune case asserts `warn`, names canon-prune, and excludes canon-sweep; all-operational-missing asserts canon-prune is named; all-nine-present pins the new count. `src/cli/commands/doctor.ts`'s skill list lacks canon-prune without this change, so the missing-specific assertion would fail (warn detail would not name it) and the all-present fixture would still warn. Full `npm test` passes after the change. |
| Restatement sweep | Searched `canon-sweep`, `canon-prune`, the canonical sentence, and `RECOMMENDED_NUDGE`; inspected the repo-wide `grep -rn 'canon-sweep'` results excluding tasks, node_modules, dist, and .git. Live listings were updated in README, permissions, tests, source, shipped skills, and mirrors; historical changelog entries and intentional negative test assertions remain historical/assertional. README/init canonical sentence matches the skill exactly; doctor diff has no RECOMMENDED_NUDGE line. |
| Sibling parity | Checked root/mirror pairs for canon-prune, canon-sweep, and canon-init; checked README, canon-init, and `.claude/settings.json` allowlists against `src/cli/commands/doctor.ts`; checked `CANON_OWNED` registration against generated mirror; checked root and scaffold lessons guidance. Each parallel carrier was updated, and `docs-audit` intentionally remains local and unregistered. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Final run: 2,248 passed, 1 skipped, 0 failed. An earlier overlapping run read the pre-correction skill reference and failed the shipped-markdown fixture; final run used the corrected tree. |
| `npm run build` | Pass | `git diff --stat -- dist/` showed only `dist/cli/index.js`. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | Broken-reference experiment failed as expected; restored run passed with “All refs OK”. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
