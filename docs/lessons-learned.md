# Lessons Learned

> Distilled cross-task insights. The QA phase appends entries here when a task surfaces a reusable insight that would have changed how a *different* task was approached.

## How to use this doc

This file accumulates over the lifetime of the project. Entries land here from two paths:

1. **QA distillation (automated, append-only)**: At the end of each task, the QA phase reads `tasks/<id>/notes.md` (raw scratchpad observations from any phase) and asks "would this have changed how a *different* task was approached?" If yes, it **appends** one entry for that task. If no, the detail stays in `notes.md` only. QA never edits, prunes, promotes, or reorganizes existing entries — appending its own task's entry is the only write it makes to this file.

2. **Lessons sweep (human-initiated and human-approved only)**: Promoting entries into permanent docs and pruning the buffer is a **human decision**. Agents never perform it autonomously, and no entry count ever auto-triggers it. Two occasions call for a sweep: (a) when this file exceeds ~15 entries — the QA phase notices and *signals* it with a one-line note in the task's `done.md`, but does not act; and (b) at the end of a release milestone — a human-recognized occasion, since the QA phase has no notion of release boundaries and emits no signal for it. Either way, a human runs the sweep when they choose to (the `/canon-sweep` skill walks the triage and proposes a verdict per entry before anything is written):
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

### When adding a location/scope constraint, add one boundary check rather than teaching every consumer a new state

*(2026-09-03, source: worktree-root-in-repo)*

A spec that needs "X outside the new boundary should stop working" is tempting to implement by narrowing every function that looks X up — scope the lookup, and an out-of-boundary X becomes unfindable, hence "missing," for free. This task tried exactly that for three spec-review rounds: each round found a different consumer (a ship path, a teardown path, a bundle-secondary scan) that the narrowed lookup broke, because none of them was built to receive the newly-invented "out of boundary" state, and one canonical case (a blank-branch record that a scoped lookup can no longer distinguish from "never existed") couldn't be made to fail loudly at all — it silently fell through to the wrong answer. The fix that converged: leave every lookup/consumer alone, and add exactly one boundary check at the single entry point that was going to act on the result (`canon run`, before any phase). Rule of thumb: when N existing consumers each read the same resolved value, and a new constraint should block *acting* on an out-of-bounds result rather than change *what resolves*, put the check at the action's entry point, not inside resolution — resolution redefining an existing state must be re-taught to every consumer, and there are reliably more consumers (and lifecycle states) than the first pass enumerates. See also the canon-spec skill's "≥3 spec_review iterations" rule of thumb for the same convergence-vs-scope-creep tell in a different shape.

---

### Pin state before a long-running external process, not after

*(2026-09-27, source: code-review-delta-rerounds)*

When an orchestrator step needs to record "what the process reviewed/acted on" (a commit SHA, a file list, a snapshot), reading that state after invoking a long-running external agent lets it drift: the state can move mid-run and the recorded value ends up describing more than the process actually saw. This task's round-1 code review caught exactly that gap (F3): the reviewed HEAD SHA was read after `codex exec review` returned, so a commit landing mid-run would be silently credited to a review that never saw it. The fix: resolve and pin the value once, before starting the external process, and thread that pinned value through every downstream step (ancestry checks, diff probes, the artifact header) instead of re-reading live state later. The regression test that pins this moves HEAD between invoking the process and archiving, and asserts the archive still names the pre-move commit — a good template for any future "pin state, then run a long external step" invariant in this orchestrator.

---

### A fake-git test fixture must be updated in lockstep with the production git command it mocks

*(2026-09-27, source: fix-staged-deletion-autocommit-and-dir-refs)*

When a gate's underlying git probe changes (e.g. from `git ls-files --deleted` to `git diff HEAD --name-only --diff-filter=D`), any test fixture that fakes the git binary by matching on argv and returning a canned response silently goes stale: the fixture keeps answering the *old* command's argv pattern, misses the new one, and returns its default/fallback response instead of the intended one — sometimes still passing, for the wrong reason. This task's real-git regression caught the gate change correctly, but the pre-existing fake-git fixture for the same code path only surfaced its staleness on the next full-suite run. Rule of thumb: whenever a production git command's exact invocation changes, grep the fake-git fixtures for argv patterns matching the *old* invocation and update them to the new one in the same change — a fake-git fixture drifting from its production probe is invisible until something else (a full suite run, a different targeted test) happens to exercise it.

---

### Enforce a new gate after the retry/recovery path settles, not immediately after the session that might leave partial state

*(2026-09-27, source: affected-files-preflight-at-code-review)*

A gate added right after an agent session ends ("check the result, block if it fails") looks like the natural place to enforce a new invariant, but if that same session can legitimately produce partial, recoverable output — a review artifact with some content but no checked verdict, a handoff with some but not all rows filled — enforcing there treats "not finished yet" the same as "finished and wrong." This task's Round 2 review caught exactly that: a post-foreman scope check placed directly after the foreman's session called `process.exit(2)` on a partial `review.md` that had no checked verdict, when the existing recovery path would have retried the same session and let it finish normally. The fix: enforce the new invariant once, at the router/`checkAndRoute` boundary that already runs *after* recovery has decided the session is actually done — not inside the phase, right after the session call. Rule of thumb: before adding a check after an agent-session call, first find out whether that call site has an existing retry-on-incomplete-output path: if it does, the new check belongs after that path resolves, not before it.

---

### Run `npm run build` to completion before `npm test`, never concurrently

*(2026-09-27, source: affected-files-preflight-at-code-review)*

Running the full test suite in parallel with a rebuild lets `tsup`'s clean step delete `dist/` while CLI-fixture tests are mid-import, producing spurious failures (missing module / stale bundle) that have nothing to do with the change under test — and a timing-sensitive process-signal test can flake the same way. This task's first full-suite run hit both: two CLI fixtures failed to load a temporarily-absent bundle, and a signal-timing test failed; a sequential rerun (build finishes, then `npm test` starts) passed clean. Rule of thumb: when validating a change that touches `dist/`, always run `npm run build` to completion before `npm test`, not as a backgrounded/concurrent step — a failure that only reproduces under concurrent build+test is not a real regression, but confirm that by rerunning sequentially before dismissing it.

<!-- Buffer swept 2026-10-02 (14 entries reviewed: 3 promoted — two merged into one patterns.md point — 5 kept in buffer, 6 pruned).
     Promotions → docs/patterns.md: point (3) "Canonical text" added to the multi-surface guidance-rule pitfall (merged from the reviewer-severity-words and canonical-string entries; a second predicate-integrity incident after spec-bugfix-diagnosis-rule). Site comment above `isTemplateUnfilled` in src/orchestrator/validation.ts (quoted sentinel trips the gate).
     Kept in buffer: one-boundary-check — re-evaluate if a scope/boundary task hits it again; pin-state-before-external-process — re-evaluate if another orchestrator step reads live state after an agent run; fake-git-fixture-lockstep — graft into patterns.md Test-writing pitfalls if it recurs; gate-after-recovery-settles — adjacent to the "non-zero agent exit" pitfall, graft if it recurs; build-before-test — one-line graft into architecture.md validation if it recurs.
     Pruned: grep-AC-exception-growth (kept two sweeps; covered by canon-spec "≥3 spec_review iterations" rule); file-existence-test (self-evident; code-review test-integrity checks); deletion-evidence-probe (site comment in main.ts + real-git regression test); not-read-elsewhere-claim (canon-spec enumerate-every-caller rule); red-first-exit-code (canon-spec bug-fix rule "fails for the stated reason"); golden-fan-out (patterns.md Test-writing golden bullet).
     Unresolved follow-ups: the canon-spec "Codebase-wide term renames" rule is skill-only, not in the spec/spec-revision phase prompts (2026-08-11 carrier note) — a separate decision.
     Prior entries are in git history. -->

### A fail-closed fix must keep each caller's existing verdict precedence and `--force` semantics

*(2026-10-03, source: affected-files-fail-closed)*

Turning a silent-empty probe result into an explicit failure is not just "block on failure" at each caller: each guard already sits inside a precedence order (SPEC GAP halt, requested-changes reroute, then advance) and some behind a `--force` branch that skips the computation entirely. Spec review caught that a naive "block if any member is approved" conflicts with bundle precedence, and planning caught that the spec's "cannot be bypassed with --force" message was false because the probe ran only inside `if (!force)`. Rule of thumb: when making a probe fail closed, trace each caller through every verdict and flag path before choosing where the block goes, and share the exemption predicate rather than restating it. Recovery wording under a verdict gate must also respect that gate (a plain re-run from a SPEC GAP block starts another review, so it can't be offered as the fix).

### A guard on one field is only as strong as the fields it reads

*(2026-10-05, source: rearm-spec-gate)*

Refusing `human_spec_gate false` on delicate tasks can be sidestepped by toggling `delicate` off, disarming, and toggling it back on — the guard checks state only at the call. Code review flagged it, but the spec scoped the guard to the gate setter, so it shipped as an accepted spec-gap. Rule of thumb: when a spec adds a guard that depends on another settable field, list the settable-field graph in the spec and either guard the dependency's mutation too or record the bypass as an accepted non-goal. A second instance: a spec-mandated recovery note ("full-tier `--reroute`") can be unreachable right after the state it describes, so trace when the advertised command is actually admitted before mandating its wording.
