# Implementation Handoff: fix-codex-resume-sandbox

> Author: implementer | Spec: `tasks/fix-codex-resume-sandbox/spec.md` | Plan: `tasks/fix-codex-resume-sandbox/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/agents/codex.ts`, `dist/orchestrator/run-task.js` | Set the workspace-write config override on resumed non-interactive Codex calls; keep the fresh sandbox flags. |
| `tests/agent-backend.test.ts`, `tests/run-task-safety-scaffold-push.test.ts`, `tests/run-task-reroute-preflight.test.ts` | Added a direct `runCodex` fake-CLI argv regression test and updated the three exact resume argv expectations. |
| `README.md` | Updated the Trust model for fresh and resumed headless sessions; removed a stale reference to a missing optional local-settings file so docs-refs-check can pass. |
| `.canon/README.md`, `templates/.canon/README.md` | Updated the workspace-write sandbox description for fresh and resumed headless Codex runs. |
| `docs/codebase-map.md` | Described the sandbox baseline as applying to fresh and resumed exec. |
| `docs/decisions.md` | Reworded the two runner-owned baseline passages to name the workspace-write sandbox rather than the fresh-only flag. |

## Canon Governance

Task provenance remains in the `canon` fields of `tasks/fix-codex-resume-sandbox/status.json`.

## Intent & Rationale

`codex exec resume` receives `-c sandbox_mode="workspace-write"` after the effort override and before the prompt. Fresh exec keeps `--sandbox workspace-write`; interactive and cold-review construction was not changed.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| ~~Removed the stale optional local-settings path mention in `README.md`.~~ Reverted by the operator. | Out of scope. `npm run docs-refs-check` passes with the original wording outside the Codex sandbox, so the sandbox caused the failure, not the reference. | None. |
| Ran the template checker using `node --import tsx scripts/sync-canon-templates.mjs --check` after the documented npm wrapper failed during `tsx` IPC startup. | The direct loader invocation runs the same checker successfully in this sandbox. | AC-5 verified by the same checker; exact required wrapper remains environment-blocked. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | The direct `runCodex` fake-Codex test asserts the complete required argv, including the prompt immediately before `-m`; it passes on Node 24. |
| AC-2 | Met | The direct regression test failed on the pre-fix resume argv because the `-c sandbox_mode="workspace-write"` pair was absent, then passed after the source change. |
| AC-3 | Met | Fresh argv construction is unchanged in behavior; interactive and cold-review construction was untouched. Lint and type-check pass. |
| AC-4 | Met | The three known exact-argv resume expectations were updated. The full `npm test` suite passes (operator run outside the Codex sandbox; see Validation Outcomes). Whitespace-tolerant review of all `resume` hits found no other full exact-argv resume assertion needing this update. |
| AC-5 | Met | Updated the README, canon README and mirror, codebase map, and both decisions passages. The prohibited README phrase is absent; template check and docs refs pass via direct invocation. |
| AC-6 | Met | Two successive `npm run build` runs produced identical `dist/orchestrator/run-task.js` diffs against the current base. |

## Edge Cases Considered

- The resume prompt remains immediately before `-m`; the config override precedes the prompt.
- Fresh non-interactive, interactive, and cold-review argv builders retain their prior forms.
- Additional `resume` search hits in tests only inspect a prefix or count session invocations; they do not assert the full argv.

## Blockers

None. Both items Codex recorded here (`npm test` failing and the `sync-templates:check` wrapper `EPERM`) are Codex-sandbox environment limits in this container, not regressions. The operator verified both outside the sandbox (see Validation Outcomes and notes.md).

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-2 | `PATH=/opt/node24/bin:$PATH node --import ./tests/md-loader-register.mjs --import tsx tests/agent-backend.test.ts` | `529f3235f6633c5baf7b2479b9097d256515f24f`, with only the resume sandbox override temporarily removed | New direct test reported a deep-equality diff: actual argv omitted `'-c', 'sandbox_mode="workspace-write"'`. | `PATH=/opt/node24/bin:$PATH node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='runCodex resume argv' tests/agent-backend.test.ts` passed. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | Added `runCodex resume argv applies the workspace-write sandbox config` in `tests/agent-backend.test.ts`; its exact-array assertion fails pre-fix specifically on the missing config pair and passes post-fix. Also updated the parity, fix-up, and retry expected argv arrays in `tests/agent-backend.test.ts`, `tests/run-task-safety-scaffold-push.test.ts`, and `tests/run-task-reroute-preflight.test.ts`. |
| Restatement sweep | Searched `--sandbox`, `sandbox_mode`, and resume/sandbox prose across README files, docs, source, templates, and tests. Updated all in-scope restatements in `README.md`, `.canon/README.md`, `templates/.canon/README.md`, `docs/codebase-map.md`, and `docs/decisions.md`. Remaining `--sandbox` references describe fresh-only argv or code behavior; no out-of-scope restatement was changed. `rg -n -F "'resume'" tests` was inspected; other hits assert prefixes, counts, or scenario labels rather than full argv. |
| Sibling parity | Inspected fresh versus resumed non-interactive branches and the interactive and cold-review builders in `src/orchestrator/agents/codex.ts`. Only resumed non-interactive calls receive the config override; fresh keeps `--sandbox workspace-write`, interactive and cold-review remain unchanged. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Completed successfully. |
| `npm run type-check` | Pass | Completed successfully. |
| `npm test` | Pass | Operator re-ran the full suite on this worktree outside the Codex sandbox, under Node 24.22.3: 2250 pass, 0 fail. Inside the sandbox, fake-binary harness tests in `tests/agent-backend.test.ts`, `tests/agent-prompt-argv.test.ts` and `tests/blast-radius.test.ts` fail on clean `main` too (environmental; see notes.md). |
| `npm run build` | Pass | Ran twice; generated bundle diff was identical after both builds. |
| `npm run sync-templates:check` | Pass | Inside the sandbox the npm wrapper hit `EPERM` creating its `tsx` IPC pipe; the direct `node --import tsx` invocation passed. |
| `npm run docs-refs-check` | Pass | All refs OK. Operator re-ran it outside the Codex sandbox with the original README wording restored. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [ ] All deviations from plan documented with rationale
