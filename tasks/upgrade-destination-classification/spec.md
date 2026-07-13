# Spec: upgrade-destination-classification — canon upgrade: refuse untracked-existing targets, fail closed on git errors

> Written by: Claude | Review by: Codex
> Status: done
> Source: GitHub issue [#187](https://github.com/tstraub89/canon-ai/issues/187) (James Hazel, 2026-07-11); triage entry in `docs/BACKLOG.md` §Distribution & Portability

## Problem

A plain `canon upgrade` (no `--force`) overwrites an existing **untracked** file sitting at a canon-managed target path — content git cannot restore — and its git safety check **fails open** when git itself errors.

**Confirmed mechanism** (verified 2026-07-11 by direct source reading of `isPathDirty` in `src/cli/commands/upgrade.ts:172–192`, corroborated by the filer's disposable-repo reproduction in #187 with before/after sha256 hashes):

1. **Untracked skip**: `isPathDirty` iterates `git status --porcelain -- <path>` output and executes `if (xy === '??') continue;` (upgrade.ts:188) — untracked entries are explicitly treated as clean. An adopter's hand-made untracked file at a managed path (e.g. `.canon/templates/spec.md`) therefore never enters the `dirty` refusal bucket, and `runUpgrade` overwrites it. Because the file was never committed, `git restore` cannot bring it back. The #187 repro shows exactly this: sentinel file, `??` status confirmed, `upgrade --check` says "Would update", plain `upgrade` replaces it, content unrecoverable.
2. **Fail-open on probe error**: `if (result.status !== 0 || result.error) return false;` (upgrade.ts:182) — when `git status` cannot run (git missing, `GIT_DIR` broken, not a repo), every path is classified clean and everything is written. The safety boundary disappears exactly when the tool it depends on is broken. This branch has no test coverage today.
3. There is additionally a **gitignored-existing blind spot** in any `??`-based check: `git status --porcelain -- <path>` prints nothing for an ignored file, which is indistinguishable from tracked-clean. A gitignored file at a managed target is just as unrestorable by git as an untracked one.

**This revises a deliberate design choice, not a typo.** The current behavior is documented as intended in two places: the docstring "Untracked files return false (they don't represent 'user work that would be lost'). Returns false if the repo is not a git repo or git is unavailable — treat as clean." (upgrade.ts:172–176) and the inline comment "?? = untracked (we don't refuse on untracked)" (upgrade.ts:183–184). One test asserts the current behavior by name: `'runUpgrade: untracked dirty status does NOT trigger refusal'` (tests/cli.test.ts:2211). #187 demonstrates the premise was wrong: an untracked file at a managed target is precisely "user work that would be lost", and it is the *only* class git cannot restore after the overwrite.

The correct polarity already exists in this repo: `isGitTreeDirty` in `tools/strip-canon-block.mjs:27–40` returns **dirty** when the git probe errors (`if (result.status !== 0 || result.error) return true;`) — the canonical fail-closed example cited by `docs/patterns.md` §"Write-safety guards must fail closed when the underlying probe errors". `isPathDirty` predates that rule and violates it.

## Decision

Rework `canon upgrade`'s per-target safety check from a boolean dirty test into a **destination classification**, applied identically in `--check` and the real run, at the existing `pending` → refusal → `--check`/`--force` gate in `runUpgrade` (per `docs/patterns.md` §"route it through the existing safety queue" — no parallel guard):

| Class | Meaning | Behavior |
|---|---|---|
| **absent** | No file at the destination | Write (scaffold) |
| **canon-identical** | Existing content byte-identical to what would be written | Report unchanged, skip (existing short-circuit, unchanged) |
| **tracked-clean** | Tracked by git, no staged/unstaged modifications | Write (git can restore the prior content) |
| **tracked-dirty** | Tracked with staged/unstaged changes, including local deletion | **Refuse** unless `--force` (existing behavior, retained) |
| **untracked-existing** | File exists on disk but is not tracked by git — untracked (`??`) **or gitignored** | **Refuse** unless `--force` (new) |
| **unverifiable** | The git probe failed (git unavailable, broken repo state, not a git repo) and the destination **exists** with non-identical content | **Refuse** unless `--force` (new — fail closed) |

Notes on the git-error row: canon-identical detection is a content comparison that needs no git, so idempotent re-runs stay unchanged-only even with git broken; and an **absent** destination has no content at risk, so scaffolding into a directory where git is unavailable (greenfield installs) still works without `--force`. Git-state errors are fatal exactly where git is being used as the safety boundary — for destinations that exist.

**Classification order matters for the absent row.** A destination is **absent** only when git has no tracked record of it at all — a path that is tracked by git but locally deleted from disk (working-tree deletion) must classify as **tracked-dirty**, not absent, exactly as today's `isPathDirty` already refuses (`tests/cli.test.ts` `'runUpgrade: locally-deleted tracked managed file is refused without --force'`, the Codex P1 fix noted inline there — "the check now asks git regardless of `existsSync()`"). The classifier must consult git's tracked state before falling back to a bare `existsSync` check on the destination, or a locally-deleted tracked file would be silently reclassified as safe-to-scaffold — reintroducing an unrestorable-overwrite bug of the same shape this task fixes, via a different code path.

Refusal remains **all-or-nothing** (one refused target aborts all writes, exit code 2) and `--force` remains the single override, now covering all three refusal classes. `--force` still does **not** override a malformed `.gitignore` canon block. All write sources flow through the same gate as today (CANON_OWNED, delimited, header-only sync, `.canon/version`, the `.gitignore` block upsert, and the docs-refs cutover's `scripts/docs-refs-config.mjs` scaffold — six sources total, not five; see Interaction Dependencies).

Refusal output distinguishes the three classes with distinct messages naming the correct fix per class (per `docs/patterns.md` §Validation Gate Discipline, "one message per failure class"):
- tracked-dirty → commit/stash or `--force` (current message, kept);
- untracked-existing → the file exists but git is not tracking it, so git cannot restore it after an overwrite; commit it, move it aside, or pass `--force`;
- unverifiable → git state could not be determined and git is `canon upgrade`'s safety boundary; repair git (or run inside a git repo), or pass `--force`.

`--check` runs the identical classifier and reports the same per-class buckets it would act on, still writing nothing and exiting 0.

## Non-Goals

- **No backup or diff-on-replace feature.** #187 floats "provide a backup/diff when replacement is explicitly authorized" — deferred; if wanted it's a separate task. Scope bound: `--force` behavior in this task is limited to covering the two new refusal classes; it gains no new side effects.
- **No bundling with #188 or #189.** The `canon update` cwd bug and release-provenance gap are separate specs per the triage decision.
- **No "adoption mode".** `--force` is the only override; no new flags.
- **No cwd/repo-root resolution change.** `canon upgrade` continues to run against `process.cwd()`; the run-from-subdirectory gap is out of scope (pre-existing, orthogonal).
- **No changes to `canon init` or `canon doctor`.** Neither shares `isPathDirty`; init's write behavior is untouched.
- **No change to malformed-`.gitignore` handling** (still not `--force`-overridable, still exit 0 when it's the only finding).
- **No change to `tools/strip-canon-block.mjs`** — it is cited as the polarity reference only.

## Acceptance Criteria

- [ ] AC-1 **(red-first regression — untracked sentinel)**: A test builds a git repo fixture with an untracked file containing a unique sentinel at a `CANON_OWNED` target path, runs `runUpgrade` without `--force`, and asserts: nothing is written, the sentinel content is intact on disk, and the path is reported in an untracked-existing refusal bucket. This test fails on pre-fix code (which reports the path in `upgraded` and replaces the content — the #187 repro). The existing test `'runUpgrade: untracked dirty status does NOT trigger refusal'` (tests/cli.test.ts:2211) is inverted to assert refusal; it must not survive in its current form (`grep -n "does NOT trigger refusal" tests/cli.test.ts` returns nothing).
- [ ] AC-2 **(red-first regression — forced git failure)**: A test makes the git probe itself fail (e.g. non-repo temp dir, or env with git unreachable / `GIT_DIR` poisoned) while a non-identical file exists at a managed target, runs `runUpgrade` without `--force`, and asserts refusal (nothing written, path reported in an unverifiable/git-error refusal bucket). Fails on pre-fix code, which writes everything. This satisfies the `docs/patterns.md` fail-closed rule: "every new write-safety guard needs a test where the probe itself fails … asserting refusal, not permission."
- [ ] AC-3 **(absent target under git failure — scaffold path preserved)**: A test in a non-git temp dir with **no** existing file at the target asserts `runUpgrade` writes it without `--force`. Paired with AC-2 so the two pin the boundary: git failure blocks only destinations that exist.
- [ ] AC-3b **(locally-deleted tracked file stays refused, never falls to absent)**: A test commits a managed file, then deletes it from the working tree only (`git rm` not used), and asserts a plain `runUpgrade` (no `--force`) still refuses it as tracked-dirty — it must not be reclassified as absent and scaffold-written. This is a preservation AC for the existing passing behavior at `tests/cli.test.ts` (`'runUpgrade: locally-deleted tracked managed file is refused without --force'`), guarding against the new "absent" class swallowing it via a naive `existsSync`-first check.
- [ ] AC-4 **(gitignored-existing refuses)**: A test with a git repo whose `.gitignore` ignores a managed target path, and a non-identical file present there, asserts refusal without `--force`. (Fixture discipline per `docs/patterns.md` §Test-writing pitfalls: plain porcelain output will not surface this file — the classifier must establish trackedness explicitly, and the test must be constructed so it cannot pass vacuously.)
- [ ] AC-5 **(--force overrides all refusal classes)**: Tests assert `--force` writes the pending set in each of the three refusal scenarios (tracked-dirty, untracked-existing, unverifiable), with the written paths reported. The existing `--force` test (tests/cli.test.ts:2153) keeps passing.
- [ ] AC-5b **(--force must NOT override a malformed `.gitignore` block — regression guard)**: A test with a malformed canon block in `.gitignore` (unrecoverable open marker) as the *only* finding asserts `runUpgrade --force` still does not write/repair it: the malformed path is reported as malformed (not upgraded), and the existing malformed-`.gitignore` behavior is unchanged. This pins the invariant that widening `--force` to cover the three new refusal classes must not leak into the malformed-block abort. Fails if an implementer routes the malformed case through the same `--force`-overridable gate. (The current non-`--force` malformed test is tests/cli.test.ts:1454.)
- [ ] AC-6 **(tracked-clean still writes)**: A test with a committed, unmodified managed file whose content differs from the shipped template asserts a plain `runUpgrade` overwrites it — the new classes must not over-tighten the tracked-clean path.
- [ ] AC-7 **(canon-identical short-circuit survives, even without git)**: A test with a byte-identical file at the target in a non-git dir asserts it is reported unchanged and not refused — idempotent re-runs need no git.
- [ ] AC-8 **(--check parity)**: For fixtures covering each class (absent, canon-identical, tracked-clean, tracked-dirty, untracked-existing, unverifiable), a test runs `--check` then the real run on the same fixture state and asserts the *underlying classification is identical* — the same path lands in the same class in both modes. Parity is normalized, not a literal shared field name: `--check` reports the would-write set as `wouldUpgrade` and the refused set as `dirtyRefused`, while the real run reports the written set as `upgraded`; the test compares the classified path sets across these corresponding fields, not the field names themselves. `--check` writes nothing and exits 0; a real refused run exits 2. (The existing deliberate asymmetry stands: `--check --force` behaves as plain `--check`.)
- [ ] AC-8b **(mixed pending set — all-or-nothing withholds the writable target too)**: A test with a fixture where a would-write target (absent or tracked-clean) and a refused target (untracked-existing or unverifiable) are both in the same pending set asserts that a plain `runUpgrade` (no `--force`) writes **neither** — the writable target is withheld along with the refused one, and it is written on a subsequent `--force` run. This locks the classify-then-write ordering (classification completes across all targets before any write) and pins the "all-or-nothing refusal amplification" behavior named in Known Risks.
- [ ] AC-9 **(per-class refusal messages)**: CLI output for a refused run names each refused path under a class-specific heading with the class-appropriate remedy (commit/stash vs. commit/move-aside/`--force` vs. repair-git/`--force`). Verified by CLI-level test or output assertion; a single shared catch-all message for structurally different classes fails this AC.
- [ ] AC-10 **(design-comment replacement)**: The revised design is documented where the old one was: `grep -n "don't refuse on untracked" src/cli/commands/upgrade.ts` and `grep -n "treat as clean" src/cli/commands/upgrade.ts` both return nothing, and the replacing docstring states the classification model and the fail-closed polarity.
- [ ] AC-11 **(README wording)**: The `canon upgrade` row in `README.md` (~line 235) describes the new refusal semantics — refuses locally-modified **and** untracked-existing (and git-unverifiable) canon-owned targets unless `--force`. Verified by reading the row; `npm run docs-refs-check` passes.
- [ ] AC-12 **(existing suite green, fixture changes accounted for)**: `npm test` passes. Existing tests that intentionally relied on the non-repo fail-open path (e.g. tests/cli.test.ts:901, :931, :2099) are updated with git fixtures or expectation changes as needed — each such change is listed in the handoff with a one-line reason.
- [ ] AC-13 **(docs-refs-config.mjs scaffold write source is covered)**: A test with an untracked, non-identical `scripts/docs-refs-config.mjs` already present at the docs-refs cutover's scaffold target asserts a plain `runUpgrade` refuses it as untracked-existing, the same as any other managed target. This closes the sixth write-source gap Codex spec_review flagged in round 1 — the spec previously said "all five write sources" when the docs-refs cutover scaffold (`upgrade.ts:296–320`) is a sixth source that also pushes into `pending`.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/upgrade.ts` | Replace `isPathDirty` with a destination classifier covering the class model above; wire the refusal gate to refuse tracked-dirty, untracked-existing, and unverifiable; extend the `runUpgrade` result to carry per-class refusal buckets; per-class CLI messages in `upgradeCmd`; replace the fail-open docstring/comment |
| `tests/cli.test.ts` | New fixtures per AC-1…AC-13 (incl. AC-3b, AC-5b, AC-8b); invert :2211; adjust non-repo-reliant fixtures per AC-12 |
| `README.md` | Update the `canon upgrade` command-table row (refusal-semantics wording) per AC-11 |
| `dist/cli/index.js` | Regenerated by `npm run build` from the `src/cli/commands/upgrade.ts` change; kept in the diff since it's the published `canon` bin. Not independently authored — code review confirmed zero drift against source. |

(No `templates/` mirrors: none of these files are in `CANON_OWNED`/`DELIMITED`.)

### Interaction Dependencies

- All six write sources inside `runUpgrade` (delimited merge, header-only sync, `CANON_OWNED` loop, `.canon/version`, `.gitignore` block upsert, and the docs-refs cutover's `scripts/docs-refs-config.mjs` scaffold at `upgrade.ts:296–320` — Codex spec_review round 1 caught this as a missing sixth source) share the single `pending` gate — the classifier applies uniformly. Note the consequence: a canon-scaffolded, never-committed tree will now be refused on non-identical targets until the adopter commits or passes `--force`. This is intended — those files are exactly the git-unrestorable class — and the untracked-existing message makes the remedy obvious.
- `getStaleOverrides` / `tasks/_templates` nudge logic consumes the written/clean sets; bucket names may shift but override behavior is unchanged (overrides are never auto-written).
- `tools/strip-canon-block.mjs` untouched; referenced only as the fail-closed precedent.
- Prior art for untracked-clobber reasoning exists in `src/task/index.ts:1213–1330`; the operative call at `src/task/index.ts:1322` is `git ls-files --others` **without** `--exclude-standard` — a deliberate choice (see the comment at :1316–1321) so gitignored files at target paths are also surfaced, which is exactly the gitignored-existing behavior AC-4 wants. The classifier may take the same approach to establish trackedness — implementation's choice, but single-path `git status --porcelain` output alone cannot distinguish tracked-clean from gitignored (AC-4).

### Data Model Changes

The `runUpgrade` return shape (consumed only by `upgradeCmd` and tests) gains per-class refusal reporting — either new buckets alongside `dirtyRefused` or a classified structure replacing it. No persisted data, no `status.json` schema involvement.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [x] `npm run docs-refs-check` (README row edit)

## Docs Impact

- `docs/patterns.md` — the §"Write-safety guards must fail closed" pitfall currently names `strip-canon-block.mjs` as the canonical case; QA may add the upgrade classifier as a second instance (heads-up only).
- Others: none expected — `docs/product-context.md` Flow 1's `canon upgrade` note stays behavior-compatible.

## Known Risks

- **Adopter-facing behavior change on a routine command.** Trees scaffolded by `canon init` and never committed will now refuse a subsequent non-identical upgrade until committed (or `--force`d). This is the point of the fix — that content is unrestorable — but the release step should treat the refusal-semantics change as at least a **minor** bump, and the changelog entry must state the new refusal classes and remedies plainly.
- **Gitignored-vs-tracked-clean ambiguity (AC-4) is the subtlest correctness trap.** Empty single-path porcelain output means *either* tracked-clean *or* ignored; a classifier that reads only `git status --porcelain -- <path>` will silently misclassify ignored files as safe. Trackedness must be established explicitly, and the AC-4 fixture must actually exercise the ignored path rather than passing vacuously.
- **Blast radius through existing fixtures.** Several existing tests run `runUpgrade` in non-git temp dirs and currently succeed via the fail-open branch. Under the new model most still pass (absent targets scaffold; identical content stays unchanged), but any fixture with existing non-identical content will start refusing. AC-12 requires each adjusted test to be individually justified in the handoff so silent expectation-flips can't hide a real regression.
- **Over-tightening.** The refusal set must not grow beyond the two new classes: tracked-clean overwrites (AC-6) and absent scaffolds under git failure (AC-3) are the guard rails against turning the fix into an upgrade-blocker.
- **All-or-nothing refusal amplification.** One untracked-existing file now blocks the entire upgrade run (as one tracked-dirty file does today). Retained deliberately for predictability; the per-class message must name every refused path so a multi-path refusal is resolvable in one pass.
- **Sixth write source easy to miss.** `runUpgrade` has six sources feeding the shared `pending` gate, not five — the docs-refs cutover's `scripts/docs-refs-config.mjs` scaffold (`upgrade.ts:296–320`) is easy to overlook because it's a conditional scaffold-only-if-missing path, not a steady-state overwrite like the others. AC-13 exists specifically to keep this source honest.
- **Absent-vs-locally-deleted-tracked precedence.** A classifier that checks `existsSync` before consulting git will misclassify a locally-deleted-but-tracked file as absent and scaffold over it, silently reintroducing an unrestorable-overwrite bug via a different code path than the one this task closes. AC-3b guards this; implementers must establish trackedness first, on-disk existence second.

## Human Test Plan

1. In a canon-adopted repository, create a file with your own recognizable content at a canon-managed location that git is not tracking. Run canon's upgrade command without any flags. Expected: the upgrade refuses, names your file, explains that it exists but isn't tracked (so git could not restore it after an overwrite), and your content is untouched.
2. Run the upgrade's preview mode on the same repository. Expected: the preview reports exactly the same refusal it would enforce for real, and changes nothing.
3. Re-run the upgrade with the force flag. Expected: the file is replaced and listed in the output as updated.
4. In a directory where git can't answer (for example, one that isn't a git repository) with a modified canon-managed file present, run the upgrade. Expected: it refuses and says it cannot verify safety because git — its safety boundary — is unavailable.
5. In a fresh empty directory that isn't a git repository and has none of canon's files, run the upgrade. Expected: files are created normally — scaffolding still works where nothing can be lost.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`). `- [ ]` is a placeholder; the spec author flips required checks to `- [x]` before marking spec done. The orchestrator's code_review pre-flight blocks if no `[x]` items are present.
- [x] (Bug/flake fixes; N/A for features/refactors) *Problem* states the confirmed mechanism and how it was confirmed, not merely a plausible cause; *Acceptance Criteria* includes a red-first regression-test AC or an explicit environment-bound and faithful-repro-impractical escape with a deterministic alternative
