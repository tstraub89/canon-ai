# Code Review: shared-tasks-root

> Reviewer: Claude | Spec: `tasks/shared-tasks-root/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude (returned `STAGE_1: fail`), cold-Claude (returned findings), cold-Codex (injected: no actionable regressions). All three returns were valid.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [ ] Red-first evidence recorded for each red-first AC. AC-2 is marked red-first in the spec, but the Red-First Evidence table has rows only for AC-1 and AC-4. There is no AC-2 row and no `[wrong-premise]` Blocker.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Subprocess test from `sub/`; red-first row against `f863241`. |
| AC-2 | Partial | The behavior is met: `tests/project-root.test.ts` asserts the fixture task's spec is created under the temp repo's root tasks dir and that no tasks dir appears under its subdirectory. The red-first evidence row is missing. |
| AC-3 | Pass | Templates are listed before `mkdirSync`; the test asserts the error and that no `tasks/` is created. |
| AC-4 (amended) | Pass | The refusal for `new`, `status`, `set` and `list` covers exit 1, the message and no `./tasks`. The `__dirname` fallback is gone. There is a per-call `chdir` unit test. |
| AC-5 | Partial | `set` is covered from both the worktree and the main checkout, and the gate reads the worktree artifact. But AC-5 also requires `canon task phase` run with cwd = the main checkout to change only the worktree copy, and every `phase` invocation in the new test uses `cwd: worktree` (`tests/task-cli.test.ts`, the `invoke(worktree, ['task','phase',…])` calls). The existing tests are unchanged. |
| AC-6 | Pass | Lists `late-task`; the row phase distinguishes the worktree copy from the main copy. |
| AC-7 | Pass | Created in main `tasks/`; `status` finds it; `base_branch === 'main'`. |
| AC-8 | Pass | `isTaskEntry` is used by all three scanners; the literal grep is clean; there are predicate and completion pin tests. |
| AC-9 | Pass | Override → managed precedence; `reset-code-review` subprocess from a subdirectory; `upgrade.ts` keeps `<cwd>/<override ?? 'tasks'>/_templates`. |
| AC-10 | Pass | Doctor subprocess output from the root and from `sub/` matches, including the templates line and the orchestrator warning. |
| AC-11 | Pass | Root messages unchanged; `../tasks/<id>` from a subdirectory. |
| AC-12 | Pass | `resolveMainCheckoutRoot` removed; the `--git-common-dir` grep hits only `src/lib/project-root.ts`. |
| AC-13 | Pass | Golden diff is empty. Not independently verified here: whether `dist/` matches a fresh build. |
| AC-14 | Pass | `docs/patterns.md` and `docs/codebase-map.md` updated as specified. |
| AC-15 | Pass | Unit tests cover ordinary, separate-git-dir and linked-worktree repos from a subdirectory, plus a `task list` subprocess in the separate-git-dir fixture. |
| AC-16 | Pass | One dispatch-level `isInsideGitRepository()` check; no diff to `state.ts`; non-git fixtures moved into `git init` repos. |
| AC-17 | Pass | No single-field fallback; the fake git answers the combined argv; a failed query takes the non-git path. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

The gaps are narrow: one missing red-first record (AC-2) and one missing AC-5 verification leg. The implementation itself looks correct. All three lenses found no correctness bug in the routing. The anchored lens ran Stage 2 anyway, and the foreman reports its low-severity items below so that the next round can fold them in cheaply.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Stage 2 was formally not run because Stage 1 failed. The implementation is clean. The three override-vs-default sites (`taskDirForCwd`, `taskRootForGate`, `isPipelineOwnedAcceptPath`) use an explicit `tasksDirOverride()` check and keep their old `tasks` anchors (anchored lens, verified). Cold-Codex reported no actionable regressions.

### Findings

#### Correctness Bugs

1. **`code-bug`. AC-2 red-first evidence missing** (anchored lens; `tasks/shared-tasks-root/handoff.md` §Red-First Evidence). Run the AC-2 test (`tests/project-root.test.ts`, "task list and task new from a subdirectory…") against `f863241` and record the pre-fix failure as a row. If it cannot fail pre-fix as written, say so and adjust the test so it does.
2. **`code-bug`. AC-5 `phase` from the main checkout is untested** (anchored lens, verified by the foreman). Add a no-override `canon task phase` invocation with `cwd` = the main checkout in the AC-5 fixture. Assert that only the worktree `status.json` changes and that the main copy is byte-identical.

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

Fix these in the same pass.

3. **Orphaned docblock.** `src/task/index.ts:1263-1274`: the JSDoc of the deleted `resolveMainCheckoutRoot` is stacked under `safeRealpath`'s own docblock and describes a function that no longer exists. Delete it. Flagged by 2 lenses (anchored and cold-Claude).
4. **Duplicated id rule.** `src/task/index.ts:79-87`: `validateTaskId` returns early on `isValidTaskId` and then re-tests its own copy of the regex and the `..` check to pick a message. If `isValidTaskId` is ever tightened without touching this copy, an invalid id falls through every branch and is accepted silently. Make the function throw unconditionally after the early return: keep the specific messages as branches, but end with a generic throw. Flagged by 2 lenses.
5. **Dead fake-git branch.** `tests/run-task-safety.test.ts`: the old single-field `rev-parse --git-common-dir` branch of the fake git is now dead (AC-17). Remove it if nothing else uses it. Anchored lens.
6. **Error prefix.** The new outside-git refusal lacks the `Error:` prefix that sibling `canon task` errors use. Flagged by 2 lenses. Optional, since AC-4 gives the message only as an example.
7. **Unisolated test.** `tests/project-root.test.ts` (~L676): `assert.equal(tasksDir(root), tasks)` runs without clearing `CANON_TASKS_DIR_OVERRIDE`, while the neighbouring test clears it. Isolate it. Cold-Claude.

#### Spec Gaps

(none — the anchored lens's AC-5 "spec gap" is a missing test against explicit AC text, so it is reclassified as a `code-bug` (#2). Its AC-9 `<root>/tasks/_templates` no-override precedence note is not required by the AC text. It is recorded as optional coverage, not a gap.)

### Dismissed Cold Findings

- Dismissed (cold-Claude): `canon upgrade` still uses `process.cwd()`, and its stale-override path reads `CANON_TASKS_DIR_OVERRIDE ?? 'tasks'` raw. This is spec-mandated: the Non-Goals say "Changing where `canon init`, `canon upgrade` and `canon update` read and write. They keep operating on the current directory", and AC-9 pins `<its cwd>/<CANON_TASKS_DIR_OVERRIDE ?? 'tasks'>/_templates` verbatim.
- Dismissed (cold-Claude): a relative `CANON_TASKS_DIR_OVERRIDE` now resolves against `process.cwd()`. The anchored lens also raised this, as low-severity risk. It is spec-mandated: Decision §"Tasks dir" says "`CANON_TASKS_DIR_OVERRIDE` when set, resolved against the current directory if relative". This matches `state.ts`'s `path.join(override, id)` from the process cwd.
- Dismissed (cold-Claude): `REPO_ROOT` is frozen at import while the per-call resolvers can disagree after `process.chdir`. This is an accepted Known Risk ("In-process tests and frozen `REPO_ROOT`"). The CLI never calls `chdir`, and the regression ACs deliberately use subprocesses.
- Dismissed (cold-Claude): the non-git fallback changed from the package root to `process.cwd()`. This is spec-mandated (Decision §"Project root": "Outside any git repository it resolves to the current directory, replacing the install-directory fallback"; AC-4). `__dirname` stays exported for `canon-snapshot.ts`.
- Dismissed (cold-Claude): `--path-format=absolute` needs git ≥ 2.31. The anchored lens also raised this. The dependency is not new: `main`'s `resolveMainCheckoutRoot` already ran `rev-parse --path-format=absolute --git-common-dir` (`git show main:src/task/index.ts`, line 1276), and the spec's Implementation Notes prescribe the flag.
- Dismissed (cold-Claude): the outside-git guard also fires when `CANON_TASKS_DIR_OVERRIDE` is set. This is spec-mandated: amended AC-4 and AC-16 say every `canon task` subcommand refuses outside git, in a single dispatch check before any subcommand logic. The product owner decided that non-git use is unsupported.
- Dismissed (cold-Claude): `isTaskEntry` drops symlinked task dirs and invalid-name dirs that used to show as INVALID rows. This is spec-mandated: AC-8 defines a task entry as a directory whose name passes the id rule, and the Known Risks accept that "Invalid-name directories … no longer appear in `task list`". canon never creates a symlinked task dir.
- Dismissed (cold-Claude): re-scaffold and the pristine check read the main checkout's templates from a worktree. The anchored lens also raised this, at low confidence. It is spec-mandated: AC-9 says "Template lookups resolve from the project root", and the project root is the main checkout from a linked worktree.
- Dismissed (cold-Claude): doctor from a worktree reports on the main checkout. This is an accepted Known Risk ("Doctor from a worktree … This is intended").
- Dismissed (cold-Claude): the hand-made `.git` dir before `git init` in a test fixture. It is harmless and redundant, and does not affect what the test proves.
- Dismissed (cold-Claude): no test covers a relative override or `upgrade` from a subdirectory. Both behaviors are spec-mandated (see above), and AC-9's existing `runUpgrade` tests pin the upgrade path.
- Dismissed (cold-Codex): none. Codex reported no findings.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `02e7eb86051ea37692c1328783a31c904db05b1d` — reason: small fix within the files already under review

Lenses: anchored Claude (`STAGE_1: pass`, approve), cold-Claude (delta only, approve), cold-Codex (delta only, no actionable regression). All three returns were valid.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | Subdirectory `task list` subprocess test; red-first row in the baseline Red-First table. |
| AC-2 | Met | New focused subprocess test in `tests/task-cli.test.ts:361-377`. Red-first row added in Iteration 2 against `f863241`. The anchored lens reran it independently against an archive of `f863241` and reproduced the pre-fix failure (`templates directory not found at …/sub/.canon/templates`). |
| AC-3 | Met (unchanged from round 1) | Missing-templates test. |
| AC-4 (amended) | Met | The refusal now carries an `Error:` prefix (`src/task/index.ts:1643`); the test matches on a substring. |
| AC-5 | Met | New leg at `tests/task-cli.test.ts:456-460`: `task phase` with cwd = the main checkout changes only the worktree status, and the main `status.json` stays byte-identical. |
| AC-6 | Met (unchanged from round 1) | Worktree `task list` includes the later-created task. |
| AC-7 | Met (unchanged from round 1) | Worktree `task new` writes to main `tasks/` with `base_branch` = main. |
| AC-8 | Met | `validateTaskId` still delegates to `isValidTaskId` and now ends with an unconditional throw; the literal grep is clean. |
| AC-9 | Met (unchanged from round 1) | `reset-code-review` from a subdirectory; upgrade path pinned. |
| AC-10 | Met (unchanged from round 1) | Doctor subprocess output matches from the root and from a subdirectory. |
| AC-11 | Met (unchanged from round 1) | Relative message paths. |
| AC-12 | Met | Resolver removed, and its orphaned docblock is now gone too. |
| AC-13 | Met | Golden file unchanged. Both dist bundles contain the iteration-2 strings. Not independently verified: a byte-identical rebuild (the handoff records Pass). |
| AC-14 | Met (unchanged from round 1) | Docs unchanged this round. |
| AC-15 | Met (unchanged from round 1) | Separate-git-dir, linked-worktree and ordinary cases. |
| AC-16 | Met | Single dispatch check; no diff to `state.ts`. |
| AC-17 | Met | Dead single-field fake-git branch removed; `run-task-safety` passes. |

The anchored lens reran the four touched test files: 413 pass, 0 fail.

### Verifying Round 1 findings

- _code-bug #1:_ AC-2 red-first evidence missing → addressed (handoff Iteration 2 Red-First row; reproduced by the anchored lens) ✓
- _code-bug #2:_ AC-5 `phase` from the main checkout untested → addressed (`tests/task-cli.test.ts:456-460`) ✓
- _nit #3:_ orphaned docblock → addressed ✓
- _nit #4:_ duplicated id rule → addressed (`src/task/index.ts:87`, unconditional final throw) ✓
- _nit #5:_ dead fake-git branch → addressed ✓
- _nit #6:_ `Error:` prefix → addressed ✓
- _nit #7:_ unisolated env in test → addressed (`tests/project-root.test.ts:106-127`) ✓

### New findings

**docs-refs-check failure (anchored lens; resolved by the foreman).** The handoff recorded `npm run docs-refs-check` as "Fail – unrelated". The cause was a fixture path that the round-1 review wrote inside backticks (review.md, round-1 AC-2 row), which docs-refs-check reads as a repo file reference. That is the foreman's own artifact, not the implementer's scope, and CI runs this check. The foreman reworded that row in this round so it no longer names the path. After the edit, `npm run docs-refs-check` reports `All refs OK`.

Optional cleanup / nit (non-blocking; none are code-bugs):

1. `tests/run-task-signals.test.ts:19-20`: the comment still says `env.ts` uses `git rev-parse --git-common-dir` "see env.ts:12-22". `env.ts` now delegates to the shared resolver, so the comment is stale. Cold-Claude (sibling sweep), verified.
2. `src/orchestrator/cli.ts:255`: `canon run` keeps its own `validateTaskId` with the same rule but not routed through `isValidTaskId`. This is drift risk only: the rule is identical today and the file is outside the task diff. Cold-Claude.
3. `tests/project-root.test.ts:106-127`: the `try`/`finally` body was not re-indented. Flagged by 2 lenses.
4. `tests/task-cli.test.ts:361-377` overlaps `tests/project-root.test.ts:150-165`; both assert the same subdirectory `task new` outcome. Harmless. Anchored lens.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the final throw in `validateTaskId` is unreachable and its message is vague. It is intentional defense-in-depth, requested as round-1 nit #4, and the anchored lens also confirms it is unreachable today. The vaguer message only fires if the rules drift apart.
- Dismissed (cold-Claude): error prefixes are mixed across commands (`canon update: …`). The `Error:` prefix matches the sibling `canon task` errors, which was the point of round-1 nit #6. Other commands' conventions are out of scope.
- Dismissed (cold-Claude): removing the fake-git branch could mask a bare `--git-common-dir` call. The lens's own sweep found no remaining caller, and AC-17 forbids that form in the resolver.
- Dismissed (cold-Claude): the `redfirst` temp-dir prefix is a leftover. It is cosmetic and accurately names the test's purpose.
- Dismissed (cold-Codex): none. Codex reported no findings.

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

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

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
