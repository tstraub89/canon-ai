You are writing QA summaries for {{taskScope}} for {{projectName}}.

{{{startup}}}

Tasks:
{{{taskLines}}}

For each task:
1. **Use the Write tool** to create tasks/<id>/done.md — plain-English summary for the human. Include: what changed, files changed, how to test, test results, human verification required, decisions made, open questions.
   ⚠️ CRITICAL: Use the `Write` tool — do NOT simply output the done.md content as text in your response. Content in your chat reply does not get saved to disk. The pipeline validates that done.md contains real content (not the template) before advancing. Write the file.
2. Read the latest `## Validation Outcomes` table in `tasks/<id>/handoff.md`, including any later iteration `### Re-run validation` tables. If any check's latest result is `human_pending`, include a **Human Verification Required** section in done.md that lists each pending check and its Notes. If none remain, write `None.` in that section. Do not hide `human_pending` checks inside the generic Test Results table.
   - If the human chooses to waive or defer a pending check later, the waiver line in done.md must begin with `Acknowledged:`. The `human_review` gate only treats that explicit prefix as a waiver.
   - Preserve `deferred_by_spec` rows in Test Results with the spec citation from Notes; do not translate them to `Pass`.
3. Include a **Proposed Changelog** section in done.md:
   - Read AGENTS.md §"Release Rules" for the project's changelog audience and SemVer interpretation before writing. Apply the project's defined scope.
   - If CHANGELOG.md exists, read the top of it (the most recent version section) to calibrate on scope and voice.
   - Apply the "would a user notice" test to every candidate bullet (or the project's equivalent scope test): if a candidate falls outside the project's defined changelog scope, omit it. If a task is entirely out of scope, say so explicitly ("no user-facing change — omit from changelog") rather than inventing a bullet.
   - Implementation mechanics belong in the "What Changed" section above — not in the proposed changelog.
   - Proposed version bump per the project's SemVer interpretation, with brief rationale.
   The human finalizes both.

After writing all done.md files:
- Read tasks/<id>/notes.md for each task. For each insight, ask: "would this have changed how a *different* task was approached?" Only write to docs/lessons-learned.md if yes. Task-specific details stay in notes.md only.
- Append one row per task to docs/task-quality-log.md (see that file for column definitions).
- **Docs freshness**: scan the protected docs in AGENTS.md (architecture.md, codebase-map.md, patterns.md, product-context.md, decisions.md) for anything contradicted by {{docsScope}}. Update stale references if found.
- **Lessons sweep** (periodic — not every task): scan docs/lessons-learned.md. For each entry: promote durable truths to the right permanent doc (patterns.md / decisions.md / AGENTS.md), OR prune entries that turned out to be task-specific after all (just delete them — the detail lives in the task's notes.md). Leave a tombstone only for promoted entries. Do this when lessons-learned exceeds ~15 entries or at the end of a release milestone.

When done, run (use the Bash tool — do not just output the command as text):
{{{phaseCommands}}}
