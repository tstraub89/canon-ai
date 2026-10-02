---
name: canon-spec-review
description: Use when a canon task spec is written and the human wants to surface BLOCKING issues before invoking `canon run <id>`. Triggers on "/canon-spec-review", "review the spec", "pre-flight the spec", "what would Codex catch", or before kicking off the pipeline. Useful for any spec with logic — for full-tier (S/M/L/XL/delicate) it pre-empts Codex spec_review iterations, for fast-tier (XS non-delicate) it's the only automated review layer since Codex spec_review auto-approves.
argument-hint: "[task-id]"
allowed-tools: Read Glob Grep Bash(canon task list*) Bash(git status*) Agent AskUserQuestion
effort: high
---

# canon-spec-review

Previews what Codex's `spec_review` phase would surface — BEFORE `canon run <id>` — by dispatching three parallel sub-agents at the spec from different angles. Returns one inline report; the human revises the spec or proceeds.

## When to use

- Spec is written, `human_spec_gate` not yet cleared
- Task is **full-tier (S/M/L/XL/delicate)** — pre-empts Codex spec_review iterations; saves time and cost
- Task is **fast-tier (XS non-delicate)** — this is the *only* automated review layer (fast-tier auto-approves `spec_review`, so without this skill the human's read is the only gate before Codex hits the spec at implement-time)
- After a reroute amendment, before re-invoking the pipeline

Don't use for code-diff review (use `/canon-inline-review`), or for XS changes with no logic to vet (typo fixes, version bumps).

## Workflow

### 1. Verify inputs

Resolve the task ID:

- **`$ARGUMENTS` names a task** → use it. This is how to review a task other than the one under discussion, or to run from a fresh session.
- **`$ARGUMENTS` is empty** → take the task from the conversation: the one just authored with `/canon-spec`, or the one the human has been discussing. Don't re-confirm an unambiguous pick.
- **Still unclear** (fresh session, or several tasks in play) → run `canon task list`, narrow to tasks at `spec` or `spec_review`, plus tasks at `plan` whose `status.json` shows `phases.plan.status: "pending"` (full tier waits at the human spec gate in that state). Use `AskUserQuestion` to pick one. If none match, say so rather than offering tasks already past the gate. Don't guess.

Verify `tasks/<id>/spec.md` exists and is filled out (no `<placeholder>` text or "TBD" stubs). If it's still a template, stop and say so.

Read into context:
- `tasks/<id>/spec.md` (the artifact under review)
- `tasks/<id>/status.json` (size, delicate flag — informs whether the review is worth running)

State briefly: task ID, size, delicate flag, "dispatching 3 parallel sub-agents."

### 2. Dispatch 3 sub-agents in one message

Send a SINGLE message with three Agent tool calls so they run concurrently. Every call uses `subagent_type: spec-review-lens` and carries the full spec text inline, its angle, scope and rubric. Each lens returns cited findings in its own format. If the Agent tool rejects `spec-review-lens`, stop and tell the human to run `canon upgrade`, then start a new Claude Code session; do not fall back to another agent type.

#### Agent A — Structural / shape

Scope: review whether the spec solves the right problem in the right shape. Answer four questions: is the problem real, is the framing right, is there a materially simpler solution, and is the AC decomposition right (compound ACs, missing ACs, ACs solving symptoms rather than causes)?

Constraints: don't audit factual claims (Agent B's job); don't audit completeness against canon's spec-writing rules (Agent C's job). Stay in shape territory.

#### Agent B — Factual / ground-truth

Scope: verify every factual claim in the spec against the actual codebase. For each named symbol, file path, function, or behavior: does it exist, is the description correct, and are Affected Files entries real paths? For symbols in ACs, verify signatures, return shapes, and call sites.

Read whole functions and call sites, not excerpts, when verifying return shapes. Cite `file:line` for every claim. Don't audit shape (Agent A) or stylistic completeness (Agent C).

This angle catches the highest-value class: a spec that assumes something exists in one place when it is elsewhere, or describes its contract incorrectly.

#### Agent C — Spec-quality completeness

Scope: audit against canon's spec-writing rules of thumb. Check these ten items:
(1) **Name effects to DELETE** — when a change supersedes prior code, is it framed as a single replacement, not separate add/remove bullets?
(2) **Prefer positive or structural assertions** — are load-bearing "must not" constraints backed by a grep AC or positive reframe, not just prose negation?
(3) **Affected Files** — the table sits under a heading that is exactly `### Affected Files`, inside `## Design` or any amendment section (an H2 whose first word is `Amendment`, such as `## Amendment`, `## Amendment Round N` or `## Amendment (full-send scope)`). It lists every file the change writes, including generated mirrors and rebuilt outputs. Files only read for context stay out. A mismatched heading or a missing generated output is BLOCKING, because a pipeline gate rejects it later.
(4) **Validation Required** — section present AND has at least one `- [x]` checked entry (or an explicit checked "None — <reason>"). A section with zero `[x]` entries is a failing check.
(5) **Non-goals** — rule out the most tempting scope expansions.
(6) **Human Test Plan** — product language only; no code, no file paths.
(7) **Known Risks** — names actual failure modes for the trickiest ACs.
(8) **Symbols in ACs exist** — for any named function or symbol, has the author verified the return shape matches the spec's assumed data contract?
(9) **Bug/flake-fix evidence** (N/A for features/refactors) — *Problem* states the confirmed mechanism and how it was confirmed, with evidence matching the mechanism class: a deterministic mechanism may cite a trace with verified trigger values; a runtime-dependent mechanism needs executed confirmation (a throwaway prototype-fix spike or a deterministic forced repro). *Acceptance Criteria* includes a red-first regression-test AC or the explicit environment-bound-and-impractical escape with a named deterministic alternative. Missing or under-rung evidence, or a missing red-first AC without the escape, is BLOCKING.
(10) **Refactor correctness audit evidence** (N/A for features/bug fixes) — for each behavior a refactor spec declares preserved, *Problem* shows that the behavior was checked for correctness and states its outcome (fixed deliberately with its own AC, split into a separate task, or kept as a named intentional quirk). A one-line "audited, correct" record satisfies a trivially correct refactor. Missing audit evidence is STRONG, never BLOCKING.

Constraints: stay structural/completeness. Don't second-guess shape (Agent A) or independently re-verify symbols against the codebase (Agent B's job). Check (8) audits whether the author verified before writing the AC.

### Severity definitions and scope boundary

- **BLOCKING:** would cause wrong behavior or a silent bug, or makes an AC unimplementable as written.
- **NIT:** an implementation detail the implementer resolves by reading the codebase, a minor ambiguity with an obvious default, or a question the plan phase should answer.
- **STRONG:** nit-grade under those rules, but likely to cost a review round, so cheaper to fix now.

Behavior the spec's Non-Goals explicitly exclude and verify as unaffected is a NIT at most. An omitted required change (such as a caller, parser, migration or test surface), a transitive effect of the change, or an internal contradiction between spec sections stays BLOCKING.

### 3. Synthesize and report

Silence is the default for what reaches the report. Apply these filters:

1. Drop any finding with no citation (uncited).
2. Downgrade any finding inside the scope boundary to NIT (scope-boundary downgrade).
3. de-dupe overlapping findings, keeping the more specific rationale.
4. Re-classify on the strongest evidence, then order BLOCKING, STRONG, NIT.

Print this inline (do NOT write to a file):

```markdown
# /canon-spec-review for `<task-id>`

**Task**: <title> · **Size**: <XS/S/M/L/XL> · **Delicate**: <yes/no>

## 🔴 BLOCKING (N)

1. <finding> — <citation>
   <rationale> · _flagged by: A/B/C_

## 🟡 STRONG (N)

...

## 🟢 NIT (N)

...

## Recommendation

<one of:>
- Proceed — `canon run <id>` is ready, only NITs (pipeline will absorb them)
- Revise spec first — N BLOCKING items must be addressed
- Worth a quick pass — STRONG items will probably surface in spec_review; cheaper to fix now
```

If a lens returned `[NO FINDINGS]`, say so under its section. Don't pad. If all three returned no findings, the report is two lines: header + "Proceed — three sub-agents found no issues."

## Output principles

- **Inline report only.** No file writes. No status.json updates. No spec-review.md mutations.
- **Operator owns the decision.** This skill surfaces findings; it doesn't revise specs or invoke the pipeline.

## Anti-patterns

| Anti-pattern | Why it's wrong | Do instead |
|---|---|---|
| Run on XS typo fixes or version bumps | Overhead exceeds value when there is no logic to vet | Skip when there's no logic to vet; use freely on any spec that has decisions in it, XS included |
| Use to revise the spec | The skill doesn't edit files | Read the report, edit the spec manually |
| Manufacture findings to look thorough | Dilutes signal | `[NO FINDINGS]` is a real verdict; report only cited findings |
| Use for code-diff review | Spec mode only | Use `/canon-inline-review` for diff review |

---

## Related

- `/canon-spec` — where the spec under review came from.
- `/canon-pipeline` — invoke `canon run <id>` after BLOCKING findings are addressed.
