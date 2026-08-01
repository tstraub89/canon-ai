# Spec Review: preroute-review-loop-autoblock

> Reviewer: Codex | Spec: `tasks/preroute-review-loop-autoblock/spec.md`

## Shape Check

No concerns. The spec confirms the deterministic ordering defect from the current control flow, moves the cap checkpoint to the revision-phase entry while preserving `routeBackTo()` as the continuation mechanism, and includes red-first coverage that prevents the capped revision from starting.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed checkpoint, evaluator, and reset-helper patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- **Non-blocking nit — isolate the resume-order clause before applying AC-10's phase-name assertion.** AC-10 proposes matching the persisted reason with `/\bspec\b/`, but the current reason already contains standalone `spec` tokens outside the future resume-order clause: its opening is `Spec review hit`, it later says `another spec revision`, and it includes `reset-spec-review`. Therefore the revision-entry assertion can pass even if the clause omits `spec` or incorrectly names `spec_review`. The intended mapping is otherwise clear and implementable. In the plan, give the clause a stable prefix and assert the canonical phase immediately after that prefix, extract and test that clause, or expose the derived resume phase as structured evaluator output while keeping prose assertions narrow.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — AC-21 does not restore the documented `MAX_REVIEW_LOOPS=0` behavior, and its proposed parser does not implement its own “non-integer” contract.** The amendment changes only the parse sites in `scripts/run-task/policy.ts:25` and `scripts/run-task/env.ts:136`, but the current shared evaluator still rejects zero in `scripts/run-task/review-loop.ts:7-9` (`cap >= 1`) and both loop evaluators return “no block” when that predicate fails (`review-loop.ts:105`, `:140`). Preserving `0` through config therefore still leaves all four checkpoints inert. The cited existing test in `tests/pipeline-policy.test.ts:92-97` proves only that policy returns `0`; it never exercises either evaluator or a checkpoint. Add the evaluator/checkpoint change and a red-first zero-cap assertion. Separately, parsing first and then checking `Number.isInteger(n)` accepts partial numeric strings (`Number.parseInt('1.5', 10) === 1`, likewise `2junk` → `2`), contradicting AC-21’s claim that a non-integer value falls back with a warning. Define validation over the complete raw value and test decimal/partial-numeric inputs, not only `abc`, `-1`, and `0`.
>
> 2. **Blocking — R2-2 misses a third consumer of the same stale blocked-phase signal.** `findFirstBlockedPhase()` has three current call sites, not the two named by the amendment: besides `classifyAttach` (`src/cli/commands/watch.ts:280`) and `classifyIdle` (`:330`), `orchestratorStillProgressing()` calls it at `:413`. During a live cap-raised revision with a stale heartbeat, that third call still treats the stale blocked review phase as a terminal stop, bypasses the keep-watching path, and can fall through to an idle classification while the orchestrator PID is alive. Apply the derived-current-phase rule there too and extend AC-20 with the live-PID/stale-heartbeat path; otherwise the stated contract is not integrated across `canon watch`.
>
> 3. **Blocking — AC-18’s “one-shape” write predicate also matches an active revision.** The amendment says “preceding phase is not `done`,” which includes `in_progress`. AC-20 itself defines the healthy resume state as `implement.status='in_progress'` with `code_review.status='blocked'`; forced acceptance in that state would mark the live `implement` phase `done` and advance toward QA while its agent is still running. The actual post-block shape established by original AC-3 is `pending`, not arbitrary non-`done`. Narrow AC-18 to that persisted shape (including the derived-current-phase relationship) and add an `in_progress` negative case. Also reconcile AC-19: current `taskAccept()` checks prior incomplete phases only under `!options.force` (`src/task/index.ts:686-692`), so forced review acceptance can currently occur with still-earlier phases pending; a post-write derived message will change output outside AC-18 even though AC-19 says all behavior outside that shape is unchanged.
>
> 4. **Blocking — the amendment’s added file scope is not consumable by the current Affected Files parser.** `parseAffectedFilesFromSpec()` scans amendment bodies but requests H3 tables named exactly `Affected Files` (`scripts/run-task/validation.ts:1087-1091`); the amendment uses `### Affected Files (Amendment additions)`, so a direct parse of the current spec returns none of AC-18–AC-24’s new paths. Even after correcting the heading, two rows violate `parseHandoffPathCell()`’s strict grammar: `` `.claude/skills/canon-pipeline/recovery.md` (+ `templates/` mirror) `` is malformed, and `` `tests/pipeline-policy.test.ts`, and an `env.ts`-equivalent test location `` is both malformed and non-specific. Use the exact H3 heading and list concrete files, including `templates/.claude/skills/canon-pipeline/recovery.md` and the chosen env-test file, so prompt preload and the base-drift allow-list see the amendment’s scope.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — the amendment still gives two incompatible predicates for the forced-accept write, and the narrowed AC does not fully identify the persisted loop-cap state.** R2-1's normative write rule still says the preceding phase may be any status “not `done`” (`spec.md:230`), while AC-18 requires exactly `pending` and explicitly excludes `in_progress`/`blocked` (`spec.md:258`). Those instructions produce different behavior for the live-resume state AC-18 now protects. Moreover, `pending` + blocked is not by itself “the persisted shape from original AC-3”: `taskAccept()` skips `priorIncompletePhases()` under `--force` (`src/task/index.ts:686-693`), so a forced `code_review` accept can have `plan`, `implement` both pending and `code_review` blocked. AC-18 would mark `implement` and `code_review` done, leaving `plan` current and eventually skipping implementation. Make the Decision and AC use one predicate that also proves the immediately preceding phase is the derived current phase (equivalently, every earlier phase is done), then test that earlier-incomplete counterexample.
>
> 2. **Blocking — the new “Next phase” contract is undefined for the supported bundle form.** `taskAccept(ids, ...)` holds one independent `StatusJson` per ID in `ctxByTask` (`src/task/index.ts:601-612`) and validates common worktree/base branch, but does not require the tasks to derive to the same phase (`src/task/index.ts:614-706`). The amendment nevertheless specifies one `deriveTopLevelStatus(status)` and one printed `Next phase` line for `<ids>` (`spec.md:229`, AC-18), even though forced bundle members can derive to different phases after the writes. Specify whether review accept must reject a mixed-next-phase bundle or print a per-task result, and add the corresponding mixed-state test; choosing an arbitrary member would leave the message false for the rest of the bundle.
>
> 3. **Blocking — AC-24 directly contradicts approved AC-8.** AC-8 still requires each emitted reason to contain `MAX_REVIEW_LOOPS=<n> canon run <ids> --step` (`spec.md:94`), while amendment AC-24 requires no `--step` match anywhere in either builder (`spec.md:264`). Both cannot pass. The F11 rationale also says the plain-run behavior “match[es] what AC-4 already tests,” but AC-4 explicitly invokes `--step` and asserts only the deferred revision runs (`spec.md:90`); it does not test one process carrying the raised environment through the following review. Explicitly supersede/amend AC-8's command string, and either correct the AC-4 claim or add a full-run assertion for the behavior used to justify the guidance change.
>
> 4. **Blocking — AC-21's zero-cap behavior contradicts approved AC-13's unqualified first-pass invariant.** AC-13 says each evaluator returns no block when its loop-local counters are `0` (`spec.md:99`), while amended AC-21(b) requires both evaluators to return `blocked: true` for `cap=0`, `count=0` (`spec.md:261`). The zero-cap requirement is consistent with the existing policy test and the amendment's confirmed mechanism, but the approved AC must be narrowed to positive caps (or explicitly superseded for cap `0`) so implementation and QA do not face mutually exclusive assertions.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — AC-18's mixed-next-phase bundle rejection contradicts AC-19's unchanged-write guarantee.** AC-18 requires any bundle whose post-write derived phases differ to be rejected atomically (`spec.md:259`), while AC-19 says write behavior is unchanged outside a predicate that includes “the whole bundle agreeing on next phase” (`spec.md:260`). A divergent bundle is therefore explicitly outside that predicate, yet AC-18 changes it from success to no writes. That is a reachable existing shape: `taskAccept()` loads independent statuses (`src/task/index.ts:605-613`), checks shared tree/base (`src/task/index.ts:616-705`), and then writes each accepted review entry without requiring a shared derived phase (`src/task/index.ts:748-765`). Reconcile the contract by naming mixed-next-phase rejection as a second, explicit exception to AC-19 (and preserve AC-18(d)'s atomic test), or narrow the bundle rule so both ACs specify the same behavior.
>
> 2. **Blocking — the stale review block still makes `canon watch --until <review-phase>` return immediately during the healthy resume AC-20 is meant to protect.** The amendment limits R2-2 to the three `findFirstBlockedPhase()` consumers (`spec.md:233-237`, AC-20 at `:261`), but `watchCmd()` has a separate settlement path: `isPhaseSettled()` treats every `blocked` entry as settled regardless of whether it is current (`src/cli/commands/watch.ts:97-100`), and `--until` checks that result before attach and during both polling reads (`src/cli/commands/watch.ts:531-539`, `:597-604`, `:653-660`). In fixture A's exact state—`implement` current/in progress, `code_review` stale/blocked, live PID—`canon watch <id> --until code_review` therefore exits `0 reason=until` before the resumed review runs. Apply the same derived-current distinction to blocked-phase settlement and add positive healthy-resume plus genuine-current-block `--until` assertions; otherwise the amendment fixes ordinary watch classification while leaving the flag's current-run contract incorrect in the newly introduced state.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — AC-18(b)'s “no other behavior change” is incompatible with the amendment's required derived message.** R2-1 requires every successful review accept to replace the current hardcoded message (`src/task/index.ts:813-816`) with a post-write `deriveTopLevelStatus()` result (`spec.md:229`), and AC-19 explicitly treats that output change as allowed (`spec.md:262`). In AC-18(b)'s own fixture, accepting `code_review` changes that entry to `done` while `implement` remains `in_progress`; `deriveTopLevelStatus()` returns the first non-`done` phase (`scripts/run-task/state.ts:367-372`), so the new message must say `Next phase: implement` instead of today's `qa`. AC-18(b) nevertheless requires “no other behavior change” (`spec.md:261`). Narrow that negative assertion to “no other *write* behavior change” and pin the derived message (and likewise the earlier-incomplete case's derived `plan` message if output is part of its test), so AC-18 and AC-19 do not demand opposite outcomes.
>
> 2. **Blocking — F11 removes the unsafe `--step` recovery from the builders but leaves the same command in the canonical operator documentation.** The amendment correctly explains that `MAX_REVIEW_LOOPS=<n> canon run <ids> --step` runs only the deferred revision and loses the raised cap before the following review (`spec.md:255-257`), yet AC-24 scopes the removal only to `scripts/run-task/review-loop.ts` (`spec.md:267`). `docs/pipeline-orchestrator.md:366-372` still advertises `MAX_REVIEW_LOOPS=5 canon run <id> --step` immediately before promising that the cap-raised resume returns to review, and its managed mirror repeats it at `templates/docs/pipeline-orchestrator.md:369`. That leaves two authoritative recovery surfaces contradicting the amended reason text and reproducing F11's failure. Extend AC-24 (or amend AC-15) to remove `--step` from this recovery snippet, re-sync the mirror, and verify both copies; the files are already in the spec's original Affected Files table.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — AC-20's derived-current rule still misclassifies the live revision→review transition, and fixture B locks in the wrong result for that reachable state.** Original AC-4 deliberately leaves the review phase `blocked` throughout the deferred revision (`spec.md:90`). Once that revision is marked `done`, the unchanged dispatch loop immediately derives the blocked review phase as current and calls it (`scripts/run-task/main.ts:3452-3467`); it does not normalize `blocked` before dispatch. On the code side, `runCodeReviewPhase()` then performs branch resolution, cap evaluation, affected-file/diff work, and the entire pre-flight before writing `code_review='in_progress'` (`scripts/run-task/phases/code-review.ts:233-298`). Therefore a healthy cap-raised run has a deterministic, reachable window with `implement='done'`, `code_review='blocked'` **and current**, plus a live orchestrator PID—the same status shape AC-20 fixture B declares genuinely blocked/settled (`spec.md:263`). The proposed current-phase-only check will make `classifyAttach` return `auto_block` and `--until code_review` exit `0` during that window even though the resumed review is about to run. Distinguish a terminal backstop from a live resumed dispatch (for example via liveness/grace semantics or by normalizing the stale block before pre-flight), and add a red-first fixture C for current+blocked review with a live resume; fixture B must specify the genuinely terminal conditions rather than treating phase state alone as sufficient.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking Shape Check — R2-2's runtime-dependent transition mechanism still lacks the executed confirmation required for a timing/liveness fix.** The revision now identifies the right ambiguous window and proposes a coherent status-plus-PID distinction (`spec.md:237-243`, AC-20 at `:265`), but its evidence is source inspection plus a future red-first fixture; it does not report an executed forced repro or prototype-fix spike in the amendment's Problem/mechanism. This is specifically a timing interaction between the revision's `done` write, review dispatch/pre-flight, and PID lifetime, so the deterministic-code-trace rung is not enough under the 3-role checkpoint. I forced the named fixture against the current tree (`implement='done'`, current `code_review='blocked'`, fresh heartbeat/live PID): `classifyAttach` returned `auto_block`, and `watch --until code_review` exited `0 reason=until`, confirming that an executable repro is available rather than environment-bound. Record that executed pre-fix confirmation (including trigger values/results) in the amendment, while retaining fixtures A/C as the implementer's red-first obligation. Also correct the supporting enumeration: current source has seven direct `autoBlockPhase()` call sites, not six (`spec-review.ts` wrapper; one in `spec.ts`; two each in `implement.ts` and `code-review.ts`; one in `main.ts`), although all seven do return to an immediate `process.exit(2)` path.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — AC-20's current-phase gate hides the primary terminal block state created by the approved spec.** Approved AC-3 requires a revision-entry cap block to persist `implement.status='pending'` as the derived current phase while `code_review.status='blocked'` (and the spec-loop mirror) (`spec.md:89`); `autoBlockPhase()` writes only the named review entry (`scripts/run-task/state.ts:399-416`). After the orchestrator exits, that task is genuinely auto-blocked even though the blocked review entry is not current. R2-2's proposed rule instead considers a block terminal only when the **current** phase is `blocked` and no PID is live (`spec.md:245`), while AC-20 fixture B covers only that review-current shape (`spec.md:269`). Applied to the AC-3 state, all three classifiers ignore the non-current block; `classifyAttach()` then reaches `nothing_to_watch` because no phase is `in_progress` (`src/cli/commands/watch.ts:302-317`), and `--until code_review` likewise no longer recognizes the terminal block. Preserve the live-resume correction without losing the actual revision-entry block—for example, make liveness the discriminator for any persisted block: non-current blocked + live PID is progressing (fixture A), but non-current blocked + no live PID is terminal. Add that no-live AC-3-shaped fixture, including `classifyAttach`/`classifyIdle` exit `3` behavior and `--until` settlement, alongside the current+blocked backstop fixture.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — AC-20 conflates “no resolved PID” with “no live process,” masking the watcher's existing ambiguous-PID safety state.** R2-2 makes a found block terminal when `ctx.resolvedPid == null || !probeAlive(ctx.resolvedPid)` (`spec.md:243`). In the current context resolver, however, `resolvedPid` is deliberately `null` when `.canon-pid` and the heartbeat name different PIDs and **both are alive**; that condition is preserved separately as `ambiguousPid` (`scripts/run-task/run-context.ts:99-118`). `classifyAttach()` and `classifyIdle()` currently surface that as `ambiguous_pid` (`src/cli/commands/watch.ts:285-292`, `:335-342`), and the command exits `2` rather than attaching (`watch.ts:516-523`). With the amendment's exact predicate, a status containing any blocked entry plus this two-live-PID state is classified `auto_block` before ambiguity can be reported; `--until` can likewise return `reason=until` before attach. That contradicts AC-20's liveness contract and weakens an existing refusal-to-attach guard. Specify the third liveness outcome explicitly—e.g. preserve `ambiguous_pid` ahead of block settlement, and reserve terminal-block classification for a non-ambiguous context whose resolved PID is absent/dead—and add a blocked-plus-ambiguous fixture for ordinary watch and `--until`.

## Amendment Review

- [x] **Changes requested**

> Findings:
>
> 1. **Blocking — the amendment still states two mutually exclusive block-authority contracts.** Its R2-2 summary says the defect is scanning any blocked phase rather than checking whether the current phase is blocked (`spec.md:220`), and the framing then declares in bold that the derived current phase is authoritative for “is this task blocked right now” (`spec.md:223`). The revised mechanism explicitly rejects that rule: it says phase identity is insufficient and liveness is authoritative (`spec.md:239-245`), while AC-20(D) requires a dead task with current `implement='pending'` and non-current `code_review='blocked'` to classify as terminal (`spec.md:271`). Following the summary contract fails the load-bearing D fixture; following AC-20 contradicts the amendment's stated unifying principle. Rewrite the summary/framing to state the actual split contract—derived phase is authoritative for routing/acceptance, but watcher block settlement is based on any block marker plus non-ambiguous process liveness—so the amendment is coherent rather than relying on later prose to silently supersede its opening.
>
> 2. **Blocking — R2-2 and AC-20(E) call ambiguity-first precedence unchanged, but current source has the opposite order.** The amendment says the ambiguous-PID check is already “checked first” and must retain that precedence (`spec.md:245`), and fixture E says the refusal precedence is unchanged (`spec.md:275`). In both current classifiers, however, `findFirstBlockedPhase()` returns `auto_block` first (`src/cli/commands/watch.ts:280-283`, `:330-333`), and only the following branch checks `ctx.ambiguousPid` (`watch.ts:285-292`, `:335-342`). Therefore satisfying E requires an intentional reorder and changes today's blocked-plus-ambiguous result; it cannot preserve current precedence as written. State that reorder explicitly and identify E as red-first against the actual pre-fix branch order, rather than against an unimplemented earlier amendment draft, so scope and regression evidence match the current artifact.

## Amendment Review

- [x] **Approved with nits**

> Findings:
>
> 1. **Non-blocking nit — AC-20 miscounts and mislabels its otherwise sufficient fixtures.** It says “Verify four fixtures” but enumerates five (A, D, C, B, E) (`spec.md:274-280`). It also calls D red-first “against the actual current source” (`spec.md:282`), although current `classifyAttach()` and `classifyIdle()` return `auto_block` immediately for any found block before consulting liveness (`src/cli/commands/watch.ts:280-283`, `:330-333`), which is already D's expected result. D is a contract-lock against the superseded current-phase draft, not a pre-fix failure. Rewording that label would make the implementer's red-first report precise; C and E remain genuine current-tree red-first cases, so the amendment's diagnosis checkpoint and verifiability are not blocked.
