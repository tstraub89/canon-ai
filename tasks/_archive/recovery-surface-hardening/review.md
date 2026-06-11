# Code Review: recovery-surface-hardening

> Reviewer: Claude | Spec: `tasks/recovery-surface-hardening/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Synthesized by the foreman from two isolated lenses: an **anchored lens** (Stage 1/Stage 2 charter against spec + Amendment + handoff + diff) and a **cold lens** (diff-only, spec-blind). The anchored lens independently re-ran type-check (clean), lint (clean), and the three target test files (`tests/task-cli.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/run-task-prompts.test.ts` — all pass), confirmed the `dist/` bundles carry the new source strings and the prompt goldens regenerated to match only the three reroute-prompt keys that changed. The anchored lens signaled **approve**; the cold lens signaled **changes_requested**, but its two lead findings are both fail-closed or unreachable-in-normal-operation hardening concerns (see Findings + Dismissed sections) rather than behavior bugs. No surviving finding is a `code-bug` or `spec-gap`.

This is a **delicate** task on the orchestrator's hot path (phase routing, `canon task accept`, reroute amendment gates) and a round-1 reroute — the spec carries an `## Amendment` adding AC-9/10/11 on top of AC-1..AC-8.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — all six required checks `Pass`. Anchored lens independently re-ran type-check, lint, and the three target test files; all green.
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, unit tests, build, sync-templates:check, docs-refs-check).
- [x] No required checks were skipped without justification.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `accept code_review`/`spec_review` on a verdictless task refuses (names task, "no review verdict exists", points at `--force`); status.json unchanged, no notes.md line | Met | Guard `src/task/index.ts:682-691` is a pure read over `ctxByTask` that throws before `git rev-parse HEAD` and the write loop. `tests/task-cli.test.ts` asserts both `code_review` and `spec_review` single-task refusal, exact message, byte-identical status.json, absent notes.md. |
| AC-2: same invocation with `--force` proceeds (sanctioned, status done, notes.md audit line) | Met | `src/task/index.ts:690-693` emits per-task warning then falls through. `tests/task-cli.test.ts` forced-`spec_review` case → `sanctioned`, advances to `plan`, notes.md audit line. Shared guarded path covers `code_review`. |
| AC-3: blocked review with `spec_gap`/`changes_requested` sanctions as in 1.11.0 | Met | `.trim()` predicate only fires on empty/whitespace; non-empty verdicts pass. New `needs_re_review` regression test + existing `spec_gap`/`changes_requested` sanction tests pass. |
| AC-4: bundle accept with ≥1 verdictless task refuses before mutating any, names exactly the offender(s); also `spec_review` | Met | `verdictlessTasks` collected over all tasks before any mutation. Bundle test asserts the error names only the verdictless task (`doesNotMatch` the sibling), both status.json byte-identical, no notes.md on either; covers `spec_review` too. |
| AC-5: mixed `spec_gap`(A)/`approved`(B) bundle reroutes after amending only A; no missing-amendment abort on B; reroute bookkeeping written | Met | Pre-flight `continue` for non-`spec_gap` siblings at `main.ts:2161-2164`. `run-task-reroute-preflight.test.ts` reroutes A(amended)/B(no amendment) → status 0, `reroute_exempt: true` + `reroute_exempt_prior_verdict: 'approved'` on B only. |
| AC-6: post-reroute, B passes spec_review/plan evidence gates without an Amendment section | Met | `checkRerouteEvidence` short-circuits `reroute_exempt === true` → `{reroute:false}` at `validation.ts:265-266`; test covers both spec_review and plan evidence-gate cases. |
| AC-7: human_review-entry reroute still requires amendment from every task | Met | Pre-flight skip gated on `isSpecGapReroute`; human_review path untouched. Existing human_review bundle test still requires all amendments and passes. |
| AC-8: a second later reroute computes a non-colliding required heading for both A (amended r1) and B (exempt r1, now gap) | Met | `run-task-reroute-preflight.test.ts` sets B previously-exempt (`reroute_exempt:true, reroute_count:1`), makes both A and B `spec_gap` in round 2, asserts the pre-flight blocks **both** demanding the exact `## Amendment Round 2` heading (A: `found ## Amendment`; B: `no ## Amendment Round 2 heading found`), status.json unchanged. Monotonic `reroute_count` increment guarantees collision-free round advance; pre-flight reads spec.md directly so a stale `reroute_exempt` cannot bypass it. |
| AC-9: failing sibling (`changes_requested` AND `needs_re_review`, both flavors) reroutes without amending; implement-reroute line names prior verdict + points at review.md + not "approved"; spec_review/plan lines also not "approved" | Met | Verdict-aware lines for all three reroute prompts (`prompts/index.ts:103-109, 161-167, 392-397`). Parametrized prompt tests assert per-line `priorVerdict` match, `review.md`, `address ALL findings`, and `doesNotMatch /approved/i`; preflight tests cover both flavors rerouting cleanly. |
| AC-10: B's amendment-evidence exemption (AC-6) holds for the failing-sibling flavor | Met | `checkRerouteEvidence` exempt short-circuit is verdict-agnostic; test asserts first-pass for an exempt sibling carrying `reroute_exempt_prior_verdict: 'changes_requested'`. |
| AC-11: approved-sibling behavior unchanged (AC-5/6/8 still pass); prior-verdict survives the reroute's verdict-clearing reset | Met | `reroute_exempt_prior_verdict` written at `main.ts:2237` before the `code_review.verdict` reset; failing-sibling test asserts the marker survives after the verdict is cleared to `''`. Approved-flavor wording preserved via the advancing-verdict path. |

### Dropped Sections Check

- [x] **Non-goals respected** — no change to bless-path semantics beyond the verdict guard, no notes.md format change, no change to the human_review reroute contract, no change to single-task spec_gap reroutes, no new CLI commands/flags (`--force` is the existing escape hatch). Full-send auto-amend left in BACKLOG.
- [x] **Known Risks addressed** — delicate routing surface guarded by AC-7 (exemption scoped to `isSpecGapReroute`); downstream gate cascade traced through `checkRerouteEvidence` per AC-6/AC-10; blocked-with-empty-verdict reviews now fail closed with a `--force`-naming message, the intended direction.
- [x] **Human Test Plan satisfiable** — the three manual steps map directly to AC-1/AC-2/AC-5 paths.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, minimal, well-targeted hardening of two independent guards on the v1.11.0 recovery surface, plus the PR #155 amendment making the exemption verdict-aware. The verdict guard is correctly positioned as a pure read pass before any state mutation (atomic single-task and bundle refusal). The `reroute_exempt` / `reroute_exempt_prior_verdict` set-clear lifecycle is sound — written by a single function (`rerouteFromHumanReview`), re-evaluated and `delete`d every round so exemptions cannot leak; AC-8 confirms a previously-exempt task that becomes a gap task is forced to amend with a non-colliding heading. The verdict-clearing reset orders the prior-verdict write before the clear, so prompt-flavor selection survives (AC-11). Test changes strengthen rather than weaken coverage. All surviving findings are low-severity hardening or nits; none block.

### Findings

#### Correctness Bugs

(none)

#### Spec Gaps

(none)

#### Risk / Guardrails

- **`risk/guardrail` — `getRerouteExemptInfo` defaults the prior verdict to `'approved'`, the least-safe default for the failing-sibling guard** (flagged by **both lenses**) — `scripts/run-task/prompts/index.ts:85-89`. When `reroute_exempt === true` but `reroute_exempt_prior_verdict` is absent or non-string, the fallback is `'approved'`, which `isAdvancingPriorVerdict` then routes to the *approved* flavor — silently dropping a failing sibling's binding `review.md` findings, the exact AC-9 failure mode the Amendment was created to prevent. **Unreachable in normal operation**: `rerouteFromHumanReview` writes both fields atomically (`main.ts:2236-2237`), and AC-11's reset-survival is met and tested. So this only bites on a corrupt/hand-edited `status.json` or a future code path that sets the exempt flag without the verdict. Because both lenses independently landed here, it is the highest-confidence observation in the review. Low severity (fail-open but unreachable today). Optional hardening: default a missing/non-string prior verdict to the **non-advancing** flavor (keep findings binding, point at review.md) rather than `'approved'`.

- **`risk/guardrail` — verdict guard `.trim()`s a value typed as `unknown`-on-disk; a non-string corrupt verdict throws a raw `TypeError` instead of the clean refusal** (cold lens) — `src/task/index.ts:683`. `!(ctx.status.phases[phaseArg]?.verdict ?? '').trim()` uses `??`, which only substitutes `null`/`undefined`; a number/boolean/object/array `verdict` reaches `.trim()` and throws. This is **fail-closed** — the throw aborts `taskAccept` before any rollback snapshot, status write, or notes write, so the core safety property (no premature sanction) holds — and is reachable only from a malformed file, since canon writes verdicts as string literals. The sibling `getVerdict`/`isVerdict` path (`main.ts`) guards this exact corrupt-on-disk class, and CLAUDE.md's "type at-risk fields `unknown` and narrow" corollary points the same way. Low severity. Optional: route through `getVerdict` or add a `typeof verdict === 'string'` narrow so the corrupt case yields the same clean message.

- **`risk/guardrail` — `checkRerouteEvidence` trusts `reroute_exempt === true` with no cross-check against `reroute_count` or gap state** (cold lens) — `scripts/run-task/validation.ts:265-266`. The short-circuit is strict `=== true`, so malformed values (`"true"`, `1`, `{}`) fall through fail-closed to the existing `reroute_count` check — good. The only fail-open path is a stale/spurious `reroute_exempt: true` letting a genuinely-rerouted task skip its fresh-round evidence gate; that path is actively prevented by the set/delete-every-round lifecycle in `rerouteFromHumanReview`. Defense-in-depth observation, not a present bug. Low severity. (Composes with the first finding: the safety of both rests on the single writer keeping the marker accurate — a typed accessor would make that contract explicit.)

#### Optional Cleanup / Nit

- **`optional cleanup/nit` — duplicated `code_review` verdict read across the two loops in `rerouteFromHumanReview`** (flagged by **both lenses**) — `scripts/run-task/main.ts:2161` (`codeReviewVerdict`, pre-flight loop) and `2216` (`currentCodeReviewVerdict`, phase-reset loop). Both are `getVerdict(readStatus(...), 'code_review')` on independently re-read status objects with no intervening write, so they agree today. Latent footgun: a future edit inserting a verdict mutation between the loops (or an external concurrent writer — out of scope per "one pipeline per worktree") would desync the two predicates. Consider one hoisted source of truth. Not a bug today.

- **`optional cleanup/nit` — `reroute_exempt` marker shape narrowed inline at three sites instead of one typed accessor** — `scripts/run-task/main.ts:2231-2234`, `scripts/run-task/validation.ts:265`, `scripts/run-task/prompts/index.ts:81-84`. The deviation (keeping the field out of `scripts/run-task/types.ts`) is documented and defensible — the spec's Affected Files did not list `types.ts`, the reads narrow at the boundary (`!== true`, `typeof === 'string'`), and the `unknown`-then-narrow read pattern matches CLAUDE.md guidance. Cost is discoverability + drift risk: the same untyped-marker shape is now declared in three places (CLAUDE.md "a cross-cutting invariant belongs in one shared helper"). Acceptable as shipped; a single typed accessor / `RerouteExemptMarker` type is a reasonable cleanup if the marker grows more call sites.

- **`optional cleanup/nit` — verdict-guard error message formatting diverges from the adjacent prior-phases guard** — `src/task/index.ts:688` uses `[${taskList}]` brackets + hyphen separator, while the prior-phases guard at `~664` uses `'${ctx.id}'` quoting. Cosmetic; no functional impact.

- **`optional cleanup/nit` — `docs/pipeline-orchestrator.md` Bundle-mode one-liner omits the failing-sibling binding-findings nuance** — the Bundle-mode line says "amend the `spec_gap` task specs" but doesn't note that `changes_requested`/`needs_re_review` siblings still carry binding prior review findings. The dedicated reroute section (and the table row) is updated correctly; this is just the less-complete summary line. Operator-facing only.

- **`optional cleanup/nit` — test-strength: approved-sibling prompt test leans on `doesNotMatch` negatives; coverage gaps in two spots** (anchored + cold) — (a) the approved-sibling test (`tests/run-task-prompts.test.ts`) asserts presence of `EXEMPT from this reroute's amendment` plus `doesNotMatch` that it's *not* directed at an Amendment heading; it would still pass if the line were empty/malformed. The paired failing-sibling tests are stronger (positive `priorVerdict` + `review.md` + `address ALL findings`), and `outputLineFor` returning `''` is caught by the paired positive `match`, so the suite as a whole is sound. (b) The round-2 spec_gap test aborts in the pre-flight (`die()` on missing `## Amendment Round 2`) before the mutation loop runs, so the `else`-branch `delete` of `reroute_exempt` for a now-gap task is correct-by-reading but not exercised by a green assertion. A follow-up test that drives a now-gap previously-exempt task through to the mutation loop (with a valid round-2 amendment) would close that gap. Not blocking.

### Dismissed Cold Findings

- **Test-integrity flag on the renamed mixed-bundle test + dropped `## Amendment` fixture for task-b** (`tests/run-task-reroute-preflight.test.ts`) — both lenses audited the rename (`reroutes whole mixed spec_gap bundle…` → `reroutes mixed spec_gap bundle when only gap task is amended`) and the fixture change. Confirmed a **strengthening, not a weakening**: every prior assertion (both tasks' `code_review.verdict === ''`, status pending, all loop counters reset to 0) is retained, and new `reroute_exempt` / `reroute_exempt_prior_verdict` assertions are added. No assertion removed. Dismissed — the change is required to genuinely exercise AC-5 (only the gap task amended).

- **`sanctioned` verdict would pass the new guard and be re-sanctioned** (cold lens) — `src/task/index.ts:683` vs the downstream sanction logic. A pre-existing `verdict: "sanctioned"` is non-empty, so it passes the new guard and the downstream path would re-stamp it. **Not introduced by this diff**: the guard is purely additive (it only *adds* a refusal for empty verdicts); `sanctioned` pass-through is identical to pre-change behavior, and the re-stamp is idempotent. No regression. Dismissed.

- **TOCTOU between the two `readStatus` calls in `rerouteFromHumanReview`** (cold lens) — retained as the duplicated-read nit above rather than a standalone finding: the only disagreement path is an external concurrent writer between the two reads, which canon's documented "one pipeline per worktree" invariant rules out.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested**
- [ ] **Needs re-review**
- [ ] **Spec gap**

> Nits (none blocking, all surface to the human at QA): (1) default a missing/non-string `reroute_exempt_prior_verdict` to the non-advancing (findings-binding) flavor instead of `'approved'` — the one finding both lenses raised; (2) route the verdict guard through `getVerdict` / a `typeof === 'string'` narrow so a corrupt non-string verdict yields the clean refusal instead of a `TypeError` (fail-closed today); (3) hoist a single `code_review` verdict read in `rerouteFromHumanReview`; (4) consolidate the `reroute_exempt` marker shape into one typed accessor if it grows more call sites; (5) minor: align the verdict-guard error formatting with the sibling guard, and complete the Bundle-mode doc one-liner; (6) optional follow-up test exercising the round-2 `else`-branch marker `delete` for a now-gap previously-exempt task. The cold lens's `changes_requested` signal was driven by findings (1) and (2), both of which are fail-closed or unreachable in normal operation — downgraded to nits after reconciliation against the spec, the marker lifecycle, and the project's `unknown`-narrow convention.
