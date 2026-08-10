# Code Review: worktree-workspace-node-modules-links

> Reviewer: Claude | Spec: `tasks/worktree-workspace-node-modules-links/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Foreman independently re-ran, in the task worktree: `npm run lint` (clean), `npm run type-check` (clean), `npm run sync-templates:check` (in sync), and the full `tests/run-task-safety.test.ts` suite (**165 tests, 165 pass, 0 fail**). Targeted runs of the new coverage pass too (14 workspace-named tests; 20 node_modules/containment tests). All results match the handoff's claims. `dist/scripts/run-task.js` contains the shipped guards; `dist/cli/index.js` is unchanged as declared.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Workspace resolution selects exactly the eligible set | Met | `tests/run-task-safety.test.ts:2250-2305` asserts exact arrays for all nine enumerated pattern cases plus absent-field and invalid-JSON; negation case at `:2307`; the no-`name` manifest (`packages/a` = `{"version":"1.0.0"}`) is in every expected set; structural invariants asserted per case. Nit: `deepEqual` rather than `deepStrictEqual` (F13). |
| AC-2: Source containment enforced in the resolver | Met | `tests:2316-2339` covers lexical `../outside/ext`, realpath escape via `packages/escape`, and an unresolvable dangling candidate (no throw); the behavioral "nothing created under `outside/`" fixture is at `tests:2827-2859`. Nit: the `!== ''` / `!== '.'` invariants are asserted only in the AC-1 loop, not the AC-2 fixtures (F13). |
| AC-3: Destination containment before probe or write | **Partial** | The linker real-git escape fixture (`tests:2735-2758`) is genuinely red-first — without `isContainedIn`, `realpathSync` resolves into `outsideDestination` and `symlinkSync` writes there. The gate direct-predicate test (`tests:2521-2559`) uses `${worktreeDir}-evil`, a real segment-wise pin on the worktree side. **Missing:** the AC's own final bullet ("The same assertion applies to rule 5's `REPO_ROOT` comparison") has no `<repoRoot>` vs `<repoRoot>-evil` resolver fixture; the AC-2 escape fixture uses `<dir>/outside/escape`, which a naive `startsWith` would also reject. Behavior is correct — rule 5 calls the same `isContainedIn` helper that *is* segment-wise unit-tested at `tests:2341-2354` — so this is an evidence gap, not a defect. |
| AC-4: Per-workspace linking in `ensureWorktree()` | **Partial** | All five classification variants present and passing (`tests:2760-2787`, wrong-target die naming the path at `:2789-2800`); root pair processed first (`worktree.ts:271-294` precedes `:296`). Evidence gap: the `missing` and `verified-symlink` variants assert identically, so "already-verified symlink → tolerated" is not distinguished from "deleted and recreated" (F7). The `error` arm's policy is challenged by F5. |
| AC-5: Hoisted and absent cases never fatal | Met | `tests:2802-2825` — `source-hoisted`, `workspace-absent` (info-level, asserted on stdout), `destination-dangling`; sibling `packages/b` still linked in all three. |
| AC-6: Probe generalization without behavior drift | Met | `probeNodeModulesEntry(candidate, expectedTargetPath)` at `worktree.ts:224-233`; `classifyNodeModulesLinkFromData` remains pure (`worktree.ts:100-104`); no assertion changes to pre-existing root-only tests and the full suite is green. |
| AC-7: Gate exemption widened — worktree-active runs only | Met | The exemption is applied at `main.ts:1254-1255`, where `dirtyEntries` is *constructed* — upstream of the clean-tree push/PR-retry branch (`:1262`), the empty-dirty `die` (`:1291`), the `unexpected` filter (`:1295`) and `buildHumanReviewStagePaths` (`:1310`). The N-symlink clean-tree fixture (`tests:2607-2650`) asserts exit 0, no allowlist/no-stage abort, and `git ls-remote` showing the branch on origin. Predicate matches its literal contract; robustness gaps in two real layouts are F3 and F4. |
| AC-8: Gate still fails closed | **Partial** | The predicate correctly returns non-exempt for the staged, real-directory, wrong-target, ineligible (`packages/notapkg/nested/node_modules`) and no-worktree cases, and the no-worktree tautology guard is genuinely red-first (without it, `probe(cwd/x, REPO_ROOT/x)` compares a path with itself and returns `verified-symlink`). **But the AC's end-to-end claim — "remains non-exempt *and aborts as today*" — fails** when a directory-form `Affected Files` entry covers the workspace (F1): non-exempt, then waved through by `affectedPrefixes` and staged. Separate evidence gap on the "real directory" case (F7). |
| AC-9: Non-vacuous porcelain fixtures | Met | Anchored `^\?\? …$` visibility companions in the QA-exempt (`:2510-2513`), N-link human-review (`:2624-2625`) and both no-worktree fixtures (`:2775`, `:2797`); bare-rule companion at `:2827-2838`. Nit: the negative-variant guard uses a loose `/node_modules/` regex (F7). |
| AC-10: No-workspaces repos unchanged | Met | No assertion changes to existing root-only tests; `resolveWorkspaceDirs` returns `[]` with no `workspaces` field, so the linker loop no-ops. Cost caveat: the gate now does filesystem work per untracked entry even in no-workspaces repos (F2). |
| AC-11: Teardown safety pinned | Met | `tests:2861-2890` tears down a worktree holding the root plus two workspace links and asserts all three source installs and markers survive. |
| AC-12: Docs updated | Met | Root doc and `templates/` mirror updated identically; `npm run sync-templates:check` re-run by the foreman and clean. Wording and coverage nits at F10. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

No AC was silently dropped, and the deviation Codex documented (exporting `isExemptNodeModulesEntry` to satisfy AC-3's mandated direct-predicate call) is correct — AC-3 is binding and the plan's indirect suggestion conflicted with it.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 passes: no AC is Not Met, and the three `Partial` marks are evidence-level (AC-3, AC-4) or are consequences of Stage 2 correctness findings (AC-8). The blocking work is in Stage 2.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The core of this change is well built. The three shared primitives (`resolveWorkspaceDirs`, `isContainedIn`, the generalized `probeNodeModulesEntry`) are the right decomposition, source containment genuinely lives inside the resolver so no consumer can bypass it, the destination-containment guard is real and red-first, and the exemption is correctly applied where `dirtyEntries` is *constructed* rather than at any single downstream decision — which is exactly the pitfall `docs/patterns.md` warns about and the trap the predecessor task fell into. Test coverage is broad and mostly non-vacuous.

The blocking problems are all at the seams rather than in the core. One is a fail-open hole where a pre-existing allowlist swallows the new entry shape (F1, flagged independently by two lenses). Two are cases where the linker and the gate compute the *same* path differently, so canon creates a symlink it can then never exempt — deadlocking its own pipeline (F3, F4); the spec's own Known Risks names "Divergence between the two consumers" as the failure mode to prevent, and these are two concrete instances of it. One is a new `die` that aborts worktree creation where canon previously succeeded (F5), and one is a partial-write-then-unrecoverable-state path (F6).

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

**F1 — `code-bug` — A directory-form `Affected Files` entry lets a workspace `node_modules` symlink be staged and committed at `human_review`.**
Source lenses: **cold-Codex (P2) + anchored** (2 lenses, independent).
`scripts/run-task/main.ts:706-716` (`humanReviewAllowedPath`), `:1295`, `:1310`, `:1343`.

`isExemptNodeModulesEntry()` correctly returns non-exempt, but that only removes the entry from `dirtyEntries` at `:1255` — it does not protect the allowlist or the staging path. `humanReviewAllowedPath()` accepts `packages/a/node_modules` through `[...affectedPrefixes].some(prefix => filePath.startsWith(prefix))` for a declared prefix `packages/`, and `buildHumanReviewStagePaths()` (`:778-782`) adds the prefix as soon as *any* dirty path falls under it. `git add -A -- packages/` then stages the symlink, and both downstream guards (`stagedBeforeUnexpected` at `:1333`, `stagedUnexpected` at `:1357`) accept it via the same prefix.

Two failure scenarios, both on the exact adopter profile in *Problem* (workspaces monorepo, trailing-slash `node_modules/` ignore style):
1. **Fail-open on a bad link.** A wrong-target or containment-failing `packages/a/node_modules` is classified non-exempt, then passes the allowlist by prefix and is committed instead of aborting. This is the case AC-8 says must "abort as today".
2. **Committing canon's own link.** Even a correctly verified symlink is staged when some other dirty file under `packages/` puts the prefix into `stagePaths` — pushing a machine-local absolute symlink (`/Users/<me>/repo/packages/a/node_modules`) into the PR.

The anchored lens confirmed the git half empirically: with `.gitignore` = `node_modules/`, `git add -A -- packages/` stages `packages/a/node_modules` as mode `120000`. Before this task the only such entry was top-level `node_modules`, which no realistic directory prefix covers — so this is new exposure, not inherited. Note the doc sentence this task edited still asserts "The exemption is classification-only — it never causes `node_modules` to be staged", which F1 falsifies.

*Fix direction:* exclude `node_modules`-tail paths from the `affectedPrefixes` match (or from stage-path expansion) unless they are exempt entries — the prefix allowlist must not swallow node_modules entries.

**F2 — `code-bug` — `resolveWorkspaceDirs()` runs once per porcelain entry: no cheap pre-filter, no memoization.**
Source lenses: **anchored + cold-Claude** (2 lenses).
`scripts/run-task/main.ts:718-750`, `scripts/run-task/worktree.ts:163-222`.

`isExemptNodeModulesEntry()` falls into the workspace branch for *every* untracked single-path entry whose path isn't exactly `node_modules` — `stray.txt`, `tasks/<id>/handoff.md`, everything. Each such entry pays a full `package.json` read + parse, an `fs.globSync` walk per pattern, and two `statSync` per match. It is called per entry at both `main.ts:866` (`commitQaArtifacts`) and `main.ts:1255` (`commitHumanReviewFiles`).

Scenario: worktree has an untracked `coverage/` or `.next/` tree that `-uall` expands into thousands of `??` entries, with root `workspaces: ["packages/**"]` — the gate performs thousands of full recursive walks before deciding anything. Second consequence: the resolver's `warn()` calls (`worktree.ts:155`, `:200`, `:216`) fire once per entry, so a repo with a negated pattern emits one identical warning line per porcelain entry. The anchored lens reproduced this: a 9-entry dirty tree emitted the negation warning 9 times.

The spec's Known Risks accepted glob cost "at every gate evaluation" — per *entry* is a different order of magnitude, and the duplicated operator-facing warning spam was not contemplated at all.

*Fix direction:* `if (!entryPath.endsWith('/node_modules')) return false;` before any filesystem work, and hoist the resolve out of the per-entry filter. The spec's own Known Risks names the resolver as the single memoization point.

**F3 — `code-bug` — Writer and classifier disagree when a workspace directory is itself an in-repo symlink; canon creates a link it can never exempt.**
Source lens: **cold-Claude** (verified by foreman against the code).
`scripts/run-task/worktree.ts:317-328` vs `scripts/run-task/main.ts:742-750`.

The linker writes at `path.join(fs.realpathSync(<wt>/<ws>), 'node_modules')` (`worktree.ts:319`, `:324`), but the gate matches the **lexical** `<ws>/node_modules` (`main.ts:743`).

Scenario: `workspaces: ["packages/*"]` with `packages/a -> ../modules/a`, both inside the repo, so both containment checks pass and `packages/a` is eligible. `ensureWorktree()` writes `<wt>/modules/a/node_modules`. Git reports `?? modules/a/node_modules`. `resolveWorkspaceDirs()` returns `packages/a`, which never equals `modules/a` → not exempt → the QA-end and `human_review` gates die on a symlink canon itself created, with no operator escape.

This is precisely the spec's own Known Risk: "Divergence between the two consumers. If `ensureWorktree()` and the gate predicate resolve workspaces or evaluate containment with different logic, an entry could be linked but not exempt." Sharing the resolver was not sufficient because only one side resolves symlinks.

**F4 — `code-bug` — Non-ASCII workspace directory names defeat the exemption; canon deadlocks on its own symlink.**
Source lens: **cold-Claude** (reproduced independently by the foreman).
`scripts/run-task/main.ts:743` vs `scripts/run-task/git.ts:376-378`.

The workspace lookup compares `entryPath` — a git-porcelain path, C-quoted with octal escapes for non-ASCII — against `${candidate}/node_modules`, a real UTF-8 name from `globSync`. `stripPorcelainQuotes()` strips only the surrounding quotes; it does not decode the escapes.

Foreman reproduction (default `core.quotepath`):

```
$ git status --porcelain=v1 -uall
A  "packages/caf\303\251/node_modules"
```

`stripPorcelainQuotes` yields `packages/caf\303\251/node_modules`, which never equals `packages/café/node_modules`. Scenario: a monorepo with any non-ASCII (or `"` / `\`) workspace directory name → `ensureWorktree()` creates canon's symlink there (the linker uses real filesystem paths, so it is unaffected) → every subsequent QA-end run dies with "dirty files outside the QA-end allowlist" naming canon's own symlink, permanently. It fails closed, but into a deadlock canon created. The pre-change code was immune because the only compared path was the ASCII literal `node_modules`.

**F5 — `code-bug` — A workspace path that is a regular file in the worktree aborts worktree creation.**
Source lens: **anchored** (empirically reproduced by that lens; verified by the foreman against the code).
`scripts/run-task/worktree.ts:300-345`.

For a branch where `packages/a` is a plain file: `lstatSync(worktreeWorkspace)` succeeds, `isContainedIn` passes (a file inside the worktree *is* contained), `realpathSync` succeeds, then `lstatSync('<file>/node_modules')` throws `ENOTDIR` → `probeNodeModulesLstatKind` maps any non-`ENOENT` error to `'error'` (`worktree.ts:111`) → `die` at `:344`. Observed: `Worktree setup aborted: could not inspect …/packages/a/node_modules (lstat failed).`, with `packages/b` never linked. Pre-task canon created that worktree fine.

AC-4's "uninspectable entry → die" licenses this literally, but it is the wrong policy here: the spec's destination-side stance everywhere else is *skip with a warning naming the workspace* ("keeps a hostile or merely unusual branch layout from halting an otherwise healthy run"), Non-Goals says no new die-precondition for workspaces, and AC-5 skips the structurally identical "workspace not usable in the worktree" case. The message also names neither the workspace nor the real cause.

*Fix direction:* treat a non-`ENOENT` lstat failure on `<worktree>/<ws>/node_modules` as skip-with-warning, or pre-check that `resolvedWorkspace` is a directory.

**F6 — `code-bug` — A `die` inside the workspace loop leaves a partially-linked worktree that a re-run can never repair.**
Source lenses: **anchored + cold-Claude** (2 lenses).
`scripts/run-task/worktree.ts:240-243` vs `:296-347`.

By the time the loop runs, `git worktree add` has already created and registered the worktree (`:262` / `:268`) and earlier iterations may already have created links. Scenario: workspaces sort to `[a, b, c]`; `packages/b/node_modules` is a tracked stray symlink; canon links `a`, dies on `b`, never reaches `c`. The operator removes the stray symlink and re-runs → `fs.existsSync(wt)` short-circuits at `:240` → `b` and `c` stay unlinked **permanently**, behind an `info` line that reads like success. npm inside the worktree then materializes real `node_modules` directories the gate refuses to exempt.

The root pair had this early-return shape already, but partial *workspace* linking and silent under-linking of a subset are new — and silently missing dependencies is the exact bug class this task exists to fix.

**F7 — `code-bug` (test integrity) — Two AC clauses are not exercised by the mechanism they name.**
Source lenses: **anchored + cold-Claude** (2 lenses on each half; foreman verified both).

- *AC-8 "real directory" case* — `tests/run-task-safety.test.ts` (negative-variant loop): the `directory` variant passes `gitignoreRule = null`, so with `-uall` git reports `?? packages/a/node_modules/marker.txt`, **not** `?? packages/a/node_modules`. The entry is rejected because its path shape matches no workspace candidate, not because it is a real directory — the exact-path branch is never reached for this case. The anti-vacuity guard `assert.match(porcelain, /node_modules/)` is too loose to catch it. (Spec-gap nuance recorded below: under `-uall` git always expands untracked directories, so AC-8's parenthetical "with a `.gitignore` that lets porcelain see it" may not be satisfiable as written.)
- *AC-4 "tolerated verified symlink"* — in `'ensureWorktree classifies workspace node_modules entries without clobbering them'`, the `missing` and `verified-symlink` variants share byte-identical assertions (`isSymbolicLink()` + realpath equality). Nothing distinguishes "canon left the existing link alone" from "canon deleted and recreated it"; a mutation that unconditionally unlinks-and-relinks passes both. The available discriminator — absence of the `Symlinked node_modules into worktree workspace 'packages/a'.` info line — is not asserted.

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

**F8 — Dead branch and a needless double-realpath TOCTOU window.** `worktree.ts:317-323`. `isContainedIn` at `:312` already calls `realpathOrNull(worktreeWorkspace)` and returns `false` when it throws, so the subsequent `try { fs.realpathSync(...) } catch { warn('is unresolvable in the worktree'); continue; }` is unreachable outside a TOCTOU window — and the second resolution is itself that window: a swap of `<wt>/<ws>` between `:312` and `:319` yields a write under a target the containment verdict never saw. Resolve once and check containment on that single value. Coupled: `'ensureWorktree skips an unresolvable workspace destination and exits successfully'` (`tests:3005`) actually exercises the *containment* warn at `:313`, not the warn its name points at, and duplicates coverage already in `'ensureWorktree skips hoisted, absent, and dangling workspace cases'`. (2 lenses.)

**F9 — `Skipping workspace outside REPO_ROOT` is emitted for paths that are inside `REPO_ROOT`.** `worktree.ts:194-202`. The branch also fires for absolute glob results (`fs.globSync` returns absolute paths for an absolute pattern) and for `normalized === '.'`, which `fs.globSync('**')` genuinely returns — so `workspaces: ["**"]` logs `Skipping workspace outside REPO_ROOT: .`. The skip is defensible; the reason text is wrong. (2 lenses.)

**F10 — Docs understate and partly misstate the new behavior.** `docs/pipeline-orchestrator.md:309` (and its mirror). Three issues: (a) the replacement is a ~95-word sentence with four stacked participial modifiers whose attachment is only recoverable on a second read; (b) the retained trailing claim "The exemption is classification-only — it never causes `node_modules` to be staged" is falsified by F1; (c) the "Worktree Isolation" section (~`:272`) is never updated, so nothing tells an operator that canon now *creates* `<workspace>/node_modules` symlinks, or that a stray tracked symlink at any workspace `node_modules` hard-aborts worktree creation with no `--force` escape. AC-12 only required the carveout wording, so (c) is a scope observation rather than an AC miss. (2 lenses.)

**F11 — Silent skips and one unguarded write.** `worktree.ts:166`, `:328`, `:340-342`. A malformed or unreadable root `package.json` yields `[]` with no warning at all, silently disabling both linking and the exemption — every other failure mode in this file warns or dies. `case 'file'` / `case 'directory'` break with no message, so an operator gets no signal that a workspace was left unlinked and that module resolution inside the worktree differs from `REPO_ROOT`. `fs.symlinkSync` at `:328` is unguarded: `EEXIST` (npm racing setup) or `EACCES` escapes as a raw stack trace rather than the `die()` remediation the surrounding switch uses everywhere else. Each matches the root pair's existing behavior, but N workspaces make them much easier to miss. (cold-Claude.)

**F12 — Two containment claims in the docs are stronger than the code.** `worktree.ts:209-214`, `:298`. `fs.statSync` follows symlinks, so a `package.json` that is itself a symlink satisfies `manifestStat.isFile()` while the doc says "containing a regular `package.json`". And `fs.existsSync(sourceModules)` follows symlinks with no containment check on the source `node_modules` target, so a `REPO_ROOT/packages/a/node_modules` that points to a store outside `REPO_ROOT` is linked and then classified `verified-symlink` — while the doc claims containment "in both `REPO_ROOT` and the active worktree", which holds for the workspace *directory* but not the node_modules *target*. The root pair has the identical property, so this is consistency-with-precedent rather than regression. (cold-Claude.)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **F13 — Test polish.** `deepEqual` → `deepStrictEqual` for AC-1's exact-array assertions (the AC's whole point is exact equality); AC-2's structural invariants are not asserted on the negation fixture and omit `!== ''` / `!== '.'` on the containment fixture; AC-3's "same assertion applies to rule 5's `REPO_ROOT` comparison" has no `<repoRoot>` vs `<repoRoot>-evil` resolver fixture (behavior is correct — the shared helper is unit-tested — only the stated evidence is missing); `makeWorkspaceResolverFixture` returns an `outsideRoot` it never creates and two of three call sites ignore; `'workspace node_modules exemption rejects staged entries before probing'` only exercises the pre-existing `indexStatus !== '?'` guard, so its "before probing" claim is untested; the AC-9 companion in the negative-variant loop uses a loose `/node_modules/` regex instead of a per-variant anchored path. No coverage exists for the workspace `case 'error'` arm, the die-then-rerun path (F6), the symlinked-workspace layout (F3), or the non-ASCII path (F4). (2 lenses on several items.)
- **F14 — Fragile `verified-symlink` fixture.** `tests/run-task-safety.test.ts:801-803`: `fs.symlinkSync(workspaceAModules, workspaceAModules)` creates a genuinely self-referential (ELOOP) symlink that only produces the intended state by fixture ordering — git stores the absolute target string, `checkout main` deletes the loop, and a later line creates a real directory at exactly that path. Both lenses independently confirmed it is **not vacuous today**, but any reordering silently degrades it to the `missing` case. Write it as `fs.symlinkSync(<explicit source path>, workspaceAModules)`. It mirrors a pre-existing root-fixture idiom (`:733`), so fixing both is the tidier change. (2 lenses.)
- **F15 — Exemption is marginally wider than AC-7 describes.** `main.ts:747-750` verifies by realpath equality against `<REPO_ROOT>/<ws>/node_modules`. If that source is itself a symlink to the root install (a plausible hand-rolled hoisting setup), a worktree entry pointing directly at `<REPO_ROOT>/node_modules` also realpath-matches and is exempted even though canon never wrote it. Harmless in practice — both resolve to a tree canon owns. (anchored.)
- **F16 — `exclude` callback fails open on its type check.** `worktree.ts:179`: `typeof entry === 'string' && …` means a future Node passing a non-string would stop pruning `node_modules` from the walk. Correctness is preserved by the mandated `segments.includes('node_modules')` post-filter at `:203`; only walk cost is affected, and F2's fix subsumes the impact. (cold-Claude.)

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong. If a surviving finding's root cause is the spec rather than the code, the final verdict is `spec_gap`.

- **AC-8's "real directory" case may not be constructible as written.** The AC asks for "a real directory (with a `.gitignore` that lets porcelain see it)" producing the entry path `<ws>/node_modules`. Under `-uall` — which both gates use — git always expands an untracked directory into its files, and a trailing-slash `node_modules/` rule hides a real directory entirely. So no `.gitignore` yields a single `?? packages/a/node_modules` entry for a real directory. The implementation's `case 'directory'` → not-exempt arm is therefore unreachable through real porcelain, and the fixture (F7) approximates it. This does not block: the behavior is correct and defense-in-depth, and F7 is fixable at the test level by asserting the actual mechanism. Recording it so the AC's parenthetical is corrected rather than chased.

*(No other finding's root cause is the spec — F1 through F6 are all fixable in code without a spec change, and the spec's Decision, Non-Goals and Known Risks give clear direction for each.)*

### Dismissed Cold Findings

> Cold-lens findings dropped after verification. Use `Dismissed (cold-Claude): <finding> - <reason>` or `Dismissed (cold-Codex): <finding> - <reason>`. Include the reason; verified cold findings are not dismissed merely for being off-AC.

- **Dismissed (cold-Claude): "Negated workspace patterns are dropped rather than subtracted, so eligibility is wider than npm's."** — The behavior is real and correctly described, but it is explicitly spec-intended with a stated bound. Non-Goals: "Negation patterns (`!packages/excluded`) in the `workspaces` array are not honored — they are skipped with a warning, never treated as a positive pattern. (Positive-scope bound: only directories matched by non-negated patterns are ever linked.)" AC-1 pins the exact outcome: `["!packages/a", "packages/*"] → ['packages/a', 'packages/b']` with a warning. Deliberate scope decision, not a defect.
- **Dismissed (cold-Claude): "The root `node_modules` branch lacks the `cwdReal === repoRootReal` guard, so in non-worktree mode any symlink there is classified `verified-symlink`."** — Verified true, and explicitly out of scope. Decision §Gate widening: "The **root** entry's behavior is deliberately unchanged in both modes (its non-worktree tautology is pre-existing, shipped behavior pinned by the existing suite) — this task neither extends nor fixes it." The new test at `tests:2788` asserts that documented status quo rather than endorsing it. Known Risks flags it for a possible separate task.
- **Dismissed (cold-Claude): "`operatorAcceptedImplement()` and `autoCommitCode()`'s empty-handoff branch are not routed through the predicate; the diff multiplies their blast radius from 1 entry to N."** — Explicit Non-Goal naming exactly these surfaces: "The pre-existing non-carveout surfaces named in `worktree-node-modules-gate-carveout`'s Non-Goals stay out of scope (`operatorAcceptedImplement()`, `autoCommitCode()`'s empty-handoff branch, `canon task accept`'s clean-tree check) … widening those gates remains a separate task if dogfood demand appears." Recorded caveat for whoever picks that up: the spec's rationale says these "degrade identically to the root case", which understates the 1→N multiplication cold-Claude correctly identifies. Not a blocker for this task.
- **Dismissed (cold-Claude): "A workspace introduced by the task branch is never linked or exempted."** — Explicit Known Risk: "Worktree-edited `package.json`. A task that *adds* a workspace mid-task won't get a link for it (globs are read from `REPO_ROOT`); that workspace has no install in the supervising checkout anyway, so there is nothing to link. Accepted asymmetry, documented here so review doesn't flag it as a gap."
- **Dismissed (cold-Claude): "Worktrees share `REPO_ROOT`'s mutable installs; `npm install` in a worktree writes through the symlink, and concurrent worktrees share one dependency tree."** — Accurate, but it is the tradeoff the shipped root symlink already makes; Decision states workspace pairs use "the same fail-closed classification the root pair uses today". Design-intended, not a defect this diff introduces.
- **Dismissed (cold-Codex): nothing.** The single injected cold-Codex finding was verified against the code and survives as **F1** — the foreman independently confirmed the mechanism by reading `humanReviewAllowedPath()` (`main.ts:706-716`), `buildHumanReviewStagePaths()` (`:778-782`) and the staging call at `:1343`, and the anchored lens independently reached the same finding. Codex's P2 rank is raised: the same hole also commits canon's *verified* link when the prefix is triggered by an unrelated dirty file, which Codex did not name.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Blocking set for Iteration 2: F1 – F7.** F1 is the highest priority (two independent lenses, fail-open on a safety gate, commits machine-local symlinks into PRs). F3 and F4 are two concrete instances of the spec's own "Divergence between the two consumers" risk and should be fixed together — canon must never create a link its own gate cannot classify. F5 and F6 are worktree-setup regressions. F7 closes the two AC evidence gaps. F8 – F16 are non-blocking; F8 and F10(b) are cheap and sit adjacent to blocking edits, so folding them in is sensible.

One spec touch-up is warranted alongside the code fix: AC-8's "real directory (with a `.gitignore` that lets porcelain see it)" parenthetical, per the Spec Gaps note above.

---

## Round 2 — verifying iteration 2's response to round 1

Synthesized from three lenses: anchored Claude, cold Claude (spec-blind), and the orchestrator's pre-obtained cold-Codex pass. Cold-Codex returned **no findings** this round; both Claude lenses independently reproduced three blocking defects, so the clean Codex result is not corroboration of a clean diff — it is one quiet lens.

### Stage 1 — Acceptance Criteria Re-Check

#### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Foreman independently re-ran in the task worktree: `npm run lint` (clean), `npm run type-check` (clean), `npm run sync-templates:check` (in sync), and the full `tests/run-task-safety.test.ts` suite — **172 tests, 172 pass, 0 fail** (up from 165 in round 1). `dist/scripts/run-task.js` was checked against the round-2 TypeScript by the cold lens and mirrors it faithfully.

#### Acceptance Criteria

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | Exact-array resolver matrices green at `tests:2250-2303`. `deepEqual`-vs-`deepStrictEqual` nit persists. |
| AC-2 | Met | `tests:2305-2329` retains lexical `../outside/ext`, realpath escape, dangling candidate and structural invariants; behavioral "nothing created under `outside/`" fixture intact. |
| AC-3 | **Met** (was Partial) | Round 1's evidence gap is closed: `tests:2311-2316` now uses `${repoRoot}-evil` as the escape target, pinning rule 5's `REPO_ROOT` comparison segment-wise — a `startsWith` implementation admits it. The worktree side stays pinned by `${worktreeDir}-evil` at `tests:2331-2344`. |
| AC-4 | **Met** (was Partial) | `tests:3119-3123` now discriminates `missing` (asserts the `Symlinked node_modules into worktree workspace 'packages/a'` line) from `verified-symlink` (asserts its absence), so "tolerated" is distinguishable from "deleted and recreated". |
| AC-5 | Met | `tests:3202-3222` adds the `destination-file` variant; hoisted / absent / dangling still exit 0 with siblings linked. |
| AC-6 | Met | `probeNodeModulesEntry(candidate, expectedTargetPath)` at `worktree.ts:229`; `classifyNodeModulesLinkFromData` still pure at `worktree.ts:100`. |
| AC-7 | Met | Exemption still applied where `dirtyEntries` is constructed (`main.ts:1310-1312`), upstream of the clean-tree push branch at `:1319`. N-symlink clean-tree fixture green. |
| AC-8 | **Met** (was Partial) | F1's fail-open is closed: `main.ts:715` and `main.ts:831` keep a `node_modules`-segment path out of the directory-prefix allowlist and out of staging, so a non-exempt workspace entry now genuinely aborts (`tests:2761`, plus `tests:2778` asserting `git ls-tree -r HEAD` contains no node_modules). Real-directory arm pinned by the synthesized exact entry at `tests:2949`. |
| AC-9 | Met | Anti-vacuity guards tightened from a loose `/node_modules/` regex to exact anchored per-variant porcelain assertions (`tests:2932-2939`). |
| AC-10 | **Not Met** | See R2-4 and R2-5. Both of AC-10's clauses are violated. (1) *"the existing root-only test suite passes without modification (test edits allowed only for shared fixture helpers, not for assertion changes to root-only expectations)"* — `tests:4965-4970` changed a pre-existing root-only assertion from `assert.match(gitLog, /^add -A -- dist\/$/m)` to `/^add -A -- dist\/cli\/index\.js$/m`, and `tests:1572` gained an inline `fs.mkdirSync(path.join(worktreesRoot, taskId))` inside a specific pre-existing test (not a shared helper). (2) *"With no `workspaces` field, `ensureWorktree()` and both gate call sites behave as before this task"* — they do not: staging shape changed for every directory-form declaration, and worktree **reuse** now runs the root probe, the REPO_ROOT-install precondition and the `.env*` block that previously ran only at creation. |
| AC-11 | Met | Teardown fixture at `tests:3276+` unchanged and green. |
| AC-12 | Met | `docs/pipeline-orchestrator.md:286` + `:323` updated, mirror regenerated, `sync-templates:check` re-run clean. Three prose/behavior mismatches in the *new* paragraph are recorded at R2-10. |

#### Stage 1 Verdict

**Fail — AC-10 is Not Met.**

Per the charter a Stage 1 failure normally suspends Stage 2. I am reporting Stage 2 anyway, deliberately: the AC-10 breach is not independent work that got dropped — it is the *fingerprint* of the two Stage 2 blocking findings (R2-1 and R2-3). The changed assertion at `tests:4965` exists because R2-1 changed staging shape; the added `mkdirSync` at `tests:1572` exists because R2-3 crashes without it. Suppressing Stage 2 here would withhold the exact diagnosis the implementer needs to repair AC-10. Round 3's AC-10 re-check should confirm both pre-existing tests are restored to their original assertions.

### Verifying Round 1 findings

All seven round-1 blocking findings were verified against the working tree at `f3cc2a8`, not against the handoff's claims.

- **F1** *(directory-prefix allowlist/staging swallows workspace node_modules)* → **fixed**. `main.ts:715` gates the `affectedPrefixes` branch on `!hasNodeModulesSegment(filePath)`; `main.ts:828-836` expands prefixes to individual non-`node_modules` paths. Pinned by `tests:2761` and `tests:2778`. **Caveat: the staging half of this fix introduces R2-1.**
- **F2** *(resolver per-entry + duplicate warnings)* → **fixed at the gate**. `main.ts:776` early-returns before any fs work for non-`/node_modules` paths; `main.ts:748-757` pre-scans and resolves at most once per dirty set; both call sites pass it (`:918`, `:1310`). Partial regression of intent elsewhere: `ensureWorktree` now calls `resolveWorkspaceDirs` on every phase transition (R2-6), re-emitting negation warnings each time.
- **F3** *(linker writes canonical, gate matches lexical)* → **fixed**. `main.ts:790-793` derives the canonical repo-relative destination via `resolveContainedPath` and probes the same path `worktree.ts:316,333` writes. Fixture at `tests:2596` (`packages/a -> ../modules/a`) asserts porcelain reports `?? modules/a/node_modules` and the gate exits 0.
- **F4** *(git C-quoted non-ASCII paths)* → **mostly fixed**. `main.ts:722-746` reimplements git's `quote_c_style` for the default `core.quotepath=true`, byte mapping matching git's `cq_lookup` including `0x7f -> \177`. Anti-vacuity assertion present at `tests:2624`. Residual config/normalization gaps at R2-9.
- **F5** *(regular-file workspace path aborts worktree creation)* → **fixed**. `worktree.ts:322-332` stats the resolved destination and skips with `Workspace '<ws>' is not a directory in the worktree`; `destination-file` variant at `tests:819`, assertion at `tests:3221`.
- **F6** *(die mid-loop leaves an unrepairable partial worktree)* → **partially fixed**. The early return is gone (`worktree.ts:256-273`) and rerun genuinely repairs (`tests:3151-3199` asserts a, b, c all linked after the operator clears the stray). But the chosen mechanism — running the entire root + workspace pass on every existing-worktree call — is far broader than F6 required and is the direct cause of R2-3, R2-5 and R2-6.
- **F7** *(test integrity: AC-8 real-directory + AC-4 verified-symlink)* → **fixed**, both halves. Synthesized-entry predicate test at `tests:2949` exercises the exact `?? packages/a/node_modules` shape no git fixture can produce; `tests:2932-2939` assert true per-variant porcelain; `tests:3119-3123` asserts absence of the creation log for `verified-symlink`.
- **F8 / F9 / F10 (non-blocking)** → addressed. Second destination realpath removed (`resolveContainedPath` returns the canonical path); lexical-rejection warning corrected; source sibling-prefix fixture added; docs gained a link-creation/repair paragraph. F13/F14 test nits and F8's coupled duplicate-test note remain open (R2-13).

### Stage 2 — New findings introduced by iteration 2

#### Correctness Bugs

**R2-1 — `code-bug` — Per-path staging feeds raw git-porcelain strings to `git add`, which hard-fails on two ordinary path shapes.**
Source: **anchored + cold-Claude + foreman reproduction** (3 independent confirmations).
`scripts/run-task/main.ts:828-836`, call site `:1399-1404`.

`parsePorcelainEntries` → `stripPorcelainQuotes` (`git.ts:376-378`) strips the surrounding `"` but never decodes the C-escape body. Iteration 2 replaced `stagePaths.add(prefix)` with `stagePaths.add(pathName)`, so those undecoded strings now become `git add -A -- <path>` arguments. Two shapes fail, both reproduced by the foreman in a scratch repo:

```
--- shape 1: non-ASCII filename under a directory-form prefix
$ git status --porcelain=v1 -uall
?? "dist/caf\303\251.js"
$ git add -A -- 'dist/caf\303\251.js'
fatal: pathspec 'dist/caf\303\251.js' did not match any files      # exit 128

--- shape 2: staged rename under a directory-form prefix
$ git status --porcelain=v1 -uall
R  dist/old.js -> dist/new.js
$ git add -A -- dist/old.js
fatal: pathspec 'dist/old.js' did not match any files              # exit 128
```

Both land in `die('Human review commit aborted: failed to stage <path>: ...')` — a hard stop at `human_review` with no `--force` escape and a message that does not hint at the cause. Before iteration 2, `stagePaths` was `['dist/']` and one `git add -A -- dist/` handled every path shape with exit 0. Scope: any task declaring a directory-form Affected Files entry, workspaces or not — hence the AC-10 breach.

The irony worth naming: this same iteration added `gitQuotedPathBody()`/`matchesPorcelainPath()` to handle exactly this escaping problem in the exemption predicate, but did not apply that awareness at the new staging site.

*Fix directions:* keep the prefix form and exclude node_modules by pathspec magic (`git add -A -- dist/ ':(exclude,glob)**/node_modules'`), or drive staging from `git status -z` (NUL-delimited, never quoted) via `--pathspec-from-file=- --pathspec-file-nul`; either way, skip rename pre-images.

**R2-2 — `code-bug` — A stale `git worktree list` registration makes `ensureWorktree` crash with an uncaught `ENOENT`.**
Source: **anchored + cold-Claude** (both reproduced; cold-Claude end-to-end).
`scripts/run-task/worktree.ts:256-273`, with `findExistingWorktreeForBranch` at `:74-88`.

`findExistingWorktreeForBranch` parses `git worktree list --porcelain` and never checks that the path exists — and git keeps listing deleted worktrees as `prunable` until `git worktree prune` runs. Old code returned that path immediately. New code assigns `wt = existingWt` and falls through to `fs.symlinkSync(repoModulesSrc, path.join(wt, 'node_modules'))` with a non-existent parent:

```
ENOENT: no such file or directory, symlink '<repo>/node_modules' -> '<stale-wt>/node_modules'
```

A raw Node stack trace, not a `die()` with remediation. Scenario: an operator `rm -rf`s a task worktree to reclaim space, then reruns `canon run`. That canon has an explicit `tolerateMissingWorktree` recovery path elsewhere (`worktree.ts:58`) confirms this is a known-real state.

*Corroborating evidence this was hit and papered over:* the pre-existing test at `tests:1572` gained `fs.mkdirSync(path.join(worktreesRoot, taskId), { recursive: true })` in this iteration — see R2-4.

*Fix direction:* `if (existingWt && fs.existsSync(existingWt))`, or gate the whole link pass on `fs.existsSync(wt)`.

**R2-3 — `code-bug` — Newly reachable aborts and uncaught throws on worktree *reuse*.**
Source: **anchored + cold-Claude** (2 lenses).
`scripts/run-task/worktree.ts:247-254`, `:284-290`, `:341-347`, `:359-370`.

Removing the early return exposed four previously creation-only code paths to every `ensureBranch` call — i.e. every implement re-entry, so once per code_review iteration and per reroute, not once per task:

- The `REPO_ROOT/node_modules does not exist but package.json does` `die` moved *above* the existing-worktree check. An operator who removes `REPO_ROOT/node_modules` mid-task now gets a hard abort on every re-entry where canon previously reused the worktree untouched.
- The root wrong-target `die` (`:284-290`) now fires repeatedly. A worktree whose `node_modules` was replaced by a symlink elsewhere (pnpm store, `npm install --install-links`, an operator relink) hard-dies on every re-entry with no escape.
- The `.env*` block (`:359-370`) now runs every invocation: `fs.existsSync(dst)` follows symlinks, so a dangling `.env*` symlink yields `false` → `fs.symlinkSync` throws `EEXIST` uncaught; and `fs.statSync(path.join(REPO_ROOT, name))` throws uncaught `ENOENT` on a dangling REPO_ROOT `.env*`.
- Spec AC-4 scopes the workspace classification to *"After worktree creation"*. Extending it to reuse is beyond the AC and beyond what F6 required.

F6 needed *repair of missing links* on rerun. It did not need the abort arms re-armed on every invocation. Separating "create missing links" from "abort on anomalies" would satisfy F6 without any of the above.

**R2-4 — `code-bug` (test integrity) — The `mkdirSync` added to a pre-existing test silently changed which branch it exercises, deleting the only coverage of the path R2-2 breaks.**
Source: **cold-Claude**, corroborated by anchored; foreman verified the diff.
`tests/run-task-safety.test.ts:1572`.

In `'ensureBranch bypasses dirty source guard when worktree branch is already recorded'`, the new `fs.mkdirSync(path.join(worktreesRoot, taskId), { recursive: true })` makes `fs.existsSync(wt)` **true**, so `findExistingWorktreeForBranch` is never reached from `ensureWorktree`. The fixture still sets `FAKE_GIT_WORKTREE_LIST_FILE` and still asserts `assert.match(log, /worktree list --porcelain/)` — now satisfied by an unrelated caller. The test's declared scenario (branch already recorded, worktree discovered via `worktree list`) is consequently **covered by no test at all**, which is precisely the path R2-2 crashes on. Without the mkdir this test would have hit `symlinkSync` on a non-existent parent, so the edit reads as working around the crash rather than testing it.

**R2-5 — `code-bug` — A pre-existing root-only assertion was rewritten to match new behavior.**
Source: **anchored**; foreman verified the diff directly.
`tests/run-task-safety.test.ts:4965-4970`.

```diff
-        // git add -A -- dist/ stages everything dirty under the prefix.
-        assert.match(gitLog, /^add -A -- dist\/$/m);
+        // Directory-form declarations admit matching dirty files, but staging
+        // remains file-specific so excluded node_modules descendants cannot be swept in.
+        assert.match(gitLog, /^add -A -- dist\/cli\/index\.js$/m);
```

This is a no-workspaces test (`commitHumanReviewFiles accepts directory-form Affected Files entries`) whose assertion had to change because R2-1 changed the staging mechanism. AC-10 forbids exactly this. The assertion change is not itself the defect — it is the visible symptom that AC-10's behavioral guarantee was broken; restoring it is only correct once R2-1 is fixed in a way that preserves prefix staging.

#### Risk / Guardrails

**R2-6 — Resolver and warnings now run per phase transition.** `worktree.ts:168-227`, `:300`. `ensureWorktree` calls `resolveWorkspaceDirs(REPO_ROOT)` on every invocation, and `extractWorkspacePatterns` `warn()`s unconditionally per negated pattern — so a monorepo with `"workspaces": ["!packages/legacy", "packages/*"]` prints `Ignoring unsupported negated workspace pattern` on every phase for the task's whole lifetime. F2 fixed the per-entry case in the gate; the linker side reintroduced a milder version of the same shape. (2 lenses.)

**R2-7 — Staging is now one `git add` subprocess per dirty path.** `main.ts:1399-1404`. An adopter whose `dist/` regenerates thousands of files goes from 1 process to N, each rewriting the whole index. Canon-ai's own `dist/` is small, so dogfooding will not surface this. (2 lenses.)

**R2-8 — `hasNodeModulesSegment` is an unconditional removal, not a scoped exemption.** `main.ts:715`. Any path with a `node_modules` segment is now rejected from the directory-prefix allowlist even when an adopter legitimately tracks vendored dependencies under a declared prefix (`dist/lambda/node_modules/...` is a standard serverless bundling pattern). The die message at `main.ts:1354-1364` never mentions `node_modules`, so the cause is undiscoverable. Behavior change for no-workspaces repos. (2 lenses.)

**R2-9 — Two remaining ways the C-quoting round-trip can miss.** `main.ts:722-746`. (a) `gitQuotedPathBody` hard-codes the `core.quotepath=true` rendering; with `core.quotepath=false` **and** a byte git must still escape (`"`, `\`, control char), git emits raw UTF-8 plus selective escapes and neither `matchesPorcelainPath` branch matches. (b) Unicode normalization: git normalizes to NFC when `core.precomposeunicode=true` (the macOS default) while `fs.globSync`/`realpathSync` return the on-disk spelling, so an NFD `café` quotes as `cafe\314\201` against git's `caf\303\251`. Both fail closed — canon's own link becomes non-exempt and the gate deadlocks, which is the exact failure mode F4 existed to close, one config away. The fixture at `tests:2624` creates its directory from an NFC JS string and does not pin `core.quotepath`, so it cannot catch either. (2 lenses; cold-Claude reproduced the normalization mechanism.)

**R2-10 — The new docs paragraph misstates three behaviors.** `docs/pipeline-orchestrator.md:286` and `:311` (both mirrored). (a) *"an existing workspace entry that is not canon's expected symlink aborts setup"* is false — `worktree.ts:349-351` handles `file` and `directory` with a bare `break`, so a real per-workspace `node_modules` directory (the normal state after `npm install` inside the worktree) is silently skipped; only a wrong-target symlink or lstat error aborts. (b) *"Missing or hoisted installs ... are skipped with a warning"* is false — `worktree.ts:302` emits nothing, and `tests:3210-3212` explicitly asserts that silence. (c) `:311` describes the exempt path as `<workspace>/node_modules`, but the implementation exempts `<realpath-relative-destination>/node_modules`; the diff's own test at `tests:2578` proves the divergence (declared `packages/a` symlinked to `../modules/a` → exempted entry is `modules/a/node_modules`). An operator reading the doc cannot predict which path is waved through. (cold-Claude.)

**R2-11 — Residual write/abort blast radius into a foreign worktree.** `worktree.ts:259-262`. When `wt` comes from `findExistingWorktreeForBranch`, it may be any worktree of the repo that is not `REPO_ROOT` — including a developer's hand-made checkout. Canon now writes root, per-workspace and `.env*` symlinks into it and can `die()` on its contents; before this diff it returned that path untouched. Largely defensible (it *is* the task branch's worktree), but it should be gated behind R2-2's existence check and is worth a deliberate decision rather than a side effect. (cold-Claude.)

**R2-12 — Error handling and TOCTOU residue.** `worktree.ts:169-174`, `:213-218`, `:316-337`. Bare `catch { return [] }` / `catch { continue }` swallow EACCES as well as the expected errors, so an unreadable `REPO_ROOT/package.json` silently yields zero workspaces and surfaces much later as unresolvable imports. The realpath→stat→lstat→symlink window remains (narrowed, not closed) and is now entered on every invocation rather than once; two concurrent processes both observing `missing` race, and the loser gets an uncaught `EEXIST`. A `../../../**` workspace pattern still globs the filesystem above the repo before the `..` rejection discards every match. (cold-Claude.)

#### Optional Cleanup / Nit

- **R2-13 — Test nits, several carried over from round 1.** `'workspace node_modules exemption rejects staged entries before probing'` (`tests:2346`) still asserts only the pre-existing `indexStatus !== '?'` guard and passes identically against `main`. `'bare node_modules gitignore rule hides nested workspace symlinks entirely'` (`tests:3027`) exercises no product code — it asserts git's own ignore behavior. The memoization test (`tests:2533`) uses one `*/node_modules` entry, so it distinguishes 1 resolve from 2 but would not catch a regression that re-resolves per workspace entry; two such entries would make it load-bearing. The containment-warning assertion (`tests:2305`) is satisfied by both round 1's and round 2's message text, so it does not pin the clarity change. `'ensureWorktree skips an unresolvable workspace destination'` (`tests:3264`) still duplicates the `destination-dangling` variant. Round-1 F13/F14 leftovers remain: `deepEqual` rather than `deepStrictEqual`; AC-2's containment fixture still omits `!== ''` / `!== '.'`; `makeWorkspaceResolverFixture` still returns an unused `outsideRoot`; the `verified-symlink` fixture (`tests:803`) still relies on the self-referential `symlinkSync(X, X)` that only works by fixture ordering. (2 lenses on several.)
- **R2-14 — Small consistency items.** `worktree.ts:317-319` conflates "resolves outside the worktree" with "is unresolvable" in one message though `resolveContainedPath` knows which. `worktree.ts:156-165` warns loudly on negated patterns but silently drops non-string entries. `worktree.ts:300-356` anomaly handling is uneven (silent / info / warn / die across six sibling cases). `main.ts:789-799` returns on the first workspace whose destination matches, so two workspaces canonicalizing to the same destination resolve arbitrarily by sort order; `continue`-on-mismatch would be more defensible. `main.ts:748-757` returns `[]` for two different meanings ("no candidate entries" and "no workspaces"), and `isExemptNodeModulesEntry`'s `resolvedWorkspaceDirs ?? resolve()` would silently disable the workspace branch for a future caller passing an empty array — correct today only because the pre-scan predicate is byte-identical to the four guards inside the predicate, which nothing pins. `main.ts:712` still admits `tasks/<id>/node_modules` via the task-artifact branch, the one remaining way to falsify the doc's "never causes `node_modules` to be staged". (2 lenses on several.)

#### Spec Gaps

- **AC-8's "real directory" parenthetical is still unconstructible, and round 1's recorded touch-up was not made.** AC-8 asks for "a real directory (with a `.gitignore` that lets porcelain see it)" producing the entry path `<ws>/node_modules`. The tightened fixture at `tests:2932-2934` now *proves* this cannot happen — under `-uall` git always expands an untracked directory, so the real porcelain is `?? packages/a/node_modules/marker.txt`. The implementation is correct and the synthesized-entry test at `tests:2949` is the right evidence. Correct the AC's parenthetical rather than leaving it to be chased again. Non-blocking.

### Dismissed Cold Findings

- **Dismissed (cold-Claude): "The root `node_modules` branch lacks the `cwdReal === repoRootReal` guard, and the new test at `tests:2988` codifies the fail-open."** — Verified true, and explicitly spec-intended. Decision §Gate widening: *"The **root** entry's behavior is deliberately unchanged in both modes (its non-worktree tautology is pre-existing, shipped behavior pinned by the existing suite) — this task neither extends nor fixes it."* The test asserts the documented status quo rather than endorsing it. Known Risks flags it for a possible separate task. Repeated from round 1; the citation is unchanged.
- **Dismissed (cold-Claude): "`resolveWorkspaceDirs` always reads `REPO_ROOT/package.json`, never the worktree's, so a task branch that adds or removes a workspace gets no link and no exemption."** — Explicit Known Risk: *"Worktree-edited `package.json`. A task that adds a workspace mid-task won't get a link for it (globs are read from `REPO_ROOT`); that workspace has no install in the supervising checkout anyway... Accepted asymmetry, documented here so review doesn't flag it as a gap."* The sliver that is *not* covered — the doc says "root `workspaces` patterns" without naming which checkout's root — survives as part of R2-10.
- **Dismissed (cold-Codex): no findings returned this round.** Codex reported the change "covered by passing type checks and tests ... without identified regressions". Recorded, but not treated as corroboration: both Claude lenses independently reproduced R2-1 and R2-2, and the foreman reproduced R2-1's two failure shapes directly. A quiet lens is a quiet lens, not a clean diff.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

**Blocking set for Iteration 3: R2-1 through R2-5.**

The round-1 findings are genuinely fixed — that work stands, and AC-3, AC-4 and AC-8 all moved from `Partial` to `Met`. The problem is that two of the seven fixes were implemented with mechanisms much broader than the finding required, and both leaked new defects into paths that previously worked:

- **F1 → R2-1.** The finding was "a `node_modules` path must not ride a directory prefix into the commit." The fix rewrote the whole staging strategy from one prefix to N raw porcelain paths. Excluding node_modules by pathspec magic, or feeding `git add` from `git status -z`, closes F1 without touching the path shapes git guarantees.
- **F6 → R2-2, R2-3.** The finding was "a rerun must be able to repair links a prior abort left missing." The fix removed the early return outright, re-arming every abort path on every invocation and exposing the unchecked `findExistingWorktreeForBranch` result to a write. Separating "create missing links" from "abort on anomalies" satisfies F6 with none of that.

R2-4 and R2-5 are the two pre-existing tests that were edited to accommodate the above; both must be restored, which will only be possible once R2-1 and R2-2 are fixed properly. R2-6 through R2-12 are non-blocking but R2-10's doc corrections are cheap and sit directly on the text this iteration added.

Round 3 tightens: findings will be limited to correctness bugs and spec gaps.

---

## Round 4 — verifying iteration 4

Three lenses: anchored Claude, cold Claude (spec-blind), cold Codex (injected). All three signalled `changes_requested`. The foreman independently reproduced three of the findings with real git fixtures.

> **Artifact gap on the record.** This file contains no `## Round 3` section — that review was never written (the foreman session was interrupted before its lenses returned), although `status.json` recorded a third `changes_requested`. Iteration 4's handoff notes this honestly and states it addressed the only available round-3 signal: a single cold-Codex P2 about porcelain paths containing a literal ` -> `. That fix is real and verified below. Round 3's Claude lenses never ran, so **the code has effectively had one fewer review pass than the round count suggests** — which is part of why round 4 surfaces this much.

### Stage 1 — Acceptance Criteria Re-Check

#### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Foreman re-ran independently: `npm run lint` clean, `npm run type-check` clean, `npm run sync-templates:check` in sync, `tests/run-task-safety.test.ts` **179/179 pass**. Iteration 4's targeted cases pass (4/4: C-quoted path, rename separator, Unicode normalization, directory-form staging). The cold lens rebuilt `dist/` and confirmed it reproduces the committed bundle byte-for-byte.

#### Acceptance Criteria

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Exact-array resolver matrices green; fixture matches the spec layout including the no-`name` manifest, `packages/file.txt`, `packages/notapkg/nested`, `packages/a/node_modules/dep`. |
| AC-2 | Met | Lexical `../outside/ext`, realpath escape into `${repoRoot}-evil`, dangling candidate, structural invariants; source containment lives in `resolveWorkspaceDirs` so neither consumer can bypass it. |
| AC-3 | Met | Linker escape fixture, unresolvable destination, synthesized-`PorcelainEntry` gate test, segment-wise `wt`/`wt-evil` pin. One shared `resolveContainedPath` serves all three call sites. |
| AC-4 | Met | All five classification variants with the `missing`-vs-`verified-symlink` discriminator; wrong-target die; root pair first. Repair mode not re-arming the die arms is in-contract (AC-4 is scoped "After worktree creation"). |
| AC-5 | Met | `source-hoisted`, `workspace-absent` (info), `destination-dangling`, `destination-file` all exit 0 with siblings linked. |
| AC-6 | Met | Explicit expected-target probe; `classifyNodeModulesLinkFromData` still pure; no assertion changes to pre-existing root-only tests. |
| AC-7 | Met | Exemption applied where `dirtyEntries` is constructed (`main.ts:1370-1371`), upstream of every decision reading the dirty set. N-symlink clean-tree fixture asserts exit 0 + observed push. |
| AC-8 | **Not Met** | The predicate half holds and is well tested (staged / real-directory / wrong-target / ineligible / no-worktree all return non-exempt). The AC's end-to-end half — *"remains non-exempt **and aborts as today**"* — fails on **three independent triggers**, including the path AC-8 names verbatim. See R4-1. Round 2 marked this Partial for one trigger; with three reproduced triggers committing instead of aborting, Partial is no longer a defensible reading. |
| AC-9 | Met | Anchored per-variant porcelain companions and bare-rule anti-vacuity companions present and exact. |
| AC-10 | Met (was Not Met in round 2) | Both round-2 breaches are genuinely repaired in the working tree, verified by the foreman against `git diff`, not the handoff: `assert.match(gitLog, /^add -A -- dist\/$/m)` restored byte-for-byte, and the inserted `fs.mkdirSync(path.join(worktreesRoot, taskId))` is gone so that pre-existing test again exercises the discovery branch. Reuse no longer runs the root probe, the `REPO_ROOT` precondition, or the `.env*` block. |
| AC-11 | Met | Teardown of root + two workspace links; all source installs and markers survive. |
| AC-12 | **Partial** | Mirror is in sync and `sync-templates:check` passes, but two sentences of the prose this task added are falsified by the shipped code. See R4-5. |

#### Stage 1 Verdict

**Fail — AC-8 is Not Met.** Stage 2 is reported rather than suspended, following round 2's precedent: the AC-8 breach *is* the top Stage 2 finding, and the remaining findings sit on the same code that must change. Withholding them would cost another round.

### Verifying Round 3

- **cold-Codex P2, porcelain paths containing ` -> `** → **fixed**. `untrackedPorcelainPath()` (`main.ts:782`) recovers the path from the raw `??` payload before `parsePorcelainEntries`' rename split can corrupt it. Red-first credible; the fail-closed side holds by construction (a real rename has `indexStatus === 'R'`, so the function returns `null` before the `'?? '` branch). Verified passing.

### Stage 2 — Findings

#### Correctness Bugs

**R4-1 — `code-bug` — A non-exempt `node_modules` path still rides a directory-form prefix into a commit. Three triggers.**
Source: **cold-Codex (P1) + anchored + cold-Claude + foreman reproduction** (4 independent confirmations).
`scripts/run-task/main.ts:716-717`, `:793-799`, `:801-820`, `:1470-1476`.

`protectedWorkspaceNodeModules` is built only from the canonical destinations of *currently eligible* workspaces. Anything with a `node_modules` segment that is not in that set falls straight through `isProtectedWorkspaceNodeModulesPath` into the `affectedPrefixes` branch, is allowlisted, and is then staged by `git add -A -- <prefix>` because the `:(exclude,literal)` list does not name it. Three ways to land there:

- **(a) Ineligible path.** `packages/notapkg/nested/node_modules` — a directory that matched a glob but has no `package.json`. Foreman reproduction: with `.gitignore` = `node_modules/` and a wrong-target symlink at that path, `git add -A -- packages/ :(exclude,literal)packages/a/node_modules` stages it. **Spec AC-8 names this exact path** and requires it to abort.
- **(b) Workspace present only on the task branch.** Cold-Claude reproduced end-to-end: `packages/c` added on the branch, symlink at `packages/c/node_modules`, prefix `packages/` — `commitHumanReviewFiles` exits 0 and commits the symlink; `git cat-file -p HEAD:packages/c/node_modules` yields a machine-local absolute path, then pushed to origin. (The spec's Known Risk about worktree-edited `package.json` covers *not linking* such a workspace; it does not sanction *committing* a stray link.)
- **(c) Staged or tracked entry.** `workspaceDirsForNodeModulesEntries()` counts only untracked entries — `untrackedPorcelainPath()` returns `null` for `indexStatus !== '?'`. If the offending entry is the only `node_modules` entry and it is staged, the pre-scan returns `[]`, so the protected set collapses to **∅** and every prefix check is unguarded. Anchored reproduced both a force-staged verified link and a force-staged wrong-target link committing at exit 0. AC-8's *first* named case is the force-staged one.

This is round 1's finding **F1 reopening for the third time**. F1 was fixed by a blanket `node_modules` rejection; round 2's R2-8 objected that the blanket form broke legitimately vendored paths; iteration 3 narrowed it to eligible destinations; the narrowing reopened the hole. *Fix direction that satisfies both AC-8 and R2-8:* protect entries whose **final segment** is exactly `node_modules` — canon's links and stray links only ever take that shape — which still admits vendored *contents* like `dist/lambda/node_modules/lodash/index.js`. And derive the protected set from a predicate over all entries, not from the untracked-only pre-scan; the exemption and the protection need different input sets.

**R4-2 — `code-bug` — The exclusion pathspecs make `git add` fail outright and wedge the task.**
Source: **cold-Claude (reproduced end-to-end) + foreman reproduction**.
`scripts/run-task/main.ts:1471-1479`, with `workspaceNodeModulesPaths` at `:813-818`.

Exclusions are emitted for every eligible workspace regardless of what exists at that path. When an excluded path exists on disk and is gitignored, git treats the exclude pathspec as an explicit mention of an ignored file and errors. Foreman reproduction:

```
$ git add -A -- packages/ ':(exclude,literal)packages/a/node_modules' ':(exclude,literal)packages/b/node_modules'
The following paths are ignored by one of your .gitignore files:
packages/a/node_modules
hint: Use -f if you really want to add them.
EXIT=1
--- index after the failed add ---
packages/a/generated.ts
```

`!addResult.ok` then `die`s with `failed to stage packages/`, naming a path the operator never asked to stage — and git **partially staged before erroring**, so a re-run fails identically. The task is wedged at `human_review`. The triggering state is ordinary: one workspace carrying canon's symlink (which turns the machinery on) plus another workspace with a real `node_modules` directory — exactly what `npm install --workspace=a` inside the worktree produces. Root cause: `workspaceNodeModulesPaths` adds `<dest>/node_modules` unconditionally instead of only when that entry is actually dirty.

**R4-3 — `code-bug` — Gate and staging normalize paths differently, silently dropping a file the gate allowed.**
Source: **cold-Claude (reproduced) + anchored** (2 lenses).
`scripts/run-task/main.ts:716-717` vs `:890-893`.

`humanReviewAllowedPath` matches prefixes through `matchesGitPathPrefix` (C-unquote + NFC); `buildHumanReviewStagePaths` still matches with raw `pathName.startsWith(prefix)` on the undecoded porcelain path. When the **prefix itself** contains bytes git C-quotes, the file is allowed but the prefix is never added to `stagePaths`. Cold-Claude's reproduction: Affected Files entry `café/`, dirty `café/build.js` (porcelain `?? "caf\303\251/build.js"`) — HEAD prints `Committed human_review artifacts…` / `Pushing…`, **exits 0**, and `git ls-tree -r HEAD` does not contain the file; it is still `??` afterwards and never reaches the PR. The same fixture against `main` dies loudly with `dirty files outside the human_review allowlist`. This diff converts a loud, actionable abort into **silent data loss**.

**R4-4 — `code-bug` (test integrity) — The coverage gaps that let R4-1 through R4-3 ship.**
Source: **anchored + cold-Claude** (2 lenses).

- No test combines a directory-form Affected Files entry with either an ineligible `node_modules` path or a staged workspace link. `commitHumanReviewFiles never lets an Affected Files directory prefix allow a node_modules entry` uses only an untracked wrong-target symlink *at an eligible workspace*; `workspace node_modules gate rejects staged, real, wrong-target, and ineligible entries` runs through `commitQaArtifacts`, which is never passed `affectedPrefixes` — so its `ineligible` and `staged` variants structurally cannot exercise the prefix allowlist.
- No test covers a **mixed** worktree (one symlinked workspace + one real gitignored workspace `node_modules`) — precisely the state that hard-fails `git add` in R4-2.
- `directory-form staging handles C-quoted filenames and staged renames` uses a non-ASCII *leaf* under an **ASCII prefix** (`dist/` + `dist/café.js`), which passes under both raw and normalized matching, so it cannot detect R4-3.
- `workspace node_modules exemption rejects staged entries before probing` still asserts nothing its name claims: with `cwd = '/unresolvable-cwd'` the `realpathSync` catch returns `false` regardless of the staged guard. Delete the guard and the test still passes; it also passes unchanged against `main`. Flagged in round 1 (F13), round 2 (R2-13), and still open.

#### Risk / Guardrails

**R4-5 — Two sentences of the new prose are falsified by the shipped code.** `docs/pipeline-orchestrator.md:311` and `:323` (both mirrored). `:311` — "The exemption is classification-only — it never causes canon-managed workspace links to be staged, so an already-staged entry at that path still hits the unrelated staged-files safety check untouched" is falsified by R4-1(c). `:323` — "Canon adds scoped exclusion pathspecs … preventing its own verified links **and non-exempt entries** from riding the prefix into a commit" is falsified by R4-1(a)/(b), and the docs do not mention that the exclusions can make `git add` fail outright (R4-2). Same doc/behavior mismatch class as round 1's F10(b) and round 2's R2-10. Cheap, and sits on the text that must change anyway. (2 lenses.)

### Dismissed Cold Findings

- **Dismissed (cold-Claude): "Negated `!` workspace patterns are dropped rather than applied as exclusions, so canon's eligible set is wider than npm's."** — Verified true and explicitly spec-intended. Non-Goals: *"Negation patterns (`!packages/excluded`) in the `workspaces` array are not honored — they are skipped with a warning, never treated as a positive pattern. (Positive-scope bound: only directories matched by non-negated patterns are ever linked.)"* AC-1 pins the exact outcome. Third round this has been raised; the citation is unchanged.
- **Dismissed (cold-Claude): "The repair pass skips the root `node_modules` block, so a missing root link is never repaired."** — Deliberate and documented at `docs/pipeline-orchestrator.md:286` ("repairs only missing workspace links"), codified by the test `ensureWorktree reuse leaves root links and env files untouched`, and it is the direct fix for round 2's R2-3, which blocked *because* reuse re-armed root aborts. Both lenses noted the `Worktree ready.` line reads as success while a root link is missing — recorded as a message-clarity observation, not a defect.
- **Dismissed (cold-Claude): `normalizeGitPath` divergences from git's `unquote_c_style`** (1–3-digit octal runs vs git's exactly-3, pass-through of malformed escapes, decoding an unquoted path containing a backslash). — Real divergences, but **unreachable**: both lenses independently verified that git C-quotes any path containing `\`, `"`, or a space under both `core.quotepath=true` and `false`, so the undecoded-input case cannot arise from porcelain. The anchored lens audited the octal cap, the named-escape table, the surrogate advance, and the malformed-trailing-`\` path and found no live defect. Recorded so it is not re-chased.
- **Dismissed (cold-Codex): nothing.** The single injected P1 was verified against the code and reproduced by the foreman; it survives as trigger (a) of **R4-1**, and both Claude lenses independently found the same hole plus two further triggers Codex did not name.

*Filtered out under round-4 discipline (nits and wording-only, not driving the verdict): `deepEqual`→`deepStrictEqual`; dead `isNewWorktree &&` guards; the unreachable `untrackedPorcelainPath` fallback; the `isContainedIn` one-line wrapper; missing Windows `type` argument; resolver re-globbing per call; gate-path warning emission; alias-collision first-match `return`; the symlink TOCTOU; pattern validated on `path.normalize` but globbed un-normalized; the `verified-symlink` fixture's self-referential construction.*

#### Spec Gaps

- **AC-8's "real directory" parenthetical is still unconstructible.** Under `-uall` git always expands an untracked directory (re-confirmed this round: `?? packages/a/node_modules/marker.txt`), and a trailing-slash rule hides it entirely — so no `.gitignore` yields a single `?? <ws>/node_modules` entry for a real directory. The implementation is correct and the synthesized-entry test is the right evidence. Recorded in rounds 1 and 2 and still not corrected; it will be chased a fourth time if left. Non-blocking.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

**Blocking set for Iteration 5: R4-1 through R4-4.**

#### Escalation — this is a design signal, not another iteration

The same bug class has now produced blocking findings in **rounds 1, 2, and 4**, always in the same triad — `humanReviewAllowedPath` → `buildHumanReviewStagePaths` → the `git add -A -- <prefix>` call site — and each round's fix created the next round's defect:

| Round | Finding | Fix | What the fix broke |
|---|---|---|---|
| 1 | F1: prefix swallows workspace `node_modules` | blanket `hasNodeModulesSegment` rejection | R2-8: broke legitimately vendored paths |
| 2 | R2-1: per-path staging on raw porcelain strings | one-prefix staging + `:(exclude,literal)` | R4-2: `git add` fails on gitignored exclusions |
| 2 | R2-8: blanket rejection too broad | narrow to eligible destinations | R4-1: three triggers reopen F1 |
| 2 | R2-9: C-quote/NFC comparison | decode + NFC in the allowlist only | R4-3: gate/staging split → silent drop |

Canon's own foreman rule names this pattern: *"A cross-cutting invariant belongs in one shared helper, not patched per call site. The tell: findings come back round after round as the same bug class at a new location. At ≥3 sites, extract the shared helper and route all sites through it."* We are past that threshold. The invariant — *no `node_modules` path is ever staged or committed by the `human_review` gate, and any non-exempt `node_modules` entry aborts* — is currently enforced by patching whichever surface leaked last, across three functions that each normalize and match paths differently.

Two options worth the human's decision before iteration 5:

1. **Single chokepoint.** Compute the final staged path set once, from one canonicalized representation of the dirty entries, and enforce the `node_modules` invariant there — so the allowlist, the stage-path builder, and the `git add` arguments cannot disagree. This is one refactor rather than three more patches.
2. **Split the task.** The linker half (AC-1..AC-6, AC-11) has been stable and correct since round 2 and would ship today. The gate-widening half (AC-7, AC-8, the staging interaction) is where every regression has occurred. Landing them separately would let the working half ship and give the gate work its own spec with the chokepoint designed in.

`status.json` records `iterations: 3`, `changes_requested_total: 3`, `auto_block_count: 1`; this is the fourth `changes_requested`. Counters are left untouched. Round 3's Claude lenses never ran, so some of what surfaced here would likely have surfaced a round earlier — the round count overstates how much review this code has actually had, which argues for fixing the structure rather than reading the count as churn.

---

## Round 5 — verifying iteration 5

Anchored Claude signalled `approve`; cold Claude signalled `changes_requested`; cold Codex returned no findings. The foreman reproduced the key fixes independently.

### Stage 1 — Acceptance Criteria Re-Check

#### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Foreman re-ran: `npm run lint` clean, `npm run type-check` clean, `npm run sync-templates:check` in sync, `tests/run-task-safety.test.ts` **185/185 pass**. The anchored lens additionally rebuilt `dist/` in an isolated extraction of `81bb96c` and confirmed it reproduces byte-for-byte; the cold lens independently confirmed the bundle mirrors the round-5 TypeScript.

#### Acceptance Criteria

| AC | Status | Notes |
|---|---|---|
| AC-1 – AC-6 | Met | `worktree.ts` untouched by iteration 5 (`git diff bfd7a73..81bb96c` = `main.ts`, tests, docs pair, `dist/` only). All resolver, containment, linking and probe evidence unchanged and green. |
| AC-7 | Met | Exemption still applied where `dirtyEntries` is constructed (`main.ts:1386-1395`), upstream of the clean-tree push branch, the empty-dirty die, the `unexpected` filter and the stage-path build. |
| AC-8 | **Met** (was Not Met) | Verified directly, not inherited. All three round-4 triggers now abort; see the verification list below. |
| AC-9 | Met | New fixtures assert anchored porcelain shapes and a `doesNotMatch` for the ignored real install. |
| AC-10 | **Partial** | Test clause holds (no pre-existing root-only assertion edits; 185/185 green). Behavioral clause does not — see the Spec Gaps section. |
| AC-11 | Met | Unchanged and green. |
| AC-12 | **Met** (was Partial) | Both falsified sentences replaced; the anchored lens re-read the new prose line-by-line against the shipped code and found both statements accurate. Mirror byte-identical. |

#### Stage 1 Verdict

**Pass.** AC-10 is `Partial` on a spec contradiction rather than dropped work, and is routed to Spec Gaps below.

### Verifying Round 4

Every round-4 blocking finding is fixed, and each was confirmed **red at `bfd7a73`, green at `81bb96c`** by the anchored lens running the fixtures against an extracted copy of the prior commit — not taken from the handoff.

- **R4-1(a) ineligible path** (`packages/notapkg/nested/node_modules`, named verbatim in AC-8) → **fixed**. Exits non-zero with "outside the human_review allowlist"; `git ls-tree -r HEAD` has no node_modules. Same test committed at exit 0 under `bfd7a73`.
- **R4-1(b) workspace only on the task branch** → **fixed**. Passes at HEAD, fails at `bfd7a73`.
- **R4-1(c) staged entry collapsing the protected set** → **fixed**, and now structural: the protected set no longer exists. `classifyHumanReviewPath` (`main.ts:790`) rejects any final-segment `node_modules` path before any allowlist branch, independent of index state and workspace eligibility.
- **R4-2 `git add` failing on a gitignored exclusion** → **fixed**. Root cause genuinely closed: `exemptNodeModulesPath` returns a path only for an entry actually observed as `??` in porcelain, and a porcelain-visible `??` entry is by definition not gitignored, so the error is unreachable. Foreman reproduction: the exact fixture that exited 1 in round 4 now exits 0 and stages only the intended file. Both lenses separately confirmed that a `:(exclude,literal)` pathspec matching nothing exits 0, so a stale exclusion cannot wedge the add either.
- **R4-3 gate/staging normalization split → silent data loss** → **fixed**, structurally: both decisions consume the single `classifyHumanReviewPath`, and the emitted stage path is the declared UTF-8 string, never the porcelain spelling.
- **R4-4 test-integrity gaps** → **fixed**, all four bullets. The staged-predicate test vacuous since round 1 is genuinely closed: the anchored lens mutation-tested it by deleting the `entry.indexStatus !== '?'` guard and the test now **fails**, where it previously passed against that mutation.
- **R4-5 docs falsified by code** → **fixed**.

**This iteration is the structural fix round 4 asked for, not a fourth patch.** The `humanReviewAllowedPath` → `buildHumanReviewStagePaths` → `git add` triad that produced blocking findings in rounds 1, 2 and 4 now routes through one classifier with a single chokepoint.

### Stage 2 — Findings

#### Correctness Bugs

None surviving. No lens produced a finding that ships incorrect content, bypasses a safety gate, or regresses against pre-task `main` in the direction that commits bad data. The two behavior deltas both lenses measured are consequences of a spec contradiction and are routed below.

#### Risk / Guardrails (non-blocking)

**Root link is never repaired on reuse, while the run reports success.** `worktree.ts:349` gates the root block on `isNewWorktree`; the workspace loop at `:369` is not gated. After a first run that dies at any probe, a rerun restores every workspace link but never `<wt>/node_modules`, so builds inside the worktree fail with unresolved modules and no diagnostic. Flagged by the anchored lens in round 4 and by cold Claude here. Not a regression — pre-task, the same rerun produced *no* links at all — and it is documented at `docs/pipeline-orchestrator.md:286`. But "silently missing dependencies behind a success-shaped message" is the bug class this task exists to close, and the `missing-source` variant at `tests:3505` asserts nothing beyond `status === 0`, so nothing pins it. Worth closing in a follow-up.

**Operator-facing abort message never mentions the `node_modules` rule.** `main.ts:1439-1449` still tells the operator "directory-form entries like 'dist/' match subpaths", which is now false for any final-segment `node_modules` path, and offers two remedies that cannot resolve a categorical rejection. Open since round 2; the surface is larger now that the rule is unconditional.

**The ` -> ` mis-split repair covers untracked entries only.** `porcelainEntryPaths` repairs the `??` case; cold Claude verified empirically that git C-quotes space-containing paths for tracked entries too, so a tracked-modified file whose name contains ` -> ` still yields two bogus fragments and aborts with a garbled path list. Fail-closed, cosmetic consequence.

#### Spec Gaps

**AC-8 and AC-10 are now mutually unsatisfiable, and the implementation had to pick a point between them.** AC-8 requires every non-exempt `node_modules` entry to "abort as today"; AC-10 requires that with no `workspaces` field, both gate call sites "behave as before this task". For entries in a no-workspaces repo these conflict, and both lenses measured the resulting split:

- **Fail-closed side** (anchored, measured via the exported `buildHumanReviewStagePaths` at HEAD vs `bfd7a73` vs pre-task `0ace030`): a *tracked* entry whose final segment is exactly `node_modules` under a declared prefix — e.g. ` M vendor/node_modules` with prefix `vendor/` — returns `[]` at HEAD (→ `die`) but `["vendor/"]` at both `bfd7a73` and pre-task. A repo that commits a `node_modules` symlink under a declared prefix now hard-aborts at `human_review` with no `--force` escape. Cold Claude flagged the same shape independently.
- **Fail-open side** (anchored, measured both directions): `?? packages/a/node_modules/lodash/index.js` under prefix `packages/` is now allowed *and* staged, where `bfd7a73` aborted. Reachable only when the repo has no `node_modules` ignore rule at all, and it matches pre-task `0ace030` exactly — so AC-10 is satisfied here while AC-8's "real directory … aborts as today" is satisfied only under the pre-task reading, which makes that clause vacuous.

The implementer chose the blanket final-segment rule because round 4's review prescribed it, and it is the right trade for the safety-gate half. But the spec cannot be met as written, and iteration 5's AC delta records "AC-10: remains Met" on the strength of `tests:5346`, which uses `dist/lambda/node_modules/lodash/index.js` — a path whose final segment is *not* `node_modules` and which therefore behaves identically at pre-task, `bfd7a73` and HEAD. That evidence structurally cannot detect the shape that changed. **A human decision on which clause governs is needed; Codex cannot resolve a contradiction in code.**

**AC-8's "real directory (with a `.gitignore` that lets porcelain see it)" parenthetical remains unconstructible** — under `-uall` git always expands an untracked directory, and a trailing-slash rule hides it entirely. Recorded in rounds 1, 2 and 4 and still uncorrected; iteration 5's handoff explicitly declined to edit `spec.md` as out of its Affected Files cap, which is the correct call. This is the fourth round it has been carried.

### Dismissed Cold Findings

- **Dismissed (cold-Claude): root `node_modules` exemption is a vacuous self-comparison when `cwd === REPO_ROOT`.** Verified true and explicitly spec-intended. Decision §Gate widening: *"The **root** entry's behavior is deliberately unchanged in both modes (its non-worktree tautology is pre-existing, shipped behavior pinned by the existing suite) — this task neither extends nor fixes it."* Fourth round raised; citation unchanged. The adjacent doc wording at `:311` ("a filesystem probe confirms it is canon's untracked symlink") does overstate it in that mode — a wording nit, folded here rather than blocking.
- **Dismissed (cold-Claude): new hard `die()` for a repo committing a workspace `node_modules` symlink.** This is AC-4's specified behavior ("wrong-target symlink → the run dies with a message naming the offending path"), pinned by a test the spec asked for.
- **Dismissed (cold-Claude): coverage concentration — "most new tests pass identically against `bfd7a73`".** Not supported. The anchored lens ran the fixtures against an extracted `bfd7a73` tree and measured 5 of 7 failing, plus mutation-tested the staged predicate. Direct execution outweighs static inspection here.
- **Dismissed (cold-Codex): no findings returned.** Recorded, not treated as corroboration — a quiet lens is a quiet lens. Its silence happens to agree with the anchored lens this round, but the agreement carries no independent weight.

*Filtered out under round-5 discipline (nits, wording, unreachable, or pre-existing): `normalizeGitPath` micro-hazards (`\777` truncation, lone surrogates, O(n²) slice, non-UTF-8 collisions — all unreachable via porcelain); dead `isNewWorktree &&` guards; the unreachable `untrackedPorcelainPath` fallback; first-match precedence in `classifyHumanReviewPath` (both lenses traced it and neither could construct a dropped file); duplicate-capable return array (both callers re-wrap in a `Set`); repeated `normalizeGitPath` calls; per-workspace warn/info not gated on rerun; exclusion pathspec NFC spelling; TOCTOU in repair mode; `resolveWorkspaceDirs` validating `path.normalize(pattern)` but globbing `pattern`; the `verified-symlink` fixture's self-referential construction; `exclude`-callback coverage; QA-gate exclusion asymmetry.*

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

**No code-bugs survive.** Every round-4 blocker is verified fixed with red/green evidence I did not have to take on trust, the gate is now a single chokepoint rather than three surfaces patched in sequence, and the previously-vacuous test is mutation-proven non-vacuous. That work is done and I would ship it.

The verdict is `spec_gap` rather than `approved` for one reason: **AC-8 and AC-10 now contradict each other**, and the resolution the implementer picked — correct for the safety half — changes documented behavior for no-workspaces repos in both directions. Routing this to `changes_requested` would send Codex around a sixth loop on a contradiction it cannot fix in code; routing it to `approved` would silently ratify a spec breach and leave AC-10's "remains Met" resting on evidence that cannot detect the change.

What the human needs to decide:

1. **Which clause governs** for a final-segment `node_modules` entry in a no-workspaces repo — AC-8's blanket rejection (current behavior, fail-closed, breaks a repo that commits such a path under a declared prefix) or AC-10's pre-task parity. Then amend the losing clause.
2. **Whether AC-8's real-directory parenthetical is retired** — it has been carried unconstructible for four rounds.

Both are one-paragraph spec edits. Once they land, the code as it stands is very likely already correct against the amended text — I expect a re-review to be a formality rather than another iteration.

`status.json` records `iterations: 4`, `changes_requested_total: 4`, `auto_block_count: 1`. Counters untouched.
## Round 6 — verifying the human-review amendment

Anchored Claude signalled `approve`; cold Claude signalled `changes_requested`; cold Codex returned no findings. The foreman independently verified the amendment's two load-bearing claims, the `docs/BACKLOG.md` gap, and the repair-mode code paths.

> **There is no implementation delta this round.** `HEAD` is `81bb96c` — the exact commit round 5 reviewed. `git diff 81bb96c..HEAD` is empty, and `git diff HEAD` against the six declared files is empty, so nothing was silently dropped by auto-commit. Round 5 returned `spec_gap` (not `changes_requested`), stating "No code-bugs survive... That work is done and I would ship it" and asking the human to resolve an AC-8/AC-10 contradiction. The human amended `spec.md`; Codex correctly made no code change. **The question this round answers is whether the shipped, unchanged code satisfies the amended text** — not whether new code is correct.

### Stage 1 — Acceptance Criteria Re-Check

#### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Re-measured independently, not taken from the handoff: `npm run lint` clean; `npm run type-check` clean; `npm test` **1144/1144 pass, 0 fail**; `tests/run-task-safety.test.ts` alone **185/185** (identical to round 5, consistent with the empty diff); `npm run build` reproduces `dist/scripts/run-task.js` **byte-identical**; `npm run sync-templates:check` in sync and the `templates/` mirror byte-identical by `diff`; `npm run docs-refs-check` clean; `git diff --check main...HEAD` clean. `git diff main...HEAD --name-only` is exactly the six declared paths, with `dist/cli/index.js` genuinely absent as the handoff claims.

One immaterial discrepancy recorded for accuracy: the handoff reports "1,143 passed, 1 expected sandbox skip"; the lens measured 1144/1144/0 skipped because it had no restricted-`.git` sandbox for that case to skip on. Not a substantive difference.

#### Acceptance Criteria

| AC | Status | Notes |
|---|---|---|
| AC-1 – AC-6 | Met | `worktree.ts` untouched since iteration 4. Resolver exactness, source containment inside the resolver, segment-wise `resolveContainedPath` (`worktree.ts:131-145`), five-variant classification, root-pair-first, and the explicit-target probe (`worktree.ts:286-295`) all re-confirmed green. Leaning on rounds 4/5 verification for the unchanged evidence, as stated. |
| AC-7 | Met | Exemption still applied where `dirtyEntries` is constructed (`main.ts:1384-1395`), upstream of the clean-tree push branch (`:1402`), the empty-dirty die (`:1431`), the `unexpected` filter (`:1435`) and the stage-path build (`:1452`). QA side at `main.ts:995-996`. |
| AC-8 | **Met** | The amended parenthetical now names the fixture the suite actually contains. Verified directly at `tests:3195-3240`: the `directory` variant builds a real `packages/a/node_modules` with an untracked child, asserts the exact porcelain line `^\?\? packages/a/node_modules/marker\.txt$`, **then** asserts non-zero exit plus "outside the QA-end allowlist". The anchored porcelain assertion makes it non-vacuous. Sibling variants pin `^A  packages/a/node_modules$` (staged) and `^\?\? packages/notapkg/nested/node_modules$` (ineligible). Four rounds of chasing an unconstructible clause are closed. |
| AC-9 | Met | Per-variant anchored porcelain companions present and exact; bare-rule anti-vacuity companion intact. |
| AC-10 | **Met** (was Partial in round 5) | Measured, not asserted — see the pre-task comparison below. The code does exactly what the amended text says: `classifyHumanReviewPath` (`main.ts:790`) rejects a final-segment `node_modules` path before any allowlist branch, independent of index state and of whether the repo declares `workspaces`; the named vendored-descendant shape is untouched. The test clause also holds — `assert.match(gitLog, /^add -A -- dist\/$/m)` is still the pre-existing byte-for-byte assertion at `tests:5341`, and no root-only expectation was edited. |
| AC-11 | Met | Unchanged and green. |
| AC-12 | Met | Docs prose re-read line-by-line against the shipped code; mirror byte-identical; `sync-templates:check` green. |

#### Stage 1 Verdict

**Pass.** No AC is Not Met or Partial.

### The amendment's two claims, verified against the code

**1. AC-10's "strictly-safer divergence" premise holds.** The amendment asserts the final-segment rule "can only newly *reject* a commit that pre-task code would have silently staged a `node_modules` directory into, never newly *admit* one". That is a falsifiable claim and it was tested rather than read. Eight porcelain shapes were driven through the exported `buildHumanReviewStagePaths` at HEAD and against an extracted pre-task tree (`0ace030`):

| Shape (declared prefix) | pre-task `0ace030` | HEAD `81bb96c` | direction |
|---|---|---|---|
| `?? dist/lambda/node_modules/lodash/index.js` (`dist/`) | `["dist/"]` | `["dist/"]` | identical — the amendment's named unaffected case |
| `?? packages/a/node_modules/lodash/index.js` (`packages/`) | `["packages/"]` | `["packages/"]` | identical — round 5's "fail-open" is pre-task parity |
| `?? tasks/t1/node_modules/x.js` (none) | `["tasks/t1"]` | `["tasks/t1"]` | identical |
| ` M vendor/node_modules` (`vendor/`) | `["vendor/"]` | `[]` → die | newly rejects |
| `?? dist/node_modules` (`dist/`) | `["dist/"]` | `[]` → die | newly rejects |
| `?? tasks/t1/node_modules` (none) | `["tasks/t1"]` | `[]` → die | newly rejects |
| `?? "packages/caf\303\251/node_modules"` (`packages/`) | `[]` | `[]` | identical (different mechanism) |
| `R dist/a.js -> dist/node_modules` (`dist/`) | committed | die | newly rejects |

No constructed shape moves in the admit direction, and the property is structural rather than incidental: the classifier rejects before any allowlist branch, and the post-`git add` backstop (`main.ts:1509-1520`) re-checks every staged name through the same classifier, so even a prefix sweep-in aborts rather than commits. Round 5's two measured behavior deltas are now both accounted for by the amended text — the fail-open side because it is pre-task parity the amendment names explicitly, the fail-closed side because the amendment sanctions it.

**2. AC-8's substituted fixture is the one in the suite, and it is non-vacuous.** Verified above at `tests:3195-3240`.

**3. The handoff's third amendment bullet checks out.** The claimed stale-wording sweep is accurate: `docs/pipeline-orchestrator.md` and its mirror both state the final-segment rejection and the preserved vendored-descendant behavior, and contain no unqualified no-workspaces parity claim.

A hypothesis worth recording as *disproved* so it is not re-chased: the `:(exclude,literal)${exemptPath}` pathspec (`main.ts:1493`) was suspected of emitting the raw on-disk (possibly NFD) spelling against git's NFC record, making the exclusion a silent no-op. Reproduced with an NFD-on-disk `packages/café` and disproved — git normalizes pathspec arguments too, and the exclusion applied correctly.

### Stage 2 — Findings

#### Correctness Bugs

**None surviving.** Applying the round-6 bar — ships incorrect content, bypasses a safety gate, causes data loss, or regresses against pre-task `main` in a direction that commits bad data — nothing from any lens clears it. Cold Claude signalled `changes_requested` on two reproduced findings; both are adjudicated below as guardrail items rather than code-bugs, with reasons.

#### Risk / Guardrails (non-blocking)

**R6-1 — Repair mode is silent on two anomalies it declines to fix.** `worktree.ts:369-372` and `:411`, `:423`. Cold Claude reproduced both end-to-end.
- *Stale link, vanished source.* `if (!fs.existsSync(sourceModules)) continue` skips a workspace whose `REPO_ROOT` install has been removed since the link was created; the repair pass only ever *creates* missing links, never removes stale ones. The dangling symlink then classifies non-exempt and the QA gate aborts with "Source or test edits must be committed during the implement phase" — a message that names the wrong cause. Clearing it requires manually `rm`-ing a symlink canon itself created.
- *Wrong-target link on re-entry.* `case 'symlink': if (isNewWorktree && verdict === 'not-exempt') die(...)` has no `else` warn, and `case 'error'` likewise. The identical condition at initial setup emits an explicit, actionable abort; on reuse it is accepted with zero output and surfaces phases later at the gate with the same misleading text.

Why this is not a code-bug: both fail closed, neither commits bad data, and **the silence is the contract this review chain demanded.** Round 2's R2-3 blocked precisely *because* reuse re-armed the abort arms on every phase transition, and `docs/pipeline-orchestrator.md:286` states the resulting rule — "repairs only missing workspace links... leaves existing root, workspace, and `.env*` entries untouched." The stale-source case is also the pre-existing root failure mode replicated per workspace: on pre-task `main`, deleting `REPO_ROOT/node_modules` mid-task leaves `<wt>/node_modules` dangling and aborts the same gate with the same message. This is a 1→N multiplication of an inherited shape, not a new class. What is genuinely worth fixing in a follow-up is the **operator signal**: a `warn` in the two reuse-gated arms, and either removing or reporting a workspace link whose source no longer exists.

**R6-2 — The abort message never mentions the `node_modules` rule.** `main.ts:1439-1449`. Verified verbatim by the foreman: the die text still tells the operator "directory-form entries like 'dist/' match subpaths", which is now false for any final-segment `node_modules` path, and offers two remedies (add to Affected Files / `git checkout HEAD -- <path>`) that cannot resolve a categorical rejection. An operator who follows the instruction dies identically on rerun with no path forward. Open since round 2; both lenses again this round; the surface is larger now that the rule is unconditional. This is the highest-value non-blocking item and it is a few lines of message text.

**R6-3 — Root link is never repaired on reuse, while the run reports success.** `worktree.ts:343` gates the root block on `isNewWorktree`; the workspace loop at `:369` is not gated. After a first run that dies at any probe, a rerun restores every workspace link but never `<wt>/node_modules`, then prints "repairing missing workspace links" and "Worktree ready." Both lenses; carried from rounds 4 and 5. Not a regression (pre-task that rerun produced no links at all) and documented, but "silently missing dependencies behind a success-shaped message" is the bug class this task exists to close, and `tests:3505` asserts nothing beyond `status === 0`. Cold Claude adds that the reuse log line fires even in repos with no `workspaces` key, where there is nothing to repair.

**R6-4 — A detached-HEAD worktree is silently excluded from the repair pass.** `worktree.ts:306`. `findExistingWorktreeForBranch` matches only `branch refs/heads/...` lines, while `git worktree list --porcelain` emits `detached` for a worktree mid-rebase/bisect or after an agent `git checkout <sha>`. Reproduced: repair is skipped and the message is byte-identical to the "not canon's worktree" case, so the operator gets no signal. Declining to write into a worktree canon cannot confirm as its own is the right default (round 2's R2-11 asked for exactly that guard); only the indistinguishable message is the defect.

**R6-5 — Smaller carried items.** The ` -> ` mis-split repair covers untracked entries only (`main.ts:758-772`, fail-closed, cosmetic). `workspaceDirsForNodeModulesEntries` (`main.ts:817`) globs and emits resolver warnings even when `cwd === REPO_ROOT`, where `exemptNodeModulesPath` returns null unconditionally at `:852` — wasted work plus spurious operator warnings in non-worktree runs. Exclusion pathspecs are emitted only for stage paths ending in `/`, so `git add -A -- tasks/<id>` gets none — measured identical to pre-task and caught by the `stagedUnexpected` backstop, but it qualifies the doc sentence at `:323`. `commitQaArtifacts` emits no exclusions at all — verified harmless, since its stage paths are only `tasks/<id>`, telemetry and managed docs.

#### Items requiring a human action, not another iteration

**The Amendment's `docs/BACKLOG.md` commitment was never carried out.** `spec.md:205` states as accomplished fact: *"That entry is recorded in `docs/BACKLOG.md`"* — covering round 4's structural chokepoint refactor plus the accumulated non-blocking nits `R2-6` through `R2-14` and `R4-5`. Foreman-verified: it is not there. `git log -1 -- docs/BACKLOG.md` is `380b3c2` (an unrelated task), the file is clean in the working tree, and no entry for this task or the chokepoint exists. Codex was right not to write it — `docs/BACKLOG.md` is neither an AC nor in Affected Files, so touching it would trip the auto-commit and base-drift gates.

This was considered as a `spec_gap` verdict and deliberately not routed there. `spec_gap` halts the pipeline so a human can amend the spec; here the spec statement is not what needs fixing — the missing BACKLOG line is — and the human reaches `human_review` two phases from now regardless. Halting a ready implementation for a bookkeeping line would cost a full cycle and buy nothing. It is recorded here, and in the summary to the operator, as the one outstanding action.

**AC-10's amended example under-describes the exception's reach.** `spec.md:117` illustrates the rule firing *"even when it falls under a declared directory-form Affected Files prefix (e.g. `dist/`)"*. Measured above, it also newly fires through the **task-artifact branch** with no prefix declared at all: `?? tasks/<id>/node_modules` yields `["tasks/t1"]` pre-task and a hard `die` at HEAD. The leading clause is unqualified, so the code is within the text as written and this is not an AC miss — but AC-10's whole purpose is enumerating no-workspaces divergences, and this is a second one it does not name. One clause, whenever the spec is next touched.

### Dismissed Cold Findings

- **Dismissed (cold-Claude): "The final-segment guard structurally cannot protect a directory-form prefix from a *real* workspace install."** — Reproduced and accurate (`.gitignore` = `/node_modules`, prefix `packages/`, real `packages/a/node_modules/left-pad/index.js` → staged), but explicitly spec-intended and pre-task parity. Amended AC-10: *"A vendored dependency file beneath such a directory (e.g. `dist/lambda/node_modules/lodash/index.js`, whose final segment is `index.js`, not `node_modules`) is unaffected and remains eligible for prefix staging, matching pre-task behavior exactly for that shape."* The foreman measured that exact shape at `["packages/"]` on both pre-task `0ace030` and HEAD. The docs sentence cold Claude objects to (`:323`) does name the vendored-descendant carve-out in the same breath, so it is not overstated.
- **Dismissed (cold-Claude): "Linking every workspace's `node_modules` widens the shared-mutable-state blast radius — installs inside the worktree write through to `REPO_ROOT`."** — Accurate, and the tradeoff the shipped root symlink already makes. Decision: workspace pairs use "the same fail-closed classification the root pair uses today". Dismissed on the same grounds in round 1; citation unchanged.
- **Dismissed (cold-Claude): NFC-insensitive identity comparison could let a rogue `node_modules` under an NFC/NFD twin be silently dropped from the dirty-tree gate** (`main.ts:754`). — Requires a normalization-sensitive filesystem where the two spellings are distinct directories; self-tagged low confidence and inferred, not reproduced. The `stagedUnexpected` backstop at `:1509` still blocks a commit, so impact is classification-only. Round 5 filtered the same normalization micro-hazard family.
- **Dismissed (cold-Claude): prefix allow-check normalizes NFC but `git add` is issued with raw spec bytes, so a normalization-mismatched prefix is allowed then fails to stage** (`main.ts:809` vs `:1495`). — Self-tagged low confidence, inferred. Contradicted by the anchored lens's direct measurement that git normalizes pathspec arguments (the NFD exclusion experiment above). Fail-closed either way.
- **Dismissed (cold-Claude): first-match `return` on aliased workspace destinations** (`main.ts:861`), **unbounded octal escape `\400`** (`main.ts:733`), **unreachable `untrackedPorcelainPath` fallback and the "before probing" test name** (`main.ts:758`, `tests:2344`), **dead `isNewWorktree &&` guards** (`worktree.ts:328`), **`buildHumanReviewStagePaths` can return duplicates** (`main.ts:898`), **source `node_modules` containment not verified** (`worktree.ts:371`). — All fail-closed or unreachable, all explicitly filtered under round-4/round-5 discipline, and none re-raised with new evidence that they are live defects. Foreman confirmed both `buildHumanReviewStagePaths` callers re-wrap in `new Set(...)`, so the duplicate contract change is latent only.
- **Dismissed (cold-Codex): no findings returned.** Recorded, not treated as corroboration — a quiet lens is a quiet lens, not a clean diff. Its silence coincides with the anchored lens this round; the agreement carries no independent weight. Cold Claude, by contrast, returned seventeen items, two of which it graded blocking; those were adjudicated on their merits above rather than outvoted.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

**No code-bugs survive, and the spec gap that produced round 5's halt is genuinely closed rather than papered over.** Both amended clauses were checked against the code, not the prose: AC-10's "strictly-safer, never newly admits" premise survived every counter-example the lenses could construct plus a direct eight-shape comparison against pre-task `0ace030`, and AC-8's substituted fixture is the one actually in the suite with an anchored porcelain assertion that makes it non-vacuous. The unchanged implementation is correct against the amended text, which is what round 5 predicted.

The `approved_with_nits` rather than `approved` rests on two things the operator should see before shipping, neither of which is code Codex should be sent back to write:

1. **`docs/BACKLOG.md` has no entry**, though the Amendment states it does. Round 4's chokepoint escalation and ~15 recorded non-blocking findings currently live only in this review artifact. One line, human-side, outside the pipeline.
2. **R6-2, the abort message**, is the highest-value residual: the rule it must explain is now unconditional and reachable through more branches than when it was first flagged in round 2. R6-1 and R6-3 are the same complaint in the linker — canon declines to act and says nothing, or says "ready" when it is not. Grouping R6-1/R6-2/R6-3 into one small operator-messaging follow-up would close the whole family.

Six rounds is a lot, and most of it was earned: the gate half of this task genuinely needed the structural rewrite round 4 demanded, and round 3's Claude lenses never ran. The linker half has been stable since round 2. Nothing outstanding justifies a seventh pass.

`status.json` records `iterations_total: 5`, `changes_requested_total: 4`, `auto_block_count: 2`. Counters untouched.
