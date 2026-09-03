# Spec: fix-installed-provenance-version — Installed-package snapshot records canon version, not adopter HEAD

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

In installed-package mode, canon's task provenance stamp records a **false canon identity**: it pairs canon's repo name with a commit SHA that belongs to the *adopter's* product repository.

**Confirmed mechanism (deterministic).** `captureCanonSnapshot` (`scripts/run-task/canon-snapshot.ts:63-81`) has no concept of installed-package mode. It discriminates only by git topology: a superproject working tree ⇒ vendored; otherwise `resolveOrchestratorCommit` treats the checkout as native. When canon runs as an installed npm package, its own code lives outside the adopter's tracked source (under `node_modules`, or in the global prefix), but `REPO_ROOT` resolves — via `git rev-parse --git-common-dir` in `env.ts` — to the **adopter's** repository. With no superproject and no distinguishing signal, the native branch runs: `git rev-parse HEAD` at `REPO_ROOT` returns the adopter's product commit, which is then written as `upstream_commit` (and, absent a superproject, as `orchestrator_commit`) under `upstream_repo: tstraub89/canon-ai`. Canon's own executing identity is captured nowhere.

**How confirmed.** (1) Source reading of the function above — the installed-package path structurally falls through to native. (2) Field evidence in #196: across an adopter's portfolio, all 17 stamped tasks set `upstream_commit == orchestrator_commit`, and all 9 unique recorded SHAs resolve to that adopter's *product* commits, never canon commits. (3) An exact-`2.2.0` reproduction where a task recorded the adopter commit "P0 quick-fixes…" as `upstream_commit` while the install pinned canon at `3687092` — the v2.2.0 release commit. The mechanism is a fixed-input misclassification (same inputs hit the native branch every run), so trace/field evidence plus a red-first regression test is the appropriate evidence class; no timing/environment race is involved.

**Impact.** The stamp exists solely as an audit/provenance trail (`docs/decisions.md` §"Canon provenance stamp"); no production code reads it. So nothing functional breaks — but every installed-package adopter's audit trail claims canon SHAs that are actually product commits, a SHA presented as belonging to `tstraub89/canon-ai` may not exist there, and refreshing task state silently rewrites the purported canon identity whenever adopter HEAD moves. This is a truthfulness defect in a supported (in fact the primary) install mode.

## Decision

Make canon's task stamp identify the executing canon **by version** when canon runs as an installed package, instead of borrowing a foreign commit.

The executing canon's **version is its identity**. For stable installs — the default `canon update` path — the version maps 1:1 to a release tag and therefore to a commit, so the version fully identifies which canon governed the task. Canon's build already carries its version in the shipped artifact, so this is a reliable, all-mode identity with no new build machinery.

### Run modes and what the stamp records

Canon runs in one of three modes; the stamp must identify canon correctly in each:

- **Native** — canon runs from its own source checkout (primary checkout **or a linked worktree**). Canon's commit is that checkout's commit. **Unchanged by this task.**
- **Vendored submodule** — canon is embedded as a submodule of a host repository. Canon's commit is the submodule commit; the orchestrating commit is the host commit. **Unchanged by this task.**
- **Installed package** — canon runs as a published npm artifact (a global CLI or a project dependency), so there is **no recoverable canon commit**. This is the mode this task fixes: record canon's **version** as its identity, record the canon commit as `<unavailable>` (never the adopter's commit), keep canon's repository slug as the upstream repo, and record the driving repository's own commit (the adopter, or its host when the adopter is nested) as the orchestrating commit.

In every mode the stamp additionally records the executing canon's **version** in a new `canon_version` field; native and vendored keep all their existing field values unchanged and simply gain `canon_version`.

Classification must be robust to canon's real-world topologies — in particular, a **linked worktree** must classify as native, and an **installed canon inside an adopter that is itself a submodule** must classify as installed-package, not vendored. The two prior spec_review rounds established both cases; the *mechanism* that distinguishes the modes (and why the obvious shortcuts fail) is an Implementation Note, not part of this contract.

## Non-Goals

- **Baking an exact canon source SHA into `dist`.** Blocked by architecture, not effort: committed `dist/` must byte-match a fresh build (`.github/workflows/ci.yml` runs `npm run build && git diff --exit-code -- dist/`), and a git SHA changes at the moment of commit while the tagged release is a post-build squash-merge — a self-referential SHA can never satisfy that gate. Documented here so version-only is not read as a shortcut.
- **Distinguishing two same-version `--channel main` development builds.** This is the one #196 acceptance test version-only does not meet; it is a canon-developer concern, not an adopter one. The install-time SHA remains recoverable later (adopter manifest pin for local installs, `.canon/provenance.json` for where `canon update` ran) if a real consumer ever needs it.
- **Consuming `.canon/provenance.json` for a canon SHA in the task stamp.** That file is a per-repo, write-time receipt of the last `canon update`; in the default global install one binary serves many repos, so the receipt drifts from the executing binary. It belongs to a future `canon doctor` cross-check, not the task snapshot.
- **The `canon doctor` provenance cross-check** and **the broader multi-field identity redesign** sketched in #196 (`adopter_base_commit`/`subject_commit`/per-mode `source` fields, executable digests). Separate follow-ups.
- **Real-submodule root resolution for vendored mode.** How `env.ts` resolves `REPO_ROOT` for a genuine git submodule (`--git-common-dir` returning the host's `.git/modules/<name>`) — and whether that yields the submodule SHA — is pre-existing behavior this task neither changes nor re-verifies. The existing vendored test's synthetic seam stands; a real-submodule-topology fixture is a separate test-hardening follow-up.
- No change to native or vendored commit values. In particular, **native mode continues to record the supervising checkout's commit** (`captureCanonSnapshot` is always called with `REPO_ROOT`, which `env.ts` anchors to the supervising checkout via `--git-common-dir`). Whether a native run from a linked worktree *should* instead record the worktree's own HEAD is a pre-existing behavior and a **latent follow-up**, explicitly out of scope here — this task only guarantees the worktree run stays classified as native (records a real commit, not `<unavailable>`).

## Acceptance Criteria

Each criterion is an observable property of the recorded stamp for a given run situation. How the tests construct each situation is an Implementation Note.

- [ ] AC-1: When canon runs as an installed package (installed via npm — a global CLI or a project dependency — not from a canon-ai source checkout), the stamp records the canon commit as `<unavailable>` and never records the adopter repository's commit as canon's. Verify with a unit test for the installed-package situation asserting the canon commit is `<unavailable>` and is not the adopter's commit.
- [ ] AC-1b: In that same installed-package situation, the other stamp fields keep their correct meaning — the upstream repo stays canon's slug (including honoring the `CANON_UPSTREAM_REPO` override when set), and the orchestrating commit is the driving repository's own commit — so suppressing the false canon commit cannot collaterally blank or relabel those fields. Verify the test asserts the upstream repo equals canon's slug and the orchestrating commit equals the driving repository's commit.
- [ ] AC-2 (red-first regression): A regression test captures the #196 behavior change for an installed-package run: on the pre-fix behavior the stamp records the adopter's commit as canon's commit (the bug), and on the fixed behavior it records `<unavailable>` for the canon commit plus the canon version. The test must fail on the pre-fix behavior and pass on the fixed behavior. (How to stage the pre-fix vs fixed behavior is an Implementation Note.)
- [ ] AC-3: The stamp records the executing canon's version in a field named exactly `canon_version` — its released version when built, or `dev` when running unversioned. Verify a unit test asserts `canon_version` matches the executing canon's version.
- [ ] AC-4 (native regression guard): When canon runs from its own source checkout (native, primary checkout), the canon commit and the orchestrating commit are both that checkout's commit, unchanged from today, and the stamp additionally records the canon version. Verify the existing native tests still pass and additionally assert the version is recorded.
- [ ] AC-4b (native linked-worktree classification guard): When native canon runs from a linked worktree of its own repository, it is still classified as **native**, never installed-package — so the canon commit is a real commit (**not** `<unavailable>`), exactly the commit native mode records today (the supervising checkout resolved as `REPO_ROOT`), and `canon_version` is recorded. This is a classification guard only; it does **not** change which commit native mode records. Verify with a unit test that supplies a linked-worktree canon source path and asserts the run classifies as native — the canon commit equals what native mode records for that `REPO_ROOT` (not `<unavailable>`) and `canon_version` is populated. Note: the field-level question of whether native-in-worktree *should* record the worktree's own HEAD rather than the supervising checkout's is pre-existing behavior, unchanged here, and called out as a latent follow-up in Non-Goals.
- [ ] AC-5 (vendored regression guard): This task does not change vendored-mode logic. AC-5 guards only that (a) the existing vendored unit test still passes unchanged in its canon-commit/orchestrator-commit assertions, and (b) `canon_version` is now additionally recorded in that test. The existing test uses a synthetic submodule `repoRoot` seam; proving live-submodule root resolution (how `env.ts`'s `--git-common-dir` resolves a real submodule to the submodule SHA) is **pre-existing behavior, out of scope here** — see Non-Goals. Verify the existing vendored test passes with the added `canon_version` assertion.
- [ ] AC-5b (installed-inside-submodule-adopter regression guard): When canon runs as an installed package inside an adopter repository that is itself nested as a submodule of a larger host, it is still classified as installed-package (not vendored): the canon commit is `<unavailable>`, the canon version is recorded, and the orchestrating commit is the host repository's commit — preserved, not blanked, and not the adopter's commit mislabeled as canon's. Verify with a unit test for this situation, using distinct adopter and host commits, asserting the canon commit is `<unavailable>` (neither the adopter nor host commit), the upstream repo is canon's slug, the version is recorded, and the orchestrating commit is the host commit.
- [ ] AC-6 (refresh immutability): When a task's stamp is refreshed in installed-package mode while the adopter's history advances between refreshes, canon's identity — repo slug, `<unavailable>` canon commit, and version — stays unchanged across refreshes, while the orchestrating commit tracks the adopter's current commit. Verify with a unit test that refreshes twice with different adopter commits and asserts the three canon-identity properties are stable while the orchestrating commit follows the adopter.
- [ ] AC-7: The `canon_version` field is part of the recorded stamp shape wherever it appears, including the scaffolded task-status template, and the template mirror stays consistent. Verify the template's `canon` block includes `canon_version` and the template-sync check passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/canon-snapshot.ts` | Add installed-package-mode recognition so an installed canon records `<unavailable>` for the canon commit (never the adopter's) while preserving the driving repository's commit as the orchestrating commit; record the canon version in every mode. Detection mechanism and precedence are in Implementation Notes. |
| `scripts/run-task/types.ts` | Add a required `canon_version: string` field to `CanonStamp`, consistent with the other snake_case stamp fields. |
| `.canon/templates/status.json` | Add the canon version field to the scaffolded `canon` block, alongside the existing runtime-populated fields. Edit the root copy only; the `templates/` mirror auto-syncs via the pre-commit hook. |
| `templates/.canon/templates/status.json` | Auto-synced mirror of `.canon/templates/status.json` (pre-commit hook, not hand-edited); declared for the base-drift gate. |
| `tests/run-task-canon-snapshot.test.ts` | Add tests for the installed-package situations (AC-1/1b, AC-2 red-first, AC-3, AC-5b, AC-6) and the native linked-worktree guard (AC-4b); extend the existing native/vendored tests with version assertions (AC-4, AC-5). |
| `dist/cli/index.js` | Rebuilt bundle — `canon-snapshot.ts` is transitively imported by the `src/cli` entry point (`update.ts` imports `CANON_UPSTREAM_REPO`). Declared for the base-drift gate. |
| `dist/scripts/run-task.js` | Rebuilt bundle — `canon-snapshot.ts` is imported by the run-task entry point. Declared for the base-drift gate. |
| `docs/pipeline-orchestrator.md` | §"Canon Snapshot Stamping": add the installed-package behavior (version-as-identity, canon commit `<unavailable>`, driving repo's commit stays the orchestrating commit) and note the version field. |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror of `docs/pipeline-orchestrator.md` (pre-commit hook, not hand-edited); declared for the base-drift gate. |
| `docs/decisions.md` | §"Canon provenance stamp": note installed-package mode records identity by version; add the SHA-baking and provenance-consume non-goals with their reasons. |

### Interaction Dependencies

- Both `dist` entry points bundle `canon-snapshot.ts`; a `dist/` rebuild rewrites both artifacts. Both are declared above so the `--pr` base-drift gate does not reject an undeclared artifact.
- `status.json` validation (`scripts/run-task/validation.ts`) does not inspect the `CanonStamp` block (its `canon` references are all incidental — `canonicalize*`, `canon task phase`, comments), so adding a stamp field needs no parser or validation change. The block is written wholesale at capture time, so the template placeholder is never read back.

### Data Model Changes

`CanonStamp` gains a required field named exactly **`canon_version: string`** (snake_case, matching the existing `upstream_repo`/`upstream_commit`/`codex_cli`/`claude_code` fields), populated at capture time and scaffolded as an empty placeholder in the task-status template — the same treatment as the existing runtime-populated CLI-version fields. No change to any existing field's type or meaning.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — `canon-snapshot.ts`/`types.ts` feed `dist/`; commit both rebuilt artifacts
- [x] `npm run docs-refs-check` — `docs/pipeline-orchestrator.md` and `docs/decisions.md` change
- [x] `npm run sync-templates:check` — `.canon/templates/status.json` is canon-managed; the `templates/` mirror must stay aligned

## Docs Impact

- `docs/pipeline-orchestrator.md` — the §"Canon Snapshot Stamping" bullets currently describe only native and vendored; they go stale without the installed-package behavior and the version note. Updated by this task.
- `docs/decisions.md` — the §"Canon provenance stamp" rule gains the installed-package identity-by-version note and the documented non-goals. Updated by this task.
- Other protected docs: none.

## Known Risks

- **Mode misclassification (linked worktree).** The highest risk is classifying a run into the wrong mode and either blanking a real canon commit or re-stamping a foreign one. The specific failure the first review round caught: native canon in a linked worktree must not be treated as installed. Guarded by AC-4 (primary checkout) and AC-4b (linked worktree). Canon-ai dogfoods worktrees, so this is live, not hypothetical.
- **Mode misclassification (adopter-as-submodule).** The second review round caught the mirror failure: an installed canon inside an adopter that is itself a submodule must not be treated as vendored, or the adopter's commit gets re-stamped as canon's — the original defect under a different layout. Guarded by AC-5b, which also pins the orchestrating commit to the host so host attribution is not silently dropped while the false canon commit is removed. The classification order that makes both cases correct is an Implementation Note.
- **Install-layout coverage.** Local `node_modules`, pnpm nested/virtual stores, global npm installs, and `npx` caches must all classify as installed; primary and linked-worktree checkouts and genuine vendored submodules must not. Implementation Notes name the concrete discriminator.
- **`dev` version leakage.** If an installed canon somehow runs unversioned, the stamp records the development marker. This is honest (not a false claim) and acceptable; it is not a false SHA.
- **Base-drift gate.** Forgetting to declare or rebuild either `dist` artifact bounces the task at `--pr`. Both are declared and the build check is required.

## Human Test Plan

1. In a project that installed canon as a global CLI from a published release, start a new task and open its task record. Expected: the canon section names the installed canon **version** and does **not** show one of your own project's commit identifiers as canon's.
2. Make a few unrelated commits in that project, then let canon refresh the task. Expected: the canon version recorded for the task does not change as your project's history moves.
3. In a setup where canon's exact build cannot be determined, open a task record. Expected: it shows the canon version and marks the canon commit as unavailable, rather than inventing a commit.
4. In canon's own repository (developing canon on itself), and in a setup where canon is embedded as a sub-component of a larger project, open task records. Expected: those records are unchanged from before this task, aside from now also naming the canon version.

## Implementation Notes (non-binding — owned by plan/implement)

Mechanics below are guidance, not contract; the compiler and tests are the authority. They carry forward the two prior review rounds' findings so the implementer doesn't re-discover them.

- **Detecting installed-package mode.** Classify canon's own executing source directory (`__dirname` in `scripts/run-task/env.ts`, or the equivalent `packageDir` in `src/cli/commands/update.ts`): installed-package ⇔ that path contains a `node_modules` or `_npx` path segment. This covers local installs, pnpm's virtual store, global npm (`<prefix>/lib/node_modules/canon-ai`), and npx caches.
- **Classification order: installed-package → vendored (superproject) → native.** Check the source-path install identity *first*. The superproject probe (`git rev-parse --show-superproject-working-tree`) runs at `REPO_ROOT`, which is the *adopter*, so it reports the adopter's git topology — an adopter that is itself a submodule would otherwise trip the vendored branch and re-stamp the adopter HEAD (AC-5b). A genuinely vendored canon's source lives at a submodule path (e.g. `vendor/canon-ai`), never under `node_modules`/`_npx`, so it doesn't match the installed predicate and correctly falls through to the superproject branch.
- **Why not `__dirname` vs `REPO_ROOT`.** `env.ts` anchors `REPO_ROOT` at the *supervising* checkout via `git rev-parse --git-common-dir`, so native canon in a linked worktree has a source path (under `dev-worktrees/…`) legitimately outside `REPO_ROOT` — a "source ≠ `REPO_ROOT`" test would misclassify it as installed and blank a real canon commit (AC-4b). The `node_modules`/`_npx`-segment identity never references `REPO_ROOT`. A "same enclosing git repo as `REPO_ROOT`?" test is also wrong: a local install lives under the adopter's `node_modules`, whose enclosing repo *is* the adopter.
- **Why not `detectInstallType`'s return value.** `detectInstallType` (`src/cli/commands/update.ts`) shares the segment logic, but its no-match branch defaults to `global`, so native dev would report `global`. Reuse the underlying segment predicate (extract or duplicate the small check); do not treat a `global` result as "installed."
- **Reading the version.** `process.env.CANON_VERSION ?? 'dev'` — the same expression `bakedVersion()` uses (baked in via `tsup` `define`); consider extracting a shared helper rather than duplicating.
- **Test seams.** Add injectable options to `CanonSnapshotOptions` for the install-mode signal (canon source path) and the version, following the existing `runGitAt`/`runCommand` seam, so tests stay hermetic (env-override tests must set values after import — see `docs/patterns.md`).
- **Red-first staging (AC-2).** Add the injectable seam(s) to `CanonSnapshotOptions` as the *first* step — before the installed-package branch — so the AC-2 test compiles against the typed interface and is runtime-red (the pre-branch logic ignores the new option, takes the native path, stamps adopter HEAD). Then add the branch to turn it green. Equivalent alternative: split a pre-existing-seam test that reproduces the adopter-HEAD bug from the new-seam post-fix test. `refreshCanonSnapshotAtPath` (`scripts/run-task/canon-snapshot.ts:94`) delegates to `captureCanonSnapshot(REPO_ROOT, …)` and is the entry point for the AC-6 refresh test.
- **Rebuild both bundles** (`npm run build`) and commit both `dist/` artifacts.
- **Template field** — add the version placeholder to the `canon` block in `.canon/templates/status.json` (root copy only; the pre-commit hook syncs the `templates/` mirror; do not hand-edit the mirror).

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Acceptance Criteria are behavioral contracts (observable stamp properties per run situation); detection mechanism, seams, and fixture construction live in the non-binding Implementation Notes
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug fix) *Problem* states the confirmed mechanism and how it was confirmed with evidence matching the mechanism class (deterministic misclassification: source + field + repro evidence); *Acceptance Criteria* includes a red-first regression-test AC (AC-2)
