# Lessons Learned

> Distilled cross-task insights. Task runs write lessons fragments; `canon run --ship` folds them here when a task surfaces a reusable insight that would have changed how a *different* task was approached.

## How to use this doc

This file accumulates over the lifetime of the project. Entries land here from two paths:

1. **QA distillation (automated, append-only)**: At the end of each task, the QA phase reads `tasks/<id>/notes.md` (raw scratchpad observations from any phase) and asks "would this have changed how a *different* task was approached?" If yes, it **appends** one entry to that task's `lessons.md` fragment; `--ship` folds it into this shared doc. If no, the detail stays in `notes.md` only. QA never edits, prunes, promotes, or reorganizes existing entries — appending its own task's fragment is its only lessons write. Task runs never write this shared doc directly.

2. **Lessons sweep (human-initiated and human-approved only)**: Promoting entries into permanent docs and pruning the buffer is a **human decision**. Agents never perform it autonomously, and no entry count ever auto-triggers it. Two occasions call for a sweep: (a) when this file plus the current task's lessons fragment exceed ~15 entries — the QA phase notices and *signals* it with a one-line note in the task's `done.md`, but does not act; and (b) at the end of a release milestone — a human-recognized occasion, since the QA phase has no notion of release boundaries and emits no signal for it. Either way, a human runs the sweep when they choose to (the `/canon-sweep` skill walks the triage and proposes a verdict per entry before anything is written):
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

### A guard on one field is only as strong as the fields it reads

*(2026-10-05, source: rearm-spec-gate)*

Refusing `human_spec_gate false` on delicate tasks can be sidestepped by toggling `delicate` off, disarming, and toggling it back on — the guard checks state only at the call. Code review flagged it, but the spec scoped the guard to the gate setter, so it shipped as an accepted spec-gap. Rule of thumb: when a spec adds a guard that depends on another settable field, list the settable-field graph in the spec and either guard the dependency's mutation too or record the bypass as an accepted non-goal. A second instance: a spec-mandated recovery note ("full-tier `--reroute`") can be unreachable right after the state it describes, so trace when the advertised command is actually admitted before mandating its wording.

---

### Name the overlap winner before finalizing a user-configured file list

*(2026-10-15, source: configurable-docs-freshness)*

When a new config lets adopters name files that an existing writer already owns (here, a telemetry log with its own unconditional append rule), the spec must state the overlap policy explicitly. Without one, admission order silently decides: a read-only call with an empty doc set still selected the telemetry file, and a configured flag-only telemetry doc would have conflicted with QA's unconditional append. Spec review caught it as F1; the fix was to reject telemetry and task-artifact paths anywhere in the config, so the sets stay disjoint. Rule of thumb: for every new user-supplied file list, enumerate the existing writers of those files and record which one wins before the config schema is final.

---

### Round-trip tests of a re-rendered row need two or more write-read cycles

*(2026-10-17, source: per-task-telemetry-fragments)*

The quality-log decoder halved backslashes once while the renderer escaped them on every write, so each QA rerun or fold doubled them. A single parse-then-render round trip passed, and only a repeated write, read, write cycle exposed it (code review C1). For any table cell that is parsed and written back out, assert the bytes are stable after at least two cycles, including values with backslashes, pipes and trailing backslashes.

---

### Don't use files an exit handler deletes as crash evidence

*(2026-10-20, source: watch-crash-not-step-done)*

A `process.on('exit')` cleanup that removes runtime files runs on every exit path, clean or not, so the files' absence says nothing about how the process ended. Here the pid and heartbeat files were gone after a crash just as after a clean step exit. Only an exit line written outside that cleanup told the two apart. Rule of thumb: before using a pid or heartbeat file to detect a crash, grep for the cleanup that removes it. If it runs on all exits, only a surviving file is evidence of an unclean exit, and an absent file proves nothing.

---

### When a message restates one contract value on several lines, change every line and check what the new value admits

*(2026-10-22, source: recovery-command-fixtures)*

A halt message that names the same heading on two lines (the fix line and a scope note) can be half-fixed: correcting the fix line left the scope note naming the bare heading, and code review caught it. The corrected round-numbered heading then created a second problem, because a blessed section with that heading satisfied the next human reroute gate with no new amendment. Rule of thumb: when a fix changes a value in an emitted message, grep the emitter for every line that names that value and change them together, then ask whether the replacement lets a bypass path (here, BLESS) satisfy a gate the operator is supposed to pass by hand. Test the replacement by following the printed instruction, then running the next command it implies. Canonical example: the spec_gap halt in `src/orchestrator/main.ts`, with the chained scope-BLESS-reroute fixture in `tests/recovery-hints.test.ts`.

<!-- Buffer swept 2026-10-23 (24 entries reviewed: 10 promoted into 4 docs/patterns.md edits, 6 kept in buffer, 8 pruned).
     Promotions → docs/patterns.md: Test-writing bullet "Prove each regression test can fail, and keep its fakes honest" (fake-git lockstep, rename sentinel, helper-vs-call-site, guidance-prose clause, fixture stream shapes, fixture phase derivation); Git-behavior bullet "A pre-push hook runs after git resolves the refspec"; new pitfall "Bind a gate or record to the state the action actually used" (pin-before-external-process, probe-after-hooks); clause on the "Clean tree" pitfall (scope guard snapshots content and HEAD).
     Kept in buffer: one-boundary-check — re-evaluate if a scope/boundary task hits it again; guard-on-one-field — re-evaluate on another settable-field bypass; overlap-winner — re-evaluate on the next adopter-config schema; round-trip-two-cycles — re-evaluate on another parse-and-rewrite cell bug; exit-handler-files — re-evaluate if crash detection is touched again; message-restates-value — graft into the clause-builder pitfall if it recurs.
     Pruned: gate-after-recovery (artifact fix-up gate had exposure without recurrence); build-before-test (no recurrence across many builds); fail-closed-precedence (AGENTS.md trace-every-verdict rule); glob-matcher (regression tests landed); prompt-builder-values (canon-spec data-contract rule); park-typed-failure (patterns.md non-zero-exit pitfall); log-marker-tail (fix and tests landed); state-classifier-entry-points (canon-spec enumerate-every-caller rule).
     Unresolved follow-ups: the canon-spec "Codebase-wide term renames" rule is skill-only, not in the spec/spec-revision phase prompts — a separate decision.
     Prior entries are in git history. -->

---

### Match a remote ref probe on the exact `refs/heads/<name>` line, not a pattern

*(2026-10-24, source: pr-pushes-scaffold-base)*

`git ls-remote origin <pattern>` tail-matches: asking for `x` also prints `refs/heads/feat/x`. A probe that treats any output as "the branch exists" will read a different branch's ref as the one it wanted, and then push or skip based on that. The failure mode is silent: the wrong ref looks present. Rule: parse the output and compare the full ref name, and map exit codes separately (here, 2 means the ref is absent and 128 means the remote is unreachable, so a missing branch and a network failure take different paths). Canonical example: `probeOriginBranch` in `src/orchestrator/git.ts`. Verify with a fixture where the wanted name is a suffix of another branch.

### Fail closed when a prune or refresh of remote state fails

*(2026-10-24, source: pr-pushes-scaffold-base)*

When a check computes "commits not on any remote" from remote-tracking refs, a stale ref for a branch deleted on the remote hides local commits from the check. The fix is to prune first, but a failed prune must not fall back to the unpruned refs; that silently reopens the hole. Rule: if the refresh step fails, skip the action that depends on it and warn, and do not compute from the old state. Prove the prune matters with a mutation: remove only the prune, confirm the stale-ref fixture then succeeds in pushing something it should refuse, and restore it. Canonical example: the missing-remote range in `src/orchestrator/git.ts` and its stale-origin integration case in `tests/run-task-safety.test.ts`.
