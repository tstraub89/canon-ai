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
4. **For single tasks only — use the Write tool** to create `tasks/<id>/pr-body.md` — the outward-facing PR body draft for `--pr`. Write it as if a human wrote it after doing the work.
   {{#prTemplate}}
   The repo has this PR template. Fill every section with specifics from what shipped. Keep the headings; replace every placeholder:

   {{{prTemplate}}}
   {{/prTemplate}}
   {{^prTemplate}}
   No PR template found. Use this structure:

   ## Summary
   1–3 bullets: what changed and why.

   ## Changes
   Key files or areas touched, described for a reviewer.

   ## How to Test
   Steps a reviewer can follow to verify the change.

   ## Notes for Reviewer
   Any context, caveats, or follow-up items.
   {{/prTemplate}}
   ⚠️ Write as the human engineer who did the work — not as the AI or tool that produced it (Claude, Codex, canon, an LLM). ✅ e.g. "Fix the pagination off-by-one that dropped the last row." ❌ e.g. "🤖 Generated with Claude Code."
   Skip this step entirely for bundle tasks — per-task bodies are not combined for bundle PRs.

After writing all done.md files:
- Read tasks/<id>/notes.md for each task. For each insight, ask: "would this have changed how a *different* task was approached?" If yes, **append** one new entry for *this* task to docs/lessons-learned.md. If no, the detail stays in notes.md only. Append-only: never edit, prune, promote, reorganize, or delete existing entries — not this task's earlier entries, and never another task's. Promoting entries into permanent docs (patterns.md / decisions.md / AGENTS.md) and pruning the buffer is a **human-initiated, human-approved** action — never perform it during QA, and no entry count ever triggers it. (See docs/lessons-learned.md → "How to use this doc".)
- Append one row per task to docs/task-quality-log.md (see that file for column definitions).
- **Docs freshness**: scan the protected docs in AGENTS.md (architecture.md, codebase-map.md, patterns.md, product-context.md, decisions.md) for references that {{docsScope}} *contradicts* — a renamed symbol, a moved file, a behavior this task changed — and correct those stale references. That is the only edit QA makes to permanent docs. Do not add new lessons, pitfalls, or decisions here, and do not promote buffer entries — promotion is the human sweep, not Docs freshness.
- **Buffer signal** (not an action): after appending, if docs/lessons-learned.md now holds more than ~15 entries, add one line to this task's done.md — `Maintenance: lessons-learned.md has N entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").` Do not perform the sweep yourself.

When done, run (use the Bash tool — do not just output the command as text):
{{{phaseCommands}}}
