# Plan: relocate-orchestrator-to-src

> Spec: `tasks/relocate-orchestrator-to-src/spec.md` | Review verdict: `approved_with_nits`

## Nit disposition

Spec-review's one nit (bare `run-task/signals.ts` comment refs at `scripts/run-task.ts:3` and `scripts/run-task/agents/stream.ts:39` evading the `scripts/run-task`-prefixed AC-2 search) is **already folded into `spec.md`** — AC-2 family 4 and the Affected Files rows for both files were corrected in round 2 to cover exactly this. No extra plan step needed beyond what AC-2/Affected Files already require; Step 3 and Step 4 below implement it.

## Sequencing principle

Do this as one continuous pass, in the order below — not "move a few files, test, move more." The tree only re-resolves once every importer is repointed, so any intermediate checkpoint fails `type-check`/`build`. Run validation only at Step 10, after every file listed in the spec's Affected Files has been touched.

Use `git mv` for every relocation (never delete+recreate) — canon's rename-detection gates (AC-14) depend on git reporting these as `R` porcelain/diff entries, and `git mv` is what makes that reliable.

---

## Step 1 — Move the three source roots

`src/orchestrator/` does not exist yet, so the whole 44-file tree moves as one directory rename — git preserves the internal structure (`agents/`, `phases/`, `prompts/`, `prompts/templates/`) automatically:

```bash
git mv scripts/run-task src/orchestrator
git mv scripts/run-task.ts src/orchestrator/run-task.ts
git mv scripts/pipeline-policy.ts src/lib/pipeline-policy.ts
```

Verify: `find src/orchestrator -type f | wc -l` → 44 (before adding the entry file, which brings it to 45 files in the directory, matching the moved-tree table plus the entry-point row). `ls scripts/` should now show only: `docs-refs-check.mjs`, `docs-refs-check.mjs.d.ts`, `docs-refs-config.mjs`, `install-git-hooks.mjs`, `normalize-dist-paths.mjs`, `sync-canon-templates.mjs` (AC-1).

---

## Step 2 — Re-point the three `pipeline-policy` importers (the easy misses)

Two of these are `import type` — a miss here produces no runtime symptom, no `dist/` diff, and no test failure; only `npm run type-check` catches it. Do this immediately after Step 1, before anything else, so you don't lose track of which of the three you've done.

- `src/orchestrator/policy.ts:13` — `} from '../pipeline-policy.js';` → `} from '../lib/pipeline-policy.js';`
- `src/orchestrator/types.ts:10` — `} from '../pipeline-policy.js';` → `} from '../lib/pipeline-policy.js';`
- `src/orchestrator/quality-log.ts:4` — `import type { TaskSize } from '../pipeline-policy.js';` → `import type { TaskSize } from '../lib/pipeline-policy.js';`

Verify (AC-15): `grep -rn "'\.\./pipeline-policy\.js'" src/orchestrator` returns zero hits. `grep -rn "'\.\./lib/pipeline-policy\.js'" src/orchestrator` returns exactly the three lines above.

---

## Step 3 — Re-point the `src/task` imports inside the moved `phases/` files

Relative depth drops one level now that the tree sits under `src/` instead of `scripts/`:

- `src/orchestrator/phases/code-review.ts` — `'../../../src/task/index.js'` → `'../../task/index.js'`
- `src/orchestrator/phases/implement.ts` — same re-point
- `src/orchestrator/phases/plan.ts` — same re-point
- `src/orchestrator/phases/qa.ts` — same re-point
- `src/orchestrator/phases/spec-review.ts` — same re-point
- `src/orchestrator/phases/spec.ts` — same re-point

Sibling imports inside the moved tree (`./cli.js`, `./types.js`, etc.) are untouched — the tree moved as a unit, so same-directory specifiers still resolve.

---

## Step 4 — Fix the entry point's own imports and the AC-2/AC-11 comment corrections

`src/orchestrator/run-task.ts` (was `scripts/run-task.ts`, now moved inside its own module directory):
- `:5` `import './run-task/signals.js';` → `import './signals.js';`
- `:8` `import { main } from './run-task/main.js';` → `import { main } from './main.js';`
- `:3` comment naming bare `run-task/signals.ts` → correct to a same-directory reference (`signals.ts`)

`src/orchestrator/agents/stream.ts:39` — the signal-isolation comment `(see run-task/signals.ts)` → correct post-move reference (this file's Affected Files row was corrected during spec review from "unchanged" to "changes" — don't skip it).

Other comment-only fixes in the moved tree, per Affected Files:
- `src/orchestrator/detach.ts:1` — header comment `// scripts/run-task/detach.ts` → `// src/orchestrator/detach.ts`
- `src/orchestrator/heartbeat.ts:1` — header comment `// scripts/run-task/heartbeat.ts` → `// src/orchestrator/heartbeat.ts`
- `src/orchestrator/signals.ts:3,4` — two comment refs to `scripts/run-task.ts` and `scripts/run-task/main.ts` → `src/orchestrator/run-task.ts` / `src/orchestrator/main.ts`
- `src/orchestrator/main.ts:2933,3457,3506,3623` — four comment refs to `scripts/run-task/validation.ts`, `scripts/run-task/heartbeat.ts`, `scripts/run-task/cli.ts`, `scripts/run-task/detach.ts` → their `src/orchestrator/` equivalents
- `src/orchestrator/agents/codex.ts:24` — `invalidCodexEffortMessage()`'s operator-facing string `scripts/pipeline-policy.ts` → `src/lib/pipeline-policy.ts` (this is a CLI stderr string, not agent prompt text — no Non-Goal conflict)
- `src/orchestrator/env.ts:92` — stderr string `Update the matrix in scripts/run-task.ts` → `Update the matrix in src/lib/pipeline-policy.ts` (AC-11: this reference was already factually wrong before the move — the matrix lives in the policy module, not the entry file — fix the *target*, don't just swap the path)
- `src/orchestrator/metrics.ts:19` — emitted doc header `Auto-logged by \`scripts/run-task.ts\`.` → `Auto-logged by canon's orchestrator.` (AC-11: match the live header already in `docs/pipeline-invocations.md:3`, don't just rename the stale one)

Confirm `resolveRepoRoot()` in `src/orchestrator/env.ts` — the `path.resolve(__dirname, '../..')` expression itself is **unchanged**. Do not touch it; the two-segment depth (`src/orchestrator/` → repo root, `dist/orchestrator/` → package root) is what makes it still correct (AC-3).

---

## Step 5 — Build and packaging config

- `tsup.config.ts` — entry key `'scripts/run-task': 'scripts/run-task.ts'` → `'orchestrator/run-task': 'src/orchestrator/run-task.ts'`
- `tsconfig.json` — `include` array: drop `"scripts/**/*.ts"` (nothing remains there); **keep** `"scripts/**/*.d.ts"` (covers `scripts/docs-refs-check.mjs.d.ts`, the one file still linted under `scripts/` per the Non-Goal)
- `package.json` — `files` array: `"scripts/"` → `"scripts/install-git-hooks.mjs"` (it's the `postinstall` entry; nothing else under `scripts/` is read at adopter runtime). Do not touch the `lint` script (Non-Goal — `eslint.config.mjs` ignores `scripts/*.mjs` but not `.d.ts`, so the `scripts/` argument stays)

---

## Step 6 — Runtime spawn bridge

`src/cli/commands/run-task.ts:8` — `join(packageDir, 'dist/scripts/run-task.js')` → `join(packageDir, 'dist/orchestrator/run-task.js')`.

This has no compile-time signal if wrong — it's a string join, not an import — and it breaks `canon run` for every installed adopter. Don't consider this done until you've executed it (see AC-6 in Step 10), not just edited it.

---

## Step 7 — Importers outside the moved tree

`src/task/index.ts` — 8 import specifiers:
```
'../../scripts/run-task/canon-snapshot.js'   → '../orchestrator/canon-snapshot.js'
'../../scripts/run-task/quality-log.js'      → '../orchestrator/quality-log.js'
'../../scripts/run-task/validation.js'       → '../orchestrator/validation.js'
'../../scripts/run-task/git.js'              → '../orchestrator/git.js'
'../../scripts/run-task/state.js'            → '../orchestrator/state.js'
'../../scripts/run-task/worktree.js'         → '../orchestrator/worktree.js'
'../../scripts/run-task/types.js'            → '../orchestrator/types.js'
'../../scripts/pipeline-policy.js'           → '../lib/pipeline-policy.js'
```
(Depth drops from `../../scripts/...` to `../orchestrator/...` because `src/task/` and `src/orchestrator/` are now siblings.)

`src/cli/commands/doctor.ts` — 4 imports (`heartbeat.js`, `quality-log.js`, `run-context.js`, `types.js`), all `'../../../scripts/run-task/X.js'` → `'../../orchestrator/X.js'` (depth drops one level: `src/cli/commands/` → `src/orchestrator/` is now two `../` instead of three). Also fix the two comments at `:649,650` referencing `scripts/run-task/types.ts` and `scripts/run-task/phases/<phase>.ts`.

`src/cli/commands/watch.ts` — 5 imports (`detach.js`, `heartbeat.js`, `run-context.js`, `state.js`, `types.js`), same depth-drop re-point.

`src/cli/commands/stop.ts` — 2 imports (`detach.js`, `heartbeat.js`, `run-context.js` — 3 total per grep) same depth-drop re-point. **Do not touch `:32`** — the comment there (`` /canon-ai|run-task/ ``) is a regex fragment describing a process-matching pattern, not a path; it's the one deliberate false positive in AC-2 family 4 and must stay byte-for-byte unchanged.

`src/cli/commands/update.ts` — 1 import (`canon-snapshot.js`), same depth-drop re-point.

Verify: `npm run type-check` will fail loudly on any missed specifier here (unlike the `import type` cases in Step 2, none of these five files' imports are type-only, so misses would also show up in `dist/`).

---

## Step 8 — Gates and tooling

`scripts/sync-canon-templates.mjs` (AC-5 — **behavioral**, not cosmetic):
- `:25` — `export const CANON_INTERNAL_PATH_PREFIXES = ['scripts/run-task/'];` → `['src/orchestrator/']`
- `:42` — `readMarkdownBasenames(join(CANON_AI_ROOT, 'scripts/run-task/prompts/templates'))` → `join(CANON_AI_ROOT, 'src/orchestrator/prompts/templates')`
- Comment refs at `:79,86,107,316` → update to `src/orchestrator/...` equivalents

`scripts/docs-refs-check.mjs:525` — comment ref to `scripts/run-task/git.ts:filterGitIgnoredPaths` → `src/orchestrator/git.ts`. This file is `CANON_OWNED`; after editing it, regenerate `templates/scripts/docs-refs-check.mjs` (Step 11 covers the mechanism — the pre-commit sync hook does this automatically, but confirm it happened before closing `implement`; AC-13).

`scripts/normalize-dist-paths.mjs:7` — comment ref `scripts/run-task/worktree.ts:147` is *already* wrong today (the symlink logic has since moved to ~`:265`) — fix both the path and the stale line number: `src/orchestrator/worktree.ts:265` (or whatever the current line is after the move — re-check, don't transcribe blindly).

---

## Step 9 — Tests (imports/paths only — AC-4)

Mechanical import/path-string updates, same depth-drop pattern as Step 7, across:

`tests/run-task-safety.test.ts` (~110 lines — **highest risk**: most refs are inside string literals written out as subprocess fixture files, invisible to the compiler if you get one wrong — grep the file for every `scripts/run-task` and `scripts/pipeline-policy` occurrence rather than relying on the type-checker to catch misses), `tests/run-task-validation.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-harness.test.ts`, `tests/sync-canon-templates.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-canon-snapshot.test.ts`, `tests/cli.test.ts`, `tests/run-task-counter-schema.test.ts`, `tests/run-task-parse-porcelain.test.ts`, `tests/task-cli.test.ts`, `tests/watch.test.ts`, `tests/detach.test.ts`, `tests/md-loader-register.mjs`, `tests/pipeline-policy.test.ts`, `tests/run-task-quality-log.test.ts`, `tests/heartbeat.test.ts`, `tests/markdown-table.test.ts`, `tests/run-context.test.ts`, `tests/run-task-cli.test.ts`, `tests/run-task-extract-verdict.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/stop.test.ts`, `tests/validation-matrix-sync.test.ts`, `tests/run-task-signals.test.ts`.

Specific, non-mechanical items inside that sweep:

- **`tests/run-task-signals.test.ts:123-126`** — the structural guard's string literals `'./run-task/signals.js'` / `'./run-task/main.js'` must become `'./signals.js'` / `'./main.js'` to match Step 4's actual edit to `run-task.ts`. This is the same file as AC-2 family 4 — if you leave these stale, the guard silently stops guarding anything (it'll `indexOf` a substring that no longer exists in the source and both indices come back `-1`, but the `<` comparison on two `-1`s still "passes"). Also fix the two unquoted assertion-message strings at `:125,126`.
- **`tests/cli.test.ts:3544`** and **`tests/task-cli.test.ts:2560`** — hardcoded `dist/scripts/run-task.js` bundle path → `dist/orchestrator/run-task.js`. `task-cli.test.ts`'s error message (`'run npm run build before npm test so dist/scripts/run-task.js exists'`) also needs its embedded path string updated, not just the `path.join` call.
- **`tests/validation-matrix-sync.test.ts:7`** — `IMPLEMENT_MATRIX_PATH` hardcodes `'scripts/run-task/prompts/templates/implement.md'` → `'src/orchestrator/prompts/templates/implement.md'`. This test hard-fails (file-not-found) if missed — a loud, immediate signal, but confirm it explicitly rather than assuming `npm test`'s green exit covers it.
- **`tests/run-task-canon-snapshot.test.ts:197,218,238,290,314`** — `canonSourcePath` fixture values end in `.../dist/scripts` (an adopter-install-path fixture, not a real code path). Update to `.../dist/orchestrator` for AC-2 family 3's zero-result gate. `isInstalledSourcePath` keys on `node_modules`/`_npx` substrings elsewhere in the path, not this suffix, so this edit is behavior-neutral for the test itself.

**New test required (AC-5)**: add a test to `tests/sync-canon-templates.test.ts` asserting `INTERNAL_ONLY_TEMPLATE_BASENAMES` is non-empty and contains the verified 8-member baseline: `code-review-foreman.md`, `implement-reroute.md`, `implement-revisions.md`, `implement.md`, `plan-reroute.md`, `qa.md`, `spec-review-reroute.md`, `spec-revision.md`. Follow the existing import pattern at the top of that file (it already imports `INTERNAL_ONLY_TEMPLATE_BASENAMES` per the file's line 13/20 — reuse that binding, don't re-derive it). This is the one test *body* change permitted by AC-4; every other test edit in this step must be import/path-only.

**Do not regenerate `tests/run-task-prompts.golden.json`** unless a diff actually appears — it's insulated by `CANON_PATTERNS_MD_PATH` pointing at a stub fixture and contains zero `scripts/`/`run-task`/`pipeline-policy`/`src/` strings today. Run the suite and check; don't pre-emptively touch it.

---

## Step 10 — Docs sweep

Do this after the code move so you're updating docs against the final, correct paths — not guessing ahead of implementation.

**Mechanical path-swap docs** (no rewording, just `scripts/run-task/` → `src/orchestrator/` and `scripts/pipeline-policy.ts` → `src/lib/pipeline-policy.ts` in each backticked ref):
- `docs/product-context.md` — 5 refs (delicate-surfaces list at `:82,88,97,100,101`)
- `docs/harness-audit-2026-06.md` — 2 refs (`:56,115`)
- `README.md` — 2 refs (`:285` bundle path → `dist/orchestrator/run-task.js`; `:289` prompt-templates path)
- `.canon/hooks/README.md` — 2 refs, but **retarget to `main.ts`, not the entry file** (AC-11): `:3` "The orchestrator (`scripts/run-task.ts`) checks for these files" is wrong today — hook dispatch lives in `main.ts` → correct to `` The orchestrator (`src/orchestrator/main.ts`) checks for these files ``. Same correction at `:39`, "The set of hooks the orchestrator checks is defined in `scripts/run-task.ts`" → `src/orchestrator/main.ts`.

**`docs/codebase-map.md`** (45 ref lines — mostly mechanical, three spots need authored correction):
- 43 of the 45 lines are straight path swaps in the module-inventory table.
- `:72` — "Phase gate validator | `scripts/run-task/check-phase-gate.ts` | CLI wrapper around `checkPhaseGate()`; **called by `canon task phase`**" — the "called by" clause is stale *today*, independent of this move: `checkPhaseGate()` is called in-process by `src/task/index.ts:443`, and `check-phase-gate.ts` itself is a zero-importer manual-use CLI wrapper (its own header comment says so). Reword to something like "manual-use CLI wrapper; `canon task phase` calls `checkPhaseGate()` in `src/orchestrator/validation.ts` directly" — don't just swap the path and leave the wrong claim.
- `:135` and `:145` describe the `scripts/`-vs-`src/` split itself and need rewriting, not path-swapping, since the split's premise (orchestrator lives outside `src/`) no longer holds. `:145` in particular currently claims `tsconfig.json` covers "`scripts/` and `tests/` only" — already wrong today (it also covers `src/`) — fix both the staleness and the post-move reality in one edit: something like "`src/`, `tests/`, and the remaining `scripts/*.mjs`/`.d.ts` tooling."

**`docs/patterns.md`** — 35 ref lines across the Trigger Table, all five pattern sections (Pure Policy + Test Discipline, Phase Addition Discipline, State Schema Discipline, Validation Gate Discipline, Lint & Type Safety Policy), and the Known Pitfalls section. All are mechanical path-swaps (`scripts/run-task/main.ts` → `src/orchestrator/main.ts`, `scripts/pipeline-policy.ts` → `src/lib/pipeline-policy.ts`, etc.) — the pattern descriptions themselves don't change, only the file references inside them.

**`docs/decisions.md`** — 11 ref lines; 9 are mechanical, 2 need authored rewriting (AC-9):
- `:37,115,119,177,193,246,257,313,397` — mechanical path swaps.
- `:175` — "the orchestrator source under `scripts/run-task/**`, canon's CLI source under `src/**`" — collapses: post-move the orchestrator *is* under `src/**`, so listing both as disjoint reads as self-contradictory. Rewrite to name the orchestrator's specific subtree instead of trying to separate it from `src/**`, e.g.: "the orchestrator source under `src/orchestrator/**`, canon's CLI source under `src/**` more broadly, or the per-phase prompt templates under `src/orchestrator/prompts/templates/`."
- `:181` — "(1) path refs under `scripts/run-task/` ... It deliberately does **not** blanket-block bare `src/` or `scripts/` path refs" — post-move, both the blocked prefix and the not-blocked bare root share the `src/` top level. Reword to make explicit that the gate discriminates by **path specificity** (a named two-segment subtree like `src/orchestrator/`), not by top-level directory name — e.g.: "path refs under the specific subtree `src/orchestrator/` (the orchestrator tree, including its prompt templates) ... It deliberately does not blanket-block the bare `src/` root: that directory name is ambiguous — adopters have their own `src/` — while `src/orchestrator/` is an unambiguous two-segment prefix that only ever refers to canon's own internals, exactly as `scripts/run-task/` was before the move." Keep the underlying decision (specific-subtree blocking, bare-root not blocked) intact — only the framing needs to change.

**`docs/architecture.md`** — 5 refs, 2 need authored work (AC-9, AC-10):
- `:139` (Full build row) — "changes to `src/**`, `scripts/run-task.ts`, `scripts/run-task/**`, `scripts/pipeline-policy.ts`" collapses to just `src/**` (post-move, the other three are subsets of it). Also update the row's two named `dist/` artifacts to `dist/cli/index.js` and `dist/orchestrator/run-task.js`.
- `:53` (ASCII diagram) — `Orchestrator (scripts/run-task/main.ts via scripts/run-task.ts)` → `Orchestrator (src/orchestrator/main.ts via src/orchestrator/run-task.ts)`. This replacement is **9 characters longer** (24→24 for the first path, 19→28 for the second), and the row is *already* misaligned against its box siblings today — measure a sibling row's width and re-pad this row's trailing spaces so the right `│` lines up with the rest of the box, rather than preserving today's (already-wrong) width.
- Remaining 3 refs (in the surrounding Validation table prose) are mechanical.

**`docs/BACKLOG.md`** — sweep all ~115 ref lines to new paths (BACKLOG is exempt from `docs-refs-check`, so nothing gates this mechanically — do it anyway per AC-12, since stale paths there mislead future readers). Then mark the migration entry at `:556-564` ("Migrate `scripts/run-task/` → `src/`...") done, with a pointer to this task (e.g. `relocate-orchestrator-to-src`, shipped in <version>). Leave the entry's prose intact as a historical record of the tradeoff discussion; just close it out, don't delete it.

**Do not touch**: `CHANGELOG.md:502,503,636` and `docs/task-quality-log.md:73,115` (Non-Goal — historical records, describe what was true when written).

---

## Step 11 — CI and PR template

- `.github/workflows/ci.yml:110` — `node "$(npm root -g)/canon-ai/dist/scripts/run-task.js" --help` → `dist/orchestrator/run-task.js`
- `.github/pull_request_template.md:11` — `` `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed) `` → drop the now-redundant `scripts/run-task/` clause since it's covered by `src/`: `` `npm run build` (rebuild + commit `dist/` if `src/` changed) ``

---

## Step 12 — Build and regenerate generated artifacts

```bash
npm run build
```
This rewrites `dist/cli/index.js` (embedded source-path comments change) and produces `dist/orchestrator/run-task.js`, replacing `dist/scripts/run-task.js`. Confirm `dist/scripts/` no longer exists after the build (the `clean: true` tsup option should remove it, but verify — AC-1 requires no `dist/scripts/` directory).

`templates/scripts/docs-refs-check.mjs` — the pre-commit hook regenerates this mirror automatically from the `scripts/docs-refs-check.mjs` edit in Step 8. **Before closing this phase, run `git status` and confirm it actually regenerated** — per the "editing managed docs inside a worktree-isolated task" pitfall in `docs/patterns.md`, don't assume; verify. If it didn't fire (e.g., committing via a path that skips hooks), run `npm run sync-templates` explicitly.

---

## Step 13 — Full validation, in order

Run these in sequence — an early failure here is cheaper to fix than one caught by a pipeline gate three steps later:

```bash
npm run lint
npm run type-check
npm test
npm run build            # already run in Step 12; re-run to confirm idempotence if anything changed after
npm run sync-templates:check
npm run docs-refs-check
```

Manual checks (not covered by any npm script):

```bash
node dist/orchestrator/run-task.js --help          # AC-3: succeeds, same usage text as pre-move dist/scripts/run-task.js
npm pack --dry-run | grep '^scripts/'              # AC-7: exactly one line, scripts/install-git-hooks.mjs
```

For AC-6 (spawn bridge), exercise the actual CLI path rather than eyeballing the string join in `src/cli/commands/run-task.ts` — e.g. run the built CLI's `run-task` command equivalent and confirm it spawns and reaches the orchestrator's usage output rather than an ENOENT.

For AC-15's zero-hit search (belt to type-check's braces):
```bash
grep -rn "'\.\./pipeline-policy\.js'" src/orchestrator          # expect: zero hits
grep -rn "'\.\./lib/pipeline-policy\.js'" src/orchestrator       # expect: exactly 3 (policy.ts, types.ts, quality-log.ts)
```

For AC-2's four zero-result reference families, search excluding the permitted bucket (`tasks/`, `CHANGELOG.md`, `docs/task-quality-log.md`, `src/cli/commands/stop.ts`, `.git/`):
```bash
grep -rn "scripts/run-task" . --exclude-dir=.git --exclude-dir=tasks --exclude-dir=node_modules \
  | grep -v '^CHANGELOG.md' | grep -v '^docs/task-quality-log.md'
grep -rn "scripts/pipeline-policy" . --exclude-dir=.git --exclude-dir=tasks --exclude-dir=node_modules \
  | grep -v '^CHANGELOG.md' | grep -v '^docs/task-quality-log.md'
grep -rn "dist/scripts" . --exclude-dir=.git --exclude-dir=tasks --exclude-dir=node_modules \
  | grep -v '^CHANGELOG.md' | grep -v '^docs/task-quality-log.md'
grep -rn "run-task/" . --exclude-dir=.git --exclude-dir=tasks --exclude-dir=node_modules --exclude-dir=dist \
  | grep -v '^CHANGELOG.md' | grep -v '^docs/task-quality-log.md' | grep -v 'src/cli/commands/stop.ts:32'
```
Each must return empty. If the last one doesn't, check whether the hit is `src/cli/commands/stop.ts:32`'s regex-fragment comment (leave it) or a real miss (fix it).

---

## Step 14 — Handoff table construction (read before writing `handoff.md`)

This is the part of the task most likely to loop if rushed — read it before, not after, hitting the auto-commit rejection.

1. **List both sides of every rename** — all 46 source renames (44 tree files + entry point + policy module) plus the `dist/` bundle rename. `autoCommitCode()`'s `findUncoveredTrackedChanges()` rejects a git-reported `R old -> new` porcelain entry if *either* path is missing from your table — old-only or new-only both fail, and this is the **first** gate to fire (at `implement` close), before `code_review` or `--pr` ever see the table.
2. **Token form**: old paths as markdown links `[old/path](old/path)`; new paths as backticks `` `new/path` ``. `handoff.md` is not `docs-refs-check`-exempt (unlike `spec.md`), so a backticked *old* (now-deleted) path is a broken ref and fails `docs-refs-check`; a bare unbracketed old path is invisible to the Changes-table parser and reads as under-declaration. One row per rename pair, e.g.:
   `` [scripts/run-task/git.ts](scripts/run-task/git.ts), `src/orchestrator/git.ts` ``
3. **Directory-form shortcuts don't work here.** Neither the auto-commit gate nor the `code_review` pre-flight accepts a `src/orchestrator/` prefix — both require exact path membership. Transcribe the full enumerated list from the spec's Affected Files tables; don't try to compress it.
4. Confirm `implement` actually ends with a completed auto-commit (a real commit object), not the "source changes not covered by handoff.md" abort — that's the positive-verification bar the spec sets, not just "I wrote the table."

If a gate rejects the handoff, the fix is almost always "the table is missing one side of a rename" — re-check coverage against the git diff before assuming the gate is wrong (per the Validation Gate Discipline pitfall in `docs/patterns.md`: a rejection here trains toward relabeling the table rather than fixing the real gap, which is how large renames loop to the review cap).

---

## Out of scope (Non-Goals — do not do these)

- Don't delete `check-phase-gate.ts` — move it as-is.
- Don't rewrite `CHANGELOG.md` or `docs/task-quality-log.md` historical entries.
- Don't rename any `tests/run-task-*.test.ts` file.
- Don't touch the `import cycle` between `src/task` and the orchestrator beyond what the `pipeline-policy.ts` move produces incidentally.
- Don't change `npm run lint`'s argument list or drop the `scripts/**/*.d.ts` `tsconfig.json` include.
- Don't change any orchestrator logic, control flow, prompt text, or artifact format — every edit in this plan is a path, an import specifier, or a stale-reference correction.
