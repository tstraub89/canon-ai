# Agent Quality Rules

This is canon-ai's local operator summary. Reusable workflow, implementation, review, validation, git, and release rules are delivered just in time by the orchestrator prompts, Claude Code skills, agent charters, task templates, and protected docs.

## Agents

| Agent | Primary Role | Writes | Reviews |
|---|---|---|---|
| Claude | Architect, Code Reviewer, QA | Specs, plans, code reviews, QA reports | Code (Codex's output) |
| Codex | Implementer, Spec Reviewer | Code, handoff reports | Specs (Claude's output) |
| Human | Product owner, final arbiter | Product decisions, priority | Specs, previews, test plans |

**Cross-review rule**: each agent reviews the other's work. Claude writes specs; Codex reviews specs. Codex writes code; Claude reviews code. No agent reviews its own output.

**Communication norm**: lead with the finding, surface real disagreement, and make risks/tradeoffs visible to the human. Tone is project taste; honest signal is canon discipline.

## Agent Memory

Both agents read `docs/lessons-learned.md` at session start and use it as recent distilled memory. Promotion into permanent docs and pruning that buffer are human-initiated, human-approved actions.

## Per-Task Notes

Any agent may append short raw observations to `tasks/TASK-ID/notes.md` with a phase prefix, such as `[implement]`. QA later decides whether a note becomes a polished lessons-learned entry.

## Workflow Observability

`docs/pipeline-invocations.md` tracks orchestrator invocation telemetry. `docs/task-quality-log.md` tracks QA-level task quality signals.

## Canon-AI Local Convention

Canon-managed files are root-authoritative and `templates/` is derived. See `CLAUDE.md` for the sync/hook/CI convention and the `CANON_OWNED` / `DELIMITED` split. `AGENTS.md` and `CLAUDE.md` themselves are local operator context, not delimiter-managed template content.
