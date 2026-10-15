@AGENTS.md

## Conversational Operator Norms

General working norms, git consent, PR CI watching, and shell rules live in `~/.claude/CLAUDE.md`.

- Default to the smallest model and lowest reasoning effort suitable for the task.
- Do not intervene in full-tier `spec_review` auto-revision unless the orchestrator blocks, the human redirects, or the review surfaces a true escalation.
- Never self-review inline work; use `/canon-inline-review` or `codex review` before committing below-pipeline changes.
