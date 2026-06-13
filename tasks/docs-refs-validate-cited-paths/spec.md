# Spec: docs-refs-validate-cited-paths — Validate base path of line-cited file refs in docs-refs-check

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`scripts/docs-refs-check.mjs` validates backtick file references in markdown docs and task artifacts, failing the build (and blocking the pipeline's auto-commit) on missing files. But its line-citation handling is inverted: a ref **without** line numbers gets its file-existence checked, while a ref **with** a line citation is skipped *wholesale* — its file is never checked at all.

The current class-1 backtick-ref handler short-circuits before the existence check:

```js
if (isLineCitationTarget(target)) continue;   // bails BEFORE fs.existsSync
```

`isLineCitationTarget` (`scripts/docs-refs-check.mjs`) recognizes single lines (`:151`), ranges (`:151-254`, en/em-dash variants), and GitHub anchors (`#L10-L20`) — but **not** comma-lists (`:151,254`). This produces two concrete harms:

1. **Inverted validation gap**: any line-cited ref bypasses the missing-file check. A handoff citing `src/components/Library/PhotoLibary.tsx:151` (note the typo'd path) passes silently; drop the `:151` and the same typo correctly fails. Adding line numbers makes a ref *less* validated.
2. **Comma-list false positive**: a legitimate ref like `` `src/components/Library/PhotoLibrary.tsx:151,254` `` (Codex's natural way to cite two changed lines in `handoff.md`) is not recognized as line-cited, so the whole `:151,254` suffix is treated as part of the path, `fs.existsSync` fails, and the auto-commit is blocked on a non-bug.

## Decision

In the **class-1 backtick file-ref** path of `docs-refs-check.mjs`, replace the wholesale "skip if line-cited" behavior with **strip-then-validate**: strip any trailing line-citation suffix from the ref, then run the normal missing-file check on the stripped base path. The cited line *numbers* remain unverified (they are drift-prone soft pointers); only the base file path is checked.

A single helper `stripLineCitation(target)` removes a trailing line-citation suffix in any of these forms (and only at the end of the token):

- single line — `:151`
- range — `:151-254` (ASCII hyphen, en-dash `–`, em-dash `—`)
- comma-list of lines and/or ranges — `:151,254`, `:151,254-260`, `:10,20,30`
- GitHub anchor forms — `#L151`, `#L151-L160`, `#L10,L20`, with or without the `L` on later items

The helper is applied at **both** sites that handle class-1 bare backtick refs, so the gitignore-skip set keys agree:

1. `collectCandidateTargetPaths` — strip before adding the bare backtick ref to the gitignore-candidate set.
2. `findBrokenRefs` class-1 handler — strip, then run the existing placeholder / valid-dir / gitignore / existence checks on the stripped path.

The reported `ref` in any finding remains the **full original** ref text (including the line citation), so a genuine missing-file finding still shows the operator exactly what they wrote.

## Non-Goals

- **Not** verifying that the cited line *numbers* exist, fall within the file's length, or appear in the task's diff. Line numbers stay unverified by design — they are approximate pointers that legitimately drift as code iterates.
- **Not** changing the **symbol-in-file** (`` `SYM` in `path` ``), **section** (`` `foo.md` §"…" ``), or **anchor-link** (`[text](path#anchor)`) ref handlers. Those three keep their current `isLineCitationTarget` behavior unchanged; only the class-1 bare backtick file-ref path changes. `isLineCitationTarget` itself is **not** removed — it remains in use by those three sites.
- **Not** broadening which top-level directories or placeholder forms are considered valid. Strip changes only the citation suffix; every other gate (`isPlaceholderTarget`, `validDirs`, gitignore-skip) runs unchanged on the stripped path.

## Acceptance Criteria

- [ ] AC-1: A new module-private function `stripLineCitation(target)` exists in `scripts/docs-refs-check.mjs` and returns the input with a trailing line-citation suffix removed for all forms listed in *Decision* (single, range w/ ASCII/en/em dash, comma-list, comma-list-with-ranges, `#L` forms). Verify by unit assertions on representative inputs (e.g. `stripLineCitation('a/b.ts:151,254')` → `'a/b.ts'`; `stripLineCitation('a/b.ts:5')` → `'a/b.ts'`; `stripLineCitation('a/b.ts#L10-L20')` → `'a/b.ts'`; `stripLineCitation('a/b.ts')` → `'a/b.ts'` unchanged).
- [ ] AC-2: A backtick ref with a comma-list citation whose **base file exists** produces **no** finding. Verify: doc containing `` `scripts/fixture-target.ts:151,254` `` with `scripts/fixture-target.ts` present → `runChecks` returns `[]`.
- [ ] AC-3: A backtick ref with a line citation (single, range, **or** comma-list) whose **base file does NOT exist** produces a `missing file` finding, and the finding's `ref` field contains the full original text including the citation. Verify: doc containing `` `src/does-not-exist.ts:151,254` `` → one finding with `reason: 'missing file'` and `ref` including `:151,254`.
- [ ] AC-4: Existing line-citation behavior for **existing** files is preserved — the current `line-citation refs: ascii hyphen, en-dash, and em-dash all pass` test stays green (single `:5`, ranges `:10-20`/`:30–40`/`:50—60`, and `#L10-L20`/`#L30–L40` all pass when the file exists).
- [ ] AC-5: The gitignore-skip still applies to a line-cited ref. Verify: a doc ref whose stripped base path is gitignored is skipped (no finding) — i.e. the candidate set built in `collectCandidateTargetPaths` keys on the stripped path so the `git check-ignore` batch and the check-site lookup agree.
- [ ] AC-6: The three non-class-1 ref handlers (symbol-in-file, section `§`, anchor-link) are unchanged — `isLineCitationTarget` is still referenced by them and their existing tests stay green.
- [ ] AC-7: `npm run docs-refs-check` run against the current repo tree passes (exit 0). The tightened check must not surface any pre-existing line-cited ref in canon's own docs/tasks/templates whose base path is actually missing; if it does, that is a real broken ref — fix the ref in the offending doc and note it in `handoff.md` (do not loosen the checker to hide it).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/docs-refs-check.mjs` | Add module-private `stripLineCitation(target)`. In `collectCandidateTargetPaths`, strip the citation from the bare backtick ref (the `match[1]` added in the first `matchAll` loop) before `targets.add`. In `findBrokenRefs` class-1 handler, remove the `if (isLineCitationTarget(target)) continue;` short-circuit; instead compute `const target = stripLineCitation(rawTarget)` and run the existing checks on the stripped value, keeping `refText = match[0]` (full original) for findings. Leave the symbol/section/anchor handlers and `isLineCitationTarget` itself untouched. |
| `tests/docs-refs-check.test.ts` | Add cases for AC-1 (direct `stripLineCitation` assertions if exported for test, else cover via `runChecks` behavior), AC-2 (comma-list + existing file → no finding), AC-3 (comma-list / single / range + missing file → `missing file` finding with full ref), and AC-5 (gitignored stripped base path skipped). Keep the existing `line-citation refs …` test (AC-4). |
| `templates/scripts/docs-refs-check.mjs` | Auto-synced mirror of the canon-managed source — regenerated and re-staged by the pre-commit `sync-templates` hook. Declared here so the `--pr` base-drift gate accepts it; do not hand-edit. |

> Note on AC-1 verification: `stripLineCitation` may stay module-private and be exercised through `runChecks` behavior (AC-2/AC-3 already pin the observable outcome). Export it only if the implementer prefers direct unit assertions — if exported, `templates/scripts/docs-refs-check.mjs.d.ts` must be regenerated by the same sync hook (it is already canon-owned). Mechanics deferred to implement.

### Interaction Dependencies

- The same source is run by CI as `npm run docs-refs-check` and shipped to adopters via `canon upgrade` (it is in `CANON_OWNED`). Behavior change propagates to adopters on their next upgrade — but the change strictly *tightens* (cited refs go from never-checked to path-checked) and cannot newly reject a previously-valid ref unless that ref's base path is genuinely missing.
- `scripts/docs-refs-config.mjs` (adopter config) is unaffected — `validDirs` / `noisySourcePaths` / `markdownRootDirs` still feed the same gates, now applied to the stripped path.

### Data Model Changes

None. No status schema, no persistent data, no shared types.

## Validation Required

- [x] `npm run lint` (= `eslint scripts/ tests/ src/`)
- [x] `npm run type-check` (= `tsc -p tsconfig.json --noEmit`) — covers the TS test file
- [x] `npm test` (= `node --test --import tsx tests/*.test.ts`) — full suite, including new cases
- [x] `npm run docs-refs-check` (= `node scripts/docs-refs-check.mjs`) — required: this task changes the checker; run it against the tree to confirm no regression and no newly-surfaced real broken ref (AC-7)
- [x] `npm run sync-templates:check` — canon-managed source changed; mirror must stay aligned
- [ ] `npm run build` — N/A: `scripts/docs-refs-check.mjs` runs directly via `node` and is not bundled into `dist/`; no `dist/` delta expected
- [ ] E2E — N/A: no UI/runtime surface

## Docs Impact

None. The validation matrix entry for `docs-refs-check` in `docs/architecture.md` already describes it as validating "file paths, symbols, sections, anchors" — strip-then-validate for cited paths is consistent with that description and needs no doc edit. (If QA judges a one-line clarification useful, it is optional, not required.)

## Known Risks

- **Over-stripping a real path that ends in `:digits`**: `stripLineCitation` only strips a *trailing* citation matching the line/range/comma-list grammar. A path like `docs/v1.2:3` would have `:3` stripped → `docs/v1.2`. This is an unlikely real path shape, but the anchoring (`$`) and the digit-only grammar keep the blast radius to genuinely citation-shaped suffixes. Mitigation: the regex is end-anchored and matches only `:` + digit-runs (with dash/comma separators), never alpha — so `foo:bar` is untouched.
- **Set-key mismatch (the subtle one)**: if the citation is stripped at the check site but not in `collectCandidateTargetPaths`, the gitignore-skip set is keyed on the raw (un-stripped) ref and the lookup on the stripped path — so a line-cited ref to a gitignored file would no longer be skipped. AC-5 exists specifically to pin this; both sites must strip. This mirrors the existing "same normalization at collection and lookup" invariant already documented for anchor-link paths in this file.
- **AC-7 surfacing a real pre-existing broken ref**: tightening could expose a genuinely missing base path behind an existing line citation somewhere in canon's docs. That is the gate working as intended — the fix is to correct the offending ref, not to weaken the checker.

## Human Test Plan

1. In any tracked doc under `docs/` or a task folder, add a reference that points at a real file and cites two lines with a comma — for example a reference to an existing source file followed by `:151,254`.
2. Run the project's documentation-reference check.
3. Expected: the check passes — the comma-style line reference no longer reports the file as missing.
4. Now change that same reference to point at a file path that does not exist (keep the `:151,254` line citation on the end).
5. Run the documentation-reference check again.
6. Expected: the check now fails and reports that file as missing, showing the full reference including the line numbers — confirming that adding line numbers no longer hides a wrong path.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
