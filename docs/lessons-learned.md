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

### When a git batch subprocess can exit 128, isolate the bad input via bisection — not token-shape filtering

*(2026-06-14, source: docs-refs-validate-cited-paths)*

When a git command (`git check-ignore --stdin -z`, `git cat-file --batch`, etc.) can exit 128 on certain inputs, the temptation is to pre-filter by token shape (drop whitespace-bearing tokens, leading-dash tokens, etc.). That approach fails in two ways: (1) it guesses wrong about which shapes actually cause 128 — the real triggers for `git check-ignore` are outside-repo paths and symlink-traversal paths, not whitespace or flags; (2) filtering by shape drops legitimate valid inputs (a gitignored file with a space in its name is a real path and should flow through). The correct fix is batch bisection on exit 128: if the batch exits 128 and has >1 input, split in half and recurse; a single unprocessable input resolves to "omit" without poisoning its siblings. This is robust to any future 128-causer without requiring shape enumeration. Performance: bisection over ~1000 items costs ~21 spawns vs. ~977 for per-item fallback. Concrete case: `collectGitIgnoredTargets` in `scripts/docs-refs-check.mjs` — two reroutes tried token-shape filtering before empirical measurement revealed the actual 128-causers.

### Declare both the canon-managed root doc AND its templates/ mirror in the handoff Changes table

*(2026-06-12, source: code-review-counter-reset-helper)*

When a task edits any canon-managed doc in `docs/` (e.g. `docs/pipeline-orchestrator.md`), the pre-commit hook runs `sync-canon-templates.mjs` and stages the `templates/` mirror automatically. The pre-flight gate reconciles the cumulative branch diff against the handoff Changes table — if the mirror is in the diff but absent from the table, the gate rejects the handoff and forces a revision round. Always declare both the root path and its `templates/` counterpart in the Changes table whenever a canon-managed file is touched. The set of canon-managed files is defined by `CANON_OWNED` and `DELIMITED` in `src/lib/canon-owned.ts`.

### Specs for QA-end or --pr-stage commit gates must not require Affected Files rows for managed docs

*(2026-06-12, source: qa-end-commit)*

`humanReviewAllowedPath` (and `verifyBaseDrift`) automatically union all `PIPELINE_MANAGED_DOCS` into the allowed set once `qa.status === 'done'`. A spec that writes an AC of the form "a QA-touched managed doc absent from spec Affected Files must abort the commit" inverts the real invariant — such a doc is *committed*, not flagged. This caused an AC-10 inversion caught in spec_review round 1 and required the AC to be rewritten before implementation. When writing any spec that reasons about which files are allowed at the QA-end or `--pr`-push gate, check `humanReviewAllowedPath` in `scripts/run-task/main.ts` (≈ line 652) and `verifyBaseDrift`'s QA-done auto-allowlist block in `scripts/run-task/validation.ts` (≈ line 1430) before asserting allow-list scope — the gate already unions managed docs unconditionally at `qa.status === 'done'`.

### Use pathspec excludes, not --exclude-dir, in git grep inventory scans

*(2026-06-14, source: release-agnostic-adopter-guidance)*

`git grep` does not accept `--exclude-dir`; the flag is silently ignored or causes an error depending on the git version. Use pathspec excludes instead: `git grep -n -e '<term>' -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)tasks' ':(exclude).git'`. Any spec AC that calls for a `git grep` inventory scan (e.g. AC-1 model-presuming-term inventory) should either supply the exact command with pathspec excludes or note that the implementer must discover the correct exclusion syntax for the repo. The `--exclude-dir` trap is silent — the scan appears to succeed but includes `node_modules/` hits, polluting the disposition table with non-shipped surface entries.

### Strip flags from the re-exec child argv rather than using an inherited env var to skip per-re-exec behavior

*(2026-06-14, source: reroute-detaches-before-loop)*

When `detachAndExit()` re-execs the process (same argv, `CANON_DETACHED=1` added), any env-var guard you place on code that should only run in the parent is also inherited by every subprocess the orchestrator later spawns — agent runners, test processes, nested `main()` calls. An env-var guard like `if (process.env.CANON_DETACHED !== '1') { doParentOnlyThing(); }` silently skips the parent-only code for those subprocesses too. The correct scoping is to strip the relevant flag from the child argv in `detachAndExit()` itself — the child re-enters `main()` without the flag and skips the parent-only path, while subprocesses launched later with a fresh argv are unaffected. Concrete case: stripping `--reroute` from the detached child argv in `scripts/run-task/detach.ts` so `rerouteFromHumanReview()` is parent-only. Whenever re-exec behavior differs between the parent and child (or the child and its own subprocesses), reach for argv manipulation over env-var state.

### Tests that validate worktree-local files must read from WORKTREE_ROOT, not REPO_ROOT

*(2026-06-15, source: canon-inline-review-skill)*

In a linked-worktree pipeline run, `REPO_ROOT` points at the supervising checkout — not the task's active worktree. A test that validates file content by reading `path.join(REPO_ROOT, 'README.md')` will silently read the stale pre-task copy and miss edits the task made in the worktree. The `README "Skip the permission prompts" allowlist matches RECOMMENDED_ALLOW` drift test in `tests/cli.test.ts` hit this exact failure: the test passed `REPO_ROOT`'s README but the task's edits were in the worktree. The fix (now in place): read from `WORKTREE_ROOT` for any path-dependent drift check that validates files the current task edits. General rule: when writing a new test that reads a file whose content could differ between the supervising checkout and the task worktree, use `WORKTREE_ROOT`; use `REPO_ROOT` only for files the task is explicitly not touching.

### List templates/ mirrors in the spec Affected Files table, not just the edited root docs

*(2026-06-16, source: canon-spec-review-rename)*

When a spec edits any canon-managed file (anything in `CANON_OWNED` or `DELIMITED` in `src/lib/canon-owned.ts`), the pre-commit hook regenerates a matching `templates/` mirror. Those mirrors land in `git diff <base>...HEAD` and must appear in the handoff Changes table — this is already captured as a lesson (see *Declare both the canon-managed root doc AND its templates/ mirror in the handoff Changes table*). The spec-authorship corollary: also list the `templates/` mirrors in the spec's Affected Files table. If you don't, the spec_review phase will flag the missing generated-artifact rows as a blocking gap and force a spec revision before implementation begins. Concrete case: `canon-spec-review-rename` spec-reviewed clean after adding all seven `templates/` mirror paths to Affected Files; the pre-revision spec triggered a round-2 changes_requested when they were absent. When writing a spec for any task that edits canon-managed files, run through `CANON_OWNED` for each edited root path, identify its `templates/<path>` mirror, and add a row for it in the Generated Artifacts section of Affected Files.

### Structural file-read tests must use `process.cwd()`, not a REPO_ROOT env var, when they validate files the current task edits

*(2026-06-18, source: relocate-rules-to-prompts)*

In a linked-worktree pipeline run, `REPO_ROOT` (and any constant derived from it) resolves to the supervising checkout — not the task's active worktree. A structural test that reads template or prompt files via `path.join(REPO_ROOT, 'scripts/...')` will silently read the pre-task copy and miss the edits the current task made. The fix: build file paths from `process.cwd()` in any test that validates files the current task is editing. `process.cwd()` resolves to the active worktree's root for test processes launched by the orchestrator. Contrast with the prior lesson (*Tests that validate worktree-local files must read from WORKTREE_ROOT, not REPO_ROOT*): that lesson covers runtime code using an env var; this one covers test code using a constant. Either way, the rule is the same — `REPO_ROOT` is the wrong anchor for files a task in a linked worktree edits. Concrete case: `tests/run-task-prompts.test.ts` AC-11 structural assertions (presence tokens, absence tokens, scaffold sweep) intentionally use `process.cwd()` so they validate the edited checkout.

