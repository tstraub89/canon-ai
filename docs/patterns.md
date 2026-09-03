# Implementation Patterns

> Concrete patterns from the actual codebase. Follow these when implementing similar functionality. This prevents agents from inventing new patterns when established ones exist.

## How to use this doc

This is the project's hard-won implementation knowledge. It has two main sections:

1. **Trigger Table** — at the top, an index agents skim to jump to the relevant section. If your task touches an area listed here, the pointed-at section is likely load-bearing for what you're doing.
2. **Known Pitfalls** — failure modes that have bitten the project before, with the rule that prevents them. The orchestrator pre-injects task-relevant pitfalls into Codex's implement prompt; agents still need this file open for spec authorship and code review.

> **Layering rule.** This file is **project-specific** — it holds patterns and pitfalls unique to canon-ai's own internals (or, for adopters, unique to their stack). **Canon-supplied universal rules** (agent discipline, harness behavior, spec/review rules of thumb) are delivered just in time through skills, per-phase prompt templates, and agent charters. Conversational-operator norms for canon-ai live in [`CLAUDE.md`](../CLAUDE.md), which Claude auto-loads at session start. If you're tempted to add a rule here that would apply to *every* canon project, it belongs in a skill or prompt template, not patterns.

> **canon-ai is a CLI orchestrator.** Patterns here are about modifying canon-ai's own harness internals (orchestrator scripts, templates, validation gates). When dropped into a downstream project, this file is rewritten for that project's stack.

## Trigger Table — Scan This First

| Area touched | Section in this file | Key files |
|---|---|---|
| Adding/changing a pipeline phase | Phase Addition Discipline | `src/orchestrator/main.ts`, `src/lib/pipeline-policy.ts`, `src/task/index.ts`, `.canon/templates/status.json` |
| Modifying `pipeline-policy.ts` | Pure Policy + Test Discipline | `src/lib/pipeline-policy.ts`, `tests/pipeline-policy.test.ts` |
| Modifying `status.json` shape | State Schema Discipline | `.canon/templates/status.json`, parsers in `src/orchestrator/state.ts`, `src/orchestrator/git.ts`, `src/orchestrator/validation.ts`, `src/task/index.ts` (`VALID_PHASES`, `assertValidPhase()`) |
| Adding/modifying a validation gate | Validation Gate Discipline | `src/orchestrator/validation.ts`, `src/orchestrator/git.ts`, `src/orchestrator/main.ts`, `tests/run-task-validation.test.ts` |
| Lint / TS suppression / `any` | Lint & Type Safety Policy | `src/orchestrator/prompts/templates/implement.md` |
| Renaming or deleting tracked files | Rename-heavy tasks pass three path-reconciliation gates | `src/orchestrator/validation.ts`, `src/orchestrator/git.ts`, `scripts/docs-refs-check.mjs` |
| Editing operator-facing text (help, errors, banners, prompt lines) | Operator-facing text is often rendered by independently-authored duplicates | `src/cli/index.ts`, `src/orchestrator/cli.ts`, `src/orchestrator/prompts/index.ts` + `templates/` |

## Patterns

### Pure Policy + Test Discipline

**Files**: `src/lib/pipeline-policy.ts`, `tests/pipeline-policy.test.ts`

**When to apply**: Any change that touches tier detection, sizing, model/effort matrices, or loop-cap defaults.

**The pattern**:
- `pipeline-policy.ts` is **side-effect-free**. No I/O, no env reads, no filesystem. Inputs are passed; outputs are returned. Env-var resolution lives in `src/orchestrator/env.ts`; the module receives a fully resolved `PolicyConfig`.
- Decisions are **table-driven**. Matrices keyed off `TaskSize` × `Phase`. Adding a new branch means adding a table cell, not chaining `if`s.
- **Every routing decision has a corresponding test row** in `pipeline-policy.test.ts`. A change to `pipeline-policy.ts` without a corresponding test update is a Stage 1 review failure — the table-driven structure exists *so* tests can cover every cell, and skipping the test means coverage drift.

**Anti-pattern**: writing routing logic directly in `src/orchestrator/main.ts` (`if (size === 'XL' || delicate) ...`). Routing drift was the original motivation for extracting this module — don't reintroduce it.

### Phase Addition Discipline

**Files**: `src/orchestrator/main.ts`, `src/orchestrator/phases/*.ts`, `src/lib/pipeline-policy.ts`, `src/task/index.ts`, `.canon/templates/status.json`

**When to apply**: Anytime a new phase is added to the pipeline (e.g., a new validation gate that warrants its own phase rather than being a sub-step within an existing one).

**The pattern**: Adding a phase touches the orchestrator's phase-aware switches in `src/orchestrator/main.ts`:
1. `PHASE_ORDER` constant (defines the linear sequence)
2. `runPhase()` switch (dispatches to the agent invocation)
3. `checkAndRoute()` switch (decides what happens after the phase completes)

Plus:
5. `src/task/index.ts` `VALID_PHASES` set and `assertValidPhase()` (so the helper accepts the new phase name)
6. `.canon/templates/status.json` (add the new phase entry with a default `status` and `agent`)
7. If the phase has model/effort needs distinct from existing phases: add it to the matrices in `pipeline-policy.ts` and `tests/pipeline-policy.test.ts`
8. Document in `docs/pipeline-orchestrator.md` (handoff sequence + workflow diagram) and any conversational-operator implications in `CLAUDE.md`

**Anti-pattern**: updating only one or two of the switch statements. Missing one produces silent skipping (the orchestrator routes past the phase without running it) or inconsistent routing state.

### State Schema Discipline

**Files**: `.canon/templates/status.json`, parsers in `src/orchestrator/state.ts`, `src/orchestrator/git.ts`, `src/orchestrator/validation.ts`, `src/task/index.ts` (`VALID_PHASES`, `assertValidPhase()`)

**When to apply**: Adding a new field to `status.json`, renaming an existing field, or changing the type/shape of a field.

**The pattern**: A status.json change must update three locations atomically:
1. `.canon/templates/status.json` — the schema source of truth (and what new tasks are scaffolded from)
2. Parsers in `src/orchestrator/state.ts`, `src/orchestrator/git.ts`, and `src/orchestrator/validation.ts` — anything that reads or writes the field. The orchestrator and `parseStatus()`-style helpers both need updates.
3. `src/task/index.ts` `VALID_PHASES` — if the field affects phase transitions, the helper needs to know about it.

For breaking changes (renames, type changes), also: add a migration shim that detects the old shape and either fails loudly or transforms it. Tasks may be in flight when the change lands.

**Anti-pattern**: updating the template but not the parser, or vice versa. The result is silent state corruption (parser writes the new field but old runs read the old field, or vice versa).

### Validation Gate Discipline

**Files**: `src/orchestrator/validation.ts`, `src/orchestrator/git.ts`, `src/orchestrator/main.ts`, `tests/run-task-validation.test.ts`

**When to apply**: Adding a new pre-flight check at a phase boundary (e.g., "the handoff Changes table must match the post-commit `git diff`").

**The pattern**:
- **Per-task checks**: extend `validateHandoff()` (returns a list of issue strings; non-empty = gate fail) or join the `autoCommitCode()` cross-checks. Both are well-tested entry points in `src/orchestrator/validation.ts` and `src/orchestrator/main.ts`.
- **Bundle-wide checks**: add a sibling function at the same call site (after the per-task loop in the `code_review` pre-flight block). `verifyHandoffAgainstDiff()` is the canonical example — it takes `taskIds: string[]` so it can compute a union across bundle members. Expose a `*FromData` test seam so tests don't need a real git repo.
- **Tests are mandatory.** Any new validation rule needs a positive case (passing handoff) and a negative case (failing handoff) in `run-task-validation.test.ts`. Edge cases (empty tables, malformed markdown) need explicit test rows.
- **Failure modes are documented — one message per failure class.** A gate that fails should write a clear rejection message to `review.md` (or equivalent) explaining what to fix. Beyond vagueness: a gate that emits the *same* message for structurally different failure classes trains the implementing agent to fix whichever layer the message names, not the root cause (the code_review pre-flight said "fix the handoff" for real test regressions, so Codex relabeled `Fail` rows instead of fixing the code — looping to the review cap). Enumerate the failure classes and name the correct fix action per class ("fix the handoff" vs. "fix the code" vs. "halt for human"). A single catch-all message means the gate is conflating classes.

**Anti-pattern**: adding a check inline in the middle of `runPhase('code_review')` without a test seam. Both `validateHandoff()` and `verifyHandoffAgainstDiff()` expose seams — any new sibling should too.

### Lint & Type Safety Policy

> Always-applicable rules. *(Canonical home is the `implement` prompt template (`src/orchestrator/prompts/templates/implement.md`); reproduced here for convenience when a contributor is reading patterns mid-task.)*

Suppressing lint or type errors is a last resort, not a convenience escape hatch. Each suppression hides a diagnostic that exists to catch real bugs.

**Lint suppression comments**: never add a suppression without a same-line justification explaining why the rule is wrong for this specific case. If you can't write that justification, the rule is right and the code needs to change.

**`any` / dynamic typing**: `any` propagates silently — once it enters a call chain, every downstream consumer loses type safety. When the shape is truly unknown at the boundary (CLI subprocess output, JSON parsing of agent artifacts), type as `unknown` and narrow explicitly.

## Known Pitfalls

> Hard-won lessons specific to canon-ai's internals. Universal agent-discipline pitfalls (handoff verification, test discipline, name-effects-to-delete, etc.) are delivered just in time via the per-phase prompt templates and agent charters. Conversational-operator norms live in [`CLAUDE.md`](../CLAUDE.md), which Claude auto-loads at session start.

### Adding a phase that updates only some switch statements is a silent-skip footgun.

`src/orchestrator/main.ts` has the phase-aware switches (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`). All of them must gain a case for the new phase. Missing `runPhase()` → the phase appears in order but nothing runs. Missing `checkAndRoute()` → the orchestrator can't decide what comes next. **The failure modes are subtle** — the pipeline may appear to make progress while silently skipping the new phase. Use the Phase Addition Discipline checklist above; reviewers should grep for the phase name across the switches in `main.ts` before approving.

### Modifying `pipeline-policy.ts` without a matching test row is silent coverage drift.

The module is small enough that contributors sometimes treat it as "just data" and skip the test update. But the table-driven structure exists *so* tests can cover every cell — `tests/pipeline-policy.test.ts` is the only thing that catches drift between the matrix's intent and its actual values. A change to a matrix cell without a corresponding test row is a Stage 1 review failure.

### Treat the `delicate` flag as load-bearing for the orchestrator's *own* surfaces.

When working on canon-ai's harness, `delicate: true` should be set for any task that modifies the orchestrator's hot path (phase routing, auto-commit, validation gates, pipeline policy, status.json schema, worktree machinery). See `docs/product-context.md` "delicate flag — project-specific domains" for the canon-ai list. The bar is "an undetected bug here corrupts every task that runs after the change lands" — true for almost every harness modification.

### Don't introduce orchestrator state that lives only in memory across phases.

The architectural decision (see `docs/decisions.md` "File-based handoffs between phases") makes resumability and observability load-bearing. Adding in-memory state that bridges phase boundaries — even seemingly innocuous things like "remember the validation result so we don't recompute it" — breaks both. New cross-phase state goes in a file under `tasks/<id>/` with a documented schema in `.canon/templates/`.

### Use `--name-status`, not `--name-only`, when building path sets from `git diff`

When parsing `git diff -M` output to build a set of changed paths, use `--name-status` instead of `--name-only`. With `--name-only`, rename detection is active but only the post-image path is emitted — the pre-image path is silently suppressed. Any code that checks "is this path in the diff" will false-negative on the pre-image of a renamed file. With `--name-status`, rename lines appear as `R<score>\told\tnew`; expand both sides into the path set. Canonical implementation: `verifyHandoffAgainstDiffFromData()` in `src/orchestrator/validation.ts`.

### Never use blanket `git stash` / `git clean` inside a pipeline phase

After `implement` closes and `autoCommitCode()` runs, only the source files listed in the handoff Changes table are committed. Task artifacts such as `tasks/<id>/handoff.md`, `tasks/<id>/notes.md`, and `tasks/<id>/status.json` can still sit uncommitted in the worktree until the QA-end commit collects the final artifact set. A blanket `git stash --include-untracked`, `git clean -fd`, or any equivalent that sweeps the worktree will erase live pipeline state. Any phase that needs to clean up after itself must compute a pre/post `git status --porcelain=v1 -uall` delta (`postDirty \ preDirty`) and touch only paths in that delta. Explicitly exclude anything under `tasks/` from the cleanup set regardless of what the delta contains. The `PIPELINE_TELEMETRY_FILES` registry in `src/orchestrator/worktree.ts` is the right reference for what the orchestrator considers off-limits to phase-level cleanup.

A corollary: `autoCommitCode()` in `src/orchestrator/main.ts` stages only handoff-table source files, so `tasks/<id>/` stays uncommitted until QA-end and `getScopedDiff()`'s committed-range diff (`git diff <base>...HEAD`) at code_review time naturally excludes all task artifacts — don't add artifact-filtering construction to make a cold review "spec-blind"; it already is, and extra filtering would break same-surface symmetry with the other lenses. If the commit boundary in `autoCommitCode()` ever changes, re-verify this corollary.

### Operator git surgery before first QA can still discard uncommitted pipeline state

Surfaced 2026-05-23 during prepr-base-drift-check's ship cycle. Same root cause class as the blanket-stash pitfall above, different trigger. The implement-phase commit (auto-commit by the orchestrator) commits ONLY the source/test/dist files from the handoff Changes table. Before the first successful QA, task artifacts (`handoff.md`, `review.md`, `notes.md`) and status.json updates from implement/code_review loops can still be uncommitted in the worktree. Operator `git reset --hard <pre-current-commit>` (or `git checkout HEAD~N`, or `git stash drop`, or any operation that discards working-tree state) during this implement-to-first-QA window can revert status.json to an older phase and make canon re-dispatch work that already happened.

The post-QA window is now closed by the QA-end commit: when `qa.status` becomes `done`, `commitQaArtifacts` commits the task artifact dirs, telemetry, and dirty managed docs before the pipeline stops at `human_review`. That means `--pr` always starts from committed post-QA state — but `--reroute` no longer necessarily does: it admits `code_review` and `qa`-pending entry states (see `docs/pipeline-orchestrator.md` §"Human Reroute"), both of which sit before the QA-end commit, so a reroute from either can still start from an uncommitted worktree. The remaining uncommitted-state risk is earlier, before QA has ever completed; per-phase artifact commits would be the broader structural fix for that residual window.

Rule: **don't `git reset --hard`, `git checkout HEAD~N`, `git stash drop`, or any equivalent on a task branch before the first QA-end commit.** If you need to drop a stray commit, prefer `git revert <sha>` — it writes a new commit that reverses the target rather than rewriting history, so the prior tip stays reachable. (`git revert` does modify the working tree and can conflict with uncommitted state; if you have uncommitted pipeline progress, stash explicitly to a named ref first or accept that the revert may surface a conflict you have to resolve by hand.) If the task branch is already corrupted, the recovery path is `canon task phase` to re-mark phases and restore artifacts from the worktree's reachable history or backups.

### Editing managed docs inside a worktree-isolated task — verify dirty before phase close

The orchestrator's `autoCommitCode()` stages only files that appear dirty in the worktree at commit time. Historical pre-commit sync paths that moved worktree edits to the supervising checkout could make protected-doc edits appear clean and silently omit them from the implementation commit. The sync path is gone, but the verification habit still matters for worktree-isolated tasks: when editing protected docs (`docs/decisions.md`, `docs/codebase-map.md`, `docs/patterns.md`, etc.), run `git status` in the worktree before the phase closes and explicitly investigate anything that came up clean unexpectedly.

### Worktree runs: read files and set subprocess cwd from the active checkout, not REPO_ROOT

In a worktree-backed task, `REPO_ROOT` is the supervising checkout (no task edits) and the worktree is the active checkout (has them). Any file read, file write, or subprocess `cwd` that uses `REPO_ROOT` where it should use the active checkout silently operates on the *stale, pre-change* copy. Three instances: (1) a self-hosting guard test read `REPO_ROOT/.gitignore` and passed against pre-change content (`adopter-gitignore-sync`); (2) `runSpecReviewPhase()` / `runPlanPhase()` passed `activeCwd` only into `metricsContext`, not the `runCodex()` / `runClaude()` `cwd` argument, so a reroute ran the agent against the pre-amendment spec (`reroute-spec-review-symmetry`); (3) the resolver-recursion rewire (`worktree-canonical-task-state`). Two coupled traps: use `getActiveCwd()` (not `REPO_ROOT`) for both the subprocess `cwd` **and** file reads/writes; and a **resumed** agent session keeps the project root it was created with — passing a new `cwd` to a resumed session does not relocate it, so clear the session slot (e.g., `sessions.codex_spec_review`) to force a fresh one. Before adding worktree support to any phase or command, check: (a) does every file op and subprocess `cwd` use the active checkout? (b) does any resumed session carry a stale root that would override the new `cwd`? (`process.cwd()` equals `REPO_ROOT` in a normal non-worktree checkout, so using the active root is safe in both environments.) **This applies to test code too**: a test that reads a task-edited file via `REPO_ROOT` (or a `REPO_ROOT`-derived constant or env var) silently reads the stale supervising-checkout copy and misses the current task's edits. Build such paths from `process.cwd()`, which resolves to the active worktree root for orchestrator-spawned test processes. Instances: a README drift test (`canon-inline-review-skill`) and the `tests/run-task-prompts.test.ts` structural assertions (`relocate-rules-to-prompts`).

A companion test rule: any **new task-state mutator** — a function that writes a task's `status.json` in the post-worktree window governed by the "Worktree-canonical task state" decision in `docs/decisions.md` — needs a worktree-routing regression test: a fixture task with both a repo-root copy and a worktree copy of `status.json`, asserting only the worktree copy changes. (Pre-implement scaffold writers like `canon task new` intentionally use REPO_ROOT state per that decision and are out of scope.) The "use `taskDirFor()`" rule alone is easy to violate (Codex used `taskDirFromRoot()` in the first iteration of `task-metadata-helpers`, silently writing the supervising-checkout copy), and without this specific test shape the bug passes every other validation check. Reference fixture: the worktree-routing test in `tests/task-cli.test.ts`.

### When adding a code path on a shared surface, route it through the existing safety queue

When a feature adds a new write/lookup that touches a surface another feature already governs (a queue, a gate, a guard, an allowlist), the new path must flow through the existing infrastructure — never spawn a parallel one. Two real instances from the v1.2.0 release shipping in separate PRs: (1) `canon upgrade` header-only sync (PR #80) wrote directly to disk and pushed to `upgraded[]`, bypassing the `pending` → dirty-refusal → `--check` / `--force` flow that PR #79 added on the same `runUpgrade()` function — Codex P1 on the release PR. (2) `findOpenPRNumber` (PR #75) didn't base-filter even after PR #77 added base-filtering to its sibling `findMergedPRNumber` — Codex P2 on the same release PR. The pattern: when extending a function with a new write/check, grep for the existing queue/guard inside it and join, don't fork. When adding a sibling helper to an existing one, check whether every invariant the original holds applies to the sibling too.

### "Clean tree" is not a proxy for "origin matches HEAD"

`git status --porcelain` returning empty means no uncommitted edits — it does not mean origin is in sync with HEAD. Local commits made after a previous push will leave a clean tree but a divergent origin. Any code path that uses "clean tree" as a proxy for "nothing to push" will silently drop those commits. Canonical fix: always run `git push origin <branch>` before checking remote state; the push is idempotent (no-op when origin already matches the tip, pushes the difference otherwise) and is cheaper than the bug it prevents. The same rule applies symmetrically: "origin/<branch> exists" is not a proxy for "origin matches HEAD" either, and the local remote-tracking ref can be stale if a prior fetch failed. Canonical example: the PR-exists branch of `commitHumanReviewFiles()` in `src/orchestrator/main.ts` always pushes before reporting the existing PR (Codex P1 on release PR #82).

### Bundle-gate conditions must use `every()`, not `some()`, on per-task flags

When a feature applies per-task in a bundle and a task-level flag controls whether a safety check is skipped, the skip condition must require ALL tasks to opt in (`statuses.every(s => s.flag)`), not just one (`statuses.some(s => s.flag)`). Using `some()` means a single opted-in task silently disables the check for every task in the bundle — including tasks the human never opted in. The bug is structurally invisible: it only manifests in mixed-bundle invocations, not single-task runs. Canonical example: `spec-review.ts` full-send gate, fixed from `some` to `every` in the full-send-mode task. Prevention: whenever writing a bundle-level dispatch branch gated on a per-task flag, default to `every()` and explicitly justify it if `some()` is ever chosen.

### `getAffectedFiles` uses three-dot diff semantics — it does not surface base-advancement

`getAffectedFiles` in `src/orchestrator/git.ts` uses a three-dot diff (`git diff <base>...<branch>`) — it reports files the task branch changed *since the merge base*. That is the correct semantic for "what did this branch contribute?" (handoff validation, coverage checks). It does **not** surface files where the base branch advanced without the task branch following. Any gate that answers "how does the task branch's tree compare to current base?" cannot reuse `getAffectedFiles`; it needs a two-dot helper (`git diff <base> HEAD`). Canonical implementation: `getTreeDriftFiles` in `src/orchestrator/git.ts`, added in the prepr-base-drift-check task. When spec-writing a new gate, verify which diff semantic is correct before naming a helper — two-dot and three-dot silently produce wrong results if confused.

### Test-writing pitfalls (canon-specific git/worktree gotchas)

- **Porcelain-delta tests need non-gitignored fixture paths.** `git status --porcelain -uall` doesn't surface gitignored files by design. Tests verifying scoped delta cleanup that write `*.tmp` files (or other extensions matching `.gitignore` patterns) will find an empty delta and pass vacuously — never exercising the cleanup path. Use names that aren't gitignored: `fixture-output.txt`, `test-check-artifact.log`.
- **A new gitignored runtime artifact must also be ignored in test fixture repos.** The inverse of the porcelain pitfall: when a change adds a runtime file to `.gitignore` (e.g., `tasks/**/.pr-number`), fixture repos built by helpers like `makeGitFixture` in `tests/run-task-ship.test.ts` have their own `.gitignore` — without the new pattern, the artifact shows up untracked and fails clean-tree (`git status --porcelain` empty) assertions that have nothing to do with it. When adding a gitignore entry for a runtime file, grep the test suite for fixture-repo setup helpers and mirror the pattern there.
- **Integration tests for process-local registries must seed the handle inside the subprocess.** When orchestrator behavior depends on a process-local registry (e.g., `activeHandles` in `src/orchestrator/heartbeat.ts`), seeding it in the test's parent process and then exercising the production path in a subprocess tests an *empty* registry — module state doesn't cross the process boundary, and `activeHandles` is rebuilt on every fresh import. The subprocess must both seed (call `startHeartbeat` or equivalent) and run the code under test. Before writing such a test, check whether the module resolves its state at load time or call time — load-time resolution forces subprocess-side seeding.
- **Prompt-context changes require regenerating the golden snapshot fixtures.** Prompt builders (`promptQa`, `promptCodeReview`, …) are snapshot-tested against `tests/run-task-prompts.golden.json`. Any change to what a prompt injects — new template variables, new sections, changed default text — fails `npm test` with a golden diff even when lint and type-check pass. Regenerate the fixture and list it in the spec's Affected Files; check sibling golden fixtures for other prompt types before assuming only one needs updating.
- **Subprocess tests for `main.ts` must use the active worktree's cwd.** When tests spawn the canon CLI (`node dist/orchestrator/run-task.js` or `tsx src/orchestrator/main.ts`) inside a linked worktree, subprocess `cwd` must be the active worktree root — not the supervising checkout's root. The wrong root loads stale compiled artifacts or source files from a different checkout, so changes that exist only in the current worktree are invisible to the test. Failure is silent (the test passes against old behavior). Derive cwd from `import.meta.url` / `__dirname` resolved relative to the test file, or pass `process.cwd()` explicitly when the suite is invoked from the worktree root.
- **Env-override tests must set the env var after import — not at module load time.** When testing a function that resolves a config value from an env var at call time, mutate `process.env` AFTER the module import and BEFORE the call. If production code accidentally captures the var at module load (`const REPO = process.env.X ?? DEFAULT` at top level), a test that sets the var pre-import passes while the production bug goes undetected. Canonical: the `CANON_UPSTREAM_REPO` call-time tests for `captureCanonSnapshot()`.
- **New pre-spawn/input validation on a shared call site retroactively invalidates placeholder fixtures.** Adding fail-fast validation to a widely-shared function (a runner, a client, a resolver) can break existing tests that passed a placeholder/sentinel value for a parameter irrelevant to what they exercise — the new guard fires before the test reaches its intended branch. Four `tests/run-task-safety.test.ts` fixtures used the literal string `effort` as a placeholder while targeting later subprocess branches; a new effort-validation guard rejected it pre-spawn. Before implementing such a guard, grep *every* test file that calls the site for placeholder values in the newly-validated parameter — not just the spec's Affected Files — so the fixture fix lands as a planned deviation.
- **Migration-tolerance fixtures for retiring schema keys must build the key dynamically.** When testing that a parser tolerates a legacy schema key (e.g., a retired phase block), the fixture must construct the key by concatenation (`'runtime_' + 'validation'`) or read it from a helper constant — never as a literal — if the codebase has a structural grep AC prohibiting the retiring symbol outside an allow-list. A literal occurrence in the test file would itself violate the grep, invalidating the structural check. Pairs with the `*FromData` injectable-input pattern.
- **`commitHumanReviewFiles()` reads module-level `cliArgs` — tests that need flag behavior must route through `main()`.** `commitHumanReviewFiles()` in `src/orchestrator/main.ts` reads the module-level `cliArgs` object that `parseArgs()` populates when `main()` is invoked. Tests calling `commitHumanReviewFiles()` directly cannot set `cliArgs` from outside the module — they must spawn `main()` with the appropriate argv. Follow the subprocess pattern in `tests/run-task-safety.test.ts` (real-git fixture + subprocess invocation) when adding tests for any flag-gated branch.
- **Module-load-time path constants that reference repo files are a test-pollution hazard.** When a module computes a file path from `REPO_ROOT` at load time (`const METRICS_FILE = path.join(REPO_ROOT, 'docs/...')`), any test that spawns a child process importing canon modules writes to the real repo file. The fix: add a `CANON_*_FILE_OVERRIDE` env-var pattern so spawned test processes can redirect writes to a temp path. Add a suite-end `git status -s docs/` cleanliness assert that catches any future path of this kind. Canonical pattern: `getMetricsFile()` with `CANON_METRICS_FILE_OVERRIDE` in `src/orchestrator/metrics.ts`.
- **Canonicalize real git worktree paths on both sides of a comparison.** On macOS, git reports a worktree created under `os.tmpdir()` canonically under `/private/var/...` even though the test's own call supplied the `/var` alias — so a bare string-equality assertion between a fixture path and git's reported worktree path fails on spelling, not on routing logic, and only on macOS (Linux CI has no such symlink to expose the gap). Run both sides through `fs.realpathSync`, or neither. The same asymmetry can reach production code: the content-based worktree scan in `resolveTaskCwd()` (`src/orchestrator/state.ts`) returns git's canonicalized path while by-id resolution returns a `path.join(...)` — two strings for one directory. Don't let one resolver branch canonicalize and another not.
- **Before building a fixture for a negative-space edge case, drive the real tool and confirm it can produce that exact state.** A fixture asserting against a state the tool under test cannot generate is vacuous no matter how carefully it's built — and its careful construction makes the vacuity look like coverage. `git status --porcelain=v1 -uall` always expands an untracked directory into its file contents, and a trailing-slash ignore rule hides a real directory outright, so no `.gitignore` choice yields a bare `<path>/node_modules` entry for a real directory. The fixture built to prove that case kept approximating the unconstructible shape (asserting on a child path, then on a loose regex) across four consecutive code_review rounds before a spec amendment renamed the AC's fixture to one the suite could actually build. When a spec names a specific fixture shape, repro it against the real tool first; if it can't be produced, fix the AC's wording rather than refining the fixture around the gap.
- **ESM entry-point modules that double as test subjects need an `import.meta.url` guard.** When a Node ESM entry-point module (a CLI main file) needs to be importable by tests — so the test can exercise code that installs at module top-level, such as a signal handler — the direct-run code must be guarded with `if (import.meta.url === pathToFileURL(process.argv[1]).href)`. Without the guard, importing the module in a test triggers `main()` and runs the full application. The guard is transparent to the normal CLI path. Canonical example: `src/orchestrator/run-task.ts` with its SIGHUP handler exercised by `tests/run-task-signals.test.ts`. Reach for this pattern any time a test needs to inspect top-level side effects of an entry-point module rather than spawn it as a subprocess.

### Decouple operation-success from cleanup-success — tolerate a failed post-op cleanup of an irreversible op

When an irreversible operation (PR merge) is followed by a cleanup step (remote branch delete), do not let a cleanup failure abort the overall command. The pre-AC-14 `mergeOpenPRsAndPull` called `gh pr merge --squash --delete-branch`; when GitHub's "auto-delete head branches" had already removed the branch, `gh` exited non-zero on the delete step and canon died — after the merge had already landed. The half-complete state (PR merged, worktree stranded) is worse than the incomplete cleanup. The fix: decouple the two steps and classify the outcome by checking whether the irreversible step succeeded, not by whether the full compound command exited zero. Canonical implementation: `classifyMergeOutcome({ exitOk, mergeConfirmed })` + `isPRMerged(prNum)` in `src/orchestrator/main.ts`. The preserved `assertOriginTaskBranchAbsent` call is the second-layer safety net in the tolerated path.

### Use the attempted `prNum` to confirm merge — not the branch name

When tolerating a `gh pr merge` failure, confirm the **specific PR number** that was just attempted (`isPRMerged(prNum)` — `gh pr view <prNum> --json state`), never a branch-based query like `findMergedPRNumber(branch, baseBranch)`. The branch-based query returns the most-recent merged PR for that branch/base combination: if a branch name was reused after an earlier merged PR, the query falsely confirms the *current* (failed) merge as succeeded, hiding a real merge failure. With a prNum-specific query, the only failure mode is a gh transient error returning false on a genuinely merged PR — that case `die()`s and reverts to today's behavior (fails safe). Canonical example: `main.ts:1397–1401`, introduced in base-divergence-gate AC-14 after the spec's Codex spec-review round surfaced the branch-reuse trap.

### Orchestrator survives supervising-shell death; the stall timer still detects hangs

Before this fix, a backgrounded `canon run <id>` could die silently when the supervising shell exited: Node took the default SIGHUP termination path, the orchestrator vanished, and the in-process stall timer died with it. The fix is to install the SIGHUP handler at module top-level in `src/orchestrator/run-task.ts` and sever child stdin in `src/orchestrator/agents/stream.ts`; after that, the orchestrator survives supervising-shell exit and the existing stall timer remains the detection layer for genuinely hung agents. The remaining detach-mode and heartbeat follow-up stays in the harness-bugs entry in `docs/BACKLOG.md`.

### Declare `templates/` mirrors of canon-managed edits in BOTH the spec Affected Files and the handoff Changes table

Editing any canon-managed file (anything in `CANON_OWNED` or `DELIMITED` in `src/lib/canon-owned.ts`) makes the pre-commit hook regenerate its `templates/<path>` mirror via `sync-canon-templates.mjs`. That mirror lands in `git diff <base>...HEAD`, so it must be declared at two stages or a gate rejects it:

- **Spec stage**: list each mirror in the spec's Affected Files (a "Generated Artifacts" row). Omitting them makes `spec_review` flag the missing generated-artifact rows and force a revision (bit `canon-spec-review-rename` at round 2).
- **Implement/handoff stage**: list each mirror in the handoff Changes table. The `code_review` pre-flight reconciles the cumulative branch diff against the table; a mirror in the diff but absent from the table fails the handoff (bit `code-review-counter-reset-helper`).

For every edited canon-managed root path, look up its `templates/<path>` counterpart and declare both. (`docs/` managed docs are auto-allowlisted at the `--pr` base-drift gate once `qa.status === 'done'`, but the spec/handoff declarations are still required.)

The inverse bites too: a doc living under `docs/` is not automatically canon-managed, so its root copy may have *no synced mirror* at all — `docs/decisions.md` is deliberately root-only (the `templates/docs/decisions.md` that exists is a generic init scaffold, not a mirror; the sync script operates only on the `CANON_OWNED`/`DELIMITED` registry and ignores it), unlike `docs/pipeline-orchestrator.md`, which is registry-managed and does get mirrored. Declaring or editing a mirror counterpart for a root-only doc fails at the `code_review` handoff-diff preflight — a declared mirror row that never appears in the diff (or an undeclared mirror edit that does) is rejected there, not by `sync-templates:check`. Before writing an Affected Files or handoff Changes row for any `docs/*.md` edit, grep `src/lib/canon-owned.ts` for the path; if absent, the edit is root-only and adding a mirror row is itself the bug (bit `cold-codex-review-invocation-policy` — a task amending both docs in one spec must treat them asymmetrically).

### Rename-heavy tasks pass three path-reconciliation gates that disagree — design to the strictest

Canon checks a rename set in three separate places, and they are not interchangeable: auto-commit's `findUncoveredTrackedChanges()` at `implement` close, `code_review`'s `verifyHandoffAgainstDiff()` pre-flight, and `--pr`'s base-drift `getTreeDriftFiles()`. They disagree on whether *both* sides of a rename must be declared or just *either*, and on whether a directory-prefix declaration is accepted. They also do not fire weakest-first — the strictest gate (auto-commit: both sides required, no directory prefix) fires **first**, so passing a later, more lenient gate is never evidence the earlier one will hold.

The correct token form also differs *per artifact*, not per task: `spec.md` is exempt from `docs-refs-check` (`isNoisySourceFile()` in `scripts/docs-refs-check.mjs`) so it can backtick both sides of every rename, while `handoff.md` is not exempt and needs `[old](old)` + `` `new` `` for the same rename — collapsing both files to one consistent form breaks a different gate. Before writing a spec's Affected Files or a handoff Changes table for any change that renames or deletes ≥1 tracked file: declare both sides of every rename unless a specific gate is verified to accept one-sided declaration, and check `isNoisySourceFile()`'s current exemption list per artifact to pick the token form. Verified empirically across 47 renames (94 path-sides) in `relocate-orchestrator-to-src`.

### When a git batch subprocess can exit 128, isolate the bad input by bisection — not token-shape filtering

When a batched git command (`git check-ignore --stdin -z`, `git cat-file --batch`, …) exits 128 on certain inputs, do not pre-filter inputs by token shape (dropping whitespace-bearing or leading-dash tokens). That guesses wrong about the real triggers — for `git check-ignore` they are outside-repo and symlink-traversal paths, not whitespace or flags — and it drops legitimate inputs (a gitignored path with a space in its name is real and should flow through). Instead bisect on exit 128: if a batch of >1 exits 128, split it in half and recurse; a single unprocessable input resolves to "omit" without poisoning its siblings. This is robust to any future 128-causer with no shape enumeration. Cost over ~1000 items: ~21 spawns vs. ~977 for a per-item fallback. Canonical implementation: `collectGitIgnoredTargets` in `scripts/docs-refs-check.mjs` (two reroutes tried shape-filtering before measurement found the real causers).

### Strip flags from the re-exec child argv; don't gate parent-only code on an inherited env var

When `detachAndExit()` re-execs the process (same argv plus `CANON_DETACHED=1`), an env-var guard meant to run code only in the parent (`if (process.env.CANON_DETACHED !== '1') { … }`) is also inherited by every subprocess the orchestrator later spawns — agent runners, test processes, nested `main()` — silently skipping the parent-only code there too. Scope parent-only behavior by stripping the relevant flag from the child argv in `detachAndExit()` itself (`src/orchestrator/detach.ts`): the child re-enters `main()` without the flag and skips the path, while later subprocesses launched with a fresh argv are unaffected. Canonical case: stripping `--reroute` so `rerouteFromHumanReview()` runs parent-only. Whenever re-exec behavior must differ between parent and child (or between the child and its own subprocesses), reach for argv manipulation over inherited env state.

### Write-safety guards must fail closed when the underlying probe errors

When a guard gates a destructive write on an external probe (`git status`, a network check, a filesystem stat), treat a probe *error* the same as a "dirty"/unsafe result — never as "clean." A guard that fails open on probe error is a bypass, not a safety net. Canonical case: `tools/strip-canon-block.mjs`'s dirty-tree check first treated a non-zero `git status` exit as "unknown → allow write"; code review changed it to refuse on any probe failure. Prevention: every new write-safety guard needs a test where the probe itself fails (e.g. `git` unavailable or exiting non-zero) asserting refusal, not permission.

### Build a state-dependent operator message from one parameterized clause builder — and pin it with a state-varying pair

When a persisted operator-facing message mixes a state-independent fact (what a recovery command does) with a state-dependent one (what runs next from *this* state), writing the second as a separately-authored sentence appended to the first lets it drift out of sync — and the obvious test (`assert.match` for the substring, run once per state) locks the wrong text in rather than catching it, because it only proves the wording is present *somewhere*, not that it is correct for the state the fixture is in. `preroute-review-loop-autoblock` hit this exact shape twice: the round-2 fix for a reset message that falsely promised "another implementation pass" was still possible appended a new trailing clause that was itself written state-independent, and was false at the backstop checkpoint. Generate the state-dependent clause from an explicit state argument inside a single shared builder consumed by every caller, and pin it with a test asserting *opposite* outcomes across a state-varying pair (`match` in state A, `doesNotMatch` in state B) — never `match`-only.

### A rule homed on multiple guidance surfaces must reach every tier — and carry its full predicate at every occurrence

Two coupled failure modes when homing a rule across canon's guidance surfaces (skills, task templates, prompt templates). **(1) Tier coverage**: a rule that names a reviewer checkpoint as its enforcement point gives false confidence on tiers where that reviewer doesn't run — fast-tier (XS non-delicate) skips `spec_review`, so a rule homed only in the spec_review prompt silently reaches nobody on the tier most likely to need it (bit `spec-bugfix-diagnosis-rule`). Home rules on the author-facing surfaces and frame them as the author's own obligation, with an explicit call-out that the reviewer may not run; grep for "reviewer will catch" / "spec_review will" in guidance targeting a fast-tier audience. **(2) Predicate integrity**: when a conditional escape clause with multiple conjuncts appears on several surfaces, every occurrence must state the full predicate — dropping one conjunct on one surface silently widens the escape (a surface rendering only "if a direct test is impractical" would have let any hard-to-test case skip verification). When a spec defines a multi-conjunct escape, add a verification step that greps all target surfaces for the shortened single-conjunct form and rejects any hit.

### A git trackedness classifier must check dirty/status output before it checks `ls-files`

A staged deletion (`git rm <path>`) removes the path from `git ls-files` entirely while `git status --porcelain` still reports it (`D  <path>`). A classifier that checks `ls-files` for trackedness first will see "not tracked, not on disk" and classify a staged-deleted tracked file as `absent` — silently recreating it and defeating any refusal logic built on trackedness. Check the dirty/status set first, and fixture both `rm` (working-tree) and `git rm` (staged) as separate cases — they take different code paths even though they represent "the same" deletion. Canonical: the destination classifier in `src/cli/commands/upgrade.ts` + `tests/cli.test.ts` (code review caught the ordering bug empirically in `upgrade-destination-classification`).

### Apply a gate exemption before every decision that reads the same dirty set — not just the one that throws

When adding an exemption to a commit/dirty-tree gate, filtering only the visible classification point (the "unexpected files" allowlist check) is insufficient if other control-flow decisions in the same function branch off the same raw count or set. `commitHumanReviewFiles()` in `src/orchestrator/main.ts` brackets its allowlist filter with three other decisions keyed on the raw `dirtyEntries` count (clean-tree push/PR retry, no-dirty-to-commit `die`, no-stage-paths `die`); exempting a verified `node_modules` symlink only at the allowlist would have swapped one abort for another on a symlink-only tree. Trace every decision upstream and downstream of the classification point that reads the same count or set, and apply the exemption before all of them (bit `worktree-node-modules-gate-carveout`).

### A non-zero agent exit is not a completed review — recovery must park, not read the artifact

`checkAndRoute()` recovery once trusted any verdict extractable from a review artifact when the phase was not yet `done`, regardless of how the preceding agent invocation exited. A returning non-interactive Codex `spec_review` crash—out-of-credits, auth, network, or MCP—could therefore read the prior round's verdict from cumulative `spec-review.md`, fabricate a review, and inflate the durable iteration counters used by `autoBlockSpecReview`. A non-zero exit cannot distinguish a completed review followed by shutdown noise from a crash that never updated the artifact. The safe rule is to test `phase === 'spec_review' && lastCodexExitStatus !== 0` via `shouldParkCrashedReview()` before `recoverPhaseForTask()`, then park with an actionable error and exit `2` instead of reading evidence or retrying. This is scoped to `spec_review`: `code_review` is Claude-owned and sees a forced Codex exit status of `0`, while a crashed Claude exits before recovery. When extending recovery for any phase, treat a non-zero agent exit as incomplete unless a stronger phase-specific completion signal already exists.

### A bundle secondary must be resolved by worktree content, never by a mutable main-checkout write

`ensureBranch`'s first-implement worktree bootstrap creates **one** worktree named after the bundle leader (`.canon/worktrees/<leader>/`), which inherits every member's `tasks/<id>/status.json` from base. A secondary task has no worktree of its own — its `resolveTaskCwd` resolution must find the leader's worktree by *content*, not by writing a branch hint into the secondary's main-checkout copy (that was the original bug: the write landed in `REPO_ROOT` because resolution needs the branch set to find the worktree, but the write is what sets it — a chicken-and-egg that dirtied main on every bundle run).

The fix: `resolveTaskCwd` (`src/orchestrator/state.ts`) scans existing git worktrees via `git worktree list --porcelain` and treats a worktree as owning the task only when its **own** `tasks/<taskId>/status.json` reads cleanly, records `worktree === true`, **and** its `branch` equals that worktree's own checked-out branch. All three conditions matter: content alone would false-match an unrelated worktree that merely inherited the task dir from base; `worktree === true` alone would false-match a stale divergent branch that happens to share a branch name. The scan fails closed — not skip-to-`REPO_ROOT` — on two distinct failure modes: `git worktree list` erroring/exiting non-zero (enumeration-failed), and a present candidate `status.json` that exists but doesn't validate (malformed JSON or a schema-invalid field like a non-string `branch`) — either would otherwise silently re-route a secondary's writes back to main. `ensureBranch`'s companion bootstrap loop writes every member's branch directly to `<leaderWorktree>/tasks/<member>/status.json` (or the `CANON_TASKS_DIR_OVERRIDE` root when set) via `readStatusFromPath`/`writeStatusToFile` — never `readStatus`/`writeStatus`, which would re-enter this same resolver for a secondary before the loop has populated the copy the scan depends on.

Anti-pattern: caching the `git worktree list` result across `resolveTaskCwd` calls to save the repeated subprocess cost. `resolveTaskCwd` is called far more often than once per phase (every status read/write, every heartbeat tick), but a worktree can be created or torn down mid-process — see "Don't introduce orchestrator state that lives only in memory across phases" above. The subprocess is cheap and local; accept the repeated cost rather than risk a stale cache silently reproducing the original bug in a new form.

### Operator-facing text is often rendered by independently-authored duplicates — grep the surface class, not the file you remember

When a task updates a piece of operator-facing or agent-facing text (CLI help, error/abort messages, banners, prompt lines naming a file or rule), "the place this is stated" is frequently two or more separately-authored renderers that happen to agree today, reached through different code paths — and a spec whose Affected Files names only the remembered one ships the fix to half the surface. `relax-reroute-gate-post-implement` hit this twice in one task: the `--reroute` help text is authored independently in `src/cli/index.ts` (top-level `canon --help`) *and* `src/orchestrator/cli.ts` `printUsage()` (`canon run --help`), caught only in spec_review round 2; then `archive-review-on-reroute` found the "prior findings at `review.md`" pointer duplicated across `promptImplementReroute()` and `promptSpecReview()`'s reroute branch in `src/orchestrator/prompts/index.ts`. Before finalizing a spec's Affected Files for any such text, grep the whole surface class for the same substring or filename (all help renderers, all message builders, all prompt templates and builders) and classify every hit — one alignment pass does not remove the structural drift risk, so the grep is due again on every subsequent edit.

## Quick Reference: "I Want To..."

| I want to... | Section above | Start at |
|---|---|---|
| Add a new pipeline phase | Phase Addition Discipline | `src/orchestrator/main.ts` `PHASE_ORDER` |
| Change which model a phase uses | Pure Policy + Test Discipline | `src/lib/pipeline-policy.ts` |
| Add a new per-task validation check at code_review entry | Validation Gate Discipline | `src/orchestrator/validation.ts` `validateHandoff()` |
| Add a new bundle-wide validation check at code_review entry | Validation Gate Discipline | `src/orchestrator/validation.ts` `verifyHandoffAgainstDiff()` (canonical sibling example) |
| Add a new field to status.json | State Schema Discipline | `.canon/templates/status.json` |
| Update phase status from a script | `docs/pipeline-orchestrator.md` | `canon task phase` |
| Run multiple related tasks together | `docs/pipeline-orchestrator.md` | `canon run a b c` |
