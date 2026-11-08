# Code Review: path-scoped-pitfalls

> Reviewer: Claude | Spec: `tasks/path-scoped-pitfalls/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

This is the first round after Amendment 1 (`spec.md` §"Amendment 1 — index-table scope and target-cell precedence (from code_review round 3 spec gap)"). The previous review cycle is archived in `review-prior-1.md`.

Lenses:
- Anchored Claude: returned `approve`, Stage 1 pass.
- Cold-Claude: returned `changes_requested`.
- Cold-Codex (injected): no actionable findings. It reports that type-check, lint, and sync-templates pass.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification. `npm test` skips 1 test: the linked-worktree `REPO_ROOT` write test, which the Codex sandbox gates. This diff does not touch that test.
- [x] Red-first evidence recorded for each red-first AC. The spec has no red-first ACs, and the handoff says so.
- [x] Self-Check evidence in the effective record is not contradicted by the diff. The Test-integrity row names a pre-fix run against `f8af39d` for the AC-4, AC-15 and AC-16 tests.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `buildKnownPitfalls` no longer appears in src, tests or dist. Both builders call `buildRelevantPitfalls` (`src/orchestrator/prompts/index.ts:361`, `:532`), which reads `extractAffectedFiles`. The call-site test passes `affectedFiles=[]` and still gets the match. |
| AC-2 | Pass | `tests/pitfalls.test.ts:45-52` covers the exact file, the directory prefix, and an unrelated entry listed as a title only. |
| AC-3 | Pass | `:54-76` covers the glob-matched linked doc, the "Open" line, titles only when unmatched, and relative-link resolution. |
| AC-4 | Pass | `:78-109` covers keyless rows, the `—` key cell, the matched marker, and a Trigger Table under an H3. The nested table carries a path token again. |
| AC-5 | Pass | `:178-217` covers H2/H3 targets, exact-before-prefix, a mixed cell, and `docs/patterns.md §Testing` with no other titles from that doc. |
| AC-6 | Pass | `:219-229` covers dedup. |
| AC-7 | Pass | `:231-239` covers the lessons subheading, Example scope, a fenced `###`, and CRLF input. |
| AC-8 | Pass | `:241-252` covers the token rules and the `:12-30` suffix strip. |
| AC-9 | Pass | `:254-324` covers demotion order, counts, "+N more in", and staying within the cap. |
| AC-10 | Pass | `:326-349` covers the independent channels. |
| AC-11 | Pass | `:370-398` covers the docs-root and patterns-path overrides. |
| AC-12 | Pass | All three snapshots show the matching entry in full and the other as a title. The anchored lens ran the focused suite: 97/97. |
| AC-13 | Pass | `:438-449`, on the real `docs/patterns.md`: 17.5 KB, not capped, and both sections are in full. |
| AC-14 | Pass | The docs, scaffold, write guide, README and codebase-map are updated. `sync-templates:check` and `docs-refs-check` pass; the anchored lens re-ran both. |
| AC-15 | Pass | `knownPitfallsIndexTables` (`src/orchestrator/pitfalls.ts:353-357`) keeps only the tables before the first H3. Tests are at `:111-123`. |
| AC-16 | Pass | `TARGET_HEADER_HINT` (`:89`, `:476`) handles header hints, with the tiered content fallback at `:484-506`. Tests cover the Lint row, the State row, a Section header beating an exact Area heading, a doc path beating an exact heading, and an exact heading beating a prefix. |

Restatement sweep: the anchored lens searched for "Known Codebase Pitfalls", "pre-inject" and `buildKnownPitfalls` across skills, `.canon/templates`, prompt templates and docs. Nothing stale remains.

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The amendment's two rules are implemented as written and pinned by tests:
- Index tables are only the tables before the first H3.
- The target cell comes from a header hint first, then the tiered content fallback.

Every finding from the previous cycle stays fixed. Cold-Codex found nothing. Cold-Claude reported many edge cases. On checking them against the code and the spec, none is a regression from pre-task behavior on a layout the spec or scaffold endorses. Most are behaviors the spec defines on purpose: the path-like token rule, the `**` Known Risk, and the Amendment B content fallback. The rest are robustness gaps in parsing the new index tables, recorded as nits below. No finding drives `changes_requested` or `spec_gap`.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

These are non-blocking. Consider each for a follow-up issue.

1. **Text in Known Pitfalls before the first H3 is now invisible.** Flagged by cold-Claude (high). Location: `src/orchestrator/pitfalls.ts:172`.
   - What happens: a `## Known Pitfalls` section whose entries are blockquotes or bullets directly under the H2, with no H3, now injects nothing. Those entries are not shown in full, not shown as titles, and not mentioned anywhere. The old builder injected the whole section.
   - Verified against the code.
   - Why it is not blocking:
     - `spec.md:34` defines entries as H3s only.
     - The judgment call at `spec.md:65` rejected the blockquote format on purpose.
     - The old scaffold placed blockquotes under category H3s. Adopters who followed it keep working: each category is an entry, and it is selected by the paths it cites.
     - canon-ai's own doc is all H3s.
   - Residual risk: `spec.md:55` claims "Zero migration … existing adopters", which is false for an adopter with no H3s at all, and the loss is silent.
   - Recommended follow-up: if a Known Pitfalls section has no H3 but has body text, treat the whole section as one entry, or at least as one title line. Alternatively, add a `canon doctor` warning.
2. **Index-table parsing is stricter than GFM.** Flagged by cold-Claude. Location: `src/orchestrator/pitfalls.ts:309` and `:283-286`.
   - `isSeparatorRow` requires at least three dashes (`-{3,}`). `splitCells` requires leading and trailing pipes.
   - Both `|--|--|` and pipe-less rows are valid GFM. A Trigger Table or split-docs index written that way is silently ignored.
   - The sibling parsers `isSeparatorRow` in `src/orchestrator/markdown-table.ts:45` and `src/orchestrator/quality-log.ts:135` already accept `-+`.
   - This is not a regression: the old builder never parsed these tables. Known Pitfalls H3 direct matches still work.
   - Fix: loosen the dash count to `-+`. This is a one-line change; add a test.
3. **The content fallback can mistake a key cell for the target.** Flagged by anchored and cold-Claude, so 2 lenses. Location: `src/orchestrator/pitfalls.ts:484-506`.
   - This applies only to tables whose headers carry no hint.
   - A `.md` key file in a key cell becomes a "linked doc" target. Example: `| Area | Rule | Files |` with `src/p/implement.md` in the Files cell.
   - A short area label prefix-matches an unrelated heading. For example, "K" matches "Known Pitfalls" and injects that whole H2.
   - Both behaviors are literal Amendment B.2 behavior (`spec.md:199`). The header hint protects every canon-documented layout.
   - Suggest adding this to Known Risks, or a follow-up that drops prefix matches shorter than N characters and drops `.md` candidates that sit next to another doc or section cell.

#### Optional Cleanup / Nit

- **Injected sections keep their original heading levels** (anchored + cold-Claude; `src/orchestrator/pitfalls.ts:734`). An injected `## Section` ends the `## Relevant Pitfalls…` block structurally, so `### Area index` reads as nested under it. Demote headings by one or two levels when embedding them.
- **Scaffold example cites `app/src/store/**`** (anchored + cold-Claude; `templates/docs/patterns.md:83`). Adopters with that tree get the placeholder injected until they edit it. AC-14 requires an example with full paths. Consider a clearly fake path.
- **`TARGET_HEADER_HINT` also accepts the plurals "docs" and "sections"** (anchored; `:89`). Amendment B.1 names "doc". In a header like `| Area | Related docs | Section |` the wrong column wins.
- **Trigger Table and Known Pitfalls are recognized only as H2** (anchored; `:469-472`). The spec does not fix the heading level. canon-ai and the scaffold both use H2.
- **Index table placed after the H3 entries** (anchored; `:353-357`). Amendment A makes this unsupported, but the failure is worse than a missing row. The table becomes part of the last entry's body, and its keys make that unrelated entry a direct match. The write guide and scaffold already say to put the table before the entries.
- **Demotion is greedy and never re-promotes** (anchored; `:751-765`). On a four-file real-docs task the block ends at about 19.9 KB of a 24 KB cap, with smaller demoted bodies that would have fit.
- **Malformed table rows lose their keys** (anchored; `:341-342`). Rows with the wrong cell count or unbalanced backticks are kept as raw text without their keys, and no marker says so.
- **Plain unbackticked doc paths are not recognized as linked docs** (anchored; `:379-392`).
- **`CANON_PATTERNS_MD_PATH` uses `??`; the docs root uses `||`** (anchored; `:818`, `:823`). Carried over from the old builder.
- **Handoff Self-Check lacks rows** (anchored). There is no Restatement-sweep row and no Sibling-parity row, and there is no Test-integrity evidence for `tests/run-task-prompts.test.ts`. The anchored lens's own sweep found no stale restatement, so this is an evidence gap, not a defect.
- **The `'none (spec has no Affected Files table)'` header branch is no longer covered by a test** (cold-Claude; `tests/run-task-prompts.test.ts:54`, `src/orchestrator/context.ts:104`). AC-12 required restructuring the golden fixture, which removed that coverage. A small dedicated test would restore it.
- **Linked docs are rescanned on every lookup** (cold-Claude; `:633`). `readLinkedDoc(...)?.text` drops the cached `MarkdownDoc`, so `scanMarkdown` runs again. This is bounded and does not affect correctness.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): root-level files (`package.json`, `README.md`) can never select an entry. `spec.md:31` defines a path-like token as one containing `/` or `*`, and AC-8 requires basenames never to match. A root file is indistinguishable from a basename, so this is the defined behavior. Silent omission is an accepted Known Risk (`spec.md:160`).
- Dismissed (cold-Claude): an Affected File given as a directory or glob does not match entries under it. `spec.md:32` defines Match one way, from the doc token to the Affected File. Affected Files are file rows.
- Dismissed (cold-Claude): `stripParenthetical` drops mid-string parentheticals like "Lint (TS) policy". `spec.md:36`: "Parenthetical prose inside an item is ignored." The behavior follows the spec, and the row still appears in the area index.
- Dismissed (cold-Claude): a backticked `**` matches every file, and brace globs are not supported. Accepted Known Risk "Broad globs" (`spec.md:163`), and `**` is a valid glob under the `spec.md:31` token rule.
- Dismissed (cold-Claude): `splitCells` keeps the backslash in `\|`, so a token becomes `a/|b`. This needs a path containing a literal pipe, which is not a realistic repository path, so there is no practical impact.
- Dismissed (cold-Claude): `docs/patterns.md` and `docs/lessons-learned.md` are not checked for realpath containment, and `CANON_PITFALLS_DOCS_ROOT` is honored in production. Both docs are fixed paths in the active checkout, and the old builder read them the same way, so the trust model has not changed. The env override follows the existing `CANON_BLAST_RADIUS_ROOT` pattern, and AC-11 requires it.
- Dismissed (cold-Claude): the AC-13 test reads canon-ai's live `docs/patterns.md`, which makes it fragile. AC-13 requires exactly this real-doc assertion.
- Cold-Codex: no findings to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
