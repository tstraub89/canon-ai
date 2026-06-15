# Spec: release-agnostic-adopter-guidance — Make canon's adopter-facing release guidance model-agnostic

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's **adopter-facing** release guidance presumes a single release model — release-branch-per-version. The *orchestrator* is already model-agnostic in code (`getBaseBranch()` in `scripts/run-task/git.ts` reads `base_branch` from `status.json`, falling back to `main`/`master`; `--pr`/`--ship` target whatever `base_branch` says, with no hardcoded `dev`/`release/` assumption). But the shipped guidance has not caught up:

- **`canon-pipeline/SKILL.md` §5 ("Release branches")** opens with a correct agnostic *disclaimer* ([line 96](.claude/skills/canon-pipeline/SKILL.md)) — "optional release-branch model… adapt these steps to your project's release setup" — but the **entire operational content of the section is one worked model**: initialize `release/vX.Y`, create tasks on it, hotfix-to-main, ship via `gh pr create --base main --head release/vX.Y`, tag a GitHub release. An adopter using a different model (trunk-from-main, tag-from-main, no versioning) gets told to "adapt" with nothing structured to adapt *to*. The skill's frontmatter `description` (line 3) likewise frames the skill as release-branch-specific ("Also for release branch operations: hotfix absorption, finalize-and-ship").
- **`canon-changelog/SKILL.md`** is ~90% agnostic already (its philosophy is "detect and match the project's existing CHANGELOG format; the existing format is the source of truth"), but two residual spots still presume release-branches as the *only* model: the base-detection heuristic (`main / release/* → base main`, line 22) and the finalize-mode assertion "version was bumped when the release branch was initialized" (line 168).
- There is **no settled decision** recording that canon prescribes no release model. Prescriptive release-branch language has crept back into adopter-facing surfaces three times in the current release cycle (see `docs/lessons-learned.md` and the #167 spec-process incident), because nothing pins the stance.

Real-world driver: an adopter like galleryplanner is itself a **hybrid** — its app surface ships via release branches, its website surface ships straight to the main line with no versioning. Because `base_branch` is recorded **per task**, canon already supports this; the guidance does not describe it.

## Decision

Reframe the two shipped skills so canon prescribes **no** release model, and record the stance as a settled decision. Specifically:

1. **`canon-pipeline/SKILL.md` §5** becomes (a) a **model-neutral core** describing the parts that are identical regardless of release model (the `--pr` / `--ship` / `base_branch` mechanics, which are already neutral), plus (b) a **compact recipe menu** covering the common release shapes — *release-branch-per-version*, *trunk-from-main*, *tag-from-main*, *no versioning at all*. Each recipe is a few lines, names the **adopter's own `decisions.md §Versioning` / release doc as the authority**, and no single recipe is presented as the default or as required. The section makes explicit that **`base_branch` is chosen per task**, so a single repo may use different models for different task surfaces (hybrid repos are first-class, not a caveat). The frontmatter `description` is reframed so it no longer presents the skill as release-branch-specific.

2. **`canon-changelog/SKILL.md`** gets its two residual release-branch assumptions neutralized so neither presumes release-branches as the only model — without otherwise changing the skill's format-detection / append / finalize behavior.

3. **`docs/decisions.md`** gains a new entry — *"Canon prescribes no release model to adopters"* — as the durable anti-regression guard, and the factually-stale persistent-`dev`-integration-branch parentheticals in the existing "Versioning and release policy" entry are corrected.

No orchestrator code changes. The exact prose/wording of the recipes is an implement-time mechanic; this spec fixes the *contract* (which recipes, what each must contain, the per-task framing, the authority pointer).

## Non-Goals

- **`docs/release-process.md` is not touched.** canon-ai's own concrete release-branch-per-version process stays exactly as-is. (This file is internal — not in `CANON_OWNED`, not mirrored to `templates/`, not shipped.) This task does **not** decide whether canon-ai itself switches to trunk-based; that is a separate internal decision.
- **`AGENTS.md` and `CLAUDE.md` release phrasings are not touched.** Their references are already *conditional* ("where a project accumulates work on a versioned release branch"; "on release branches") and are correct as-is. Backed structurally by AC-8 (diff scope).
- **No orchestrator / source code change.** `base_branch` plumbing is already agnostic. If implement discovers a hardcoded release-model assumption in `scripts/` or `src/`, that is a `spec_gap` to escalate — not silent scope expansion. Backed structurally by AC-8.
- **`canon-changelog`'s format-detection, mode-detection, append, and finalize behavior is not redesigned** — only the two named assumptions are neutralized. Backed by AC-6.
- **`CHANGELOG.md` content and canon-ai's own changelog policy are not changed.** Historical version-note entries that mention release branches are accurate history and stay.

## Acceptance Criteria

- [ ] **AC-1 (inventory gate):** The implementer re-runs `git grep -n` against the current tree for the model-presuming terms (`release/v`, `release branch`, `release-branch`, `origin/dev`, `dev branch`, `trunk`, `cut a release`, `unreleased`, `base_branch`/`base branch`) excluding `node_modules/`, `dist/`, `tasks/`, and `.git/`, and records in `handoff.md`: the exact command(s) run, the full hit list, and a one-word disposition for **every** hit in a shipped surface — `reframed`, `intentionally-conditional` (with a one-line reason), or `out-of-scope-internal`. A shipped surface is any file in `CANON_OWNED` or `DELIMITED` (see `src/lib/canon-owned.ts`) plus the two skill files. Non-shipped hits (e.g. `docs/release-process.md`, tests, internal docs) are **listed but need no disposition** — they appear in the hit list so the reviewer can confirm nothing shipped was mis-bucketed as out-of-scope. Verify: every shipped-surface hit has a disposition; no shipped-surface hit presumes a single model as the default/required without a recorded `intentionally-conditional` reason.
- [ ] **AC-2 (recipe menu):** `canon-pipeline/SKILL.md` §5 contains a distinct recipe for each of: release-branch-per-version, trunk-from-main, tag-from-main, and no-versioning. Verify by reading §5: all four shapes are present and none is labeled or positioned as the default/recommended/required model.
- [ ] **AC-3 (per-task / hybrid framing):** §5 explicitly states that `base_branch` is chosen per task and that a single repository may use different release models for different task surfaces. Verify: `grep` §5 for the per-task statement; it names the per-task `base_branch` mechanism and the mixed/hybrid case.
- [ ] **AC-4 (authority pointer):** Each recipe defers to the adopter's own release authority (their `decisions.md §Versioning and Release Policy` and/or their own release doc) rather than prescribing canon's. Verify: each of the four recipes references the adopter's own policy/doc as the source of truth for version/changelog/branch decisions.
- [ ] **AC-5 (frontmatter):** `canon-pipeline/SKILL.md`'s frontmatter `description` no longer frames the skill as release-branch-specific. Verify: the line 3 `description` reads model-neutrally (no "release branch operations" as a defining purpose; release-branch work is one supported shape, not the framing).
- [ ] **AC-6 (changelog skill — neutralize, don't redesign):** In `canon-changelog/SKILL.md`, (a) the base-detection guidance (≈line 22) no longer presents `release/* → main` as the only mapping — it derives the base generically (e.g. from the task's `base_branch`/upstream, falling back to the default branch); (b) the finalize-mode note (≈line 168) no longer asserts as universal that "version was bumped when the release branch was initialized" — it is reframed conditionally (some models bump at branch creation, others at finalize, others not at all). No other behavioral clause of the skill changes. Verify: read both spots; confirm the rest of the mode/append/finalize logic is unchanged (diff is limited to these two reframings plus any wording needed for AC-1 dispositions).
- [ ] **AC-7 (decision record):** `docs/decisions.md` gains a new entry titled to the effect of "Canon prescribes no release model to adopters" with the standard **What / Why / Rule** sections, positioned as a sibling of the existing positioning decisions. The existing "Versioning and release policy" entry's stale persistent-`dev`-integration-branch parentheticals are corrected to reflect current reality (canon-ai dropped the persistent `dev` branch at 1.4.0). Verify: the new entry exists with all three sections; `grep docs/decisions.md` for `dev` shows only accurate/historical references (no claim that the changelog currently "lives on both `dev` and `main`").
- [ ] **AC-8 (diff scope — structural non-goal guard):** The branch diff against the task baseline touches **only**: `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-changelog/SKILL.md`, their two auto-synced `templates/.claude/skills/...` mirrors, `docs/decisions.md`, and task artifacts under `tasks/release-agnostic-adopter-guidance/`. Verify: `git diff --name-only <base>...HEAD` contains no path under `scripts/`, `src/`, `dist/`, and does not include `docs/release-process.md`, `AGENTS.md`, or `CLAUDE.md`.
- [ ] **AC-9 (templates mirror invariant):** `npm run sync-templates:check` passes — the two edited skills' `templates/` mirrors match their roots. Both root and mirror paths for each skill appear in the `handoff.md` Changes table.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/skills/canon-pipeline/SKILL.md` | Restructure §5 into a model-neutral core + a 4-recipe menu (release-branch-per-version, trunk-from-main, tag-from-main, no-versioning), each deferring to the adopter's own release authority; add explicit per-task `base_branch` / hybrid-repo framing; reframe the frontmatter `description` (line 3) to be model-neutral. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Auto-synced mirror of the above (pre-commit hook runs `sync-canon-templates`; declare in handoff). |
| `.claude/skills/canon-changelog/SKILL.md` | Neutralize the base-detection heuristic (≈line 22) and the finalize-mode "version bumped at release-branch init" assertion (≈line 168); no other behavioral change. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Auto-synced mirror of the above (declare in handoff). |
| `docs/decisions.md` | Add the "Canon prescribes no release model to adopters" decision entry; correct the stale persistent-`dev` parentheticals in the existing "Versioning and release policy" entry. (Internal doc — adopters receive a template stub, so it has no auto-synced mirror.) |

### Interaction Dependencies

- `docs/pipeline-orchestrator.md` is the authoritative reference for `base_branch` and is already model-agnostic — §5's recipes should point to it for the mechanics rather than restating them. No change to that doc.
- The pre-commit hook (`simple-git-hooks` → `sync-canon-templates --stage`) auto-syncs and stages the two skills' `templates/` mirrors on commit. The pre-flight gate reconciles the cumulative branch diff against the handoff Changes table, so both root and mirror paths must be declared (see `docs/lessons-learned.md` "Declare both the canon-managed root doc AND its templates/ mirror").

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint` — suite runs clean (no JS/TS change expected; cheap guard).
- [x] `npm run type-check` — runs clean (no type change expected).
- [x] `npm test` — full suite; relevant because tests may assert skill/doc content.
- [x] `npm run sync-templates:check` — the load-bearing check: confirms the two skill mirrors match their roots.
- [x] `npm run docs-refs-check` — validates file/path references cited in the edited skills and `decisions.md`.
- [ ] `npm run build` — N/A: skills and docs are not bundled into `dist/`; no source change means `dist/` is unaffected. (CI's `git diff dist/` gate stays green precisely because nothing here touches `dist/`.)

## Docs Impact

- `docs/decisions.md` — edited directly (new entry + stale-ref fix); listed in Affected Files.
- The two skills are themselves shipped docs — the core of the change.
- `docs/pipeline-orchestrator.md`, `AGENTS.md`, `CLAUDE.md`, `docs/release-process.md` — explicitly **not** changed (see Non-Goals; AC-8 enforces).
- QA-owned telemetry (`docs/lessons-learned.md`, `docs/task-quality-log.md`) auto-committed by the QA phase — no row needed.

## Known Risks

- **Recipe drift over time.** Four worked recipes can fall out of date as canon's flags evolve. Mitigation: keep each recipe thin (a few lines) and route version/changelog/branch authority to the adopter's own doc, so the recipes carry mechanics-pointers rather than duplicating policy.
- **Over-editing `canon-changelog`.** The skill is delicate prose with interlocking mode-detection logic; an over-broad edit could break format-detection or finalize behavior. Mitigation: AC-6 scopes the edit to exactly two named spots; the full test suite + a read-through of the unchanged clauses guard the rest.
- **Inventory under-coverage.** The spec's inventory (from the authoring session) could miss a surface. Mitigation: AC-1 requires the *implementer* to re-run `git grep` against the live tree and record a disposition for every shipped-surface hit — don't trust the spec's list (per `CLAUDE.md` "generate the allow-list from `git grep`, not the Affected Files table").
- **Mirror desync.** Editing `templates/` directly instead of the root would be overwritten on the next sync. Mitigation: edit roots only; `sync-templates:check` (AC-9) catches a desync deterministically.
- **No UI / no runtime surface** — this is documentation; no visual-iteration or gesture-debugging risk applies.

## Human Test Plan

1. As an adopter who ships everything from a single main line with no release branches, open canon's pipeline operations guidance and confirm there is a clear, usable recipe for *your* model — not merely an instruction to "adapt" the release-branch steps.
2. As an adopter who tags releases directly from the main line, confirm there is a matching recipe.
3. As a project with two surfaces that release differently (one uses versioned release branches, the other ships straight to the main line with no versioning), confirm the guidance makes clear you choose the model **per task** and may mix them in one repository.
4. Confirm the guidance never states or implies that release branches are required or are canon's default.
5. Confirm canon's changelog guidance still adapts to whatever changelog format a project already uses, and does not impose a particular versioned-heading style.
6. Confirm canon-ai's own internal release instructions are unchanged.
- Expected: every common release shape has usable, self-contained guidance; no model is presented as mandatory or default; the model is selectable per task; canon-ai's own concrete process is untouched.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan written by pipeline)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
