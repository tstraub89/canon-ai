# Spec: relocate-rules-to-prompts — Relocate sole-homed canon rules into per-phase prompts and skills

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

Canon's operating rules live in two parallel places: the canon-delimited blocks of `AGENTS.md` / `CLAUDE.md` (auto-loaded ambiently by every agent) and the per-phase prompt templates / agent charters / startup constants / skills (the just-in-time channel injected by the orchestrator). The orchestrator **never reads `AGENTS.md` / `CLAUDE.md` and injects their content** — `CODEX_STARTUP` / `CLAUDE_STARTUP` in `scripts/run-task/prompts/helpers.ts` merely instruct the spawned agent to "read AGENTS.md."

A partition sweep found that **~22 operating rules are sole-homed in `AGENTS.md` / `CLAUDE.md`** — they reach pipeline agents *only* via auto-load. The Human Escalation Contract has **no template home at all**. One of the sole-homed rules is the structural **Validation Matrix** (change-type → check-category, `AGENTS.md` §"Validation Matrix"): it lives only in `AGENTS.md`, yet the implement prompt (`scripts/run-task/prompts/templates/implement.md` — "the matrix in AGENTS.md"), the spec scaffold (`.canon/templates/spec.md` — "from AGENTS.md validation matrix"), and `docs/architecture.md` §Validation (its binding table is keyed "Category (from AGENTS.md)") all depend on it. This blocks the larger goal (a later task that vacates the canon blocks from adopter `AGENTS.md` / `CLAUDE.md` entirely): vacating today would silently strip those ~22 rules — the Validation Matrix among them — from Codex and pipeline-Claude, because nothing injects them.

This task completes the just-in-time channel so it carries every rule its phase needs — making the `AGENTS.md` / `CLAUDE.md` canon blocks fully redundant — **without yet vacating them**. It is the non-breaking prerequisite for the vacate.

A second benefit drives the design: today's monolith forces every phase to auto-load *all* rules (the code-review lenses carry spec-writing guidance they never use; implement carries QA rules). Scoping each rule to the specific phase that consumes it shrinks each phase's prompt to its own job and reduces cross-rule attention dilution.

## Decision

Relocate each sole-homed operating rule from the `AGENTS.md` / `CLAUDE.md` canon blocks into the specific just-in-time surface that consumes it — **scoped per consumer, not broadcast**. After this task:

- Every rule a pipeline phase relies on is present in that phase's prompt template, agent charter, or startup constant (no rule reaches an agent only via `AGENTS.md` / `CLAUDE.md` auto-load).
- Operator-facing craft rules (spec-writing, code-review rules of thumb) live in the skills and the pipeline spec templates that consume them.
- The ~18 dangling "read AGENTS.md / CLAUDE.md" references in templates/skills are rewired to be self-contained or to point at a doc that survives the later vacate (`docs/pipeline-orchestrator.md`, `docs/patterns.md`, etc.).
- The canon **artifact scaffolds** (`.canon/templates/*` — the files `canon task new` copies into each task dir) are made self-contained too: every place a scaffold points at an `AGENTS.md`/`CLAUDE.md` canon-block rule is inlined or repointed to a surviving doc, so spec/QA authors keep their guidance after the vacate (AC-13).
- Each phase's prompt carries **only** its phase's rules — code-review surfaces do not carry spec-writing rules and vice versa; spec_review does not carry implementation rules and vice versa.

Behavior is preserved: the same rules reach the same agents, via the injected channel instead of auto-load. `AGENTS.md` and `CLAUDE.md` are **not modified** by this task — they keep their full canon blocks (now redundant) and ship unchanged. The single-source cleanup (deleting the now-duplicate MD copies) happens in the vacate task.

The authoritative rule-to-destination mapping is the **Partition Table** in §Design. The spec defines *what moves where* and *how it is verified*; the exact prose of each relocated rule is an implementation detail (mechanics deferred to plan/implement), constrained by the structural verification in the Acceptance Criteria.

## Non-Goals

- **NOT vacating `AGENTS.md` / `CLAUDE.md`**, not removing them from `DELIMITED`, not deleting the now-redundant canon-block copies, and not the `canon upgrade` migration — that is the **vacate task** (tracked in `docs/BACKLOG.md`). Those files ship byte-identical after this task.
- **NOT the discovery nudge / `canon init` seeding / `canon doctor` check** — that is the **nudge task** (tracked in `docs/BACKLOG.md`).
- **NOT moving any personal/dogfood methodology** (no-self-review, git/commit consent, the trivial-vs-non-trivial canon-mod split) to `README.md` — that is part of the vacate task.
- **NOT changing** pipeline phase order, routing, model/effort selection, `status.json` schema, or any orchestrator control flow. This is content relocation into existing prompt surfaces only.
- **NOT broadcasting** rules across phases. Dumping all of `AGENTS.md` into every template is an explicit anti-goal (it forfeits the scoping benefit); see AC-8.

## Acceptance Criteria

- [ ] **AC-1 (coverage / anti-drop):** For every presence token in §Design *Verification Tokens*, grepping its destination file(s) for that token **verbatim** returns a match. Reviewer-verified rows (listed there) are confirmed by the reviewer reading the destination, not by grep. This is the load-bearing guard against silently dropping a rule in transit; the grep is run, not eyeballed — there is no "equivalent phrasing" escape.
- [ ] **AC-2 (escalation contract has a home):** The Human Escalation Contract is delivered per consumer per the Partition Table — its "escalate" awareness reaches spec authoring (`canon-spec` skill + `spec.md`/`spec-revision.md`), its mid-implement path is present in `implement.md`, and its "notify" list is present in `qa.md`. It is **not** relocated verbatim as a monolith into a single surface.
- [ ] **AC-3 (dangling references rewired):** No prompt template, agent charter, startup constant, or skill body relies on `AGENTS.md` or `CLAUDE.md` being present for a rule it needs. Each prior "read AGENTS.md/CLAUDE.md for <rule>" reference is either (a) inlined, or (b) repointed to a doc that survives the vacate (`docs/*`). Verify: grep the injected JIT surfaces (prompt templates under `scripts/run-task/prompts/templates/`, `.claude/agents/*`, `.claude/skills/*`, `helpers.ts`) for `AGENTS.md` and `CLAUDE.md`; every remaining occurrence is justified in `handoff.md` as a pointer to surviving content, not a dependency on a soon-to-be-vacated rule. **This AC is reviewer-adjudicated** (prose review of the justification) — it is not covered by the AC-11 automated test. *(The author-facing artifact scaffolds under `.canon/templates/` are a distinct surface owned by AC-13, which requires zero remaining references there — not "justified" ones.)*
- [ ] **AC-4 (spec craft rules — pipeline + operator):** The spec-writing rules of thumb are present in `spec.md` and `spec-revision.md` (so pipeline spec authoring and full-tier auto-revision apply them) **and** in the `canon-spec` and `canon-spec-review` skills. Verify via the Partition Table anchors for those rows.
- [ ] **AC-5 (code-review craft rules):** The code-review rules of thumb are present in the code-review surfaces (`code-review-foreman.md` and/or `.claude/agents/code-review-anchored.md` / `code-review-cold.md`) per the Partition Table.
- [ ] **AC-6 (`AGENTS.md` / `CLAUDE.md` unchanged):** `git diff <base>...HEAD -- AGENTS.md CLAUDE.md templates/AGENTS.md templates/CLAUDE.md` is empty. This task adds no edit to those files or their mirrors.
- [ ] **AC-7 (`templates/` mirrors synced):** For every `CANON_OWNED` file edited (skills, agent charters), its `templates/<path>` mirror is regenerated and committed (`npm run sync-templates:check` passes).
- [ ] **AC-8 (anti-broadcast / scoping):** The two craft-rule classes do not bleed across phases, verified by the **absence tokens** in §Design *Verification Tokens* (a disjoint set, distinct from the presence tokens): the code-review-craft signatures must be absent from the spec surfaces, and the spec-writing-craft signatures must be absent from the code-review surfaces. spec_review-phase rules are a distinct third class and are exempt. Verified by absence-grep of those exact strings — not the generic presence anchors.
- [ ] **AC-9 (golden fixture):** `tests/run-task-prompts.golden.json` is regenerated to match the new prompt output and `npm test` passes.
- [ ] **AC-10 (build artifact current):** `npm run build` produces no `dist/` diff beyond `dist/scripts/run-task.js` (the bundle that inlines the edited prompt templates + `helpers.ts`); the committed `dist/scripts/run-task.js` matches a fresh build.
- [ ] **AC-11 (structural relocation test):** A test in `tests/run-task-prompts.test.ts` (confirmed to exist) asserts the AC-1 presence-token greps, the AC-8 absence-token greps, and the **AC-13 scaffold sweep** (reads `.canon/templates/*` from disk and asserts no `AGENTS.md`/`CLAUDE.md` reference remains, plus the `heads-up, not a change` token is present in `.canon/templates/spec.md`) against the destination surfaces, so future edits can't silently drop a rule, re-introduce cross-phase bleed, or re-add a scaffold dependency on the soon-to-vacate MD blocks. Reviewer-verified rows (§Verification Tokens) and AC-3's pointer justifications are out of the automated test's scope by design — they are reviewer-adjudicated.
- [ ] **AC-12 (Validation Matrix relocated to BOTH consumers, not dropped):** The structural change-type→check-category matrix has **two** consumers, and each gets a surviving canon-managed home:
  - **(a) Implementer (Codex)** — inlined in `implement.md`, verified by the `Migration runner + manual review` presence-token grep against that file (covered by AC-1/AC-11). Codex is the consumer that *runs* the applicable checks.
  - **(b) Spec author (Claude — conversational and pipeline)** — the change-type→category matrix is **inlined** into `.canon/templates/spec.md`'s "Validation Required" section, verified by the `Migration runner + manual review` presence-token grep against *that* file (covered by AC-1/AC-11). This is the surface every spec-authoring flow fills in (the conversational operator and the pipeline spec/spec-revision sessions both edit a `tasks/<id>/spec.md` scaffolded from it), it is canon-managed, and it survives the vacate. The author reads it to decide which validation categories to mark Required.
  - **(c) No JIT or spec-author surface relies on `AGENTS.md` for the category matrix.** `docs/architecture.md` §Validation is made self-contained (drops the "from `AGENTS.md`" phrasing) and retains the *project command bindings* (category→command); `.canon/templates/spec.md`'s "Validation Required" section points at it **only** for "which command runs for each category," not for the change-type→category rule (now inline). Both reviewer-confirmed.
  - The universal change-type→category matrix is **canon-supplied**, so its homes are canon-managed surfaces (`implement.md`, `.canon/templates/spec.md`) — not the project-specific `docs/architecture.md` (per the `docs/patterns.md` layering rule: universals do not live in project docs). The project command bindings legitimately remain in `docs/architecture.md`, so this is not an AC-6 violation and does not require duplicating bindings into `implement.md`.
- [ ] **AC-13 (canon artifact scaffolds carry zero dependence on the vacated MD blocks):** `grep -rE 'AGENTS\.md|CLAUDE\.md' .canon/templates/` returns **no matches** after this task (the mirror under `templates/.canon/templates/` follows via AC-7's sync check). Every canon-managed scaffold that today points at an `AGENTS.md`/`CLAUDE.md` canon-block rule is either inlined or repointed to a doc that survives the vacate. This closes the **entire** scaffold-dependency class in one sweep rather than patching one site — the Validation Matrix and Docs Freshness findings are the *same bug class at successive sites* (a scaffold rule with a spec-author / QA-author consumer pointing at a soon-to-vacate rule), and `done.md` / `status.json` carry two more instances that an unswept fix would leave for a later review round. The four sites and their handling:
  - **`.canon/templates/spec.md` "Validation Required"** — inline the universal change-type→category matrix (this is the AC-12b relocation; presence token `Migration runner + manual review`).
  - **`.canon/templates/spec.md` "Docs Impact"** — replace the `AGENTS.md` "Docs Freshness" pointer with the inlined **protected-docs list** (`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/product-context.md`) and the spec-phase rule ("name any protected doc that might go stale if this ships; this is a heads-up, not a change — the actual update happens at QA"). Presence token: `heads-up, not a change` (covered by AC-1/AC-11). The protected-doc names are reviewer-confirmed present. This is the round-3 `spec_review` blocker: the Docs Freshness rule has the same two-consumer shape as the Validation Matrix (spec-author *heads-up* checkpoint + QA *scan-and-update* checkpoint), and only the QA half was previously relocated.
  - **`.canon/templates/done.md` "Proposed Changelog"** — repoint the changelog-scope line from `AGENTS.md §"Release Rules"` to the project changelog policy in `docs/decisions.md` §"Versioning and release policy" (the canon-universal Release Rules already reach the QA author via `qa.md`); reviewer-confirmed.
  - **`.canon/templates/status.json` `_full_send` comment** — repoint from `AGENTS.md Full-send mode` to `docs/pipeline-orchestrator.md` (the `--full-send` flag is documented there); reviewer-confirmed.

## Design

### Partition Table (the contract)

Each row names the rule, where it lives today, and the destination surface(s) it must reach. The **Anchor** column is descriptive only; the **authoritative, mechanical** verification set (distinctive verbatim tokens for presence, a disjoint set for absence) is the *Verification Tokens* subsection below — that is what AC-1 / AC-8 / AC-11 grep against.

**→ `implement.md` / `implement-revisions.md` (Codex implementation):**

| Rule (source) | Today | Destination | Anchor |
|---|---|---|---|
| Safe-First Rules (guarded-first; explicit user action; shared types) | AGENTS.md, sole | `implement.md` | "safer guarded" |
| Scope Discipline rules 2 & 3 (no new abstractions; no incidental dependency changes) | AGENTS.md (rule 1's *concept* is enforced in `implement.md` via the unrelated-failure/scope wording, [implement.md:22]; plan confirms whether to add rule 1's explicit "Affected Files is the scope cap" statement) | `implement.md` | see Verification Tokens |
| Lint & Type Safety Policy (suppression justification; `any`→`unknown`) | AGENTS.md, sole | `implement.md` | "suppression"; "`unknown`" |
| Parsing Structured Input (cell-by-cell; reject malformed) | AGENTS.md, sole | `implement.md` | "cell-by-cell" |
| Deleted-file ref rules (Changes-table markdown-link only; prose no backticks) | AGENTS.md, sole | `implement.md` / `implement-revisions.md` | "markdown-link" |
| Reverting a file during iteration (`git show origin/<base>:<path>`; perfect vs imperfect) | AGENTS.md, sole | `implement-revisions.md` | "git show origin" |
| Rerouted/revised cumulative-diff rule (union of all Changes tables) | AGENTS.md, sole | `implement-revisions.md` | "cumulative" / "union" |
| **Validation Matrix** (structural change-type → check-category, 7 rows) | AGENTS.md, sole (implement.md, spec scaffold, architecture.md all depend on it) | `implement.md` (inline the universal matrix — Codex is the consumer that runs the checks; mirrors how Safe-First etc. inline here). The **spec-author** consumer gets its own inline copy of the universal matrix in `.canon/templates/spec.md`'s "Validation Required" section (canon-managed scaffold). Project command bindings stay in the project's validation doc (canon-ai: `docs/architecture.md` §Validation), which is made self-contained — see the Decomposed group below. | "Migration runner + manual review" |

**→ `spec-review.md` / `spec-review-reroute.md` (Codex spec review):**

| Rule | Today | Destination | Anchor |
|---|---|---|---|
| Agents table + cross-review ("no agent reviews its own output") | AGENTS.md, sole | `spec-review.md` | "reviews its own" |
| Diagnose Before You Fix — 3-role checkpoint (author verifies / reviewer challenges / implementer reproduces) | AGENTS.md (spec-review.md hints only) | `spec-review.md` | "verified mechanism" |

**→ `qa.md` (Claude QA):**

| Rule | Today | Destination | Anchor |
|---|---|---|---|
| Release Rules (4: authorization, QA entry-only, separate commit, no major surprises) | AGENTS.md (qa.md links it) | `qa.md` | "entry only" / "version bump" |
| Handoff Validation pre-merge checklist | AGENTS.md, sole | `qa.md` | "pre-merge" |
| Output Format for Human (done.md structure) | AGENTS.md (qa.md hints) | `qa.md` | "done.md" structure list |
| Docs Freshness — protected-docs list + 2-checkpoint | AGENTS.md (qa.md partial) | **Two consumers** (like the Validation Matrix): `qa.md` carries the QA *scan-and-update* checkpoint (token `Two-checkpoint`); `.canon/templates/spec.md` "Docs Impact" carries the spec-author *heads-up* checkpoint + protected-docs list (AC-13, token `heads-up, not a change`) | named protected docs; `Two-checkpoint`; `heads-up, not a change` |
| Code is Canonical; Docs Reference Symbols | AGENTS.md, sole | `qa.md` | "reference symbols" |
| Commit Ownership categories | AGENTS.md, sole | `qa.md` | "Commit Ownership" |

**→ code-review surfaces (`code-review-foreman.md`, `.claude/agents/code-review-*.md`):**

| Rule | Today | Destination | Anchor |
|---|---|---|---|
| Code-review rules of thumb (baseline-diff on release branches; verify handoff via `git diff`; delicate cross-cutting guards; `git -C`; don't infer one git invariant from another; cross-cutting helper consolidation) | CLAUDE.md, sole | foreman + lens charters (scoped to what each lens does) | "task baseline"; "git -C"; "cross-cutting" |

**→ spec surfaces (`spec.md`, `spec-revision.md`) + skills (`canon-spec`, `canon-spec-review`):**

| Rule | Today | Destination | Anchor |
|---|---|---|---|
| Spec-writing rules of thumb (name-effects-to-delete; positive/structural over prose negation; symbol+return-shape verify; grep allow-list from `git grep`; behavioral-contracts-not-mechanics; refactor caps; iteration-shape; etc.) | CLAUDE.md, sole | `spec.md` + `spec-revision.md` + `canon-spec` skill + `canon-spec-review` skill | "name effects to DELETE"; "structural"/"grep AC" |

**→ `helpers.ts` startup constants (cross-cutting, minimal):**

| Rule | Today | Destination | Anchor |
|---|---|---|---|
| Communication norms (lead with finding; honest signal is canon) | AGENTS.md, sole | `CODEX_STARTUP` + `CLAUDE_STARTUP` (one line each) | "honest signal" |
| Git workflow for Codex (branch sync / CI resync / serialized git) | AGENTS.md (CODEX_STARTUP partial) | `CODEX_STARTUP` | "rebase"; existing git-ownership block |

**→ Decomposed / already-structural (verify coverage, relocate the gaps):**

| Rule | Handling |
|---|---|
| Human Escalation Contract | Decompose per AC-2: sensitive-surface awareness → `canon-spec` skill + `spec.md`/`spec-revision.md` (relies on `docs/product-context.md` delicate-domain list, unchanged); mid-implement escalation → `implement.md` Blocker/`[ambiguity]` path (verify present); "notify" list → `qa.md` done.md. Operator-gate slice already in `canon-pipeline` skill / `docs/pipeline-orchestrator.md`. |
| Pipeline Tiers / Full-send / Bundle mode | Operator-facing; already in `docs/pipeline-orchestrator.md` + `canon-pipeline` skill. No relocation; rewire any dangling pointer (AC-3). |
| Validation Matrix — spec-author consumer | The matrix has two consumers; the implementer copy lands in `implement.md` (row above). The **spec author** also consumes it (to decide which categories to mark Required), so it needs its own surviving home: **inline the canon-universal change-type→category matrix into `.canon/templates/spec.md`'s "Validation Required" section** (canon-managed scaffold — every spec-authoring flow fills a `tasks/<id>/spec.md` derived from it), replacing the "(from `AGENTS.md` validation matrix)" pointer. That section then points at `docs/architecture.md` §Validation **only** for the per-category command binding. Separately, `docs/architecture.md` §Validation is made self-contained — neutralize the "Category (from AGENTS.md)" / "`AGENTS.md` §Validation Matrix defines the categories" phrasing so its category→command binding table no longer depends on the AGENTS.md matrix; it survives the vacate as canon-ai's command-binding reference. The two-consumer relocation is asserted by AC-12; the architecture.md self-containment is the AC-3 rewire. |
| Canon artifact scaffolds (`.canon/templates/*`) — full sweep | The scaffolds `canon task new` copies into each task dir carry **four** live `AGENTS.md`/`CLAUDE.md` canon-block dependencies, all the same bug class (a scaffold instruction pointing at a soon-to-vacate rule): Validation Matrix + Docs Freshness (`spec.md`), Release-Rules changelog scope (`done.md`), Full-send (`status.json`). AC-13 makes the whole `.canon/templates/` surface self-contained — inline the universal rules into `spec.md`, repoint the project-policy / operator pointers to surviving docs (`done.md` → `docs/decisions.md` §"Versioning and release policy"; `status.json` → `docs/pipeline-orchestrator.md`). One grep invariant (`grep -rE 'AGENTS\.md\|CLAUDE\.md' .canon/templates/` → no matches) closes the class so no later round surfaces a fifth site. |

### Verification Tokens (authoritative for AC-1 / AC-8 / AC-11)

Distinctive verbatim tokens — chosen unique enough that a grep match proves the rule landed (no generic single words). Implement must emit each token **verbatim** in its destination; surrounding prose may be reworded freely.

**Presence tokens (AC-1) — destination → token(s) that must appear:**

- `implement.md`: `ship the safer guarded behavior first` (Safe-First) · `No unauthorized new abstractions` + `No incidental dependency changes` (Scope Discipline 2&3) · `Suppressing a lint or type error is a last resort` (Lint/Type) · `Parse cell-by-cell with explicit rejection` (Parsing) · `Migration runner + manual review` (Validation Matrix — distinctive row of the inlined change-type→check-category matrix)
- `implement-revisions.md`: `git show origin/` (revert) · `the pre-flight diff is cumulative` (cumulative-diff) · `Referencing deleted` (deleted-file refs — may instead land in `implement.md`; token must appear in whichever)
- `spec-review.md`: `No agent reviews its own output` (cross-review) · `Each role owns a checkpoint` (Diagnose 3-role)
- `qa.md`: `Agents do not bump versions` (Release Rules) · `Handoff Validation` (pre-merge checklist) · `One-paragraph plain-English summary` (Output Format) · `Two-checkpoint` (Docs Freshness) · `Code is Canonical` (Code-is-Canonical) · `Commit Ownership` (Commit Ownership)
- `spec.md` **and** `spec-revision.md` **and** `canon-spec`/`canon-spec-review` skills: `Name effects to DELETE` + `Prefer positive or structural assertions` (spec-writing rules of thumb)
- `.canon/templates/spec.md` (spec scaffold — the spec-author's surviving home for the Validation Matrix **and** Docs Freshness): `Migration runner + manual review` (distinctive row of the inlined change-type→category matrix, AC-12b) · `heads-up, not a change` (inlined spec-phase Docs Freshness rule, AC-13)
- `helpers.ts` `CODEX_STARTUP` + `CLAUDE_STARTUP`: `honest signal is canon` (communication norms); plus `pull --rebase` in `CODEX_STARTUP` (git workflow)

**Reviewer-verified rows (no mechanical token — reviewer confirms by reading; excluded from the AC-11 test):**

- Code-review rules of thumb across `code-review-foreman.md` + lens charters: per-rule placement is a judgment. Reviewer confirms the foreman / anchored lens carry baseline-diffing, handoff-verification (`git diff`), and cross-cutting-helper guidance, and that the **cold lens stays spec-blind** (gained nothing spec-aware).
- Validation Matrix relocation + rewire (AC-12): the `Migration runner + manual review` token in **both** `implement.md` and `.canon/templates/spec.md` is mechanically covered (AC-1/AC-11). Reviewer additionally confirms (a) `docs/architecture.md` §Validation is self-contained (no longer states the categories live in `AGENTS.md`; still lists every category→command binding) and (b) `.canon/templates/spec.md`'s "Validation Required" section presents the inline change-type→category matrix and points at `docs/architecture.md` §Validation only for the per-category command, not at the AGENTS.md matrix.
- Canon scaffold repoints (AC-13, beyond the two mechanical tokens above): reviewer confirms (a) `.canon/templates/spec.md` "Docs Impact" names the five protected docs and drops the `AGENTS.md` "Docs Freshness" pointer; (b) `.canon/templates/done.md`'s changelog-scope line points at `docs/decisions.md` §"Versioning and release policy" rather than `AGENTS.md §"Release Rules"`; (c) `.canon/templates/status.json`'s `_full_send` comment points at `docs/pipeline-orchestrator.md`; and (d) the AC-13 sweep grep returns no matches.
- Human Escalation Contract decomposition (AC-2) and the AC-3 pointer justifications.

**Absence tokens (AC-8) — these exact strings must NOT appear on the wrong surface:**

- `spec.md`, `spec-revision.md`, `spec-review.md` must NOT contain `task baseline` or `git -C` (code-review-craft signatures).
- `code-review-foreman.md`, `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md` must NOT contain `Name effects to DELETE` or `Prefer positive or structural assertions` (spec-writing-craft signatures).
- spec_review-phase rules (`No agent reviews its own output`, `Each role owns a checkpoint`) are a **distinct third class** — legitimately present in `spec-review.md`, not part of either absence set.

### Mechanics deferred

Exact prose, ordering within each destination, and whether a rule lands in the foreman vs. a lens charter (for code-review rules) are implementation decisions, constrained by AC-1/AC-8. The plan phase resolves placement; the structural test (AC-11) locks it.

### Affected Files

> `AGENTS.md` / `CLAUDE.md` are intentionally absent — AC-6 requires them unchanged.

| File | Change |
|---|---|
| `scripts/run-task/prompts/templates/implement.md` | Add Safe-First, Scope Discipline 2&3, Lint/Type, Parsing rules; inline the structural Validation Matrix (change-type→check-category) and rewire line 20's "the matrix in AGENTS.md" to the inlined copy (command bindings still point at the project's validation doc) |
| `scripts/run-task/prompts/templates/implement-revisions.md` | Add revert-during-iteration, cumulative-diff, deleted-file ref rules |
| `scripts/run-task/prompts/templates/spec-review.md` | Add Agents/cross-review, expand Diagnose 3-role |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | Carry cross-review/diagnose anchors if its phase needs them (reconcile in plan) |
| `scripts/run-task/prompts/templates/qa.md` | Inline Release Rules, Handoff Validation, Output Format, Docs Freshness list, Code-is-Canonical, Commit Ownership |
| `scripts/run-task/prompts/templates/spec.md` | Inject spec-writing rules of thumb |
| `scripts/run-task/prompts/templates/spec-revision.md` | Inject spec-writing rules of thumb |
| `scripts/run-task/prompts/templates/code-review-foreman.md` | Add code-review rules of thumb (foreman-scoped) |
| `scripts/run-task/prompts/helpers.ts` | Add communication-norms + git-workflow lines to `CODEX_STARTUP`/`CLAUDE_STARTUP`; rewire "read AGENTS.md" wording |
| `.claude/agents/code-review-anchored.md` | Add code-review rules relevant to the anchored lens |
| `.claude/agents/code-review-cold.md` | Add only diff-relevant rules (keep cold lens spec-blind) |
| `.claude/skills/canon-spec/SKILL.md` | Inline spec-writing rules of thumb; rewire dangling AGENTS.md/CLAUDE.md refs |
| `.claude/skills/canon-spec-review/SKILL.md` | Inline spec-writing rules (Agent C already references them); rewire refs |
| `.claude/skills/canon-pipeline/SKILL.md` | Rewire dangling AGENTS.md/CLAUDE.md refs to `docs/pipeline-orchestrator.md` |
| `.claude/skills/canon-changelog/SKILL.md` | Rewire "AGENTS.md §Release Rules" ref |
| `.claude/skills/canon-init/SKILL.md` | Rewire dangling AGENTS.md refs |
| `templates/.claude/agents/code-review-anchored.md` | Mirror (pre-commit sync) |
| `templates/.claude/agents/code-review-cold.md` | Mirror |
| `templates/.claude/skills/canon-spec/SKILL.md` | Mirror |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Mirror |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirror |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Mirror |
| `templates/.claude/skills/canon-init/SKILL.md` | Mirror |
| `tests/run-task-prompts.golden.json` | Regenerate (prompt output changed) |
| `tests/run-task-prompts.test.ts` | Add AC-11 presence-token / absence-token grep assertions (file confirmed to exist) |
| `dist/scripts/run-task.js` | Build artifact — regenerated by `npm run build` (inlines edited prompt templates + `helpers.ts`) |
| `.canon/templates/spec.md` | Two AGENTS.md dependencies removed (AC-12b + AC-13): (1) "Validation Required" — replace the "(from `AGENTS.md` validation matrix)" pointer with the **inline** canon-universal change-type→category matrix (must contain `Migration runner + manual review`); point at `docs/architecture.md` §Validation only for the per-category command binding. (2) "Docs Impact" — replace the "(see `AGENTS.md` "Docs Freshness")" pointer with the inlined protected-docs list + spec-phase heads-up rule (must contain `heads-up, not a change`) |
| `.canon/templates/done.md` | "Proposed Changelog" section — repoint the changelog-scope line from `AGENTS.md §"Release Rules"` to `docs/decisions.md` §"Versioning and release policy" (AC-13) |
| `.canon/templates/status.json` | `_full_send` comment — repoint from `AGENTS.md Full-send mode` to `docs/pipeline-orchestrator.md` (AC-13) |
| `templates/.canon/templates/spec.md` | Mirror of the above (pre-commit sync; `CANON_OWNED`) |
| `templates/.canon/templates/done.md` | Mirror (pre-commit sync; `CANON_OWNED`) |
| `templates/.canon/templates/status.json` | Mirror (pre-commit sync; `CANON_OWNED`) |
| `docs/architecture.md` | Make §Validation self-contained: neutralize the "`AGENTS.md` §Validation Matrix defines the categories" / "Category (from AGENTS.md)" phrasing so the category→command binding table no longer depends on the AGENTS.md matrix. It holds the project command bindings only — the universal change-type→category matrix now lives in the canon-managed scaffold + `implement.md`; survives the vacate as canon-ai's command-binding reference (AC-3/AC-12) |
| `docs/codebase-map.md` | Update helpers/prompt-template content-role notes (QA Docs Freshness) |
| `docs/decisions.md` | Add decision entry: canon rules delivered JIT per-phase, not via auto-loaded MD |

### Interaction Dependencies

- The vacate task and the nudge task both depend on this task completing first.
- The golden-fixture snapshot couples to every prompt edit; expect a single large regeneration.
- `templates/` mirrors are auto-synced by the pre-commit hook; both root and mirror must appear in the handoff Changes table (per canon's own lessons).

### Data Model Changes

None. No `status.json` schema, type, or persistent-shape changes.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; includes the regenerated golden fixture and the new AC-11 structural test
- [x] `npm run sync-templates:check` — `templates/` mirrors aligned
- [x] `npm run docs-refs-check` — edited skills/docs have no broken refs
- [x] `npm run build` — `dist/scripts/run-task.js` regenerated; committed dist matches fresh build
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `docs/decisions.md` — **new entry** establishing JIT-per-phase rule delivery (listed in Affected Files; this is the decision this task settles).
- `docs/architecture.md` — §Validation made self-contained so the category→command binding table no longer depends on `AGENTS.md` (listed in Affected Files; the universal change-type→category matrix relocates to the canon-managed scaffold + `implement.md`, while architecture.md survives the vacate as canon-ai's command-binding reference).
- `docs/codebase-map.md` — helpers.ts / prompt-template content-role notes now carry operating rules (listed in Affected Files).
- `docs/patterns.md` — candidate Known-Pitfall: "relocate rules scoped per phase, never broadcast" — QA decides whether it generalizes.
- `docs/pipeline-orchestrator.md` — only if a rewired pointer needs new operator-facing content there; reconcile in plan (it is `CANON_OWNED`, so a `templates/` mirror row would be added if touched).

## Known Risks

- **Silent rule-drop (highest risk).** Relocating 22 rules by hand can drop or garble one, silently degrading every future task — the Validation Matrix omission caught in spec review is exactly this failure mode surfacing at spec time. Mitigation: AC-1 structural grep per row + AC-11 test. The reviewer must run the Anchor greps, not eyeball.
- **Scaffold-pointer whack-a-mole.** The same bug class — a `.canon/templates/*` scaffold pointing at a to-be-vacated `AGENTS.md`/`CLAUDE.md` rule — surfaced across successive `spec_review` rounds at successive sites (Validation Matrix, then Docs Freshness), and two more sites (`done.md`, `status.json`) sit unflagged. Patching one site per round is the wrong shape (canon's own cross-cutting-helper lesson). Mitigation: AC-13 closes the *entire* class with one grep invariant (`grep -rE 'AGENTS\.md|CLAUDE\.md' .canon/templates/` → no matches) instead of site-by-site fixes.
- **Over-broadcast.** The easy wrong move is to paste whole AGENTS.md sections into every template, forfeiting the scoping win. Mitigation: AC-8 absence-grep + AC-11.
- **Cold-lens contamination.** `code-review-cold.md` must stay spec-blind — only diff-relevant rules may land there; spec-anchored guidance would break the cold lens's purpose. Reviewer verifies the cold charter gained nothing spec-aware.
- **Escalation-contract placement is a judgment call.** It is decomposed, not verbatim-relocated (AC-2); a reviewer expecting a single verbatim block will mis-assess. The decomposition rationale is in §Design.
- **Golden-fixture churn.** A large, legitimate snapshot diff; the risk is rubber-stamping it. Mitigation: the regeneration must be reviewed against intended prompt changes, not blindly accepted.
- **Interim duplication.** Rules now live in both the MD blocks and the JIT surfaces until the vacate task. This is intentional and safe (canon-ai's own agents double-load harmlessly); not a defect.
- **Spec size.** 22 relocations is high-volume (though mechanically uniform). If `spec_review` thrashes on volume rather than design (Shape Check clean, repeated wording `changes_requested`), the escape hatch is to split Task A by destination group (Codex-impl / review / QA / spec-craft) rather than iterate — per canon's own "spec size, not design" diagnostic.

## Human Test Plan

1. After the change, start a normal canon task that *tempts scope creep* (e.g., a small fix adjacent to a refactor opportunity) and whose change type spans more than one validation category (e.g., touches both code and a build artifact). Run it through `implement`. **Expected:** Codex still honors scope discipline — no new abstraction, no files outside Affected Files — and still runs every check category that applies to the change type, just as before. (Confirms Safe-First / Scope Discipline *and* the Validation Matrix reach Codex via the prompt, not auto-load.)
2. Take a task to full-tier `spec_review` `changes_requested` so the pipeline auto-revises the spec. **Expected:** the revised spec still follows the spec-writing rules of thumb (names effects to delete, prefers structural/grep assertions). (Confirms spec-writing rules reach pipeline spec authoring.)
3. Run a task to `code_review`. **Expected:** the review still applies the code-review discipline (baseline diffing, handoff verification) and the cold lens still reviews diff-only with no spec awareness.
4. Open `AGENTS.md` and `CLAUDE.md`. **Expected:** unchanged from before this task — still full canon blocks. (Confirms nothing was vacated.)
5. Scaffold a throwaway task (`canon task new`) and open its scaffolded `spec.md`, `done.md`, and `status.json`. **Expected:** the Validation Required and Docs Impact guidance is complete inline (validation categories listed; the protected docs to consider named), the changelog and full-send notes point you at the project docs, and **none** of these scaffolds tells you to "go read AGENTS.md / CLAUDE.md." (Confirms the scaffolds survive the later vacate — AC-13.)
6. Confirm the project still passes its own checks: lint, type-check, tests, build, template-sync, docs-refs.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan is a pipeline phase)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — uses phase/behavior language a canon operator reads
- [x] Validation Required has at least one entry marked `- [x]`
