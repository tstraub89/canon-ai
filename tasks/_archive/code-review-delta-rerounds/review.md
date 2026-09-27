# Code Review: code-review-delta-rerounds

> Reviewer: Claude | Spec: `tasks/code-review-delta-rerounds/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens re-ran the checks independently. A fresh build in a copy of the tree is byte-identical to the committed `dist/`. `npm test` passed (1245 pass, 0 fail). lint, type-check, `docs-refs-check`, and `sync-templates:check` pass.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Pure scope resolver | Pass | `resolveCodeReviewScope` in `src/lib/pipeline-policy.ts` does no I/O. Tests have one row per trigger, a delta row, a 400/401 boundary pair, and a task/telemetry exclusion row. Caveat: the resolver trusts that its inputs are complete (see F1). |
| AC-2: One round definition | Pass | The runner (`code-review.ts:320`) and `promptCodeReview` both call `resolveCodeReviewRound`. The stale-counter test asserts the archive header has round=1 with the Round 1 reason. |
| AC-3: Per-round archive written | Pass | Tests cover (a) two runs producing run-1/run-2 with distinct headers, (b) {1,2,10} producing 11, (c) pre-flight rejection writing nothing, (d) byte-equal bundle archives. A failed cold-Codex run writes nothing. |
| AC-4: Delta cold-Codex base | Pass | The runner test records the bases `['main', previousSha]` for a full round followed by a delta round. |
| AC-5: Previous-SHA lookup | Pass | Real-git tests cover normal delta, retry (lookup still uses round − 1), non-ancestor after a rewrite, prevSHA == HEAD, missing, malformed, and unresolved. |
| AC-6: All three lenses every round | Pass | The delta golden has both `subagent_type` spawns, and the runner calls cold-Codex on delta rounds. |
| AC-7: Foreman delta instructions | Partial | Diffed key by key, the full-round goldens differ only by the scope line plus the AC-8 instruction. The delta golden names scope, base, and reason. The anchored-lens instruction on delta rounds is ambiguous (F4), and the delta block has no fallback when the diff is missing (F2). |
| AC-8: Scope line in review.md | Pass | The instruction is in every golden. `.canon/templates/review.md` shows the line for Round 1 and for `## Round N`. |
| AC-9: Sibling-site sweep | Partial | The charter adds the sweep and keeps every spec-blind prohibition, and the mirror is byte-identical. The foreman template still tells the foreman to limit cold-Claude to changed files (F5). The new test assertion matches only the heading text. |
| AC-10: docs-refs ignores archives | Pass | The regex matches only `tasks/<id>/review-cold-codex-run-N.md`. The negative test shows `review.md` is still checked. The mirror is in sync. |
| AC-11: Decision and orchestrator docs | Partial | The `decisions.md` entry is present with a Supersedes line, and the stale slim-shape block is replaced. `pipeline-orchestrator.md` says the prompt "tells anchored Claude to retrieve the full task diff by command", but the rendered prompt does not say that (F4). |
| AC-12: Scope bounds | Pass | `git diff --name-status -M main...HEAD` lists none of the four protected paths. |
| AC-13: Build and full suite | Pass | Fresh build matches the committed `dist/`, and every check passes (re-run by the anchored lens). |
| AC-14: Rename-aware trigger-4 inputs | Pass | The real-git `git mv X Y` fixture forces full with a reason naming X, and the delta set is asserted as [X, Y]. The prior-change-set side uses the same helper but has no separate test. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation (one wording mismatch, see N9)

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

The three Partial rows come from the Stage 2 findings below, not from missing work. Every AC has an implementation and a test.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The structure is sound. The pure resolver, the shared round definition, the numbered archive with a strict header, the round − 1 lookup, and the rename-aware path sets all match the spec, and the real-git tests are meaningful: the rename negative control was actually run. The blocking problem is that the new scope gate **fails open when a git probe fails**. All three lenses flagged it independently, and two of them reproduced it. The large-delta case that trigger 5 exists for is exactly the case that makes the probes fail. Several smaller gaps follow the same pattern: the prompt or archive quietly carries on with missing data instead of falling back to full scope or stopping.

### Findings

#### Correctness Bugs

- **F1 — Scope resolution fails open when a delta git probe fails.** `code-bug`. Flagged by 3 lenses (cold-Codex P2, cold-Claude, anchored; the two Claude lenses each reproduced it in a temp repo). `src/orchestrator/git.ts:426-429` (`getPathsInRange`) and `src/orchestrator/git.ts:443-455` (`getDeltaLineStats`) return `[]` on any git failure. The call site is `src/orchestrator/phases/code-review.ts:341-343`. The resolver reads an empty delta path set and empty stats as "nothing outside the change set, 0 lines" and returns `delta`. Failure scenario: `gitSafeAtRaw` (`git.ts:48-52`) uses spawnSync's default 1 MiB `maxBuffer`. A fix commit that adds thousands of files, or any large delta, hits ENOBUFS on `--name-status` and `--numstat`, so both probes return `[]` and the round is scoped `delta` when triggers 4 and 5 should force `full`. The failure is asymmetric: when the prior-set query (`base...prevSHA`) fails, every delta path counts as outside and the round goes full, so that side fails closed; the delta-set and line-count queries fail open. This contradicts `docs/patterns.md` §"Write-safety guards must fail closed when the underlying probe errors" and spec Decision trigger 3/4/5 intent ("no usable…" → `full`). **Fix:** have the range helpers report failure separately from an empty result (e.g. return `null` or `{ ok, paths }`), and make the runner or resolver force `full` with a reason naming the failed probe whenever any delta fact is unknown. Add a runner test that stubs a failing `getPathsInRange` / `getDeltaLineStats` and asserts `full`. Consider giving the range probes a larger `maxBuffer`.

- **F2 — A delta round with a missing delta diff gives cold-Claude an empty diff and no fallback.** `code-bug`. Flagged by 2 lenses (cold-Claude, anchored; both reproduced it). `src/orchestrator/phases/code-review.ts:346-348`, `src/orchestrator/prompts/index.ts` (`deltaDiffContent: scopeInfo?.deltaDiff?.diff ?? ''`), `src/orchestrator/prompts/templates/code-review-foreman.md:42-51`. When `getScopedDiffInRange` returns `null`, the prompt renders an empty diff code block under "give this delta to the cold-Claude lens". The full diff has a `{{^hasDiff}}` retrieval fallback; the delta diff has none, and its retrieval pointer appears only when `deltaDiffTruncated` is set. Failure scenario (anchored lens repro): a 700 KB single-line minified file inside the prior change set shows numstat 1/1, so the round goes delta. The raw delta diff then hits ENOBUFS and returns `null`, and cold-Claude reviews nothing. The foreman may read the silent lens as a clean delta. This case is reachable even after F1 is fixed. **Fix:** add a delta-scope fallback that renders `git diff <prevSHA>..HEAD` as the retrieval command when the delta diff is null. Alternatively, treat a null delta diff as a reason to fall back to full scope, deciding before cold-Codex runs so all lenses agree on scope.

#### Risk / Guardrails

- **F3 — The archive's `reviewed_sha` is read after cold-Codex runs, and a failure to read it throws outside the phase's failure contract.** `code-bug`. Flagged by 2 lenses (cold-Claude, anchored). `src/orchestrator/phases/code-review.ts:376-377`. Scope, `equalsHead`, and the delta range are computed from HEAD before the cold-Codex run, which can take minutes, but `headSha` is resolved afterward. If HEAD moves during the run (a manual commit in the worktree or a concurrent tool), the archive records a SHA the cold lenses never reviewed. The next delta round then uses it as prevSHA, and the in-flight commit never gets a cold review. Separately, `throw new Error(...)` fires after `review-cold-codex.md` has already been overwritten, which skips the phase's `setExitReason` + `process.exit` convention and leaves the phase `in_progress`. **Fix:** resolve HEAD once before `runColdCodexReview`. If it does not resolve, stop through `setExitReason` + `process.exit(1)` before any Codex or Claude session. Reuse that SHA for the scope decision and the archive header.

- **F4 — On delta rounds the anchored lens is not clearly told to use the full diff, and the docs describe instructions the prompt does not contain.** `code-bug` (prompt accuracy; AC-7 / AC-11). Flagged by the anchored lens; confirmed in the `promptCodeReview_deltaRound` golden. On delta rounds only the delta diff is injected. The anchored bullet still says "Give it the full diff", and the only pointer to the full diff is the generic `Retrieve the task diff with git diff main...HEAD.` line. That line has no blank line before "Delta diff … give this delta to the cold-Claude lens", so markdown renders both as one paragraph. A foreman can reasonably hand the anchored lens the delta, which breaks the spec's "anchored lens unchanged" rule. `docs/pipeline-orchestrator.md` (the §Code Review Diff Injection and §Per-Iteration Prompt Slimming passages, plus the `templates/` mirror) says the prompt "tells/directs anchored Claude to retrieve the full task diff by command"; the rendered prompt does not. **Fix:** add an `{{#isDeltaScope}}` anchored-lens bullet naming `git diff <baseBranch>...HEAD` as its input ("the full task diff, not the delta above"), separate the retrieve line from the delta block, and regenerate the delta golden.

- **F5 — The foreman template still limits cold-Claude to changed files, which contradicts the new sibling-site sweep.** `code-bug` (undermines AC-9). Flagged by 2 lenses (cold-Claude, anchored). `src/orchestrator/prompts/templates/code-review-foreman.md:86` still says "If it needs to inspect files for truncated diff context, constrain it to changed files only". The updated `.claude/agents/code-review-cold.md` lets the sweep search other code files. The foreman writes cold-Claude's spawn prompt, so a foreman following the template literally suppresses the sweep. **Fix:** scope the foreman bullet to truncated-diff context and add that the sibling-site sweep may search other code files while staying spec-blind. Optionally, update the cold agent's frontmatter description ("Reviews only the diff and base ref") to match.

#### Optional Cleanup / Nit

- **N1 — Misleading full-scope reasons.** 2 lenses. When bundle members' records all exist but disagree, `prevRecord` is null and the reason reads "no cold-Codex archive record for the previous round" (`code-review.ts:326-330`). `hasMalformedColdCodexArchive` (`review-archive.ts:61-70`) scans every numbered archive from every loop, so one stale malformed file relabels every later missing-record case as "unparseable". The scope is still correctly `full`. There is no runner test for bundle disagreement or a missing member record, although the spec's Interaction Dependencies names both. These are cheap to add alongside F1's failure-probe test.
- **N2 — `--numstat` runs without `-z`** (`git.ts:445`), so paths with special characters come back C-quoted and miss the task-artifact exclusion. That over-counts, which is safe. Binary files and `-diff` files count 0 lines, which under-counts toward the threshold. A non-numeric field would make the sum `NaN`, and `NaN > 400` is false, so that case fails open; it is theoretical. `-z` parsing, or treating non-numeric fields as over-threshold, would close it.
- **N3 — The archive header reason escapes `"` but not newlines or `-->`** (`review-archive.ts:26`). A trigger-4 path containing either breaks the next round's parse, which falls back to full (safe).
- **N4 — Wasted work.** `getScopedDiff(baseBranch)` always runs and is discarded on delta rounds (`code-review.ts:387`). Delta, prior, and numstat queries run even when `prevRecord` already fails the ancestor or equals-HEAD check. `resolveCodeReviewRound` runs twice and re-reads `review.md`; passing the resolved round into `promptCodeReview` would make the AC-2 identity structural.
- **N5 — Prompt wording.** The roundN golden renders the reason "full review", which the resolver never produces. The cold-Codex intro says Codex reviewed "over the task's branch diff" right before the delta line saying otherwise. "This round is delta-scoped (delta)" is redundant.
- **N6 — Test sharpness.** The pipeline-policy row named "delicate forces full" passes `effectiveSize: 'XL'`, so it tests the XL branch plus the reason label. That matches the spec (trigger 2 is effective XL via `getEffectiveSize`), but the name overstates it. Phase tests stub `getEffectiveSize: () => 'M'`, so the runner's XL/delicate path (lookup skipped) is never exercised. The AC-9 assertion matches only `/Sibling-site sweep/`. AC-14 has no rename on the prior-change-set side.
- **N7 — `scripts/docs-refs-check.mjs` comment** (~line 486) still says "Three exempt classes" and doesn't describe the new archive class.
- **N8 — `docs/decisions.md`**: the original 2026-06 cold-Codex entry gains no forward "superseded by" pointer on its `--base <baseBranch>` clause, though the file uses inline forward pointers elsewhere. `isReviewOwnedPath` duplicates the existing pipeline-owned-path helpers (the spec allowed either sharing or duplicating).
- **N9 — Human Test Plan step 4 wording (spec, for the human).** Step 4 expects both rounds of a delicate task to record the reason "delicate". Trigger 1 is checked before trigger 2, as the spec's Decision ordering requires, so Round 1's record says "Round 1 (initial review)" and only Round 2 says "delicate". The implementation is correct. Expect that difference when running step 4.

#### Spec Gaps

(none — N9 is a test-plan wording mismatch; the Decision's trigger order is unambiguous and the code follows it)

### Dismissed Cold Findings

- Dismissed (cold-Claude): A malformed current-loop round-(N−1) archive lets the lookup fall back to an older loop's valid round-(N−1) record — the older record's SHA is either a non-ancestor (forces full) or an ancestor of the lost one, so the resulting delta is a superset of the true delta and trigger 4's prior set is smaller, which pushes toward full. The handoff's `[ambiguity]` Blocker documents the conservative handling, and the spec says archives accumulate and the round-number lookup handles loop boundaries.
- Dismissed (cold-Claude): Forced Round 1 with a stale `iterations` counter makes the next run Round 3, which looks up round 2 — AC-2 requires the prompt's round definition. The outcome is either `full` ("no archive record") or a superset delta from an older ancestor, never a narrower review.
- Dismissed (cold-Claude): A delta containing only task artifacts or telemetry returns `delta` over an empty reviewable diff — spec Decision excludes these paths from triggers 4/5 by design. With no reviewable change, a delta round loses no coverage.
- Dismissed (cold-Claude): Cold lenses can see committed `tasks/<id>/` artifacts in the delta diff — this diff did not introduce that exposure. The full-scope `main...HEAD` diff includes the same committed task files. Not a regression.
- Dismissed (cold-Claude): The singular `review-cold-codex.md` is still ref-checked by docs-refs-check — spec AC-10 says explicitly that "`review-cold-codex.md` handling is unchanged". (The stale comment is kept as N7.)
- Dismissed (cold-Claude): `codex exec review --base` receives a raw SHA where Codex expects a branch — the spec's Problem section records empirical verification on codex-cli 0.157.0 that `--base <sha>` reviews only changes since that commit.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Must fix: F1–F5. N1 and the F1 failure-probe test should go in with F1. The other nits are optional.

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

**Scope:** Full — base `main` — reason: no cold-Codex archive record for the previous round (this run used the installed canon engine, which predates delta scope)

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the handoff's `## Iteration 2 — addressing review round 1` → Re-run validation table has no `Fail`. The anchored lens re-ran every check independently. type-check, lint, `sync-templates:check`, and `docs-refs-check` pass. Full `npm test` gives 1255 pass, 0 fail, 0 skipped; the handoff's "1 skipped" is Codex's sandbox. A fresh build in a temp copy of HEAD is byte-identical to the committed `dist/`. The only uncommitted changes are task artifacts and `docs/pipeline-invocations.md`.

| AC | Status | Notes |
|---|---|---|
| AC-1: Pure scope resolver | Met | A null probe now forces `full` with a reason naming the probe (`src/lib/pipeline-policy.ts:54-56`). New rows at `tests/pipeline-policy.test.ts:36,43-45`. |
| AC-2: One round definition | Met (unchanged from round 1) | The runner and `promptCodeReview` share `resolveCodeReviewRound` (`src/orchestrator/phases/code-review.ts:326`). |
| AC-3: Per-round archive written | Met | The archive records the pinned `headSha` (`code-review.ts:386`). Nothing is archived when HEAD doesn't resolve (`tests/run-task-code-review.test.ts:1153`). Tests (a)–(d) still pass. |
| AC-4: Delta cold-Codex base | Met (unchanged from round 1) | `runColdCodexReview(scope.base, …)` at `code-review.ts:360`. |
| AC-5: Previous-SHA lookup | Met | The ancestor and equals-HEAD checks now compare against the pinned SHA (`code-review.ts:343-344`). Real-git lookup tests pass. |
| AC-6: All three lenses every round | Met | The delta golden spawns both Claude lenses, and cold-Codex runs on delta rounds. |
| AC-7: Foreman delta instructions | Met | The delta golden names scope, base, and reason. The anchored bullet names `git diff main...HEAD` explicitly (`code-review-foreman.md:80-82`). This iteration touched only the `promptCodeReview_deltaRound` golden. Compared with main, `_round1` and `_roundN` each gain exactly the scope line and the AC-8 instruction. |
| AC-8: Scope line in review.md | Met (unchanged from round 1) | The instruction is in every golden, and the template comment shows the line. |
| AC-9: Sibling-site sweep | Met | The charter carries the sweep on every round and keeps all spec-blind prohibitions; the mirror is identical. The delta foreman bullet (`code-review-foreman.md:98-100`) clarifies the sweep. Full-round wording is discussed at R2-N1. |
| AC-10: docs-refs ignores archives | Met (unchanged from round 1) | Archive regex exemption, plus a negative `review.md` case. |
| AC-11: Decision and orchestrator docs | Met | `docs/pipeline-orchestrator.md` now matches the prompt: anchored retrieves the full diff by command, and the missing-delta fallback is documented. One minor omission (R2-N5). |
| AC-12: Scope bounds | Met | `git diff --name-status -M main...HEAD` lists none of the protected paths. |
| AC-13: Build and full suite | Met | Fresh build is byte-identical, and every check passes. |
| AC-14: Rename-aware trigger-4 inputs | Met (unchanged from round 1) | The `git mv X Y` real-git fixture still forces `full`. |

### Verifying Round 1 findings

- _correctness bug:_ **F1**, delta probes fail open → **addressed**. `getPathsInRange` returns `null` on failure and `[]` on an empty success (`src/orchestrator/git.ts:426-431`). `getDeltaLineStats` returns `null` on failure or on any row with an empty path or non-finite counts (`git.ts:444-459`). The resolver forces `full` on any null probe (`pipeline-policy.ts:54-56`). `getAffectedFiles` with `?? []` behaves the same as main's `!ok || !stdout → []`, so its other caller (`phases/implement.ts:74`) is unaffected. The runner stub test (`run-task-code-review.test.ts:1094`) covers all three probes, and the real-git test (`:1124`) separates a failure from an empty range. ✓
- _correctness bug:_ **F2**, empty delta block when the diff is missing → **addressed**. The `{{^hasDeltaDiff}}` branch renders a `git diff <prevSHA>..HEAD` retrieval instruction (`code-review-foreman.md:54-56`, `prompts/index.ts:553`). The test at `run-task-prompts.test.ts:563` asserts that no empty diff block renders. ✓
- _risk/guardrail:_ **F3**, reviewed SHA read after cold-Codex → **addressed**. HEAD is pinned at `code-review.ts:317-321`, before `taskPhase(... 'in_progress')` and before any Codex or Claude session. A failure stops through `setExitReason` + `process.exit(1)`. The pinned SHA feeds the ancestry, equals-HEAD, probe, delta-diff, and archive steps. The moving-HEAD test (`:1176`) fails on the old code. ✓
- _risk/guardrail:_ **F4**, anchored lens not told to take the full diff → **addressed**. A delta-only anchored bullet names `git diff <baseBranch>...HEAD` (`code-review-foreman.md:80-82`). A blank line now separates the delta block from the generic retrieval line, and the docs match. ✓
- _risk/guardrail:_ **F5**, foreman limits cold-Claude to changed files → **addressed on delta rounds; full rounds carried as R2-N1**. Only delta rounds get the sweep clarification. The implementer followed AC-7's literal "full round keeps today's lens instructions". See R2-N1 for why this does not block.
- _nit:_ **N1**, misleading full-scope reasons → **mostly addressed**. Bundle disagreement now has its own reason (`pipeline-policy.ts:47-51`), and tests cover disagreement and a missing member. Still open, label only: `hasMalformedColdCodexArchive` scans every loop's archives (`review-archive.ts:61`).

### Stage 2 — New findings

No code-bugs survive. What's left are optional nits and one spec tension, which I'm treating as a non-blocking follow-up.

#### Optional Cleanup / Nit

- **R2-N1: full-round foreman wording versus the every-round sweep (flagged by 2 lenses: anchored low, cold-Claude medium).** On full rounds, which include every Round 1 and every XL or delicate round, `code-review-foreman.md:97` still says "If it needs to inspect files for truncated diff context, constrain it to changed files only". The delta-only sweep bullet (`:98-100`) does not render there. **Why this doesn't block:** the bullet is limited to *truncated-diff context*. The cold agent's own charter, which is its system prompt, now draws the same line: "If the visible diff is truncated … inspect changed files … The sibling-site sweep may search other code files". Its description names the sweep as well, so the two instructions agree when read as written. In practice the cold lens swept outside the changed files in both rounds of this review. Closing it fully means adding the sweep bullet to full rounds, which changes full-round lens instructions and needs AC-7's "only the scope line added" relaxed. That is a spec-owner call, a one-line follow-up, not an implementation defect.
- **R2-N2: the pinned HEAD isn't used everywhere (anchored, cold-Claude).** On full rounds `getScopedDiff(baseBranch)` (`code-review.ts:393`) reads the live `...HEAD`. Cold-Codex reviews the live tree. The prompt's retrieval commands say `..HEAD`, while the injected delta diff is pinned to `headSha`. If HEAD moves during the cold run, which requires an operator commit outside the pipeline, the lenses see slightly different trees. The next delta starts from the archived (pinned) SHA and so covers anything that landed mid-run. Optional: `getScopedDiffInRange(\`${baseBranch}...${headSha}\`)`.
- **R2-N3: harden the pure resolver for delicate (cold-Codex P2, also raised by cold-Claude; see Dismissed for why it isn't reachable).** `effectiveSize === 'XL' || facts.delicate` at `pipeline-policy.ts:45` would make the pure function safe for any caller. The runner derives `delicate` with `=== true` (`code-review.ts:328`), while `anyDelicate` uses `?? false` truthiness. For a non-boolean `delicate` value, the reason would read "XL task size" instead of "delicate", which affects the label only.
- **R2-N4: prompt edge wording.** When `hasDeltaDiff` is false, `:81` ("not the delta above") and `:91` ("Give it the delta diff above") refer to a block that doesn't render. The retrieval line comes first, so the foreman can cope. A successful but empty delta diff (for example, a commit followed by its revert) renders an empty diff block that looks like the F2 symptom. Round 1 N5 wording ("over the task's branch diff", "delta-scoped (delta)", roundN reason "full review") is still open.
- **R2-N5: docs and test sharpness.** `docs/pipeline-orchestrator.md:417` and its mirror leave out the previous change-set probe from the failed-probe list and don't mention the new stop when HEAD doesn't resolve. The unresolved-HEAD test (`run-task-code-review.test.ts:1153`) doesn't assert that `code_review.status` stayed out of `in_progress`. No test covers the non-finite or empty-path numstat rejection. The scope-follows-round test resets `iterations` by hand instead of letting it progress. The Round 1 N6 gaps are still open: no XL or delicate runner test, the AC-9 agent assertion matches only a heading, and there's no rename on the prior-change-set side.
- **R2-N6: Round 1 nits still open, all optional.** N2 (numstat without `-z`; binary files count 0 lines), N3 (reason header doesn't escape newlines or `-->`; a failure forces full), N4 (`resolveCodeReviewRound` computed twice), N7 (the `scripts/docs-refs-check.mjs:486` comment still says "Three exempt classes"), N8 (no forward "superseded by" pointer in `docs/decisions.md`). Also: `canProbe === false` passes `[]` rather than `null` for the probe facts, so correctness relies on the resolver checking `prevRecord` first, which the current order and tests guarantee.
- **R2-N7: a merge from the base branch between rounds (cold-Claude).** If the task branch merges `main` between rounds and main's changes touch only prior-change-set files within 400 lines, the two-dot delta includes main's work, and the cold lenses may attribute it to the task. The result is extra review noise, never missed coverage. Canon's flow rebases rather than merging base into task branches mid-review, and a rebase makes prevSHA a non-ancestor, which forces full.

#### Spec Gaps

(none blocking — R2-N1 records the AC-7 vs. AC-9 wording tension as an optional follow-up for the spec owner)

### Dismissed Cold Findings

- Dismissed (cold-Codex): "Force full review for delicate tasks: `resolveCodeReviewScope` allows delta for a delicate non-XL task" (`pipeline-policy.ts:45`). Cold-Claude raised the same concern. Spec evidence: Decision trigger 2 reads "The effective task size is XL (nominal XL or `delicate: true`, via `getEffectiveSize`)", and AC-1 has the resolver take "effective size" as the input. Code evidence: the runner passes `deps.getEffectiveSize(tasks)` → `src/orchestrator/policy.ts:60-61` → `getPipelinePolicy(...).effectiveSize` → `getEffectiveSize` (`src/lib/pipeline-policy.ts:185-187`), which returns `'XL'` whenever `anyDelicate` is true. `PolicyConfig` carries no size or delicate override, and no env var in `src/` changes it. A delicate task therefore never reaches a delta round through the real runner. The pure-function hardening is kept as R2-N3.
- Dismissed (cold-Claude): The singular `review-cold-codex.md` (and `review-prior-N.md` / `spec-review-prior-N.md`) is still ref-checked. AC-10 says explicitly that "`review-cold-codex.md` handling is unchanged". The `*-prior-N.md` gap existed before this diff. The stale comment is R2-N6 (N7).
- Dismissed (cold-Claude): Stale-counter round drift makes the next lookup miss. Same as Round 1: AC-2 mandates the prompt's round definition, and the outcome is always `full`, never a narrower review.
- Dismissed (cold-Claude): A delta made only of review-owned paths returns `delta`. Same as Round 1: the spec's Decision excludes these paths from triggers 4/5 on purpose, and when nothing reviewable changed, no coverage is lost.
- Dismissed (cold-Claude): A raw SHA passed to `codex exec review --base` may be rejected. The spec's Problem section records empirical verification on codex-cli 0.157.0.
- Dismissed (cold-Claude): Archives keyed by round survive reroute/reset. This is a spec Non-Goal ("archives accumulate across loops; the round-number lookup handles loop boundaries"), and an older SHA only widens the delta or forces full.
- Dismissed (cold-Claude): The new template scope line breaks `isPristineTaskArtifact` for tasks scaffolded before the upgrade. `isPristineTaskArtifact` (`src/task/templates.ts:63-79`) exact-matches the current template, so every earlier `review.md` template edit had the same effect. AC-8 requires this template change. The worst case is an untouched scaffold archived as `review-prior-N.md` during the upgrade window.
- Dismissed (cold-Claude): `scopeReason` rendered unescaped with an implementer-controlled filename. This adds no new injection surface: the same filenames and the full diff content are already injected verbatim into the same prompt.
- Dismissed (cold-Claude): Scan-then-write archive numbering races under concurrent runs. The spec's Decision specifies "a monotonic max+1 scan like `review-prior-N.md`", the same allocator pattern already in use, and concurrent `code_review` runs on the same task are not a supported mode.
- Dismissed (cold-Claude): The "review scope follows prompt round" test resets `iterations` by hand, which compromises its integrity. The test does exercise the forced-Round-1 case AC-2 names (archive round=1 with `iterations > 0`). The missing progression and threshold tests are coverage gaps, kept as R2-N5, not a test that asserts the wrong thing.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

F1–F4 are fixed, each with a test that fails on the old code. F5 is fixed on delta rounds, and the full-round residual is a spec-level wording follow-up (R2-N1). All remaining items are optional.
