# Spec: adopter-agent-file-redesign — Agent files come from built-in /init; canon stops referencing and generating them

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The "canon vacates adopter MD" program (Tasks A+B+C, on `main`, unreleased) made `AGENTS.md`/`CLAUDE.md` adopter-owned and stopped shipping managed content into them. But canon is still entangled with these files in three ways that are now redundant or misleading:

1. **Instructional/descriptive references remain** across canon's docs and skills — "read `AGENTS.md`", "operator context in `CLAUDE.md`", and prose that frames them as canon rule-homes. These are dead weight: **each agent auto-loads its own file** (Claude Code → `CLAUDE.md`; Codex → `AGENTS.md`), and the operating rules already arrive just-in-time via prompts/skills (Task A). A reference telling an agent to read a file it already auto-loads is noise; one that points at a rule which has moved is actively wrong.
2. **`/canon-init` still claims to generate the agent files** (`README.md`: "generates the full canon document set: `AGENTS.md`, `CLAUDE.md`, and the `docs/` knowledge corpus"). Post-vacate the skill no longer writes them — agent files are the job of the **tool-native `/init`** (Claude's `/init`, Codex's init), which produces a standard high-level codebase overview.
3. **canon-ai's own agent files haven't been settled** into the end-state shape. They should dogfood exactly what an adopter gets: a high-level `/init`-style overview, consolidated so both agents converge on one source.

Leaving this half-done ships an incoherent story: canon tells adopters their agent files are theirs, while canon's own docs still read/reference/generate them as if canon owned them.

## Decision

Get canon out of the agent-file business and dogfood the result.

1. **Agent files are produced by the tool-native `/init`** (Claude `/init` → `CLAUDE.md`; Codex init → `AGENTS.md`) as a high-level codebase overview. Canon does not generate, manage, or instruct agents to read them.
2. **Strip** canon's instructional/descriptive references to `AGENTS.md`/`CLAUDE.md` from its docs and skills (auto-load + JIT prompts handle delivery). The only references that remain are operational code that *operates* on the files, decision records, tests, README's adopter recommendation, "adopter-owned, when present" descriptions, and accurate operational/CI descriptions that name the files without framing them as rule-homes.
3. **`/canon-init` is scoped to the `docs/` knowledge corpus only** — it does not claim to generate *or read* the agent files. README/skill text that says otherwise is corrected and repointed to the built-in `/init`.
4. **README owns the recommendation**: adopters should generate their agent files via the built-in `/init` (Claude and/or Codex), and may consolidate (see below). This is the one human-facing "you should have these" home.
5. **`canon doctor` advises**: when neither agent file exists → advise running `/init`; when a file exists but neither mentions canon → advise adding the discovery nudge. (Warn-only, never fails.)
6. **Consolidation (audience-split)**: the *shared overview* lives once in `AGENTS.md` (genuinely useful to both agents in every phase); canon-ai's `CLAUDE.md` imports it via `@AGENTS.md` (Claude Code expands `@path` imports into context at launch) and appends **only** the Claude-conversational-operator norms. Codex auto-loads `AGENTS.md` natively and gets the overview with no operator-only instructions; Claude auto-loads `CLAUDE.md` → the overview + its operator addendum. Both converge on one shared overview; operator-only norms stay out of Codex's context (e.g. "don't intervene in `spec_review` auto-revision" is meaningless to Codex, which *is* the spec_review agent). The `@AGENTS.md` import is **recommended to adopters, not mandated.**
7. **canon-ai dogfoods**: its `AGENTS.md` is rewritten as the shared high-level overview (what it is + phases, roles, the cross-review + communication norms which are dual-useful, commands, conventions, structure, and a "where to go deeper" doc-pointer map); its `CLAUDE.md` is reduced to `@AGENTS.md` + the four conversational-operator norms.
8. **Reframe the leftover prose/cells** that imply the agent files are canon rule-homes (or that canon/the pipeline reads them) but that a literal token-grep won't catch (philosophy lines, getting-started steps, a trigger-table cell).

## Non-Goals

- **Not re-managing the agent files.** `AGENTS.md`/`CLAUDE.md` stay out of `CANON_OWNED` and `DELIMITED`; built-in `/init` owns generation. (Backed by a structural AC.)
- **Not mandating consolidation for adopters** — `@AGENTS.md` is a documented option, not a requirement.
- **Not touching the pipeline prompt layer.** The vacate already removed all agent-file reads from `scripts/run-task/prompts/`; a test guards it (`tests/run-task-prompts.test.ts`). No prompt-template edits, so the prompt golden does not change.
- **Not touching any delicate orchestrator surface** (routing, auto-commit, validation gates, pipeline policy, status schema). Any `docs/pipeline-orchestrator.md` and CLI-banner edits are **prose/string-only** — correcting stale read claims and dangling rule-home pointers; no orchestrator code, flag, or behavior changes.
- **No version bump or CHANGELOG version line.** This folds into the pending 2.0.0 release; QA proposes changelog entry text only.
- **Not re-sweeping the `templates/docs/*` adopter stubs** that the vacate already corrected — except any residual the AC-1/AC-2 sweep surfaces.

## Acceptance Criteria

> **Shape note.** The strip is specified as a **structural post-condition over a grep**, not a hand-enumerated list of lines. Implement runs the grep, reframes/strips every non-allow-listed hit, fixes any pointer left dangling by the slimming, and **extends `### Affected Files` with every file it actually touches before `--pr`**. The spec defines the *end state and the allow-list categories*; the grep defines the *work set*. Do not enumerate individual line numbers in any AC.

- [ ] **AC-1 (strip — structural post-condition):** After this task, `git grep -nE 'AGENTS\.md|CLAUDE\.md'` across canon's shipped + authority surfaces — `src/`, `scripts/`, `.claude/skills/`, `docs/` (excluding the historical/log docs: `docs/lessons-learned.md`, `docs/BACKLOG.md`, `docs/task-quality-log.md`, and the dated `docs/*-report.md` / `docs/harness-audit-*.md` retrospectives, plus any `templates/docs/*` mirrors of those), `README.md`, `AGENTS.md`, `CLAUDE.md`, and all `templates/` mirrors; excluding `dist/`, `tasks/`, `CHANGELOG.md` — returns **only lines that fall into the allow-listed categories below**. No "read `AGENTS.md`/`CLAUDE.md`" instruction and no "rule X lives in `AGENTS.md`/`CLAUDE.md`" claim survives in any non-allow-listed line. This includes pointers left dangling by AC-6's slimming of `CLAUDE.md` (e.g. runtime `--reroute` help/usage banners that referenced a now-removed `CLAUDE.md` section): implement repoints them to their real source of truth in `docs/` (the reroute mechanics live in `docs/pipeline-orchestrator.md`). Allow-listed categories (by **kind**, exhaustive — these are the only references that may remain):
  - **(a) Operational code that operates on the files** — `init.ts`'s `AGENT_FILES` set and scaffold-detection notice, `doctor.ts`'s discovery-nudge check, `docs-refs-check.mjs`'s root-file scan-list and illustrative comments, and the auto-synced `templates/` mirrors of these.
  - **(b) Decision records** in `docs/decisions.md`.
  - **(c) README's adopter recommendation** (AC-4) and its adopter-owned framing (AC-3).
  - **(d) Test files.**
  - **(e) "Adopter-owned, when present" descriptions** (independent adopter stubs and Related-References lines that describe the files as the adopter's, without instructing a read or claiming a rule lives there).
  - **(f) canon-ai's own consolidation artifacts** — `CLAUDE.md`'s `@AGENTS.md` import and its conversational-operator-norms addendum, and the `AGENTS.md` self-reference in its Local Convention note.
  - **(g) Accurate operational/CI descriptions** that *name* the files without rule-home framing — e.g. CI path-filter lists that re-include the root operator docs, worktree-visibility notes, and the `canon doctor` behavior summary.
  - Verify: run the grep over the full tree (root + `templates/`); every surviving hit maps to one of (a)–(g); produce no line that tells an agent to read the files or claims a canon rule is homed in them.
- [ ] **AC-2 (reframe rule-home framing a token-grep misses):** Some prose frames the agent files as canon rule-homes — or claims canon/the pipeline *reads* them — **without naming an `AGENTS.md`/`CLAUDE.md` token**, so the AC-1 grep cannot catch it. Implement reviews canon's philosophy/pitch prose, getting-started steps, and trigger-table cells across `README.md`, `docs/product-context.md`, `docs/patterns.md`, and `docs/pipeline-orchestrator.md`, and reframes any such claim to the auto-load + JIT reality: agent files are adopter-owned high-level overviews; operating rules arrive just-in-time via prompts/skills; the pipeline reads the protected `docs/*` corpus and JIT prompt/skill guidance on session start, **not** adopter agent files. Illustrative (not exhaustive): `docs/patterns.md`'s Lint/TS trigger-table cell reading "*(rule, no canonical file)*" is repointed to its real home `scripts/run-task/prompts/templates/implement.md` (consistent with the `:91` fix already on `main`). Verify: after the reframe, re-read the philosophy/getting-started/trigger prose in those files and confirm none implies a canon rule-home or a canon/pipeline read of the agent files.
- [ ] **AC-3 (`/canon-init` scoped to docs corpus):** Neither `.claude/skills/canon-init/SKILL.md`, `.claude/skills/canon-init/write-guide.md`, nor `README.md` claims `/canon-init` **generates** or **reads** `AGENTS.md`/`CLAUDE.md`. README's "generates the full canon document set: AGENTS.md, CLAUDE.md, and the docs/ knowledge corpus" is corrected to the `docs/` corpus only and points to the built-in `/init` for agent files; README's "if they already exist, `/canon-init` reads them as project context" read claim is cut (the skill reads only the `docs/` corpus). The adopter-owned framing ("`AGENTS.md` and `CLAUDE.md` are adopter-owned; canon does not scaffold, modify, or read them") remains (allow-listed under AC-1). The skill's knowledge-corpus generation is otherwise unchanged. Verify: grep the canon-init skill + write-guide + README for any agent-file *generation* or *read-as-context* claim → none.
- [ ] **AC-4 (README recommendation):** `README.md` recommends adopters generate their agent files via the built-in `/init` (Claude and/or Codex) and documents the optional `CLAUDE.md` = `@AGENTS.md` consolidation. The existing `RECOMMENDED_NUDGE`↔README drift test still passes (or is updated in lockstep if the nudge presentation moves).
- [ ] **AC-5 (`doctor` advisory):** `checkCanonDiscoveryNudge` (`src/cli/commands/doctor.ts`) distinguishes two warn states: (i) **neither** `CLAUDE.md` nor `AGENTS.md` exists → detail advises running the built-in `/init`; (ii) a file exists but **neither mentions canon** → detail advises adding the nudge. It still returns `pass` when either mentions canon, and **never** returns `fail`. Verify: unit tests in `tests/cli.test.ts` cover both warn branches and the pass case.
- [ ] **AC-6 (consolidation — canon-ai dogfood, audience-split):** The split is by **audience**, not file-count. canon-ai's `CLAUDE.md` consists of a `@AGENTS.md` import line (plus an optional one-line comment) followed by a short **Conversational Operator Norms** section containing exactly the four conversational-operator norms — **commit consent, never self-review inline work, default toward smaller models / lower effort, don't intervene in full-tier `spec_review` auto-revision** — and nothing else. canon-ai's `AGENTS.md` is the **shared high-level overview** (useful to both agents in every phase) comprising: what canon is + the pipeline phases + "route work through the `/canon-*` skills"; the roles table; the **cross-review rule and communication norm** (dual-useful — Codex relies on them writing handoffs/spec-reviews — so they live in the shared file); commands; structure/conventions; a **"where to go deeper" doc-pointer map** (each major subsystem → its `docs/` home or the skills, as links, **not** reproduced prose); and operational notes (agent memory, per-task notes, observability, local convention). The four operator norms do **not** appear in `AGENTS.md` — Codex must not load operator-only instructions it cannot act on. Detailed mechanics (quick refs, reroute mechanics, review charters, command bindings, PR/CI rules) are not reproduced in either file — they live in the skills and `docs/`. Verify: `CLAUDE.md` = the `@AGENTS.md` import + the four-norm section and nothing else; `AGENTS.md` contains the overview + the doc-pointer map + the cross-review/comms norms; a grep of `AGENTS.md` confirms **none** of the four operator norms appear there; a grep of `CLAUDE.md` finds each of the four operator norms; no detailed-mechanics sections remain in either file.
- [ ] **AC-7 (not re-managed — structural):** `git grep -nE "'AGENTS\.md'|'CLAUDE\.md'" -- src/lib/canon-owned.ts` shows neither file added to `CANON_OWNED` or `DELIMITED`; no code writes or modifies `AGENTS.md`/`CLAUDE.md` (the `doctor` advisory is read-only; `init` does not create them).
- [ ] **AC-8 (templates mirrors in lockstep):** Every edited canon-owned file's `templates/` mirror reflects the change; `npm run sync-templates:check` passes. (The five canon-init/canon-spec/canon-spec-review/canon-pipeline skills and `docs/pipeline-orchestrator.md` / `scripts/docs-refs-check.mjs` are canon-owned and auto-sync root→mirror; root docs `patterns.md`/`codebase-map.md`/`product-context.md` are not mirrored pairs — their `templates/docs/*` stubs are independent.)
- [ ] **AC-9 (decision record — append + correct the stale read-claim):** Two coupled edits to `docs/decisions.md`. (i) **Append** an end-state entry recording the agent-files-via-`/init` decision (agent files are tool-native `/init` output, adopter-owned; canon references none; `@AGENTS.md` consolidation recommended). (ii) **Correct** the existing "Canon ships zero owned content into adopter agent files" entry, whose **Rule** still ends "If a repo already has them, canon setup reads them as adopter-owned context only" — that read-claim now contradicts AC-3/AC-11 (the `/canon-init` grill and `init` scaffold-notice no longer read the agent files). Replace that sentence so it reflects the end state: built-in `/init` generates the files, canon does not read them, and canon only **detects** their presence (the `init` adopter-owned notice + the `doctor` discovery nudge). Do not delete the entry — it remains the standing record that the files are not `CANON_OWNED`/`DELIMITED`; only its last sentence is corrected. Verify: `git grep -n "reads them as adopter-owned context only" -- docs/decisions.md` returns nothing, and no other line in `docs/decisions.md` claims canon (or `canon init`/`canon-init`/`canon setup`) **reads** the agent files; the new agent-files-via-`/init` entry is present.
- [ ] **AC-10 (build + validation clean):** `dist/` rebuilt for the `doctor`, `init`, and CLI-banner source changes; `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check` all pass. The prompt golden (`tests/run-task-prompts.golden.json`) is unchanged (prompt layer untouched) and the `run-task-prompts` agent-file guard still passes.
- [ ] **AC-11 (init scaffold notice drops the read claim):** `existingAgentFilesNoticeLines()` (`src/cli/commands/init.ts`) no longer claims the grill / `/canon-init` reads the agent files "as project context" — post-AC-3 the grill is scoped to the `docs/` corpus and does not read them. The notice still detects the files and states they are adopter-owned (canon does not insert, merge, or read managed content into them). `AGENT_FILES` and `hasExistingAgentFiles` are otherwise unchanged. This detection notice is the **one** runtime CLI string that legitimately names `AGENTS.md`/`CLAUDE.md` (an operational detection string, not a rule-home/feedback pointer); it is allow-listed under AC-1(a). Verify: the notice string contains no read-as-context claim; the `tests/cli.test.ts` notice test is updated in lockstep (drops the `/project context/` assertion, asserts the adopter-owned/no-read phrasing, keeps the `does-not-match /merge protocol/i` assertion).

## Design

### Affected Files

> This is the **confident starting manifest** (the behavioral-AC targets plus the files we already know carry references). Per the Shape note, implement runs the AC-1 grep over the full tree, strips/reframes every non-allow-listed hit, and **adds any further file it touches to this table before `--pr`** (the base-drift gate reads the final table, not this starting one). Recovery if a file is missed is cheap — add the path and re-run `--pr`, not `--force`.

| File | Change |
|---|---|
| `README.md` | AC-3/AC-4/AC-2: cut the `/canon-init` agent-file generation claim (→ docs corpus only + point to built-in `/init`); cut the "`/canon-init` reads them as project context" read claim (keep allow-listed adopter-owned framing); add the recommendation to generate agent files via `/init` + document `@AGENTS.md` consolidation; reframe the philosophy lines. |
| `AGENTS.md` | AC-6: rewrite as the **shared** high-level overview — what-it-is + phases, roles, cross-review + comms norms (dual-useful), commands, conventions, structure, a "where to go deeper" doc-pointer map, operational notes; **no** conversational-operator norms (those move to `CLAUDE.md`); drop detailed-mechanics sections. |
| `CLAUDE.md` | AC-6: reduce to `@AGENTS.md` import (+ optional one-line comment) + a short Conversational Operator Norms section (the four operator norms); nothing else. |
| `docs/patterns.md` | AC-1/AC-2: strip/repoint the `CLAUDE.md` operator-pointer refs and quick-reference rows to the auto-load/JIT reality + `docs/pipeline-orchestrator.md`; repoint the "(rule, no canonical file)" trigger-table cell to `implement.md`. |
| `docs/codebase-map.md` | AC-1/AC-2: strip/repoint the token-bearing agent-file references (Entry-Points + Agent-Config rows, Protected-Docs preamble) to the auto-load/JIT reality; leave accurate operational descriptions (e.g. the `canon doctor` summary) allow-listed and unchanged. |
| `docs/product-context.md` | AC-2/AC-1: reframe the philosophy/getting-started prose off the rule-home/read framing; strip token-bearing references that frame the files as orchestrator surfaces or rule attributions. |
| `docs/pipeline-orchestrator.md` | AC-2/AC-1: correct the stale "the pipeline reads the project's operator context" claim → reads the protected `docs/*` corpus + JIT prompt/skill guidance, not adopter agent files; keep allow-listed adopter-owned Related-References line. Doc prose only — no delicate orchestrator surface. |
| `docs/decisions.md` | AC-9: append the end-state agent-files-via-`/init` decision record **and** correct the existing "Canon ships zero owned content" entry's Rule — replace the trailing "canon setup reads them as adopter-owned context only" sentence with the end-state (built-in `/init` generates them; canon detects-only, never reads). |
| `src/cli/commands/init.ts` | AC-11: reword `existingAgentFilesNoticeLines()` to drop the read-as-context claim; keep adopter-owned/no-merge wording. `AGENT_FILES`/`hasExistingAgentFiles` unchanged. |
| `src/cli/commands/doctor.ts` | AC-5: extend `checkCanonDiscoveryNudge` to the two warn states (absent → `/init`; silent → nudge). |
| `scripts/run-task/cli.ts` | AC-1: repoint the `--reroute` help banner off the now-removed `CLAUDE.md` reroute section to `docs/pipeline-orchestrator.md`. |
| `src/cli/index.ts` | AC-1: repoint the `--reroute` usage banner off the now-removed `CLAUDE.md` reroute section to `docs/pipeline-orchestrator.md`. |
| `.claude/skills/canon-init/SKILL.md` | AC-1/AC-3: strip the Phase-0 "if AGENTS.md/CLAUDE.md exists, read it" lines and any read-instruction; ensure no agent-file generation claim; point to built-in `/init`; keep "adopter-owned" description. |
| `.claude/skills/canon-init/write-guide.md` | AC-1/AC-3: strip any read-instruction; ensure no agent-file generation claim; keep "adopter-owned" description. |
| `.claude/skills/canon-spec/SKILL.md` | AC-1: strip the `AGENTS.md`/`CLAUDE.md` load-context + Related refs. |
| `.claude/skills/canon-spec-review/SKILL.md` | AC-1: strip the `CLAUDE.md` Related ref. |
| `.claude/skills/canon-pipeline/SKILL.md` | AC-1: strip the `CLAUDE.md` Related ref. |
| `templates/.claude/skills/canon-init/SKILL.md` | AC-8: auto-synced root→mirror; do not hand-edit. |
| `templates/.claude/skills/canon-init/write-guide.md` | AC-8: auto-synced root→mirror; do not hand-edit. |
| `templates/.claude/skills/canon-spec/SKILL.md` | AC-8: auto-synced root→mirror; do not hand-edit. |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | AC-8: auto-synced root→mirror; do not hand-edit. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | AC-8: auto-synced root→mirror; do not hand-edit. |
| `templates/docs/pipeline-orchestrator.md` | AC-8: auto-synced root→mirror; do not hand-edit. |
| `tests/cli.test.ts` | AC-5/AC-4/AC-11: doctor advisory branch tests; update the init-notice test to the reworded no-read phrasing; keep the RECOMMENDED_NUDGE↔README drift test green. |
| `dist/` | AC-10: rebuilt artifacts (`doctor`, `init`, CLI-banner source changes are bundled). |

> Build-generated artifacts: `dist/` is regenerated by `npm run build`; listed in directory form so the `--pr` base-drift gate accepts it. No prompt-template change → `tests/run-task-prompts.golden.json` is NOT regenerated.

### Interaction Dependencies

- **Built-in `/init` behavior** (Claude Code `/init`, Codex init) is external tooling canon now relies on for agent-file generation — canon documents it but does not implement it. The `@path` import is a Claude Code feature (imports expand into context at launch, recursive to 5 hops); confirmed against Anthropic docs.
- **`RECOMMENDED_NUDGE`** single-source constant (`doctor.ts`) and its README drift test must stay in lockstep if the nudge presentation changes (AC-4).
- **Pre-commit sync hook / `sync-templates:check`**: canon-owned files auto-sync root→mirror; do not hand-edit the `templates/` mirrors.

### Data Model Changes

None.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — full suite clean; adds `doctor` advisory branch coverage
- [x] `build` (`npm run build`) — `doctor`/`init`/banner changes bundled into `dist/`
- [x] `docs-refs` (`npm run docs-refs-check`)
- [x] `sync-templates:check` (`npm run sync-templates:check`) — required for canon-managed edits; AC-8/AC-10 depend on it
- [ ] `E2E` — N/A: no UI/runtime surface.

## Docs Impact

- `docs/codebase-map.md`, `docs/product-context.md`, `docs/patterns.md`, `docs/decisions.md`, `docs/pipeline-orchestrator.md` are **directly edited** by this task (in Affected Files), not just at-risk — doc prose only, no delicate orchestrator surface.
- `docs/architecture.md` — verify during the AC-1 sweep that any agent-file mentions are accurate operational/CI descriptions (allow-listed kind g), not rule-home framing; reframe if not.

## Known Risks

- **Affected-Files completeness vs. the `--pr` base-drift gate.** A strip-everywhere task risks the diff containing a file the table doesn't name. Mitigation is structural, not heroic enumeration: AC-1's post-condition *requires* implement to run the grep over the full tree and extend the table before `--pr`. (Recovery if still missed is cheap — add the path and re-run `--pr`, not `--force`.) This shape is deliberate — the earlier hand-enumerated version diverged across review rounds because the spec tried to own the work set; the grep owns it now.
- **canon-ai operator self-degradation.** Slimming the agent files must not drop a norm that no skill re-states. AC-6 names the must-survive norms explicitly (four operator norms in `CLAUDE.md`; cross-review + comms in `AGENTS.md`); the reviewer greps for each. If a norm has no skill/prompt home, it stays in the appropriate file.
- **`@AGENTS.md` import correctness.** If the single-line `CLAUDE.md` doesn't actually import (typo, wrong path), canon-ai's Claude operator loses its overview silently. Human test plan exercises a real session to confirm the import resolves.
- **Doctor advisory message drift.** The two new warn details are user-facing strings; keep them asserted in tests so wording changes don't silently regress (AC-5).
- **Operator-norm placement (resolved by the audience-split).** The four conversational-operator norms are useful only to the human-facing Claude operator — inert or confusing for Codex (e.g. "don't intervene in `spec_review` auto-revision", when Codex *is* the spec_review agent) and for pipeline Claude (orchestrator-gated). AC-6 keeps them in `CLAUDE.md` (Claude-loaded) so Codex's `AGENTS.md` carries only the shared overview. The dual-useful cross-review + comms norms intentionally stay shared. Verify Codex's file is operator-norm-free. (This is empirically grounded: a worktree dry-run of the built-in `/init` for both tools produced overview-only files with no operator norms — confirming the norms are not codebase-derivable and belong layered on by audience.)

## Human Test Plan

1. In a brand-new empty folder, set up canon, then run `canon doctor`. Confirm it does **not** error about missing agent files — at most a gentle suggestion to run the built-in init to create a high-level overview.
2. In that folder, create a `CLAUDE.md` with unrelated content (no mention of canon) and run `canon doctor` again. Confirm the suggestion now nudges you to add the "this project uses canon" line, rather than to run init.
3. Read canon-ai's own top-level Claude guide. Confirm it points to the shared agents overview and adds the human-facing operator habits, and that opening a fresh Claude session still surfaces canon's high-level orientation plus canon-ai's standing habits (ask before committing, never self-review own work, prefer smaller models, don't intervene in auto-revision).
4. Read the project's README "getting started." Confirm it tells an adopter to generate their agent files with the built-in init (and mentions the one-line consolidation option), and no longer claims the canon setup skill creates those files.
5. Skim canon's own guides and skills end-to-end. Confirm none of them tell an agent to "read" the agent files or claim a canon rule lives inside them.
6. Open a fresh session as the implementer/spec-reviewer agent (Codex). Confirm it receives canon's high-level orientation (what the project is, how to build and test, where the docs live) and is **not** handed operator-only instructions meant for the human-facing Claude operator (nothing about choosing models, committing on its own judgment, or not intervening in reviews).

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files with specific change descriptions; the strip set is delegated to the AC-1 grep (structural post-condition), not pre-enumerated by line
- [x] Plan steps (fast tier) reference actual function/file names — N/A (full tier; pipeline writes the plan). Curation of canon-ai's overview content is deferred to plan.
- [x] Known Risks covers failure modes for the trickiest ACs (base-drift completeness reframed as a structural post-condition after the enumerate-by-hand approach diverged across review rounds)
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] Replacement framing, not paired add/remove: strips and reframes are post-conditions over a grep; load-bearing "must not survive" constraints are backed by the AC-1 structural grep and AC-5/AC-11 unit tests, not bare prose
- [x] Symbols named in ACs exist — `checkCanonDiscoveryNudge`/`RECOMMENDED_NUDGE` (`doctor.ts`), `CANON_OWNED`/`DELIMITED` (`canon-owned.ts`), `AGENT_FILES`/`existingAgentFilesNoticeLines`/`hasExistingAgentFiles` (`init.ts`), the `run-task-prompts` guard, the `cli.test.ts` init-notice test — all verified this session.

---

## Amendment

> **Round 1 — pre-PR cold-review findings.** Before opening the PR, the human ran an independent cold Codex review and a guided fresh-Claude review of the implemented `AGENTS.md`/`README.md`. They surfaced six doc-content gaps. **Note:** one of these (A1) is an existing AC that the pipeline's `code_review` **false-passed** (it marked AC-4 Pass while the `@AGENTS.md` consolidation guidance is in fact absent from `README.md`) — so A1 carries an explicit grep re-verification. The audience-split structure shipped by the baseline is correct and must be preserved; this amendment only fills content gaps.

**Scope:** doc-content only — `AGENTS.md` and `README.md`. Neither is canon-owned (no `templates/` mirror; verified absent from `CANON_OWNED`/`DELIMITED`), so no mirror sync and no `dist/` rebuild result from these edits. No source or behavior changes. The baseline structure — `CLAUDE.md` = `@AGENTS.md` + the four conversational-operator norms; `AGENTS.md` = shared overview — stays exactly as implemented. AC-1's strip post-condition must still hold: the new opener describes canon; it must not (re)introduce any "read `AGENTS.md`/`CLAUDE.md`" instruction or rule-home framing.

Each item below is an added acceptance criterion for this round:

- [ ] **A1 (README `@AGENTS.md` consolidation — closes the AC-4 gap):** `README.md` documents the optional `CLAUDE.md` = `@AGENTS.md` consolidation for adopters who generate both agent files — at the agent-file recommendation (the `canon init` / built-in `/init` guidance, ~line 106) and/or beside the discovery-nudge block. **Verify by grep:** `@AGENTS.md` appears in `README.md` in a consolidation-guidance context (a hit beyond the discovery-nudge `CLAUDE.md` block). This AC was previously false-passed; re-verify explicitly, do not trust a prior Pass.
- [ ] **A2 (AGENTS.md "what canon is" opener):** Add a 2–3 sentence opener to `AGENTS.md` stating what canon is — a TypeScript/Node CLI (npm package) that scaffolds a Claude + Codex spec-driven pipeline into other repositories, **and dogfoods that pipeline on itself** (canon runs canon on canon — which is why `tasks/`, worktree isolation, and `templates/` mirrors exist). This is the orientation the current "shared project overview" line omits and is load-bearing for the Codex audience, which has no other ambient context. Verify: a fresh reader of `AGENTS.md` alone learns the product, the stack, and the self-hosting fact.
- [ ] **A3 (re-add the managed-set caveat):** The `Conventions` section's "edit the root copy, run `npm run sync-templates`" guidance must clarify that `AGENTS.md` and `CLAUDE.md` are themselves **not** in the managed set — they have no `templates/` mirror and edits to them need no sync. Restores the caveat the rewrite dropped (which now misleads an agent into a no-op sync). Verify: the caveat is present and correctly scoped (it does not claim either file is canon-owned).
- [ ] **A4 (stack build/test line):** Add a one-line stack signal to `AGENTS.md` naming the npm commands — `npm run build`, `npm test`, `npm run lint`, `npm run type-check` — so a fresh agent learns the language/build without a docs hop. Detailed validation bindings stay in `docs/architecture.md` (link, don't duplicate).
- [ ] **A5 (release-process pointer):** Add `docs/release-process.md` to the `Where to Go Deeper` list (release ops is a frequent operator activity and is currently unlinked).
- [ ] **A6 (CANON_OWNED pointer):** Restore a pointer to `src/lib/canon-owned.ts` as the home of the `CANON_OWNED` / `DELIMITED` split in the `Conventions` section (lost in the convention move; useful to whoever adds a managed file).

**Validation for this round:** `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check` all pass (no `dist/` rebuild expected — no source change). Plus the A1 grep check. The A2 opener must not regress AC-1 (re-run the AC-1 strip grep over `AGENTS.md`).
