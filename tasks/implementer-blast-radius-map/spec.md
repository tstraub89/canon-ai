# Spec: implementer-blast-radius-map — Implementer pre-handoff self-check and blast-radius map

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

First-round `code_review` findings show the same few failure classes repeating. `scripts/review-metrics.mjs` (committed in `78c1ba8`) parses round 1 of every archived `review.md`. Over the October 2026 tasks (26 tasks under a stable three-lens review setup), round 1 averages 1.46 blocking findings per task, and 54% of first rounds return `changes_requested`. The largest keyword-tagged classes are:

- **Test integrity** (0.42 per task): tests that would pass against broken behavior, loose substring assertions, or no assertion on the failure reason.
- **Restatement drift** (about 0.15): a changed contract left stale where another surface restates it, such as `--help` lines, agent charters, or README sections.
- **Sibling asymmetry** (about 0.19): a guard added on one path but not its sibling, for example `classifyAttach` vs `classifyIdle`, or bash vs zsh completion tables.

Two gaps feed these classes.

1. **No self-check before the handoff.** The implement prompts never ask the implementer to look for these classes before writing the handoff. The spec-author and reviewer prompts carry sibling and restatement guidance; the implement prompts do not.
2. **No view of the change's surroundings.** The implement prompt gives the spec, Known Risks, the Known Pitfalls section, and the contents of the Affected Files. It does not say what *references* the Affected Files, or where else the identifiers the spec names appear. The implementer can search with its shell, but it has to think of the search first.

The map mainly serves restatement drift: files that reference the changed module, and other occurrences of named identifiers. It helps sibling asymmetry only when the sibling shares a name or reference. Siblings with different names, and brand-new flags, depend on the self-check alone. Test integrity depends on the self-check alone.

## Decision

1. **Pre-handoff self-check.** The fresh, park-resume, revision, and reroute implement prompts gain a self-check block that runs after the implementer makes its changes and before it runs validation and writes `handoff.md`. That way any edit the sweeps produce is covered by validation. It has three checks, in this order:
   1. **Test integrity:** this is a reasoning check. For each test this pass added or changed to pin new or altered behavior, would it fail if the change were reverted? Does it assert the specific reason (the message, value, or state the change produces), not only that something failed or passed? Regenerated snapshots and pure fixture updates are exempt. Where a cheap run against the base confirms a failure, do it. ACs that the spec states as red-first regression tests still follow the existing red-first checkpoint, which this check does not replace.
   2. **Restatement sweep:** for every contract the change alters (an operator-facing string, flag, format, heading, verdict, or config key), search the repository for other places that state the same contract, and bring them in line.
   3. **Sibling parity:** for every guard, check, or branch the change adds, find the parallel paths that handle the same input (other commands, modes, entry points, or platform variants), and confirm each one either gets the same treatment or deliberately does not.

   The block itself states that a needed edit outside Affected Files is recorded as a Blocker in `handoff.md`, not made. Only the fresh template states that scope cap today, so the block must carry it on its own. The interrupted-resume prompt (`promptImplementResume`, "finish validation + handoff only") omits the block, because it authorizes no code changes.

2. **Blast-radius map.** The orchestrator computes a names-only block and injects it into the fresh, park-resume, and reroute implement prompts, next to the existing Known Risks, Known Pitfalls, and Relevant Files blocks. It has two parts. Both exclude every Affected File (including files under an Affected Files directory entry), task artifacts under `tasks/`, and tracked files whose `linguist-generated` git attribute is set.
   - **References to Affected Files:** for each Affected File that exists as a regular file in the active checkout, the tracked files that reference it. A file references it by a module specifier that resolves to its stem (`./foo.js`, `../lib/foo`) or by its file name (`foo.ts`).
   - **Spec-named identifiers:** identifier-shaped or flag-shaped backticked tokens from the spec's amendment sections (newest first), then Design, then Acceptance Criteria. Identifier shape is camelCase, PascalCase, snake_case, or `name()`, with the trailing `()` stripped before searching. Flag shape is `--name`. For each token, the block lists the tracked files that contain it as a whole word. When the token cap applies, earlier tokens in that order win.

   The block lists paths only, never contents. Each entry has a per-entry file limit with `+N more`, and the whole block has a byte cap with a truncation line. Its framing says these are surfaces to check for the restatement and sibling self-checks, and that editing one outside Affected Files still requires a Blocker. Map computation never fails the prompt. On any error the block is omitted.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Task split | Self-check and map ship together here; handoff evidence and its gate are the separate task `handoff-self-check-evidence` | Ship the self-check alone, measure with `scripts/review-metrics.mjs`, then decide on the map | The human chose this split; the gate is delicate and the map isn't | `Human` |
| Template-mirror and golden-file entries in the map | Not computed | Map each Affected File to its mirror and golden snapshots | Adopters have no `templates/` mirrors (AGENTS.md §Adopter Scope), and no file→golden mapping exists; test files still appear because they reference the module | `Human` |
| Excluding generated files from results | Honor the `linguist-generated` git attribute. canon-ai's `.gitattributes` marks its tracked `dist/` bundle and its managed `templates/` mirrors as generated | A new config key listing excluded globs | A standard attribute adopters may already use, so no new config surface; without it, canon-ai's bundle and mirrors would show in most results as out-of-scope noise | `Human` |
| Test integrity: reasoning or execution | A reasoning check, with an optional cheap base run; red-first ACs keep their executed checkpoint | Require running every changed test against the base | Mandatory execution would put red-first cost on every task and conflict with the red-first contract; the evidence task will record what was checked | `Author` |
| Where the self-check sits | After changes, before validation and the handoff | Just before the handoff instruction | Edits from the restatement and sibling sweeps must be covered by the validation run | `Author` |
| Which prompts get the self-check and the map | Self-check: fresh, park-resume, revision, reroute. Map: fresh, park-resume, reroute. Interrupted resume gets neither | Map in revision prompts too, or the self-check in resume | A revision round's scope is the review findings, which already name the files; interrupted resume authorizes no code changes, so an edit-producing check would contradict it | `Author` |
| Affected Files in the References part | Excluded, as in the identifiers part | List referrers that are themselves Affected Files | They are already in scope and already preloaded, so listing them adds tokens without new surfaces | `Author` |
| Identifier source and order | Backticked tokens in amendments (newest first), Design, then ACs, filtered by shape | All backticked tokens anywhere in the spec | Problem and Known Risks cite incidental symbols; amendment tokens are the newest contract and must survive the cap | `Author` |
| Failure behavior | Omit the block and continue | Fail the phase | The map is advisory context, not a gate | `Author` |
| Test seam for prompt goldens | A test-only env override for the map's repository root, in the existing `CANON_PATTERNS_MD_PATH` style, pointed at a fixture git repository | Inject a cwd parameter through `promptImplement` | The golden harness already uses this override style; threading a parameter through every implement wrapper widens the change | `Author` |

## Non-Goals

- No new handoff section, checkbox, or pre-flight check. That belongs to `handoff-self-check-evidence`.
- The map is not a scope allowance. Edits outside Affected Files remain Blockers.
- No language-aware import graph, AST parsing, or new dependency. Detection is text matching over tracked files.
- No change to `buildKnownPitfalls`, `buildKnownRisks`, or `buildContextBlock` output. Path-scoped pitfalls are the separate task `path-scoped-pitfalls`.
- No change to the plan, code-review, or QA prompts.
- No new user-facing environment variable or `.canon/config.json` key. The test-only override from Judgment Calls is the one exception.

## Acceptance Criteria

- [ ] AC-1: The rendered prompts from `promptImplement` (fresh), `promptImplementParkResume`, `promptImplementRevisions`, and `promptImplementReroute` each contain the self-check block. In the fresh and reroute prompts it appears before the validation instruction. In the revision prompt it appears before the per-round steps. The block lists test integrity, then restatement sweep, then sibling parity, and states that an edit needed outside Affected Files is recorded as a Blocker. The `promptImplementResume` output does not contain the block. Verify with a prompt-builder test asserting presence, order, and placement for each prompt and absence for resume, plus the golden snapshots.
- [ ] AC-2: The self-check block and the map's framing are adopter-neutral and role-neutral. They contain none of `src/`, `scripts/`, `tests/`, `templates/`, `Codex`, or `Claude`. Verify with a test over the rendered block and framing text, for both providers.
- [ ] AC-3: A new builder produces the blast-radius block. It obtains Affected Files through `extractAffectedFiles` (no second spec parser). In a temporary git repository fixture with Affected Files `lib/foo.ts` and `lib/bar.ts`, the References part lists:
  - a tracked file that imports `./foo.js`;
  - a tracked file that imports `../lib/foo`;
  - a tracked doc that mentions `foo.ts`.
  
  It does not list a file that only contains the word `foo`, `lib/foo.ts` itself, or `lib/bar.ts` even though `lib/bar.ts` imports `./foo.js`. Verify with a unit test.
- [ ] AC-4: In the same kind of fixture, a spec whose Design or ACs mention `` `parseWidget()` `` and `` `--dry-run` `` produces an identifiers part listing the tracked files outside Affected Files that contain `parseWidget` (including a call site `parseWidget(x)`) and `--dry-run`. Files inside Affected Files, including files under a directory entry ending in `/`, are excluded. Path tokens (`` `lib/foo.ts` ``) and plain lowercase words (`` `true` ``) are not searched. A token that appears only in an `## Amendment` section is searched. Verify with unit tests.
- [ ] AC-5: Results exclude task artifacts under `tasks/` and any tracked file whose `linguist-generated` attribute is set. Verify with a fixture test that marks one matching file `linguist-generated` in `.gitattributes`, asserting it is absent while an unmarked matching file is present.
- [ ] AC-6: The block is bounded:
  - each entry lists at most a fixed number of files, then `+N more`;
  - the token count has a fixed cap, and amendment tokens are kept ahead of Design and AC tokens;
  - the whole block stays under a fixed byte cap, and a truncation line reports entries dropped to stay under it.
  
  Verify with fixture tests: one whose identifier matches more files than the per-entry limit (asserting `+N more`), one with more tokens than the cap where the only amendment token survives, and one exceeding the byte cap (asserting the truncation line and the length bound).
- [ ] AC-7: The block's framing text says the listed files are surfaces to check for restatements and sibling paths, and that editing a file outside Affected Files still requires a Blocker. Verify by asserting the framing sentence in the golden `promptImplement_fresh` snapshot.
- [ ] AC-8: When there is nothing to report, the builder returns an empty string and the prompt has no blast-radius heading. The same happens when the root is not a git repository or a git command fails, and the builder does not throw. Verify with unit tests: an empty fixture, and a non-git directory.
- [ ] AC-9: The builder takes the repository root as an explicit argument, and `promptImplement` and `promptImplementReroute` pass the active checkout (`getActiveCwd`) unless the test-only override is set. All git commands run with that root as their working directory (a cwd-taking helper such as `gitSafeAt`, never the REPO_ROOT-bound `git()` or `gitSafe()`). Verify with a unit test passing a fixture path where a matching file exists only there, and by code review of the call sites.
- [ ] AC-10: The map appears in `promptImplement` (fresh) and `promptImplementReroute` output, and not in any `promptImplementRevisions` output or in `promptImplementResume` output. The prompt goldens point the test-only override at a fixture git repository created by the test, so they don't depend on canon-ai's own tree. Verify via golden snapshots for `promptImplement_fresh` and `promptImplementReroute` (heading present), the revision keys (absent), and a resume prompt assertion (absent). Also verify that a second plain `npm test` run after `UPDATE_GOLDENS=1` passes unchanged.
- [ ] AC-11: canon-ai's root `.gitattributes` marks `dist/**` and the `templates/` mirror paths of the canon-managed files (`templates/.canon/**`, `templates/.claude/**`, `templates/docs/pipeline-orchestrator.md`, `templates/scripts/**`) as `linguist-generated`. It does not mark the init scaffolds under `templates/docs/` other than `pipeline-orchestrator.md`. Verify with `git check-attr linguist-generated` printing `set` for `dist/cli/index.js` and `templates/.canon/templates/spec.md`, and `unspecified` for `templates/docs/patterns.md`.
- [ ] AC-12: `docs/pipeline-orchestrator.md` (and its mirror) gains a short note that the implement prompt lists files referencing the Affected Files and files containing spec-named identifiers, and that tracked generated output is excluded only when marked `linguist-generated` in `.gitattributes`. Verify by reading the doc and with `npm run sync-templates:check`.
- [ ] AC-13: The golden prompt snapshots are regenerated with `UPDATE_GOLDENS=1 npm test`, and the full suite passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/blast-radius.ts` | New module: builds the blast-radius block (references part, identifiers part, exclusions, caps, fail-open) |
| `src/orchestrator/prompts/index.ts` | Wire the block into `promptImplement` (fresh and park-resume) and `promptImplementReroute`; omit the self-check and map for `promptImplementResume` |
| `src/orchestrator/prompts/templates/implement.md` | Self-check block before the validation instruction (conditional so resume omits it); placeholder for the blast-radius block |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Same self-check block before validation; placeholder for the blast-radius block |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Same self-check block before the per-round steps (no map) |
| `tests/blast-radius.test.ts` | New unit tests for AC-3 through AC-6, AC-8, AC-9 |
| `tests/run-task-prompts.test.ts` | Fixture git repository and override for goldens; self-check presence/order/absence and neutrality assertions (AC-1, AC-2, AC-10) |
| `tests/run-task-prompts.golden.json` | Regenerated snapshots |
| `.gitattributes` | New: mark `dist/**` and the managed `templates/` mirror paths as `linguist-generated` |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Note on the map and the `linguist-generated` exclusion |
| `docs/codebase-map.md` | Row for the new module |
| `dist/` | Rebuilt bundle (prompt templates are bundled by tsup; `dist/` is tracked) |

### Implementation Notes (non-binding; plan and implement own these)

- Use `git grep -l -I` in the root. Use `-F -w` for identifiers, after stripping a trailing `()`. Filter by attribute with `git check-attr --stdin linguist-generated`. Both run through a cwd-taking helper.
- A module-specifier match can be a pattern on `/<stem>` followed by an optional extension and then a quote. Plan may choose another approach that satisfies AC-3, and may skip the stem match for generic stems (`index`, `types`) while keeping the file-name match.
- Pick the per-entry limit (around 10 files), the token cap (around 20), and the byte cap (around 6 KB) in plan.
- Bundles: union the Affected Files across tasks for exclusion, and gather tokens per task.
- A mustache section flag (for example `{{#selfCheck}}`) lets `implement.md` omit the block in resume mode.

### Interaction Dependencies

- `extractAffectedFiles` / `parseAffectedFilesFromSpec` is the only source of Affected Files.
- `toResumePrompt` strips startup blocks by exact match. The self-check sits outside the startup block, so stripping is unaffected; the resumed reroute golden confirms it.
- An existing test asserts that implement prompts rendered for the Claude provider never contain `Codex` (`tests/run-task-prompts.test.ts`). AC-2 keeps the new text compatible.
- `handoff-self-check-evidence` (follow-up) will reword the self-check to record evidence in the handoff. Keep the block self-contained, one copy per template.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

- `docs/pipeline-orchestrator.md` and `docs/codebase-map.md` (in Affected Files).
- `docs/architecture.md`: the implement step description may want a mention. QA checks it.

## Known Risks

- **Noise.** Short or common stems can reference-match many files. The per-entry cap and the optional generic-stem skip bound this.
- **Token over-extraction.** ACs cite existing symbols they don't change. Listing those files costs only tokens, because the framing says "check", not "edit".
- **Scope pressure.** A visible list of files outside Affected Files may tempt edits. The block's framing, the self-check's Blocker rule, and code review's Affected Files pre-flight counter this.
- **Performance.** One `git grep` per token. The token cap keeps prompt build fast.
- **Worktree view mismatch.** The existing Relevant Files preload reads Affected Files from the main checkout, while the map reads the active checkout. In a worktree run the two blocks can disagree for files changed on the task branch. This task does not change the preload.
- **Golden drift.** Every implement golden changes once. Review the regenerated diff for unintended changes. The fixture repository keeps later runs stable.

## Human Test Plan

1. Start a pipeline run for a small task whose spec names a function that other files also use.
2. Open the implementer's prompt in the run log.
3. Expected: a short list of files that reference the changed file, a short list of other files that use the named function, and a reminder that editing those files still needs a Blocker.
4. Expected: after making changes and before validating, the prompt asks the implementer to check test integrity, then restatements, then sibling paths.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, with one file per row. Each row has a specific change description.
- [x] Plan steps (fast tier) reference actual function/file names from the codebase (N/A: full tier)
- [x] If this spec replaces existing behavior: frame it as one replacement (N/A: additive)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions are backed by ACs (AC-3, AC-7, AC-10)
- [x] Symbols named in ACs actually exist in the codebase (`promptImplement`, `promptImplementParkResume`, `promptImplementResume`, `promptImplementRevisions`, `promptImplementReroute`, `getActiveCwd`, `extractAffectedFiles`, `gitSafeAt` grep-verified)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A: feature
- [x] (Refactors) N/A: feature
- [x] *Judgment Calls* lists every judgment call the spec makes
