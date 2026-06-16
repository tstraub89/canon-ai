# Implementation Handoff: canon-inline-review-skill

> Author: Codex | Spec: `tasks/canon-inline-review-skill/spec.md` | Plan: `tasks/canon-inline-review-skill/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `.claude/skills/canon-inline-review/SKILL.md` | Added the new inline cross-review skill with frontmatter, target-selection contract, mutual-exclusivity guidance, non-interactive execution, concise reporting, and scope bound. |
| `templates/.claude/skills/canon-inline-review/SKILL.md` | Synced mirror of the new skill for canon-managed template shipping. |
| `CLAUDE.md` | Replaced the long inline/XS cross-review how-to with a short norm and a pointer to `/canon-inline-review`. |
| `templates/CLAUDE.md` | Synced delimited mirror of the CLAUDE.md change. |
| `src/lib/canon-owned.ts` | Registered the new skill path in `CANON_OWNED` so canon-managed sync includes it. |
| `src/cli/commands/doctor.ts` | Added the new skill to `checkSkills()` and `RECOMMENDED_ALLOW`. |
| `tests/cli.test.ts` | Expanded the skill-count coverage to seven and switched the README drift checks to the active worktree root. |
| `README.md` | Added the new skill catalog row, the permission-prompt allowlist entries, and the prose skill summary mention. |
| `.claude/settings.json` | Added the local Claude permission allowlist entries for the new skill. |
| `dist/cli/index.js` | Rebuilt the bundled CLI after the doctor / canon-owned changes. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The implementation splits the always-loaded policy from the on-demand mechanics. `CLAUDE.md` now carries only the short guardrail norm, while the new `/canon-inline-review` skill owns the actual target selection and `codex review` invocation flow. I kept the skill registration surfaces, README allowlist, and tests in lockstep so the installer, doctor check, and template sync all agree on the new capability.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| `tests/cli.test.ts` reads `README.md` from `WORKTREE_ROOT` instead of `REPO_ROOT` for the README drift checks. | In this linked worktree, `REPO_ROOT` still points at the supervising checkout, so the test would read the stale README and miss the new allowlist entries. | None; this makes the drift test validate the same README the task actually edits. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: A skill exists at `.claude/skills/canon-inline-review/SKILL.md` with valid frontmatter - `name: canon-inline-review` (matching the directory), a `description` carrying trigger phrases, an `allowed-tools` that permits the `codex` review invocation and read-only git inspection, and an `effort`. Verify: file exists; `name` equals the dir name; frontmatter parses as YAML. | Met | Added the new skill file plus the synced `templates/.claude/skills/canon-inline-review/SKILL.md` mirror; frontmatter includes the required name, trigger phrases, tool allowlist, and effort. |
| AC-2: When invoked, the skill drives an actual cross-review - it determines the target from working-tree state, runs `codex review` / `codex exec review` non-interactively, and surfaces the findings to the session (a concise summary, not a raw dump). Verify: Human Test Plan steps 1-3 (run on a real dirty tree → it runs the review and reports findings). | Met | The skill body now encodes the full workflow and reporting contract. I attempted a live `codex review --uncommitted` smoke test, but the sandbox blocked the app-server client initialization; see Blockers. |
| AC-3: The skill encodes a target-selection contract (a guided procedure, not an open-ended choice) and treats `codex exec review --help` as the version-pinned source of truth for flags rather than freezing a list. The procedure: (a) inspect working-tree state first via read-only `git status`; (b) default to `--uncommitted` when uncommitted changes exist and the intent is a pre-commit review; (c) override to `--commit <SHA>` (one named/last commit - resolve a human reference to a SHA via read-only `git log` / `git rev-parse`) or `--base <branch>` (whole-branch / pre-PR; default the repo's default branch) when the operator names a target or context is unambiguous; (d) state the chosen target and the scope it covers before running, asking only when scope is genuinely ambiguous (e.g. unpushed commits and uncommitted edits both present). Custom steering uses the positional `PROMPT`, which cannot be combined with a target selector (selector XOR prompt; prompt-only defaults to the uncommitted tree). Verify: SKILL.md states procedure (a)-(d), each flag form, and the mutual exclusivity; the flag names match `codex exec review --help` of the installed codex-cli; it notes `codex review` is the shorthand for `codex exec review`. | Met | The skill spells out the guided selection procedure, the XOR prompt rule, the shorthand, and the version-pinned `--help` source of truth. |
| AC-4: The skill states its scope bound - it catches correctness/quality bugs across models and is not a spec-compliance gate; anything with acceptance criteria goes through `canon run` / `--reroute`. Verify: the scope-bound sentence is present in SKILL.md. | Met | The scope-bound sentence is present in the skill body and the top-level description. |
| AC-5: CLAUDE.md's "## Cross-review for inline and XS work (`codex review`)" section is replaced by a <=2-line norm (non-trivial inline + XS changes get an independent `codex review` before commit; Claude never self-reviews its own inline code; not a spec-compliance gate) plus a pointer to the `canon-inline-review` skill; the detailed invocation forms no longer appear in CLAUDE.md. Verify (structural): `grep -c 'codex review --uncommitted' CLAUDE.md` returns `0`; the norm + the skill pointer are present. | Met | `CLAUDE.md` now has the short norm plus the skill pointer, and the mirrored `templates/CLAUDE.md` stayed in sync. |
| AC-6: The skill is registered on every required surface so the full validation suite passes: added to `CANON_OWNED` in `src/lib/canon-owned.ts` (which is what gives it a `templates/` mirror); to the `checkSkills()` `skillNames` list and to `RECOMMENDED_ALLOW` in `src/cli/commands/doctor.ts` (`RECOMMENDED_ALLOW` is the adopter-facing grant path); to the skill-enumeration test(s) in `tests/cli.test.ts`; to README's "Skip the permission prompts" JSON block (lockstep with `RECOMMENDED_ALLOW` - see the README row in Affected Files); and granted in canon-ai's own `.claude/settings.json` (canon-ai-local only - this file has no `templates/` mirror and does not ship to adopters). Verify: `lint`, `type-check`, `test`, `build`, `docs-refs-check`, and `sync-templates:check` all pass (per Validation Required); in particular the `README "Skip the permission prompts" allowlist matches RECOMMENDED_ALLOW` test passes (README block == `RECOMMENDED_ALLOW`), and `sync-templates:check` passes precisely because `settings.json` is outside the synced set, so no `templates/.claude/settings.json` is expected. | Met | All required validations passed on the final tree: lint, type-check, test, build, docs-refs-check, and sync-templates:check. |

## Edge Cases Considered

- Clean working tree now prompts for a specific commit or branch instead of silently running an empty `--uncommitted` review.
- The skill distinguishes `--commit <SHA>` from `--base <branch>` so a single commit review does not accidentally pretend to cover a whole branch.
- Prompt-only steering remains possible, but only when no selector is used.
- The README drift test now reads the active worktree root, which matters in linked-worktree runs where `REPO_ROOT` points at the supervising checkout.
- The generated `templates/` mirrors stay in sync with the root files through the existing canon sync flow.

## Blockers

- `codex review --uncommitted` could not complete in this sandbox: `failed to initialize in-process app-server client: Operation not permitted (os error 1)`. The skill text and registration are in place, but the live smoke test from the Human Test Plan could not be completed here.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite passed after the README drift test was switched to `WORKTREE_ROOT`. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` after the source changes. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | Root and `templates/` mirrors were in sync after running the sync step. |
| `codex review --uncommitted` smoke test | blocked | The sandbox rejected the app-server client initialization with `Operation not permitted (os error 1)`. |
| `E2E` | not_configured | canon-ai has no UI / E2E surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `.claude/skills/canon-inline-review/SKILL.md` | Rewrote the target-selection contract to follow operator intent + conversation + `$ARGUMENTS`, removed git-state intent inference, switched the review examples to `codex exec review`, and documented the CLI's default read-only review behavior after confirming the installed `codex review` wrapper rejects `--sandbox`. Also trimmed the unused `git branch` permission. |
| `templates/.claude/skills/canon-inline-review/SKILL.md` | Synced mirror of the amended skill text. |
| `tasks/canon-inline-review-skill/spec.md` | Added the amendment that replaces the old git-state-driven target-selection contract with the intent-driven AC-3 rewrite. |
| `tasks/canon-inline-review-skill/plan.md` | Added the reroute plan that narrows the delta to the skill file and spells out the amended contract. |
| `tasks/canon-inline-review-skill/spec-review.md` | Recorded the spec review verdict for the amended spec. |
| `tasks/canon-inline-review-skill/status.json` | Updated reroute bookkeeping for the implement rerun. |
| `tasks/canon-inline-review-skill/notes.md` | Appended the reroute note about the installed CLI rejecting the explicit `--sandbox` flag on `codex review`. |
| `tasks/canon-inline-review-skill/handoff.md` | Appended this reroute iteration so the handoff stays cumulative. |
| `docs/pipeline-invocations.md` | Auto-appended invocation telemetry from this reroute pass. |

### Findings addressed

- _correctness bug:_ the skill no longer infers review targets from git history or ahead-counts; it now reads intent from the request, the conversation, and `$ARGUMENTS`, then uses one `git status --porcelain` guard only for the clean-tree no-op case.
- _risk/guardrail:_ the target-selection procedure now makes the user-facing ambiguity path explicit via `AskUserQuestion` instead of guessing.
- _correctness bug:_ the review examples now use the documented `codex exec review` form, which is the installed CLI surface that actually accepts the review options.
- _optional cleanup/nit:_ the unused `git branch` permission was removed from the skill frontmatter; the wording now says intent first instead of "working-tree state first".

### AC deltas (if any)

- AC-3: the intent-driven target-selection contract is now encoded, but the explicit `--sandbox read-only` wording from the amendment is not representable on codex-cli 0.139.0 because `codex exec review --help` does not expose a sandbox flag. The skill documents the CLI's default read-only review behavior instead.

### Blockers

- [ambiguity] The amended spec requested an explicit `--sandbox read-only` invocation, but the installed `codex exec review --help` surface does not expose that flag and `codex review --uncommitted --sandbox read-only` is rejected by the wrapper. The implementation therefore uses the documented `codex exec review` form and relies on the CLI's default read-only behavior.
- Live smoke test: `codex exec review --uncommitted` still fails in this sandbox with `failed to initialize in-process app-server client: Operation not permitted (os error 1)`.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm test` | Pass | Full suite passed again on the final tree after the reroute edit. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `codex exec review --uncommitted` smoke test | blocked | The sandbox rejected the app-server client initialization with `Operation not permitted (os error 1)`. |
