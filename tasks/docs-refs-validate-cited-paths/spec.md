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

---

## Amendment

### Why

The Round-1 implementation correctly strips line citations and validates the base path, but opening the PR surfaced a **real, latent bug** that this change makes load-bearing for the first time.

`collectCandidateTargetPaths` adds **every** backtick token in the scanned docs to the gitignore-candidate set — not just path-shaped refs, but command snippets (`canon run`, `npm run lint`), flags (`--force`, `--reroute`, `-f`), and prose fragments (`state=… reason=…`). On canon's own tree that set is ~1003 entries, ~373 of them non-paths. `collectGitIgnoredTargets` feeds the whole set to a single `git check-ignore --stdin -z` batch; a flag-like / malformed token makes git exit **128**, and the function fails **closed to an empty set** — silently disabling the gitignore-skip for the *entire run*.

Before this task, line-cited refs were skipped *before* the gitignore check ran, so a broken gitignore-skip was harmless. After this task, stripped line-cited refs depend on the gitignore-skip working — so a gitignored, line-cited, non-existent path (e.g. `` `.claude/settings.local.json:151,254` `` written into this task's own `review.md`) is now (incorrectly) reported as `missing file`. The Round-1 AC-5 test passes only because its fixture has a tiny, clean candidate batch that never triggers the 128 — it does not discriminate the bug. (Verified empirically: instrumented run shows the candidate batch at `status=128`, gitignore set returned empty.)

### Amended / added Acceptance Criteria

- [ ] AC-8: The gitignore-skip is **robust to non-path candidate tokens**. A single flag-like or non-path backtick token (e.g. `--force`, `npm run lint`, `state=… reason=…`) appearing anywhere in the scanned docs must **not** disable the gitignore-skip for other refs. Verify: a fixture doc containing both a flag-like backtick token **and** a gitignored line-cited path; `runChecks` returns `[]` (the gitignored path is still skipped despite the poison token present). The fix restricts the `git check-ignore` batch to plausibly-path-shaped candidates (at minimum: drop entries that are empty, start with `-`, or contain whitespace/control characters) so a stray token cannot poison the batch.
- [ ] AC-9 (strengthens AC-5): The AC-5 gitignore test must **discriminate** the gitignore gate — its fixture must reach the gitignore-skip as the *only* path to `[]` (a gitignored path under a top-level dir that **is** in `validDirs`, alongside at least one non-path poison token), so the test fails if either the dual-site stripping **or** the batch-robustness regresses. Replace or augment the Round-1 AC-5 test accordingly.
- [ ] AC-10: The existing regression test `'gitignored skip survives parent-relative anchor links elsewhere in the repo'` (the prior `../AGENTS.md` → exit-128 guard) stays green — the batch-robustness change must not reintroduce that failure mode.
- [ ] AC-7 (re-confirm): `npm run docs-refs-check` exits 0 against the **full worktree tree**, including this task's own `review.md` — i.e. the self-referential `` `.claude/settings.local.json:151,254` `` ref in `review.md` is correctly gitignore-skipped, not reported missing.

### Scope note

Still confined to `scripts/docs-refs-check.mjs` (the `collectGitIgnoredTargets` safe-filter, and possibly `collectCandidateTargetPaths`) plus `tests/docs-refs-check.test.ts`. The `templates/` mirror auto-syncs. No change to the symbol/section/anchor handlers or to `isLineCitationTarget`. Do **not** "fix" this by deleting or rewording the `review.md` ref — the ref is a valid gitignored citation and must be handled correctly by the checker. The existing `collectGitIgnoredTargets` behavior of degrading to "no skip" **outside a git repo** (status 128 because there is no repo) must be preserved — only the *in-repo, poison-token* path changes.

---

## Amendment Round 2

### Why

Codex PR review (P2 on `scripts/docs-refs-check.mjs`) found the Round-2 batch-hardening filter is **too broad for the source-file pass**. `collectGitIgnoredTargets` is called at two sites in `findBrokenRefs`:

1. **Source-file pass** — `collectGitIgnoredTargets(repoRoot, new Set(sourceRelByAbs.values()))`: inputs are **real walked markdown file paths**, used to exclude gitignored source docs from scanning (preserves local-vs-CI consistency).
2. **Candidate pass** — `collectGitIgnoredTargets(repoRoot, candidateTargets)`: inputs are **arbitrary backtick snippets** (flags, command snippets, prose) — this is where the exit-128 poison lives.

The Round-2 filter added whitespace (`!/\s/`) and glob (`!/[*?\[\]]/`) exclusions to the shared helper. Those are appropriate for candidate snippets but **wrong for real source paths**: a gitignored source like `docs/generated report.md` (space in name) is now dropped from `ignoredSources`, so it gets scanned locally and can fail on refs that CI (fresh clone, file absent) never sees — re-introducing the exact local-vs-CI skew the gitignore-skip exists to prevent. `git check-ignore --stdin -z` handled space-bearing paths fine before; whitespace/glob were never the poison (leading-`-` flag-like tokens were).

### Amended / added Acceptance Criteria

- [ ] AC-11: The aggressive non-path token filter (empty / `.` / `..` / leading-`-` / whitespace / glob / control-char) applies **only to the ref-candidate pass**, not the source-file pass. The source-file pass must restore the pre-Round-2 behavior (only the git-stdin-safety prefixes `./`, `../`, `/`, `http(s)` are dropped) so a **gitignored source path containing a space or glob char is still skip-listed**. Verify with a test: a gitignored markdown source file whose name contains a space is excluded from scanning (no finding from refs inside it), proving the source pass no longer drops it. Mechanics: parameterize `collectGitIgnoredTargets` (e.g. a `filterNonPathTokens` option, default `false`; the candidate-pass call passes `true`), or equivalently apply the poison filter to `candidateTargets` before the call rather than inside the shared helper.
- [ ] AC-8 (re-confirm): the candidate-pass poison protection still holds — a flag-like / non-path token in the docs must not disable the gitignore-skip (the Round-2 AC-8 test stays green).
- [ ] AC-10 (re-confirm): the `'gitignored skip survives parent-relative anchor links...'` regression test stays green.

### Scope note

Same file scope (`scripts/docs-refs-check.mjs`, `tests/docs-refs-check.test.ts`, auto-synced `templates/` mirror). The outside-a-git-repo degradation must remain. Do not narrow what the candidate pass filters — only stop the source pass from over-filtering real paths.

---

## Amendment Round 3

### Why — the Round-2 approach was the wrong logic

A second Codex P2 (on the candidate-pass filter) plus empirical investigation showed the Round-2 "poison-token filtering" was solving a misdiagnosed problem. Measured facts (`git check-ignore --stdin -z` run against the real worktree):

- The **only** inputs that make `git check-ignore` exit 128 are **outside-repo paths** (`../x`, `/x`, bare `..` → "is outside repository") and **paths that traverse a symlinked directory** (e.g. `node_modules/foo.js` when `node_modules` is a symlink → "is beyond a symbolic link").
- Token *shapes* that Round 2 filtered — whitespace, glob chars, leading `-`, tabs — are all processed **fine** (exit 1). Because records are NUL-delimited (`-z`), a path with a space matches correctly. Filtering whitespace therefore (a) fixed nothing and (b) wrongly dropped legitimate space-bearing gitignored refs in BOTH passes, reporting them as `missing file` (the two P2s).

So the fix is not "predict bad token shapes" (we guessed wrong twice). It is "tolerate the handful of paths `git check-ignore` genuinely cannot resolve, without letting them poison the rest of the batch."

### New design (replaces Round-2 token filtering)

- **Remove** the `filterNonPathTokens` parameter and the whitespace / glob / leading-`-` / control-char filters added in Round 2. `collectGitIgnoredTargets` keeps only the genuine non-checkable drops: empty, `.`, `..`, and the `/` / `./` / `../` / `http(s)` prefixes (these are never repo-relative gitignore matches and definitionally cannot be checked). Both passes (source-file and candidate) call the identical function — no per-pass divergence.
- **Resilient batch (bisection on 128):** run the batched `git check-ignore --stdin -z`. On exit 0/1, parse normally. On exit 128 with >1 input, **split the input in half and recurse**, unioning the results; a single input that still 128s is treated as "not determinable" → simply omitted (it never poisons its siblings). This is robust to *any* unprocessable path (outside-repo, beyond-symlink, future unknowns) without enumerating causes.
- **No-git-repo degradation preserved cheaply:** before bisecting, confirm we're in a work tree once (`git rev-parse --is-inside-work-tree`); if not, return an empty set immediately (current "no skip outside a repo" behavior) rather than bisecting 900+ paths to no purpose.

Mechanics (recursion vs. explicit stack, exact helper name) deferred to implement. Chosen over a flat per-path loop on measured grounds: per-path = ~8.2 s / 977 `git` spawns; bisection = ~225 ms / 21 spawns — and the batch 128s on every run in this repo (a `node_modules`-symlink ref is present), so the fallback is hot, not rare.

### Amended / added Acceptance Criteria

- [ ] AC-12: A doc that cites a **gitignored target whose filename contains a space** produces NO finding (candidate pass). Verify: a fixture with `.gitignore` listing e.g. `docs/has space.md` and a doc citing `` `docs/has space.md` `` → `runChecks` returns `[]`.
- [ ] AC-13: An **unprocessable candidate path** (one that makes `git check-ignore` exit 128) does NOT disable the gitignore-skip for other candidates. Verify with a fixture that creates a **symlinked directory**, gitignores a real path, and cites both a path *through the symlink* (the 128-causer) and the separate gitignored real path → the real gitignored ref is still skipped (no finding), proving the 128 path was isolated, not allowed to empty the whole set.
- [ ] AC-14: The `filterNonPathTokens` parameter and the Round-2 whitespace/glob/leading-`-`/control filters are **removed**; `collectGitIgnoredTargets` filters only empty/`.`/`..`/prefix cases and is called identically by both passes. Verify by reading the source (no `filterNonPathTokens` references remain) and by AC-11/AC-12 passing.
- [ ] AC-15: Outside a git repo, the gitignore-skip degrades to "no skip" (empty set) without error and without per-path bisection of every candidate (one `--is-inside-work-tree` guard). Verify with the existing no-repo test path / a fixture outside a repo.
- [ ] AC-8 (corrected): the Round-2 poison-token test used `--force` / `npm run lint` as the "poison," but those are NOT unprocessable (exit 1). Replace that fixture's discriminator with a **genuine** 128-causer (the symlink path from AC-13) so the test actually exercises batch resilience. (If AC-13's test already covers this, fold AC-8 into it rather than keeping a non-discriminating duplicate.)
- [ ] AC-7 / AC-10 / AC-11 (re-confirm): full-tree `docs-refs-check` exits 0; the `../AGENTS.md` regression test stays green; gitignored source paths with spaces remain skip-listed (source pass).

### Scope note

Same file scope. Net effect vs. Round 2: simpler (one code path, no param), correct (no dropped valid refs), and resilient (bisection). Do not reintroduce token-shape filtering.
