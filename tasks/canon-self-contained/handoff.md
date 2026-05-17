# Implementation Handoff: canon-self-contained

> Author: Codex | Spec: `tasks/canon-self-contained/spec.md` | Plan: `tasks/canon-self-contained/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.github/workflows/ci.yml` | Builds before tests and extends the git-install smoke through bundled orchestrator help, jq-less `canon init`, `canon doctor`, and `canon task new`. |
| `AGENTS.md` | Replaces `scripts/task.sh` task-helper docs with `canon task`. |
| `CLAUDE.md` | Updates direct orchestrator invocation from `npx tsx scripts/run-task.ts` to `canon run`. |
| `CODEX.md` | Updates implement completion command from `scripts/task.sh` to `canon task phase`. |
| `dist/cli/index.js` | Rebuilt bundled CLI with in-process task command and no jq/tsx runtime checks. |
| `dist/scripts/run-task.js` | New bundled orchestrator entry. |
| `docs/architecture.md` | Documents the bundled orchestrator, TS task helper, revised validation command bindings, and CI ordering. |
| `docs/codebase-map.md` | Points task management to `src/task/index.ts` and updates npm script/phase-addition references. |
| `docs/patterns.md` | Replaces `scripts/task.sh` references with `src/task/index.ts`/`canon task`. |
| `eslint.config.mjs` | Ignores test-only `.mjs` loader files outside the TS project. |
| `package-lock.json` | Regenerated after moving `tsx` to dev dependencies. |
| `package.json` | Shrinks package files to `dist/` and `templates/`, removes `task`/`run-task` scripts, moves `tsx` to dev dependencies, and updates the test loader. |
| `scripts/run-task/canon-snapshot.ts` | Removes standalone entry guard; used as an in-process helper. |
| `scripts/run-task/check-phase-gate.ts` | Removes tsx shebang/top-level process exit and exposes `runCheckPhaseGateCli()`. |
| `scripts/run-task/cli.ts` | Updates orchestrator help text to `canon run`. |
| `scripts/run-task/env.ts` | Removes `TASK_SH`. |
| `scripts/run-task/main.ts` | Replaces `runTaskShFor()` fallback calls with `taskPhase()`, removes direct entry guard, and drops jq from dependency checks. |
| `scripts/run-task/phases/code-review.ts` | Calls `taskPhase()` directly for code review transitions. |
| `scripts/run-task/phases/implement.ts` | Calls `taskPhase()` directly for implement transitions. |
| `scripts/run-task/phases/plan.ts` | Calls `taskPhase()` directly for plan transitions. |
| `scripts/run-task/phases/qa.ts` | Calls `taskPhase()` directly for qa transitions. |
| `scripts/run-task/phases/spec-review.ts` | Calls `taskPhase()` directly for spec review transitions and updates `canon run` messaging. |
| `scripts/run-task/phases/spec.ts` | Calls `taskPhase()` directly for spec transitions. |
| `scripts/run-task/prompts/helpers.ts` | Emits `canon task phase ...` in spawned-agent final commands. |
| `scripts/run-task/prompts/index.ts` | Replaces runtime template file reads with static `.md` imports. |
| `scripts/run-task/prompts/md-modules.d.ts` | Adds the `.md` module declaration for TypeScript. |
| `scripts/run-task/task-sh.ts` | Deleted obsolete bash bridge. |
| `scripts/run-task/validation.ts` | Updates phase-gate comments to the new `canon task` path. |
| `scripts/task.sh` | Deleted bash/jq task helper. |
| `src/cli/commands/doctor.ts` | Removes jq and `npx tsx` from required/recommended checks. |
| `src/cli/commands/run-task.ts` | Spawns `process.execPath dist/scripts/run-task.js` instead of `tsx` source. |
| `src/cli/commands/task.ts` | Delegates to the in-process TS task module instead of spawning bash. |
| `src/cli/deps.ts` | Removes jq from `canon init` hard dependencies. |
| `src/task/index.ts` | Adds the TypeScript task CLI port: new/list/status/phase/reset-spec-review/post-merge-sync/release-init. |
| `tests/md-loader-hooks.mjs` | Test-only loader for `.md` imports under Node's test runner. |
| `tests/md-loader-register.mjs` | Registers the test-only markdown loader. |
| `tests/run-task-canon-snapshot.test.ts` | Uses `taskNew()` instead of `task.sh`. |
| `tests/run-task-counter-schema.test.ts` | Uses `taskPhase()`/`taskResetSpecReview()` instead of `task.sh`. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt goldens for `canon task` commands. |
| `tests/run-task-validation.test.ts` | Updates comments from `task.sh` to `canon task`. |
| `tests/task-cli.test.ts` | Adds behavioral parity coverage for task subcommands, worktree routing, release-init, and bundled help. |
| `tsconfig.json` | Includes `scripts/**/*.d.ts` for `.md` module declarations. |
| `tsup.config.ts` | Adds `scripts/run-task` bundle entry, `.md` text loader, and bundles `mustache` into dist entries. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The implementation makes the installed canon package self-contained around `dist/` plus `templates/`. The task helper is now a TypeScript API in `src/task/index.ts`, both `canon task` and the orchestrator call it in-process, and `canon run` invokes the bundled orchestrator with Node instead of source via `tsx`.

I folded `canon-snapshot` and `check-phase-gate` into importable helpers instead of shipping sidecar processes. They did not need process isolation, and in-process calls remove the deleted bash script's process-spawn surface.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Added `noExternal: ['mustache']` in `tsup.config.ts`. | The raw extracted tarball smoke exposed that `dist/scripts/run-task.js` otherwise needed `node_modules/mustache`. Bundling it keeps the orchestrator invocable from `dist/` alone. | Supports AC-23 and AC-26. |
| Added `tests/md-loader-register.mjs` and `tests/md-loader-hooks.mjs`. | tsup can bundle `.md` imports, but source tests under Node+tsx cannot load `.md` files without a test-only loader. | Supports AC-7a and AC-22. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `package.json.files` is exactly `["dist/", "templates/"]`. |
| AC-2 | Met | `tsx` moved from `dependencies` to `devDependencies`; verification command exits 0. |
| AC-3 | Met | Removed `task` and `run-task` npm scripts. |
| AC-4 | Met | `scripts/task.sh` deleted. |
| AC-5 | Met | `scripts/run-task/task-sh.ts` deleted. |
| AC-6 | Met | `tsup.config.ts` builds `dist/scripts/run-task.js`. |
| AC-7 | Met | tsup `.md` text loader added. |
| AC-7a | Met | `.md` declaration added and covered by `tsconfig.json`. |
| AC-8 | Met | Prompt templates are static imports; runtime `readFileSync` template loading removed. |
| AC-9 | Met | `loadTemplate(name): string` retained and throws `Unknown template: <name>`. |
| AC-10 | Met | `canon run` spawns `process.execPath` with `dist/scripts/run-task.js`. |
| AC-11 | Met | `canon task` dispatches to TS functions without bash. |
| AC-12 | Met | `tests/task-cli.test.ts` covers happy and error paths for every subcommand. |
| AC-13 | Met | `taskPhase()` derives top-level status via `deriveTopLevelStatus()`; tested. |
| AC-14 | Met | `taskPhase`, `taskStatus`, and `taskResetSpecReview` route through `resolveTaskCwd()`; worktree routing tested. |
| AC-15 | Met | `release-init` preserves duplicate-branch guard text and injectable push; tested. |
| AC-16 | Met | Phase handlers and `main.ts` call `taskPhase()` directly; grep for `runTaskShFor` returns no matches. |
| AC-16a | Met | Prompt phase commands emit `canon task phase`; grep for `scripts/task.sh` in `scripts/` and `src/` returns no matches. |
| AC-17 | Met | `TASK_SH` export removed; grep returns no matches. |
| AC-18 | Met | Direct entry guards removed/refactored; `node dist/scripts/run-task.js --help` tested. |
| AC-19 | Met | `doctor.ts` no longer requires jq or recommends `Bash(jq *)`/`Bash(npx tsx *)`. |
| AC-19a | Met | `deps.ts` no longer hard-requires jq; jq-less init smoke passed. |
| AC-20 | Met | `npm run lint` passed. |
| AC-21 | Met | `npm run type-check` passed. |
| AC-22 | Met | `npm test` passed with 253 pass / 1 skipped / 0 fail. |
| AC-23 | Met | `npm run build` passed and produced executable shebang bundles for CLI and orchestrator. |
| AC-24 | Met with pipeline caveat | Fresh build is deterministic, but the raw pre-commit command reports the expected uncommitted regenerated `dist/` diff until the orchestrator commits it. |
| AC-25 | Met | Workflow extended; local temp-prefix git-source smoke passed with jq-less shims. |
| AC-26 | Met | `npm pack` tarball contains `dist/` and `templates/`, no `scripts/` or `public/`; raw extraction smoke passed. |
| Bootstrap self-repair | Met | I will close implement with `node "/Users/tstraub/canon-ai/dev-worktrees/canon-self-contained/dist/cli/index.js" task phase canon-self-contained implement done`. |

## Edge Cases Considered

- Worktree routing uses the existing `resolveTaskCwd()` instead of a new parser.
- `status.json` writes use temp-file plus rename to avoid partial writes.
- `release-init` keeps the local/remote duplicate branch guards before mutations and uses an injectable push for tests.
- jq-less smoke PATH includes only `node`, `npm`, `git`, `canon`, `which`, and no-op `claude`/`codex` shims.
- Raw tarball extraction works without `node_modules` because the generated bundles include `mustache`.
- Source tests can import static `.md` prompts through the test-only loader without changing production runtime behavior.

## Blockers

- None.

## Decisions Made During Implementation

- Sidecar decision: folded `canon-snapshot.ts` and `check-phase-gate.ts` into in-process imports; no sidecar bundles are shipped.
- Task module location: `src/task/index.ts`, shared by `canon task` and orchestrator phase handlers.
- CI shim approach: the git-install smoke creates `claude` and `codex` shell shims that print a line and intentionally does not provide `jq` on PATH.
- Bootstrap completion command: `node "/Users/tstraub/canon-ai/dev-worktrees/canon-self-contained/dist/cli/index.js" task phase canon-self-contained implement done`.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exited 0. |
| `npm run type-check` | Pass | Exited 0. |
| `npm test` | Pass | Exited 0; 253 pass, 1 skipped, 0 fail. |
| `npm run build` | Pass | Exited 0; produced `dist/cli/index.js` and `dist/scripts/run-task.js`, both executable with `#!/usr/bin/env node`. |
| `git diff --exit-code -- dist/` after build | Pass | Committed-state gate caveat: before the orchestrator commit, the command exits nonzero because regenerated `dist/` is the expected task diff. This is the same diff the orchestrator will commit before CI reruns the gate. |
| CI "Verify git-install path" | Pass | Local equivalent used a temp committed copy plus temp npm prefix; `canon --version`, `node .../dist/scripts/run-task.js --help`, jq-less `canon init`, `canon doctor`, and `canon task new test-task "Test"` all exited 0. The temp-prefix npm run required `npm_config_install_links=true`; GitHub workflow still exercises the git-source install path. |
| Local install smoke (Codex during implement): in a clean tmpdir initialized as a git repo (`git init && git commit --allow-empty -m init`), run `npm pack` in the workspace, extract the tarball into the tmpdir, then exercise the smoke against the extracted bundle: | Pass | `npm pack` plus raw extraction: `node package/dist/cli/index.js --version`, `init`, `doctor`, `task new smoke "Smoke"`, and `node package/dist/scripts/run-task.js --help` all exited 0 on a jq-less shim PATH; package contained no `scripts/` or `public/`. |
| E2E - N/A | deferred_by_spec | Spec Validation Required marks E2E as N/A; no UI surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/dev` (`git rev-list --left-right --count origin/dev...HEAD` showed `0 1`)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

| File | What Changed |
|---|---|
| `<path>` | ... |

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
