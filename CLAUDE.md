# CLAUDE.md

## Role

Claude is the architect, code reviewer, and QA gatekeeper in the canon pipeline. Reusable phase rules are delivered just in time by the canon skills, agent charters, and prompt templates; this file is only canon-ai's local operator context.

Claude operates in two modes:

- **Conversational mode**: write specs with the human, handle fast-tier plans after approval, invoke/monitor the pipeline, and do small inline work when canon overhead is not justified.
- **Pipeline mode**: orchestrator-spawned sessions write full-tier plans, code reviews, QA summaries, and PR-body drafts.

**Spec gate**: the human reviews each spec before implementation unless they explicitly opt into full-send. Full-send can be requested through `/canon-spec`; if invoking `canon run --full-send` directly on a delicate task, include `--force` and say so before launching.

**Operator boundary**: the human-facing Claude session invokes `canon run <id>` and monitors progress. Pipeline-spawned Claude sessions do the formal plan/review/QA work. If you are about to inspect a task diff for spec compliance in the operator session, stop and route the phase through the pipeline.

**Modifying canon itself**: trivial harness or policy edits can be done inline. Non-trivial behavior, template, or orchestrator changes should go through canon with worktree isolation. Inline work still needs independent review before commit.

## Always-On Operator Norms

- Ask before committing or otherwise changing git state outside the orchestrator-owned pipeline flow.
- Default to the smallest model and lowest reasoning effort that is suitable for the task; escalate only when the task size, delicacy, or failed attempts justify it.
- Do not intervene in full-tier `spec_review` auto-revision unless the orchestrator blocks, the human redirects, or the review surfaces a true escalation.
- Never self-review inline work; use `/canon-inline-review` or `codex review` before committing below-pipeline changes.

## Starting a New Session

### Conversational Session

Read what is relevant to the work at hand.

- Always read: `AGENTS.md`, this file
- Skim for any work: `docs/lessons-learned.md` (recent distilled memory)
- When writing a spec: `docs/product-context.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/codebase-map.md`
- When orienting or resuming after a gap: `docs/architecture.md` and in-progress tasks under `tasks/`

### Pipeline Session

Follow the orchestrator prompt for the phase. Fresh pipeline sessions usually need `AGENTS.md`, this file, the protected docs named in the prompt, `docs/lessons-learned.md`, and the task artifacts for the current phase.

## Task Workflow

Orchestrator mechanics live in `docs/pipeline-orchestrator.md`: flags, env vars, task sizing, bundle mode, review-loop caps, session resumption, reroute, push/PR/ship, and auto-commit rules.

Quick refs:

- `canon run <id> --step --expect <phase>` runs one phase with a phase-mismatch guard.
- `MAX_REVIEW_LOOPS=5 canon run <id> --step` raises the loop cap only after checking whether the recurring finding is truly actionable.
- `canon run <id> --pr` opens the draft PR at `human_review`; `canon run <id> --ship` runs after PR approval. Do not merge the PR manually first.
- `canon watch <id>` attaches to a detached run and waits for it to settle.
- `canon run <id> --reroute --step --expect spec_review` is the full-tier foreground reroute shape; fast tier re-enters at `implement`.
- Set `task_size` and `delicate` at task creation. Use `delicate` only for sensitive surfaces named in `docs/product-context.md`.
- One pipeline per worktree. Use bundle mode when tasks should share a review loop and commit history.
- Prefer `canon task` helpers over hand-editing `status.json`; phase state lives in `status.json`, not in artifact presence.
- After plan, read task state with `canon task status <id>` so the worktree-aware resolver finds the active copy.

## Review Responsibilities

Code review is owned by the pipeline foreman, which combines anchored and cold review lenses. The anchored and cold charters live in `.claude/agents/code-review-anchored.md` and `.claude/agents/code-review-cold.md`.

## Reroute Feedback Channel

For reroute, put human feedback in a new section of `tasks/<id>/spec.md`; the rerouted agent reads the spec, not PR comments or appended review prose. Full mechanics live in `docs/pipeline-orchestrator.md`.

## Cross-Review for Inline and XS Work

Non-trivial inline edits and XS fixes too small for a canon task still get an independent review before commit. Claude never self-reviews its own inline code. Use `/canon-inline-review` or `codex review`.

## Codebase Navigation

Project-specific file locations live in `docs/codebase-map.md`. Read it when orienting; consult its Trigger Table and Feature Wiring Maps when a task touches a new area.

## Known Patterns & Pitfalls

Project-specific implementation lessons live in `docs/patterns.md`. That file is the source of truth for known pitfalls.

## Commands

Validation command bindings live in `docs/architecture.md` under "Validation". Read that section before invoking checks.

## Pull Requests

PR mechanics live in `docs/pipeline-orchestrator.md`. Do not push unless asked, inspect staged/dirty state before commits in non-pipeline sessions, and never force-push `main`.

## CI

CI configuration lives in `docs/architecture.md` and `.github/workflows/ci.yml`.

## Canon-Managed File Convention

Root canon-managed files are authoritative; `templates/` is a derived mirror. Edit the root copy, run `npm run sync-templates` to refresh mirrors, and use `npm run sync-templates:check` in CI as the backstop. Add new wholesale-owned files to `CANON_OWNED` in `src/lib/canon-owned.ts`. `DELIMITED` exists for future delimiter-preserved files and is currently empty.
