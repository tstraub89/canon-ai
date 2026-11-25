# Completion Summary: fix-codex-resume-sandbox — Resumed Codex sessions keep the workspace-write sandbox

> For the human. This is what you need to know.

## What Changed

In mixed mode, canon resumes an earlier Codex session for revisions after a review asks for changes, pre-flight retries, handoff fix-ups, and guardrail retries. Those resumed runs were dropping the write sandbox that fresh runs get. When the operator's Codex settings had no sandbox mode and the project was not marked trusted, Codex fell back to read-only. The implementer then could not write, and the same rejection repeated until the review loop auto-blocked the task. Resumed non-interactive runs now pass the same workspace-write sandbox as fresh runs. Fresh runs, the interactive Codex session and the cold-review lens are unchanged. The README, the canon README and its template mirror, the codebase map and the decisions doc now describe the sandbox by mode, so they no longer say resumes are unsandboxed.

## Files Changed

- `src/orchestrator/agents/codex.ts` — adds the `-c sandbox_mode="workspace-write"` override to the resume argv, placed after the effort flag and before the prompt.
- `dist/orchestrator/run-task.js` — rebuilt bundle; matches a fresh `npm run build`.
- `tests/agent-backend.test.ts` — new direct `runCodex` test against a fake `codex` that logs argv (the regression test), plus the parity resume expectation.
- `tests/run-task-safety-scaffold-push.test.ts` — implement fix-up resume argv expectation updated.
- `tests/run-task-reroute-preflight.test.ts` — guardrail-retry resume argv expectation updated.
- `README.md` — "Trust model" bullet: headless Codex runs, fresh or resumed, use the workspace-write sandbox; the interactive session and the cold-review lens remain the exceptions.
- `.canon/README.md`, `templates/.canon/README.md` — same sandbox sentence, kept in sync with the mirror.
- `docs/codebase-map.md` — "Codex sandbox baseline" row covers fresh and resumed exec.
- `docs/decisions.md` — the two runner-owned baseline passages name the workspace-write sandbox rather than the fresh-only flag.

## How to Test

1. On a machine where your Codex configuration has no sandbox setting and the project is not marked trusted, run a task until code review asks for changes.
2. Let the pipeline send the work back to the implementer.
3. Expected: the revision pass edits files and finishes with no "read-only" errors, and the task moves on to the next review instead of blocking.

## Test Results

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass |
| Type-check (`npm run type-check`) | Pass |
| Unit tests (`npm test`) | Pass — the operator re-ran the full suite outside the Codex sandbox under Node 24.22.3: 2250 pass, 0 fail. Inside the sandbox, three fake-binary suites fail on clean `main` too (see Follow-ups). |
| Red-first regression (AC-2) | Pass — the new `runCodex` resume argv test failed on the pre-fix argv (the `-c` pair was missing) and passed after the fix. |
| Build (`npm run build`) | Pass — run twice; the `dist/` diff was identical both times. |
| Template sync (`npm run sync-templates:check`) | Pass via the direct form `node --import tsx scripts/sync-canon-templates.mjs --check`. The npm wrapper itself failed in the sandbox (`EPERM` creating the `tsx` IPC pipe) and was not run to completion. |
| Docs refs (`npm run docs-refs-check`) | Pass — the operator re-ran it outside the sandbox with the original README wording restored. |

## Human Verification Required

None.

Pre-merge checklist. These items cannot be confirmed yet, so they are listed for the human:

- [ ] Version correct — not decided at QA; the release step sets the version.
  Acknowledged: version is set at release cut, not per task.
- [ ] Changelog updated if needed — the draft is in Proposed Changelog; the release step lands it.
  Acknowledged: CHANGELOG is written at release cut from the Proposed Changelog draft.
- [x] PR body current — drafted in `tasks/fix-codex-resume-sandbox/pr-body.md`.
- [x] Final CI/CD checks green — all 8 checks on PR #195 passed.
- [x] Final diff matches spec intent — code review approved with nits; operator reviewed the final diff against the spec.

## Proposed Changelog

- **Resumed Codex sessions keep the workspace-write sandbox.** In mixed mode, a revision, pre-flight retry, or handoff fix-up on a resumed Codex session could run read-only when your Codex config set no sandbox mode and the project was not trusted. The implementer then could not write, and the task auto-blocked at the review-loop cap. Resumed headless runs now use the same workspace-write sandbox as fresh runs.

## Judgment Calls to Confirm

- Override value form — quoted TOML string `sandbox_mode="workspace-write"`; alternative: unquoted `sandbox_mode=workspace-write`, matching the `model_reasoning_effort` style and relying on Codex's raw-string fallback.
- Fresh-path flag — keep `--sandbox workspace-write` on fresh runs; alternative: switch fresh runs to the same `-c` override for symmetry.
- Resume working directory — no change; rely on the spawn cwd and the session's stored root; alternative: add an explicit cwd override on resume (`codex exec resume` has no `-C`).

## Decisions Made

- Restored the README wording the implementer had changed to clear a sandbox-only `docs-refs-check` failure. The operator reverted that edit as out of scope; the README change is limited to the Trust model bullet.
- The sync check ran through `node --import tsx scripts/sync-canon-templates.mjs --check` because the npm wrapper hit `EPERM` in the sandbox. The result is the same checker's output.
- The resume regression is a direct `runCodex` test against a fake `codex` that logs argv, placed in `tests/agent-backend.test.ts`. It asserts the full array, so no duplicate test was added.

## Open Questions

- Operators whose `~/.codex/config.toml` sets a stricter `sandbox_mode` (for example `read-only`) will now get `workspace-write` on resumed runs, as they already did on fresh runs. The spec's Known Risks accepts this, because canon's runner flags already take precedence for canon's invocations. Confirm you accept this behavior change, or ask for a different approach.
  Resolution: accepted. `docs/decisions.md` already states canon's runner flags take precedence for canon's invocations; resumes now match fresh runs.

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| nit | The implementer's Changes table in `tasks/fix-codex-resume-sandbox/handoff.md` still lists the README stale-reference cleanup that the operator reverted. The Deviations row is the accurate record. | dropped |
| nit | The "All deviations from plan documented" box in `tasks/fix-codex-resume-sandbox/handoff.md` Ready for Review is unchecked, though the Deviations table is filled in. | dropped |
| nit | `tests/agent-backend.test.ts:31-60` mutates `process.env.PATH` in-process. It is restored in a `finally` block and is safe under the serial Node test runner. Low confidence; leave or tidy. | dropped |
| observation | The three fake-binary suites (`tests/agent-backend.test.ts`, `tests/agent-prompt-argv.test.ts`, `tests/blast-radius.test.ts`) fail inside the Codex sandbox on clean `main`, because the fake binaries return empty output. Make them sandbox-safe or document that they need an unsandboxed run. | #196 |
| observation | `npm run sync-templates:check` fails inside the Codex sandbox with `EPERM` while creating the `tsx` IPC pipe under `/tmp`. The direct `node --import tsx` form works. | #196 |
| observation | CodeRabbit on PR #195: `.canon/README.md` (and mirror) says headless Codex runs use workspace-write without naming the cold-review lens, which sets no sandbox, as an exception (the root README names it). Pre-existing: the old "fresh headless" wording also covered cold review. #196 rewrites the same sentence. | #196 |
| observation | The interactive Codex path ignores `resumeId`. This is a pre-existing quirk, excluded from this task as a Non-Goal in `tasks/fix-codex-resume-sandbox/spec.md`. | dropped |

## Quality Log

- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: The npm wrapper for sync-templates:check never ran to completion in the Codex sandbox; the direct checker form passed, and the three fake-binary suites needed an unsandboxed operator run.

## Root Cause

None.

Maintenance: lessons-learned.md plus this task’s fragment have 17 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
