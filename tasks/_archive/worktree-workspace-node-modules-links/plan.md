# Implementation Plan: worktree-workspace-node-modules-links

> Written by: Claude | Implements: `tasks/worktree-workspace-node-modules-links/spec.md`

## Approach

Generalize the single root `node_modules` link pair into a list: root pair (unchanged) + one pair per eligible workspace directory. Three new/changed pieces in `scripts/run-task/worktree.ts`, all exported so `scripts/run-task/main.ts` and tests can reach them:

1. `isContainedIn(candidateAbsPath, rootAbsPath)` — one containment primitive, realpaths both sides, compares via `path.relative` (segment-wise, not string-prefix). Used for rule 5 (source), the linker's destination check, and the gate's destination check.
2. `resolveWorkspaceDirs(repoRoot)` — the single source of truth for "which workspace directories are eligible," called fresh at each use site (no cross-phase caching, per the in-memory-state pitfall in `docs/patterns.md`).
3. `probeNodeModulesEntry(candidatePath, expectedTargetPath)` — generalized to take an explicit expected-target path instead of assuming `<repoRoot>/node_modules` (AC-6).

`ensureWorktree()` iterates root-then-workspace pairs; `isExemptNodeModulesEntry()` in `main.ts` reuses the same resolver and containment helper so the two consumers can't diverge (this is the explicit risk called out in *Known Risks* / "Divergence between the two consumers").

The spec-review nit (non-blocking, in `spec-review.md`) is folded in directly: a workspace directory that is **absent** from the worktree (`lstat` → `ENOENT`) is an info-level, silent-ish skip (AC-5); a workspace directory that **exists but fails containment** (dangling symlink, permission error, or a resolved escape) is a warning-level skip (AC-3). These are different code paths, not different log levels on the same check — see Step 3.

## Steps

### Step 1: `isContainedIn` — the shared containment primitive

Files: `scripts/run-task/worktree.ts`

Add near the existing `realpathOrNull` helper (`worktree.ts:118`):

```ts
export function isContainedIn(candidateAbsPath: string, rootAbsPath: string): boolean {
    const resolvedCandidate = realpathOrNull(candidateAbsPath);
    const resolvedRoot = realpathOrNull(rootAbsPath);
    if (resolvedCandidate === null || resolvedRoot === null) return false;
    const rel = path.relative(resolvedRoot, resolvedCandidate);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
```

`path.relative` on two realpaths is inherently segment-wise (it walks common path *segments*, not characters), so `/parent/wt` vs `/parent/wt-evil` and `REPO_ROOT` vs a sibling `REPO_ROOT-evil` both resolve correctly without extra logic — `path.relative('/parent/wt', '/parent/wt-evil')` is `'../wt-evil'`, which starts with `..`. Returns `false` (non-contained) whenever either side's realpath fails — this is the fail-closed direction required for both the linker (write nothing) and the gate (don't exempt). `candidateAbsPath === rootAbsPath` also returns `false` ("strictly beneath", not "equal to" — matches rule 5's wording).

This single function serves three call sites per the Implementation Notes: rule 5 (source vs `REPO_ROOT`), the linker's destination check (worktree workspace dir vs worktree root), and the gate's destination check (cwd workspace dir vs cwd).

### Step 2: `resolveWorkspaceDirs` — the workspace resolver

Files: `scripts/run-task/worktree.ts`

Add a private pattern-extraction helper and the exported resolver, placed after `isContainedIn`:

```ts
function extractWorkspacePatterns(pkg: unknown): string[] {
    if (typeof pkg !== 'object' || pkg === null) return [];
    const workspaces = (pkg as { workspaces?: unknown }).workspaces;
    let raw: unknown[];
    if (Array.isArray(workspaces)) {
        raw = workspaces;
    } else if (
        typeof workspaces === 'object' && workspaces !== null &&
        Array.isArray((workspaces as { packages?: unknown }).packages)
    ) {
        raw = (workspaces as { packages: unknown[] }).packages;
    } else {
        return [];
    }
    const patterns: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        if (entry.startsWith('!')) {
            warn(`Ignoring negated workspace pattern (not supported): ${entry}`);
            continue;
        }
        patterns.push(entry);
    }
    return patterns;
}

export function resolveWorkspaceDirs(repoRoot: string): string[] {
    let pkg: unknown;
    try {
        pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    } catch {
        return [];
    }
    const patterns = extractWorkspacePatterns(pkg);
    if (patterns.length === 0) return [];

    const candidates = new Set<string>();
    for (const pattern of patterns) {
        let matches: string[];
        try {
            matches = fs.globSync(pattern, {
                cwd: repoRoot,
                // Pruning optimization only — exclude receives a mix of basenames
                // and repo-relative paths, so the node_modules-segment rejection
                // below must still run as a post-filter on results.
                exclude: (name) => name === 'node_modules',
            });
        } catch {
            continue;
        }
        for (const match of matches) candidates.add(match);
    }

    const eligible: string[] = [];
    for (const candidate of candidates) {
        const normalized = candidate.split(path.sep).join('/');
        if (normalized === '' || normalized === '.') continue;
        const segments = normalized.split('/');
        if (segments.includes('node_modules')) continue; // rule 4
        if (segments.includes('..')) {
            warn(`Skipping workspace pattern outside REPO_ROOT: ${normalized}`);
            continue; // rule 5, lexical half
        }
        const absPath = path.join(repoRoot, normalized);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(absPath); // follows symlinks; dangling -> caught below
        } catch {
            continue; // unresolvable candidate: absent from result, no throw (AC-2)
        }
        if (!stat.isDirectory()) continue; // rule 2
        let pkgJsonStat: fs.Stats;
        try {
            pkgJsonStat = fs.statSync(path.join(absPath, 'package.json'));
        } catch {
            continue; // rule 3
        }
        if (!pkgJsonStat.isFile()) continue;
        if (!isContainedIn(absPath, repoRoot)) {
            warn(`Skipping workspace outside REPO_ROOT (symlink escape): ${normalized}`);
            continue; // rule 5, realpath half
        }
        eligible.push(normalized);
    }
    return [...new Set(eligible)].sort();
}
```

Notes:
- Rule 3 is existence-only per the spec's Non-Goals — never read/parse the workspace's own `package.json` contents.
- `fs.globSync` needs `@types/node` ^22.19 (confirmed present) — no other dependency change.
- Dedup + sort happens twice in effect (`Set` for candidates from possibly-overlapping patterns, then a final `Set` + `.sort()` on the eligible array) — harmless and keeps the sort/dedupe step self-contained and independently testable in isolation from the candidate-gathering loop.
- A `package.json` that fails to parse yields `[]`, not a throw (Implementation Notes).

### Step 3: Generalize `probeNodeModulesEntry`

Files: `scripts/run-task/worktree.ts`

Change the signature from `(candidatePath, repoRoot)` (which internally assumes `<repoRoot>/node_modules`) to `(candidatePath, expectedTargetPath)`:

```ts
export function probeNodeModulesEntry(
    candidatePath: string,
    expectedTargetPath: string,
): { verdict: NodeModulesLinkVerdict; lstatKind: NodeModulesLstatKind; resolvedTarget: string | null } {
    const lstatKind = probeNodeModulesLstatKind(candidatePath);
    const resolvedTarget = lstatKind === 'symlink' ? realpathOrNull(candidatePath) : null;
    const expectedTarget = realpathOrNull(expectedTargetPath);
    const verdict = classifyNodeModulesLinkFromData({ lstatKind, resolvedTarget, expectedTarget });
    return { verdict, lstatKind, resolvedTarget };
}
```

`classifyNodeModulesLinkFromData` is untouched (already pure, already takes `expectedTarget` as a resolved string — AC-6 requires no change there). Every existing caller must now pass the *full* expected `node_modules` path, not a repo root:
- `worktree.ts` root-pair call site (Step 4) passes `repoModulesSrc` (`path.join(REPO_ROOT, 'node_modules')`) instead of `REPO_ROOT`.
- `main.ts:724` (`isExemptNodeModulesEntry`, Step 5) passes `path.join(REPO_ROOT, 'node_modules')` instead of `REPO_ROOT`.

### Step 4: `ensureWorktree()` — root pair + workspace pairs

Files: `scripts/run-task/worktree.ts`

Keep the existing root-pair block (`worktree.ts:173–197`) exactly as-is except for the `probeNodeModulesEntry` call signature update (Step 3). Immediately after it (still inside `ensureWorktree()`, still before the `.env` file linking block), add the workspace loop:

```ts
if (fs.existsSync(repoPackageJson)) {
    for (const ws of resolveWorkspaceDirs(REPO_ROOT)) {
        const srcModules = path.join(REPO_ROOT, ws, 'node_modules');
        if (!fs.existsSync(srcModules)) continue; // AC-5: hoisted, silent skip

        const wtWsPath = path.join(wt, ws);
        let wsLstat: fs.Stats;
        try {
            wsLstat = fs.lstatSync(wtWsPath);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                info(`Workspace '${ws}' not present in worktree; skipping node_modules link.`);
            } else {
                warn(`Could not inspect worktree workspace '${ws}' (${(err as Error).message}); skipping node_modules link.`);
            }
            continue;
        }
        void wsLstat;

        if (!isContainedIn(wtWsPath, wt)) {
            warn(`Workspace '${ws}' resolves outside the worktree (or is unresolvable); skipping node_modules link.`);
            continue;
        }

        // Operate on the resolved directory so we don't re-traverse an
        // already-validated symlink chain.
        const resolvedWsDir = fs.realpathSync(wtWsPath);
        const wsModulesPath = path.join(resolvedWsDir, 'node_modules');
        const probe = probeNodeModulesEntry(wsModulesPath, srcModules);
        switch (probe.lstatKind) {
            case 'missing':
                fs.symlinkSync(srcModules, wsModulesPath);
                info(`Symlinked node_modules into worktree workspace '${ws}'.`);
                break;
            case 'symlink':
                if (probe.verdict === 'not-exempt') {
                    die(
                        `Worktree setup aborted: ${wsModulesPath} is a symlink but does not resolve to ` +
                        `${srcModules} (found: ${probe.resolvedTarget ?? 'unresolvable target'}). ` +
                        `Remove or fix the stray symlink before retrying.`
                    );
                }
                break;
            case 'file':
            case 'directory':
                break;
            case 'error':
                die(`Worktree setup aborted: could not inspect ${wsModulesPath} (lstat failed).`);
                break;
        }
    }
}
```

Notes:
- `wsLstat` is computed only to distinguish `ENOENT` (absent, info) from other errors (warning) per the spec-review nit; it isn't otherwise consumed, hence `void wsLstat` to keep lint quiet (or just drop the assignment and inline the try/catch check — either is fine, prefer whichever reads cleaner to the implementer).
- The root pair keeps writing directly to `wtModules = path.join(wt, 'node_modules')` — no resolved-path indirection needed there since the destination has no intermediate segment to escape through (per *Interaction Dependencies*).
- Order matches AC-4/AC-5 exactly: source-missing check first (silent), then worktree-path-absent check (info), then containment (warning), then classification (die/tolerate/link).

### Step 5: Widen `isExemptNodeModulesEntry()`

Files: `scripts/run-task/main.ts`

Replace the current body (`main.ts:718–725`):

```ts
function isExemptNodeModulesEntry(entry: PorcelainEntry, cwd: string): boolean {
    if (entry.paths.length !== 1) return false;
    // Untracked-only: a staged node_modules (e.g. `git add -f`) is a deliberate
    // departure from canon's own worktree symlink and must still hit the
    // normal staged-files safety checks, not be waved through as clean.
    if (entry.indexStatus !== '?' || entry.worktreeStatus !== '?') return false;
    const entryPath = entry.paths[0];

    if (entryPath === 'node_modules') {
        return splitWorktree.probeNodeModulesEntry(
            path.join(cwd, 'node_modules'),
            path.join(REPO_ROOT, 'node_modules'),
        ).verdict === 'verified-symlink';
    }

    // Workspace-level exemption applies only when a distinct worktree is
    // active. When worktree: false, cwd === REPO_ROOT and "does <cwd>/<ws>
    // verify against <REPO_ROOT>/<ws>" degenerates into comparing a path with
    // itself — a tautology that would wave through an adopter-created
    // symlink canon never made. Fail closed (non-exempt) if realpath itself
    // errors — that should not happen for cwd/REPO_ROOT in practice, but a
    // write-safety guard treats a probe error as unsafe, never as safe.
    let cwdReal: string;
    let repoRootReal: string;
    try {
        cwdReal = fs.realpathSync(cwd);
        repoRootReal = fs.realpathSync(REPO_ROOT);
    } catch {
        return false;
    }
    if (cwdReal === repoRootReal) return false;

    const ws = splitWorktree.resolveWorkspaceDirs(REPO_ROOT).find(w => entryPath === `${w}/node_modules`);
    if (!ws) return false;

    if (!splitWorktree.isContainedIn(path.join(cwd, ws), cwd)) return false;

    return splitWorktree.probeNodeModulesEntry(
        path.join(cwd, ws, 'node_modules'),
        path.join(REPO_ROOT, ws, 'node_modules'),
    ).verdict === 'verified-symlink';
}
```

Both call sites (`commitQaArtifacts` inline filter at `main.ts:839–841`, `commitHumanReviewFiles` upstream `dirtyEntries` filter at `main.ts:1228–1229`) call `isExemptNodeModulesEntry` unchanged — no relocation, per the spec's "Gate widening" section and the "apply exemption before every decision that reads the same dirty set" pitfall in `docs/patterns.md`. Since `commitHumanReviewFiles` filters `dirtyEntries` upstream (not just at the final `unexpected` check), the exemption already reaches the clean-tree push/PR-retry branch (`main.ts:1236`) and the no-dirty-to-commit `die` (`main.ts:1265`) for free — no additional plumbing needed there, just confirm with AC-7's fixture test (Step 7).

`fs` is already imported in `main.ts` (used throughout) — no new import needed. `splitWorktree.resolveWorkspaceDirs` and `splitWorktree.isContainedIn` need to be exported from `worktree.ts` (done in Steps 1–2 via `export`).

### Step 6: Docs — `docs/pipeline-orchestrator.md` (AC-12)

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`

At `docs/pipeline-orchestrator.md:309`, the sentence currently reads:

> A top-level `node_modules` entry is exempt from both this gate's dirty-tree check and the `human_review` dirty-tree check below when a filesystem probe confirms it's canon's own worktree symlink resolving to `REPO_ROOT/node_modules`; anything else at that path (a real file/directory, or a symlink pointing elsewhere) still blocks normally.

Reword to cover workspace entries in one added sentence, e.g.:

> A top-level `node_modules` entry, or a verified symlink at `<workspace>/node_modules` for an eligible npm-workspaces directory (declared in root `package.json`'s `workspaces` field, itself containing a `package.json`, and contained in both `REPO_ROOT` and the active worktree), is exempt from both this gate's dirty-tree check and the `human_review` dirty-tree check below when a filesystem probe confirms it resolves to the corresponding `REPO_ROOT` path; anything else at that path (a real file/directory, a symlink pointing elsewhere, or an entry that fails containment) still blocks normally. The workspace-level exemption only applies when a distinct task worktree is active.

Do **not** hand-edit `templates/docs/pipeline-orchestrator.md` — it's regenerated by the pre-commit sync hook (`docs/patterns.md` "Canon templates auto-sync from root"). After editing the root doc, run `npm run sync-templates` (or let the pre-commit hook do it) and verify with `npm run sync-templates:check`.

### Step 7: Tests

Files: `tests/run-task-safety.test.ts`

**7a. Fixture builders.** Add alongside the existing `makeGitFixture` / `makeNodeModulesGateFixture` / `makeEnsureWorktreeNodeModulesFixture` (`tests/run-task-safety.test.ts:561–655`):

- `makeWorkspaceResolverFixture(dir, layout)` — a plain temp-dir builder (no git needed) that writes a `package.json` with a given `workspaces` value plus a directory tree per the AC-1/AC-2 fixture spec (`packages/a/package.json`, `packages/a/src/`, `packages/a/node_modules/dep/package.json`, `packages/b/package.json`, `packages/notapkg/nested/`, `apps/app/package.json`, `packages/file.txt`, plus optionally a sibling `../outside/ext/package.json` and a `packages/escape` symlink target outside the fixture root). Call `resolveWorkspaceDirs(fixtureRoot)` directly — this is a pure-fs unit test, no subprocess needed (it doesn't touch git or `REPO_ROOT`-derived module state).
- Extend `makeNodeModulesGateFixture` (or add a workspace-aware sibling) to also create `<ws>/package.json` + `<ws>/node_modules` in the source checkout and commit them, for the gate-side AC-7/AC-8/AC-9 tests.
- Extend `makeEnsureWorktreeNodeModulesFixture` (or add a sibling) with a workspaces variant for AC-4/AC-5/AC-11: source has `packages/a/node_modules` and `packages/b/node_modules`; the branch commits `packages/a` and `packages/b` as ordinary directories (or, for the AC-3 red-first case, `packages/a` as a symlink to an external directory).

**7b. AC-1 / AC-2 — resolver unit tests.** One `test()` per bullet in the spec's AC-1 and AC-2, asserting exact array equality (`assert.deepEqual`, not `.includes`/`some`) against `resolveWorkspaceDirs(fixtureRoot)`. Include:
- All eight `workspaces` value shapes from AC-1 (glob, multi-pattern, literal, overlapping/dedupe, legacy object form, no-match, empty array, absent, non-array string, non-string entries, negation-with-warning — capture the warning via a `warn` spy or by checking `resolveWorkspaceDirs` doesn't throw and returns the right array; canon's `warn()` writes to stderr via `cli.ts`, so a stderr-capturing wrapper works if a spy isn't convenient).
- The `{"version":"1.0.0"}`-only manifest case (rule 3 never reads manifest contents).
- AC-2's `../outside/ext` case and the `packages/escape` realpath-escape case, both asserting the escaped path is absent from the result and a warning names it.
- The dangling-symlink-candidate case (absent from result, no throw).
- Structural assertion across all AC-1/AC-2 fixtures: every returned path is relative, non-empty, not `.`, no `..` segment, no `node_modules` segment.
- The `../outside/ext` fixture driven through `ensureWorktree()` (via `runEnsureWorktreeInline`, following the existing pattern at `tests/run-task-safety.test.ts:897–908`): assert the sibling `outside/` tree is byte-for-byte unchanged (same `fs.readdirSync` listing before/after, `node_modules` still absent) and the widened gate predicate's exempt set contains no `..`-segment entry (call `isExemptNodeModulesEntry`... — this is a private function, so instead assert indirectly: build a `PorcelainEntry` for `../outside/ext/node_modules` and confirm `commitQaArtifacts`/gate flow treats it as unexpected, or test `resolveWorkspaceDirs` directly and confirm no `..` path is ever returned, which is the structural assertion above and is sufficient — don't invent a new export just for this).

**7c. AC-3 — destination containment.** Four tests:
1. **Red-first real-git fixture.** Both `packages/a/node_modules` and `packages/b/node_modules` exist in the source checkout; on the task branch, `packages/a` is committed as a symlink to an outside directory (no `node_modules`) and `packages/b` stays a real directory. Run `ensureWorktree()` via `runEnsureWorktreeInline`. Assert: exit 0; stderr names `packages/a`; the outside directory's entries are unchanged (snapshot `fs.readdirSync` before/after) and still has no `node_modules`; `<worktree>/packages/b/node_modules` is a symlink realpath-equal to the source. This must fail against a source-containment-only implementation (i.e., write this test first and confirm it fails without the destination check, per the spec's explicit red-first framing).
2. **Dangling worktree-side symlink.** `<worktree>/<ws>` exists as a symlink to a nonexistent target. Assert exit 0, a warning naming `<ws>`, no `die`.
3. **Gate, direct predicate unit test.** Since `isExemptNodeModulesEntry` isn't exported, test it indirectly through `commitQaArtifacts`: build a fixture where a hand-crafted porcelain-visible entry `<ws>/node_modules` exists at a path whose `<cwd>/<ws>` realpaths outside `cwd` (a symlinked workspace dir escaping the worktree, with a `node_modules` marker file placed at the *outside* target so the entry is visible in porcelain per AC-9), and assert `commitQaArtifacts` (via `runCommitQaArtifactsInline`) treats it as non-exempt (dies with the QA-end-allowlist message). This satisfies AC-3's intent (a synthesized entry exercising the destination-containment predicate) within the existing subprocess-fixture test style, without needing a new export.
4. **Segment-wise sibling case.** A worktree at `<parent>/wt` and a sibling `<parent>/wt-evil`; a workspace path resolving into `wt-evil` is non-contained. This can be asserted directly against the exported `isContainedIn(candidate, root)` as a small unit test (it's exported, unlike the gate predicate) — cheaper and more precise than routing through git fixtures. Also assert the same for `REPO_ROOT` vs a sibling `REPO_ROOT-evil` directory.

**7d. AC-4 / AC-5 — per-workspace linking in `ensureWorktree()`.** Using the workspaces variant of `makeEnsureWorktreeNodeModulesFixture` (7a), parametrize over the same variants as the existing root test (`missing`, `verified-symlink`, `file`, `directory`, `wrong-target-symlink`) but for a workspace path (e.g. `packages/a`), asserting the same outcomes the root test already asserts (symlink realpath equality / preserved content / non-zero exit naming the offending path) — mirror `tests/run-task-safety.test.ts:2309–2346` structurally. Add: an eligible workspace with **no** source `node_modules` is skipped without error and without a link (AC-5 hoisted case) — assert sibling workspaces still link. Add: an eligible workspace whose directory doesn't exist in the worktree at all is skipped with an info-level message and exit 0 (AC-5 absent case) — assert no warning-level message for this case specifically (distinguishing it from the AC-3 warning cases per the nit).

**7e. AC-6 — probe generalization, no drift.** No new test required beyond confirming the existing decision-table tests (`classifyNodeModulesLinkFromData` at `tests/run-task-safety.test.ts:1990–2027`) and existing root-only `probeNodeModulesEntry`/`ensureWorktree` tests pass unchanged against the new signature (they will, since the root call site is updated to pass the equivalent resolved path).

**7f. AC-7 / AC-8 / AC-9 — gate tests.** Extend the existing node_modules gate test cluster (`tests/run-task-safety.test.ts:2153–2307`):
- A workspace-aware version of "commitQaArtifacts exempts the verified node_modules worktree symlink" (`:2153`) and "commitHumanReviewFiles pushes a tree dirty only with the verified node_modules symlink" (`:2181`), each with **≥2** verified symlinks (root + one nested workspace) — AC-7 requires this multiplicity explicitly to guard the "N verified symlinks behave as a clean tree" clause.
- A workspace-aware version of "commitHumanReviewFiles still blocks a force-staged node_modules symlink" (`:2223`) and "commitQaArtifacts still rejects non-exempt node_modules entries" (`:2270`) for a nested path — plus the new case AC-8 calls out explicitly: `packages/notapkg/nested/node_modules` (a path under a directory that matched a glob but failed rule 3) must be non-exempt.
- **AC-8's no-worktree regression case** (red-first for the tautology): a workspaces-shaped fixture run with `worktree: false` (`cwd === REPO_ROOT`), a porcelain-visible untracked `<ws>/node_modules` symlink via a trailing-slash `.gitignore`, asserting the gate aborts (non-exempt) rather than taking the clean-tree path. Write this test before the worktree-active guard exists in `main.ts` and confirm it fails without the guard, then confirm it passes with it.
- **AC-9's anti-vacuity companions**: for the workspace fixtures above, assert `git status --porcelain -uall` actually shows the nested symlink under the trailing-slash `.gitignore` rule (mirroring `:2296`'s bare-rule companion, which already proves the inverse for the root case — add the nested-path version of both directions).

**7g. AC-10 — no-workspaces regression.** No `workspaces` field in the fixture `package.json`: assert every existing root-only test in this file still passes unmodified. This is satisfied by *not* changing any existing root-only test's assertions — flag in the handoff if any pre-existing test needed a shared-fixture-helper tweak (allowed) vs. an assertion change (not allowed, would indicate regressed behavior).

**7h. AC-11 — teardown safety.** A fixture worktree with the root symlink plus ≥1 workspace symlink (via `ensureWorktree()`), then `teardownWorktree(taskId)`, asserting no error and that every source `node_modules` (root + workspace) still exists with its content intact afterward.

**7i. New decision-table rows.** Wherever the existing `classifyNodeModulesLinkFromData` decision-table tests live (`:1990–2027`), no new rows are needed there (the function is unchanged) — but add a small decision-table-style test for `isContainedIn` covering: same path, nested-contained, sibling-escape (`wt` vs `wt-evil`), unresolvable candidate, unresolvable root.

## Testing Plan

- **Unit**: `isContainedIn` decision table (7i); `resolveWorkspaceDirs` over the AC-1/AC-2 fixture matrix (7b) — pure fs, no subprocess.
- **Integration (real-git fixtures + subprocess)**: `ensureWorktree()` workspace variants (7d), the AC-3 destination-escape red-first case (7c-1), gate exemption/rejection cases (7f), teardown (7h) — following the existing `runEnsureWorktreeInline` / `runCommitQaArtifactsInline` / `main()`-via-argv subprocess patterns already in this file.
- **Manual**: none beyond the spec's Human Test Plan, which is out of scope for an agent to execute (requires a real adopter monorepo) — note this in the handoff for the human reviewer.

## Rollback Plan

Fully additive to existing root-`node_modules` behavior (AC-10 pins zero drift for no-workspaces repos) and gated behind `resolveWorkspaceDirs` returning `[]` whenever a repo has no `workspaces` field. If a regression surfaces post-merge, reverting the single commit/PR restores prior behavior with no data migration — `status.json` schema is untouched (spec's *Data Model Changes*: None) and no persisted state depends on the new code paths.

## Reroute Plan

### Context

Round-5 `code_review` returned `spec_gap`: the Decision section's categorical "Repos without a `workspaces` field see no behavior change" (`spec.md:72` pre-amendment) contradicted amended-at-the-time AC-8/AC-10 language about the final-segment `node_modules` rejection. This was a **spec-only** defect — the reviewer's own amendment-review verdict states the current (Iteration 5) implementation is "already correct against the amended text." Two spec edits resolved it (both already reflected in the spec.md now on disk):

1. Decision line 72 now reads "...with the one exception named in AC-10..." instead of the unqualified "no behavior change."
2. AC-8's real-directory parenthetical now names the tracked-parent/untracked-child fixture shape (an untracked file inside the real `<ws>/node_modules` directory) instead of the previously-unconstructible bare-entry claim.

The amendment-review round-2 verdict is **Approved**, unconditionally — no residual spec issue.

### Delta

Prior plan Steps 1–7 (containment helper, resolver, probe generalization, `ensureWorktree()` workspace loop, gate widening, docs, tests) are unaffected and already implemented through handoff.md Iteration 5. This round's delta is verification-only, not a new implementation pass:

1. **Confirm no code delta is needed.** `main.ts`'s final-segment `node_modules` rejection (Iteration 5 / R4-1, `main.ts:774`, `784`, `1435`) and its AC-10 "narrower safety invariant" framing already match the amended Decision/AC-10 text verbatim — the amendment reworded the spec to match already-shipped behavior, not the other way around. Do not re-touch `scripts/run-task/worktree.ts` or `scripts/run-task/main.ts` on this account.
2. **Confirm the test evidence already matches the corrected AC-8 fixture shape.** Iteration 5's real-directory fixture (handoff notes it asserts porcelain reports an untracked child inside a real `<ws>/node_modules` directory, mirroring the amendment's corrected parenthetical) is the fixture AC-8 now describes — grep `tests/run-task-safety.test.ts` for the real-directory / tracked-parent-untracked-child case and confirm it matches; do not add a second fixture for the same shape.
3. **Grep for stale wording pinned to the old contradiction.** Check `docs/pipeline-orchestrator.md` (and its `templates/` mirror) and any handoff/test comment text for the literal old claim ("no behavior change" with no stated exception) per the "retired wording needs a semantic sweep" lesson (`docs/lessons-learned.md`) — Iteration 5's R4-5 docs update already reworded this, so this is a spot-check, not new authoring.
4. **If confirmation is clean (expected outcome):** append an `## Iteration 6 — addressing spec amendment` section to `handoff.md` stating explicitly that no production code or test changes were required, re-run the full validation suite (`npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run sync-templates:check`, `npm run docs-refs-check`) to produce a fresh Pass row set attributable to the amended spec, and resubmit for `code_review`.
5. **If confirmation instead finds a stale assertion or doc sentence still pinned to the pre-amendment wording:** fix only that specific assertion/sentence — do not reopen or re-derive any AC-1–AC-11 evidence already marked Met in the AC Coverage table; match the fix to its blast radius (a wording correction, not a re-implementation pass).
