# Spec: canon-inline-review-skill — Add canon-inline-review cross-review skill

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

CLAUDE.md carries a full "## Cross-review for inline and XS work (`codex review`)" section — the four invocation forms, the selector-XOR-prompt rule, dirty-tree `--commit` scoping. That detail is loaded into **every** Claude session even though it's only relevant when actually running an inline review. Anthropic's CLAUDE.md guidance is explicit that sometimes-relevant how-to belongs in an on-demand skill, not the always-loaded file ("use skills instead… without bloating every conversation").

There is also no executable workflow for it: canon's norms require an independent second-model review of below-the-pipeline work (non-trivial inline edits, XS fixes too small for a task), but the operator has to hand-construct the `codex review` invocation each time. Canon has skills for spec pre-flight (`canon-review`), pipeline driving (`canon-pipeline`), etc., but none for the inline cross-review its own discipline demands.

## Decision

Add a new canon-managed Claude Code skill **`canon-inline-review`** that, when invoked, *drives* an independent second-model cross-review of below-the-pipeline work: it determines the review target from working-tree state, runs `codex review` (the documented shorthand for `codex exec review`), and reports the findings back concisely.

Move the invocation mechanics out of CLAUDE.md into the skill (its operating logic plus a short reference). **Replace** the CLAUDE.md "Cross-review for inline and XS work" section with a ≤2-line guardrail *norm* plus a pointer to the skill — the always-loaded file keeps the **rule** (when to cross-review; Claude never self-reviews its own inline code; this is not a spec-compliance gate) but sheds the **mechanics**. A skill that only loads on demand can't remind the agent to invoke it, so the norm must stay always-on.

Register the skill across all canon surfaces so it ships to adopters and CI stays green.

The skill is **function-named** (`canon-inline-review`), not tool-named (`canon-codex-review`), so the name survives a change of second-model reviewer — consistent with the no-provider-lock-in stance in `docs/decisions.md` §"Canon prescribes no release model to adopters."

## Non-Goals

- **Not** the deep CLAUDE.md slim (separate task B) — this task touches CLAUDE.md only to collapse the one cross-review section.
- **Not** the `canon-review` → `canon-spec-review` rename (separate task C).
- **Not** changing the pipeline `code_review` phase, its foreman, or its anchored/cold lenses.
- **Scope bound is correctness/quality cross-review of below-pipeline work only.** Anything with acceptance criteria worth enforcing goes through `canon run` / `--reroute`, never this skill. (Stated positively rather than as a prose "NOT a gate" alone — the skill text and AC-4 carry the bound.)
- **Not** adding a pre-commit hook or any automation that auto-runs the review — the skill is *invoked*, not enforced.

## Acceptance Criteria

- [ ] AC-1: A skill exists at `.claude/skills/canon-inline-review/SKILL.md` with valid frontmatter — `name: canon-inline-review` (matching the directory), a `description` carrying trigger phrases, an `allowed-tools` that permits the `codex` review invocation and read-only git inspection, and an `effort`. Verify: file exists; `name` equals the dir name; frontmatter parses as YAML.
- [ ] AC-2: When invoked, the skill drives an actual cross-review — it determines the target from working-tree state, runs `codex review` / `codex exec review` non-interactively, and surfaces the findings to the session (a concise summary, not a raw dump). Verify: Human Test Plan steps 1–3 (run on a real dirty tree → it runs the review and reports findings).
- [ ] AC-3: The skill encodes a **target-selection contract** (a guided procedure, not an open-ended choice) and treats `codex exec review --help` as the version-pinned source of truth for flags rather than freezing a list. The procedure: (a) inspect working-tree state first via read-only `git status`; (b) **default to `--uncommitted`** when uncommitted changes exist and the intent is a pre-commit review; (c) **override** to `--commit <SHA>` (one named/last commit — resolve a human reference to a SHA via read-only `git log` / `git rev-parse`) or `--base <branch>` (whole-branch / pre-PR; default the repo's default branch) when the operator names a target or context is unambiguous; (d) **state the chosen target and the scope it covers before running**, asking only when scope is genuinely ambiguous (e.g. unpushed commits *and* uncommitted edits both present). Custom steering uses the positional `PROMPT`, which cannot be combined with a target selector (selector XOR prompt; prompt-only defaults to the uncommitted tree). Verify: SKILL.md states procedure (a)–(d), each flag form, and the mutual exclusivity; the flag names match `codex exec review --help` of the installed codex-cli; it notes `codex review` is the shorthand for `codex exec review`.
- [ ] AC-4: The skill states its scope bound — it catches correctness/quality bugs across models and is **not** a spec-compliance gate; anything with acceptance criteria goes through `canon run` / `--reroute`. Verify: the scope-bound sentence is present in SKILL.md.
- [ ] AC-5: CLAUDE.md's "## Cross-review for inline and XS work (`codex review`)" section is replaced by a ≤2-line norm (non-trivial inline + XS changes get an independent `codex review` before commit; Claude never self-reviews its own inline code; not a spec-compliance gate) plus a pointer to the `canon-inline-review` skill; the detailed invocation forms no longer appear in CLAUDE.md. Verify (structural): `grep -c 'codex review --uncommitted' CLAUDE.md` returns `0`; the norm + the skill pointer are present.
- [ ] AC-6: The skill is registered on every required surface so the full validation suite passes: added to `CANON_OWNED` in `src/lib/canon-owned.ts` (which is what gives it a `templates/` mirror); to the `checkSkills()` `skillNames` list and to `RECOMMENDED_ALLOW` in `src/cli/commands/doctor.ts` (`RECOMMENDED_ALLOW` is the adopter-facing grant path); to the skill-enumeration test(s) in `tests/cli.test.ts`; to README's "Skip the permission prompts" JSON block (lockstep with `RECOMMENDED_ALLOW` — see the README row in Affected Files); and granted in canon-ai's own `.claude/settings.json` (canon-ai-local only — this file has no `templates/` mirror and does not ship to adopters). Verify: `lint`, `type-check`, `test`, `build`, `docs-refs-check`, and `sync-templates:check` all pass (per Validation Required); in particular the `README "Skip the permission prompts" allowlist matches RECOMMENDED_ALLOW` test passes (README block == `RECOMMENDED_ALLOW`), and `sync-templates:check` passes precisely because `settings.json` is outside the synced set, so no `templates/.claude/settings.json` is expected.

## Design

### Affected Files

> Templates mirrors and `dist/` are sync/build-generated, but are declared here because the `--pr` base-drift gate rejects any committed path not in this table (the "declare both root and its `templates/` mirror" rule; build-generated artifacts alongside their sources). **`.claude/settings.json` is the one exception — it is committed but NOT a `CANON_OWNED`/`DELIMITED` file, so it has no `templates/` mirror and the sync pipeline never touches it; it is canon-ai's own operator/dev settings (note its machine-specific `additionalDirectories` + `sandbox`).** The adopter-facing grant ships via `RECOMMENDED_ALLOW` in `doctor.ts`, not via a shipped `settings.json` mirror — so editing the root `.claude/settings.json` only enables the grant for canon-ai's own sessions.

| File | Change |
|---|---|
| `.claude/skills/canon-inline-review/SKILL.md` | **CREATE** — new workflow skill: frontmatter; when-to-use guardrail; the AC-3 target-selection contract (default `--uncommitted`; override to `--commit`/`--base` on explicit/unambiguous context; the gotcha guardrails); runs `codex review`; reports findings concisely; scope bound; flag reference pointing at `codex exec review --help`. |
| `CLAUDE.md` | Replace the "## Cross-review for inline and XS work (`codex review`)" section (≈ lines 209–220) with a ≤2-line norm + pointer to the skill. |
| `src/lib/canon-owned.ts` | Add `.claude/skills/canon-inline-review/SKILL.md` to `CANON_OWNED` (alphabetical among the skill entries). Do not touch `DELIMITED`. |
| `src/cli/commands/doctor.ts` | Add `canon-inline-review` to the `checkSkills()` `skillNames` list (line ~249) and add `Skill(canon-inline-review)` / `Skill(canon-inline-review:*)` to `RECOMMENDED_ALLOW` (after the `canon-review` entries). |
| `tests/cli.test.ts` | Update the skill-enumeration test(s) that hardcode the skill set: the `checkSkills: all six skills present → pass` test (≈ line 406) must add `canon-inline-review` to its loop and the name becomes "seven"; audit the other `checkSkills` tests (≈ lines 425, 439) so their fixtures still satisfy the expanded `skillNames`. |
| `.claude/settings.json` | Add `Skill(canon-inline-review)` and `Skill(canon-inline-review:*)` to `permissions.allow` (after the `canon-review` entries). Canon-ai's own dev settings — no `templates/` mirror. |
| `README.md` | Three edits: (1) add `canon-inline-review` to the skill catalog table; (2) add it to the prose skill summary; (3) add `Skill(canon-inline-review)` and `Skill(canon-inline-review:*)` to the "Skip the permission prompts" JSON block — that block is coupled to `RECOMMENDED_ALLOW` by the `README "Skip the permission prompts" allowlist matches RECOMMENDED_ALLOW` drift test (compared sorted), so it must change in lockstep with the `doctor.ts` `RECOMMENDED_ALLOW` edit or `npm test` fails. |
| `templates/.claude/skills/canon-inline-review/SKILL.md` | Auto-synced mirror (pre-commit hook stages it because the SKILL.md is in `CANON_OWNED`). |
| `templates/CLAUDE.md` | Auto-synced mirror of the CLAUDE.md change (DELIMITED). |
| `dist/cli/index.js` | Rebuilt via `npm run build` (bundles `doctor.ts` + `canon-owned.ts`). |

### Interaction Dependencies

- Skill enumeration is **intentionally redundant** across `canon-owned.ts`, `doctor.ts`, and `tests/cli.test.ts` — all three must include the new skill or CI fails. The reviewer should confirm all three, not just one.
- The pre-commit hook (`sync-canon-templates.mjs --stage`) auto-creates/stages the `templates/` mirrors for every `CANON_OWNED` entry (and the canon-delimited region of `DELIMITED` files); `sync-templates:check` is the CI backstop. The new SKILL.md is in `CANON_OWNED`, so its mirror is auto-managed; `CLAUDE.md` is `DELIMITED`, so its tail mirror is auto-managed. **`.claude/settings.json` is in neither set, so the sync pipeline does not create a `templates/.claude/settings.json` — do not add one and do not add `settings.json` to `CANON_OWNED` (it carries canon-ai's machine-specific `additionalDirectories`/`sandbox`, which must not ship to adopters).** Per Codex spec_review, `WHOLESALE_SYNC = [...CANON_OWNED]` in `scripts/sync-canon-templates.mjs` confirms there is no code path that would mirror `settings.json`.
- **Sequencing**: this task (A) precedes the deep CLAUDE.md slim (B — shares `CLAUDE.md`) and the `canon-review`→`canon-spec-review` rename (C — shares `canon-owned.ts`). Run sequentially; do not run in parallel worktrees, which would collide on those shared files.

### Data Model Changes

None. No `status.json` schema change, no shared type change beyond appending a string literal to the `CANON_OWNED` array.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; the skill-enumeration tests are updated and the suite runs clean
- [x] `npm run build` — `dist/` regenerated and committed (doctor/canon-owned are bundled)
- [x] `npm run docs-refs-check` — CLAUDE.md / SKILL.md path refs resolve
- [x] `npm run sync-templates:check` — root and `templates/` mirrors in sync
- [ ] E2E — N/A (canon-ai has no UI / E2E surface)

## Docs Impact

- `CLAUDE.md` — the collapsed section is part of this change (not freshness drift).
- `docs/codebase-map.md` — QA checkpoint: if it enumerates the skill inventory, add `canon-inline-review`.
- `README.md` — skill catalog (in Affected Files).
- No other protected doc expected to drift.

## Known Risks

- **`codex review` is a shorthand for `codex exec review`** (confirmed: `codex exec` lists a `review` subcommand; `codex exec review --help` carries `--uncommitted` / `--base` / `--commit` / `[PROMPT]` / `--title`). The public CLI *web* reference doesn't list `codex review` at the top level, so the skill should reference `codex exec review` as the documented form, name `codex review` as the shorthand, and instruct deriving the live flag set from `codex exec review --help` rather than freezing a list a codex version bump could break. Flags here are pinned to codex-cli **0.139.0**.
- **selector-XOR-prompt** mutual exclusivity is observed parser behavior (not surfaced in `--help`), verified on 0.139.0. State it as observed; prefer prompt-only only when steering is needed (target then defaults to the uncommitted tree).
- **Target-selection gotchas (why the AC-3 contract is pinned, not left open-ended)**: `--commit <SHA>` reviews **only that commit's own diff**, not the cumulative state up to it — for "everything I've done," use `--base`, not `--commit`; there is **no multi-SHA or commit-range** form (review a span via `--base <branch>`, or commit the lot then `--base`); `--uncommitted` **excludes already-committed work**; a **clean working tree** makes `--uncommitted` a no-op, so the skill must detect it and clarify intent rather than run an empty review. The skill must encode these so the wrong target isn't silently chosen.
- **stdin-hang footgun**: plain `codex exec "<prompt>"` can block reading stdin; the `review` subcommand runs non-interactively and does not, but the skill's invocation should not introduce a piped-stdin path that reintroduces the hang.
- **Output volume**: `codex review` can emit tens of KB. The skill must summarize findings rather than dumping raw output, to protect the operator session's context (AC-2 requires a concise summary).
- **Registration redundancy**: missing any of the three sites (`canon-owned.ts` / `doctor.ts` / `tests/cli.test.ts`) turns CI red. Affected Files + AC-6 enumerate all three.

## Human Test Plan

1. In a repo using canon, make a small uncommitted code change.
2. Ask for an inline review (e.g. "review my uncommitted changes before I commit", or invoke the skill directly).
3. Expected: it runs an independent second-model review of your uncommitted changes and reports the findings (bugs / quality issues) without you having to recall the exact review command — and it does **not** behave like a spec / acceptance-criteria gate.
4. Open CLAUDE.md: confirm the long "Cross-review for inline and XS work" how-to is gone, replaced by a short rule stating that non-trivial inline changes get an independent review before commit, pointing to the skill.
5. Run canon's health check and the test suite: the new skill is recognized and everything passes.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan is a pipeline phase)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
