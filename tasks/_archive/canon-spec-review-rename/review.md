# Code Review: canon-spec-review-rename

> Reviewer: Claude | Spec: `tasks/canon-spec-review-rename/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All six required checks passed (lint, type-check, test, build, sync-templates:check, docs-refs-check). E2E marked `deferred_by_spec` with a valid spec citation. The AC-6 ambiguity note in the handoff (pre-commit worktree shows the expected `dist/` rename diff until the orchestrator stages the commit) is consistent with the normal pipeline flow; the bundle was regenerated from source and the diff is limited to the expected rename outputs.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Skill renamed at source | Pass | `.claude/skills/canon-spec-review/SKILL.md` exists with `name: canon-spec-review`; frontmatter, H1, usage line, and report header all updated; `.claude/skills/canon-review/` absent from git tree. |
| AC-2: Manifest + templates mirror | Pass | `src/lib/canon-owned.ts` line 10 lists `.claude/skills/canon-spec-review/SKILL.md`; `templates/.claude/skills/canon-spec-review/SKILL.md` exists; old `templates/.claude/skills/canon-review/` absent from git tree; `sync-templates:check` passes. |
| AC-3: doctor presence check | Pass | `doctor.ts:251` `skillNames` contains `canon-spec-review`; `tests/cli.test.ts:408` "all seven skills present → pass" fixture updated; no `canon-review` in `src/` or `tests/`. |
| AC-4: Permission grant lockstep | Pass | `doctor.ts:78-79` `RECOMMENDED_ALLOW` has `Skill(canon-spec-review)` / `Skill(canon-spec-review:*)`; README allowlist block matches; `cli.test.ts` deepEqual test passes. |
| AC-5: README user-facing refs | Pass | README catalog row (line 113) and installed-skills prose read `/canon-spec-review`; `grep README canon-review` returns 0. |
| AC-6: dist rebuilt | Pass | `dist/cli/index.js` contains `canon-spec-review` in `RECOMMENDED_ALLOW`, `skillNames`, and `CANON_OWNED`; old name absent; bundle regenerated via `npm run build`. |
| AC-7: Shipped cross-references | Pass | `canon-pipeline`, `canon-spec`, `canon-status` SKILL.md and `docs/pipeline-orchestrator.md` (3 refs) all updated; `grep .claude/skills/ canon-review` and `grep docs/pipeline-orchestrator.md canon-review` return 0. |
| AC-8: Forward-looking dev docs + local settings | Pass | `docs/decisions.md`, `docs/BACKLOG.md`, and `.claude/settings.json` all updated; `grep` for `canon-review` in each returns 0. |
| AC-9: Structural grep gate | Pass | `git grep -n 'canon-review'` hits only: `CHANGELOG.md` (historical + new adopter-guidance entry) and `tasks/canon-spec-review-rename/**`. No matches outside the allow-list. |
| AC-10: Adopter guidance in CHANGELOG | Pass | `CHANGELOG.md` `[Unreleased]` entry records the rename, notes behavior is unchanged, and directs adopters to remove `.claude/skills/canon-review/` after `canon upgrade` with the caveat that upgrade does not prune it. |
| AC-11: Full validation green | Pass | All six required checks pass per handoff. |

### Dropped Sections Check

- [x] Non-goals respected — no deletion logic added to `canon upgrade`; no CHANGELOG history rewritten; `tasks/_archive/**` untouched; SKILL.md content only changed where the old name literally appears
- [x] Known Risks addressed — README↔RECOMMENDED_ALLOW lockstep verified by test; dist rebuilt from source; orphaned templates mirror `git rm`'d; generated paths all declared in handoff Changes table
- [x] Human Test Plan is satisfiable — the renamed skill dir exists; `canon doctor` will report it present; CHANGELOG guidance is unambiguous

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean rename across all load-bearing surfaces: source (`doctor.ts`, `canon-owned.ts`), compiled dist, live skill (rename + 5 name-occurrence edits), templates mirror (new + orphan removed), four sibling cross-links, three orchestrator-doc references, README prose and allowlist block, dev docs, and local settings. All derived artifacts regenerated by tooling. No behavior changes; no structural risk.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Pre-existing weak regex in negative test** — `tests/cli.test.ts:432` uses `/canon-spec/` to assert the missing-skills warning includes a skill name. This regex matches both `canon-spec` (the spec-authoring skill) and `canon-spec-review` (the renamed skill); it cannot distinguish them. The test was not changed by this PR and represents a pre-existing under-specification — it is not a regression. A tighter pattern (e.g., `/canon-spec-review/`) would make the assertion unambiguous. Low severity; the test still correctly exercises the warning path. *(Flagged by cold lens; not flagged by anchored lens as it predates this diff.)*

- **Empty untracked dir residue** — After the git rename, an empty `.claude/skills/canon-review/` directory (and its `templates/` counterpart) remains on the local filesystem as a git-untracked artifact. It does not affect CI, adopters, or the shipped bundle — git does not track empty directories. Minor working-tree residue. *(Flagged by both lenses.)*

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed (cold, spec-intended):** "No `canon doctor` warning for stale old skill directory" — The spec §Decision explicitly chose documentation-only migration: "we handle this with documentation only (a CHANGELOG entry telling adopters to remove the old dir) — we do NOT add deletion logic to `canon upgrade`." The same design intent governs doctor: adding a stale-dir detection check would contradict the explicit non-goal of keeping `canon upgrade` additive-only. Dismissed.

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
