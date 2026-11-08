# Completion Summary: implementer-blast-radius-map — Implementer pre-handoff self-check and blast-radius map

> For the human. This is what you need to know.

## What Changed

The implementer now gets two things it did not have before. First, a short self-check that runs after its edits and before validation and the handoff: it asks whether each new test would fail if the change were reverted, whether every other place that restates a changed contract was updated, and whether the parallel paths of each new guard were handled. Second, on fresh and rerouted implement runs, a list of surfaces to check: files that reference the task's Affected Files, and files that contain the identifiers and flags the spec names. The list is paths only, capped in size, and it omits generated files. It is a list to check, not permission to edit. Any edit outside Affected Files is still recorded as a Blocker. The self-check is also added to revision and park-resume prompts, and interrupted-resume prompts get neither piece because they authorize no code changes.

The motivation is the three failure classes that repeat in first-round code review: weak test integrity, restatement drift, and sibling asymmetry.

## Files Changed

- `.gitattributes` — new; marks `dist/**` and the managed `templates/` mirror paths as `linguist-generated`.
- `src/orchestrator/blast-radius.ts` — new; builds the blast-radius block (references and identifiers parts, exclusions, caps, fail-open).
- `src/orchestrator/prompts/index.ts` — wires the self-check and map into the implement prompt builders.
- `src/orchestrator/prompts/templates/implement.md` — self-check block (gated for fresh and park-resume) and map placeholder.
- `src/orchestrator/prompts/templates/implement-reroute.md` — self-check block and map placeholder.
- `src/orchestrator/prompts/templates/implement-revisions.md` — self-check block before the revision steps.
- `tests/blast-radius.test.ts` — new; builder tests for matching, exclusions, caps, fail-open, and explicit roots.
- `tests/run-task-prompts.test.ts` — fixture-repository golden setup; self-check order, placement, and absence; neutrality and parity checks.
- `tests/run-task-prompts.golden.json` — regenerated implement prompt snapshots.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — note on the map and the `linguist-generated` exclusion (mirror kept in sync).
- `docs/codebase-map.md` — row for the new builder.
- `dist/orchestrator/run-task.js` — rebuilt bundle.

## How to Test

1. Start a pipeline run for a small task whose spec names a function that other files also call.
2. Open the implementer's prompt in the run log.
3. Expected: a "files referencing Affected Files" list and a "files containing named identifiers" list, both excluding the Affected Files themselves, with a reminder that editing a listed file outside Affected Files needs a Blocker.
4. Expected: the self-check appears after the change-making instructions and before validation, in this order: test integrity, restatement sweep, sibling parity.
5. Expected: a resume prompt for an interrupted run contains neither the self-check nor the map.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — full suite on the first iteration: 2,083 passed, 1 skipped, 0 failed. The second iteration re-ran only the two touched test files (84 passed). |
| `npm run build` | Pass |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| Skipped: `tests/run-task-safety-staging.test.ts` linked-worktree anchor check | Skipped in this environment (`.git/` writes are restricted). Not counted as a pass. |

Note: the full suite was not re-run by the implementer after the second iteration. The cold Codex review lens reports that the full suite passed on the final head (`4cb093c`).

## Human Verification Required

None. No validation check is `human_pending`.

Pre-merge checklist items QA could not confirm:

- [ ] Version correct — the release step decides the bump; not decided here.
- [ ] Changelog updated — proposed entry below; the human finalizes it.
- [ ] PR body current — drafted at `tasks/implementer-blast-radius-map/pr-body.md`; re-check at `--pr`.
- [ ] Final CI/CD checks green — not run by QA.
- [ ] Final diff matches spec intent — human review, including Open Questions 1–3.

## Proposed Changelog

- **Implementers self-check before handoff, and see the files a change can reach.** Implement prompts now ask the implementer to check its new tests for integrity, sweep for other places that restate a changed contract, and check the parallel paths of each new guard, all before validation and the handoff. Fresh and rerouted implement prompts also list the files that reference the task's Affected Files and the files that contain the identifiers and flags the spec names. Both lists are bounded, and files marked `linguist-generated` in `.gitattributes` are left out. The lists are for checking; editing a file outside Affected Files still requires a Blocker.

## Judgment Calls to Confirm

- Test integrity is a reasoning check, not a required run — chosen: reason through each new test, with an optional cheap base run; red-first ACs keep their executed checkpoint. Alternative: run every changed test against the base.
- Self-check placement — chosen: after changes, before validation and the handoff, so sweep edits get validated. Alternative: just before the handoff instruction.
- Prompt coverage — chosen: self-check in fresh, park-resume, revision, and reroute; map in fresh, park-resume, and reroute; interrupted resume gets neither. Alternative: map in revision prompts too.
- Affected Files in the references list — chosen: excluded, since they are already preloaded. Alternative: list referrers that are themselves Affected Files.
- Identifier source and order — chosen: backticked tokens from amendments (newest first), then Design, then Acceptance Criteria, filtered by shape. Alternative: all backticked tokens anywhere in the spec.
- Failure behavior — chosen: omit the block and continue. Alternative: fail the phase.
- Test seam — chosen: test-only override `CANON_BLAST_RADIUS_ROOT` for the golden fixture. Alternative: pass a cwd parameter through `promptImplement`.

## Decisions Made

- Identifier shape: a token counts as PascalCase when it has an internal lowercase- or digit-to-uppercase transition, or an uppercase run followed by a lowercase letter (`URLParser`, `JSONValue`, `HTTPServer`). Single-hump names such as `Widget` are not searched unless written with `()`. The round-1 review found acronym-led names were being dropped; the fix added them.
- Caps: 10 files per entry, 20 tokens, 6,144 bytes for the whole block. Paths are passed to `git check-attr` in chunks of 200, because the spec's `--stdin` form cannot be used with the existing git helpers.
- Any git failure during map building omits the block rather than failing the prompt.
- The test-only override `CANON_BLAST_RADIUS_ROOT` is honored unconditionally in code; only the comment marks it test-only (see Open Questions 3).
- The round-1 nit that `gitGrep` treats a non-zero exit with empty stderr as "no matches" was deferred as optional; the practical risk is low.
- Docs freshness: checked `docs/architecture.md`'s implement-step description; nothing it says is contradicted, so no edit was made.

## Open Questions

1. **Single-hump PascalCase names are not searched** (`Widget` is skipped, `Widget()` is searched). Recorded as an `[ambiguity]` Blocker in `tasks/implementer-blast-radius-map/handoff.md`. Confirm this reading or widen the shape.
2. **New Affected Files get no references list.** The spec says to list referrers only for Affected Files that exist as regular files in the active checkout. A task that creates a new module and already has files importing its path gets no references list. The cold Codex lens raised this as a P2 and it was dismissed as spec-intended. It may deserve a follow-up spec.
3. **`CANON_BLAST_RADIUS_ROOT` is a real environment variable** that adopters can set. The spec sanctioned it as a test-only seam, but nothing enforces that. Confirm it can stay, or gate it.
4. **Round-2 nits left open** (the verdict was approved with nits): (a) `/[A-Z]{2,}[a-z]/` also matches plurals such as `IDs` and `URLs`, which the reviewer suggested tightening to `/[A-Z]{2,}[a-z]{2,}/`; (b) the fail-open test has no positive control; (c) the omitted-count assertion uses `TOKEN_CAP` rather than `tokens.length`; (d) the iteration heading says "round 1" where the template expects "Iteration 1" (cosmetic). These are not blocking.
5. **Pipeline telemetry docs can appear as noise entries.** Flagged by review as a follow-up; deliberately not changed here, since the spec's exclusion list is exact.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 1
- Validation gaps: 1
- Notes: Code review round 1 returned changes_requested on test-integrity gaps (AC-2 partial) and acronym PascalCase; round 2 approved with nits, and the remaining nits are listed in Open Questions.

## Root Cause

- execution: the AC-2 neutrality test asserted hand-typed literals rather than rendered output, so a non-neutral heading would have passed.
- execution: the fail-open test only exercised the early `rev-parse` return, so the outer catch on the grep and attribute-check throws was untested.
- execution: the byte-cap test asserted only the length bound and a truncation line, so it would pass even if every entry were dropped.
- context-conflicting: "PascalCase" in the spec was undefined for acronym-led names; the plan's reading and the first implementation's shape check missed `URLParser`, `JSONValue`, and `HTTPServer`.

Maintenance: lessons-learned.md plus this task's fragment have 31 entries (30 `### ` headings in docs/lessons-learned.md plus 1 in `tasks/implementer-blast-radius-map/lessons.md`); a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
