# Implementation Plan: docs-refs-validate-cited-paths

> Written by: Claude | Implements: `tasks/docs-refs-validate-cited-paths/spec.md`

## Approach

Replace the wholesale "skip line-cited refs" short-circuit in the class-1 backtick file-ref path with strip-then-validate. Introduce one module-private helper, `stripLineCitation(target)`, and call it at the two sites that handle class-1 bare backtick refs so the gitignore-candidate set and the check-site lookup key on the same stripped path. Leave `isLineCitationTarget` and the symbol/section/anchor handlers untouched — they are out of scope and keep their current behavior.

This is the minimal change that both closes the inverted-validation gap (cited refs go from never-checked to path-checked) and fixes the comma-list false positive, without broadening any other gate.

## Steps

### Step 1: Add `stripLineCitation()` helper

Files: `scripts/docs-refs-check.mjs`

Add a module-private function near the existing `isLineCitationTarget` (`scripts/docs-refs-check.mjs`). It strips a *trailing* line-citation suffix and returns the bare path; non-citation input is returned unchanged. Reuse the dash class already used by `isLineCitationTarget` (`[-–—]`, ASCII/en/em).

Grammar to strip (end-anchored, digits-only, never alpha):
- colon form: `:` followed by a comma-separated list of `N` or `N-N` spans — e.g. `:151`, `:151-254`, `:151,254`, `:151,254-260`, `:10,20,30`.
- GitHub anchor form: `#L` followed by a comma-separated list of line/range items, with optional `L` on later items — e.g. `#L151`, `#L151-L160`, `#L10,L20`.

Suggested implementation (mechanics deferred — implementer may adjust so long as the AC-1 cases hold):

```js
function stripLineCitation(target) {
    const span = '\\d+(?:[-–—]\\d+)?';                       // 151 or 151-254 (any dash)
    return target
        .replace(new RegExp(`:${span}(?:,${span})*$`), '')   // foo.ts:151,254 -> foo.ts
        .replace(/#L\d+(?:[-–—]L?\d+)?(?:,L?\d+(?:[-–—]L?\d+)?)*$/, ''); // foo.ts#L10-L20 -> foo.ts
}
```

Keep it module-private. Export it only if you prefer direct unit assertions for AC-1 (AC-2/AC-3 already pin the observable behavior through `runChecks`); if you do export it, let the pre-commit `sync-templates` hook regenerate `templates/scripts/docs-refs-check.mjs.d.ts` — do not hand-edit the mirror or the `.d.ts`.

### Step 2: Strip in the gitignore-candidate collector

Files: `scripts/docs-refs-check.mjs`

In `collectCandidateTargetPaths`, the first `matchAll` loop adds bare backtick refs:

```js
for (const match of line.matchAll(/`([^`]+)`(?!\s+in\s+`|\s+§")/g)) {
    targets.add(match[1]);
}
```

Change the add to `targets.add(stripLineCitation(match[1]));` so the gitignore-candidate set keys on the stripped path. Leave the other three `matchAll` loops in this function unchanged (symbol-in-file, section, anchor-link).

### Step 3: Strip-then-validate at the class-1 check site

Files: `scripts/docs-refs-check.mjs`

In `findBrokenRefs`, the class-1 handler currently reads:

```js
for (const match of line.matchAll(/`([^`]+)`(?!\s+in\s+`|\s+§")/g)) {
    const refText = match[0];
    const target = match[1];

    if (isLineCitationTarget(target)) continue;          // <- remove this line
    if (!target.includes('/') && path.extname(target) === '') continue;
    ...
}
```

- Keep `refText = match[0]` (full original ref, so findings show the citation).
- Replace `const target = match[1];` + the `isLineCitationTarget` short-circuit with `const target = stripLineCitation(match[1]);`.
- Leave every subsequent gate (`isPlaceholderTarget`, `validDirs` top-level check, `gitIgnoredTargets.has(target)`, the `fs.existsSync`/`isFile` existence check) exactly as-is — they now run on the stripped path.

Do **not** touch the symbol-in-file, section `§`, or anchor-link handler blocks; their `isLineCitationTarget` short-circuits stay.

### Step 4: Tests

Files: `tests/docs-refs-check.test.ts`

Add cases alongside the existing `line-citation refs …` test (which stays for AC-4):

- **AC-2**: doc with `` `scripts/fixture-target.ts:151,254` `` + the fixture file present → `runChecks(root)` returns `[]`.
- **AC-3**: doc with `` `src/does-not-exist.ts:151,254` `` (and a single `:151` and a range variant) → one `missing file` finding each, asserting the finding's `ref` still contains the full citation suffix.
- **AC-5**: doc referencing a gitignored path with a trailing `:N` → no finding (stripped base path is gitignore-matched). Follow the existing gitignore test's fixture pattern in this file (writes a `.gitignore`, inits a temp git repo via the existing `makeTempRepo` helper).
- **AC-1** (optional): if `stripLineCitation` is exported, add direct assertions for the representative inputs in the spec; otherwise AC-1 is covered transitively by AC-2/AC-3.

Use the existing `makeTempRepo` / `writeFile` helpers already in the test file — match their structure.

### Step 5: Validate against the live tree (AC-7)

Files: (none — verification step)

Run `npm run docs-refs-check` against the repo. If it surfaces a previously-hidden broken ref (a real missing base path behind an existing line citation), fix the offending ref in its doc and record it in `handoff.md`. Do not weaken the checker to silence it.

## Testing Plan

- **Unit**: new cases in `tests/docs-refs-check.test.ts` for AC-2, AC-3, AC-5 (and AC-1 if exported); existing `line-citation refs …` and symbol/section/anchor tests stay green (AC-4, AC-6).
- **E2E**: N/A — no runtime surface.
- **Manual**: per the spec's Human Test Plan — add a comma-cited ref to a real file (passes), then repoint it at a missing path keeping the citation (now fails with full ref shown).

Full validation gate: `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`. No `npm run build` (script is not bundled into `dist/`).

## Rollback Plan

Pure revert of the `scripts/docs-refs-check.mjs` and test diffs (the `templates/` mirror re-syncs from the reverted source via the pre-commit hook). No data migration, no schema change, no persistent state. Worst case if reverted: the checker returns to skipping line-cited refs wholesale — i.e. the prior behavior — with no residual effect.

## Reroute Plan

Implements the `## Amendment` in `spec.md` (AC-8, AC-9, AC-10, AC-7 re-confirm). The Round-1 strip-then-validate logic is correct and stays — this round only hardens the gitignore-skip batch and makes its test discriminating.

### Step R1: Make the gitignore batch poison-proof (AC-8)

Files: `scripts/docs-refs-check.mjs`

In `collectGitIgnoredTargets`, the `safe` filter currently drops only `./`, `../`, `/`, and `http(s)` prefixes. Extend it so non-path tokens can't reach `git check-ignore` and trip exit 128. Add to the filter predicate (mechanics deferred; intent is what matters):

- drop empty strings,
- drop entries starting with `-` (flag-like: `--force`, `-f`),
- drop entries containing whitespace or control characters (command snippets, prose: `canon run`, `state=… reason=…`).

These tokens can never be gitignore matches, so dropping them is loss-free for correctness and removes the poison. Keep real path candidates (e.g. `.claude/settings.local.json`, `docs/foo.md`) untouched.

Preserve the existing **outside-a-git-repo** degradation: when `git check-ignore` exits 128 because there is no repo (not because of a bad input), the function must still return an empty set and the run degrades to "no skip" exactly as today. Only the in-repo, poison-token failure mode changes. (If the implementer judges the safe-filter alone insufficient — e.g. an exotic in-repo token still trips 128 — a defense-in-depth fallback that retries/per-path-checks rather than globally discarding the set is acceptable, but the simple filter is expected to suffice and is preferred for minimality.)

Consider applying the same path-shape restriction at the `collectCandidateTargetPaths` source if cleaner, but the `safe`-filter location is preferred since it already owns the check-ignore-input contract and is the single choke point both candidate-collection passes funnel through.

### Step R2: Make AC-5 discriminating (AC-9)

Files: `tests/docs-refs-check.test.ts`

Replace/augment the Round-1 `'gitignored target paths are skipped when the ref is line-cited'` test so it can only pass through the gitignore gate:

- fixture under a **valid** top-level dir that is also gitignored (so the `validDirs` gate does not short-circuit it),
- include at least one **poison token** (e.g. a backtick `` `--force` `` or `` `npm run lint` ``) in the same fixture tree, so the test would fail if the batch-robustness regressed,
- assert `runChecks(root)` returns `[]`.

This test must fail if either the dual-site stripping OR the batch-robustness is removed.

### Step R3: Guard the prior regression (AC-10) and re-confirm the tree (AC-7)

Files: `tests/docs-refs-check.test.ts` (verify only), then run `npm run docs-refs-check`

- Confirm `'gitignored skip survives parent-relative anchor links elsewhere in the repo'` still passes (the `../AGENTS.md` exit-128 guard must not regress).
- Run `npm run docs-refs-check` against the full worktree and confirm exit 0 — specifically that `review.md`'s own `` `.claude/settings.local.json:151,254` `` is now gitignore-skipped, not reported missing. This is the end-to-end proof the reroute worked.

### Validation

Same gate as Round 1: `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`. No build.

## Reroute Plan Round 2

Implements `## Amendment Round 2` (AC-11; AC-8/AC-10 re-confirm). Addresses the Codex P2: the batch-hardening filter over-filters the source-file pass.

### Step R2.1: Scope the poison filter to the candidate pass

Files: `scripts/docs-refs-check.mjs`

Add an options parameter to `collectGitIgnoredTargets` — `collectGitIgnoredTargets(repoRoot, candidateTargets, { filterNonPathTokens = false } = {})`. Inside, always apply the git-stdin-safety prefix filters (`./`, `../`, `/`, `http://`, `https://`) as before. Apply the aggressive non-path filters (empty, `.`, `..`, leading-`-`, whitespace `\s`, glob `[*?\[\]]`, control chars) **only when `filterNonPathTokens` is true**.

Update the two call sites in `findBrokenRefs`:
- Source-file pass (`collectGitIgnoredTargets(repoRoot, new Set(sourceRelByAbs.values()))`): leave as-is (default `false`) → restores pre-Round-2 behavior; gitignored source paths with spaces/glob chars are skip-listed again.
- Candidate pass (`collectGitIgnoredTargets(repoRoot, candidateTargets)`): pass `{ filterNonPathTokens: true }` → keeps the exit-128 poison protection.

(Equivalent alternative if cleaner: filter `candidateTargets` with the poison predicate before the candidate-pass call, and revert the shared helper's filter to prefixes-only. Either way, the source pass must not drop real paths with spaces/globs.)

Update the block comment above the `safe` filter to reflect that the whitespace/glob/leading-dash conditions are candidate-only.

### Step R2.2: Test the source-pass regression (AC-11)

Files: `tests/docs-refs-check.test.ts`

Add a test: a temp git repo with a `.gitignore` listing a gitignored markdown **source** file whose name contains a space (e.g. `docs/generated report.md`), where that gitignored file contains a broken ref. Assert `runChecks(root)` returns `[]` — the gitignored source is excluded from scanning despite the space, proving the source pass no longer over-filters. (Follow the `makeTempRepo` + `git init` pattern used by the existing gitignore tests.)

### Step R2.3: Re-confirm (AC-8, AC-10)

Files: (verify only)

Confirm the Round-2 AC-8 poison-token test and the `'gitignored skip survives parent-relative anchor links...'` test both stay green. Run `npm run docs-refs-check` against the full worktree → exit 0.

### Validation

`npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`. No build.

## Reroute Plan Round 3

Implements `## Amendment Round 3` (AC-12..AC-15; AC-7/8/10/11 re-confirm). Replaces the Round-2 token-shape filtering — which was misdiagnosed (whitespace/glob/dash are processed fine; only outside-repo and beyond-symlink paths 128) — with batch resilience.

### Step R3.1: Strip the Round-2 token filter + param

Files: `scripts/docs-refs-check.mjs`

In `collectGitIgnoredTargets`, remove the `{ filterNonPathTokens = false } = {}` parameter and the conditional whitespace/glob/leading-`-`/control filters. Keep only: drop empty, `.`, `..`, and `./`/`../`/`/`/`http://`/`https://` prefixes. Update both call sites in `findBrokenRefs` (source-file pass ~line 451 and candidate pass ~line 456) to call `collectGitIgnoredTargets(repoRoot, set)` with no options object. Update the block comment to state that only non-checkable/outside-repo tokens are dropped, and that the batch is made resilient below.

### Step R3.2: Make the batch resilient (bisection on 128)

Files: `scripts/docs-refs-check.mjs`

Before issuing the batched `git check-ignore`, confirm we're in a work tree once: `spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot })` — if status !== 0, return an empty set (preserves the existing no-repo "no skip" degradation without bisecting).

Then resolve the safe candidates with a helper that bisects on 128:
- Run `git check-ignore --stdin -z` on the input slice.
- `status === 0 || status === 1` → parse NUL-split stdout into the result set.
- `result.error` → return empty (git missing, etc.).
- `status === 128`:
  - if the slice has 1 element → that path is unprocessable; return empty for it (do not poison siblings).
  - else → split in half, recurse on each half, union the results.

Recursion vs explicit stack is the implementer's choice. Keep the existing NUL-delimited input encoding (`input: arr.map(t => t + '\0').join('')`). Measured: ~225 ms / 21 git calls on the current tree (vs ~8.2 s / 977 for a flat per-path loop).

### Step R3.3: Tests

Files: `tests/docs-refs-check.test.ts`

- **AC-12**: temp repo, `.gitignore` lists a path with a space (e.g. `docs/has space.md`), a doc cites `` `docs/has space.md` `` → `runChecks(root)` returns `[]`. (Also keep/confirm the source-pass space test from Round 2 — AC-11.)
- **AC-13 (and corrected AC-8)**: temp repo where a directory is a **symlink** (`fs.symlinkSync`), gitignore a real path, and a doc cites BOTH a path through the symlink (the 128-causer) and the separate gitignored real path. Assert the real gitignored ref is skipped (`[]` for it) — proving the symlink path was isolated by bisection, not allowed to empty the set. This replaces the Round-2 `--force`/`npm run lint` "poison" fixture, which never actually 128'd.
- **AC-15**: confirm the no-git-repo path still returns no findings for would-be-gitignored refs (degrades to no-skip) without error.
- Remove or rewrite the Round-2 test that asserted a flag-like token disables/with the poison filter, since that premise is gone.

Guard: existing `'gitignored skip survives parent-relative anchor links...'` (AC-10) stays green.

### Step R3.4: Re-confirm tree

Run `npm run docs-refs-check` against the full worktree → exit 0.

### Validation

`npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`. No build.
