# Code Review: full-send-tail-push-and-watch

> Reviewer: Claude | Spec: `tasks/full-send-tail-push-and-watch/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns:
- Anchored: `STAGE_1: pass`, signal `changes_requested`.
- Cold-Claude: 12 findings, signal `changes_requested`.
- Cold-Codex: no actionable findings; the full suite passed (1,531 passed, 1 skipped).

Context: earlier review rounds 1–3 are archived in `tasks/full-send-tail-push-and-watch/review-prior-1.md`. HEAD has not changed since the round-3 verdict, and the handoff has no Iteration 4. The round-3 test-integrity finding is therefore re-checked here, and it is still open.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results (the Iteration 2 `Fail – unrelated` docs-refs row was superseded by a Pass in Iteration 3)
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: classifyIdle reports a dead tail | Pass | `src/cli/commands/watch.ts:465-472` checks `findCrashEvidence` before it returns `checkpoint`. The `code=0` and non-full-send controls are present. Red against the old early return. The anchored lens re-ran the watch tests: 61/61 pass. |
| AC-2: late attach reports a dead tail | Pass | `classifyAttach` (`watch.ts:374-383`) returns `death` with the marker reason, and `watchCmd` exits 4 with the reason on stderr. |
| AC-3: live tail never checkpoint/death | Pass | A live pid wins in `classifyAttach`, in `classifyIdle` and in `orchestratorStillProgressing` (`watch.ts:557`). Covered both with no marker and with a stale `code=1` marker. |
| AC-4: tail pushes safe-to-push commits | Pass | `pushScaffoldBaseCommitsForFullSend` (`src/orchestrator/main.ts:1171-1206`) is called only on the full-send tail route, before `commitHumanReviewFiles`. The real-git `main()` test covers the copy case and asserts the pushed SHAs and subjects. The plain `--pr` control is present. The handoff records the red run. |
| AC-5: other commits never pushed | Pass | Six real-git variants (arbitrary, suffixed, embedded, outside-path, rename, real merge). Each asserts origin is unchanged and the divergence death. |
| AC-6: push/probe failures fail closed | Pass | A pre-receive rejection gives the git error plus the protected-branch hint. A listing-probe failure dies without pushing. |
| AC-7: concurrent operator commit not pushed | Pass | A PATH git wrapper commits before the refspec resolves. The push is `<tipSha>:refs/heads/<base>`. Red when the push uses the branch name. |
| AC-8: accurate scaffold hint | Pass | `scaffoldCommitHint` (`src/orchestrator/phases/implement.ts:12-19`) has direct tests. The real-git `hasUnpushedScaffoldCommits` test covers false, true, unsafe-false and null. |
| AC-9: restatements updated | Pass | `docs/pipeline-orchestrator.md` updates the watch `0`/`4` rows, the `--full-send` row, the scaffold-to-base paragraph and the base-divergence paragraph. The mirror is synced, and the README paragraph is updated. See the nit about `--help` text. |
| AC-10: build and checks | Pass | dist contains the new symbols. The handoff reports lint, type-check, suite, docs-refs and sync as Pass. Cold-Codex independently ran the suite green. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is sound and matches the spec's three decisions. The safe-to-push predicate is a single shared helper (`src/orchestrator/git.ts`) used by both the tail push and the hint probe. Every probe failure fails closed, and the push targets the checked tip SHA. The watch changes are scoped to `isFullSendTailPending`. The one blocking item comes from the test file, not the feature: a pre-existing assertion that this task loosened is still loosened. Round 3 flagged it, and it was never fixed.

### Findings

#### Correctness Bugs

1. **`code-bug` (test integrity): a weakened pre-existing assertion is still in the diff.** Flagged by 2 lenses (anchored and cold-Claude), and the same finding was left open from archived round 3.
   - **Where:** "commitHumanReviewFiles fails closed when only the task-changed diff fails (force=…)", at `tests/run-task-safety.test.ts:6736`.
   - **What changed:** on `main` the assertion is `assert.doesNotMatch(output, /could not compute base-drift diff|git rebase|base advanced|src\//)`. The branch drops the `|src\/` alternative.
   - **Why it's a bug:** this test covers the `--push` path, which this feature does not change. The anchored lens restored `|src\//` in a temporary copy, and both the force=false and force=true variants pass. Nothing justifies the loosening.
   - **Fix:** restore `|src\//`.
   - **Same pass, at `tests/run-task-safety.test.ts:6805`:** revert "base-drift gate dies when the base branch advanced outside Affected Files" to `main`'s `/src\/orchestrator\/main\.ts\s*$/m`. The branch's `/src\//` is stricter, so this one is not a weakening. It is still an unrequested change to an unrelated test, and `main`'s form passes.
   - **Done when:** `git diff main...HEAD -- tests/run-task-safety.test.ts` shows neither line.
   - **Handoff:** correct the Iteration 3 "Findings addressed" claim that the source-path assertion was restored, in a new Iteration 4 section.

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

- **`--help` text is incomplete (anchored).** The `--full-send` help line in `src/cli/index.ts:97` and `src/orchestrator/cli.ts:136` still says only "Skip the spec gate and auto-open a draft PR after clean QA". It does not mention the new base push. It doesn't contradict the new behavior, but `--help` is where an operator would look for a git side effect. Both files are outside Affected Files and AC-9 did not list them, so this is an advisory for the human: a follow-up, or an amendment if wanted.
- **Hidden failure reason in AC-5 tests (anchored).** The AC-5 variants do not assert the `not safe to push (<reason>)` info line, so a variant could pass for the wrong reason. Optional.
- **No heartbeat notice on the idle `live` branch (cold-Claude).** The idle-loop `live` branch (`watch.ts:920`) continues without the heartbeat-age notice that other live paths print. Cosmetic.
- **"One line" printed as several (anchored).** Decision 2 says "one line listing the pushed commits". The implementation prints a header line plus one line per commit. The intent is met.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the push runs before the remaining PR gates, so a later gate can die after origin's base has changed. Spec Decision 2, under "Ordering tradeoff (accepted)", chooses this explicitly: the commits carry only task artifacts and telemetry, and a re-run needs them pushed anyway.
- Dismissed (cold-Claude, also raised low-confidence by the anchored lens): for a pending full-send tail, a live resolved pid is trusted regardless of heartbeat age, so a recycled pid could block watch. Flagged by 2 Claude lenses; cold-Codex did not raise it, so this is not cross-model agreement. Spec Decision 1, "Live tail", requires exactly this: "While the orchestrator pid is alive, watch keeps blocking … even when the heartbeat has gone stale … A live pid takes precedence over any exit marker". AC-3 pins it, Known Risks lists it, and `--timeout` bounds it. Recorded for the human as an accepted tradeoff.
- Dismissed (cold-Claude): the `tasks/` prefix allows any task's paths, not just the subject's id. Spec Decision 2 defines the rule as "under `tasks/`", and Known Risks ("Concurrent full-send tasks") intends sibling scaffold commits to be pushed. `tasks/` is canon's own task root in an adopter repo.
- Dismissed (cold-Claude): the hard-coded `tasks/` ignores `CANON_TASKS_DIR_OVERRIDE`. That override is a test-only hook: `src/orchestrator/state.ts` (lines 97, 133, 154) short-circuits guards when it is set. It also fails closed, since nothing gets pushed.
- Dismissed (cold-Claude): a non-fast-forward push reports "may be protected". Spec Decision 2, under "Fail closed", names both protected and non-fast-forward as causes of the same die path, and the message includes the git error, which names the real cause.
- Dismissed (cold-Claude): the tail's fetch dies, while `verifyBaseDivergence` only warns. Spec Decision 2, under "Fail closed", requires a failed fetch to die, and the plan notes accept the inconsistency.
- Dismissed (cold-Claude): the README headline "never pushes … on its own" understates the full-send push. The push is flag-gated (`--full-send`), so the bullet's "need a flag" framing still holds, and AC-9 required exactly the clause that was added.
- Dismissed (cold-Claude): hint wording with a mixed range or `--allow-divergent-base`. The wording follows Decision 3 nearly verbatim ("stops if any other commit is unpushed"). The same finding was dismissed in archived rounds 1–3.
- Dismissed (cold-Claude): the hint is suppressed when only non-scaffold commits are unpushed. Decision 3 requires this: the hint prints "only when local `<base>` actually has unpushed canon scaffold commits". The divergence gate still reports operator commits at `--pr`/`--ship`.
- Dismissed (cold-Claude): in a partially full-send bundle, watch checks only the watched task's flag. Decision 1 scopes the rules per task to `full_send === true`. In a mixed bundle the orchestrator exits at `human_review`, so no pid is live and classification falls through to crash evidence or `checkpoint` as before.
- Dismissed (cold-Codex): none. It reported no findings.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

## Round 2 — verifying iteration 4's response to round 1

**Scope:** Delta — base `b056d9741d1e5aa7db4131418af7a1c6da4edf20` — reason: small fix within the files already under review

Lens returns:
- Anchored: `STAGE_1: pass`, signal `approve`.
- Cold-Claude (delta only): 6 findings, signal `changes_requested`.
- Cold-Codex (delta only): one P2, the `src/` assertion at `tests/run-task-safety.test.ts:6833`.

The handoff numbers this response "Iteration 4" because rounds 1–3 were archived to `review-prior-1.md`. It is this review's round-1 response.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | The delta touches only `tests/run-task-safety.test.ts`, and `src/cli/commands/watch.ts` has not changed. |
| AC-2 | Met (unchanged from round 1) | — |
| AC-3 | Met (unchanged from round 1) | — |
| AC-4 | Met (unchanged from round 1) | The anchored lens re-ran `tests/run-task-safety.test.ts`: 255/255 pass. |
| AC-5 | Met (unchanged from round 1) | — |
| AC-6 | Met (unchanged from round 1) | — |
| AC-7 | Met (unchanged from round 1) | — |
| AC-8 | Met (unchanged from round 1) | — |
| AC-9 | Met (unchanged from round 1) | The `--help` text advisory stands (nit). |
| AC-10 | Met | lint, type-check and the suite pass (1,531 passed, 1 skipped). docs-refs-check is `Fail – unrelated`, and the cause is verified: the one broken ref was this review artifact's own malformed line-range ref in round 1's dismissal list, not task code. The foreman rewrote that ref in this round and re-ran `npm run docs-refs-check`: "All refs OK". |

### Verifying round 1 findings

- _code-bug (test integrity), weakened assertion at ~6736 plus the unrequested edit at ~6805:_ addressed ✓
  - `git diff main...HEAD -- tests/run-task-safety.test.ts` no longer shows either `src\/` line. The anchored lens confirmed this with grep.
  - The force-variant assertion is back to `main`'s `…|base advanced|src\//`. The base-advance assertion is back to `main`'s `/src\/orchestrator\/main\.ts\s*$/m`.
  - The Iteration 3 claim is corrected in Iteration 4.
- _Test isolation added alongside the fix:_ seven pre-existing fake-CLI `main()` tests now set `status.worktree = true` with a temporary `CANON_WORKTREES_ROOT`.
  - **Why it was needed.** The anchored lens ran `main`'s unmodified versions against the current tree, and all seven fail with `docs-refs-check found broken refs … review.md:91`. Without worktree mode, `getActiveCwd` returns REPO_ROOT, so the docs-refs gate scanned the live `tasks/`. On `main` the tests were not hermetic; they passed only because the live tree happened to be clean.
  - **What it preserves.** Fake git ignores cwd, so every git-log and output assertion runs against unchanged fake-git behavior, and the docs-freshness config they lose lists no file these tests dirty.
  - Accepted as a hermeticity fix. See the coverage nit below.

### New findings

#### Correctness Bugs

(none)

#### Optional Cleanup / Nit

- **Non-worktree `--pr` coverage now thinner (flagged by 2 lenses: anchored and cold-Claude).** The seven isolated tests no longer run the REPO_ROOT branch of the `--pr` path. That means the non-worktree `getActiveCwd` result, `verifyBranch`'s mismatch path, and a docs-refs scan over real content. No assertion depended on these paths. A follow-up could restore a non-worktree variant with a temporary REPO_ROOT.
- **`force=false` gains nothing from the new setup (cold-Claude).** In the `fails closed when only the task-changed diff fails` loop, `force=false` now writes `worktree: true` without passing `CANON_WORKTREES_ROOT`. It works only because `runHumanReviewCommit` passes an explicit cwd. Scope the setup to `force=true`, or add a comment.
- **Duplicated setup (cold-Claude).** The four-step isolation setup is copied by hand into seven tests. An option on `setupHumanReviewHarness` or `runHumanReviewCommit` would stop the copies drifting apart.
- **Other tests still read the live checkout (cold-Claude and anchored).** Other `--pr`/`--push`/`--full-send` tests (for example around 5374, 6232, 6722) still run with cwd at the live checkout. They pass only because they die before the docs-refs gate or use `--force`. This is not a regression in this delta, but the same coupling remains.
- Round-1 advisory nits are still open and deferred by the handoff: the `--help` text in `src/cli/index.ts:97` and `src/orchestrator/cli.ts:136` (outside Affected Files; a human call), the AC-5 tests not asserting the reason line, the idle `live` heartbeat notice, and the "one line" wording.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex, and cold-Claude on the same line, cross-model): "the base-drift source-path assertion at `tests/run-task-safety.test.ts:6833` was narrowed from `/src\//` and should stay broad". Both cold lenses saw only the delta, so they compared against the round-1 head instead of the baseline. The evidence:
  - The new form, `/src\/orchestrator\/main\.ts\s*$/m`, is `main`'s exact assertion, and `git diff main...HEAD` shows no change on this line.
  - Round 1 (`Correctness Bugs` above, the `6805` paragraph) asked for this revert because the branch's `/src\//` was an unrequested change to an unrelated test.
  - Restoring the baseline is not a test-integrity regression. Broadening this assertion is a separate decision about a test this task doesn't own.
- Dismissed (cold-Claude): restoring `|src\/` at ~6764 is described as brittle. It is `main`'s exact pre-existing assertion. Round 1 required restoring it, because dropping it was the test-integrity regression.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.
-->
