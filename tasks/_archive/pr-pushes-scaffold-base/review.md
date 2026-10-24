# Code Review: pr-pushes-scaffold-base

> Reviewer: Claude | Spec: `tasks/pr-pushes-scaffold-base/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored `STAGE_1: pass`, `OVERALL_SIGNAL: approve`. Cold-Claude: 10 findings, `changes_requested`. Cold-Codex: no actionable regressions.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, test 1,616 pass / 1 env-skipped unrelated, build, sync-templates:check, docs-refs-check)
- [x] No required checks were skipped without justification (the one skipped test is the linked-worktree REPO_ROOT anchor test, gated on `.git` writability and unrelated to this diff)
- [x] Red-first evidence recorded for each red-first AC (AC-1, AC-4, AC-4b(i), AC-8(a) against `1ededd5`; AC-6 mutation proof)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `--pr` pushes a safe scaffold | Pass | The integration test checks the origin tip, PR creation, the mode-neutral info line, the shim argv (`<tip>:refs/heads/main`, no `-f`/`-u`) and one fetch. Red-first evidence is recorded. |
| AC-2: `--push` pushes a safe scaffold | Pass | Origin base and `task/task-a` are both pushed. |
| AC-3: operator commit blocks | Pass | New mixed-range test. The existing refusal test is retitled with its body unchanged. |
| AC-4: missing remote base, safe | Pass | `refs/heads/feat/x` lands at the tip, and the PR targets `--base feat/x`. Red-first evidence is recorded. |
| AC-4b: missing base, empty range | Pass | (i) and (ii) pass via published=true with and without the override. (iii) passes via the rejected-creation test, which stays fatal under the override. |
| AC-5: missing base, operator commit | Pass | Both runs, with and without the flag, block with the labelled list and the "does not apply" line. No task branch is pushed. |
| AC-6: stale ref can't hide commits | Pass | The stale=true variant fails when the prune is removed (R2 mutation proof). |
| AC-7: fetch failure ≠ missing branch | Pass | Covered for plain and full-send runs. The warning prints, the missing-remote block does not, and base is unchanged. |
| AC-8: rejection messages | Pass | (a) The non-ff message names `git pull --rebase` with no "protected", in both modes. (b) and (c) are covered by the pre-receive hook tests. |
| AC-9: override still pushes when safe | Pass | The push happens and no override warning prints. |
| AC-10: full-send regressions | Pass | The anchored lens diffed the four tests against `main`: only the permitted success literal changed. The one-fetch count is asserted. |
| AC-11: hint | Pass | The unit test and the `runImplementPhase` once/absent assertions are updated. |
| AC-12: structural removal | Pass | The grep returns zero hits (re-run by the anchored lens). |
| AC-13: `--ship` unchanged | Pass | The default-options `verifyBaseDivergence` on a missing base returns the original warn-and-skip object. The clean-path `deepEqual` is unchanged. |
| AC-14: restatement sweep | Pass | The grep returns zero hits. The listed surfaces were read, and a wider sweep (skills, prompts, `.canon`, product-context) found no stale text. |
| AC-15: decision recorded | Pass | The `docs/decisions.md` entry names the archived non-goal and gives the PR-only-base guidance. |
| AC-16: build artifacts | Pass | The anchored lens rebuilt into a temp outDir. `dist/cli/index.js` is identical, and `run-task.js` differs only in an outDir-dependent esbuild path comment. `sync-templates:check` passes. The handoff omits an AC-16 row (nit N8). |

### Dropped Sections Check

- [x] Non-goals respected: classifier and subject regexes byte-identical, `--ship` untouched, no new flag, `commitTaskArtifactsToBase` unchanged
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation follows the spec's order: one fetch and list, classify, push the checked tip SHA, re-list from that SHA, then the divergence decision. All of this sits in one helper (`pushScaffoldBaseCommits`, `src/orchestrator/main.ts:1382`) that every `--pr`/`--push`/full-send caller reaches through `commitHumanReviewFiles`. The missing-remote classification is opt-in, so `--ship` stays on its old path. Test coverage is real-git and broad, and includes mutation proof for the prune. None of the three lenses found a code-bug that survives verification. What remains is message polish, help-text alignment, one weak unit assertion, and one documented-but-incomplete recovery hint.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **R1 — Non-fast-forward remediation leads into a base-drift conflict on re-run.** Altitude: nit (non-blocking). Source: cold-Claude. Location: `src/orchestrator/main.ts:1409-1413`.
  - **Scenario:** After `git pull --rebase`, the scaffold commit is rewritten (S → S′). The task branch still descends from S and has evolved `tasks/<id>/status.json`. On re-run canon pushes S′, and the base-drift `merge-tree` probe then reports an add/add conflict on `tasks/<id>/*`.
  - **Why it is not blocking:** The recovery does not dead-end. The base-drift gate blocks with its own merge/rebase remediation. The spec prescribes this message text (spec.md:77), and the pre-change manual `git push origin main` hit the same situation.
  - **Optional improvement:** Append "the task branch may then need `origin/<base>` merged in" to the message.
- **R2 — The base push runs before cheap local preconditions in `commitHumanReviewFiles`.** Altitude: nit (non-blocking). Source: anchored and cold-Claude (2 lenses). Location: `src/orchestrator/main.ts:1529`.
  - **Scenario:** The push runs before the missing-`gh` die and the dirty-file allow-list die. Plain `--pr` without `gh`, or with disallowed dirty files, publishes the canon-safe scaffold to base and then aborts.
  - **Spec coverage:** The spec requires this order only relative to the docs-refs and base-drift gates (spec.md:35). It accepts the resulting "scaffold left on origin" outcome as harmless (Known Risks, spec.md:234). The gh and dirty-tree cases have the same harmless outcome, so this is not a defect.
  - **Optional follow-up:** Hoisting the `gh` availability die above the push would be cheap.
- **R3 — `fetch --prune` only prunes refs inside the configured fetch refspec.** Altitude: nit (non-blocking). Source: anchored. Location: `src/orchestrator/git.ts:245`.
  - **Scenario:** With a narrowed refspec (single-branch clone), a hand-made `refs/remotes/origin/*` ref outside it survives the prune and can hide a local-only commit from the missing-remote range.
  - **Why it is not blocking:** The implementation matches the spec's prescribed mechanism (spec.md:49-50, :208), and the trigger is contrived.
  - **Possible hardening:** Build the exclusion set from `git ls-remote origin` heads instead of local tracking refs. Candidate follow-up issue.

#### Optional Cleanup / Nit

- **N1 — Help-text alignment.** Source: anchored and cold-Claude (2 lenses). Location: `src/cli/index.ts:105`.
  - The new `--allow-divergent-base   At …` line has three spaces, so it sits one column right of every other option.
  - The rewrapped `--push` continuation lines (`src/cli/index.ts:96-97`, `src/orchestrator/cli.ts:136`) overrun the block's wrap width.
- **N2 — Inconsistent die alias.** `src/orchestrator/main.ts:1396` uses `splitCli.die(...)`, while the rest of `pushScaffoldBaseCommits` uses the module `die` alias. It is the same function but reads inconsistently, and it is why `dist/` shows both `die` and `die2`.
- **N3 — Misnamed failure.** In `src/orchestrator/main.ts:1385-1387`, the `!divergence.ok` die also covers `verifyBaseDivergence`'s "cwd missing" branch, which then reads as "could not list unpushed commits".
- **N4 — Wrong wording on an empty-range creation rejection.** At `src/orchestrator/main.ts:1413-1418`, the other-rejection text says "Push or merge these commits…", but there are no commits. A concurrent-creation `fetch first` rejection would also pair rebase guidance with the "does not apply when origin has no <base>" suffix.
- **N5 — Raw enum in the warning.** At `src/orchestrator/main.ts:1420`, the override-fallback warning prints the classifier value (`(other)` / `(non-fast-forward)`) to the operator.
- **N6 — Lost cause on prune failure.** At `src/orchestrator/validation.ts:1810`, a prune failure overwrites the original missing-branch stderr. The warn-and-skip line then suggests restoring network access and drops the signal that origin has no `<base>`.
- **N7 — Weak unit assertion.** At `tests/run-task-validation.test.ts:2390-2391`, the "exact branches" probe case (`x` with `feat/x` on origin) never reaches the exact-ref filter in `probeOriginBranch` (`git.ts:232`), because `ls-remote` already exits 2. The filter is defensive and no AC pins it, so this is a nit rather than a test-integrity bug. A `refs/heads/foo/refs/heads/x` fixture would exercise it. Source: anchored.
- **N8 — Missing handoff row.** The handoff's AC Coverage table has no AC-16 row. AC-16 is met (see Stage 1). The anchored lens tagged this as a spec gap; it is really a handoff omission.
- **N9 — Ambiguous base ref.** `rev-parse --verify <base>^{commit}` (`git.ts:245`) resolves a short name, so a same-named tag would win. The present-remote `origin/<base>..<base>` listing already has the same ambiguity. Using `refs/heads/<base>` would avoid it. Source: cold-Claude, low confidence.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): a prune failure after the missing branch is proven only warns and skips, so `gh pr create` later fails against a nonexistent base. This is spec-intended: Known Risks (spec.md:230) requires a prune failure to be treated as a fetch failure ("skip the push and keep today's warn-and-skip"). The message-quality part is kept as N6.
- Dismissed (cold-Claude): plain `--pr` now publishes sibling tasks' scaffold commits. This is spec-intended: Known Risks (spec.md:227) and Non-Goals (spec.md:90) explicitly keep the classifier un-narrowed ("A sibling task's unpushed scaffold therefore rides along").
- Dismissed (cold-Claude): routine `--pr` pushes to `main`, which may trigger adopter CI/CD. This is the task's decided purpose. `docs/decisions.md` records the consent, the PR-only-base guidance, and the `--allow-divergent-base` escape.
- Dismissed (cold-Claude): `git fetch --prune origin` has a wide side effect and can hit lock contention. The spec prescribes the prune (spec.md:49), and on failure it degrades to the documented warn-and-skip, never to an unsafe push.
- Dismissed (cold-Claude): full-send gets `--pr` wording, and a full-send fetch failure no longer fails closed. Both are spec-intended. spec.md:56 says the full-send run "uses the prefix that path passes", and spec.md:55 and Known Risks (spec.md:235) explicitly change the full-send fetch failure from die to skip.
- Dismissed (cold-Claude): no test covers the re-list catching a concurrent local commit. This does not hold. `tests/run-task-safety.test.ts:6865` ("full-send tail pushes the checked tip but not a concurrent operator commit") injects an operator commit during the push. It asserts that origin holds only the checked tip and that the run dies with `Base divergence detected`, which exercises the shared re-list path.
- Cold-Codex: no findings to dismiss ("No actionable regressions found").

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

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
