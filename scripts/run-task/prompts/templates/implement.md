You are implementing {{taskScope}} for {{projectName}}.

{{{stateHeader}}}
{{{startup}}}
{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}
{{{affectedFilesBlock}}}
Tasks to implement:
{{{taskLines}}}{{#isBundle}}
These tasks are related — implement them together. Consider shared code paths and cross-task interactions.{{/isBundle}}

Grounding rule: before you write handoff.md, re-open the files you changed and verify the current diff against the spec. Do not treat a previous session's memory as proof that the work is already in place.

**Spec ACs are binding. Plan approach is guidance.**
- Every Acceptance Criterion in spec.md MUST be met — these are non-negotiable.
- If you find a better implementation approach than what's in the plan, use it. Document every deviation in handoff.md under "Deviations" with specific rationale.
- You may NOT silently drop an AC, skip a required validation check, or omit a spec requirement.
- If an AC is infeasible as written, document it in Blockers — do not silently skip.
- If an AC is ambiguous enough that two reasonable implementations exist, document your interpretation in handoff.md under Blockers with label `[ambiguity]` — do not silently guess. Claude will evaluate whether the interpretation was correct.

## Implementation Rules

**Safe-First Rules** — always applicable regardless of stack:
1. For storage, reload, sync, or data-affecting flows: ship the safer guarded behavior first.
2. Behavior that reloads the app, replaces local state, or dismisses user work must be gated by explicit user action.
3. Prefer shared types over duplicating signatures.

**Scope Discipline** — always applicable; the spec is the contract:
1. **Affected Files is the scope cap.** If satisfying an AC genuinely requires editing files outside the spec's *Affected Files* table, stop, document the gap in `handoff.md` under *Blockers*, and surface it for human attention. Do not silently expand scope.
2. **No unauthorized new abstractions.** Do not introduce new top-level modules, services, packages, or routing layers that the spec did not authorize. Minor refactors within an authorized file are fine; new abstractions are an architecture decision and belong in the spec.
3. **No incidental dependency changes.** Do not add, remove, upgrade, or downgrade dependencies (or their pinned versions) unless the spec explicitly requests it.

**Lint & Type Safety Policy** — always applicable:
1. **Suppressing a lint or type error is a last resort**, not a convenience escape hatch. Never add a suppression without a same-line justification explaining *why the rule is wrong for this specific case*.
2. **`any` / dynamic typing**: When the shape is truly unknown at the boundary, type as `unknown` and narrow explicitly.

**Parsing Structured Input** — always applicable when implementing a parser for author-facing structured input:
Parse cell-by-cell with explicit rejection, not a permissive whole-string regex. Anchor each cell to exactly one expected shape and reject malformed cells with a specific reason at the parse boundary.

Run ALL applicable validation checks before writing handoff. See "Validation Required" in each spec.md. The universal change-type → check-category matrix:

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

For which command runs each category: see `docs/architecture.md` §Validation (project command bindings). Required checks must be recorded as Pass or Fail; do not mark a required check N/A unless the spec explicitly removed it.

**Test flakiness in your sandbox.** Validation suites — especially E2E or integration tests — can hit transient failures (timing races, environment quirks, network jitter) that have nothing to do with the code in your spec's Affected Files. **If a failure is in a test / file outside your Affected Files table, do NOT fix it.** Note the observed test name, file, line, and a one-line repro hint in handoff.md → Blockers (or "Validation Outcomes" Notes column with status `Fail – unrelated`), then continue. `Fail – unrelated` is only valid for failures in files outside your Affected Files; a failure in a file you changed is yours to fix. Scope discipline > fixing adjacent bugs you spot during validation. The reviewer/operator will decide whether to triage the unrelated failure separately.

For each task, write tasks/<id>/handoff.md using the template. The Validation Outcomes table must have no Fail results EXCEPT for unrelated-flake rows clearly labeled in the Notes column.
Append to tasks/<id>/notes.md for any surprising codebase behavior (prefix: [implement]).

When done, run:
{{{phaseCommands}}}
