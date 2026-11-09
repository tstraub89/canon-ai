# Code Review: pitfalls-coverage-gaps

> Reviewer: Claude (foreman) | Spec: `tasks/pitfalls-coverage-gaps/spec.md`

Synthesized from the anchored Claude lens, the cold-Claude lens, and the injected cold-Codex findings (no actionable regressions).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (Red-First Evidence rows against pre-fix code)
- [x] Self-Check evidence in the effective record is not contradicted by the diff

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Prose-only fallback | Pass | `knownPitfallEntries` adds an unconditional H2-titled entry, rendered under its own "included regardless of your files" subsection; blockquotes dropped. Test added, red-first row present. |
| AC-1b: Fallback boundaries | Pass | Index-table lines excluded from prose and kept in the area index; scaffold-without-example yields no prose entry; H3 sections skip the preamble. |
| AC-2: Cap demotion | Pass | Entry uses the `direct` channel, so it is demoted after lessons, section targets and linked-doc entries; test asserts the title-only line remains. |
| AC-3: Directory Affected Files | Pass | `tokenMatches` handles directory files via prefix and `globCouldMatchInsideDir`; tests cover entries, index rows, linked docs, lessons, glob and negative cases. Red-first row present. |
| AC-4: Tests | Pass | `tests/pitfalls.test.ts` 23/23 on re-run; handoff reports full suite green; no goldens regenerated. |
| AC-5: Docs | Pass | `docs/patterns.md`, `templates/docs/patterns.md`, `README.md`, canon-init write guide (root and mirror) all updated; `dist/` rebuilt. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

The change is small, contained in `src/orchestrator/pitfalls.ts`, and matches the spec's decisions. Directory matching is segment-aware and handles `**` and the boundary cases. No lens found a blocking defect; all surviving items are low-severity nits.

### Findings

#### Correctness Bugs

(none)

#### Nits (non-blocking)

- **Blockquote lazy continuation over-strips** — `src/orchestrator/pitfalls.ts:397-404` (`proseFallbackBody`). Every non-blank line after a `>` line is dropped until the next blank line, so a list item, sub-heading or fence opener placed directly under a quote with no blank line is lost. Flagged by 2 lenses (anchored, cold-Claude). Altitude: code-bug (low). The spec says "all blockquote paragraphs removed", so paragraph-level stripping is within spec; the edge is rare. Optional follow-up: end the quote on list/heading/fence starts.
- **Non-index tables in a no-H3 section are stripped** — `src/orchestrator/pitfalls.ts:383-407`. With no H3, `knownPitfallsIndexTables` spans the whole section, so any table mid-prose is treated as an index table. Matches the spec's "tables directly under the H2" and existing index parsing; untested. Anchored lens only.
- **Dedup interaction with nested section targets / same-span targets** — `addCandidate` / `candidateCovered` (anchored lens, cold-Claude). If a Trigger Table row targets the prose-only H2 itself (same span), the section candidate can replace the unconditional one and render blockquotes under "cite your files"; a nested H4 target is hidden by the H2 span. Unlikely fixture shape; low confidence.
- **Test robustness** — `tests/pitfalls.test.ts` AC-1b scaffold test depends on the template's example H3 title via regex, and the AC-2 demotion test's `- Known Pitfalls` regex is loose. Cold-Claude. Optional hardening.

## Dismissed Cold Findings

- Dismissed (cold-Claude): Placeholder/`TODO[canon]` stubs in an un-customized adopter `patterns.md` get injected - the spec deliberately strips blockquotes (where the scaffold keeps its TODO and format guidance) and records this as a decided tradeoff; non-blockquote stubs are the adopter's content.
- Dismissed (cold-Claude): A pitfall citing the directory without a trailing slash (src/a) does not match directory `src/a/` - the spec's boundary treats `src/a/` as the directory form; no test or AC requires the slashless form, confidence low.
- Dismissed (cold-Claude): Brace/`?` glob syntax in `globCouldMatchInsideDir` untested - speculative; `matchesDocsGlob` is the existing per-segment matcher and the new helper only delegates to it.
- Dismissed (cold-Codex): none raised; no actionable regressions reported.

## Final Verdict

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**
- [ ] **Spec gap**
