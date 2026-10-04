# Code Review: affected-files-fail-closed

> Reviewer: Claude | Spec: `tasks/affected-files-fail-closed/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored (STAGE_1 pass, signal approve), cold-Claude (10 findings, signal changes_requested), cold-Codex (no findings).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The one skipped test is the existing linked-worktree fixture, which skips itself when `.git` is not writable; it is not new. The anchored lens independently re-ran lint, type-check, build (`git diff --exit-code dist/` clean), docs-refs-check, and the targeted tests. All were clean.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: contract replaced | Pass | `src/orchestrator/git.ts:449-455` returns the union directly from `gitSafeAtRaw`, with stderr kept. The real-repo test covers empty success, modify, both sides of a rename, and a nonexistent base with no `files` key. The structural grep finds nothing. |
| AC-2: B follows bundle precedence | Pass | `main.ts:3262-3296`. Rule 3 uses `!isFullSendScopeCheckExempt(verdicts)`, the same predicate `findUnjudgedFullSendFilesFromData` uses (`code-review.ts:34`), so the exemption has one source. The anchored lens ran all 7 cases against main's `src`: the approved and spec_gap cases fail and the reroute cases pass, as the spec expects for red-first. The existing exemption test passes unchanged. |
| AC-3: C blocks before routing | Pass | `code-review.ts:312-319` runs before `verifyHandoffAgainstDiff`/classification. Tests run with both `full_send` values and assert exit 2, no agents, an unchanged rejection counter, no `changes_requested`, and no `## Pre-Flight Rejection`. |
| AC-4: A message correct | Pass | The fake-git switch is keyed on the exact `origin/<base>...HEAD` argv plus a new env var. The test shows the drift diff succeeded and that the new message appears with no rebase classification, and asserts no commit. |
| AC-5: D lenient | Pass | `null` renders the could-not-determine note in all three builders. The goldens are unchanged and pass. |
| AC-6: existing behavior intact | Pass | Stubs changed shape only; no assertions were weakened. |
| AC-7: build artifact | Pass | A fresh build reproduces `dist/` byte-for-byte; `dist/cli/index.js` is unchanged. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is tight and closely follows the spec. The union forces every caller to narrow. The B failure path reuses the helper's exemption predicate instead of copying the verdict list. C's block is placed correctly and tested. The new tests are well keyed. One new operator message makes a safety promise that does not hold in the exact scenario it covers, and that one finding drives the verdict.

### Findings

#### Correctness Bugs

1. **[code-bug] The spec_gap + unreadable-scope note promises a `--pr` scope check that is skipped in this scenario** (cold-Claude; foreman-verified). `src/orchestrator/main.ts:3386-3389` (reason) and `:3409-3411` (banner) say "Scope was not checked; --pr will still reject any task-changed file outside Affected Files" and "BLESS does not check scope; --pr will still reject task-changed files outside Affected Files." `--pr` catches out-of-scope files only through `verifyBaseDrift` (`src/orchestrator/validation.ts:1668-1679`). When `git fetch origin <base>` fails, it warns, returns `fetchFailed: true`, and skips the drift check. A nonexistent or mistyped `base_branch` is the main trigger for this path and the one the tests use (`no-such-base`), and it makes that fetch fail. So in the scenario the note covers, `--pr` checks nothing. An operator deciding whether to BLESS is told a later gate will catch scope when it won't. That is the "advertises a recovery that can't succeed" pattern in AGENTS.md §Code Review Rules. The spec only asked that the reason "says instead that scope could not be verified, and includes the git error"; the guarantee was added beyond the spec. **Fix:** drop the `--pr will still reject` assurance from both strings. Say instead that scope was not verified and must be checked (fix the base branch and re-run, or verify scope manually) before blessing. Update the AC-2 spec_gap assertions if they pin the old text.

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

1. **The `scopeUnverifiedReason` recovery hint is narrow and points at hand-editing status.json** (flagged by 2 lenses: anchored + cold-Claude). `src/orchestrator/phases/code-review.ts:47-55` always says "Check that the base_branch recorded in each task's status.json exists". Other failures produce the same error class: no merge base in a shallow clone, `getBaseBranch` falling back to the default when nothing is recorded, a corrupt repo. Consider "Check that the task's base branch exists and shares history with HEAD (set it with `canon task set <id> base_branch <branch>`)". That points at the helper over hand-editing, per AGENTS.md conventions. Not blocking: the git error is included, which the spec's Known Risks requires.
2. **The implement warning overclaims on resume** (cold-Claude). `src/orchestrator/phases/implement.ts:76` says "the implement prompt will apply the full check matrix", but the `isResume` branch calls `promptImplementResume(state)`, which never receives `affectedFiles`. Reword it so it doesn't depend on which prompt runs (e.g. "the full check matrix applies").
3. **Multi-line git stderr inside the SPEC GAP parenthetical** (anchored). `main.ts:3386-3389, 3409-3411`. For an unknown revision, git's stderr is three lines, including the `Use '--' to separate paths` hint. Inside `(git error: …)` that breaks the sentence. Put it on its own `Git error:` line, as `scopeUnverifiedReason` does, or use only the first line.
4. **Pre-existing missing space** (anchored). In `main.ts:3384-3385`, the older out-of-scope scopeNote ends with "…from the branch." and no trailing space, so the reason reads "…branch.Recovery options". The new branch is spaced correctly. Fix it while editing nearby.
5. **AC-3 test ordering proof is indirect** (cold-Claude). `tests/run-task-code-review.test.ts:385-410`. `makeDeps.verifyHandoffAgainstDiff` records no event, so `events == ['verifyBranch']` does not show that the classifier was skipped. The counter and no-rejection-block assertions do pin the ordering for AC-3. Recording an event in the stub override would make the ordering direct.
6. **Operator doc doesn't mention the new halts** (anchored). `docs/pipeline-orchestrator.md:349` (managed, with a `templates/` mirror) describes the code_review entry pre-flight and the full-send unjudged-file block, but not the new could-not-verify blocks or their recovery. Nothing in it contradicts the new behavior, so it isn't a stale restatement, and the spec's Docs Impact only required `docs/patterns.md`. A QA-time doc addition, optional.
7. **Sibling probe follow-up (pre-existing, not in this diff)** (cold-Claude). `src/orchestrator/main.ts:2969-2977`. `checkImplementEvidence` reads `committedDiff.stdout` from a three-dot `gitSafeAt` diff without checking `ok`. A failed probe shows up as "no committed deletions" and gives a misleading message, though in practice it fails closed. It is the same probe class as this task but out of scope. Candidate follow-up issue.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the `--pr`/`--push` task-changed probe now runs before the `--force` branch, so a three-dot failure blocks `--force` even though `--force` never uses the result (also raised by the anchored lens as needing a human decision; **flagged by 2 lenses**). This is spec-intended, on explicit evidence. Spec Non-Goals: "No `--force` bypass". Spec Decision A requires the message "This failure cannot be bypassed with --force." The existing operator contract in `docs/pipeline-orchestrator.md:99` says `--force` "does **not** bypass … diff-computation failures", and `:351` says "`--force` does not bypass diff-computation failure". Under the old code that message would be false, because the probe was skipped under `--force`. The plan recorded this as a deliberate decision and pinned it with a test. **Open question for the human** (from `notes.md`, carried here because this session is unattended): confirm that `--pr --force` with detected drift should hard-abort when only the three-dot probe fails (for example a shallow clone with no merge base). The alternative is to run the probe only on the non-force path and drop the no-bypass sentence from A's message.
- Dismissed (cold-Claude): implement fails open and spends a Codex round although the next code_review will block. This is spec-intended: Decision D says "Benign — stay lenient", and C blocks before any reviewer runs.
- Dismissed (cold-Claude): an unreadable diff with a `changes_requested`/`needs_re_review` bundle reroutes with no scope warning. This is spec-intended: Decision B rule 2 keeps the reroute unchanged because "the next review re-runs the scope check", and C then blocks with the git error.
- Dismissed (cold-Claude): `verifyHandoffAgainstDiff` still classifies `git diff failed:` as a format issue, so a failure that appears between the two calls would still misroute. Out of scope by explicit Non-Goal ("No change to `verifyHandoffAgainstDiff`'s own diff or its `git diff failed:` issue text"). The remaining window is two back-to-back git calls on the same range, which is a transient race and not the deterministic defect fixed here. The ordering invariant is documented in `docs/patterns.md`.
- Dismissed (cold-Claude): the checkAndRoute failure matrix has no case for a member with `done` and an empty verdict. Low value: an empty verdict is a non-exempt bundle and correctly falls into rule 3 ("or no recorded verdict" per spec), and its reason prints "none". The approved cases already pin rule 3.
- Cold-Codex: no findings, so nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required: Correctness Bug 1. Recommended in the same pass because they are small and touch the same lines: nits 1–4.

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

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Full — base `main` — reason: delicate

Lens returns: anchored (STAGE_1 pass, signal approve), cold-Claude (8 findings, signal changes_requested), cold-Codex (no findings; type-check clean, 1,347 tests passing).

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the iteration's handoff re-ran lint, type-check, build, docs-refs-check, and the four affected suites. It did **not** re-run the full `npm test` that Validation Required lists. The anchored lens independently ran `npm run build` (dist unchanged) and then the full `npm test`: 1348/1348 pass, 0 fail, 0 skipped. So the gap in evidence is closed by the reviewer run, not by the handoff.

| AC | Status | Notes |
|---|---|---|
| AC-1: contract replaced | Met (unchanged from round 1) | `src/orchestrator/git.ts:449-455`; the structural grep is still empty. |
| AC-2: B follows bundle precedence | Met | Precedence at `main.ts:3264-3276` is unchanged. The unreadable-scope spec_gap note no longer makes the `--pr` assurance. Tests at `tests/run-task-code-review.test.ts:442-465` assert that the assurance is absent and that a separate `Git error:` line is present. See Finding 1 for a problem with the replacement wording. |
| AC-3: C blocks before routing | Met | The `verifyHandoffAgainstDiff` stub now records `handoffDiff`, so `events == ['verifyBranch']` directly shows the classifier was skipped. |
| AC-4: A message correct | Met (unchanged from round 1) | The A path was not touched; its tests pass in the full suite. |
| AC-5: D lenient | Met | Prompt rendering is unchanged and the goldens pass. The warning at `implement.ts:76` is now accurate on resume. |
| AC-6: existing behavior intact | Met | Full suite 1348/1348 (anchored-lens run). Only assertions were added. |
| AC-7: build artifact | Met | A fresh build leaves `dist/` unchanged. |

### Verifying Round 1 findings

- _correctness bug 1:_ "spec_gap + unreadable-scope note promises a `--pr` scope check" → **addressed** (`main.ts:3386-3389`, `:3410-3413`; the claim survives only in the successful-diff branch, where it holds). The replacement wording introduces Finding 1 below.
- _nit 1:_ narrow recovery hint / `canon task set` → **addressed with a justified deviation**. The anchored lens confirmed that `taskSet` locks `base_branch` once `status.branch` is recorded (`src/task/index.ts:1509-1514`), so `canon task set` is not a valid recovery at code_review time and my Round 1 suggestion was wrong. The hint is now broader (`code-review.ts:52`).
- _nit 2:_ implement warning overclaims on resume → **addressed** (`implement.ts:76`).
- _nit 3:_ multi-line stderr in a parenthetical → **addressed** (separate `Git error:` line in both the reason and the banner).
- _nit 4:_ missing space before "Recovery options" → **addressed** (`main.ts:3385`).
- _nit 5:_ AC-3 ordering proof is indirect → **addressed**.
- _nits 6, 7:_ operator-doc addition and the pre-existing `checkImplementEvidence` probe → **deferred**, acceptable (outside Affected Files and a pre-existing follow-up). Cold-Claude's sibling sweep this round found that `checkImplementEvidence` can only refuse to advance on a failed diff (it fails closed), so it stays a follow-up.

### New findings

1. **[code-bug] The spec_gap unreadable-scope note recommends a plain `canon run`, which bypasses the SPEC GAP gate.** Flagged by 2 lenses: cold-Claude as gate-bypassing guidance, and anchored as the "Two recovery options" contradiction. Foreman-verified. `src/orchestrator/main.ts:3389` (reason): "Fix the base branch or repository history and re-run \`canon run <ids>\`, or verify scope manually before blessing." `:3413` (banner): "…and re-run, or verify scope manually before blessing." Nothing at run entry refuses a plain `canon run` on a task whose code_review is blocked with a `spec_gap` verdict. The only spec_gap-aware entry logic is the `--reroute` path in `rerouteFromHumanReview` (`main.ts:2444-2480`). A blocked code_review stays the current phase, so the re-run starts a fresh review round, and that round can overwrite the spec_gap verdict without FIX (`--reroute` after an amendment) or BLESS (`canon task accept`). The halt exists to put that decision in front of the human, and the note now advertises a third path around it. The banner prints this next to "Two recovery options:". That is the "advertises a recovery that skips the gate" pattern in AGENTS.md §Code Review Rules. **Foreman note:** the Round 1 fix suggestion ("fix the base branch and re-run") introduced this wording, so the implementer followed my guidance. The bug is still real. **Fix:** do not recommend `canon run <ids>` (without `--reroute`) in either spec_gap scope note. Suggested wording:
   - reason: `Scope was not checked. Fix the base branch or repository history before choosing a recovery option below, and verify scope manually before blessing.\n`
   - banner: `'  Fix the base branch or repository history before choosing FIX or BLESS; verify scope manually before blessing.'`

   Since `canon task set` is locked, consider naming where the base is recorded (e.g. "the base_branch recorded in the task's status.json"), so an adopter with a mistyped base knows what to repair. In the AC-2 spec_gap cases, add an assertion that the scope note does not recommend a plain re-run, for example that the reason and output do not match `` /re-run `canon run/ `` and `/and re-run, or/`. The `FIX: … --reroute` line must still match.

#### Optional Cleanup / Nit

1. **Double space before the scope note** (flagged by 2 lenses: anchored + cold-Claude). The base reason ends "…in the spec. " and both scopeNote variants start with a space (`main.ts:3384`, `:3387`), so the stored reason reads "spec.  Full-send". The files branch already had this; the new branch copies it. Drop the leading space from both variants.
2. **Rule-3 block "Then re-run `canon run <ids>`" starts a new review round** (cold-Claude). This matches existing `fullSendScopeBlockReason` behavior and the documented recovery for an unjudged-file block, and there is no human gate at an `approved` verdict to bypass. Informational.
3. **Precedence-matrix gaps** (cold-Claude). `tests/run-task-code-review.test.ts:417-421` has no `[spec_gap, changes_requested]` mixed bundle and no empty-verdict bundle. The code orders `verdicts.includes('spec_gap')` before the exempt check, so the mixed case routes to the SPEC GAP halt as the spec requires (rule 1 first). Adding the case would pin that ordering. Optional.
4. **Human Test Plan step 1 requires a hand edit** (anchored). Because `canon task set` locks `base_branch` after branch creation, "change the task's recorded base branch" means editing `status.json` by hand. The step can still be done; QA may note it in the test plan wording.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `--force` cannot bypass a failed three-dot probe whose result `--force` does not use. This was adjudicated in Round 1 as spec-intended, on explicit evidence: the spec Non-Goal "No `--force` bypass", the message Decision A requires ("cannot be bypassed with --force"), and `docs/pipeline-orchestrator.md:99,351`. The open human-confirmation question recorded in Round 1 still stands. The "no remediation step" sub-point is cosmetic: the message includes the git error and the drifted files.
- Dismissed (cold-Claude): the comment "only a bundle that would advance to QA blocks here" is inaccurate for empty verdicts. An empty or unrecognized verdict is non-exempt, and `findUnjudgedFullSendFilesFromData` treats it the same way on the success path, so such a bundle *would* advance. The spec's rule 3 explicitly includes "or no recorded verdict". The comment and the code agree.
- Dismissed (cold-Claude): verbatim multi-line stderr breaks the banner indentation. Round 1 nit 3 moved stderr onto its own `Git error:` line, which is the agreed remedy. A multi-line git error under that label is readable and keeps git's own text, so it is not worth further change.
- Dismissed (cold-Claude): no end-to-end test of `runImplementPhase` with a failed probe. AC-5 asks for "a prompt-level test", which exists for all three builders. The mapping `affected.ok ? affected.files : null` is one type-checked expression, and the union type stops a regression to reading `files` on failure.
- Cold-Codex: no findings, so nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Required: New finding 1 (a one-line message change in the reason and the banner, plus one test assertion). Recommended in the same pass: nit 1 (drop the leading space). Round 3 will be limited to correctness bugs and spec gaps.

## Round 3 — verifying iteration 3's response to round 2

**Scope:** Full — base `main` — reason: delicate

Lens returns: anchored (STAGE_1 pass, signal approve), cold-Claude (8 findings, signal approve), cold-Codex (no actionable findings; type-check and lint pass). Round 3 discipline applies: only correctness bugs and spec gaps drive the verdict. Nits and wording-only findings are folded into the notes below or left out.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the Iteration 3 handoff ran lint, type-check, build (a second fresh build was byte-identical), the full `npm test` (1,348 tests: 1,347 pass, 1 skipped, the known `.git`-write-guarded fixture), docs-refs-check, and `git diff --check`. There are no `Fail` rows. The anchored lens independently rebuilt (`dist/` unchanged) and then ran the full `npm test`: 1348/1348 pass, 0 skipped.

| AC | Status | Notes |
|---|---|---|
| AC-1: contract replaced | Met (unchanged from round 2) | `src/orchestrator/git.ts:449-455` was not touched this iteration. |
| AC-2: B follows bundle precedence | Met | Precedence is unchanged. The unreadable-scope spec_gap note (`main.ts:3386-3390`) and banner (`:3410-3414`) now stay within FIX/BLESS. Tests at `tests/run-task-code-review.test.ts:445-446,465-466` assert that no plain-rerun wording appears and that `FIX … --reroute` is kept. |
| AC-3: C blocks before routing | Met (unchanged from round 2) | `code-review.ts` was not touched. |
| AC-4: A message correct | Met (unchanged from round 2) | The A path was not touched; its safety tests pass. |
| AC-5: D lenient | Met (unchanged from round 2) | Prompts and implement code were not touched; the goldens pass. |
| AC-6: existing behavior intact | Met | Full suite is green in both the handoff run and the reviewer run. The iteration only added assertions. |
| AC-7: build artifact | Met | A fresh build leaves `dist/` unchanged. |

### Verifying Round 2 findings

- _correctness bug (new finding 1):_ "spec_gap unreadable-scope note recommends a plain `canon run`, which bypasses the SPEC GAP gate" → **addressed** (`main.ts:3389`, `:3413`: "Fix the base branch or repository history before choosing a recovery option below / before choosing FIX or BLESS; verify scope manually before blessing"). No third recovery path is offered. The anchored lens confirmed the negative test regex cannot be satisfied or defeated by the existing FIX lines, and that red-first failed on the old banner text.
- _nit 1:_ leading double space → **addressed**. The anchored lens checked all three scopeNote variants (files, error, empty) and found no double spaces or run-together words.
- _nits 2–4:_ deferred; acceptable.

### New findings

(none that drive the verdict)

Non-blocking notes, recorded for follow-up and not required:
- Anchored: the spec_gap note's "Fix the base branch" doesn't say where the base is recorded. `canon task set` locks `base_branch` once a branch exists (`src/task/index.ts:1509-1514`), so a mistyped base means hand-editing the task's `status.json`. This is message clarity only, with no gate impact. QA could note it in the Human Test Plan step 1 wording.
- Anchored: the negative regex pins only the two removed phrasings, and nothing pins the double-space fix. These are test-hardening nits.
- Cold-Claude (verified): `gitSafeAtRaw` uses `spawnSync`'s default `maxBuffer` (`git.ts:49-52`). A name-status output over about 1 MiB fails with `ENOBUFS`, and `getAffectedFiles` now blocks on it instead of silently passing as empty. Failing closed is the intended behavior (spec Decision), and the block shows the git error (`spawnSync git ENOBUFS`). The buffer limit itself predates this task: the old `getPathsInRange` path and `getTreeDriftFiles` share it. Candidate follow-up: raise `maxBuffer` for the name-status probes.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `--force` cannot bypass a failed three-dot probe whose result `--force` does not use. Adjudicated in Rounds 1 and 2 as spec-intended, on explicit evidence: the spec Non-Goal "No `--force` bypass", the message Decision A requires ("This failure cannot be bypassed with --force."), and `docs/pipeline-orchestrator.md:99,351` ("does **not** bypass … diff-computation failures"). The open human-confirmation question recorded in Round 1 still stands for the human_review gate.
- Dismissed (cold-Claude): BLESS on a spec_gap with unreadable scope advances with scope never machine-checked (fail-open recovery). This is spec-intended: Decision B rule 1 keeps "the existing SPEC GAP halt … unchanged (FIX/BLESS guidance included)". BLESS is the human's explicit acceptance, and the halt message now says plainly that scope was not checked and must be verified manually before blessing. BLESS also never re-runs the scope check on a readable diff, so that part predates this task and is not a regression.
- Dismissed (cold-Claude): a race between the pre-flight probe and `verifyHandoffAgainstDiff`'s separate diff. Dismissed in Round 1 under the explicit Non-Goal not to change `verifyHandoffAgainstDiff`. Only a transient failure between two back-to-back calls would hit it.
- Dismissed (cold-Claude): an unreadable diff with a requested-changes bundle reroutes without a scope warning. This is spec-intended (Decision B rule 2), as in Round 2.
- Dismissed (cold-Claude): implement continues after a failed probe. This is spec-intended (Decision D, "stay lenient"), as in Rounds 1 and 2.
- Dismissed (cold-Claude): the AC-3 test pairs the stub base `'main'` with `no-such-base` stderr, and its review.md check is conditional. Cosmetic fixture mismatch. The core behavior is pinned without conditions by `events == ['verifyBranch']`, the blocked status, the verdict not being `changes_requested`, and the unchanged rejection counter. No false pass.
- Dismissed (cold-Claude): the reroute cases don't assert that the next pre-flight blocks. That downstream behavior is AC-3's test, which covers it directly; chaining the two would add no coverage.
- Cold-Codex: no actionable findings, so nothing to dismiss.

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

**Open human question (carried from Round 1, not blocking):** should `--pr --force` with detected drift hard-abort when only the three-dot task-changed probe fails (for example a shallow clone with no merge base)? It is implemented as non-bypassable, per the spec's Non-Goal, Decision A, and the documented `--force` contract. The alternative is to run the probe only on the non-force path and drop the no-bypass sentence.
