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
