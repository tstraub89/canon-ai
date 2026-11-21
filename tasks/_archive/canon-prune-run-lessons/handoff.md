# Implementation Handoff: canon-prune-run-lessons

> Author: implementer | Spec: `tasks/canon-prune-run-lessons/spec.md` | Plan: `tasks/canon-prune-run-lessons/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.claude/skills/canon-prune/SKILL.md`, `templates/.claude/skills/canon-prune/SKILL.md` | Added sentence classification, guard requirement/path accounting, reference sweep, and merge-record hand-back instructions; synced mirror. |
| `.claude/skills/docs-audit/SKILL.md` | Added canon-ai-own-root-docs carve-out to prune pass. |
| `docs/patterns.md` | Removed obsolete helper incident aside; retained `taskDirFor()` rule. |
| `docs/decisions.md` | Removed untracked backlog line. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |
| Canon version | `status.json.canon.canon_version` |

## Intent & Rationale

Applied the four prune-skill safeguards, added the local docs-audit carve-out, and removed the two stale doc lines. Kept the skill headings unchanged because `tasks/canon-prune-run-lessons/spec.md` identifies heading references in docs-audit as a dependency.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Followed the plan. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Sentence classifications required in Steps 2 and 3 and shown in Step 4's triage columns. |
| AC-2 | Met | Guard section names requirements, selecting paths, standalone H3 behavior, and same-failure grouping. |
| AC-3 | Met | Step 5 adds archive-excluded reference search, same-apply retarget/removal, and hand-back listing. |
| AC-4 | Met | Step 6 makes the record and required carried content explicit. |
| AC-5 | Met | Mirror synced; sync and docs-ref checks pass; adopter-safety grep passes. |
| AC-6 | Met | docs-audit carve-out added; `docs-audit` remains absent from `src/lib/canon-owned.ts`. |
| AC-7 | Met | Both requested lines removed; `taskDirFor()` remains. `git diff main --stat` also shows the task `status.json` update already present at session start; it is pipeline state, not a source change. |

## Edge Cases Considered

- Kept `§"Verdicts"` and `§"Implement-prompt guard"` unchanged for docs-audit references.
- The PRUNE group row scopes the exception specifically to canon-ai's own root docs.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| None — no red-first ACs | | | | |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | N/A — no tests were added or changed; the change is guidance prose and two doc deletions. |
| Restatement sweep | Searched `canon-prune`, `Implement-prompt guard`, `delete`, `Canon-Prune:`, and docs-audit references. The local docs-audit prune row was updated; the canon-prune shipped/template copies were kept in sync. No other in-scope restatement required an edit. |
| Sibling parity | Checked both shipped skill and template mirror; sync check confirms parity. Checked the docs-audit group row and confirmed `docs-audit` is not in `CANON_OWNED` in `src/lib/canon-owned.ts`. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm test` | Pass | 2,248 passed, 0 failed, 1 skipped. |
| AC greps | Pass | canon-ai safety grep, obsolete helper grep, backlog grep passed; `taskDirFor()` found in `docs/patterns.md`. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `.claude/skills/docs-audit/SKILL.md` | Made the canon-mechanism carve-out unconditional for this row's canon-ai root docs, resolving the ambiguity flagged in review. |
| `docs/decisions.md` | Removed the extra blank line left by the deleted Backlogged entry. |

### Findings addressed

- _correctness bug:_ The docs-audit carve-out could be read as unreachable for canon-managed docs → stated directly for the canon-ai root docs covered by this row.
- _optional cleanup/nit:_ Removed the extra blank line before the separator in `docs/decisions.md`.

### AC deltas

- AC-6: wording corrected to apply unconditionally to this row's canon-ai root docs.

### Self-Check

| Check | Evidence |
|---|---|
| Restatement sweep | Searched for `describes a canon mechanism`, `High-level canon mentions only`, and `Prune (canon-managed set)` across `.claude/skills/`, `templates/.claude/skills/`, and docs. The canon-ai-specific exception appears in `.claude/skills/docs-audit/SKILL.md`; shipped `/canon-prune` and its template remain adopter-neutral and synchronized. No outside-scope restatement needed an edit. |
| Sibling parity | Compared the single `Prune (canon-managed set)` docs-audit row with the shipped and templated `/canon-prune` guidance. The exception belongs only on the local docs-audit row because the shipped skill excludes canon-managed docs from prune input; no parallel row requires the carve-out. |

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm test` | Pass | 2,248 passed, 0 failed, 1 skipped (2,249 total). |
