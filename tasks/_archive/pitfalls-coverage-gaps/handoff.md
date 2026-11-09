# Implementation Handoff: pitfalls-coverage-gaps

> Author: implementer | Spec: `tasks/pitfalls-coverage-gaps/spec.md` | Plan: `tasks/pitfalls-coverage-gaps/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/pitfalls.ts` | Add prose-only Known Pitfalls fallback and directory-aware matching for path tokens. |
| `tests/pitfalls.test.ts` | Add AC-1 through AC-3 coverage, including red-first, boundary, and cap cases. |
| `docs/patterns.md` | Document the fallback and directory selection behavior. |
| `templates/docs/patterns.md` | Document the fallback and directory selection behavior in the init scaffold. |
| `.claude/skills/canon-init/write-guide.md`, `templates/.claude/skills/canon-init/write-guide.md` | Document prose-only sections and directory Affected Files in the write guide and its synced mirror. |
| `README.md` | Describe both selection behaviors in the pattern guidance row. |
| `dist/orchestrator/run-task.js` | Rebuild the tracked orchestrator bundle. |

## Intent & Rationale

Prose-only Known Pitfalls sections now become an unconditional candidate rendered under a separate subsection. Their index tables remain in the area index, blockquote paragraphs are omitted, and H3 sections retain their existing behavior. The shared token matcher now checks whether a cited path or glob can match a path below a directory Affected File, covering direct, linked, section-target, index-row, and lesson channels.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| A glob with exactly the directory's segments, such as `src/*` against `src/a/`, does not match. | The spec requires a match to some path inside the directory; that glob can match only the directory itself. This follows the spec's boundary rather than the plan's conflicting extra example. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Prose-only fallback | Met | Two paragraphs are included in full under `Known Pitfalls (included regardless of your files)` with no Affected Files and an unrelated Affected File; the blockquote is absent. |
| AC-1b: Fallback boundaries | Met | Index rows remain in the area index, a table-and-blockquote-only scaffold section produces no prose entry, and an H3 section's preamble is not injected. Tests also cover lazy blockquote continuation and quote-looking fenced code. |
| AC-2: Prose-only under the cap | Met | At a 1200-byte cap, the fallback is demoted to the `Known Pitfalls` title line after lesson, section, and linked candidates; the other direct entry remains full. |
| AC-3: Directory Affected File | Met | `src/a/` selects nested direct, Trigger Table section, linked-doc, and lesson entries. The `src/**/*.ts` index row matches; `src/ab/**` and `*.md` do not. |
| AC-4: Existing behavior holds | Met | `npm test` passes all 2150 passing tests with one skip. The golden fixtures were not regenerated. |
| AC-5: Docs | Met | Updated `docs/patterns.md`, `templates/docs/patterns.md`, `README.md`, and the canon-init write guide plus its mirror. |

## Edge Cases Considered

- No fallback is emitted when removing index tables and blockquotes leaves an empty body.
- Any H3 under a Known Pitfalls H2 keeps the existing H3-only selection behavior; preamble text is not included.
- Blockquote lazy continuation lines are removed, while quote-looking lines in fenced code remain.
- Directory-prefix tokens and segment-wise globs are evaluated without filesystem access; sibling directories and root-level globs stay unmatched where required.
- The fallback uses the existing `direct` demotion channel and title-group behavior, so it participates in the byte cap without changing demotion order.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1 | `npx tsx --test tests/pitfalls.test.ts` | `2f36ff1b624ad750f8aac6fd021f1362b31499b8` | The output contained only the area index; it had no unconditional Known Pitfalls subsection or prose. The same run also showed the AC-1b and AC-2 fallback tests failing. | The focused suite passes 23/23 tests. |
| AC-3 | `npx tsx --test tests/pitfalls.test.ts` | `2f36ff1b624ad750f8aac6fd021f1362b31499b8` | With `src/a/`, the direct entry and Trigger Table row keyed by `[src/a/b.ts](src/a/b.ts)` were not selected. | The focused suite passes 23/23 tests, including all four selection channels and the non-matching cases. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | AC-1 asserts both paragraphs, the unconditional subsection, and absence of blockquote text for both empty and unrelated Affected Files. AC-1b asserts the index/prose boundary, empty scaffold fallback, and H3 preamble boundary. AC-2 asserts the title line after cap demotion while the direct match remains full. AC-3 asserts nested path selection and rejects sibling/root-level matches. All were run before the fix against the base commit and failed for the missing behavior; the focused suite passes after the fix. |
| Restatement sweep | Searched `README.md`, `docs/`, `templates/`, and `.claude/skills/canon-init/write-guide.md` for Known Pitfalls selection, `Affected Files`, and directory wording. Updated every required surface. `docs/codebase-map.md` retains a generic accurate description of selection; `docs/pipeline-orchestrator.md` only lists the patterns document. |
| Sibling parity | `rowMatches()` routes direct entries, linked-doc entries, Trigger Table and Known Pitfalls index rows, and lessons through `tokenMatches()`. AC-3 tests each channel. H3 entries still use their existing relevance selection and are covered by the full suite. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2150 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npx tsx --test tests/pitfalls.test.ts` | Pass | 23 passed, 0 failed. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
