# Code Review: canon-prune-skill

> Reviewer: Claude (foreman) | Spec: `tasks/canon-prune-skill/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: the anchored Claude lens (Stage 1 / Stage 2 charter), the cold-Claude lens (diff only), and the pre-obtained cold-Codex review. All three returned valid results.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (none are red-first)
- [x] Self-Check evidence in the effective record is not contradicted by the diff

The anchored lens re-ran `npm run sync-templates:check` (pass), `npm run docs-refs-check` (pass) and the `checkSkills` / README tests in `tests/cli.test.ts` (13 passed). Full `npm test`, lint, type-check and build were not re-run by the review; the handoff records them as Pass, and the `dist/cli/index.js` diff contains exactly the three expected changes.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Frontmatter, description triggers, human-invoked, lessons-buffer exclusion, required `allowed-tools`; canon-sweep's description unchanged. |
| AC-2 | Pass | Six steps in order; preflight referenced to canon-sweep §"Preconditions"; routed pitfall docs discovered from the table, gated on existence. See Finding 1 for the read-rule conflict this reference creates. |
| AC-3 | Pass | Managed set named by kind; high-level-only rule with keep / delete / mixed examples; no `canon-ai` match. |
| AC-4 | Pass | Three default groups, read-only, light model; per-rule location, form, gist, six evidence items, verdict; no delete on "covered elsewhere". |
| AC-5 | Pass | Rule-form only; source reread before merge; home via canon-sweep §"Step 2 — Choose the smallest carrier"; cluster verdict replaces member verdicts. |
| AC-6 | Pass | Exactly four verdicts; duplicate is merge; no `demote`. |
| AC-7 | Partial | Guard tag and path-citing H3 home present, but the guard misses routing-table rows, no-H3 Known Pitfalls prose, and Trigger Table targets (Finding 2). |
| AC-8 | Pass | Remove-and-measure default; ablation human-requested only. |
| AC-9 | Pass | Batched triage, merges last, per-row approval; file-disjoint editors; docs validation always, full validation for non-doc changes; no commit. |
| AC-10 | Pass | Fixed prefix plus `Canon-Prune:` trailer; Reviewed-and-kept format; lookup, matching, re-propose conditions, skip list, no log file. |
| AC-11 | Pass | Only the Recurrence clause changed; mirror synced. See Finding 4. |
| AC-12 | Pass | Only `src/lib/canon-owned.ts` and `src/cli/commands/doctor.ts` changed outside `dist/`; doctor change limited to `RECOMMENDED_ALLOW` and `checkSkills`. |
| AC-13 | Pass | Sync and docs-refs checks pass; no canon-ai source paths in the shipped skill. |
| AC-14 | Pass | `CANON_OWNED`, `checkSkills`, `RECOMMENDED_ALLOW`, README (table, JSON, install sentence), canon-init allowlist, `.claude/settings.json`, tests. |
| AC-15 | Partial | Prune group, PRUNE verdicts, individual triage, prompt-template follow-ups present; applying §"Verdicts" verbatim to canon's own docs is wrong (Finding 3). |
| AC-16 | Pass | One `canon-prune` sentence in each lessons-learned file. |
| AC-17 | Pass | Added and Changed entries name the doctor warnings and the upgrade / settings steps. |
| AC-18 | Pass | Identical sentence in the README after the nudge block and in canon-init (root equals mirror); `RECOMMENDED_NUDGE` untouched. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted (except "Silent loss from implement prompts", whose mitigation is incomplete; Finding 2)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

The two Partial rows are scoped defects in otherwise complete work, so they are carried as Stage 2 findings rather than a Stage 1 send-back.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The wiring (managed set, doctor, allowlists, README, tests, mirrors, changelog) is complete and consistent. The new skill follows the spec closely, but three behavioral defects in the skill text would mislead the agent that runs it: a self-contradictory read rule, an under-scoped implement-prompt guard, and a docs-audit pass that inherits a delete criterion that cannot apply to canon's own docs.

### Findings

#### Correctness Bugs

1. **`code-bug` — "Canon-managed files are never read" contradicts the skill's own references to canon-sweep.** Flagged by 3 lenses (cold-Codex P2, cold-Claude, anchored). `.claude/skills/canon-prune/SKILL.md:20` (and the description at line 3, line 57, line 110) says canon-managed files are never read; line 47 tells the agent to run the preflight in `.claude/skills/canon-sweep/SKILL.md` §"Preconditions" and line 72 tells it to choose a home from canon-sweep §"Step 2 — Choose the smallest carrier". canon-sweep is canon-managed. An agent following the absolute rule skips the preflight and the carrier table; one following the steps breaks its scope rule. Also, that §"Preconditions" section is written for the sweep: it says "Triage (Steps 1 to 3)… Before applying anything (Step 4)" and its "Read before triaging" list starts with reading `docs/lessons-learned.md` in full, which is out of prune's scope. The spec's intent (Judgment Calls row "Canon-managed files in adopter repos": never used as a comparison set) is that managed files are not prune *input*. Fix: scope the rule to "never reviewed, inventoried or edited as prune input", name the two canon-sweep sections as the explicit exception, and say that only the three preflight check bullets apply, before the prune's Step 5 apply (not the sweep's step numbers or its read list). Apply the same wording to the description and the closing "does not do" line, and resync the mirror.

2. **`code-bug` — the implement-prompt guard misses three ways a prune drops content from implement prompts.** Flagged by 2 lenses (anchored as spec gap, cold-Claude). `.claude/skills/canon-prune/SKILL.md:39` covers only Known Pitfalls H3 entries and routed-doc H3s. Verified in `src/orchestrator/pitfalls.ts`:
   - Deleting or relocating a row of the `Read this doc` / `Before touching` routing table stops routing that whole doc, so every H3 in it leaves implement prompts. Step 2 classifies such rows as `pointer`, making an untagged `delete` likely. This is inside the spec's own wording ("any verdict that would remove such an entry").
   - When §"Known Pitfalls" has no `###` entries, its prose is injected whole regardless of Affected Files (`src/orchestrator/pitfalls.ts:790`). Deleting or relocating that prose is untagged.
   - `buildIndexRows` (`src/orchestrator/pitfalls.ts:520`) reads `## Trigger Table*` rows and injects the section a matching row targets (including `doc-section` targets in other docs, line 469/732). Deleting such a row, or the section it targets, silently drops that guidance.
   Failure: an approved row removes guidance from every matching implement prompt with no "removes from implement prompts" tag, which is exactly the spec's Known Risk "Silent loss from implement prompts" that AC-7 exists to mitigate. Fix: extend the guard to routing-table rows, no-H3 Known Pitfalls prose, and Trigger Table rows plus their target sections, stated in adopter-readable terms (no canon-ai source paths). The Trigger Table case goes beyond the spec's literal guard definition but serves its stated mitigation; if the implementer judges it out of scope, record that as `[ambiguity]` in the handoff rather than dropping it silently.

3. **`code-bug` — docs-audit applies a delete criterion that cannot apply to canon's own files.** Anchored lens. `.claude/skills/docs-audit/SKILL.md:26` applies `/canon-prune` §"Verdicts" by reference to canon-ai's `CANON_OWNED` set. That list includes "delete — … describes a canon mechanism", which is right for adopter docs but wrong for `docs/pipeline-orchestrator.md` and the canon-* skills, whose job is describing canon's mechanisms. Failure: audit agents following the reference propose PRUNE delete rows against core shipped content, flooding triage. Fix: state in the Prune row that the "describes a canon mechanism" delete criterion and §"High-level canon mentions only" do not apply to the managed set.

#### Risk / Guardrails

4. **sweep recurrence check counts any `git log -S` hit.** Flagged by 2 lenses (anchored, cold-Claude). `.claude/skills/canon-sweep/SKILL.md:48`: `-S` also returns the commit that added the phrase and ordinary rewordings; the clause gives no way to confirm the hit was a prune removal. Failure: a lesson counts a prior "occurrence" that was never pruned, loosening the twice-bitten bar. Fix (stays within AC-11's single clause): count it only when the commit that removed the phrase is a `docs: canon-prune` commit or carries a `Canon-Prune:` trailer. Resync the mirror.

#### Optional Cleanup / Nit

5. **Validation commands are not pre-approved in `allowed-tools`.** Flagged by 3 lenses (cold-Codex P2, cold-Claude, anchored). `.claude/skills/canon-prune/SKILL.md:4` pre-approves only `node scripts/docs-refs-check.mjs*`; Step 5's full validation commands and any `npm run …` docs check will prompt. Cold-Codex says they "will be blocked"; that overstates it: `allowed-tools` pre-approves listed tools, and unlisted ones go through the normal permission prompt, which is acceptable for a human-invoked interactive skill. Downgraded to a nit; optionally say in Step 5 that these commands may prompt.
6. **docs-audit file-disjoint apply overlaps.** Anchored lens. `.claude/skills/docs-audit/SKILL.md:26` — the new Prune group covers files also owned by the Pipeline and Skills + templates groups, while step 3 assigns one editing agent per group with no shared files. Optionally add "assign PRUNE rows to the agent that owns the file".

#### Spec Gaps

(none — Finding 2's Trigger Table case is routed to the implementer under the spec's Known Risks mitigation; see its fix note)

### Dismissed Cold Findings

- Dismissed (cold-Claude): a routed pitfall doc that is canon-managed creates an unresolved scope conflict, and the out-of-scope list is a hand-written copy of `CANON_OWNED` - "never read, inventoried or edited" plainly wins over the in-scope list, and naming the set by kind is the spec's accepted Known Risk ("The canon-managed list in the skill drifts from `CANON_OWNED`").
- Dismissed (cold-Claude): the prune record is lost if a squash merge replaces the commit body - the spec's Judgment Calls row "Prune record" chose a commit-message record with no log file; the `Canon-Prune:` trailer lookup already handles squash merges that keep the body. Accepted design.
- Dismissed (cold-Claude): no test pins the canon-init allowlist to `RECOMMENDED_ALLOW` - the gap predates this diff and the lens confirmed the lists match now; not a defect introduced here.
- Folded, not dismissed (cold-Claude): the borrowed preflight uses canon-sweep's step numbers - merged into Finding 1.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Address Findings 1–4; 5–6 are optional.

---

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Delta — base `df6a894d699698a8b01c91a91679873f57b2793a` — reason: small fix within the files already under review

Lenses: anchored (full diff vs `main`, spec, handoff, Round 1 review), cold-Claude (delta only), cold-Codex (delta only; no actionable defects). All three returned valid results.

### Stage 1 — Acceptance Criteria Re-Check

Validation: the Iteration 2 re-run table has no Fail rows (`npm run sync-templates:check`, `npm run docs-refs-check`, `npm test` 2,248 passed / 1 skipped, `git diff --check`). Lint, type-check and build were not re-run; justified because the delta touches only Markdown (confirmed: no `src/` or `dist/` change). The anchored lens re-ran sync and docs-refs (both pass). Red-first: none required. Effective Self-Check: Iteration 2 rows for restatement sweep and sibling parity; baseline row for test integrity (no tests changed). None contradicted by the diff.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Description now scopes the exclusion to prune input and names the two operating-instruction reads. |
| AC-2 | Met | Steps in order; only the three check bullets of canon-sweep §"Preconditions" apply, before apply. |
| AC-3 | Met (unchanged from round 1) | |
| AC-4 | Met (unchanged from round 1) | |
| AC-5 | Met (unchanged from round 1) | |
| AC-6 | Met (unchanged from round 1) | |
| AC-7 | Partial | Guard now covers routing rows, no-H3 prose and Trigger Table section targets, but misses H3s in docs a Trigger Table row targets as a whole doc (Finding R2-1). |
| AC-8 | Met (unchanged from round 1) | |
| AC-9 | Met | Step 5 runs the three checks immediately before applying; note that validation may prompt. |
| AC-10 | Met (unchanged from round 1) | |
| AC-11 | Met | Single Recurrence clause; requires a removal patch in a prune-marked commit; mirror synced. |
| AC-12 | Met | Delta changes no source files. |
| AC-13 | Met | Sync and docs-refs pass. |
| AC-14 | Met (unchanged from round 1) | |
| AC-15 | Met | Mechanism-delete criterion exempted for managed files; PRUNE rows go to the existing file owner. |
| AC-16 | Met (unchanged from round 1) | |
| AC-17 | Met (unchanged from round 1) | |
| AC-18 | Met (unchanged from round 1) | |

### Verifying Round 1 findings

- _Finding 1 (read rule vs canon-sweep references):_ addressed — `.claude/skills/canon-prune/SKILL.md` description, §"Scope", §"Step 1 — Preconditions and scope", and §"What this skill does not do" now exclude managed files as prune input and name the two canon-sweep sections as operating instructions; only the three preflight bullets apply. ✓
- _Finding 2 (guard scope):_ partly addressed — three surfaces added; one surface still missing (R2-1). Still open.
- _Finding 3 (docs-audit delete criterion):_ addressed — `.claude/skills/docs-audit/SKILL.md:26`. ✓
- _Finding 4 (sweep recurrence):_ addressed — `.claude/skills/canon-sweep/SKILL.md:48` requires a removal patch in a prune-marked commit. ✓
- _Findings 5, 6 (optional):_ both done. ✓

### New findings

1. **R2-1 — `code-bug` — guard misses H3s in docs that a table row targets as a whole document.** Flagged by 2 lenses (anchored as risk/guardrail, cold-Claude as correctness bug). `.claude/skills/canon-prune/SKILL.md:39`. Verified in `src/orchestrator/pitfalls.ts`: `buildIndexRows` reads tables under both `Trigger Table*` and `Known Pitfalls*` headings; a row whose target is a plain doc path becomes a `linked` target (line 477), every linked doc from any row is collected regardless of match (lines 691–702), and each linked doc's H3s are path-matched into the prompt (lines 715–726). The `Read this doc` routing table is just one such table. Failure: an adopter's Trigger Table row points at `docs/architecture.md`; a prune `delete` of a path-citing H3 there drops it from matching implement prompts, and the guard's text (surface 1 limited to the routing table; surface 3 limited to "a section") gives it no **removes from implement prompts** tag. This is the same bug class as Round 1 Finding 2 at a new location, so fix it by generalizing instead of adding a fourth enumerated surface: describe the selected content as (a) every row of any table under §"Known Pitfalls" or a `Trigger Table` heading in `docs/patterns.md`, (b) any H3 entry in `docs/patterns.md` §"Known Pitfalls" or in any doc such a row points to, (c) any section such a row points to, and (d) the no-H3 Known Pitfalls prose; tag every verdict that removes, redirects, or strips the paths/triggers of any of them. Tagging every H3 removal in those docs (not only path-citing ones) also covers the cold-Claude note that H3 titles are listed in every implement prompt. Resync the mirror.

#### Optional Cleanup / Nit

2. **Sweep recurrence counts prune relocates and merges.** Flagged by 2 lenses (anchored nit, cold-Claude). `.claude/skills/canon-sweep/SKILL.md:48`: `git log -S` is per file, so a prune `relocate` or `merge` shows as removing the phrase from the file it left. A merge into another permanent doc is caught earlier by sweep Stage A ("already covered"), but a relocate to a code comment is not. Optional: count only rules listed under `Deleted:` in the prune record.
3. **docs-audit PRUNE rows for files no regular group owns.** cold-Claude. `.claude/skills/docs-audit/SKILL.md:49`: `.canon/README.md` and `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md` and `.claude/agents/spec-review-lens.md` are in `CANON_OWNED` (`src/lib/canon-owned.ts:2,15-17`) but in no regular group. Optional: say the Prune group's agent edits files no other group owns.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the prune-subject / `Canon-Prune:` trailer requirement makes removals committed under a different message stop counting - by design: spec Decision step 6 makes the drafted commit message the prune record, and Round 1 Finding 4 asked for exactly this restriction; a commit without the record is not identifiable as a prune.
- Dismissed (cold-Claude): a Trigger Table row targeting a section of a canon-managed doc cannot be judged without reading it - tagging removal or redirection of the row needs no read of the target, and R2-1's generalized wording tags every such row change.
- Folded (cold-Claude): H3 titles appear in every implement prompt regardless of path selection - merged into R2-1's fix.
- cold-Codex: no findings this round.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Address R2-1; items 2–3 are optional.

---

## Round 3 — verifying iteration 3's response to round 2

**Scope:** Delta — base `7710cb97ad698838b27cf01619359bf408cffe11` — reason: small fix within the files already under review

Lenses: anchored (full diff vs `main`, spec, handoff, prior review; signal approve), cold-Claude (delta only; signal changes_requested), cold-Codex (delta only; no actionable defects). All three returned valid results.

### Stage 1 — Acceptance Criteria Re-Check

Validation: the Iteration 3 re-run table has no Fail rows (`npm run sync-templates:check`, `npm run docs-refs-check`, `npm test` 2,248 passed / 1 skipped, `git diff --check`). Lint, type-check and build were not re-run; justified because the delta touches only Markdown (no `src/` or `dist/` change). The anchored lens re-ran `npm run sync-templates:check` (pass). Red-first: none required. Effective Self-Check: Iteration 3 rows for restatement sweep and sibling parity, baseline row for test integrity; none contradicted by the diff.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | |
| AC-2 | Met (unchanged from round 2) | |
| AC-3 | Met (unchanged from round 1) | |
| AC-4 | Met (unchanged from round 1) | |
| AC-5 | Met (unchanged from round 1) | |
| AC-6 | Met (unchanged from round 1) | |
| AC-7 | Met | `.claude/skills/canon-prune/SKILL.md` §"Implement-prompt guard" now describes the selected content generally: rows of tables under `Known Pitfalls` / `Trigger Table`, Known Pitfalls H3s, H3s (including titles) in whole-document targets, section targets, and the no-H3 prose. Anchored lens checked each against `src/orchestrator/pitfalls.ts` (`buildIndexRows`, linked targets at line 477, title listing, section targets, prose fallback). |
| AC-8 | Met (unchanged from round 1) | |
| AC-9 | Met (unchanged from round 2) | |
| AC-10 | Met (unchanged from round 1) | |
| AC-11 | Met (unchanged from round 2) | Optional R2-2 deferred. |
| AC-12 | Met | Delta changes no source files. |
| AC-13 | Met | Mirror byte-identical; sync passes. |
| AC-14 | Met (unchanged from round 1) | |
| AC-15 | Met (unchanged from round 2) | Optional R2-3 deferred. |
| AC-16 | Met (unchanged from round 1) | |
| AC-17 | Met (unchanged from round 1) | |
| AC-18 | Met (unchanged from round 1) | |

### Verifying Round 2 findings

- _R2-1 (guard misses whole-document targets):_ addressed — §"Implement-prompt guard" covers whole-document targets and their H3 titles; cold-Codex independently confirmed the new list matches the runtime selection paths. ✓
- _R2-2, R2-3 (optional):_ deferred by the implementer, as allowed.

### New findings

No correctness bug or spec gap drives this round's verdict. The remaining items are residual edge cases in an advisory tag that the human sees on every row before approving; they are recorded below as follow-ups rather than routed back.

**Why not another round.** This is the third consecutive round in which a lens found a selection path the guard's prose does not describe (Round 1 Finding 2, R2-1, and now items 1–3 below). Each time the guard is a hand-written restatement of `src/orchestrator/pitfalls.ts`, so further prose patches chase the code without converging. The durable fix is one shared mechanism: a canon helper that reports which implement-prompt sources an edit to the permanent docs would remove, which the skill would call instead of describing the selector. That is a new subcommand or tool, which the spec's Non-Goals exclude for this task ("no new `canon` subcommand"). I record it as a follow-up and accept the residual prose gaps as known risk. Cold-Claude's `changes_requested` signal is noted as a real disagreement; the items hold against the code, but their severity in a human-approved, advisory tag does not justify a fourth round.

#### Follow-ups (recorded, not blocking)

1. **Adding the first H3 under a prose-only `Known Pitfalls` silently disables the prose fallback** (cold-Claude, verified at `src/orchestrator/pitfalls.ts:174-189`: prose is injected only while the section has no H3). A pitfall `merge` whose new home is that section's first H3 drops the prose from every implement prompt without the tag; deleting the last H3 does the reverse. Only reachable in a repo whose Known Pitfalls is prose-only.
2. **No step says who computes the tag for sections in other docs** (cold-Claude). Trigger Table rows can target sections of `docs/decisions.md` or `docs/architecture.md`, but those groups' inventory agents never read the `docs/patterns.md` tables, and Step 4 says only "where it applies". The invoking session can compute it, but nothing tells it to. Cheapest prose fix: have the invoking session check each non-keep row against the `docs/patterns.md` table targets before Step 4.
3. **Renaming a heading a row targets breaks or redirects the row** (anchored and cold-Claude; flagged by 2 lenses). `sectionHeading` (`src/orchestrator/pitfalls.ts:163-172`) matches exact then prefix; a merge that retitles a targeted heading is covered only by the catch-all "rewrite … so it no longer carries that guidance".
4. **Scope's routed-doc discovery is narrower than the guard's table set** (cold-Claude). Scope reads only the `Read this doc` / `Before touching` table; a whole-document target listed in another Known Pitfalls index table or a Trigger Table is a guard source but not reviewed. Fails safe (no pruning of an unreviewed doc).

#### Optional Cleanup / Nit (omitted from verdict)

- "Any table under a `Known Pitfalls` … heading" over-tags tables inside H3 entry bodies (`knownPitfallsIndexTables`, both lenses); fails safe.
- "A Known Pitfalls doc" as a merge home is no longer defined by the new list (anchored); wording only.

### Dismissed Cold Findings

- cold-Codex: no findings this round.
- No cold-Claude finding dismissed; items 1, 2 and 4 above are recorded as follow-ups, and item 3 merges cold-Claude with the anchored lens.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

Follow-ups 1–4 and the shared-helper idea belong in an issue or a `/canon-spec` task; no further implement round is requested.
