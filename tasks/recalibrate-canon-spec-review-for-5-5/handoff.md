# Implementation Handoff: recalibrate-canon-spec-review-for-5-5

> Author: Codex | Spec: `tasks/recalibrate-canon-spec-review-for-5-5/spec.md` | Plan: `tasks/recalibrate-canon-spec-review-for-5-5/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.claude/agents/spec-review-lens.md`, `templates/.claude/agents/spec-review-lens.md` | Added and mirrored the shared read-only reviewer charter. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Repointed the three angles to the charter, moved filtering to synthesis, clarified scope and C3, and corrected the identified drift. |
| `src/lib/canon-owned.ts` | Registered the charter for init and upgrade. |
| `dist/cli/index.js` | Rebuilt bundle includes the charter path. |
| `tests/run-task-prompts.test.ts` | Added structural assertions for AC-1 through AC-7. |
| `docs/decisions.md` | Recorded the skill calibration under the Claude prompt calibration audit. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

A shared charter limits what each spec-review lens can do, while the skill keeps each angle's rubric and the synthesis rules. The charter registration and generated mirrors deliver the change through the existing canon-managed file flow.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Implemented the plan approach. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Charter frontmatter declares exactly Read, Grep, Glob, and Bash; the test checks the parsed allowlist. |
| AC-2 | Met | Charter includes the lane, read-only Bash, grounding, coverage-first, and clean-return contract; structural test checks tokens. |
| AC-3 | Met | Both shipped files state matching severity definitions and the full scope-boundary predicate with all three exclusions; test rejects one-conjunct lines. |
| AC-4 | Met | Skill dispatches only to `spec-review-lens`, has a missing-charter stop, and preserves the two required Agent C phrases. |
| AC-5 | Met | Per-angle silence calibration is removed; synthesis now drops uncited findings, downgrades scope-boundary findings, de-dupes, and re-classifies. |
| AC-6 | Met | Check C3 names the exact heading and parent section and includes generated/rebuilt outputs. |
| AC-7 | Met | Updated frontmatter, inline-review pointer, XS anti-pattern, and removed stale strings are pinned in the structural test. |
| AC-8 | Met | Charter is registered; sync generated both mirrors. `grep -c 'spec-review-lens.md' dist/cli/index.js` returned `1`. |
| AC-9 | Met | Calibration-audit section contains the `spec-review-lens` decision paragraph (grep hit at line 471); docs reference check passed. |

## Edge Cases Considered

- A mixed-version adopter whose updated skill lacks the new charter is told to upgrade and start a fresh Claude Code session; the skill does not fall back to a broader agent type.
- The scope-boundary test checks each `Non-Goals`/`explicitly exclude` line for the required verification conjunct.
- The existing task-state status file was already dirty at session start and was not included as a source change.

## Blockers

- [validation] One unrelated test is unverified: `tests/run-task-safety.test.ts:2522`, “REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree,” is skipped because this sandbox restricts `.git/` writes. The full suite exits successfully, but this case is not counted as passing.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,333 passed; one unrelated linked-worktree test at `tests/run-task-safety.test.ts:2522` was skipped and is recorded above as unverified. |
| `npm run build` | Pass | Bundle grep found `spec-review-lens.md` once in `dist/cli/index.js`. |
| `npm run sync-templates` | Pass | Generated both declared template mirrors. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts` | Pass | 46 tests passed, including the new structural test. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
