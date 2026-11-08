# Implementation Handoff: handoff-self-check-evidence

> Author: Codex | Spec: `tasks/handoff-self-check-evidence/spec.md` | Plan: `tasks/handoff-self-check-evidence/plan.md`
>
> Initial implementation; cumulative baseline for subsequent review rounds.

## Changes

| File | What Changed |
|---|---|
| `.canon/templates/handoff.md`, `templates/.canon/templates/handoff.md` | Baseline three-row Self-Check evidence table and optional whole-branch Iteration updates. |
| `.canon/templates/review.md`, `templates/.canon/templates/review.md` | Stage 1 Self-Check contradiction checklist item beside red-first evidence. |
| `.claude/agents/code-review-anchored.md`, `templates/.claude/agents/code-review-anchored.md` | Effective-record supersession, both historical-evidence examples, Stage 1 contradictions and Stage 2 omissions. |
| `src/orchestrator/validation.ts` | Shared presence/fill parser wired into both handoff gates; live classification uses the format bucket. |
| `src/orchestrator/prompts/templates/implement.md`, `src/orchestrator/prompts/templates/implement-reroute.md` | Require recorded evidence even with an older handoff template; reroute carries whole-branch evidence forward. |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Baseline in-place repair after rejection; whole-branch Iteration rows supersede earlier evidence. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Re-review reads every Self-Check block and judges only effective rows. |
| `src/orchestrator/prompts/index.ts` | Interrupted-resume handoff summary names the Self-Check table and its three checks. |
| `tests/run-task-validation.test.ts` | Invalid and tolerated parser cases through both gates; format framing, review artifact and rejection counter assertions; classifier fixture parity. |
| `tests/red-first-evidence-template.test.ts` | Template shape/position, charter supersession/examples/omissions and review parsing tests. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Evidence guidance assertions, updated snapshots and new pre-flight revision golden. |
| `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-safety-helpers.ts` | Filled Self-Check sections in passing pre-flight fixtures. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Presence/fill gate and anchored truth judgment documented. |
| `docs/architecture.md` | Implement-to-review and gates lists name Self-Check presence/fill. |
| `docs/codebase-map.md` | Pre-flight gate row names baseline Self-Check presence/fill. |
| `docs/decisions.md` | Enforcement split decision and aligned Stage 1 checklist. |
| `dist/orchestrator/run-task.js` | Rebuilt validation and prompt bundle. |
| `tasks/handoff-self-check-evidence/notes.md`, `tasks/handoff-self-check-evidence/handoff.md` | Implementation observations and review handoff. |

## Canon Governance

The authoritative provenance stamp is `tasks/handoff-self-check-evidence/status.json` under `canon`.

| Field | Source |
|---|---|
| Upstream repo | status.json.canon.upstream_repo |
| Upstream commit | status.json.canon.upstream_commit |
| Orchestrator commit | status.json.canon.orchestrator_commit |
| Codex CLI | status.json.canon.codex_cli |
| Claude Code | status.json.canon.claude_code |

## Intent & Rationale

Require falsifiable evidence without asking the deterministic gate to judge truth. The parser reuses the existing visible Markdown scanner and escaped-pipe table splitter, inspects baseline rows positionally, and rejects absent, empty, placeholder, bare-N/A or malformed cells. Both entry points share it. Existing format routing supplies the repair framing and loop accounting; no routing or state-schema change was needed.

The anchored charter judges only the latest filled row per check across the cumulative handoff. Revisions restate whole-branch evidence and retain superseded rows as history. Omissions remain Stage 2 findings, preserving Stage 2 review when bookkeeping is incomplete.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Explicitly reject recognized Self-Check rows with other than two cells. | The implementation rules require cell-level rejection; otherwise an unescaped pipe silently truncates evidence. The message names the row, baseline repair and pipe escape. | Preserves AC-3 escaped-pipe tolerance; adds malformed-input coverage. |
| Reused existing scanner imports already present in validation. | Both scanner exports were already imported in the current source. No import change needed. | None. |
| Aligned the existing Stage 1 checklist in the decisions doc as well as adding its new entry. | The restatement sweep found that checklist in the same authorized file. | Keeps AC-10 documentation consistent. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Handoff baseline and optional Iteration tables have the required rows, ordering, citation/pipe guidance and whole-branch supersession; structure test parses and asserts them. |
| AC-2 | Met | Both gates reject each missing/empty/placeholder/bare-N/A/Iteration-only case; named messages explain baseline repair. Tests cover zero rows, hidden tables and duplicate invalid rows too. |
| AC-3 | Met | Both gates accept real evidence, all reasoned dash forms, case variants, bold labels, escaped pipes and a valid baseline with placeholder Iteration rows. |
| AC-4 | Met | Live classification is format; the artifact test writes “Fix the handoff” and verifies the durable current-loop rejection counter becomes 1. |
| AC-5 | Met | Fresh/reroute/resume/revision instructions updated; new pre-flight golden and existing authoring goldens pass alongside clause assertions. |
| AC-6 | Met | Charter item follows red-first, defines effective rows, ignores placeholder updates, exempts history and contains both examples; Stage 2 omission rule and existing implement-template-name exclusion test pass. |
| AC-7 | Met | Round-2 foreman golden and explicit assertion pin whole-handoff effective-record instructions beside red-first guidance. |
| AC-8 | Met | Review checklist item added; AC-table and checked-verdict parsing tests pass. |
| AC-9 | Met | Passing pre-flight fixtures updated; full suite passes. |
| AC-10 | Met | All named docs updated and references validated. |
| AC-11 | Met | Managed mirrors regenerated with the sync command; sync check passes. |

## Edge Cases Considered

- A baseline H2 is mandatory; an Iteration H3 cannot satisfy presence. Placeholder Iteration rows never enter the structural gate.
- Empty or header-only sections fail closed with missing-row issues. Fenced/commented tables cannot supply evidence.
- Evidence is read from column two; escaped pipes survive, unescaped extra cells receive a specific repair message. Every duplicate recognized row is checked.
- Labels tolerate emphasis, code spans, case and a trailing colon. Reasoned N/A permits em, en and ASCII dashes.
- Fresh, reroute, revision, interrupted-resume and park-resume guidance remain aligned. The anchored truth rule is prose: tests pin its wording and examples, not model execution. The spec's human pipeline smoke remains for downstream human review.
- Recovery/routing remains existing behavior: the code-review pre-flight runs before review verdict handling; accept/sanction and reroute retain their explicit spec-defined behavior. No new exemption or state is introduced.

## Blockers

None. No unresolved ambiguity or required out-of-scope edit was found.

## Red-First Evidence

The spec is a feature and has no mandatory red-first AC. These additional base checks establish that the new tests detect absent behavior.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-2–4 (additional feature check) | node --test --test-name-pattern='Self-Check' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-validation.test.ts | 0810b2f72269dd5ce173f74a327d87f7b319e5c6, before non-test edits | 19 negative/routing cases failed: live gate reported no Self-Check issue; expected blocker count 1 was 0. Eleven compatibility cases already passed. | All 30 pass with the parser and both wiring points. |
| AC-1, AC-6, AC-8 (additional feature check) | node --test --test-name-pattern=Self-Check with the project loaders and tests/red-first-evidence-template.test.ts, cwd containing base template/charter copies | 0810b2f72269dd5ce173f74a327d87f7b319e5c6 template/charter contents copied to a temporary directory | All three new structure tests failed on missing Self-Check content. | All three pass against current files; existing red-first tests also pass. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/run-task-validation.test.ts`: 18 invalid-input cases assert the specific row/repair reason, identical messages from both gates and format classification; 11 compatibility cases assert both gates return no issues; the routing case asserts a missing-section issue, written “Fix the handoff” framing and persisted counter 1. The negative/routing tests were red on base and all 30 pass now (see above). Compatibility cases protect the allowed syntax from false rejection. `tests/red-first-evidence-template.test.ts`: the three new tests assert parsed rows, exact supersession clauses and both examples, plus unchanged review-table/verdict parsing; all three were red against base text copies. `tests/run-task-prompts.test.ts`: the two new tests pin baseline repair, template-override handling, reroute carry-forward, whole-branch revision semantics, resume and foreman wording; the current diff shows those exact clauses are absent from base. Prompt goldens were regenerated. The three other test-file edits are fixture-only. |
| Restatement sweep | Ran patterns `pre-flight\|Pre-flight\|preflight\|AC Coverage\|AC coverage\|self-check`, then `Self-Check\|self-check` across the task templates, agent charters, prompt templates, docs and mirrors; searched `AC Coverage\|AC coverage\|Validation Outcomes\|pre.flight\|Self-Check\|self-check\|red-first evidence` in the local skills too. Updated the authorized contract carriers, including the additional Stage 1 list in `docs/decisions.md`. Outside the affected set, `docs/patterns.md` gives generic gate implementation discipline and `.claude/skills/canon-pipeline/SKILL.md` has a separate pre-PR/ship checklist; neither claims to enumerate this handoff gate. Historical telemetry is unchanged; the pre-flight list in `src/orchestrator/main.ts` is a non-runtime source comment, exempt under adopter scope. No contradictory runtime carrier required an out-of-scope edit. |
| Sibling parity | Examined `validateHandoff` and the live `classifyPreflightBlockers` in `src/orchestrator/validation.ts`; both invoke the same parser, and the latter feeds `selfCheckIssues` through `classifyPreflightBlockersFromData` as format. The missing-file catch keeps its existing handoff-not-found behavior. Examined `src/orchestrator/phases/code-review.ts`: existing artifact writer and rejection helper provide framing/accounting and need no edit. Fresh/reroute/revision prompts, `promptImplementResume` and park-resume through fresh rendering all carry the corresponding evidence rule. Synced all four managed root/mirror pairs. `checkImplementEvidence` and accept/reroute recovery are intentionally unchanged per spec. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | No warnings or suppressions added. |
| `npm run type-check` | Pass | TypeScript noEmit check completed. |
| `npm test` | Pass | 2,125 tests: 2,124 pass, 0 fail, 1 skip. `tests/run-task-safety-staging.test.ts` worktree-root test skips because .git writes are restricted; fish completion smoke/syntax checks also skip internally because fish is unavailable. |
| `npm run build` | Pass | Fresh tsup build and path normalization; only the orchestrator bundle changed. |
| `npm run docs-refs-check` | Pass | All refs OK; run after final documentation edits. |
| `npm run sync-templates:check` | Pass | All four changed managed pairs match. |
| Scoped validation/prompt/template/recovery/code-review tests | Pass | 464 tests pass, 0 fail. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
