# Spec: release-agnostic-surface — Align canon's shipped surface to its release-agnostic stance

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`AGENTS.md` §"Release Rules" already declares canon's stance: *"Canon enforces workflow discipline around releases… it does NOT enforce a specific versioning scheme or changelog scope — those are project-defined."* But several **shipped, canon-owned** surfaces contradict that stance by hardcoding canon-ai's *own* release conventions, forcing adopters to fork-and-maintain canon-owned files against `canon upgrade`:

- **`canon-changelog` skill** bakes in canon-ai's CHANGELOG format (`## [X.Y.Z] — unreleased`, bracketed full-semver + em-dash, `### Added`/`### Fixed`) and depends on the **unshipped** `auto-release.yml` workflow. A real adopter — GalleryPlanner (GP) — uses a *different* format (`# What's New` / `## vX.Y - <date>` / `### 🚀 Improvements` / `### 🐞 Fixes`) and has had to **fork the entire skill and revert it on every `canon upgrade`**. This fork-and-revert tax is the concrete pain.
- **`canon-pipeline` §5 "Release branches"** prescribes the release-branch flow with the hardcoded CHANGELOG format + `auto-release.yml` + a pointer to `docs/release-process.md` (which is **not** a canon-owned file, so adopters lack it).
- **`AGENTS.md`** itself has three spots that contradict its own disclaimer by treating versioning/changelog as unconditional.

Survey of comparable public skills (ComposioHQ, borghei changelog-generators) confirms the right design: neither does "detect-and-match the existing CHANGELOG" — they pick from built-in templates, which would *still* force GP to fork. The differentiator is **adapting to whatever format already exists**, deferring policy to the project.

## Decision

Make every shipped mention of *how you release* either **descriptive** or **deferred to project policy** — never a canon-ai mandate — while preserving all release-model-agnostic pipeline mechanics. Specifically:

- **`canon-changelog`**: detect and faithfully match the project's *existing* `CHANGELOG.md` format (title, version-heading pattern, category structure including emoji, insertion point) instead of imposing a canonical one — the CHANGELOG is the format source of truth and is always present when the skill's gate fires. Treat `docs/decisions.md §"Versioning and Release Policy"` as an **optional** policy layer (audience/scope/tier) used *if present*, with graceful degradation when it's absent (the upgrader path — see AC-4). Drop the `auto-release.yml` dependency. Reword the frontmatter `description` so it no longer asserts a hard "requires versioned releases" precondition (today it ends *"Requires the project to do versioned releases…"*). Keep the frontmatter gate (CHANGELOG.md present) and the existing format-adaptivity (generalized).
- **`canon-pipeline` §5**: keep the release-branch flow as canon's **recommended, explicitly-optional** model (not the only way; some projects don't version at all), but strip the hardcoded CHANGELOG format, the `auto-release.yml` reference, and the `docs/release-process.md` pointer; defer changelog mechanics to the (now format-agnostic) `canon-changelog` skill. Preserve `base_branch` task-creation mechanics and `--pr`/`--ship`.
- **`AGENTS.md`**: reconcile the four spots that contradict the Release Rules disclaimer.
- **`docs/pipeline-orchestrator.md`**: note that `--ship`'s `--squash` is canon's default merge strategy, and reconcile the standalone changelog/version-bump line (~296) to project policy.

GP (and any adopter) must be able to run the **shipped** skills unchanged, configuring nothing beyond their existing `docs/decisions.md §Versioning` and their existing `CHANGELOG.md`.

## Non-Goals

- **`docs/release-process.md`** (canon-ai-internal, not shipped) — already fixed inline this session; not touched here.
- **`auto-release.yml`** — canon-ai-internal CI, not shipped; unchanged. (The skills stop *depending on / referencing* it; the workflow itself stays.)
- **AGENTS.md Release Rules #2** — just edited inline this session ("QA proposes a changelog entry, not a version tier"); **do not re-touch**.
- **Not switching `canon-changelog` to git-commit parsing** — its input stays the human-reviewed `done.md` QA entry (better-phrased, human-in-loop than commit logs).
- **Not changing `--ship`'s actual squash behavior** — `docs/pipeline-orchestrator.md` gets a doc note only; no code change.
- **No `dist/` rebuild** — this task touches only docs/skills/markdown, no `src/`.
- **Not removing the release-branch model from canon** — it stays as a recommended-optional pattern (GP and canon-ai both use it).
- **No `canon-init` change.** The init scaffold (`templates/docs/decisions.md`) already seeds a `## Versioning and release policy` section with a `TODO[canon]` placeholder that the canon-init skill fills at bootstrap, so fresh adopters are covered. The skill's optional/graceful deference (AC-4) covers existing upgraders who lack the section. A possible follow-up — adding a `§Versioning`-specific nudge to canon-init's `write-guide.md` or a `canon doctor` warning when it's missing — is **out of scope** here.

## Acceptance Criteria

- [ ] **AC-1 — `canon-changelog` detects and matches the existing format.** The skill instructs the agent to derive the CHANGELOG format from the project's *existing* `CHANGELOG.md` — the title line, the version-heading pattern, the category/subheading structure (including emoji categories), and the insertion point — and to match that format when appending or finalizing. It must NOT impose canon-ai's bracketed `## [X.Y.Z] — unreleased` form as a default or "canonical" target. *Verify:* read the skill; the format-handling section frames canon-ai's bracketed form as *one example*, and the operative instruction is "match what `CHANGELOG.md` already uses." The GP format is satisfiable (see AC-2).
- [ ] **AC-2 — GP format is a worked witness.** The skill's format-handling guidance demonstrably covers a non-canon-ai format: `# What's New` title, `## vX.Y - <date|unreleased>` version headings (v-prefix, hyphen, minor-version for unreleased), and `### 🚀 Improvements` / `### 🐞 Fixes` emoji categories — i.e., an agent following the skill against GP's `CHANGELOG.md` would append under the right emoji category and match the heading style without forking the skill. *Verify:* the skill either uses a non-bracketed example or states the detect-and-match rule generally enough that GP's format is unambiguously handled; a reviewer simulates "append a bullet to GP's CHANGELOG" against the instructions and gets GP's format, not canon-ai's.
- [ ] **AC-3 — `canon-changelog` defers policy to `decisions.md` *if present*, drops `auto-release` dependency.** The CHANGELOG itself is the **format source of truth** (it is always present when the skill's gate fires). `docs/decisions.md §"Versioning and Release Policy"` is an **optional policy layer** (audience/scope/tier) the skill consults *if it exists*; the skill must NOT hard-depend on it. References to the `auto-release.yml` workflow as an extraction mechanism are removed (lines ~51, ~53, ~169 today). The `release/vX.Y` branch-taxonomy assumption (mode table, lines ~58–59) is genericized to "the active release/working branch (whatever your project uses)." The frontmatter `description` (line ~3) must not assert a hard versioned-releases precondition: today it ends *"Requires the project to do versioned releases (CHANGELOG.md present + AGENTS.md §\"Release Rules\" defined)"*, which tells adopters the skill only works for versioned projects. Reword so the trigger still fires on changelog/release-notes intent with a present `CHANGELOG.md`, but drops the *"Requires the project to do versioned releases"* mandate — the CHANGELOG-present gate itself stays (it is the gate AC-4 builds on). *Verify:* `git grep -n "auto-release" .claude/skills/canon-changelog/SKILL.md` returns nothing; `git grep -n "do versioned releases" .claude/skills/canon-changelog/SKILL.md` returns nothing; the mode table no longer hardcodes `release/vX.Y` as the only branch shape; the skill explicitly treats §Versioning as optional (see AC-4); the frontmatter gate and format-adaptivity remain.
- [ ] **AC-4 — Graceful degradation when a source is absent (the upgrader path).** The skill must function for an adopter who upgrades into the genericized skill without having `docs/decisions.md §Versioning` filled — `canon upgrade` does not create or touch that section. Two absence branches, both defined and non-blocking:
  - **No `§Versioning` policy** → proceed using the existing CHANGELOG's own style for format, AGENTS.md's general propose-only discipline for behavior (human finalizes), and audience inferred from the existing CHANGELOG; emit a one-time nudge suggesting the adopter fill `docs/decisions.md §Versioning` for richer policy. Do **not** error or block.
  - **No existing `CHANGELOG.md` format to match** (greenfield / empty file) → use an explicit format declared in `§Versioning` if present, otherwise a **neutral default that the skill itself documents** (Keep-a-Changelog `## [X.Y.Z] — unreleased` is fine as the named default, presented as a generic starting point, not as canon-ai's mandate), and surface the choice to the human rather than silently imposing a format. **If the skill does not already spell out this default, the implementer must add it** — this is an additive change, not just a description of existing behavior.
  *Verify:* the skill has both branches with defined, non-blocking behavior, and the greenfield branch names a concrete default the skill documents; a reviewer simulating "run on a project with a CHANGELOG but no §Versioning" gets a correct format-matched entry plus the nudge (not an error), and "run on a project with no CHANGELOG" gets the documented default surfaced for confirmation.
- [ ] **AC-5 — `canon-pipeline` §5 keeps the model, optional + genericized.** §5 retains the release-branch flow but frames it as canon's *recommended, optional* model ("adapt to your project; some projects use a different model or don't version"). Removed from §5: the hardcoded `## [X.Y.Z] — unreleased → date` CHANGELOG format (line ~108), the `auto-release workflow` reference (line ~108), and the `docs/release-process.md` pointers (lines ~97, ~102). The ship step defers changelog mechanics to the `canon-changelog` skill rather than describing a format inline. *Verify:* read §5 — flow present and marked optional; `git grep -nE "auto-release|release-process.md" .claude/skills/canon-pipeline/SKILL.md` returns nothing; no inline CHANGELOG-format literal in the ship step.
- [ ] **AC-6 — `canon-pipeline` preserves release-model-agnostic mechanics.** The "Creating a task on a release branch" / base_branch auto-detection guidance (line ~100) and the `--pr`/`--ship` references are intact. The "NOT checked out" variant (line ~102) keeps its base_branch logic but its `docs/release-process.md` pointer is genericized to "your project's release setup." *Verify:* read §5; base_branch auto-detect guidance unchanged in substance; no `docs/release-process.md` reference remains.
- [ ] **AC-7 — `AGENTS.md` four spots reconciled (only those four).** (a) Commit-ownership rule #3 prose (line ~147) "Changelog + version bump: A separate release step after human_review…" no longer states the step unconditionally — it is conditioned on projects that version (e.g. "for projects that version, …"). (b) Commit-ownership summary table row (line ~157) "Before PR / merge | Changelog + version bump | Human + Claude" no longer prescribes the step unconditionally — it defers to project policy. (c) Release Rules #3 (line ~343) no longer asserts "last commit on the branch" as a universal linear requirement — softened to project-policy / isolation-intent. (d) Handoff Validation checklist (lines ~348–349) "Version correct" / "Changelog updated if needed" is conditioned on the project versioning ("per project policy / if the project versions"). **Release Rules #2 (line ~342) is NOT modified.** *Verify:* diff shows edits only at those four locations (#2 untouched); each now defers to project policy. Note: spots (a)/(b) live in the **commit-ownership** section, *not* the actual Validation Matrix (line ~294, which has no changelog row) — do not edit the Validation Matrix.
- [ ] **AC-8 — `docs/pipeline-orchestrator.md` squash note + changelog-line + release-process pointer reconcile.** (a) A brief note states `--ship`'s `gh pr merge --squash` is canon's default merge strategy and that projects using rebase/merge-commit should be aware. No change to `--ship`'s behavior. (b) The standalone line at line ~296 "Changelog and version bump remain a manual human + Claude step." is reworded to defer to project policy (e.g. "For projects that version, changelog and version bump remain a manual human + Claude step; projects that don't version skip it.") so the orchestrator doc no longer asserts the step unconditionally. (c) The command-cheatsheet comment at line ~139 `# Initialize a release branch with the manual steps in docs/release-process.md` is genericized to drop the canon-internal `docs/release-process.md` pointer (e.g. "# Initialize a release branch per your project's release setup"), consistent with AC-6's genericization in `canon-pipeline` — adopters don't have that file. *Verify:* the squash note is present near the `--ship` description (line ~411–413 region); the line ~296 changelog/version-bump statement is now conditioned on project versioning rather than stated unconditionally; `git grep -n "release-process" docs/pipeline-orchestrator.md` returns nothing.
- [ ] **AC-9 — `auto-release` absent from both shipped skills.** *Verify:* `git grep -nE "auto-release" -- .claude/skills/canon-pipeline/SKILL.md .claude/skills/canon-changelog/SKILL.md` returns no matches. (The canon-ai-internal `auto-release.yml` and `docs/release-process.md` are untouched and may still reference it — out of scope.)
- [ ] **AC-10 — canon-owned mirrors synced.** The three canon-owned files (`canon-pipeline` SKILL, `canon-changelog` SKILL, `pipeline-orchestrator.md`) are edited at root; the `sync-templates` pre-commit hook regenerates their `templates/` mirrors. AGENTS.md (delimited canon-owned) likewise syncs. *Verify:* `npm run sync-templates:check` passes; `git grep -nE "auto-release" -- templates/.claude/skills/canon-pipeline/SKILL.md templates/.claude/skills/canon-changelog/SKILL.md` returns nothing (mirrors reflect the edits).
- [ ] **AC-11 — CHANGELOG bullet.** A bullet is added under the active `## [Unreleased]` block (canon-ai's own CHANGELOG, bracketed form) noting that the shipped `canon-changelog`/`canon-pipeline` skills are now release-format-agnostic. *Verify:* the Unreleased block has the entry.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Detect-and-match existing CHANGELOG format (AC-1/2); defer policy to `decisions.md §Versioning` (AC-3); drop `auto-release.yml` refs + genericize `release/vX.Y` taxonomy + reword frontmatter `description` to drop the hard versioned-releases precondition (AC-3); define greenfield fallback (AC-4); keep gate + format-adaptivity. |
| `.claude/skills/canon-pipeline/SKILL.md` | §5: keep release-branch flow as optional/recommended; strip hardcoded CHANGELOG format, `auto-release` ref, `docs/release-process.md` pointers; defer changelog to `canon-changelog` (AC-5); preserve base_branch + `--pr`/`--ship` (AC-6). |
| `AGENTS.md` | Reconcile 4 spots — commit-ownership rule #3 prose (~147), commit-ownership summary table row (~157), Release Rules #3 (~343), Handoff Validation (~348–349) — to defer to project policy; **Release Rules #2 (~342) and the Validation Matrix (~294) untouched** (AC-7). |
| `docs/pipeline-orchestrator.md` | Add a one-line note that `--ship` squash-merge is canon's default; reword the standalone changelog/version-bump line (~296) to defer to project policy; genericize the cheatsheet `docs/release-process.md` pointer (~139) (AC-8). |
| `CHANGELOG.md` | Add release-format-agnostic bullet under `## [Unreleased]` (AC-11). |
| `templates/.claude/skills/canon-changelog/SKILL.md` | **Derived mirror** — regenerated by `sync-templates` hook; declared for the `--pr` base-drift gate. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | **Derived mirror** — as above. |
| `templates/docs/pipeline-orchestrator.md` | **Derived mirror** — as above. |
| `templates/AGENTS.md` | **Derived mirror** — as above. |

`templates/` rows are never hand-edited; the `sync-templates` pre-commit hook regenerates them from the canon-owned roots. They are declared because the `--pr` base-drift gate rejects undeclared changed files (lesson from `retire-release-init`).

### Interaction Dependencies

- **`canon-changelog` ↔ `canon-pipeline` §5**: §5's ship step defers changelog mechanics to `canon-changelog`; the two must agree (no inline format in §5).
- **`docs/decisions.md §"Versioning and Release Policy"`**: the policy source the genericized skill defers to. canon-ai and GP both already have this section; adopters fill it at bootstrap. (Read-only here — not edited.)
- **`sync-templates` pre-commit hook**: edits to the 4 canon-owned roots trigger `templates/` re-sync + re-stage (AC-10).
- **No `dist/` interaction** — no `src/` change, so the bundle is untouched and the `--pr` base-drift `dist/` concern does not apply.

### Data Model Changes

None. Docs/skill prose only; no types, schemas, or persistent data.

## Validation Required

- [x] `npm run lint` — eslint (covers `src/ tests/ scripts/`; no code change expected, run as a backstop)
- [x] `npm test` — full suite (confirms no skill/template-sync test regressed)
- [x] `npm run sync-templates:check` — the 4 canon-owned mirrors match their roots after edits
- [x] `npm run docs-refs-check` — no dangling doc references introduced (e.g. the removed `docs/release-process.md` pointers)
- [ ] `npm run type-check` — N/A (no TypeScript change), harmless if run
- [ ] `npm run build` — N/A (no `src/` change; no `dist/` rebuild)
- [ ] E2E — N/A (no runtime/browser layer)

## Docs Impact

- `docs/pipeline-orchestrator.md` (protected, canon-owned) — squash note, changelog-line reconcile, and `docs/release-process.md` pointer genericization (AC-8, AC-10).
- `AGENTS.md` (canon-owned delimited) — 4-spot reconcile (AC-7, AC-10).
- Skills `canon-changelog` / `canon-pipeline` (canon-owned) — genericized (AC-1–6, AC-10).
- No change to `codebase-map.md`, `decisions.md` (read-only reference), `patterns.md`, `architecture.md`, `product-context.md`.

## Known Risks

- **Over-stripping vs. over-keeping the format (highest-judgment AC).** AC-1/AC-2 must remove *prescription* while preserving *descriptive* examples — canon-changelog legitimately still names formats as examples. The risk is either imposing canon-ai's form (GP still forks) or removing so much guidance the skill can't act. Mitigation: AC-2 uses GP's concrete format as a pass/fail witness; AC-1 frames the bracketed form as one example only.
- **`release/vX.Y` over-genericization.** §5 keeps the model (so `release/vX.Y` appears legitimately); canon-changelog genericizes the branch taxonomy. The grep guard is scoped to `auto-release` (a clean signal), *not* `release/vX.Y` (which legitimately remains) — see AC-9. Risk: a blunt grep banning `release/vX.Y` would be wrong; ACs deliberately avoid that.
- **Dangling references after removing `docs/release-process.md` pointers.** AC-5/AC-6 (in `canon-pipeline`) and AC-8(c) (in `pipeline-orchestrator.md`) require the pointers be genericized, not left dangling. Note: `docs-refs-check` won't catch a *stale* `docs/release-process.md` reference because the file exists in canon-ai itself — the issue is that the file is canon-internal and not shipped, so the per-AC verify greps (not `docs-refs-check`) are the real guard.
- **Greenfield ambiguity.** A project with no/empty CHANGELOG has no format to match; AC-4 forces an explicit fallback rather than silent imposition.
- **Low blast radius:** docs/skill prose; no code, no `dist/`. Worst case is wording, caught by review + `sync-templates:check` + `docs-refs-check`. The release-branch model and all pipeline mechanics are preserved.

## Human Test Plan

1. Picture a project whose changelog looks nothing like canon-ai's — say one titled "What's New" with version headings like "v1.8 - unreleased" and emoji section headers ("🚀 Improvements", "🐞 Fixes"). Ask canon to add a changelog entry for a just-shipped task. Expected: it adds the bullet under the right emoji section in *that* project's style — it does not rewrite the file into canon-ai's bracketed "[1.8.0]" style, and the project did not have to edit canon's changelog skill to make this work.
2. Read canon's changelog guidance as an adopter. Expected: it tells you to follow your own project's changelog format and points to your project's versioning policy doc for audience/scope — it does not assume a specific release-automation workflow exists.
3. Read canon's pipeline guidance about release branches. Expected: it still describes the recommended release-branch flow, but clearly says this is one option to adapt to your project (or skip if you don't do versioned releases), and it doesn't bake in a specific changelog format or reference a release-automation file you don't have.
4. Read canon's top-level workflow rules about releases. Expected: nothing demands a version bump or changelog update for projects that don't version — those steps are described as following your project's policy.
5. Picture an existing adopter who updates canon but has never written a "versioning policy" entry in their decisions doc. Ask canon to add a changelog entry. Expected: it still works — it matches their existing changelog's style and adds the bullet, and at most gently suggests they could add a versioning-policy entry for richer guidance. It does not error, block, or demand the policy section first.
6. Confirm canon-ai's own release flow still works end to end with its existing bracketed changelog format — genericizing the guidance did not break the project that uses the canonical form.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names — N/A (full-tier M; plan written in pipeline)
- [x] Known Risks covers failure modes for the trickiest ACs (prescription-vs-description, release/vX.Y over-grep, greenfield)
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has entries marked `- [x]`

---

## Amendment 1 — Codex PR-review P2 fixes (post-`human_review`)

Codex's PR-level review on #131 surfaced two P2 realization gaps: the genericized surface *describes* release-agnostic deference but two operative steps don't *act* on it. Both are addressed by the ACs below; no change to AC-1–AC-11.

- [ ] **AC-12 — `canon-changelog` Phase 3 reads the policy doc when present (present-case deference).** AC-3 framed `docs/decisions.md` "Versioning and Release Policy" as an optional policy layer "used if present," but the operative synthesize step (Phase 3) only reads `AGENTS.md §"Release Rules"` + `CHANGELOG.md` and falls back to `docs/product-context.md` — it never reads `decisions.md` when it *is* present, so an adopter's tier/audience/scope policy is silently ignored and the generic Patch/Minor + audience heuristics take over. Phase 3 must, before drafting, read `docs/decisions.md` "Versioning and Release Policy" **when present** and apply its tier/audience/scope guidance (the version-bump proposal and audience calibration defer to it). When absent, behavior is unchanged (the existing `### When sources are absent` nudge path stays as-is). *Verify:* read Phase 3 — it instructs reading/applying the `decisions.md` policy section when present, ahead of the generic version-bump heuristic; the absent-case nudge in `### When sources are absent` is unchanged. This is the present-case companion to the already-handled absent case (AC-4 Branch A).

- [ ] **AC-13 — `canon-pipeline` §5 init enumeration is example/delegated, not universal.** §5's release-agnostic preface (line ~95) says "some projects… don't version at all; adapt these steps to your project's release setup," but the next step ("Let's start vX.Y", line ~97) enumerates `npm version` / `npm install --package-lock-only` / `npm run build` / `.canon/version` as "the init steps need…," which reads as a universal requirement and contradicts the preface for non-npm adopters. Reword so the enumeration is explicitly canon-ai's *example* (or delegated to "your project's release-branch initialization steps"), consistent with the CHANGELOG/finalize delegation already in §5. The point being preserved — that this skill does **not** run init because the steps fall outside its `canon`/`git`/`gh` command scope — must stay; only the universal framing of the specific commands changes. *Verify:* read §5 "Let's start vX.Y" — the npm/`.canon/version` commands are framed as one project's example (or delegated to project setup), not as steps every project needs; the "skill does not run init / out of command scope" rationale and the operator-delegation steps remain.

### Amendment — Affected Files (delta only)

| File | Change |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Phase 3: read + apply `docs/decisions.md` Versioning policy when present, ahead of the generic version-bump/audience heuristics (AC-12). |
| `.claude/skills/canon-pipeline/SKILL.md` | §5 "Let's start vX.Y": reframe the npm/`.canon/version` init enumeration as canon-ai's example / project-delegated, preserving the out-of-scope rationale (AC-13). |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Derived mirror — regenerated by `sync-templates`. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Derived mirror — regenerated by `sync-templates`. |

No new validation beyond the spec's existing matrix (`lint`, `test`, `sync-templates:check`, `docs-refs-check`). Skill files are not scanned by `docs-refs-check`, but `sync-templates:check` must pass for the two mirrors.

---

## Amendment Round 2 — Finalize-mode version preservation + operative-step sweep (post-`human_review`, Codex P2-C)

Codex's third PR-review P2 (#131, on the AC-12/AC-13 commit) exposed a finalize-mode gap, and the round-over-round shape (Phase 3 policy-read → §5 init → Phase 5 finalize) shows the *same meta-class*: an operative step doesn't fully honor the format-agnostic intent the spec describes. This amendment fixes the reported gap **and** sweeps the remaining operative steps for the same invariant in one pass, to converge rather than iterate per-finding. No change to AC-1–AC-13.

**Reconciliation with AC-4 (supersedes its greenfield-default heading).** AC-4's prose named the greenfield default as the version-carrying `## [X.Y.Z] — unreleased`, but the implemented skill's Prerequisites template (SKILL.md:~34) uses the true Keep-a-Changelog **version-less `## [Unreleased]`** form, and that is the correct release-agnostic choice — `## [X.Y.Z] — unreleased` is canon-ai's *own* non-standard variant, not generic KaC, so making it the "neutral default" would reintroduce the canon-ai bias this task removes. **Amendment Round 2 therefore supersedes AC-4's greenfield-default heading: the documented greenfield default is the version-less `## [Unreleased]` (standard KaC), as the skill already implements.** With that settled, AC-4 (version-less default) and AC-14 (finalize cuts a versioned section from it) compose: the greenfield file is created with `## [Unreleased]`, and finalize converts it to `## [<version>] — <date>` while leaving a fresh `## [Unreleased]` on top. The rest of AC-4 (the two non-blocking absence branches, the nudge, surface-the-choice) is unchanged.

- [ ] **AC-14 — Finalize mode preserves the release version for the version-less `## [Unreleased]` default.** Phase 5 Finalize (line ~172) currently says "replace the 'unreleased' placeholder with today's date, keeping whatever heading pattern the project already uses." For headings that already carry a version (canon-ai `## [X.Y.Z] — unreleased`, v-prefixed `## vX.Y - unreleased`) this is correct and must stay unchanged. But for the **version-less Keep-a-Changelog `## [Unreleased]` form** — the greenfield default this skill itself introduces (Prerequisites, AC-4) — "replace the placeholder with the date" yields a date-only heading (`## [2026-06-04]`) that drops the Phase-4 proposed version and leaves no clear released-version section. Fix Finalize so that when the active block's heading carries no version, it converts the placeholder into the project's **released-version heading** using the version proposed/approved in Phase 4 (e.g. `## [1.9.0] — 2026-06-04`), and — per Keep-a-Changelog convention for that form — recreates a fresh empty `## [Unreleased]` section above the finalized block. Version-carrying formats finalize exactly as before (no new `## [Unreleased]` injected where the project doesn't use one). *Verify:* read Phase 5 Finalize — it branches on "heading carries a version vs. version-less," inserts the Phase-4 version for the version-less case, and recreates the `## [Unreleased]` placeholder only for that KaC form; a reviewer simulating finalize on a `## [Unreleased]` changelog gets `## [<proposed-version>] — <date>` + a fresh `## [Unreleased]`, while canon-ai's and GP's formats finalize identically to before.

- [ ] **AC-15 — Operative-step sweep for the format-agnostic invariant.** Audit **every** operative step that emits, selects, or transforms changelog/version content for one invariant: *use the project's detected format, handle the version-less `## [Unreleased]` default, and assume no specific build toolchain (e.g. npm).* Scope: `canon-changelog` Phases 1–7 (Mode detection, Synthesize/Phase 3, Bullet format/Phase 3, Write/Phase 5 across all four modes, Commit/Phase 7 messages) and `canon-pipeline` §5. Any step still assuming canon-ai's bracketed form, a version-carrying unreleased heading, or npm-specific mechanics must be genericized or explicitly framed as a canon-ai example — consistent with AC-1/2/3/5/12/13/14. This is a consolidation pass: fix the whole class now rather than per-finding. *Verify:* the reviewer enumerates each operative step in the two skills and confirms, per step, that it either (a) defers to the detected/project format, (b) handles the version-less default where applicable, or (c) labels canon-ai-specific mechanics as an example; the AC-14 finalize fix is one instance, and the reviewer reports any additional steps changed (or explicitly states "no other steps required changes" with the per-step rationale).

### Amendment 2 — Affected Files (delta only)

| File | Change |
|---|---|
| `.claude/skills/canon-changelog/SKILL.md` | Phase 5 Finalize: version-less-heading branch inserts the Phase-4 version + recreates `## [Unreleased]` for the KaC form; version-carrying formats unchanged (AC-14). Plus any other operative-step genericization the AC-15 sweep surfaces. |
| `.claude/skills/canon-pipeline/SKILL.md` | Only if the AC-15 §5 sweep surfaces a remaining canon-ai/npm assumption beyond AC-13's fix. |
| `templates/.claude/skills/canon-changelog/SKILL.md` | Derived mirror — regenerated by `sync-templates`. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Derived mirror — regenerated by `sync-templates` (only if §5 changes). |

Same validation matrix as Amendment 1; `sync-templates:check` must pass for any touched mirror.
