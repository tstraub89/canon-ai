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

### A grep AC's exception list growing across review rounds signals mis-scoping, not under-specification

*(2026-08-20, source: relax-reroute-gate-post-implement)*

When a spec AC verifies "no live surface states the old rule" via a repo-wide grep, and each `spec_review` round finds one more class of hit that needs to be excused (round 3: two leave-as-is classes; round 4: a third, pointing at a fourth), the temptation is to add the newly-found exception and move on. That pattern does not converge — `relax-reroute-gate-post-implement` measured it directly: `docs/BACKLOG.md` alone carried roughly a dozen more co-occurrences of the swept term, all dated history. The fix is not another exception; it's replacing the enumerated exception list with a small number of closed-form rules the grep's *scope* is defined by (e.g., "dated/historical records are categorically excluded" and "within live files, only prose stating a precondition counts, not any mention of the term"). The tell: if a grep AC's leave-as-is list grew on two consecutive rounds, stop adding a third exception and instead ask what closed-form rule would have excluded the whole class from the start.

---

### When adding a location/scope constraint, add one boundary check rather than teaching every consumer a new state

*(2026-09-03, source: worktree-root-in-repo)*

A spec that needs "X outside the new boundary should stop working" is tempting to implement by narrowing every function that looks X up — scope the lookup, and an out-of-boundary X becomes unfindable, hence "missing," for free. This task tried exactly that for three spec-review rounds: each round found a different consumer (a ship path, a teardown path, a bundle-secondary scan) that the narrowed lookup broke, because none of them was built to receive the newly-invented "out of boundary" state, and one canonical case (a blank-branch record that a scoped lookup can no longer distinguish from "never existed") couldn't be made to fail loudly at all — it silently fell through to the wrong answer. The fix that converged: leave every lookup/consumer alone, and add exactly one boundary check at the single entry point that was going to act on the result (`canon run`, before any phase). Rule of thumb: when N existing consumers each read the same resolved value, and a new constraint should block *acting* on an out-of-bounds result rather than change *what resolves*, put the check at the action's entry point, not inside resolution — resolution redefining an existing state must be re-taught to every consumer, and there are reliably more consumers (and lifecycle states) than the first pass enumerates. See also `docs/lessons-learned.md` → "A grep AC's exception list growing across review rounds signals mis-scoping" for the same convergence-vs-scope-creep tell in a different shape.

---

### A test asserting file existence is not a test of the file's content

*(2026-09-04, source: update-from-npm-registry)*

An AC that says "verify: assertions added to the provenance tests" can be satisfied by a test that merely checks the file exists (or that some unrelated field is present) while never reading the fields the AC actually cares about (`source`, `channel`, `version`, `resolved_sha`). This task's code review round 1 caught exactly that gap on a brand-new code path (the registry install branch): the production code wrote the right shape, but no test read it back and compared it. The fix cost a full review round that a stricter self-check would have avoided. Rule of thumb: when an AC's verify clause names specific fields or a specific shape, grep the test for an assertion on each named field individually — a passing `existsSync`/"has been written" check is not evidence the shape is right, especially on a path with no prior test coverage to imitate.

---

### Pin state before a long-running external process, not after

*(2026-09-27, source: code-review-delta-rerounds)*

When an orchestrator step needs to record "what the process reviewed/acted on" (a commit SHA, a file list, a snapshot), reading that state after invoking a long-running external agent lets it drift: the state can move mid-run and the recorded value ends up describing more than the process actually saw. This task's round-1 code review caught exactly that gap (F3): the reviewed HEAD SHA was read after `codex exec review` returned, so a commit landing mid-run would be silently credited to a review that never saw it. The fix: resolve and pin the value once, before starting the external process, and thread that pinned value through every downstream step (ancestry checks, diff probes, the artifact header) instead of re-reading live state later. The regression test that pins this moves HEAD between invoking the process and archiving, and asserts the archive still names the pre-move commit — a good template for any future "pin state, then run a long external step" invariant in this orchestrator.

---

### A deletion-evidence probe needs a full history-to-worktree diff, and `--no-renames`

*(2026-09-27, source: fix-staged-deletion-autocommit-and-dir-refs)*

A gate that decides "does this handoff's removed path still count as evidence" by running `git ls-files --deleted` sees only *unstaged* removals — a path already removed from the index with `git rm` is invisible to it, so the gate rejects a perfectly valid staged deletion before auto-commit ever runs. The fix is `git diff HEAD --name-only --diff-filter=D`, which reports both staged and unstaged removals against the last commit. But that alone isn't enough: Git's rename detection can pair the removed path with a similarly-named added or intent-to-add path elsewhere in the diff and report neither as a `D`, hiding the deletion again. Add `--no-renames` so the probe sees the plain add/delete pair instead of a rename. Both gaps were caught only by a real-git regression test that drove the actual routing path (`checkAndRoute`), not by calling the underlying function directly — a fixture that calls the function in isolation can pass while the gate in front of it still wedges. Rule of thumb: any deletion-evidence probe built on `git diff`/`git status` output needs both a staged+unstaged union and an explicit rename-detection stance, and needs a red-first test that goes through the real caller, not just the leaf function.

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

---

<!-- Buffer swept 2026-08-22 (3 entries reviewed: 1 promoted, 1 kept in buffer, 1 pruned).
     Promotion → docs/patterns.md: "Operator-facing text is often rendered by independently-authored duplicates — grep the surface class" as a new pitfall + Trigger Table row (from the duplicate-presentation-surfaces entry; strengthened by a second same-week instance in archive-review-on-reroute's dual review.md prompt pointers).
     Kept in buffer: the grep-AC-exception-list-growth entry — adjacent to two existing canon-spec SKILL rules (≥3-iterations read-content, permitted-to-remain buckets); re-evaluate for a one-sentence SKILL graft if it recurs.
     Pruned: the post-mutation-message entry — near-truism, single task pair, adjacent territory already covered by patterns.md's state-dependent-operator-message pitfall; detail survives in tasks/_archive/relax-reroute-gate-post-implement/notes.md.
     Prior entries are in git history. -->

<!-- Buffer swept 2026-08-11 (14 entries reviewed: 12 promoted, 2 pruned; buffer now empty).
     Promotions → .claude/skills/canon-spec/SKILL.md rules of thumb: (1) the "≥3 spec_review iterations" bullet rewritten to read round *content* not count — new-structural-case vs narrowing-an-existing-one — and to prefer dropping the mechanism class / deferring to a layer that already owns the concern over another round of hardening (merged from the review-verdict-freshness-guard, stable-validation-ids, and fix-installed-provenance-version entries); (2) "Behavioral contracts, not mechanics" extended with the code-altitude symptom and the non-binding Implementation Notes remedy (update-install-root-provenance); (3) "Codebase-wide term renames" extended with the paraphrase-sweep and permitted-to-remain-bucket checks (allow-comma-separated-multipath-cells + default-codex-models-to-5-6-generation); (4) new bullet: enumerate every caller and classify agent-vs-orchestrator execution context before asserting a mechanism (reconcile-qa-quality-log-summary).
     Promotions → docs/patterns.md: three-gate rename reconciliation as a new pitfall + Trigger Table row (relocate-orchestrator-to-src); state-dependent operator-message clause builder + state-varying test pair as a new pitfall (preroute-review-loop-autoblock); worktree realpath canonicalization and confirm-the-tool-can-produce-the-state as Test-writing-pitfalls bullets.
     Promotion → docs/architecture.md Validation table: `npm test -- <file>` does not scope, with the correct direct-runner invocation. NOTE: the source entry attributed this to Vitest and prescribed `npx vitest run` — this repo has never used Vitest (`node --test`), so the corrected command was verified by execution before promoting; the table's own runner command was also stale (missing the md-loader import).
     Pruned: the literal-AC-vs-tested-invariant entry (kept borderline at the last sweep, no recurrence in ~1 month, and its only real home is the implement prompt template, not a doc); the guardrail-prompt-calibration entry (already promoted — docs/decisions.md "Guardrail prompts carry an implicit model-strength calibration").
     CARRIER NOTE: the spec-writing rules-of-thumb block is triplicated — `.claude/skills/canon-spec/SKILL.md` (conversational `/canon-spec`) plus `src/orchestrator/prompts/templates/spec.md` and `spec-revision.md`, which the *pipeline's own* spec phases render. This commit carries only the internal-docs half of the sweep; the four rules above land in a separate adopter-visible PR (SKILL + mirror + both prompt templates + prompt goldens + `dist/`), so they are deliberately pruned from this buffer rather than dropped. Carrier coverage is NOT uniform across those four: (1), (2) and (4) reach all three carriers, but (3) — the `Codebase-wide term renames` extension — is **skill-only**, because that base rule has never existed in the phase prompts and importing the whole rule family there would exceed a sweep's scope. So a pipeline-authored spec does not get the paraphrase-sweep or permitted-to-remain checks; only a spec authored through `/canon-spec` does. Closing that gap is a separate decision, not an oversight.
     Prior entries are in git history. -->

### A spec's own "not read elsewhere" claim needs a grep before it scopes Affected Files

*(2026-09-29, source: rebaseline-claude-matrix-for-5-5)*

A spec's Decision section asserted that a duplicate config block slated for removal was "read outside `env.ts`" by nothing else today, and used that claim to justify a narrow Affected Files list. The claim was false: a test elsewhere read the same field through a spawned subprocess import that type-check couldn't see, and a second bundle (`dist/cli/index.js`) that imports the same module went stale on the next build. Both surfaced only during implement and cost a full code-review round (two spec-gap findings) before an operator could amend the manifest. The claim wasn't hard to verify — `rg` for the field name across `tests/` and `dist/` entry points would have caught both — it just wasn't checked before being stated as fact in the spec. Rule of thumb: when a spec's Decision or Non-Goals section makes a factual claim like "nothing else reads/imports/depends on X" to justify a narrow scope, grep for X's read sites (including subprocess/`--eval` imports and every build entry point, not just direct static imports) before trusting the claim into Affected Files — a false "nothing else touches this" claim is a spec gap that implement can only flag, not fix.

<!-- Buffer swept 2026-07-16 (16 entries reviewed). Promotions → docs/patterns.md: (1) multi-surface guidance rules need every-tier author-side homes + full predicate at every occurrence (merged from the two spec-bugfix-diagnosis-rule entries); (2) trackedness classifier checks dirty/status before ls-files; (3) gate exemptions apply before every decision reading the same dirty set; (4) env-override-after-import and placeholder-fixture-invalidation as Test-writing-pitfalls bullets; (5) worktree-routing regression test for new status.json writers folded into the "Worktree runs" pitfall; (6) the no-mirror inverse case folded into the "Declare templates/ mirrors" pitfall; (7) getScopedDiff-excludes-task-artifacts folded as a corollary into the blanket-stash pitfall. Promotion → .claude/skills/canon-spec/SKILL.md rules of thumb: per-family invariant gates for codebase-wide renames. Pruned (borderline-no-recurrence / niche / test-pinned): per-task-prompt-variant (kept borderline last sweep, no recurrence), past-pending-warning-predicate, review.md-citation-hygiene, preserved-dirt-restore-point (pinned by AC-11 test in shipped --ship code). Kept in buffer: two entries for re-evaluation at the next sweep — both were resolved by the 2026-08-11 sweep above (one promoted, one pruned), and the buffer is now empty. Prior entries are in git history. -->

### `isTemplateUnfilled`'s substring check flags a template sentinel anywhere in the file, including inside a quote

*(2026-09-29, source: claude-55-calibration)*

Writing `plan.md`'s feasibility-check instruction needed to describe the unfilled-template sentinel by name as an example. Doing so — quoting the literal bracketed TASK-ID placeholder anywhere in the file, even inside prose describing what *not* to write — made `check-phase-gate` treat the whole plan as an unfilled template, because `isTemplateUnfilled` only checks whether that substring appears anywhere in the file, not whether it appears in the sentinel's original structural position. The fix was to reword around it rather than quote it literally. Rule of thumb: when a prompt template or generated artifact needs to *refer to* another file's unfilled-template sentinel (to describe it, warn about it, or give an example), never reproduce the literal sentinel text — the gate that detects "unfilled" can't distinguish a real placeholder from a quoted example of one.

### Exit code alone doesn't prove a red-first AC fails for the right reason

*(2026-09-29, source: claude-55-calibration)*

An AC's red-first test asserted the process would exit non-zero against the pre-change code, but the pre-change code *already* exited 2 for an unrelated reason (no stored review session → "did not reach done"), so a naive "exit code changed" check would have passed even with no real fix in place. The actual red signal had to be a specific string in the output ("Evidence insufficient") plus an escalation count of zero — evidence that the *old* recovery path ran, not just that the process failed for any reason. Rule of thumb: when writing a red-first AC test, don't rely on a coarse outcome (exit code, pass/fail) that the pre-change code could already produce for a different reason — assert the specific evidence (an error string, a counter, an absent branch) that only the *old* behavior would produce, so the red run actually demonstrates the bug the fix addresses.
