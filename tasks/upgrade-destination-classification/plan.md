# Implementation Plan: upgrade-destination-classification

> Written by: Claude | Implements: `tasks/upgrade-destination-classification/spec.md`

## Approach

Replace the boolean `isPathDirty()` gate in `src/cli/commands/upgrade.ts` with a
batched git classifier (`classifyDestinations`) that assigns every pending
write target one of five classes (`absent`, `tracked-clean`, `tracked-dirty`,
`untracked-existing`, `unverifiable`); `canon-identical` stays exactly where it
already lives today (the per-source content-equality check that short-circuits
into `unchanged` *before* a path ever reaches `pending`). Wire the three new
refusal classes into the existing `pending` → refuse-or-write gate (all six
write sources already share it — no parallel guard, per
`docs/patterns.md` §"route it through the existing safety queue"). Extend
`UpgradeResult` additively (`refusals: { trackedDirty, untrackedExisting,
unverifiable }`) so existing consumers of `dirtyRefused` (the union) keep
working, and per-class CLI messaging (AC-9) can read the specific buckets.

The single trickiest design point — how the docs-refs-config.mjs scaffold (6th
write source) interacts with the classifier without breaking its pre-existing
"adopter fully owns it once present" contract — is called out in its own step
below (Step 4) with the reasoning spelled out; read that step fully before
touching that code, it is easy to get wrong in a way that either reintroduces
an unrestorable-overwrite bug or silently clobbers adopter customizations.

## Steps

### Step 1: Add the `DestinationClass` type and `classifyDestinations()`

File: `src/cli/commands/upgrade.ts`

Delete `isPathDirty()` (lines 172–192) entirely — including its docstring
("Untracked files return false... Returns false if the repo is not a git repo
or git is unavailable — treat as clean.") and the inline comment "?? =
untracked (we don't refuse on untracked)". Both phrases are AC-10's grep
targets (`grep -n "don't refuse on untracked"` / `grep -n "treat as clean"`
must return nothing after this change).

Replace with:

```ts
type DestinationClass = 'absent' | 'tracked-clean' | 'tracked-dirty' | 'untracked-existing' | 'unverifiable';

/**
 * Classifies every candidate destination path against git's tracked state in
 * one batched pass — at most 3 git spawns total for an entire `runUpgrade`
 * call, regardless of how many paths are classified (one availability probe,
 * one `ls-files` batch, one `status --porcelain` batch).
 *
 * Fails closed: when git itself is unavailable (not a repo, git missing,
 * broken GIT_DIR), a path that already exists on disk classifies
 * `unverifiable` (refuse) rather than `tracked-clean` (write) — see
 * docs/patterns.md §"Write-safety guards must fail closed when the underlying
 * probe errors". A path that doesn't exist on disk AND has no git history
 * classifies `absent` regardless of git availability — there is no content at
 * risk, so greenfield scaffolding still works outside a repo.
 *
 * Trackedness (via `git ls-files`, which reports a path even when it's been
 * deleted from disk) is always checked BEFORE on-disk existence. A tracked
 * path the operator deleted locally must classify `tracked-dirty`, never
 * `absent` — checking existence first would silently let `canon upgrade`
 * recreate a file the operator intentionally removed.
 *
 * `untracked-existing` covers both plain untracked (`??`) files and
 * gitignored files: `git ls-files` (no `--others`) only lists tracked paths,
 * so a gitignored file at a managed target — which `git status --porcelain`
 * alone can't distinguish from tracked-clean — falls into "not tracked, but
 * exists on disk" the same as a plain untracked file. Same git-unrestorable
 * risk either way.
 */
function classifyDestinations(cwd: string, relPaths: readonly string[]): Map<string, DestinationClass> {
    const classes = new Map<string, DestinationClass>();
    if (relPaths.length === 0) return classes;
    // IMPORTANT: `git ls-files --` / `git status --porcelain --` with ZERO
    // paths after `--` means "no pathspec filter" — i.e. matches the ENTIRE
    // repo, not nothing. The guard above is load-bearing, not a micro-opt.

    const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const gitAvailable = probe.status === 0 && !probe.error && probe.stdout.trim() === 'true';

    if (!gitAvailable) {
        for (const rel of relPaths) {
            classes.set(rel, existsSync(join(cwd, rel)) ? 'unverifiable' : 'absent');
        }
        return classes;
    }

    // Lists whichever of the given paths ARE tracked (present in the index),
    // regardless of on-disk existence.
    const lsFiles = spawnSync('git', ['ls-files', '--', ...relPaths], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tracked = new Set((lsFiles.stdout ?? '').split('\n').filter(Boolean));

    // Lists only paths with staged/unstaged changes, including local deletion
    // of a tracked path. A tracked, unmodified path prints nothing.
    const status = spawnSync('git', ['status', '--porcelain', '--', ...relPaths], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const dirty = new Set<string>();
    for (const line of (status.stdout ?? '').split('\n')) {
        if (!line.trim()) continue;
        dirty.add(line.slice(3));
    }

    for (const rel of relPaths) {
        if (!tracked.has(rel)) {
            classes.set(rel, existsSync(join(cwd, rel)) ? 'untracked-existing' : 'absent');
            continue;
        }
        classes.set(rel, dirty.has(rel) ? 'tracked-dirty' : 'tracked-clean');
    }
    return classes;
}
```

### Step 2: Extend `UpgradeResult`

File: `src/cli/commands/upgrade.ts`

```ts
export interface UpgradeResult {
    upgraded: string[];
    unchanged: string[];
    skipped: string[];
    wouldUpgrade: string[];
    /** Union of all three refusal classes in `refusals`. Kept so existing
     *  call sites that only need "was anything refused" keep working
     *  unmodified; per-class CLI messaging and tests use `refusals`. */
    dirtyRefused: string[];
    /** Per-class refusal buckets; their union is `dirtyRefused`. Empty arrays
     *  when nothing in that class. */
    refusals: {
        trackedDirty: string[];
        untrackedExisting: string[];
        unverifiable: string[];
    };
    malformed: string[];
    cutoverWarnings: string[];
    staleOverrides: string[];
}
```

This is additive — no existing field is renamed or removed, so every existing
assertion against `dirtyRefused` (e.g. the tracked-dirty tests at
`tests/cli.test.ts:2124`, `:2153`, `:2181`) continues to pass unmodified.

### Step 3: Wire the classifier into `runUpgrade`'s dirty-detection loop

File: `src/cli/commands/upgrade.ts`, replace the current block:

```ts
const dirty: WriteOp[] = [];
const clean: WriteOp[] = [];
for (const op of pending) {
    if (isPathDirty(cwd, op.rel)) dirty.push(op);
    else clean.push(op);
}
```

with (the docs-refs-config.mjs handling from Step 4 slots in immediately
*before* this, since it needs `destinationClasses` too — see Step 4 for how
the two steps compose):

```ts
const destinationClasses = classifyDestinations(cwd, [...pending.map(op => op.rel), docsRefsConfigRel]);

// docs-refs-config.mjs decision (Step 4) goes here, consulting
// destinationClasses.get(docsRefsConfigRel) and possibly pushing it into
// `pending` before the loop below runs.

const clean: WriteOp[] = [];
const trackedDirtyOps: WriteOp[] = [];
const untrackedExistingOps: WriteOp[] = [];
const unverifiableOps: WriteOp[] = [];
for (const op of pending) {
    switch (destinationClasses.get(op.rel)) {
        case 'tracked-dirty': trackedDirtyOps.push(op); break;
        case 'untracked-existing': untrackedExistingOps.push(op); break;
        case 'unverifiable': unverifiableOps.push(op); break;
        default: clean.push(op); // 'tracked-clean' | 'absent'
    }
}
const dirty: WriteOp[] = [...trackedDirtyOps, ...untrackedExistingOps, ...unverifiableOps];
const refusals = {
    trackedDirty: trackedDirtyOps.map(op => op.rel),
    untrackedExisting: untrackedExistingOps.map(op => op.rel),
    unverifiable: unverifiableOps.map(op => op.rel),
};
```

Everything downstream (`options.check` branch, the `dirty.length > 0 &&
!options.force` refusal branch, the final write branch) is **unchanged in
control flow** — only add `refusals` to each of the three `return { ... }`
object literals (lines ~377, ~384, ~403 in the current file). `dirty` remains
the union array feeding `dirtyRefused`, so the all-or-nothing refusal
semantics (AC-8b) and the `toWrite = options.force ? pending : clean` write
gate need no changes at all.

### Step 4: docs-refs-config.mjs (6th write source) — read this fully before editing

**Do not** make docs-refs-config.mjs symmetric with the `CANON_OWNED` loop
(i.e. don't make it always overwrite when content differs). That file exists
specifically so adopters can customize `VALID_DIRS` / `NOISY_SOURCE_PATHS` /
`MARKDOWN_ROOT_DIRS` outside the canon-owned checker — a committed adopter
customization must never be silently replaced with the fresh template. Two
existing tests pin this (`tests/cli.test.ts` "pre-split checker with config
already present is overwritten WITH a warning" and "new docs-refs checker with
config present upgrades normally and does not scaffold") — both assert the
config file's content is left byte-for-byte untouched once it exists,
regardless of whether it matches the template. **Preserve that invariant for
any `tracked-clean` classification.**

What AC-13 actually wants fixed: today, `docsRefsConfigMissing =
!existsSync(docsRefsConfigPath)` gates the scaffold *purely on disk
existence*. That means (a) an untracked stray file at that path (e.g. left
over from an interrupted `canon init`/upgrade, never committed) is silently
adopted as "already there, ignore forever" — exactly the unrestorable-content
risk this whole task closes, just silently rather than via an overwrite; and
(b) a *tracked* config file the operator deleted locally gets silently
recreated by the scaffold branch (the same class of bug AC-3b fixes
elsewhere, for this source specifically). Fix both by consulting the
classifier instead of raw `existsSync`, while still never touching a
`tracked-clean` file's content:

```ts
const docsRefsConfigTemplatePath = join(pkgDir, 'templates', docsRefsConfigRel);
const docsRefsConfigTemplateContent = existsSync(docsRefsConfigTemplatePath)
    ? readFileSync(docsRefsConfigTemplatePath, 'utf8')
    : null;
const docsRefsConfigClass = destinationClasses.get(docsRefsConfigRel);

if (docsRefsConfigTemplateContent === null) {
    if (!docsRefsConfigExists) skipped.push(`${docsRefsConfigRel} (missing template for cutover scaffold)`);
    // else: exists, no template to compare against — leave untouched (unchanged from today).
} else if (docsRefsConfigClass === 'absent') {
    // Never existed on disk or in git — today's scaffold-on-first-install path.
    pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
} else if (!docsRefsConfigExists) {
    // Tracked in git but deleted locally — refuse instead of silently
    // recreating a file the operator intentionally removed (AC-3b's
    // protection, applied to this source too).
    pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
} else {
    const existingConfigContent = readFileSync(docsRefsConfigPath, 'utf8');
    if (existingConfigContent !== docsRefsConfigTemplateContent && docsRefsConfigClass !== 'tracked-clean') {
        // untracked-existing / unverifiable / tracked-dirty non-identical
        // content: flag it through the same refusal gate as every other
        // managed target (AC-13). `tracked-clean` is excluded deliberately —
        // see the note above this code block.
        pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
    }
    // tracked-clean, or content already matches template: leave untouched — the pre-existing "adopter owns it" contract.
}
```

This must run *before* the bucketing loop in Step 3 (so a docs-refs-config.mjs
entry added to `pending` here gets bucketed by the same loop), and it reuses
`destinationClasses` computed once in Step 3 rather than issuing its own git
calls — the `[...pending.map(op => op.rel), docsRefsConfigRel]` classification
list in Step 3 already includes it unconditionally, so the class is available
before deciding whether to push it into `pending`.

If you land on a different reading of AC-13 during implementation, flag it in
the handoff — this task's Known Risks and Interaction Dependencies sections
don't fully resolve the tension between "same as any other managed target"
and "config is adopter-owned once present," and the interpretation above is a
plan-time judgment call, not something spec_review confirmed line-by-line.

### Step 5: Per-class CLI messaging (AC-9)

File: `src/cli/commands/upgrade.ts`, `upgradeCmd()`.

Replace the single `dirtyRefused`-driven block in the `--check` branch:

```ts
if (dirtyRefused.length > 0) {
    console.log('Would refuse (dirty in git — pass --force to overwrite):');
    for (const f of dirtyRefused) console.log(`  ⚠ ${f}`);
    console.log('');
}
```

with three class-specific blocks:

```ts
if (result.refusals.trackedDirty.length > 0) {
    console.log('Would refuse — tracked and locally modified (commit/stash first, or pass --force):');
    for (const f of result.refusals.trackedDirty) console.log(`  ⚠ ${f}`);
    console.log('');
}
if (result.refusals.untrackedExisting.length > 0) {
    console.log('Would refuse — exists but not tracked by git (git could not restore it after an overwrite; commit it, move it aside, or pass --force):');
    for (const f of result.refusals.untrackedExisting) console.log(`  ⚠ ${f}`);
    console.log('');
}
if (result.refusals.unverifiable.length > 0) {
    console.log('Would refuse — git state could not be verified (git is canon upgrade\'s safety boundary; repair git or run inside a git repo, or pass --force):');
    for (const f of result.refusals.unverifiable) console.log(`  ⚠ ${f}`);
    console.log('');
}
```

Do the same replacement in the real-run refusal branch (currently `if
(dirtyRefused.length > 0) { console.log('Refused (dirty in git...'); ...
process.exit(2); }`) — same three headings (drop "Would " → "Refused —"),
same `process.exit(2)` still gated on `dirtyRefused.length > 0` (the union,
unchanged).

Wording must match the Human Test Plan in the spec: untracked-existing names
"exists but isn't tracked... git could not restore it"; unverifiable names
"git — its safety boundary — is unavailable."

### Step 6: README (AC-11)

File: `README.md`, line ~235. Current row:

> `canon upgrade` | Sync vendored canon-owned files to match the installed
> version. It does not touch adopter-owned `AGENTS.md` or `CLAUDE.md`.
> Refuses to overwrite locally-modified canon-owned files unless `--force` is
> set. Use `--check` (or `--dry-run`) to preview, `--no-stage` to skip the
> auto-`git add`.

Update the refusal sentence to cover all three classes, e.g.:

> Refuses to overwrite canon-owned targets that are locally modified,
> untracked-but-present (git can't restore them after a write), or whose git
> state can't be verified — unless `--force` is set.

Run `npm run docs-refs-check` after editing (Validation Required already
lists this).

## New Tests

Several ACs are **already satisfied by existing tests once the fixture
repairs in the next section land** — no new test needed, just verify they
still pass:

- **AC-3b** (locally-deleted tracked file stays tracked-dirty) — already
  covered by `tests/cli.test.ts:2181`. No change needed; just confirm it still
  passes (it exercises the `!docsRefsConfigExists`-style precedence generally,
  via the CANON_OWNED path, not docs-refs-config specifically).
- **AC-5b** (`--force` must not override malformed `.gitignore`) — already
  fully covered by `tests/cli.test.ts:1454`, which asserts both the
  non-`--force` and `--force` cases in the same test. No new test needed.
- **AC-6** (tracked-clean still writes) — will be incidentally covered by
  every fixture-repaired test below (each becomes a tracked-clean scenario).
  Still add one small test explicitly labeled for AC-6 traceability (a
  git-committed managed file, unmodified, content differing from the shipped
  template, plain `runUpgrade` overwrites it) — easy to lift from the repaired
  version of `tests/cli.test.ts:931`.
- **AC-7** (canon-identical short-circuit without git) — already covered by
  several non-git fixtures with byte-identical content (e.g.
  `tests/cli.test.ts:995`, `:1036`, `:1130`, `:1401`). No new test needed.

New tests to add (place near the existing "runUpgrade safety flags" section,
`tests/cli.test.ts:2065` onward, following the `gitInit`/`gitAddCommit`
helpers already defined there):

- **AC-1**: invert `tests/cli.test.ts:2211` ("untracked dirty status does NOT
  trigger refusal") in place. Same fixture (git repo, untracked skill file
  with a unique sentinel), flip the assertions: `result.refusals
  .untrackedExisting.includes(rel)` (or `dirtyRefused.includes(rel)`),
  `upgraded` stays empty, and the sentinel content on disk is unchanged. Grep
  after: `grep -n "does NOT trigger refusal" tests/cli.test.ts` must return
  nothing.
- **AC-2**: non-git temp dir (`withTempDir`, no `gitInit`) with a non-identical
  existing file at a managed target (mirrors `setupSkillTemplate` +
  differing project content, no git). Assert `refusals.unverifiable.includes(rel)`,
  nothing written, exit-code semantics aside (this test calls `runUpgrade`
  directly, not the CLI, so no process.exit involved).
- **AC-3**: same non-git temp dir, but the target file doesn't exist at all.
  Assert it's in `upgraded`. Pair directly with AC-2 in the same test file (two
  `test()` blocks) to pin both sides of the boundary.
- **AC-4**: git repo fixture; write `.gitignore` with a pattern matching the
  managed target's relative path; write non-identical content at that target
  path; do **not** `git add` it. Assert `refusals.untrackedExisting.includes(rel)`.
  Per `docs/patterns.md` "Test-writing pitfalls: porcelain-delta tests need
  non-gitignored fixture paths" — this test needs the OPPOSITE care: make sure
  the fixture path really is matched by the `.gitignore` pattern (e.g. ignore
  the exact skill-template relative path), or the test passes vacuously
  because the file just looks like a normal untracked file.
- **AC-5**: three new sub-tests (or one test with three fixtures) mirroring
  `tests/cli.test.ts:2153` (the existing tracked-dirty `--force` test) for the
  other two classes: untracked-existing (git repo, file present, never
  `git add`ed, `--force` writes it) and unverifiable (non-git temp dir,
  existing non-identical file, `--force` writes it). Assert `upgraded`
  includes the path and `refusals.*` are empty in each case.
- **AC-8**: for each of the six classes, run `--check` then the real run on
  the *same* untouched fixture and assert the classification matches:
  absent/tracked-clean → path in `wouldUpgrade` (check) and `upgraded` (real);
  the three refusal classes → path in the corresponding `refusals.*` bucket in
  *both* the check result and the real result (real run must not have written
  anything either). canon-identical → `unchanged` in both. Six small
  sub-fixtures, or a table-driven test iterating a `{ class, setup, expectWrite }`
  array — either is fine, but don't compare `wouldUpgrade` against `upgraded`
  directly (different field names by design per AC-8's parity note).
- **AC-8b**: git repo fixture with two pending targets: one tracked-clean (or
  absent) and one untracked-existing (or unverifiable via a non-git variant is
  not possible here since untracked-existing needs a working repo — use
  untracked-existing or tracked-dirty for the refused side). Assert a plain
  `runUpgrade` writes **neither** (`upgraded` is empty, including the
  would-be-clean target), and a subsequent `--force` run writes both. This is
  the same shape as the existing
  `tests/cli.test.ts:1223` ("mixed dirty-refusal keeps nudge empty...") test —
  reuse that pattern but with an untracked-existing target instead of a
  second tracked-dirty one, so the new refusal class is what's under test.
- **AC-9**: add a `runCanonCliIn(cwd, args)` helper next to `runCanonCli`
  (same shape, `cwd` parameterized instead of hardcoded to `WORKTREE_ROOT`) —
  `upgradeCmd`'s refusal path calls `process.exit(2)`, so it can only be
  exercised safely via a subprocess, not an in-process call. Two subprocess
  tests: (a) a real git-repo scratch dir with one tracked-dirty target and one
  untracked-existing target present simultaneously — assert stdout contains
  both class-specific headings and does NOT contain the other class's
  heading text; (b) a non-git scratch dir with one existing non-identical
  managed target — assert stdout contains the unverifiable heading and NOT
  the other two. A single shared/catch-all message text appearing for two
  different fixtures fails this AC.
- **AC-10**: `grep -n "don't refuse on untracked" src/cli/commands/upgrade.ts`
  and `grep -n "treat as clean" src/cli/commands/upgrade.ts` both return
  nothing; a positive assertion that the new docstring/comment mentions the
  classification model (e.g. `assert.match(source, /tracked-dirty/)` and
  `/untracked-existing/` and `/unverifiable/` against the file's own text, or
  just review manually — a grep-based test is easy to add near the existing
  README/AGENTS.md content-assertion tests at `tests/cli.test.ts:866`).
- **AC-11**: read `README.md`, assert the `canon upgrade` row matches
  `/untracked/i` and `/verif/i` (or the exact new wording) — pattern-match the
  existing README-content tests at `tests/cli.test.ts:2238` onward.
- **AC-13**: git repo fixture; do **not** create `scripts/docs-refs-check.mjs`
  at all (avoids entangling with the cutover-warning logic — keep this test
  minimal and focused on the config file alone); create
  `scripts/docs-refs-config.mjs` in the project dir with non-template content,
  never `git add`ed; the template's `scripts/docs-refs-config.mjs` has
  different content. Assert a plain `runUpgrade` puts
  `scripts/docs-refs-config.mjs` in `refusals.untrackedExisting`, `upgraded`
  is empty, and the file's on-disk content is unchanged.

## Existing Test Fixture Repairs (AC-12)

These 19 tests currently rely on the fail-open path: a plain `withTempDir`
project dir (no `git init`) with an existing file at a managed target whose
content differs from what would be written. Under the new classifier this
becomes `unverifiable` (git unavailable + destination exists) instead of a
silent write, breaking each assertion below. **Fix**: add `gitInit(projectDir)`
after the temp dirs are created, and `gitAddCommit(projectDir, '<message>')`
right before the `runUpgrade(...)` call — after all the `fs.writeFileSync`
setup calls, so the pre-upgrade content is committed and the destination
classifies `tracked-clean` (git can restore it, so a plain upgrade may write
it — exactly the original intent of each test, which is about the
merge/overwrite logic, not git safety). `gitInit`/`gitAddCommit` are already
defined at `tests/cli.test.ts:2067`; either reuse them in place or move them
earlier in the file if a test above line 2067 needs them (they have no
dependencies on anything defined after them).

List each of these in the handoff's Changes table with the one-line reason
"non-git fixture with pre-existing non-identical content now classifies
unverifiable; committed it to restore the original tracked-clean intent" (or
similar) per AC-12:

| Line | Test | Fix |
|---|---|---|
| 931 | `runUpgrade: canon-owned skill file fully overwritten` | gitInit + commit before `runUpgrade` |
| 977 | `runUpgrade: version bumped when .canon/version mismatches installed version` | gitInit + commit |
| 1012 | `runUpgrade: task template (.canon/templates/spec.md) fully overwritten` | gitInit + commit |
| 1107 | `runUpgrade staleOverrides: differing override under default root is listed` | gitInit + commit |
| 1152 | `runUpgrade staleOverrides: identical override content is suppressed` | gitInit + commit |
| 1173 | `runUpgrade staleOverrides: --check uses wouldUpgrade and does not write` | gitInit + commit |
| 1283 | `runUpgrade staleOverrides: empty when override root is absent` | gitInit + commit |
| 1298 | `runUpgrade staleOverrides: stray files under the override root are ignored` | gitInit + commit |
| 1317 | `runUpgrade staleOverrides: honors CANON_TASKS_DIR_OVERRIDE and ignores the default root` | gitInit + commit |
| 1384 | `runUpgrade: .gitignore without canon block receives the block via pending queue` | gitInit + commit |
| 1437 | `runUpgrade --check: .gitignore reports wouldUpgrade without writing` | gitInit + commit |
| 1475 | `runUpgrade: pre-split docs-refs checker scaffolds config and overwrites checker + .d.ts with a warning` | gitInit + commit (checker + .d.ts differ; config itself is absent — unaffected) |
| 1551 | `runUpgrade: new docs-refs checker with missing config scaffolds config but does not defer` | gitInit + commit (checker differs; config absent — unaffected) |
| 1615 | `runUpgrade: pre-split checker with config already present is overwritten WITH a warning` | gitInit + commit (checker differs; config content already equals template in this fixture — unaffected by Step 4) |
| 1687 | `runUpgrade: new docs-refs checker with config present upgrades normally and does not scaffold` | gitInit + commit (same shape as 1615) |
| 1751 | `runUpgrade --check: cutover plans config scaffold without writing` | gitInit + commit (checker differs, non-git dir) |
| 1935 | `runUpgrade: header-only sync refreshes telemetry header + preserves rows` | gitInit + commit |
| 2002 | `runUpgrade --check: header-only sync reports wouldUpgrade without writing` | gitInit + commit |
| 2099 | `runUpgrade --check: reports wouldUpgrade without writing` | gitInit + commit |

Do **not** touch these — they already use `gitInit`/`gitAddCommit` and model a
genuinely dirty/absent/identical fixture, so they're unaffected by this
change: `tests/cli.test.ts:1196`, `:1223`, `:1256`, `:1416`, `:1454`, `:1794`,
`:1980`, `:2124`, `:2153`, `:2181`, `:2211` (inverted per AC-1, not otherwise
touched), `:995`, `:1036`, `:1130`, `:1401`, `:959`, `:901`.

After adding `gitInit`/`gitAddCommit` to a test, double check whether it also
needs `.canon/version` committed — most already call `writeCurrentCanonVersion`
or write `.canon/version` directly before the point where the commit should
land; make sure the commit happens *after* that write, not before, or the
version bump path will itself classify differently than intended (though
since version mismatches are usually the point of those specific tests, this
mostly self-resolves — just be deliberate about commit placement, not an
afterthought).

## Testing Plan

- **Unit**: all new/repaired tests above, in `tests/cli.test.ts`.
- **E2E**: none beyond the AC-9 subprocess tests (which already exercise the
  real CLI entrypoint end-to-end).
- **Manual**: the Human Test Plan steps in `tasks/upgrade-destination-classification/spec.md` — recommend running through all 5 before QA sign-off, since this changes a routine adopter-facing command's refusal behavior.

Full validation sequence before handoff: `npm run lint`, `npm run type-check`,
`npm test`, `npm run build`, `npm run docs-refs-check`.

## Rollback Plan

Single-file logic change (`src/cli/commands/upgrade.ts`) plus test-only
changes and a README row edit — revert is a straightforward `git revert` of
the commit. No persisted state, no schema, no migration. The main externally
visible consequence of *not* rolling back promptly is that adopters with
untracked customizations at canon-managed paths start seeing refusals on
`canon upgrade` where they previously saw silent (data-losing) overwrites —
intentional, but per the spec's Known Risks this is at least a **minor**
version bump with a changelog entry naming the new refusal classes and
remedies.
