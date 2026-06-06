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

<!-- Buffer empty after the 2026-06-01 sweep (release/v1.9). Promotions: refactor structural-caps + cross-cutting-helper rules → CLAUDE.md; strict structured-input parsing → AGENTS.md; worktree REPO_ROOT/cwd/session divergence → docs/patterns.md; CliArgs wiring → docs/codebase-map.md. Prior entries are in git history. -->

### Integration tests for process-local registries must seed the handle inside the subprocess

*(2026-06-01, source: watch-worktree-flip-false-idle)*

When orchestrator-internal behavior depends on a process-local registry (such as `activeHandles` in `scripts/run-task/heartbeat.ts`), an integration test that seeds the registry in the parent process and then calls the production path in a subprocess will exercise an empty registry — the production code never sees the seeded state. The test must spawn a subprocess that both seeds the registry (or calls `startHeartbeat`) and runs the code under test within the same process. The tell: a test that "proves" a registry-sweep path is exercised but seeds the data on the wrong side of a process boundary; `activeHandles` is cleared on every fresh `require`. Before writing any integration test that calls into registry-backed orchestrator paths, confirm whether `ensureBranch` / `ensureWorktree` / similar functions resolve their module-level state at load time or at call time — module-load-time resolution is the flag that forces subprocess seeding.

### A reverted file must be removed from every prior iteration's Changes table in handoff.md

*(2026-06-01, source: watch-worktree-flip-false-idle)*

The pre-flight handoff verifier diffs the *cumulative* set of files across all Changes tables against the branch diff. If a file appears in an earlier iteration's table but is fully reverted (no longer in `git diff base...HEAD`), it will fail the pre-flight check even if it's absent from the latest iteration's table. When reverting a file during a reroute or revision: remove it from every prior Changes table entry where it appears — not just the most recent section. Conversely, a file that is still in the diff but was listed in an earlier iteration and carried forward must appear in at least one Changes table so the cumulative union covers it. The tell: pre-flight rejections citing files you know you reverted — the problem is always a stale entry in a prior iteration block, not the newest one.

### When removing a large function block, verify every symbol deleted is not shared before staging

*(2026-06-01, source: retire-release-init)*

When a large block of code is deleted in a retirement or refactoring task, shared helpers nested inside or near the removed block can be swept up in the deletion. The failure is silent until lint or typecheck runs: the symbol disappears from the compiled output and the downstream consumer fails with a "not exported" or "not found" error. Prevention: before staging a large deletion, grep the rest of the file (and the codebase) for every symbol you removed — especially ones that are not exported but are referenced internally. In this task, `readJsonFile` lived near the deleted `taskReleaseInit` block in `src/task/index.ts` and was accidentally removed; `npm run lint` caught it immediately. The rule: `git grep -n '<symbol>'` on each deleted non-public helper before committing. See [[feedback_byte_identical_refactor_trap]] for the related "correctness audit before deletion" rule.

### Reference deleted files in handoff Changes tables with markdown-link syntax, not backticks

*(2026-06-01, source: retire-codex-md)*

`docs-refs-check` scans backtick file-path refs (`` `path/to/file` ``) as live references and reports them as broken if the file no longer exists — even when the deletion is the entire point of the handoff entry. A handoff Changes table row that references a deleted file with the standard backtick form will fail `docs-refs-check` after implementation, making the mandatory deletion entry self-defeating. Fix: use markdown-link form (`[path/to/file](path/to/file)`) for deleted-file rows in the Changes table. This preserves the diff-reconciliation entry (the orchestrator's pre-flight verifier still matches it against `git diff`) while bypassing the ref scan. The tell: `docs-refs-check` reports "missing file" on a path you intentionally deleted, from inside `handoff.md`.

### Changing QA prompt context requires regenerating the golden snapshot fixture

*(2026-06-02, source: qa-drafts-pr-body)*

`promptQa` is snapshot-tested via `tests/run-task-prompts.golden.json`. Any spec or task that alters what is injected into the QA prompt — new template variables, new sections, changed default text — must regenerate that fixture or the prompts test suite will fail with a snapshot mismatch. The tell: a QA-prompt-context change that passes lint and type-check but fails `npm test` with a golden diff. Regeneration is a one-liner (`npx jest run-task-prompts --updateSnapshot` or equivalent); listing `tests/run-task-prompts.golden.json` in the spec's Affected Files table is the prevention. Sibling golden fixtures exist for other prompt types — check whether your change touches those too before assuming only the QA golden needs updating.

### Backtick refs to any missing file in handoff/review prose trip docs-refs-check, not just Changes table rows

*(2026-06-03, source: release-agnostic-surface)*

`docs-refs-check` treats every backtick-wrapped path (`` `path/to/file` ``) in markdown files as a live reference and reports a broken ref when the file doesn't exist — even when the reference is purely explanatory prose, not a navigable link. This fires in `handoff.md` and `review.md` body sections (implementation notes, rationale paragraphs), not just in Changes table rows. The existing lesson for Changes tables (use markdown-link form for deleted files) covers one case; this lesson covers the broader pattern: any backtick ref to a file that doesn't exist in the repo will fail the check. Prevention: when writing explanatory prose that names a missing or non-shipped file (e.g., `docs/decisions.md §Versioning` when that file is absent from the working tree, or a canon-internal file that adopters don't have), use bare prose ("docs/decisions.md §Versioning" without backticks) or an inline description. The tell: `docs-refs-check` reports "missing file" on a path you know the repo doesn't contain, inside a prose section of handoff.md or review.md.

### When a source file bundles into multiple dist artifacts, declare all of them in Affected Files

*(2026-06-04, source: reroute-latest-amendment-section)*

`npm run build` can regenerate more than one committed dist artifact from a single source change. In canon-ai, `scripts/run-task/validation.ts` bundles into both `dist/scripts/run-task.js` and `dist/cli/index.js`. A spec that only declares one of the pair will fail the `--pr` base-drift gate (which diffs the worktree against `origin/<base>` and rejects any undeclared changed file). Prevention: when a spec touches a file under `scripts/run-task/`, check `npm run build` output for every artifact it writes — then list all of them in the spec's Affected Files table. The tell: `--pr` gate rejects a file with a name like `dist/cli/index.js` that you never touched directly.

### Drift-guard tests require the guarded list to be exported at the module boundary

*(2026-06-04, source: pr-body-completeness-guards)*

A test that asserts "list A must cover set B" can only avoid duplicating list A if it can import A directly. When the guarded list is module-private, the test has two choices: export the list, or hardcode a second copy — and hardcoding re-introduces the exact drift the guard exists to prevent. Prevention: when writing a drift-guard test, check whether the guarded constant is exported. If not, exporting it is the right fix (not duplicating it in the test). The tell: a new drift-guard test that, to compile, declares its own `const EXPECTED_... = [...]` next to the one it's supposed to guard against. In `src/cli/commands/doctor.ts`, `EXPECTED_TEMPLATES` was module-private until this task exported it for the AC-2 drift guard.

### Adding a new verdict requires updating both the TypeScript type union and the separate runtime validator

*(2026-06-05, source: multi-agent-code-review)*

Canon's verdict type (`Verdict` union in `scripts/run-task/types.ts`) and the runtime validator (`VALID_VERDICTS` set + `assertValidVerdict()` in `src/task/index.ts`) diverge by design. Adding a new verdict to only the type union makes TypeScript happy but leaves `canon task phase ... <verdict>` throwing a runtime error — the command calls `assertValidVerdict()` before writing `status.json`. Similarly, the CLI help list (`src/cli/index.ts`) and the `extractCheckedVerdict()` regex in `scripts/run-task/validation.ts` are separate surfaces that both need the new value. When a spec adds a new verdict, enumerate all four surfaces explicitly in the Affected Files table (or use AC-10's full seven-surface enumeration as the template). The tell: TypeScript compiles cleanly but `canon task phase ... <new_verdict>` fails at runtime with an "unknown verdict" error.

### When appending an audit block to a versioned artifact, use a non-scoping heading to preserve prior verdict parsing

*(2026-06-06, source: bundle-preflight-atomic-rejection)*

When a pre-flight or other orchestrator block appends to a `review.md` that already contains a real verdict (`- [x] **Approved**`), the append heading must NOT match the verdict parser's scope delimiter (`## Round`). `extractCheckedVerdict` uses `extractSectionBodies(content, /^## Round\b/)` to scope parsing to the latest `## Round N` body when one exists — so a new `## Round`-headed block with no verdict checkbox would return `undefined` instead of the prior approval. The correct pattern: use a non-`## Round` heading (e.g., `## Bundle Pre-Flight Rejection (round <N>)`) and omit the verdict checkbox entirely. This applies to any future path that appends administrative blocks (halts, rejections, audit notes) to a file that `extractCheckedVerdict` must also parse for routing. Prevention: grep `extractSectionBodies(content, /^## Round\b/)` in `scripts/run-task/validation.ts` before choosing an append heading. The tell: `extractCheckedVerdict` returns `undefined` on a file with a clear prior checked verdict, because a `## Round`-headed append block with no checkbox was added after it.

### A gate with one rejection message for all failure classes trains agents to fix the layer the message names

*(2026-06-05, source: preflight-failure-routing)*

When a validation gate emits the same verdict text for structurally different failure classes, the implementer learns to fix whichever layer the message points at — not the actual root cause. The concrete failure: the code_review pre-flight said "fix the handoff" for every blocker, including real test regressions; Codex's path of least resistance became relabeling `Fail` rows as `Fail – unrelated` (a handoff edit) rather than fixing the broken check. This looped until the review cap hit. Prevention: when writing or extending a gate, enumerate the distinct failure classes and emit a separate verdict message for each class that names the correct fix action ("fix the handoff" vs. "fix the code"). A single catch-all message is a design smell — it means the gate is conflating classes. The tell: a gate that fires repeatedly on the same failure while the agent iterates on the wrong layer.
