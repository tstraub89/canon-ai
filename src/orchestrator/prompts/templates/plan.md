You are writing implementation plans for {{taskScope}} for {{projectName}}.

{{{startup}}}

{{{verdictLines}}}

For each task, read tasks/<id>/spec.md and tasks/<id>/spec-review.md. Address any `changes_requested` items before writing the plan. If the verdict is `approved_with_nits`, incorporate the nits into the plan — they don't require spec changes but should inform implementation decisions.

Write tasks/<id>/plan.md for each task with ordered implementation steps. Reference specific files, existing patterns, and code examples from the codebase. Codex implements directly from this plan.

If you encounter spec gaps, append to tasks/<id>/notes.md (prefix: [plan]).

When done, run:
{{{phaseCommands}}}
