# Spec: relocate-orchestrator-to-src — Relocate the pipeline orchestrator from `scripts/` to `src/orchestrator/`

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`scripts/` holds two unrelated kinds of code under one name:

- **Shipped product code** — the pipeline orchestrator (`scripts/run-task.ts` + the 44 files under `scripts/run-task/`, plus `scripts/pipeline-policy.ts`). tsup bundles this into `dist/` and it ships in the published `canon-ai` package. It is what `canon run` executes.
- **Dev/build tooling** — `docs-refs-check.mjs`, `docs-refs-config.mjs`, `install-git-hooks.mjs`, `normalize-dist-paths.mjs`, `sync-canon-templates.mjs`. None of it is ever bundled.

The directory name advertises the second and mostly contains the first. Three concrete costs follow from that:

1. **The published package ships ~14k lines of redundant raw TypeScript.** `package.json` `files` includes all of `scripts/`, so adopters download the orchestrator source alongside the bundles that already contain it.
2. **`docs/architecture.md:139` and `docs/decisions.md:175` both enumerate "`src/**`, `scripts/run-task.ts`, `scripts/run-task/**`, `scripts/pipeline-policy.ts`" as separate trees** — a four-item list that exists only because the code is split across two roots.
3. **New contributors read `scripts/` as "build scripts" and `src/` as "the product",** which is exactly backwards for 90% of `scripts/` by line count.

This is a filed backlog item (`docs/BACKLOG.md:556-564`), parked with one stated blocker: *"a directory move conflicts with every in-flight task that touches the orchestrator… do this only when the run-task queue is drained."* The queue is currently empty, which is the forcing function the entry was waiting for.

This is a **refactor, not a bug fix** — there is no failure mechanism to confirm. Zero behavior changes.

## Decision

Move the orchestrator to `src/orchestrator/` and reduce `scripts/` to exactly the set of tooling that never enters `dist/`.

- `scripts/run-task/**` → `src/orchestrator/**` (structure preserved: `agents/`, `phases/`, `prompts/`, `prompts/templates/`).
- `scripts/run-task.ts` (the tsup entry) → `src/orchestrator/run-task.ts`, moving *inside* the module directory it heads.
- `scripts/pipeline-policy.ts` → `src/lib/pipeline-policy.ts`. It is a pure module (verified: zero imports, no I/O) consumed by both `src/task/index.ts` and the orchestrator, so `src/lib/` — which already holds the pure shared modules `canon-owned.ts` and `canon-block.ts` — makes both consumers depend downward on a leaf.
- The emitted bundle moves from `dist/scripts/run-task.js` to `dist/orchestrator/run-task.js`.
- `package.json` `files` narrows from `scripts/` to `scripts/install-git-hooks.mjs` (required in the tarball because it is the `postinstall` entry; nothing else under `scripts/` is read at adopter runtime).

**Two path depths are load-bearing and must be preserved.** `resolveRepoRoot()` in `env.ts` derives its non-git fallback as `path.resolve(__dirname, '../..')`, where `__dirname` is the module's own directory. That resolves correctly today only because `scripts/run-task/` and `dist/scripts/` are each exactly two segments below their respective roots. `src/orchestrator/` and `dist/orchestrator/` preserve both. This is the reason the destination is not a flatter `dist/run-task.js`.

Three references inside the blast radius are **already factually wrong today** and are corrected rather than swapped verbatim:

| Location | Currently says | Actually true |
|---|---|---|
| `.canon/hooks/README.md:3,39` | the orchestrator entry `scripts/run-task.ts` checks for hooks | hook dispatch lives in `main.ts` → target is `src/orchestrator/main.ts` |
| `env.ts:92` (user-facing stderr) | "update the matrix in `scripts/run-task.ts`" | the matrix lives in `pipeline-policy.ts` → `src/lib/pipeline-policy.ts` |
| `metrics.ts:19` (emitted doc header) | "Auto-logged by `scripts/run-task.ts`" | the live `docs/pipeline-invocations.md:3` header already reads "Auto-logged by canon's orchestrator"; the code string is stale against its own artifact |

## Non-Goals

- **Not deleting `check-phase-gate.ts`.** It has zero importers and is in neither bundle, but it moves as-is. Its removal is a separate call.
- **Not rewriting historical records.** `CHANGELOG.md:502,503,636` and `docs/task-quality-log.md:73,115` describe what was true at the time they were written and are explicitly excluded from the sweep (see AC-2's permitted-to-remain bucket).
- **Not renaming test files.** `tests/run-task-*.test.ts` keep their names; the entry point is still called `run-task`, so the vocabulary stays correct.
- **Not refactoring the `src/task` ⇄ orchestrator import cycle** beyond the reduction that moving `pipeline-policy.ts` to `src/lib/` produces incidentally.
- **Not changing `npm run lint`'s argument list.** `eslint.config.mjs` ignores `scripts/*.mjs` but not `.d.ts`, so `scripts/docs-refs-check.mjs.d.ts` remains the one linted file under `scripts/`; dropping the `scripts/` argument would silently lose that coverage.
- **Not changing any orchestrator behavior.** No logic, control flow, prompt text, or artifact format changes.

## Acceptance Criteria

### Structural invariants (the "cloned not moved" guards)

- [ ] **AC-1 — Nothing remains at the old location.** `scripts/run-task/` and `scripts/run-task.ts` and `scripts/pipeline-policy.ts` do not exist. `ls scripts/` returns exactly: `docs-refs-check.mjs`, `docs-refs-check.mjs.d.ts`, `docs-refs-config.mjs`, `install-git-hooks.mjs`, `normalize-dist-paths.mjs`, `sync-canon-templates.mjs`. No `dist/scripts/` directory exists.

- [ ] **AC-2 — Zero-result reference gate, per string family, with an explicit permitted-to-remain bucket.** The retired path decomposes into **four** string families, each of which must return **zero** hits outside the permitted bucket below. Family 4 exists because the retired path also appears *unqualified* — a gate built only on the fully-qualified `scripts/`-prefixed forms would miss those entirely:
  - `scripts/run-task` — covers both the tree (`scripts/run-task/…`) and the entry file (`scripts/run-task.ts`).
  - `scripts/pipeline-policy` — the policy module.
  - `dist/scripts` — the retired bundle directory. This family is **not** a substring of either family above and would otherwise go ungated; it currently survives in `tests/run-task-canon-snapshot.test.ts:197,218,238,290,314` as `canonSourcePath` fixtures. Those stay functional either way (`isInstalledSourcePath` keys on `node_modules`/`_npx`, not the dist subdirectory), so this family is cosmetic-staleness cleanup rather than breakage — but it is gated so the retired path leaves no residue.
  - `run-task/` (bare — **no** `scripts/` prefix) — the unqualified form, which appears in four syntactically distinct shapes that no `scripts/`-prefixed pattern reaches. All are inside the moving tree or its tests, and the complete pre-move hit set outside `scripts/run-task/` is exactly eight lines:
    - **Real imports** — `scripts/run-task.ts:5,8` (`'./run-task/signals.js'`, `'./run-task/main.js'`), which become `'./signals.js'` / `'./main.js'`.
    - **Test string literals** — `tests/run-task-signals.test.ts:123,124`, where the structural guard matches those exact import strings via `src.indexOf(...)`. Same invisible-to-the-compiler class that makes `run-task-safety.test.ts` this task's highest-risk file: leave them stale and the guard silently stops guarding anything.
    - **Test assertion messages** — `tests/run-task-signals.test.ts:125,126`, unquoted `./run-task/…` inside failure text. Cosmetic, but they evade every quoted-form pattern.
    - **Prose comments** — `scripts/run-task.ts:3` and `scripts/run-task/agents/stream.ts:39`, naming the signal-isolation module. Note this contradicts the Affected Files row claiming `agents/stream.ts` is unchanged; that row is corrected accordingly.

    This is deliberately **one broad pattern with a named carve-out** rather than several narrow ones. Narrower quoted/prefixed patterns were tried first and each missed a further variant — three successive rounds of pattern-narrowing for the same root, which is the scope-expansion signal `docs/lessons-learned.md` names. The broad pattern has exactly **one** false positive in the entire repo (`src/cli/commands/stop.ts:32`, enumerated in the permitted bucket), so carving that out is cheaper and more airtight than enumerating syntactic variants. After the move no new path can satisfy it: `src/orchestrator/`, `src/lib/pipeline-policy.ts`, and `dist/orchestrator/run-task.js` contain no `run-task/` (the last has no trailing slash).

  **Permitted to remain** — surfaces this spec deliberately preserves:
  - `tasks/**` — all task artifacts. This covers archived tasks (497 files under `tasks/_archive/`, never scanned by `docs-refs-check` per `scripts/docs-refs-check.mjs:214`, which skips `_archive` at the `tasks/` top level) **and this task's own directory**: `tasks/relocate-orchestrator-to-src/spec.md` necessarily cites every retired path in its Affected Files table — the base-drift gate requires the source side of all 47 renames to be declared there (AC-14) — and `plan.md` / `handoff.md` / `review.md` will legitimately discuss the move using both old and new paths. Narrowing this bucket to `_archive` alone would make the gate unsatisfiable by construction.
  - `CHANGELOG.md` — release-history entries at `:502`, `:503`, `:636`.
  - `docs/task-quality-log.md` — historical log rows at `:73`, `:115`.
  - `src/cli/commands/stop.ts:32` — the single line in the repo where `run-task/` is a **regex fragment, not a path** (`/canon-ai|run-task/`, in a comment describing a process-matching pattern). It is correct today and stays byte-for-byte unchanged. This is family 4's only false positive.

  Verify each family with a search excluding `tasks/`, `CHANGELOG.md`, `docs/task-quality-log.md`, `src/cli/commands/stop.ts`, and `.git/`. No new path introduced by this task can satisfy any of the four patterns, so these are true zero-result gates rather than substring-collision cases.

- [ ] **AC-3 — `dist/` is behaviorally identical, and the depth invariant holds.** `node dist/orchestrator/run-task.js --help` succeeds and prints the same usage output as the pre-move `dist/scripts/run-task.js`. `src/orchestrator/` is exactly two path segments below the repo root and `dist/orchestrator/run-task.js` exactly two below the package root, and `resolveRepoRoot()`'s `path.resolve(__dirname, '../..')` fallback expression is unchanged. `dist/` will **not** be byte-identical (tsup embeds source paths as `// <path>` comments, so every `// scripts/run-task/…` becomes `// src/orchestrator/…`, and the two output files rename) — the real check is CI's `npm run build && git diff --exit-code -- dist/` step passing on a fresh build.

- [ ] **AC-4 — Tests pass with imports-and-paths-only edits.** The full suite is green. No test *body* changes **except the single new test required by AC-5**: every other edit under `tests/` is an import specifier, a path string, or a fixture path. If any further test's assertions or logic require a change, the handoff must name it explicitly with justification — that is a signal something moved that shouldn't have, not a routine edit.

### Gate integrity (the silent-degradation guards)

- [ ] **AC-5 — The canon-internal leak gate still has coverage, and can no longer lose it silently.** `CANON_INTERNAL_PATH_PREFIXES` in `scripts/sync-canon-templates.mjs` names the new orchestrator subtree, and the internal-template directory scan resolves to the moved `prompts/templates/` directory. Because that scan sits behind an `existsSync` guard (`readMarkdownBasenames` returns `[]` for a missing dir), a missed path would collapse `INTERNAL_ONLY_TEMPLATE_BASENAMES` to the empty set with **no error** — so this AC additionally requires a test in `tests/sync-canon-templates.test.ts` asserting the set is non-empty and contains known internal-only basenames. That converts a permanently-silent failure mode into a loud one. `npm run sync-templates:check` passes.

  **Verified pre-move baseline for that test** — the set is the 11 template basenames minus the 3 that also exist in `.canon/templates/` (`plan.md`, `spec.md`, `spec-review.md`), leaving exactly 8: `code-review-foreman.md`, `implement-reroute.md`, `implement-revisions.md`, `implement.md`, `plan-reroute.md`, `qa.md`, `spec-review-reroute.md`, `spec-revision.md`. The post-move set must be identical — this move changes where the directory lives, not which basenames are internal-only. Assert against this list, not against a guessed subset.

- [ ] **AC-6 — The runtime spawn bridge resolves.** `src/cli/commands/run-task.ts` points at the new bundle path. A miss here produces **no compile error** and breaks `canon run` for every installed adopter, so verify by executing the CLI path, not by inspection: a `canon run`-equivalent invocation through the built CLI reaches the orchestrator and prints its usage rather than failing to spawn.

- [ ] **AC-7 — The published package contents are correct.** `npm pack --dry-run` lists `scripts/install-git-hooks.mjs` and lists **no** other `scripts/` entry — in particular no raw orchestrator `.ts` source. `postinstall` still resolves its script.

### Reference sweep

- [ ] **AC-8 — Gated doc surfaces are correct and `npm run docs-refs-check` passes.** All backtick path refs under `docs/` and `README.md` resolve. This covers ~123 refs that the checker validates by `existsSync`, concentrated in `docs/codebase-map.md` (45 lines), `docs/patterns.md` (35), `docs/decisions.md` (11), `docs/architecture.md` (5), `docs/product-context.md` (5), `docs/harness-audit-2026-06.md` (2), `README.md` (2).

- [ ] **AC-9 — Two doc passages are rewritten, not path-swapped.** Both currently enumerate the orchestrator tree as disjoint from `src/**`; after the move the orchestrator is a *subset* of `src/**`, so a literal swap yields a redundant, self-contradicting list:
  - `docs/architecture.md:139` — the Full build row's "changes to `src/**`, `scripts/run-task.ts`, `scripts/run-task/**`, `scripts/pipeline-policy.ts`" collapses to `src/**`. The row's two named dist artifacts also change.
  - `docs/decisions.md:175` and `:181` — §"Canon-shipped guidance never names orchestration internals". `:175`'s three-item tree list collapses. `:181` contrasts "blocked: `scripts/run-task/`" against "deliberately not blocked: bare `src/`"; post-move both sides share the `src/` root, so the passage must be reworded to make explicit that the gate discriminates by **path specificity**, not by top-level directory. The decision's underlying logic survives intact — `src/orchestrator/` is exactly as unambiguous a two-segment prefix as `scripts/run-task/` was — but the prose must say so or a reader hits an apparent contradiction.

- [ ] **AC-10 — `docs/architecture.md:53`'s ASCII diagram is re-aligned.** The replacement string is **9 characters longer**, not shorter: `scripts/run-task/main.ts`→`src/orchestrator/main.ts` is length-neutral (24→24), but `scripts/run-task.ts`→`src/orchestrator/run-task.ts` is 19→28. The row must be re-padded so its right border lines up with its siblings — note `:53` is *already* misaligned against the rest of the box today, so "match the surrounding rows" is the target, not "preserve the current width".

- [ ] **AC-11 — The three already-wrong references are corrected**, per the table in *Decision* — `.canon/hooks/README.md:3,39` targets `main.ts` (not the entry file), `env.ts:92` names the policy module, and `metrics.ts:19` matches its own artifact's live header.

- [ ] **AC-12 — `docs/BACKLOG.md` is swept and the migration entry is closed.** All ~115 ref lines updated to the new paths, and the entry at `:556-564` marked done with a pointer to this task. BACKLOG is exempt from `docs-refs-check` (`isNoisySourceFile`, `scripts/docs-refs-check.mjs:518`), so no gate enforces this — it is swept because BACKLOG describes *future* work, and stale paths there would mislead whoever picks an entry up.

- [ ] **AC-13 — The one canon-managed mirror is regenerated and declared.** `scripts/docs-refs-check.mjs:525` (a `CANON_OWNED` file) carries a `scripts/run-task/git.ts` ref in a comment; its `templates/scripts/docs-refs-check.mjs` mirror regenerates via the pre-commit sync hook and must appear in both this spec's Affected Files and the handoff Changes table.

### Pipeline gate clearance

- [ ] **AC-14 — All three path-reconciliation gates clear, and the handoff declares both sides of every rename.** A wholesale directory move is the worst case for canon's own path-reconciliation machinery. **Three** gates read path tables here, not two, and they fire in a fixed order with the *strictest one first* — so satisfying the later, weaker gate is not evidence the earlier one will pass. Each requirement below is verifiable before the phase that follows it opens:

  - **Gate 1 — auto-commit, at `implement` close (strictest; fires first).** `autoCommitCode()` stages the handoff paths and then re-inspects the tree through `findUncoveredTrackedChanges()`. That function walks `git status --porcelain=v1 -uall` entries and rejects an entry when **any** path in it is missing from the handoff set. A rename surfaces as the single porcelain entry `R  old -> new` carrying **both** paths, so an old-only declaration and a new-only declaration are *each* reported uncovered — only listing both clears it. The production abort message says so directly: *"Fix handoff.md to list all changed files (including both sides of renames)"*. **Requirement: the handoff Changes table lists both sides of all 47 renames** — the 44 files under `scripts/run-task/`, plus the entry point and the policy module (46 source renames), plus the `dist/` bundle. If git scores the bundle as an add/delete pair rather than a rename, both paths are still declared and the gate is satisfied either way. Verify positively — `implement` must end with the orchestrator's auto-commit actually completing and producing a commit, not with the abort above.

  - **Token form for the old paths (a hard constraint, not a style choice).** Every old path is a *deleted* file by the time this table is read, and `tasks/<id>/handoff.md` is **not** exempt from `docs-refs-check` — `isNoisySourceFile()` exempts only `spec.md`, `plan.md`, `notes.md`, and `spec-review.md` under `tasks/<id>/`, deliberately, because handoff/review/done are records of real work. So per the handoff template's own "Deleting a file?" rule: **old paths use the `[path](path)` markdown-link form, new paths use backticks.** A backticked old path is a broken ref and fails `npm run docs-refs-check` (AC-8); a bare unbracketed path fails the Changes-table parse and is invisible to the coverage check, which then reads as an under-declaration at Gate 1. The two failure modes point in opposite directions, so this is the one form that satisfies both — one row per rename pair, e.g. `` [scripts/run-task/git.ts](scripts/run-task/git.ts), `src/orchestrator/git.ts` ``.

  - **Gate 2 — `code_review` pre-flight (`verifyHandoffAgainstDiff`; weaker).** This check keeps rename pairs intact and accepts **either** side, but matches by **exact string** — trailing-slash directory form does **not** work here. It is satisfied automatically by the both-sides table Gate 1 already forced; it is listed so nobody reads its either-side leniency as the governing rule and relaxes the table. Verify by getting zero `diff→handoff` / `handoff→diff` issues, not by eyeballing.

  - **Gate 3 — `--pr` base-drift (reads this spec, not the handoff).** `git diff origin/<base> HEAD --name-status -M` must produce no path outside this spec's parsed Affected Files set, which `parseNameStatusOutput` flattens into two independent paths per rename — so **both** sides must be declared here too. Verify positively: parse this spec with `parseAffectedFilesFromSpec('relocate-orchestrator-to-src')`, confirm `malformed` is empty, and confirm the returned `files` set contains every path on both sides — `src/orchestrator/main.ts`, `src/orchestrator/run-task.ts`, `src/lib/pipeline-policy.ts`, `dist/orchestrator/run-task.js`, and `dist/scripts/run-task.js` are the representative members a source-paths-only declaration would miss. Unlike the handoff, backticked old paths are correct here: `tasks/<id>/spec.md` *is* `docs-refs-check`-exempt, and `parseAffectedFilesFromSpec()` reads backticked tokens. If the implementation legitimately touches a file this spec did not anticipate, add it to Affected Files as an amendment rather than reaching for `--force`.

### Module resolution

- [ ] **AC-15 — Every `pipeline-policy` importer in the moved tree re-points, and no parent-directory specifier survives.** After the move, a search for the specifier string `'../pipeline-policy.js'` across `src/orchestrator/**` returns **zero** hits, and a search for `'../lib/pipeline-policy.js'` scoped to that same tree returns exactly the three importers named in the policy-importer note (`policy.ts`, `types.ts`, `quality-log.ts`). Scoping matters: `src/task/index.ts` resolves the same module by the byte-identical specifier `'../lib/pipeline-policy.js'` from its own directory, so an unscoped repo-wide search legitimately returns four hits and is not evidence of a stray importer. That file must also retain zero `scripts/` references. Two of the three sites are `import type`, which emit nothing — so a miss is invisible in `dist/` and at runtime; `npm run type-check` passing on a clean tree is the binding check, and the zero-hit search is what distinguishes "re-pointed" from "coincidentally still compiles".

## Design

### Affected Files

> **First-column declaration contract — every rename declares BOTH sides.** `parseAffectedFilesFromSpec()` (`scripts/run-task/validation.ts:1059`) reads path tokens from the **first column only**; second-column prose is invisible to it. Tokens must be backticked and comma-separated (`` `a`, `b` ``); a comma is the only accepted separator, and joining two tokens with anything else (an arrow, a dash, bare whitespace) marks the cell malformed and drops **every** path in that row, not just the second one — the round-1 review of this spec bit exactly that way on the `dist/` row. The `--pr` base-drift gate compares that parsed set against `getTreeDriftFiles()` (`scripts/run-task/git.ts:431`), which flattens a rename into **two independent entries** (`parseNameStatusOutput` expands `R100\told\tnew`), so declaring only the source path leaves every destination path unauthorized and aborts `--pr`. Wildcards (`*`, `?`) are rejected. Trailing-slash directory form (`dist/`) is accepted as a prefix, but this spec enumerates every path explicitly — see the note under *Interaction Dependencies* on why the handoff table needs the explicit list anyway.

**Moved — orchestrator tree (44 files, `scripts/run-task/` → `src/orchestrator/`)**

Structure is preserved verbatim; each row is one rename pair. Unless the Change column says otherwise, the file's contents are byte-identical after the move.

| File | Change |
|---|---|
| `scripts/run-task/canon-snapshot.ts`, `src/orchestrator/canon-snapshot.ts` | Move; contents unchanged (same-directory sibling imports still resolve) |
| `scripts/run-task/check-phase-gate.ts`, `src/orchestrator/check-phase-gate.ts` | Move; contents unchanged. Zero importers, in neither bundle — moved as-is, not deleted (see Non-Goals) |
| `scripts/run-task/cli.ts`, `src/orchestrator/cli.ts` | Move; contents unchanged |
| `scripts/run-task/context.ts`, `src/orchestrator/context.ts` | Move; contents unchanged |
| `scripts/run-task/detach.ts`, `src/orchestrator/detach.ts` | Move; fixes its own file-header path comment at `:1` |
| `scripts/run-task/env.ts`, `src/orchestrator/env.ts` | Move; fixes the stale operator-facing stderr string at `:92` to name `src/lib/pipeline-policy.ts` (AC-11). `resolveRepoRoot()`'s `path.resolve(__dirname, '../..')` expression is **unchanged** — the destination preserves the two-segment depth (AC-3) |
| `scripts/run-task/git.ts`, `src/orchestrator/git.ts` | Move; contents unchanged |
| `scripts/run-task/heartbeat.ts`, `src/orchestrator/heartbeat.ts` | Move; fixes its own file-header path comment at `:1` |
| `scripts/run-task/main.ts`, `src/orchestrator/main.ts` | Move; fixes 4 comment refs at `:2933`, `:3457`, `:3506`, `:3623` |
| `scripts/run-task/markdown-table.ts`, `src/orchestrator/markdown-table.ts` | Move; contents unchanged |
| `scripts/run-task/metrics.ts`, `src/orchestrator/metrics.ts` | Move; fixes the emitted doc header at `:19` to match its own artifact's live header (AC-11) |
| `scripts/run-task/policy.ts`, `src/orchestrator/policy.ts` | Move; re-points its `pipeline-policy` import at `../lib/pipeline-policy.js` (see the policy-importer note below this table) |
| `scripts/run-task/quality-log.ts`, `src/orchestrator/quality-log.ts` | Move; re-points its `pipeline-policy` import at `../lib/pipeline-policy.js` (see the policy-importer note below this table) |
| `scripts/run-task/review-loop.ts`, `src/orchestrator/review-loop.ts` | Move; contents unchanged |
| `scripts/run-task/run-context.ts`, `src/orchestrator/run-context.ts` | Move; contents unchanged |
| `scripts/run-task/signals.ts`, `src/orchestrator/signals.ts` | Move; fixes 2 comment refs at `:3`, `:4` |
| `scripts/run-task/state.ts`, `src/orchestrator/state.ts` | Move; contents unchanged |
| `scripts/run-task/types.ts`, `src/orchestrator/types.ts` | Move; re-points its `pipeline-policy` import at `../lib/pipeline-policy.js` (see the policy-importer note below this table) |
| `scripts/run-task/validation.ts`, `src/orchestrator/validation.ts` | Move; contents unchanged |
| `scripts/run-task/worktree.ts`, `src/orchestrator/worktree.ts` | Move; contents unchanged |
| `scripts/run-task/agents/claude.ts`, `src/orchestrator/agents/claude.ts` | Move; contents unchanged |
| `scripts/run-task/agents/codex.ts`, `src/orchestrator/agents/codex.ts` | Move; fixes the path inside `invalidCodexEffortMessage()` at `:24` to name `src/lib/pipeline-policy.ts`. That string is an **operator-facing validation error** surfaced locally at `:38`/`:153`, not agent-facing prompt text — so it does not conflict with the "no prompt text changes" Non-Goal |
| `scripts/run-task/agents/stream.ts`, `src/orchestrator/agents/stream.ts` | Move; **contents change**: the signal-isolation comment at `:39` names a bare `run-task/signals.ts` and must become a correct post-move reference (AC-2 family 4). This row previously claimed "unchanged" — corrected after `spec_review` |
| `scripts/run-task/phases/code-review.ts`, `src/orchestrator/phases/code-review.ts` | Move; re-points `'../../../src/task/index.js'` → `'../../task/index.js'` |
| `scripts/run-task/phases/implement.ts`, `src/orchestrator/phases/implement.ts` | Move; same `src/task` import re-point, plus a comment ref at `:41` |
| `scripts/run-task/phases/plan.ts`, `src/orchestrator/phases/plan.ts` | Move; same `src/task` import re-point |
| `scripts/run-task/phases/qa.ts`, `src/orchestrator/phases/qa.ts` | Move; same `src/task` import re-point |
| `scripts/run-task/phases/spec-review.ts`, `src/orchestrator/phases/spec-review.ts` | Move; same `src/task` import re-point |
| `scripts/run-task/phases/spec.ts`, `src/orchestrator/phases/spec.ts` | Move; same `src/task` import re-point |
| `scripts/run-task/prompts/helpers.ts`, `src/orchestrator/prompts/helpers.ts` | Move; contents unchanged |
| `scripts/run-task/prompts/index.ts`, `src/orchestrator/prompts/index.ts` | Move; contents unchanged |
| `scripts/run-task/prompts/md-modules.d.ts`, `src/orchestrator/prompts/md-modules.d.ts` | Move; contents unchanged |
| `scripts/run-task/prompts/render.ts`, `src/orchestrator/prompts/render.ts` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/code-review-foreman.md`, `src/orchestrator/prompts/templates/code-review-foreman.md` | Move; contents unchanged (verified: zero `scripts/` refs in any template) |
| `scripts/run-task/prompts/templates/implement.md`, `src/orchestrator/prompts/templates/implement.md` | Move; contents unchanged. Internal-only per the leak gate (AC-5); also the path hardcoded by `tests/validation-matrix-sync.test.ts:7` |
| `scripts/run-task/prompts/templates/implement-reroute.md`, `src/orchestrator/prompts/templates/implement-reroute.md` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/implement-revisions.md`, `src/orchestrator/prompts/templates/implement-revisions.md` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/plan.md`, `src/orchestrator/prompts/templates/plan.md` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/plan-reroute.md`, `src/orchestrator/prompts/templates/plan-reroute.md` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/qa.md`, `src/orchestrator/prompts/templates/qa.md` | Move; contents unchanged. Internal-only per the leak gate (AC-5) |
| `scripts/run-task/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec.md` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/spec-review.md`, `src/orchestrator/prompts/templates/spec-review.md` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/spec-review-reroute.md`, `src/orchestrator/prompts/templates/spec-review-reroute.md` | Move; contents unchanged |
| `scripts/run-task/prompts/templates/spec-revision.md`, `src/orchestrator/prompts/templates/spec-revision.md` | Move; contents unchanged |

> **Policy-importer note — three files, not one.** `pipeline-policy.ts` is the one moved module whose importers do **not** keep working by construction. Every orchestrator module reaches it today as the parent-directory specifier `'../pipeline-policy.js'`, which is correct only while the importer sits in `scripts/run-task/`. From `src/orchestrator/`, that identical specifier resolves to a nonexistent `src/pipeline-policy.js`, so leaving it unchanged breaks module resolution and fails `npm run type-check` and `npm run build`. There are exactly **three** such importers in the moved tree — `policy.ts:13` (value + type import), `types.ts:10` (`import type`), and `quality-log.ts:4` (`import type`) — and all three must re-point to `../lib/pipeline-policy.js`. The two `import type` sites are the easy misses: they are erased at emit, so they produce no runtime symptom and no bundle diff, but the TypeScript resolver still fails them. Sibling imports (`./cli.js`, `./types.js`) are unaffected — the tree moves as a unit, so same-directory specifiers stay valid. `src/task/index.ts`'s import of the same module is a separate re-point, tracked in the *Importers* table below.

**Moved — entry point and policy**

| File | Change |
|---|---|
| `scripts/run-task.ts`, `src/orchestrator/run-task.ts` | Move *inside* the module directory it heads; sibling imports at `:5,:8` become `./signals.js`, `./main.js` and the comment at `:3` naming a bare `run-task/signals.ts` is corrected — all three are AC-2 family 4. Keeps its `import.meta.url` direct-run guard |
| `scripts/pipeline-policy.ts`, `src/lib/pipeline-policy.ts` | Move to `src/lib/` alongside the other pure shared modules; contents unchanged |

**Build, packaging, runtime path**

| File | Change |
|---|---|
| `tsup.config.ts` | Entry key → `'orchestrator/run-task': 'src/orchestrator/run-task.ts'` |
| `tsconfig.json` | Drop `scripts/**/*.ts` from `include` (none remain); **keep** `scripts/**/*.d.ts` for `docs-refs-check.mjs.d.ts` |
| `package.json` | `files`: `scripts/` → `scripts/install-git-hooks.mjs`. `lint` unchanged (see Non-Goals) |
| `src/cli/commands/run-task.ts` | Spawn path → `dist/orchestrator/run-task.js` (AC-6) |
| `.github/workflows/ci.yml` | Global-install smoke test path at `:110` |
| `.github/pull_request_template.md` | Checklist line at `:11` |

**Importers**

| File | Change |
|---|---|
| `src/task/index.ts` | 8 imports → `../orchestrator/*.js` and `../lib/pipeline-policy.js` |
| `src/cli/commands/doctor.ts`, `src/cli/commands/watch.ts`, `src/cli/commands/stop.ts`, `src/cli/commands/update.ts` | 13 imports; relative depth drops one level (`'../../../scripts/run-task/x.js'` → `'../../orchestrator/x.js'`). `doctor.ts:649,650` also fixes 2 comments |

**Gates and tooling**

| File | Change |
|---|---|
| `scripts/sync-canon-templates.mjs` | `CANON_INTERNAL_PATH_PREFIXES` (`:25`) and the internal-template dir scan (`:42`) — both **behavioral**; plus 4 comment refs. See AC-5 |
| `scripts/docs-refs-check.mjs` | Comment ref at `:525` |
| `scripts/normalize-dist-paths.mjs` | Comment ref at `:7`, which also cites a stale line number (`worktree.ts:147`; the symlink logic is now ~`:265`) |

**Docs**

| File | Change |
|---|---|
| `docs/codebase-map.md` | 45 ref lines. Mechanical for 43; `:135` and `:145` describe the `scripts/`-vs-`src/` split itself and need rewriting. `:145` is already wrong today (claims tsconfig covers "`scripts/` and `tests/` only"). `:72`'s description of `check-phase-gate.ts` as "called by `canon task phase`" is also stale |
| `docs/patterns.md` | 35 ref lines across the Trigger Table, all five pattern sections, and the pitfalls |
| `docs/decisions.md` | 11 ref lines; `:175` and `:181` need authored rewriting (AC-9) |
| `docs/architecture.md` | 5 ref lines; `:139` needs rewriting and `:53` needs border realignment (AC-9, AC-10) |
| `docs/product-context.md` | 5 ref lines (delicate-surfaces list, tier summary) |
| `docs/harness-audit-2026-06.md` | 2 ref lines |
| `docs/BACKLOG.md` | ~115 ref lines swept; migration entry at `:556-564` closed (AC-12) |
| `README.md` | 2 ref lines (`:285`, `:289`) |
| `.canon/hooks/README.md` | 2 ref lines, corrected to `main.ts` (AC-11) |

**Tests** — ~200 ref lines across 25 files; all edits are imports/paths only (AC-4)

| File | Change |
|---|---|
| `tests/run-task-safety.test.ts` | ~110 lines. **Highest-risk file**: most refs are inside *string literals* written out as subprocess fixture files, invisible to the compiler |
| `tests/run-task-validation.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-harness.test.ts`, `tests/sync-canon-templates.test.ts`, `tests/run-task-signals.test.ts` | Imports plus `pathToFileURL`/`path.join` path strings. `run-task-signals.test.ts:123-126` holds the structural guard asserting the entry imports `signals` before `main` — its `'./run-task/signals.js'` / `'./run-task/main.js'` **string literals** must move to `'./signals.js'` / `'./main.js'` (AC-2 family 4) or the guard silently stops guarding anything |
| `tests/run-task-code-review.test.ts`, `tests/run-task-canon-snapshot.test.ts`, `tests/cli.test.ts`, `tests/run-task-counter-schema.test.ts`, `tests/run-task-parse-porcelain.test.ts`, `tests/task-cli.test.ts`, `tests/watch.test.ts` | Imports and path strings; `cli.test.ts:3544` and `task-cli.test.ts:2560` hardcode the dist bundle path |
| `tests/detach.test.ts`, `tests/md-loader-register.mjs`, `tests/pipeline-policy.test.ts`, `tests/run-task-quality-log.test.ts`, `tests/heartbeat.test.ts`, `tests/markdown-table.test.ts`, `tests/run-context.test.ts`, `tests/run-task-cli.test.ts`, `tests/run-task-extract-verdict.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/stop.test.ts`, `tests/validation-matrix-sync.test.ts` | Imports and path strings. `validation-matrix-sync.test.ts:7` hardcodes the `implement.md` template path and hard-fails if missed |

**Generated artifacts**

| File | Change |
|---|---|
| `templates/scripts/docs-refs-check.mjs` | Regenerated mirror of the `CANON_OWNED` source (AC-13). `scripts/docs-refs-check.mjs.d.ts` is also `CANON_OWNED` but carries zero refs, so its mirror does not change and is deliberately not declared |
| `dist/cli/index.js` | Rebuilt; embedded source-path comments change |
| `dist/scripts/run-task.js`, `dist/orchestrator/run-task.js` | The tracked bundle is rebuilt at the new path and the old file is deleted. Both sides declared: `git diff --name-status -M` may pair these as a rename or emit them as separate add/delete depending on similarity scoring, and the base-drift gate flattens either shape into two independent paths |

### Interaction Dependencies

- **The canon-internal leak gate** (`sync-canon-templates.mjs`) is keyed on the literal prefix `scripts/run-task/`. Its own comment already anticipates this move: *"Extend this list if a future split adds a new canon-internal source tree."* The gate's logic is parameterized and unchanged; only constants move.
- **`docs/decisions.md` §"Canon-shipped guidance never names orchestration internals"** is the governing decision for that gate. Its rationale — block *specific* subpaths, never bare `src/` or `scripts/`, because adopters have their own — survives the move but needs the reworded framing in AC-9.
- **`tests/run-task-prompts.golden.json` should not need regeneration.** Verified: it contains zero `scripts/`, `run-task`, `pipeline-policy`, or `src/` strings. The `implement` prompt injects `docs/patterns.md`'s pitfalls section (which *is* ref-dense), but the golden test insulates itself by pointing `CANON_PATTERNS_MD_PATH` at `tests/fixtures/patterns.stub.md`. Re-run to confirm rather than assume; if the fixture handoff row at `tests/run-task-prompts.test.ts:58` is updated for consistency, that is the one edit with a nonzero chance of moving the golden.
- **Global vs. dev canon**: `canon run` executes the globally-installed engine, not this checkout's build. Exercising the moved orchestrator end-to-end requires running the dev build directly (`node dist/orchestrator/run-task.js`) or `npm link`.
- **Canon's three path-reconciliation gates read renames differently — this task runs the largest rename set the repo has ever produced through all of them.** They are not interchangeable, and satisfying one does not satisfy the others. Note the ordering trap: the gate with the *strictest* rename rule fires *first*, so the later gates' leniency is never a safe design target.

  | | Auto-commit (`findUncoveredTrackedChanges`) | `code_review` pre-flight (`verifyHandoffAgainstDiff`) | `--pr` base-drift (`getTreeDriftFiles`) |
  |---|---|---|---|
  | Fires at | End of `implement` — **first** | Entry to `code_review` | `--pr`, post-QA — last |
  | Reads | Handoff Changes table | Handoff Changes table | **This spec's** Affected Files |
  | Input shape | `git status --porcelain=v1 -uall` | `git diff <base>...HEAD --name-status -M` | `git diff <base> HEAD --name-status -M` |
  | Rename representation | Single entry `R  old -> new` carrying both paths | Preserved: `parseDiffNameStatus` keeps `renamePairs` separate from `diffFiles` | Flattened: `parseNameStatusOutput` expands `R100\told\tnew` into two independent paths |
  | Declaration needed | **Both** sides (rejects if *any* path in the entry is unlisted) | **Either** side is sufficient | **Both** sides |
  | Directory-form (`dist/`) | **Not** accepted — exact set membership only | **Not** accepted — exact set membership only | Accepted as a prefix (`allowedPrefixes`) |
  | Old-path token form | `[path](path)` link — `handoff.md` is `docs-refs-check`-scanned | same table, same rule | Backticks — `spec.md` is `docs-refs-check`-exempt |

  Two practical consequences. First, **neither handoff-reading gate accepts a `src/orchestrator/` prefix**, so the handoff table must enumerate explicit paths — which is why the Affected Files tables above enumerate all 46 destinations rather than using the shorter directory form base-drift alone would have accepted. The implementer transcribes the manifest instead of re-deriving it under a gate that fails by looping. Second, **the same rename is written two different ways in two different files**: backticked on both sides in this spec, and link-form-plus-backtick in the handoff. That asymmetry is not redundancy to be normalized away — it falls out of `docs-refs-check` exempting `spec.md` but not `handoff.md`, and collapsing it in either direction breaks a gate.

### Data Model Changes

None. No `status.json` field, schema, artifact format, or prompt template content changes.

## Amendment

The initial Affected Files inventory missed a split-token fixture path that the retired-path literal searches could not see. The resumed implementation instruction authorizes completing this path-only test update.

### Affected Files

| File | Change |
|---|---|
| `tests/run-task-ship.test.ts` | Re-point the `MAIN_HREF` fixture from the retired orchestrator module location to `src/orchestrator/main.ts`; no assertion or test-logic change |

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; "suite runs clean," not "new tests were added". One test *is* added (AC-5)
- [x] `npm run build` — mandatory: this change moves a tsup entry point and rewrites both `dist/` artifacts
- [x] `npm run sync-templates:check` — mandatory: a `CANON_OWNED` file changes (AC-13)
- [x] `npm run docs-refs-check` — mandatory: ~123 gated backtick refs move
- [ ] End-to-end tests — N/A per `docs/architecture.md` §Validation (no UI surface)

Additional manual verification, not covered by any npm script:

- [x] `node dist/orchestrator/run-task.js --help` (AC-3)
- [x] `npm pack --dry-run` contents check (AC-7)
- [x] `parseAffectedFilesFromSpec('relocate-orchestrator-to-src')` returns zero `malformed` entries and a `files` set covering both sides of every rename (AC-14, Gate 3). Re-confirmed after the implementation amendment: 0 malformed, 145 paths, all 46 source and 46 destination paths present
- [x] Auto-commit clears at `implement` close (AC-14, Gate 1) — the phase ends with a commit, not with the "source changes not covered by handoff.md" abort. This is the strictest of the three gates and the first to fire

## Docs Impact

Five of the six protected docs go stale without updates, and all are handled in-task rather than deferred to QA: `docs/architecture.md` (build contract, diagram), `docs/codebase-map.md` (the module inventory — largest surface at 45 lines), `docs/decisions.md` (the leak-gate decision), `docs/patterns.md` (every pattern section keys off orchestrator paths), `docs/product-context.md` (the delicate-surfaces list names `scripts/run-task/main.ts` and `scripts/pipeline-policy.ts`).

`docs/pipeline-orchestrator.md` — the one `CANON_OWNED` doc — contains **zero** refs and is expected to need no change. If that holds, this spec declares no `templates/docs/` Generated Artifacts row. The only mirror in play is `templates/scripts/docs-refs-check.mjs` (AC-13).

## Known Risks

**Silent failures — the ones no gate catches.** Ranked by how quiet they are:

1. **Leak-gate coverage collapse.** `sync-canon-templates.mjs:42` reads the internal-template directory behind an `existsSync` guard. Miss the path and it returns `[]` — `sync-templates:check` still passes, the gate just stops protecting anything, permanently and invisibly. AC-5's non-empty assertion exists specifically to close this.
2. **String-literal test refs.** ~110 refs in `tests/run-task-safety.test.ts` live inside strings that get written out as subprocess fixture files. TypeScript cannot see them. They fail at *runtime* inside a spawned child, where the failure may surface as an unrelated-looking assertion error.
3. **The spawn bridge.** `src/cli/commands/run-task.ts` builds the bundle path by string join — no compile error if wrong, and unit tests that import the orchestrator directly won't catch it. It breaks `canon run` for every adopter. AC-6 requires executing it.
4. **Depth-derived `REPO_ROOT` fallback.** Preserved by construction here, but any later flattening of either path silently changes where the non-git fallback lands.
5. **Under-declared renames in the handoff table.** Quiet in a specific way: nothing fails *while writing the code*. Build, lint, type-check, and the full test suite all pass on a completely correct implementation whose handoff table lists only one side of each rename. The rejection lands at the auto-commit step that closes `implement` — the work is done and validated, and the commit is refused and the index reset. The failure mode is also self-perpetuating: per the Validation Gate Discipline pitfall in `docs/patterns.md`, a handoff rejection trains the agent to edit the *table* rather than reconsider coverage, which is how a 47-rename task loops to the review cap. The specific trap here is that the abort message names the table, and the table has three independent ways to be wrong at once — a missing side, a backticked deleted path, and a non-comma separator — so a fix aimed at one can leave the other two and read as "the gate is flaky." AC-14 turns all three gates into pre-close checks with distinct, named remedies rather than discoveries.

6. **A silently-erased type-only import.** Two of the three `pipeline-policy` importers use `import type`. If a re-point is missed there, nothing appears in `dist/`, no runtime path changes, and no test exercises it — the only signal is `npm run type-check`. That is a loud signal, but only if the check is actually run before the phase closes on a "the build passed" reading; `npm run build` alone does not typecheck these away. AC-15's zero-hit search is the belt to type-check's braces.

**Loud failures (expected, low-risk):** the three `pipeline-policy` import re-points (type-check fails immediately on any miss — AC-15), `validation-matrix-sync.test.ts:7`'s hardcoded template path, the two hardcoded `dist/scripts/run-task.js` test assertions, and ~123 `docs-refs-check` findings. These fail immediately and unambiguously.

**Scope-creep risk.** This touches ~340 reference lines across 40+ files, in a codebase where nearly every doc names an orchestrator path. The temptation is to fix adjacent staleness as it appears. Three corrections are explicitly authorized (AC-11) and one sweep is (AC-12); anything beyond that belongs in a follow-up. Per `docs/lessons-learned.md`, round-over-round *new-bug-class* findings on a refactor this mechanical would indicate the invariants are wrong, not that another iteration is needed.

**Merge-conflict risk.** A directory move conflicts with any concurrent work touching the orchestrator. The queue is drained as of task creation; if another task starts against `scripts/run-task/` before this lands, one of them has to rebase wholesale.

**Deliberately accepted:** `dist/` will show a large, boring diff (every embedded source-path comment changes, plus a file rename). CI's fresh-build comparison is the check that this is mechanical rather than substantive.

## Human Test Plan

1. Install canon into a scratch project, create a throwaway piece of work, and start it. Expected: it begins and moves into its first stage exactly as before, with no error about something being missing or unable to start.
2. Ask canon to check its own setup and report on its health. Expected: it reports healthy, with no warnings about files it cannot find.
3. While a piece of work is running, confirm you can still watch its progress and stop it partway through. Expected: both behave exactly as they did before.
4. Install canon fresh from the published package. Expected: installation completes, the one-time setup that runs automatically on install still succeeds, and the download is smaller than the previous release.
5. Read canon's own project documentation. Expected: every location it points you to actually exists, and its explanation of which folder holds the shipped product versus the build-time tooling now matches what you find there.
6. Expected overall: nothing anyone does with canon behaves differently. This is purely a reorganization — if any step above differs from before, that is a defect.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — this is a refactor with no failure mechanism; *Problem* says so explicitly
