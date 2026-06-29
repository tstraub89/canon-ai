# Agent Quality Rules

canon-ai is a TypeScript/Node CLI published as an npm package. It scaffolds a Claude + Codex spec-driven pipeline into other repositories, and canon-ai dogfoods that same pipeline on itself. That's why `tasks/`, worktree isolation, and `templates/` mirrors exist.

This is canon-ai's shared project overview. It gives both agents the same starting picture; detailed operating rules arrive just in time through skills, prompt templates, and the docs below.

## Roles

| Agent | Primary Role | Writes | Reviews |
|---|---|---|---|
| Claude | Architect, code reviewer, QA | Specs, plans, code reviews, QA summaries | Code |
| Codex | Implementer, spec reviewer | Code, handoff reports | Specs |
| Human | Product owner, final arbiter | Product decisions, priorities | Specs, previews, test plans |

## Shared Norms

- Cross-review: each agent reviews the other agent's work. Claude writes specs; Codex reviews specs. Codex writes code; Claude reviews code. No agent reviews its own output.
- Communication: lead with the finding, surface real disagreement, and make risks and tradeoffs visible to the human. Tone is project taste; honest signal is canon discipline.

## Workflow

canon-ai runs a phase pipeline: `spec -> spec_review -> plan -> implement -> code_review -> qa -> human_review`.

- Fast tier collapses spec and plan into one Claude session.
- Full tier keeps spec, review, plan, implement, code review, and QA separate.
- `canon task phase` and `canon task accept` manage task state; prefer them over hand-editing `status.json`.
- `canon run` drives the pipeline, `canon watch` observes detached runs, and `canon stop` terminates them when needed.

## Stack

TypeScript/Node CLI, built and tested with `npm run build`, `npm test`, `npm run lint`, and `npm run type-check`.

## Commands

- `canon init` scaffolds canon into a repo.
- `canon doctor` checks environment and setup.
- `canon task new`, `list`, `status`, `phase`, `accept`, `set`, `reset-spec-review`, and `reset-code-review` manage task state.
- `canon run`, `watch`, `stop`, `update`, and `upgrade` operate the pipeline and package lifecycle.
- `canon run --pr` opens a draft PR at `human_review`; `canon run --ship` runs the post-merge cleanup path after approval.

## Conventions

- Task artifacts live under `tasks/<id>/`; `tasks/<id>/notes.md` is the raw scratchpad and `docs/lessons-learned.md` is the promotion buffer.
- `docs/architecture.md` holds validation and CI commands; run that section before checks.
- Root canon-managed files are authoritative; `templates/` is a derived mirror. Edit the root copy, then run `npm run sync-templates` and verify with `npm run sync-templates:check`. `AGENTS.md` and `CLAUDE.md` are not part of the managed set; they have no `templates/` mirror and need no sync.
- Prefer `canon task` helpers over direct `status.json` edits so phase state stays consistent.
- Use worktrees for task isolation when canon creates them.
- The managed set lives in `src/lib/canon-owned.ts` as `CANON_OWNED` and `DELIMITED`; add managed files there, not here.

## Where to Go Deeper

- `docs/codebase-map.md` for file locations and entry points.
- `docs/patterns.md` for implementation pitfalls and load-bearing patterns.
- `docs/pipeline-orchestrator.md` for flags, env vars, reroute, worktrees, PR/ship, and recovery.
- `docs/release-process.md` for branch, versioning, and release-cut mechanics.
- `docs/product-context.md` for user-visible behavior and terminology.
- `docs/decisions.md` for settled rules and architecture decisions.
- `docs/lessons-learned.md` for distilled cross-task memory.
- `docs/task-quality-log.md` for QA trends and task-quality signals.

## Operational Notes

- Append short raw observations to `tasks/<id>/notes.md` with a phase prefix.
- Re-run `canon doctor` after install or when environment assumptions change.
- Do not force-push `main`; the pipeline and release flow manage branch state.
