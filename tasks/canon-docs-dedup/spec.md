# Spec: canon-docs-dedup — Eliminate templates/-root drift for class-1 dual-files (symlink) + structural lint for class-2 (AGENTS/CLAUDE)

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

canon-ai-dev is dual-use: it runs canon's pipeline on itself (so it needs its own `docs/`, `AGENTS.md`, `CLAUDE.md`, etc.) AND it ships those same files to adopters via `canon upgrade` (so it also has `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/docs/*.md`, `templates/CODEX.md`). The two-copy layout means every canon-managed doc change has to land in both files, and the pipeline only auto-commits the root `docs/` copy — the `templates/` copy drifts silently.

**Concrete drift surface as of 2026-05-24** (after PR #99 landed):

- `templates/docs/pipeline-orchestrator.md` is missing **three** structural paragraphs from prior PRs that landed only in `docs/pipeline-orchestrator.md`:
  - Auto-commit allow-list expansion (from `scope-pr-auto-commit-to-affected-files-v2`, PR #96)
  - Base-drift check paragraph (from `prepr-base-drift-check`, PR #97)
  - Reroute amendment convention paragraph (from `reroute-preflight-spec-amendment-check`, PR #99 — mirrored on the task branch but the prior-PR drift remains)
- `templates/CODEX.md` happens to be byte-identical to `CODEX.md` today, but there's no enforcement — next pipeline edit could silently drift it too.
- `templates/AGENTS.md` and `templates/CLAUDE.md` have intentional adopter-context divergence (pedagogical examples differ — e.g., `src/example/retry.ts` vs `scripts/docs-refs-check.mjs`). But the canon-delimited regions could still grow asymmetrically when only one side is edited.
- `templates/docs/{architecture,decisions,patterns,codebase-map,product-context}.md` and the telemetry files (`lessons-learned`, `task-quality-log`, `pipeline-invocations`) all diverge heavily by design — adopters fill them in with their own content. Out of scope for this task.

The recurring failure mode is documented in operator memory (`feedback_canon_delimited_files_template_parallel_edit`): edits to canon-managed files must land in BOTH root and `templates/` in the same commit. The memory rule helps a careful operator but doesn't catch pipeline-initiated edits or honest mistakes. We want a structural fix.

## Decision

Two structural fixes addressing two distinct classes of dual-files:

**Class 1 — no intentional divergence (pipeline-orchestrator.md + CODEX.md)**: replace the `templates/` copy with a symlink to the root copy. Single source of truth. `canon upgrade` reads via `readFileSync` (follows symlinks transparently); `npm pack` resolves symlinks at pack time and stores the resolved content in the published tarball, so adopters receive a regular file via the normal install path.

- `templates/docs/pipeline-orchestrator.md` → symlink to `../../docs/pipeline-orchestrator.md`
- `templates/CODEX.md` → symlink to `../CODEX.md`

**Class 2 — intentional divergence within canon-delimited region (AGENTS.md + CLAUDE.md)**: keep the two physical files but add a structural-equality unit test that enforces matching heading sets within `<!-- canon:start -->...<!-- canon:end -->`. Pedagogical example text and per-file adopter-context content can still diverge under each heading; only the *outline of canon-managed sections* must match.

- New test (in `tests/canon-template-mirror.test.ts` or extend an existing test file) extracts heading text + level from each canon-delimited region and compares the SET. Same headings in same order on both sides → pass; any addition/removal/renaming on one side without the matching change on the other → fail.

**Out of scope** (deferred to potential follow-up tasks):

- `templates/docs/{architecture,decisions,patterns,codebase-map,product-context,lessons-learned,task-quality-log,pipeline-invocations}.md` — heavy intentional adopter-context divergence. Adding canon delimiters + structural lint to these would be a separate task.
- Stricter enforcement (full-structural-diff including table shape and list shape) — heading-text match is the v1 grain; expand later if it proves insufficient.

## Non-Goals

- **Forcing byte-equality on AGENTS.md / CLAUDE.md.** The pedagogical-example divergence (e.g., `src/example/retry.ts` vs `scripts/docs-refs-check.mjs`) is intentional. Only the heading skeleton is enforced.
- **Adding canon delimiters to `docs/architecture.md`, `docs/decisions.md`, etc.** These intentionally have free-form adopter-fillable content with no delimiters today. Out of scope.
- **One-time content reconciliation as a separate step.** The symlink conversion implicitly resolves the existing pipeline-orchestrator.md drift (the symlink shows the root content immediately). No separate `cp` commit is needed.
- **Cross-platform symlink testing on Windows.** Canon's primary target is macOS/Linux developer machines; npm pack resolves symlinks on the pack-time machine, so adopters never see a symlink regardless of their OS. Document this in Known Risks but don't add Windows CI.
- **Auto-detecting which files should be class 1 vs class 2.** This task explicitly enumerates the four files involved. Future "canon framework" docs added to either class are a manual decision.

## Acceptance Criteria

- [ ] **AC-1**: `templates/docs/pipeline-orchestrator.md` is a symbolic link pointing to `../../docs/pipeline-orchestrator.md`. Verify with `ls -la templates/docs/pipeline-orchestrator.md` (line starts with `l`) and `readlink templates/docs/pipeline-orchestrator.md` (output equals `../../docs/pipeline-orchestrator.md`). Reading the file via `cat` (or `fs.readFileSync`) returns the exact content of `docs/pipeline-orchestrator.md`.
- [ ] **AC-2**: `templates/CODEX.md` is a symbolic link pointing to `../CODEX.md`. Same verification as AC-1 (`ls -la`, `readlink`, content equality).
- [ ] **AC-3**: `npm pack --dry-run` lists `templates/docs/pipeline-orchestrator.md` and `templates/CODEX.md` with file sizes matching the resolved content (not zero-byte symlink entries). Verify by capturing `npm pack --dry-run` output before and after; the byte counts must match the resolved-content sizes.
- [ ] **AC-4**: An actual `npm pack` (no `--dry-run`) produces a tarball where `templates/docs/pipeline-orchestrator.md` and `templates/CODEX.md` are stored as **regular files** (not symlinks) containing the resolved content. Verify by extracting the tarball to a temp dir and inspecting the files with `ls -la` (no `l` prefix) and `cat` (content matches root).
- [ ] **AC-5**: A new test in `tests/canon-template-mirror.test.ts` (NEW file) asserts that for every file in `CANON_DELIMITED_MIRROR_FILES = ['AGENTS.md', 'CLAUDE.md']`, the SET of headings inside the canon-delimited region (`<!-- canon:start -->...<!-- canon:end -->`) is identical between `<root>` and `templates/<root>`. The heading set is computed as `[{level: 2-6, text: string}]` extracted via the same regex used by `extractMarkdownHeadings` in `scripts/docs-refs-check.mjs:129-171` (or an inlined equivalent). Order matters — the test asserts `deepEqual` on the array, not set-equality, so reordering headings without matching the other side fails.
- [ ] **AC-6**: The test in AC-5 fails (red) when `templates/AGENTS.md` has a heading that root `AGENTS.md` doesn't (or vice versa) — verified by a deliberate fixture in a sibling test that mutates one file in-memory, runs the heading extractor, and asserts the comparison rejects. The negative case is critical because passing on the current tree is a weak signal.
- [ ] **AC-7**: `canon upgrade` continues to write the correct (resolved) content of `templates/docs/pipeline-orchestrator.md` and `templates/CODEX.md` into an adopter's repo. Verify by running `canon upgrade` against a temp adopter fixture and confirming the resulting `<adopter>/docs/pipeline-orchestrator.md` and `<adopter>/CODEX.md` byte-equal the root canon-ai-dev files. This exercises the symlink-resolution path through `readFileSync`.
- [ ] **AC-8**: `docs-refs-check` (the existing gate) continues to pass after the symlink conversion. Verify by running `npm run docs-refs-check` and observing `All refs OK`. The script walks `templates/` via `fs.readdirSync` — symlinks should be followed transparently, but verify behavior explicitly.
- [ ] **AC-9**: `tests/canon-template-mirror.test.ts` also includes a regression test that the SET of CANON_OWNED entries containing `templates/docs/pipeline-orchestrator.md` or `templates/CODEX.md` still resolves correctly via the symlink path used by `src/cli/commands/upgrade.ts:223-242` (`pkgDir/templates/<rel>` lookup). The test reads the file via `readFileSync` on the symlink path and asserts the content matches `readFileSync` on the root path.
- [ ] **AC-10**: `CLAUDE.md`'s "Spec-writing rules of thumb" (or equivalent operator-facing doc) gains a one-paragraph note documenting the dual-file convention: class 1 files are symlinks (single source of truth — edit only the root path); class 2 files (AGENTS.md, CLAUDE.md) require parallel edits within the canon-delimited region (enforced by the AC-5 lint). Updates `CLAUDE.md` AND `templates/CLAUDE.md` (per the convention being documented).
- [ ] **AC-11**: `docs/pipeline-orchestrator.md` "Auto-Branch + Auto-Commit" or "Customizing Canon for Your Project" section (whichever is more contextually appropriate) gets a paragraph noting that some `templates/` files are symlinks to their root counterparts. Adopters who edit a symlink target locally are editing the canon source; on `canon upgrade`, the file is overwritten by the resolved content. Same paragraph lands in `docs/pipeline-orchestrator.md`; once symlinked, `templates/docs/pipeline-orchestrator.md` reflects the change automatically. The lint in AC-5 does NOT apply here (pipeline-orchestrator.md is class 1, not class 2).
- [ ] **AC-12**: `package.json`'s `files` array continues to include `"templates/"` (the path that captures both regular files and symlinks). No change required if symlinks Just Work; explicit verification by `npm pack --dry-run` confirming both files are listed.

## Design

### Affected Files

| File | Change |
|---|---|
| `templates/docs/pipeline-orchestrator.md` | DELETE the regular file, CREATE symlink → `../../docs/pipeline-orchestrator.md`. This also resolves the 3-paragraph drift currently in the tree (auto-commit allow-list, base-drift check, reroute amendment) — the symlink immediately reflects the root copy. |
| `templates/CODEX.md` | DELETE the regular file, CREATE symlink → `../CODEX.md`. No content change observable (already byte-identical); the symlink locks future drift. |
| `tests/canon-template-mirror.test.ts` | NEW. Two tests: (1) heading-set equality across `CANON_DELIMITED_MIRROR_FILES` (AGENTS.md, CLAUDE.md) within `<!-- canon:start -->...<!-- canon:end -->`, (2) symlink-resolution sanity (reading the symlinked templates files returns the root content). Plus the deliberate-mutation negative test per AC-6. ~120 lines. |
| `tests/fixtures/canon-mirror/` (NEW dir) or inline within the test | Small fixtures for AC-6's negative case — strings representing a mutated AGENTS.md with an extra heading. Pure in-memory; no filesystem fixtures needed if the heading-extraction helper accepts a string argument. |
| `CLAUDE.md` | Add a paragraph under "Spec-writing rules of thumb" documenting the dual-file convention per AC-10. ~6-8 lines. |
| `templates/CLAUDE.md` | Mirror the AC-10 paragraph. (templates/CLAUDE.md is class 2 — manual parallel edit, enforced by the new lint after this task.) |
| `docs/pipeline-orchestrator.md` | Add a paragraph noting class-1 symlinks per AC-11. ~4-6 lines. |
| `templates/docs/pipeline-orchestrator.md` | (Automatically updated via symlink — no separate edit.) |

### Interaction Dependencies

- **`canon upgrade` machinery** in `src/cli/commands/upgrade.ts:223-242` — already reads via `readFileSync` which follows symlinks. No code change needed. Verify behavior via AC-7.
- **`docs-refs-check`** at `scripts/docs-refs-check.mjs` — walks `templates/` via `fs.readdirSync` + `fs.statSync`. `statSync` follows symlinks by default, so symlinked files appear as regular files. The scanner's heading extraction works on the resolved content. Verify via AC-8.
- **`tsup` build** doesn't read `templates/` (it bundles `src/` and `scripts/run-task/` into `dist/`), so symlinks in `templates/` are invisible to the build pipeline. No interaction.
- **`canon-template-mirror` test** depends on regex-based heading extraction. The same regex (or a near-equivalent) is in `scripts/docs-refs-check.mjs:129-171` (`getMarkdownHeadings`). Two reasonable shapes: (1) export `getMarkdownHeadings` from the script's `.d.ts` and import in the test, OR (2) inline a smaller equivalent in the test. Option 2 is simpler and avoids cross-script coupling for a one-purpose test; option 1 reduces duplication. Codex should pick the shape that fits the existing test conventions.
- **Operator workflow change**: editing `docs/pipeline-orchestrator.md` no longer requires also editing `templates/docs/pipeline-orchestrator.md` (the symlink propagates). Editing `AGENTS.md` still requires editing `templates/AGENTS.md` for canon-delimited region changes, and the new lint enforces that the heading sets stay in sync. The operator memory rule `feedback_canon_delimited_files_template_parallel_edit` continues to apply for class 2 files; for class 1 files, the symlink supersedes it.
- **CI** runs `npm test` which now exercises the new mirror test. No CI workflow file change needed (the test lives under `tests/` and is picked up by the existing `npm test` glob).

### Data Model Changes

None. No `status.json` schema changes, no new template files, no changes to `CANON_OWNED` or `PIPELINE_MANAGED_DOCS` arrays.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — full suite, including the new `tests/canon-template-mirror.test.ts`.
- [x] `docs-refs-check` (`npm run docs-refs-check`) — verify symlink-walking compatibility.
- [x] `build` (`npm run build`) — no dist change expected (the symlink swap doesn't touch `src/` or `scripts/run-task/`), but the dist-freshness CI gate runs `git diff --exit-code -- dist/` and would fail on any incidental drift. Implementer must rebuild and verify dist is clean.
- [ ] `E2E` — N/A; no UI

**Additional manual check (recorded in handoff)**: `npm pack --dry-run` before and after the symlink conversion. Both files must still appear in the file list, with byte counts matching the resolved content (the source-of-truth file's size). Run `npm pack` (actual, not dry-run), extract the tarball to a temp dir, and confirm both files exist as regular files with the correct content. Record outcome as a handoff line item.

## Docs Impact

- `CLAUDE.md` — Spec-writing rules of thumb gains the dual-file convention paragraph (AC-10).
- `templates/CLAUDE.md` — Mirror of the above (still class 2 — parallel edit required).
- `docs/pipeline-orchestrator.md` — Notes the class-1 symlink convention (AC-11). The mirror in `templates/docs/pipeline-orchestrator.md` updates automatically via symlink after AC-1.

## Known Risks

- **Symlink behavior in `git`**: Git stores symlinks as mode-`120000` blobs containing the link target as text. Cloning canon-ai-dev preserves the symlink. Confirmed working in standard git checkout on macOS/Linux. **Implementer must verify**: `git ls-files -s templates/docs/pipeline-orchestrator.md` should show `120000` after commit.
- **Windows developer machines**: Windows requires admin or Developer Mode for symlink creation. A Windows developer cloning canon-ai-dev may get a regular file (containing the link target text) instead of a working symlink. Mitigation: documented in CLAUDE.md as a Windows-known-issue; primary canon dev is macOS/Linux. Adopters never see this because npm pack resolves at the pack-time machine (which is canon-ai-dev's release pipeline, not the adopter).
- **`npm pack` behavior with symlinks**: standard npm behavior is to follow symlinks and store the resolved content. Verified via AC-3 and AC-4. If for any reason `npm pack` stores a broken symlink instead, the published tarball would have a broken file at the adopter; the AC-4 manual check catches this BEFORE shipping a release.
- **`canon upgrade` symlink semantics**: `readFileSync` follows symlinks. AC-7 verifies the end-to-end path. If `canon upgrade` were ever to use `realpath`-aware logic that distinguishes symlinks (it doesn't today), this would break. Today's code is symlink-transparent and the test locks it in.
- **Lint negative case (AC-6) requires careful implementation**: the negative test must DELIBERATELY mutate one of the two files (or a fixture-derived copy) and verify the lint rejects. Without the negative case, a green test only proves "the current tree happens to match" — not that the comparison logic actually detects drift. Pattern: clone the canon-extracted headings array from one file, push a fake heading, assert that the comparison fails.
- **Heading-set comparison strictness**: the spec says "heading set" but AC-5 uses `deepEqual` on an array (order-sensitive). Heading reordering on one side without matching reorder on the other would fail the lint. This is the right strictness for v1; if it produces false positives in practice we can relax to set-based comparison. The current AGENTS.md and CLAUDE.md don't have any reordering issue today.
- **Touching the new ref**: AC-10 adds a paragraph to CLAUDE.md mentioning class-1 symlinks. CLAUDE.md is class 2 — the new lint will require the same paragraph (heading-wise) in templates/CLAUDE.md. AC-10 explicitly calls out the mirror edit. Verify by running the lint after committing.

## Human Test Plan

1. From `release/v1.4` with this task merged, run `ls -la templates/docs/pipeline-orchestrator.md templates/CODEX.md`. Expected: both lines start with `l` (symlink) and show the target paths (`../../docs/pipeline-orchestrator.md` and `../CODEX.md` respectively).
2. Run `cat templates/docs/pipeline-orchestrator.md` and `cat docs/pipeline-orchestrator.md`. Expected: byte-identical output (since one is a symlink to the other).
3. Edit `docs/pipeline-orchestrator.md` to add a new test paragraph. Save. Run `cat templates/docs/pipeline-orchestrator.md`. Expected: the new paragraph appears in `templates/` too (without editing `templates/` directly). Revert the test edit.
4. Run `npm pack` (actual, not dry-run). Move the resulting `.tgz` to a temp dir. Extract with `tar -xzf canon-ai-*.tgz`. Inspect `package/templates/docs/pipeline-orchestrator.md` — expected: regular file (no `l` in `ls -la`), content matches `docs/pipeline-orchestrator.md`. Same for `package/templates/CODEX.md`. Delete the temp dir.
5. Add a new `## Test Section` to `AGENTS.md` (anywhere inside the canon-delimited region). Save. Run `npm test`. Expected: the new mirror test fails with a message indicating the heading set mismatches. Add the same `## Test Section` to `templates/AGENTS.md`. Re-run `npm test`. Expected: green. Revert both edits.
6. Run `canon upgrade` against a temp adopter directory (or an in-repo test fixture). Inspect the adopter's `docs/pipeline-orchestrator.md` — expected: byte-identical to canon-ai-dev's `docs/pipeline-orchestrator.md`.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs (symlink-in-git, Windows, npm pack semantics, negative-test discipline)
- [x] Human Test Plan uses product language only (no code, no file names) — *Note: canon's operator audience uses CLI commands and file paths, so the test plan uses them appropriately.*
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`)
