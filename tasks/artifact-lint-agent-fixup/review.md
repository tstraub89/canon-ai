# Code Review: artifact-lint-agent-fixup

> Reviewer: Claude | Spec: `tasks/artifact-lint-agent-fixup/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored = `STAGE_1: pass` / `approve` (re-ran build, lint, type-check, full suite 1532 pass / 0 fail, docs-refs-check, sync-templates:check); cold-Claude = 13 findings / `changes_requested`; cold-Codex = 1 finding (P2, ignored files), full test run interrupted before completion.

> Foreman note: this task's earlier review history (3 changes_requested rounds, then a budget-exhaustion escalation) is archived in `tasks/artifact-lint-agent-fixup/review-prior-1.md`; the orchestrator scoped this as a fresh Round 1.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results (Iteration 3's full-suite row is `Fail – unrelated`, citing a ship-test clone failure outside Affected Files; Iteration 4 did not re-run the full suite, but the anchored lens re-ran it green: 1532 pass, 0 fail)
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: implement fix-up succeeds (red-first) | Pass | Test asserts one resume with the stored session id, the fixed handoff and source blob committed, and `code_review`. The red-first run was reproduced by a prior-round reviewer, and the AC-3 no-session case (same fixture dies `Auto-commit failed:`) corroborates it. |
| AC-2: bounded fallback | Pass | 2 resumes, warning naming the finding, `Auto-commit failed:`, implement `done`, counters 0, HEAD unchanged. |
| AC-3: no fix-up when nothing is wrong | Pass | Unrelated hook failure, no session, review.md-only finding, and checker absent (through `main()`) each make 0 resumes. The `docs/`-file variant shares the review.md filter path. |
| AC-4: review-entry retry | Pass | Happy path plus a non-zero resume that falls back and still commits. |
| AC-5: scope guard | Pass (tested shapes) | Dirty source edit, status.json edit, and QA non-artifact edit each stop with the path named. A committed edit escapes; see Finding 1. |
| AC-6: failed fix session never parks | Pass | Codex non-zero leaves implement `done`; Claude exit 7 at QA reaches `human_review` with done.md committed. |
| AC-7: QA fix-up | Pass | Fixed (committed blob asserted, red-first recorded), never-fixed (2 attempts), and no-session cases covered. |
| AC-8: prompt guidance | Pass | `ARTIFACT_CITATION_RULE` is in all 4 templates and pinned; `promptArtifactFixup_implement` / `_qa` golden keys say not to run `canon task phase`. |
| AC-9: restatements updated | Pass | Pipeline-orchestrator auto-commit and Session Resumption sections are updated and mirrored, and decisions.md is updated. The wording overstates the guard; see Finding 2. |
| AC-10: build and checks | Pass | A fresh build leaves `dist/` unchanged, and all checks pass when re-run by the anchored lens. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The fix-up loop is well-shaped. It makes one shared `fixUpOwnArtifactRefs` path for implement and QA, uses the same 2-attempt bound and the same exempt set, and catches `AgentSessionError` locally. The tests are thorough. One real gap remains in the scope guard, the safety stop the spec calls non-negotiable (spec §Decision 3). The snapshot fingerprints only paths that `git status` reports, plus status.json. It never records `HEAD`, so a fix session that edits a clean tracked file and commits it leaves no trace. The docs then promise more than the guard delivers. Both fixes are small.

### Findings

#### Correctness Bugs

1. **[code-bug] Scope guard misses changes the fix session commits.** Flagged by 2 lenses (anchored, cold-Claude). Location: `src/orchestrator/main.ts:395-427` (`snapshotOutsideArtifacts`). The snapshot is keyed only on porcelain entries plus each status.json. Suppose a resumed agent edits a *clean* tracked file and runs `git commit`. The porcelain output is clean before and after, so `diffScopeSnapshots` returns `[]`, and the auto-commit lands on top of the out-of-scope commit. Spec §Decision 3 says: "If anything outside the agent's own artifacts differs after the session, the run stops." The QA fix-up prompt also lacks the "Do not run git add or git commit" line, which only the implement branch adds (`src/orchestrator/prompts/index.ts:65`).
   - **Fix:** record `git rev-parse HEAD` in the snapshot, under a reserved key, so the guard diff includes it. A HEAD move is then a stop that names the change. If cheap, also record the index state (e.g. `git write-tree`), so that a staged-then-reverted change is visible too.
   - Emit the no-commit sentence for both phases, and regenerate the `promptArtifactFixup_qa` golden.
   - Add one test: a fake fix session that commits an edit to a clean source file stops the run, and nothing further is committed.

#### Risk / Guardrails

2. **[code-bug, docs accuracy] The scope-guard restatement overstates what is guarded.** Flagged by 3 lenses (cold-Codex P2, cold-Claude, anchored), all about ignored files. Locations: `docs/pipeline-orchestrator.md:335` and its `templates/docs/` mirror, which say "any outside change stops the run before commit". Gitignored paths are not seen, because the snapshot uses `git status --porcelain=v1 -uall` without `--ignored`. Neither are writes outside the active checkout.
   - **Adjudication:** I am *not* requiring ignored files to be hashed. Spec §Decision 3 gives the snapshot scope as "`git diff` / hashes of dirty paths plus untracked files", which is explicit spec evidence that ignored paths were not in scope. Hashing `node_modules`/build output on every attempt would also be expensive.
   - **Required instead:** reword the doc sentence, in both the root and the mirror, to state what is compared: tracked and untracked (non-ignored) files in the active checkout, plus each bundle member's `status.json`, plus `HEAD` once Finding 1 lands.

#### Optional Cleanup / Nit

- `src/orchestrator/prompts/templates/implement.md:60-61`: the citation rule has no blank line before "Append to tasks/<id>/notes.md…", so the two render as one paragraph. Flagged by cold-Claude.
- `src/orchestrator/prompts/templates/implement-revisions.md:41`: two bold lead-ins are stacked ("**Referencing deleted…**: **Citing files in task artifacts:** …"). Flagged by 2 lenses.
- `src/orchestrator/main.ts:479-482`: on a failed fix session, the warning prints the *pre-session* findings as "remaining findings" without re-checking, so they may be stale. Flagged by cold-Claude.
- `src/orchestrator/main.ts:473-474`: the `return;` after `die(...)` is unreachable. Flagged by anchored.
- The QA scope-stop message says "re-run canon run <ids>". On re-run the task is at `human_review`, so `commitQaArtifacts` never runs again, and the QA artifacts are committed only by the `--pr` allow-list sweep. Consider phase-specific recovery text for QA (e.g. point at `--pr`). Flagged by cold-Claude.
- `docs/architecture.md:87` (step 10, QA) does not mention the QA-end check and fix-up, although step 8 got the implement mention. The spec's Docs Impact leaves architecture.md for QA, so this is optional here. Flagged by 2 lenses.
- `src/orchestrator/validation.ts` `runDocsRefsCheck` has no `timeout`, mirroring the `--pr` gate. The new call sites raise the exposure (up to 3 runs per commit point). Flagged by cold-Claude.
- Test coverage: QA fix-up tests all run without a task worktree, so a regression of the QA cwd back to REPO_ROOT would go uncaught. The `runDocsRefsCheck` `error` branch, and its warn-and-skip path, have no test. Flagged by anchored and cold-Claude.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): QA `runSession` always returns `true`, ignoring Claude's exit code, so a failing session burns the second attempt. On a non-zero exit, `runClaude` throws `AgentSessionError({ kind: 'exit_code' })` (`src/orchestrator/agents/claude.ts:199-202`). `fixUpOwnArtifactRefs` catches it, `ok` stays `false`, and the loop warns and returns after one attempt, so `return true` is reached only on success.
- Dismissed (cold-Claude): the `CLAUDE_HEADLESS` preamble's "record ambiguities in notes.md" could trip the guard. The fix-up prompt explicitly overrides it ("Do not change any other file — including notes.md, status.json…", `src/orchestrator/prompts/index.ts:63`). If the agent disobeys, the run stops, which is the intended safety outcome.
- Dismissed (cold-Claude): the implement fix-up may resume an older `sessions.codex` after an interactive round. Spec §Decision 1 specifies resuming "a stored Codex implement session (`sessions.codex`)", and the Non-Goals accept a non-original session because the scope guard still applies.
- Dismissed (cold-Claude, also raised by anchored): `lastClaudeSessionId` may not be the session that wrote done.md, for example after recovery or a resume fallback. Spec §Decision 2 conditions the fix-up on "this process knows the QA Claude session id", and the Non-Goals accept a fresh-session fallback under the scope guard.
- Dismissed (cold-Claude): sha256-hashing every dirty/untracked file is slow in large trees. The cost is bounded to dirty, non-ignored paths, twice per attempt for at most 2 attempts. That is negligible next to an agent turn, and no concrete failure was shown.
- Dismissed (cold-Claude): `.heartbeat.json.tmp` is not exempt. Heartbeat writes are synchronous on the orchestrator thread, so the temp file cannot exist at snapshot time; the scenario needs a hypothetical future change.
- Dismissed (cold-Claude): the scope-guard test matrix misses notes.md and staged-only shapes. notes.md uses the same tracked-file path the dirty-source and status.json tests exercise; the meaningful untested shape (an agent commit) is folded into Finding 1's required test.
- Dismissed (anchored, risk): the scope-guard stop is not sticky across a re-run. Spec §Decision 3 requires that "the run stops" and that canon "commits nothing", both of which hold. The die message tells the operator to review and revert before re-running. Persisting a block would add state the spec did not ask for.
- Dismissed (anchored, risk): only `AgentSessionError` is caught, so config/`readStatus` throws propagate. Spec §Decision 1 scopes local catching to "an agent error from that session". The other throws are configuration faults that would equally break the main implement call.
- Dismissed (anchored): the validation helper tests live in run-task-safety rather than run-task-validation. That file is outside Affected Files; the plan recorded the choice in notes.md.
- Dismissed (anchored): `node` from PATH and the symlink entry-guard no-op are pre-existing behavior shared with the `--pr` gate, which the spec's Non-Goals leave unchanged; the earlier handoff already deferred them.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required for the next iteration: Finding 1 (snapshot `HEAD`, emit the no-commit line for QA too, regenerate the golden, add the agent-commits test) and Finding 2 (reword the scope-guard sentence in `docs/pipeline-orchestrator.md` and sync the mirror). Then rebuild `dist/`. The nits are optional.

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

**Scope:** Delta — base `c63dbfd8704849477f99922c0db5aa8ff1714126` — reason: small fix within the files already under review

Lens returns:
- **Anchored:** `STAGE_1: pass` / `approve`. It re-ran build (`dist/` unchanged), lint, type-check, full suite (1532 pass / 0 fail), sync-templates:check and docs-refs-check. It also did a mutation check: with the `[git HEAD]` snapshot line removed, the new committed-edit test fails.
- **Cold-Claude:** 9 low/medium findings / `changes_requested`.
- **Cold-Codex:** 1 finding (P2, key collision).

> Handoff note: the response to this review is the second `## Iteration 2 — addressing review round 1` section (the earlier Iteration 2–4 sections belong to the archived cycle in `review-prior-1.md`).

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: implement fix-up succeeds | Met (unchanged from round 1) | The happy-path test passes in the full suite. |
| AC-2: bounded fallback | Met (unchanged from round 1) | The 2-attempt fallback is unchanged. |
| AC-3: no fix-up when nothing is wrong | Met (unchanged from round 1) | Each zero-resume case still passes. |
| AC-4: review-entry retry | Met (unchanged from round 1) | The retry is unchanged. |
| AC-5: scope guard | Met | `src/orchestrator/main.ts:400-401,412` snapshots `HEAD`. The new committed-edit case at `tests/run-task-safety.test.ts:7687-7706` stops the run and names `[git HEAD]`; the anchored lens's mutation run proves it depends on the HEAD entry. |
| AC-6: failed fix session never parks | Met (unchanged from round 1) | Unchanged. |
| AC-7: QA fix-up | Met (unchanged from round 1) | Unchanged. |
| AC-8: prompt guidance | Met | `src/orchestrator/prompts/index.ts:65` emits the no-commit line for both phases, and the `promptArtifactFixup_qa` golden was regenerated. |
| AC-9: restatements updated | Met | `docs/pipeline-orchestrator.md:335` and its mirror now list the guard's real inputs (changed tracked paths, non-ignored untracked paths, each `status.json`, `HEAD`). |
| AC-10: build and checks | Met | All checks were re-run green by the anchored lens. |

### Verifying Round 1 findings

- _code-bug:_ The scope guard missed changes the fix session committed. **Addressed** at `src/orchestrator/main.ts:400-401,412` and `src/orchestrator/prompts/index.ts:65`, with a test at `tests/run-task-safety.test.ts:7687`. AC-5 is now Met. ✓
- _code-bug (docs accuracy):_ The scope-guard sentence overstated what is guarded. **Addressed** in `docs/pipeline-orchestrator.md:335` and `templates/docs/pipeline-orchestrator.md`. ✓

### New findings (only NEW issues introduced by Iteration 1's changes)

Optional nits only; none is blocking.

- **[nit] The `[git HEAD]` sentinel key shares the namespace with repository paths.** Location: `src/orchestrator/main.ts:412`. Flagged by 3 lenses (cold-Codex P2, cold-Claude, anchored).
  - **Verified:** the entry is set before the path loop, so a pre-existing dirty or untracked root file literally named `[git HEAD]` would overwrite it.
  - **Why this is a nit rather than a code-bug:** it holds against the code, but the trigger needs that exact filename to already exist before the fix session. If the agent creates such a file during the session, pre holds the SHA and post holds a file fingerprint, so the guard still stops. The severity is negligible.
  - **Cheap fix:** set the HEAD entry after the loop, or use a key no repo-relative path can be, e.g. a leading `\0`.
- **[nit] The stop message is misleading when HEAD moved.** Location: `src/orchestrator/main.ts:495-498`. Flagged by 2 lenses (cold-Claude, anchored).
  - When `[git HEAD]` is among the changes, the fix session made a commit itself. "Nothing was committed. Review and revert those changes" then reads as a working-tree-only revert, and lists `[git HEAD]` as if it were a file.
  - The out-of-scope commit stays visible on the task branch and would surface in the next code review's diff, so it is not silent. Still, a HEAD-specific line ("the fix session moved HEAD; undo its commit") would make the recovery advice accurate.
- **[nit] The guard records the HEAD SHA only, not the symbolic ref.** Location: `src/orchestrator/main.ts:400`. Flagged by cold-Claude. A fix session that switches branches, or detaches HEAD, at the same commit passes the guard, and the orchestrator's later commit lands off the task branch. This needs the agent to disobey the prompt, which already forbids git writes. Recording `git symbolic-ref -q HEAD` alongside the SHA would close it.
- **[nit] The new commit test covers only the implement flow.** Location: `tests/run-task-safety.test.ts:7687`. Flagged by cold-Claude. QA runs through the same `fixUpOwnArtifactRefs` and `snapshotOutsideArtifacts` code, so the gap is low risk.
- **[nit] The unit assertion at `tests/run-task-safety.test.ts:55` adds no independent coverage.** Flagged by cold-Claude. `diffScopeSnapshots` treats every key the same, so the integration case is what proves the guard.
- **[nit] Handoff accuracy.** Flagged by anchored. The latest handoff iteration lists `dist/cli/index.js` as rebuilt, but the delta changes only `dist/orchestrator/run-task.js`. The path is still in the task's full diff, so pre-flight coverage is unaffected.

### Dismissed Cold Findings

- Dismissed (cold-Claude): a pre-session `rev-parse HEAD` failure (unborn branch, corrupt ref) silently downgrades fix-up to warn-and-continue. A canon task branch always has commits by implement/QA time. The warn-and-continue path matches the spec's fallback for an uninspectable tree, and a post-session failure correctly stops the run.
- Dismissed (cold-Claude): other git state (other refs, tags, push, stash, `assume-unchanged`/`skip-worktree`) is unguarded. Spec §Decision 3 scopes the guard to a content snapshot of the working tree, and none of these changes what the orchestrator commits on the task branch. The prompt already forbids git writes, and `update-index` index-flag manipulation needs deliberate adversarial behavior far beyond a misfiring citation fix.
- Dismissed (cold-Claude): a fix session that commits only its own artifacts now stops the run. The fix-up prompt explicitly forbids `git add`/`git commit` in both phases, and a stop is the conservative outcome for a disobeyed safety instruction. The spec's scope guard is a safety stop, unlike the warn-only lint result.
- Dismissed (cold-Claude): the fixture uses `git commit --no-verify` and assumes the agent cwd. `--no-verify` is deliberate: it isolates the HEAD-move case from the fixture's checker hook. The cwd assumption is exercised, since the test asserts `HEAD:clean-tracked.txt` holds the agent's content, which proves the script ran in `localDir`.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
