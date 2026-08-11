# Code Review: relocate-orchestrator-to-src

> Reviewer: Claude | Spec: `tasks/relocate-orchestrator-to-src/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Synthesized by the foreman from three lenses: an anchored Claude lens, a cold (spec-blind) Claude lens, and a pre-obtained cold-Codex lens. Every finding below was re-verified by the foreman against the tree before it was recorded.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The table is structurally clean and every required check is present. One recorded *result* is inaccurate, which is a separate finding (CB-3): the `npm test` row reads "1,147 passed, 1 skipped, 0 failed". Re-run in this worktree: **1,147 passed, 0 skipped, 1 failed**. The one test that was *skipped* in the implementer's sandbox is the one that *fails* here, so the recorded Pass never exercised the moved code.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: nothing remains at the old location | Pass | `ls scripts/` = exactly the 6 tooling files; [scripts/run-task](scripts/run-task), [scripts/run-task.ts](scripts/run-task.ts), [scripts/pipeline-policy.ts](scripts/pipeline-policy.ts) absent; no `dist/scripts/` (dist top level = `cli`, `orchestrator`) |
| AC-2: zero-result reference gate, 4 string families | Pass | All four families via `git grep -F` with the spec's exclusions (`tasks/**`, `CHANGELOG.md`, `docs/task-quality-log.md`, `src/cli/commands/stop.ts`) → 0 / 0 / 0 / 0. `stop.ts:32` byte-identical to base; only its 3 import specifiers changed |
| AC-3: `dist/` behaviorally identical, depth invariant holds | Pass | `path.resolve(__dirname, '../..')` unchanged at `src/orchestrator/env.ts:55` (identical in base); both `src/orchestrator/` and `dist/orchestrator/run-task.js` are 2 segments deep; `npm run build && git diff --exit-code -- dist/` clean on a fresh build; `--help` output identical to the pre-move bundle's |
| AC-4: tests pass with imports-and-paths-only edits | **Fail** | Two independent clauses unmet. (a) "The full suite is green" is false in a linked worktree — `tests/run-task-safety.test.ts:2186` fails (CB-1), reproduced directly. (b) One test carries a non-path edit and the handoff does not name it (CB-3). A third file's guard silently stopped guarding (CB-2). Everything else across the 26 touched test files normalizes to pure path/import substitution |
| AC-5: leak gate keeps coverage and can't lose it silently | Pass | `CANON_INTERNAL_PATH_PREFIXES = ['src/orchestrator/']`; dir scan → `src/orchestrator/prompts/templates/`. The new test at `tests/sync-canon-templates.test.ts:71` imports the **production** `INTERNAL_ONLY_TEMPLATE_BASENAMES` export (resolved at module load against `CANON_AI_ROOT`) and asserts `size > 0` plus `deepEqual` on the exact 8 baseline names — not a re-derivation, not a directory read in the test. `readMarkdownBasenames` returns `[]` on a missing dir, so a stale path trips the assertion. This is the right guard and it is not vacuous. `sync-templates:check` clean |
| AC-6: runtime spawn bridge resolves | Pass | `src/cli/commands/run-task.ts:8` and `dist/cli/index.js:1737` → `dist/orchestrator/run-task.js`; `node dist/cli/index.js run --help` reaches orchestrator usage, exit 0 |
| AC-7: published package contents correct | Pass | `npm pack --dry-run --json`: 40 files, `scripts/` entries = exactly `["scripts/install-git-hooks.mjs"]`, zero raw `.ts`. `postinstall` target present and reads no sibling script. Adopter scaffolding resolves from `templates/`, not `scripts/`, so the narrowing has no collateral |
| AC-8: gated doc surfaces correct | Pass | `npm run docs-refs-check` → all refs OK |
| AC-9: two doc passages rewritten, not path-swapped | Pass | `docs/architecture.md` Full-build row collapses to `src/**` and names both new dist artifacts; `docs/decisions.md:175`/`:181` reworded to discriminate by **path specificity** rather than top-level directory. Authored, coherent, no residual self-contradiction |
| AC-10: ASCII diagram re-aligned | Pass | Orchestrator box normalized to 77 columns on all 9 rows. See Dismissed for the sibling-box width question |
| AC-11: three already-wrong references corrected | Pass | `.canon/hooks/README.md:3,39` → `src/orchestrator/main.ts` (verified: hook dispatch is in `main.ts` only, 4 sites, zero elsewhere); `env.ts:92` → `src/lib/pipeline-policy.ts` (the effort matrix does live there); `metrics.ts:19` now byte-matches `docs/pipeline-invocations.md:3` |
| AC-12: BACKLOG swept, migration entry closed | Pass | Family-1 grep proves the sweep; `docs/BACKLOG.md:556` is `[x]` with a task pointer. Three accuracy issues inside the swept entry — one is a Risk finding (RG-2), two are nits |
| AC-13: canon-managed mirror regenerated and declared | Pass | `scripts/docs-refs-check.mjs` and `templates/scripts/docs-refs-check.mjs` carry byte-identical diffs; sync check clean; declared in both spec and handoff |
| AC-14: all three path-reconciliation gates clear | Pass | Gate 1: auto-commit completed (`preCheckOk: true`, `remaining: []`, `commitOk: true` → 9c36c98) with all 47 as `R old -> new` porcelain entries. Gate 2: `code_review` opened with 0 pre-flight rejections. Gate 3 re-run directly: `parseAffectedFilesFromSpec` → `malformed: []`, 145 files, and every representative both-sides member present including `dist/scripts/run-task.js` |
| AC-15: policy importers re-pointed, no parent specifier survives | Pass | `'../pipeline-policy.js'` in `src/orchestrator/**` → 0. `'../lib/pipeline-policy.js'` scoped there → exactly 3 (`policy.ts:13`, `quality-log.ts:4`, `types.ts:10`); `src/task/index.ts:17` is the expected 4th repo-wide. `npm run type-check` clean |

### Dropped Sections Check

- [x] Non-goals respected — `check-phase-gate.ts` moved rather than deleted; test filenames unchanged; `npm run lint`'s argument list unchanged; no orchestrator behavior change. Independently corroborated: every mutation chokepoint (`validation.ts`, `git.ts`, `state.ts`, `worktree.ts`, `review-loop.ts`) is a 100% rename with a zero-byte body diff, and `main.ts` is 99% with only 4 comment lines touched. `autoCommitCode`, `findUncoveredTrackedChanges`, `checkPhaseGate`, and `verifyBaseDrift` are byte-identical across the move
- [x] Known Risks addressed — risks 1 (leak-gate collapse), 3 (spawn bridge), 4 (depth fallback), 5 (under-declared renames), and 6 (erased type-only import) all verified closed. **Risk 2 (string-literal test refs) is the one that landed**: CB-1 and CB-2 are both instances of it
- [x] Human Test Plan is satisfiable

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

**Stage 2 was run anyway, deliberately.** The AC-4 gap is narrow and localized to three test-file sites; the other 14 ACs are verified met and the relocation itself is sound. Withholding Stage 2 would have hidden CB-2 — a guard that silently stopped guarding, in code the AC-4 fix does not otherwise touch — and guaranteed a third round for it. All findings are therefore in this one round.

## Stage 2 — Code Quality

### Summary

The relocation is genuinely clean. Across 108 files and 47 renames I could not find a single behavior change smuggled into the sweep: every guard-bearing orchestrator module is a zero-body-diff rename, `dist/` rebuilds byte-identically from a fresh build, the two bundles' `--help` output is identical, all four AC-2 string families are truly zero, the `REPO_ROOT` depth invariant is untouched, and the AC-5 regression test is the real thing — it exercises the production discovery path and would catch the silent `existsSync → []` collapse it was written for. The three authorized content corrections (AC-11) are each factually right.

The findings all sit in one place: **test-harness root resolution**. Three sites in this commit use, or should have used, the active checkout instead of `REPO_ROOT`, and the implementer applied the correct fix at one of them and not the other two. This is a *named* canon pitfall (`docs/patterns.md:143`) and the canonical pattern with its full rationale is written out in a sibling test file this very commit edited (`tests/run-task-signals.test.ts:17-27`). That is what makes it worth one round rather than a nit: same bug class, three sites, fix already known in-repo.

### Findings

#### Correctness Bugs

**CB-1 — `tests/run-task-safety.test.ts:2199`: the suite is red in a linked worktree, and the test loads the wrong checkout's module.** *(flagged by 2 lenses: anchored + cold-Claude; reproduced by the foreman)*

The line was swept to `path.join(REPO_ROOT, 'src/orchestrator/env.ts')`, but `REPO_ROOT` is deliberately **not** the current tree — `resolveRepoRoot()` uses `git rev-parse --git-common-dir`, so it anchors to the supervising checkout. Observed directly:

```
✖ REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree
  ERR_MODULE_NOT_FOUND: Cannot find module
  '/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/env.ts'
```

Failure scenario: any `npm test` from a canon-created task worktree while `main` has not yet absorbed this branch → red suite at code_review / QA / human_review. Pre-move the literal was [scripts/run-task/env.ts](scripts/run-task/env.ts), which *does* exist in the supervising checkout, so this was green on `origin/main`.

Two things keep this from being dismissible as transient. First, it is **CI-invisible**: a flat CI clone makes `REPO_ROOT == cwd`, so the branch merges green and only canon's own dogfood flow breaks. Second, the defect survives the merge — post-merge the test passes while importing the *supervising* checkout's `env.ts`, so a future task that changes `resolveRepoRoot()` inside a worktree gets a green result from the old copy. That is the guard silently not guarding, which is exactly what `docs/patterns.md:143` warns about.

Fix: resolve from the active checkout. `tests/run-task-signals.test.ts:17-27` already spells out the pattern and the reason; this same commit applied the `process.cwd()` variant at three sites in `tests/run-task-harness.test.ts` and did not carry it here. The `assert.equal(result.stdout.trim(), REPO_ROOT)` assertion is unaffected by where the module loads from — resolution happens in the child's cwd — so the assertion keeps its meaning.

**CB-2 — `tests/cli.test.ts:3562`: the adopter-leak guard fail-opens and now scans the orchestrator bundle not at all.** *(flagged by cold-Claude; verified by the foreman)*

`ADOPTER_SHIPPED_PATHS` was swept to `'dist/orchestrator/run-task.js'` (`:3544`), and the loop does:

```ts
const fullPath = path.join(REPO_ROOT, rel);
if (!fs.existsSync(fullPath)) continue;
```

`/Users/tstraub/canon-ai/canon-ai-dev/dist/` contains only `cli/` and `scripts/` — confirmed — so the path is absent in the supervising checkout, the loop `continue`s, and `adopter-shipped content does not leak canon-development tokens` passes green having scanned nothing. Pre-move the old path *did* exist in the supervising checkout, so coverage went from "wrong copy scanned" to "nothing scanned."

Failure scenario: a canon-dev token (e.g. the active release-branch name in `tests/fixtures/canon-dev-tokens.json`) reaches a string literal that bundles into `dist/orchestrator/run-task.js` and ships to every adopter — and the test that exists to catch exactly that reports success.

Test-integrity finding, therefore a code-bug per the charter. Fix: build the path from the active checkout — `WORKTREE_ROOT` is already defined at `tests/cli.test.ts:47` as `process.cwd()` — and replace the fail-open `continue` with an existence assertion. Both sibling path-literal guards in this same diff already do it that way: `tests/validation-matrix-sync.test.ts:7,11` (`process.cwd()` + `assert.ok(fs.existsSync(...))`) and `tests/task-cli.test.ts:2560` (`assert.equal(fs.existsSync(runTaskBundle), true, ...)`). This one is the only unsafe member of the set.

Note `'dist/cli/index.js'` on the adjacent line has the same fail-open defect **pre-existing**. Fixing it comes free with the loop change; that is in scope only because the loop is being edited anyway.

**CB-3 — `tests/run-task-harness.test.ts:18,79,83`: undeclared non-path test edit, plus an inaccurate `npm test` row.** *(flagged by anchored; verified by the foreman)*

The commit deletes `import { REPO_ROOT } from '../scripts/run-task/env.js'` outright and replaces three `REPO_ROOT` uses with `process.cwd()`: `TSX_LOADER` (`:18`), the inline-import path (`:79`), and the spawned child's `cwd:` (`:83`). That is a root-resolution **mechanism** change, not an import specifier, path string, or fixture path — the categories AC-4 permits. AC-4 is explicit: *"If any further test's assertions or logic require a change, the handoff must name it explicitly with justification — that is a signal something moved that shouldn't have, not a routine edit."* Neither the Changes row ("Re-pointed imports and fixture paths") nor the Deviations table mentions it.

The edit itself is **correct** — it is what stops this file hitting CB-1's failure mode. The defect is that it is undeclared, which is precisely the check AC-4 exists to run: a reviewer trusting the "imports/paths only" claim skips auditing it.

Separately, the `npm test` row records "1,147 passed, 1 skipped, 0 failed" where this worktree yields "1,147 passed, 0 skipped, 1 failed" — the skip in the implementer's sandbox (`gitDirWritable === false` at `tests/run-task-safety.test.ts:2175`) is what hid CB-1.

Fix: declare the mechanism change with its rationale, and re-run `npm test` after CB-1/CB-2 and record the actual result.

> **These three are one bug class, so fix them as one sweep.** The invariant — *in test code, build paths to repo source from the active checkout, never from `REPO_ROOT`* — is already documented at `docs/patterns.md:143` and demonstrated at `tests/run-task-signals.test.ts:17-27`. To spare a re-derivation loop under the pre-flight gate (`docs/patterns.md` §Validation Gate Discipline), here is the definitive site list from a full `tests/` sweep for `REPO_ROOT`-built repo-source paths:
>
> | Site | State | Action |
> |---|---|---|
> | `tests/run-task-safety.test.ts:2199` | targets a path this task moved | fix (CB-1) |
> | `tests/cli.test.ts:3562` (`ADOPTER_SHIPPED_PATHS` loop) | targets a path this task moved | fix (CB-2) |
> | `tests/run-task-harness.test.ts:18,79,83` | already fixed, undeclared | declare (CB-3) |
> | `tests/cli.test.ts:3490` (`OPERATIONAL_DOCS` loop) | same class, none of its paths moved; unchanged by this task | **leave** — out of scope |
> | `tests/run-task-signals.test.ts:14,15` | `node_modules/tsx`, `tests/md-loader-register.mjs`; unchanged by this task | **leave** — out of scope |
>
> Do not widen past the first three rows. Per the spec's Scope-creep note, adjacent staleness belongs in a follow-up.

#### Risk / Guardrails

**RG-1 — `src/orchestrator/agents/stream.ts:39`: the one authorized content edit here uses the file-relative form.** *(flagged by 2 lenses)*

The comment was rewritten from `see run-task/signals.ts` to `see ../signals.ts`. Every other comment ref rewritten in this commit uses the repo-root-relative form, and `scripts/sync-canon-templates.mjs:78-79` states the canon-ai-dev convention explicitly. The consequence is specific: the next relocation greps `src/orchestrator/signals.ts` — exactly the AC-2 discipline — and misses this line, leaving it stale. That is the same grep-invisible class AC-2 family 4 was written to close, so writing the fix in the one form the discipline can't see is self-defeating. One-token fix in an in-manifest file: `src/orchestrator/signals.ts`.

**RG-2 — `docs/BACKLOG.md:588`: the path swap preserved a claim this same commit made false.** *(flagged by anchored)*

The line now reads: *"they're under `src/orchestrator/prompts/templates/`, which the npm package ships per the docs-refs-check `files` expansion task."* That was **true** on base (`files` included all of `scripts/`) and is **false** now — `src/` was never in `files`, and AC-7 narrowed the `scripts/` entry to one file. Verified against the pack manifest: 40 files, zero `.ts`, no `src/` entries; the templates reach adopters only inlined inside `dist/orchestrator/run-task.js`.

Failure scenario: whoever picks up the still-open `/canon-claude-review` entry designs an adopter-side skill around reading a template out of `node_modules/canon-ai/src/orchestrator/prompts/templates/`, which does not exist in the tarball. This is the trap of preserving a statement while correcting the path under it, and it defeats AC-12's stated purpose ("stale paths there would mislead whoever picks an entry up"). In-manifest, one-line fix.

#### Optional Cleanup / Nit

- `docs/BACKLOG.md:556` — the closure note says "completed by `relocate-orchestrator-to-src` **for v2.7.0**", but v2.7.0 is already cut (`CHANGELOG.md` `## [2.7.0]`, release commit c315af8, `package.json` at 2.7.0) with an empty `## [Unreleased]`, so this task lands in a later release. AC-12 asked only for a task pointer; drop the version or say "unreleased."
- `docs/BACKLOG.md:557-563` — tense sweep applied unevenly under a now-`[x]` entry. Two bullets were past-tensed correctly; four still read as an open proposal ("**Why it's parked (not \"no\")** … Do it only if a concrete reason appears", "**Sequencing — the real blocker** … **Do this only when the run-task queue is drained**", "**Effort tension to resolve** … Settle the real scope deliberately before picking this up", "**Effort**: `L`–`XL` … Its own pipeline task"). A reader hits a checked entry that tells them to defer the work.
- `src/orchestrator/main.ts:26` — `import { taskPhase } from '../../src/task/index.js'` while all six `phases/*.ts` siblings were re-pointed to the intra-`src` form `'../../task/index.js'`. It resolves correctly (byte-identical to base; `../..` from `src/orchestrator/` still lands on the repo root because depth was preserved) and `main.ts`'s only authorized edits were comments — so this is consistency, not a bug. Verified no duplicate-module hazard: exactly one `function taskPhase` in the bundle.
- `src/lib/pipeline-policy.ts:3,8` — "Extracted from run-task.ts…" and "Env-var resolution + legacy-shim warnings stay in run-task.ts." Env resolution and the legacy shims live in `src/orchestrator/env.ts`, not the 14-line `run-task.ts` wrapper. **Pre-existing** — it was equally wrong before the move (env resolution was in [scripts/run-task/env.ts](scripts/run-task/env.ts), not [scripts/run-task.ts](scripts/run-task.ts)) and the file is declared "contents unchanged," so fixing it is scope creep. Noted because the diff corrected the mirror-image half of this same reference pair at `env.ts:92`.
- `scripts/install-git-hooks.mjs:36-38` — docstring still says the file "ships in the npm tarball via the `files` **glob**"; post-AC-7 it ships via an explicit single-file entry. The concrete risk is real (a maintainer adding a second install-time script trusts the wording, drops it in `scripts/`, it silently doesn't ship, `postinstall` breaks for adopters) but the file is outside this spec's Affected Files, so fixing it needs an amendment. **Follow-up, not this round.**
- Leak-gate coverage gaps, both **pre-existing with zero current exposure**, recorded so a later change doesn't inherit them unexamined. (a) `scripts/sync-canon-templates.mjs:25` gates only `src/orchestrator/`, leaving `src/lib/`, `src/task/`, `src/cli/` ungated — newly relevant because `pipeline-policy.ts` moved into `src/lib/`. Verified no wholesale-synced markdown references `src/lib/pipeline-policy.ts`, and `docs/patterns.md` is explicitly *not* canon-managed (the constant's own comment names it as adopter-visible). (b) `templates/scripts/docs-refs-check.mjs:525` carries a canon-internal ref into a shipped `CANON_OWNED` file; the gate structurally can't see it because it scans only `.md` entries of `WHOLESALE_SYNC`. Harmless today — the adopter's checker only scans markdown — and the pre-change ref was equally absent from adopter repos.

#### Spec Gaps

(none)

The anchored lens classified CB-3 as a spec gap; I'm overriding that. AC-4 is unambiguous about what must be declared and by whom — the spec is right, the artifact is incomplete. That routes to `implement`, not to a human.

### Dismissed Cold Findings

- **Dismissed (cold-Codex): "Type-checking, linting, build, tests, template sync, and docs-reference checks pass" — the tests half does not hold.** Both Claude lenses independently reproduced a failing test and I reproduced it a third time. The likely cause is the same sandbox condition that hid it from the implementer: `gitDirWritable === false` skips `tests/run-task-safety.test.ts:2186` rather than running it. Recording this rather than passing over it — cold-Codex returned **zero findings** on this diff, and per the charter a quiet lens is a failure of the lens, not evidence of a clean diff. Its report supplied no independent signal this round, so cross-family agreement was unavailable and the two Claude lenses carried the review.
- Dismissed (cold-Claude): `docs/task-quality-log.md:115` and `CHANGELOG.md:502,503,636` retain old-path refs — AC-2's permitted-to-remain bucket names those exact files and line numbers as deliberately preserved historical records. Spec evidence, not an oversight.
- Dismissed (cold-Claude): `docs/codebase-map.md:72`'s `check-phase-gate.ts` claim rewrite flagged as an out-of-scope behavioral-documentation change — the spec's Affected Files row for `docs/codebase-map.md` explicitly authorizes it (*"`:72`'s description of `check-phase-gate.ts` as 'called by `canon task phase`' is also stale"*). Verified accurate: `src/task/index.ts:11` imports `checkPhaseGate` from `../orchestrator/validation.js` directly.
- Dismissed (cold-Claude): `env.ts:92` and `metrics.ts:19` flagged as unreviewed semantic edits riding in a mechanical diff — AC-11 authorizes all three corrections by name, with a table in §Decision explaining why each is a correction rather than a swap. Not out of scope. The sub-observation that `env.ts:92` now names a path absent from the installed package is fair but not a defect: the message concerns a legacy env var no longer honored and its remedy is a canon source change, so it is maintainer-directed.
- Dismissed (cold-Claude + anchored): `docs/architecture.md:52-60` is now 77 columns while the two boxes above it remain 64/65 — AC-10's target is stated as "the rest of the box," and the AC itself notes `:53` was *already* misaligned against its own box's rows before this change. Met on the spec's own wording; the diagram-wide normalization was never in scope.
- Dismissed (cold-Claude) as a bug, kept as a nit: `src/orchestrator/main.ts:26` as a module-resolution hazard — it resolves correctly today and is byte-identical to base. The consistency observation survives above.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Scope of this round:** CB-1, CB-2, CB-3, RG-1, RG-2 — five edits across four files, all localized, none touching orchestrator logic. The relocation itself needs no rework. Per the spec's Scope-creep note and `docs/lessons-learned.md`, do not widen beyond the sites named above; the `Optional Cleanup / Nit` items are at your discretion and the two marked "follow-up" require a spec amendment to touch at all.

---

## Round 2 — verifying iteration 1's response to round 1

Iteration 1 landed as commit `786f033`: 4 files, 5 insertions, 5 deletions. Both Claude lenses re-ran from scratch; the foreman re-verified every load-bearing claim independently.

### Verifying Round 1 findings

- _correctness bug (CB-1):_ "linked-worktree regression loaded `env.ts` from the supervising checkout; suite red in a worktree" → **addressed** at `tests/run-task-safety.test.ts:2199` (now `path.join(process.cwd(), 'src/orchestrator/env.ts')`). Verified by execution, and the important part is that **the test actually runs here rather than skipping**: the `gitDirWritable` probe writes to `REPO_ROOT/.git`, which is the supervising checkout's real directory even from a linked worktree, so the guard does not fire locally. Full-suite result below shows `skipped 0`. The assertion kept its meaning — `resolveRepoRoot()` runs `git rev-parse --git-common-dir` in the *child's* cwd (the temp linked worktree), so `assert.equal(result.stdout.trim(), REPO_ROOT)` at `:2205` is unchanged and still non-trivial, and `cwd: REPO_ROOT` at `:2192`/`:2208` is correct-by-intent because worktree add/remove must target the supervising repo. Nothing was weakened to make it pass. ✓
- _correctness bug (CB-2):_ "adopter-leak guard fail-opened and scanned the orchestrator bundle not at all" → **addressed** at `tests/cli.test.ts:3562-3563` (`WORKTREE_ROOT` + a hard existence assertion). The guard now genuinely scans both `dist/cli/index.js` and `dist/orchestrator/run-task.js`. I chased the new failure mode the hard assert introduces and it is **not reachable in any legitimate flow**: `git ls-files dist` returns exactly those two paths, so a fresh clone, `npm ci && npm test` in CI, and a fresh worktree all have them; `npm test` does not build, and CI builds before testing anyway. Matches the sibling convention at `tests/task-cli.test.ts:2560` and `tests/validation-matrix-sync.test.ts:11`. ✓ (residual → N-1)
- _correctness bug (CB-3):_ "undeclared root-resolution mechanism change plus an inaccurate `npm test` row" → **addressed**. The Iteration 2 Changes table declares `tests/run-task-harness.test.ts` with its rationale, naming the loader, inline-import, and subprocess paths as intentional active-checkout resolution. The new `npm test` row reads "1,147 passed, 1 sandbox-conditional skip, 0 failed" — internally consistent at 1,148 total and honestly labelled as environment-conditional rather than asserted as a clean green. That is the correction the finding asked for. ✓
- _risk/guardrail (RG-1):_ "the authorized comment edit used the grep-invisible file-relative form" → **addressed** at `src/orchestrator/agents/stream.ts:39` (now `src/orchestrator/signals.ts`). No lint rule fires (`eslint.config.mjs` has no `max-len`). The consequence check matters more than the edit and it is clean — see the bundle note below. ✓
- _risk/guardrail (RG-2):_ "the swept path preserved a packaging claim AC-7 made false" → **addressed** at `docs/BACKLOG.md:588`, now "they are internal source files bundled into `dist/orchestrator/run-task.js`, not separate entries in the npm package." I verified the replacement is *true* rather than merely different: `package.json` `files` is `["dist/","templates/","scripts/install-git-hooks.mjs","CHANGELOG.md"]` with no `src/`, the pack manifest has zero `src/` and zero `prompts/templates` entries, and a prose phrase from `src/orchestrator/prompts/templates/spec-review.md` is present inside the built bundle — so the templates do reach adopters inlined, exactly as the new wording says. ✓
- _optional cleanup/nit:_ all deferred, as the round-1 scope note permitted. Correct call.

**Bundle-sync check (the one claim worth spelling out).** `786f033` edits a source file inside the tsup entry graph but does **not** commit `dist/`. That looks like a stale bundle, so I checked it directly rather than trusting either the handoff or a lens: tsup strips module-body comments (a distinctive phrase from that comment block returns **0** hits in the bundle), so a comment-only source edit produces no bundle delta and `dist/` correctly needed no re-commit. `npm run build && git diff --exit-code -- dist/` exits 0 — CI's exact gate. The handoff's "produced no additional bundle-byte delta" is precisely right.

> Correcting one lens on the evidence, since it points the opposite way on a question that matters: cold-Claude reported the bundle *does* carry the comment fix (`grep -c 'src/orchestrator/signals.ts'` → 1) and concluded the bundle was regenerated. That match is tsup's module banner `// src/orchestrator/signals.ts` at bundle line 3, which has been present since `9c36c98`, not the edited comment. Right conclusion — bundle in sync — reached from the wrong evidence. The distinction is load-bearing: "the bundle was regenerated and committed" and "the bundle correctly needed no change" look identical at the gate but only one of them is true here.

### Stage 1 — Acceptance Criteria Re-Check

Re-filled against the current tree. `delicate: true`, so round 1's table is not reusable proof; ACs marked unchanged carry an evidence pointer verified this round.

| AC | Status | Notes |
|---|---|---|
| AC-1: nothing remains at the old location | Met | `ls scripts/` = exactly the 6 tooling files; all three retired source paths and the retired bundle directory absent; `dist/` top level = `cli`, `orchestrator` |
| AC-2: zero-result reference gate, 4 string families | Met | All four families re-run with the spec's exclusions → 0 / 0 / 0 / 0. `src/cli/commands/stop.ts` cumulative diff is 3 import specifiers only; the `:32` regex comment is untouched |
| AC-3: `dist/` behaviorally identical, depth invariant holds | Met (re-verified from scratch) | `npm run build && git diff --exit-code -- dist/` → exit 0, run by me. `path.resolve(__dirname, '../..')` unchanged at `src/orchestrator/env.ts:55`; both source and bundle remain 2 segments deep; bundle `--help` exit 0 |
| AC-4: tests pass with imports-and-paths-only edits | **Met** (was Fail) | **1148 tests / 1148 pass / 0 fail / 0 skipped, exit 0** — run by me, and independently by both lenses. Iteration 1's two test edits are non-path (root-resolution mechanism; fail-open → fail-closed) and **both are explicitly named with justification** in the Iteration 2 Changes table — which is the clause AC-4 requires and CB-3 enforced |
| AC-5: leak gate keeps coverage and can't lose it silently | Met (unchanged) | `CANON_INTERNAL_PATH_PREFIXES = ['src/orchestrator/']`; dir scan resolves to `src/orchestrator/prompts/templates/`; the non-empty + exact-8 assertion at `tests/sync-canon-templates.test.ts:71` passed in this round's run; `sync-templates:check` clean |
| AC-6: runtime spawn bridge resolves | Met (unchanged) | `src/cli/commands/run-task.ts:8` → `dist/orchestrator/run-task.js`; `node dist/cli/index.js run --help` reaches orchestrator usage, exit 0 |
| AC-7: published package contents correct | Met (re-verified from scratch) | `npm pack --dry-run --json`: 40 files, `scripts/` = exactly one entry, zero `src/`, zero raw orchestrator TypeScript. One lens additionally packed the tarball and ran `postinstall` plus both bundles out of the extracted layout — all exit 0 |
| AC-8: gated doc surfaces correct | Met (re-verified from scratch) | `npm run docs-refs-check` → "All refs OK", including the repaired `review.md`, which is **not** exempt |
| AC-9: two doc passages rewritten, not path-swapped | Met (unchanged) | `docs/architecture.md` Full-build row collapses to `src/**` and names both new dist artifacts; `docs/decisions.md:181` discriminates by path specificity and says why bare `src/` stays unblocked |
| AC-10: ASCII diagram re-aligned | Met (unchanged) | Display width (not byte count) of `docs/architecture.md:52-60` = 77 on all 9 rows, borders aligned |
| AC-11: three already-wrong references corrected | Met (unchanged) | `metrics.ts:19` still byte-matches `docs/pipeline-invocations.md:3` after this round's telemetry append (header untouched); `env.ts:92` names the policy module; `.canon/hooks/README.md` names `src/orchestrator/main.ts` |
| AC-12: BACKLOG swept, migration entry closed | Met (re-verified; RG-2's edit lives here) | Family-1 grep → 0; `docs/BACKLOG.md:556` is `[x]` with a task pointer; `:588`'s claim is now true. The round-1 "for v2.7.0" nit remains, deferred as declared |
| AC-13: canon-managed mirror regenerated and declared | Met (unchanged) | `sync-templates:check` clean; declared in both spec and handoff |
| AC-14: all three path-reconciliation gates clear | Met (re-verified from scratch) | Gate 1: iteration-1 auto-commit produced `786f033` with no abort. Gate 2: round 2 opened and all 5 Iteration-2 declared paths are present in the cumulative diff. Gate 3: `parseAffectedFilesFromSpec` → `malformed: []`, 145 files, **0 unauthorized paths** out of 155 cumulative diff paths |
| AC-15: policy importers re-pointed, no parent specifier survives | Met (unchanged) | Zero old specifiers in `src/orchestrator/**`; exactly 3 new ones (`policy.ts:13`, `quality-log.ts:4`, `types.ts:10`); `src/task/index.ts` is the expected 4th repo-wide; `type-check` clean |

**Validation gate:** `lint` Pass · `type-check` Pass · `npm test` Pass (1148/1148, 0 skipped) · `build` + reproducible `dist/` Pass · `docs-refs-check` Pass · `sync-templates:check` Pass · both bundle entry points exit 0. No `Fail` rows and no unrun required check. The Iteration 2 table omits `sync-templates:check`; that is defensible for a table scoped to re-run checks (the revision touched no `CANON_OWNED` file) and I ran it anyway — clean.

**Scope containment:** confirmed no creep. `786f033` is exactly the 4 files this review named. The two sites round 1 marked **leave — out of scope** were left alone. `REPO_ROOT` is still imported and used in `tests/cli.test.ts`, so no unused-import lint error. `docs/pipeline-invocations.md`'s working-tree modification is append-only orchestrator telemetry (registered in `PIPELINE_TELEMETRY_FILES`), not an artifact edit.

**Delicate re-audit:** every mutation chokepoint is still a byte-identical rename in the cumulative `-M` diff — `validation.ts`, `git.ts`, `state.ts`, `worktree.ts`, `review-loop.ts`, and `src/lib/pipeline-policy.ts` are all R100; `main.ts` R099 and `agents/stream.ts` R098 carry comment-only bodies. Iteration 1 touched no guard.

### Stage 2 — New findings

Nothing in iteration 1 introduced a defect. What both lenses surfaced instead is the **same bug class recurring at new locations** — `REPO_ROOT` (supervising checkout) used in test code where the active checkout is meant. Cold-Claude enumerated the full surface: `tests/cli.test.ts:3490` and `:3555`, `tests/run-task-signals.test.ts:14,15`, `tests/run-task-canon-snapshot.test.ts:436`, plus a four-way naming split across the suite (`REPO_ROOT` / raw `process.cwd()` / `WORKTREE_ROOT` / `WORKSPACE_ROOT` / `CHECKOUT_ROOT`).

**Every one of those sites is byte-identical to `origin/main`.** This task introduced none of them; it improved two and left the rest untouched exactly as round 1 directed.

#### Optional Cleanup / Nit

- **N-1 — `tests/cli.test.ts:3555`: the leak guard is half-migrated.** *(flagged by 2 lenses)* The scan target moved to `WORKTREE_ROOT` (CB-2) but the fixture load seven lines above still reads `tests/fixtures/canon-dev-tokens.json` from `REPO_ROOT`, so the branch's artifacts are checked against the supervising checkout's banned-token list. Latent, not live: I diffed both fixture copies and they are byte-identical today. The failure shape is a future task that rotates `active_release_branch` or adds a token, then runs tests in a worktree — the new token is absent from `banned` and a leak of it passes green. Real, and one word to fix. **Not an implementer miss**: round 1's "definitive site list" did not enumerate `:3555` and explicitly said *"Do not widen past the first three rows."* The implementer did precisely what was asked. That omission is mine.
- **N-2 — the wrong-root class is a repo-wide problem, and it belongs in one follow-up task, not a fourth patch round.** Round 1 raised three sites; round 2 surfaces four more. Per this review's own governing rule — *a cross-cutting invariant belongs in one shared helper, not patched per call site; at ≥3 sites, extract the shared helper and route all sites through it* — continuing to patch site-by-site inside a relocation task is the wrong mechanism, and it would be the third consecutive round narrowing on the same root, the pattern the spec's AC-2 note and `docs/lessons-learned.md` both flag as a design signal rather than an iteration signal. The canonical form already exists in-repo and documents its own rationale: `tests/run-task-signals.test.ts:23-27` derives the checkout root from `import.meta.url`, which is both cwd-independent and worktree-correct — strictly better than `process.cwd()`, which round 1 prescribed and which breaks if the runner is invoked from a subdirectory. **Recommended follow-up:** one task that normalizes test-root resolution to a single named constant on that pattern and routes all sites through it, sweeping `:3490`, `:3555`, `run-task-signals.test.ts:14,15`, and `run-task-canon-snapshot.test.ts:436`.
- **N-3 — `tests/run-task-safety.test.ts:2170-2173`: the skip-guard comment is factually wrong**, claiming the probe skips when "running from inside a linked worktree (`.git` is a file, not a dir)". It does not — the probe targets `REPO_ROOT/.git`, which is the supervising checkout's real directory, which is exactly why this test ran (and in round 1, failed) here. Byte-identical to base, so pre-existing. Worth naming because that wrong comment is part of why CB-1 read as environmentally-skipped for a round.
- **N-4 — canon-product gap: the review template carries no old-path token-form rule.** The handoff template spells out the "Deleting a file?" rule; the review template and the code-review prompt say nothing, even though `docs-refs-check` scans `handoff.md` and `review.md` identically (`isNoisySourceFile()` exempts only spec/plan/notes/spec-review under `tasks/<id>/`). **This bit me in round 1**: I wrote backticked refs to paths this task deleted, which broke `docs-refs-check` and several subprocess test cases, and the implementer had to repair the reviewer's own artifact to get a green run. I verified that repair myself — all five findings and the verdict survive unaltered, and the edit is confined to four deleted-path refs converted to markdown-link form — but canon has no mechanism that *proves* a reviewer artifact was not altered in substance, and every rename-heavy task will reproduce this. Worth filing against the review template and the foreman prompt, not against this task.
- Carried forward from round 1, unchanged and still deferred: `docs/BACKLOG.md:556`'s "for v2.7.0" attribution (2.7.0 is already cut), `:557-563`'s open-proposal tense under a checked entry, `src/orchestrator/main.ts:26`'s non-normalized cross-tree specifier, `src/lib/pipeline-policy.ts:3,8`'s pre-existing stale back-references, `scripts/install-git-hooks.mjs:36-38`'s "`files` glob" docstring, and the two leak-gate coverage gaps. All out-of-manifest or explicitly pre-existing.

#### Correctness Bugs

(none)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the bundle carries iteration 1's comment fix, evidencing a regenerated bundle — the grep matched tsup's module banner, present since `9c36c98`, not the edited comment. Module-body comments are stripped. Conclusion right, evidence wrong; see the bundle-sync note above.
- Dismissed (cold-Claude): `CHANGELOG.md:5` `## [Unreleased]` is empty despite a user-visible bundle-path change — canon-ai cuts changelog entries at the release step (`/canon-changelog` plus human), never per task; QA proposes entry text only, and `done.md` carries a Proposed Changelog section. Repo convention, not an omission. The lens itself rated confidence low on the convention question.
- Dismissed (cold-Claude): `templates/docs/pipeline-orchestrator.md:288` still lists `scripts/` as a project-level resource — that is adopter-generic wording about the *adopter's* `scripts/`, and the file is a `CANON_OWNED` shipped doc. Rewriting it to match canon-ai's internal layout is precisely the leak the canon-internal gate exists to prevent, so leaving it is correct, not an oversight.
- Dismissed (cold-Claude): `scripts/install-git-hooks.mjs:37` rated a *correctness bug* — the comment is stale but has no runtime effect and the file is outside this spec's Affected Files. Retained as a nit at its real severity, as in round 1.
- Dismissed (cold-Claude): `docs/codebase-map.md` semantic edits and the `metrics.ts:19` header rewording flagged again as non-mechanical changes riding in a relocation — the spec authorizes both by name (AC-11 and the `docs/codebase-map.md` Affected Files row). Same spec evidence as round 1; the lens is spec-blind by design, so re-flagging is expected rather than a lens error.
- Dismissed (cold-Claude): `scripts/sync-canon-templates.mjs:25` widened to also match the orchestrator entry file, which the retired prefix did not — that is *more* protective and consistent with the gate's stated intent, and `sync-templates:check` passes. The companion observation that `src/lib/pipeline-policy.ts` stays uncovered is a pre-existing gap with verified zero current exposure; carried as a nit.
- Dismissed (cold-Claude): `.github/workflows/ci.yml:125`'s smoke does not assert the adopter-facing `templates/scripts/*` scaffold lands — a real pre-existing coverage gap, verified not broken by this task (the pack manifest lists all three files and both `init` and `upgrade` read only from `templates/`). Follow-up, not this task.
- Dismissed (cold-Codex): "Type-checking, linting, tests, build, template sync, and docs-reference validation all pass" — this round the claim **holds**, and I confirmed every element of it independently. Recording it as dismissed only because cold-Codex again returned **zero findings**, so it contributed no independent signal for a second round; per the charter a quiet lens is a failure of the lens, not evidence of a clean diff. Cross-family disagreement was therefore unavailable again, and the two Claude lenses carried this review. Note the specific reason it was blind in round 1 — its sandbox skips the `.git`-writing test — no longer applies here, since that test now passes on its merits.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

**Why not `approved`:** N-1 is a genuine latent fail-open in a function iteration 1 just edited, and two lenses flagged it. It should not ship unrecorded.

**Why not `changes_requested`:** all 15 ACs are met with the strictest gates re-run from scratch, the suite is fully green with zero skips, `dist/` is reproducible, and every Round 1 finding is closed and verified by execution rather than by reading the handoff. Every remaining site of the recurring wrong-root class is byte-identical to base — this task introduced none of them. Sending back a fourth per-site patch would be the third consecutive round narrowing on one root, against both the spec's explicit scope cap and this review's own ≥3-sites rule. The right mechanism is N-2's follow-up task, and `approved_with_nits` is what leaves that call with the operator.

**If anything else forces another iteration,** take N-1's one-word fix opportunistically — but it does not justify a round on its own.
