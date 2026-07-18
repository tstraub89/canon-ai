# Code Review: bundle-secondary-branch-worktree-routing

> Reviewer: Claude | Spec: `tasks/bundle-secondary-branch-worktree-routing/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Lens convergence (Round 1):** anchored → approve (Stage 1 pass, all ACs Met, validation independently re-run green); cold-Codex → approve (routing + bootstrap satisfy intended behavior, validation passes); cold-Claude → changes_requested, driven by the fail-closed global-die tradeoff (see Dismissed Cold Findings — spec-intended with explicit citation, and *not* corroborated by cold-Codex) plus a set of low-severity nits. After adjudication no finding is a code-bug or spec-gap.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens independently re-ran the suite: `npm run lint` pass, `npm run type-check` pass, `npm test` 992/992 pass, `npm run build` with `git diff --exit-code -- dist/` clean (AC-9), `npm run docs-refs-check` "All refs OK". Handoff Validation Outcomes are all `Pass`.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: wrong-main-write regression (red-first) | Pass | `tests/run-task-safety.test.ts:1276` real-git 2-task bundle. Asserts (a) worktree secondary copy `branch === task/<leader>`, (b) main secondary copy `branch === ""` **and** clean `git status --porcelain`, (c) `resolveTaskCwd(secondary)` returns `realpath(leaderWorktree)`. Red-first verified by trace: pre-fix `ensureBranch`'s `writeStatus(secondary)` routed to `REPO_ROOT` (empty-branch fall-through, no scan), so (a) stays `""` and (b) goes dirty — both fail; (c) passes pre-fix only via the wrongly-populated main hint, exactly as the spec claims. |
| AC-2: override-aware bootstrap destination, main untouched | Pass | `scripts/run-task/git.ts:290-302`: `leaderWorktree` captured from `ensureWorktree` return; destination is override root when `CANON_TASKS_DIR_OVERRIDE` set, else `<leaderWorktree>/tasks/<member>/status.json`; no main write. Guarded by AC-1 (non-override) + existing bundle-heartbeat test (override), both green. |
| AC-3: match rule + fail-closed | Pass | `scripts/run-task/state.ts:54-84` scan gated inside the `parsed.worktree === true` empty-branch sub-path (`state.ts:177`). Match requires `candidate.worktree === true` **and** `checkedOutBranch !== null` **and** trimmed `branch === checkedOutBranch` (`state.ts:74-78`). enumeration-failed → `die` (188), present-but-invalid → `die` (191), ambiguous → `die` (181), no-match → `REPO_ROOT` (197/204). Candidates read through `readStatusFromPath` (runs `validateStatus`/`validateBranchField`), never raw `JSON.parse`. |
| AC-4: negative / fail-closed tests | Pass | inherited-dir (`:1389`), main `worktree:false` not scanned via non-by-id candidate (`:1432`), candidate `worktree:false` (`:1475`), multi-match → die naming both (`:1518`), enum-fail → die via new `FAKE_GIT_WORKTREE_LIST_FAIL=1` lever (`:1574`), malformed-JSON → die (`:1607`), schema-invalid `branch:123` → die with "expected string, got number" (`:1651`). |
| AC-5: no self-reference recursion | Pass | Scan + bootstrap use only `fs`, `spawnSync git`, `readStatusFromPath`, `writeStatusToFile`. No `readStatus`/`writeStatus`/`statusFileFor`/`taskDirFor` in `scanWorktreesForSecondaryOwnership`/`listWorktreesWithBranches` or the changed `ensureBranch` block. `readStatusFromPath` takes an explicit path and does not re-enter `resolveTaskCwd`. |
| AC-6: leader / single-task / override unchanged | Pass | Leader/single-task resolve via the direct by-id fast-path before the scan (`state.ts:156-160`). Full suite green incl. bundle-heartbeat, reuse-path (`:1153`), secondary-routing (`:1272`). |
| AC-7: existing non-empty-branch die intact | Pass | `state.ts:167-175` non-empty-branch `die` path unchanged; the new scan sits on the sibling empty-branch path within the same `worktree === true` block. |
| AC-8: log accuracy | Pass | `git.ts:308` "Branch recorded … (worktree mode — main checkout untouched)" retained; main is now genuinely untouched for every bundle member, so the line is true for secondaries. |
| AC-9: build artifacts | Pass | `dist/cli/index.js` + `dist/scripts/run-task.js` regenerated; `git diff --exit-code -- dist/` clean; dist faithfully mirrors the TS source. |
| AC-10: validation clean | Pass | lint / type-check / test / build / docs-refs-check all green (independently re-run). |

### Dropped Sections Check

- [x] Non-goals respected — reuse block (`git.ts:262-277`) is byte-identical/untouched; no `status.json` schema change; no `docs/BACKLOG.md` edit; the deferred crash-consistency hole is left unfixed as specified.
- [x] Known Risks addressed or documented as accepted — recursion (AC-5), fail-closed enumeration/present-but-invalid (AC-3/AC-4), candidate `worktree:false` false-match, override contract, detached-HEAD, dist drift all covered by code + tests.
- [x] Human Test Plan satisfiable by the implementation.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation matches the spec's two-change Decision precisely and cleanly. The porcelain parser (`listWorktreesWithBranches`) correctly handles the `flush()` boundary, detached-HEAD worktrees (no `branch` line → `null` → can never match), and the REPO_ROOT filter. The tri-state-plus scan (`matched`/`ambiguous`/`enumeration-failed`/`present-but-invalid`/`no-match`) fails closed on exactly the two modes the spec requires (`die`, not skip), and routes the residual `no-match` to `REPO_ROOT` for the legitimate pre-implement case. The bootstrap loop writes every member to an override-aware, resolver-free destination and never touches main. Recursion safety holds. All surviving findings are low-severity nits or the spec's own explicitly-accepted fail-closed tradeoff — nothing blocks.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **Resolved-path shape inconsistency (low; anchored + cold-Claude — 2 lenses).** `state.ts:81` — a scan-matched secondary returns the `git worktree list --porcelain` path (git canonicalizes to realpath, e.g. `/private/var/…`), whereas the leader / direct-by-id path returns the non-canonicalized `directWorktree = path.join(worktreesRoot, taskId)` (`state.ts:158-160`). Under a repo/worktrees root with a symlinked component (macOS `/tmp → /private/tmp`, which the AC-1 test itself papers over with `fs.realpathSync`) `resolveTaskCwd(leader)` and `resolveTaskCwd(secondary)` return **different strings for the same directory**. No current consumer does exact string-equality between two resolved cwds, and Linux/CI has no such symlink, so filesystem ops land correctly today. Latent only — flagged so a future "same worktree?" string comparison isn't written against this. Optional: canonicalize both sides (or neither).

#### Optional Cleanup / Nit

- **Parse-before-disqualify widens the fail-closed blast radius (low; cold-Claude).** `state.ts:63-74` reads each present candidate through `readStatusFromPath` **before** the cheap `checkedOutBranch === null` / `worktree !== true` disqualifiers. A detached-HEAD or unrelated-branch worktree that provably can never own the task still triggers a fatal `present-but-invalid` die if its inherited `status.json` happens to be corrupt. This matches the spec's prescribed per-candidate order and its accepted global-die tradeoff (see Dismissed Cold Findings), so it is not a defect — but reordering the `checkedOutBranch === null` guard ahead of the parse would narrow the die to plausible-owner worktrees at zero correctness cost. Optional.
- **Redundant `candidateBranch &&` guard (low; cold-Claude).** `state.ts:76` — `checkedOutBranch` from porcelain is either `null` (already filtered at line 74) or a non-empty branch name, so `'' === checkedOutBranch` can never hold; the `candidateBranch &&` prefix is defensive but never load-bearing. Harmless; keep for intent-clarity or drop.
- **Unreachable `break` after `die()` (trivial; cold-Claude).** `state.ts:187/190/195` — `die` is typed `: never` (`scripts/run-task/cli.ts:97`, `process.exit(1)`), so the trailing `break`s are dead. Harmless/defensive (survives a hypothetical `die` return-type change); no action needed.
- **Bootstrap `readStatusFromPath` throws a bare error on a never-committed member (low; anchored + cold-Claude).** `git.ts:299` — if a bundle member's `tasks/<member>/status.json` was never committed to base (so not inherited into the leader worktree), `readStatusFromPath` throws ENOENT and aborts `ensureBranch` without a `die()` remediation message. Only reachable on a malformed bundle; `commitTaskArtifactsToBase` runs immediately prior on the normal path, and pre-fix `readStatus` would also have failed here — no regression. Optional: wrap with an actionable message.
- **REPO_ROOT enumeration filter is an exact string compare (low; cold-Claude).** `state.ts:30` — `currentPath !== REPO_ROOT` can leak the main checkout into the candidate set if the repo path has a symlinked component (REPO_ROOT is not realpath-canonicalized). Benign in the fixed flow (main's secondary copy keeps `branch: ""` → never matches) and mirrors the pre-existing `findExistingWorktreeForBranch:99` behavior. Optional.

#### Spec Gaps

(none — the fail-closed global-die behavior is a deliberate, documented spec decision, not a spec oversight; see Dismissed Cold Findings.)

### Dismissed Cold Findings

- **Dismissed (cold-Claude): present-but-invalid dies globally on any corrupt inherited candidate, even when a valid owner exists (`state.ts:59-72`, ranked medium)** — Verified against the code: the `return { outcome: 'present-but-invalid' }` does short-circuit the loop before a valid `matched` owner can be accumulated, so one corrupt inherited `tasks/<taskId>/status.json` in *any* worktree bricks resolution of that task. **Not dismissed for being off-AC — dismissed because it is the spec's explicit, deliberate fail-closed decision:** Known Risks (`spec.md:127`) states verbatim "a corrupt or schema-invalid `tasks/<taskId>/status.json` in *any* worktree makes `resolveTaskCwd(taskId)` die; acceptable for a delicate path, and atomic writes mean it fires only on genuine corruption/invalid metadata." The alternative — skip the corrupt candidate and fall through to `REPO_ROOT` — is precisely the re-dirty-main bug this task fixes. Cross-model note: cold-Codex did **not** flag this (it approved), so there is no cold-Claude + cold-Codex agreement to escalate. Retained as an optional narrowing nit (parse-before-disqualify, above), not a blocker.
- **Dismissed (cold-Claude): detached-HEAD / unrelated-branch worktree still dies on a corrupt inherited copy (`state.ts:64-74`, ranked medium)** — Same root behavior as above; the candidate order (existsSync → `readStatusFromPath` → worktree/branch checks) is exactly what `spec.md:37-41` prescribes, and the resulting die is the accepted fail-closed outcome. Kept as an optional reordering refinement, not a defect.
- **Dismissed (cold-Claude): weak fake-git negatives — asserting `=== REPO_ROOT` would also pass against a no-op scan (test integrity)** — Verified not a test-integrity violation: the discriminating negatives genuinely discriminate (main-`worktree:false` and candidate-`worktree:false` candidates *would* match if their gates were removed → the test would then return the worktree ≠ `REPO_ROOT` and fail; multi-match/enum-fail/malformed/schema-invalid assert `die`). The positive scan→match routing path is covered by the real-git AC-1 integration test (`resolveTaskCwd(secondary) === realpath(leaderWorktree)`), which cannot pass against a no-op scan. Coverage is adequate; downgraded to the low test-coverage nit below.
- **Dismissed (cold-Claude/anchored): AC-4(a) inherited-dir test only exercises the empty-branch variant, not a non-empty-but-mismatched branch** — Real but low: the match rule (`candidateBranch === checkedOutBranch`) covers the mismatched-non-empty case and the multi-match/candidate-`worktree:false` tests exercise non-empty branches, but no single test pins "inherited dir with non-empty branch ≠ checked-out branch." A hardening opportunity, not a correctness or integrity problem. Recorded as a low test-coverage nit; does not block.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
