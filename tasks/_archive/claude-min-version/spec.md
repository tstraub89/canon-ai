# Spec: claude-min-version — Require Claude Code ≥ 2.1.72 in doctor (fixes `--effort` spawn crash)

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

canon's orchestrator unconditionally passes `--effort <level>` to every `claude` spawn (`scripts/run-task/agents/claude.ts:36` interactive path, `:58` `-p` streaming path). The `--effort` flag was introduced in Claude Code around v2.1.72 (verified via the 2.1.72 changelog). On any Claude Code release earlier than that, every Claude spawn fails immediately with an unknown-flag error — every Claude pipeline phase (spec / plan / code_review / qa) crashes before the agent receives a prompt.

The orchestrator surfaces the failure as a hard exit with no diagnostic pointing at the underlying version mismatch, so the user is left guessing. Filed as [issue #70](https://github.com/tstraub89/canon-ai/issues/70); James reproduced the crash on Claude Code 2.1.34 during a TokenAnxiety dogfood run.

## Decision

Make Claude Code ≥ 2.1.72 a hard prerequisite of canon, enforced by `canon doctor`. Specifically:

1. Add a `checkClaudeVersion()` function in `src/cli/commands/doctor.ts` that runs `claude --version`, parses the version, and returns a `fail` Check if the parsed version is below 2.1.72.
2. Wire the new check into `doctorCmd()`'s `envChecks` list, immediately after the existing `checkBinary('claude', ...)`.
3. Keep `scripts/run-task/agents/claude.ts` passing `--effort` unconditionally — the doctor check is the single gate. Runtime code trusts the gate has been run.
4. As defense-in-depth, add a stderr-pattern catch in `claude.ts`'s spawn-failure path: if a Claude spawn exits non-zero AND captured stderr mentions an unknown `--effort` option, print a one-line hint pointing the user at `canon doctor` and the upgrade command before propagating the non-zero exit. Protects users who skip `canon doctor`.
5. Update README **Prerequisites** to specify the minimum version.
6. Append a `### Fixed` entry to the in-progress CHANGELOG block for the next patch.

## Non-Goals

- **No version probe at runtime.** Considered: spawning `claude --help` once at orchestrator startup and grepping for `--effort`. Rejected: adds spawn overhead and runtime complexity for a problem better solved by a setup-time prereq check.
- **No version-detection branch in `claude.ts`.** The doctor check is the gate; the stderr-pattern catch is a fallback diagnostic only, not a runtime conditional on Claude version.
- **No change to Codex spawn paths.** Codex uses `-c model_reasoning_effort=...` (separate mechanism); the `--effort` bug is Claude-only. Confirmed in issue #70.
- **No removal of effort telemetry.** Metrics continue to record the resolved effort level for routing analysis; unchanged.
- **No new orchestrator phase or validation gate.** Tests are limited to unit coverage of the new check.
- **No backport of the friendly stderr-pattern catch to any other agent.** `claude.ts` only.

## Acceptance Criteria

- [ ] **AC-1**: `src/cli/commands/doctor.ts` exports a new function `checkClaudeVersion(): Check` that runs `claude --version`, parses the leading `X.Y.Z` triple from the output, compares against the minimum `2.1.72`, and returns a `Check`. Pass when version ≥ minimum; fail when version < minimum; warn when output is unparseable; the function does not throw on `claude` being unavailable (the existing `checkBinary('claude', ...)` already covers that case — `checkClaudeVersion` either short-circuits to a `'skip'`-style return or is conditionally pushed onto `envChecks` only when `isAvailable('claude')` returns true; implementer's choice).
- [ ] **AC-2**: The new check is invoked from `doctorCmd()` and appears in the `Environment` section of `canon doctor`'s output immediately after the `claude` binary check. On canon-ai-dev's current install (Claude Code 2.1.143) it prints `✓ claude 2.1.143`.
- [ ] **AC-3**: When the parsed version is `2.1.71` or any earlier release, `canon doctor` prints `✗ claude <version> — Claude Code 2.1.72+ required — npm install -g @anthropic-ai/claude-code` and the doctor command's exit summary reflects a failure (consistent with how other `fail` checks already render).
- [ ] **AC-4**: When `claude --version` produces unparseable output (e.g., an empty string or a non-semver-shaped line), `canon doctor` prints a warn line referencing the unparseable output and instructs the user to verify their Claude install — `canon doctor` does NOT crash.
- [ ] **AC-5**: A new pure helper (e.g., `parseClaudeVersion(raw: string): { major: number; minor: number; patch: number } | null`) is exported from `doctor.ts` so unit tests can exercise the parser directly without spawning `claude`. The helper accepts the literal output Claude emits — `2.1.143 (Claude Code)` — and returns `{ major: 2, minor: 1, patch: 143 }`. It returns `null` for unparseable input.
- [ ] **AC-6**: `scripts/run-task/agents/claude.ts` is updated such that when a Claude spawn exits non-zero AND captured stderr matches `/unknown option[^\n]*--effort/i` (or whichever regex matches Claude Code's actual unknown-flag error format — verify by running a stub `claude` that prints the real error pattern; if the format varies across versions in a way that makes a single regex unreliable, drop the AC and document why in handoff), the orchestrator prints **exactly one line** to stderr before propagating the non-zero exit:

      Claude Code is too old for canon — run `canon doctor` to verify (canon requires Claude Code 2.1.72+).

  This applies to both the interactive path (around `claude.ts:40`) and the `-p` streaming path (around `claude.ts:134-140`). The line MUST NOT be printed when the spawn fails for any other reason.
- [ ] **AC-7**: `README.md` Prerequisites section — the `Claude Code` bullet (currently around line 79) is updated to read `**Claude Code (≥ 2.1.72)** — \`npm install -g @anthropic-ai/claude-code\``.
- [ ] **AC-8**: `CHANGELOG.md` has a `### Fixed` entry under the in-progress patch block (`## [1.1.4] — unreleased`, creating the block if it does not yet exist) that describes: the `--effort` crash on older Claude Code installs, the new `canon doctor` enforcement, and the friendly stderr hint as a fallback. The entry references issue #70.
- [ ] **AC-9**: New tests in `tests/cli.test.ts`:
  - `parseClaudeVersion: parses "2.1.143 (Claude Code)" → { 2, 1, 143 }`
  - `parseClaudeVersion: parses "2.1.72" (no suffix) → { 2, 1, 72 }`
  - `parseClaudeVersion: returns null for "" (empty)`
  - `parseClaudeVersion: returns null for "Claude Code v??"` (non-semver)
  - `checkClaudeVersion: pass for 2.1.143`
  - `checkClaudeVersion: pass for 2.1.72 (exact minimum)`
  - `checkClaudeVersion: fail for 2.1.71 (one below)`
  - `checkClaudeVersion: fail for 2.1.34 (James's reported version)`
  - `checkClaudeVersion: pass for 3.0.0 (future major)`
  - `checkClaudeVersion: warn for unparseable output`

  The `checkClaudeVersion` tests must inject the version string rather than spawning real `claude`; implement via a function-pointer seam (e.g., an injectable `runVersionCmd` parameter that defaults to `execSync('claude --version').toString()`).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/doctor.ts` | Add `MIN_CLAUDE_VERSION = { major: 2, minor: 1, patch: 72 }` constant. Add pure helper `parseClaudeVersion(raw: string)`. Add `checkClaudeVersion()` Check function (with injectable runner seam for tests). Wire into `envChecks` in `doctorCmd()`. ~40 lines added. |
| `scripts/run-task/agents/claude.ts` | Add a regex constant for the unknown-option-`--effort` stderr pattern. In both spawn-failure exit points, before the non-zero `process.exit(...)`, check the pattern against captured stderr and print the one-line hint to `console.error` if matched. ~10 lines added. |
| `tests/cli.test.ts` | Add ten unit tests per AC-9 covering `parseClaudeVersion` and `checkClaudeVersion`. Add an import for the new exports. ~60 lines added. |
| `README.md` | Tighten the Claude Code prereq bullet to include `(≥ 2.1.72)`. One line. |
| `CHANGELOG.md` | Add `## [1.1.4] — unreleased` block with a `### Fixed` entry referencing issue #70. |

### Interaction Dependencies

None outside the files listed. The check joins `envChecks` alongside `checkPlatform`, `checkNodeVersion`, and `checkBinary` — it does not interact with canon setup, config, or template checks.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite passes; new tests added per AC-9
- [x] `npm run build` — `dist/` rebuilt and committed (CI verifies freshness)
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `README.md` Prerequisites bullet — addressed by AC-7.
- `CHANGELOG.md` — addressed by AC-8.

No other docs need updates. This is a one-line behavior change in `canon doctor` (new check) plus a fallback diagnostic in the orchestrator; the operational story doesn't change.

## Known Risks

1. **Stderr-pattern matching depends on Claude Code's actual error format.** Different CLI parser libraries emit different unknown-flag error strings. Implementer should reproduce the failure once (stub a `claude` shim that exits with a realistic error, or test against a real old Claude install if available) before settling on the regex. If the format is unstable across the supported version range (i.e., 2.0.x vs. 2.1.x might phrase the error differently), drop AC-6 and document the decision in handoff — the doctor check is the load-bearing guard regardless.
2. **The 2.1.72 minimum is the verified-safe floor.** Earlier minor patches in the 2.1.x line may also support `--effort` but those versions are not documented. Pinning conservatively (2.1.72) is the right tradeoff vs. shipping a less-verified minimum.
3. **Doctor is a manual check.** Users who never run `canon doctor` will still hit the failure at runtime — that's why AC-6 (the stderr hint) exists as defense-in-depth. If AC-6 is dropped per risk (1), there is no runtime fallback; the failure is just a hard exit with the original Claude error, no canon-context hint.
4. **Worktree path behavior**: this task is fast-tier (S, non-delicate) and will run with `worktree: true`. No special handling needed; the doctor surface is small enough that the worktree-isolated branch will diff cleanly against `dev`.
5. **CHANGELOG block creation order**: if no `## [1.1.4] — unreleased` block exists yet, the implementer creates it; if one exists from prior work, append to its `### Fixed` section rather than duplicating the heading.

## Human Test Plan

1. Pull the merged branch locally and install: `npm install -g --install-links git+file:///path/to/canon-ai`.
2. Run `canon doctor` in any project. Confirm a new line appears under the **Environment** section showing `claude <version>` with a `✓` (the version printed should match the locally-installed Claude Code).
3. Verify the minimum-version constraint by stubbing Claude to report an older version:
   ```bash
   SHIM_DIR=$(mktemp -d)
   printf '#!/bin/sh\necho "2.1.34 (Claude Code)"\n' > "$SHIM_DIR/claude"
   chmod +x "$SHIM_DIR/claude"
   PATH="$SHIM_DIR:$PATH" canon doctor
   ```
   Expected: the `claude 2.1.34` line shows a `✗` with the message `Claude Code 2.1.72+ required — npm install -g @anthropic-ai/claude-code`, and the summary reports a failure.
4. Read the README **Prerequisites** section and confirm the Claude Code line specifies `(≥ 2.1.72)`.
5. Read the CHANGELOG and confirm a `### Fixed` entry under the next-patch in-progress block describes the fix and links to issue #70.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry checked
