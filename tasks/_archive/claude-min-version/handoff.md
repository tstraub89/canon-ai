# Implementation Handoff: claude-min-version

> Author: Codex | Spec: `tasks/claude-min-version/spec.md` | Plan: `tasks/claude-min-version/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `src/cli/commands/doctor.ts` | Added `MIN_CLAUDE_VERSION`, the pure `parseClaudeVersion()` helper, and `checkClaudeVersion()` with injectable version-command runner; wired the new check into `doctorCmd()` immediately after the existing `claude` binary check. |
| `scripts/run-task/agents/claude.ts` | Added the `--effort` unknown-flag regex and fallback hint; the streaming `-p` path now prints the hint on matching non-zero exits, and the interactive path uses a live stderr-capturing `spawn()` wrapper so it can do the same. |
| `tests/cli.test.ts` | Added unit coverage for version parsing and `checkClaudeVersion()` across the documented pass/fail/warn boundaries, including the exact minimum and a future major release. |
| `README.md` | Tightened the Claude Code prerequisite to `≥ 2.1.72`. |
| `CHANGELOG.md` | Added the unreleased `1.1.4` block with the `### Fixed` note for issue #70. |
| `dist/cli/index.js` | Regenerated build output after the source changes. |
| `dist/scripts/run-task.js` | Regenerated build output after the source changes. |

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

The doctor gate is the primary fix: it fails fast on Claude Code versions older than the verified-safe `2.1.72` floor, which stops canon from handing `--effort` to a CLI that does not support it. The runtime hint in `scripts/run-task/agents/claude.ts` is defense-in-depth for users who skip `canon doctor`; it only fires when the stderr text matches the unsupported-`--effort` failure mode.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Interactive Claude spawn uses a bespoke `spawn()` wrapper instead of `runCommandOrDie()` | The wrapper preserves live stderr output while still capturing the failure text needed for the fallback hint. `runCommandOrDie()` inherits stderr directly and provides no hook to inspect the unknown-`--effort` message after the fact. | None; AC-6 still holds. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `src/cli/commands/doctor.ts` exports a new function `checkClaudeVersion(): Check` that runs `claude --version`, parses the leading `X.Y.Z` triple from the output, compares against the minimum `2.1.72`, and returns a `Check`. Pass when version ≥ minimum; fail when version < minimum; warn when output is unparseable; the function does not throw on `claude` being unavailable (the existing `checkBinary('claude', ...)` already covers that case — `checkClaudeVersion` either short-circuits to a `'skip'`-style return or is conditionally pushed onto `envChecks` only when `isAvailable('claude')` returns true; implementer's choice). | Met | `checkClaudeVersion()` is exported from `src/cli/commands/doctor.ts`; `doctorCmd()` only inserts it when `claude` is already available, and the helper itself parses the leading semantic triple and compares against `MIN_CLAUDE_VERSION`. |
| AC-2: The new check is invoked from `doctorCmd()` and appears in the `Environment` section of `canon doctor`'s output immediately after the `claude` binary check. On canon-ai-dev's current install (Claude Code 2.1.143) it prints `✓ claude 2.1.143`. | Met | `envChecks` now renders `checkClaudeVersion()` immediately after `checkBinary('claude', ...)`; the test suite covers the `2.1.143` pass case and the label format matches the expected output. |
| AC-3: When the parsed version is `2.1.71` or any earlier release, `canon doctor` prints `✗ claude <version> — Claude Code 2.1.72+ required — npm install -g @anthropic-ai/claude-code` and the doctor command's exit summary reflects a failure (consistent with how other `fail` checks already render). | Met | `checkClaudeVersion()` returns `status: 'fail'` with the specified detail string for versions below the minimum; `doctorCmd()` already aggregates `fail` checks into the existing failure summary. |
| AC-4: When `claude --version` produces unparseable output (e.g., an empty string or a non-semver-shaped line), `canon doctor` prints a warn line referencing the unparseable output and instructs the user to verify their Claude install — `canon doctor` does NOT crash. | Met | `parseClaudeVersion()` returns `null` for non-semver shapes, and `checkClaudeVersion()` converts that into a warn check whose label includes the unparseable preview plus a verify-install detail. |
| AC-5: A new pure helper (e.g., `parseClaudeVersion(raw: string): { major: number; minor: number; patch: number } | null`) is exported from `doctor.ts` so unit tests can exercise the parser directly without spawning `claude`. The helper accepts the literal output Claude emits — `2.1.143 (Claude Code)` — and returns `{ major: 2, minor: 1, patch: 143 }`. It returns `null` for unparseable input. | Met | `parseClaudeVersion()` is exported and tested directly against the documented string shapes. |
| AC-6: `scripts/run-task/agents/claude.ts` is updated such that when a Claude spawn exits non-zero AND captured stderr matches `/unknown option[^\n]*--effort/i` (or whichever regex matches Claude Code's actual unknown-flag error format — verify by running a stub `claude` that prints the real error pattern; if the format varies across versions in a way that makes a single regex unreliable, drop the AC and document why in handoff), the orchestrator prints exactly one line to stderr before propagating the non-zero exit: `Claude Code is too old for canon — run \`canon doctor\` to verify (canon requires Claude Code 2.1.72+).` This applies to both the interactive path and the `-p` streaming path. The line MUST NOT be printed when the spawn fails for any other reason. | Met | The streaming path inspects `capturedStderr` on non-zero exit; the interactive path uses a live stderr-capturing spawn wrapper so it can inspect the same failure text before exit. The hint string is exact. |
| AC-7: `README.md` Prerequisites section — the `Claude Code` bullet (currently around line 79) is updated to read `**Claude Code (≥ 2.1.72)** — \`npm install -g @anthropic-ai/claude-code\``. | Met | Updated in place in the Prerequisites list. |
| AC-8: `CHANGELOG.md` has a `### Fixed` entry under the in-progress patch block (`## [1.1.4] — unreleased`, creating the block if it does not yet exist) that describes: the `--effort` crash on older Claude Code installs, the new `canon doctor` enforcement, and the friendly stderr hint as a fallback. The entry references issue #70. | Met | Added the new unreleased block at the top of `CHANGELOG.md` with the required `### Fixed` entry and issue link. |
| AC-9: New tests in `tests/cli.test.ts` for parsing and `checkClaudeVersion()` across the documented pass/fail/warn boundaries. | Met | Added parser tests for suffix / bare / empty / non-semver inputs plus version-check tests for `2.1.143`, `2.1.72`, `2.1.71`, `2.1.34`, `3.0.0`, and warn-on-unparseable output. |

## Edge Cases Considered

- Bare `2.1.72` output parses the same as `2.1.72 (Claude Code)`.
- `2.1.71` fails even though it is the closest older patch; the threshold is the verified-safe `2.1.72` floor from the spec.
- Future major releases such as `3.0.0` pass because the comparison is semantic, not string-based.
- Unparseable `claude --version` output surfaces as a warn check instead of crashing doctor.
- The runtime hint only fires when the stderr text looks like the unsupported-`--effort` failure, so unrelated Claude spawn failures stay unchanged.

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
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite passed; one sandbox-only test was skipped by the harness. |
| `npm run build` | Pass | Regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

| File | What Changed |
|---|---|
| `<path>` | ... |

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
