# Code Review: fix-staged-deletion-autocommit-and-dir-refs

> Reviewer: Claude | Spec: `tasks/fix-staged-deletion-autocommit-and-dir-refs/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

Lens inputs this round:
- **Anchored Claude:** Stage 1 pass. It reproduced all five red-first failures on the pre-fix code, re-ran the full suite unskipped (1265/1265), and confirmed the committed `dist/` matches a fresh build. It also mutation-tested the helper (Finding 2).
- **Cold Claude:** returned `changes_requested`. It found the evidence-gate gap (Finding 1), which the foreman verified.
- **Cold Codex:** "No actionable defects were identified."

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens independently re-ran lint, type-check, docs-refs-check, sync-templates:check and `npm test`. In a non-linked scratch copy, `npm test` gave 1265 pass, 0 fail, 0 skipped. A fresh build matches the committed `dist/`. E2E is N/A per the spec.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: staged deletion only (red-first) | Pass | `tests/run-task-safety.test.ts:1368`. Red-first reproduced (`pathspec 'dead.ts' did not match`). Asserts a new HEAD, exactly `D dead.ts`, and a clean tree. **Scope caveat:** the test drives `autoCommitCode` directly through the new export. In a `worktree: false` task, the real implement phase never reaches auto-commit for this case (Finding 1). |
| AC-2: staged deletion + edit (red-first) | Pass | `:1382`. One new commit containing exactly `{D dead.ts, M keep.ts}`. |
| AC-3: staged rename (red-first) | Pass | `:1399`. At HEAD, `old.ts` is absent and `new.ts` is present. |
| AC-4: unstaged deletion unchanged | Pass | `:1414`. Passes both pre-fix and post-fix. |
| AC-5: QA-end commit (red-first) | Pass | `:1425`. Red-first reproduced. Asserts one commit with the `D` entry and the task-artifact `A` entries, and a clean tree. |
| AC-6: one shared helper, unit-tested | Pass (test is weak, see Finding 2) | `filterStageablePaths` is at `src/orchestrator/git.ts:86`. All three call sites use it: `src/orchestrator/main.ts:536`, `:936`, `:1399`. The unit test at `tests/run-task-validation.test.ts:80` covers all eight listed cases, but none of them exercises the index-prefix or fail-closed branches. |
| AC-7: early return removed | Pass | The grep count is 0 in `src/orchestrator/main.ts` and in `dist/`. |
| AC-8: directory refs | Pass | `tests/docs-refs-check.test.ts:67` (red-first), `:77`, `:86`. |
| AC-9: mirror in sync | Pass | `cmp` shows the files are identical, and `sync-templates:check` passes. |
| AC-10: red/green recorded, nothing skipped | Pass | The handoff records all five pre-fix messages, and the anchored lens reproduced each one. None of the new tests is gated. |
| AC-11: build and suite | Pass | Committed `dist/` matches a fresh build. lint, type-check, docs-refs-check and test all pass. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted. The "Excluding too much" risk is handled correctly by the code, but its test is incomplete (Finding 2).
- [ ] Human Test Plan is satisfiable by the implementation. **Partially.**
  - Step 1 (deletion-only via `git rm`) passes in the default worktree mode only by accident: the evidence gate finds the file in the main checkout. It still wedges for `worktree: false` tasks (Finding 1).
  - Step 5 cannot tell pre-fix from post-fix (Follow-up F4).

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The core fix is small and correct:
- `filterStageablePaths` drops only paths that are absent from both the index and the working tree, and keeps every path when a probe is uncertain.
- All three stage sites route through it, and the deletion-only commit path now reaches the commit.
- The docs-refs change does what Decision 3 says.
- The delicate guard audit is clean. The pre-stage checks, both staged-coverage checks, `findUncoveredTrackedChanges` and `verifyHandoffFilesCommitted` all still run at every site, including when the filtered list is empty.

Two things block approval:
1. The implement phase's evidence gate, which runs before auto-commit, still treats a staged deletion as "no evidence". So the headline #45 scenario still wedges for non-worktree tasks.
2. The helper's unit test does not pin the branch that guards the task's main Known Risk.

### Findings

#### Correctness Bugs

1. **[code-bug] The implement evidence gate rejects a handoff whose only change is a staged deletion, so auto-commit is never reached.** Location: `src/orchestrator/main.ts:2966-2969` (`checkImplementEvidence`). Source: cold-Claude; verified by the foreman.
   - **Mechanism:**
     - `checkAndRoute('implement')` runs `checkImplementEvidence` even when Codex marked implement done (`main.ts:3195`), before `autoCommitCode` (`:3308`).
     - For a deletion-only handoff, `existingFiles` is empty. The deletion fallback then builds `deletedInWorkingTree` from `git ls-files --deleted`, which lists only *unstaged* deletions. Foreman check: after `git rm dead.ts`, `ls-files --deleted` prints nothing, while `git diff --cached --name-only --diff-filter=D` prints `dead.ts`.
     - The committed diff (`base...HEAD`) does not have the deletion yet either.
     - So the gate returns "none exist on disk or are git-tracked deletions", resets implement to `in_progress`, and the one-shot retry cannot help. The run exits 2.
   - **Exposure:**
     - Any `worktree: false` task, which is a supported configuration; the existing gate test at `tests/run-task-safety.test.ts:7601` uses it.
     - Worktree tasks where the file is absent from the main checkout too, for example a file added earlier on the task branch and now `git rm`'d.
     - In the default worktree mode the gate usually passes only because `checkRoots` includes `REPO_ROOT`, where the file still exists on the base branch.
   - **Why this is a code-bug, not a spec gap:**
     - The gate's own comment (`main.ts:2959-2965`) states the invariant: "autoCommitCode already handles deletions; this pre-check must not be stricter". This diff made auto-commit accept staged deletions without updating its gatekeeper.
     - `main.ts` is in Affected Files, and no Non-Goal fences off the gate.
     - The spec's Human Test Plan step 1 expects the pipeline to "commit the deletion and move on".
     - The AC-1 test passes only because it calls the exported `autoCommitCode` directly. The spec's suggested harness, `checkAndRoute('implement', …)` with `worktree: false`, would have hit the gate.
   - **Fix:**
     - Count staged deletions as deletion evidence too. For example, build the set from `git diff HEAD --name-only --diff-filter=D` at `evidenceCwd`, which covers both staged and unstaged deletions, or union in `git diff --cached --name-only --diff-filter=D`.
     - Add a real-git temp-repo test that drives `checkAndRoute('implement', [id])` on a `worktree: false` task whose handoff lists only a `git rm`'d file. It should assert that the phase stays `done` and the deletion is committed. It must be red-first against the current gate.

2. **[code-bug: test integrity] The helper's directory-prefix branch and fail-closed fallback are untested; mutating them leaves the full suite green.** Location: `src/orchestrator/git.ts:94`, `:97-99`, `:107-108`; `tests/run-task-validation.test.ts:80-112`. Flagged by 2 lenses (anchored, cold-Claude).
   - **The gap:**
     - The AC-6 `kept-dir` candidate is still on disk, so `lstat` keeps it whatever the index branch does.
     - The anchored lens replaced the index match with a plain `indexed === normalized` (dropping the `startsWith(\`${normalized}/\`)` prefix match) and removed the trailing-slash strip. The full suite still passed, 1265/1265.
     - Changing the probe-error fallback `return [...paths]` to `return []` would also go uncaught.
   - **Why it matters:** these branches are the spec's "Excluding too much" Known Risk, which says AC-6's kept cases pin the boundary. A regression would silently drop a whole-directory deletion from a commit. Examples: an unstaged `rm -rf` of a `dist/` Affected-Files prefix at human-review, or of `tasks/<id>` at QA-end. docs/patterns.md §"Write-safety guards must fail closed when the underlying probe errors" also asks for a test where the probe itself fails.
   - **Current behavior is correct.** The anchored lens confirmed by hand that an `rm -rf`'d directory and `dist/` are kept, and that a non-repo cwd returns the input unchanged.
   - **Fix:** add three cases to the unit test:
     - a directory removed with plain `rm -rf` (index entries remain), which must be **kept**;
     - a `dir/` trailing-slash candidate for a directory that was `git rm -r`'d, which must be dropped, or one still in the index, which must be kept;
     - a probe-failure case, such as a cwd that is not a git repo, asserting the input comes back unchanged.

#### Risk / Guardrails

None that block. Pre-existing and out-of-scope risks are listed under Follow-ups below.

#### Optional Cleanup / Nit

- **N1.** `scripts/docs-refs-check.mjs:773-774` and the mirror call `fs.statSync` twice. `fs.existsSync(targetPath)` alone gives the same answer, since a path that exists is a file or a directory for this purpose, or use one `statSync(p, { throwIfNoEntry: false })`. Flagged by 2 lenses (anchored, cold-Claude).
- **N2.** `src/orchestrator/git.ts:88` passes every path to one `git ls-files` call with the default 1 MiB `maxBuffer`.
  - At human-review, directory prefixes like `src/` can overflow that buffer in a large adopter repo (ENOBUFS). Any non-zero exit, including one bad pathspec, turns the filter off for every path.
  - It fails safe, back to the pre-fix behavior, but the fix then does nothing there.
  - Consider a larger `maxBuffer`. Flagged by 2 lenses (anchored, cold-Claude).
- **N3.** `src/orchestrator/git.ts:85` doc comment: say that inputs must be canonical repo-relative paths.
  - An unstaged-deleted `./x.ts` or `a//b.ts` would not literally match the `ls-files` output and would be dropped.
  - This is unreachable today: the handoff pre-stage check rejects those spellings, and the QA and human-review stage paths are constants. Flagged by 2 lenses.
- **N4.** `tests/run-task-safety.test.ts:1399-1411` (AC-3 rename): add the clean-tree and one-new-commit assertions that AC-1 and AC-2 have.

#### Spec Gaps

(none that drive the verdict. The spec-quality items are listed as follow-ups F3 to F5.)

#### Follow-ups (not for Codex this round: pre-existing, fenced by a Non-Goal, or outside Affected Files)

- **F1. Pre-existing: gitignored handoff paths that exist on disk still reach `git add -A` and fail with "paths are ignored".** Location: `src/orchestrator/main.ts:536`. Flagged by 2 lenses (anchored, cold-Claude).
  - Cold-Claude reproduced two cases:
    - a gitignored build artifact listed next to its generator, as `main.ts:461-467` explicitly invites;
    - `git rm --cached secret.env` followed by adding it to `.gitignore`.
  - Both die with `Failed to stage files`.
  - **Why it is not a required fix here:** this diff did not introduce it; pre-fix `stageable` had the same path. The fix also has its own design question: whether `check-ignore` treats tracked-but-ignored files as ignored, which would silently drop real edits. It needs its own issue and tests. One side effect of this diff: a gitignored path that is *absent* is now dropped instead of dying, which is harmless because both downstream checks already exempt gitignored paths.
- **F2. The same staged-deletion exposure exists in `commitTaskArtifactsToBase` (`src/orchestrator/git.ts:129-130`).** Flagged by 2 lenses (anchored, cold-Claude).
  - Its `git add -- <telemetry file>` throws when an operator `git rm`'d the file before `canon run`.
  - The spec's Non-Goals exclude this site explicitly, so it is out of scope. But the stated reason ("None stages a path the caller removed through the index") applies equally to `commitQaArtifacts`, which this task fixed.
  - Recommend an issue that routes it through `filterStageablePaths`.
- **F3. Stale adopter guidance in `.canon/templates/handoff.md:15` (and its mirror).**
  - It says "Never backtick a bare directory path … `docs-refs-check` … aborts … with 'missing file' when it is a directory." That is no longer true for existing directories.
  - The file is not in Affected Files or Docs Impact. Retire or reword it in a follow-up, or through an Affected Files amendment, and keep the deleted-path guidance at line 13. Source: anchored.
- **F4. Human Test Plan step 5 cannot tell pre-fix from post-fix.**
  - `isNoisySourceFile` (`scripts/docs-refs-check.mjs:512`) exempts task `notes.md`, so the step passes on the old code too.
  - For the human test, put the folder ref in the handoff, the review, or a project doc instead. Source: anchored.
- **F5. Note for QA on Docs Impact.**
  - The deferred `docs/patterns.md` line belongs in the entry the spec names (the `git rm` vs `rm` fixtures / trackedness-classifier pitfall, around `docs/patterns.md:230`), not the `--name-status` entry that plan Step 9 points at.
  - The plan header also calls it "Step 6". Source: anchored.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "`git rm --cached gen.ts` (not ignored, still on disk) is kept and re-added, undoing the operator's removal." The spec says this is intended. The Problem section says `git rm --cached` "re-adds it. A path still on disk is never a pathspec failure", and AC-6 requires "a `git rm --cached` file still on disk is kept". The behavior is also unchanged from pre-fix: auto-commit stages each handoff path to match its working-tree state.
- Dismissed (cold-Claude): "Abort paths' `git reset HEAD -- …handoffFiles` now undo a pre-staged deletion or rename." The spec covers this in Implementation Notes: the reset "is unchanged. It restores an index entry for a staged-deleted path and is harmless for the others." Working-tree content is preserved. On re-run, the unstaged deletion and the untracked destination are both kept by the filter (AC-4 and AC-6), and `git add -A` restages them, so git re-detects the rename.
- Dismissed (cold-Claude): "A directory ref passes locally when the directory exists only as empty or untracked leftovers, but fails in a fresh CI clone." Decision 3 specifies disk existence: "a target that exists as a file **or** a directory passes". File refs already have the same local-disk semantics (an untracked file also passes locally), so the change adds no new kind of local-vs-CI skew.
- Dismissed (cold-Claude): "The `commitHumanReviewFiles` call site has no end-to-end staged-deletion test." AC-6 accepts this: the three call sites are "verified by review; AC-1 to AC-3 and AC-5 exercise two of them end to end". The foreman confirmed the site routes through the helper at `main.ts:1399`.
- Dismissed (cold-Claude): "No test pins the removed `settledDeletions` case (deletion committed earlier plus another dirty file)." To the filter, a committed deletion and a staged deletion look the same: absent from both the index and the disk. The `staged-dead.ts` unit case covers that rule, and cold-Claude confirmed the scenario works end to end.
- Dismissed (cold-Claude): "Exporting `autoCommitCode` widens the module API." The spec's Implementation Notes allow "export a narrow test seam". Finding 1's new test should go through `checkAndRoute` rather than the seam, since the seam is what hid Finding 1.
- Dismissed (cold-Claude): "Glob metacharacters (`app/[slug]/page.tsx`) glob-expand in the bulk `git add`." That bulk-add behavior predates this diff. Cold-Claude showed that the new filter's literal comparison handles such paths correctly, with the staged deletion committed.
- Cold-Codex: no findings, so nothing to dismiss. Its "consistent with the intended behavior" summary did not cover the evidence gate that runs before auto-commit (Finding 1).

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required this round: Finding 1 (evidence gate counts staged deletions, plus a red-first `checkAndRoute('implement')` real-git test) and Finding 2 (the three helper unit cases). Nits N1 to N4 are optional. Follow-ups F1 to F5 are for the human and QA, not Codex.

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

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Full — base `main` — reason: delicate

This round reviews HEAD a9f0e06. The iteration changed `src/orchestrator/main.ts` (the evidence gate), `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts` and `dist/orchestrator/run-task.js`. That file set matches the handoff's "Iteration 2 — addressing review round 1" Changes table.

Lens inputs this round:
- **Anchored Claude:** Stage 1 pass. Both round-1 findings are fixed, confirmed by red-first and mutation runs. It flagged one new rule violation (N-1).
- **Cold Claude:** returned `changes_requested`, and found N-1 independently.
- **Cold Codex:** "no actionable bugs in the diff."

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the Iteration 2 re-run table has no `Fail` rows, and every check in Validation Required was re-run. The anchored lens re-ran everything in a standalone copy of HEAD:
- lint and type-check exit 0.
- docs-refs-check prints "All refs OK", and sync-templates:check passes.
- `npm test`: 1267 pass, 0 fail, 0 skipped.
- A fresh build matches the committed `dist/` byte for byte.

| AC | Status | Notes |
|---|---|---|
| AC-1: staged deletion only | Met | The direct test is at `tests/run-task-safety.test.ts:1372`. The new routed test at `:1386` drives `checkAndRoute('implement')` with `worktree: false` and implement `done`, so it goes through the evidence gate (`main.ts:3198`) before `autoCommitCode` (`:3311`). Red-first reproduced: with only the gate probe reverted, it fails with "none exist on disk or are git-tracked deletions". |
| AC-2: staged deletion + edit | Met (unchanged from round 1) | `:1415`. |
| AC-3: staged rename | Met (unchanged from round 1) | `:1432`. N4 is still open and optional. |
| AC-4: unstaged deletion | Met (unchanged from round 1) | `:1447`. |
| AC-5: QA-end commit | Met (unchanged from round 1) | `:1458`. |
| AC-6: one shared helper | Met | `tests/run-task-validation.test.ts:80` now covers an `rm -rf`'d `unstaged-dir` and `unstaged-dir/` (both kept). `:116` covers index-probe failure. Each of the three round-1 mutations now fails a test. |
| AC-7: early return removed | Met | 0 hits in `src/orchestrator/main.ts` and in both `dist/` bundles. |
| AC-8: directory refs | Met (unchanged from round 1) | `tests/docs-refs-check.test.ts:67`, `:77`, `:86`. |
| AC-9: mirror in sync | Met | `cmp` shows the files are identical, and the sync check passes. |
| AC-10: red/green recorded, nothing skipped | Met | The handoff records the routed test's pre-fix message and exit 2, and the anchored lens reproduced it. No task test was skipped. |
| AC-11: build and suite | Met | Fresh build equals committed `dist/`, and all checks pass. |

### Verifying Round 1 findings

- _correctness bug:_ "The implement evidence gate rejects a handoff whose only change is a staged deletion" → **addressed.**
  - `main.ts:2969` now uses `git diff HEAD --name-only --diff-filter=D`.
  - The routed real-git test at `tests/run-task-safety.test.ts:1386` is red-first and non-worktree.
  - The fake-git change at `:121-124` does not weaken the older argv-matched evidence test at `:7634`.
  - One edge-case regression came in with this probe; see N-1.
- _correctness bug (test integrity):_ "The helper's directory-prefix, trailing-slash and fail-closed branches are untested" → **addressed.** Each mutation now fails a test:
  - dropping the `startsWith(\`${normalized}/\`)` prefix match fails `:80`;
  - dropping the trailing-slash strip fails `:80`;
  - changing the fallback to `return []` fails `:116`.

### New findings (only NEW issues introduced by Iteration 1's changes)

**N-1. [code-bug] The new deletion probe runs with rename detection on, so it misses a deletion that git pairs with an indexed add.** Location: `src/orchestrator/main.ts:2969`. Flagged by 2 lenses (anchored, cold-Claude); reproduced by the foreman.
- **Mechanism:**
  - `git diff` detects renames by default. When a removed path's content matches an added index entry (a staged add, or intent-to-add), git reports an `R` and `--diff-filter=D` filters it out.
  - Foreman repro: `mv old.ts new.ts && git add -N new.ts`. Here `git diff HEAD --name-only --diff-filter=D` prints nothing, while `--no-renames` prints `old.ts`, and so does the old `ls-files --deleted`.
  - So this is a **regression from the pre-fix gate** for that case. A deletion-only handoff for the task wedges at the gate with "none exist on disk or are git-tracked deletions". Example: a non-worktree bundle where this task lists only `old.ts` and a sibling task stages a similar `new.ts`.
- **Why it blocks:**
  - It breaks the written rule at `docs/patterns.md:121` ("Use `--name-status`, not `--name-only`, when building path sets from `git diff`"), which describes exactly this silent loss of the pre-image path.
  - It sits on the delicate implement gate.
  - It is new code from this iteration, and a one-flag change fixes it.
  - The reach is narrow, but the failure is a hard wedge that needs a human.
  - The foreman owns this one: round 1's suggested fix proposed exactly this command without `--no-renames`.
- **Fix:**
  - Add `--no-renames` to the probe: `splitGit.gitSafeAt(evidenceCwd, 'diff', 'HEAD', '--name-only', '--no-renames', '--diff-filter=D')`.
  - Add a real-git test that fails first. For example, a handoff listing only `old.ts` after `mv old.ts new.ts && git add -N new.ts` (or a staged similar-content add), where `tryEvidenceAdvance`/`checkImplementEvidence` must advance.
  - Recommended in the same edit, but optional because it predates this diff: the sibling `deletedInCommits` probe (`main.ts:2977-2981`, `--name-status base...HEAD` filtered with `startsWith('D')`) misses a committed rename's pre-image for the same reason. `--no-renames` there too keeps the function consistent.

**Optional nits (not blocking):**
- **N-2.** `tests/run-task-validation.test.ts:116` assumes the temp dir is not inside a git work tree and that `GIT_DIR` is unset. If either fails, the test gives a false failure, not a false pass. Passing a nonexistent cwd, or using a repo with a corrupted `.git/index`, makes it independent of the environment. Flagged by 2 lenses.
- **N-3.** `src/orchestrator/git.ts:104-108`: the `lstat` non-absence branch (keep the path on errors such as EACCES) has no test. Changing it to fail open survives the suite. docs/patterns.md §"Write-safety guards must fail closed when the underlying probe errors" asks for a probe-failure test. Source: anchored.
- **N-4.** The evidence gate's unstaged-`rm` case is covered only by the argv-matched fake git (`tests/run-task-safety.test.ts:121-124`). A real-git unstaged `rm` case next to N-1's test would pin it. Source: anchored.
- **N-5.** The fake-git `ls-files --deleted` branch (`tests/run-task-safety.test.ts:117-120`) is now dead code, since no `src/` caller uses it. Flagged by 2 lenses.
- **N-6.** `main.ts:2969`: without `-z`, `--name-only` C-quotes non-ASCII paths (`"caf\303\251.ts"`), so they never match the handoff path. The old probe had the same limitation, but the line was rewritten anyway. Flagged by 2 lenses.
- Round-1 nits N1 to N4 are still open and optional.

**Follow-ups (for the human and QA, not Codex):**
- F1 to F5 from round 1 still stand. Cold-Claude re-flagged F1 (gitignored paths on disk reach `git add`) and F2 (`commitTaskArtifactsToBase`, `src/orchestrator/git.ts:119,130`), and the anchored lens re-verified F3 (`.canon/templates/handoff.md:15`).
- **F6 (new, low confidence).** Cold-Claude flagged a possible silent drop of stage paths, in the path of the spec's "Excluding too much" risk.
  - **Scenario:** on Linux (no normalization-insensitive filesystem), an Affected Files prefix spelled in NFC while the index and disk hold NFD bytes. Both `ls-files` and `lstat` miss it, so `filterStageablePaths` drops it at human-review. Before this change, `git add` died loudly.
  - **Consequence:** if other paths stage, the commit goes ahead without those files.
  - Rare, and not reproduced on macOS. It is worth checking when the F1/F2 issue is filed.

### Dismissed Cold Findings (Round 2)

- Dismissed (cold-Claude): "On an unborn HEAD, `git diff HEAD` fails and the gate reads 'no deletions'." This cannot happen for canon tasks: implement always runs on a task branch cut from a base with commits. It also fails safe, because the gate refuses rather than advancing.
- Dismissed (cold-Claude): "The fake git has no `ls-files -z` branch, so fake-git tests go through the helper's keep-everything fallback." The helper's behavior is pinned by the real-git tests (`tests/run-task-validation.test.ts:80`, `:116`, and the real-git auto-commit and QA-end tests). For fake-git tests, keep-everything is the pre-fix staging behavior, so they still test what they tested before.
- Dismissed (cold-Claude): "Coverage gaps: no human-review staged-deletion test, no rename or intent-to-add evidence test, no `autoCommitCode` fallback test."
  - The human-review site is covered by review under AC-6, as in round 1.
  - The rename and intent-to-add evidence case is folded into N-1's required test.
  - The fallback is unit-tested at `:116`.
- Dismissed (cold-Claude): "Directory refs pass locally but fail on a fresh clone." Same ruling as round 1: Decision 3 specifies disk existence, and file refs already have the same local-disk semantics.
- Dismissed (cold-Claude): "`` `docs/..` `` or `` `docs/../../x` `` now pass when they resolve to a directory outside the tree, and missing directories still say 'missing file'."
  - `resolveRepoRelative` never had a containment check. An out-of-tree *file* ref that exists already passed before this diff, so the change adds no new class of bug, and such refs are contrived.
  - AC-8 mandates the `missing file` reason for a missing directory.
- Dismissed (cold-Claude): "`git rm --cached` is re-tracked by `git add -A`." Same ruling as round 1: the spec Problem section and AC-6 require the kept case.
- Dismissed (cold-Claude): "Abort-path `git reset HEAD` undoes staged `git rm`/`git mv`." Same ruling as round 1: the spec's Implementation Notes cover it, and a re-run restages it from the working tree.
- Kept, not dismissed: cold-Claude's `maxBuffer`/ENOBUFS point (round-1 nit N1 to N4 list, `git.ts:88`), F1, F2, N-1, N-2 and N-6.
- Cold-Codex: no findings, so nothing to dismiss. Its "consistent with the changed behavior" summary did not cover the rename-detection gap in the new probe (N-1).

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Required: N-1 (`--no-renames` on the new deletion probe, plus a red-first real-git test for a deletion that rename detection would pair). Everything else this round is optional or a follow-up.

## Round 3 — verifying iteration 2's response to round 2

**Scope:** Full — base `main` — reason: delicate

This round reviews HEAD 404cbb3. The iteration changed `src/orchestrator/main.ts` (adds `--no-renames` to the deletion probe), `tests/run-task-safety.test.ts` and `dist/orchestrator/run-task.js`, which exactly matches the handoff's "Iteration 3 — addressing review round 2" Changes table.

Lens inputs:
- **Anchored Claude:** Stage 1 pass and N-1 verified. It returned `changes_requested` only because of the pre-existing sibling probe, and said that without it the signal would be approve with nits.
- **Cold Claude:** returned `changes_requested`, on edge cases adjudicated below.
- **Cold Codex:** no findings.

Round 3 discipline applies: only correctness bugs and spec gaps drive the verdict.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the Iteration 3 re-run table has no `Fail` rows and covers every check in Validation Required. The anchored lens re-ran everything in a scratch clone of 404cbb3:
- lint 0, type-check 0, docs-refs-check "All refs OK", sync-templates:check in sync.
- `npm test`: 1268 pass, 0 fail, 0 skipped.
- A fresh build is byte-identical to the committed `dist/` (SHA-256).

| AC | Status | Notes |
|---|---|---|
| AC-1: staged deletion only | Met | `tests/run-task-safety.test.ts:1372` (direct), `:1386` (routed, non-worktree), and the new `:1415` intent-to-add rename case through `tryEvidenceAdvance`. |
| AC-2: staged deletion + edit | Met (unchanged from round 2) | `:1442`. |
| AC-3: staged rename | Met (unchanged from round 2) | `:1459`. |
| AC-4: unstaged deletion | Met (unchanged from round 2) | `:1474`. |
| AC-5: QA-end commit | Met (unchanged from round 2) | `:1485`. |
| AC-6: one shared helper | Met (unchanged from round 2) | `src/orchestrator/git.ts:86`, used at `main.ts:536`, `:936` and `:1399`. Unit tests are at `tests/run-task-validation.test.ts:80` and `:116`. |
| AC-7: early return removed | Met | 0 hits in the source and in both bundles. |
| AC-8: directory refs | Met (unchanged from round 2) | `tests/docs-refs-check.test.ts:67`, `:77`, `:86`. |
| AC-9: mirror in sync | Met | `cmp` shows the files are identical, and the sync check passes. |
| AC-10: red/green recorded, nothing skipped | Met | Iteration 3 records the new test's pre-fix failure (exit 2, missing-evidence note), and the anchored lens reproduced it. 0 skipped. |
| AC-11: build and suite | Met | Fresh build equals committed `dist/`, and all checks pass. |

### Verifying Round 2 findings

- _correctness bug:_ "N-1: the new deletion probe runs with rename detection on" → **addressed** (`src/orchestrator/main.ts:2970`).
  - **Red-first:** with only `--no-renames` removed, the new test at `:1415` fails at the gate (exit 2), and so does the older fake-git evidence test at `:7661`, which now pins the flag.
  - **Real gate:** the test drives the real gate. With `worktree: false` and HEAD equal to base, only the new probe can supply the evidence.
  - **Precondition:** the test's precondition (`git diff HEAD --name-only --diff-filter=D` prints nothing) cannot give a false pass. It fails before the gate runs whenever git does not pair the rename.

### New findings

None drive the verdict. Every item raised this round is either practically unreachable, pre-existing and already routed, or a nit:

- **Sibling committed-range probe misses a committed rename's pre-image.** Location: `main.ts:2976-2984`, `deletedInCommits` using `--name-status base...HEAD` plus `startsWith('D')`. Flagged by 2 lenses (anchored, cold-Claude); reproduced.
  - It is not blocking because this line is byte-identical to `main`, so the task did not regress it, and round 2 ruled it optional. Making it required now would move the goalposts.
  - Reach: a non-worktree, deletion-only handoff whose deletion git pairs with a *committed* similar add.
  - This disagrees with the anchored lens's `changes_requested` signal, which rested only on this item. Routed to **F7**. The fix is `--no-renames` plus a red-first test, and can ride with the F2 issue.
- **Sparse-checkout regression.** Location: `src/orchestrator/git.ts:95-97`. Source: cold-Claude; reproduced.
  - **Scenario:** a handoff path outside the sparse cone (skip-worktree), committed earlier on the branch, absent on disk, and not dirty, while another handoff file is dirty.
  - The old `settledDeletions` skipped it by accident. Now `ls-files` lists the skip-worktree entry, the path is kept, and `git add -A` fails with "outside of your sparse-checkout definition".
  - Canon has no sparse-checkout support anywhere in `src/`, since worktrees are created non-sparse. The trigger also needs the cone to change between rounds. Real, but practically unreachable. Routed to **F8**.
- **NFD/NFC comparison in `filterStageablePaths`** (`git.ts:99`). Source: cold-Claude; reproduced at helper level. This upgrades round 2's F6.
  - The neighboring QA/human-review classifiers NFC-normalize (`main.ts:638-697`, `:772-774`), but the helper compares raw strings.
  - **Scenario:** an Affected Files prefix spelled in NFD (for example pasted from Finder) whose whole directory was `rm -rf`'d during human review.
  - On macOS, git's precompose returns NFC paths, the comparison misses them, and `lstat` gets ENOENT, so the prefix is dropped. Pre-fix, `git add -A` staged the deletions. On Linux, an NFD prefix is dropped even when the directory exists.
  - Very rare. The fix is one line: normalize both sides to NFC. Routed to **F6**.
- **Nits, omitted from the verdict:**
  - The new test's precondition fails falsely under `diff.renames=false` in the developer's git config. This is a false failure, never a false pass, and was flagged by 2 lenses.
  - The test asserts only exit 0. That is sufficient, because the fixture leaves only the new probe as a way to advance.
  - The fake-git matcher depends on argument order.
  - Carry-overs N1–N4 and N-2 to N-6.

### Follow-ups for the human (none for Codex)

F1–F5 from round 1 and F6 still stand. F6 is upgraded above. F1 also covers cold-Claude's note that the `git add` die at `main.ts:537-538` doesn't reset the index, leaving a partial stage (pre-existing). New this round:
- **F7:** add `--no-renames` to `deletedInCommits` (`main.ts:2976-2984`).
- **F8:** make `filterStageablePaths` aware of skip-worktree entries, if canon ever supports sparse checkouts.

A single issue could cover F1, F2 and F6–F8, since they are the stage-path and deletion-probe edge cases left after this task.

### Dismissed Cold Findings (Round 3)

- Dismissed (cold-Claude): "`git rm --cached` is re-added by `git add -A`, and the helper test locks this in." Same ruling as rounds 1 and 2: the spec Problem section ("re-adds it. A path still on disk is never a pathspec failure") and AC-6 ("a `git rm --cached` file still on disk is kept") require it. The untrack-and-ignore variant is F1.
- Dismissed (cold-Claude): "The intent-to-add rename test passes on pre-diff code, because `ls-files --deleted` caught it." It is meant as a guard against the regression the round-2 probe introduced mid-task. It fails at a9f0e06 (reproduced by the anchored lens), which is exactly what N-1 required.
- Dismissed (cold-Claude): "The fake git has no `ls-files -z` branch, so fake-git tests take the helper's keep-everything fallback." Same ruling as round 2: real-git tests pin the filter, and the fallback is the pre-fix staging behavior for fake-git tests.
- Dismissed (cold-Claude): "`commitHumanReviewFiles` has no staged-deletion test." Same ruling as round 1: AC-6 accepts review-only verification for that site.
- Dismissed (cold-Claude): "Directory refs can pass locally but fail on a fresh clone." Same ruling as round 1: Decision 3 specifies disk existence, and file refs already have the same semantics.
- Kept as nits or follow-ups, not dismissed:
  - F1 (gitignored paths on disk), F2 (`commitTaskArtifactsToBase`), F6 (NFD), F7 (committed-range renames) and F8 (sparse).
  - The `-z` quoting (N-6), `maxBuffer` (N2), probe-failure test environment (N-2) and `statSync` twice (N1).
- Cold-Codex: no findings, so nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

Nothing further is required from Codex. The remaining items are follow-ups F1–F8 for the human, plus F5 (placement of the Docs Impact line) for QA.
