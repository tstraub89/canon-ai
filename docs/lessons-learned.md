# Lessons Learned

> Distilled cross-task insights. The QA phase appends entries here when a task surfaces a reusable insight that would have changed how a *different* task was approached.

## How to use this doc

This file accumulates over the lifetime of the project. Entries land here from two paths:

1. **QA distillation (automated, append-only)**: At the end of each task, the QA phase reads `tasks/<id>/notes.md` (raw scratchpad observations from any phase) and asks "would this have changed how a *different* task was approached?" If yes, it **appends** one entry for that task. If no, the detail stays in `notes.md` only. QA never edits, prunes, promotes, or reorganizes existing entries — appending its own task's entry is the only write it makes to this file.

2. **Lessons sweep (human-initiated and human-approved only)**: Promoting entries into permanent docs and pruning the buffer is a **human decision**. Agents never perform it autonomously, and no entry count ever auto-triggers it. Two occasions call for a sweep: (a) when this file exceeds ~15 entries — the QA phase notices and *signals* it with a one-line note in the task's `done.md`, but does not act; and (b) at the end of a release milestone — a human-recognized occasion, since the QA phase has no notion of release boundaries and emits no signal for it. Either way, a human runs the sweep when they choose to:
   - **Promote durable truths** to the right permanent doc — `docs/patterns.md` (a pitfall), `docs/decisions.md` (a settled decision), or `AGENTS.md` / `CLAUDE.md` (a workflow / spec / review rule). Then prune the entry here.
   - **Prune task-specific entries** that turned out not to generalize. Just delete them — the detail lives in the task's `notes.md` and the git history of this file.

The goal: this file is a *staging area*, not a permanent archive. Entries that prove durable get promoted by a human; entries that don't get pruned by a human. The total count stays manageable. Tombstones from past promotions are not preserved — `git log docs/lessons-learned.md` is the audit trail.

## Entry format

Each lesson is a short paragraph with this shape:

```markdown
### Short imperative title naming the rule

*(date YYYY-MM-DD, source: TASK-ID or `manual`)*

The rule, then the failure mode it prevents (specific incident if recent), then the concrete prevention (what to grep for, what to verify, where the canonical example lives). Reference symbols/files via the `` `SYMBOL` in `path/file.ts` `` form.
```

The title is the lesson — a future reader scanning headings should learn the rule from titles alone. Resist the urge to make it cute or descriptive of the bug; name the *rule that prevents the bug*.

## Example entry

### Always reset derived state when source identifier changes

*(2026-04-12, source: feat-photo-swap)*

When a record references another by ID, computed fields (caches, transforms, ephemeral selections) calibrated for the old reference can survive an ID swap and produce stale-data bugs that are visible to users but invisible in logs. The fix: reset every derived field at every site that writes the ID — there's no single chokepoint for this. Canonical reset rule: reset derived state at every writer of the ID field. Grep all writers of the ID field before adding a new one.

---

> **TODO[canon]: Real entries land here as tasks ship. New projects start with this file mostly empty — that's fine. The discipline is: after every task QA, ask the "would this have changed how a different task was approached?" question, and only write if yes.**

---

<!-- Buffer empty after the 2026-06-10 sweep (v1.11.0 cut). Promotions: cumulative-diff handoff rule → AGENTS.md (per-iteration convention); same-resolver corollary → CLAUDE.md (cross-cutting-helper bullet); review.md append-heading rule → .canon/templates/review.md comment block; verdict 4-surface wiring → docs/codebase-map.md; per-failure-class gate messages (strengthened existing bullet), golden-fixture regeneration, subprocess registry seeding, fixture-gitignore mirroring → docs/patterns.md; multi-artifact dist declaration → docs/architecture.md build row. Pruned as already-promoted (AGENTS.md artifact-ref rules): revert-from-all-tables, deleted-file markdown-link form, prose backtick refs. Pruned as superseded by v1.11's sidecar change: reportOrCreatePR status-write rule, [skip ci] successor-commit rule. Pruned low-value: deleted-symbol grep (lint catches deterministically), mixed-bundle recovery symmetry (actionable part lives in the BACKLOG mixed-bundle entry). Prior entries are in git history. -->

### Keep per-task exemption markers local when the spec didn't scope the types module

*(2026-06-10, source: recovery-surface-hardening)*

When a plan proposes adding a new per-task or per-round flag to a shared types file (e.g. `scripts/run-task/types.ts`), but the spec's Affected Files don't include that module, keep the marker local to the modules that produce and consume it with explicit runtime narrowing (`reroute_exempt === true` pattern in `main.ts` / `validation.ts`). The shared type system already treats `status.json` as `unknown` at the boundary, so runtime narrowing is the correct layer anyway. Expanding the types module for a single-task flag widens diff scope without narrowing type safety. Concrete case: `reroute_exempt` in `recovery-surface-hardening` — kept local, documented as a deviation, all ACs still met. Apply the same check to any new per-phase counter, per-round marker, or temporary exemption flag proposed in a plan: if the spec didn't list `types.ts`, prefer the local-narrowing pattern.

### Per-task prompt variant requires both the state field AND template wording alignment

*(2026-06-11, source: recovery-surface-hardening)*

When adding per-task variant behavior to a shared template's prompt, storing the state is necessary but not sufficient — the template's generic wording must also defer to the per-task line, or the generic clause overrides the per-task customization entirely. Concrete case: the `reroute_exempt` implementation stored `reroute_exempt_prior_verdict` so prompts could render approved vs. failing flavors, but the `implement-reroute.md` template still had a generic "exempt task only re-verifies shared behavior" clause that would override the per-task failing-sibling line for any exempt task. The fix was a template change that makes the generic clause defer to whatever per-task line was injected. Pattern: when a spec adds state for conditional rendering, immediately audit every template that displays that state for a generic fallback clause that would negate it.
### Orchestrator-phase success-path fixtures must supply fake `git log` output

*(2026-06-10, source: implement-done-evidence-guard)*

Even when a test fixture's orchestrator phase does no staging, `autoCommitCode()` still runs on the success path and calls `git log` to verify the working tree. Without a fake `git log` stub, the subprocess exits non-zero and the test reads as a commit failure rather than a clean success. When writing subprocess-pattern tests for any phase that terminates normally (not just the stale-done or error paths), include a fake `git log` entry in the fixture's command registry alongside the `git add` / `git commit` stubs — otherwise the test will fail in a way that looks like an unrelated infrastructure issue.

### Exit-hook tests require the fixture process to reach a natural exit

*(2026-06-10, source: orchestrator-exit-logging)*

The orchestrator's exit marker is written from a `process.on('exit')` handler. Node `exit` handlers only fire on natural exits (explicit `process.exit`, unhandled exception exit, end of event loop) — they do not fire when the process is forcibly killed (SIGKILL, test runner teardown that kills the child). When writing subprocess-pattern tests for exit-marker behavior, crash handlers, or any code that relies on `exit` event firing: ensure the fixture lets the process reach a natural exit after the failure path runs. A fixture that calls `process.kill(pid, 'SIGKILL')` or that the test runner forcibly terminates will produce flaky or absent marker output and non-deterministic assertions.

