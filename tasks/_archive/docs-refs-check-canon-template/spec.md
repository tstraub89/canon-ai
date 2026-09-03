# Spec: docs-refs-check-canon-template — Ship `docs-refs-check` as canon-shipped script + canon-ai CI gate

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

canon-ai-dev's docs (`docs/codebase-map.md`, `docs/architecture.md`, `CLAUDE.md`, `AGENTS.md`, `docs/pipeline-orchestrator.md`, plus per-task spec/plan/handoff/review/done files) reference code symbols, file paths, and document sections heavily. When the orchestrator's TypeScript modules get refactored — functions renamed, files moved, sections retitled — these refs go stale immediately and silently. Per `docs/architecture.md`'s validation matrix today, only `lint` + `type-check` + `test` + `build` gate on changes; no automated check catches doc drift.

The drift is a recurring failure mode:
- **GP-style adopters** observed it as the symptom that caught canon's own cross-pipeline contamination Mode 2 — their `docs-refs-check` CI gate at the gallery_wall repo flagged a foreign codebase-map entry pointing at a file that only existed on a sibling branch. canon itself didn't catch it.
- **canon-on-canon dogfood** has accumulated stale refs — the explore audit estimates 2-8 stale refs across canon-ai-dev's high-density docs today (mostly in `docs/pipeline-orchestrator.md` from recent 1.4.0 polish).
- The **upcoming worktree-canonical-task-state refactor** (parked at spec_review per `tasks/worktree-canonical-task-state/`) will rename functions, delete two sync functions, and rewire `taskDirFor` semantics. Docs that reference the deleted/renamed symbols would go stale without a gate to catch them at PR time.

GP's operator has already written a working version of the gate — `scripts/docs-refs-check.mjs` (~310 lines) in tstraub89/gallery_wall. It validates four classes of stale references:
1. **Broken file paths in backticks** — `` `path/to/missing-file.ts` ``
2. **Broken symbol-in-file refs** — `` `SYMBOL` in `path/file.ts` `` where the symbol doesn't appear in the file
3. **Broken section refs** — `` `path.md` §"Heading Name" `` where the section heading doesn't exist
4. **Broken markdown anchor links** — `[text](#anchor)` or `[text](path.md#anchor)` where the anchor doesn't resolve

Per the BACKLOG entry at [docs/BACKLOG.md:369](../../docs/BACKLOG.md:369), the right shape is a canon-shipped script (adopters get it via `canon upgrade`) wired into canon-ai-dev's own CI as a quality gate. Adopters opt in by adding the script invocation to their own workflow.

The strategic value is dual: canon-ai-dev gets the gate immediately (catches the worktree-canonical-task-state refactor's potential ref drift before it lands), AND adopters who install canon-ai get a cross-pipeline-contamination tripwire built in.

## Decision

**Adapt GP's `scripts/docs-refs-check.mjs`** (with attribution) into canon-ai-dev. Make it a first-class canon-shipped utility script. Wire into canon-ai-dev's own CI between `type-check` and `test` so failure blocks PRs early. Ship to adopters via the existing `canon upgrade` machinery so they can opt their own workflows in.

### Change 1 — Add `scripts/docs-refs-check.mjs`

Adapted from GP's working script. Validates the four ref classes named above. Comment block at the top documents the GP origin + adaptation rationale. The script:

- Walks all markdown files under `docs/`, `tasks/`, `templates/`, plus root-level agent files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `README.md`)
- For each ref pattern, validates the target exists
- Exits with non-zero status if any broken ref found; prints a concise listing
- Reads a top-level-dirs allowlist from a constant near the top of the script:

```javascript
const VALID_DIRS = new Set([
  'src', 'scripts', 'tests', 'docs', 'public', 'tasks',
  '.github', '.canon', '.claude', '.codex', 'templates',
]);
```

Adopters who customize their top-level dir layout edit this list locally after `canon upgrade` brings them the script. Future task: promote to `.canon/config.json` when that lands (separate BACKLOG entry).

### Change 2 — `templates/scripts/docs-refs-check.mjs` mirror

`runUpgrade()` at [src/cli/commands/upgrade.ts:223-242](../../src/cli/commands/upgrade.ts:223) reads every `CANON_OWNED` file from `pkgDir/templates/<rel>`. To make the new entry actually sync to adopters, also create a byte-identical mirror at `templates/scripts/docs-refs-check.mjs`. This matches the existing pattern: every `CANON_OWNED` entry (e.g., `.canon/templates/spec.md` ↔ `templates/.canon/templates/spec.md`, `docs/pipeline-orchestrator.md` ↔ `templates/docs/pipeline-orchestrator.md`) has a `templates/`-rooted mirror that ships in the npm tarball.

Per the *Edit root AND templates/ in parallel for canon-managed files* convention, both files must change in lockstep. Implementation drops the same script content at both paths in the same commit.

### Change 3 — `package.json` integration

Two changes to `package.json`:

1. **Add npm script** under `scripts`:
   ```json
   "docs-refs-check": "node scripts/docs-refs-check.mjs"
   ```
2. **Expand `files` array** to include `"scripts/"` so the npm package ships the script directory. Current `files`: `["dist/", "templates/", "CHANGELOG.md"]`. New: `["dist/", "templates/", "scripts/", "CHANGELOG.md"]`.

The expanded `files` array means ALL of `scripts/` ships with the npm package — including `scripts/run-task/`, `scripts/run-task.ts`, `scripts/normalize-dist-paths.mjs`, and `scripts/task.sh`. This is a meaningful surface increase for the published package; verify the additional ship is safe (no secrets, no dev-only scripts that adopters shouldn't see).

Per the audit, the existing `scripts/` directory contents (top-level: `docs-refs-check.mjs` new, `normalize-dist-paths.mjs`, `pipeline-policy.ts`, `run-task.ts`, `task.sh`, plus the `scripts/run-task/` subtree) are all canon-discipline files that adopters should reasonably see. No secrets, no dev-only state.

### Change 4 — `CANON_OWNED` expansion

`src/cli/commands/upgrade.ts` line 26 has the `CANON_OWNED` array — files that `canon upgrade` syncs to adopter installs. Add one entry:

```typescript
'scripts/docs-refs-check.mjs',
```

A comment notes that this is the FIRST entry in `CANON_OWNED` from outside `.canon/`, `.claude/`, and `docs/pipeline-orchestrator.md`. Future canon-shipped utility scripts follow the same pattern.

### Change 5 — CI integration

Two-workflow approach to handle path filters:

**5a.** `.github/workflows/ci.yml` gains a step in the existing `test` job, positioned between `npm run type-check` and `npm test`:

```yaml
- run: npm run docs-refs-check
```

Position rationale: docs-refs-check is fast (no compilation, just file reads + grep), validates static content, and failure should block CI early before more expensive steps (tests, build, dist-cleanliness, smoke install). This step catches drift on code-touching PRs.

**5b.** NEW workflow file `.github/workflows/docs-refs-check.yml` that runs ONLY the docs-refs-check on PRs touching the documentation surface. Rationale: the existing `ci.yml` skips doc-only PRs via `paths: !docs/**`, `!tasks/**`, `!AGENTS.md`, `!CLAUDE.md`, `!CODEX.md`, `!.github/**/*.md` ([.github/workflows/ci.yml:21-34](../../.github/workflows/ci.yml:21)). Those are the exact surfaces this validator is meant to police, so a separate workflow is required to cover them. The workflow:

- Triggers on `pull_request` against `main`, `release/**`, and `dev` branches.
- Triggers ONLY on paths that `ci.yml`'s `paths:` filter excludes (so no double-execution on mixed PRs): `docs/**`, `tasks/**` (with `!tasks/_templates/**` re-exclusion since `ci.yml` re-includes that path), `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.github/**/*.md`. Paths NOT in `ci.yml`'s exclude list — `templates/**`, `README.md`, `scripts/docs-refs-check.mjs`, `src/**`, etc. — are NOT in this workflow's trigger because `ci.yml` runs the same gate via its `docs-refs-check` step on those PRs. The two workflows together cover the union of changeable paths with NO overlap.
- Runs only `npm ci` + `npm run docs-refs-check`. No build, no test, no smoke-install — keeps the gate fast on doc-only PRs.
- Same Node version as `ci.yml` (24.x) for consistency.

Both workflows must pass to merge — combine via branch protection's required-status-checks list. The two workflows are not mutually exclusive (a PR that touches both docs and code triggers both), but the work each does does not overlap: `ci.yml` runs the full validation matrix on code; `docs-refs-check.yml` runs only the doc-refs validator on doc-only PRs.

### Change 6 — Documentation updates

- `docs/architecture.md` Validation section — add a row for `docs-refs-check`: `npm run docs-refs-check` (= `node scripts/docs-refs-check.mjs`). Required for all changes that touch markdown docs or source files referenced from docs. Apply category: "Docs references" (new validation category) or under "Most changes" depending on framing — single AC decides.
- `AGENTS.md` Validation Matrix — add a row matching architecture.md's binding so the canon-supplied universal matrix names the category.
- `docs/codebase-map.md` Tests / Configuration sections — add a row pointing at the new script.
- Recommended workflow snippet for adopters — short paragraph in `AGENTS.md` or `docs/architecture.md` § "CI" recommending adopters add the `npm run docs-refs-check` step to their own workflow files. Canon doesn't ship `.github/workflows/` files to adopters; this is a directive, not a managed file.
- `CHANGELOG.md` `[1.4.0] Added` — entry describing the new gate.

### Change 7 — handle pre-existing drift in canon-ai-dev

The first run of the gate on canon-ai-dev likely surfaces 2-8 stale refs (per the explore audit). Two options:
- (a) Fix them in this task's same diff (keeps the gate green from first commit, but muddies the task's PR)
- (b) Land the script + CI gate first, then a small follow-up commit fixes the surfaced drift

Recommended: **(b)** — land the script in this task; the CI run on this task's own PR surfaces the existing drift and a follow-up commit (same PR, separate commit) fixes it. Keeps the diff readable. If the drift count is unexpectedly high (>15), reconsider via reroute.

## Non-Goals

- **Shipping `.github/workflows/docs-gate.yml` to adopters** — canon doesn't manage adopter workflow files. Adopters add the `npm run docs-refs-check` step to their own workflow.
- **`.canon/config.json` integration for the allowlist** — defer. The allowlist stays a script-level constant; future task can promote it.
- **`canon doctor --docs` integration** (running the validator from `canon doctor`) — defer per BACKLOG.
- **Orchestrator QA-phase integration** — defer per BACKLOG. CI is the right surface for now.
- **Adopting GP's symbol-validation rigor verbatim** — the script adapts the four classes; minor tuning may be needed (TypeScript types, function-name density). Implementation phase tunes based on initial canon-on-canon results, not pre-specified here.
- **Validating refs in code comments** (e.g., `// see scripts/run-task/main.ts:42`) — out of scope. The gate validates markdown refs only.
- **Validating refs in test fixtures or task artifact templates** — refs inside `tasks/<id>/spec.md` etc. are validated like other markdown, but refs inside `.canon/templates/*.md` (the source-of-truth templates) are out of scope because they're parameterized.
- **Auto-fix mode** (script attempts to repair refs) — out of scope. The script reports; humans (or follow-up tasks) fix.
- **Renaming or moving the GP script** — keep the filename `scripts/docs-refs-check.mjs` to match GP's working version (eases future cross-pollination of improvements).

## Acceptance Criteria

- [ ] AC-1: `scripts/docs-refs-check.mjs` exists at the canon-ai-dev repo root's `scripts/` directory. The script is adapted from `tstraub89/gallery_wall`'s `scripts/docs-refs-check.mjs` with a header comment attributing the source. Verify by reading the file: header comment includes the attribution; file has executable shebang `#!/usr/bin/env node` or runs via `node scripts/docs-refs-check.mjs`.

- [ ] AC-2: The script validates four ref classes. Each class is implemented with at least one positive test (ref resolves → no error) and one negative test (ref doesn't resolve → error emitted):
  - **Backtick file-path refs**: `` `path/to/file.ts` `` — error if the path doesn't exist relative to repo root AND the first segment is in `VALID_DIRS`.
  - **Symbol-in-file refs**: `` `SYMBOL` in `path/to/file.ts` `` — error if either the file doesn't exist OR the symbol regex `\bSYMBOL\b` doesn't match anywhere in the file contents.
  - **Section refs**: `` `path.md` §"Heading Name" `` — error if the file doesn't exist OR a markdown heading (any level) with that exact text doesn't appear.
  - **Markdown anchor links**: `[text](#anchor)` and `[text](path.md#anchor)` — error if the anchor doesn't resolve to a heading in the target file (slugified).
  Verify by adding unit tests in `tests/docs-refs-check.test.ts` covering one positive + one negative for each class.

- [ ] AC-3: `VALID_DIRS` is defined as a constant near the top of `scripts/docs-refs-check.mjs` with the canon-ai-dev-tailored allowlist: `'src', 'scripts', 'tests', 'docs', 'public', 'tasks', '.github', '.canon', '.claude', '.codex', 'templates'`. A comment above the constant explains that adopters can edit this list after `canon upgrade` brings the script. Verify by reading the source.

- [ ] AC-4: The script walks markdown files in the following locations: `docs/`, `tasks/` (excluding `tasks/_archive/`), `templates/`, and root-level `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `README.md`. It does NOT walk `node_modules/`, `dist/`, `.canon/templates/*.md` (canon-template parameterized files), or hidden directories beyond the explicit allowlist members. Verify by reading the source's path-walking logic + by running the script and confirming output includes refs from the named locations but not the excluded ones.

- [ ] AC-5: The script exits with code 0 when no broken refs are found, and exits with a non-zero code (>= 1) when any broken ref is found. On exit code != 0, stderr contains a concise listing: one line per broken ref, with format `<source-file>:<line>: <ref-text> — <error reason>`. Verify with two unit tests: (a) a clean fixture exits 0 with empty stderr; (b) a fixture with one broken ref exits non-zero with the path/line/reason on stderr.

- [ ] AC-6: `package.json` gains an `"docs-refs-check"` script entry: `"docs-refs-check": "node scripts/docs-refs-check.mjs"`. Existing scripts (lint, type-check, test, build, postbuild) are unchanged. Verify by reading `package.json`.

- [ ] AC-7: `package.json` `files` array is expanded from `["dist/", "templates/", "CHANGELOG.md"]` to `["dist/", "templates/", "scripts/", "CHANGELOG.md"]`. This ships ALL of `scripts/` in the npm package — not just `docs-refs-check.mjs`. Verify the surface increase is safe: the new shipped paths are `scripts/normalize-dist-paths.mjs`, `scripts/pipeline-policy.ts`, `scripts/run-task.ts`, `scripts/run-task/**`, `scripts/task.sh`, and the new `scripts/docs-refs-check.mjs`. None contain secrets, dev-only state, or content adopters shouldn't see. Verify by reading the diff + running `npm pack --dry-run` to enumerate the resulting package contents.

- [ ] AC-8: `CANON_OWNED` in [src/cli/commands/upgrade.ts:26](../../src/cli/commands/upgrade.ts:26) gains the entry `'scripts/docs-refs-check.mjs'`. A code comment above the addition notes this is the first canon-managed file outside `.canon/`, `.claude/`, and `docs/pipeline-orchestrator.md`, and that future canon-shipped utility scripts follow the same pattern. Verify by reading the source.

- [ ] AC-8b: A byte-identical mirror of the script lives at `templates/scripts/docs-refs-check.mjs`. This is required because `runUpgrade()` at [src/cli/commands/upgrade.ts:223-242](../../src/cli/commands/upgrade.ts:223) resolves every `CANON_OWNED` entry against `pkgDir/templates/<rel>` — without the mirror, `canon upgrade` would silently skip the new entry. Verify by reading both files and confirming `diff scripts/docs-refs-check.mjs templates/scripts/docs-refs-check.mjs` is empty; also verify by reading [src/cli/commands/upgrade.ts:225](../../src/cli/commands/upgrade.ts:225) to confirm the lookup path. (Memory `feedback_canon_delimited_files_template_parallel_edit` calls this out as the standing convention for canon-managed files in canon-ai-dev.)

- [ ] AC-9: `.github/workflows/ci.yml` gains a step `- run: npm run docs-refs-check` in the existing `test` job, positioned between `npm run type-check` and `npm test`. Verify by reading the workflow file: the new step appears in the named position.

- [ ] AC-9b: NEW workflow file `.github/workflows/docs-refs-check.yml` runs the doc-refs validator on doc-only PRs that `ci.yml`'s path filters would otherwise skip. The existing `ci.yml` `pull_request` block excludes `docs/**`, `tasks/**`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and `.github/**/*.md` ([.github/workflows/ci.yml:21-34](../../.github/workflows/ci.yml:21)), which are exactly the surfaces this validator must police. The new workflow:
  - Triggers on `pull_request` against `main`, `release/**`, and `dev`.
  - `paths:` is the **inverse** of `ci.yml`'s exclude list — covers ONLY surfaces `ci.yml` skips, with no overlap: `docs/**`, `tasks/**`, `!tasks/_templates/**` (re-excluded to match `ci.yml`'s positive entry at line 18 / 32), `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.github/**/*.md`. Does NOT include `README.md`, `templates/**`, `scripts/**` — those trigger `ci.yml`'s `docs-refs-check` step instead. Verify by reading the workflow file: every path entry maps 1:1 to an entry in `ci.yml`'s exclude list at lines 13-20 / 27-34.
  - Single job runs `actions/checkout@v6`, `actions/setup-node@v6` (Node 24.x with `cache: npm`), `npm ci`, `npm run docs-refs-check`. No build, no test, no smoke-install.
  - Uses the same concurrency-cancel group pattern as `ci.yml`.
  Verify by reading the new workflow file; verify by triggering a draft PR with a doc-only change (handled in Human Test Plan step 3).

- [ ] AC-10: `docs/architecture.md` Validation section gains a row for `docs-refs-check`: `` `npm run docs-refs-check` (= `node scripts/docs-refs-check.mjs`) — validates broken refs in markdown docs (file paths, symbols, sections, anchors). Required for any change touching `docs/`, `tasks/`, `templates/`, or root-level agent files; also required when source files referenced from docs are renamed or moved. `` Verify by reading the file.

- [ ] AC-11: `AGENTS.md` Validation Matrix gains a row matching architecture.md's binding. The canon-supplied universal matrix names a new "Docs references" category. Verify by reading the file.

- [ ] AC-12: `docs/codebase-map.md` gains a row in the appropriate section (Tests or Configuration or a new Validators section) pointing at `scripts/docs-refs-check.mjs` as the source-of-truth for docs-refs validation. Verify by reading the file.

- [ ] AC-13: `AGENTS.md` § "CI" (or `docs/architecture.md` § "CI") gains a short adopter-facing paragraph: "Adopters can opt into the `docs-refs-check` gate by adding `- run: npm run docs-refs-check` to their own GitHub Actions workflow file (canon does not ship `.github/workflows/` files to adopter repos). The script ships via `canon upgrade` to `<adopter-repo>/scripts/docs-refs-check.mjs` and is invokable via the npm script." Verify by reading the file.

- [ ] AC-14: `tests/docs-refs-check.test.ts` exists and covers the four ref classes' positive/negative cases (per AC-2) plus the exit-code semantics (per AC-5). Fixtures use `fs.mkdtempSync` for isolation per [docs/patterns.md](../../docs/patterns.md) Test-writing pitfalls. Verify by running `npm test` and observing the new test names; verify by reading the test file.

- [ ] AC-15: The script run on the current canon-ai-dev tree at PR time surfaces any pre-existing stale refs (the explore audit estimates 2-8). The task's same PR includes a separate commit fixing each surfaced ref — explicit "fix(docs): repair stale refs surfaced by docs-refs-check" or similar. If the drift count exceeds 15, the task is rerouted to deepen scope or split the cleanup into a separate PR. Verify by inspecting the PR's commit history: at least the introduction commit + one cleanup commit (or zero cleanup commits if no drift exists).

- [ ] AC-16: `CHANGELOG.md` `[1.4.0] Added` (or wherever 1.4.0 entries live currently) gains an entry summarizing the new gate. Suggested wording: `` **`docs-refs-check` script + CI gate.** New utility script at `scripts/docs-refs-check.mjs` validates markdown ref hygiene (broken file paths, symbol-in-file refs, section refs, anchor links). Wired into canon-ai's own CI between type-check and test. Ships to adopters via `canon upgrade`; adopters opt in by adding `npm run docs-refs-check` to their own workflow. Originally written by tstraub89/gallery_wall; adapted with attribution. `` Verify by reading the changelog.

- [ ] AC-17: Lint, type-check, full test suite, and full build pass. Because this task edits `src/cli/commands/upgrade.ts`, [docs/architecture.md:137](../../docs/architecture.md:137) requires running `npm run build` and committing any resulting `dist/` deltas — CI runs `git diff --exit-code -- dist/` and fails on stale `dist/`. Verify by running `npm run lint && npm run type-check && npm test && npm run build` and then `git diff --exit-code -- dist/` (must exit 0 after the build).

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/docs-refs-check.mjs` | NEW. Adapted from `tstraub89/gallery_wall`'s `scripts/docs-refs-check.mjs` with attribution header. ~310 LOC. Implements the four ref-class validators, walks the markdown surface defined in AC-4, emits findings, exits non-zero on broken refs. Honors `VALID_DIRS` constant per AC-3. |
| `templates/scripts/docs-refs-check.mjs` | NEW. Byte-identical mirror of `scripts/docs-refs-check.mjs` so `canon upgrade` can resolve the `CANON_OWNED` entry via `pkgDir/templates/<rel>`. Must change in lockstep with the root copy. |
| `package.json` | Two changes: add `"docs-refs-check": "node scripts/docs-refs-check.mjs"` to `scripts`; expand `"files"` from `["dist/", "templates/", "CHANGELOG.md"]` to `["dist/", "templates/", "scripts/", "CHANGELOG.md"]`. |
| `src/cli/commands/upgrade.ts` | Add `'scripts/docs-refs-check.mjs'` to the `CANON_OWNED` array (currently lines 26-45). Add a brief comment explaining this is the first script in CANON_OWNED. **`dist/` regeneration required** — `src/**` change. |
| `dist/cli/index.js` | Regenerated by `npm run build` to reflect the `upgrade.ts` change. Commit alongside source per the dist-freshness CI gate ([docs/architecture.md:137](../../docs/architecture.md:137)). |
| `scripts/docs-refs-check.mjs.d.ts` | NEW. Ambient type declaration for the ESM script so `tsc` / ESLint don't choke on the .mjs module when other TS sources reference it indirectly. |
| `.github/workflows/ci.yml` | Add step `- run: npm run docs-refs-check` between `npm run type-check` and `npm test` in the `test` job. |
| `.github/workflows/docs-refs-check.yml` | NEW. Separate workflow that runs only `npm run docs-refs-check` on doc-only PRs (the surfaces `ci.yml`'s path filters skip). Trigger paths and behavior per AC-9b. |
| `docs/architecture.md` | Add row in Validation section per AC-10. Add adopter-facing paragraph in CI section per AC-13 (or in AGENTS.md — single AC decides). |
| `AGENTS.md` | Add row in Validation Matrix per AC-11. Optional: add adopter-facing CI paragraph per AC-13. |
| `docs/codebase-map.md` | Add row pointing at `scripts/docs-refs-check.mjs` per AC-12. |
| `tests/docs-refs-check.test.ts` | NEW. Tests covering AC-2 (four ref-class positive/negative cases) and AC-5 (exit-code semantics). Use `fs.mkdtempSync` for fixtures. |
| `CHANGELOG.md` | Add `[1.4.0] Added` entry per AC-16. |
| `README.md` | Per AC-15: stale-ref cleanup. Surfaced by the gate's first run; rewritten to prose where the cited path no longer exists. |
| `docs/decisions.md` | Per AC-15: stale-ref cleanup for retired `runtime_validation` path citations. |
| `docs/pipeline-orchestrator.md` | Per AC-15: stale-ref cleanup for a post-merge hook note rewritten to prose. |
| `CLAUDE.md` | QA-time promotion of the "verify return shape" spec-writing rule (extends the existing "verify symbols exist" bullet at line ~166). Distinct from any operator inline edits on the same file. |
| `templates/CLAUDE.md` | Mirror of the QA promotion above so adopters receive the same rule via `canon upgrade`. |
| `docs/patterns.md` | QA-time promotion of two pitfalls discovered during this task (the `every()` vs `some()` bundle-gate trap and `getAffectedFiles` three-dot semantics). |

### Interaction Dependencies

- **`canon upgrade` machinery** in `src/cli/commands/upgrade.ts` — already handles `CANON_OWNED` syncing via `pkgDir/templates/<rel>` lookup ([src/cli/commands/upgrade.ts:223-242](../../src/cli/commands/upgrade.ts:223)). The new entry inherits the same dirty-file refusal, `--force` override, `--check` preview behavior added in 1.2.0. No code changes beyond the array addition — but the `templates/scripts/docs-refs-check.mjs` mirror (Change 2 / AC-8b) MUST exist or the lookup silently no-ops.
- **`dist/` regeneration** — `src/cli/commands/upgrade.ts` is bundled into `dist/` via `tsup`. The implement phase runs `npm run build` and commits the resulting `dist/` deltas in the same commit as the source change, per the dist-freshness CI gate.
- **CI path-filter shape** — `.github/workflows/ci.yml`'s `paths:` block skips doc-only PRs to keep CI cheap, but those are exactly the surfaces this validator must police. The new `docs-refs-check.yml` workflow (Change 5b / AC-9b) handles the doc-only path; both workflows together cover the union of changes with NO overlap (docs-refs-check.yml's paths are the strict inverse of ci.yml's exclude list). No changes to `ci.yml`'s trigger filters.
- **npm packaging** via the `files` array expansion — `npm pack` will include `scripts/` in the tarball. The auto-release workflow's smoke-install step at [.github/workflows/auto-release.yml](../../.github/workflows/auto-release.yml) (the post-publish step that runs the bundled `canon --help`) is unaffected because it doesn't exercise `scripts/`; the published tarball just gets larger.
- **CI workflow** — the new step adds <1 second per CI run (the script is fast). No other CI step is affected; ordering is preserved.
- **The worktree-canonical-task-state task** (parked) — its PR runs through this gate once shipped. If SSOT introduces stale refs (deletes a function still referenced in docs), the gate catches it.

### Data Model Changes

None. No `status.json` schema changes, no new flags, no template structural changes.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — full suite, including the new `tests/docs-refs-check.test.ts`
- [x] `docs-refs-check` (`npm run docs-refs-check`) — the new script runs against canon-ai-dev's own docs. This is the first task that validates against itself; any pre-existing drift surfaces here (handled per AC-15).
- [x] `build` (`npm run build`) — REQUIRED. The change to `src/cli/commands/upgrade.ts` regenerates `dist/`. Per [docs/architecture.md:137](../../docs/architecture.md:137), committed `dist/` must match a fresh build; CI runs `git diff --exit-code -- dist/` and fails on staleness. Implementer must `npm run build` and commit `dist/` deltas alongside source.
- [ ] `E2E` — N/A; no UI

## Docs Impact

Per Affected Files. Concretely:
- `docs/architecture.md` Validation section + CI section
- `AGENTS.md` Validation Matrix
- `docs/codebase-map.md` Validators section pointer

These changes are part of the task's diff per the ACs. `docs/decisions.md` does NOT need a new entry — `docs-refs-check` is an additive validator, not an architectural decision.

## Known Risks

- **Pre-existing drift count uncertainty**. The explore audit estimates 2-8 stale refs. If the actual count is 0, AC-15's "drift cleanup commit" is a no-op (acceptable). If >15, AC-15's reroute clause fires — split the cleanup into a separate PR. The middle case (5-15) is the expected normal: one cleanup commit in the same PR fixes them.
- **`scripts/` surface increase via `package.json files`** — the expanded `files` array ships ALL of `scripts/` in the npm package, not just `docs-refs-check.mjs`. Includes `scripts/run-task/` (the orchestrator), `scripts/task.sh`, etc. Adopters who `npm install canon-ai` will now have these files available locally. Per the explore audit, none contain secrets or dev-only content, but adopters will SEE the orchestrator's source files — they don't NEED them (the bundled `dist/` is the executable surface), but having them present is benign and may help with debugging. The increase is intentional and supports future "ship more canon-managed utility scripts" use cases.
- **First-time CI run on this PR** — the new step blocks CI if any drift exists at task-PR time. If drift exists, AC-15's cleanup commit lands; CI re-runs; passes. Acceptable round-trip.
- **GP-script adaptation regressions** — the source script is ~310 LOC. Adapting it to canon-ai-dev's directory structure (different VALID_DIRS, different markdown surface) risks regression. The unit tests at AC-14 cover the four ref classes; positive/negative cases per class catch most regression shapes. Edge cases (escape characters in paths, unicode headings, etc.) may surface during canon-on-canon dogfood — the implementation phase tunes.
- **No allowlist for "intentionally-broken refs"** — sometimes a doc references a future file (e.g., the worktree-canonical-task-state spec references `taskDirForRepoRoot` which doesn't exist yet). The script would flag these as broken. Mitigation: spec authors who reference yet-to-exist symbols must either (a) wait until the symbol lands to mention it, or (b) use a different reference style that doesn't match the four patterns (e.g., backticks-without-path, prose mention of the function name without an "in `file.ts`" suffix). Document this in the script's header comment.
- **Test isolation** — tests in `tests/docs-refs-check.test.ts` use `fs.mkdtempSync` for fixtures, avoiding pollution of the real `docs/` directory. Per the `docs/patterns.md` test-writing pitfalls.
- **Symbol-validation false negatives** — the regex `\bSYMBOL\b` matches inside comments and strings, so a comment like `// See OldFunctionName` would falsely satisfy a `` `OldFunctionName` in `file.ts` `` ref even if the function was renamed. This is GP's known limitation; canon-ai-dev inherits it. Acceptable for v1; tightening would require AST parsing (out of scope).
- **Mirror drift between `scripts/docs-refs-check.mjs` and `templates/scripts/docs-refs-check.mjs`** — future edits must touch both files in the same commit (per the `feedback_canon_delimited_files_template_parallel_edit` convention). Drift = silent install-vs-source divergence for adopters until they `canon upgrade` and overwrite their copy. Mitigation: AC-8b's `diff` check + the existing canon-delimited convention; consider a future task to lift these mirrors into a build step.
- **Worktree-canonical-task-state sequencing dependency** — this task is INTENTIONALLY landing before SSOT. If SSOT's PR introduces stale refs in protected docs, the gate catches them at SSOT's CI. If this task slips past SSOT in sequencing, SSOT's potential drift goes uncaught until later. Acceptable — the gate's value persists; the SSOT-specific safety net just isn't there for SSOT's own PR.

## Human Test Plan

> Verifies the gate fires and the canon upgrade machinery propagates the script.

1. **Setup**: from `release/v1.4` with this task merged, verify the npm script exists by running `npm run docs-refs-check` from the repo root. Expected: exits 0 if all refs are clean, OR exits non-zero with a clear listing if any drift remains.

2. **Verify the gate catches a broken ref**: temporarily edit a high-density doc (e.g., `docs/codebase-map.md`) to add a reference to a fake file: `` `scripts/nonexistent-file.ts` ``. Run `npm run docs-refs-check`. Expected: non-zero exit; stderr lists the broken ref with file:line and reason. Revert the edit.

3. **Verify CI integration on a code+docs PR**: open a draft PR with a code change AND a deliberate stale ref. Confirm `ci.yml`'s `docs-refs-check` step fails. Revert the bad ref and confirm CI passes.

3b. **Verify CI integration on a doc-only PR**: open a draft PR that touches ONLY `docs/` or `AGENTS.md` (no `src/`, no `tests/`) with a deliberate stale ref. Confirm the new `docs-refs-check.yml` workflow runs and fails (because `ci.yml` itself is skipped by path filters on doc-only PRs). Revert and confirm the workflow passes.

4. **Verify adopter shipping**: install canon-ai locally via `npm pack` + `npm install -g <tarball>`. Confirm `scripts/docs-refs-check.mjs` is present in the installed package directory. Run `canon upgrade` in a downstream test repo and confirm the script appears at `<repo>/scripts/docs-refs-check.mjs`.

5. **Verify adopter opt-in path**: in a downstream test repo with the script installed, add a step `- run: npm run docs-refs-check` to their `.github/workflows/ci.yml`. Push a deliberate stale ref. Confirm their CI fails. Revert.

6. **Verify SSOT readiness**: once the parked `worktree-canonical-task-state` task is unparked and runs, its PR's CI includes the gate. If SSOT renames/deletes a function referenced from `docs/codebase-map.md` etc., the gate fires.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry checked (or "None" with justification)
