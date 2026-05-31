# Spec: adopter-gitignore-sync — Manage canon runtime-file .gitignore patterns across init/upgrade/doctor

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's orchestrator writes runtime-only files into the adopter's repo under `tasks/<id>/`:

- `.canon-pid` and `.canon-run.log` — detached-run PID + combined output (`scripts/run-task/detach.ts`, `PID_FILENAME`/`LOG_FILENAME` at lines 56–57).
- `.heartbeat.json` — liveness signal rewritten every ~30s (`scripts/run-task/heartbeat.ts`, `HEARTBEAT_FILENAME` line 35).

None should ever be committed — staleness is the signal that the orchestrator is dead, so a committed copy is actively misleading. canon-ai-dev's **own** `.gitignore` ignores all three (`tasks/**/.canon-pid`, `tasks/**/.canon-run.log`, `tasks/**/.heartbeat.json`), but those entries were hand-added (citing Codex PR #113) and **nothing propagates them to adopters**:

- There is no `.gitignore` in `templates/` (the adopter-shipped template set).
- `canon init` (`scaffoldTemplates`, `src/cli/commands/init.ts:33`) never creates or touches `.gitignore`.
- `canon upgrade` (`runUpgrade`, `src/cli/commands/upgrade.ts:119`) never syncs `.gitignore`.
- `canon doctor` (`src/cli/commands/doctor.ts`) checks that `.claude/settings.local.json` is ignored (`checkLocalSettingsGitignored`, line 467) but has no equivalent check for the runtime files.

Discovered live: an adopter (GP) sees canon's runtime files as untracked because nothing told its `.gitignore` to ignore them. And because `init` only runs once, the retrofit path for *existing* adopters is `canon upgrade` — which today does nothing for `.gitignore`.

## Decision

Make canon own a small, clearly-marked block of `.gitignore` for its runtime files, and propagate it through all three adopter touchpoints:

1. **`canon init`** — ensure a fresh adopter's `.gitignore` contains the canon runtime block (create the file if absent; insert the block if the file exists without it).
2. **`canon upgrade`** — retrofit/refresh the block onto existing adopters. This is the **critical path** (existing adopters never re-run `init`). It must route through `runUpgrade`'s existing `pending` queue so it inherits dirty-refusal, `--check`, `--force`, and `--no-stage` — never a parallel write path.
3. **`canon doctor`** — a warn-level check that the runtime patterns are present, mirroring `checkLocalSettingsGitignored`.

**Mechanism — canon owns a delimited block, adopter owns the rest.** Canon manages only a `# canon:start` … `# canon:end` block containing the three runtime patterns. Everything outside the block is adopter-authored and never touched. This mirrors the DELIMITED model used for `AGENTS.md`/`CLAUDE.md`/`CODEX.md`, but with `#`-comment markers instead of HTML.

**The INSERT problem and why we use an isolated helper.** The existing `mergeDelimited` (`upgrade.ts:29`) only *updates* an existing block — it returns `null` if the project file has no `# canon:start` marker. That is fine for the managed docs because `canon init` scaffolds them *with* the block already present. But every existing adopter already has a `.gitignore` with **no canon block**, so the first-time write is an *insert*, which `mergeDelimited` does not do. Therefore:

- A new **isolated `upsertCanonBlock` helper** handles `.gitignore`: append the canon block if no `# canon:start` marker is present; replace the existing block (reusing the established start/end splice logic) if it is.
- `mergeDelimited` and the managed-doc DELIMITED path are **left byte-for-byte unchanged** — zero risk to `AGENTS.md`/`CLAUDE.md`/`CODEX.md` handling.
- **`.gitignore` is NOT added to the `DELIMITED` array** (`src/lib/canon-owned.ts:23`). `runUpgrade`'s DELIMITED loop calls `mergeDelimited`, which would mark `.gitignore` `skipped` (null) for every block-less adopter. Instead, `.gitignore` gets a dedicated handling step in `runUpgrade`, `init`, and the template-sync script.

**Self-hosting.** canon-ai-dev's own `.gitignore` runtime entries are wrapped in the same `# canon:start`/`# canon:end` block, and a new `templates/.gitignore` is created carrying **exactly** that block (and nothing else). The block is defined once as the `src/lib/canon-block.ts` constant; both the TS commands (init/upgrade, via `upsertCanonBlock`) and the sync `.mjs` (run via `tsx`, which already imports from `src/lib/`) import that one constant. So the sync is not a delimiter *merge* — `templates/.gitignore` is block-only, so there is no outside-block tail to preserve — it simply writes/verifies `templates/.gitignore` against the constant. This sidesteps `mergeDelimitedForSync` entirely (which matches only the HTML `<!-- canon:start -->` markers used by the managed docs, not the `#`-comment markers used here).

## Non-Goals

- **Canon owns only its runtime patterns.** No general ignores (`node_modules`, `.env`, `*.log`, etc.) ship in the canon block — adopters manage their own. The template's canon block is exactly the three runtime patterns.
- **No modification to `mergeDelimited` or the managed-doc DELIMITED path.** The `.gitignore` upsert is isolated.
- **Never remove, reorder, or rewrite adopter-authored `.gitignore` content.** Only the canon block is canon's to write; everything outside `# canon:end` is preserved verbatim.
- **No un-tracking of already-committed runtime files.** If an adopter already committed a `.canon-pid`, this task ignores-going-forward only; `git rm --cached` is the adopter's call (mention in doctor detail, do not automate).
- **No new bypass flags.** `upgrade`'s `.gitignore` write obeys the existing `--check`/`--force`/`--no-stage`; no `.gitignore`-specific flag.
- **Block placement is append-at-end.** The canon block goes at the end of an existing adopter `.gitignore` (least intrusive to their existing structure); we do not reorganize their file.

## Acceptance Criteria

- [ ] AC-1: A new exported helper `upsertCanonBlock(content: string, block: string): string | null` exists in a new shared module `src/lib/canon-block.ts`, importable by `init`, `upgrade`, and — via `tsx` — the sync `.mjs` (see AC-7). Behavior:
  - If `content` contains `# canon:start` AND a subsequent `# canon:end` (in that order), replace the region (inclusive of both marker lines) with `block`, preserving content before `# canon:start` and after `# canon:end` verbatim.
  - If `content` contains `# canon:start` but no subsequent `# canon:end` (malformed block — adopter or external edit broke the closer), return `null`. This is the fail-safe — same shape as `mergeDelimited` at `src/cli/commands/upgrade.ts:29`, which returns `null` rather than risk clobbering. Callers handle `null` by skipping the write and surfacing a "fix your `.gitignore` manually" warning (see AC-3 / AC-4).
  - If `content` contains no `# canon:start` marker, return `content` with `block` appended (single separating blank line; trailing newline). A lone `# canon:end` with no preceding `# canon:start` is treated as adopter content and preserved verbatim above the appended block (no auto-repair).
  - If `content` is empty/absent, return just `block`.
  - The helper is **pure** (string in, string-or-null out; no I/O; never throws). `mergeDelimited` is not called or modified.
  - Marker anchoring: a line counts as a marker line iff, after stripping leading and trailing whitespace, the line is **exactly** the string `# canon:start` (or `# canon:end` for the closer). No trailing content of any kind is permitted on the marker line — a line like `# canon:start is canon's marker` (or `# canon:start  some-trailing-text`) is NOT a marker. Equivalently: regex `/^[ \t]*# canon:start[ \t]*$/m` (and the matching `# canon:end` form). This is the rule the spec is locked to; AC-9(e), AC-9(g), and the Known Risks "Marker collision" entry all reference it.

- [ ] AC-2: The canon `.gitignore` block is defined **once** as a string constant exported from `src/lib/canon-block.ts` (the single source of truth). It is imported by `init`/`upgrade` (TypeScript) and by the sync `.mjs` (run via `tsx`, which already imports from `src/lib/` — see AC-7), so no second definition exists anywhere. The block contains exactly: a `# canon:start` line, a short comment line noting the block is canon-managed (edits are overwritten on `canon upgrade`), the three patterns `tasks/**/.canon-pid`, `tasks/**/.canon-run.log`, `tasks/**/.heartbeat.json`, and a `# canon:end` line. The three patterns use `tasks/**/` (not `tasks/*/`) so they survive the `tasks/<id>/ → tasks/_archive/<id>/` rename (same rationale as the existing canon-ai-dev `.gitignore` comment).

- [ ] AC-3: `canon init` ensures the adopter `.gitignore` contains the canon block. In `src/cli/commands/init.ts`: if `.gitignore` is absent, create it containing the block; if present, apply `upsertCanonBlock` and write only if the result differs. Idempotent: running `init` twice produces no second block. This must NOT go through `scaffoldTemplates`'s skip-if-exists copy (which would never touch an existing `.gitignore`); it is explicit `.gitignore` handling.
  - **Malformed-block fail-safe**: if `upsertCanonBlock` returns `null` (adopter `.gitignore` has `# canon:start` without `# canon:end`), `init` does NOT write `.gitignore`. It logs a warning naming the file and the unclosed marker (one line, points to manual fix), and continues with the rest of `init` — the malformed `.gitignore` must not abort scaffolding or template copy.

- [ ] AC-4: `canon upgrade` refreshes the canon block via the existing `pending` queue. In `runUpgrade` (`src/cli/commands/upgrade.ts`): compute the desired `.gitignore` content via `upsertCanonBlock` against the adopter's current `.gitignore` (or the bare block if absent); if it differs from current, enqueue a `WriteOp` into `pending` (the SAME array the DELIMITED/CANON_OWNED/header-only paths use) so it inherits: `isPathDirty` dirty-refusal (refuse the whole op set without `--force`), `--check` (report under `wouldUpgrade`/`dirtyRefused`, write nothing), `--force` (write despite dirty), `--no-stage` (skip `git add`). If unchanged, record under `unchanged`. The write must NOT be a direct `writeFileSync` outside the queue (the PR #80 anti-pattern in `docs/patterns.md`: "route through the existing safety queue, never spawn a parallel one").
  - **Malformed-block fail-safe**: if `upsertCanonBlock` returns `null` (adopter `.gitignore` has `# canon:start` without `# canon:end`), `.gitignore` is NOT enqueued for write. It is reported in `runUpgrade`'s summary under a `malformed` bucket (or the closest existing failure-surface field — name it explicitly in the plan) with a one-line message naming the file and pointing to manual fix. `--check` reports the same. `--force` does NOT override this — a malformed marker cannot be auto-resolved without risking adopter data, so `--force` only overrides *dirty* refusal, not *malformed* refusal. The rest of the pending queue still processes normally (one malformed file does not poison the other DELIMITED/CANON_OWNED writes).

- [ ] AC-5: A new `canon doctor` check `checkRuntimeFilesGitignored(cwd): Check` (mirroring `checkLocalSettingsGitignored` at `doctor.ts:467`) returns: `pass` if all three patterns are present in `.gitignore` (line-trimmed match, accepting them inside or outside the canon block); `warn` if `.gitignore` is absent, or present but missing any of the three patterns (detail names which are missing and points to `canon upgrade` as the fix). Severity is **warn**, never `fail` — untracked runtime files are hygiene, not breakage. The check is registered in `doctorCmd`'s config-checks section.

- [ ] AC-6: `templates/.gitignore` is created containing the canon block (and nothing else — no general ignores). canon-ai-dev's own root `.gitignore` is restructured so its three runtime-file patterns live inside a `# canon:start`/`# canon:end` block matching `templates/.gitignore`'s block. **The three pre-existing standalone runtime lines (`tasks/**/.canon-pid`, `tasks/**/.canon-run.log`, `tasks/**/.heartbeat.json`) and their hand-added comment MUST be removed from their current location — they move *into* the block, not get duplicated alongside it.** After this AC, each of the three patterns appears exactly once in root `.gitignore`, inside the block. (Verify: `grep -c 'tasks/\*\*/\.canon-pid' .gitignore` returns `1`.) The other root-`.gitignore` entries (`node_modules`, `*.log`, etc.) stay outside the block, untouched.

- [ ] AC-7: The template-sync script (`scripts/sync-canon-templates.mjs`, run via `tsx`) keeps `templates/.gitignore` in sync with the canon block. **Source-of-truth model: the constant.** Unlike the existing CANON_OWNED / DELIMITED entries, where the root-side file is the source and `templates/<rel>` is the mirror, the `.gitignore` entry uses the exported `src/lib/canon-block.ts` constant as the sole source. The `.mjs` already imports from `src/lib/` (`canon-owned.ts` at line 6); it additionally imports the block constant from `src/lib/canon-block.ts` and writes/verifies `templates/.gitignore` to equal **exactly** that constant (with trailing newline). The root `.gitignore` is **not read** by the sync script — root self-hosting (AC-6) and the sync mirror are independent obligations that both reference the same constant.
  - Because `templates/.gitignore` is block-only (AC-6), this is a direct write/compare — there is no outside-block tail to preserve and therefore **no merge**.
  - It MUST NOT use `mergeDelimitedForSync` (line 29): that helper matches only the HTML markers `<!-- canon:start -->` / `<!-- canon:end -->` (`CANON_START_RE` line 12, `CANON_END` line 11) and returns `null` for the `#`-comment markers this block uses.
  - It MUST NOT add `.gitignore` to `DELIMITED_SYNC` (= the TS `DELIMITED` array, imported at line 9) — that array is also consumed by `runUpgrade`'s DELIMITED loop, which AC-4 forbids for `.gitignore`. The `.gitignore` sync is a dedicated step in the `.mjs`.
  - **First-create**: if `templates/.gitignore` is absent, the sync step creates it containing the constant. This is not an error.
  - **Drift**: if `templates/.gitignore` exists but its content differs from the constant, `checkSync` includes `templates/.gitignore` in its drift list; `applySync` rewrites it to the constant. There is no "missing source" error for this entry — the source (the constant) is in the code, not on disk.
  - `npm run sync-templates:check` passes after this task, and `npm run sync-templates` is a no-op once `templates/.gitignore` equals the constant.

- [ ] AC-8: The canon-internal-leak scan in the sync script (`sync-canon-templates.mjs` lines ~272–331, which rejects canon-managed content referencing `scripts/run-task/` paths) does not false-positive on `templates/.gitignore`. Verify the gitignore block (pattern lines + comment) passes the scan; if the scan would trip on `tasks/**/` or a comment, scope the scan to exclude `.gitignore` or confirm it is inert. (Reviewer confirms by running `npm run sync-templates:check`.)

- [ ] AC-9: `upsertCanonBlock` has unit tests in `tests/cli.test.ts` (or the sibling that hosts `mergeDelimited` tests) covering: (a) absent/empty content → returns just the block; (b) content without a marker → block appended, original content preserved verbatim above it; (c) content with an existing canon block → block replaced, content before `# canon:start` and after `# canon:end` preserved; (d) idempotency — applying twice yields the same result as once; (e) adopter content that merely *mentions* `# canon` in a non-marker context (e.g., a comment that includes `# canon:start is canon's marker`) is not misparsed (anchor on a marker line, not a substring); (f) **fail-safe**: content with `# canon:start` but no subsequent `# canon:end` → returns `null` (verifies the malformed-input contract from AC-1); (g) content with a `# canon:end` but no preceding `# canon:start` → falls into the no-marker branch (the orphan end is preserved verbatim, block appended).

- [ ] AC-10: `checkRuntimeFilesGitignored` has unit tests covering: all three present → `pass`; `.gitignore` absent → `warn`; one pattern missing → `warn` naming it. Use the `withTempDir` fixture pattern already in `tests/cli.test.ts`.

- [ ] AC-11: `runUpgrade`'s `.gitignore` handling has tests via the `withTempDir` fixture covering: (a) adopter `.gitignore` without the block → block inserted (appears in `upgraded`); (b) `.gitignore` already current → `unchanged`; (c) `.gitignore` dirty in git + no `--force` → appears in `dirtyRefused`, nothing written; (d) `--check` → appears in `wouldUpgrade`, nothing written; (e) **malformed** adopter `.gitignore` (`# canon:start` with no `# canon:end`) → reported in the `malformed` bucket, nothing written, and `--force` does NOT override (re-run with `--force` and verify the file is still untouched and still reported as malformed). These prove the queue integration (AC-4) and the malformed fail-safe, not a parallel path.

- [ ] AC-12: `docs/codebase-map.md` gains a pointer to the new gitignore-management surface (the `upsertCanonBlock` helper + the three touchpoints — init, upgrade, doctor). It also includes a one-sentence adopter-facing note: "canon manages a `# canon:start`/`# canon:end` block in `.gitignore`; `canon upgrade` refreshes it." Scoped to **only** `docs/codebase-map.md`. `docs/pipeline-orchestrator.md` is NOT edited by this task — keeping it out of scope avoids the CANON_OWNED templates-mirror requirement (`docs/pipeline-orchestrator.md` is in `CANON_OWNED` per `src/lib/canon-owned.ts`, so any edit there would require also updating `templates/docs/pipeline-orchestrator.md`).

- [ ] AC-13: `tests/sync-canon-templates.test.ts` is extended so existing assertions stay green AND the new `.gitignore` sync path is exercised. Per AC-7's **constant-source model**, every assertion below compares `templates/.gitignore` to the imported `src/lib/canon-block.ts` constant — there are no root-`.gitignore`-driven sync tests in this file (root self-hosting is exercised by AC-14 instead).
  - **Fixture extension**: `seedCanonFixture(root)` (currently seeds only `WHOLESALE_SYNC` + `DELIMITED_SYNC`, line 43) additionally seeds `templates/.gitignore` with the constant. Root `.gitignore` is NOT seeded by the fixture — the sync script never reads it. Without this seeding, the dedicated `.gitignore` sync step (AC-7) would report `templates/.gitignore` as drift (missing → first-create) in every existing seeded test, breaking the exact-drift-list assertions at lines 73, 77, 118, 119 (`['templates/docs/pipeline-orchestrator.md']`, `['templates/AGENTS.md']`, etc.).
  - **New tests for the `.gitignore` sync path** (all reference the imported constant — no root-`.gitignore` setup): (a) `templates/.gitignore` contains content that differs from the constant → `checkSync` includes `templates/.gitignore` in its drift list; `applySync` rewrites it to equal the constant. (b) `templates/.gitignore` already equals the constant → `checkSync` returns `[]`, `applySync` is a no-op. (c) `templates/.gitignore` is absent → `checkSync` reports it as drift (first-create); `applySync` creates it containing the constant; `findSyncErrors` returns no error for this case (the constant is the source, so "absent target" is never a missing-source error).
  - **Existing assertions remain valid**: re-run the suite locally with the new fixture; every existing exact-list assertion must still pass without modification (the goal of the fixture extension is exactly that — no rewrite of existing tests' expected lists).
  - `npm test` is green.

- [ ] AC-14: **Root `.gitignore` self-hosting guard** (separate from sync-script behavior, lives in `tests/cli.test.ts` next to the other `upsertCanonBlock` tests). One test asserts that the canon block extracted from canon-ai-dev's own root `.gitignore` (via the AC-1 helper's marker locator, run against the *real* `.gitignore` content read from `REPO_ROOT/.gitignore`) equals the imported `src/lib/canon-block.ts` constant. This is the only guard that catches drift between root and constant; the sync script (AC-7) does not. If the helper's locator is not exported, expose a small `extractCanonBlock(content): string | null` helper alongside `upsertCanonBlock` and use it from the test. This AC is intentionally narrow: one assertion, one canon-ai-dev-only file path, no fixture.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/canon-block.ts` (new) | Add pure `upsertCanonBlock(content, block)` helper per AC-1 and export the canon gitignore block constant per AC-2 (single source of truth, imported by init, upgrade, and the sync `.mjs`). |
| `src/cli/commands/init.ts` | Explicit `.gitignore` handling per AC-3 (create-if-absent / upsert-if-present), outside the `scaffoldTemplates` skip-if-exists path. |
| `src/cli/commands/upgrade.ts` | Add a `.gitignore` step in `runUpgrade` that enqueues a `WriteOp` into the existing `pending` array per AC-4; obeys dirty/`--check`/`--force`/`--no-stage`. Do NOT add `.gitignore` to the DELIMITED loop. |
| `src/cli/commands/doctor.ts` | Add `checkRuntimeFilesGitignored` per AC-5; register in `doctorCmd` config checks. |
| `templates/.gitignore` (new) | Create with the canon block only (AC-6). |
| `.gitignore` (root, canon-ai-dev's own) | Wrap the three runtime patterns in the `# canon:start`/`# canon:end` block (AC-6); leave other entries outside, untouched. |
| `scripts/sync-canon-templates.mjs` | Import the block constant from `src/lib/canon-block.ts` and add a dedicated step that writes/verifies `templates/.gitignore` directly against the constant (AC-7 — constant-source model; root `.gitignore` is NOT a sync source). Do NOT use `mergeDelimitedForSync` and do NOT add `.gitignore` to `DELIMITED_SYNC`. Ensure the internal-leak scan doesn't false-positive (AC-8). |
| `tests/cli.test.ts` | Tests per AC-9, AC-10, AC-11, AC-14. Also add `templates/.gitignore` to the `ADOPTER_SHIPPED_PATHS` list so the existing "adopter-shipped content does not leak canon-development tokens" scan covers the newly shipped template (Codex spec-review nit). |
| `tests/sync-canon-templates.test.ts` | Extend `seedCanonFixture` to seed `templates/.gitignore` (NOT root `.gitignore` — sync script never reads root) so existing exact-drift-list assertions (lines 73, 77, 118, 119) stay valid once the dedicated `.gitignore` sync step exists. Add tests for the constant-source sync path per AC-13: drift detection, apply, idempotency, first-create on absent template. |
| `dist/cli/index.js` | Regenerated by `npm run build`. The CLI is bundled from `src/cli/index.ts` via `tsup.config.ts` to `./dist/cli/index.js` (package.json `bin`); `docs/architecture.md` + the `--pr` base-drift gate require committed `dist/` to match a fresh build after any `src/**` change. Declared here per project rule "Build-generated artifacts go in Affected Files alongside their sources" (CLAUDE.md). |
| `docs/codebase-map.md` | Pointer + adopter-facing note per AC-12 (sole doc touched by this task). |

### Interaction Dependencies

- **`runUpgrade` pending queue** is the load-bearing integration. The `.gitignore` write must be one of the `pending` ops so dirty-refusal/`--check`/`--force` apply uniformly. This is the explicit lesson from `docs/patterns.md` ("route through the existing safety queue"). A direct write would reintroduce the PR #80 bug class.
- **`mergeDelimited` / DELIMITED docs** must be untouched. The isolated `upsertCanonBlock` exists precisely so the managed-doc path carries zero risk.
- **Template sync** (`sync-canon-templates.mjs`) is run via `tsx` and **does** import from `src/lib/` (it imports `CANON_OWNED`/`DELIMITED` from `canon-owned.ts` at line 6). It imports the block constant from `src/lib/canon-block.ts` and writes/verifies `templates/.gitignore` directly against it — it does NOT use `mergeDelimitedForSync` (HTML-marker-only; would return `null` for the `#`-comment block) and does NOT add `.gitignore` to `DELIMITED_SYNC` (which feeds `runUpgrade`'s DELIMITED loop, forbidden for `.gitignore` per AC-4). The shared constant means root, template, init, and upgrade all derive from one definition.
- **`scaffoldTemplates`** must not be the vehicle for `.gitignore` (skip-if-exists means an existing adopter `.gitignore` would never receive the block). Init handles `.gitignore` explicitly.

### Data Model Changes

None. No `status.json` schema change; one new pure helper, one new doctor check, one new constant/template file.

## Validation Required

- [x] **Linting** — `npm run lint`.
- [x] **Type checking** — `npm run type-check`.
- [x] **Unit tests** — `npm test` (new tests per AC-9/10/11/13/14; existing sync-templates assertions stay valid via the `seedCanonFixture` extension per AC-13; suite stays green).
- [x] **Build** — `npm run build` — the CLI commands (init/upgrade/doctor) are bundled into `dist/cli/index.js` (declared in Affected Files); rebuild + commit `dist/cli/index.js` so `git diff --exit-code -- dist/` is clean (per `docs/architecture.md` / PR template). If the build emits any additional artifact under `dist/` that the diff touches, declare it at implement time as well.
- [ ] **E2E** — N/A (no UI).
- [x] **Docs references** — `npm run docs-refs-check`.
- [x] **Template sync** — `npm run sync-templates:check` (AC-7/AC-8).

## Docs Impact

- `docs/codebase-map.md` — updated (AC-12). This is the **only** doc edited by the task.
- `docs/pipeline-orchestrator.md` — intentionally **NOT** edited. It is in `CANON_OWNED`, so any edit would also require updating its `templates/docs/pipeline-orchestrator.md` mirror — out of scope per AC-12. (Do not re-add it during planning.)
- `docs/patterns.md` — candidate pitfall ("first DELIMITED-style file that pre-exists in adopters without the block needs INSERT, not just UPDATE — use an isolated upsert, don't generalize `mergeDelimited`"). QA decides; not an AC.

## Known Risks

- **Clobbering adopter `.gitignore` content (the delicate core).** The whole point of the block model is that adopter content outside `# canon:end` is preserved. The risk: a buggy `upsertCanonBlock` (bad marker matching, off-by-one on the splice) eats adopter patterns. Mitigation: `upsertCanonBlock` is pure and unit-tested (AC-9) including the "preserve content above and below" cases; the `upgrade` write is dirty-refused (AC-4) so an adopter with uncommitted `.gitignore` edits is protected by default. Reviewer must verify the splice preserves *both* sides exactly.
- **Marker collision.** If an adopter coincidentally has a line that *contains* the substring `# canon:start` (e.g., a comment like `# canon:start is canon's marker`), the upsert could mis-splice. Mitigation: per AC-1, anchor on a marker *line* whose **trimmed contents equal exactly** `# canon:start` (regex `/^[ \t]*# canon:start[ \t]*$/m`) — substring matches and trailing content both reject. AC-9(e) tests the near-miss. Low likelihood (the marker is canon-specific) but worth the test.
- **Malformed canon block in adopter `.gitignore` (`# canon:start` present, `# canon:end` missing).** Could arise from an interrupted hand-edit or a previous canon write that was partially clobbered. The naive "append a block at end" or "replace through next end-marker we find" both risk data loss (everything after the orphan start, or unrelated adopter content beyond the file). Mitigation: `upsertCanonBlock` returns `null` (AC-1 fail-safe); `init` warns + skips (AC-3); `upgrade` reports `malformed` + refuses even with `--force` (AC-4); tests at AC-9(f) and AC-11(e) lock in the behavior. The reviewer must verify that `--force` does NOT bypass the malformed refusal — that is the failure mode this risk is guarding.
- **Sync ordering (no merge asymmetry).** Because the `.mjs` writes/verifies `templates/.gitignore` directly against the imported block constant (not a delimiter merge), there is no INSERT-vs-UPDATE asymmetry to worry about. The one ordering constraint: `templates/.gitignore` (AC-6) and the `src/lib/canon-block.ts` constant (AC-2) must exist *before/with* the sync wiring, so the first `sync-templates:check` finds `templates/.gitignore` present and matching the constant. Reviewer verifies `sync-templates:check` is green in the handoff.
- **`upgrade` dirty-refusal scope.** `runUpgrade` refuses the *entire* op set if *any* pending target is dirty (upgrade.ts:249). Adding `.gitignore` to `pending` means a dirty adopter `.gitignore` now blocks the whole upgrade (not just the gitignore write). This is the existing, intended behavior (consistency), but it's a behavior change in blast radius — a dirty `.gitignore` will newly block upgrades. Acceptable (matches how every other managed file behaves) and recoverable via `--force` or committing; call it out in the handoff so it's a conscious acceptance.
- **`init` on a repo with no git / no `.gitignore`.** Creating `.gitignore` is fine; no special handling needed. Verify init doesn't assume a git repo for this step.
- **Delicate classification.** This modifies adopter files via `upgrade` (the `auto-commit`/adopter-mutation-adjacent surface in `docs/product-context.md`'s delicate list) and touches `init`/`upgrade`/`doctor` + the template-sync machinery. A bug has unbounded blast radius *in adopter repos* (eats their `.gitignore`, or a bad upgrade refuses/corrupts). Hence `delicate: true` and full-model review chains.

## Human Test Plan

1. **Fresh adopter, no `.gitignore`:** in a scratch repo with no `.gitignore`, run `canon init`. Expected: a `.gitignore` is created containing the canon block with the three `tasks/**/...` runtime patterns and the `# canon:start`/`# canon:end` markers.
2. **Fresh adopter, existing `.gitignore`:** in a scratch repo whose `.gitignore` already has (say) `node_modules` and `.env`, run `canon init`. Expected: those entries are untouched; the canon block is appended at the end.
3. **Idempotency:** run `canon init` again. Expected: no second canon block, no change.
4. **Existing adopter retrofit (the GP case):** in a repo that has canon installed at an older version with a `.gitignore` lacking the block, run `canon upgrade`. Expected: the canon block is added (reported as upgraded), adopter entries preserved.
5. **Upgrade dirty-refusal:** make an uncommitted edit to the adopter `.gitignore`, run `canon upgrade` (no `--force`). Expected: upgrade refuses (reports the dirty `.gitignore`), writes nothing. Re-run with `--force`. Expected: the block is written.
6. **Upgrade `--check`:** on a repo missing the block, run `canon upgrade --check`. Expected: reports that `.gitignore` *would* be upgraded, writes nothing.
7. **Doctor:** on a repo missing the patterns, run `canon doctor`. Expected: a warn-level line saying the runtime patterns are missing, suggesting `canon upgrade`. Add the block, re-run. Expected: that check passes.
8. **Real runtime files stay ignored:** run a real `canon run <id>` in an adopter that has the block, confirm `git status` does not show `tasks/<id>/.canon-pid`, `.canon-run.log`, or `.heartbeat.json`.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files with specific change descriptions
- [x] Replaces existing behavior with explicit remove/leave-untouched notes (e.g., `.gitignore` NOT added to DELIMITED; `mergeDelimited` untouched; adopter content preserved)
- [x] Known Risks covers failure modes for the trickiest ACs (AC-1/AC-4/AC-7)
- [x] Human Test Plan uses product language (canon CLI is the operator's surface)
- [x] Validation Required has checked entries
- [x] Symbols named in ACs exist (verified via exploration: `scaffoldTemplates`, `runUpgrade`, `pending`, `isPathDirty`, `mergeDelimited`, `mergeDelimitedForSync`, `checkLocalSettingsGitignored`, `DELIMITED`, `PID_FILENAME`/`LOG_FILENAME`/`HEARTBEAT_FILENAME`)
