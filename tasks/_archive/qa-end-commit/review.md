# Code Review: qa-end-commit

> Reviewer: Claude | Spec: `tasks/qa-end-commit/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All six required checks (`lint`, `type-check`, `test` — 854 pass / 1 skip / 0 fail, `build`, `sync-templates:check`, `docs-refs-check`) recorded `Pass`. E2E is `not_configured`, which matches the spec's `Validation Required` (E2E marked N/A — no UI surface).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `commitQaArtifacts(taskIds, cwd)` helper exists, no push/PR, reuses `buildHumanReviewStagePaths` | Pass | `scripts/run-task/main.ts:765`; stages via `buildHumanReviewStagePaths` (`main.ts:788`); no push/PR steps. Unit tests at `tests/run-task-safety.test.ts:1332`. |
| AC-2: qa→done invokes helper for every bundle task; no dirty artifact/managed-doc/telemetry left | Pass | `checkAndRoute` `case 'qa'` (`main.ts:3039`) calls helper for all ids; `git add -A -- tasks/<id>` stages the full task dir incl. `status.json`; real-git test asserts clean `git status --porcelain=v1 -uall`. |
| AC-3: single chokepoint covers both advance paths (normal + `tryEvidenceAdvance`) | Pass | Every phase routes through `checkAndRoute(phase, taskIds)`; the recover loop drives `tryEvidenceAdvance`'s qa→done *before* the `case 'qa'` commit runs. Evidence-advance subprocess test verifies the commit fires on that path. |
| AC-4: commit message `chore: QA artifacts for <task-id>`; bundle names all ids | Pass | `main.ts:829`. Single + bundle (`task-a, task-b`) subject tests. |
| AC-5: clean-tree `--pr`/`--push` path unregressed; no-pr/no-push `die` untouched | Pass | `commitHumanReviewFiles` and the shared `buildHumanReviewStagePaths`/`humanReviewAllowedPath` are not modified by the diff. |
| AC-6: late-edit dirty-tree `commitHumanReviewFiles` path still commits | Pass | No change to `commitHumanReviewFiles` dirty-tree path; existing tests still pass per handoff. |
| AC-7: staged set scoped to worktree, never REPO_ROOT | Pass | All paths derive from `gitSafeAtRaw(cwd, 'status', …)`; `getActiveCwd(taskIds)` supplies the worktree cwd. Test asserts non-dirty managed docs are not staged from a hardcoded root list. |
| AC-8: #152 timing — reroute from clean committed state, no implement abort on QA-touched managed doc | Pass | QA-end commit leaves a clean tree for `--reroute`; closed structurally by AC-9 as well. Real-git test leaves worktree clean after managed-doc QA edits. |
| AC-9: `autoCommitAllowedSourceBypass` exempts `PIPELINE_MANAGED_DOCS` | Pass | `validation.ts:763-767`; new porcelain test confirms a dirty `docs/codebase-map.md` absent from handoff is not reported uncovered. |
| AC-10: reuses `humanReviewAllowedPath` with full managed-doc union; out-of-union dirty file aborts | Pass | Helper unions full `PIPELINE_MANAGED_DOCS` (valid because it only fires at qa=done). Test (a): managed doc absent from Affected Files is staged; test (b): out-of-union dirty file aborts with the QA-end allow-list message. |

### Dropped Sections Check

- [x] Non-goals respected — no per-phase commits added; implement auto-commit contents unchanged; `commitHumanReviewFiles`'s no-pr/no-push `die` untouched; base-drift gate/allow-list unchanged.
- [x] Known Risks addressed or documented as accepted — AC-7 worktree-scoping, AC-10 allow-list, AC-3 single chokepoint, and the reconciler-widening risk are all covered (see Findings + Dismissed Cold Findings).
- [x] Human Test Plan satisfiable — clean tree after QA, clean `--pr`, clean reroute, and late-edit capture all map to implemented behavior.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, faithful implementation of the minimum-scope contract. `commitQaArtifacts` is a well-guarded sibling of `commitHumanReviewFiles`: it derives its staged set strictly from the worktree's own `git status` (AC-7), reuses the established `humanReviewAllowedPath` / `buildHumanReviewStagePaths` primitives, and layers a pre-add and post-add staged-allow-list re-check so a stray pre-staged or escaped path aborts rather than committing silently. The single-chokepoint routing through `checkAndRoute('qa', …)` cleanly covers both qa→done advance paths. Both lenses independently returned an "approve" signal. No correctness bugs and no spec gaps survived adjudication; all surviving findings are optional nits, several of which are pre-existing patterns inherited from the reused `commitHumanReviewFiles` shape.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none blocking — see nits below for the bounded, mostly-inherited risk items)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- _nit (cold):_ **Quoting asymmetry in the post-add staged re-check.** `main.ts:807-826` reads `git diff --cached --name-only` (which quotes paths containing spaces/special chars) and compares the raw lines against `humanReviewAllowedPath`, but does not strip git's quoting — whereas the earlier dirty check goes through `parsePorcelainEntries`, which *does* strip quotes. A staged task-artifact/managed-doc path containing a space would pass the porcelain dirty check, get staged, then fail the post-add re-check and `die` spuriously. Unreachable in practice (task IDs are validated kebab-case, artifact filenames are fixed, managed-doc paths have no spaces) and the same pattern pre-exists in `commitHumanReviewFiles`, but worth normalizing if this code is touched again.
- _nit (anchored):_ **`git add -A -- tasks/<id>` trusts the directory, not the validated entry set.** `main.ts:807-812` stages the whole task dir; a file written into `tasks/<id>/` during the TOCTOU window between the `git status` read and the `add` would be committed (it passes `humanReviewAllowedPath` because everything under `tasks/` is allowed). Bounded by the pipeline-owned task dir and identical to the existing `commitHumanReviewFiles` shape — low practical blast radius.
- _nit (anchored):_ **Pre-add staged-file check (`stagedBefore`) is dead in the single-chokepoint path** — nothing is staged before the helper runs in the pipeline. Codex documented it as a deliberate deviation mirroring `commitHumanReviewFiles`'s second-stage guard; harmless defense-in-depth.
- _nit (cold):_ **Test coverage edges.** (1) The bundle real-git test (`run-task-safety.test.ts:1402-1416`) asserts only the commit subject, not that both tasks' artifacts landed — though the `checkAndRoute` bundle test does assert the `add -A` staging for both task-a *and* task-b in the git log, so staging coverage exists. (2) The `checkAndRoute('qa', …)` fake-git tests cannot exercise the post-add escape guard (`add` is a no-op and `diff --cached` returns a static fixture) — that guard is only meaningfully covered by the real-git tests, which write only allow-listed dirty files. Neither is a test-integrity violation (no test was weakened to pass against broken behavior); they are coverage observations.
- _nit (cold, low confidence):_ **`git commit` runs without `--no-verify`.** The repo's `simple-git-hooks` pre-commit hook auto-syncs and re-stages `templates/`; if QA's Docs Freshness touches a canon-owned managed doc, the hook may stage its `templates/` mirror into the commit after the post-add re-check has passed. This mirrors the existing `commitHumanReviewFiles` behavior (the hook fires there too) and the mirror-sync is the intended canon convention, so it's not introduced or worsened by this task.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong.

(none)

### Dismissed Cold Findings

> Cold-lens findings dropped because the spec shows the behavior is intended. Include the spec reason.

- Dismissed (cold): **`autoCommitAllowedSourceBypass` widening relaxes the implement-phase abort guard** — Intended per **AC-9** and explicitly accepted in the spec's *Known Risks* ("Reconciler exemption widens what implement may auto-commit… This is acceptable — managed docs are pipeline-owned and still gated by the `--pr` allow-list at push"). The required reviewer confirmation is satisfied: the anchored lens verified `autoCommitCode` only `git add`s handoff files, so a dirty managed doc is left dirty-and-tolerated (never swept silently into the implement commit) and is re-gated at `--pr` base-drift. This finding was raised without spec context, which is precisely the cold lens's role.
- Dismissed (cold): **`commitQaArtifacts` never threads `affectedPrefixes`, so a dirty `dist/`/directory-form artifact aborts at QA-end instead of committing** — Intended per **AC-10** and the helper's `die` message ("Source or test edits must be committed during the implement phase, not left dirty at QA-end"). Source/test/dist are committed at implement via the handoff Changes table; QA's Docs Freshness touches only managed docs + telemetry. A stray dirty source/dist file at QA-end is *supposed* to hit the existing allow-list-violation abort. The asymmetry with `commitHumanReviewFiles` is by design.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

All 10 ACs met, every Non-Goal respected, both lenses returned approve. Surviving findings are optional nits only — several inherited from the reused `commitHumanReviewFiles` shape and none blocking. The quoting-asymmetry nit (`main.ts:807-826`) is the most concrete should-someone-touch-this-again item but is unreachable with current task-ID/artifact naming.
