# Code Review: claude-provider-mode

> Reviewer: Claude | Spec: `tasks/claude-provider-mode/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

A foreman synthesized this review from three lenses: an anchored Claude lens (Stage 1 / Stage 2 charter), a cold-Claude lens that read only the diff and base ref, and the cold-Codex lens the orchestrator ran beforehand. This is the first code_review round after implement reroute 1 (the Amendment, AC-16 to AC-19). The previous loop is archived in `tasks/claude-provider-mode/review-prior-1.md` and ended Approved with nits.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (build, type-check, lint, full `npm test`, sync-templates:check, docs-refs-check; E2E N/A per spec)
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (no mandatory red-first AC; the handoff records voluntary pre-fix evidence for AC-16 and AC-17 against `96c7f75`)

The anchored lens re-ran every check itself:

- `npm run build` exited 0 and left `dist/` clean.
- `type-check`, `lint`, `sync-templates:check` and `docs-refs-check` pass.
- `npm test`: 1849 pass, 0 fail.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Provider policy | Pass | `src/lib/pipeline-policy.ts` has no `process.env`; `CANON_PROVIDER` appears only in `src/orchestrator/policy.ts`. Policy rows pass. |
| AC-2: Task pin | Pass | Unchanged since the prior loop; task-cli and completion tests pass. |
| AC-3: Routing reads the pin once per run | Pass | Required-parameter grep empty; type-check and fake-agent routing tests pass. |
| AC-4: Mixed-provider bundles refused | Pass | Bundle refusal tests pass. |
| AC-5: Backend-tagged sessions | Pass | No direct `sessions` writes outside `state.ts`; tag table and clears covered. |
| AC-6: Implement resumes after Claude park | Pass | Unchanged in the reroute; park/resume tests pass. |
| AC-7: spec_review resumes without false preamble | Pass | The park-resume and changes-requested re-review tests named by the AC pass. A recovery path the AC does not test is broken; see Finding 1. |
| AC-8: Claude config for spec_review/implement | Pass | Matrix and precedence rows pass. |
| AC-9: Recovery paths under Claude | Pass | Dry-run, retry and fix-up tests pass. |
| AC-10: Code review skips cold lens in Claude mode | Pass (as amended) | Cold dependency never called; stale `review-cold-codex.md` removed (`src/orchestrator/phases/code-review.ts:466`). The record filename is superseded by AC-16. |
| AC-11: Two-lens foreman prompt | Pass | Golden values unchanged by the reroute; Claude round-1 and round-2 entries present. |
| AC-12: Role-holder text | Pass | Unchanged in the reroute; prompt tests pass. |
| AC-13: Dependency checks follow provider | Pass | cli and agent-backend dependency tests pass. |
| AC-14: Mixed mode unchanged | Pass | Full suite passes; argv parity values untouched. |
| AC-15: Decisions and docs | Pass (as amended) | Provider, session and budget docs present; both doc checks pass. |
| AC-16: Neutral Claude round record | Pass | `code-review.ts:464-469` writes `review-round-N.md` via the neutral writer. The test asserts no `review-cold-codex-run-*`, no `review-cold-codex.md`, and no Codex text in the body. |
| AC-17: Two-family round lookup | Pass | The "round lookup across record families" tests cover mixed→Claude, Claude→mixed, conflicting SHAs (full scope), agreeing SHAs and a malformed neutral record. Claude→Claude delta is covered by the phase test. |
| AC-18: Mixed mode unchanged | Pass | Exact mixed archive bytes pinned; Claude→mixed writes run-N plus `review-cold-codex.md`; no golden or expected-value edits in the reroute diff. |
| AC-19: Docs describe both families | Pass | `docs/pipeline-orchestrator.md:482` (and mirror) and `docs/decisions.md:585` name `review-round-N.md` and the two-family lookup. A repo grep finds no doc saying Claude mode writes `review-cold-codex-run-N.md`. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The Amendment is small and clean. The neutral writer shares the existing header format, the two-family lookup is a few lines in `review-archive.ts`, the new conflict fact gets its own reason string, and mixed-mode bytes and reason strings are pinned unchanged. Mutation checks in the handoff show the new tests discriminate.

One correctness bug survives, in code from the previous loop that this Full-scope round re-examined. On a Claude task, `canon task reset-spec-review` leads to a resumed reviewer session with no "spec has been revised" preamble.

### Findings

#### Correctness Bugs

1. **`code-bug`: after `canon task reset-spec-review`, a Claude-provider spec_review resumes the old reviewer session without the "spec has been revised" preamble.**
   - Flagged by: cold-Claude. Foreman verified against the code.
   - Where: `src/orchestrator/phases/spec-review.ts:103`, `isReReview = resumeId !== null && (state.provider !== 'claude' || specReviewCheck.count > 0)`.
   - How it happens: `taskResetSpecReview` (`src/task/index.ts:1116-1119`) zeroes `iterations` and `iterations_current_loop` but clears only the `author` session pair. The `spec_reviewer` session and its `claude` tag survive. On the next run, `resumeId` is non-null and `count` is 0, so a Claude task resumes the old reviewer session with the plain first-pass prompt, wrapped by `toResumePrompt` with the "[Resumed session …]" banner. Mixed mode sends the preamble on the same path.
   - Why it is wrong: spec Decision §7 (`spec.md:32`) says the preamble is shown "when a previous review round requested changes". `reset-spec-review` is the documented recovery after a spec_review loop-cap block (`docs/pipeline-orchestrator.md:125`, `:448`), and a loop-cap block means earlier rounds did request changes. `iterations_current_loop > 0` is a proxy for that predicate, and the reset destroys the proxy. The reviewer is then nudged to continue from session memory on a spec the human has just edited, which is the stale-replay failure the preamble exists to prevent. AGENTS.md §"Code Review Rules" asks each new gate to be traced through the `reset-*` recovery paths, and this one fails that trace.
   - Fix (implementer's choice; both are small):
     - (a) Base the Claude predicate on a counter that survives the reset. `spec_review.changes_requested_total > 0` is the closest to §7's wording and is preserved by the reset. Keep `count > 0` or OR it in so the AC-7 tests still hold.
     - (b) Clear the `spec_reviewer` session pair in `reset-spec-review` as well, so the post-reset pass is fresh. This changes mixed-mode behavior: AC-14 freezes mixed behavior, and Codex currently resumes with the preamble there. Only take (b) if it is gated to Claude-tagged sessions, or if the reviewer judges the mixed change acceptable. (a) is preferred because it leaves mixed untouched.
   - Test: on a Claude task with a stored `claude`-tagged `spec_reviewer` session and `changes_requested_total ≥ 1`, run `reset-spec-review` and then `canon run`. Assert the prompt sent to `claude` contains "has been revised since your last review". Keep AC-7's first-pass park test, where `changes_requested_total` is 0 and no preamble is sent.

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Cross-family conflicts after a reroute plus a provider switch** (`src/orchestrator/review-archive.ts:80-89`).
  - Flagged by: anchored (raised as a spec-gap, medium) and cold-Claude (consistency gap, low). 2 lenses.
  - What happens: header round numbers restart at 1 after a reroute; this task's own `review-cold-codex-run-3.md` has `round=1` after run-2's `round=2`. The lookup takes the newest match per family, so a stale earlier-loop record in the other family can conflict with the current loop's record. Example: loop 1 mixed, then a reroute plus a switch to `claude`. Round 2 of the new loop sees cold r1=A against neutral r1=C and falls back to full scope with the "round records for the previous round disagree" reason, and later rounds repeat this up to the old loop's last round.
  - Why it is a nit, not a spec gap: the implementation follows the Amendment's rule exactly ("different SHAs → unusable → full scope"). The fallback is the safe direction, and the cost appears only for non-delicate, non-XL tasks that are rerouted *and* switch provider. The Known Risk's "equal numbers are harmless" refers to file numbers and is still accurate.
  - Not for this implement round: changing it would contradict the spec's rule. If the human wants delta scope preserved there, a follow-up amendment could prefer the record whose SHA descends from the other (`isAncestorCommit`) or tag records with the loop.
- `src/lib/pipeline-policy.ts:53-54`: in Claude mode a missing or malformed `review-round-N.md` still produces "no cold-Codex archive record…" and "unparseable cold-Codex archive record…" reasons. These reach the record header, the Scope line and the foreman prompt, which sits awkwardly with the Amendment's lens-neutral intent. Flagged by anchored and cold-Claude (2 lenses). Previously accepted as deliberate mixed-text preservation (plan note 4; `review-prior-1.md` round 1). A provider-aware reason would keep mixed bytes intact. Follow-up candidate.
- `src/orchestrator/review-archive.ts:80,92`: `findColdCodexArchiveForRound` / `hasMalformedColdCodexArchive` (and the deps keys and `ColdCodexArchiveHeader` type) now read both families under cold-Codex names. The JSDoc notes this (plan note 8). Neutral aliases are a possible follow-up (anchored).
- `src/orchestrator/phases/code-review.ts:404-405`: `hasConflictingRoundRecords` re-reads and re-parses both families right after `findColdCodexArchiveForRound` did. A single call returning `{ record, conflict }` would remove the duplicate I/O and the small window where the two reads could differ (anchored).
- `src/orchestrator/review-archive.ts:95`: the malformed check now also flags `review-round-*.md` files on a mixed-only task. This is spec-intended ("The malformed-record check covers both families"). It only relabels a full-scope reason when such a file exists (anchored, low).
- `src/orchestrator/phases/implement.ts:1,3` and `src/orchestrator/phases/spec.ts:1,4`: two separate imports from `'../policy.js'`; merge them (cold-Claude).
- `src/orchestrator/policy.ts` (`resolveBundleProvider`): the "Cannot run a mixed-provider bundle" error could name the recovery (`canon task set <id> provider <mixed|claude>`). `src/task/index.ts` hard-codes `['mixed', 'claude']` rather than deriving it from the policy's provider list (cold-Claude; the second half is carried from the prior loop).
- `src/orchestrator/prompts/index.ts:362`: the park-resume prompt pastes the raw escalation reason, which ends with the operator instruction to re-run `canon run`, and that contradicts the headless "don't run `canon run`" rule (cold-Claude). Carried from the prior loop, still optional.
- Other optional nits from `review-prior-1.md` round 2 are unchanged and still optional.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the Claude implementer and spec_reviewer run with `--dangerously-skip-permissions` and `--add-dir REPO_ROOT`, with no write sandbox and no commit detection. This is a spec Non-Goal ("Claude sandboxing or agent-commit detection"), accepted under Known Risks "No write sandbox for a Claude implementer". Prior loops dismissed it the same way.
- Dismissed (cold-Claude): `isParkResume` fires on any blocked implement with a stored session, including a manual block or a park whose error had no session id. The spec accepts this predicate under Known Risks "Park-resume entry condition". A park with no new id stores nothing, and the no-diff auto-block clears the slot. Dismissed in both prior rounds.
- Dismissed (cold-Claude): stale adopter-facing Codex wording in `.canon/templates/review.md`, `handoff.md`, `spec.md` and `spec-review.md`, the `.claude/agents/code-review-*.md` "three-lens" descriptions, and `src/orchestrator/cli.ts` help text. The Non-Goals defer the vendor-wording sweep of `.canon/templates/*` artifact templates and CLI help to the follow-up wording task.
- Dismissed (cold-Claude): `CANON_PROVIDER` affects `task new`, `doctor` and `init` but not `canon run`, which reads the task pin. This is spec-intended (Decision §11: doctor checks the setting, not existing task pins; runs read the pin).
- Dismissed (cold-Claude): the unattended completion sentence reaches the docs-refs fix-up session, whose own text forbids `canon` commands. The fix-up prompt overrides the "instructions above", and the sentence sits above that override. Verified and dismissed in the prior loop.
- Dismissed (cold-Claude): `canon task set … provider` during a live run can be overwritten by the running orchestrator. Spec §3 defines next-run semantics, and the unlocked read-modify-write applies to every existing `canon task set` field.
- Cold-Codex reported no actionable regressions, so there is nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Address Finding 1 (`code-bug`) with a regression test. The nits are optional. The cross-family stale-record nit is spec-driven and should not be changed in this round.

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

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Full — base `main` — reason: delicate

This round synthesizes three lenses: the anchored Claude lens, the cold-Claude lens (diff and base ref only), and cold-Codex. Cold-Codex found no actionable regressions.

### Stage 1 — Acceptance Criteria Re-Check

**Validation gate: pass.**

- The baseline and Iteration 2 Validation Outcomes tables in `handoff.md` have no `Fail` rows. E2E is N/A per the spec.
- The anchored lens re-ran every check itself:
  - `npm run build` exited 0 and left `dist/` clean.
  - type-check, lint, `sync-templates:check` and `docs-refs-check` pass.
  - `npm test`: 1851 pass, 0 fail.
- Red-first evidence was read across the whole handoff. No AC is a mandatory red-first regression. Iteration 2 records voluntary pre-fix evidence for F1 against `af30163`: the Claude reset case lacked the preamble, and the mixed control passed.
- The iteration delta `af30163..HEAD` is exactly `src/orchestrator/phases/spec-review.ts`, `dist/orchestrator/run-task.js`, `tests/run-task-safety.test.ts` and `tests/recovery-hints.test.ts`, which matches the Iteration 2 Changes table.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | Policy untouched by iteration 1. |
| AC-2 | Met (unchanged from round 1) | Task CLI and completion untouched. |
| AC-3 | Met (unchanged from round 1) | Routing untouched; type-check passes. |
| AC-4 | Met (unchanged from round 1) | Bundle refusal untouched. |
| AC-5 | Met (unchanged from round 1) | `state.ts` untouched. |
| AC-6 | Met (unchanged from round 1) | Implement park/resume untouched. |
| AC-7 | Met for its named cases; see Finding 1 | `spec-review.ts:106-108` ORs `changes_requested_total > 0` with the loop count. First-pass park (`tests/run-task-safety.test.ts:11247`) still gets no preamble, the ordinary re-review (`:11433`) still gets it, and the new reset regression (`:11437-11482`) gets it after a loop-cap reset. |
| AC-8 | Met (unchanged from round 1) | Policy cells untouched. |
| AC-9 | Met (unchanged from round 1) | Recovery paths untouched. |
| AC-10 | Met as amended (unchanged from round 1) | `code-review.ts` untouched. |
| AC-11 | Met (unchanged from round 1) | Goldens unchanged. |
| AC-12 | Met (unchanged from round 1) | Prompt delivery untouched. |
| AC-13 | Met (unchanged from round 1) | Dependency checks untouched. |
| AC-14 | Met | The mixed predicate short-circuits on `state.provider !== 'claude'`. The mixed reset control passes. |
| AC-15 | Met (unchanged from round 1) | Docs untouched. |
| AC-16 | Met (unchanged from round 1) | Neutral writer untouched. |
| AC-17 | Met (unchanged from round 1) | Two-family lookup untouched. |
| AC-18 | Met (unchanged from round 1) | No mixed expected values edited. |
| AC-19 | Met (unchanged from round 1) | Docs untouched. |

### Verifying Round 1 findings

- _correctness bug F1:_ "after `reset-spec-review`, a Claude spec_review resumes without the revised-spec preamble" → **partially addressed.**
  - The loop-cap reset shape is fixed and tested. The new test drives the real `reset-spec-review` dispatcher and asserts the preamble for both providers.
  - The same failure remains on the other reset shape the command supports (Finding 1 below).
  - The recommended option (a) in round 1 was this review's, and it was incomplete. The fix below replaces it.
- _nits:_ optional, unchanged, not re-raised.

### Stage 2 — New findings

#### Correctness Bugs

1. **`code-bug`: the round-1 fix does not cover `reset-spec-review` after a spec-gate halt. Its predicate also adds a false preamble after a reroute.**
   - Flagged by: anchored (two findings, both rooted in `src/orchestrator/phases/spec-review.ts:106-108`). Foreman verified against the code.
   - **(a) Gate-halt reset still replays.**
     - The spec gate halts only after spec_review approves. `taskResetSpecReview` explicitly supports a reset after that halt: `src/task/index.ts:1120-1122` re-arms the gate for exactly that case.
     - A spec approved in its first round has `changes_requested_total === 0` and a stored, `claude`-tagged `spec_reviewer` session.
     - The human edits the spec at the gate and runs `reset-spec-review`. The next Claude run resumes the reviewer session that already approved the old spec, with no preamble and with the `[Resumed session …]` banner. That is the stale-replay failure round 1 described. Mixed sends the preamble on this path.
   - **(b) False preamble after a reroute.**
     - A full-tier reroute zeroes `iterations_current_loop` and clears the `spec_reviewer` pair, but keeps `changes_requested_total` (`src/orchestrator/main.ts` reroute reset, ~3061-3095).
     - On a Claude task with any changes-requested round in an earlier loop, the amendment's first spec_review that parks and is resumed is now told "the spec has been revised since your last review". That session never finished a review.
     - This is a regression from iteration 1: before it, `count === 0` sent no preamble here. Harm is small, because the preamble only asks for a fresh re-read, but it is the false preamble Decision §7 (`spec.md:32`) exists to avoid.
   - **Fix: one change covers both.**
     - In `taskResetSpecReview`, also clear the `spec_reviewer` session pair when its stored backend is `claude`. Use `storedSessionBackend` / `clearSessionPair` from `state.ts`, or route through the same helper.
     - Leave a mixed (Codex) reviewer session untouched, so AC-14 holds and mixed keeps resuming with the preamble.
     - Revert the predicate at `spec-review.ts:106-108` to the loop-count check only (`specReviewCheck.count > 0`), and remove the comment and its recovery-hints registration.
     - After a reset, the Claude reviewer then starts fresh (no session, no preamble needed) whether the reset followed a loop-cap block or a gate halt. A post-reroute park-resume goes back to no preamble.
     - Update the `reset-spec-review` row in `docs/pipeline-orchestrator.md` (`:125`) and its mirror to say that a Claude-held reviewer session is also dropped.
   - **Tests.**
     - Claude reset after a first-round approval (`changes_requested_total: 0`, stored `claude` reviewer session): the next run has no `--resume`.
     - Claude reset after a loop-cap block: no `--resume`.
     - Mixed reset: the Codex session is kept and the preamble is sent (the existing control).
     - Claude first-pass park after a reroute with `changes_requested_total > 0`: no preamble.
     - Keep AC-7's existing park and re-review tests.

#### Optional Cleanup / Nit

- `src/orchestrator/review-archive.ts:83`: cross-family records from an earlier loop that reuse a round number conflict permanently, falling back to full scope. When the SHAs agree, `neutral ?? cold` prefers the neutral record even if the cold archive is newer. The anchored and cold-Claude lenses raised this in round 1 and cold-Claude raises it again now. The implementation follows the Amendment's rule; it stays a spec-driven follow-up, not for this round.
- `.canon/templates/status.json:27,36`: a new Claude-provider task's `phases.spec_review.agent` and `phases.implement.agent` read `codex` until the phase runs and `recordPhaseAgent` overwrites them. `canon task set … provider` also leaves them unchanged. Only the display is affected; routing reads the assignment (cold-Claude).
- `src/orchestrator/main.ts:3521-3523`: under `claude`, the guardrail-retry text says "the orchestrator owns commits" for every role, where mixed Claude phases were told "commit if needed". The lens rated this low/low and found no Claude phase that depends on committing during a retry (cold-Claude).
- `src/orchestrator/policy.ts` (`resolveTaskProvider`): `"provider": null` is refused as invalid rather than treated as absent. That is consistent with "absent means mixed, other values refused", but treating `null` as absent would be friendlier (cold-Claude).
- Carried from round 1, still optional: the fragile `.replace`-built Claude startup and park header (`src/orchestrator/prompts/helpers.ts:29`, `prompts/index.ts:368`), and the raw escalation reason in the park-resume prompt. Cold-Claude now also notes that this reason can come from an earlier loop's escalation.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the Claude implementer and spec_reviewer run with `--dangerously-skip-permissions` and `--add-dir REPO_ROOT`. They can write outside the worktree, commit, or edit `spec.md`, and the startup's sandbox sentence is replaced. This is the spec Non-Goal "Claude sandboxing or agent-commit detection", accepted under Known Risks "No write sandbox for a Claude implementer". Prior rounds dismissed it the same way.
- Dismissed (cold-Claude): the revision no-diff check misfires if a Claude implementer commits its own edits. This follows from the same accepted Non-Goal (no agent-commit detection), and the Known Risk names the clean-tree consequence.
- Dismissed (cold-Claude): a park after budget exhaustion stores the session, so the next run resumes it under the same budget and can exhaust it again. Decision §7 / AC-6 require implement to resume the parked session. Each invocation gets a fresh `--max-budget-usd`. The park message tells the operator to fix the budget cause, and `CLAUDE_BUDGET` raises it. Live budget exhaustion is a Human Test Plan item.
- Dismissed (cold-Claude): `isParkResume` fires for any blocked implement with a stored Claude session. The spec accepts this predicate under Known Risks "Park-resume entry condition", and it was dismissed in every prior round. The stale-escalation wording part is carried as a nit above.
- Dismissed (cold-Claude): `doctor` and `init` check `CANON_PROVIDER` while `canon run` reads task pins. This is spec-intended (Decision §11). The lens notes that the docs say so.
- Dismissed (cold-Claude): the lens charters (`.claude/agents/code-review-*.md` "three-lens"), the skills (`canon-pipeline`, `canon-spec`, `canon-status`) and other managed restatements still describe the fixed Codex role split. The Non-Goals defer the vendor-wording sweep of skills, templates and help to the follow-up wording task.
- Dismissed (cold-Claude): the Claude implementer and spec_reviewer lack the other `CODEX_HEADLESS` rules (`[ambiguity]` Blocker, scope cap). Round 1's F2 told the implementer not to duplicate the overlapping headless guidance and to add only the completion rule. The implement and spec-review templates carry their own scope and Blockers rules.
- Dismissed (cold-Claude): the suite is sensitive to an exported `CANON_PROVIDER`. The handoff and the anchored lens ran the full suite with `CANON_PROVIDER=claude` exported and it passed, and spawned-process tests scrub the variable (AC-14).
- Cold-Codex reported no actionable regressions, so there is nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Address Finding 1 with the session-clear fix and the four tests. The nits are optional.
