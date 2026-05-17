# QA Summary: canon-self-contained

> Task: Bundle orchestrator + task CLI into dist/, drop bash/jq/tsx from runtime requirements
> Reviewed by: Claude | 2026-05-16

## What Changed

Canon is now self-contained at runtime. Its only requirements beyond Node.js are `git` plus the pipeline agents (`claude`, `codex`). The previous install required `bash`, `jq`, and the `tsx`/`esbuild` runtime chain — each a source of native-postinstall failures on `npm install -g`. All three are gone from the runtime dep graph.

**TypeScript task CLI port (`src/task/index.ts`)** — The 693-line `scripts/task.sh` bash+jq script is deleted and replaced with an in-process TypeScript module. All seven subcommands (`new`, `list`, `status`, `phase`, `reset-spec-review`, `post-merge-sync`, `release-init`) are ported 1:1. `canon task` dispatches to this module directly instead of shelling out to bash. The orchestrator's six phase handlers now call `taskPhase()` in-process instead of spawning bash via the deleted `runTaskShFor()` helper.

**Bundled orchestrator (`dist/scripts/run-task.js`)** — `scripts/run-task.ts` and its child scripts now compile to `dist/scripts/run-task.js` via tsup. `canon run` spawns `node dist/scripts/run-task.js` instead of `npx tsx scripts/run-task.ts`. `canon-snapshot` and `check-phase-gate` were folded in as in-process imports (no sidecar bundles).

**Static template imports** — Prompt templates in `scripts/run-task/prompts/templates/*.md` are now static imports at build time (via tsup's `.md` text loader) rather than `readFileSync` calls at runtime. The bundle is self-contained; no sibling `templates/` directory is required next to the bundled JS.

**Prompt seam fixed** — `phaseCommands()` in `prompts/helpers.ts` previously emitted `'<REPO_ROOT>/scripts/task.sh' phase ...` in spawned-agent final commands. It now emits `canon task phase ...`, so agents receive a command that exists post-deletion.

**Smaller install footprint** — `package.json files` is now `["dist/", "templates/"]`. `scripts/` and `public/` are gone from what adopters install. `tsx` moves from `dependencies` to `devDependencies`. The `npm run task` and `npm run run-task` dev shortcuts are removed; the dogfood path is `npm run build && canon run <id>`.

**`jq` removed from hard deps** — `src/cli/deps.ts` no longer lists `jq` in `HARD_DEPS`, so `canon init` no longer fails on jq-less machines. `canon doctor` no longer lists `jq` or `npx tsx` as required/recommended binaries.

## Files Changed

42 files across the implementation commit plus a recovery commit for docs:

- **New**: `src/task/index.ts`, `dist/scripts/run-task.js`, `scripts/run-task/prompts/md-modules.d.ts`, `tests/task-cli.test.ts`, `tests/md-loader-hooks.mjs`, `tests/md-loader-register.mjs`
- **Deleted**: `scripts/task.sh`, `scripts/run-task/task-sh.ts`
- **Modified**: `tsup.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, `src/cli/commands/task.ts`, `src/cli/commands/run-task.ts`, `src/cli/commands/doctor.ts`, `src/cli/deps.ts`, `scripts/run-task/prompts/index.ts`, `scripts/run-task/prompts/helpers.ts`, `scripts/run-task/env.ts`, `scripts/run-task/main.ts`, all six phase handlers, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/architecture.md`, `docs/codebase-map.md`, `docs/patterns.md`, `.github/workflows/ci.yml`, rebuilt `dist/cli/index.js`

Note: `docs/architecture.md`, `docs/codebase-map.md`, and `docs/patterns.md` were listed in the handoff Changes table but were dropped from the main implementation commit by a bug in `syncWorktreeArtifacts`. They were recovered in a follow-up commit (`7d39db6`). The underlying sync bug is a separate follow-up item.

## How to Test

1. **Fresh global install** — `cd $(mktemp -d) && npm install -g "git+file:///Users/tstraub/canon-ai/canon-ai-dev"`. Expected: completes with no `esbuild` ENOENT. No `tsx` in the runtime dep graph.

2. **`canon doctor` on a jq-less machine** — run `canon doctor` from a directory where `jq` is not on PATH. Expected: reports clean. `jq` not listed as a required binary.

3. **Task management end-to-end without bash/jq** — in a repo with `canon init` already run:
   - `canon task new test-port "Verify the port works"` — task directory created with well-formed `status.json`. No errors about `jq` or `bash`.
   - `canon task list` — new task appears with current phase.
   - `canon task phase test-port spec done` — phase advances; top-level `status.status` updates correctly.
   - `canon task status test-port` — full status displays, matching previous bash output.

4. **Bundled orchestrator** — `node $(npm root -g)/canon-ai/dist/scripts/run-task.js --help`. Expected: exits 0 and prints usage text.

5. **Install footprint** — `ls $(npm root -g)/canon-ai/`. Expected: only `dist/`, `templates/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`. No `scripts/`, no `public/`. Installed `node_modules` for canon-ai contains `mustache` only (no `tsx` or `esbuild`).

6. **Full pipeline iteration** — create a trivial S task, write a minimal spec, and run `canon run <id>`. Verify phase transitions, worktree creation, auto-commit, and code review all work as before.

7. **Worktree routing** — from the supervising checkout, run `canon task phase <id> ...` while a task is checked out in a linked worktree. Expected: worktree's `status.json` updated; supervising checkout's unchanged.

## Test Results

All automated checks passed in a single implementation round:

| Check | Result |
|---|---|
| `npm run lint` | Pass (exit 0) |
| `npm run type-check` | Pass (exit 0) |
| `npm test` | Pass — 253 pass / 1 skipped / 0 fail |
| `npm run build` | Pass — produced `dist/cli/index.js` and `dist/scripts/run-task.js`, both with `#!/usr/bin/env node` |
| `git diff --exit-code -- dist/` | Pass (caveat: nonzero before orchestrator commit; CI reruns gate post-merge on clean tree) |
| CI "Verify git-install path" | Pass — git-init tmpdir, `canon --version`, bundled orchestrator help, jq-less `canon init`/`canon doctor`/`canon task new` all exit 0 |
| Local tarball smoke (`npm pack`) | Pass — extracted tarball has `dist/` and `templates/`, no `scripts/`/`public/`; all smoke steps exit 0 without jq on PATH |
| E2E | N/A (no UI surface) |

Code review: Stage 1 and Stage 2 both passed in one round. No correctness bugs, no risk/guardrail findings.

## Decisions Made

- **`canon-snapshot` and `check-phase-gate` folded in as in-process imports**, not sidecar bundles. Neither relied on process-isolation properties, so in-process is cleaner and removes two build entries.
- **Task module at `src/task/index.ts`**, shared by `canon task` CLI and orchestrator phase handlers. Single source of truth.
- **`mustache` bundled into dist entries** (`noExternal: ['mustache']` in tsup) — the raw extracted-tarball smoke exposed that `dist/scripts/run-task.js` otherwise needed `node_modules/mustache` to run without the installed package's `node_modules` tree.
- **Test-only `.md` loader** (`tests/md-loader-register.mjs`) — tsup can bundle `.md` imports, but Node + tsx cannot load `.md` files by default. The loader is test infrastructure only.
- **Bootstrap self-repair** — Codex marked the implement phase done using the freshly-built bundle (`node dist/cli/index.js task phase canon-self-contained implement done`) rather than the stale parent's in-memory `task.sh` command. `scripts/task.sh` was the last thing deleted in the final implement pass.

## Open Questions / Follow-Up

- **Worktree-sync bug** — the auto-commit step dropped `docs/architecture.md`, `docs/codebase-map.md`, and `docs/patterns.md` from the main commit despite them being in the handoff Changes table. A bug in `syncWorktreeArtifacts` moved worktree edits to the supervising checkout and reset the worktree copy to HEAD. Recovery commit `7d39db6` landed the edits. Root-cause fix is a separate follow-up task.

---

## Proposed Changelog

> The spec explicitly defers the CHANGELOG entry and version bump to a separate human+Claude commit after `human_review` approves. This section drafts the proposed entry.

**Proposed version: 1.0.3 (patch)** — no API breakage; same CLI shape, same `status.json` schema. Drops runtime system dependencies and shrinks the install footprint, which is a reliability and portability fix rather than a new capability.

---

```markdown
## [1.0.3] — YYYY-MM-DD

### Changed

- **Canon is now self-contained — runtime requirements drop to Node.js + git.** The 693-line `scripts/task.sh` bash+jq task helper is replaced by an in-process TypeScript module (`src/task/index.ts`). The orchestrator compiles to `dist/scripts/run-task.js` and is invoked via `node` instead of `tsx`. Prompt templates are static build-time imports rather than runtime file reads. Net effect: `bash`, `jq`, and the `tsx`/`esbuild` native-postinstall chain are gone from the runtime dependency graph. `npm install -g <git-url>` is more reliable as a result.

### Removed

- **`scripts/task.sh`** — deleted. All functionality lives in `src/task/index.ts`. The `canon task` command API is unchanged.
- **`jq` hard dependency** — removed from `canon init`'s required-binary check. `canon init` and `canon doctor` run on machines without `jq` installed.
- **`scripts/` and `public/` from the npm package** — the installed package now contains only `dist/` and `templates/`. Smaller install with no `.ts` source or shell scripts.
```
