# Spec: post-ship-cleanup — Trivial leftovers from three shipped tasks

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

`implementer-blast-radius-map` (PR #156), `handoff-self-check-evidence` (PR #158) and `path-scoped-pitfalls` (PR #160) shipped with review nits, bot comments and QA follow-ups that are small, independent and still present on `main`. Each item below was checked against current `main`. Each is a bug fix with a deterministic mechanism confirmed by reading the cited code; behavioral items get a test that fails on current `main`.

## Decision

Fix these items, each in place. No item changes a prompt's structure or a phase's routing.

**Blast-radius map (`src/orchestrator/blast-radius.ts`).**
- B1. Spec identifier extraction treats the literals and status words `True`, `False`, `None`, `Null`, `Pass`, `Fail`, `Done`, `Todo`, `Note`, `Approved` and `Blocked` as identifiers, since the single-capitalized-word rule (`/^[A-Z][a-z0-9]+$/`, line 39) admits them. Add a small stoplist, compared case-sensitively against the exact token, so these are never search tokens. `Widget` stays a token.
- B2. `/[A-Z]{2,}[a-z]/` admits acronym plurals (`IDs`, `URLs`, `PRs`, `APIs`). Require at least two lowercase letters after the capitals, so `URLParser` and `HTMLElement` still qualify and the plurals do not.
- B3. `gitGrep` reads any non-zero exit with empty stderr as "no matches". Only exit status 1 returns no matches; any other status that is not 0 (including a `null` status from a signal) throws, even with empty stderr. The existing fail-open behavior of the map's caller is unchanged.
- B4. The pipeline telemetry files (`PIPELINE_TELEMETRY_FILES` in `src/orchestrator/worktree.ts`: `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`) are excluded from reference and identifier hits, as `tasks/` already is.
- B5. The fail-open test in `tests/blast-radius.test.ts` gains a positive control: when its shim passes every call through, the block is non-empty.

**Self-Check evidence (`src/orchestrator/validation.ts`, `checkSelfCheckEvidence`).**
- S1. Placeholder detection only catches an Evidence cell starting with `_(`. A placeholder wrapped in other markup (`**_(…)_**`, `` `_(…)` ``) passes as filled. Treat the cell as the placeholder when its markup-stripped text (the existing `bare`) starts with `(` and ends with `)`. Also reject an Evidence cell containing the literal `<reason>` (a copied `N/A — <reason>`), with a message telling the implementer to give the reason.
- S2. Stale references: `docs/patterns.md` (three places), `docs/codebase-map.md` and `docs/product-context.md` name `validateHandoff()` as the per-task validation entry point, and the comment above `checkImplementEvidence` in `src/orchestrator/main.ts` says "validateHandoff passes" and describes an AC Coverage check, while the code calls `validateHandoffAgainstSpec`, which only classifies the required validation checks. Correct the comment's name and description to what the code does. In `docs/patterns.md` and `docs/product-context.md`, where text tells the reader to add or find per-task checks, name the live gate `classifyPreflightBlockers` and note that `validateHandoff()` is its test-parity function to keep in step. The `docs/codebase-map.md` row that describes `validateHandoff()` test cases may stay if it is accurate. The `templates/docs/` copies of these docs carry no such reference.

**Pitfall selection (`src/orchestrator/pitfalls.ts`) and its docs.**
- P1. `isSeparatorRow` requires three or more dashes per cell. Accept one or more (`:?-+:?`), matching GFM and the sibling table parsers.
- P2. `CANON_PATTERNS_MD_PATH` uses `??`, so an empty value reads `''` as the patterns path and drops `docs/patterns.md`. Treat an empty value as unset, like `CANON_PITFALLS_DOCS_ROOT`.
- P3. The scaffold's example pitfall in `templates/docs/patterns.md` cites `app/src/store/**`, a path real adopters can have, so it can be selected as a live entry. Replace the path with one no real project has (for example `example-app/src/store/**`).
- P4. Path-citation syntax is only partly documented. In `docs/patterns.md` "How to use this doc", `templates/docs/patterns.md` "Pitfall format", and the canon-init write guide (root and mirror), state that a path counts only inside backticks or as a markdown link target, a directory prefix needs a trailing `/`, a glob needs `*`, and bare file names never match.
- P5. The `CANON_PITFALLS_DOCS_ROOT` row in `docs/pipeline-orchestrator.md` (and its mirror) also says it roots `docs/patterns.md` when `CANON_PATTERNS_MD_PATH` is unset.
- P7. `README.md` and the two `docs/codebase-map.md` rows (Relevant pitfalls and lessons; Patterns + Known Pitfalls) say a Known Pitfalls section without `###` entries is injected whole except blockquotes. Index tables are also excluded (their rows appear only in the area index). Add that exception, as `docs/patterns.md` and the canon-init write guide already do (Codex P2 deferred from PR #162).
- P6. Add a test that the implement prompt's state header reads `none (spec has no Affected Files table)` (`src/orchestrator/context.ts:104`) for a spec without an Affected Files table. Golden restructuring removed its coverage.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Literal/status words | Fixed exact-token stoplist | Drop the single-capitalized-word rule | The rule was added to catch component names like `Widget` (Codex P2 on PR #156) | `Author` |
| Placeholder shape | Whole cell parenthesized after stripping markup | Match the template's exact placeholder strings | Survives template rewording; real evidence wrapped entirely in parentheses is implausible | `Author` |
| Telemetry exclusion | Reuse `PIPELINE_TELEMETRY_FILES` | A blast-radius-local list | One source of truth for which files the pipeline folds | `Author` |

## Non-Goals

- No `./` handling in blast-radius Affected Files (issue #157, closed as not planned).
- No change to the two-cell rule, heading strictness, or header-less table handling in `checkSelfCheckEvidence`.
- No change to pitfall selection rules beyond P1 and P2 (`pitfalls-coverage-gaps` owns the coverage gaps).
- No adding paths to canon-ai's own Known Pitfalls entries (a lessons/patterns sweep).

## Acceptance Criteria

- [ ] AC-1: B1 and B2. A spec body containing `` `True` ``, `` `None` ``, `` `Pass` ``, `` `IDs` ``, `` `URLs` ``, `` `Widget` ``, `` `URLParser` `` yields tokens `Widget` and `URLParser` only. Verify with a unit test in `tests/blast-radius.test.ts`, failing first on `main`.
- [ ] AC-2: B3. `gitGrep` returns `[]` for a pattern with no matches (status 1), and throws when git exits 2 with empty stderr. Verify with a unit test using a git shim like the existing fail-open shim in `tests/blast-radius.test.ts`, failing first on `main`.
- [ ] AC-3: B4. A reference to an Affected File's stem inside `docs/lessons-learned.md` in a fixture repo does not appear in the map. Verify with a unit test.
- [ ] AC-4: B5. The fail-open test asserts a non-empty block in its pass-through case. Verify by reading the test and running it.
- [ ] AC-5: S1. `checkSelfCheckEvidence` reports the placeholder issue for `**_(…)_**` and `` `_(…)` `` cells, reports the `<reason>` issue for a literal `N/A — <reason>`, and accepts `N/A — no tests changed` and real evidence. Verify with cases in `tests/run-task-validation.test.ts`, failing first on `main`.
- [ ] AC-6: S2. `git grep -n "validateHandoff()" -- docs templates/docs src` returns no hit that presents it as the live per-task check, and the `main.ts` comment names `validateHandoffAgainstSpec` and describes only what it checks. Verify with the grep and by reading.
- [ ] AC-7: P1 and P2. An index table whose separator row is `|-|-|` is parsed. With `CANON_PATTERNS_MD_PATH=""`, `buildRelevantPitfalls` reads `docs/patterns.md` from the docs root. Verify with unit tests in `tests/pitfalls.test.ts`, failing first on `main`.
- [ ] AC-8: P3 to P5 and P7. The docs read as described. Verify by reading, plus `npm run docs-refs-check` and `npm run sync-templates:check`.
- [ ] AC-9: P6. A test in `tests/run-task-prompts.test.ts` asserts that an implement prompt for a spec without an Affected Files table carries the `none (spec has no Affected Files table)` header line. Verify by running it.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/blast-radius.ts` | B1 stoplist, B2 regex, B3 exit status, B4 telemetry exclusion |
| `tests/blast-radius.test.ts` | Tests for B1–B5 |
| `src/orchestrator/validation.ts` | S1 placeholder and `<reason>` checks |
| `tests/run-task-validation.test.ts` | S1 cases |
| `src/orchestrator/main.ts` | S2 comment fix |
| `docs/patterns.md` | S2 references; P4 path syntax |
| `docs/codebase-map.md` | S2 reference; P7 index-table exception |
| `README.md` | P7 index-table exception |
| `docs/product-context.md` | S2 reference |
| `src/orchestrator/pitfalls.ts` | P1 separator, P2 empty env value |
| `tests/pitfalls.test.ts` | P1, P2 tests |
| `tests/run-task-prompts.test.ts` | P6 header test |
| `templates/docs/patterns.md` | P3 example path; P4 path syntax |
| `.claude/skills/canon-init/write-guide.md`, `templates/.claude/skills/canon-init/write-guide.md` | P4 path syntax |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | P5 env row |
| `dist/` | Rebuilt bundle (tracked) |

### Interaction Dependencies

`pitfalls-coverage-gaps` edits `src/orchestrator/pitfalls.ts` and `templates/docs/patterns.md` and ships first; this task starts from the new `main`.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean
- [x] `npm run build`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

The docs in Affected Files.

## Known Risks

- **Stoplist over-reach.** A real identifier named `Note` or `Done` stops being searched; the map is advisory.
- **Placeholder rule.** Evidence written entirely in parentheses is rejected; the message says how to fix it.
- **Acronym shapes.** B2 also drops tokens with one lowercase letter after the capitals (`UUIDv4`); the map is advisory. (Importing `PIPELINE_TELEMETRY_FILES` adds no module edge: `blast-radius.ts` already imports `worktree.ts`.)

## Human Test Plan

1. Run a small task end to end.
2. Expected: the implementer's map of related files no longer lists pipeline log docs or words like "True" as identifiers.
3. Expected: a handoff that leaves the self-check example text in place, even in bold, is sent back.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row
- [x] Plan steps (fast tier) reference actual names (plan phase owns this)
- [x] Replacement framing: N/A, independent fixes
- [x] Non-Goals rules out the tempting expansions
- [x] Symbols named exist (`gitGrep`, `PIPELINE_TELEMETRY_FILES`, `checkSelfCheckEvidence`, `checkImplementEvidence`, `validateHandoffAgainstSpec`, `classifyPreflightBlockers`, `isSeparatorRow`, `buildRelevantPitfalls`)
- [x] Known Risks covers the trickiest items
- [x] Human Test Plan uses product language only
- [x] Validation Required has a checked entry
- [x] (Bug fixes) mechanisms confirmed by code reading; behavioral items are red-first
- [x] (Refactors) N/A
- [x] *Judgment Calls* lists every judgment call
