# Spec: canon-self-contained — Bundle orchestrator + task CLI into dist/, drop bash/jq/tsx from runtime requirements

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Adopters cannot install canon-ai via `npm install -g <git-url>` because the install path runs into [npm/cli#8440](https://github.com/npm/cli/issues/8440) — npm 11's `pacote` git-source preparation does not reliably install devDependencies into its cache-clone before firing lifecycle scripts, and the `tsx → esbuild` chain in canon's runtime `dependencies` triggers a native-postinstall ENOENT during global git installs. The 1.0.2 fix (commit `dist/`, drop the `prepare` hook) addresses the orchestrator-entry bundling but leaves the deeper structural problem in place: canon ships TypeScript source under `scripts/` and depends on `tsx` (with esbuild transitively) to JIT-compile it at runtime. Every transitive native-postinstall script in that chain is a future blast-radius for `npm install -g` bugs.

Compounding this, canon ships `scripts/task.sh` — 693 lines of bash + jq managing every `status.json` phase transition and the worktree-routing chokepoint — which forces adopters to have `bash` and `jq` installed at runtime and exposes a second shipped surface (`scripts/`) parallel to the bundled CLI (`dist/`). The `canon task` JS command is currently a thin passthrough that spawns bash on the shell script ([src/cli/commands/task.ts:15](src/cli/commands/task.ts:15)), so adopters' machines need a working bash shell with jq on PATH for canon's primary task-management API to function. There is no structural reason this logic should live outside the bundled CLI.

The end state we want: canon is a self-contained TypeScript CLI. Its only runtime requirement beyond Node.js is `git`. The shipped install surface is `dist/` (compiled JS) plus `templates/` (scaffold content for adopters). Everything else — `scripts/`, `public/`, the bash script, the tsx runtime, the jq dependency — is eliminated from what adopters install. The dogfood path (canon-on-canon development) goes through `npm run build && canon run <id>` rather than the current `npx tsx scripts/run-task.ts <id>` shortcut.

## Decision

Make canon self-contained at runtime:

1. **Bundle the orchestrator** — `scripts/run-task.ts` and child scripts compile to `dist/scripts/run-task.js` (main bundle). Whether `canon-snapshot.ts` and `check-phase-gate.ts` become separate sidecar bundles or fold into the main bundle as in-process imports is an implementation decision (see Known Risks). `canon run` spawns `node` against the main bundle instead of `tsx` against source.

2. **Inline the 10 prompt templates** — `scripts/run-task/prompts/templates/*.md` become static imports via a tsup `.md` text loader. The `readFileSync` runtime path in `prompts/index.ts` goes away. Bundle is self-contained; no sibling `templates/` directory required next to the bundled JS.

3. **Port `scripts/task.sh` to TypeScript** — rewrite the 693-line bash+jq script as in-process TS subcommands directly in `src/cli/commands/task.ts`. Covers: `new`, `list`, `status`, `phase`, `reset-spec-review`, `post-merge-sync`, `release-init`. Native JSON manipulation replaces jq. Worktree routing uses the existing `resolveTaskCwd()` in `scripts/run-task/state.ts` (deduplicates the bash `resolve_task_cwd` function). The TypeScript port becomes the single source of truth.

4. **Refactor orchestrator call sites** — six phase handlers (`scripts/run-task/phases/*.ts`) plus `scripts/run-task/main.ts` currently call `runTaskShFor()` from `scripts/run-task/task-sh.ts` to spawn bash. After the port, they call the new TS task API directly (in-process). The `task-sh.ts` helper file is deleted.

5. **Drop runtime dependencies** — `tsx` moves to `devDependencies` (kept for type-checking and ad-hoc dev runs; not on canon's hot path). `bash` and `jq` are removed from `canon doctor`'s required-binary checks. The `Bash(jq *)` and `Bash(npx tsx *)` permission entries in `doctor.ts` are removed.

6. **Shrink shipped surface** — `package.json` `files` becomes `["dist/", "templates/"]`. Adopters get the bundled CLI plus the canon-init scaffold; no `.ts` source, no shell script, no README images. The `npm run-task` script is removed (the dogfood path is `npm run build && canon run <id>`).

Net effect for adopters:
- Smaller install (no native-postinstall scripts in the runtime dep graph)
- `npm install -g <git-url>` works reliably (no esbuild ENOENT)
- Runtime requirements drop from `{node, git, bash, jq, tsx-via-esbuild}` to `{node, git}`
- Single shipped artifact (`dist/`) for the CLI surface

## Non-Goals

- **No new task-management features.** The TypeScript port of `task.sh` is strictly 1:1 — same subcommands, same arguments, same semantics, same exit codes, same error messages (verbatim where possible). Behavior changes are out of scope.
- **No `status.json` schema changes.** The JSON shape stays identical. Only the read/write mechanism changes (jq → native TS).
- **No spec/plan/handoff/review/done/notes template changes.** `.canon/templates/*.md` files are not touched.
- **No new orchestrator capabilities.** Phase order, routing logic, auto-commit, validation gates all stay structurally identical.
- **No changes to what `canon init` scaffolds.** The `templates/` package-root directory and its layout are unchanged; adopter-init output is byte-identical.
- **No CHANGELOG entry or version bump in this task.** Per release rules, the human + Claude do the bump in a separate commit after `human_review` approves.
- **No CI workflow changes beyond what's needed.** The existing `npm install -g git+file://` step from 1.0.2 stays; it will validate the new bundle once `dist/` is rebuilt.
- **No deletion of `tsx` from `devDependencies`.** It stays available for tests and ad-hoc dev (`npx tsx <some-script>`); just not on canon's hot path.

## Acceptance Criteria

- [ ] **AC-1**: `package.json` `files` field equals `["dist/", "templates/"]` exactly (no `scripts/`, no `public/`).
- [ ] **AC-2**: `package.json` `dependencies` does NOT include `tsx`. `tsx` is listed in `devDependencies`. Verify: `node -e "const p=require('./package.json'); if (p.dependencies?.tsx) process.exit(1); if (!p.devDependencies?.tsx) process.exit(1);"` exits 0.
- [ ] **AC-3**: `package.json` `scripts` does NOT include a `run-task` entry, and does NOT include a `task` entry. (The current `"task": "./scripts/task.sh"` dev shortcut is removed alongside `run-task` — no broken script targets remain after deletion.)
- [ ] **AC-4**: `scripts/task.sh` is deleted from the repository.
- [ ] **AC-5**: `scripts/run-task/task-sh.ts` is deleted from the repository.
- [ ] **AC-6**: `tsup.config.ts` includes an entry for `scripts/run-task` (main orchestrator). Whether `canon-snapshot` and `check-phase-gate` are separate tsup entries or in-process imports is left to the implementer (see Known Risks), but after `npm run build`, `dist/scripts/run-task.js` must exist and must successfully run the orchestrator end-to-end.
- [ ] **AC-7**: `tsup.config.ts` includes a `.md` text loader (e.g., `loader: { '.md': 'text' }`) so `prompts/index.ts` can import templates as strings at build time.
- [ ] **AC-7a**: TypeScript can type-check `.md` imports. The current `tsconfig.json` has no `allowArbitraryExtensions` and no module declaration for `*.md`, so `import template from './templates/spec.md'` would fail `tsc --noEmit`. The implementer adds a module declaration file (e.g., `scripts/run-task/prompts/md-modules.d.ts` with `declare module '*.md' { const content: string; export default content; }`) and ensures it is picked up by `tsconfig.json`'s `include` glob (the existing `scripts/**/*.ts` does NOT match `.d.ts`; either rename the include to `scripts/**/*.{ts,d.ts}`, add an explicit entry, or place the declaration under an already-included path with a `.ts` extension. The implementer picks the least-invasive option and documents it in `handoff.md`.) Verify: `npm run type-check` exits 0 with the new static `.md` imports in place.
- [ ] **AC-8**: `scripts/run-task/prompts/index.ts` no longer reads template files at runtime. The `TEMPLATE_DIR` constant, `TEMPLATE_CACHE` Map, and `readFileSync` call inside `loadTemplate()` are removed. Templates are sourced from static imports of the 10 `.md` files (`code-review-round-1.md`, `code-review-round-n.md`, `implement.md`, `implement-revisions.md`, `implement-reroute.md`, `plan.md`, `qa.md`, `spec.md`, `spec-revision.md`, `spec-review.md`).
- [ ] **AC-9**: `loadTemplate()` retains its existing signature `(name: string) => string` and throws a clear error (e.g., `Unknown template: <name>`) when called with an unrecognized name. All 11 existing `render()` callsites in `prompts/index.ts` continue to work unchanged.
- [ ] **AC-10**: `src/cli/commands/run-task.ts` spawns `node` (or `process.execPath`) with the path to the bundled main orchestrator at `dist/scripts/run-task.js` (resolved relative to `packageDir`). The `resolveTsx()` helper function is removed. The `runTaskScript` constant points to the `.js` bundle, not the `.ts` source.
- [ ] **AC-11**: `src/cli/commands/task.ts` no longer spawns bash. It dispatches to in-process TypeScript implementations of the subcommands (`new`, `list`, `status`, `phase`, `reset-spec-review`, `post-merge-sync`, `release-init`). The `taskScript` constant and the `spawnSync('bash', ...)` call are removed.
- [ ] **AC-12**: All `task.sh` subcommands have TypeScript counterparts that pass behavioral parity tests. For each of `new`, `list`, `status`, `phase`, `reset-spec-review`, `post-merge-sync`, `release-init`, a unit test in `tests/` exercises the happy path and at least one error-path case (e.g., missing task, invalid phase, malformed `status.json`). Tests do NOT shell out to `task.sh`.
- [ ] **AC-13**: The `phase` subcommand re-derives the top-level `status.status` pointer after writing a phase entry (mirrors the existing `task.sh:cmd_phase` derivation logic). A test verifies that writing `phases.spec.status = "done"` updates the top-level `status` correctly.
- [ ] **AC-14**: Worktree routing is preserved. When a task has an active worktree (`task/<id>` branch checked out), `phase`, `status`, `reset-spec-review` subcommands operate on the worktree's `tasks/<id>/status.json`, not the main checkout's. The TS port uses the existing `resolveTaskCwd()` in `scripts/run-task/state.ts` rather than duplicating logic. A test using a fake `git worktree list --porcelain` fixture verifies routing.
- [ ] **AC-15**: The `release-init` subcommand preserves the existing `cmd_release_init` contract exactly: on first run it creates `release/<short>` off `main`, bumps `package.json` and `package-lock.json`, inserts the empty changelog block, commits, and pushes. On a second invocation (when the local or remote `release/<short>` branch already exists), it **fails with the existing error message** (`Error: branch '<branch>' already exists locally.` or `Error: branch '<branch>' already exists on origin.`) and exits non-zero — no commit, no push, no changelog mutation. A test exercises both paths: (a) happy path against a temp git repo, (b) second-run guard against a temp repo that already has the release branch present locally, asserting the exact stderr/stdout text and a non-zero exit code. Tests must NOT execute real `git push` — the push call site is mocked or stubbed. The Non-Goals constraint applies: this is a 1:1 port; no behavior change.
- [ ] **AC-16**: Six phase handler files (`scripts/run-task/phases/{implement,spec,spec-review,plan,code-review,qa}.ts`) and `scripts/run-task/main.ts` no longer import from `./task-sh.js`. Each `runTaskShFor()` call is replaced with a direct in-process call into the new TS task module. A grep for `runTaskShFor` across `scripts/` and `src/` returns zero matches.
- [ ] **AC-16a**: `scripts/run-task/prompts/helpers.ts` no longer hard-codes `'<REPO_ROOT>/scripts/task.sh' phase ...` in `phaseCommands()`. Spawned agent sessions are given a command that invokes the bundled CLI instead — e.g., `canon task phase <id> <phase> <status> [verdict]` (preferred — works for adopters because `canon` is on PATH after `npm install -g`). The `REPO_ROOT` import is removed if unused after the change. A grep for `scripts/task.sh` across `scripts/` and `src/` returns zero matches. (This is the prompt seam flagged in `notes.md` — without it, spawned agents receive commands pointing at a deleted file.)
- [ ] **AC-17**: `scripts/run-task/env.ts` no longer exports `TASK_SH`. Grep for `TASK_SH` across `scripts/` and `src/` returns zero matches.
- [ ] **AC-18**: The entry-point check at `scripts/run-task/main.ts:1715` (`if (process.argv[1] === __filename)`) and the equivalent at `scripts/run-task/canon-snapshot.ts:94` (`isMain` constant) are either removed or refactored so they do not cause double-invocation after bundling. The wrapper at `scripts/run-task.ts:3` (`void main().catch(...)`) remains the sole invocation site for `main()`. A test runs `node dist/scripts/run-task.js --help` (or similar non-destructive flag) and verifies that the orchestrator's entry function is called exactly once.
- [ ] **AC-19**: `src/cli/commands/doctor.ts` no longer requires `jq` as a binary check (the `checkBinary('jq', true, ...)` call at line 259 is removed or changed to `required: false` if jq is still optional). The `Bash(jq *)` permission entry at line 24 is removed. The `Bash(npx tsx *)` permission entry at line 32 is removed.
- [ ] **AC-19a**: `src/cli/deps.ts` no longer hard-requires `jq`. The entry `{ cmd: 'jq', installHint: '...' }` is removed from the `HARD_DEPS` array (`src/cli/deps.ts:10`). After this change, `canon init` does NOT fail on a machine without `jq` installed. Verify: in a tmpdir on a `jq`-less PATH, `canon init` exits 0. (Per the task's stated end state — only `git` remains a hard runtime requirement beyond Node.js. `claude` and `codex` remain in `HARD_DEPS`; their removal is out of scope.)
- [ ] **AC-20**: `npm run lint` exits 0.
- [ ] **AC-21**: `npm run type-check` exits 0.
- [ ] **AC-22**: `npm test` exits 0. All existing tests pass plus new ones from AC-12 through AC-18.
- [ ] **AC-23**: `npm run build` exits 0 and produces `dist/cli/index.js` and `dist/scripts/run-task.js` at minimum (plus any sidecar bundles per AC-6). Each entry-point bundle is executable and starts with the `#!/usr/bin/env node` shebang banner.
- [ ] **AC-24**: `git diff --exit-code -- dist/` after `npm run build` exits 0 (committed `dist/` matches a fresh build — same gate the CI dist-freshness step enforces).
- [ ] **AC-25**: The CI step "Verify git-install path produces a working canon binary" passes. Specifically, in a clean tmpdir initialized as a git repo with `git init` and one empty commit:
  1. `npm install -g "git+file://$WORKSPACE"` exits 0.
  2. `canon --version` exits 0.
  3. `node $(npm root -g)/canon-ai/dist/scripts/run-task.js --help` (or equivalent non-destructive flag) exits 0 — confirms the bundled orchestrator entry exists and is invocable, without requiring agent CLIs to be installed.
  4. `canon init` exits 0 in an environment where `git`, `claude`, and `codex` are on PATH. CI may install no-op shims (`echo` scripts) for `claude` and `codex` to satisfy `checkDeps()`; `jq` MUST NOT be on PATH for this step (verifies AC-19a — `canon init` runs without `jq`). After `init`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.canon/templates/`, and `.claude/skills/` exist in the cwd.
  5. `canon doctor` exits 0 (or with warnings only — never with a `fail` exit). `jq` is not listed as a required binary in the output.
  6. `canon task new test-task "Test"` exits 0 and creates `tasks/test-task/` with a well-formed `status.json` — exercises the ported `cmd_new` logic in-process without `jq` on PATH.
  If the existing CI step does not yet invoke `canon init`/`canon task new`, extend it to do so as part of this AC. The implementer may add minimal CI-side `claude`/`codex` shims (since those CLIs are out of scope for removal in this task); the shims must NOT mask a real check this AC depends on. Document the shim approach in `handoff.md`.
- [ ] **AC-26**: The local tarball install path stays sound: `npm pack` produces `canon-ai-<version>.tgz`; extracting it shows `package/dist/cli/index.js`, `package/dist/scripts/run-task.js`, `package/templates/...` — and NO `package/scripts/` or `package/public/` paths.

## Design

### Affected Files

| File | Change |
|---|---|
| `tsup.config.ts` | Add entry for `scripts/run-task` (and sidecars if kept separate). Add `loader: { '.md': 'text' }`. |
| `scripts/run-task/prompts/index.ts` | Replace runtime `readFileSync` template loading with 10 static imports + lookup `Record<string, string>`. Delete `TEMPLATE_DIR`, `TEMPLATE_CACHE`. Keep `loadTemplate(name): string` signature. |
| `scripts/run-task/prompts/helpers.ts` | `phaseCommands()` currently emits `'<REPO_ROOT>/scripts/task.sh' phase ...`. Replace with a `canon task phase ...` invocation. Remove the `REPO_ROOT` import if no other helper uses it. (Per AC-16a — this is the prompt seam that spawned agents read; without this change the deletion of `scripts/task.sh` leaves spawned commands pointing at a missing file.) |
| `scripts/run-task/prompts/md-modules.d.ts` (new) | New TypeScript module declaration: `declare module '*.md' { const content: string; export default content; }`. Without this (or `allowArbitraryExtensions`), `tsc --noEmit` fails on the new static `.md` imports. Ensure `tsconfig.json`'s `include` glob picks it up — if `scripts/**/*.ts` doesn't match `.d.ts`, update the include or place the declaration where it will be matched. |
| `tsconfig.json` (conditional) | If the AC-7a `.d.ts` placement requires it, broaden the `include` glob to match the new declaration (e.g., `scripts/**/*.{ts,d.ts}`). Skip this edit if the declaration is placed somewhere already matched. |
| `scripts/run-task/main.ts` | Remove the entry-point check at line 1715 (`if (process.argv[1] === __filename)`); the wrapper is the sole invoker. Remove `import * as splitTaskSh from './task-sh.js'` at line 20. Replace any `runTaskShFor()` calls with the new in-process TS API. |
| `scripts/run-task/canon-snapshot.ts` | Remove or refactor the entry-point check at line 94 (`isMain` constant) so it doesn't misfire post-bundle. If kept as a sidecar bundle, the file's main logic runs unconditionally when invoked as the bundle entry. If folded into the main bundle as an importable module, the main logic moves into an exported function called by the new TS task module. |
| `scripts/run-task/check-phase-gate.ts` | Remove `#!/usr/bin/env node --import tsx` shebang. If kept as a sidecar bundle, becomes a plain JS bundle invoked via `node`. If folded in, exported as a function. |
| `scripts/run-task/env.ts` | Delete the `TASK_SH` export at line 45. |
| `scripts/run-task/task-sh.ts` | **DELETE.** No remaining callers after AC-16. |
| `scripts/run-task/phases/implement.ts` | Replace `import { runTaskShFor } from '../task-sh.js'` and its call sites with in-process TS task-API calls. |
| `scripts/run-task/phases/spec.ts` | Same as implement.ts. |
| `scripts/run-task/phases/spec-review.ts` | Same as implement.ts. |
| `scripts/run-task/phases/plan.ts` | Same as implement.ts. |
| `scripts/run-task/phases/code-review.ts` | Same as implement.ts. |
| `scripts/run-task/phases/qa.ts` | Same as implement.ts. |
| `scripts/task.sh` | **DELETE.** All functionality moves to TypeScript. |
| `src/cli/commands/run-task.ts` | Replace `resolveTsx()` + `tsx` spawn with `spawnSync(process.execPath, [bundledPath, ...args])` where `bundledPath = join(packageDir, 'dist/scripts/run-task.js')`. Update `runTaskScript` constant to point at the `.js` bundle. Delete `resolveTsx()` and its `existsSync` import if unused elsewhere in the file. |
| `src/cli/commands/task.ts` | Rewrite as in-process dispatcher. Import the new TS implementations of `new`, `list`, `status`, `phase`, `reset-spec-review`, `post-merge-sync`, `release-init`. Delete `taskScript` constant, `spawnSync('bash', ...)` call. The new implementations should live in a new module under `src/` (e.g., `src/task/`) or under `scripts/run-task/task/` — implementer's call, document in `handoff.md`. |
| `src/cli/commands/doctor.ts` | Remove `Bash(jq *)` permission entry (line 24). Remove `Bash(npx tsx *)` permission entry (line 32). Remove the `checkBinary('jq', true, ...)` call (line 259) — or change `required: true` to `required: false` if you want jq to remain an optional environment hint. |
| `src/cli/deps.ts` | Remove the `jq` entry from `HARD_DEPS` (line 10). Without this, `canon init` fails with `canon init requires the following tools to be installed: jq` on adopter machines without `jq` — defeats the task's whole premise. `claude` and `codex` entries stay (out of scope for this task). |
| `package.json` | `files`: drop `"scripts/"` and `"public/"` (final value: `["dist/", "templates/"]`). `dependencies`: remove `tsx`. `devDependencies`: ensure `tsx` is present (add if not). `scripts`: remove BOTH the `run-task` entry AND the `task` entry (current `"task": "./scripts/task.sh"` would point at a deleted file). |
| `package-lock.json` | Regenerated by `npm install` after the `package.json` changes; commit the result. |
| `dist/` | Rebuilt. New layout includes `dist/scripts/run-task.js`. Committed dist/ must match a fresh build per AC-24. |
| `docs/codebase-map.md` | Update the "Task management helper (status.json updates, phase transitions)" row to reference the new TS module instead of `scripts/task.sh`. Update Configuration → `Worktree dirs allowed` entry if anything changed. |
| `docs/architecture.md` | If the Validation section binds commands referencing `scripts/task.sh` or `npx tsx scripts/run-task.ts`, update to reflect bundled invocation. |
| `docs/patterns.md` | The "State Schema Discipline" pattern mentions `scripts/task.sh cmd_phase()` as a synchronization point; replace with the equivalent TS function name post-port. The Trigger Table row for "Modifying status.json shape" lists `scripts/task.sh` as one of the files to update — replace with the new TS location. |
| `AGENTS.md` | Task management helper code block at lines 112-117 lists `./scripts/task.sh new <TASK-ID> <title>` etc. Update to recommend `canon task new <TASK-ID> <title>` as the primary form. |
| `CLAUDE.md` | Verify `canon task` references; should already be the documented form. Update any remaining mentions of the bash script. |
| `CODEX.md` | Same — update references to `task.sh` or `npx tsx scripts/run-task.ts` if present. |
| `tests/` | Add the new tests required by AC-12 through AC-18. Consolidate into existing test files per project convention (test files are per-feature, not per-helper) — e.g., a new `tests/task-cli.test.ts` covering all subcommand-parity cases, plus updates to existing tests if they exercise the deleted `runTaskShFor` path. |

**Files Codex only reads for context** (do not edit, but referenced inline above): `scripts/run-task/state.ts` (for `resolveTaskCwd`), the existing template `.md` files under `scripts/run-task/prompts/templates/`, the `.canon/templates/status.json` schema. Plus `scripts/run-task.ts` (the wrapper file) for entry-point structure context — no edits needed unless the wrapper itself moves.

### Interaction Dependencies

- **Worktree machinery** — listed delicate surface. The new TS task module must invoke `resolveTaskCwd()` (existing) for any subcommand that mutates `status.json`. A regression where the wrong cwd is used produces silent task-state drift between the supervising checkout and the worktree.
- **Auto-commit** — orchestrator `autoCommitCode()` reads `status.json` to determine phase. If the new phase mutation has a bug, auto-commit may stage wrong files or skip valid changes.
- **Pipeline policy** — `pipeline-policy.ts` reads task fields (`task_size`, `delicate`) from `status.json` via the parser in `state.ts`. Schema is unchanged; routing should be unaffected.
- **CLI dispatch** — `src/cli/index.ts` routes `canon run`, `canon task`, etc. to the command handlers. These signatures don't change; only their bodies.
- **Adopter `.canon/templates/`** — unchanged. The TS task module reads from `.canon/templates/` the same way `task.sh cmd_new` did.

### Data Model Changes

None. `status.json` schema, template shapes, handoff/review formats — all unchanged. Only the read/write mechanism changes from `jq` shelling out to native TS `JSON.parse`/`JSON.stringify`.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite plus new subcommand-parity tests
- [x] `npm run build` — must produce all bundle entries listed in AC-23
- [x] `git diff --exit-code -- dist/` after build — dist-freshness gate
- [x] CI "Verify git-install path" — the real adopter motion, must pass
- [x] Local install smoke (Codex during implement): in a clean tmpdir initialized as a git repo (`git init && git commit --allow-empty -m init`), run `npm pack` in the workspace, extract the tarball into the tmpdir, then exercise the smoke against the extracted bundle:
    1. `node package/dist/cli/index.js --version` → exits 0.
    2. `node package/dist/cli/index.js init` → exits 0 (Codex's local environment has `git`, `claude`, `codex` available, so `checkDeps()` passes; `jq` should be uninstalled or shadowed off PATH to verify AC-19a end-to-end).
    3. `node package/dist/cli/index.js doctor` → exits 0 or warn-only; `jq` absent from the required-binary list.
    4. `node package/dist/cli/index.js task new smoke "Smoke"` → exits 0 and creates `tasks/smoke/` with a well-formed `status.json`.
    5. `node package/dist/scripts/run-task.js --help` (or equivalent non-destructive flag) → exits 0; the bundled orchestrator entry is invocable.
  Codex reports each step's exit code in `handoff.md`'s Validation Outcomes table. A failure on any step is a `Fail`, not a `Fail – unrelated`.
- [ ] E2E — N/A (no UI)

## Docs Impact

- `docs/codebase-map.md` — "Task management helper" row references `scripts/task.sh`; update to point at the new TS module.
- `docs/architecture.md` — Validation section may reference `scripts/task.sh` or `npx tsx scripts/run-task.ts`; review and update.
- `AGENTS.md` — Task management helper code block (lines 112-117) references `./scripts/task.sh`. Update to `canon task`.
- `CLAUDE.md` — Quick refs reference `canon task` helpers; verify recommendations still hold.
- `docs/patterns.md` — "State Schema Discipline" pattern and Trigger Table reference `scripts/task.sh`; replace with new TS location.
- `docs/decisions.md` — No conflicts identified; no updates required.
- `CODEX.md` — Check for references to `task.sh` or `npx tsx scripts/run-task.ts`; update if present.

These updates land in this task. The implementer should at minimum update `docs/codebase-map.md` and `docs/patterns.md` Trigger Table since those are load-bearing for future agents.

## Known Risks

- **Worktree-routing port is the highest-risk surface.** `task.sh:resolve_task_cwd` (lines ~33-80) parses `git worktree list --porcelain` output to find the worktree owning `refs/heads/task/<id>`. The TS port should reuse the existing `resolveTaskCwd()` in `scripts/run-task/state.ts` rather than re-implement. If the existing TS function and the bash function differ in any edge case (absolute vs. relative path normalization, behavior when pwd is already inside the worktree, behavior when no worktree exists), the port must reconcile to the TS version's behavior and add a regression test. Implementer should diff the two implementations side-by-side before relying on the TS function.

- **`status.json` phase derivation must match `cmd_phase` exactly.** After writing a phase entry, the bash script re-derives the top-level `status.status` pointer by walking phases in order. The TS port must reproduce this logic to avoid orchestrator misdispatch. Canonical reference: `task.sh:cmd_phase` (lines ~297-435). Cross-check with the orchestrator's existing `deriveTopLevelStatus()` (search the orchestrator for this name; if found, the two implementations should agree — if they don't, that's a pre-existing declared/executable drift bug per `docs/decisions.md` "Declared Canon vs Executable Canon" and must be flagged in `notes.md` for follow-up, not silently smoothed over).

- **`release-init` mutates branch state.** Existing `cmd_release_init` (lines ~567-684) creates/switches branches and pushes to remote. The contract is NOT "idempotent" in the sense of "running it twice is safe and a no-op" — instead, the script **errors out on the second run** when the local or remote `release/<short>` branch already exists (see `task.sh:618-626`). The TS port must preserve this exact behavior: same error messages, same non-zero exit, no partial mutation. Tests must NOT execute real `git push` — the push call site is mocked or stubbed. A regression where `release-init` silently no-ops or re-pushes on every invocation is a silent footgun.

- **Bundling preserves `import.meta.url` semantics.** After tsup bundling, all `fileURLToPath(import.meta.url)` calls inside the main bundle resolve to the bundle's path (`dist/scripts/run-task.js`), not the source files' paths. This affects: (a) the prompt template loader (handled by AC-8 — no more file reads), (b) the entry-point check (handled by AC-18 — removed), (c) `env.ts:39` (the `path.resolve(__dirname, '../..')` fallback for non-git environments). The `env.ts` fallback is only hit in tests outside a git repo; verify behavior with an explicit test in `tests/` if any existing test relies on this branch.

- **Sidecar bundle decision is open.** `canon-snapshot.ts` and `check-phase-gate.ts` are currently invoked as separate processes from `task.sh` via `run_tsx`. Once `task.sh` is gone and the task module runs in-process, there's no longer a need for them to be separate node processes — they could be regular ESM imports called as functions. **Implementer should evaluate**: if folding them in is straightforward (the functions don't rely on process-isolation properties like exit-code-as-signal or independent cwd), fold them in (cleaner, fewer build entries). If there's a reason to preserve process isolation, keep them as sidecar bundles. Document the decision in `handoff.md` "Decisions made during implementation."

- **The 693-line bash port has surface area beyond tested paths.** `task.sh` has zero unit tests today; behavior is implicit. The implementer must enumerate every subcommand's branches when writing the TS replacement. AC-12 requires happy path + at least one error path per subcommand, but the implementer should cover all observable error messages and exit codes — `bash set -euo pipefail` masks some failure modes that JSON.parse will surface differently. If a subcommand produces an output format the orchestrator parses (e.g., `cmd_status` printing structured data), the TS version must match the format; downstream parsing assumes specific column widths or delimiters in some places. The reviewer should diff the output of each TS subcommand against the bash equivalent for at least one fixture before approving.

- **Concurrent runs / file locking.** `status.json` writes via jq are atomic at the bash-process level (jq writes to a temp file via redirect, then `mv` is implicit in shell). The TS port should use an atomic-rename pattern (`fs.writeFileSync(tmp); fs.renameSync(tmp, final)`) to preserve the no-partial-write guarantee. Two `canon task phase` invocations racing should not leave a corrupt `status.json` on disk. Low-probability but worth the one-line guard.

- **Dev workflow: `npm run-task` removal is intentional.** Per the scope decision: the dogfood path is now `npm run build && canon run <id>` (or `node dist/scripts/run-task.js <id>`). If the implementer finds that test runs or CI implicitly relied on `npm run-task`, surface in `notes.md`. The change is not reversible without breaking the structural goal.

- **Test infrastructure: the existing tests import directly from `scripts/run-task/main.js`.** Two test files reference `../scripts/run-task/main.js` (named exports like `buildHumanReviewStagePaths`, `commitArchiveChanges`, `extractCheckedVerdict`). These imports must continue to work after the refactor — main.ts source stays the source of truth; only its INVOCATION mechanics change. If the new TS task module exports symbols, place them at predictable import paths so test files don't need wholesale restructuring.

## Human Test Plan

The human runs these steps after the pipeline completes; expected results follow each.

1. **Fresh install from the dev branch in a clean temp directory.**
   - Run `cd $(mktemp -d) && npm install -g "git+file:///Users/tstraub/canon-ai/canon-ai-dev"`.
   - Expected: install completes without errors. No `esbuild` postinstall ENOENT. No mention of `tsx` in the installed package's transitive deps for the runtime portion.

2. **Verify `canon doctor` reports a clean environment with the new reduced requirements.**
   - Run `canon doctor` in a directory with `git` available but without `jq` installed.
   - Expected: `canon doctor` reports the environment as clean. `jq` is not listed as a required binary. Other checks (node, git, claude, codex, gh) report as before.

3. **Verify task management works end-to-end without bash/jq.**
   - In a fresh test repo with `canon init` already run, create a task: `canon task new test-port "Verify the port works"`.
   - Expected: task directory created under `tasks/test-port/` with all templates scaffolded. `status.json` is well-formed. No errors about missing `jq` or `bash`.
   - Run `canon task list`.
   - Expected: the new task appears in the list with its current phase.
   - Run `canon task phase test-port spec done`.
   - Expected: phase advances; top-level `status.status` updates correctly.
   - Run `canon task status test-port`.
   - Expected: full status displays, mirroring the previous bash output.

4. **Verify the orchestrator works (full pipeline iteration on a trivial task).**
   - Create a tiny S task in the test repo, write a minimal spec, and run `canon run test-port`.
   - Expected: orchestrator drives through the phases. No regression in pipeline behavior. Phase transitions, worktree creation (if `worktree: true`), auto-commit, and code review all function as before.

5. **Verify worktree routing.**
   - Create a task that runs in a worktree, then from the supervising checkout, run `canon task phase <id> ...`.
   - Expected: the worktree's `status.json` is updated, not the supervising checkout's. The CLI output includes a "routed to <worktree path>" note (matching the bash script's existing behavior, if the implementer preserves the routing-message side effect).

6. **Verify the install footprint shrank.**
   - In the global install location, list the canon-ai package contents: `ls $(npm root -g)/canon-ai/`.
   - Expected: only `dist/`, `templates/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`. No `scripts/`, no `public/`. The installed `node_modules` tree for canon-ai contains `mustache` (and any other production deps); does NOT contain `tsx` or `esbuild`.

7. **Confirm CI is green on the merge commit.** Open the PR's checks tab; the "Verify git-install path produces a working canon binary" step passes. No new warnings or errors.

## Bootstrap & Self-Repair (one-time, this task only)

This task modifies canon's own orchestrator and task CLI. The parent `run-task.ts` process driving this task was loaded into memory **before** this task's code changes land — its in-memory `phaseCommands()` still emits `'<REPO_ROOT>/scripts/task.sh' phase ...`, and its evidence-fallback at `scripts/run-task/main.ts:1335` calls `runTaskShFor()` which spawns `bash` on the to-be-deleted `TASK_SH` path. If Codex deletes `scripts/task.sh` and lets the parent's auto-advance fire, both the spawned prompt's final command AND the parent's fallback will fail against a missing file.

The implementer MUST avoid relying on the stale parent. Concretely:

1. **During implement**, after building the new bundle (`npm run build`), Codex marks the implement phase done by **invoking the freshly-built bundled CLI directly**, not the prompt's pre-baked `task.sh` command:
   ```bash
   node "$WORKTREE/dist/cli/index.js" task phase canon-self-contained implement done
   ```
   The exact path depends on the worktree layout; the spirit is: invoke the freshly-built `dist/cli/index.js` from the worktree, NOT the stale `task.sh`. Document the exact invocation used in `handoff.md` under *Decisions made during implementation*.

2. **The parent's evidence-fallback (`scripts/run-task/main.ts:1335`) still calls `runTaskShFor()`**. If Codex marks the phase done manually first (step 1), the parent finds the phase already advanced and skips the fallback — safe. If Codex does NOT mark it done first and the parent tries to auto-advance, the fallback will fail with `bash: scripts/task.sh: No such file or directory`. Avoid the failure path by marking phase done manually.

3. **`canon doctor` failure protection during build cycles**: While `scripts/task.sh` exists alongside the new TS code in early implementation rounds, the orchestrator must remain functional. Do NOT delete `scripts/task.sh` (AC-4) until *all other AC work* (TS task module, `phaseCommands` update, doctor/deps cleanup, dist rebuild) is complete and committed. Sequence the work so the bash script is the last thing removed in the final implement pass.

4. **Future runs**: After this task ships, the new `scripts/run-task.ts` source is bundled into `dist/scripts/run-task.js`, the next pipeline run uses the bundled paths, and the bootstrap problem is gone permanently.

- [ ] **AC-27**: `handoff.md` includes a *Decisions made during implementation* note that explicitly records (a) the exact command Codex used to mark implement phase done from the freshly-built bundle, and (b) the sequencing approach used to avoid deleting `scripts/task.sh` before the rest of the work landed.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (grep targets, file contents, exit codes, test names)
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (this is a full-tier task; plan is written separately by pipeline Claude after Codex spec review)
- [x] Known Risks covers failure modes for the trickiest ACs (worktree routing port, status.json phase derivation, release-init idempotency, bundling import.meta.url semantics, sidecar bundle decision, untested bash surface area, concurrent writes, test imports)
- [x] Human Test Plan uses product language only
- [x] Validation Required has at least one entry checked
- [x] Symbols named in ACs verified to exist in the codebase: `resolveTsx`, `runTaskScript`, `taskScript`, `loadTemplate`, `TEMPLATE_DIR`, `TEMPLATE_CACHE`, `runTaskShFor`, `TASK_SH`, `phaseCommands`, `REPO_ROOT`, `resolve_task_cwd`, `cmd_new`, `cmd_list`, `cmd_status`, `cmd_phase`, `cmd_reset_spec_review`, `cmd_post_merge_sync`, `cmd_release_init`, `checkBinary`, `Bash(jq *)`, `Bash(npx tsx *)`, `resolveTaskCwd`, `allowArbitraryExtensions` — all confirmed via grep at spec-write time (the `*.md` declaration file is new; AC-7a authorizes its addition explicitly).
- [x] Replacement vs. addition: explicit "delete" bullets paired with the new behavior for `scripts/task.sh`, `scripts/run-task/task-sh.ts`, `TEMPLATE_DIR`, `TEMPLATE_CACHE`, `resolveTsx`, `TASK_SH`, the `npm run-task` script, `scripts/` from `files`, `public/` from `files`, and the `Bash(jq *)` / `Bash(npx tsx *)` permission entries.
