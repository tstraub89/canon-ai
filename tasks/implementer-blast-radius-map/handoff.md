# Implementation Handoff: implementer-blast-radius-map

> Author: implementer | Spec: `tasks/implementer-blast-radius-map/spec.md` | Plan: `tasks/implementer-blast-radius-map/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `.gitattributes` | Marked bundled output and canon-managed template mirrors as `linguist-generated`. |
| `src/orchestrator/blast-radius.ts` | Added the fail-open, bounded builder for Affected Files references and spec-named identifiers. |
| `src/orchestrator/prompts/index.ts` | Wired the map into fresh, park-resume, and reroute prompts; gated the fresh self-check off for interrupted resume. |
| `src/orchestrator/prompts/templates/implement.md` | Added the conditional self-check and map placeholder. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Added the self-check and map placeholder. |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Added the self-check before revision steps. |
| `tests/blast-radius.test.ts` | Added builder tests for matching, exclusions, bounds, fail-open behavior, and explicit roots. |
| `tests/run-task-prompts.test.ts` | Added fixture-root golden setup and prompt placement, provider-neutrality, and omission assertions. |
| `tests/run-task-prompts.golden.json` | Regenerated implement prompt snapshots. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented the map and generated-file exclusion rule; synchronized the managed mirror. |
| `docs/codebase-map.md` | Added the blast-radius builder entry. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled orchestrator. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Added a bounded names-only blast-radius map to fresh and rerouted implement prompts, plus a pre-handoff self-check to fresh, park-resume, revision, and reroute prompts. The builder gets scope from `extractAffectedFiles`, searches only tracked files in the active checkout, and omits task artifacts and generated files marked by `.gitattributes`.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | Implemented the planned approach. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Prompt tests assert self-check order and placement in fresh, park-resume, revision, and both reroute variants; interrupted resume omits it. |
| AC-2 | Met | Rendered self-checks and map framing are checked for forbidden repo-specific and role-specific terms under both providers. |
| AC-3 | Met | Fixture tests cover both module-specifier forms and a file-name mention, plus plain-word and Affected Files exclusions. |
| AC-4 | Met | Tests cover calls, flags, amendment-only tokens, path/lowercase filtering, and directory-form Affected Files exclusions. |
| AC-5 | Met | A fixture verifies `tasks/` artifacts and a `linguist-generated` match are excluded while an unmarked match remains. |
| AC-6 | Met | Tests cover the 10-file entry limit, 20-token cap with amendment priority, and 6,144-byte block cap with a truncation line. |
| AC-7 | Met | The fresh prompt golden asserts the restatement/sibling framing and Blocker reminder. |
| AC-8 | Met | Empty, non-git, missing-root, and git-failure cases return an empty string; prompt test confirms no heading for a non-git root. |
| AC-9 | Met | Builder accepts an explicit root; the prompt builders use the test override or `getActiveCwd` through `resolveBlastRadiusRoot`. |
| AC-10 | Met | Fresh and reroute goldens contain the map; revisions and interrupted resume omit it; park-resume assertions confirm map inheritance. |
| AC-11 | Met | `git check-attr` returned `set` for `dist/cli/index.js`, the managed template, and the pipeline-doc mirror; `templates/docs/patterns.md` was `unspecified`. |
| AC-12 | Met | Updated the operator documentation and synchronized its managed mirror; sync check passed. |
| AC-13 | Met | Ran `UPDATE_GOLDENS=1 npm test`, then plain `npm test`; both passed and the second run left snapshots unchanged. |

## Edge Cases Considered

- Module-specifier patterns escape stems and match quoted imports with or without a common extension.
- Directory-form Affected Files entries exclude all tracked descendants.
- Amendment sections are searched newest first, ahead of Design and Acceptance Criteria tokens.
- Generated-file checks are chunked; any command or attribute-probe error omits the full map.
- The map is byte-bounded after entry-level truncation and reports omitted entries.

## Blockers

- [ambiguity] The spec says `PascalCase` tokens are searched. A single capitalized identifier such as `Widget` could qualify, while the plan interprets PascalCase as at least two humps. The implementation follows that plan interpretation: a token needs an internal lowercase/digit-to-uppercase transition unless written with `()`. This excludes single-hump PascalCase names to reduce noise.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| _(none — no red-first ACs)_ | | | | |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Passed after applying the repository's `void test(...)` convention to the new fixture tests. |
| `npm run type-check` | Pass | Passed. |
| `npm test` | Pass | `UPDATE_GOLDENS=1 npm test` and the plain second run both passed: 2,083 passed, 1 skipped, 0 failed. The skip was `tests/run-task-safety-staging.test.ts`'s linked-worktree anchor check because `.git/` writes are restricted in this environment. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`. |
| `npm run docs-refs-check` | Pass | Passed after the implementation handoff was written. |
| `npm run sync-templates:check` | Pass | Managed documentation mirror is synchronized. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration, or a comma-separated list when files are tightly coupled — see the baseline Changes note for grouping guidance and token format. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. (Deleted files: `[path](path)` markdown-link form only.)

| File | What Changed |
|---|---|

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Red-First Evidence

_Include only when this round adds or changes a red-first test or adds missing evidence._

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/blast-radius.ts` | Accepted acronym-led PascalCase identifiers and marked the root override as test-only. |
| `tests/blast-radius.test.ts` | Exercised rendered neutral output, mid-build Git failures, retained byte-cap entries and exact omission counts, and acronym-led identifier searches. |
| `tests/run-task-prompts.test.ts` | Added parity assertions for the three numbered self-check items across fresh, reroute, and revision prompts. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Moved the map note beside prompt iteration guidance and included park-resume prompts. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled identifier-shape update. |

### Findings addressed

- _correctness bug:_ Finding 1 — the neutrality test now checks a non-empty block from `buildBlastRadiusBlock`, including both subsections and the truncation line (`tests/blast-radius.test.ts:327`).
- _risk/guardrail:_ Finding 2 — fake Git delegates repository detection, then fails `grep` and `check-attr` separately; each path asserts an empty result without throwing (`tests/blast-radius.test.ts:251`).
- _risk/guardrail:_ Finding 3 — the size-bound test requires surviving entries and verifies the omitted count against the 20-entry fixture (`tests/blast-radius.test.ts:228`).
- _correctness bug:_ Finding 4 — acronym-led PascalCase names are recognized and searched, with `URLParser`, `JSONValue`, and `HTTPServer` fixture coverage (`src/orchestrator/blast-radius.ts:36`, `tests/blast-radius.test.ts:134`). The accepted single-hump interpretation in the existing `[ambiguity]` Blocker remains unchanged.
- _optional cleanup/nit:_ Finding 5 — the doc note now covers fresh, park-resume, and rerouted prompts beside prompt iteration guidance (`docs/pipeline-orchestrator.md:515`).
- _optional cleanup/nit:_ Finding 6 — the root override constant is explicitly commented as test-only (`src/orchestrator/blast-radius.ts:10`).
- _optional cleanup/nit:_ Finding 7 — a rendered-prompt test compares all three numbered self-check items byte-for-byte (`tests/run-task-prompts.test.ts:497`).
- _optional cleanup/nit:_ Finding 8 deferred — the reviewer rated the empty-stderr/non-zero `git grep` distinction low-confidence and impractical to address through `gitSafeAtRaw`, which does not expose exit status. The current map continues to omit on reported Git errors.

### AC deltas

- AC-2: the previously vacuous neutrality assertion now checks actual rendered map output, including subsection headings and truncation text; prompt tests continue checking both providers.
- AC-4: added extraction and file-search coverage for acronym-led PascalCase identifiers.
- AC-6: byte-cap coverage now proves entries survive and the truncation count matches omitted entries.
- AC-8: added fail-open coverage for `git grep` and `git check-attr` failures after repository detection succeeds.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`. |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/blast-radius.test.ts tests/run-task-prompts.test.ts` | Pass | 84 tests passed; 0 failed or skipped. |
| `npm run docs-refs-check` | Pass | All repository references are valid. |
| `npm run sync-templates:check` | Pass | Managed documentation mirror is synchronized. |
