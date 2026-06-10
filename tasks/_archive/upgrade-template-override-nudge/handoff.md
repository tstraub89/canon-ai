# Implementation Handoff: upgrade-template-override-nudge

> Author: Codex | Spec: `tasks/upgrade-template-override-nudge/spec.md` | Plan: `tasks/upgrade-template-override-nudge/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `src/cli/commands/upgrade.ts` | Added `staleOverrides` to `UpgradeResult`, computed it from the clean pending writes using the shared `taskTemplateOverrideRoot()` resolver, and printed the new heads-up section in both apply and `--check` modes. |
| `src/task/index.ts` | Exported `taskTemplateOverrideRoot()` so `upgrade.ts` resolves the override root through the same source of truth `canon task new` already uses. |
| `tests/cli.test.ts` | Added coverage for the CANON_OWNED basename drift guard, positive/negative/suppression cases, `--check` parity, dirty-refusal suppression, missing/stray override roots, `CANON_TASKS_DIR_OVERRIDE` resolution, and the printed nudge text. |
| `.canon/README.md` | Updated the adopter-facing guidance to describe the automatic override heads-up while preserving the manual `diff` reconciliation step. |
| `templates/.canon/README.md` | Regenerated the mirror from the root README through the sync script. |
| `dist/cli/index.js` | Rebuilt the bundled CLI artifact after the source change so the committed dist output matches `npm run build`. |
| `tasks/upgrade-template-override-nudge/status.json` | Advanced the task phase to `implement: done` with `canon task phase upgrade-template-override-nudge implement done`. |

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

This mirrors the existing `cutoverWarnings` pattern instead of inventing a parallel reporting path. `runUpgrade()` now computes a second informational list from the same pending-write pass, keyed off the actual canon template changes in the run, and `upgradeCmd()` prints it without changing write/refusal/exit behavior. The resolver comes from `src/task/index.ts` so the nudge follows the same override-root semantics as `canon task new`, including `CANON_TASKS_DIR_OVERRIDE`.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Exported `printStaleOverrideNudge()` from `src/cli/commands/upgrade.ts` | The output formatter needed direct unit-test coverage without a brittle subprocess harness. The helper stays side-effect-only and does not change behavior. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `UpgradeResult` gains `staleOverrides: string[]` and every `runUpgrade()` return populates it | Met | `src/cli/commands/upgrade.ts:152-169`, `src/cli/commands/upgrade.ts:377-400`; covered by `tests/cli.test.ts:1085-1104`, `tests/cli.test.ts:1151-1170`, and `tests/cli.test.ts:1174-1196`. |
| AC-2: the checked basename set equals the `CANON_OWNED` task-template basenames | Met | `src/cli/commands/upgrade.ts:121-149`; drift-guard test at `tests/cli.test.ts:1074-1083`. |
| AC-3: differing overrides under the resolved override root are listed when the template changes this run | Met | `src/cli/commands/upgrade.ts:127-149`, `src/cli/commands/upgrade.ts:371-375`; positive test at `tests/cli.test.ts:1085-1104`. |
| AC-4: unchanged canon templates do not nudge differing overrides | Met | `src/cli/commands/upgrade.ts:371-375`; test at `tests/cli.test.ts:1108-1128`. |
| AC-5: byte-identical overrides are suppressed | Met | `src/cli/commands/upgrade.ts:140-146`; test at `tests/cli.test.ts:1130-1149`. |
| AC-6: `--check` computes from `wouldUpgrade` and preserves dry-run semantics | Met | `src/cli/commands/upgrade.ts:377-381`, `src/cli/commands/upgrade.ts:423-463`; test at `tests/cli.test.ts:1151-1172`. |
| AC-7: dirty-refusal does not surface a nudge when the canon template itself is dirty | Met | `src/cli/commands/upgrade.ts:364-389`; test at `tests/cli.test.ts:1174-1199`. |
| AC-8: the new field is informational only and does not change exit behavior | Met | `src/cli/commands/upgrade.ts:416-480`; apply-mode coverage at `tests/cli.test.ts:1085-1104`, dirty-refusal exit-2 coverage remains in the existing upgrade tests. |
| AC-9: the output helper prints the reminder and copy-pasteable diff commands | Met | `src/cli/commands/upgrade.ts:107-117`, `src/cli/commands/upgrade.ts:430-435`, `src/cli/commands/upgrade.ts:492-500`; direct output test at `tests/cli.test.ts:1271-1290`. |
| AC-10: missing roots and stray files under the root are ignored without throwing | Met | `src/cli/commands/upgrade.ts:127-149`; tests at `tests/cli.test.ts:1201-1233`. |
| AC-11: `.canon/README.md` now reflects the automatic heads-up and the mirror stayed in sync | Met | `.canon/README.md:20-27`, `templates/.canon/README.md:20-27`; verified by `npm run sync-templates:check`. |
| AC-12: the nudge resolves the override root through `taskTemplateOverrideRoot()` and honors `CANON_TASKS_DIR_OVERRIDE` | Met | `src/task/index.ts:81-83`, `src/cli/commands/upgrade.ts:127-146`; override-root test at `tests/cli.test.ts:1235-1269`. |

## Edge Cases Considered

- `runUpgrade()` only compares overrides for clean pending writes, so a dirty canon template path does not produce a stale-override nudge on the refusal path.
- The override root is resolved through `taskTemplateOverrideRoot()` and then normalized with `path.resolve(cwd, ...)`, so an absolute `CANON_TASKS_DIR_OVERRIDE` is honored verbatim.
- Missing override roots and stray non-template files under `tasks/_templates/` are ignored instead of throwing.
- Overrides identical to the new canon template bytes are intentionally suppressed to avoid noisy upgrade output.

## Blockers

- none

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
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added" | Pass | Full suite passed (`800` tests, `1` skip from an unrelated sandboxed fixture). |
| `npm run build` — `upgrade.ts` change affects `dist/cli/index.js`; committed `dist/` must match a fresh build (CI `git diff --exit-code -- dist/`) | Pass | `tsup` rebuilt the CLI bundle and normalized `1` file in `dist/`; only `dist/cli/index.js` changed in the worktree. |
| `npm run sync-templates:check` — `.canon/README.md` is a canon-managed root/template pair; the mirror must stay aligned | Pass | Mirror and root README were in sync after regeneration. |
| `npm run docs-refs-check` — `.canon/README.md` and task artifacts touched | Pass | No broken refs. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

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

| File | What Changed |
|---|---|
| `src/cli/commands/upgrade.ts` | Changed the stale-override changed-set source so `--force` dirty writes are included in the nudge, and corrected the reminder header wording to say canon templates changed by this upgrade have customized overrides that were not auto-updated. |
| `tests/cli.test.ts` | Added an AC-13 force-write test and tightened the output assertions to match the corrected header wording. |
| `dist/cli/index.js` | Rebuilt after the source and test updates. |
| `tasks/upgrade-template-override-nudge/status.json` | Phase metadata updated as part of the revision cycle. |

### Findings addressed

- _code-bug:_ AC-13 force-path omission → fixed by reporting `options.force ? pending : clean` to `getStaleOverrides()` so dirty templates written under `--force` nudge stale overrides too; covered by the new force-path test.
- _code-bug:_ AC-9 wording implied the overrides were updated → fixed by rewriting the reminder header to say the canon templates changed by this upgrade have customized overrides that were not auto-updated; the output test now pins the exact header text.

### AC deltas

- AC-9: was Partial/Not Met → now Met (`src/cli/commands/upgrade.ts:107-117`, `tests/cli.test.ts:1271-1290`)
- AC-13: new in the amended spec → Met (`src/cli/commands/upgrade.ts:371-377`, `tests/cli.test.ts:1174-1199`)

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly after the wording + force-path changes. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full test run passed, including the new AC-13 force-write case and the corrected header assertions. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` after the source change. |

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `src/cli/commands/upgrade.ts` | Moved stale-override detection behind the dirty-refusal early return so refusal paths return `staleOverrides: []`, renamed the helper parameter to `changedOps`, and dropped the unreachable `relative(...) || overridePathAbs` fallback. |
| `tests/cli.test.ts` | Added a mixed dirty-refusal regression test that proves a clean would-change template does not leak a stale-override nudge when another managed file makes the run refuse. |
| `dist/cli/index.js` | Rebuilt after the source change. |
| `tasks/upgrade-template-override-nudge/status.json` | Advanced the task state back through `canon task phase upgrade-template-override-nudge implement done` after the reroute fix. |
| `docs/pipeline-invocations.md` | Auto-appended telemetry from the reroute validation and phase-close runs. |

### Findings addressed

- _code-bug:_ AC-14 dirty-refusal mixed-case leak → fixed by returning `staleOverrides: []` on the no-`--force` refusal path instead of deriving the nudge from `clean[]` before the early return.
- _optional cleanup/nit:_ helper parameter name still said `clean` even when `--force` could pass dirty writes → renamed to `changedOps` so the contract matches the data.
- _optional cleanup/nit:_ dead-code fallback `relative(...) || overridePathAbs` → removed because `relative()` already returns a path string for files under `cwd`.

### AC deltas

- AC-14: new in the amended spec → Met (`src/cli/commands/upgrade.ts:368-385`, `tests/cli.test.ts:1198-1231`)

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after the refusal-path refactor. |
| `npm run type-check` | Pass | Clean after the helper rename and return-shape change. |
| `npm test` | Pass | Full suite passed, including the new mixed dirty-refusal regression. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` after the source change. |
| `npm run docs-refs-check` | Pass | Handoff refs still resolve after the new iteration block was appended. |
