# Spec Review: reroute-from-implement

> Reviewer: Codex | Spec: `tasks/reroute-from-implement/spec.md`

## Shape Check

no concerns

The deterministic rejection mechanism is confirmed by the current admission gate, route-back reset, implement-entry loop-cap check, and phase derivation. Direct probes of the loop-cap and review route-back states both derived `implement`, hit the current phase-gate error, and left status bytes unchanged. AC-1 requires red-first coverage of those states. The prompt changes account for unfinished work when admitting partial implementation rounds.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

Traced both proposed predicate call sites, reroute amendment pre-flight and bundle exemption, reset counters and routing, prompt selection, concurrent-run guard, and operator text surfaces. The existing reset already supports the proposed implement-entry states; the spec pins that behavior without expanding the evidence-advance or recovery contracts it explicitly excludes.

Targeted verification against the current code:

- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='rerouteFromHumanReview (admits|rejects|accepts and normalizes)' tests/run-task-reroute-preflight.test.ts` — 15 passed.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='review-loop evaluators|review-loop recovery reasons|retains the capped-loop' tests/run-task-code-review.test.ts` — 3 passed.
- Temporary subprocess probes exercised the current reroute gate with implement pending / code review blocked / empty verdict, and implement pending / code review pending / one current-loop review iteration. Both were rejected before status mutation, confirming the stated base behavior.
- `npm run lint` and `npm run docs-refs-check` — passed.

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

none

### Type Safety / Interface Gaps

none

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

No findings. Partial-round agent execution remains untested at spec review; the implementation phase must supply the new admission/reset tests and regenerated prompt evidence. The explicitly accepted stale-handoff evidence-advance risk remains outside this task.

## Amendment Review

- [x] **Changes requested**

### Findings

1. **[P2] Keep the red-first escape conditional on the spec's named alternative — tasks/reroute-from-implement/spec.md:192 (AC-A3).** For an unfinished original regression-test AC with aborted-round edits in the worktree, this requirement allows the agent to record that testing committed HEAD is impractical without requiring the spec's environment-bound escape or a named deterministic alternative. That weakens the existing checkpoint: difficulty isolating edits is not evidence that the bug mechanism is environment-bound, and an explanation alone does not confirm the premise. Require a safe isolated pre-fix run, or the explicit spec-authorized escape and its named alternative; otherwise require a Blocker and preserve the prohibition on implementing an unconfirmed fix. Preserve earlier-round evidence when it already satisfies the AC. This follows the checkpoint in this phase's instructions and the current implement-reroute prompt's final paragraph.

2. **[P2] Require red-first evidence for the newly added legacy-counter fix — tasks/reroute-from-implement/spec.md:195 (AC-A6).** With implement pending, code_review pending, legacy `iterations: 1`, and no current-loop field, the current predicate returns false while `getIterations()` returns 1. The amendment requires the corrected admit-row test but never requires running it before the fix or recording the observed rejection. The original AC-1 red-first requirement covers the loop-cap and current-field route-back rows, not this new legacy fixture; AC-A9 therefore does not supply the missing checkpoint. State the confirmed deterministic mechanism in the amendment's Problem and explicitly make the legacy fixture red-first, recording rejection before the amendment fix and admission afterward. This is a new bug-fix requirement, not a reconsideration of the approved admission rule.

3. **[P2] Limit the new reroute recovery advice to admitted implementation states — tasks/reroute-from-implement/spec.md:191 (AC-A2).** The targeted recovery section covers both spec_review and code_review loop-cap blocks, and the targeted docs paragraph likewise presents both reset commands. Adding amend-and-`--reroute` as a shared third path would advertise a command that rejects the spec-review cases: the normal spec-review cap leaves current phase spec, and a direct review block leaves spec_review; neither is admitted. This conflicts with the approved Non-Goal retaining those exclusions. Require the new path to be explicitly conditional on implementation having begun, and retain normal spec revision/resume or reset-spec-review guidance for the earlier states. Verify both outcomes when reading the revised recovery text.

### Shape and integration

The amendment otherwise stays within the task's routing, prompt, recovery-text, and test scope. It preserves the parsed Reroute Plan headings and declares the newly edited recovery-file mirror and both dist outputs. AC-A1 explicitly supersedes the earlier Known Risks statement; the implementation should also read its tracked/untracked distinction as correcting the same overstatement in the original Non-Goals and Interaction Dependencies.

The blocking shape concern is the missing red-first requirement for AC-A6. AC-A3 must preserve the existing confirmation contract, and AC-A2 needs the recovery predicate above. No prior approved finding is reopened.

### Verification

- Read the amendment and prior spec review, required project guidance, relevant decisions and lessons, and the current predicate, phase derivation, iteration reader, reroute gate, prompt templates, auto-commit helper, and recovery surfaces. Did not read handoff.md, review.md, or done.md.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='isRerouteAdmitted' tests/run-task-reroute-preflight.test.ts` — 26 passed.
- Direct read-only predicate probes: the AC-A6 legacy fixture derives implement and is rejected; a spec-review cap fixture at spec entry derives spec and is rejected; a spec_review-blocked fixture derives spec_review and is rejected.
- `npm run docs-refs-check` — passed after appending this review and the phase note.
- These checks establish the current amendment premises; they do not constitute implementation or validation of the requested fixes.

## Amendment Review

- [x] **Approved**

No findings.

### Shape Check

The amendment is implementable and its acceptance criteria are verifiable. AC-A6 states a deterministic rejection mechanism with concrete trigger values and explicitly requires a failing pre-fix admission test, a passing post-fix run, and recorded evidence. Re-reading the predicate and iteration reader and executing the fixture confirms that the current implementation ignores the positive legacy count. No runtime-dependent mechanism needs additional confirmation.

### Integration and feasibility

The amendment keeps the original admission boundaries, bundle behavior, and reroute evidence headings, with an explicit compatibility extension for legacy review counters. Its recovery guidance distinguishes code-review blocks from the excluded spec/spec-review states. The partial-round checkpoint retains satisfied prior evidence, requires an isolated pre-fix run for unfinished red-first work, and preserves the spec-authorized alternative and unconfirmed-premise block. The tracked/untracked correction explicitly supersedes the older overstatements without changing auto-commit behavior.

The affected-file union covers the prompt and operator-text changes, test assertions, recovery mirror, golden entries, and both generated dist artifacts. The golden restriction is compatible with the named reroute prompt changes; non-reroute prompts need no change. The amendment remains within the approved task's scope.

### Verification and remaining risk

- Re-read the current spec and cumulative spec review, inspected the working tree, and reopened the relevant predicate, iteration reader, reroute gate/banner, prompt templates/builders, admission tests, auto-commit checks, QA-end check, and recovery text. No implementation handoff, code-review artifact, or QA summary was read.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='isRerouteAdmitted' tests/run-task-reroute-preflight.test.ts` — 26 passed in this review session.
- Current-code probes confirmed that the legacy-only fixture derives implement and is rejected, and that spec and spec_review block fixtures remain rejected.
- `npm run docs-refs-check` — passed after appending this fresh review and the phase note.

The amended behavior has not been implemented or exercised by this review. Safe preservation/restoration of interrupted edits, the new legacy admission test, and regenerated prompt evidence remain implementation-phase validation obligations.

## Amendment Review Round 2

- [x] **Changes requested**

### Findings

1. **[P2] Give shared-branch bundles a recovery that passes downstream gates — tasks/reroute-from-implement/spec.md:233 (AC-B1; also AC-B3 and line 229).** For the stated mixed-verdict route-back case, let A change only `src/task-a.ts` and B change only `src/task-b.ts` on their shared task branch. `canon run B --reroute` passes admission, but it still reviews the entire branch diff against the original base. With B alone, `verifyHandoffAgainstDiffFromData()` rejects A's file as missing from the supplied handoffs; even if B's rewritten handoff lists it, the Affected Files gate rejects it because only B's spec contributes scope. Resuming A separately has the symmetric problem. `ensureBranch()` creates one shared worktree/branch for a bundle; the recovery does not split its history. Direct probes returned missing coverage and out-of-scope `src/task-a.ts` for B alone, and no issues for the full A+B set. Replace the unconditional split-run advice with a sequence that retains the original branch owners through review, or restrict it to cases where separate runs really have independent scope and provide a shared-branch recovery. Verify the proposed sequence through the downstream gates with distinct A/B source files, rather than only matching the printed command. This does not require reversing the chosen admission predicate or introducing the declined marker.

2. **[P2] Add the diagnosis and red-first checkpoint for the archived-findings fix — tasks/reroute-from-implement/spec.md:236 (AC-B4).** This fixes an existing guardrail-contract bug, but the amendment neither states its confirmed mechanism/evidence nor requires a pre-fix failing run for the new prompt tests. The current non-exempt branches of `promptImplementReroute()` and `promptPlan()` omit the archive pointer; `priorReviewReference()` is reached only for an exempt failing sibling. A temporary non-exempt round-2 fixture with `review-prior-2.md` confirmed that archive lookup finds the file while neither rendered prompt names it. State that deterministic mechanism and confirmation in the amendment's problem description, and explicitly require the with-archive assertions to fail for that omission before the fix, pass afterward, and be recorded in Red-First Evidence. Keep the no-archive assertions as the negative case. Earlier admission-test evidence under AC-1/AC-A6 does not cover this new fix. This is a blocking Shape Check concern under the phase's three-role checkpoint.

### Integration and feasibility

The decision to preserve per-task admission and counter semantics remains coherent. The blocker is the newly prescribed recovery sequence, not that settled decision. The archive lookup helper already supports numeric newest-archive selection, and the declared files cover prompt plumbing, tests, mirrors, and generated outputs. The remaining wording, set-aside, and assertion changes fit the approved scope.

[ambiguity] AC-B6's grep does not name a search scope. I interpreted its single-source requirement as production code_review counting (including `buildPipelineState()`), while preserving the generic `phaseIterationCount()` contract and test-fixture builders. A literal repository-wide grep also matches those unrelated fallbacks; scope the verification to the intended production consumers.

### Verification and remaining risk

- Re-read the current spec, cumulative spec review, required project guidance, relevant decisions/lessons, and current admission, counter, bundle-reset, shared-worktree, downstream-gate, prompt-builder, archive-lookup, and recovery surfaces. Did not read or audit the task's handoff.md, review.md, or done.md.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='isRerouteAdmitted|legacy iterations|reroute implement-entry bundle' tests/run-task-reroute-preflight.test.ts` — 34 passed.
- Read-only helper probes reproduced the B-only handoff/scope failures and the passing full-bundle comparison. A temporary prompt fixture reproduced both missing non-exempt archive pointers. These establish current mechanisms; they do not validate a revised recovery sequence or implement AC-B4.
- `npm run lint`, `npm run docs-refs-check`, and the changed-artifact whitespace check passed.
- Full agent execution and safe restoration of interrupted files remain implementation-phase obligations.

## Amendment Review Round 2

- [x] **Approved**

No findings.

### Shape Check

The revised amendment defines an implementable bundle admission extension. A pending sibling needs a named task that independently passes the existing single-task predicate and shares its non-empty recorded branch. Matching branches cannot bootstrap admission when no task independently qualifies. The reset, amendment pre-flight, and spec_gap exemption contracts remain applicable to the full named bundle.

The deterministic archive-pointer diagnosis is confirmed by the current prompt branches and a fresh rendered fixture: numeric lookup selects `review-prior-10.md` over `review-prior-2.md`, while neither non-exempt prompt names that archive. AC-B4 now requires failing pre-fix assertions for both builders, passing post-fix assertions, recorded evidence, and the no-archive negative case. That meets the bug-fix checkpoint; no runtime-dependent mechanism is alleged.

### Integration and feasibility

Reopened `ensureBranch()`, review-counter updates, route-back, the reroute admission/pre-flight/reset sequence, and downstream scope checks. Bundle bootstrap records the same task branch for every member, and approval followed by bundle route-back leaves the approved member pending with zero counters. The new clause uses that existing branch identity without changing counters or schema. A fresh helper probe with distinct A/B source files passes both handoff coverage and Affected Files checks when both owners remain named.

The affected-file union covers admission, messages, prompt plumbing, helper consolidation, tests, mirrors, and both distribution outputs. The narrower single-task predicate remains suitable for the single-task gate and spec-gate note; its shared-branch exception belongs in bundle admission. AC-B6 now scopes its single-source check explicitly and preserves the generic phase-counting contract.

[ambiguity] Read AC-B1 as superseding the original blanket zero-counter bundle exclusion only for its new shared-branch case; the original AC-2(a) rejection fixture uses different task branches and remains a rejection. Read AC-B3 together with the original full-rule wording requirements (Decision 4, AC-6/7/11): existing exclusive admission-rule statements in help, README, the spec-gate note, and docs must distinguish the single-task rule from the new bundle exception. Those files are already in the affected-file union; the single-task predicate need not change.

### Verification and remaining risk

- Re-read the entire current spec and cumulative spec review, inspected the working tree, and reopened the current symbols and surfaces supporting the amendment. Did not read or audit the task's handoff.md, review.md, or done.md.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='isRerouteAdmitted|legacy iterations|reroute implement-entry bundle' tests/run-task-reroute-preflight.test.ts` — 34 passed in this review session.
- A temporary shared-branch fixture confirmed that A derives implement and fails single-task admission, B derives implement and passes it, and the current bundle gate rejects before changing either status file. Direct downstream checks passed with the combined A+B scope. A separate rendered-fixture check confirmed the current missing archive pointers described above.
- `npm run lint`, `npm run docs-refs-check`, and the changed-artifact whitespace check passed.
- The new admission clause, its reset/negative matrix, archive-pointer red-first tests, and safe set-aside/restoration guidance remain implementation-phase obligations. This review did not execute agent phases or implement the amendment.
