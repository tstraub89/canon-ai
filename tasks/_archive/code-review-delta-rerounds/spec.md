# Spec: code-review-delta-rerounds — Delta-scoped code_review re-rounds with per-round cold-Codex archive

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Every `code_review` round runs the full three-lens shape against the whole task diff (`git diff <baseBranch>...HEAD`): the orchestrator runs cold-Codex with `--base <baseBranch>`, then the foreman spawns the anchored lens and the cold-Claude lens, both over the full diff. Re-rounds (round 2+) mostly verify fixes to the previous round's findings, but the two cold lenses re-review the entire diff from scratch each time. The costs:

- On an adopter's telemetry (GalleryPlanner, Aug–Sep 2026), code_review was 4,829 of ~10,000 agent-minutes, the largest phase, overtaking `implement`. Re-rounds (iteration > 0) accounted for ~55% of code_review time. Rounds are fat-tailed (avg 10.8 on L tasks; one task took 25).
- An archive analysis of 72 multi-round three-lens tasks (8 canon-ai, 64 GalleryPlanner; 185 later rounds) found that later-round findings credited to a cold lens split into: ~10 blocking bugs **inside the fix diff** that the anchored lens missed (it tends to accept a fix as closing the prior finding); ~10 blocking **latent or pre-existing** issues outside the fix diff (several extended the tail via spec-gap halts; a few were sibling sites of the pattern the fix changed); and ~35 nits or repeats of previously dismissed findings. Cold-Codex's unique later-round catches were mechanical and mostly in the fix diff too (e.g., a refactor regressing a toast to the unsanitized filename; an `!important` added by the fix beating a focus-ring style).

So the cold lenses earn their place on re-rounds, but on the **fix delta**, not the whole diff. Re-reviewing the whole diff every round costs time and generates new out-of-scope findings that lengthen the tail.

A second gap: `tasks/<id>/review-cold-codex.md` is overwritten every round (`runCodeReviewPhase` in `src/orchestrator/phases/code-review.ts`), so only the last round's cold-Codex output survives. That made the per-lens analysis above approximate, and there is no record of which commit each round reviewed.

Verified mechanics this spec relies on:
- `codex exec review --base <sha>` accepts a raw commit SHA and reviews only changes since it. Confirmed empirically on codex-cli 0.157.0 in a scratch repo: with a bug in an earlier commit and a new bug in a later commit, `--base <earlier-sha>` reported only the later bug.
- A reroute (`rerouteFromHumanReview`) and `canon task reset-code-review` both reset `code_review.iterations_current_loop` and archive/re-scaffold `review.md`, so the first review after a spec amendment already renders as Round 1 (`promptCodeReview`'s `isRound1`).

## Decision

Replace "cold lenses always review the whole task diff" with a per-round **review scope** chosen by the orchestrator: `full` or `delta`.

**Scope resolution.** A round is `full` if any of these hold, otherwise `delta`:
1. It is Round 1 (as `promptCodeReview` defines it: `isRound1`), which includes the first round after any reroute or reset.
2. The effective task size is XL (nominal XL or `delicate: true`, via `getEffectiveSize`).
3. No usable previous reviewed commit: no archived cold-Codex record for the previous round, the record is unparseable, the recorded commit does not exist, it is not an ancestor of HEAD, or it equals HEAD.
4. The delta touches a file outside the task's change set as of the previous round: some path in `<prevSHA>..HEAD` is not in `<baseBranch>...<prevSHA>`.
5. The delta exceeds a line threshold (added + deleted lines in `<prevSHA>..HEAD`), set as a named constant in `src/lib/pipeline-policy.ts`, initially 400.

Both path sets in trigger 4 are **rename-aware**: a rename or copy contributes both its pre-image and post-image path, per `docs/patterns.md` §"Use `--name-status`, not `--name-only`, when building path sets from `git diff`". A post-image-only set would hide a rename's source path and let a delta round through when a fix moves a file the task never touched onto a path in the change set.

For triggers 4 and 5, paths under the bundle members' `tasks/<id>/` directories and the pipeline telemetry files (`PIPELINE_TELEMETRY_FILES`) are excluded. Task artifacts are normally uncommitted during `code_review` loops, but they can land in a committed range (e.g., the QA-end commit before a reroute), and they are never reviewable code.

**Delta round shape.** All three lenses still run; no lens is dropped.
- cold-Codex runs with `--base <prevSHA>` instead of `--base <baseBranch>`.
- The foreman is told the round is delta-scoped. It directs the cold-Claude lens to review the delta (`<prevSHA>..HEAD`) instead of the full diff, still spec-blind.
- The anchored lens is unchanged: full diff, spec, handoff, prior review.

**Sibling-site sweep.** The cold-Claude lens charter gains an instruction for every round: when the diff adds or changes a guard, check, or invariant, search the repository for other sites that need the same treatment and report missing ones. This extends the charter's existing "diff-local pattern" rule beyond changed files; the lens stays spec-blind (no spec, ACs, handoff, review, or canon docs).

**Per-round cold-Codex archive.** Each round that runs cold-Codex writes a new numbered archive file in every bundle member's task directory. It holds an orchestrator-written header, followed by the verbatim findings. The header records: the round number, the reviewed HEAD SHA, the scope (`full` or `delta`), the base the cold lenses reviewed against (`<baseBranch>` or `<prevSHA>`), and the reason for the scope (which trigger fired, or `delta`). Numbering is a monotonic max+1 scan like `review-prior-N.md`, never a round counter. `review-cold-codex.md` keeps its current role and content: the latest round's verbatim findings.

A delta round's `<prevSHA>` is the reviewed SHA from the newest archive whose recorded round number is exactly the current round minus 1. This makes a retried round (e.g., after a crash mid-foreman) resolve against the previous completed round, not its own aborted attempt.

**Scope label in `review.md`.** The foreman prompt tells the foreman the round's scope, base, and reason, and each `review.md` round (Round 1 body and each `## Round N` section) carries one human-readable scope line with those values. The archive header, not this line, is the machine-readable record.

## Non-Goals

- **No `status.json` schema change.** The reviewed SHA lives in the orchestrator-written archive file. Backed by AC-12.
- **No lens is ever skipped.** Every round runs cold-Codex, anchored, and cold-Claude. Backed by AC-6.
- **No change to the anchored lens's inputs or charter.** `.claude/agents/code-review-anchored.md` is untouched. Backed by AC-12.
- **No per-lens timing / new `pipeline-invocations.md` column.** A follow-up issue.
- **No round-1 `docs/patterns.md` check.** A separate task.
- **No foreman dismissal recalibration** and no change to the round-3+ `tightenLine` discipline.
- **No change to `review-prior-N.md` archiving on reroute/reset**, and no deletion or rewrite of existing cold-Codex archives on reroute/reset (archives accumulate across loops; the round-number lookup handles loop boundaries).
- **No change to the cold-Codex failure contract.** Failure still stops `code_review` before any Claude session.

## Acceptance Criteria

- [ ] AC-1: **Pure scope resolver.** `src/lib/pipeline-policy.ts` exports a pure function (suggested name `resolveCodeReviewScope`) that takes the round facts (round-1 flag, effective size, previous-record availability and ancestry, delta paths, prior change-set paths, delta line count) and returns `{ scope: 'full' | 'delta', base, reason }`. It implements triggers 1–5 from Decision, and the threshold is an exported named constant (initially 400). Verify: `tests/pipeline-policy.test.ts` has one row per trigger forcing `full` with the matching reason, a row returning `delta`, a boundary row at exactly the threshold and one line over, and a row showing `tasks/<id>/` and telemetry paths are excluded from triggers 4 and 5.
- [ ] AC-2: **One round definition.** The round number and round-1 flag used for scope resolution and written to the archive header are the same values `promptCodeReview` renders (`isRound1` / `roundN`, including the `bundleHasRealPriorReview` forced-Round-1 fallback). Verify: a test where `iterations_current_loop > 0` but `review.md` lacks a real prior Stage 1 review resolves `full` with the round-1 reason, and the archive header records round 1.
- [ ] AC-3: **Per-round archive written.** Each `runCodeReviewPhase` invocation that obtains cold-Codex findings writes a new numbered archive file (header + verbatim findings) in every bundle member's task directory, with numbering by max+1 numeric scan that survives gaps and N ≥ 10. `review-cold-codex.md` still receives the verbatim findings. Pre-flight-rejected invocations and failed cold-Codex runs write no archive. Verify: tests in `tests/run-task-code-review.test.ts` covering (a) two successive rounds producing archives 1 and 2 with distinct headers, (b) an existing archive set `{1, 2, 10}` producing 11, (c) a pre-flight rejection producing no archive, (d) a bundle writing the same archive content to each member.
- [ ] AC-4: **Delta cold-Codex base.** On a `delta` round, `runColdCodexReview` is invoked with `<prevSHA>` as its base; on a `full` round, with `<baseBranch>` exactly as today. Verify: test with a stubbed `runColdCodexReview` dep asserting the base argument for a full round and a delta round.
- [ ] AC-5: **Previous-SHA lookup.** `<prevSHA>` comes from the newest archive whose header round equals current round − 1. A missing or unparseable record, a SHA that doesn't resolve, one that is not an ancestor of HEAD, or one equal to HEAD resolves `full` with a reason naming the cause. Verify: real-git tests (temp repo) for: normal delta; retried round (an archive for the current round already exists, the lookup still uses round − 1); non-ancestor after a rewritten branch; prevSHA == HEAD.
- [ ] AC-6: **All three lenses run on every round.** On a delta round, cold-Codex still runs and the foreman prompt still instructs spawning both the anchored and cold-Claude lenses. Verify: golden foreman prompt for a delta round contains both `subagent_type: code-review-anchored` and `subagent_type: code-review-cold`; the runner test asserts `runColdCodexReview` is called on delta rounds.
- [ ] AC-7: **Foreman delta instructions.** On a delta round, the foreman prompt names the scope, the delta base SHA, and the reason. It instructs giving the cold-Claude lens the delta (`<prevSHA>..HEAD`) instead of the full diff, while the anchored lens keeps the full diff plus spec/handoff/prior review. On a full round, the rendered foreman prompt keeps today's lens instructions, with only the scope line added. Verify: new golden key for a delta-round foreman prompt; the existing `promptCodeReview_round1` / `promptCodeReview_roundN` goldens differ from pre-change only by the scope line (reviewer checks the golden diff).
- [ ] AC-8: **Scope line in review.md.** The foreman prompt instructs writing one scope line (scope, base, reason) in the Round 1 body and in each `## Round N` section of `review.md`. Verify: golden prompts contain the instruction; `.canon/templates/review.md` shows the line in its expected-shape comment.
- [ ] AC-9: **Sibling-site sweep.** `.claude/agents/code-review-cold.md` instructs: when the diff adds or changes a guard, check, or invariant, search the repository for other sites needing the same and report missing ones. It keeps every existing spec-blind prohibition (no `spec.md`, `handoff.md`, `review.md`, canon docs, task notes, or ACs). `templates/.claude/agents/code-review-cold.md` is byte-identical. Verify: the structural assertions in `tests/run-task-prompts.test.ts` over the cold agent file still pass and a new assertion checks the sweep instruction; `npm run sync-templates:check` passes.
- [ ] AC-10: **docs-refs-check ignores cold-Codex archives.** `scripts/docs-refs-check.mjs` treats the numbered cold-Codex archive files under `tasks/<id>/` as noisy sources (like `spec.md`/`plan.md`), so stale backticked paths in old rounds' findings cannot fail the `--pr` docs-refs gate. `review-cold-codex.md` handling is unchanged. The `templates/scripts/docs-refs-check.mjs` mirror is byte-identical. Verify: a `tests/docs-refs-check.test.ts` case where an archive file references a nonexistent path passes, and the same reference in `tasks/<id>/review.md` still fails.
- [ ] AC-11: **Decision and orchestrator docs updated.** `docs/decisions.md` gets a new entry recording per-round review scope and superseding the "`--base <baseBranch>`" clause of §"Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" (the sequential and hard-fail parts stand). `docs/pipeline-orchestrator.md` §"Code Review Diff Injection" and §"Per-Iteration Prompt Slimming" describe the scope triggers, the delta round shape, and the archive, and the stale "Code review's slim shape" block (which the current foreman template no longer renders) is replaced by an accurate description. Verify: reviewer reads both sections; `npm run docs-refs-check` and `npm run sync-templates:check` pass.
- [ ] AC-12: **Scope bounds.** The diff does not touch `.canon/templates/status.json`, `src/orchestrator/types.ts`'s `PhaseEntry`, `src/orchestrator/state.ts`, or `.claude/agents/code-review-anchored.md`. Verify: `git diff --name-status -M <base>...HEAD` lists none of these paths on either side of any rename.
- [ ] AC-13: **Build and full suite.** `npm run build` output is committed and matches a fresh build; lint, type-check, the full test suite (with regenerated goldens via `UPDATE_GOLDENS=1`), docs-refs-check, and sync-templates check pass.
- [ ] AC-14: **Rename-aware trigger-4 inputs.** The delta path set (`<prevSHA>..HEAD`) and the prior change-set path set (`<baseBranch>...<prevSHA>`) that the runner passes to the resolver include both paths of every rename. Verify: a real-git test (temp repo) where the base branch has two unrelated files X and Y, the previous round's change set deletes Y, and the fix commit renames X onto Y (`git mv X Y`, detected as a rename). The round resolves `full` with the trigger-4 reason, because X is outside the prior change set. The test fails if the delta set is built from post-image paths only (it would contain just Y, which is in the prior set, and resolve `delta`).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/pipeline-policy.ts` | Add the pure scope resolver and the delta line-threshold constant. |
| `src/orchestrator/phases/code-review.ts` | In `runCodeReviewPhase`: gather round facts (previous archive record, ancestry, delta paths/lines, prior change set), call the resolver, pass the chosen base to `runColdCodexReview`, write the numbered archive with header to each member, pass scope info to `promptCodeReview`. |
| `src/orchestrator/review-archive.ts` | Add the cold-Codex archive helpers (numeric max+1 allocator, header write/parse, newest-record-for-round lookup), mirroring the existing `review-prior-` helpers. |
| `src/orchestrator/git.ts` | Add helpers as needed for the ancestry check, the rename-aware delta and prior change-set path sets (`--name-status -M -z` parsed by the existing `parseNameStatusOutput`, as `getAffectedFiles` does), the delta line count, and a delta scoped diff, following the existing `gitSafeAt` / `getScopedDiff` style. |
| `src/orchestrator/prompts/index.ts` | `promptCodeReview` accepts scope info and renders the scope/base/reason and delta instructions; export or share the round definition so the runner uses the same `isRound1`/`roundN`. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Scope line; delta-round instruction block for the cold-Claude lens; review.md scope-line instruction. |
| `.claude/agents/code-review-cold.md` | Add the sibling-site sweep instruction; allow repository search for that purpose while keeping the spec-blind prohibitions. |
| `templates/.claude/agents/code-review-cold.md` | Mirror (sync-templates). |
| `.canon/templates/review.md` | Show the scope line in the expected-shape comment for Round 1 and `## Round N`. |
| `templates/.canon/templates/review.md` | Mirror (sync-templates). |
| `scripts/docs-refs-check.mjs` | Exempt the numbered cold-Codex archive files in `isNoisySourceFile`. |
| `templates/scripts/docs-refs-check.mjs` | Mirror (sync-templates). |
| `docs/decisions.md` | New decision entry; superseding note on the `--base <baseBranch>` clause. |
| `docs/pipeline-orchestrator.md` | Update §"Code Review Diff Injection" and §"Per-Iteration Prompt Slimming". |
| `templates/docs/pipeline-orchestrator.md` | Mirror (sync-templates). |
| `tests/pipeline-policy.test.ts` | Resolver rows (AC-1). |
| `tests/run-task-code-review.test.ts` | Archive, base selection, lookup, bundle, pre-flight, and rename-aware trigger-4 cases (AC-2 to AC-6, AC-14). |
| `tests/run-task-prompts.test.ts` | Delta-round golden state; sweep assertion (AC-6 to AC-9). |
| `tests/run-task-prompts.golden.json` | Regenerated goldens plus the new delta-round key. |
| `tests/docs-refs-check.test.ts` | Archive exemption case (AC-10). |
| `dist/orchestrator/run-task.js` | Rebuilt output. |
| `dist/cli/index.js` | Rebuilt output if the build rewrites it (shared `src/lib`/`src/orchestrator` modules often bundle into both entry points). |

### Interaction Dependencies

- **Reroute / reset-code-review:** these reset the loop and produce a Round 1 (full). Archives from earlier loops remain. The round − 1 lookup takes the newest matching record, so post-reroute round 2 resolves against post-reroute round 1.
- **Pre-flight rejection:** reviews nothing and writes no archive; the next real round's lookup is unaffected.
- **Bundles:** one cold-Codex run and one scope decision per invocation over the shared branch. The same archive content goes to every member. If members' previous records disagree or any is missing, the round is `full`.
- **Resume IDs:** `runCodeReviewPhase` computes its own `maxIter` from `iterations_current_loop` for resume and metrics. AC-2 requires scope resolution to use the prompt's round definition instead. Resume behavior is unchanged.
- **`--pr` / ship / QA commit:** these stage whole `tasks/<id>` directories, so new archive files ride along without allowlist changes.
- **`review-cold-codex.md` readers:** unchanged content (verbatim latest findings).

### Data Model Changes

New orchestrator-written task artifact: numbered cold-Codex archive files in `tasks/<id>/` (header + verbatim findings). No `status.json` change.

### Implementation Notes (non-binding; owned by plan/implement)

- Archive name suggestion: `review-cold-codex-run-<N>.md`. Header suggestion: a single leading HTML comment with `key=value` pairs (round, reviewed_sha, scope, base, reason), so findings stay verbatim below it.
- The trigger-4/5 exclusion matches `isPipelineOwnedPath` in `src/orchestrator/main.ts` (bundle `tasks/<id>/` prefixes plus `PIPELINE_TELEMETRY_FILES`); plan may extract and share it rather than duplicate it.
- For the trigger-5 line count, `--numstat -M -z` emits rename records as `added\tdeleted\t\0old\0new\0`; the parser must not misread them. `--no-renames` is an acceptable alternative (it counts a rename as delete + add, which over-counts toward `full`, the safe direction).
- `codex exec review` rejects a positional prompt together with a target selector, so the delta base goes through `--base`, not a prompt.
- A delta diff for the foreman can use the same 50,000-byte cap convention as `getScopedDiff`; if both the full and the delta diff are injected, plan should keep the prompt within a sensible budget (e.g., inject the delta and have the anchored lens retrieve the full diff by command when large).

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite, including regenerated goldens
- [x] `npm run build` — committed `dist/` must match
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `docs/decisions.md`: new entry (in Affected Files).
- `docs/pipeline-orchestrator.md`: code_review sections (in Affected Files).
- `docs/codebase-map.md`: may need a line for the new archive helpers in `review-archive.ts`.
- `docs/product-context.md`: names `review-cold-codex.md` (lines ~38, ~128); may need the archive mentioned.

## Known Risks

- **Empty or wrong delta on retry:** if the lookup took the newest archive regardless of round, a retried round would diff HEAD against itself. Mitigated by the round − 1 lookup plus the prevSHA == HEAD → `full` guard (AC-5).
- **Trigger 4 silently under-firing on renames:** a post-image-only delta path set hides a rename's source, so a fix that moves an untouched file onto a change-set path would get a delta review. AC-14 pins the rename-aware set with a test that fails on the post-image-only construction. The flip side is conservative: renaming a task-touched file to a new path forces `full`, which costs time but not coverage.
- **Trigger 4 always firing:** if task artifacts or telemetry files reach a committed range (e.g., after a QA-end commit and reroute) and the exclusion is missed, re-rounds go `full` silently and the feature does nothing. AC-1's exclusion row guards this. Telemetry-based checking after ship (share of `delta` rounds in archive headers) confirms it.
- **Branch rewrites:** a rebase or amend makes prevSHA a non-ancestor. The round falls back to `full` (AC-5), costing time but not coverage.
- **Recall regression on delta rounds:** latent issues outside the delta will no longer be found by re-rounds. This is the intended trade (evidence in Problem). The sibling sweep recovers the sibling-site subset, and round 1 remains full. If the next archive analysis shows escapes, lower the threshold or widen trigger 4.
- **Cold-Claude sweep cost in round 1:** a repository search adds work to every round's cold lens. Bounded to guards/invariants the diff changes.
- **Golden churn:** round-1/round-N goldens change by the scope line. AC-7 requires the diff to be limited to that.
- **docs-refs exemption too broad:** the pattern must match only the numbered archive files under `tasks/<id>/`, not `review.md` (AC-10 negative case).

## Human Test Plan

1. Run a task through code review where the first review requests changes and the fix is small.
2. After the second review, open the task folder: there should be two saved cold-Codex review records. The second should say it reviewed only the changes since the first review's commit and name that commit.
3. In the written review, each round should state whether it was a full or a changes-only review and why.
4. Run a delicate task through two rounds: both records should say full review, with the reason "delicate".
5. Expected: small fix rounds are noticeably shorter in the run log, and every round still shows all three reviewers' input in the written review.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, feature/policy change
