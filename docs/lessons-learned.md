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

---

### Name the overlap winner before finalizing a user-configured file list

*(2026-10-15, source: configurable-docs-freshness)*

When a new config lets adopters name files that an existing writer already owns (here, a telemetry log with its own unconditional append rule), the spec must state the overlap policy explicitly. Without one, admission order silently decides: a read-only call with an empty doc set still selected the telemetry file, and a configured flag-only telemetry doc would have conflicted with QA's unconditional append. Spec review caught it as F1; the fix was to reject telemetry and task-artifact paths anywhere in the config, so the sets stay disjoint. Rule of thumb: for every new user-supplied file list, enumerate the existing writers of those files and record which one wins before the config schema is final.

---

### Test a hand-rolled glob matcher for backtracking and dot-file behavior

*(2026-10-15, source: configurable-docs-freshness)*

A regex-built `**` matcher with adjacent globstar segments backtracks badly: 30 consecutive globstars against a 30-level non-matching path ran past two seconds, and the regression only failed by hitting a subprocess deadline. Collapsing adjacent `**` segments before building the regex fixed it. The matcher was written in-repo rather than using `path.matchesGlob`, because the config needed dot paths matched and Node's matcher skips them. Rule of thumb: when writing a glob matcher for user config, decide the dot-file rule up front and test a dotted path, and add a deep non-matching case run under a subprocess timeout, since an unbounded test hangs rather than failing.

---

### Check that a prompt builder passes each per-task value a template renders

*(2026-10-17, source: per-task-telemetry-fragments)*

A spec that names a per-task value inside a prompt template (for example, a fragment path for each bundle member) is unimplementable if the builder only passes formatted strings. `promptQa()` passed `taskLines` and `taskScope` and no per-task field, so the template could not substitute the path, and spec_review rejected the first draft. Before naming a template variable in a spec's Affected Files, grep the builder's call site for the value it would need, and list the builder if it does not pass that value as data.

---

### Force a rename failure with a sentinel file, not an empty directory

*(2026-10-17, source: per-task-telemetry-fragments)*

`fs.renameSync` onto an existing empty directory succeeds on POSIX, because it replaces the directory. A red-first test that expects ENOTEMPTY from an empty `tasks/_archive/<id>/` therefore never fails, and the test looks like it covers the failure path when it does not. Put a sentinel file in the destination so the rename really fails. Probe the failure trigger in isolation before using it as a red-first fixture.

---

### Round-trip tests of a re-rendered row need two or more write-read cycles

*(2026-10-17, source: per-task-telemetry-fragments)*

The quality-log decoder halved backslashes once while the renderer escaped them on every write, so each QA rerun or fold doubled them. A single parse-then-render round trip passed, and only a repeated write, read, write cycle exposed it (code review C1). For any table cell that is parsed and written back out, assert the bytes are stable after at least two cycles, including values with backslashes, pipes and trailing backslashes.

---

### Park a typed agent failure at one boundary, and reopen bundle members only where no agent runs after routing

*(2026-10-20, source: agent-failure-parks-phase)*

When a failed agent session must stop a run durably, throw a typed error from the wrapper and catch only that type at one loop boundary; rethrow everything else. Returning a failed result instead lets phase post-processing treat truncated stdout as a finished result: a QA phase would salvage `done.md` from partial output. If the park also reopens completed bundle members, that is safe only while no agent session runs after the routing writes; this task's argument depended on that ordering. Before adding an agent call after a verdict or routing write, check whether a park at that point would reopen members that routing already moved on. Keep the bundle partial-completion integration test as the tripwire.

---

### A helper-level test does not prove the call site that wires it in

*(2026-10-20, source: autocommit-retry-at-review-entry)*

The retry was added to the main loop, but its first tests called only the exported helper. They passed while the loop's call site was never exercised, and the spec's integration ACs (pre-flight counter stays 0, no `handoff→diff` block) stayed unmet until code review flagged them. The fix was a fixture that drives `main()` to code_review. Rule of thumb: for any gate or retry placed in a router or loop, write at least one test that drives the entry point, then delete the wiring line and confirm that test fails. For a pre-flight gate, the fixture must keep the checked file out of the base diff, or the gate cannot reproduce the failure it guards.

---

### Anchor a log-marker parser on the marker's tail, not its line start

*(2026-10-20, source: watch-crash-not-step-done)*

A writer that appends an exit marker without a leading newline puts the marker mid-line whenever the output before it lacked a trailing newline. A parser anchored with `^` misses that marker and falls back to the wrong answer; here a real crash was reported as `step_done`. The spec's first amendment added line-start anchoring, and the second reversed it after code review: the regex matches anywhere and requires the ISO timestamp to end the line or file, which also rejects a tail cut mid-marker. Rule of thumb: when parsing a marker a process writes on exit, anchor on the fixed suffix the writer always emits, and test both a marker that follows unterminated output and a truncated tail.

---

### Don't use files an exit handler deletes as crash evidence

*(2026-10-20, source: watch-crash-not-step-done)*

A `process.on('exit')` cleanup that removes runtime files runs on every exit path, clean or not, so the files' absence says nothing about how the process ended. Here the pid and heartbeat files were gone after a crash just as after a clean step exit. Only an exit line written outside that cleanup told the two apart. Rule of thumb: before using a pid or heartbeat file to detect a crash, grep for the cleanup that removes it. If it runs on all exits, only a surviving file is evidence of an unclean exit, and an absent file proves nothing.

---

### When fixing a state classifier, list every entry point that reads the same state

*(2026-10-20, source: watch-crash-not-step-done)*

The crash fix went into the idle classifier, but `canon watch` also classifies at attach time, and the spec's Non-Goals left that path alone. A crash that happened before watch attached still reports `nothing_to_watch` (exit 2), and cold review flagged it as a spec_gap that the operator then accepted. The bug also sat in an earlier specific return (pending-after-done → `step_done`) that shadowed the generic `death` fallback, so the fallback was never reached. Rule of thumb: before scoping a fix to how a status shape is classified, grep every function that classifies that shape (attach-time, loop-time, `--until`), fix each one or name it as a non-goal with its user-visible result, and check whether an early return matches the crash shape before the fallback.

---

### Probe the commit you are about to push, after hooks have run

*(date 2026-10-20, source: base-drift-conflicts-only)*

A gate that checks a commit before a push must read the commit git recorded, not a candidate built beforehand. A pre-commit hook can rewrite the index after the candidate is built, so a check that passed on the candidate can still push a conflicting tree. This task's spec review rejected a pre-commit candidate probe for that reason and probed `HEAD` after `git commit` instead. When a gate aborts after the commit, undo it with `git reset --soft` to the recorded pre-commit HEAD, which keeps the content staged. Check the fixture for a hook that rewrites the index: the test should fail if the gate probes the pre-hook index. Canonical example: the base-drift gate in `src/orchestrator/main.ts`, with the hook-rewrite case in `tests/run-task-safety.test.ts`.

---

### Inject a concurrent base commit before ref resolution, not from a pre-push hook

*(2026-10-21, source: full-send-tail-push-and-watch)*

A real-git test that asserts "a push by SHA excludes a commit that lands after the listing" cannot inject that commit from a `pre-push` hook. Git resolves the refspec before it runs the hook, so a branch-name push and a SHA push both look correct, and the test stays green for the wrong reason. The working injection point is a `git` wrapper earlier on PATH that commits to local base and then `exec`s the real git, so the commit lands before ref resolution. Rule of thumb: for any race test around a push, check the push variant that should fail (a push by branch name) turns the test red with the injection in place, and inject from a wrapper or before the listing call, not from a hook.

---

### A scope guard over dirty paths must also snapshot HEAD

*(2026-10-21, source: artifact-lint-agent-fixup)*

A guard that fences what an agent session may change by comparing `git status` output misses a session that stages and commits a previously clean tracked file: the porcelain state returns to clean, so the guard sees nothing. This task's round 2 review caught that gap, and the fix added the resolved `HEAD` to every snapshot. The fix also needs the content of each dirty path, not just the set of paths, because an edit to an already-dirty file leaves the same path list. Rule of thumb: before writing a "the agent may not change X" guard, snapshot the content of every candidate path and the `HEAD` SHA, then compare both after the session. A test should have the session commit an edit to a clean tracked file, not only edit a dirty one.

---

### Test guidance prose by the clause it must enforce, not by separate keywords

*(2026-10-22, source: red-first-evidence-slot)*

A test that pins a reviewer charter with independent substring matches (one for a heading, one for a term, each found somewhere in the section) keeps passing after the one clause that makes a check closable is deleted, because each keyword still appears elsewhere. This task's review flagged it: a Stage 1 item whose late-evidence clause makes a gap recoverable would have had no test that fails without it. The same test also sliced the template from the first HTML comment, so an added earlier comment would have moved the slice silently. Rule of thumb: when a test pins guidance prose, match the specific clause as one phrase and assert that phrase within the exact section it belongs to, and check that removing the clause turns the test red.

---

### Fixture-encoded stream shapes prove the parser, not the harness

*(date 2026-10-22, source: code-review-lens-timing)*

A parser for a CLI's output stream (Claude Code's `stream-json`, Codex's `--json`) written against fixtures passes its tests even when the field paths are wrong, because the fixtures encode the same assumption the parser makes. This task's plan noted that the `tool_use_id` path was not re-verified against a real capture, and that a mismatch would only degrade to `-` values. Before the feature ships, capture one real run of the harness and check each field path the parser reads, then confirm the output in a live run. When a field can only be verified by a live run, say so in the spec's Human Test Plan and in the PR body, not only in the test names. Rule of thumb: for any new read of harness output, grep the captured stream for each key path before writing the fixture, and make the fixture a copy of the capture, not a new hand-written shape.

---

### When a message restates one contract value on several lines, change every line and check what the new value admits

*(2026-10-22, source: recovery-command-fixtures)*

A halt message that names the same heading on two lines (the fix line and a scope note) can be half-fixed: correcting the fix line left the scope note naming the bare heading, and code review caught it. The corrected round-numbered heading then created a second problem, because a blessed section with that heading satisfied the next human reroute gate with no new amendment. Rule of thumb: when a fix changes a value in an emitted message, grep the emitter for every line that names that value and change them together, then ask whether the replacement lets a bypass path (here, BLESS) satisfy a gate the operator is supposed to pass by hand. Test the replacement by following the printed instruction, then running the next command it implies. Canonical example: the spec_gap halt in `src/orchestrator/main.ts`, with the chained scope-BLESS-reroute fixture in `tests/recovery-hints.test.ts`.

### Derive a fixture's phase from phase statuses before testing a state-specific message

*(2026-10-22, source: recovery-command-fixtures)*

A chained fixture that sets a top-level `status` field, or sets one phase's status to a value that conflicts with the phase it names, does not reach the state it claims. Phase identity comes from `status.phases`, so the derived phase can be a later one: a `code_review` case left `code_review` as done and landed at `qa`, and the `qa` case landed at `human_review`. The registry's coverage claim was false until review caught it. Rule of thumb: build the fixture's state from phase statuses the way an agent would leave them, assert the phase the state derives to before running the command under test, and fail the test if the derived phase is not the one it names.
