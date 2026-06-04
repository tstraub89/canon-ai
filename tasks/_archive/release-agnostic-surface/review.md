# Code Review: release-agnostic-surface

> Reviewer: Claude | Spec: `tasks/release-agnostic-surface/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (`npm run lint`, `npm test`, `npm run sync-templates:check`, `npm run docs-refs-check` — all Pass)
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `canon-changelog` detects and matches the existing format | **Partial** | Phase 3 formatting rules are correct. Phase 5 "Fresh release mode" step 1 still prescribes `## [X.Y.Z] — YYYY-MM-DD` (canon-ai's bracketed form) and uses `## [` as the insertion marker. "In-progress append mode" step 1 hardcodes `### Added / ### Changed / ### Fixed / ### Removed`. Both contradict the Phase 3 instruction to use the project's detected headings. See Finding 1. |
| AC-2: GP format is a worked witness | **Partial** | Mode detection and Phase 3 formatting rules cover GP's emoji categories. Phase 5 "In-progress append mode" step 1 would create `### Added` inside GP's changelog (which has `### 🚀 Improvements`/`### 🐞 Fixes`) — exactly the failure mode the AC guards against. See Finding 1. |
| AC-3: defers policy to `decisions.md` if present; drops `auto-release` | Met | `auto-release` absent from both skills; frontmatter `description` updated; mode table genericized; §Versioning framed as optional. |
| AC-4: Graceful degradation when a source is absent | **Partial** | Non-blocking behavior is present. Missing: (a) the nudge to fill docs/decisions.md §Versioning when absent; (b) explicit "surface the choice" instruction for the greenfield case. The handoff claims "Added a When sources are absent section" — no such section exists in the file. See Finding 2. |
| AC-5: `canon-pipeline` §5 keeps the model, optional + genericized | Met | Optional/recommended framing added; `auto-release` and `release-process.md` removed; ship step defers to `canon-changelog`. |
| AC-6: `canon-pipeline` preserves release-model-agnostic mechanics | Met | `base_branch` auto-detect guidance unchanged; `--pr`/`--ship` intact; `release-process.md` pointer genericized. |
| AC-7: `AGENTS.md` four spots reconciled (only those four) | Met | Spots (a)–(d) updated to defer to project policy. Release Rules #2 and Validation Matrix untouched. |
| AC-8: `docs/pipeline-orchestrator.md` squash note + changelog-line + pointer reconcile | Met | Squash note added near `--ship` description; changelog/version-bump line conditioned on project versioning; cheatsheet comment genericized. |
| AC-9: `auto-release` absent from both shipped skills | Met | Confirmed by diff — no `auto-release` strings remain in either skill. |
| AC-10: canon-owned mirrors synced | Met | All five mirror files appear in diff matching their roots. |
| AC-11: CHANGELOG bullet | Met | Bullet present under `## [Unreleased]`. |

### Dropped Sections Check

- [x] Non-goals respected — `docs/release-process.md`, `auto-release.yml`, `--ship` behavior, `canon-init`, `dist/` all untouched
- [x] Known Risks addressed in implementation
- [ ] Human Test Plan satisfiable — HTP item 1 ("append bullet in GP's style") is blocked by the Phase 5 gap in Finding 1; the skill currently prescribes the wrong headings for non-canon-ai projects at write time

### Stage 1 Verdict

- [ ] **Pass**
- [x] **Fail** — AC-1, AC-2, AC-4 Partial; Phase 5 prescribes canon-ai-specific format at write time (AC-1/AC-2); AC-4 nudge and greenfield surface-choice instruction missing. Skip Stage 2.

## Stage 2 — Code Quality (only if Stage 1 passed)

Not run — Stage 1 failed.

---

## Findings

### Finding 1 — `correctness bug` — Phase 5 write steps prescribe canon-ai-specific format (AC-1, AC-2)

**File**: `.claude/skills/canon-changelog/SKILL.md` Phase 5, lines 155–162

**Fresh release mode, step 1** (line 156):
> Insert a new `## [X.Y.Z] — YYYY-MM-DD` section immediately before the first existing `## [` version block

Two problems: (1) `## [X.Y.Z] — YYYY-MM-DD` is canon-ai's bracketed format, not the project's detected format. (2) `## [` as the insertion marker fails for GP's `## v1.8 - 2025-01-01` headings which don't start with `## [`. The parenthetical description `(main, no active ## [<version>] — unreleased block)` also still names canon-ai's format as the trigger condition.

**In-progress append mode, step 1** (line 160):
> Append bullets to the appropriate `### Added` / `### Changed` / `### Fixed` / `### Removed` subheading within the active unreleased block (create the subheading if absent).

GP has no `### Added` heading. "Create the subheading if absent" would insert `### Added` inside a GP changelog that uses `### 🚀 Improvements` — this is precisely what AC-2 prohibits. Phase 3's formatting rules say "Use the category headings your CHANGELOG already has" and "Create a new category heading only if it matches an existing category type in the file," but Phase 5 is the procedural write step an agent executes and contradicts Phase 3 at the point that matters.

**Fix**: Update Phase 5 "Fresh release mode" step 1 to reference the project's detected version-heading pattern and detected heading boundary (not `## [`). Update "In-progress append mode" step 1 to say "Append bullets under the matching category heading from the project's existing CHANGELOG (derived in Mode detection); create a new subheading only if a matching category type exists in the file."

---

### Finding 2 — `spec gap` — AC-4 two-branch degradation incomplete; handoff overclaims

**File**: `.claude/skills/canon-changelog/SKILL.md` throughout

AC-4 requires two defined, non-blocking branches when sources are absent. Current state:

**Branch A — No `§Versioning` policy**: the skill says "If it doesn't, read docs/product-context.md for context and use judgment" (lines 40, 95). The spec's verify clause requires "a correct format-matched entry **plus the nudge**" — specifically "emit a one-time nudge suggesting the adopter fill docs/decisions.md §Versioning for richer policy." The nudge is absent. A user upgrading into the genericized skill without a `§Versioning` entry would not be prompted to create one.

**Branch B — Greenfield (no CHANGELOG format to match)**: the Prerequisites template now defaults to `## [Unreleased]` (correct neutral default per spec). But the spec requires "surface the choice to the human rather than silently imposing a format." The current skill creates the CHANGELOG with the template and proceeds; there is no instruction to confirm the chosen default format with the user before creating the file.

The handoff states "Added a `When sources are absent` section that defines both the no-policy branch and the greenfield default/fallback path without blocking." No such section exists in the file. The AC-4 handling was distributed into existing sections without the explicit absent-source behaviors the spec requires.

**Fix**: Add explicit language (inline or as a named section) for both branches: (a) when `§Versioning` is absent, proceed normally and emit a note: "Tip: add a Versioning and Release Policy section to docs/decisions.md for richer audience/scope guidance"; (b) when CHANGELOG.md doesn't exist or has no detectable format, show the proposed default (`## [Unreleased]` / Keep-a-Changelog) and confirm with the user before creating the file.

---

## Final Verdict

- [ ] Approved
- [ ] Approved with nits
- [x] **Changes requested** — Finding 1 (Phase 5 write steps still impose canon-ai format, breaks AC-1/AC-2) and Finding 2 (AC-4 nudge and greenfield surface-choice missing) must be addressed before shipping.
- [ ] Needs re-review

---

<!--
On re-review, append below this line:
-->

## Round 2 — verifying iteration 1's response to round 1

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `canon-changelog` detects and matches the existing format | Met | Phase 5 "Fresh release mode" step 1 now uses "the version-heading pattern derived in Mode detection" and "first existing version block in the project's own format" — no longer prescribes `## [X.Y.Z] — YYYY-MM-DD` or `## [` as insertion marker. SKILL.md:161–162. |
| AC-2: GP format is a worked witness | Met | Phase 5 "In-progress append mode" step 1 now says "Append bullets under the matching category heading from the project's existing CHANGELOG (derived in Mode detection). Create a new category heading only if the file already uses that category type." GP's `### 🚀 Improvements` is correctly targeted; no `### Added` would be created. SKILL.md:166. |
| AC-3: defers policy to `decisions.md` if present; drops `auto-release` | Met (unchanged from round 1) | No changes to these paths in iteration 1. |
| AC-4: Graceful degradation when a source is absent | Met | `### When sources are absent` section added (SKILL.md:42–46). Branch A (no §Versioning): proceeds non-blocking + emits the tip nudge after finishing. Branch B (greenfield): line 28 now says "treat it as a greenfield case: propose the default format below and confirm it with the human before writing." Both branches defined, non-blocking, greenfield default named and surfaced for confirmation. |
| AC-5: `canon-pipeline` §5 keeps the model, optional + genericized | Met (unchanged from round 1) | No changes to canon-pipeline in iteration 1. |
| AC-6: `canon-pipeline` preserves release-model-agnostic mechanics | Met (unchanged from round 1) | Unchanged. |
| AC-7: `AGENTS.md` four spots reconciled (only those four) | Met (unchanged from round 1) | Unchanged. |
| AC-8: `docs/pipeline-orchestrator.md` squash note + changelog-line + pointer reconcile | Met (unchanged from round 1) | Unchanged. |
| AC-9: `auto-release` absent from both shipped skills | Met (unchanged from round 1) | Iteration 1 made no changes that could introduce `auto-release` references. |
| AC-10: canon-owned mirrors synced | Met | `npm run sync-templates:check` Pass in iteration 1 re-run. Template for canon-changelog updated in lockstep. |
| AC-11: CHANGELOG bullet | Met (unchanged from round 1) | Unchanged. |

### Verifying Round 1 findings

- _correctness bug:_ "Phase 5 write steps prescribe canon-ai-specific format" → addressed at SKILL.md:161–162, 166; AC-1 and AC-2 now Met in table above ✓
- _spec gap:_ "AC-4 two-branch degradation incomplete; handoff overclaims" → addressed: `### When sources are absent` section added with both branches explicit, nudge present, greenfield confirmation present; AC-4 now Met ✓

### New findings introduced by Iteration 1's changes

None. The iteration only touched canon-changelog SKILL.md and its template mirror. No regressions in previously-Met ACs. The minor structural observation that "When sources are absent" lives inside `## Prerequisites` rather than as a top-level section is not blocking — its location is before Mode detection, which is the right ordering for a gate/fallback.

### Verdict for this round

- [x] **Approved** — all 11 ACs Met; both round 1 findings resolved; no new issues.
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

## Round 3 — verifying iteration 2 (Amendment 1: AC-12 + AC-13)

This round covers only the amendment ACs. Original ACs 1–11 were approved in Round 2; Iteration 3 made no changes to their implementations.

### Validation Gate

- [x] Validation Outcomes table (Iteration 3 section) has no Fail results
- [x] All required checks re-ran and passed: `npm run lint`, `npm test`, `npm run sync-templates:check`, `npm run docs-refs-check` — all Pass
- [x] No required checks were skipped without justification

### Acceptance Criteria Check (Amendment ACs only)

| AC | Status | Notes |
|---|---|---|
| AC-12: Phase 3 reads and applies the `docs/decisions.md` Versioning policy when present | Met | SKILL.md:101 — Phase 3 now reads `docs/decisions.md` when it exists and has a matching heading, uses its tier/audience/scope guidance "before falling back to the generic heuristics below." The absent-case nudge in `### When sources are absent` is unchanged from Round 2's approval (verified at SKILL.md:44). |
| AC-13: `canon-pipeline` §5 init enumeration is example/delegated | Met | SKILL.md (canon-pipeline):97 — "For canon-ai, the init steps use `npm version`, `npm install --package-lock-only`, `npm run build`, and edits to `.canon/version` + `CHANGELOG.md`; other projects may initialize release branches differently." The npm/`.canon/version` steps are explicitly labeled as canon-ai's example. The "skill does not run init / out of command scope" rationale is preserved and the operator-delegation steps are intact. |

### New issues introduced by Iteration 3

None. The iteration was narrow: Phase 3 received one sentence, and the "Let's start vX.Y" block was reworded without changing any surrounding mechanics. Previously-Met ACs unaffected.

### Verdict for this round

- [x] **Approved** — AC-12 and AC-13 Met; no regressions; all 13 ACs across original spec + Amendment 1 now Met.
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

## Round 4 — verifying iteration 3 (Amendment Round 2: AC-14 + AC-15)

This round covers only the Amendment Round 2 ACs. ACs 1–13 were approved in Rounds 2–3; Iteration 4 made no changes to their implementations.

### Validation Gate

- [x] Validation Outcomes table (Iteration 4 section) has no Fail results
- [x] All required checks re-ran and passed: `npm run lint`, `npm test`, `npm run sync-templates:check`, `npm run docs-refs-check` — all Pass
- [x] Additional AC-9 spot-checks in Iteration 4 re-run table: no `auto-release` in either skill, no `do versioned releases` in canon-changelog, no `release-process` in pipeline-orchestrator — all Pass

### Acceptance Criteria Check (Amendment Round 2 ACs)

| AC | Status | Notes |
|---|---|---|
| AC-14: Finalize mode preserves the release version for the version-less `## [Unreleased]` default | Met | SKILL.md:171–174 — Phase 5 Finalize now branches on whether the active unreleased heading carries a version. Version-carrying (canon-ai `## [X.Y.Z]`, GP `## vX.Y`): replaces placeholder with date, no `## [Unreleased]` injected. Version-less (`## [Unreleased]` — the KaC form and the skill's own greenfield default): inserts the Phase-4 proposed/approved version converting to `## [<version>] — YYYY-MM-DD`, then recreates a fresh empty `## [Unreleased]` above. Simulating finalize on a `## [Unreleased]` changelog yields the correct `## [<version>] — <date>` + fresh `## [Unreleased]` result; canon-ai and GP forms finalize unchanged. |
| AC-15: Operative-step sweep for the format-agnostic invariant | Met | All operative steps enumerated: (1) Version source line 20: defers ("project's version source if it has one; canon-ai uses package.json"). (2) Mode detection: derives format from existing CHANGELOG, examples include GP emoji and v-prefix forms. (3) Phase 3 bullet format code block: labeled "match your project's existing CHANGELOG exactly" with formatting rules overriding to the detected heading pattern; canon-ai's bracketed form appears as the code block illustration only — see nit below. (4) Phase 3 formatting rules: defer to detected pattern and existing category headings explicitly. (5) Phase 5 fresh release: "version-heading pattern derived in Mode detection" + "project's version files (for canon-ai, package.json…)". (6) Phase 5 in-progress: "matching category heading from the project's existing CHANGELOG (derived in Mode detection)". (7) Phase 5 finalize: AC-14 coverage. (8) Phase 6 diff: generic `<version-files if applicable>`. (9) Phase 7 commit messages: all genericized to `<version>` / `<task-id>` placeholders. (10) canon-pipeline §5 ship: delegates to `canon-changelog finalize`. No operative step imposes canon-ai's format or assumes npm. |

### New issues introduced by Iteration 4

**`optional cleanup/nit` — Phase 3 bullet-format code block shows only canon-ai's format without a label.**

`.claude/skills/canon-changelog/SKILL.md` lines 116–130

The "Bullet format" code block shows `## [X.Y.Z] — unreleased` and `### Added`/`### Changed`/`### Fixed`/`### Removed` as the only structural illustration. The surrounding text ("match your project's existing CHANGELOG exactly") and the formatting rules immediately below it ("Use the version-heading pattern derived in Mode detection") correctly defer to the project's format, so the operative instructions are sound. But the code block has no label like "(example — adapt to your project's format)" that would signal to a skimmer that the illustrated headings are illustrative structure, not the target format. A GP adopter reading quickly could anchor on the bracketed form and the `### Added` headings and only catch the override in the rules paragraph. Low risk given the explicit rule text, but a one-word annotation on the code fence or a `> (example format — match your project's existing headings)` callout above the block would eliminate the ambiguity entirely. Does not block shipping.

### Verifying round 3 findings

Round 3 had no findings. Nothing to verify.

### Verdict for this round

- [ ] Approved
- [x] **Approved with nits** — AC-14 and AC-15 Met; the nit on the Phase 3 code block (no "example" label) is cosmetic and does not affect correctness; all 15 ACs across original spec + Amendment 1 + Amendment Round 2 now Met.
- [ ] Changes requested
- [ ] Needs re-review
