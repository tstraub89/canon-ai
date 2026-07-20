{{{iterBanner}}}

{{{stateHeader}}}
{{{startup}}}

{{{affectedFilesBlock}}}

{{#hasReviewFindings}}
Your prior iteration shipped; the reviewer (Claude) appended findings to `review.md` as `## Round {{priorRound}}`. If you're resuming the prior session, the full task framing (spec, plan, repo conventions) is already in context — skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and `tasks/<id>/plan.md` before addressing findings.

Tasks with new review feedback:
{{{reviewLines}}}

For each task:
1. Read the most recent `## Round {{priorRound}}` section of `tasks/<id>/review.md`. That is the entire scope of this iteration.
2. Address every `correctness bug`, `risk/guardrail`, and `spec gap` finding from that round (blocking). `optional cleanup/nit` is at your discretion{{#tightenLine}}{{{tightenLine}}}{{/tightenLine}}
3. Re-run only the validation checks affected by your changes (typically lint, type-check, plus whatever the diff touches).
4. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}` (the template's "On revision rounds" comment shows the shape). Do NOT rewrite the file from scratch — earlier iterations stay as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation results.
{{/hasReviewFindings}}
{{#hasPreflightFindings}}
Your prior iteration was rejected by the orchestrator's pre-flight gate **before any Claude review ran**. The rejection details are recorded in `review.md` under `## Validation Gate` / `## Pre-Flight Rejection`.

Tasks with pre-flight rejection feedback:
{{{reviewLines}}}

For each task:
1. Read the pre-flight block in `tasks/<id>/review.md` and follow **whichever framing it carries**:
   - **"Fix the handoff"** items → fix `handoff.md` (Validation Outcomes rows, AC Coverage table, Changes table).
   - **"Fix the code"** items → a required check failed on a file you changed. Fix the regression, re-run the check, and update the handoff.
   - Both framings may be present — address all items from both before resubmitting.
2. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}`. Include the delta: which items you addressed and how.
{{/hasPreflightFindings}}

Spec ACs remain binding. If the review identifies a dropped AC, restore it.

**Iteration rules:**

- **Reverting a file**: For a byte-perfect revert to the task baseline, use `git show origin/<base-branch>:<path>` (read-only git, always allowed) and write the output to the file.
  - *Perfect revert* (file no longer in `git diff base...HEAD`): delete it from all prior iteration Changes tables in `handoff.md`.
  - *Imperfect revert* (trailing newline or other residual remains): add it to the current iteration's Changes table with "Reverted to original (describe residual diff)".
- **Referencing deleted (or not-yet-created) files in artifacts**: `docs-refs-check` flags a backtick path-ref to a file that does not exist. Referencing deleted paths in the handoff Changes-table first column must use `[path](path)` markdown-link form only — backtick form fails both checks.
- **Rerouted / revised tasks — the pre-flight diff is cumulative**: the verifier checks the union of all Changes tables against `git diff <base>...HEAD`. Before submitting, run `git diff <base>...HEAD --name-only` and confirm every listed path is covered by at least one Changes-table row across ALL iterations.
- **Bug/flake-fix red-first checkpoint**: if this round adds or modifies the spec's red-first regression test, write and run the test **before** making this round's fix edits and confirm it fails *for the reason the spec states*; then apply the fix and confirm it passes. Report the red run in the handoff delta. If it cannot be made to fail for that reason, stop and record a `[wrong-premise]` Blocker in handoff.md — do not implement around an unconfirmed premise. If the spec instead uses the environment-bound-and-impractical escape, run its named deterministic alternative if it is executable in your sandbox and report the outcome in the handoff delta; if it is not executable (e.g. a documented manual repro), state that instead — never report an outcome for a run that did not happen.

Append to `tasks/<id>/notes.md` for new pitfalls found (prefix: `[implement-revision]`).

When done, run:
{{{phaseCommands}}}
