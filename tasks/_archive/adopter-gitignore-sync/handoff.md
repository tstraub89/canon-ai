# Implementation Handoff: adopter-gitignore-sync

> Author: Codex | Spec: `tasks/adopter-gitignore-sync/spec.md` | Plan: `tasks/adopter-gitignore-sync/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `.gitignore` | Moved the three canon runtime-file ignore patterns into the managed `# canon:start` / `# canon:end` block and removed the prior standalone comment/patterns. |
| `src/lib/canon-block.ts` | Added the shared gitignore block constant, runtime pattern list, pure `upsertCanonBlock`, and `extractCanonBlock` self-hosting helper. |
| `src/cli/commands/init.ts` | Added explicit `.gitignore` upsert handling after template scaffolding, including malformed-marker warning without aborting init. |
| `src/cli/commands/upgrade.ts` | Added `.gitignore` refresh through the existing `pending` write queue, malformed-marker reporting, and CLI summary output for malformed files. |
| `src/cli/commands/doctor.ts` | Added and registered warn-level `checkRuntimeFilesGitignored`. |
| `templates/.gitignore` | Added the block-only adopter template sourced from `CANON_GITIGNORE_BLOCK`. |
| `scripts/sync-canon-templates.mjs` | Added constant-sourced `templates/.gitignore` drift detection/apply support without adding it to DELIMITED sync. |
| `tests/cli.test.ts` | Added helper, doctor, upgrade, root self-hosting, and shipped-template leak coverage for the gitignore block. |
| `tests/sync-canon-templates.test.ts` | Seeded `templates/.gitignore` in sync fixtures and added drift/idempotency/first-create tests for the constant-source sync path. |
| `dist/cli/index.js` | Rebuilt the published CLI bundle after source changes. |
| `docs/codebase-map.md` | Added the gitignore-management surface and adopter-facing upgrade note. |

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

Canon now owns only a small delimited runtime-file block in adopter `.gitignore` files. The shared helper handles insertion/replacement without touching adopter content outside the block, `init` handles first-install explicitly, `upgrade` routes the write through the existing safety queue, and `doctor` warns when the runtime patterns are missing.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| AC-14 test reads root `.gitignore` from the active checkout root (`process.cwd()` / `WORKTREE_ROOT`) instead of `REPO_ROOT`. | In linked worktree runs, `REPO_ROOT` intentionally resolves to the supervising checkout, not this task branch's worktree. Reading the active checkout validates the file changed by this task; in a normal checkout the paths are the same. | Preserves AC-14's self-hosting guard while making it valid under worktree isolation. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `upsertCanonBlock` is pure, anchored to marker lines, appends when absent, replaces the inclusive block when well-formed, preserves outside content, and returns `null` for unclosed start markers. |
| AC-2 | Met | `CANON_GITIGNORE_BLOCK` and `CANON_RUNTIME_GITIGNORE_PATTERNS` live in `src/lib/canon-block.ts`; init, upgrade, doctor, tests, and sync import from that module. |
| AC-3 | Met | `canon init` explicitly upserts `.gitignore` after scaffolding and warns/continues on malformed blocks. |
| AC-4 | Met | `runUpgrade` computes `.gitignore` content and enqueues it in `pending`; malformed blocks populate `malformed` and are not overridden by `--force`. |
| AC-5 | Met | `checkRuntimeFilesGitignored` passes when all patterns are present and warns with missing names / `canon upgrade` guidance otherwise. |
| AC-6 | Met | Added `templates/.gitignore`; root `.gitignore` has one canon block with each runtime pattern exactly once. |
| AC-7 | Met | Sync script imports `CANON_GITIGNORE_BLOCK` and directly compares/writes `templates/.gitignore` from the constant. |
| AC-8 | Met | `npm run sync-templates:check` passes; `.gitignore` is not part of the markdown leak scan. |
| AC-9 | Met | Added `upsertCanonBlock` unit coverage for empty, append, replace, idempotency, near-marker, malformed, and orphan-end cases. |
| AC-10 | Met | Added doctor check unit coverage for pass, absent `.gitignore`, and missing-pattern warning. |
| AC-11 | Met | Added upgrade coverage for insert, unchanged, dirty refusal, `--check`, malformed, and malformed-with-`--force`. |
| AC-12 | Met | `docs/codebase-map.md` documents the helper and init/upgrade/doctor touchpoints with the adopter-facing upgrade note. |
| AC-13 | Met | Extended sync-template fixtures and added constant-source `.gitignore` sync tests for drift, clean, and absent-template first-create. |
| AC-14 | Met | Added root `.gitignore` self-hosting guard comparing `extractCanonBlock` to `CANON_GITIGNORE_BLOCK`. |

## Edge Cases Considered

- Marker lines must be exact trimmed `# canon:start` / `# canon:end`; comments that merely mention the marker append normally.
- A start marker with no later end marker is malformed and never auto-repaired by `init` or `upgrade`, including under `--force`.
- An orphan end marker with no start marker is adopter content and is preserved above a newly appended canon block.
- `upgrade` uses the same pending queue as other managed writes, so `.gitignore` inherits dirty refusal, `--check`, `--force`, staging, and `--no-stage`.
- A dirty `.gitignore` now blocks the whole pending upgrade set unless `--force` is used, matching the existing managed-file safety model.
- `templates/.gitignore` sync is constant-sourced and does not read root `.gitignore`, avoiding delimiter-merge asymmetry.

## Blockers

- None.

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
| Linting — `npm run lint` | Pass | Final run passed. |
| Type checking — `npm run type-check` | Pass | Final run passed. |
| Unit tests — `npm test` | Pass | Final run passed: 659 pass, 1 skipped, 0 fail. |
| Build — `npm run build` | Pass | Final run passed; regenerated `dist/cli/index.js`. |
| E2E — N/A (no UI) | not_configured | Spec marks E2E N/A. |
| Docs references — `npm run docs-refs-check` | Pass | Final run passed: All refs OK. |
| Template sync — `npm run sync-templates:check` | Pass | Final run passed: All canon-managed files in sync. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>` (not independently fetched in this implement phase; orchestrator owns branch sync)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

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
