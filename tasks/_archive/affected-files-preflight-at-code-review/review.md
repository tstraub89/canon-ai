# Code Review: affected-files-preflight-at-code-review

> Reviewer: Claude | Spec: `tasks/affected-files-preflight-at-code-review/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens re-ran `npm run build` (no `dist/` or `templates/` drift), lint, type-check, docs-refs-check, and sync-templates:check; all pass. The four touched test files pass 495/495. It did not re-run the full suite; the handoff reports 1278 pass, 1 skip.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Shared builder, no fork | Pass | `buildAffectedFilesAllowlist` (`src/orchestrator/validation.ts`) is exported, and `verifyBaseDrift` now calls it. The builder tests cover Design and Amendment rows, the `dist/` prefix, telemetry, and the managed-docs flag on and off. Existing `verifyBaseDrift` tests pass unchanged. Task dirs are admitted through the `taskIds` argument to `verifyBaseDriftFromData`, not by the builder itself; that's an acceptable split. |
| AC-2: Pure scope check | Pass | Reuses `verifyBaseDriftFromData` with `changedFiles` from `getAffectedFiles` → `parseNameStatusOutput`, which includes both sides of a rename. Tests cover an out-of-scope rename post-image, a prefix match, and a managed doc admitted at code_review. |
| AC-3: Normal-run halt | Pass | The halt at `src/orchestrator/phases/code-review.ts:317-332` runs before `resolveCommit`, `taskPhase(in_progress)`, cold-Codex, and `runClaude`. The test asserts no agent events, status `blocked`, the file and both fixes in the escalation, and all four counters unchanged. |
| AC-4: Resume after spec edit | Partial | The test proves Round 1 renders after a spec edit, but it goes through `canon task reset-code-review`, which is not needed and has side effects (Finding 2). The spec's fix (a) is a spec edit plus `canon run <id>`. |
| AC-5: Full-send hands the list to the foreman | Pass | `promptCodeReview` renders the block only for a non-empty list. The runner test asserts `spec.md` is byte-identical inside `onClaude` and that both agents are called. New golden `promptCodeReview_fullSendOutOfScope`; existing foreman goldens are unchanged (`deltaRound` differs only by a trailing comma). |
| AC-6: Post-foreman enforcement | Partial | The three stub-foreman outcomes pass on the direct path. Enforcement is skipped entirely when `review.md` is unfilled and the retry happens in `checkAndRoute` (Finding 1). Membership uses exact match rather than the pre-flight matcher (Finding 3). |
| AC-7: In-scope diffs unaffected | Pass | An in-scope full-send case and the normal-run resume both pass the check. The existing pre-flight suite passes. |
| AC-8: `--pr` base-advance wording | Pass (with deviation) | `classifyBaseDriftFilesFromData` is tested for all-base-only, all-task, and mixed inputs. I checked the message text: the base-only list is labelled as a base advance with merge/rebase guidance, the out-of-scope list keeps "not in the spec's Affected Files", and every non-`--force` path still calls `die`. However, the task-changed set uses local `<base>` rather than the `origin/<base>` that Decision 3 names (Finding 4). |
| AC-9: Implement prompt | Pass | Scope Discipline rule 1 at `implement.md:28` is the only prompt change, and only the `promptImplement_fresh` golden changed. |
| AC-10: Build and suite | Pass | A rebuild matches the committed `dist/`, and all listed checks pass. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

Non-goals are all honored: prefix semantics are unchanged, the orchestrator never writes an amendment, `--pr` still uses two-dot and still blocks, and `autoCommitCode` is untouched. Two Known Risks are only partially addressed. On "Halt state and re-run", the message names a reset that isn't needed (Finding 2). On "Full-send amendment format", AC-6c enforcement has a bypass (Finding 1).

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

AC-4 and AC-6 are Partial, but they're fixable in place and don't need a re-implementation, so Stage 2 ran. They are carried as Findings 1–3.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The refactor is clean: one builder feeds both gates, the pure classifier is well tested, the normal-run halt is in the right place and leaves counters alone, and the prompt block renders conditionally with goldens intact. The problems are all in the new full-send and recovery paths.
- The post-foreman fail-closed check doesn't run on every path that can complete code_review.
- It uses a different path matcher than the gate it enforces.
- The halt's recovery instruction sends operators through a reset that throws away review-loop state.
- The `--pr` classification compares against a different ref than the spec names.

### Findings

#### Correctness Bugs

1. **`code-bug` — post-foreman scope enforcement is bypassed on the unfilled-review retry path.** Source: anchored lens; verified by foreman. Location: `src/orchestrator/phases/code-review.ts:433` (the `!anyUnfilled` guard), with `src/orchestrator/main.ts:3156-3185` (`recoverPhaseForTask` → `retryAgentForPhase` / `tryEvidenceAdvance`).
   - Failure scenario: a full-send run has an out-of-scope file, and the foreman's first turn ends without writing `review.md`, a failure mode the foreman template itself warns about.
     - `runCodeReviewPhase` resets the phase to `pending` and returns without enforcing.
     - `checkAndRoute` then resumes the `claude_review` session through `retryAgentForPhase`. The retry writes an approved review with no amendment and runs `canon task phase … done approved`.
     - The phase is `done`, the task moves on to qa and the full-send `--pr` tail, and base-drift aborts there. AC-6c exists to prevent that late failure.
     - `tryEvidenceAdvance` after the retry skips the check the same way.
   - Fix: make the enforcement run on every path that completes code_review. For example, move it into a shared helper and call it wherever code_review reaches `done` (the direct path and the `checkAndRoute` recovery path), and recompute the out-of-scope set there (see Finding 3).
   - Add a runner test covering the unfilled → retry → approved-without-amendment path.
   - The handoff's edge-case note ("An unfilled review retries through the existing path before post-foreman scope enforcement") is inaccurate; correct it.

2. **`code-bug` — the halt's recovery instruction prescribes an unnecessary `canon task reset-code-review` that discards review-loop state.** Flagged by 2 lenses (anchored, cold-Claude); verified by foreman. Location: `src/orchestrator/phases/code-review.ts:326-327`, `docs/pipeline-orchestrator.md:333` (plus mirror), and the AC-4 test in `tests/run-task-code-review.test.ts`.
   - A reset isn't needed. The run loop does not refuse a `blocked` code_review. The only `blocked` checks in `src/orchestrator/` are the reroute entry and `autoBlockPhase` itself, and `runCodeReviewPhase` re-runs the pre-flight on entry. The anchored lens deleted the reset call from a copy of the AC-4 test, and all scope tests still pass.
   - Following the instruction has side effects. `reset-code-review` (`src/task/index.ts:1105-1142`):
     - archives `review.md` and re-scaffolds it;
     - zeroes `iterations_current_loop`, `iterations`, and `preflight_rejections_current_loop`;
     - drops `sessions.claude_review`.
   - What that means:
     - After a Round-1 halt, an untouched template gets archived into a `review-*.md` file that lands in the PR.
     - After a Round-N>1 halt (Codex adds a new unlisted helper during a fix iteration), the real review is archived, the loop-cap budget resets, and the next review renders as a fresh Round 1. It no longer re-verifies the prior round's findings.
     - That contradicts Decision 2's rule that the halt must not change review-loop state or round rendering.
   - The handoff's `[ambiguity]` blocker resolved AC-4 this way. The spec's fix (a) is "add them to the spec's Affected Files … and re-run `canon run <id>`". The Known Risk allows a reset only "if the blocked status needs" one, and it doesn't.
   - Fix:
     - Drop the reset step from the halt message and from `docs/pipeline-orchestrator.md` (then `npm run sync-templates`).
     - Change the AC-4 test to resume with a plain re-run.
     - Add a halt-then-resume test at Round N>1 that asserts the next review renders as Round N and the counters are unchanged.
   - While editing the message:
     - Use the actual task IDs instead of `<id>`.
     - Don't say "in the task worktree" unconditionally (non-worktree mode exists).
     - Only mention bundle members when the run is a bundle.
     - Give the post-foreman "unjudged" auto-block (`code-review.ts:442-444`) a concrete resume instruction too: amend the spec, then re-run `canon run`.

3. **`code-bug` — post-foreman membership check doesn't use the pre-flight's matcher.** Flagged by 2 lenses (anchored, cold-Claude; cold-Claude confirmed it with a probe against the real `runCodeReviewPhase`). Location: `src/orchestrator/phases/code-review.ts:434-440`.
   - The pre-flight decides scope with `buildAffectedFilesAllowlist` + `verifyBaseDriftFromData`, where a directory entry ending in `/` covers its subpaths. The enforcement builds `amended` from `parseAffectedFilesFromSpec(...).files` and uses exact `Set.has`.
   - Failure scenario: a hypothetical helper file (src/helpers/a.ts) is out of scope, and the foreman amends with a directory-form row for its parent directory (src/helpers/). The next pre-flight and `--pr` would both accept that, but code_review auto-blocks with "left out-of-scope files unjudged".
   - That is the "stricter than `--pr`" failure the Known Risks warn about, and a second copy of a rule that Decision 1 puts in one builder.
   - Fix: after the foreman session, rebuild the allowlist with `buildAffectedFilesAllowlist(taskIds, { admitManagedDocs: true })` and re-run `verifyBaseDriftFromData` over `changedFiles`. Any path it still returns is unjudged.
   - This also catches files the foreman's spec edit might have pushed out of scope.
   - Combine it with Finding 1's shared helper and give it a `*FromData` seam so it can be unit-tested (Validation Gate Discipline).
   - Add a directory-form amendment test.

4. **`code-bug` — the `--pr` task-changed set uses local `<base>`, not `origin/<base>`.** Flagged by 2 lenses (anchored, cold-Claude); verified by foreman. Location: `src/orchestrator/main.ts:1225`.
   - Decision 3 defines base-only drift as files "absent from `<origin/base>...HEAD`". The code calls `getAffectedFiles(baseBranch, cwd)`, which is local `<base>...HEAD`, and the handoff doesn't document the deviation.
   - Failure scenarios:
     - Local `main` is stale, and the task branch already merged or rebased `origin/main` (as the new message tells operators to do). Files changed in the absorbed range are then labelled "task-changed … not in the spec's Affected Files", pointing the operator at a spec edit when a merge is the fix.
     - With `--allow-divergent-base`, local-only base commits are described as "changed only on origin/<base>".
   - Fix: `getAffectedFiles(\`origin/${baseBranch}\`, cwd)`. `verifyBaseDrift` has already fetched at this point.
   - Optional: move `taskChangedFiles` inside the `!cliArgs.force` branch, since it is only used there.

#### Risk / Guardrails

5. **Full-send `changes_requested` exemption is bundle-wide rather than per-file (non-blocking).** Flagged by 3 lenses (cold-Codex P2, anchored, cold-Claude). Location: `src/orchestrator/phases/code-review.ts:438-441`.
   - Verified: a `changes_requested` verdict for any reason, on any bundle member, exempts every unamended file from the post-foreman check.
   - This is spec-intended, and I'm not dismissing the cross-model agreement without evidence. The spec text:
     - Decision 2: "every listed file must now be in Affected Files (via `parseAffectedFilesFromSpec`) **or the verdict must be `changes_requested`**".
     - AC-6(b): "if the verdict is `changes_requested`, it routes back to implement as usual".
   - Why the invariant still holds: `changes_requested` keeps `full_send` (only reroute clears it), so the next round's pre-flight lists any still-unamended file again and enforcement runs again. The file is judged later; it can't reach an approved verdict unjudged.
   - The real cost is an extra loop when the implementer isn't told to remove the file.
   - Two items to fold into the Finding 1/3 refactor, since they're cheap there:
     - Treat the legacy `needs_re_review` verdict the same as `changes_requested`; routing already does (`main.ts:3346-3349`).
     - Add a comment explaining why the bundle check uses `some()` over verdicts, as the patterns.md `every()`/`some()` rule asks.
   - Tying each file to its own finding is a possible spec follow-up, not a fix for this round.

6. **A `spec_gap` verdict with an unamended file hits the scope auto-block first (non-blocking).** Flagged by 2 lenses (anchored, cold-Claude). Location: `code-review.ts:438-446`.
   - `process.exit(2)` fires before `checkAndRoute`, so the SPEC GAP banner and its FIX/BLESS recovery text never print. The recorded verdict survives, and the task halts either way.
   - Consider letting `spec_gap` pass through to its own halt; the human is looking at it anyway.

7. **The `--pr` message is built inline with no text test (non-blocking).** Flagged by 2 lenses. Location: `src/orchestrator/main.ts:1229-1247`.
   - AC-8 only requires a reviewer check of the message, and that passed above.
   - Still, the patterns.md rule on state-dependent operator messages (one parameterized builder, pinned by a state-varying `match`/`doesNotMatch` pair) applies here.
   - The existing fake-git safety test passes only because its fake returns the drift list for the three-dot call too.
   - The base-advanced section also dropped the concrete `git fetch origin <base> && git rebase origin/<base>` command and the cross-pipeline-contamination hint.
   - Suggested: build the message in `validation.ts` next to the classifier, and test both sections plus the mixed case in `tests/run-task-validation.test.ts`, which is within Affected Files.

#### Optional Cleanup / Nit

8. The foreman template block has no blank line between `{{/hasOutOfScopeFiles}}` and `## Foreman Protocol`, so the rendered prompt runs "…otherwise it auto-blocks." straight into the heading. Flagged by 2 lenses; it's visible in the new golden.
9. The scope check runs after the handoff pre-flight. When both fail, the handoff rejection sends the task back to implement first, and scope only halts on the next pass. The spec's "before any cold-Codex or Claude session" is still satisfied. Flagged by 2 lenses.
10. `getAffectedFiles` returns `[]` on git failure, so the new gate fails open. The existing handoff pre-flight shares this, and `--pr` backstops it. (anchored)
11. Test gaps (anchored, cold-Claude):
    - No bundle runner cases: union allowlist, mixed `full_send`, an amendment in the sibling's spec, `changes_requested` on one member.
    - No malformed-amendment case, which the AC-6c Known Risk depends on.
    - Counter assertions start from 0, so a counter reset wouldn't be caught.
    - The AC-6(b) test doesn't assert routing.
12. `commitHumanReviewFiles` (`main.ts:1255-1281`) still builds its own prefix/managed-doc set for the dirty-tree commit. It has a different purpose, and AC-1 doesn't name it. The result is that malformed-row warnings print twice per `--pr`. (cold-Claude)
13. The carried-over `--pr` text still names `PIPELINE_TELEMETRY_FILES` / `PIPELINE_MANAGED_DOCS`, which adopters can't look up. This predates the task. (anchored, cold-Claude)

#### Spec Gaps

14. **`spec-gap` — the foreman's full-send `## Amendment` collides with the human reroute amendment gate.** Flagged by 2 lenses (anchored, cold-Claude); verified by foreman. Location: `src/orchestrator/validation.ts:310-313`, the foreman template block, and `implement-reroute.md`.
    - `verifyRerouteAmendment(taskId, 1)` accepts any `^#{2,6} Amendment\b` heading, and the reroute prompts tell the agents to treat `## Amendment` as the new requirements.
    - After a full-send scope amendment, a later `canon run <id> --reroute` passes the amendment gate even if the human wrote nothing, and Codex treats the foreman's Affected-Files row as the reroute requirement. If the human does write one, the spec has two `## Amendment` sections.
    - Decision 2 prescribes this exact heading, and a different `## Amendment…` heading would still match the gate, so the implementer can't fix it inside the spec.
    - Needs a human decision, for example: a distinct heading that `parseAffectedFilesFromSpec` reads but the reroute gate and prompts exclude, or accept the collision and file a follow-up.
    - Not routed to the implementer this round.

### Dismissed Cold Findings

- Dismissed (cold-Claude): Managed docs are admitted at code_review before QA, so an unlisted implementer edit to a managed doc passes. Reason: spec-intended. Decision 1: "The code_review pre-flight always admits them, so it is never stricter than `--pr` will be after QA." `--pr` already admits them once QA is done.
- Dismissed (cold-Claude): The gate sees only committed files, so untracked files left out of the handoff escape it. Reason: files that are never committed aren't on the task branch and don't ship. Changing auto-commit coverage is an explicit Non-goal.
- Dismissed (cold-Claude): Out-of-scope paths are injected raw into the foreman prompt (prompt injection via file names). Reason: the path author is the pipeline implementer, which already controls the diff the foreman reads. File names add no new trust boundary. Low confidence and low severity.
- Dismissed (cold-Claude): The scope halt leaves no `review.md` record. Reason: spec-intended. Known Risks warn that writing a pre-flight block into `review.md` could break Round 1 rendering, and the reason is persisted in the `status.json` escalation.
- Dismissed (cold-Claude): Editing the original `## Design` table in place, with no `## Amendment`, satisfies enforcement. Reason: AC-6(a) defines success as the file being "returned by `parseAffectedFilesFromSpec`". An in-place edit is visible in the PR diff, where full-send puts human review.
- Dismissed (cold-Claude): A foreman crash that leaves a non-template `review.md` with no verdict auto-blocks with a misleading "unjudged" reason. Reason: it fails closed, which is the safe direction. The case where the foreman removes rows is covered by Finding 3's fix, which recomputes over all changed files.
- Dismissed (cold-Claude): The new runner tests use an inconsistent fixture (the fixture handoff lists one hypothetical source path while the fixture diff has a different hypothetical helper path, and `verifyHandoffAgainstDiff` is stubbed). Reason: the scope check is independent of the handoff check, and stubbing deps is the established `runCodeReviewPhase` test pattern. Test integrity is not compromised. The real gaps are listed in nit 11.
- Cold-Codex's single P2 (per-file `changes_requested` binding) was not dismissed. It is kept as Risk 5, with the spec evidence cited there.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Address Findings 1–4. Risks 5–7 are recommended where they fall out of the Finding 1/3 refactor. Spec Gap 14 is for the human and is not routed to the implementer.

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

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Full — base `main` — reason: delicate

Lenses: the anchored lens, the cold-Claude lens, and cold-Codex (which reported no findings). A clean cold-Codex result is not approval evidence here: cold-Claude found R2-1 below and confirmed it with a scratch test.

Foreman housekeeping: two lines of the Round 1 section above (Finding 3's failure scenario and the fixture dismissal) backticked three hypothetical paths that don't exist. That broke `npm run docs-refs-check`, and through it the six `--pr`-path tests in `tests/run-task-safety.test.ts` that the handoff's Iteration 2 Blockers report. The mistake was mine, not the implementer's. I rewrote those two lines without the backticked paths, and the check now passes.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: **pass**. The anchored lens re-ran every check after the review.md fix:
- `npm run build` left no `dist/` or `templates/` drift.
- lint, type-check, `sync-templates:check`, and `docs-refs-check` all pass.
- The full `npm test` suite passed 1285 of 1285, with no failures and no skips.

The handoff's two "Fail – unrelated" rows traced to the reviewer artifact and are resolved. Every file in the cumulative diff is in the spec's Affected Files, and `tests/run-task-safety.test.ts` is untouched.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `buildAffectedFilesAllowlist` is the only builder. `verifyBaseDrift`, the pre-flight, and both post-review sites call it. |
| AC-2 | Met (unchanged from round 1) | Uses `verifyBaseDriftFromData`. Covered cases: the new side of a rename, a prefix, a managed doc. |
| AC-3 | Met | `src/orchestrator/phases/code-review.ts:342-353`. The test asserts no agent calls, `blocked` status, the file and fixes in the escalation, and unchanged counters. |
| AC-4 | Met | The halt no longer mentions `reset-code-review`. A plain re-run resumes Round 1 after a Round-1 halt, and Round 2 (with `iterations_current_loop` = 1 kept) after a Round-2 halt. |
| AC-5 | Met (unchanged) | The block renders only when the list is non-empty. `spec.md` is byte-identical inside `onClaude`. The golden JSON changes only `promptImplement_fresh` and the new full-send key. |
| AC-6 | Met | The (a) amended, (a) directory-amended, (b) `changes_requested`, and (c) unjudged cases pass. The recovery path is enforced at `src/orchestrator/main.ts:3218-3235`. R2-1 is a Stage 2 regression at the other enforcement site. |
| AC-7 | Met (unchanged) | The existing pre-flight buckets are untouched; the in-scope case passes. |
| AC-8 | Met | The task-changed set is `origin/<base>...HEAD`, inside `!force` (`src/orchestrator/main.ts:1226`). The message comes from the pure `buildBaseDriftAbortMessage`, pinned by match/doesNotMatch pairs for base-only, task-only, and mixed drift. |
| AC-9 | Met (unchanged) | Only rule 1 of `implement.md` and its golden changed. |
| AC-10 | Met | Details in the validation gate above. |

### Verifying Round 1 findings

- _code-bug 1 (enforcement bypassed on the unfilled-review retry path):_ addressed. The `checkAndRoute` recheck (`src/orchestrator/main.ts:3218`) runs after the recovery loop and before routing, so it covers direct completion, evidence-advance, retry, and post-retry evidence. It uses the same base, cwd, and three-dot diff as the runner. There is a red-first subprocess test. ✓
- _code-bug 2 (halt prescribed an unnecessary reset):_ addressed. The message uses the real task IDs and a plain `canon run`. The docs and mirror are synced, and the Round-1 and Round-2 resume tests pass. ✓
- _code-bug 3 (post-foreman matcher differed from the pre-flight's):_ addressed. The check rebuilds the allowlist and runs the prefix-aware `verifyBaseDriftFromData`. A directory-amendment test is included. ✓
- _code-bug 4 (`--pr` classification used local base):_ addressed. ✓
- _risk 5 (bundle-wide `changes_requested`):_ addressed. `needs_re_review` is now treated the same way, and a comment explains the `some()`. ✓
- _risk 6 (`spec_gap` swallowed by the scope block):_ addressed as I recommended, but see R2-4 for the side effect. ✓ with follow-up
- _risk 7 (inline `--pr` message with no text test):_ addressed. The builder is pure, keeps the concrete fetch/rebase and stray-commit guidance, and is pinned by state-varying tests. ✓
- _nit 8 (missing blank line before Foreman Protocol):_ addressed. ✓
- _nits 9–13:_ still open, non-blocking. Some are restated below.
- _spec gap 14 (foreman `## Amendment` satisfies the reroute gate):_ still open. The handoff Blockers correctly leave it for the human, and the code is unchanged. Still a human decision.

### New findings (only NEW issues introduced by Iteration 2's changes)

#### Correctness Bugs

**R2-1 · `code-bug`: the in-phase post-foreman check blocks a partially written review instead of letting recovery retry it.**
- Sources: cold-Claude (P2; reproduced with a scratch test showing exit 2 and `blocked` status). Anchored and cold-Claude also flagged the same site as redundant and inconsistent. Verified by foreman.
- Location: `src/orchestrator/phases/code-review.ts:454-466`.
- The check skips only a review.md that is missing or still the template.
  - Failure scenario: in full-send, the foreman writes part of review.md, then crashes or runs out of budget before checking a verdict box or writing the amendment. `extractCheckedVerdict` returns `null`, which is not exempt, so the runner auto-blocks with "left out-of-scope files unjudged" and calls `process.exit(2)`.
  - Without this site, control returns to the main loop. The loop stores the `claude_review` session (`src/orchestrator/main.ts:3649-3671`), and then `checkAndRoute` finds code_review not done and runs the established evidence-advance and one-shot retry, which resumes the foreman so it can finish.
  - So on this failure mode, the new site replaces automatic recovery with a misleading block. The early exit also skips storing the session ID.
- The site is now redundant. The `checkAndRoute` recheck runs after every path that can complete code_review, and this site differs from it:
  - it reads verdicts from review.md checkboxes, not `status.json`;
  - it uses the changed-file list taken before the review, not a fresh one;
  - it records a different escalation `iteration_count`.
- This is the foreman rule of thumb: one invariant, one enforcement site.
- **Fix (preferred):** remove the in-phase post-foreman block and keep `checkAndRoute` as the only post-review scope enforcement.
  - Move the AC-6 (c) "unjudged auto-blocks" test to drive `checkAndRoute`, and assert the escalation reason names the file.
  - Add `checkAndRoute` pass cases for an amended file and for `changes_requested`. Today the router test covers only the block.
  - Add a runner case where review.md is filled but has no checked verdict and a file is unamended. It must not block in the runner.
- **Fix (acceptable alternative):** keep the in-phase site but skip it whenever any verdict is `null`, and leave that case to the router. The router tests above are still required.

**R2-2 · `code-bug` (low): the post-review block tells the operator to "request changes", which they can't do.**
- Sources: anchored and cold-Claude.
- Location: `fullSendScopeBlockReason`, `src/orchestrator/phases/code-review.ts:43-46`.
- No operator command requests changes on a blocked code_review.
  - The obvious attempt is `canon task phase <id> code_review done changes_requested`. It marks the phase done without going through `checkAndRoute`'s routing, so the next `canon run` starts at qa.
  - This is the same class as Round 1 Finding 2: blocking-path guidance that leads to a wrong state if followed.
- Fix: offer the normal halt's second fix instead: reroute with a note telling the implementer to remove the files.

#### Risk / Guardrails (non-blocking; recommended alongside R2-1)

**R2-3: a scope block after an `approved` verdict leaves a stale approval behind.** Sources: anchored and cold-Claude; cold-Claude reproduced it.
- What's left: verdict `approved`, `iterations_current_loop` reset to 0 by `updateReviewCounters` (`src/task/index.ts:394-397`), and a filled review.md with Approved checked.
- On resume after an amendment:
  - The run renders a fresh Round 1 over a review that already has content, including a `## Round N` section if the approval came at Round ≥ 2.
  - If the new session writes nothing, `tryEvidenceAdvance` advances on the stale approval.
- It's still resumable with a spec edit and `canon run`, as the Known Risk requires. The cost is a redundant full review and some confusion about round rendering.
- Suggested: state the recorded verdict in the block reason, or clear the verdict when blocking.

**R2-4: the `spec_gap` exemption is an undocumented deviation from Decision 2 and AC-6(c).** Sources: anchored and cold-Claude.
- The spec text says only `changes_requested` exempts. I recommended the exemption in Round 1 Risk 6, so part of this is mine.
- The FIX path is safe: `--reroute` clears `full_send`, so the next pre-flight halts normally.
- The BLESS path isn't: `canon task accept … code_review` sends the unjudged files on to QA and `--pr`, and the SPEC GAP banner doesn't list them.
- Suggested:
  - Include the unjudged list in the spec_gap escalation and banner so a BLESS is an informed decision.
  - Add a Deviations row to handoff.md.
  - Align the foreman template's "covered by `changes_requested`" sentence (`src/orchestrator/prompts/templates/code-review-foreman.md`) with the real exempt set.

**R2-5: a crash between the foreman's `phase done` and `checkAndRoute` skips enforcement.** Source: anchored.
- If the orchestrator dies after the foreman runs `canon task phase … done` but before `checkAndRoute`, the next run starts at qa and neither site checks scope.
- `--pr` backstops it. A check at QA entry would close the gap; that's optional.

#### Optional Cleanup / Nit

- Both scope checks fail open when `getAffectedFiles` hits a git error and returns `[]`. This is Round 1 nit 10; flagged by 2 lenses, and cold-Claude rated it P2. I rank it low: it's the helper's existing semantics, shared with the handoff pre-flight, and a `--pr` diff failure is fatal and can't be bypassed with `--force`, so an unjudged file can't ship.
- The pre-flight halt says "the active checkout". Printing the resolved spec path(s) would be more actionable. Fix (b) could also note that `--reroute` needs an `## Amendment`. Flagged by 2 lenses.
- `--pr` classification: if the `origin/<base>...HEAD` diff fails, every drift file is labelled "base advanced". With `--allow-divergent-base`, local-only base commits are labelled task-changed. Flagged by 2 lenses.
- Malformed-row warnings print once per builder call, so up to three times per full-send code_review. The dirty-tree gate in `commitHumanReviewFiles` still builds its own set (Round 1 nit 12). Flagged by 2 lenses.
- `--pr` message text:
  - It says "--pr aborted" on `--push` too.
  - It dropped the note about managed docs after QA.
  - It shows `PIPELINE_TELEMETRY_FILES` to adopters.
  - `git checkout origin/<base> -- <path>` can't restore a file that exists only on the task branch.
  - Sources: cold-Claude and anchored.
- `content === null ? null : …` at `src/orchestrator/phases/code-review.ts:457` is unreachable. It goes away if R2-1 removes the site. Source: anchored.
- Test gaps: the `iterations_total` and pre-flight counters are seeded at 0 in the halt tests, no integration test pins the `origin/` ref in the `--pr` wiring, AC-6(b) routing isn't asserted, and there's no malformed-amendment case. Flagged by 2 lenses. These are coverage gaps; test integrity is not compromised.

#### Spec Gaps

- Round 1 Spec Gap 14 is still open for the human; it isn't routed to the implementer. Cold-Claude raised it again independently this round, so 2 rounds × 2 lenses now agree.

### Dismissed Cold Findings

- Dismissed (cold-Claude): no gate ever flags implementer edits to managed docs. Reason: spec-intended. Decision 1 says the code_review pre-flight "always admits them, so it is never stricter than `--pr` will be after QA". Same as Round 1.
- Dismissed (cold-Claude): following the `--pr` rebase advice while local base is stale makes the code_review pre-flight flag base-advanced files. Reason: Decision 2 specifies the task's own changes as `<base>...HEAD` against the local base. The existing handoff→diff pre-flight has the same stale-base behavior, and it runs first.
- Dismissed (cold-Claude): raw file paths go into the foreman prompt without escaping or a size cap. Reason: the implementer that names the paths already controls the diff the foreman reads, so no new trust boundary is crossed. Low confidence and low severity. Same as Round 1.
- Dismissed (cold-Claude): pre-flight ordering, no review.md record of the halt, and no `--force`-style bypass. Reason: ordering is Round 1 nit 9 and still satisfies "before any cold-Codex or Claude session". Not writing to review.md is spec-intended (see the Round-rendering Known Risk). The spec asks for no bypass, and `canon task accept` exists.
- Dismissed (cold-Claude): `sanctioned` isn't exempt, so the router would re-block an operator-accepted task. Reason: unreachable. After `canon task accept`, code_review is done and the next run starts at qa. `checkAndRoute('code_review')` runs only right after `runPhase('code_review')`.
- Not dismissed (cold-Claude): the runner post-check uses the changed-file list from before the review, and the two sites record different escalation iteration counts. Both are folded into R2-1.
- Cold-Codex: no findings this round, so nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Address R2-1 and R2-2. R2-3 and R2-4 are recommended in the same pass because they touch the same code. Round 3 will be limited to correctness bugs and spec gaps.

## Round 3 — verifying iteration 3's response to round 2

**Scope:** Full — base `main` — reason: delicate

Lenses: the anchored lens, the cold-Claude lens, and cold-Codex. Cold-Codex reported no findings. Under Round 3 discipline, only correctness bugs (test-integrity findings count as correctness bugs) and spec gaps drive the verdict. Nits and wording items below are folded in or left out.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: **pass**. The anchored lens re-ran every check at HEAD `4a23fac`:
- `npm run build` left no drift in `dist/`, `templates/`, `src/` or `tests/`.
- lint, type-check, `docs-refs-check` and `sync-templates:check` all pass.
- The full `npm test` passed 1289 of 1289, with no failures and no skips.

Only `promptCodeReview_fullSendOutOfScope` changed in the golden this iteration. All 13 files in the cumulative diff are in the spec's Affected Files.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | `buildAffectedFilesAllowlist` is the only builder. `verifyBaseDrift`, the pre-flight and the router all call it. |
| AC-2 | Met (unchanged) | `verifyBaseDriftFromData` tests cover the new side of a rename, a directory prefix and a managed doc. |
| AC-3 | Met (unchanged) | The pre-flight halt did not change this iteration. |
| AC-4 | Met (unchanged) | The Round-1 and Round-2 plain re-run tests still pass. |
| AC-5 | Met | The block renders only when the list is non-empty, and `spec.md` is byte-identical inside `onClaude`. The runner outcome loop still verifies this correctly. |
| AC-6 | Met in code; coverage regressed | Enforcement now runs only in `checkAndRoute` (`src/orchestrator/main.ts:3218-3242`), after the recovery loop and before routing. Router tests cover exact-path amended (passes), `changes_requested` (routes to implement), unjudged (blocks and names the file) and `spec_gap`. The directory-form amendment and the sibling-spec amendment are no longer tested at any enforcement site (R3-1). |
| AC-7 | Met (unchanged) | |
| AC-8 | Met (unchanged) | |
| AC-9 | Met (unchanged) | |
| AC-10 | Met | Details in the validation gate above. |

AC-6(c) deviation: `spec_gap` is exempt from the scope block. I judge it acceptable, and the anchored lens agrees. A `spec_gap` verdict still auto-blocks, and its escalation and banner now name the unamended files, so the literal AC-6(c) outcome holds on that path. The one remaining difference is an explicit human BLESS. The handoff now records this as a Deviation and an `[ambiguity]` blocker. This follows my Round 1 Risk 6 and Round 2 R2-4 recommendations.

### Verifying Round 2 findings

- _code-bug R2-1 (the in-phase check blocked a partial review):_ addressed. The in-phase block and its bookkeeping are gone, and the runner's post-`runClaude` loop is byte-identical to `main`. A review.md with partial content and no verdict stays `in_progress`, so `checkAndRoute` recovery (evidence-advance, then retry) handles it.
  - `checkAndRoute` is the only enforcement site. Its one caller runs after every `runPhase`, including step mode, interactive mode and detached runs.
  - The red-first test is meaningful: the anchored lens swapped in the prior-iteration runner, and the partial-review test failed with `process.exit` 2. ✓
- _code-bug R2-2 ("request changes" guidance):_ addressed. `fullSendScopeBlockReason` offers a spec edit plus `canon run <ids>`, or a reroute with a note. ✓
- _risk R2-3 (stale approval):_ addressed as far as I asked. The recorded verdict is named in the block reason. See the carried risk below. ✓
- _risk R2-4 (undocumented `spec_gap` deviation):_ addressed. The escalation and banner list the files, the handoff records the deviation, and the foreman template matches the code. ✓
- _risk R2-5 (crash between the foreman's `phase done` and `checkAndRoute`):_ still open. Cold-Claude widened it; see below. Non-blocking.
- _spec gap 14 (the foreman's `## Amendment` satisfies the reroute gate):_ still open for the human.

### New findings

#### Correctness Bugs

**R3-1 · `code-bug` (test integrity): the post-foreman outcome tests pass vacuously now that the runner no longer enforces.**
- Sources: anchored and cold-Claude. Both independently mutation-verified it, and I read the tests to confirm.
- Location: `tests/run-task-code-review.test.ts`:
  - the runner outcome loop `scope pre-flight full-send outcome: …` (~548-593);
  - the second half of `mixed full-send bundle halts; an amendment in a sibling spec covers the shared diff` (~523-546);
  - the router outcome loop (~457-487).
- What's wrong:
  - The runner cases `amended`, `directory_amended`, `unjudged`, and the bundle's sibling-amendment step still claim post-foreman outcomes. They only call `runCodeReviewPhase` and assert "not blocked", which is always true now.
  - The router loop, the real enforcement site, covers only an exact-path amendment. It has no directory-form case and no bundle sibling-spec case.
- Evidence: both lenses replaced `allowlist.prefixes` with `[]` in `findUnjudgedFullSendFilesFromData`, so the router stops honoring directory-form amendments. All 43 code-review tests still passed. Cold-Claude also disabled the router block entirely, and only one test failed.
- Consequence: Round 1 Finding 3 (directory-form amendment matching) and the bundle union rule from Interaction Dependencies no longer have a guard that can fail.
- Fix:
  1. Add `directory_amended` to the router outcome loop: amend with a directory-form row covering the file, and expect exit 0 with status not blocked.
  2. Add a router case where a two-member full-send bundle is covered by an amendment in the *other* member's spec. Expect exit 0. Include the matching unjudged case, which expects exit 2 and the file named.
  3. Add a prefix case to the `findUnjudgedFullSendFilesFromData` unit test.
  4. In the runner outcome loop and the bundle test, drop or rename the post-foreman outcome claims. What the runner now guarantees is: no block after the foreman, the prompt names the files, and `spec.md` is not changed before the foreman.
  5. Optional: rename `full-send scope is enforced after an unfilled review retries to approved`. It hand-writes `done`/`approved`, so it tests the router boundary, not the retry path its name claims.

#### Risk / Guardrails (carried; non-blocking at Round 3)

- **Paths to QA that skip `checkAndRoute`.** Sources: anchored (R2-5) and cold-Claude.
  - The router check only runs right after `runPhase('code_review')`.
  - It is skipped if the process dies after the foreman's `canon task phase … done`.
  - It is also skipped by operator overrides (`canon task phase … done`, `canon task accept`).
  - In each case the next run starts at qa, and the `--pr` base-drift gate is the backstop. The `spec_gap` and `changes_requested` routing already has the same gap, so this is not new.
  - A check at QA entry would close it. Worth a follow-up issue rather than another round.
- **Resuming after a stale-approval block is a fresh Round 1.** Source: cold-Claude (R2-3 carried).
  - An `approved` verdict resets `iterations_current_loop`, so after amending, `canon run` pays for a full new review. The Round 1 prompt ("fill the existing template") could overwrite earlier `## Round N` sections.
  - It only happens when a full-send foreman approves without writing the amendment it was told to write. The block reason now names the recorded verdict.
- **BLESS guidance.** Sources: anchored and cold-Claude.
  - The `spec_gap` banner says to "inspect these files before blessing". After a BLESS, unamended files still abort at `--pr`.
  - Clearer wording: add them to Affected Files or remove them before blessing. The same text has a spacing slip ("…in the spec.  Full-send files… before blessing.Recovery options"). Both are wording only; fix them in the same pass if convenient.

#### Spec Gaps

- **Spec Gap 14 (carried, 3 rounds).** The foreman's bare `## Amendment` satisfies the round-1 reroute gate, and the reroute prompts treat it as the human's change request. Cold-Claude raised it again independently this round. It needs a human decision and is not routed to the implementer.
- **Full-send `spec_gap` × unamended files × BLESS.** Source: anchored. The spec doesn't define whether a BLESS on a full-send `spec_gap` should also require an amendment. The implementer's `[ambiguity]` entry states it correctly. Human decision; not routed.

### Dismissed Cold Findings

- Dismissed (cold-Claude): a foreman-written directory amendment (for example, the whole source tree) removes the scope cap with no bound. Reason: spec-accepted. The Known Risk "Foreman leniency" says the foreman's classification and reason are recorded in review.md and the amendment, "visible in the PR diff, where full-send puts human review".
- Dismissed (cold-Claude): managed docs are always admitted at code_review. Reason: Decision 1, same as Rounds 1 and 2.
- Dismissed (cold-Claude): "reroute with a note" understates what a reroute involves. Reason: Decision 2 (b) prescribes this fix wording. Wording only.
- Dismissed (cold-Claude): the new router check fails open when git fails, and `--pr` classification mislabels drift when the three-dot diff fails. Reason: this was the Round 1/2 nit. The `--pr` diff failure is fatal and can't be bypassed with `--force`, so an unjudged file can't ship. Not a Round 3 correctness bug.
- Dismissed (cold-Claude): the `spec_gap` escalation text is concatenated wrongly. Reason: cosmetic persisted wording, folded into the BLESS guidance note above.
- Dismissed (cold-Claude): the dirty-tree gate in `commitHumanReviewFiles` still builds its own allowlist, and malformed-row warnings repeat. Reason: a carried nit. AC-1 names only `verifyBaseDrift` and the pre-flight.
- Dismissed (cold-Claude): the base-drift message drops the note on managed docs after QA, names a constant, and says "--pr aborted" on `--push`. Reason: wording only, and it predates the task.
- Dismissed (cold-Claude): a handoff pre-flight failure hides scope problems for one round. Reason: the carried Round 1 nit 9. It still satisfies "before any cold-Codex or Claude session".
- Not dismissed (cold-Claude): the post-foreman outcome tests pass trivially. That is R3-1.
- Not dismissed (cold-Claude): the test named "retries to approved" overclaims. Folded into R3-1 item 5.
- Not dismissed (cold-Claude): process-death and operator-override bypass, and the stale-approval resume. Both are carried as non-blocking risks above.
- Not dismissed (cold-Claude): the `## Amendment` collision. Carried as Spec Gap 14.
- Cold-Codex: no findings this round.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Address R3-1 only. It is a test-only fix: add router cases for a directory-form amendment and a bundle sibling amendment, add a prefix unit case, and remove the vacuous runner-side claims. No source change is required. The carried risks and spec gaps are for the human and a follow-up issue.
