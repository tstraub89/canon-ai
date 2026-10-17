# Code Review: per-task-telemetry-fragments

> Reviewer: Claude | Spec: `tasks/per-task-telemetry-fragments/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored-Claude (valid, Stage 1 pass, signal `changes_requested`), cold-Claude (valid, 13 findings, signal `changes_requested`), cold-Codex (injected, no findings).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [ ] Validation Outcomes table has no `Fail` results — `npm test` is recorded as `Fail – unrelated`. The anchored lens re-ran the full suite in the worktree: 1477 tests, 1476 pass, 1 fail. The only failure is `tests/run-task-safety.test.ts:4606`, which expects an implement invocation to append to the worktree's `docs/pipeline-invocations.md` and gets the unchanged `baseline telemetry`. That is AC-1's intended behavior. The explanation holds, but the failure is *caused by this task*, not unrelated: it is a stale assertion in a file outside the Affected Files cap. Recorded as spec gap S1.
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, test, build, sync-templates:check, docs-refs-check; E2E N/A per spec). The anchored lens confirmed `npm run build` leaves `dist/` unchanged.
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Metrics go to the fragment | Met | `tests/metrics.test.ts` covers the fragment path, header creation, shared doc unchanged, bundle row in the first member (a) metrics fragment labelled `a+b`, both overrides, and warn-without-throw. |
| AC-2: Quality row goes to the fragment | Met | `tests/task-cli.test.ts` checks one fragment row, first verdict kept when the rerun omits it, and shared-log bytes and mtime unchanged. Doctor still reads the shared doc. |
| AC-3: QA prompt targets the lessons fragment | Met | `promptQa` renders `lessonsFragments` per task. Tests cover a single task and a bundle, with no literal `<id>` and no empty-id path. The golden diff touches only the two QA keys. |
| AC-4: `--ship` folds and removes fragments | Met | The ship test covers (a) to (e): row order with no duplicate header, earliest verdict and the adopter column, stray rows removed, `_archive` refs, fragments consumed, and all three docs in the archive commit. |
| AC-5: A failed fold leaves `--ship` re-runnable | Met | The fold runs at `main.ts` after the merge-proof gate and before the archive loop, teardown and status writes. A malformed shared table aborts with docs, fragments and status unchanged, and the retry succeeds. Write and delete failures roll back under injected errors. |
| AC-6: Parallel tasks don't conflict | Met | Real `git merge --squash` of A, ship A, then squash B. Neither branch diff contains a shared doc, and the end state holds both tasks' rows and lessons. |
| AC-7: Missing fragments are a no-op | Met | Legacy merged rows survive with only the ref rewrite. Absent shared docs are created when a fragment exists (lessons skeleton is minimal; see N4). |
| AC-8: Early-phase metrics leave main clean | Met | In a real temp git repo, the spec, spec_review and plan rows land in the early task metrics fragment and `docs/` stays clean. |
| AC-9: `--pr` warns on shared-doc drift | Met | `reportOrCreatePR` warns on both PR paths using `getAffectedFiles`. Tested positive; the existing `--pr` test covers the no-warning case. |
| AC-10: Docs and templates describe the new flow | Partial | Header blockquotes are updated, but `docs/task-quality-log.md:13` and `templates/docs/task-quality-log.md:13` still say "The qa → done transition writes or updates this task's row in place." That fails AC-10's grep criterion. Both files are in Affected Files, and plan.md flagged this exact line. See C2. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 passes. AC-10 is one missed line, and it is carried as code-bug C2. The `npm test` failure is carried as spec gap S1.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is solid. The fold is computed first, then written, then the fragments are deleted, with rollback for ordinary filesystem errors. It sits correctly between the merge-proof gate and the archive loop. Row placement reuses the quality-log helpers instead of adding a second table writer, and the tests exercise real git squash merges. Two defects need fixing:

- a backslash round-trip bug that now hits every shipped quality row
- one stale doc line that AC-10 covered

Separately, the spec's file cap blocks a clean `npm test` and one adopter-facing doctor message. Those need a spec amendment, not an implementer fix.

### Findings

#### Correctness Bugs

- **C1 (code-bug, flagged by 2 lenses: anchored + cold-Claude; both confirmed with a scratch probe): `src/orchestrator/quality-log.ts` `foldQualityLogFragment` with `splitTableRowCells` (~lines 94-125), corrupts backslashes on `--ship`.**
  - The cause: `splitTableRowCells` keeps an escaped `\\` as two characters when no `|` follows, but `serializeQualityLogCell` doubles every backslash again.
  - The effect: a QA Notes value `C:\x` (or a regex such as `\d`) is written to the fragment as `C:\\x` and lands in `docs/task-quality-log.md` as `C:\\\\x`. Each later re-upsert doubles it again.
  - The asymmetry already existed, but it used to hit only the history reconcile on a re-upsert. The fold now parses and re-serializes every cell of every shipped row.
  - Fix: make the parser un-escape `\\` to `\` when no pipe follows (the inverse of `serializeQualityLogCell`), or copy fragment cells without re-serializing.
  - Add a round-trip test with a backslash in a judgment cell, through both the qa → done upsert and the fold.
- **C2 (code-bug, anchored): `docs/task-quality-log.md:13` and `templates/docs/task-quality-log.md:13`.** "The qa → done transition writes or updates this task's row in place" is now false: the transition writes the task fragment, and `--ship` folds it here. AC-10 requires that none of the listed files still say the transition upserts into the shared doc. Reword both copies to match the updated header blockquote.

#### Risk / Guardrails

- **R1 (flagged by 2 lenses: anchored + cold-Claude): a malformed or legacy shared log now blocks `--ship`.**
  - Before this change, a `docs/task-quality-log.md` missing a required column only produced a warning at qa → done. Now `foldQualityLogFragment` throws and `--ship` aborts for every task that has a quality fragment.
  - The same happens when `docs/pipeline-invocations.md` has no `| Timestamp |` header. `canon doctor` checks only the quality-log header.
  - This is spec-intended. The spec's Decision says "If computing or writing fails, `--ship` aborts with the shared docs unchanged and the fragments intact", and the handoff and plan notes record abort-on-malformed as the chosen reading.
  - Not blocking, but surfaced for the human: an adopter with a customized legacy table must hand-repair it before shipping anything. If that is unwanted, amend the spec to warn-and-skip for a malformed shared doc (keeping the fragment), and extend the doctor check to the invocations header.
- **R2 (version skew, cold-Claude):** if this engine wrote a task's fragments but an older engine runs `--ship`, the fragments are archived unfolded into `tasks/_archive/<id>/`. Nothing is lost, but the rows never reach the shared docs. This is inherent to the engine transition. Note it in the release notes.

#### Optional Cleanup / Nit

- **N1 (anchored + cold-Claude):** `writeQualityLogForTask` keeps an unused `_activeCwd` parameter, and `getQualityLogFile` is now used only by doctor. A one-line comment saying which file each one targets would help.
- **N2 (anchored + cold-Claude): `qa.md` wording.**
  - Curly apostrophes (`member’s`, `task’s`) are mixed with ASCII `'` in the same prompt.
  - A single-task run still says "Append each member’s lesson to that member’s fragment".
  - The `{{{lessonsFragments}}}` bullets render at column 0 under an indented sub-paragraph, which breaks the list nesting.
- **N3 (anchored): no suite-end cleanliness assert.** No test asserts that the suite leaves `tasks/*/{metrics,quality-log,lessons}.md` clean. The current run left no stray files, so this is preventive only.
- **N4 (anchored): minimal lessons skeleton.** `LESSONS_SKELETON` is a minimal title plus blockquote rather than the init scaffold. The handoff records this as an interpretation of AC-7's "standard skeleton"; acceptable.
- **N5 (anchored + cold-Claude): rows for other tasks are dropped silently.** `foldQualityLogFragment` keeps only rows whose Task cell matches the shipping task, then deletes the fragment. The writer never writes another task's row, so this can't happen today. A warning when rows are dropped would make it visible.
- **N6 (cold-Claude): no worktree-mode fold test.** All new ship and fold tests run in non-worktree mode. A worktree-mode ship test that combines preserved dirt with the fold would pin the `classifyAndPreserveSharedDocDirt` interaction (see S3).

#### Spec Gaps

- **S1 (anchored; verified by a full-suite re-run): the full suite fails on an out-of-scope test.**
  - `tests/run-task-safety.test.ts:4606` (worktree metrics-routing regression) still asserts the old shared-doc destination, so the spec's "`npm test` — full suite runs clean" cannot pass.
  - The file is outside Affected Files, and the code_review pre-flight blocks out-of-scope edits.
  - Amend Affected Files to add it. The assertion should move to `<worktree>/tasks/implement-ssot/metrics.md` while keeping the check that `docs/pipeline-invocations.md` is unchanged. Don't drop the test: `docs/patterns.md` requires this worktree-routing check.
- **S2 (anchored; verified): stale doctor text.**
  - `src/cli/commands/doctor.ts:304,310` tells adopters "not present — writer creates it fresh on first qa → done transition" and "the writer's self-heal write would also fail".
  - The shared quality log is now created only by the `--ship` fold. This is a stale restatement of a changed contract (AGENTS.md: P2), and the spec's AC-2 assumed doctor needed no change.
  - Amend Affected Files to add `src/cli/commands/doctor.ts`, plus its test file if wording is asserted. Then reword the message to say the log is created when `--ship` folds a task fragment.
- **S3 (flagged by 2 lenses: anchored + cold-Claude, medium confidence): re-running after a post-fold failure doesn't recover cleanly.**
  - The spec promises that "a later failure (archive, commit or push) cannot cause a second fold on re-run". That holds, but it doesn't say the re-run succeeds. Examples of such a failure: an archive `renameSync` hitting ENOTEMPTY, a commit failure, or a push failure.
  - Those failures leave the folded shared docs uncommitted in REPO_ROOT, with the fragments already deleted.
  - On a worktree-mode re-run, `classifyAndPreserveSharedDocDirt` runs first:
    - The quality row is inserted before `## Periodic Reviews`, which is not a pure append, so ship aborts with "commit or stash". `git checkout` of that doc would lose the row, because the fragment is gone.
    - The folded metrics and lessons rows are pure appends, so they are reverted and re-applied unstaged. The archive commit then records the fragment deletions without the folded rows.
  - Per the AGENTS.md rule on advertised recovery paths, the spec should state the recovery. Options:
    - (a) the post-fold die message tells the operator to commit the shared docs before re-running
    - (b) the re-run recognises its own fold dirt
    - (c) accept the gap as a Known Risk with documented manual recovery

### Dismissed Cold Findings

- Dismissed (cold-Codex): "the test suite completed without reported failures". The anchored lens's full re-run in the worktree shows 1 failure (`tests/run-task-safety.test.ts:4606`), which matches the handoff. See S1.
- Dismissed (cold-Claude): non-worktree ships now sweep uncommitted old-engine rows in `docs/pipeline-invocations.md` into the `chore: archive` commit. The spec's Known Risks ("Non-worktree ships") explicitly accepts this as a small, transitional widening.
- Dismissed (cold-Claude): the fold-failure `die` doesn't name the backup path for preserved shared-doc dirt. The other dies in that window already behave the same way, so this adds no new behavior. Worth a follow-up across all of those sites, not a per-site patch here.
- Dismissed (cold-Claude): race on metrics-fragment creation (`existsSync` then `writeFileSync`). The same window existed on the shared file, and the orchestrator does not record two invocations for the same task concurrently.
- Dismissed (cold-Claude): `renameSync` replaces a symlinked shared doc with a regular file. This matches the existing `writeFileAtomic` behavior in `quality-log.ts`, and canon does not scaffold symlinked docs.
- Dismissed (cold-Claude): lessons appended after the trailing `TODO[canon]` blockquote, or after a trailing HTML comment. That is the same end-of-file placement as today's QA "append", and the spec only asks for "after a `---` separator, matching the existing entry layout".
- Dismissed (cold-Claude): `QA_STARTUP` still says to read `docs/lessons-learned.md`, and canon-sweep can't see unshipped fragments. The spec's Non-Goals keep agents reading the shared doc, and Known Risks accepts delayed visibility until ship.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Codex: fix C1 and C2, the two code-bugs; the nits are optional. S1 and S2 need files outside Affected Files. Edit those only after the spec gains an Affected Files amendment for `tests/run-task-safety.test.ts` and `src/cli/commands/doctor.ts`; otherwise leave them and keep the `Fail – unrelated` row, because the code_review pre-flight blocks out-of-scope files. S3 needs a human decision on the recovery story.

---

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Full — base `main` — reason: delicate

Lens returns: anchored-Claude (valid, Stage 1 pass), cold-Claude (valid, 16 findings), cold-Codex (injected, no findings).

Foreman administrative note: in round 1 this file cited two fixture paths that don't exist. docs-refs-check rejected them, and that caused six `--pr`/full-send failures in the iteration's full-suite run. The foreman rewrote those two cells as plain prose before spawning this round's lenses, and docs-refs-check now reports "All refs OK". No verdict content changed.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the anchored lens re-ran the full suite on the current tree: **1478 tests, 1477 pass, 1 fail, 0 skipped**. The only failure is the stale S1 assertion in `tests/run-task-safety.test.ts:4606`. The six other failures the handoff records were caused by the review.md refs and now pass. `sync-templates:check` and `docs-refs-check` both pass. The handoff's re-run validation rows for docs-refs-check and `npm test` are therefore out of date.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | `metrics.ts` is untouched by the iteration; the metrics tests pass. |
| AC-2 | Met | The C1 fix touches the fragment upsert reconcile. The new test at `tests/run-task-quality-log.test.ts:388` shows a rerun that omits a judgment leaves the row byte-identical. The task-cli tests for this AC pass. |
| AC-3 | Met (unchanged from round 1) | The QA template and `promptQa` are unchanged; the golden and prompt tests pass. |
| AC-4 | Met | (b) now also holds for backslash content: folding is byte-stable and idempotent across repeated folds. |
| AC-5 | Met (unchanged from round 1) | Pre-fold compute, write and delete, and the die, are unchanged. |
| AC-6 | Met (unchanged from round 1) | The real-squash parallel test passes. |
| AC-7 | Met (unchanged from round 1) | The legacy no-op and skeleton tests pass. |
| AC-8 | Met (unchanged from round 1) | The temp-repo early-phase test passes. |
| AC-9 | Met (unchanged from round 1) | The `--pr` drift warning is unchanged, and the `--pr` tests pass. |
| AC-10 | Met | Line 13 of `docs/task-quality-log.md` and of its template mirror now says QA writes the task fragment and `--ship` folds it. A grep of every AC-10 file finds no direct-shared-write wording left. |

### Verifying Round 1 findings

- _correctness bug:_ C1, backslash doubling on the fold → **addressed**. `splitTableRowCells` (`src/orchestrator/quality-log.ts:97-131`) is now the inverse of `serializeQualityLogCell`.
  - The anchored lens ran a probe that round-trips random strings over the alphabet backslash, pipe and letters through the real `foldQualityLogFragment`. 28000 of 28000 cells came back byte-identical, against 6721 of 28000 on the round-1 code.
  - The new test fails on c6f029a and passes on 037af38.
  - Both dist bundles carry the fix.
- _correctness bug:_ C2, stale line 13 → **addressed** in both copies.
- _risk:_ R1 (malformed shared log fails closed) → retained as spec-intended. The cold lens re-flagged it; see the dismissals below.
- _risk:_ R2 (an older engine archives fragments without folding them) → retained as a transition risk. Mention it in the release notes.
- _nit:_ N1 → addressed with comments. N2 to N6 remain optional and deferred.
- _spec gap:_ S1 → **still open**. No Affected Files amendment exists. This is now the only full-suite failure.
- _spec gap:_ S2 → **still open**. `src/cli/commands/doctor.ts:304,310` is unchanged.
- _spec gap:_ S3 → **documented, human acceptance pending**. Codex chose option (c) and added a manual-recovery paragraph to the pipeline-orchestrator reference and its mirror.
  - The anchored lens checked the paragraph against the `main.ts` ship flow (`:2322-2400`) and found it accurate and adopter-safe.
  - The spec's Known Risks does not yet record the limitation, and the human has not confirmed (c) over (a) or (b).

### New findings (only NEW issues introduced by Iteration 1's changes) and still-open items

#### Spec Gaps (blocking — need a human spec amendment or decision, not another implement iteration)

- **S1 (anchored, verified by full-suite run; carried from round 1): `tests/run-task-safety.test.ts:4606`, the only failing test.**
  - It still expects the implement row in the worktree's shared metrics doc.
  - To fix: amend Affected Files to include this test. Then move the assertion to the worktree task's metrics fragment, and keep the check that the shared doc is unchanged.
- **S2 (flagged by 2 lenses: anchored + cold-Claude; carried from round 1): stale doctor text in `src/cli/commands/doctor.ts`.**
  - Lines 304 and 310 still tell adopters that the quality log is created "on first qa → done transition" and refer to "the writer's self-heal write". The cold lens also notes that the malformed-table warning near line 324 doesn't say `--ship` now aborts on that condition.
  - To fix: amend Affected Files to include `src/cli/commands/doctor.ts`, plus its test file if that file asserts the wording.
- **S3 (flagged by 2 lenses: anchored + cold-Claude; carried from round 1): recovery after a post-fold failure.**
  - Option (c), documentation, is now in place. The human must confirm (c) and add it to the spec's Known Risks, or choose (a) or (b).
  - The anchored lens adds a low-severity complement. The post-fold failures (the commit-failure die at `main.ts:2398-2400`, and an uncaught push throw at `:1977`) don't point to the new recovery paragraph. An operator who resets the dirty docs and re-runs loses the folded rows, because the fragments are already deleted. A one-line hint in those messages, which is option (a)-lite, would close that.

#### Risk / Guardrails (non-blocking)

- **Legacy even-run decode (anchored).** An unescaped legacy shared row *for the shipping task* that holds an even backslash run (for example a hand-written UNC path) is halved on its first fold. The result is stable afterwards, the ambiguity is inherent to legacy rows that were never escaped, and other tasks' rows pass through byte-for-byte. Accept.
- **Bundle accept edge (cold-Claude, low confidence).** Accepting a non-first bundle member on its own, with `canon task accept`, can trip the dirty-tree guard on the first member's uncommitted metrics fragment. Before, rows went to the exempt shared doc. The workaround is to accept with every bundle id, which exempts all members' task dirs.

#### Optional Cleanup / Nit

- **New test can flake at UTC midnight (anchored).** `tests/run-task-quality-log.test.ts:388-414` compares whole rows, including the date cell, across two writes. A run that straddles UTC midnight could fail spuriously.
- **Unclear referent in a shared doc (anchored).** Line 13 of the task-quality-log doc says "this task's quality-log.md fragment" inside a shared, multi-task doc. Name the placeholder path instead.
- **Curly apostrophes (anchored + cold-Claude).** These are in the new source comment at `quality-log.ts:96` and in `qa.md` (round-1 N2). The `qa.md` instance is inside the literal Maintenance line that QA copies verbatim.
- **Fragment rows consumed silently (cold-Claude, round-1 N5).** A quality fragment whose rows don't match the task id is consumed with no warning. The writer never produces such a fragment.
- **Real repo file as test oracle (cold-Claude).** `tests/task-cli.test.ts:2817` reads the real repository quality log as its unchanged-bytes oracle. The test still detects a regression, but a regressed writer would modify a tracked file before the failure is reported. A temp copy would be safer. This is hygiene, not a test-integrity defect: the assertion is sound.
- **Crash-only temp file location (cold-Claude).** A crash during the fragment upsert leaves a `.tmp` beside the fragment in the task dir, which a later task-dir auto-stage would pick up.
- **Stale handoff validation rows.** The docs-refs-check and `npm test` re-run rows are out of date; see the gate note above.

### Dismissed Cold Findings

- Dismissed (cold-Codex): no findings to adjudicate. Its "telemetry-fold tests passed" agrees with the anchored lens's run.
- Dismissed (cold-Claude): malformed or customized shared logs now block `--ship` after the merge (re-flag of R1). The spec's Decision says it explicitly: "If computing or writing fails, `--ship` aborts with the shared docs unchanged and the fragments intact." It is spec-intended, and it stays surfaced to the human as R1.
- Dismissed (cold-Claude): a worktree-mode fold `die` leaves preserved sibling dirt only in the tmp backup. The other dies in the same window behave identically (round-1 dismissal), so this is a cross-site follow-up rather than a per-site patch.
- Dismissed (cold-Claude): non-worktree ships sweep uncommitted rows in the shared metrics doc into the archive commit. Spec Known Risks ("Non-worktree ships") accepts this.
- Dismissed (cold-Claude): a crash between the renames and the unlinks double-folds metrics and lessons. Spec Known Risks accepts this window, with manual de-duplication as the recovery.
- Dismissed (cold-Claude): the parser now diverges from `splitTableLine`. That parser reads spec and handoff tables, which have no matching serializer, so it is not a sibling site. The legacy-row effect is covered by the risk above.
- Dismissed (cold-Claude): `recordMetric` and the quality writer `mkdir` could create stray dirs under a wrong `activeCwd`. That requires a separate bug that resolves the wrong cwd, and the orchestrator resolves `activeCwd` itself.
- Dismissed (cold-Claude): worktree fragments written after the last commit are destroyed at teardown. No agent runs after the QA-end commit, and the old shared-doc rows had the same behavior.
- Dismissed (cold-Claude): lessons are appended at end-of-file after the TODO placeholder, with `---` separators. This matches today's QA append and the spec's Implementation Notes (round-1 dismissal).
- Dismissed (cold-Claude): spec and plan prompts don't point at unshipped fragments, and the buffer count ignores other tasks' pending fragments. Spec Non-Goals keep agents reading the shared doc, and Known Risks accepts delayed visibility.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

Both round-1 code-bugs are fixed and verified, and no new code-bugs survived adjudication. Three spec gaps remain, and another implement iteration can't close them.

The fix path:
1. Amend `spec.md` with an Amendment section.
2. Add `tests/run-task-safety.test.ts` and `src/cli/commands/doctor.ts` (plus doctor's test file if it asserts wording) to Affected Files.
3. Record the S3 decision. If (c) is accepted, add a Known Risks line, ideally with the one-line recovery hint in the post-fold failure messages.
4. Run `canon run per-task-telemetry-fragments --reroute`.

Bless path, if the human accepts S1 and S2 as follow-ups: `canon task accept per-task-telemetry-fragments code_review --reason "<why>"`. That would leave `npm test` red, so the fix path is the recommended one.

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
