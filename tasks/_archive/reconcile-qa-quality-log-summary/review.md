# Code Review: reconcile-qa-quality-log-summary

> Reviewer: Claude | Spec: `tasks/reconcile-qa-quality-log-summary/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Lens signals this round:** anchored = approve (all 12 ACs met, all validation independently re-run green, red-first empirically confirmed); cold-Codex = approve (specified behavior implemented, full suite passes); cold-Claude = changes_requested (10 findings, all low/medium). The foreman adjudicated the cold findings against the spec: no code-bug and no blocking spec-gap survives; the surviving items are non-blocking nits.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens independently re-ran `npm run lint`, `npm run type-check`, `npm test` (1039 pass / 0 fail / 1 env skip), `npm run build` (committed `dist/` matches a fresh build byte-for-byte), and `npm run docs-refs-check` — all green. `sync-templates:check` is correctly excluded (no edited file is in `CANON_OWNED`; `templates/docs/task-quality-log.md` is a hand-maintained seed, edited explicitly per AC-10).

### Acceptance Criteria Check

Cross-reference **every** AC from the spec. Missing an AC from this table is itself a Stage 1 failure.

| AC | Status | Notes |
|---|---|---|
| AC-1: derived counters, red-first | Pass | Red-first empirically reproduced (stale `1/1` survives with the writer disabled; `6/2` after). Absent-counter case → `0/0` covered by `upsertQualityLogRow(file, {taskId}, {})`. |
| AC-1b: Date / Size binding | Pass | Test seeds distinct `created`/`updated` sentinels and asserts `Date` = today UTC and equal to neither; `Size` covers explicit, absent (`M`), and delicate-suffix. |
| AC-2: upsert — exactly one row | Pass | Two writes converge to one row; second-pass counters + judgments win. |
| AC-3: placement + relocation | Pass | Periodic, anchorless, and below-Periodic-stray fixtures each leave exactly one row inside `## Log`. |
| AC-4: judgment cells + serialization | Pass | Five cells write/preserve; `a\|b` exact round-trip through `parseTable`, `\n`/`\r\n` → single space, cell count preserved. |
| AC-4b: header-driven adopter columns | Pass | Adopter column before a canon column preserved on update / empty on insert; missing canon header → warn + file byte-unchanged. |
| AC-4c: duplicate precedence | Pass | Earliest `Spec verdict` / latest corrigible cells survive for in-table and stray-below-Periodic duplicates; sibling rows byte-stable. |
| AC-5: no unsound reroute derivation | Pass | `QualityLogDerived` has no reroute field; `reroute_count: 2` fixture keeps `Human reroute? = No`. |
| AC-6: all four qa→done paths | Pass | Salvage branch (`qa.ts`) funnels through `taskPhase`; evidence-advance subprocess asserts the row; operator `taskCmd` dispatch covered; agent command reaches `taskPhase` by construction. |
| AC-7: fail-soft | Pass | Malformed → warn + unchanged + done; unwritable → warn + done; absent → scaffold + row + done. Double-guarded (both writer functions try/catch). |
| AC-8: attempt history untouched | Pass | `status.json`, `spec-review.md`, `review.md`, and sibling rows asserted byte-unchanged. |
| AC-9: prompt + derived copies | Pass | `qa.md` rewritten to the `done.md` block contract; golden regenerated and passing; both `dist/` bundles carry the writer. |
| AC-10: stale append-only prose | Pass | Both log-file headers + `XS` size domain; all three `architecture.md` sites incl. the removed false `autoBlockPhase()` append claim; `decisions.md` entry added. |
| AC-11: test isolation (override) | Pass | Override redirects the write; isolation test asserts repo log content + mtime unchanged; full suite leaves the real repo log byte-clean. |
| AC-12: validation suite green | Pass | Independently re-ran all five checks + dist parity — all green. |

### Dropped Sections Check

- [x] Non-goals respected (no event log, no qa-done gate, no `status.json` schema growth, no unsound `Human reroute?` derivation, no retroactive cleanup of other tasks' rows, no column-schema change)
- [x] Known Risks addressed or documented as accepted (in-transition write is double-guarded fail-soft per AC-7; fail-soft-loses-a-row tradeoff accepted by the spec; `Human reroute?`/`Spec verdict` remain corrigible agent judgment)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-factored implementation. The writer is a small pure-ish pipeline (locate table → parse in-Log + stray rows → reconcile per-cell precedence → build derived+judgment row → atomic replace), keyed entirely off the live table header so adopter columns survive by name rather than position. The load-bearing risk for this delicate task — a throw inside the `qa → done` transition — is contained by two nested try/catch layers (`upsertQualityLogRow` and `writeQualityLogForTask`), each of which warns and returns; the anchored lens traced every throw site and confirmed none can escape. The serialization contract (escape backslashes before pipes) is implemented correctly and its regression guard (`a\|b`) passes. No correctness bug survived across the three lenses. Surviving items are low-severity robustness and coverage nits.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none blocking — see nits)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **Gap-duplicate rows are unreconciled** (`scripts/run-task/quality-log.ts:184-217`, cold-Claude). A duplicate task row sitting *between* the `## Log` table's trailing blank line and `## Periodic Reviews` is scanned by neither `parseLogRows` (`[dataStart, dataEnd)`, stops at the first non-`|` line) nor `parseStrayRows` (scans only after `## Periodic Reviews`), so it would survive as a second row. The mechanism is real, but the trigger state is not produced by this writer (it always inserts contiguously at `dataEnd`) nor by the old below-Periodic append; spec Decision item 5 + AC-4c scope reconciliation to in-`## Log` duplicates and below-Periodic strays, both fully met. A hand-edit-only edge case — worth a follow-up guard but not blocking.
- **Fixed temp path, no cross-process lock** (`scripts/run-task/quality-log.ts:278-291`, cold-Claude + anchored). `writeFileAtomic` uses a fixed `${filePath}.tmp`; two processes writing the same log concurrently could drop a row (last-writer-wins on the read-modify-write, ENOENT on the loser's rename → swallowed with a warning). Outside canon's sequential execution model (bundle members call the transition in a loop, not in parallel), so unreachable in practice.
- **`locateLogTable` does not skip code fences / HTML comments** (`scripts/run-task/quality-log.ts:137-158`, cold-Claude). Unlike `scanAllTables`/`extractSectionBodies` in `markdown-table.ts`, it would treat a `## Log` heading or canonical header row appearing inside a ```` ``` ```` fence or `<!-- -->` block as the real table. No real-world impact — neither `docs/task-quality-log.md` nor the seed contains a code fence (verified) — but a robustness gap vs. the existing parser convention.
- **`parseStrayRows` is broad below `## Periodic Reviews`** (`scripts/run-task/quality-log.ts:202-217`, cold-Claude). It reconciles/removes any post-heading `|` row whose column count matches the header and whose Task cell equals the task id — including, in principle, a legitimate row inside a genuine Periodic-Reviews table. Spec says no data rows live below that heading, so this is intended cleanup; the collision requires an adopter Periodic-Reviews table with matching column count *and* the task id in the Task-position cell. Edge case.
- **CRLF / lone-`\r` line-ending handling** (`scripts/run-task/quality-log.ts` — `normalizeCellValue` and the file split/rejoin, cold-Claude). `normalizeCellValue` flattens `\r\n`/`\n` inside a cell but not a lone `\r`; the file is split/rejoined on `\n`, so a CRLF log gets one LF-terminated new row among CRLF lines. Cosmetic mixed line endings.
- **Empty (0-byte) existing log is treated as malformed, not scaffolded** (`scripts/run-task/quality-log.ts:298-320`, anchored). Scaffolding fires only on `ENOENT`; a truncated-to-empty log yields `locateLogTable → null` → warn + no write. Within the AC-7 contract (absent = ENOENT), but a re-seed on empty would be friendlier.
- **Coverage nits** (tests, cold-Claude + anchored). No worktree-routing regression test for the log path — the code is correct (it reuses `taskCwd = resolveTaskCwd(id)`, the same active-checkout root that routes the status write, with no independent `REPO_ROOT` reference), and AC-11 proves the override works, but a future refactor swapping `taskCwd` for a `REPO_ROOT`-derived path would pass every existing test. Also no explicit test for the "remove the final line and append" branch (`dataEnd >= lines.length` with the final row removed); both lenses verified the loop logic is correct, so this is a coverage, not correctness, gap.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong.

(none — the gap-duplicate nit above brushes the boundary of Decision item 2's general "relocate a row sitting outside the table" prose, but item 5 and AC-4c enumerate the specific configurations to reconcile and the implementation meets them; not a blocking ambiguity.)

### Dismissed Cold Findings

> Cold-lens findings dropped after verification.

- **Dismissed (cold-Claude): the quality-log write dirties `docs/task-quality-log.md` but nothing in the diff commits it.** Verified false as a defect: `docs/task-quality-log.md` is in `PIPELINE_TELEMETRY_FILES` (`scripts/run-task/worktree.ts:11`) and is committed by the existing `commitQaArtifacts` QA-end commit (reached via the human_review branch in `scripts/run-task/main.ts`), which the spec's Interaction Dependencies explicitly relies on ("auto-committed at the QA-end commit and base-drift-exempt"). This is unchanged from the prior behavior, where the QA agent wrote the same row into the same file. The operator-manual path (`canon task phase … qa done`) leaves it dirty for the operator to commit — also unchanged. No regression.
- **Dismissed (cold-Claude): recomputed derived columns overwrite a correct historical value with a default (e.g. missing `task_size` → downgrade to `M`).** Spec-intended: Decision item 5's precedence table states derived cells are "Not applicable — always recomputed from task state," and item 3 fixes `Size = task_size ?? 'M'`. Absent `task_size` is normally impossible; when absent, `M` is the specified output, not a bug.
- **Dismissed (cold-Claude): QA-supplied `Spec verdict` overrides earliest-wins reconciliation, erasing the reroute signal.** Spec-intended: Decision item 5 closes with "QA-supplied values for the current pass take precedence over all reconciled history," and the rewritten `qa.md` prompt instructs QA to *omit* `Spec verdict` on a re-upsert precisely so the earliest persists. A QA agent wrongly re-supplying it is the corrigible-judgment risk the spec accepts in Known Risks — not a code defect.
- **Dismissed (cold-Claude): the "does not infer human reroutes" test asserting `status.json`/`spec-review.md`/`review.md` unchanged is near-tautological.** This is exactly what AC-8 mandates (a byte-unchanged guard against a *future* mutator), and the meaningful AC-5 assertion (`Human reroute?` stays `No` despite `reroute_count: 2`) is present in the same test. The framing is intentional, not vacuous coverage of broken product code.
- **Dismissed (cold-Codex): no specific findings.** Cold-Codex returned a clean approve ("changes implement the quality-log upsert as specified; type-check, lint, build, template checks, and full suite pass"). Corroborated by the anchored lens's independent re-run.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

The implementation meets all 12 ACs with real, non-vacuous tests and a correctly-contained fail-soft writer. The surviving nits are non-blocking robustness/coverage items — the gap-duplicate guard and a worktree-routing test are the two most worth a follow-up, neither reachable in canon's current execution model or required by the spec's enumerated cases.
