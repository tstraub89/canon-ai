---
name: canon-spec
description: Use when the human describes a new feature, bug fix, or refactor that doesn't yet have a canon task — phrases like "let's add X", "I want to fix Y", "we should refactor Z", "start a task for...", or explicit `/canon-spec` invocation. Also triggers on "full send" / "full-send" / "yolo it" which carries through to pipeline launch without further interrupts. Don't use for existing in-progress tasks (use `/canon-pipeline`) or status checks (use `/canon-status`).
argument-hint: "[task description or title]"
allowed-tools: Read Glob Grep Write Edit Agent Bash(canon task *) Bash(canon run *) Bash(git branch *) Bash(git status *) Bash(git log *)
effort: high
---

# Spec Authorship

Task: **$ARGUMENTS**

## Session context

In-progress tasks:
```!
canon task list 2>/dev/null || echo "(none)"
```

Current branch: `!git branch --show-current 2>/dev/null`

---

## Workflow

Follow these phases in order. Do not skip ahead or combine phases.
Stop points marked **⛔ STOP** require explicit approval before continuing.

---

### Phase 1 — Load context

Read before doing anything else:

- `docs/product-context.md` — project context, user flows, delicate surfaces
- `docs/decisions.md` — settled decisions (check for conflicts)
- `docs/patterns.md` — implementation patterns and known pitfalls
- `docs/lessons-learned.md` — insights from past tasks

> The Validation Matrix is inline in `.canon/templates/spec.md` (the sizing table lives in `docs/pipeline-orchestrator.md`).

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

Before grilling, detect full-send intent from `$ARGUMENTS`: if it contains an explicit `--full-send` flag or the phrase `full send` / `full-send` (case-insensitive), enter full-send mode, print the acknowledgment line below, and carry that mode through the rest of the workflow.

`Full-send mode detected. I'll grill, write the spec, and run the pipeline through to a draft PR without further interrupts.`

Assess task size from the description and exploration findings:
- **S**: 1–3 files, clearly bounded, low uncertainty
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
   ```

2. Edit `tasks/TASK-ID/status.json`: set `task_size`, `delicate`, and `human_spec_gate: true`.

3. Write `tasks/TASK-ID/spec.md` using `.canon/templates/spec.md` as structure. Fill every section — no placeholders, no "TBD".
   - If full-send mode is active, prepend this line immediately after the title block and before `## Problem`:
     `> **Full-send mode**: This spec was produced in full-send mode.`

4. Set `spec.status` to `"done"` in `status.json`.

Self-check before presenting:
- [ ] Every AC states exactly how to verify it (not just "it works")
- [ ] Affected Files lists specific files (not directories) with specific change descriptions
- [ ] If this spec replaces existing behavior: frame it as one replacement ("replace X with Y; X must not exist after") and add a structural/grep AC when practical; use paired add/remove bullets only when true replacement framing doesn't fit
- [ ] Known Risks covers failure modes for the trickiest ACs
- [ ] Human Test Plan uses product language only — no code, no file paths
- [ ] Validation Required has at least one entry (or "None" with a reason)
- [ ] Non-Goals rules out the most tempting scope expansions — back load-bearing exclusions with a positive scope-bound or grep AC, not prose "NOT" alone
- [ ] Symbols named in ACs actually exist in the codebase — grep-verify before presenting

**Spec-writing rules of thumb** (apply when writing ACs and structure):
- **Name effects to DELETE**: frame supersession as replacement ("replace `oldFn` with `newFn`; `oldFn` must not exist after"), not separate add/remove bullets.
- **Prefer positive or structural assertions** over prose negations for load-bearing constraints. Back a "must not" with a grep AC or positive reframe.
- **Symbols in ACs must exist** — grep for every named function or symbol; verify return shape matches the spec's assumed data contract.
- **Behavioral contracts, not mechanics** — ACs describe observable behavior; defer implementation mechanics to plan/implement.
- **At ≥3 spec_review iterations, label each round**: *edge-fine-tune* (missed path, single validator) or *scope-expansion* (new sub-problem). If scope-expansion, redesign rather than iterate.
- **Refactor specs need hard structural caps**: size cap, explicit deletion expectations per symbol, grep AC for disappeared symbols.

**⛔ STOP — present the spec and wait for approval.**

---

### Phase 6 — After spec approval

**S tasks:**
1. Write `tasks/TASK-ID/plan.md` using `.canon/templates/plan.md` as structure.
2. Record the human's approval in `tasks/TASK-ID/spec-review.md`: check the **Approved** box and add a one-line note ("Fast tier — human conversational spec approval; Codex spec review skipped"). The phase gate reads this artifact before letting `spec_review` advance.
3. Advance the phases with the helpers (they rederive the top-level `status` pointer):
   ```bash
   canon task phase TASK-ID spec done
   canon task phase TASK-ID spec_review done approved
   canon task phase TASK-ID plan done
   ```
   Then set `human_spec_gate: false` in `status.json` (already cleared by the human's conversational approval).
4. Invoke the pipeline:
   ```bash
   canon run TASK-ID
   ```

**Full-tier tasks (M, L, XL, or any delicate task):**
1. Invoke the pipeline — Codex reviews the spec, then pipeline Claude writes the plan, Codex implements, pipeline Claude reviews and QA's:
   ```bash
   canon run TASK-ID
   ```

**Full-send tasks:** if the task was detected as full-send, invoke the pipeline with `--full-send` instead of the plain run. If the task is delicate, print this acknowledgment block before launching, then append `--force`:
```text
⚠ Delicate + full-send: canon's review chains still run with the upgraded model, but no human checkpoint exists before the PR opens. Reply "stop" within 5 seconds to abort, or anything else (including silence) to proceed.
```
Then launch:
```bash
canon run --full-send [--force] TASK-ID
```

---

## Related

- `/canon-spec-review` — adversarial pre-pipeline review of the spec. Recommended for M/L/XL or delicate tasks before invoking the pipeline.
- `/canon-pipeline` — drive the pipeline after spec approval.
- `/canon-status` — check what other canon tasks are in flight before committing to scope.
- `docs/pipeline-orchestrator.md` — pipeline internals, sizing guide, model/effort matrix. The Validation Matrix is now inline in `.canon/templates/spec.md`.
