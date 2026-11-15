# Implementation Handoff: ship-followup-capture

> Author: implementer | Spec: `tasks/ship-followup-capture/spec.md` | Plan: `tasks/ship-followup-capture/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.canon/templates/done.md` | Added the required Follow-ups section after Open Questions and narrowed Open Questions to decisions. |
| `templates/.canon/templates/done.md` | Synced the done.md template mirror. |
| `src/orchestrator/prompts/templates/qa.md` | Added QA’s Follow-ups sources, category mapping, tracking defaults, escaping, None. form, and decision-only Open Questions rule. |
| `tests/run-task-prompts.golden.json` | Regenerated QA prompt golden entries. |
| `tests/run-task-prompts.test.ts` | Pinned the Follow-ups, post-ship, and nit prompt instructions. |
| `src/orchestrator/followups.ts` | Added Follow-ups parsing, row classification, and ship block formatting; rejects None. with other visible content. |
| `src/orchestrator/validation.ts` | Requires a valid Follow-ups section at the QA phase gate. |
| `src/orchestrator/main.ts` | Checks QA evidence advancement and prints read-only follow-up listings and warnings on both ship paths. |
| `src/orchestrator/cli.ts` | Documents follow-up listing in run usage. |
| `tests/followups.test.ts` | Added parser, classification, and formatter coverage, including None. mixed with prose. |
| `tests/run-task-validation.test.ts` | Added QA gate, taskPhase, and evidence-advance coverage. |
| `tests/run-task-ship-docs-fold.test.ts` | Added ship listing, omission, bundle, warning, external-merge, and read-only tests. |
| `tests/run-task-ship-helpers.ts` | Extended ship fixture setup for custom or missing done.md files. |
| `.claude/skills/canon-pipeline/SKILL.md` | Added the human_review follow-up decision step and ship block instructions. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Synced the canon-pipeline skill mirror. |
| `docs/pipeline-orchestrator.md` | Updated ship usage and numbered ship order. |
| `templates/docs/pipeline-orchestrator.md` | Synced the pipeline orchestrator doc mirror. |
| `README.md` | Updated both --ship descriptions. |
| `docs/codebase-map.md` | Added parser and test locations. |
| `docs/product-context.md` | Added the follow-up decision to the human flow. |
| `docs/decisions.md` | Recorded the QA table, human_review decision, and post-ship handling. |
| `dist/cli/index.js` | Rebuilt CLI bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle. |
| `src/orchestrator/phases/qa.ts` | Catches QA gate rejection during stdout salvage, warns with the gate message, preserves done.md, and leaves qa not done. |
| `tests/run-task-safety-providers.test.ts` | Added the rejected-salvage regression test and valid Follow-ups sections to all three salvage fixtures. |
| `tests/run-task-safety-base-drift.test.ts` | Added a valid Follow-ups section to the QA artifact fixture. |
| `tests/run-task-safety-routing.test.ts` | Added a valid Follow-ups section to the result-event salvage fixture. |
| `.claude/skills/canon-pipeline/recovery.md` | Documented the valid Follow-ups requirement for qa done. |
| `templates/.claude/skills/canon-pipeline/recovery.md` | Synced the recovery guide mirror. |

## Intent & Rationale

QA requires a parseable Follow-ups section. The QA stdout-salvage path now handles a gate rejection without crashing: it keeps the salvaged file, prints the actual gate rejection, and leaves the phase unfinished for the existing recovery route. Valid salvaged content still advances, and a QA session that blocked itself remains blocked.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None. | Implemented the original plan and reroute steps R1–R3. | None. |

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-1 | Met | The done.md template places the section immediately after Open Questions, documents all columns and values, narrows Open Questions, and its mirror passes sync validation. |
| AC-2 | Met | The QA prompt and golden cover all four sources, category mapping and default, nits, Docs drift, tracked values, task references, escaping, None., and decision-only Open Questions. |
| AC-3 | Met | Parser tests cover valid triples, every state form, malformed input, hidden tables, repeated headings, escaped pipes, and None. mixed with prose. |
| AC-4 | Met | Gate and taskPhase tests cover missing, malformed, valid table, and None. forms. |
| AC-5 | Met | Ship integration tests verify both blocks, their rows and instructions, normal completion, and archiving. |
| AC-6 | Met | Tests verify None., dropped-only, and reference-only sections print no block or warning. |
| AC-7 | Met | Bundle test verifies one Untracked block grouped by task id. |
| AC-8 | Met | Missing section, malformed table, and missing file each produce one warning and still complete and archive. |
| AC-9 | Met | External-merge resume test verifies the Untracked block. |
| AC-10 | Met | Tests compare archived done.md bytes and verify no issue subcommand in the fake gh log. |
| AC-11 | Met | Main skill and mirror cover the four choices, batched nits, open-item confirmation, project filing convention, Tracked updates before --pr, and both ship blocks. |
| AC-12 | Met | Config extra-key coverage remains; rg for 'issue' in src returns no matches in gh argument lists. |
| AC-13 | Met | Usage, pipeline doc and mirror, README, codebase map, product context, and the amended recovery guide consistently state their respective ship and QA-gate contracts. |
| AC-14 | Met | docs/decisions.md records the required table, human_review decision, post-ship docs commit, and non-interactive/adopter-specific rationale. |
| AC-15 | Met | The new salvage regression test proves gate rejection warns without throwing, leaves done.md, and leaves qa in_progress; valid and blocked salvage paths remain covered. |
| AC-16 | Met | All five QA fixtures now contain a valid None. section; npm test passes in full. |
| AC-17 | Met | Recovery guide and mirror state the parseable Follow-ups requirement; template sync check passes. |

## Edge Cases

- A missing section differs from None.; malformed headers, separators, row widths, and None. mixed with visible prose are rejected.
- Fenced and commented tables are ignored; the last Follow-ups heading wins; escaped pipes parse; unknown categories remain visible.
- Unclear tracking values stay untracked. Only valid URLs, issue numbers, markdown links, and task:<id> references count as tracked.
- Ship warns once for missing or unparseable task sections and continues; empty, dropped-only, and reference-only sections print no blocks.
- The QA blocked-session branch remains first and does not attempt to advance through the gate.

## Blockers

None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-15 | node --import tsx --test --test-name-pattern='QA salvage leaves qa not done when the salvaged done.md fails the qa gate' tests/run-task-safety-providers.test.ts | 7537f6ec52887cedbfebeaa56d08d310d558defb | The new assertion expected exit 0 but got exit 1; the captured stack showed check-phase-gate rejection escaping through taskPhase and runQaPhase at qa.ts:62. | The test passes; the three focused QA safety suites pass 181/181 and the full npm test suite passes 2,210 with one skipped. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | The AC-15 test in `tests/run-task-safety-providers.test.ts` asserts no throw, the salvaged bytes remain on disk, qa remains in_progress, and the warning contains the gate message. It failed before the fix against the task branch HEAD with the escaping check-phase-gate stack recorded above; it now passes. AC-16 changed fixtures only, as specified. The earlier parser tests in `tests/followups.test.ts` pin triples, classification, malformed-cell reasons, hidden-table handling, last-heading behavior, and rejection of None. plus prose; the prior red run showed the parser returned empty rows without the fix. `tests/run-task-validation.test.ts` pins gate and taskPhase outcomes. Prompt tests and goldens pin QA instructions. Ship tests pin block contents, warnings, grouping, external merge, and unchanged archived bytes. Focused and full suites pass. |
| Restatement sweep | Searched for Follow-ups, qa done, done.md near ship, and ship near done.md across the template, QA prompt, skills, docs, README, and orchestrator; searched `canon task phase <task-id> qa done` across both canon-pipeline skill files; ran `rg -n "'issue'" src` with no hits. The recovery guide and its mirror now name the parseable section; all in-scope AC-13 surfaces remain aligned. |
| Sibling parity | Checked direct qa gate and taskPhase, the QA evidence-advance path, stdout salvage, valid salvage, blocked salvage, and normal/external-merge/bundled ship paths. The stdout salvage catch handles only check-phase-gate errors; other errors rethrow. Blocked QA is checked first and stays blocked. All five legacy fixtures now supply valid content. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| npm run lint | Pass | |
| npm run type-check | Pass | |
| npm test | Pass | 2,210 passed; 1 skipped; 2,211 total. |
| npm run build | Pass | Rebuilt both dist bundles. |
| npm run docs-refs-check | Pass | All refs OK after the handoff rewrite. |
| npm run sync-templates:check | Pass | All canon-managed files in sync. |
| npm run sync-templates | Pass | Regenerated the recovery guide mirror. |
| Focused QA safety suites | Pass | node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-safety-providers.test.ts tests/run-task-safety-routing.test.ts tests/run-task-safety-base-drift.test.ts — 181/181. |
| AC-12 source grep | Pass | rg -n "'issue'" src returned no matches. |
| git diff --check | Pass | No whitespace errors. |
| E2E | not_configured | The spec marks E2E N/A because there is no end-to-end surface. |

## Ready for Review

- [x] All spec ACs met.
- [x] All applicable validation checks pass.
- [x] All deviations from plan documented with rationale.
