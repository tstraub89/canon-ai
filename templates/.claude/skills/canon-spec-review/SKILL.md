---
name: canon-spec-review
description: Use when a canon task spec is written and the human wants to surface BLOCKING issues before invoking `canon run <id>`. Triggers on "/canon-spec-review", "review the spec", "pre-flight the spec", "what would Codex catch", or before kicking off the pipeline. Useful for any spec with logic — for full-tier (M/L/XL/delicate) it pre-empts Codex spec_review iterations, for fast-tier (S non-delicate) it's the only automated review layer since Codex spec_review auto-approves.
argument-hint: "<task-id>"
allowed-tools: Read Glob Grep Bash(canon task list*) Bash(git status*) Agent
effort: high
---

# canon-spec-review

Previews what Codex's `spec_review` phase would surface — BEFORE `canon run <id>` — by dispatching three parallel sub-agents at the spec from different angles. Returns one inline report; the human revises spec.md or proceeds.

## When to use

- Spec is written, `human_spec_gate` not yet cleared
- Task is **full-tier (M/L/XL/delicate)** — pre-empts Codex spec_review iterations; saves ~10 min × N rounds + $
- Task is **fast-tier (S non-delicate)** — this is the *only* automated review layer (fast-tier auto-approves `spec_review`, so without this skill the human's read is the only gate before Codex hits the spec at implement-time)
- After a reroute amendment, before re-invoking the pipeline

Don't use for already-committed code review (use `codex review --uncommitted` for that), or for genuinely trivial S patches (typo fixes, version bumps) where there's no logic to vet.

## Workflow

### 1. Verify inputs

The task ID is `$ARGUMENTS`. If empty, stop: usage is `/canon-spec-review <task-id>`.

Verify `tasks/<id>/spec.md` exists and is filled out (no `<placeholder>` text or "TBD" stubs). If it's still a template, stop and say so.

Read into context:
- `tasks/<id>/spec.md` (the artifact under review)
- `tasks/<id>/status.json` (size, delicate flag — informs whether the review is worth running)

State briefly: task ID, size, delicate flag, "dispatching 3 parallel sub-agents."

### 2. Dispatch 3 sub-agents in one message

Send a SINGLE message with three Agent tool calls so they run concurrently. Each gets a specific scope, the spec content inline, a calibration constraint, and a fixed output schema. **Do not interleave** — single message, three Agent calls.

Each sub-agent returns findings in this format (no preamble, no closing remarks):

```
- [BLOCKING|STRONG|NIT] <one-line finding> — <file:line or AC#>
  <2-3 sentence rationale, citing evidence>
```

**Calibration applied to every angle**: silence is the default. Only flag issues that would cause real problems during implementation. A real shape concern becomes the lead reason for a `changes_requested` verdict. Don't manufacture findings to look thorough.

#### Agent A — Structural / shape

Subagent type: `general-purpose`. Scope: "Apply the Shape Check rubric from canon's spec_review prompt."

Goal: answer "is this spec solving the right problem in the right shape?" Four questions: (1) is the problem real, (2) is the framing right, (3) is there a materially simpler solution, (4) is the AC decomposition right (compound ACs, missing ACs, ACs solving symptoms not causes)?

Constraints: don't audit factual claims (Agent B's job); don't audit completeness against canon's spec-writing rules (Agent C's job). Stay in shape territory.

Output: the format above. If no shape concerns, return exactly `- [NO FINDINGS]`.

#### Agent B — Factual / ground-truth

Subagent type: `Explore`. Scope: "Verify every factual claim in the spec against the actual codebase."

Goal: for each named symbol, file path, function, or behavior the spec mentions — does it exist? Is the description correct? Are Affected Files entries real paths? For symbols in ACs (e.g. "extend `parseFooBar` to handle X"): grep for the symbol, read the function signature, verify the spec's assumptions about return shape and call sites.

Constraints: cite `file:line` for every claim. Don't audit shape (Agent A) or stylistic completeness (Agent C).

Output: the format above. If everything checks out, return exactly `- [NO FINDINGS]`.

This angle catches the highest-value class: "spec assumes X exists in Y but it's actually in Z" — which Codex's spec_review catches eventually but usually after 1-2 iterations.

#### Agent C — Spec-quality completeness

Subagent type: `general-purpose`. Scope: "Audit against canon's spec-writing rules of thumb."

Goal: check these spec-quality rules:
(1) **Name effects to DELETE** — when a change supersedes prior code, is it framed as a single replacement, not separate add/remove bullets?
(2) **Prefer positive or structural assertions** — are load-bearing "must not" constraints backed by a grep AC or positive reframe, not just prose negation?
(3) **Affected Files** — files that will *change* are listed; files only read for context are not.
(4) **Validation Required** — section present AND has at least one `- [x]` checked entry (or an explicit checked "None — <reason>"). A section with zero `[x]` entries is a failing check.
(5) **Non-goals** — rule out the most tempting scope expansions.
(6) **Human Test Plan** — product language only; no code, no file paths.
(7) **Known Risks** — names actual failure modes for the trickiest ACs.
(8) **Symbols in ACs exist** — for any named function or symbol, has the author grepped for it and verified the return shape matches the spec's assumed data contract?

Constraints: stay structural/completeness. Don't second-guess shape (Agent A) or re-verify symbols / return shapes (Agent B's job — Agent C trusts that ACs reference symbols Agent B is verifying).

Output: the format above. If nothing's missing, return exactly `- [NO FINDINGS]`.

### 3. Synthesize and report

When all three return:

1. **De-dupe**: if two agents flag the same thing, merge — keep the more specific rationale.
2. **Re-classify**: if Agent A says BLOCKING but Agent B's evidence shows it's actually a minor ambiguity, downgrade. Trust the most evidence-grounded classification.
3. **Order**: BLOCKING first (numbered), then STRONG, then NIT.

Print this inline (do NOT write to a file):

```markdown
# /canon-spec-review for `<task-id>`

**Task**: <title> · **Size**: <S/M/L/XL> · **Delicate**: <yes/no>

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

If an agent returned `[NO FINDINGS]`, say so under its section. Don't pad. If all three returned no findings, the report is two lines: header + "Proceed — three sub-agents found no issues."

## Output principles

- **Inline report only.** No file writes. No status.json updates. No spec-review.md mutations.
- **Operator owns the decision.** This skill surfaces findings; it doesn't revise specs or invoke the pipeline.
- **One example of what this catches** (from canon-ai's own worktree-canonical-task-state spec authoring): a Pass 1 multi-agent run caught a `taskDirFor → resolveTaskCwd` rename that would have produced infinite recursion at every pipeline phase entry, plus 6 other BLOCKING items. Codex's spec_review would have surfaced these across 2-3 iterations (~30 min each); the skill closed them in one ~15-min pass.

## Anti-patterns

| Anti-pattern | Why it's wrong | Do instead |
|---|---|---|
| Run on truly trivial S patches | Overhead > value for typo fixes, version bumps, single-line fixes with no logic | Skip when there's no logic to vet; use freely on any S spec that has decisions in it |
| Use to revise the spec | The skill doesn't edit files | Read the report, edit spec.md manually |
| Manufacture findings to look thorough | Dilutes signal | Silence is the default — `[NO FINDINGS]` is a real verdict |
| Use for code-diff review | Spec mode only in v1 | Use `codex review --uncommitted` for diff review |

---

## Related

- `/canon-spec` — where the spec under review came from.
- `/canon-pipeline` — invoke `canon run <id>` after BLOCKING findings are addressed.
- `CLAUDE.md` — operator context; Agent C's rules of thumb are listed in this skill above.
