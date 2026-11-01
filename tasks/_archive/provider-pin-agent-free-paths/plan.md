# Implementation Plan: provider-pin-agent-free-paths

> Written by: Claude | Implements: `tasks/provider-pin-agent-free-paths/spec.md`

## Approach

Two small, independent fixes: (1) in `main()` skip provider resolution when `cliArgs.ship && !cliArgs.dryRun`, but still read and validate every `status.json`; (2) in `doctorCmd`, when `CANON_PROVIDER` is invalid, require only the agent backends common to every supported provider (derived, `{claude}` today) instead of guessing `mixed`.

Spec-review nit incorporated: structure the startup block as map-then-conditionally-resolve. The `.map` callback (task-id validation, status.json existence check, `readStatusFromPath` → `validateStatus`) runs for every mode; only the `resolveBundleProvider(...)` call is gated.

### Feasibility check

- **Exists:** `main.ts` startup try block (`runProvider = splitPolicy.resolveBundleProvider(cliArgs.taskIds.map(...))`, ~L4040); `runProvider` module-level `let ... | null` (L214) with `providerForTasks` fallback (L215); `shipTasks` (L2425–2784); `resolveBundleProvider`/`resolveTaskProvider` (`src/orchestrator/policy.ts:108-118`); `PROVIDERS`, `requiredAgentBackends`, `roleAssignmentFor` (`src/lib/pipeline-policy.ts`); `doctorCmd` guess at `doctor.ts` (~L729-735). Test helpers `makeStatus`, `prepareShipFixture`, `runCanon` (`tests/run-task-ship.test.ts`), `runReviewLoopMain(..., step)` and `writeReviewLoopFixture` (`tests/run-task-safety.test.ts`), `runDistCli` (`tests/cli.test.ts`). All found by grep.
- **Real path:** `main()` → `parseArgs` → startup try block → `checkDeps(skipAgentDeps)` → (dryRun branch → `buildPipelineState` → `providerForTasks`) → `if (cliArgs.ship) shipTasks()`. Grep of `providerForTasks|assignmentForTasks|roleName|buildPipelineState` shows no hit inside `shipTasks` (L2425–2784); the L2955 `roleName` hit is in the reroute function, not ship. `checkDeps` calls `assignmentForTasks` only under `!skipAgentDeps` (L3944). `validateStatus` does not check `provider`, so the read still passes for a bad pin. Existing code already doing part of the work: the `ship`-aware `statusFile` selection in the map callback — kept as is.
- **Callers:** `resolveBundleProvider` / `resolveTaskProvider` contracts are unchanged (no edits to `policy.ts`). `runProvider` consumers: only `providerForTasks`; on the ship path none is reached. `doctorCmd` is only called from the CLI dispatcher; no signature change.
- **Tests that can fail:** AC-1/AC-2 use a `provider` pin of `'bogus'` / a `claude`+absent bundle through `prepareShipFixture`, so pre-fix code dies at startup with `Invalid provider` / `Cannot run a mixed-provider bundle`. AC-7 sets `CANON_PROVIDER=bogus`; pre-fix prints `✓ codex` and `✓ codex project trust`. AC-4/5/6 pass on pre-fix code (they pin behavior kept); verify AC-4/5 are red if the gate is widened to `cliArgs.ship` alone (temporarily change to `cliArgs.ship` and confirm AC-5 turns red with a stack).
- **Predicates:** gate is `cliArgs.ship && !cliArgs.dryRun`. Four combos: neither → resolve; ship only → skip; dry-run only → resolve; ship+dry-run → resolve. Empty `taskIds`: `.map` yields `[]`, skip is harmless. Doctor: unset/empty setting → `mixed` (unchanged); valid → unchanged; invalid → intersection. Intersection over `PROVIDERS` must be derived (not hard-coded) and must be non-empty-safe (empty set just yields no agent checks).
- **Scope:** all files below are in the spec's Affected Files. `PROVIDERS` is imported in `doctor.ts` straight from `../../lib/pipeline-policy.js` (check existing import lines there). `dist/` is rebuilt by `npm run build`.
- **Async/stateful:** `main()` startup block is synchronous. `runProvider` stays `null` on the ship path; Known Risk (a future provider read on ship would re-resolve and throw with a stack) is documented in the test comment for AC-1 and not otherwise mitigated.

## Steps

### Step 1: Gate provider resolution in `main()`

Files: `src/orchestrator/main.ts`

Replace the single `runProvider = resolveBundleProvider(map(...))` expression inside the try block with:

```ts
try {
    const statuses = cliArgs.taskIds.map(id => {
        splitCli.validateTaskId(id);
        const mainFile = path.join(REPO_ROOT, 'tasks', id, 'status.json');
        const statusFile = cliArgs.ship && fs.existsSync(mainFile) ? mainFile : splitState.statusFileFor(id);
        if (!fs.existsSync(statusFile)) die(`No status.json at tasks/${id}/status.json — run canon task new ${id} first`);
        return splitState.readStatusFromPath(statusFile, id);
    });
    // --ship (without --dry-run) spawns no agent, so a bad pin must not block merge/archive.
    // --dry-run still resolves: buildPipelineState re-resolves outside this try and would throw with a stack.
    if (!cliArgs.ship || cliArgs.dryRun) runProvider = splitPolicy.resolveBundleProvider(statuses);
} catch (error) { die(error instanceof Error ? error.message : String(error)); }
```

Keep the existing comment style (short, why-only). Leave `skipAgentDeps` and everything else untouched.

### Step 2: Doctor invalid-setting checks

Files: `src/cli/commands/doctor.ts`

Replace the `requiredAgents` computation:

```ts
const requiredAgents = new Set(providerError
    ? PROVIDERS.map(p => new Set(requiredAgentBackends(roleAssignmentFor(p)))).reduce((a, b) => new Set([...a].filter(x => b.has(x))))
    : requiredAgentBackends(roleAssignmentFor(provider)));
```

(or a small named helper `agentBackendsEveryProviderNeeds()` in the same file if clearer). Keep `provider = 'mixed'` initializer only if still needed for the `providerCheck` detail; with `providerError` set the detail uses the error. Downstream `requiredAgents.has('codex')` guards already omit the Codex binary and project-trust checks. Exit code stays 1 via the failing provider check.

### Step 3: Tests — ship (`tests/run-task-ship.test.ts`)

- Extend `makeStatus(taskId, branch, provider?)` to set `status.provider` when given; thread a `providers?: Record<string, unknown>` option through `prepareShipFixture` (map taskId → pin value) into the `makeStatus` calls (both the local fixture and `simulateMergeOnOrigin`'s `statuses`, which already reuses the same objects).
- AC-1: `ship-invalid-pin`, pin `'bogus'`, same env as the happy test (`FAKE_GH_PR_STATE: 'MERGED'`, etc.). Assert `status === 0`, output doesn't match `/Invalid provider/`, `expectArchivedAndDeleted(...)`.
- AC-2: two tasks, pins `claude` and absent; follow the bundle fixture shape at the `--ship bundle proof` test with `prNumbers` for both; assert exit 0, no `/Cannot run a mixed-provider bundle/`, both archived (check `tasks/_archive/<id>` per task as `expectArchivedAndDeleted` does).
- AC-6: after `prepareShipFixture`, rewrite `tasks/<id>/status.json` in the working tree with an invalid `branch` (e.g. `"bad branch"`; confirm `validateBranchField` rejects it before choosing the value) and assert exit 1, the existing validation message, `doesNotMatch(stderr, /^\s+at /m)`.
- AC-5 (ship + dry-run) belongs in the safety file (below), as spec says.

### Step 4: Tests — dry-run (`tests/run-task-safety.test.ts`)

Next to `provider validation refuses invalid pins...` (leave it untouched, AC-3): add one test using `writeReviewLoopFixture` with a `bogus` pin and `runReviewLoopMain(localDir, tasksRoot, bins, 'a', 3, ['--dry-run'], {}, false)` (last arg `step=false`) for AC-4: exit 1, `/Invalid provider/`, `doesNotMatch(output, /^\s+at /m)`. AC-5: same with `['--ship', '--dry-run']`, plus assert the task directory still exists and is not archived.

### Step 5: Test — doctor (`tests/cli.test.ts`)

Add a test beside the existing doctor/init provider test (leave that unchanged, AC-8), reusing its env setup (fake `claude` in `bins`, `PATH` restricted, `HOME: dir`, `CANON_PROVIDER: 'bogus'`; run `init` with `CANON_PROVIDER: 'claude'` first so templates exist). Assert: status 1; stdout matches `/Provider \(CANON_PROVIDER setting\).*Accepted values: mixed, claude/`; matches `/^\s+[✓✗!] claude\b/m`; `doesNotMatch(stdout, /^\s+[✓✗!] codex\b/m)` (label-anchored per spec-review nit, covers both `codex` and `codex project trust`). Note the existing `doesNotMatch` there uses unanchored `✗.*codex`; the new one must not.

### Step 6: Docs

Files: `docs/pipeline-orchestrator.md`, `docs/architecture.md`, `docs/decisions.md`

- `pipeline-orchestrator.md` ~L240: after "refused before any phase starts." add that `canon run --ship` (without `--dry-run`) does not resolve provider pins, and that `canon doctor` with an invalid `CANON_PROVIDER` reports the failing provider check and skips the Codex checks. Adopter-readable wording only (no canon-ai paths).
- `architecture.md` L108: append "(`--ship` skips this resolution)" clause.
- `decisions.md` L589: add "`--ship` without `--dry-run` skips this resolution since it spawns no agent."
- Root-only for `architecture.md` and `decisions.md` (no mirror, confirm via `grep -n "architecture.md\|decisions.md" src/lib/canon-owned.ts`). The pre-commit hook mirrors `pipeline-orchestrator.md` to `templates/docs/`; run `npm run sync-templates` and verify.

### Step 7: Build and validate

Run `npm run build` (updates `dist/cli/index.js`, `dist/orchestrator/run-task.js`), then `npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check`. Per project memory, `run-task-safety` linked-worktree guard message may fail as the single known baseline failure only if this diff doesn't touch it; report any other failure as-is. Red-first check: stash Steps 1–2, run the new AC-1/2/7 tests and confirm they fail, restore.

## Testing Plan

- **Unit/integration:** AC-1, AC-2, AC-6 (ship file); AC-4, AC-5 (safety file); AC-7 (cli file). AC-3 and AC-8 are existing tests, unchanged.
- **Red-first:** AC-1, AC-2, AC-7 must fail on pre-fix code; AC-4/5/6 guard retained behavior (confirm AC-5 turns red under an over-broad `cliArgs.ship` gate).
- **E2E:** Human Test Plan in the spec (needs a real finished task; not runnable here).
