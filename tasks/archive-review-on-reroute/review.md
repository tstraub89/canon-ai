# Code Review: archive-review-on-reroute

> Reviewer: Claude | Spec: `tasks/archive-review-on-reroute/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens re-ran the gate independently in this worktree rather than trusting the handoff: `npm run lint`, `npm run type-check`, `npm test` (1,175 tests, 1,175 pass, 0 fail), `npm run sync-templates:check` ("All canon-managed files in sync"), and `npm run docs-refs-check` ("All refs OK") all pass. The cold lens independently re-ran the four affected suites (`run-task-reroute-preflight` 49/49, `run-task-prompts` 35/35, `task-cli` 70/70, `run-task-safety` 186/186) plus type-check, lint, docs-refs and template-sync — all green. `git diff HEAD` shows every source/test/dist edit committed at `b47be57`; only task artifacts and telemetry are dirty.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: red-first regression, wedge parses cleanly post-reroute | Pass | `tests/run-task-reroute-preflight.test.ts:369-427`. Real `runReroute` subprocess; `writeReview` (`:101-112`) has genuine append-into-existing semantics; absence is captured at `:414` **before** the fresh write. The anchored lens executed `extractCheckedVerdict` by hand against the composed pre-fix file (returns `changes_requested`) and the post-fix file (returns `approved`) — the test discriminates, it is not asserting a state the parser can't produce. |
| AC-2: archive step, lookup and filename constant in one module, invariant unit-tested | Pass | `src/orchestrator/review-archive.ts:6-50`. One numeric scan (`newestReviewArchiveNumber`, `:13-20`) feeds both `findNewestReviewArchive` (`:23-26`) and `archivePriorReview` (`:35-50`); neither call site (`src/task/index.ts:1121`, `src/orchestrator/main.ts:2556`) carries a rename loop. Gapped two-digit fixture test at `:430-448` asserts all four required outcomes. Structural grep confirmed: `review-prior-` in `src/` hits only the shared module plus the permitted `spec-review-prior-` literals. |
| AC-3: `reset-code-review` unchanged except the allocator | Pass | `git diff main...HEAD -- tests/task-cli.test.ts` contains **zero** deletion lines — pure additions. Existing reset tests untouched. `taskResetCodeReview` read end to end: phase guard, counter resets, session drop and stdout wording all byte-identical; the only delta is the shared-helper call with no `skipUnfilledTemplate`, preserving unconditional archival. |
| AC-4: template-stub `review.md` is not archived | Pass | `:450-475` writes the real `.canon/templates/review.md` into the worktree task dir, reroutes, asserts byte-identity and no archive. Predicate is `isTemplateUnfilled`, the same one `checkPhaseGate` and `tryEvidenceAdvance` use — see finding R4 for its residual hole. |
| AC-5: repeat reroutes number monotonically across a deleted archive | Pass | `:477-511`. Three **real** reroutes, not the helper in isolation: archives 1, then 2 with 1 byte-unchanged, then archive 1 deleted and the third reroute produces `review-prior-3.md` with 2 byte-unchanged. |
| AC-6: worktree-canonical routing | Pass | `tests/task-cli.test.ts:2401-2466`. Real `git worktree add`, `review.md` seeded in both checkouts, `CANON_TASKS_DIR_OVERRIDE` deleted so worktree resolution is genuine. Asserts the supervising copy is byte-unchanged with no archive, and the worktree copy moved. |
| AC-7: `sessions.claude_review` dropped on reroute | Pass | `src/orchestrator/main.ts:2635-2637` deletes it **unconditionally**, outside the full-tier branch; `codex_spec_review` deletion stays inside the full-tier branch at `:2653-2655`. Both tier fixtures extended to assert `claude_review` gone and fast-tier `codex_spec_review` preserved. |
| AC-8: reroute prompts point at the archive that reroute created | Pass | Both surfaces repointed (`src/orchestrator/prompts/index.ts:169` and `:401`); advancing-verdict lines untouched. Production-sequence test at `:1238-1271` seeds the gapped `2`/`10` set, runs the real reroute, then renders both prompts in a **separate cold subprocess** — an allocator/lookup mismatch could not hide. Negative assertion `/tasks\/task-b\/review\.md(?:\s|$)/` cannot be satisfied by `review-prior-11.md`, as AC-8 requires. Static half at `tests/run-task-prompts.test.ts:374` and `:383` rewritten, not deleted. |
| AC-9: stale-`review.md` evidence hole closed | Pass | `:513-554` constructs the state where the pre-fix advance actually fires (populated review with a checked approval), reroutes, then drives `code_review` back to `pending` before invoking the evidence path — it does not merely reroute and assert nothing happened. Asserts `advanced: false`, the exact note text, and that the phase is still `pending` afterwards. |
| AC-10: archive failure fails closed before any status mutation | Pass | `rerouteFromHumanReview` read end to end (`main.ts:2467-2690`), not taken from the handoff: statuses read → amendment pre-flight (read-only) → **archive pass over all task ids at `:2552-2575`** → status write loop beginning `:2577` with its first mutation at `:2580`. No status write precedes the archive pass. The `die()` at `:2561` names the task, the underlying error, the no-mutation guarantee and the completed archives. Test at `:556-588` injects on the **second** task and asserts task-a's status byte-unchanged (the discriminating assertion), task-a's archive on disk and reported, task-b's review intact. See nit N2 on the injection predicate's breadth. |
| AC-11: docs state the new behavior | Pass | `docs/pipeline-orchestrator.md` §"Human Reroute" covers highest-plus-one numbering, the stub exception, the two-pass fail-closed ordering with completed renames preserved, the session drop, and that archived findings remain binding. `templates/` mirror identical; the `reset-code-review` row is untouched. |
| AC-12: generated artifacts regenerate | Pass | Both bundles genuinely rebuilt from the new source — the anchored lens located all three new symbols in `dist/orchestrator/run-task.js` and confirmed `findNewestReviewArchive` is correctly tree-shaken out of `dist/cli/index.js`, which has no prompt path. The empty golden diff is **legitimate, not a missed regeneration**: zero golden fixtures render either changed line (verified by grep), and the suite asserts rather than regenerates goldens. See nit N1 on the coverage consequence. |
| AC-13: suite green | Pass | See Validation Gate above; independently re-run by both lenses. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — the parser, `handoff.md` archival, the spec-review archiver, reroute admission and the status schema are all untouched, exactly as the Non-Goals require.
- [x] Known Risks addressed or documented as accepted — with one recorded exception: Known Risk 1's closing instruction for the no-archive case is not followed and is not documented as accepted (finding R2). Recorded as a non-blocking finding rather than a gate failure because reaching that branch requires an archive set no canon path produces.
- [x] Human Test Plan is satisfiable by the implementation — all six steps map to shipped behavior and to AC-1/4/5/8/11 coverage.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

This is a tight, well-scoped implementation of a `delicate: true` orchestrator change. The load-bearing decisions — one module owning the allocator and the lookup so they cannot drift, a render-time disk lookup rather than an in-memory handoff, and a two-pass ordering that puts every archive before the first status byte — are all implemented as specified and are pinned by tests that drive the real reroute path rather than the helper in isolation. The anchored lens additionally enumerated every site that zeroes `code_review.iterations_current_loop` (the counter that makes the round-1 prompt render over a multi-round artifact) and confirmed the two call sites the spec chose are exhaustive: no un-archived zeroing path remains. Downstream gate compatibility for the new archive file was verified against the human-review path classifier, the base-drift check and the handoff/diff pre-flight — the last of which already anticipates archive renames. Every surviving finding clusters in one 8-line function, `priorReviewReference`, and in operator-facing message wording; none of them changes what the pipeline actually does on any path canon can produce.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

**R1 — `newestReviewArchiveNumber`'s unguarded `fs.readdirSync` turns prompt rendering into a throwing I/O path.** `code-bug`. Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/review-archive.ts:15`, reached via `src/orchestrator/prompts/index.ts:435-442`. Before this change the exempt-sibling line was pure string interpolation with zero I/O; it now performs an unguarded directory scan at render time. The sibling filesystem call twenty lines below in the same file, `bundleHasRealPriorReview` (`prompts/index.ts:462-472`), wraps its read in try/catch for exactly this reason. Failure scenario: an exempt sibling whose `taskDirFor()` resolves to a missing or unreadable directory (removed worktree, EACCES) makes `promptSpecReview` / `promptImplementReroute` throw an uncaught `ENOENT: … scandir` and take the orchestrator down at render time, instead of degrading to the binding-findings wording. Reachability is low — the sibling's task dir was just read for its `status.json` — which is why this is non-blocking, but the fix is a try/catch returning `0`, and it belongs at the **lookup** only: the archiver's error propagation is deliberate and correct for AC-10's fail-closed contract (handoff Deviations table).

**R2 — the no-archive fallback names the one file guaranteed to be absent after a reroute.** `code-bug`. Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/prompts/index.ts:440-442`. The fallback returns `tasks/<id>/review.md` — precisely the path the archive step just vacated. The in-code comment says it avoids "inventing a filename that does not exist," but post-reroute that is exactly what it does. Spec Known Risk 1 gives the opposite instruction verbatim: "If the lookup finds nothing at all, fail toward the current wording's *intent* (findings remain binding) rather than naming a nonexistent file." Failure scenarios: (a) an exempt sibling whose review was a stub, or whose archives an operator deleted, is told to "read that file and address ALL findings" against a file that is not there; (b) the inverse, raised by cold-Claude — when this reroute archived nothing but an older archive survives, the line asserts that an earlier cycle's already-addressed findings remain binding. Both need a corrupted or hand-edited archive set to reach, since a non-advancing recorded verdict implies a populated `review.md` that `checkPhaseGate` already vetted. Fix is to drop the filename in the null branch and keep the binding-findings sentence.

**R3 — the archive messages print a repo-root-relative path for an operation that ran in the worktree.** `code-bug`. Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/main.ts:2563` (the abort) and `:2571-2573` (the info line). Both interpolate a repo-root-relative `tasks/<id>/review.md` path, but the operation targets `taskDirFor(taskId)` — the worktree copy for every worktree-backed task, which is canon's default. This diff's own worktree test asserts that the supervising checkout's `tasks/<id>/review.md` is the copy that was *not* touched, so the message names the wrong file. The adjacent pre-existing reroute error at `:2509` prints an absolute `path.join(taskDirFor(taskId), …)`; matching it fixes both messages. The abort is the one that matters — an operator has to act on it.

**R4 — the stub predicate is a bare substring test, so a genuine review that quotes the task-id placeholder token is left un-archived.** `code-bug`, inherited rather than introduced. Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/review-archive.ts:42-45` via `isTemplateUnfilled` (`src/orchestrator/validation.ts:786-788`), which is `content.includes(<task-id placeholder token>)` with no header anchoring. A real multi-round review that quotes that token anywhere — a finding citing a template path, for instance — is classified as a pristine stub, skipped, and left on disk, reproducing the exact wedge this task exists to close on the next round-1 review. Reachability is narrow because `checkPhaseGate` and `tryEvidenceAdvance` share the predicate, so such a review could never have been accepted through the gate; only the never-gated `blocked` entry state (the one PR #228 newly admits to reroute) reaches it. The spec **directs** this reuse (Known Risk 4: "Detection should reuse the existing template-unfilled predicate … not a new heuristic"), so the implementer did as instructed — this is the residual hole in that risk, and there is no test for a partially-filled review. Recommend filing rather than patching here (see Follow-Ups).

**R5 — the status-write loop still has no rollback, and the archive pass now precedes it.** `code-bug`, low severity. Flagged by cold-Claude. `src/orchestrator/main.ts:2552-2600`. AC-10's contract covers an archive failure; it does not cover a throw inside the status loop that now runs *after* N irreversible renames. Failure scenario: a three-task bundle archives cleanly, then `splitState.writeStatus` throws on task-b — all three `review.md` files are gone while task-a's status is rewritten and task-b's and task-c's still report `code_review: done` with a verdict and no backing artifact. The pre-existing loop had the same absence of rollback; the delta is that the artifacts are now relocated first. Re-running `--reroute` is idempotent and recovers (no `review.md` means no second archive), but nothing tells the operator that. One clause in both the abort message and the docs closes it.

#### Optional Cleanup / Nit

**N1 — the change removed the fallback branch's only coverage instead of adding to it.** Flagged by 2 lenses. `tests/run-task-prompts.test.ts:369` moved its fixture from `review.md` to `review-prior-1.md`, so both static assertions now exercise only the archive-found branch, and the production-sequence test always has an archive too. A regression making `priorReviewReference` return an empty or malformed reference in the null branch would pass the entire suite. One extra assertion with no archive seeded closes it, and it is the natural companion to R2.

**N2 — the AC-10 injected-rename predicate is broader than the archive rename.** Flagged by cold-Claude. `tests/run-task-reroute-preflight.test.ts:135-137` throws for *any* rename whose source path contains the task id, which includes `writeStatusAtomic`'s temp-to-`status.json` rename. The test is **not** vacuous — its discriminating assertion is that *task-a's* status is byte-unchanged, and that would fail if the archive pass moved after the status loop — but the task-b assertion proves less than its name suggests. Scoping the predicate to a review path would make the test assert exactly what it claims.

**N3 — AC-1's most diagnostic assertion is ordered after the gate comparison.** Flagged by 2 lenses. `tests/run-task-reroute-preflight.test.ts:414` captures `reviewWasAbsentImmediatelyAfterReroute` at the correct instant, but `:425` asserts it after the `checkPhaseGate` deep-equal at `:424`. A regression that stops archiving fails first with an opaque verdict mismatch; the line that would say "the review was still there after the reroute" never runs. Reordering plus a comment naming why the capture must stay above the fresh write would protect the ordering from a later edit that silently turns the assertion into a tautology.

**N4 — `REVIEW_ARCHIVE_PREFIX` is exported with no consumer outside its own module.** Flagged by 2 lenses. `src/orchestrator/review-archive.ts:6`. AC-2 accepts either the constant or the return value and the implementation consistently uses return values, so the `export` is dead public surface on a brand-new module — the kind of surface that invites a future caller to build filenames by hand instead of going through the allocator.

**N5 — `archivedReviewByTask` is a `Map` that only the error path reads.** `src/orchestrator/main.ts:2552` and `:2559-2569`. The success path prints inline; the map exists solely to build the completed-archives list. An array of pairs would express the intent more directly. Zero behavioral impact.

**N6 — the archive scan does not use `withFileTypes` and parses numbers unbounded.** Flagged by 2 lenses. `src/orchestrator/review-archive.ts:14-19`. A *directory* named like an archive counts toward the max and would be handed to the prompt as a file to read; a pathological digit string past `Number.MAX_SAFE_INTEGER` makes `newest + 1 === newest` and lets `renameSync` clobber. Neither is reachable in a real task dir, and the old code's structural non-clobber guarantee (`while (existsSync(...))`) is what was traded away — one `existsSync` assertion before the rename restores it cheaply.

**N7 — TOCTOU between `existsSync` and `renameSync` produces a misleading abort.** Flagged by cold-Claude. `src/orchestrator/review-archive.ts:40-48`. If `review.md` disappears between the two calls, the rename throws `ENOENT` and the whole reroute dies with "failed to archive …" for a case that is semantically "nothing to archive" — the case line 40 was written to return `null` for. Catching `ENOENT` at the rename makes the two paths agree.

**N8 — the two callers disagree on stub handling and neither call site says so.** Flagged by 2 lenses. `src/task/index.ts:1121` passes no options, so `reset-code-review` archives a pristine scaffold into a numbered archive that `findNewestReviewArchive` will later hand to an exempt sibling's prompt as "the findings that remain binding". This is the one narrow case where AC-2's invariant ("numerically greatest equals the archive holding the newest findings") is false. AC-3 mandates preserving `reset-code-review`'s behavior, so this is sanctioned, not a defect — worth a one-line comment at the call site.

**N9 — redundant `Object.hasOwn` guard before `delete`.** `src/orchestrator/main.ts:2635-2636`. Deleting a missing key is already a no-op; only the `status.sessions &&` half is load-bearing. Noted only because it mirrors `src/task/index.ts:1139` verbatim — it is a deliberate consistency choice, not an oversight.

**N10 — the golden fixtures give the two changed prompt lines no drift protection.** Flagged by anchored. AC-12 is met and nothing was missed, but the consequence of zero golden fixtures rendering a non-advancing exempt sibling is that the whole AC-8 change rests on two static assertions and one production-sequence test. A `promptSpecReview` reroute-bundle golden variant carrying such a sibling would give these lines the same protection every other prompt line has.

#### Spec Gaps

(none — R2 is recorded as a code-bug rather than a spec gap because Known Risk 1 gives actionable direction, "fail toward the current wording's intent … rather than naming a nonexistent file," which is enough for an implementer to act on without a spec revision.)

#### Follow-Ups for `docs/BACKLOG.md` (out of scope here by explicit Non-Goal)

- **A stale `done.md` lets evidence recovery advance `qa` after a reroute.** Verified by the foreman against the code, surfaced by cold-Claude. The reroute sets `qa.status = 'pending'` (`src/orchestrator/main.ts:2638-2639`) but leaves `done.md` on disk, and `tryEvidenceAdvance` case `'qa'` (`main.ts:3045-3051`) asks only `isDoneMdTemplate(donePath)` — a populated pre-reroute `done.md` is not a template, so `qa` advances to `done` with no QA run against the rerouted implementation. This is the exact analog of the hole AC-9 closes for `review.md`, and `handoff.md` has the same shape via `checkImplementEvidence`. The spec's Non-Goals rule this out of scope in as many words — "If implementation surfaces a concrete handoff analog, file it — don't fix it here" — so it is filed here rather than fixed. It is the strongest of the cold-lens findings and should not be lost.
- **`isTemplateUnfilled`'s substring semantics (R4)** deserve a scoped fix — anchor the check to the artifact header rather than matching the placeholder token anywhere in the file — shared with `checkPhaseGate` and `tryEvidenceAdvance`.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "**blocking** — the reroute renames `review.md` away and nothing re-scaffolds it, while the round-1 foreman prompt says 'fills the existing template structure directly' and never restates that structure, so the foreman must improvise the headings and the exact verdict-checkbox syntax." — The load-bearing premise is factually wrong: §4 of `src/orchestrator/prompts/templates/code-review-foreman.md` (lines 95-105) does restate the required structure, enumerating Stage 1 with the AC table, Stage 2 / Findings, Dismissed Cold Findings and "Final Verdict: check exactly one verdict checkbox," and §3 names the four verdict labels. `extractCheckedVerdict` (`validation.ts:830-841`) accepts both bolded and unbolded label forms. Beyond that, the spec adopts the absent-`review.md` state deliberately and with cited reasoning (Decision item 1: "An absent `review.md` is load-bearing and already-handled state: `bundleHasRealPriorReview` then force-pins round 1, and `src/orchestrator/phases/code-review.ts` treats it as a first run"), it is the shipped behavior of `reset-code-review` that Decision item 1 explicitly directs the reroute to reuse, and the pre-flight writer already handles the missing file as a first run (`phases/code-review.ts:197`). The residual risk — a foreman writing a nonconforming verdict line — fails loud at `checkPhaseGate` and self-corrects on retry rather than corrupting state. Downgraded from blocking to not-a-finding for this diff.
- Dismissed (cold-Claude): "the diff left `taskResetSpecReview`'s `spec-review-prior-` archiver on the old lowest-free-gap loop, so two divergent numbering rules now sit forty lines apart." — Verified as accurate, but the spec ruled on it explicitly and gave the reason: "`taskResetSpecReview`'s separate `spec-review-prior-` loop keeps its lowest-unused scan: nothing looks up 'the newest spec-review archive', so it has no invariant to break, and unifying the two archivers is optional cleanup this task does not take on" (Non-Goals). The failure the finding describes needs a future consumer that does not exist. Correctly out of scope.
- Dismissed (cold-Claude): "`priorReviewReference` names only the newest archive, so findings from an earlier reroute cycle are in a file the agent is never told about." — Naming only the newest archive is what AC-8 specifies, twice and unambiguously: "both must repoint at the archive that the reroute just created" and "it names `review-prior-11.md` (the archive that reroute created)". Decision item 3 gives the reasoning. The variant of this finding that *is* live — a stale pointer when this reroute archived nothing — is retained above as R2(b) rather than dismissed.
- Dismissed (cold-Claude): "two resolvers for one location — the archive writes to per-task `taskDirFor(taskId)` while the agent reads a relative path under bundle-wide `getActiveCwd(taskIds)`." — `taskDirFor` is the same resolver every other `review.md` operation in the codebase already uses: `bundleHasRealPriorReview`'s probe (`prompts/index.ts:466`), the pre-flight writer (`phases/code-review.ts:195`) and the post-run template check (`:340`). The archive is therefore consistent with the entire surrounding surface, and the divergence the finding describes needs a half-removed worktree — a state `isOrphanedWorktreeState` already detects and reports separately. Introducing a second resolution rule for this one write would create the drift the finding warns about rather than prevent it.
- Dismissed (cold-Codex): the injected cold-Codex lens returned no findings — "The changes are consistent with the reroute archive behavior and all available tests and checks pass." Recorded for completeness; nothing to adjudicate from that lens.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> Recommended, not required: R1, R2 and N1 are one follow-up commit in a single 8-line function — guard the directory scan, drop the filename from the null branch, and seed a no-archive assertion. R3 is a two-line message fix in the same commit. R4 and the stale-`done.md` analog belong in `docs/BACKLOG.md`, not in this task.

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
