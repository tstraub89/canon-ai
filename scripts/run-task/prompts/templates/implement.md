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

Run ALL applicable validation checks before writing handoff. See "Validation Required" in each spec.md and the matrix in AGENTS.md. Required checks must be recorded as Pass or Fail; do not mark a required check N/A unless the spec explicitly removed it.

**Test flakiness in your sandbox.** Validation suites — especially E2E or integration tests — can hit transient failures (timing races, environment quirks, network jitter) that have nothing to do with the code in your spec's Affected Files. **If a failure is in a test / file outside your Affected Files table, do NOT fix it.** Note the observed test name, file, line, and a one-line repro hint in handoff.md → Blockers (or "Validation Outcomes" Notes column with status `Fail – unrelated`), then continue. `Fail – unrelated` is only valid for failures in files outside your Affected Files; a failure in a file you changed is yours to fix. Scope discipline > fixing adjacent bugs you spot during validation. The reviewer/operator will decide whether to triage the unrelated failure separately.

For each task, write tasks/<id>/handoff.md using the template. The Validation Outcomes table must have no Fail results EXCEPT for unrelated-flake rows clearly labeled in the Notes column.
Append to tasks/<id>/notes.md for any surprising codebase behavior (prefix: [implement]).

When done, run:
{{{phaseCommands}}}
