# Spec: canon-snapshot-robustness — upstream-repo override + non-submodule vendored detection

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`captureCanonSnapshot()` in `scripts/run-task/canon-snapshot.ts` writes a provenance stamp into every task's `status.json.canon`. Two parts of that stamp are wrong for adopters who don't match canon-ai's own layout:

1. **Hardcoded upstream repo.** `CANON_UPSTREAM_REPO = 'tstraub89/canon-ai'` ([canon-snapshot.ts:10](../../scripts/run-task/canon-snapshot.ts:10)) is stamped verbatim into `upstream_repo` ([canon-snapshot.ts:59](../../scripts/run-task/canon-snapshot.ts:59)). An adopter who forks canon or vendors it from an internal mirror gets their task artifacts mis-attributed to the canonical upstream, which misleads any downstream consumer of the stamp (e.g. a future `canon dogfood-report`).

2. **Submodule-only vendored detection.** `orchestrator_commit` is meant to record the HEAD of the *downstream* repo that ships canon to its agents. Detection keys solely off `git rev-parse --show-superproject-working-tree` ([canon-snapshot.ts:52,54](../../scripts/run-task/canon-snapshot.ts:52)), which is non-empty **only** when canon is a git submodule. For canon vendored as a plain `git clone` into a host repo (e.g. `vendor/canon-ai/`), the superproject query returns empty, detection falls through to "native," and `orchestrator_commit` is set equal to `upstream_commit` — losing the host repo's HEAD-of-record.

This is a robustness/correctness gap on the provenance path, not a runtime bug with a reproducible failure in canon-ai's own (native) checkout; both gaps only manifest under adopter vendoring layouts, which are exercised here via injected git fixtures (the existing test seam) rather than a real submodule/clone tree.

## Decision

In `captureCanonSnapshot()`:

1. **Upstream-repo override.** At the single point in `captureCanonSnapshot()` where `upstream_repo` is assigned (today the object literal at [canon-snapshot.ts:59](../../scripts/run-task/canon-snapshot.ts:59)), resolve the value at **call time** as: a trimmed non-empty `process.env.CANON_UPSTREAM_REPO`, else the `CANON_UPSTREAM_REPO` const. An empty or whitespace-only env var falls back to the const (do **not** stamp an empty repo). The read must not be hoisted to module load. The exported `CANON_UPSTREAM_REPO` const stays in `canon-snapshot.ts` as the documented default (per `docs/decisions.md` — the slug's single home is this symbol); the env var only overrides the value written into the stamp.

2. **Non-submodule vendored detection.** The discriminator, stated explicitly: **canon is "vendored" when it is a self-contained git checkout nested inside a *distinct* host repository.** That is the layout where `orchestrator_commit` (the downstream HEAD that shipped canon to its agents) must differ from `upstream_commit` (canon's own HEAD). The three relevant `.git` shapes at `repoRoot` map cleanly: a `.git` **file** = git submodule (already handled by the superproject query, kept as the first check); a `.git` **directory** = standalone clone (the gap this AC closes); **no own `.git`** = canon's files are tracked directly by a host repo, in which case canon's own HEAD already *is* the host HEAD and native behavior is correct.

   So: keep the submodule path first. When the superproject query is empty, decide via an enclosing-repo probe that both confirms the "distinct host" condition and supplies the host HEAD:
   - Resolve canon's own toplevel: `git -C <repoRoot> rev-parse --show-toplevel` → `ownToplevel`.
   - Resolve the parent directory's toplevel: `git -C <dirname(repoRoot)> rev-parse --show-toplevel` → `parentToplevel`.
   - If `parentToplevel` is non-empty **and**, after `path.resolve` normalization, differs from `ownToplevel`, canon is a self-contained checkout inside a distinct host → set `orchestrator_commit` to `git -C <parentToplevel> rev-parse HEAD`.
   - Otherwise (no enclosing repo, or the parent resolves to canon's own toplevel — the untracked-subdir/monorepo-subdir shape) → native: `orchestrator_commit = upstream_commit` (unchanged behavior).

   The `parentToplevel !== ownToplevel` test is the operational form of the "distinct host" discriminator: a standalone clone in `host/vendor/canon-ai` has `ownToplevel = .../canon-ai` (its own `.git` dir) but `parentToplevel = host`, so they differ; a subdir tracked *by* the host resolves both to `host`, so they're equal → native. This covers the plain `vendor/<dir>` clone — the main observed gap — without brittle path-string matching on `vendor/`, and degrades safely to today's behavior when there is no host repo.

## Non-Goals

- **No move to `.canon/config.json`.** That is the long-term home for `CANON_UPSTREAM_REPO`, but it doesn't exist yet; this task does the env-var fallback only and does not change where the const lives.
- **No relocation of the `CANON_UPSTREAM_REPO` symbol** out of `canon-snapshot.ts`, and no duplication of the slug elsewhere (decisions.md constraint).
- **No guaranteed coverage of the symlink or tarball-extract layouts.** A symlinked canon copy or a `.git`-less tarball extraction is genuinely ambiguous; when the enclosing-repo probe finds nothing, the stamp falls back to today's native behavior (`orchestrator_commit = upstream_commit`). Documented as best-effort, not solved here.
- **No change to `upstream_commit`, `codex_cli`, `claude_code`, or the stamp's shape.** Only `upstream_repo`'s source and the `orchestrator_commit` detection branch change.
- **No new env-var plumbing in `env.ts`.** The read is local to `canon-snapshot.ts` to keep the symbol's home intact; it follows the same `process.env.X ?? default` shape used in `env.ts`.

## Acceptance Criteria

- [ ] AC-1: With `CANON_UPSTREAM_REPO` set to a non-empty value, `captureCanonSnapshot()` stamps `upstream_repo` with that value; with it unset, **or set to empty/whitespace-only**, it stamps the default `'tstraub89/canon-ai'`. Verified by three tests (set→override, unset→default, `""`/whitespace→default), each restoring the env var in a `finally`. The read must be call-time: a test that mutates `process.env` after import and before the call must observe the new value (guards against a module-load capture).
- [ ] AC-2: Submodule detection is unchanged — when the injected `--show-superproject-working-tree` returns a non-empty path, `orchestrator_commit` is the HEAD captured at that superproject path (existing test continues to pass, asserting `orchestrator_commit !== upstream_commit` for the submodule fixture).
- [ ] AC-3: Plain-vendored detection — when the superproject query is empty but the parent directory resolves (via injected `rev-parse --show-toplevel`) to a git toplevel **distinct** from canon's own toplevel, `orchestrator_commit` is the HEAD captured at that enclosing toplevel (and differs from `upstream_commit`). Verified by a new fixture: superproject empty, `ownToplevel = <repoRoot>`, `parentToplevel = <host>`, host HEAD distinct.
- [ ] AC-4: Native detection — when the superproject query is empty and the parent directory has no enclosing repo (`--show-toplevel` at the parent returns empty/error) **or** resolves to canon's own toplevel, `orchestrator_commit === upstream_commit` (today's behavior preserved). Verified by two fixtures (no enclosing repo; parent resolves to own toplevel).
- [ ] AC-5: Probe failures are non-fatal. If any fallback git invocation errors or returns empty, detection degrades to native without throwing — `captureCanonSnapshot()` still returns a complete `CanonStamp` (consistent with the existing `<unavailable>` handling). Verified by a fixture where the parent `rev-parse` returns a non-`ok` result.
- [ ] AC-6: A short note is added to `docs/decisions.md` (the existing `CANON_UPSTREAM_REPO` provenance entry, ~line 37) recording that the slug is now overridable via the `CANON_UPSTREAM_REPO` env var while remaining homed in the symbol. No new decision section; an in-place clause on the existing Rule.
- [ ] AC-7: Full suite green: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (committed `dist/` matches a fresh build), `npm run docs-refs-check`.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/canon-snapshot.ts` | (a) Resolve `upstream_repo` at the build site in `captureCanonSnapshot()` using the trimmed-non-empty rule from AC-1 (a non-empty trimmed `process.env.CANON_UPSTREAM_REPO`, else the `CANON_UPSTREAM_REPO` const), not a raw `??`. (b) Add the enclosing-repo fallback probe in the `orchestratorCommit` computation, using the injectable `runGitAt` runner so it stays test-seamable; factor the detection into a small helper if it clarifies the branch. |
| `tests/run-task-canon-snapshot.test.ts` | Add fixtures/tests for AC-1 (env override, call-time), AC-3 (plain-vendored), AC-4 (native: no-enclosing + parent-equals-own), AC-5 (probe failure → native). Reuse the existing `fakeGitRunner` keyed by `<cwd> :: <args>`. |
| `docs/decisions.md` | Append the env-override clause to the existing `CANON_UPSTREAM_REPO` provenance Rule (~line 37). |
| `dist/cli/index.js` | Generated artifact — `canon-snapshot.ts` is imported by `src/task/index.ts` (`refreshCanonSnapshotAtPath`), so the build rewrites the CLI bundle. |
| `dist/scripts/run-task.js` | Generated artifact — `canon-snapshot.ts` is part of the orchestrator bundle; the build rewrites it. |

### Interaction Dependencies

- **`refreshCanonSnapshotAtPath` / `refreshCanonSnapshotsAtPaths`** call `captureCanonSnapshot()` ([canon-snapshot.ts:77,89](../../scripts/run-task/canon-snapshot.ts:77)); both pick up the override and the new detection automatically — no separate change needed, but tests should confirm the refresh path stamps the env value end-to-end if a refresh-path test already exists.
- **`canon task new`** stamps the snapshot at creation via `refreshCanonSnapshotAtPath` ([src/task/index.ts](../../src/task/index.ts)). This is the CLI→canon-snapshot import that makes the change land in `dist/cli/index.js` as well as the orchestrator bundle.
- **`docs/decisions.md` line 37** is the documented single home for the slug; the env clause must keep that framing (the symbol remains canonical; env only overrides the stamped value).

### Data Model Changes

None. `CanonStamp` shape is unchanged; only the *source* of `upstream_repo` and the *detection branch* for `orchestrator_commit` change.

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Routes / config / build | Full build |
| Docs references | Docs references |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — `scripts/run-task/**` change rewrites `dist/scripts/run-task.js` and `dist/cli/index.js`; committed `dist/` must match a fresh build
- [x] `npm run docs-refs-check` — touches `docs/decisions.md`

> `docs/decisions.md` is not a canon-managed/template-mirrored file, so `sync-templates:check` is N/A for this task.

## Docs Impact

- `docs/decisions.md` — the `CANON_UPSTREAM_REPO` provenance Rule goes stale without the env-override clause (updated in this task).
- Other protected docs: no impact. `codebase-map.md` already lists `canon-snapshot.ts` correctly; no new pattern.

## Known Risks

- **False-positive enclosing repo (riskiest AC).** If canon-ai's *own* checkout happens to sit inside another git repository (e.g. a parent dir that is itself a repo), the probe could classify the dev checkout as vendored and stamp a wrong `orchestrator_commit`. Mitigation: the probe only fires when the superproject query is empty (so true submodules are unaffected) **and** requires `parentToplevel !== ownToplevel`; for canon-ai's normal layout the parent dir is not a git repo, so `--show-toplevel` there returns empty → native. The AC-4 "parent resolves to own toplevel" case explicitly covers the monorepo-subdir shape (canon tracked as a subdir of one repo) so it is classified native, not vendored.
- **Symlinked canon.** A symlinked working copy may resolve `repoRoot` to the link target whose parent is not the host repo, so the probe can miss it. This is accepted as best-effort (Non-Goals); behavior is no worse than today (native fallback).
- **Path resolution.** `ownToplevel`/`parentToplevel` comparison must normalize paths (`path.resolve`) before comparing, or a trailing-slash / relative-vs-absolute mismatch could cause a false "distinct" result. Tests should feed realistic absolute paths.
- **Env-var trimming (resolved in AC-1).** A bare `process.env.CANON_UPSTREAM_REPO ?? CANON_UPSTREAM_REPO` would let `CANON_UPSTREAM_REPO=""` override to an empty repo (empty string is not nullish). Decision: trim and treat empty/whitespace as "not set" → fall back to the const default; AC-1 tests this case. So the resolution is `const env = process.env.CANON_UPSTREAM_REPO?.trim(); const repo = env ? env : CANON_UPSTREAM_REPO;` rather than a raw `??`.

## Human Test Plan

1. In a normal canon-ai checkout, create a task and view its provenance stamp: confirm the upstream repo reads `tstraub89/canon-ai` and the orchestrator commit matches canon's own HEAD (unchanged behavior).
2. Set the upstream-repo override environment variable to a different value, create a task, and confirm the stamp records that value instead.
3. Expected: forks/mirrors can correct their attribution via the environment variable, and a host repo that vendors canon as a plain folder gets the host's commit recorded as the orchestrator commit rather than a copy of the upstream commit.
