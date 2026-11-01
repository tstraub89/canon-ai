# Code Review: spec-manifest-lint

> Reviewer: Claude | Spec: `tasks/spec-manifest-lint/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

This is the first review round after the operator's `--reroute` Amendment (AC-A1–AC-A5). The pre-reroute rounds are archived in `tasks/spec-manifest-lint/review-prior-1.md`. All three lenses returned valid output:

- **Anchored Claude:** `STAGE_1: pass`, signal `approve`.
- **Cold Claude:** 12 findings, signal `changes_requested`.
- **Cold Codex:** no actionable findings. It ran tests, type-check and lint, and all were clean.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did the implementer's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification. E2E is N/A per the spec.
- [x] Red-first evidence recorded for each red-first AC. AC-6 has two rows against `a4b4174`. AC-A2 has two rows against `2f7889c`, the commit before the amendment. Both pairs show the pre-fix failure with the value received. The carried-forward rows are intact.

The anchored lens independently re-ran everything in the worktree:

- `npm test`: 1,925/1,925 passed, 0 failed.
- `npm run lint`, `npm run type-check`, `npm run sync-templates:check` and `npm run docs-refs-check` all pass.
- A scratch `tsup` rebuild matches the tracked `dist/` except for an esbuild module-path comment.

The cold lens also got 1,925/1,925 on `npm test`.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Fused cells rejected | Pass | `fused-cells` fires only when an extra cell holds a backticked token. Tests cover the row number, the "one file per row" text and the `\|` escape hint. Prose-only extras and escaped pipes pass. |
| AC-2: Header-less blocks rejected | Pass | Tested: a table with no separator, a split at a blank line, and a split at a note line. |
| AC-3: Malformed path cells rejected | Pass | All seven listed cells are tested, plus a partial `<path>` sibling. Comma-joined and `dist/` cells pass. |
| AC-4: Ignored headings rejected | Pass | All five failing forms are tested, plus underscore-emphasis variants. A title with no table passes, and "Unaffected Files" passes. |
| AC-5: Duplicate exact heading rejected | Pass | Rejected within one H2, including an empty duplicate. Design plus Amendment Round 2 passes. |
| AC-6: Fenced/commented content excluded | Pass | All consumers use the shared scan `scanSpecManifest`/`visibleMarkdownLines`. Red-first evidence is recorded. |
| AC-7: Empty first cell rejected | Pass | Fires only when another cell holds a backticked token. Fully empty rows and prose-only continuation rows pass. |
| AC-8: Valid manifests pass, consumers unchanged | Pass (amended) | The no-table case was removed, as the Amendment requires. Other valid shapes pass. The live spec, including its Amendment, lints clean. Consumer path arrays for the 127 archived specs are unchanged. |
| AC-9: Spec gate hard-fails | Pass | `checkPhaseGate` lists every issue with the fix/rerun instruction and honors `taskDirOverride`. `CANON_SKIP_PHASE_GATE` bypasses it. |
| AC-10: Evidence recovery parks | Pass | `tryEvidenceAdvance('spec')` returns `advanced: false` with the issues, does not throw, and leaves spec `in_progress`. |
| AC-11: Plan/implement pre-flights | Pass | Both entries lint every bundle member before any status write, scaffold commit or agent session, and auto-block with exit 2. `--force` downgrades to a warning. Tests cover clean, blocked, forced and missing-manifest inputs, reroute in the active worktree, and fast-tier reroute. |
| AC-12: Adopter-safe messages | Pass | All 8 kinds are checked in both the gate and pre-flight formatted output for internal names. |
| AC-13: Restatements updated | Pass | `SPEC_MANIFEST_CONTRACT` is copied verbatim to the template, the prompt self-check, `spec-revision.md`, the `/canon-spec` skill and the foreman, and a carrier test pins it. `/canon-spec-review` item (3) is narrowed. Docs, mirrors and `--force` help are updated. No "not directories" wording remains. |
| AC-14: Lessons and backlog | Pass | The lesson is removed. BACKLOG (b) is split into done and open halves. |
| AC-15: Archive calibration | Pass | The anchored lens re-ran the counts over 127 specs and reproduced them. Samples are classified. |
| AC-A1: missing-manifest | Pass | Fires for no Design section, a heading with no table, and a header-only table. A Design manifest plus a table-less Amendment passes. Gate and both pre-flights are tested. See N1 for a narrow edge case. |
| AC-A2: unclosed-block | Pass | Names the construct and its 1-based opening line, and resets on close. Red-first rows are recorded. Well-formed fences and comments are clean. See N3 for one CommonMark false positive. |
| AC-A3: foreman contract + example | Pass | The rendered foreman contains the contract and a two-column example. The test lints the example and extracts its path. Golden regenerated. |
| AC-A4: docs + grep | Pass | Docs and mirror require a Design manifest and reject unclosed constructs. Grep for "a spec with no scope table is valid" over `docs/`, `templates/` and `src/` finds nothing. |
| AC-A5: recalibration | Pass | `missing-manifest` = 3, each a standalone H2 table that is a real defect. `unclosed-block` = 0. No archived specs were edited. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work). Every changed source, test, doc, template and dist file is in the Design or Amendment Affected Files table.
- [x] Known Risks addressed or documented as accepted. The full-send/delicate `--force` interaction is documented in `docs/pipeline-orchestrator.md`.
- [x] Human Test Plan is satisfiable by the implementation. Step 4 was updated in place, as the Amendment requires.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is sound. The lint and every manifest consumer share one visibility and table-block scan, so they cannot disagree about which tables exist. The pre-flights sit before any state mutation or agent session, and test coverage is thorough. Cold-Codex found nothing. Every verified finding from the Claude lenses is a narrow edge case, an explicit spec choice, or prompt-wording polish. None makes shipped behavior worse than `main` in a silent way:

- The one confirmed regression against `main` (N3) fails loudly at `spec done` and has an obvious fix.
- The residual lint gaps (N1, N2) still fail later at the existing `code_review` scope pre-flight, exactly as they do today.

I ranked them by confidence × severity, and all land as non-blocking follow-ups.

### Findings

#### Correctness Bugs

(none blocking — see the nits below for confirmed low-severity edge cases)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **N1 — A Design table with only blank rows satisfies `missing-manifest`.** Flagged by the anchored lens and verified by foreman probe. `src/orchestrator/validation.ts:1978` checks `block.rows.length > 0`, so a header, a separator and a fully empty row together count as a manifest with nothing in scope. The probe returned `[]`. This contradicts the handoff's own "readable data row is required" interpretation. It is unlikely in practice: the template row is a `<path>` placeholder, which is already flagged. The spec still fails later at the `code_review` scope pre-flight. Follow-up: require at least one row with a non-empty first cell. Altitude: code-bug, low severity.
- **N2 — Markdown-link paths escape `fused-cells` and `empty-first-cell`.** Flagged by cold-Claude and verified by foreman probe. `hasToken` at `src/orchestrator/validation.ts:1935` matches only backticks. `parseHandoffPathCell` also accepts the deleted-file link form `[old.ts](old.ts)`. A fused link cell, or a link in a row whose first cell is empty, lints clean and is dropped silently, as it is on `main`. The predicate is the one the spec chose: AC-1 says "an extra cell contains a backticked token", AC-7 says "a backticked token in another cell", and the Implementation Notes say "gate … on … a backticked token". So this is a known limit of the spec's design, not an implementation slip. Follow-up: widen `hasToken` to the link form. Altitude: spec-gap, low.
- **N3 — A list-nested fence whose closer is indented 4–6 spaces is reported as unclosed.** Flagged by cold-Claude and verified by foreman probe. The closer regex at `src/orchestrator/markdown-table.ts:193` allows only 0–3 leading spaces. CommonMark measures that indent from the list item's content column. Take a `1. step` item with the opener at 3 spaces and the closer at 4 spaces: the lint returns `unclosed-block` plus `missing-manifest`, and `parseAffectedFilesFromSpec` returns `[]` where `main` returned the path. This is the one consumer regression against `main`. It is loud, though: `spec done` and the pre-flights reject it with a clear "close the fence" message. Archive calibration found 0 `unclosed-block` hits in 127 specs. Follow-up: tolerate a closer indented further than its opener, or match the opener's indent. Altitude: code-bug, low severity.
- **N4 — The foreman contract paragraph is misplaced and claims a re-check that doesn't happen.** Flagged by 2 lenses, anchored and cold-Claude. At `src/orchestrator/prompts/templates/code-review-foreman.md:89` the verbatim contract sits between list items 2 and 3 with no blank line, so it renders as a lazy continuation of item 2. It also ends "canon re-checks it before planning and implementation". A full-send amendment the foreman writes on an approved path is never re-linted. The post-review scope check only warns about malformed rows. AC-A3 requires the contract in the foreman prompt, and Decision 2 covers foreman amendments only when they are "present by then". So the gap is a known limit of the design, and the contract text plus the linted example is the intended mitigation. Follow-up: add a blank line, and consider a foreman-specific closing sentence.
- **N5 — The generic trailing instruction doesn't fit every issue kind.** The anchored lens flagged this, and cold-Claude flagged a related wording issue. The spec-gate reason (`src/orchestrator/validation.ts:964`) and the pre-flight message always end "Fix the `### Affected Files` table". For `unclosed-block`, and for `missing-manifest` with no Design section, there is no table to fix. Each per-issue message does give the correct fix, and AC-9 mandates the trailing instruction. Similar small wording issues:
  - The `missing-manifest` message gives no hint when a GFM table lacks leading pipes.
  - The `empty-first-cell` message says "a path" when the backticked token is an identifier.
- **N6 — The implement pre-flight's block changes how the implementer prompt is chosen after a fix.** Flagged by cold-Claude and partly verified by the foreman. `autoBlockPhase(…'implement'…)` at `src/orchestrator/phases/implement.ts:49` overwrites `implement.status` to `blocked`. Only one route is affected: an interrupted, `in_progress` implement whose spec is malformed. Once that spec is fixed:
  - Claude mode reruns with the park-resume prompt.
  - Mixed mode starts a fresh session instead of the resume prompt.

  Other routes are unaffected:
  - A first-run implement has no implementer session, so it gets the fresh prompt.
  - Reroute and revision keep precedence.

  The spec mandates the auto-block, "the same way the `code_review` scope pre-flight does". The degraded route is a rare combination, but worth noting.
- **N7 — `parseAllTablesH3` is now dead in production.** Flagged by cold-Claude. `src/orchestrator/markdown-table.ts:172` is used only by tests, and the module carries two visibility models (`computeCommentHiddenLines` and `visibleMarkdownLines`). Keeping the non-manifest scanners unchanged was deliberate and protects AC-8, as recorded in `notes.md` and the handoff Deviations. Removing the dead function is optional cleanup.
- **N8 — The contract says "exactly one" heading per Amendment section, but Amendments may omit the table.** Flagged by the anchored lens. Amendment item 1 explicitly says the contract is "accurate as written", so this is a settled spec decision. A future wording pass could say "at most one per Amendment".
- **N9 — The AC-8 own-spec test lints a snapshot of the Design table only.** Flagged by the anchored lens. The snapshot lives in `tests/run-task-validation.test.ts`, and the live spec including its Amendment lints clean by probe. This is coverage drift only.
- **Cosmetic:** `plan.ts` has a doubled blank line after the pre-flight, and the new imports in `plan.ts`/`implement.ts` sit above the existing import group. Flagged by cold-Claude.

#### Spec Gaps

(none blocking — N2 traces to the spec's backtick-only predicate and is recorded above as a follow-up)

### Dismissed Cold Findings

- Dismissed (cold-Claude): A heading like `### Affected Files parser drift` above a Risk table in `## Known Risks` blocks `spec done` as `ignored-heading`. This is spec-intended. AC-4 defines the predicate exactly: a heading containing "Affected Files", case-insensitive, with a `|` table in its section, that the parser would not read. The only passing case the spec names is a heading with no table.
- Dismissed (cold-Claude): A continuation row whose only content is a backticked identifier trips `empty-first-cell`, and an unescaped `|` inside a Change-column code span trips `fused-cells`. Both are spec-intended. AC-7 rejects "a row with an empty column 1 and a backticked token in another cell". AC-1 together with the "Escaped pipes" Known Risk covers the pipe case, and the message points to `\|`. The message-wording part is folded into N5.
- Dismissed (cold-Claude): One `--force` bypasses unrelated gates, and full-send on a delicate task needs `--force`, which downgrades the pre-flight. This is spec-intended. Decision 2 and AC-11 make `--force` the bypass. The plan notes and `docs/pipeline-orchestrator.md` document the full-send/delicate interaction.
- Dismissed (cold-Claude): `lintSpecManifestForTasks` fails open when `spec.md` is missing, and non-ENOENT read errors throw. Reaching plan or implement without a `spec.md` is not possible through normal routing, because the `spec done` gate requires the file. EACCES/EISDIR are environment faults outside this gate's purpose.
- Dismissed (cold-Claude): Duplicate header names such as `| File | File |` collapse in `blocksToRecords`, so the consumer reads a different cell than the lint does. This is pre-existing: `main`'s `parseAllTablesH3` built the same header-keyed record. AC-8 requires consumer behavior to stay unchanged, and the input is contrived.
- Dismissed (cold-Codex): none. Cold-Codex reported no actionable findings.

Each remaining cold-Claude finding is a merged or kept nit above: foreman wording and gap (N4), message wording (N5), the lifecycle issue (N6), dead code (N7), and the cosmetic items.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Recommended follow-ups, suitable for one small issue: N1 (require a non-empty first cell for scope), N2 (link-form paths in `hasToken`), N3 (tolerate an indented fence closer), and N4 (foreman paragraph placement and wording).

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
