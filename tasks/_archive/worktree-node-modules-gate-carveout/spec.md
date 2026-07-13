# Spec: worktree-node-modules-gate-carveout — Exempt canon's verified node_modules worktree symlink from QA-end and human-review dirty gates

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's own worktree setup can hard-stop canon's own QA-end commit gate (adopter report: [GitHub issue #197](https://github.com/tstraub89/canon-ai/issues/197); backlog entry in `docs/BACKLOG.md` §"🐛 Harness Bugs").

**Confirmed mechanism** (source-verified 2026-07-12 on `main`, plus an empirical git-semantics check; not merely plausible):

1. `ensureWorktree()` in `scripts/run-task/worktree.ts` (symlink block at lines 104–130) creates `<worktree>/node_modules` as a symlink to the absolute path `<REPO_ROOT>/node_modules` via `fs.symlinkSync`, guarded only by `fs.existsSync` — there is no verification that a pre-existing entry is canon's own symlink.
2. Whether git reports that symlink depends on the adopter's ignore style. Verified empirically with `git check-ignore`: a directory-only rule (`node_modules/`, trailing slash — a very common style) does **not** match a symlink, so `git status --porcelain=v1 -uall` in the worktree reports `?? node_modules` (exact string, no trailing slash — git lists a symlink as a single untracked entry). A bare `node_modules` rule (canon-ai's own style) matches the symlink, which is why canon's dogfooding never reproduces this.
3. The QA-end commit gate `commitQaArtifacts()` (`scripts/run-task/main.ts:814–885`) classifies the whole-tree porcelain output through `humanReviewAllowedPath()` (`main.ts:701–711`) — a pure string allowlist (tasks/&lt;id&gt;, `PIPELINE_TELEMETRY_FILES`, managed docs). `node_modules` matches nothing, lands in `unexpected`, and the gate aborts: "QA-end commit aborted: working tree has dirty files outside the QA-end allowlist."
4. The human-review commit path `commitHumanReviewFiles()` (`main.ts:1091+`, status read at line 1208, same classifier at line 1253) — reached via `--pr`, `--push`, and full-send — has the identical whole-tree classification and aborts the same way.

Net effect: an otherwise-green full-tier task hard-stops at the QA-end boundary on an artifact canon itself created, at exactly the moment that invites broad force/cleanup workarounds. James hit this live (#197).

A faithful repro is practical in a test fixture (real git repo with a trailing-slash ignore rule + a symlink), so a red-first regression test is required (AC-1) — no environment-bound escape is needed.

## Decision

Add a narrow, verified-symlink carve-out to the QA-end and human-review dirty-tree classification: a porcelain entry whose path is exactly `node_modules` is exempt **iff** a filesystem probe confirms it is a symlink (`lstat`) whose target resolves — with realpath normalization on both sides — to the supervising root checkout's dependency directory (`<REPO_ROOT>/node_modules`). Anything else at that path — a regular file, a real directory, a symlink to any other target, or a probe that errors — still blocks the gate exactly as today (fail closed).

**"Exempt" means treated as absent from the commit-relevant dirty set for *every* dirty-tree decision in both gates — not merely omitted from the "unexpected files" allowlist filter.** This distinction is load-bearing for `commitHumanReviewFiles()` (`main.ts:1091+`), which brackets the allowlist filter (line 1253) with three other decisions that all key off the *raw* `dirtyEntries` count:

- The **clean-tree push/PR retry** branch (`main.ts:1220`, `dirtyEntries.length === 0 && (createPR || cliArgs.push)`) — the idempotent re-attempt for a prior run whose commit+push landed but `gh pr create` failed.
- The **no-dirty-to-commit** `die` (`main.ts:1249`, `dirtyEntries.length === 0`).
- The **no-stage-paths** `die` (`main.ts:1279`, `stagePaths.size === 0` → *"Human review commit aborted: no allowed dirty files found to stage."*).

After QA-end already committed the task artifacts, the tree at `--pr`/`--push` time is frequently dirty **only** because of the `?? node_modules` symlink. With a classification-only exemption (allowlist filter alone), `dirtyEntries.length` is still `1`, so the retry branch is skipped and `buildHumanReviewStagePaths()` yields nothing → the function dies at line 1279. The gate is wedged with a *different* error than today's, and the `--pr`/`--push` retry named in *Problem* still cannot complete. Therefore the exemption must remove verified-symlink entries from the dirty set that drives all three decisions above: a tree dirty only because of the verified symlink must be treated as clean and flow into the normal clean-tree push + PR-create path. (`commitHumanReviewFiles()` is only ever reached with `--push` or `--pr` set — call sites `main.ts:2623/2656/2678` — so `(createPR || cliArgs.push)` at line 1220 is always true when it runs; a symlink-only tree therefore takes the push/PR path, never the line-1249 `die`.)

QA-end (`commitQaArtifacts()`, `main.ts:814-885`) does **not** share this hazard: its `stagePaths.size === 0` case is a graceful `return` (line 838), not a `die`, and QA-end always has task artifacts to stage, so the symlink is never the sole dirty entry there. The classification-only exemption at its `unexpected` filter (line 825) is sufficient for QA-end. The predicate is still applied identically in both gates; only the human-review path additionally needs it upstream of the clean-tree / no-stage decisions.

The exemption is **write-inert**: the gates never remove, recreate, or stage the symlink. Staging stays allowlist-driven (`buildHumanReviewStagePaths()` never emits `node_modules`, and it is fed the exempted set, which cannot change its output since the symlink was never a stage-able path), and the existing pre-add/post-add **staged-set** guards stay untouched — they filter the *staged* names, so the symlink can never slip past them (if it were ever staged, they still fail closed).

Separately, make worktree setup idempotent against pre-existing `node_modules` entries: replace the `fs.existsSync` creation guard in `ensureWorktree()` with an `lstat`-based check so a re-run never throws `EEXIST` and never silently clobbers foreign state (details in AC-7).

The verification predicate is built as a pure, injectable-input classifier (the `*FromData` seam pattern from `docs/patterns.md` §Validation Gate Discipline), with the filesystem probe at the call site, so both gates and worktree setup share one verification and tests can exercise the decision table without a real repo.

## Non-Goals

- **No change to implement-phase whole-tree dirty checks** (`operatorAcceptedImplement()`, `autoCommitCode()`'s empty-handoff and coverage checks). The reported failure and the verified mechanism are at the QA-end/human-review boundaries; the adopter's run passed implement. The shared predicate is shaped for reuse if those boundaries are later shown to trip, but this task does not touch them.
- **No change to `--ship` classification** (`classifyAndPreserveSharedDocDirt()` is pathspec-scoped to shared docs and cannot see `node_modules`).
- **No exemption for the `.env*` symlinks** that `ensureWorktree()` also creates (worktree.ts lines 132–146) — different ignore-rule dynamics, no reported failure.
- **No gitignore-based exemption** (`git check-ignore`): the carve-out is fs-probe based. `check-ignore` exits 128 on symlink-traversal paths (see `docs/patterns.md` §git batch exit-128) and, for the trailing-slash style, would report the symlink as not-ignored anyway.
- **No gate-time removal or recreation of the symlink** — classification-only, per Decision.
- **No Windows junction / `fs.symlinkSync` type-argument fix** (a pre-existing platform fragility in worktree setup, unchanged by this task).

## Acceptance Criteria

- [ ] **AC-1 (red-first regression test)**: A new test in `tests/run-task-safety.test.ts` builds a real-git fixture whose `.gitignore` contains the directory-only rule `node_modules/` (trailing slash), creates a `node_modules` symlink in the checkout pointing at a fixture root-install directory, and drives `commitQaArtifacts()`. On pre-fix code the test fails because the gate aborts with "outside the QA-end allowlist" on `?? node_modules`; on post-fix code the QA-end commit succeeds. Red-first is verified by running the new test against the pre-fix gate code and recording the failure in the handoff.
- [ ] **AC-2 (human-review boundary — symlink-only tree proceeds)**: In `commitHumanReviewFiles()` the verified-symlink exemption is applied to the commit-relevant dirty set **upstream of all three of** the clean-tree push/PR retry decision (`main.ts:1220`), the no-dirty-to-commit `die` (`main.ts:1249`), and the no-stage-paths `die` (`main.ts:1279`) — not only the `unexpected` allowlist filter (`main.ts:1253`). A regression test drives the path via `main()` with `--push` (routing through `main()` is required because `commitHumanReviewFiles()` reads the module-level `cliArgs`, per `docs/patterns.md`) on a real bare-origin fixture (`makeGitFixture`) whose working tree is dirty **only** because of the verified `node_modules` symlink; it asserts the branch is pushed to origin and the function does **not** abort with either "outside the human_review allowlist" or "no allowed dirty files found to stage." On pre-fix code this test fails (the symlink-only tree dies at the no-stage-paths check); on post-fix code it pushes and returns. `--push` (not `--pr`) is used so the assertion needs no `gh` stub. Verify by running the test against pre- and post-fix code and recording the red-first failure in the handoff.
- [ ] **AC-3 (negative cases still block, exact-path only)**: Each of the following at the checkout root still aborts the QA-end gate with the existing allowlist message: (a) a regular file named `node_modules` (trailing-slash-ignore fixture); (b) a real (untracked, un-ignored) directory named `node_modules` containing at least one file — use a fixture without any node_modules ignore rule so the directory is visible to porcelain; (c) a symlink named `node_modules` whose target resolves somewhere other than the expected root install. The exemption matches only the exact top-level porcelain path `node_modules` — no other path is affected by the new predicate. Verify by running the tests.
- [ ] **AC-4 (fail closed on probe error)**: When the filesystem probe underlying the verification errors (e.g. `lstat`/`readlink` throws), the entry is classified as unexpected and the gate aborts — never exempted. A unit test on the pure classifier injects a probe-error input and asserts "block"; verify by running the test.
- [ ] **AC-5 (both ignore styles, no vacuous pass)**: A companion test uses a fixture with the bare `node_modules` (no-slash) rule and asserts that `git status --porcelain=v1 -uall` does **not** list the symlink (so the gate passes without ever consulting the exemption). This guards against the vacuous-test trap in `docs/patterns.md` (porcelain doesn't surface gitignored paths): the AC-1 fixture must write its own trailing-slash `.gitignore` or the regression test never exercises the fix. Verify by running the test.
- [ ] **AC-6 (symlink never staged)**: After a successful QA-end commit with the exempted symlink present (AC-1 fixture), the commit's tree does not contain `node_modules` (verify via `git ls-tree` / `git show --name-only` in the test) and the working tree still shows `?? node_modules` afterward. Additionally, a unit test asserts `buildHumanReviewStagePaths()` never emits `node_modules` even when the porcelain input includes it. Verify by running the tests.
- [ ] **AC-7 (idempotent setup)**: `ensureWorktree()`'s `node_modules` creation guard is `lstat`-based and a re-run never throws `EEXIST`: (a) no entry → symlink created (current behavior); (b) verified canon symlink (target resolves to `<REPO_ROOT>/node_modules`) → no-op; (c) non-symlink entry (real directory or file) → skipped, as today (a real adopter-installed `node_modules` directory is legitimate); (d) a symlink whose target does not resolve to the root install → setup fails with an explicit error naming the path and the found target (fail closed; no silent clobber). Unit tests cover (b), (c), and (d); verify by running them.
- [ ] **AC-8 (pure classifier seam)**: The verification decision logic is a pure function taking injected inputs (porcelain path, lstat kind, resolved target, expected target — exact shape up to the plan) with no filesystem or git access, following the `*FromData` seam pattern; the fs probe lives at the call sites. Unit tests cover the full decision table (verified symlink / file / directory / wrong-target symlink / probe error) without a real repo. Verify by reading the new function signature and running the tests.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Apply the verified-symlink exemption to the commit-relevant dirty set in both commit gates. In `commitQaArtifacts()`: filter porcelain entries through the shared predicate at the `unexpected` allowlist classification (line 825). In `commitHumanReviewFiles()`: filter them out of the dirty set **before** the clean-tree push/PR retry decision (line 1220), the no-dirty-to-commit `die` (line 1249), the `unexpected` allowlist filter (line 1253), and the no-stage-paths `die` (line 1279) — so a symlink-only dirty tree takes the normal clean-tree push/PR path. No change to staging (`buildHumanReviewStagePaths()`) or the pre/post staged-set guards. |
| `scripts/run-task/worktree.ts` | New shared verification helper (pure classifier + fs-probe wrapper) colocated with the symlink creation; replace the `fs.existsSync` setup guard in `ensureWorktree()` with the `lstat`-based idempotent logic of AC-7. |
| `tests/run-task-safety.test.ts` | New tests: AC-1 red-first QA-end regression, AC-2 human-review path, AC-3 negative cases, AC-4 probe-error, AC-5 no-slash companion, AC-6 staged-set assertions, AC-7 setup idempotency, AC-8 classifier decision table. |
| `dist/scripts/run-task.js` | Rebuilt output reflecting the `scripts/run-task/**` source changes above — committed dist must match a fresh build per `docs/architecture.md`. |
| `docs/pipeline-orchestrator.md` | One-sentence heads-up added post-QA describing the exemption's scope in the QA-end/human-review dirty-tree sections. |
| `templates/docs/` | Auto-synced mirror of the `docs/pipeline-orchestrator.md` edit above (`npm run sync-templates`); directory-form entry since this managed-doc mirror isn't itself in `PIPELINE_MANAGED_DOCS`. |

### Interaction Dependencies

- `--pr` / `--push` / full-send flows all route through `commitHumanReviewFiles()`; the exemption changes which dirty-tree branch it takes when the verified symlink is the only dirty entry (clean-tree push/PR path instead of the no-stage `die`), but does not alter its staging set, push command, or PR-creation logic.
- **QA-end vs human-review asymmetry is deliberate**: `commitQaArtifacts()`'s no-stage case is a `return` (line 838) and it always has task artifacts to stage, so it only needs the exemption at the `unexpected` filter; `commitHumanReviewFiles()`'s no-stage case is a `die` (line 1279) and its tree can be symlink-only, so it needs the exemption upstream of the retry/no-dirty/no-stage decisions. An implementer who patches only the shared `unexpected` filter will pass AC-1 and the AC-2 allowlist assertion but leave the AC-2 symlink-only push case wedged.
- Implement-phase gates and `--ship` classification are untouched (see Non-Goals).
- The expected symlink target derives from `REPO_ROOT` (the supervising checkout — deliberately, since that is where the root install lives), while the gates run with `cwd` = the active worktree. This is the correct inversion of the usual "use the active checkout, not REPO_ROOT" worktree pitfall; the plan should note it explicitly so the implementer doesn't "fix" it.

### Data Model Changes

None. No `status.json` schema, template, or artifact-format changes.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [ ] `<E2E>` — not applicable; no end-to-end surface

## Docs Impact

`docs/pipeline-orchestrator.md` may need one sentence where the QA-end/human-review allowlist is described, noting the verified-symlink carve-out. Heads-up only; QA decides. No other protected doc goes stale.

## Known Risks

- **Vacuous tests via gitignore semantics (the trap most likely to slip through)**: canon-ai's own no-slash `node_modules` rule hides the symlink from porcelain, so any fixture inheriting that style passes without exercising the fix. AC-5 exists specifically to pin the two styles apart; reviewers should confirm the AC-1 fixture writes its own trailing-slash `.gitignore`.
- **Human-review partial-fix trap (surfaced in spec_review round 1)**: `commitHumanReviewFiles()` keys three control-flow decisions off the raw `dirtyEntries` count around the allowlist filter (retry at 1220, no-dirty at 1249, no-stage `die` at 1279). Filtering only at the shared `unexpected` allowlist check (line 1253) trades today's "outside the human_review allowlist" abort for a "no allowed dirty files found to stage" abort on a symlink-only tree — the `--pr`/`--push` retry stays wedged. AC-2's symlink-only push assertion is the guard; the exemption must feed the dirty set upstream of all three decisions.
- **Realpath normalization**: the symlink target is stored absolute; comparing it to `<REPO_ROOT>/node_modules` must normalize both sides via `fs.realpathSync` (macOS `/private/tmp` vs `/tmp`, trailing separators) or the exemption silently never matches in temp-dir tests while appearing to work in production — or vice versa.
- **Carve-out breadth**: this is a safety gate at a commit boundary. An exemption keyed on name alone ("any symlink called node_modules") would let arbitrary adopter state slip past the gate. The target-resolution check and the fail-closed probe are load-bearing; AC-3/AC-4 are the guards.
- **Probe fail-open**: per `docs/patterns.md` §"Write-safety guards must fail closed", a probe error treated as "clean" is a bypass, not a safety net. AC-4 pins this with a test where the probe itself throws.
- **Setup-guard behavior change**: switching `fs.existsSync` (follows symlinks) to `lstat` changes behavior for a dangling symlink (previously an `EEXIST` crash on re-setup) — AC-7's enumerated cases keep every legitimate current behavior (real dir, valid symlink) intact while making the crash case deterministic.

## Human Test Plan

1. In a project whose git ignore file lists the dependencies folder in the common trailing-slash style, run a full-tier canon task through QA in the default isolated-workspace mode.
2. Expected: the pipeline commits the QA artifacts and stops at human review normally — no abort complaining about unexpected changed files, even though canon linked the dependencies folder into the task's workspace.
3. From that same stopped-at-human-review state, ask canon to open a draft pull request (the "open a PR" step). At this point the only leftover change in the workspace is canon's own dependency link.
4. Expected: canon pushes the branch and opens the draft PR normally — it does **not** stop and complain that there are no changes it is allowed to commit, and it does not include the dependency link in the PR.
5. Replace canon's dependency link in the task workspace with an ordinary folder or file of the same name, then let the pipeline reach the same commit point.
6. Expected: the pipeline stops and reports the unexpected item instead of committing or opening a PR — anything other than canon's own verified link is still treated as a problem.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier); ACs reference verified symbols
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed, not merely a plausible cause; AC-1 is a red-first regression-test AC
