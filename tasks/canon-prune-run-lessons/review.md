# Code Review: canon-prune-run-lessons

> Reviewer: Claude (foreman: anchored Claude + cold-Claude + cold-Codex) | Spec: `tasks/canon-prune-run-lessons/spec.md`

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence: none required (no red-first ACs)
- [x] Self-Check evidence in the effective record is not contradicted by the diff

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: per-sentence delete classification | Pass | Steps 2, 3 and the Step 4 column in `.claude/skills/canon-prune/SKILL.md` |
| AC-2: guard rows name requirements and selecting paths | Pass | §"Implement-prompt guard" states own-H3, no-fold and same-failure rules; headings unchanged |
| AC-3: Step 5 reference sweep | Pass | Archive-excluded search, same-apply retarget, hand-back listing |
| AC-4: record survives merge | Pass | Step 6 requires carrying the record into the squash message or PR body |
| AC-5: shipped skill adopter-safe, mirror synced | Pass | Anchored lens re-ran `sync-templates:check`; no `canon-ai` match in the skill; mirror diff identical |
| AC-6: docs-audit carve-out | Pass (wording issue below) | Carve-out present; `docs-audit` not in `CANON_OWNED` |
| AC-7: patterns/decisions doc fixes | Pass | `taskDirFromRoot` gone, `taskDirFor()` kept; "Backlogged" line gone |

### Dropped Sections Check

- [x] Non-goals respected
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

The prune-skill edits are small and land in the steps they govern. The mirror matches. One restatement, the `docs-audit` carve-out, is worded ambiguously and weakens the old text's clarity. Everything else is nit-level.

### Findings

#### Correctness Bugs

1. **[code-bug] `.claude/skills/docs-audit/SKILL.md:26` — carve-out wording is ambiguous (flagged by 2 lenses: cold-Claude, cold-Codex; anchored lens noted it as near-circular).** The old text said the "describes a canon mechanism" delete criterion and §"High-level canon mentions only" do not apply to *canon-managed files* (the files this row covers). The new text reads "except when pruning canon-ai's own root docs with `/canon-prune`". A docs-audit agent applying §"Verdicts" by reference is not obviously "pruning with `/canon-prune`", so it can read the exemption as not applying, and then flag canon-mechanism rules in `CANON_OWNED` root docs for deletion. Codex adds that `/canon-prune` itself excludes canon-managed files from prune input, so a carve-out phrased as conditional on a `/canon-prune` run looks unreachable for the files this row names. Spec evidence: AC-6 fixes the intent (the two criteria do not apply to canon-ai's own root docs), not this conditional phrasing. Failure: a docs-audit prune pass over `docs/architecture.md`-style canon docs proposes `delete` for rules whose job is to describe canon. Fix: state it unconditionally for this row, e.g. "for this row, which covers canon-ai's own root docs, the 'describes a canon mechanism' delete criterion and §"High-level canon mentions only" do not apply, because these docs exist to describe canon."

#### Risk / Guardrails

(none surviving; see nits)

#### Optional Cleanup / Nit

- `docs/decisions.md:~233`: deleting the "Backlogged" line leaves two consecutive blank lines before `---` (flagged by anchored and cold-Claude). Remove one.
- `.claude/skills/canon-prune/SKILL.md` Step 2: the inventory agent return-format sentence ("a proposed verdict with exact replacement text, or `delete`") doesn't list the sentence classification. It is stated as a separate instruction and required in Step 4, but adding it to the return fields would make the omission visible earlier (anchored lens; Known Risk 2).
- Step 5 reference sweep: edits to files outside the approved rows (changelog, backlog) are described in the hand-back only, not surfaced at triage; "heading rename" is not a verdict. AC-3 mandates this shape, so informational.
- Step 4: the "Sentence classification" column has no stated value for relocate and merge rows.
- Step 6 / Codex P2: carrying the record only in a PR body is findable by `git log --grep` only if the merge uses that body as the commit message. AC-4 states this exact allowance and the skill words it as "the PR body used to merge", so no change required; a clarifying clause would be harmless.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): `docs/decisions.md` "Backlogged" deletion is data loss because the four ideas are tracked nowhere — spec Judgment Calls row "The untracked 'Backlogged' ideas" chose delete (Decided by Author) and AC-7 requires the line gone.
- Dismissed (cold-Claude): `docs/patterns.md:168` losing the `taskDirFromRoot()` incident drops a live requirement — AC-7 requires removing it; `taskDirFromRoot` is now a private helper in `src/task/index.ts`, and the rule ("use `taskDirFor()`") plus its test shape is retained.
- Dismissed (cold-Claude): Step 6 carry-the-record rule contradicts "Do not commit" / "Create no log file" — the skill only tells the human to carry the drafted message into the merge text; nothing commits or logs.
- Dismissed (cold-Claude): Step 5 retargets in `docs/BACKLOG.md`/`CHANGELOG.md` conflict with docs-audit's record rule — that rule governs docs-audit findings, not `/canon-prune`; AC-3 explicitly includes changelog and backlog.
- Dismissed (cold-Codex): [P2] put the prune record in a searchable commit message — AC-4 explicitly permits "the squash commit message or PR body the merge uses"; GitHub squash uses the PR body as the commit message, which is the failure mode this change addresses. Recorded as a nit above.
- Cold-Codex [P2] make the docs-audit carve-out reachable — retained as code-bug finding 1.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

## Round 2 — verifying iteration response to round 1

**Scope:** Delta — base `731149447bcfa03fcab964b3921aebb61ab4acc5` — reason: small fix within the files already under review

### Stage 1 — Acceptance Criteria Re-Check

Anchored lens re-read the full task diff, the handoff (baseline plus the "Iteration 2 — addressing review round 1" section), and the effective Self-Check record. Validation Outcomes have no `Fail`; no red-first ACs.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | Steps 2–4 in `.claude/skills/canon-prune/SKILL.md` |
| AC-2 | Met (unchanged from round 1) | §"Implement-prompt guard" |
| AC-3 | Met (unchanged from round 1) | Step 5 |
| AC-4 | Met (unchanged from round 1) | Step 6 |
| AC-5 | Met (unchanged from round 1) | Mirror identical; no `canon-ai` match in the shipped skill |
| AC-6 | Met | `.claude/skills/docs-audit/SKILL.md:26` now reads "except for this row's canon-ai root docs, … do not apply, because these docs exist to describe canon" |
| AC-7 | Met (unchanged from round 1) | Greps return nothing; `taskDirFor()` kept |

### Verifying Round 1 findings

- _code-bug:_ docs-audit carve-out conditional on a `/canon-prune` run → addressed (`.claude/skills/docs-audit/SKILL.md:26`, now unconditional for the row, with rationale) ✓. Cold-Claude and cold-Codex both find the new wording clear.
- _nit:_ double blank line in `docs/decisions.md` → addressed (delta removes it) ✓.
- _nits left as-is:_ Step 2 return-field listing, Step 4 column for relocate/merge rows, PR-body wording. Round 1 marked these informational; not blocking.

### New findings

(none blocking)

Nits (not blocking):
- Anchored: "this row's canon-ai root docs" is slightly loose versus "root copies of `CANON_OWNED` markdown files"; meaning is clear in context.
- Anchored: Step 6 does not literally say "tell the human"; audience is implicit.
- Cold-Claude: reach of "this row's canon-ai root docs" (only `CANON_OWNED` root markdown, or all root docs) is slightly ambiguous; low severity. Same point as the first nit.

### Dismissed Cold Findings

(none: cold-Claude returned no findings; cold-Codex found no actionable issue)

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
