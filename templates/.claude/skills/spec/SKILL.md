---
name: spec
description: Write a scoped implementation spec for a new task. Explores the codebase, grills for M/L/XL tasks, proposes scope for approval, then creates the task directory and writes spec.md. For S tasks, also writes plan.md and kicks off the pipeline after approval.
argument-hint: "[task description or title]"
allowed-tools: Read Glob Grep Write Edit Agent Bash(canon task *) Bash(canon run *) Bash(./scripts/task.sh *) Bash(git branch *) Bash(git status *) Bash(git log *)
effort: high
---

# Spec Authorship

Task: **$ARGUMENTS**

## Session context

In-progress tasks:
```!
canon task list 2>/dev/null || ./scripts/task.sh list 2>/dev/null || echo "(none)"
```

Current branch: `!git branch --show-current 2>/dev/null`

---

## Workflow

Follow these phases in order. Do not skip ahead or combine phases.
Stop points marked **⛔ STOP** require explicit approval before continuing.

---

### Phase 1 — Load context

Read before doing anything else:

- `AGENTS.md` — workflow rules, validation matrix, sizing guide
- `CLAUDE.md` — your role and spec authorship guidelines
- `docs/product-context.md` — project context, user flows, delicate surfaces
- `docs/decisions.md` — settled decisions (check for conflicts)
- `docs/patterns.md` — implementation patterns and known pitfalls
- `docs/lessons-learned.md` — insights from past tasks

For the task's area, also read the relevant section of `docs/codebase-map.md`.

---

### Phase 2 — Explore the codebase

Delegate entirely to an Explore sub-agent. Do not read source files directly in this conversation.

Spawn an Explore sub-agent via the Agent tool with a prompt covering:
- The task: **$ARGUMENTS**
- Which systems and files are likely affected (infer from the task and `docs/codebase-map.md`)
- What to return:
  - Relevant files with a brief description of their current behavior
  - Patterns from `docs/patterns.md` that apply
  - Pitfalls from `docs/patterns.md` that are relevant
  - Conflicts with settled decisions in `docs/decisions.md`
  - Surprising or non-obvious constraints Codex will need to know

Synthesize the sub-agent's findings before proceeding.

---

### Phase 3 — Scope alignment

Assess task size from the description and exploration findings:
- **S**: 1–2 files, clearly bounded, low uncertainty
- **M**: several files, well-understood approach, < 1 day
- **L**: cross-cutting, significant refactor, or meaningful uncertainty
- **XL**: architecture change, high uncertainty, multiple systems

Also assess: is this **delicate**? Check `docs/product-context.md` for the project's defined delicate surfaces. The bar is: an undetected bug here is materially harder to recover from than a normal bug.

**For S tasks:** Ask at most 2–3 clarifying questions in one round if scope is genuinely ambiguous. Resolve them, then move to Phase 4.

**For M / L / XL / delicate tasks — grill mode:**

Walk the decision tree one branch at a time until you have full shared understanding:
- Ask **one question at a time** — never a batch
- Always state your **recommended answer** so the user can confirm, redirect, or override
- If a question can be answered by exploring the codebase, explore instead of asking
- Resolve parent decisions before descending to child decisions
- Continue until the user signals shared understanding ("ok", "yep", "let's write it")

**Always take a position.** A question without a recommended answer offloads design work onto the user.

Topics to work through for M+ (apply judgment — not all will apply):
- What exact behavior changes? What does the user see/do differently?
- What's explicitly out of scope?
- Does this conflict with an existing pattern or settled decision?
- What's the riskiest AC? What can go wrong?
- Which files are likely affected?
- Does this touch a delicate surface?

---

### Phase 4 — Propose scope

**⛔ STOP — present this and wait for approval before creating any files.**

Summarize concisely:

- **Task slug** — kebab-case, descriptive (e.g. `add-search-sidebar`, `fix-auth-timeout`)
- **Title** — short phrase
- **Size** — S / M / L / XL with one-line justification
- **Delicate?** — yes/no, citing the relevant surface
- **Affected areas** — 2–4 bullets: which files/systems change
- **Approach** — 1–2 sentences: what we're building
- **Non-goals** — what we're explicitly NOT doing

Wait for approval before proceeding.

---

### Phase 5 — Create task and write spec

After scope is approved:

1. Create the task directory:
   ```bash
   canon task new TASK-ID "Title"
   # falls back to: ./scripts/task.sh new TASK-ID "Title"
   ```

2. Edit `tasks/TASK-ID/status.json`: set `task_size`, `delicate`, and `human_spec_gate: true`.

3. Write `tasks/TASK-ID/spec.md` using `.canon/templates/spec.md` as structure. Fill every section — no placeholders, no "TBD".

4. Set `spec.status` to `"done"` in `status.json`.

Self-check before presenting:
- [ ] Every AC states exactly how to verify it (not just "it works")
- [ ] Affected Files lists specific files (not directories) with specific change descriptions
- [ ] If this spec replaces existing behavior: explicit "remove X" bullets paired with "add Y" bullets — don't just describe the new state
- [ ] Known Risks covers failure modes for the trickiest ACs
- [ ] Human Test Plan uses product language only — no code, no file paths
- [ ] Validation Required has at least one entry (or "None" with a reason)
- [ ] Non-Goals rules out the most tempting scope expansions
- [ ] Symbols named in ACs actually exist in the codebase — grep-verify before presenting

**⛔ STOP — present the spec and wait for approval.**

---

### Phase 6 — After spec approval

**S tasks:**
1. Write `tasks/TASK-ID/plan.md` using `.canon/templates/plan.md` as structure.
2. Update `status.json` phases:
   - `phases.spec.status: "done"`
   - `phases.spec_review: { "status": "done", "agent": "claude", "verdict": "approved" }`
   - `phases.plan.status: "done"`
   - `human_spec_gate: false`
3. Invoke the pipeline:
   ```bash
   canon run TASK-ID
   ```

**Full-tier tasks (M, L, XL, or any delicate task):**
1. Invoke the pipeline — Codex reviews the spec, then pipeline Claude writes the plan, Codex implements, pipeline Claude reviews and QA's:
   ```bash
   canon run TASK-ID
   ```
