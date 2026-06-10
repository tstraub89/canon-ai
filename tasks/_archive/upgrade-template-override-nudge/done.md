# QA Summary: upgrade-template-override-nudge

## What Changed

`canon upgrade` now detects when it writes a canon task template and the project carries a customized override for that same template (the files under `<override-root>/<name>`, where `canon task new` looks first). When that happens, it prints a polite heads-up listing each stale override and a copy-pasteable `diff` command so the adopter can reconcile the two versions manually.

The nudge is purely informational: no override files are written, moved, or staged; exit codes are unchanged; the dirty-refusal path is unchanged; and `--check` (dry-run) still writes nothing.

Two edge-case behaviors worth knowing:
- **`--force` path fires the nudge**: when `--force` is passed and a dirty canon template is written, any stale override for it is listed — because the template was actually touched by the run. The no-`--force` dirty-refusal path (where the template is NOT written) correctly stays silent.
- **Byte-identical suppression**: an override whose contents already match the new canon template is quietly excluded from the list.

The override root is resolved through `taskTemplateOverrideRoot()` — the same function `canon task new` uses — so projects using `CANON_TASKS_DIR_OVERRIDE` see the nudge against their custom root, not the default `tasks/_templates/`.

## Files Changed

| File | Change |
|---|---|
| `src/cli/commands/upgrade.ts` | Added `staleOverrides: string[]` to `UpgradeResult`; `getStaleOverrides(changedOps)` helper computes the list from the run's actually-written (or would-write) ops; computation placed after the dirty-refusal branch so refusal paths always return `[]`; `printStaleOverrideNudge()` helper prints the section; both branches of `upgradeCmd()` call it. |
| `src/task/index.ts` | Exported `taskTemplateOverrideRoot()` so `upgrade.ts` resolves the override root through the same source of truth `canon task new` already uses. Export-only change — no behavior change to the task module. |
| `tests/cli.test.ts` | Added 14 new test cases covering: CANON_OWNED basename drift guard (AC-2), positive case (AC-3), unchanged-template suppression (AC-4), byte-identical suppression (AC-5), `--check` parity (AC-6), dirty-refusal no-nudge (AC-7), exit-behavior preservation (AC-8), printed output (AC-9), no-overrides / stray files (AC-10), `CANON_TASKS_DIR_OVERRIDE` resolution (AC-12), `--force` dirty-write (AC-13), and mixed dirty-refusal returns empty (AC-14). |
| `.canon/README.md` | Updated post-upgrade override-reconciliation guidance to describe the automatic heads-up while preserving the manual `diff` reconciliation step. |
| `templates/.canon/README.md` | Synced mirror (pre-commit hook regenerated from root). |
| `dist/cli/index.js` | Rebuilt by `npm run build` after the source changes. |

## How to Test

Follow the Human Test Plan from the spec:

1. In a canon-enabled repo, copy one of the canon task templates (e.g. `.canon/templates/spec.md`) to your project's override folder (tasks/_templates/spec.md) and tweak its content so it differs from canon's version.
2. Run `canon upgrade` in a state where canon's own copy of that template has changed (i.e., a new canon version with an updated template). This simulates a normal upgrade.
3. **Expected**: the upgrade completes normally (files updated and staged, exit code 0), and the output now includes a heads-up section naming your customized override and showing a `diff .canon/templates/spec.md tasks/_templates/spec.md` command. Your override file is untouched.
4. Run the upgrade again when the template hasn't changed (or when your override already matches the new canon version).
5. **Expected**: no heads-up — nudge stays silent when the template wasn't touched or when the override is already in sync.
6. Run `canon upgrade --check` with a diverged override in place.
7. **Expected**: the same heads-up appears in the preview; no files are written.
8. (Optional, power-user path) Stage a local modification to `.canon/templates/spec.md`, place a differing tasks/_templates/spec.md override, and run `canon upgrade --force`.
9. **Expected**: the canon template is force-written and the override is listed in the nudge.

## Test Results

All validation checks passed on iteration 3 (final — post-AC-14 fix):

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (800 tests, 1 unrelated skip) | Pass |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |

Code review ran 3 rounds: round 1 returned `spec_gap` on the `--force` path (resolved by spec amendment adding AC-13); round 2 returned `changes_requested` for the missing AC-13 implementation and AC-9 wording violation (both fixed in iteration 2); round 3 returned `approved_with_nits` — three optional nits that were addressed in iteration 3 (stale block comment, `getStaleOverrides` param renamed `clean`→`changedOps`, dead-code `|| overridePathAbs` removed). A Codex PR-level review after approval also caught the AC-14 mixed dirty-refusal gap (resolved in iteration 3 via Amendment Round 2).

## Human Verification Required

None.

## Decisions Made

- **`--force` + dirty template fires the nudge** (spec amendment, AC-13): the power-user scenario most likely to have in-flight customizations is exactly when silence would be most harmful. The "no change to upgrade write behavior" Non-Goal still holds — nudge behavior is separate from write behavior.
- **Changed-set definition**: "changed set" = what was actually written (`upgraded` in apply mode, `wouldUpgrade` in `--check`) — not a separate notion. Under `--force`: `pending` (all ops including dirty); under `--check`: `clean` (dry run never forces). This keeps `staleOverrides` in lockstep with what `upgradeCmd` reports as upgraded.
- **Dirty-refusal path always returns empty `staleOverrides`** (spec amendment, AC-14): computing the nudge before the dirty-refusal early return could produce non-empty `staleOverrides` on a path where nothing was written. Fixed by computing `staleOverrides` after the refusal branch, so the contract "in `staleOverrides` iff in `upgraded`/`wouldUpgrade`" holds at every return point.

## Open Questions

None.

## Proposed Changelog

**Proposed version**: no change to 1.11.0 (unreleased) — this is a new feature addition to the already-open release branch.

**Proposed entry** (under `### Added` in the `[1.11.0]` block):

> **`canon upgrade` now nudges you when a changed canon task template has a customized project override.** When an upgrade touches a `.canon/templates/<name>` that your project has overridden under `tasks/_templates/<name>` (or your `CANON_TASKS_DIR_OVERRIDE` equivalent), a heads-up section lists each affected override and a copy-pasteable `diff` command for manual reconciliation. The nudge fires in both apply and `--check` modes; it is silent when the template was not changed by the run or when the override is already byte-identical to the new template. Override files are never written or staged.

Rationale: new user-facing capability added to an existing command → minor; already accumulating in 1.11.0.
