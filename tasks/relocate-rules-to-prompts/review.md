# Code Review: relocate-rules-to-prompts

> Reviewer: Claude | Spec: `tasks/relocate-rules-to-prompts/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below is the post-reroute code review of the amended implementation (base spec AC-1..13 **plus** the amendment's AC-A1/A2/A3). It supersedes the earlier pre-amendment review (which covered AC-1..13 only). On any re-review, append a new `## Round N` section near the bottom rather than rewriting this one.

Code review synthesized by the foreman from two lenses: an **anchored** lens (Stage 1 AC-compliance gate + Stage 2 quality, holding spec + handoff + diff) and a **cold** lens (diff-only, spec-blind). Both lenses retrieved the full untruncated diff via `git diff main...HEAD`. Both independently signalled **approve**. The anchored lens **ran** the AC-1 presence-token and AC-8 absence-token greps (not eyeballed, per AC-1), confirmed AC-6's empty diff and the AC-13 scaffold sweep, and read the AC-11 test in full. The cold lens confirmed dist/golden integrity (fresh `npm run build` produced zero diff against the committed bundle) and that all 10 root↔mirror pairs are byte-identical. The foreman directly re-verified the two borderline items (AC-A1 test specificity, AC-A3 casing) below.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — all required checks `Pass` (lint, type-check, `npm test` 874 pass/1 skip, `sync-templates:check`, `docs-refs-check`, `build`); E2E `not_configured` (no UI, per spec). Manual AC greps (AC-1/AC-8/AC-13) and AC-6/AC-10/AC-A1/A2/A3 git+grep checks all recorded `Pass`.
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: coverage / anti-drop | Pass | Anchored lens ran every presence-token grep; all match verbatim (implement.md 6/6, implement-revisions.md 3/3, spec-review.md 2/2, qa.md 6/6, spec.md + spec-revision.md + both spec skills carry `Name effects to DELETE`/`Prefer positive or structural assertions`, `.canon/templates/spec.md` both tokens, helpers.ts `honest signal is canon` ×2 + `pull --rebase`). |
| AC-2: escalation contract has a home | Pass | Decomposed (not monolithic): sensitive-surface awareness in spec surfaces + `canon-spec`; mid-implement `[ambiguity]`/Blocker path in implement.md; "notify"/human-output list in qa.md. |
| AC-3: dangling references rewired | Pass | Greps of all JIT surfaces: every remaining `AGENTS.md`/`CLAUDE.md` mention is a pointer to surviving content (operator/project context, `canon-init` file ops, resume optimization, human-sweep promotion target), not a sole-home rule dependency. Justifications in handoff §Intent hold. (Pointer-clarity nits below — not dependencies.) |
| AC-4: spec craft rules | Pass | `Name effects to DELETE` + `Prefer positive or structural assertions` present in spec.md, spec-revision.md, canon-spec, canon-spec-review. |
| AC-5: code-review craft rules | Pass | Foreman carries baseline-diff / git-invariant / cross-cutting-helper; anchored carries handoff-verification + delicate-guards + git-invariant; cold gained only a diff-local guard-consistency pattern (stays spec-blind). |
| AC-6: AGENTS.md / CLAUDE.md unchanged | Pass | `git diff main...HEAD -- AGENTS.md CLAUDE.md templates/AGENTS.md templates/CLAUDE.md` empty (run directly). |
| AC-7: templates/ mirrors synced | Pass | `sync-templates:check` Pass; all mirrors present in diff; cold lens confirmed root↔mirror pairs byte-identical. |
| AC-8: anti-broadcast / scoping | Pass | Absence greps run: `task baseline`/`git -C` absent from spec.md/spec-revision.md/spec-review.md; spec-craft signatures absent from foreman + both lens charters. |
| AC-9: golden fixture | Pass | Committed golden equals a fresh `UPDATE_GOLDENS=1` regeneration (zero diff) — current, not rubber-stamped. |
| AC-10: build artifact current | Pass | `git diff main...HEAD --name-only -- dist/` returns only `dist/scripts/run-task.js`; dist rebuilds with zero drift. |
| AC-11: structural relocation test | Pass | Added test reads on-disk destinations and asserts presence tokens, absence tokens, AC-A1 escalation triggers, and the recursive `.canon/templates/` scaffold sweep; runs green and is non-vacuous. |
| AC-12: Validation Matrix to both consumers | Pass | `Migration runner + manual review` in both implement.md and `.canon/templates/spec.md`; `docs/architecture.md` §Validation self-contained (no longer sourced from AGENTS.md) and retains every category→command binding. |
| AC-13: scaffolds zero MD dependence | Pass | `grep -rE 'AGENTS\.md|CLAUDE\.md' .canon/templates/` returns no matches; all four sites (spec.md ×2, done.md, status.json) repointed to surviving docs. |
| AC-A1: escalation triggers reach spec templates | Pass | All six triggers (auth, billing, privacy, destructive, schema, analytics) present on the escalation line of **both** `spec.md` and `spec-revision.md`; AC-11 asserts each. Foreman confirmed `author`/`authoring` absent from both templates, so the substring regexes match only the intended line (test is meaningful — see N4). |
| AC-A2: QA proposes changelog entry text only | Pass | qa.md "Proposed version bump per SemVer" ask removed; `.canon/templates/done.md` "Proposed version" field removed; `docs/decisions.md` Minor tier reassigns bump-tier proposal to the release/changelog step (QA = entry text only). Both lenses traced all three surfaces end-to-end; residual `version bump` mentions explicitly state QA does **not** bump / it is a separate step — non-contradictory. |
| AC-A3: changelog skill description capitalization | Pass | `.claude/skills/canon-changelog/SKILL.md` `description:` (and its mirror) now `§"Versioning and release policy"` (lowercase), matching the `docs/decisions.md` heading. (Body-prose casing leftover noted as N2 — outside AC-A3's description scope.) |

### Dropped Sections Check

- [x] Non-goals respected — AGENTS.md/CLAUDE.md untouched (AC-6); no vacate; no orchestrator control-flow change (the `index.ts` edit is a string-only reference rewire, confirmed by both lenses); no rule broadcast (AC-8).
- [x] Known Risks addressed — silent rule-drop guarded by AC-1 greps + AC-11 test; scaffold whack-a-mole closed by the AC-13 class sweep; over-broadcast guarded by AC-8; cold-lens contamination verified absent; golden churn reviewed against intended edits; interim duplication is the documented, intended interim state.
- [x] Human Test Plan is satisfiable by the implementation.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, mechanically-uniform execution of a high-volume (22-rule) relocation plus a scoped three-finding amendment. The relocated prose was spot-checked against the in-context AGENTS.md/CLAUDE.md originals for the highest-risk rules (Validation Matrix, Safe-First, Scope Discipline, Release Rules, Commit Ownership, Docs Freshness 5-doc list, Diagnose 3-role) — faithful, no semantic drift. The AC-A2 self-contradiction the PR-level review caught is genuinely resolved across all three surfaces. The two documented deviations (adding `scripts/run-task/prompts/index.ts`; using `process.cwd()` in the test) are sound and correctly justified. No correctness bugs, no spec gaps. Only minor pointer-clarity / robustness nits remain.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **N1 — `scripts/run-task/prompts/index.ts:286` (flagged by both lenses):** the resume prompt says "see the Validation Matrix in `implement.md`," but implement.md introduces the table as "the universal change-type → check-category matrix" — no heading literally named "Validation Matrix," and a resumed agent receives the rendered prompt body, not a file it opens. Cosmetic: `promptImplementResume` appends the full implement.md body, so the resumed session gets the matrix regardless. Tighten the wording if touched.
- **N2 — `.claude/skills/canon-changelog/SKILL.md:49` (anchored + cold):** AC-A3 fixed the `description:` frontmatter to lowercase `Versioning and release policy`, but this body line (touched by this diff) still carries title-case `§"Versioning and Release Policy"` in its fallback lead-in and the "(Tip: add a `## Versioning and Release Policy` section…)" text, while the same line's rewired reference is lowercase. Cosmetic intra-line casing drift; docs-refs-check passes and AC-A3's scope (the description) is met. Normalize the body casing in a follow-up.
- **N3 — `.claude/skills/canon-spec-review/SKILL.md:78-87 (Agent C) (anchored):** Agent C's `Goal` expanded from 6 to 8 checks (per plan Step 11 — intended for AC-4), adding (8) "Symbols in ACs exist… verified the return shape," which overlaps Agent B's job; the unchanged Constraints line still says "Agent C trusts that ACs reference symbols Agent B is verifying." Mild internal tension (Agent C now both audits and trusts symbol verification). One-line reconciliation of the Constraints note would resolve it. Not a relocation defect.
- **N4 — `tests/run-task-prompts.test.ts` escalation-trigger loop (cold):** the AC-A1 loop asserts unanchored short substrings (`/auth/`, `/schema/`, `/privacy/`, …). Verified meaningful **today** (foreman confirmed `author`/`authoring` and other incidental hosts are absent from both spec templates, so each regex matches only the escalation line), but it is structurally weak: a future edit introducing e.g. "author" or "schemas" elsewhere in the template would let the assertion pass even if the escalation line were dropped. Anchoring to the actual phrase ("auth, billing / payments") would harden the AC-A1 guard. Robustness nit, not a current test-integrity defect.
- **N5 — `scripts/run-task/prompts/templates/qa.md` lessons-promotion line (anchored, carried from prior round):** still names `AGENTS.md` as a human-sweep promotion *target*. Justified today (AC-3: target, not rule source), but the later vacate task should revisit whether AGENTS.md remains a valid target.

#### Spec Gaps

(none)

### Dismissed Cold Findings

> Cold-lens findings dropped because the spec shows the behavior is intended.

- **Dismissed (cold): rewritten pointers describe a "post-vacate world," and the same rules now exist in two places (AGENTS.md/CLAUDE.md + JIT surfaces)** — intended. This is the spec's central design (complete the JIT channel **without** vacating) and is named in Known Risks as "Interim duplication … intentional and safe." The cold lens is spec-blind, so it correctly flagged the duplication it could see; the spec explains it.
- **Dismissed (cold): AC-11 test uses loose substring `assert.match`/`assert.doesNotMatch` rather than exact-content checks** — intended. Spec §Verification Tokens: "Implement must emit each token **verbatim** … surrounding prose may be reworded freely." Token-presence is the contract. (The AC-A1-specific weakness is surfaced separately as N4.)
- **Dismissed (cold): test uses `process.cwd()` rather than `REPO_ROOT`** — not a defect. Documented deviation #2 and the correct choice: in a linked worktree `REPO_ROOT` resolves to the supervising checkout and would read stale files (the worktree-cwd pitfall in `docs/patterns.md`). Anchored lens independently confirmed.
- **Dismissed (cold): `helpers.ts`/golden token tests are file-level, not per-constant** — pre-existing coverage shape; not introduced by this task and not a correctness issue. Out of scope.

### Telemetry note (non-finding)

`docs/pipeline-invocations.md` (orchestrator auto-append) and `docs/task-quality-log.md` appear in the diff but not in the spec's Affected Files. These are pipeline-telemetry / QA-log files written outside the relocation, neither is `AGENTS.md`/`CLAUDE.md` (AC-6 holds), and neither is relocation content — recorded for completeness, not a finding.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> N1–N5 are optional pointer-clarity / robustness / follow-up items; none blocks shipping. They surface at QA.
