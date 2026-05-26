# Spec Review: docs-refs-adopter-skip-and-ellipsis

> Reviewer: Codex | Spec: `tasks/docs-refs-adopter-skip-and-ellipsis/spec.md`

## Shape Check

no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Missing Edge Cases

- blocking: the spec promises exact-file skip support for entries like docs/changelogs.md, but the acceptance criteria only exercise a directory-prefix case (docs/archive). As written, an implementation that only matches `entry/` prefixes would still satisfy the tests while failing the documented exact-file case. Add an explicit exact-file fixture or AC so the behavior is enforced, not just described.
- non-blocking: the spec mixes trailing-slash examples in the problem statement (docs/archive/, docs/personas/reviews/) with slashless examples in the decision (docs/archive, docs/changelogs.md). Plan should state whether adopter entries are normalized or must be written without a trailing slash.

### Correctness Issues

none

### Type Safety / Interface Gaps

none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)

## Round 2 — fresh review after spec revision

### Shape Check

no concerns

### Issues Found

#### Correctness Issues

- blocking: AC-2b's negative-control fixture uses docs/changelogs.md.bak, but `scripts/docs-refs-check.mjs` only visits files whose names end in `.md` (`collectMarkdownFiles()` delegates to `walkMarkdownTree()`, which only pushes `entry.name.endsWith('.md')`). That path will never be scanned, so the spec still asks for a test the runner cannot observe. Replace it with a scanned `.md` path that shares the string prefix, or drop the negative control.

### Verdict

- [x] **Changes requested** — spec must be revised before plan phase

## Round 3 — fresh review after spec revision

### Shape Check

no concerns

### Issues Found

#### Correctness Issues

- blocking: AC-2b still does not prove exact-match semantics. The positive fixture at docs/changelogs.md would also pass if the implementation used a sloppy `relPath.startsWith(entry)` check, because that path starts with the entry string either way. The spec needs a scanned negative control for the exact-file entry, such as a `.md` file under docs/changelogs.md-notes/ or similar, so the test catches overmatching instead of only proving the positive case.

### Verdict

- [x] **Changes requested** — spec must be revised before plan phase

## Round 4 — fresh review after spec revision

### Shape Check

no concerns

### Issues Found

none

### Verdict

- [x] **Approved** — spec is implementable as written

## Round 5 — fresh review after spec revision

### Shape Check

no concerns

### Issues Found

#### Correctness Issues

- blocking: the revised ACs only exercise `runChecks(root, { skipPaths })`. They never prove that the adopter-facing `NOISY_SOURCE_PATHS` constant is actually consulted when the checker runs without options. As written, an implementation that ignores `NOISY_SOURCE_PATHS` entirely and only honors the test seam would still satisfy every AC, which breaks the advertised runtime feature. Add a positive fixture that mutates a temp copy's `NOISY_SOURCE_PATHS` and runs the checker with no options, or otherwise assert the default path list is read by the runtime path.

### Verdict

- [x] **Changes requested** — spec must be revised before plan phase

## Round 6 — fresh review after spec revision

### Shape Check

no concerns

### Issues Found

#### Correctness Issues

- blocking: the revised spec still omits the type-surface update for the new `NOISY_SOURCE_PATHS` export. `tests/docs-refs-check.test.ts` will need to import that symbol, but `scripts/docs-refs-check.mjs.d.ts` currently only declares `runChecks(repoRoot: string): Finding[]` and does not declare `NOISY_SOURCE_PATHS`. Without adding the exported constant to the ambient module declaration, `npm run type-check` will fail as soon as the test imports it. Add the export to the `.d.ts` alongside the `runChecks` signature change.

### Verdict

- [x] **Changes requested** — spec must be revised before plan phase

## Round 7 — fresh review after spec revision

### Shape Check

no concerns

### Issues Found

none

### Verdict

- [x] **Approved** — spec is implementable as written
