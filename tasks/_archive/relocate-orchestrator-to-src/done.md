# Done: relocate-orchestrator-to-src

## Summary

canon-ai's pipeline orchestrator — the code that actually runs `canon run` — used to live under `scripts/run-task/`, mixed in with a handful of unrelated dev-tooling scripts (docs checkers, git-hook installers). This task moved the orchestrator (44 files) plus its entry point and its shared policy module into `src/`, where the rest of the shipped product already lives, and shrank `scripts/` down to just the tooling that never ships. Nothing about how the orchestrator behaves changed — this is a pure reorganization, verified by an exhaustive reference sweep and a byte-for-byte-behavioral rebuild of the compiled output. As a side effect, the published npm package is smaller: it no longer ships ~14k lines of raw orchestrator source that were already redundant with the compiled bundle.

## Files Changed

- **Moved** (`scripts/run-task/**` → `src/orchestrator/**`, 44 files): all orchestrator modules, agents, phase handlers, and prompt templates. Contents byte-identical except for corrected path comments/strings (see Decisions below).
- **Moved**: the former scripts/run-task.ts → `src/orchestrator/run-task.ts` (entry point); the former scripts/pipeline-policy.ts → `src/lib/pipeline-policy.ts` (shared policy module).
- **Updated**: `tsup.config.ts`, `tsconfig.json`, `package.json` (build entry, includes, published `files` list).
- **Updated**: `src/cli/commands/run-task.ts`, `doctor.ts`, `watch.ts`, `stop.ts`, `update.ts`, `src/task/index.ts` — all re-pointed to the new module locations.
- **Updated**: `scripts/sync-canon-templates.mjs`, `scripts/docs-refs-check.mjs` (+ its `templates/` mirror), `scripts/normalize-dist-paths.mjs` — gate/tooling constants re-pointed.
- **Updated**: `docs/codebase-map.md`, `docs/patterns.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/product-context.md`, `docs/harness-audit-2026-06.md`, `docs/BACKLOG.md`, `README.md`, `.canon/hooks/README.md` — ~340 reference lines swept; a few passages rewritten rather than swapped (see Decisions).
- **Updated**: `.github/workflows/ci.yml`, `.github/pull_request_template.md`.
- **Updated**: 26 test files (imports/fixture paths only, plus two justified root-resolution fixes — see Decisions) and `dist/cli/index.js`, `dist/orchestrator/run-task.js` (rebuilt bundles; `dist/scripts/run-task.js` removed).

Full per-file detail is in `tasks/relocate-orchestrator-to-src/handoff.md` (baseline + Iteration 2) and `spec.md`'s Affected Files tables.

## How to Test

1. Install canon into a scratch project and start a piece of work with it. It should begin and move into its first stage exactly as before.
2. Run canon's own health check. It should report healthy with no missing-file warnings.
3. While work is running, watch its progress and stop it partway through — both should behave exactly as before.
4. Install canon fresh from the published package. Installation and its one-time setup step should still succeed, and the download should be smaller than the previous release.
5. Read canon's own project documentation — every path it points to should exist, and the explanation of "shipped product vs. build tooling" should now match what's actually in each folder.
6. Overall: nothing about using canon should feel different. This is a reorganization, not a behavior change.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | Covers the erased type-only policy imports. |
| `npm test` | Pass | 1,148 passed, 0 skipped, 0 failed (re-verified in code review, both rounds). |
| `npm run build` | Pass | Fresh build reproduces `dist/` exactly (`git diff --exit-code -- dist/` clean). |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | ~123 gated refs, all resolve. |
| `node dist/orchestrator/run-task.js --help` | Pass | |
| Built CLI spawn bridge (`node dist/cli/index.js run --help`) | Pass | Reaches orchestrator usage. |
| `npm pack --dry-run --json` | Pass | 40 files; exactly one `scripts/` entry (`install-git-hooks.mjs`), zero raw orchestrator `.ts`. |
| `parseAffectedFilesFromSpec` | Pass | 0 malformed, 145 files, both sides of all 46 renames present. |
| Dirty tree vs. spec manifest | Pass | 145 dirty paths, all covered, no under-declaration. |
| AC-2 structural searches (4 retired-path string families) | Pass | Zero hits outside the spec's named permitted bucket. |
| AC-15 policy-import search | Pass | Zero old specifiers; exactly 3 correctly re-pointed. |
| End-to-end / UI tests | N/A | No UI surface (per `docs/architecture.md` §Validation). |

Code review ran two rounds. Round 1 found three correctness bugs and two risk/guardrail items, all in test-harness root-resolution code (not orchestrator logic) — a recurring canon pitfall (`docs/patterns.md` "Worktree runs") that the implementer fixed at some sites but not all. Round 2 verified all five fixes from scratch, found the suite fully green with zero skips, and surfaced one new latent nit (a leak-guard fixture still reading from the wrong checkout root) plus a recommendation to fix the broader "wrong-root" pattern as its own follow-up task rather than a third patch round on this one. Final verdict: **Approved with nits**.

## Human Verification Required

None. All required validation checks resolved to `Pass`; no `human_pending` rows exist in the handoff's Validation Outcomes tables.

**Pre-merge checklist:**
- [ ] Version correct — N/A at QA (bump happens at the release step, not per-task; see Proposed Changelog below).
- [ ] Changelog updated — draft entry proposed below; human finalizes at `/canon-changelog`.
- [x] PR body current — see `pr-body.md`.
- [ ] Final CI/CD checks green — confirm on the actual PR once opened.
- [x] Final diff matches spec intent — verified by two code-review rounds against all 15 ACs.

## Decisions Made During Implementation

- **Used plain filesystem moves, not `git mv`**, because the pipeline owns git staging and forbids the implementer from staging directly. Git detected the renames on its own when the orchestrator's auto-commit staged the tree; both rename sides were declared in the handoff either way.
- **Corrected three references that were already factually wrong before this task**, rather than swapping them verbatim (all pre-authorized by the spec, AC-11): `.canon/hooks/README.md` now points at `main.ts` (where hook dispatch actually lives, not the entry file); `env.ts`'s operator-facing error message now names `src/lib/pipeline-policy.ts`; `metrics.ts`'s emitted doc header now matches the header actually written into `docs/pipeline-invocations.md`.
- **Rewrote two doc passages instead of doing a literal path swap** (AC-9): `docs/architecture.md`'s build-contract row and `docs/decisions.md`'s leak-gate rationale both used to list the orchestrator tree as separate from `src/**`; post-move it's a subset, so a literal swap would have been self-contradicting. Both were reworded to explain the real distinction (path specificity, not top-level directory).
- **Code review round 1 fixed a class of latent test bugs this move exposed** (not introduced by the move itself, but only reachable once the orchestrator's test fixtures pointed at paths under `src/`): two tests were resolving repo-source paths from `REPO_ROOT` (the *supervising* checkout, via `git rev-parse --git-common-dir`) instead of the active worktree checkout. In a linked canon task worktree, that meant one test loaded a stale copy of `env.ts` from the wrong repo and passed for the wrong reason, and an adopter-leak guard silently scanned nothing because the bundle path it was checking didn't exist in the supervising checkout. Both were fixed to resolve from the active checkout (`process.cwd()` / `WORKTREE_ROOT`), matching the pattern already documented in `tests/run-task-signals.test.ts` and `docs/patterns.md`.
- **Declined to fix the same root-resolution pattern at four more sites** that code review's round-2 lens found were byte-identical to `main` (pre-existing, not introduced here) — extracting a shared helper for this is recommended as its own follow-up task rather than a fourth patch round on a relocation task that was otherwise fully converged.
- **Added an implementation amendment** for `tests/run-task-ship.test.ts`, whose `MAIN_HREF` fixture built the retired path as a split `path.join(...)` call that the spec's literal-string greps couldn't see. This was a path-only fixture fix, explicitly authorized mid-implementation, not a scope change.

## Open Questions

None blocking. One follow-up worth filing (from code review round 2, N-2): a repo-wide test-helper pass to normalize "resolve repo-source paths from the active checkout, not `REPO_ROOT`" into one shared constant, covering the ~4 remaining pre-existing sites this task didn't touch.

Maintenance: `docs/lessons-learned.md` holds **16** entries — this task appended one (on canon's three path-reconciliation gates: firing order and per-file token-form asymmetry). That is **above the ~15-entry sweep threshold**, so a lessons sweep is worth scheduling. Per this file's own rules a sweep is human-initiated and human-approved; no agent should perform one. *(Corrected at human_review: this line previously read "12 entries (no addition from this task); no sweep threshold reached" — wrong on the count, wrong on whether an entry was added, and it suppressed the sweep signal. Verified against `git diff main...HEAD -- docs/lessons-learned.md`: +6 lines, 15 → 16 entries.)*

## Proposed Changelog

No changelog entry — this task has no adopter-visible behavior change. It relocates internal source files (the former scripts/run-task tree → `src/orchestrator/**`, and scripts/pipeline-policy.ts → `src/lib/pipeline-policy.ts`), which is exactly the kind of internal reorganization `docs/decisions.md` §"Versioning and release policy" scopes out of the changelog (no new capability, no behavior change, no breaking change). The one arguably user-facing effect — a smaller npm tarball, since raw orchestrator `.ts` source no longer ships alongside the compiled bundle — is a packaging-size improvement with no functional difference an adopter would notice in canon's behavior; applying the "would a user notice" test, a smaller download size is noticeable but not a *behavior* change, and no prior canon-ai changelog entry treats a packaging-size reduction alone as changelog-worthy. Recommend omitting from `CHANGELOG.md` and closing this out as an internal-only change.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Clean 47-file/94-path relocation; code review found only test-harness root-resolution bugs (fixed) plus a follow-up recommendation, no orchestrator logic changes.
