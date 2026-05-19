# Done: claude-min-version — Require Claude Code ≥ 2.1.72 in doctor

## What Changed

`canon doctor` now checks the installed Claude Code version and fails fast if it is below 2.1.72 — the verified-safe minimum for the `--effort` flag that the orchestrator passes to every Claude spawn. Before this change, users on older Claude Code installs hit a hard exit with no diagnostic pointing at the version mismatch (reproduced by James on Claude Code 2.1.34, issue #70).

As defense-in-depth for users who skip `canon doctor`, the orchestrator's Claude spawn paths now detect the specific "unknown option --effort" error pattern and print a one-line hint before propagating the exit.

## Files Changed

| File | What |
|---|---|
| `src/cli/commands/doctor.ts` | New `MIN_CLAUDE_VERSION` constant, `parseClaudeVersion()` pure helper, and `checkClaudeVersion()` check wired into `envChecks` after the existing claude binary check. |
| `scripts/run-task/agents/claude.ts` | Added `--effort` unknown-flag regex; both interactive and streaming spawn paths print the hint on match. Interactive path uses a bespoke `spawn()` wrapper to capture stderr for inspection after the fact. |
| `tests/cli.test.ts` | Ten new unit tests covering `parseClaudeVersion` (suffix/bare/empty/non-semver) and `checkClaudeVersion` (pass at 2.1.143, 2.1.72, 3.0.0; fail at 2.1.71, 2.1.34; warn on unparseable). |
| `README.md` | Prerequisites bullet updated to `Claude Code (≥ 2.1.72)`. |
| `CHANGELOG.md` | New `## [1.1.4] — unreleased` block with a `### Fixed` entry for issue #70. |
| `dist/cli/index.js`, `dist/scripts/run-task.js` | Regenerated build output. |

## How to Test

1. Install the branch locally: `npm install -g --install-links git+file:///path/to/canon-ai-dev-worktrees/claude-min-version`
2. Run `canon doctor` in any project. Confirm a `✓ claude <version>` line appears in the **Environment** section immediately after the `claude` binary check.
3. Stub an older version to verify the failure path:
   ```bash
   SHIM_DIR=$(mktemp -d)
   printf '#!/bin/sh\necho "2.1.34 (Claude Code)"\n' > "$SHIM_DIR/claude"
   chmod +x "$SHIM_DIR/claude"
   PATH="$SHIM_DIR:$PATH" canon doctor
   ```
   Expected: `✗ claude 2.1.34 — Claude Code 2.1.72+ required — npm install -g @anthropic-ai/claude-code` and a failure in the doctor summary.
4. Check the README Prerequisites section shows `(≥ 2.1.72)`.
5. Check CHANGELOG.md for the `### Fixed` entry referencing issue #70 under the `## [1.1.4] — unreleased` block.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (including 10 new unit tests) | Pass |
| `npm run build` | Pass |
| E2E | N/A — no UI surface |

One sandbox-only test was skipped by the harness — unrelated to this task.

## Decisions Made

- **Check wired conditionally, not unconditionally**: `checkClaudeVersion()` is pushed onto `envChecks` only when the `claude` binary is already confirmed available, so it never races with the `checkBinary('claude', ...)` check and doesn't double-report a missing-binary.
- **Bespoke spawn wrapper for interactive path**: `runCommandOrDie()` inherits stderr directly with no hook to inspect the failure text after the fact. A custom `spawn()` wrapper captures stderr while still streaming it live — `runCommandOrDie()` was not modified because its inherited-stderr behavior is correct for every other use.
- **Doctor check is the gate; AC-6 hint is fallback**: per spec, the runtime hint is defense-in-depth only. Users who see the hint skipped `canon doctor`; the hint redirects them back to it.

## Open Questions

None. All ACs met, no deferred items.

---

## Proposed Changelog

**Version bump**: `1.1.3 → 1.1.4` (patch — bug fix; no new API surface or behavior change for users on compliant installs)

The `## [1.1.4] — unreleased` block with the `### Fixed` entry is already committed as part of this task. The entry reads:

> **Claude Code installs older than 2.1.72 no longer crash canon's `--effort` spawns.** `canon doctor` now checks the installed Claude Code version and fails fast below the verified-safe floor, which blocks the orchestrator from handing an unsupported CLI the `--effort` flag that it does not understand. As a fallback for users who skip `canon doctor`, Claude spawn failures that mention the unknown `--effort` option now print a one-line hint directing them back to `canon doctor` and the upgrade command. Closes [#70](https://github.com/tstraub89/canon-ai/issues/70).

This is user-facing (anyone on an older Claude Code install hits this crash; the fix makes canon recoverable instead of opaquely broken). Patch scope is correct.
