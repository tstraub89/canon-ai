# Implementation Plan: fix-codex-resume-sandbox

> Written by: Claude | Implements: `tasks/fix-codex-resume-sandbox/spec.md`

## Approach

Add one config override to the resume branch of `runCodex`, update the three exact-argv resume assertions, correct the docs that describe the sandbox as fresh-only, and rebuild `dist/`.

Feasibility check:
- **Exists:** `runCodex` and its `sandboxFlags` constant are in `src/orchestrator/agents/codex.ts` (resume and fresh argv around lines 79-82). The three resume assertions are at `tests/agent-backend.test.ts:66`, `tests/run-task-safety-scaffold-push.test.ts:535-538` and `tests/run-task-reroute-preflight.test.ts:2152-2162`. The doc passages are `README.md:312`, `.canon/README.md:33` (and the same line in its mirror), `docs/codebase-map.md:186`, and `docs/decisions.md:328` and `:336`.
- **Real path:** every Codex resume (implement revision or resume, handoff fix-up, guardrail retry, spec_review re-review) goes through `runCodex` → `streamProcess('codex', args, { cwd })`. There is no second builder for the resume argv.
- **Callers:** `runCodex`'s signature and error contract don't change. Only the argv content changes, so no caller needs an update.
- **Tests that can fail:** the parity test in `tests/agent-backend.test.ts` calls the backend with a `resumeId` against a fake `codex` that logs argv. With the new expected array, it fails on the pre-fix code because the `-c sandbox_mode="workspace-write"` pair is missing. That is the red-first run.
- **Predicates:** the only condition is `resumeId` truthy versus falsy, already used to pick the branch. No new boundary values.
- **Scope:** every file below is in the spec's Affected Files.
- **Async/stateful:** N/A.

## Steps

### Step 1: Red-first test update

Files: `tests/agent-backend.test.ts`

Change the resume expected array on line 66 to `['exec','resume',resumeId,'--json','-c','model_reasoning_effort='+cfg.effort,'-c','sandbox_mode="workspace-write"',effective,'-m',cfg.model]`. Leave the fresh line (67) alone. Run the file on its own (`node --test --import ./tests/md-loader-register.mjs --import tsx tests/agent-backend.test.ts`) and confirm it fails because the pair is missing. Record that red run in the handoff.

### Step 2: Fix the resume argv

Files: `src/orchestrator/agents/codex.ts`

In the resume branch, insert `'-c', 'sandbox_mode="workspace-write"'` right after `...effortFlag` and before `effectivePrompt`, so the prompt stays immediately before `-m`. Keep `--sandbox workspace-write` on the fresh branch. Rename `sandboxFlags` or inline it into the fresh branch, since it is now fresh-only. Add a short source comment explaining that `codex exec resume` has no `--sandbox`, so the mode goes through `-c`. Re-run Step 1's test and confirm it passes.

### Step 3: Update the other resume exact-argv assertions

Files: `tests/run-task-safety-scaffold-push.test.ts`, `tests/run-task-reroute-preflight.test.ts`

Insert `'-c', 'sandbox_mode="workspace-write"'` after the `model_reasoning_effort` entry in each expected array. Then run `grep -rn "'resume'" tests/` and check that no other hit asserts a full resume argv.

### Step 4: Docs

Files: `README.md`, `.canon/README.md`, `templates/.canon/README.md`, `docs/codebase-map.md`, `docs/decisions.md`

Describe the sandbox by mode, not by flag name:
- **README "Trust model" bullet:** headless Codex runs, fresh or resumed, use the workspace-write sandbox. Fresh runs pass `--sandbox workspace-write`; resumes pass the same mode as a config override, because `codex exec resume` has no `--sandbox` flag. Keep the cold-review lens and interactive sessions as the exceptions.
- **`.canon/README.md`:** edit the root copy, then run `npm run sync-templates` to update the mirror.
- **codebase-map row:** say the baseline applies to fresh and resumed exec.
- **decisions.md lines 328 and 336:** replace the parenthetical `--sandbox workspace-write` with mode-level wording, for example "the `workspace-write` sandbox".

### Step 5: Build and validate

Run `npm run build` and commit the rebuilt `dist/orchestrator/run-task.js`. Then run `npm run lint`, `npm run type-check`, `npm test`, `npm run sync-templates:check` and `npm run docs-refs-check`.

## Testing Plan

- **Unit:** the parity test in `tests/agent-backend.test.ts` is the red-first regression. The other two resume exact-argv tests are updated, and the fresh, interactive and cold-review argv tests pass unchanged.
- **E2E:** N/A.
- **Manual:** the spec's Problem records the live repro of the bug and the fix against codex-cli 0.172.0.

## Rollback Plan

Revert the commit. Resumed runs then go back to inheriting the operator's sandbox settings. No data or state migration is involved.
