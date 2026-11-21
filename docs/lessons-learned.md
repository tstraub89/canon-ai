# Lessons Learned

> Distilled cross-task insights. Task runs write lessons fragments; `canon run --ship` folds them here when a task surfaces a reusable insight that would have changed how a *different* task was approached.

## How to use this doc

This file accumulates over the lifetime of the project. Entries land here from two paths:

1. **QA distillation (automated, append-only)**: At the end of each task, the QA phase reads `tasks/<id>/notes.md` (raw scratchpad observations from any phase) and asks "would this have changed how a *different* task was approached?" If yes, it **appends** one entry to that task's `lessons.md` fragment; `--ship` folds it into this shared doc. If no, the detail stays in `notes.md` only. QA never edits, prunes, promotes, or reorganizes existing entries — appending its own task's fragment is its only lessons write. Task runs never write this shared doc directly.

2. **Lessons sweep (human-initiated and human-approved only)**: Promoting entries into permanent docs and pruning the buffer is a **human decision**. Agents never perform it autonomously, and no entry count ever auto-triggers it. Two occasions call for a sweep: (a) when this file plus the current task's lessons fragment exceed ~15 entries — the QA phase notices and *signals* it with a one-line note in the task's `done.md`, but does not act; and (b) at the end of a release milestone — a human-recognized occasion, since the QA phase has no notion of release boundaries and emits no signal for it. Either way, a human runs the sweep when they choose to (the `/canon-sweep` skill walks the triage and proposes a verdict per entry before anything is written):
   - **Promote durable truths** to the right permanent doc — `docs/patterns.md` (a pitfall), `docs/decisions.md` (a settled decision), or `AGENTS.md` / `CLAUDE.md` (a workflow / spec / review rule). Then prune the entry here.
   - **Prune task-specific entries** that turned out not to generalize. Just delete them — the detail lives in the task's `notes.md` and the git history of this file.

The goal: this file is a *staging area*, not a permanent archive. Entries that prove durable get promoted by a human; entries that don't get pruned by a human. The total count stays manageable. Tombstones from past promotions are not preserved — `git log docs/lessons-learned.md` is the audit trail. The permanent docs the sweep promotes into are pruned separately: a human runs the `/canon-prune` skill when they choose to, and no entry count or size threshold triggers it.

## Entry format

Each lesson is a short paragraph with this shape:

```markdown
### Short imperative title naming the rule

*(date YYYY-MM-DD, source: TASK-ID or `manual`)*

The rule, then the failure mode it prevents (specific incident if recent), then the concrete prevention (what to grep for, what to verify, where the canonical example lives). Reference symbols/files via the `` `SYMBOL` in `path/file.ts` `` form.
```

The title is the lesson — a future reader scanning headings should learn the rule from titles alone. Resist the urge to make it cute or descriptive of the bug; name the *rule that prevents the bug*.

---

### When adding a location/scope constraint, add one boundary check rather than teaching every consumer a new state

*(2026-09-03, source: worktree-root-in-repo)*

A spec that needs "X outside the new boundary should stop working" is tempting to implement by narrowing every function that looks X up — scope the lookup, and an out-of-boundary X becomes unfindable, hence "missing," for free. This task tried exactly that for three spec-review rounds: each round found a different consumer (a ship path, a teardown path, a bundle-secondary scan) that the narrowed lookup broke, because none of them was built to receive the newly-invented "out of boundary" state, and one canonical case (a blank-branch record that a scoped lookup can no longer distinguish from "never existed") couldn't be made to fail loudly at all — it silently fell through to the wrong answer. The fix that converged: leave every lookup/consumer alone, and add exactly one boundary check at the single entry point that was going to act on the result (`canon run`, before any phase). Rule of thumb: when N existing consumers each read the same resolved value, and a new constraint should block *acting* on an out-of-bounds result rather than change *what resolves*, put the check at the action's entry point, not inside resolution — resolution redefining an existing state must be re-taught to every consumer, and there are reliably more consumers (and lifecycle states) than the first pass enumerates. See also the canon-spec skill's "≥3 spec_review iterations" rule of thumb for the same convergence-vs-scope-creep tell in a different shape.

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

---

### A prompt that names a file must also tell the agent to open it

*(2026-10-25, source: reroute-from-implement)*

A reroute prompt pointed the agent at the archived review (`review-prior-<n>.md`) and said its unresolved findings "remain binding", but no instruction told the agent to read it. The sentence was true and still did not get the findings read, and a cold reviewer flagged it as P2. Prevention: when a prompt cites an artifact the agent must act on, pair the citation with an explicit read step, and grep the rendered prompt for the read verb near the path. A test that only checks the path appears in the prompt cannot catch this. Canonical example: the archive guidance built in `archivedReviewGuidance()` in `src/orchestrator/prompts/index.ts`, and the implement-reroute template's step list.

---

### A request flag one backend honors is a silent no-op on the other backend

*(2026-10-30, source: claude-provider-mode)*

Routing a call site to a second backend exposes every per-request flag the first backend honored. `wrapForResume` was honored only by Codex. Once Claude-held roles reached the implement reroute and the artifact fix-up, the Claude backend ignored the flag: it prepended a resume banner and stripped the commit-ownership startup. Code review caught it in round 1. Prevention: when a call site moves to another backend, list every field of the request object and confirm each backend reads it. Then test the prompt each call site actually delivers on that backend. Canonical example: `claudeBackend.run` and `runClaude` in `src/orchestrator/agents/claude.ts`, compared with `runCodex` in `src/orchestrator/agents/codex.ts`.

---

### Classify a table by its position or header, not by what its cells contain

*(2026-11-08, source: path-scoped-pitfalls)*

A parser that decides whether a markdown table is an index (a lookup of docs or sections) by sniffing its cells misclassified tables in three consecutive review rounds. Each content rule (a path token, an em dash, a heading-like cell) fixed the layout the last reviewer reported and broke one the previous rule handled, because an explanatory table inside an entry can carry the same signals as an index. The rule that settled it was positional: only tables directly under the section heading, before the first entry, are indexes; a table inside an entry is entry content. The same pattern held for choosing a row's target cell: a header hint ("Read this doc", "Section") beat any content precedence. Prevention: when a spec needs to tell two kinds of table apart, write the rule as position or header text in the spec before implementing, and pin each real layout in a test. Do not add a content heuristic to a parser already in review. Canonical example: `knownPitfallsIndexTables` in `src/orchestrator/pitfalls.ts`, with the rule stated in `tasks/_archive/path-scoped-pitfalls/spec.md` Amendment 1.

---

### A directory-matching glob must be tested at the directory's depth, not just under its prefix

*(date 2026-11-08, source: pitfalls-coverage-gaps)*

When a matcher asks "could some path inside this directory match this glob," a glob with the directory's exact segment count (`src/*` against `src/a/`) matches the directory itself, not anything inside it, and a prefix-only test would say yes for every leading-wildcard glob. The implementation had to require a deeper segment, and the plan's example said the opposite. Prevention: when a matcher decides whether a glob reaches inside a directory, write a boundary case for each of: the glob equal in depth to the directory, the glob one level deeper, a `**` segment, and a sibling directory sharing a name prefix (`src/ab/**` against `src/a/`). Judge the spec's example against the boundary rule before copying it into a plan. Canonical example: `globCouldMatchInsideDir` in `src/orchestrator/pitfalls.ts`, with its `**` and sibling-prefix cases in `tests/pitfalls.test.ts`.

---

### Check the legitimate values of a shape before replacing an exact-text placeholder match

*(date 2026-11-08, source: post-ship-cleanup)*

The Self-Check placeholder check moved from matching the template's exact `_(` prefix to rejecting any Evidence cell that is entirely parenthesized. That also rejects real evidence written the same way, such as `(verified both entry points against the diff)`. Two cold reviewers flagged it. The spec had accepted the shape rule as a Known Risk, so it shipped with the cost. Rule of thumb: when a check moves from exact-text matching to shape matching, list the real values that share the shape (parenthesized prose, a bare `(N/A)`) in the spec, and either accept each one or keep the exact match. Canonical example: `checkSelfCheckEvidence` in `src/orchestrator/validation.ts`, with its tests in `tests/run-task-validation.test.ts`.


<!-- Buffer swept 2026-11-19 (16 entries reviewed: 3 promoted, 12 kept in buffer, 1 pruned).
     Promotions → AGENTS.md Code Review Rules: restatement bullet now covers relational claims and operator config-location instructions (contract-sweep-relational; recurred after message-restates-value). canon-spec skill checklist and the pipeline spec prompt checklist (src/orchestrator/prompts/index.ts): unchecked Validation Required rows are ignored, so delete inapplicable template placeholders such as <E2E> with an N/A reason. Site comment: string-built recordMetric call in tests/run-task-safety-routing.test.ts.
     Kept in buffer: one-boundary-check — re-evaluate if a scope/boundary task hits it; overlap-winner — re-evaluate on the next adopter file-list config; round-trip-two-cycles — re-evaluate on another parse-and-rewrite cell bug; exit-handler-files — re-evaluate if crash detection is touched; message-restates-value — graft its bypass-gate check into the clause-builder pitfall if it recurs; prompt-names-file — re-evaluate if another prompt cites an artifact without a read step; backend-flag-no-op — re-evaluate when another call site changes backend; classify-table-by-position — re-evaluate if another parser churns on a content heuristic in review; shape-vs-exact-placeholder — re-evaluate if a shape check rejects real values again; directory-glob-depth — structural, stays until a test pins the equal-depth boundary; gate-every-caller — graft into patterns.md "Enumerate every writer" if another gate change breaks a salvage or recovery caller; plan-file-outside-affected-files — re-evaluate if it recurs; carrier would be the plan prompt.
     Pruned: malformed-precondition fixture — covered by patterns.md "Prove each regression test can fail".
     Unresolved follow-ups: the equal-depth boundary test for globCouldMatchInsideDir (src/* against src/a/) has not landed.
     Prior entries are in git history. -->

---

### Gate every caller of a shared phase transition, including salvage paths

*(2026-11-15, source: ship-followup-capture)*

A new rejection in a phase gate reached a caller that did not expect it. The QA stdout-salvage path calls the qa → done transition directly, so a salvaged done.md without the new section threw out of the phase runner and left qa `in_progress` with no repair route. The plan had flagged the path and deferred it, and code review caught it in round 1. Prevention: when a gate adds a rejection to a transition, grep every call site of that transition, including recovery and salvage paths, and confirm each one either handles the rejection or is left alone on purpose. Canonical example: `runQaPhase` in `src/orchestrator/phases/qa.ts`, which calls `taskPhase` and is the path that escaped.

---

### Put a file the plan finds outside Affected Files into the spec before implement

*(2026-11-15, source: ship-followup-capture)*

The plan noticed that a salvage path, five QA test fixtures, and a recovery guide also had to change, but kept them out of the spec's Affected Files and left them as notes for the operator. Implement is capped by Affected Files, so the implementer logged them as Blockers, and code review raised three spec-gap findings that needed an amendment. Prevention: when a plan or notes entry says a file outside Affected Files must change, amend the spec's Affected Files before implement starts instead of leaving it as a note. When writing the list, grep for the tests that drive the changed gate or phase, because fixtures that supply the old input are the usual omissions.

---

### A skill's restated selector drifts from the code that selects; state the general rule, then check each path

*(2026-11-19, source: canon-prune-skill)*

The prune skill's implement-prompt guard listed the content that pitfall selection injects one surface at a time. Each review round found a path the list missed: routing-table rows, the no-H3 prose fallback, Trigger Table targets, then whole-document targets. Each enumerated fix moved the gap instead of closing it. Prevention: when a doc or skill restates what the runtime selects, write the general selector (for example, "every source the code reads for this section"), then check it against each code path in the selector's source, including fallbacks and whole-document targets. Do not add one more named case per round. Canonical example: `buildIndexRows` and the linked-target handling in `src/orchestrator/pitfalls.ts`.

---

### A "never read" rule needs its exceptions named where the skill cites a heading inside that set

*(2026-11-19, source: canon-prune-skill)*

The prune spec said canon-managed files are never read. The skill still told the agent to run the preflight in canon-sweep §"Preconditions" and to take a home from canon-sweep §"Step 2", and both sections sit in that managed set. The contradiction went to review as a correctness bug. Prevention: when a rule says a set is never read or edited and a skill points at a heading in that set, state the exception in the same sentence, name the exact sections, and say which parts of them apply (here, only the three preflight checks). Otherwise the agent either skips the reference or breaks the rule.

---

### A carve-out's condition must match the rows it covers, not a run of another skill

*(date 2026-11-20, source: canon-prune-run-lessons)*

A docs-audit carve-out said the "describes a canon mechanism" delete rule does not apply "when pruning canon-ai's own root docs with `/canon-prune`." The rows it covers are canon-managed root copies, and `/canon-prune` excludes canon-managed files from its input, so the condition could never be true for them. Two cold reviewers flagged it as unreachable. Prevention: when a carve-out covers a set of files, state the exception unconditionally for those rows and say why it applies. Do not condition it on a run of another skill that never touches those files. Before writing the wording, check the other skill's input rule for those same files. Canonical example: the docs-audit prune row in `.claude/skills/docs-audit/SKILL.md` (line 26), against the exclusion in `.claude/skills/canon-prune/SKILL.md`.
