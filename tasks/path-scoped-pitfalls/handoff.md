# Implementation Handoff: path-scoped-pitfalls

> Author: implementer | Spec: `tasks/path-scoped-pitfalls/spec.md` | Plan: `tasks/path-scoped-pitfalls/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/pitfalls.ts` | Added the relevance selector, then applied Amendment 1's positional Known Pitfalls table scope and header-first target selection with the specified content fallback. |
| `src/orchestrator/context.ts` | Removed `buildKnownPitfalls` and its unused worktree import. |
| `src/orchestrator/prompts/index.ts` | Wired the selector into fresh implement and implement-reroute prompts. |
| `tests/pitfalls.test.ts` | Added original AC coverage plus AC-15/16 fixtures, real Lint-row coverage, and cap tests. |
| `tests/fixtures/patterns.stub.md` | Added matching and unrelated path-citing pitfalls for prompt goldens. |
| `tests/fixtures/pitfalls-docs/docs/lessons-learned.md` | Added a matching lesson fixture after the excluded example scope. |
| `tests/run-task-prompts.test.ts` | Restructured the golden spec fixture, added the empty-diff call-site test and docs-root override, and covered park-resume. |
| `tests/run-task-prompts.golden.json` | Regenerated fresh implement, reroute, and reroute-resumed snapshots. |
| `docs/patterns.md` | Described relevance selection in “How to use this doc.” |
| `templates/docs/patterns.md` | Updated selection guidance and the scaffold's one-H3-per-pitfall format. |
| `.claude/skills/canon-init/write-guide.md` | Specified that split-doc indexes go before the H3 entries and use a `Read this doc` column. |
| `templates/.claude/skills/canon-init/write-guide.md` | Synced the managed write-guide change. |
| `README.md` | Described pitfalls and lessons as selected by spec Affected Files. |
| `docs/pipeline-orchestrator.md` | Clarified the patterns override and documented the test-only docs-root override. |
| `templates/docs/pipeline-orchestrator.md` | Synced the managed pipeline documentation change. |
| `docs/codebase-map.md` | Updated the Patterns entry and added the selector module. |
| `dist/orchestrator/run-task.js` | Rebuilt the tracked CLI bundle. |
| `tasks/path-scoped-pitfalls/notes.md` | Recorded implementation and reroute pitfalls. |

## Intent & Rationale

The implementer receives full pitfall entries that cite paths from the task spec's Affected Files, matched Trigger Table sections, linked-doc entries, and matching lessons. Other pitfall titles and every index row remain available within the byte cap. Both fresh implement and implement-reroute use `buildRelevantPitfalls`; park-resume inherits it through the fresh prompt.

Amendment 1 resolves the two recurring spec gaps by making Known Pitfalls table membership positional and target-cell precedence explicit. Only tables before the first H3 under `## Known Pitfalls` are indexes. A target header containing “section”, “doc”, or “read this” wins; tables without a hinted header use the specified doc/section/prefix precedence.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The implementation follows the original plan and Amendment 1's reroute plan. | None |

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-1 | Met | No `buildKnownPitfalls` hits in `src/` or `tests/`; both prompt call sites use `buildRelevantPitfalls`, which reads spec paths through `extractAffectedFiles`. The call-site test selects an entry for `[src/a/b.ts](src/a/b.ts)` when prompt `affectedFiles` is empty. |
| AC-2 | Met | Exact and directory-prefix matches render in full; an unrelated path-citing entry stays in the title index. |
| AC-3 | Met | Covers glob-matched linked entries, open-doc pointer, unmatched titles, area row, and relative Markdown link resolution. |
| AC-4 | Met | Covers keyless and matched rows, Trigger Table rows under H3, and the restored path-bearing explanatory table fixture. |
| AC-5 | Met | Covers H2/H3 targets, exact-before-prefix resolution, mixed section/doc targets, and `docs/patterns.md` §Testing without treating that document as a linked pitfall doc. |
| AC-6 | Met | A direct entry covered by a selected section appears once; nested H3 content is not repeated in the title index. |
| AC-7 | Met | Matching lessons render under their own heading; unrelated, excluded-example, and fenced headings do not render as entries. |
| AC-8 | Met | Basenames, symbols, and plain words do not match; a source-line suffix is stripped. |
| AC-9 | Met | Full entries demote in channel order; title and index truncation include counts, and output stays within the cap. |
| AC-10 | Met | Covers absent docs, section-only, lesson-only, missing linked docs, and no-Affected-Files output. |
| AC-11 | Met | Tests `CANON_PATTERNS_MD_PATH` and the docs-root override using a temporary docs tree. |
| AC-12 | Met | Golden spec uses `## Design` / `### Affected Files`; fresh, reroute, and reroute-resumed snapshots were generated and remain unchanged in this amendment. |
| AC-13 | Met | Real-doc test keeps the git-path pitfall and Validation Gate Discipline full; it also pins the actual Lint row. |
| AC-14 | Met | Updated the docs, scaffold, README, codebase map, pipeline reference, and init write guide. The guide now states the amendment's table position and target-header convention; the managed mirror is synced. |
| AC-15 | Met | A path-citing table inside `### Worker retries` remains in the full direct-match entry, not the area index. A signal-free table before the first H3 appears in the area index. |
| AC-16 | Met | Tests cover the real Lint row, the `Read this doc` hint, Section-header precedence over an exact Area heading, doc-path fallback over an exact heading, and exact-section fallback over a prefix. |

## Edge Cases Considered

- Hinted columns are selected even when their target text does not resolve; the row stays in the area index and contributes no targets.
- Without a header hint, Markdown doc paths and `§` references win first, then exact section matches, then prefix matches; the leftmost cell wins within each tier.
- Wildcard `.md` tokens remain keys rather than linked-doc targets.
- Trigger Table tables are collected at any heading depth. Known Pitfalls tables after the first H3 are entry content by Amendment 1.
- Missing linked docs stay visible in the index; their rows still match by key. Linked paths remain confined to the docs root.
- The hard byte cap truncates title/index/demoted-title details with counts and does not emit a partial fallback sentence.

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | Before production edits, the AC-4/15/16 test selection ran against committed HEAD `f8af39de60b62750d293499a8c9b8b583fe4aaa2`. AC-4 failed because the explanatory table row appeared in the area index; AC-15's Worker retries entry failed to render in full; three AC-16 cases chose the wrong linked-doc/header target. The exact-over-prefix fallback pin passed at HEAD. The AC-15 test's second, signal-free-table assertion was reached and passed after the fix; the pre-fix run stopped at its earlier Worker retries assertion. |
| Post-fix regression run | `node --import tsx --test tests/pitfalls.test.ts`: 19 passed, 0 failed. |
| Golden stability | `tests/run-task-prompts.golden.json` did not change in Amendment 1; the current-tree full suite passes against the existing fresh, reroute, and reroute-resumed snapshots. The initial implementation regenerated those snapshots. |
| Prompt parity | `promptImplement` and `promptImplementReroute` both use `buildRelevantPitfalls`; park-resume uses the fresh implement prompt. |

## Blockers

- `[ambiguity]` The original spec defines lessons as H3 entries under H2s starting with “Example”, while the real lessons file places later real lessons below `## Example entry` and separates them with an unfenced `---`. The implementation ends the excluded example scope at the first such thematic break or the next H1/H2 so real lessons remain selectable.
- `[ambiguity]` The original spec orders cap demotions by channel but does not define within-channel order. The implementation demotes the largest body first, breaking ties by later document position to preserve more smaller entries in full.
- `[ambiguity]` Legacy `## Known Pitfalls` content without H3 entries contributes no selected entry. I preserve the H3-only entry definition and do not add a fallback beyond the Affected Files scope.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| _(none — the spec has no AC designated as red-first)_ | | | | |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean. |
| `npm run type-check` | Pass | Clean. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`. |
| `npm test` | Pass | Current-tree run: 2,144 passed, 1 skipped, 0 failed. The skipped linked-worktree `REPO_ROOT` write test is disabled because this environment restricts `.git/` writes. |
| `npm run docs-refs-check` | Pass | Final check after this handoff rewrite. |
| `npm run sync-templates:check` | Pass | Final check after syncing the write-guide mirror. |
| `npm run sync-templates` | Pass | Synced the canon-managed write-guide mirror. |
| `node --import tsx --test tests/pitfalls.test.ts` | Pass | 19 focused tests passed. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All original and amended ACs met.
- [x] All required validation checks pass.
- [x] Reroute scope is documented; no files were added outside the spec's Affected Files.
