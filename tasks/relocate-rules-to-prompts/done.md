# Done: relocate-rules-to-prompts

## What Changed

Canon's operating rules previously had two delivery channels: the canon-delimited blocks of `AGENTS.md` / `CLAUDE.md` (auto-loaded by every agent at session start) and the per-phase injected prompts/skills (just-in-time). About 22 operating rules were **sole-homed** in the MD blocks, meaning pipeline agents only received them because the startup prompt told them to read those files — the JIT channel was incomplete. This made the MD blocks a hard dependency for every phase and blocked the later "vacate" task that will empty the canon blocks from adopter AGENTS.md / CLAUDE.md.

This task completes the JIT channel by relocating each sole-homed rule into the specific phase surface that consumes it, scoped per consumer rather than broadcast everywhere. Key relocations:

- **`implement.md`** now carries Safe-First rules, Scope Discipline 2 & 3, Lint/Type-Safety policy, Parsing rules, and the full structural Validation Matrix (change-type → check-category) inline. Codex no longer looks up the Validation Matrix in AGENTS.md.
- **`spec.md` and `spec-revision.md` + the `canon-spec` and `canon-spec-review` skills** now carry the spec-writing rules of thumb (name-effects-to-DELETE, structural assertions, symbol-verify, etc.).
- **`code-review-foreman.md` and the anchored/cold lens charters** carry code-review rules of thumb (baseline-diffing, handoff-verification, delicate guard audits, git-C, cross-cutting helper consolidation). The cold lens gained only a diff-local pattern and remains spec-blind.
- **`qa.md`** carries Release Rules, Handoff Validation, Output Format, Docs Freshness two-checkpoint, Code-is-Canonical, and Commit Ownership.
- **`spec-review.md`** carries the cross-review rule and Diagnose-Before-You-Fix three-role checkpoint.

The `canon task new` scaffolds are now fully self-contained: `spec.md` has the validation matrix and protected-docs list inline; `done.md` and `status.json` point at surviving project docs instead of AGENTS.md. The `canon-pipeline`, `canon-changelog`, and `canon-init` skills have dangling MD references rewired to surviving docs.

**`AGENTS.md` and `CLAUDE.md` are unchanged.** Rules now exist in both the MD blocks (unchanged) and the JIT surfaces (enriched), making the MD blocks redundant but not yet removed. The single-source cleanup is the vacate task.

## Files Changed

36 files changed — 357 insertions / 79 deletions.

**Prompt templates** (`scripts/run-task/prompts/templates/`):
- `implement.md` — Safe-First, Scope Discipline 2 & 3, Lint/Type, Parsing rules + inline Validation Matrix
- `implement-revisions.md` — revert-during-iteration, cumulative-diff, deleted-file ref rules
- `spec-review.md` — cross-review rule, Diagnose 3-role checkpoint
- `spec-review-reroute.md` — same cross-review/diagnose anchors for amendment review
- `spec-revision.md` — spec-writing rules of thumb
- `spec.md` — spec-writing rules of thumb
- `qa.md` — Release Rules, Handoff Validation, Output Format, Docs Freshness, Code-is-Canonical, Commit Ownership
- `code-review-foreman.md` — foreman-scoped code-review rules of thumb

**Startup constants / index**:
- `scripts/run-task/prompts/helpers.ts` — communication norms + git-workflow to `CODEX_STARTUP`/`CLAUDE_STARTUP`
- `scripts/run-task/prompts/index.ts` — `promptImplementResume()` Validation Matrix reference rewired (deviation; justified in handoff)

**Agent charters**:
- `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md`

**Skills**:
- `.claude/skills/canon-spec/SKILL.md`, `.claude/skills/canon-spec-review/SKILL.md`, `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-changelog/SKILL.md`, `.claude/skills/canon-init/SKILL.md`

**Task scaffolds**:
- `.canon/templates/spec.md` — inline validation matrix + inline Docs Impact protected-docs list
- `.canon/templates/done.md` — changelog scope repointed to `docs/decisions.md`
- `.canon/templates/status.json` — `_full_send` comment repointed to `docs/pipeline-orchestrator.md`

**Tests / golden**:
- `tests/run-task-prompts.test.ts` — new AC-11 structural relocation test (presence tokens, absence tokens, scaffold sweep)
- `tests/run-task-prompts.golden.json` — regenerated

**Docs**:
- `docs/architecture.md` §Validation — made self-contained (no longer sources categories from AGENTS.md)
- `docs/codebase-map.md` — JIT prompt-rule roles documented
- `docs/decisions.md` — new JIT per-phase rule-delivery decision entry

**Build artifact**:
- `dist/scripts/run-task.js` — only dist file changed (AC-10)

**Template mirrors** (13 files auto-synced by pre-commit hook for the above canon-managed files)

## How to Test

1. **Validation Matrix reaches Codex via prompt**: start a canon task whose change type spans more than one validation category (e.g., touches both code and a build artifact). Run it through `implement`. Confirm Codex runs every applicable check category and honors scope discipline — no new abstractions, no files outside Affected Files.

2. **Spec-writing rules reach pipeline spec authoring**: take a full-tier task to `spec_review` `changes_requested` so the pipeline auto-revises the spec. Confirm the revised spec names effects to delete and prefers structural/grep assertions.

3. **Code-review discipline intact**: run a task to `code_review`. Confirm the review applies baseline diffing and handoff verification; confirm the cold lens reviews diff-only with no spec awareness.

4. **AGENTS.md / CLAUDE.md unchanged**: open both files and confirm they are identical to before this task — full canon blocks, nothing vacated.

5. **Scaffolds self-contained**: `canon task new` a throwaway task and open its scaffolded `spec.md`, `done.md`, and `status.json`. Confirm the Validation Required section has the matrix inline, Docs Impact names the protected docs, the changelog note points at `docs/decisions.md`, and **none of these scaffolds says "go read AGENTS.md / CLAUDE.md."**

6. **Amendment — escalation triggers**: start a full-tier task whose change touches an auth or billing surface. Confirm the `spec.md` scaffold (and the pipeline `spec.md` prompt) reminds the spec author to flag these as delicate / call them out.

7. **Amendment — QA version-bump ask gone**: run any task to QA and open its `done.md` scaffold. Confirm there is no "Proposed version" field — only "Proposed Changelog" with an entry-text section.

8. **Checks pass**: run lint, type-check, tests, build, template-sync, docs-refs.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (874 pass / 1 skipped) | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| `npm run build` | Pass |
| AC-1 presence-token grep (verbatim tokens in all destinations) | Pass |
| AC-8 absence-token grep (no cross-phase bleed) | Pass |
| AC-13 scaffold sweep (`grep -rE 'AGENTS\.md|CLAUDE\.md' .canon/templates/`) | Pass — zero matches |
| AC-6 MD files unchanged | Pass — empty diff |
| AC-10 dist scope | Pass — only `dist/scripts/run-task.js` changed |
| AC-A1 escalation-trigger grep | Pass — all six trigger terms (auth, billing, privacy, destructive, schema, analytics) in both `spec.md` and `spec-revision.md` |
| AC-A2 version-bump request grep | Pass — no surface asks QA to propose/choose a version or bump tier |
| AC-A3 changelog description grep | Pass — description contains `Versioning and release policy` |
| E2E | Not configured (no UI surface, per spec) |

## Human Verification Required

None.

## Decisions Made

- **`scripts/run-task/prompts/index.ts` added to change set**: `promptImplementResume()` had a hardcoded AGENTS.md Validation Matrix reference on a JIT resume path. Leaving it would violate AC-3; adding this file (not in spec Affected Files) is the correct fix, documented as a deviation.
- **AC-11 test uses `process.cwd()` not `REPO_ROOT`**: in linked-worktree pipeline runs, `REPO_ROOT` resolves to the supervising checkout and would read stale pre-task file content. `process.cwd()` reads the active worktree and is the correct scoping. Documented deviation in handoff.
- **Escalation contract decomposed, not verbatim-relocated**: the Human Escalation Contract is delivered per consumer (spec authoring, implement, QA) rather than copied verbatim into one surface, per AC-2. A reviewer expecting a single block would mis-assess; the decomposition rationale is in the handoff.
- **QA proposes changelog entry text only; version/bump tier is owned by the release/changelog step** (2026-06-18, human policy decision, AC-A2). The QA prompt and `done.md` scaffold no longer ask the QA session to propose or choose a version number or bump tier. `docs/decisions.md` §"Versioning and release policy" is updated accordingly. `AGENTS.md` already carried this rule ("QA proposes entry text only") — the fix brought the prompt templates and scaffolds into agreement.

## Open Items (optional nits from code review — none blocking)

- **N1** — `scripts/run-task/prompts/index.ts:286`: resume prompt says "see the Validation Matrix in `implement.md`" but the table is introduced under a different heading. Cosmetic; the full `implement.md` is appended anyway so the resumed session gets the matrix.
- **N2** — `.claude/skills/canon-spec/SKILL.md:35,197`: refers to `implement.md` as the source of the validation matrix for the spec author. The primary pointer (`.canon/templates/spec.md`) is correct; consider dropping the `implement.md` mention (an internal template path the operator never opens).
- **N3** — `.claude/skills/canon-changelog/SKILL.md:45`: a pre-existing line treats a generic `## Release Rules` section as audience guidance. Not an AGENTS.md dependency; tidy at the vacate.
- **N4** — `scripts/run-task/prompts/templates/qa.md:47`: lessons-promotion line names `AGENTS.md` as a valid human-sweep promotion target. Justified today (it's a target, not a rule source); revisit at the vacate.

## Proposed Changelog

Suggested entry text for the next release (the human and release/changelog step assign the version and bump tier):

```markdown
### Changed

- **Phase prompts, skills, and task scaffolds are now self-contained.** Each pipeline phase carries its operating rules directly in the injected prompt rather than relying on agents reading `AGENTS.md` / `CLAUDE.md`. The `spec.md` scaffold (`canon task new`) has the validation matrix and protected-docs list inline; `done.md` and `status.json` point at surviving project docs. The `canon-spec`, `canon-spec-review`, `canon-pipeline`, `canon-changelog`, and `canon-init` skills have dangling MD references rewired to surviving docs. Spec templates now include the Human Escalation Contract's sensitive-surface trigger list (auth, billing, privacy, destructive operations, schema migrations, analytics changes). Ships to adopters via `canon upgrade`. *(Non-breaking prerequisite for the upcoming canon-vacates-adopter-md release.)*

- **QA no longer proposes a version bump.** The QA phase's done.md scaffold and qa.md prompt now ask only for changelog entry text; the version number and bump tier are owned by the release/changelog step (`/canon-changelog` skill) and human review. Ships to adopters via `canon upgrade`.
```
