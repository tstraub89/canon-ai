# Code Review: full-send-tail-push-and-watch

> Reviewer: Claude | Spec: `tasks/full-send-tail-push-and-watch/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored = `STAGE_1: fail`, `changes_requested`; cold-Claude = 12 findings, `changes_requested`; cold-Codex = no actionable findings.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: classifyIdle reports a dead tail | Pass | `tests/watch.test.ts` "classifyIdle: full-send tail reports a fresh non-zero exit…" covers the death case and both checkpoint controls (`code=0`, `full_send:false`). The existing settled-checkpoint test is unchanged. No red run was recorded, but the test is red against `main` by construction: old `classifyIdle` returns `checkpoint` before any crash check. |
| AC-2: late attach reports a dead tail | Pass | "classifyAttach and watchCmd report a dead full-send tail…" asserts `death` plus the reason, and that `watchCmd` exits 4 with the reason on stderr. Red by construction: old `classifyAttach` skipped crash evidence at `human_review`. |
| AC-3: live tail never checkpoint/death | Partial | The live pid + stale heartbeat + old `code=1` marker case is covered across `classifyIdle`, `classifyAttach` and `orchestratorStillProgressing`. The spec's "no marker" fixture variant is missing. It runs the same code path, so this is a minor gap. |
| AC-4: tail pushes safe-to-push commits | Partial | The real-git `main()` child-process test pushes two scaffold commits, one of them the byte-identical copy, asserts the remote tip equals the checked tip, and reaches `pr create`. The plain `--pr` control exists. Gap: the assertion matches only the count prefix of the pushed-commit line, not the listed SHAs/subjects. |
| AC-5: other commits never pushed | Not Met | Only the data-level `classifySafeToPushCommitFromData` unit test exists. The spec requires each variant to be checked end to end (tail does not push, `origin/<base>` unchanged, divergence message), and none is. The rename variant passes a hand-built path list, so dropping `--no-renames` from the `diff-tree` probe would not turn it red. That probe is exactly what the spec says this variant must pin. The merge variant passes `parentCount=2` directly, so `rev-list --parents` parsing is never exercised. The embedded near-miss subject is not covered. |
| AC-6: push/probe failures fail closed | Not Met | No rejected-push test and no probe-failure test. The implementation exists (`src/orchestrator/main.ts` `pushScaffoldBaseCommitsForFullSend` dies on fetch/list/inspect/push failures) but nothing regresses it. |
| AC-7: concurrent operator commit not pushed | Not Met | No injection test. The implementation pushes `<tipSha>:refs/heads/<base>`, which is correct, but the AC requires a real-git regression. |
| AC-8: accurate scaffold hint | Not Met | No test for the no-commit case (this AC is red-first) or for either wording. The logic in `src/orchestrator/phases/implement.ts:65-76` matches Decision 3. |
| AC-9: restatements updated | Pass | The pipeline-orchestrator rows and paragraphs plus the mirror are updated, and so is the README paragraph. |
| AC-10: build and checks | Pass | The handoff records Pass for lint, type-check, the full suite (1,526 pass, 1 skip), build, docs-refs-check and sync-templates:check. Both dist bundles are in the diff. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Gaps (the handoff's own Blockers section reports them accurately):

1. **AC-5, AC-6, AC-7 and AC-8 lack the regressions the spec requires.** They pin the two safety-critical Known Risks: pushing operator work by accident, and a protected base. Cold-Claude flagged the same missing negative-path tests independently (see Findings).
2. **Undocumented deviation.** Spec §Affected Files says `commitTaskArtifactsToBase` "reports whether it committed". That was not implemented, and the handoff says "No deviations". The behavior is not needed: Decision 3 keys the hint on the unpushed-commit probe, which `hasUnpushedScaffoldCommits` does. So record it in the Deviations table rather than implementing it.

## Stage 2 — Code Quality (only if Stage 1 passed)

Stage 2 was not run by the anchored lens, because Stage 1 failed. The cold-lens findings below are still adjudicated, since a verified cold finding stands regardless of Stage 1.

### Findings

#### Correctness Bugs

1. **`code-bug` (test integrity). The negative-path push-safety coverage is missing.** Flagged by 2 lenses: anchored (Stage 1 gaps) and cold-Claude. See `tests/run-task-safety.test.ts:5848-5897` for the happy path only. Add real-git `main()` child-process tests under full-send for the following:
   - **AC-5:** each variant must leave `origin/<base>` unchanged and die with the divergence message. The variants are an arbitrary subject, a suffixed near-miss subject, an embedded near-miss subject, a scaffold subject that touches `src/`, a rename from the fixture source module into `tasks/<id>/` (this one goes through the real `diff-tree --no-renames` probe), and a merge commit (this one goes through real `rev-list --parents`).
   - **AC-6:** a rejected push dies with the git error and the protected-branch hint, and `pr create` is never reached. A probe failure dies with nothing pushed.
   - **AC-7:** a concurrent operator commit injected between list and push is not on origin.
   - **AC-8:** with no commit and no unpushed safe commits, no `Scaffold committed` line prints. With unpushed safe commits, the full-send wording prints under full-send and today's wording otherwise.
   - **AC-3:** add the "no marker" variant.
   - **AC-4:** tighten the pushed-line assertion to the listed SHAs/subjects.

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

1. **Docs overstate "stops" when `--allow-divergent-base` is set.** Source: cold-Claude. Affects the `docs/pipeline-orchestrator.md` `--full-send` row and divergence paragraph, and the README. They say that when any other commit is unpushed the tail "pushes nothing and stops at the divergence gate". With `--allow-divergent-base`, the gate is bypassed and the tail proceeds to the PR. Consider qualifying it with "unless `--allow-divergent-base` is set", as Decision 2 implies.
2. **`CANON_TASK_ID_PATTERN` duplicates the task-id regex.** Source: anchored. At `src/orchestrator/git.ts:196`, it repeats the regex already in `validateTaskId` (`src/orchestrator/cli.ts`, `src/task/index.ts`). Optional: share one constant.
3. **Handoff Deviations table.** Record the `commitTaskArtifactsToBase` non-change (Stage 1 gap 2).

#### Spec Gaps

1. **Advisory only. It does not drive the verdict and needs no implementer change: keep the spec's die behavior.** Source: cold-Claude, at `src/orchestrator/main.ts:1192-1199`. Under full-send on a protected base, `--allow-divergent-base` used to let the tail reach the PR. Now the scaffold push is rejected first, the tail dies, and the override can no longer serve as an escape hatch there. The code matches the spec: Decision 2 §Fail closed says "If the push fails … the tail dies", and "`--allow-divergent-base` under full-send: the push still runs first". But Known Risks "Protected base branch" compares only against today's non-override path. Human: decide whether a rejected push under `--allow-divergent-base` should warn and continue. If so, amend the spec in a later round or follow-up.

### Dismissed Cold Findings

- Dismissed (cold-Claude): a recycled pid or unbounded heartbeat staleness keeps watch blocking on a pending full-send tail (`src/cli/commands/watch.ts:375-377, 466-468, 557`), and the watch test pins that behavior. The spec intends this. Decision 1 §Live tail says "While the orchestrator pid is alive, watch keeps blocking … even when the heartbeat has gone stale … A live pid takes precedence". AC-3 requires it. The existing `blockedPhaseLivenessTrusted` also reduces to the pid probe, so this matches current behavior.
- Dismissed (cold-Claude): a fetch failure dies in the tail, whereas `verifyBaseDivergence` warns and skips. The spec mandates this: Decision 2 §Fail closed says "If the fetch or the commit-listing/path probe fails, the tail dies with the error and pushes nothing."
- Dismissed (cold-Claude): the push-failure hint says "may be protected" even for a non-fast-forward rejection. The spec prescribes this wording (Decision 2 §Fail closed), and the message includes git's stderr, which names the non-fast-forward cause. Non-Goals exclude auto-pull/rebase.
- Dismissed (cold-Claude): the classifier pushes other tasks' scaffold commits and does not bind paths to `tasks/<subject-id>/`. The spec intends this. Known Risks "Concurrent full-send tasks … That is intended". Problem says "the guard is a content-safety rule, not a provenance rule".
- Dismissed (cold-Claude): the push decision uses the stored `full_send` flag rather than the current invocation's flags. That flag is the existing task-level consent that `shouldRunFullSendTail` already uses to open the PR, and Decision 2 ties the push to "the full-send tail". This is not a new consent path.
- Dismissed (cold-Claude): the full-send hint says the tail pushes even when an unsafe commit is also unpushed. Decision 3 keys the hint on the presence of safe commits, and the printed wording includes "and stops if any other commit is unpushed", so it is not misleading.
- Dismissed (cold-Claude): the hint probe does not fetch and prints nothing when every unpushed commit is unsafe. The spec specifies this: Decision 3 says "(safe-to-push commits not on `origin/<base>`, no fetch)", and the hint prints only when such commits exist.
- Dismissed (cold-Claude): `unpushed.commits[0]` as the tip relies on `git log` ordering. `getUnpushedBaseCommits` runs `git log origin/<base>..<base>` (`src/orchestrator/git.ts:178`), which starts its walk at the tip. Any merge aborts before the push, so on the linear chains that reach the push, `commits[0]` is the tip. Low confidence, and the finding does not hold.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `db8bfd2d5c14ad9c0a3b32dfa7acd76e99899bee` — reason: small fix within the files already under review

Lens returns:
- Anchored: `STAGE_1: pass`, signal `changes_requested`.
- Cold-Claude (delta only): 10 findings, signal `changes_requested`.
- Cold-Codex (delta only): no actionable defects.

Foreman administrative fix: the Round 1 Findings item 1 above cited the AC-5 fixture's missing source-module path in backticks, which made `docs-refs-check` report a broken ref (review.md:61). I reworded it with no change in meaning. That broken ref is what drove the iteration's test workarounds (finding 1 below).

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Unchanged from round 1. Red against `main` by construction. |
| AC-2 | Met | Unchanged from round 1. |
| AC-3 | Met | No-marker variant added (`tests/watch.test.ts:498-501`). |
| AC-4 | Met | The real-git happy path now checks the short SHA and full subject of each pushed commit. Red-first evidence is recorded in the handoff. |
| AC-5 | Met | Six real-git variants run through `main()`, including a real rename and a real merge. Each asserts origin is unchanged, the divergence message appears, and no `pr create` runs. Removing `--no-renames` or the parent check would let the push happen and turn the test red. |
| AC-6 | Met | A pre-receive hook rejection checks the git error, the protected-branch hint, that origin is unchanged and that no PR was created. A fake git on PATH fails the listing probe, and the helper's own message is asserted. |
| AC-7 | Partial | The test cannot tell pushing the SHA from pushing the branch name (finding 2). |
| AC-8 | Partial | Only the pure `scaffoldCommitHint` helper is tested. The `hasUnpushedScaffoldCommits` probe and the implement-entry wiring have no test (finding 3). |
| AC-9 | Met | The `--allow-divergent-base` wording is now in the README, the doc and the mirror. |
| AC-10 | Partial | `docs-refs-check` fails on two task-artifact refs. The review.md one is fixed above. handoff.md:191 is the implementer's own row and re-cites the same missing path in backticks, so it still fails (finding 4). Lint, type-check, the suite (1,530 pass), build and sync-templates pass per the handoff. |

### Verifying round 1 findings

- _code-bug (test integrity), negative-path coverage:_
  - AC-3, AC-4, AC-5 and AC-6 are addressed ✓.
  - AC-7: a test was added, but it cannot fail against the bug it exists to catch. Still open (finding 2).
  - AC-8: only the helper is tested. Still open (finding 3).
- _nit, docs "stops" wording:_ addressed ✓.
- _nit, handoff deviation record:_ addressed ✓.
- _nit, duplicated task-id regex:_ not addressed. It is optional, so that is acceptable.

### New findings

#### Correctness Bugs

1. **`code-bug` (test integrity): pre-existing tests were weakened to work around a leaked docs-refs failure.** Flagged by 2 lenses: anchored and cold-Claude, and cold-Claude reproduced it.
   - **What changed:** `--force` was added to six pre-existing tests at `tests/run-task-safety.test.ts:5177, 5270, 5368, 5416, 6226, 7059`. The `src\/` alternative was also removed from the `doesNotMatch` at `tests/run-task-safety.test.ts:6711`.
   - **Why it was done:** these tests run `main()` with the live checkout as cwd, so the docs-refs gate scans the real `tasks/` tree. They failed only because of the broken artifact refs.
   - **What it costs:**
     - `--force` moves the tests off the default path. It bypasses the docs-refs, base-drift allow-list and dirty-REPO_ROOT gates.
     - The removed alternative permanently drops the check that no source path appears in the drift-failure output.
   - **Fix:** revert all six `--force` additions and restore `src\/`. The artifact refs are now clean apart from handoff.md:191 (finding 4), so the originals should pass again.
   - **Optional:** isolate those tests' cwd so docs-refs runs against the fixture. The leak predates this task, so that is not required here.
2. **`code-bug` (test integrity): the AC-7 concurrent-commit test passes whether the code pushes the tip SHA or the branch name.** Source: anchored, verified empirically.
   - **Why:** the operator commit is injected from a `pre-push` hook. Git has already resolved the refspec by then, so even `git push origin main` would leave the injected commit off the remote.
   - **Fix:** inject the commit before the ref is resolved. Use a fake `git` wrapper on PATH that, on the tail's `push` call, commits on local main and then execs the real git, as the spec suggests.
   - **Red check:** confirm the test goes red when the push uses the branch name.
3. **`code-bug` (test coverage): AC-8 does not reach the probe.** Flagged by 2 lenses: anchored and cold-Claude.
   - **Gap:** `hasUnpushedScaffoldCommits` (`src/orchestrator/git.ts:240`) has no test. If the probe were hard-coded, or given the wrong cwd, every test would stay green.
   - **Fix:** add a real-git unit test covering four cases:
     - no unpushed commits → `false`
     - a scaffold-only unpushed commit → `true`
     - only an unsafe unpushed commit → `false`
     - a missing `origin/<base>` ref → `null`

     Together with the existing helper test, that covers the AC-8 decision end to end.
   - **Optional:** driving `runImplementPhase` directly.
4. **`code-bug` (validation): `docs-refs-check` fails because handoff.md:191 cites the missing fixture path in backticks.** Source: anchored.
   - **Fix:** reword that row without backticks, re-run `npm run docs-refs-check`, and record Pass.
   - **Impact:** while this ref is broken, this task's own PR tail and CI fail at the docs-refs gate.

#### Optional Cleanup / Nit

1. `runFullSendTailFixture` always passes `--full-send --force`, which these tests don't need. Dropping `--force` keeps them on the default path, as the AC-4 happy path already does. Source: anchored.
2. The unsafe-variant test could also assert the `Full-send: not pushing main; … (<reason>)` line, and the probe-error case could assert no `pr create`. Source: cold-Claude.
3. The doc's scaffold-to-base paragraph (`docs/pipeline-orchestrator.md:302` and mirror) says the hint prints "only when an unpushed safe scaffold commit is detected". It also prints today's advice when the probe fails, as Decision 3 specifies. Consider adding "or the probe fails". Source: cold-Claude.
4. The per-commit "could not inspect" fail-closed branch (`src/orchestrator/main.ts:1180-1185`) has no test. AC-6 names only the listing probe, so this is optional. Source: anchored.
5. No test runs `--full-send --allow-divergent-base` with an unsafe unpushed commit. Source: cold-Claude.

#### Spec Gaps

(none new; the round 1 advisory on protected base + `--allow-divergent-base` stands for the human)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the empty-run-log assertions in `tests/watch.test.ts:498-501` cannot fail, because the live branch returns before any log is read. AC-3 explicitly requires the "no marker" fixture variant. The assertions pin that a live pid wins in that fixture, which is the behavior being specified. Harmless and spec-required.
- Dismissed (cold-Claude): the runtime full-send hint says "stops if any other commit is unpushed" without the `--allow-divergent-base` qualifier the docs now carry. Decision 3 prescribes this exact wording, and the hint is advisory.
- Dismissed (cold-Claude): `hasUnpushedScaffoldCommits` returns true when any unpushed commit is safe. Already dismissed in round 1: Decision 3 keys the hint on safe commits being present, and the wording includes the stop clause.
- Dismissed (cold-Claude): the fake-git argv match in the probe-error test is brittle. It matches the exact command the helper issues today. If the shape changed, the test would fail loudly rather than pass falsely, so this is not an integrity problem.
- Dismissed (cold-Claude): a non-fast-forward race between fetch and push is reported as "may be protected". This is code from before this delta, and it was already dismissed in round 1: the spec prescribes the wording, and git's stderr is included.
- Dismissed (cold-Codex): none. It reported no findings.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

---

## Round 3 — verifying iteration 2's response to round 2

**Scope:** Delta — base `e650f45662ba1f6902364e087b29762613a1dcfb` — reason: small fix within the files already under review

Lens returns:
- Anchored: `STAGE_1: pass`, signal `changes_requested`.
- Cold-Claude (delta only): 5 findings, signal `approve`.
- Cold-Codex (delta only): no actionable defects.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | `classifyIdle` death plus checkpoint controls. |
| AC-2 | Met (unchanged from round 2) | `classifyAttach` death; `watchCmd` exits 4. |
| AC-3 | Met (unchanged from round 2) | Live pid wins, with and without a marker. |
| AC-4 | Met (unchanged from round 2) | Real-git happy path with SHA/subject assertions. |
| AC-5 | Met (unchanged from round 2) | Six real-git unsafe variants. |
| AC-6 | Met (unchanged from round 2) | Rejected push and listing-probe failure. |
| AC-7 | Met | A PATH git wrapper commits on local main before the real push resolves its refspec. `fakeBins` is first on the child's PATH, and `*:refs/heads/main` matches the tail's refspec. The anchored lens confirmed the test goes red when the push uses the branch name. |
| AC-8 | Met | The real-git `hasUnpushedScaffoldCommits` test covers false, true, unsafe-false and null (null via a genuinely failed listing probe). Together with the `scaffoldCommitHint` test, that covers the decision end to end. |
| AC-9 | Met (unchanged from round 2) | — |
| AC-10 | Met | The anchored lens re-ran `docs-refs-check`: "All refs OK". The handoff reports lint, type-check and the suite (1,531 pass) as Pass. The iteration changed only tests, so dist is unaffected. |

### Verifying round 2 findings

- _code-bug, weakened pre-existing tests:_
  - `--force` reverts: addressed ✓. All six tests match `main` again.
  - `src\/` restore: **still open**. The fix went to the wrong test (finding 1).
- _code-bug, AC-7 test can't fail:_ addressed ✓ (red check confirmed).
- _code-bug, AC-8 probe untested:_ addressed ✓.
- _code-bug, docs-refs-check:_ addressed ✓.

### New findings

#### Correctness Bugs

1. **`code-bug` (test integrity): the round-2 `src\/` restoration landed on the wrong assertion.** Flagged by 2 lenses: anchored and cold-Claude, and both re-ran it.
   - **The weakened assertion is still there:** in "commitHumanReviewFiles fails closed when only the task-changed diff fails (force=…)", `tests/run-task-safety.test.ts:6736` still reads `/could not compute base-drift diff|git rebase|base advanced/`. On `main` it ends `|base advanced|src\//`.
   - **Both lenses tested the fix:** with `|src\//` put back, both the force=false and force=true variants pass.
   - **A different test was edited instead:** "commitHumanReviewFiles base-drift gate dies when the base branch advanced outside Affected Files", at `tests/run-task-safety.test.ts:6805`. Its `main` assertion was `/src\/orchestrator\/main\.ts\s*$/m`, and it became `/src\//`. That is stricter, but it is an unrequested change to a test this task does not otherwise touch, and it changes what the test means.
   - **Fix:**
     - restore `|src\//` at 6736
     - revert 6805 to `main`'s form, so `git diff main -- tests/run-task-safety.test.ts` shows neither line
     - correct the Iteration 3 "Findings addressed" note, which claims the restoration was done

The remaining anchored items carry no verdict weight under round-3 discipline:
- The untested per-commit classify-failure → `null` branch.
- `runFullSendTailFixture`'s `--force`.
- The implement-entry wiring.

All three are optional or deferred from round 2.

#### Spec Gaps

(none new; the round 1 advisory on protected base + `--allow-divergent-base` stands for the human)

### Dismissed Cold Findings

- Dismissed (cold-Claude): `hasUnpushedScaffoldCommits` returns true when any unpushed commit is safe, so a mixed range gets today's `git push origin <base>` advice (`src/orchestrator/git.ts:240`, plus the request for a mixed-case test). This was dismissed in rounds 1 and 2 against the spec. Decision 3 says the hint prints "only when local `<base>` actually has unpushed canon scaffold commits", and "Otherwise the hint keeps today's push advice". The pre-change code printed that same advice unconditionally, so this is no regression. Low confidence by the lens's own tag.
- Dismissed (cold-Claude): the AC-7 test reads `checkedScaffoldTip` from `task/task-a` after the run instead of capturing it beforehand. It is correct today, since the run dies before committing to the task branch, and `notEqual(remoteTip, localMainTip)` independently proves the operator commit stayed local. That makes this a hypothetical robustness nit.
- Dismissed (cold-Claude): the wrapper does not match a `git -C <dir> push` call shape. The lens itself notes the test would then fail loudly rather than pass vacuously. No action.
- Dismissed (cold-Claude): the classify-failure `null` branch and the telemetry-subject variant are untested in the probe test. These are optional coverage nits, folded per round-3 discipline.
- Dismissed (cold-Codex): none. It reported no findings.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
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
