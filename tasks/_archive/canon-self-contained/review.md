# Code Review: canon-self-contained

> Reviewer: Claude | Spec: `tasks/canon-self-contained/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All required checks (lint, type-check, test, build, dist-freshness, CI smoke) pass. The AC-24 caveat (dist freshness gate exits nonzero pre-orchestrator-commit because the new `dist/` is the expected task diff) is credible — the committed `dist/` already contains the rebuilt bundles from the prior commit (`3358125`), and CI reruns the gate post-merge when the tree is clean. The E2E deferred-by-spec entry is accurate.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `files` = `["dist/", "templates/"]` | Pass | Verified in `package.json`. |
| AC-2: `tsx` not in `dependencies`, present in `devDependencies` | Pass | Verified in `package.json`. |
| AC-3: No `run-task` or `task` npm scripts | Pass | Verified in `package.json`. |
| AC-4: `scripts/task.sh` deleted | Pass | File absent; grep confirms. |
| AC-5: `scripts/run-task/task-sh.ts` deleted | Pass | File absent; grep confirms. |
| AC-6: `tsup.config.ts` includes `scripts/run-task` entry; `dist/scripts/run-task.js` produced | Pass | `entry: { 'scripts/run-task': 'scripts/run-task.ts' }` in `tsup.config.ts`. |
| AC-7: `.md` text loader in `tsup.config.ts` | Pass | `loader: { '.md': 'text' }` present. |
| AC-7a: `.md` module declaration; `tsconfig.json` includes `scripts/**/*.d.ts` | Pass | `scripts/run-task/prompts/md-modules.d.ts` exists; `tsconfig.json` `include` updated. |
| AC-8: Static template imports in `prompts/index.ts`; no `readFileSync` | Pass | All 10 templates imported statically; no `TEMPLATE_DIR`, `TEMPLATE_CACHE`, or `readFileSync` present. |
| AC-9: `loadTemplate(name): string` retained, throws `Unknown template: <name>` | Pass | Implementation verified in `prompts/index.ts:31-34`. |
| AC-10: `run-task.ts` spawns `process.execPath` with `dist/scripts/run-task.js`; `resolveTsx()` removed | Pass | Verified in diff and `src/cli/commands/run-task.ts`. |
| AC-11: `task.ts` dispatches in-process; no bash spawn; `taskScript` and `spawnSync('bash', ...)` removed | Pass | `src/cli/commands/task.ts` delegates to `../../task/index.js`. |
| AC-12: `tests/task-cli.test.ts` covers happy + error paths for every subcommand | Pass | Tests exist for `new`, `list`, `status`, `phase`, `reset-spec-review`, `post-merge-sync`, `release-init` with error paths. |
| AC-13: `phase` subcommand re-derives top-level `status`; tested | Pass | `task phase` test verifies spec→done produces `status: spec_review`. |
| AC-14: Worktree routing preserved via `resolveTaskCwd()`; tested with fixture | Pass | Real git worktree fixture test at `tests/task-cli.test.ts:325`. Confirms worktree `status.json` updated, main checkout's unchanged. |
| AC-15: `release-init` duplicate-branch guard preserved; injectable push; both paths tested | Pass | Happy path (line 274) + local-branch guard with exact error message (line 312). Push is injectable. |
| AC-16: No `runTaskShFor` references; phase handlers call `taskPhase()` directly | Pass | Grep returns no matches. |
| AC-16a: `phaseCommands()` emits `canon task phase`; no `scripts/task.sh` in scripts/ or src/ | Pass | `helpers.ts:34` emits `canon task phase ...`. Grep returns no matches for `scripts/task.sh`. |
| AC-17: `TASK_SH` removed from `env.ts`; grep returns no matches | Pass | `env.ts` verified; grep confirms. |
| AC-18: Entry-point guards removed; `node dist/scripts/run-task.js --help` test passes | Pass | Test at `tests/task-cli.test.ts:366` verifies exit 0 and `Usage: canon run` output. |
| AC-19: `doctor.ts` removes `Bash(jq *)`, `Bash(npx tsx *)`, `checkBinary('jq', true, ...)` | Pass | Verified in diff (`dist/cli/index.js` and source). |
| AC-19a: `deps.ts` removes `jq` from `HARD_DEPS`; `canon init` runs without jq | Pass | Verified in diff. CI smoke confirms jq-less PATH. |
| AC-20: `npm run lint` exits 0 | Pass | Reported in Validation Outcomes. |
| AC-21: `npm run type-check` exits 0 | Pass | Reported in Validation Outcomes. |
| AC-22: `npm test` exits 0; 253 pass / 1 skipped / 0 fail | Pass | Reported in Validation Outcomes. |
| AC-23: `npm run build` produces shebang-headed `dist/cli/index.js` and `dist/scripts/run-task.js` | Pass | Reported in Validation Outcomes. |
| AC-24: `git diff --exit-code -- dist/` exits 0 after fresh build | Pass | With documented caveat (pre-orchestrator-commit diff is expected task artifact; CI gate reruns post-merge). |
| AC-25: CI smoke extended with git-init, orchestrator help, jq-less init/doctor/task-new | Pass | `.github/workflows/ci.yml` diff confirms all required steps present. |
| AC-26: `npm pack` tarball contains only `dist/` and `templates/`; no `scripts/`, `public/` | Pass | Reported in Validation Outcomes. |
| AC-27: `handoff.md` records bootstrap completion command and sequencing | Pass | Handoff "Decisions Made During Implementation" and "Bootstrap self-repair" rows document both. |

### Dropped Sections Check

- [x] Non-goals respected (no new features, no schema changes, no changelog)
- [x] Known Risks addressed: worktree routing reuses existing `resolveTaskCwd()`, release-init second-run guard preserved with exact messages, bundling `import.meta.url` handled (AC-18 removed guards), sidecar decision documented, atomic writes used
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is clean and well-scoped. The task module (`src/task/index.ts`) is a faithful 1:1 TypeScript port of the bash script. Static template imports eliminate the runtime file-read path. The `phaseCommands()` prompt seam correctly emits `canon task phase` so spawned agents receive valid commands. Atomic writes (tmp-file + rename), worktree routing via the existing `resolveTaskCwd()`, and injectable push for `release-init` tests are all handled correctly. Test coverage is comprehensive — real git worktree fixtures for routing, injectable push for release-init, and full subcommand parity including both guard paths.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved** — ship as-is

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
