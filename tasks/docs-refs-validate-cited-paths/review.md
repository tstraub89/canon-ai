# Code Review: docs-refs-validate-cited-paths

> Reviewer: Claude | Spec: `tasks/docs-refs-validate-cited-paths/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All five spec-required checks show `Pass`. `npm run build` and E2E are marked `deferred_by_spec` with Notes citing the spec's explicit N/A annotations — both are credible and neither check covers files this task modified.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `stripLineCitation` exists, strips all citation forms, verify by unit assertions | Met | Function at `scripts/docs-refs-check.mjs:277–281`. Spec's Design note explicitly permits private function + `runChecks` coverage: "may stay module-private and be exercised through `runChecks` behavior (AC-2/AC-3 already pin the observable outcome)." All representative forms exercised through integration tests. |
| AC-2: Comma-list citation on an existing file → no finding | Met | Test `'line-citation refs: comma-list citation on an existing file passes'` at `tests/docs-refs-check.test.ts:109`. |
| AC-3: Missing file with line citation → `missing file` finding with full original ref text | Met | Test `'line-citation refs: missing file reports the full cited ref text'` at `tests/docs-refs-check.test.ts:125`. Finding shape matches spec exactly. |
| AC-4: Existing line-citation tests stay green (single, range, dash variants, `#L` forms) | Met | Existing test at `tests/docs-refs-check.test.ts:85` is unchanged and still green through the new code path. |
| AC-5: Gitignore-skip applies to a line-cited ref | Met | Test `'gitignored target paths are skipped when the ref is line-cited'` at `tests/docs-refs-check.test.ts:755`. Code strips at both `collectCandidateTargetPaths` (line 397) and `findBrokenRefs` (line 492) so candidate-set and lookup keys agree. (See nit in Stage 2 about the fixture's discriminating power.) |
| AC-6: Non-class-1 handlers unchanged; `isLineCitationTarget` still used and existing tests green | Met | `isLineCitationTarget` at `scripts/docs-refs-check.mjs:273` is untouched and still called by symbol-in-file, section, and anchor-link loops. Existing tests unchanged. |
| AC-7: `npm run docs-refs-check` exits 0 against current tree | Met | Handoff reports `Pass` / `All refs OK`. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work — symbol-in-file, section §, anchor-link handlers untouched; line numbers not verified)
- [x] Known Risks addressed or accepted (over-stripping and set-key mismatch risks called out; mitigations verified via regex anchoring and dual-site stripping)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, minimal change. `stripLineCitation` is well-anchored (end-of-string `$`), handles all required citation forms, and is correctly applied at both the candidate-collection site and the check site. The `isLineCitationTarget` short-circuit removal is clean and the original `refText = match[0]` preservation keeps findings readable. New tests cover the three net-new behaviors. No correctness bugs or risks.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit`: The AC-5 gitignore test (`'gitignored target paths are skipped when the ref is line-cited'`, `tests/docs-refs-check.test.ts:755`) uses the hidden settings file as the fixture target. After stripping the citation, the top-level component is `.claude`, which is almost certainly not in `validDirs` — so the test returns `[]` via the `validDirs` gate, not via the gitignore path. The test would pass even if the gitignore-skip-with-line-citation wiring were broken. A more discriminating fixture would use a path under a valid top-level directory (e.g. `docs/` or `scripts/`) that is also gitignored, so the only path to `[]` is through gitignore. (Flagged by cold lens; code is correct — stripping is present at both sites — but the test doesn't specifically discriminate the gitignore gate.) Not blocking.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed (cold): symbol-in-file / section handlers don't strip comma-list citations** — spec Non-Goals are explicit: "The three non-class-1 ref handlers (symbol-in-file, section `§`, anchor-link) are unchanged — `isLineCitationTarget` is still referenced by them." Pre-existing behavior, deliberately out of scope.
- **Dismissed (cold): anchor-link loop comma-list inconsistency** — same reason; anchor-link handler is explicitly unchanged per Non-Goals. The `!rawTarget.includes('#')` guard is a separate pre-existing filter.
- **Dismissed (cold): `isLineCitationTarget` inconsistency across loops** — spec design: `isLineCitationTarget` remaining in the three non-class-1 handlers is the intended design; the function is not removed, only the class-1 skip is replaced with strip-then-validate.
- **Dismissed (anchored): AC-1 Stage 1 fail on missing direct unit assertions** — spec Design note (under AC-1) explicitly permits: "may stay module-private and be exercised through `runChecks` behavior (AC-2/AC-3 already pin the observable outcome)." The Design note overrides the AC-1 verification-method clause.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

## Round 2 — verifying iteration 2's response to round 1 (post-reroute)

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `stripLineCitation` exists, strips all citation forms | Met (unchanged from round 1) | Function at `scripts/docs-refs-check.mjs:277–281`. All listed forms covered. |
| AC-2: Comma-list citation on an existing file → no finding | Met (unchanged from round 1) | Test `'line-citation refs: comma-list citation on an existing file passes'`. |
| AC-3: Missing file with line citation → `missing file` finding with full ref text | Met (unchanged from round 1) | Test `'line-citation refs: missing file reports the full cited ref text'`. |
| AC-4: Existing line-citation tests stay green | Met (unchanged from round 1) | Existing test unchanged; still green. |
| AC-5: Gitignore-skip applies to a line-cited ref | Met (strengthened by AC-9) | Dual-site stripping unchanged; new discriminating test now exercises the gitignore gate specifically. |
| AC-6: Non-class-1 handlers unchanged | Met (unchanged from round 1) | `isLineCitationTarget` and symbol/section/anchor handlers untouched. |
| AC-7: `npm run docs-refs-check` exits 0 (re-confirmed) | Met | Handoff re-confirms exit 0 on full worktree tree including `review.md`'s gitignored ref. |
| AC-8: Gitignore-skip robust to non-path candidate tokens | Met | `collectGitIgnoredTargets` safe-filter drops empty, `.`/`..`, `-`-prefixed, whitespace-bearing, control-char, and glob-char tokens before the `git check-ignore` batch. |
| AC-9: AC-5 test discriminates the gitignore gate | Met | New test `'gitignored target paths are skipped when the ref is line-cited and a poison token is present'` uses `docs/gitignored/` (top-level `docs` is in `validDirs`) with `--force` poison token; the only path to `[]` is through the gitignore check. |
| AC-10: Prior `../AGENTS.md` exit-128 regression test stays green | Met | Test `'gitignored skip survives parent-relative anchor links elsewhere in the repo'` retained and reported passing. |

Validation gate: all five required checks (`npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`) pass. `npm run build` and E2E remain `deferred_by_spec` — credible, neither covers files changed by this task.

### Verifying Round 1 findings

- `optional cleanup/nit: AC-5 test not discriminating` → addressed by AC-9 amendment. New test uses `docs/gitignored/` (validDirs, so validDirs gate does not short-circuit) plus `--force` poison token; test fails if either dual-site stripping or batch-robustness regresses. ✓

### New findings (only NEW issues introduced by iteration 2's changes)

- `optional cleanup/nit`: `scripts/docs-refs-check.mjs:362–368` — The expanded `safe` filter adds seven new conditions (empty, `.`, `..`, `-`-prefix, whitespace, control chars, glob chars), but the existing block comment above the `safe` filter only explains the prior conditions (relative paths, absolute paths, http/https URLs). The new conditions are self-evident from the regex, but a one-line comment extension (e.g. "non-path tokens: empty, self-refs, flag-like, whitespace/control, glob chars") would keep the comment current. Not blocking.

### Dismissed Cold Findings (Round 2)

- **Dismissed (cold): symbol-in-file / `isLineCitationTarget` inconsistency with comma-list** — Spec Non-Goals explicitly: "Not changing the symbol-in-file, section §, or anchor-link ref handlers. Those three keep their current `isLineCitationTarget` behavior unchanged." Intentionally out of scope.
- **Dismissed (cold): gitIgnoredTargets lookup inconsistency in symbol-in-file** — same Non-Goals reason; symbol-in-file handler is explicitly preserved as-is.
- **Dismissed (cold): `stripLineCitation` double-replace edge case (`file.ts:10#L20`)** — anchored lens analysis confirms the sequential `$`-anchored replacements are correct and converge safely; the edge case is an invalid/unreachable input in practice. Low confidence, confirmed non-bug.
- **Dismissed (cold): redundant `git init` in new AC-9 test** — the surrounding `'gitignored skip survives parent-relative anchor links...'` test also calls `spawnSync('git', ['init'])`, establishing the pattern that gitignore tests init git explicitly. The new test follows the same pattern; all tests pass. Not a bug.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

---

## Round 3 — verifying iteration 3's response to round 2

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `stripLineCitation` exists, strips all citation forms | Met (unchanged from round 2) | Function at `scripts/docs-refs-check.mjs:277–281`. All forms covered. |
| AC-2: Comma-list citation on existing file → no finding | Met (unchanged from round 2) | Test `'line-citation refs: comma-list citation on an existing file passes'`. |
| AC-3: Missing file with citation → `missing file` finding with full ref text | Met (unchanged from round 2) | Test `'line-citation refs: missing file reports the full cited ref text'`. |
| AC-4: Existing line-citation tests stay green | Met (unchanged from round 2) | Existing test unchanged and still green. |
| AC-5: Gitignore-skip applies to a line-cited ref | Met (unchanged from round 2) | Dual-site stripping unchanged; discriminating fixture retained. |
| AC-6: Non-class-1 handlers unchanged | Met (unchanged from round 2) | `isLineCitationTarget` at line 273 still referenced by symbol-in-file (line 525), section § (line 548), anchor-link (line 570). |
| AC-7: `npm run docs-refs-check` exits 0 (re-confirmed) | Met | Handoff re-confirms exit 0 on full worktree tree. |
| AC-8: Gitignore-skip robust to non-path candidate tokens | Met (re-confirmed) | Candidate pass calls `collectGitIgnoredTargets(..., { filterNonPathTokens: true })`; `-`-prefix, whitespace, and glob guards apply only to that pass. AC-8 poison-token test (`'gitignored target paths are skipped when the ref is line-cited and a poison token is present'`) still green. |
| AC-9: AC-5 test discriminates the gitignore gate | Met (unchanged from round 2) | Discriminating fixture under `docs/gitignored/` with `--force` poison token retained. |
| AC-10: Prior `../AGENTS.md` exit-128 regression test stays green | Met (re-confirmed) | Test `'gitignored skip survives parent-relative anchor links elsewhere in the repo'` passes. |
| AC-11: Aggressive filter scoped to candidate pass only; source pass restores pre-round-2 behavior; gitignored source with space still skip-listed | Met | Source-file call at line 451: `collectGitIgnoredTargets(repoRoot, new Set(sourceRelByAbs.values()))` — no `filterNonPathTokens`, so whitespace/glob guards absent. A gitignored source path whose name contains a space (the AC-11 fixture) reaches `git check-ignore` and is correctly listed in `ignoredSources`. Test `'gitignored markdown source files with spaces are still skipped from scanning'` at `tests/docs-refs-check.test.ts:859` verifies this. |

Validation gate: all five spec-required checks (`npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`) pass. `npm run build` and E2E remain `deferred_by_spec` — credible, no coverage gap for files changed by this task.

### Verifying Round 2 findings

- `optional cleanup/nit: stale block comment above safe filter` → nit; not addressed (optional). Not eligible for round 3+ per review template rules.

### New findings (only NEW issues introduced by Iteration 3's changes)

(none) — Cold lens raised four items; none survive adjudication:
- **Dismissed (cold): bare `.`/`..` tokens not blocked by `gitStdinSafe` in source-file pass** — labeled "code quality, near-zero practical risk" by cold lens; source-file inputs are produced by `path.relative(repoRoot, abs)` over walked files and are never bare `.` or `..`. Not a correctness bug.
- **Dismissed (cold): `/\s/u` and `/[ -]/u` overlap** — harmless, not a bug.
- **Dismissed (cold): `target.length > 0` behavioral improvement** — an improvement, not a defect.
- **Dismissed (cold): AC-11 test lacks negative control** — nit; not eligible for round 3+.

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

---

## Round 4 — verifying Iteration 4's response to round 3

Foreman synthesis from anchored lens + cold lens run in parallel. Round 3 verdict was `Approved` on the filterNonPathTokens split. Iteration 4 replaces that approach wholesale with bisection; this round reviews the Round-3 rewrite.

### Stage 1 — Acceptance Criteria Re-Check

All 15 ACs verified against the Iteration 4 code (bisection implementation).

| AC | Status | Notes |
|---|---|---|
| AC-1: `stripLineCitation` exists, strips all forms | Met (unchanged from round 3) | `scripts/docs-refs-check.mjs:277–281`. All required forms; exercised via integration tests per spec Design note. |
| AC-2: Comma-list citation on existing file → no finding | Met (unchanged from round 3) | Test `'line-citation refs: comma-list citation on an existing file passes'` at `tests/docs-refs-check.test.ts:109`. |
| AC-3: Missing file with citation → finding with full ref text | Met (unchanged from round 3) | Test at `tests/docs-refs-check.test.ts:125`. |
| AC-4: Existing line-citation tests stay green | Met (unchanged from round 3) | Test at line 85; unchanged. |
| AC-5: Gitignore-skip applies to line-cited refs | Met | Dual-site stripping at `collectCandidateTargetPaths:424` and `findBrokenRefs:519`. Both call sites now use parameterless `collectGitIgnoredTargets`, so candidate-set and lookup keys agree. |
| AC-6: Non-class-1 handlers unchanged | Met (unchanged from round 3) | `isLineCitationTarget` still called by symbol-in-file (line 537), section § (line 560), anchor-link handlers. |
| AC-7: `npm run docs-refs-check` exits 0 (re-confirmed) | Met | Handoff Iteration 4 re-confirms exit 0 on full worktree tree. |
| AC-8: Gitignore-skip robust to genuine 128-causers | Met | Bisection in `runGitCheckIgnoreBatch` isolates any exit-128 path without disabling siblings. Test `'gitignored target paths are skipped when a symlinked 128-causer appears in the same fixture'` at `tests/docs-refs-check.test.ts:755` uses a symlink-traversal path as the genuine 128-causer (not token-shape filtering). |
| AC-9: AC-5 test discriminates the gitignore gate | Met | Test at line 755 uses symlink-based 128-causer alongside a gitignored line-cited ref (a comma-cited path under the valid `docs/` top-level dir); the only path to `[]` is through the gitignore-skip-with-bisection. |
| AC-10: `../AGENTS.md` exit-128 regression stays green | Met | Test `'gitignored skip survives parent-relative anchor links elsewhere in the repo'` at line 776; `../`-prefix filter still in `safe` at line 366. |
| AC-11: Space-bearing gitignored source paths not over-filtered | Met | No `filterNonPathTokens` param in Round 3 rewrite; both passes call identical `collectGitIgnoredTargets(repoRoot, set)`. Test `'gitignored markdown source files with spaces are still skipped from scanning'` at line 863 verifies the source pass. |
| AC-12: Space-bearing gitignored target → no finding (candidate pass) | Met | Test `'gitignored target paths with spaces are skipped when the citation is in a scanned doc'` at `tests/docs-refs-check.test.ts:884`; bisection processes a space-bearing gitignored path correctly (NUL-delimited batch handles spaces). |
| AC-13: Unprocessable 128-causer doesn't disable other candidates | Met | Bisection at `scripts/docs-refs-check.mjs:394–403`: exit-128 on >1 input → split and recurse; exit-128 on 1 input → return empty Set for that path only. Test at line 755 proves siblings survive. |
| AC-14: `filterNonPathTokens` removed; both passes use identical function | Met | `filterNonPathTokens` does not appear in any changed file. Both call sites at lines 465 and 470 call `collectGitIgnoredTargets(repoRoot, set)` with no options. |
| AC-15: Outside git repo degrades to empty set without per-path bisection | Met | `git rev-parse --is-inside-work-tree` guard at line 373 returns empty Set if not in a work tree, before `runGitCheckIgnoreBatch` is reached. Test `'gitignored skip degrades to no-skip outside a git repo'` at line 901 verifies degradation produces a `missing file` finding. |

Validation gate: all five spec-required checks (`npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`) report Pass in Iteration 4's handoff. `npm run build` and E2E remain `deferred_by_spec` — spec-cited N/A, no coverage gap.

Non-goals respected (symbol-in-file, section §, anchor-link handlers untouched). Known Risks addressed. Human Test Plan satisfiable.

**Stage 1 verdict: Pass.**

### Stage 2 — Code Quality

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit` (both lenses): `scripts/docs-refs-check.mjs:323–336` — The docblock comment describing `collectGitIgnoredTargets` appears immediately above `normalizeAnchorLinkPath`'s definition, not above `collectGitIgnoredTargets` itself. The two comment blocks are out of order relative to the functions they describe. Documentation only; no correctness impact. Flagged by both lenses independently (higher confidence).

- `optional cleanup/nit` (anchored lens): `tasks/docs-refs-validate-cited-paths/handoff.md` — AC-5 coverage note in the initial Changes table says the test is named `'gitignored target paths are skipped when the ref is line-cited'`, but the actual test (which correctly covers AC-5) is named `'gitignored target paths are skipped when a symlinked 128-causer appears in the same fixture'` at line 755. Handoff artifact only; no code impact.

- `optional cleanup/nit` (anchored lens, low confidence): `tests/docs-refs-check.test.ts:763` — The AC-13 fixture uses an absolute symlink (`fs.symlinkSync(path.join(root, 'content'), path.join(root, 'docs', 'link'), 'dir')`). The target is outside the test repo root, which is what causes git to exit 128 on traversal. On platforms where `os.tmpdir()` resolves inside an enclosing git worktree, there is a theoretical risk the nested `git init` changes the 128-causer semantics. Tests pass in the current environment; this is an environmental edge case, not an observed failure. Low confidence, low severity.

#### Spec Gaps

(none)

### Dismissed Cold Findings (Round 4)

- **Dismissed (cold): symbol-in-file comma-list gap** — Cold lens flags that `collectCandidateTargetPaths` adds symbol-in-file file paths (`match[2]`) without `stripLineCitation`, and that `isLineCitationTarget` does not match comma-list suffixes (`:151,254`). Both points are correct observations. However, spec Non-Goals are explicit: "Not changing the symbol-in-file, section §, or anchor-link ref handlers. Those three keep their current `isLineCitationTarget` behavior unchanged." This is pre-existing behavior deliberately excluded from scope. Dismissed.
- **Dismissed (cold): test integrity — no symbol-in-file comma-list test** — Same Non-Goals exclusion. No test is required for out-of-scope behavior. Dismissed.
- **Dismissed (cold): `stripLineCitation` mixed citation edge case (a path with both a `:N` colon citation and a `#LN` anchor suffix)** — Pathological form with no real-world occurrence. The sequential `$`-anchored regexes handle all specified forms correctly; an intentionally invalid mixed form is not a specified input. Negligible blast radius. Dismissed.
- **Dismissed (cold): double `git rev-parse` per `findBrokenRefs` call** — `collectGitIgnoredTargets` is called twice per scan (source-file pass + candidate pass), adding two extra subprocess calls. Negligible in practice; no correctness risk. Dismissed as risk/nit below round 3+ threshold.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
