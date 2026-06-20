# Spec: adopter-agent-file-redesign — Agent files come from built-in /init; canon stops referencing and generating them

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The "canon vacates adopter MD" program (Tasks A+B+C, on `main`, unreleased) made `AGENTS.md`/`CLAUDE.md` adopter-owned and stopped shipping managed content into them. But canon is still entangled with these files in three ways that are now redundant or misleading:

1. **Instructional/descriptive references remain** across canon's docs and skills — "read `AGENTS.md`", "operator context in `CLAUDE.md`", and prose that frames them as canon rule-homes. These are dead weight: **each agent auto-loads its own file** (Claude Code → `CLAUDE.md`; Codex → `AGENTS.md`), and the operating rules already arrive just-in-time via prompts/skills (Task A). A reference telling an agent to read a file it already auto-loads is noise; one that points at a rule which has moved is actively wrong.
2. **`/canon-init` still claims to generate the agent files** (`README.md:106`: "generates the full canon document set: `AGENTS.md`, `CLAUDE.md`, and the `docs/` knowledge corpus"). Post-vacate the skill no longer writes them — agent files are the job of the **tool-native `/init`** (Claude's `/init`, Codex's init), which produces a standard high-level codebase overview.
3. **canon-ai's own agent files haven't been settled** into the end-state shape. They should dogfood exactly what an adopter gets: a high-level `/init`-style overview, consolidated so both agents converge on one source.

Leaving this half-done ships an incoherent story: canon tells adopters their agent files are theirs, while canon's own docs still read/reference/generate them as if canon owned them.

## Decision

Get canon out of the agent-file business and dogfood the result.

1. **Agent files are produced by the tool-native `/init`** (Claude `/init` → `CLAUDE.md`; Codex init → `AGENTS.md`) as a high-level codebase overview. Canon does not generate, manage, or instruct agents to read them.
2. **Strip** canon's instructional/descriptive references to `AGENTS.md`/`CLAUDE.md` from its docs and skills (auto-load + JIT prompts handle delivery). The only references that remain are operational code that *operates* on the files, decision records, tests, README's adopter recommendation, and "adopter-owned, when present" descriptions.
3. **`/canon-init` is scoped to the `docs/` knowledge corpus only** — it does not claim to generate the agent files. README/skill text that says otherwise is corrected and repointed to the built-in `/init`.
4. **README owns the recommendation**: adopters should generate their agent files via the built-in `/init` (Claude and/or Codex), and may consolidate (see below). This is the one human-facing "you should have these" home.
5. **`canon doctor` advises**: when neither agent file exists → advise running `/init`; when a file exists but neither mentions canon → advise adding the discovery nudge. (Warn-only, never fails.)
6. **Consolidation**: canon-ai's `CLAUDE.md` becomes a single `@AGENTS.md` import line (Claude Code expands `@path` imports into context at launch), and `AGENTS.md` holds the high-level overview plus canon-ai's own always-on norms. Codex auto-loads `AGENTS.md` natively; Claude auto-loads `CLAUDE.md` which imports `AGENTS.md` — both converge on one source. Consolidation is **recommended to adopters, not mandated.**
7. **canon-ai dogfoods**: its `AGENTS.md` is rewritten as the high-level overview + its four always-on operator norms; its `CLAUDE.md` is reduced to `@AGENTS.md`.
8. **Reframe the leftover prose/cells** that imply the agent files are canon rule-homes but that a literal token-grep won't catch (philosophy lines + a trigger-table cell).

## Non-Goals

- **Not re-managing the agent files.** `AGENTS.md`/`CLAUDE.md` stay out of `CANON_OWNED` and `DELIMITED`; built-in `/init` owns generation. (Backed by a structural AC.)
- **Not mandating consolidation for adopters** — `@AGENTS.md` is a documented option, not a requirement.
- **Not touching the pipeline prompt layer.** The vacate already removed all agent-file reads from `scripts/run-task/prompts/`; a test guards it (`tests/run-task-prompts.test.ts`). No prompt-template edits, so the prompt golden does not change.
- **Not touching any delicate orchestrator surface** (routing, auto-commit, validation gates, pipeline policy, status schema).
- **No version bump or CHANGELOG version line.** This folds into the pending 2.0.0 release; QA proposes changelog entry text only.
- **Not re-sweeping the `templates/docs/*` adopter stubs** that the vacate already corrected — except any residual a strip-grep surfaces (see Known Risks).

## Acceptance Criteria

- [ ] **AC-1 (strip — structural):** After this task, a token grep for `AGENTS\.md|CLAUDE\.md` across canon's shipped + authority surfaces (`src/`, `scripts/`, `.claude/skills/`, `docs/` excluding the historical/log docs, `README.md`, `AGENTS.md`, `CLAUDE.md`, and all `templates/` mirrors; excluding `dist/`, `tasks/`, `CHANGELOG.md`) returns **only allow-listed lines**. The allow-list (built by the reviewer from `git grep` against the tree per the large-removal rule) comprises exactly: (a) operational code that operates on the files — `init.ts` `AGENT_FILES`, `doctor.ts` discovery-nudge check, `docs-refs-check.mjs` root-file scan-list + illustrative comments; (b) `docs/decisions.md` decision records; (c) `README.md` adopter recommendation; (d) test files; (e) "adopter-owned, when present" descriptions; (f) canon-ai's own `CLAUDE.md` = `@AGENTS.md` import and `AGENTS.md` self-reference in its Local Convention note. No "read AGENTS.md/CLAUDE.md" instruction and no "rule X lives in AGENTS.md/CLAUDE.md" claim survives.
- [ ] **AC-2 (leftover reframe — prose/cells a token-grep misses):** The following sites no longer frame the agent files as canon rule-homes: `README.md:19` and `:305`, `docs/product-context.md:27` and `:50` (philosophy/pitch — reframed to the auto-load + JIT reality, agent files described as adopter-owned overview), and `docs/patterns.md:24` — the Lint/TS trigger-table cell currently reading "*(rule, no canonical file)*" is repointed to its real home `scripts/run-task/prompts/templates/implement.md` (consistent with the `:91` fix already on `main`). Verify by reading each cited line. This enumerated list is best-effort, not provably exhaustive (these framings name no file token, so the AC-1 grep can't catch them); implement re-reads each cited file's surrounding neighborhood and adds any residual rule-home framing surfaced during the AC-1 sweep before `--pr`.
- [ ] **AC-3 (`/canon-init` scoped to docs corpus):** Neither `.claude/skills/canon-init/SKILL.md`, `.claude/skills/canon-init/write-guide.md`, nor `README.md` claims `/canon-init` generates `AGENTS.md`/`CLAUDE.md`. `README.md:106`'s "generates the full canon document set: AGENTS.md, CLAUDE.md, and the docs/ knowledge corpus" is corrected to the `docs/` corpus only, and points to the built-in `/init` for agent files. The skill's knowledge-corpus generation is otherwise unchanged. Verify: grep the canon-init skill + write-guide + README for any agent-file *generation* claim → none.
- [ ] **AC-4 (README recommendation):** `README.md` recommends adopters generate their agent files via the built-in `/init` (Claude and/or Codex) and documents the optional `CLAUDE.md` = `@AGENTS.md` consolidation. The existing `RECOMMENDED_NUDGE`↔README drift test still passes (or is updated in lockstep if the nudge presentation moves).
- [ ] **AC-5 (`doctor` advisory):** `checkCanonDiscoveryNudge` (`src/cli/commands/doctor.ts`) distinguishes two warn states: (i) **neither** `CLAUDE.md` nor `AGENTS.md` exists → detail advises running the built-in `/init`; (ii) a file exists but **neither mentions canon** → detail advises adding the nudge. It still returns `pass` when either mentions canon, and **never** returns `fail`. Verify: unit tests in `tests/cli.test.ts` cover both warn branches and the pass case.
- [ ] **AC-6 (consolidation — canon-ai dogfood):** canon-ai's `CLAUDE.md` consists of the single line `@AGENTS.md` (plus an optional one-line comment). canon-ai's `AGENTS.md` is a high-level overview of canon (what it is, the two roles, the pipeline phases, "route work through the `/canon-*` skills") that retains canon-ai's four always-on operator norms — **commit consent, never self-review inline work, default toward smaller models / lower effort, don't intervene in full-tier `spec_review` auto-revision** — and the communication norm. Detailed operator mechanics (quick refs, reroute mechanics, review charters, commands, PR/CI rules) are **not** reproduced here — they live in the skills and `docs/pipeline-orchestrator.md`. Verify: `CLAUDE.md` is the import line; grep `AGENTS.md` for each of the four named norms + the comms norm; confirm no detailed-mechanics sections remain.
- [ ] **AC-7 (not re-managed — structural):** `git grep -nE "'AGENTS\.md'|'CLAUDE\.md'" -- src/lib/canon-owned.ts` shows neither file added to `CANON_OWNED` or `DELIMITED`; no code writes or modifies `AGENTS.md`/`CLAUDE.md` (the `doctor` advisory is read-only; `init` does not create them).
- [ ] **AC-8 (templates mirrors in lockstep):** Every edited canon-owned file's `templates/` mirror reflects the change; `npm run sync-templates:check` passes. (The five canon-init/canon-spec/canon-spec-review/canon-pipeline skills are canon-owned and auto-sync; root docs `patterns.md`/`codebase-map.md`/`product-context.md` are not mirrored pairs — their `templates/docs/*` stubs are independent and out of scope per Non-Goals.)
- [ ] **AC-9 (decision record):** `docs/decisions.md` gains an end-state entry recording the agent-files-via-`/init` decision (agent files are tool-native `/init` output, adopter-owned; canon references none; `@AGENTS.md` consolidation recommended).
- [ ] **AC-10 (build + validation clean):** `dist/` rebuilt for the `doctor` change; `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check` all pass. The prompt golden (`tests/run-task-prompts.golden.json`) is unchanged (prompt layer untouched) and the `run-task-prompts` agent-file guard still passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `README.md` | AC-3/AC-4/AC-2: cut `:106` agent-file generation claim (→ docs corpus only + point to built-in `/init`); add/Adjust the recommendation to generate agent files via `/init` + document `@AGENTS.md` consolidation; reframe philosophy lines `:19`, `:305`. |
| `AGENTS.md` | AC-6: rewrite as high-level canon overview + canon-ai's four always-on norms + comms norm; drop detailed-mechanics sections (now in skills/docs). |
| `CLAUDE.md` | AC-6: reduce to the single `@AGENTS.md` import line (+ optional one-line comment). |
| `docs/patterns.md` | AC-1/AC-2: strip the `CLAUDE.md` operator-pointer refs (`:12`, `:56`, `:62`, `:63`); repoint the `:24` "(rule, no canonical file)" cell to `implement.md`. |
| `docs/codebase-map.md` | AC-1: strip/repoint the agent-file references in the Entry Points + Agent Config tables to the auto-load/JIT reality (don't reframe rows already correct from the vacate). |
| `docs/product-context.md` | AC-2: reframe philosophy lines `:27`, `:50` (and the `:119` "From AGENTS.md" citation) off the rule-home framing. |
| `docs/decisions.md` | AC-9: append the end-state decision record. |
| `.claude/skills/canon-init/SKILL.md` | AC-1/AC-3: strip the `if AGENTS.md/CLAUDE.md exists, read it` Phase-0 lines; ensure no agent-file generation claim; point to built-in `/init`. |
| `.claude/skills/canon-init/write-guide.md` | AC-1/AC-3: confirm no agent-file generation; strip any read-instruction; keep "adopter-owned" description. |
| `.claude/skills/canon-spec/SKILL.md` | AC-1: strip the `AGENTS.md`/`CLAUDE.md` load-context + Related refs. |
| `.claude/skills/canon-spec-review/SKILL.md` | AC-1: strip the `CLAUDE.md` Related ref. |
| `.claude/skills/canon-pipeline/SKILL.md` | AC-1: strip the `CLAUDE.md` Related ref. |
| `templates/.claude/skills/canon-init/SKILL.md` | AC-8: synced mirror of the above. |
| `templates/.claude/skills/canon-init/write-guide.md` | AC-8: synced mirror. |
| `templates/.claude/skills/canon-spec/SKILL.md` | AC-8: synced mirror. |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | AC-8: synced mirror. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | AC-8: synced mirror. |
| `src/cli/commands/doctor.ts` | AC-5: extend `checkCanonDiscoveryNudge` to the two warn states (absent → `/init`; silent → nudge). |
| `tests/cli.test.ts` | AC-5/AC-4: doctor advisory branch tests; keep the RECOMMENDED_NUDGE↔README drift test green. |
| `dist/` | AC-10: rebuilt artifacts (`doctor` source change is bundled). |

> Build-generated artifacts: `dist/` is regenerated by `npm run build`; listed in directory form so the `--pr` base-drift gate accepts it. No prompt-template change → `tests/run-task-prompts.golden.json` is NOT regenerated.

### Interaction Dependencies

- **Built-in `/init` behavior** (Claude Code `/init`, Codex init) is external tooling canon now relies on for agent-file generation — canon documents it but does not implement it. The `@path` import is a Claude Code feature (imports expand into context at launch, recursive to 5 hops); confirmed against Anthropic docs.
- **`RECOMMENDED_NUDGE`** single-source constant (`doctor.ts`) and its README drift test must stay in lockstep if the nudge presentation changes (AC-4).
- **Pre-commit sync hook / `sync-templates:check`**: the five canon-owned skills auto-sync root→mirror; do not hand-edit the `templates/` mirrors.

### Data Model Changes

None.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — full suite clean; adds `doctor` advisory branch coverage
- [x] `build` (`npm run build`) — `doctor` change is bundled into `dist/`
- [x] `docs-refs` (`npm run docs-refs-check`)
- [x] `sync-templates:check` (`npm run sync-templates:check`) — required for canon-managed edits; AC-8/AC-10 depend on it
- [ ] `E2E` — N/A: no UI/runtime surface.

## Docs Impact

- `docs/codebase-map.md`, `docs/product-context.md`, `docs/patterns.md`, `docs/decisions.md` are **directly edited** by this task (in Affected Files), not just at-risk.
- `docs/architecture.md` — not expected to change; verify it carries no agent-file rule-home framing during the strip sweep.

## Known Risks

- **Affected-Files completeness vs. the `--pr` base-drift gate.** A strip-everywhere task risks missing a file; the base-drift gate then rejects `--pr`. Mitigation: spec_review and implement should run the AC-1 grep over the **full** tree (root + `templates/`) and add any surfaced file to Affected Files *before* `--pr`. (Recovery if missed is cheap — add the path and re-run `--pr`, not `--force`.)
- **canon-ai operator self-degradation.** Slimming canon-ai's `AGENTS.md` to a high-level overview must not drop a norm that no skill re-states. AC-6 names the must-survive norms explicitly; the reviewer greps for each. If a norm has no skill/prompt home, it stays in `AGENTS.md`.
- **`@AGENTS.md` import correctness.** If the single-line `CLAUDE.md` doesn't actually import (typo, wrong path), canon-ai's Claude operator loses its overview silently. Human test plan exercises a real session to confirm the import resolves.
- **Doctor advisory message drift.** The two new warn details are user-facing strings; keep them asserted in tests so wording changes don't silently regress (AC-5).
- **Codex sees canon-ai's norms via `AGENTS.md`.** Acceptable: the norms are few and high-level; Codex won't act on operator-only ones (it's pipeline-gated) and benefits from the shared overview. This is the intended "useful to both agents" trade.

## Human Test Plan

1. In a brand-new empty folder, set up canon, then run `canon doctor`. Confirm it does **not** error about missing agent files — at most a gentle suggestion to run the built-in init to create a high-level overview.
2. In that folder, create a `CLAUDE.md` with unrelated content (no mention of canon) and run `canon doctor` again. Confirm the suggestion now nudges you to add the "this project uses canon" line, rather than to run init.
3. Read canon-ai's own top-level Claude guide. Confirm it is effectively a pointer to the agents overview, and that opening a fresh Claude session still surfaces canon's high-level orientation and canon-ai's standing habits (ask before committing, never self-review own work, prefer smaller models, don't intervene in auto-revision).
4. Read the project's README "getting started." Confirm it tells an adopter to generate their agent files with the built-in init (and mentions the one-line consolidation option), and no longer claims the canon setup skill creates those files.
5. Skim canon's own guides and skills end-to-end. Confirm none of them tell an agent to "read" the agent files or claim a canon rule lives inside them.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; pipeline writes the plan). Curation of canon-ai's overview content is explicitly deferred to plan.
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] Symbols named in ACs exist — `checkCanonDiscoveryNudge`/`RECOMMENDED_NUDGE` (`doctor.ts`), `CANON_OWNED`/`DELIMITED` (`canon-owned.ts`), `AGENT_FILES` (`init.ts`), the `run-task-prompts` guard, README:106/:19/:305, patterns.md:24, product-context:27/:50 — all verified this session.
