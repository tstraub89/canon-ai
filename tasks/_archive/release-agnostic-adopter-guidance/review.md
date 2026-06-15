# Code Review: release-agnostic-adopter-guidance

> Reviewer: Claude | Spec: `tasks/release-agnostic-adopter-guidance/spec.md`
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

All applicable checks passed: lint, type-check, full test suite (867/0/1), sync-templates:check, docs-refs-check. `npm run build` is deferred_by_spec with a valid citation (skills/docs are not bundled into `dist/`).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: inventory gate | Met | Nine `git grep` commands covering all spec-listed terms. All shipped-surface hits carry dispositions (`reframed` or `intentionally-conditional` with a one-line reason). `docs/pipeline-orchestrator.md` is correctly identified as CANON_OWNED and classified `intentionally-conditional` (its release-branch references are CLI flag examples, not prescriptive defaults). Non-shipped hits are listed without disposition as required. |
| AC-2: recipe menu | Met | §5 now titled "Release and shipping operations" contains four distinct labeled recipes: release-branch-per-version, trunk-from-main, tag-from-main, no versioning. None is labeled or positioned as the default/recommended/required model. |
| AC-3: per-task / hybrid framing | Met | `canon-pipeline/SKILL.md` preamble explicitly states `base_branch` is recorded per task and that hybrid repos can use different models across surfaces. Both required elements are present. |
| AC-4: authority pointer | Met | Global preamble at line 100 says "for every recipe below, your project's own `decisions.md §Versioning and Release Policy` (and/or your project's release doc) is the source of truth." This explicitly covers all four recipes. The no-versioning recipe lacks an individual per-recipe pointer, but the global preamble's "for every recipe below" framing satisfies the functional requirement. |
| AC-5: frontmatter | Met | Skill description now reads: "Also for release and shipping operations: finalization, hotfix absorption, and any release model (release-branch, trunk, tag, or no-versioning)." Release-branch is listed as one of four equal options, not the defining purpose. |
| AC-6: changelog skill — neutralize, don't redesign | Met | Exactly two lines changed in `canon-changelog/SKILL.md`. (a) Base-branch heuristic replaced with generic upstream-derived logic that also honors `status.json`'s `base_branch` field. (b) "version was bumped when the release branch was initialized" replaced with a conditional deferral to project versioning policy. No other behavioral clauses changed. |
| AC-7: decision record | Met | New entry "Canon prescribes no release model to adopters" added with Decision, Why, and Rule sections. Stale `CHANGELOG.md lives on both dev and main` wording removed in two places. Surviving `dev` references are accurate historical parentheticals only. |
| AC-8: diff scope guard | Met | Diff touches only the four skill files (root + templates mirrors), `docs/decisions.md`, and task artifacts under `tasks/release-agnostic-adopter-guidance/`. No `scripts/`, `src/`, `dist/`, `AGENTS.md`, `CLAUDE.md`, or `docs/release-process.md` paths appear. |
| AC-9: templates mirror invariant | Met | `npm run sync-templates:check` passed. Both root and mirror paths appear in the handoff Changes table. |

### Dropped Sections Check

- [x] Non-goals respected — `docs/release-process.md`, `AGENTS.md`, `CLAUDE.md`, orchestrator source, and `CHANGELOG.md` are untouched. Confirmed by diff inspection.
- [x] Known Risks addressed — recipe-drift mitigation (thin recipes, authority-pointer pattern) is present; over-editing mitigation (AC-6 scope-bound) is enforced; inventory under-coverage mitigation (AC-1 re-run) is documented.
- [x] Human Test Plan is satisfiable — the four recipes cover each test persona (trunk-only adopter, tag-from-main adopter, hybrid adopter, adopter confirming no single model is imposed).

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean documentation-only implementation. The strategy is correct: neutralize exactly the two named release-branch assumptions in canon-changelog, rewrite §5 of canon-pipeline into a model-neutral core plus four recipes, and lock the stance with a decision record. The prose is clear, internally consistent within each changed surface, and the recipe structure is appropriately thin. All findings from both lenses are nits.

### Findings

#### Correctness Bugs

None.

#### Risk / Guardrails

**R-1** (`risk/guardrail` — cold lens) `.claude/skills/canon-changelog/SKILL.md` line 22 — The new base-branch derivation says "If the task's `status.json` is readable and has a `base_branch` field, that takes precedence over the git-derived upstream." The instruction does not specify how to locate the `status.json` (which task directory to look in) when invoked outside a well-known task context. The soft "if readable" hedge limits blast radius — a skill agent that can't locate the file simply falls back to git-derived upstream — but an agent could also read the wrong file in a multi-task repo. Not a regression from the old text (which gave no `status.json` guidance at all), and AC-6 scoped this change to neutralizing the heuristic generically. Low blocking risk; flagged as a known limitation worth tightening in a follow-up.

#### Optional Cleanup / Nit

**N-1** (`optional cleanup/nit` — both lenses) `.claude/skills/canon-pipeline/SKILL.md` — The "Always check working tree state before branch operations" guard appears verbatim twice in §5: once in the preamble (before the first recipe) and once after the no-versioning recipe. The second copy was preserved from the original §5 closing position while a new copy was added to the preamble. Either the trailing copy (after no-versioning) should be removed, or the preamble copy should be removed. The preamble position is more effective because it applies before any recipe is followed.

**N-2** (`optional cleanup/nit` — anchored lens) `docs/decisions.md` new Rule section — The Rule enumerates adopter-facing surfaces as "skill files, `AGENTS.md`, `CLAUDE.md`" but omits `docs/pipeline-orchestrator.md`, which is also CANON_OWNED and ships to adopters. The enumeration is underspecified on scope. Could be tightened to "skill files and all CANON_OWNED docs" or could list pipeline-orchestrator.md explicitly.

#### Spec Gaps

None.

### Dismissed Cold Findings

- **`decisions.md §Versioning and Release Policy` pointer misleads adopters** (cold lens, medium confidence): dismissed. The authority pointer in the skill directs adopters to *their own* `decisions.md §Versioning and Release Policy`, not to canon-ai's decisions.md. An adopter's own `decisions.md` is where they record their release policy — the pointer is correct. The cold lens confused the referent (adopter's document) with the source (canon-ai's document).
- **`getBaseBranch()` in `scripts/run-task/git.ts` unverifiable** (cold lens, low confidence): dismissed. Low-confidence claim about an internal doc's accuracy; not a behavioral issue in shipped guidance.
- **`finalize` not in canon-changelog argument hint** (cold lens, low confidence): dismissed. The hint is `[optional: version override e.g. 1.5.0, or single task ID to add one bullet]`; `finalize` is the mode trigger. This is a pre-existing documentation gap in the changelog skill's frontmatter, not introduced by this task and out of AC-6 scope.
- **Pre-existing "In-progress append mode (release branch)" label inconsistency** (anchored lens): dismissed as pre-existing. The mode-detection table uses the agnostic label "Active release/working branch" while Phase 5 still says "(release branch)." This gap pre-dates this task; AC-6 explicitly scoped the edit to two named spots, and this label is not one of them.

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
