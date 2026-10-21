# Code Review: base-drift-conflicts-only

> Reviewer: Claude | Spec: `tasks/base-drift-conflicts-only/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Handoff reports lint, type-check, build, docs-refs-check, sync-templates:check, and full `npm test` (1,534 tests, 0 failed, 1 skipped) as Pass. The anchored lens independently confirmed that a fresh `npm run build` leaves `dist/` unchanged and that the 26 targeted tests pass. The foreman did not re-run the full suite. Cold-Codex reported that its own test run was interrupted, so the full suite has no independent confirmation from that lens.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: non-overlapping base advance passes (red-first) | Pass | Rewritten real-git test through `main()` asserts the "they merge cleanly" info line and the push. The handoff records the red-first command and the pre-fix failure. |
| AC-2: another task's artifacts on the base pass | Pass | another task's spec and status files added on the base; passes without `--force`; reports "advanced on 2 files". |
| AC-3: real conflict aborts | Pass | `tests/run-task-safety.test.ts:6706` asserts the header, the path, the rebase remediation, the undo line, HEAD unchanged, and no remote branch. |
| AC-4: scope drift still aborts unchanged | Pass | Existing drift tests pass. Fake-git assertions now expect commit, then `reset --soft`, then no push. Only the base-advanced message assertions changed. |
| AC-4b: conflict plus scope drift | Pass | `tests/run-task-safety.test.ts:6733` asserts both sections. |
| AC-4c: human_review-commit conflicts caught and undone | Partial | All three cases exist. The dirty-doc test (`:6755`) and the hook test (`:6792`) check only for `/docs\/patterns\.md/` plus a non-zero exit. That path is already printed by the configured-doc `WARNING:` (`src/orchestrator/main.ts:1408`), so neither test proves the abort was a conflict abort that names the doc. See finding 1. |
| AC-4d: undo leaves task re-runnable | Pass | Dirty-doc test reverts the base edit, re-runs, and asserts the push plus the `chore: add task artifacts` commit containing the doc. |
| AC-5: `--force` bypasses a conflict with a warning | Pass | Fake-git `main()` tests: the conflict warning lists both paths; a clean advance under `--force` prints the info line and no override warning. |
| AC-6: probe failure | Pass | Exit 129 warns with the 2.38 minimum and proceeds. Exit 128 fails closed with and without `--force`. `setupFakeGit` stubs `merge-tree` explicitly and defaults to clean, so tests do not ride the exit-1 fallthrough. |
| AC-7: restatements updated | Partial | The required grep returns no hits; docs, mirror, codebase-map, both patterns.md additions, and `src/orchestrator/cli.ts` are updated. The `--force` help line in `src/cli/index.ts:98` still says "currently: --full-send on a delicate task". It now contradicts the `--pr`/`--push` lines above it ("bypass with --force"). AC-7 names the `--force` help in this file. See finding 2. |
| AC-8: build and checks | Pass | `dist/` matches a fresh build; the handoff reports all checks Pass. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

The anchored lens returned Stage 1 pass. The two Partials are narrow test-assertion and help-text gaps, not missing behavior, so the foreman carries them as Stage 2 findings instead of failing the gate.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is sound. The probe runs inside `verifyBaseDrift`, before any force decision. On the dirty path the gate runs on the recorded HEAD after the human_review commit. Every abort branch of `runBaseDriftGate` (`diffFailed`, probe error, fail-closed `getAffectedFiles`, conflict/scope) goes through the undo closure. Both human_review push sites are gated. `probeMergeConflicts` disambiguates exit 1 by the tree-OID first field and parses `-z` output. All three lenses agree there is no behavioral regression. The blocking items are one test-integrity gap and one stale help line.

### Findings

#### Correctness Bugs

1. **[code-bug, test integrity] AC-4c dirty-doc and hook tests don't prove a conflict abort.** Source: anchored lens; verified by the foreman. In `tests/run-task-safety.test.ts:6755` (blocked run) and `:6792`, the only content check is `/docs\/patterns\.md/`. `commitHumanReviewFiles` prints `WARNING: docs/patterns.md has uncommitted edits and is a configured doc` (`src/orchestrator/main.ts:1408`) before it commits, so the regex matches whatever happens afterwards. "Non-zero exit + HEAD unchanged + no push" also holds if the fixture's `git commit` itself fails (for example, a broken hook gives "Human review commit aborted"). The hook test is the one meant to pin the probe to the recorded commit, and it would pass without the probe ever running. Fix: in both tests assert `/conflicts with origin\/main/` and `/human_review commit was undone/`, matching the AC-3 test at `:6721-6725`.

#### Risk / Guardrails

2. **[code-bug, stale restatement] `src/cli/index.ts:98` `--force` help omits the base-drift bypass.** Source: anchored lens; verified by the foreman. The line reads "Acknowledge high-commitment combinations (currently: --full-send on a delicate task)". Lines 93 and 96 now say conflicts and scope drift are bypassed with `--force`, and AC-7 lists the `--force` help in this file as a surface to update. The incompleteness predates this task, but the contradiction with this task's new text is live. Align it with `src/orchestrator/cli.ts`, which lists the base-drift gate, then rebuild `dist/`.

#### Optional Cleanup / Nit

- `docs/pipeline-orchestrator.md:351` (and its mirror): the paragraph opens "Before that dirty-tree auto-commit path runs, the orchestrator also runs remote-boundary gates", then says the base-drift gate runs after the human_review commit. Reword the opener. The same paragraph's "still block with the same remediation as before" is change-relative wording in an adopter-shipped doc; state the remediation directly. (anchored + cold-Claude)
- `docs/patterns.md:260`: the git-behavior section's neighbours name the git version a claim was verified on; the new merge-tree bullet doesn't. (anchored)
- `src/orchestrator/main.ts:~1245`: after a `--force` conflict override, the info line "…; they merge cleanly." can print right after a "merge conflicts" warning. It is accurate for those N files but reads as contradictory; consider dropping "they merge cleanly" when `hasConflict`. (cold-Claude)
- `src/orchestrator/main.ts:1236-1240`: the scope-override warning keeps the "base-drift detected; … Drifted files:" wording but now lists only task-changed out-of-scope files. That is intended, but the wording could say "out-of-scope files". (anchored)
- `src/orchestrator/main.ts:1495`: the undo covers only aborts routed through the `abort` callback. A `die` inside `requireDocsFreshnessConfig` (called again by `verifyBaseDrift`) or a thrown exception would leave the commit in place. That path can't fail in practice, because the same config already loaded at the top of the function. Loading it once before the commit, or a try/finally, would make the rollback structural. (cold-Claude)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): merge-tree exits 128 on unrelated or shallow histories, which fails closed with no `--force` bypass even when there is zero drift. The spec mandates this (§Decision item 4: "Any other probe failure … the run aborts fail-closed … `--force` cannot bypass it"). A task worktree branched from the base always has a merge base. A shallow clone is not a supported canon worktree setup.
- Dismissed (cold-Claude): `reset --soft` leaves hook-staged files in the index, so a rerun could die on the staged-allowlist check. A hook-added path outside the allowlist is task-changed out-of-scope on the recorded HEAD, so the first abort already lists it under the scope section with "add to Affected Files" remediation. Following that remediation also satisfies the staged check on rerun. A hook-added path inside the allowlist reruns cleanly. The spec's Known Risks ("Undo safety") accept hook side effects.
- Dismissed (cold-Claude): `--force` for delicate `--full-send` also bypasses conflicts. §Decision item 3 makes `--force` bypass the conflict block, and the same coupling already applied to scope drift. The bypass warns loudly, and `--ship`'s forge merge still fails on a real conflict.
- Dismissed (cold-Claude): the "`--pr aborted:`" header appears under `--push`. This is an explicit spec Non-Goal ("The abort header's '`--pr` aborted' wording under `--push` is not fixed here").
- Dismissed (cold-Claude): shared telemetry files now block on append conflicts. The spec's Known Risks ("Telemetry conflicts") call blocking correct, because `--ship` would hit the same conflict. The header already says "conflicts with origin/<base>", not "base-drift", which meets the stated mitigation.
- Cold-Codex: no actionable findings; nothing to dismiss. Its note that the test run was interrupted is recorded under the Validation Gate above.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
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

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Delta — base `87d476325052194e63ed4722f176893ca5427eec` — reason: small fix within the files already under review

### Stage 1 — Acceptance Criteria Re-Check

Anchored lens: Stage 1 pass.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | Clean-advance test passes and asserts the info line. |
| AC-2 | Met (unchanged from round 1) | Other-task artifacts on the base pass without `--force`. |
| AC-3 | Met (unchanged from round 1) | Real-conflict test unchanged and passing. |
| AC-4 | Met (unchanged from round 1) | Scope-drift tests keep their assertions. |
| AC-4b | Met (unchanged from round 1) | Combined conflict + scope message test unchanged. |
| AC-4c | Met | Dirty-doc and hook tests now require `conflicts with origin/main` and `human_review commit was undone` (`tests/run-task-safety.test.ts:6779-6781`, `:6817-6819`). |
| AC-4d | Met | Rerun half of the dirty-doc test passes. |
| AC-5 | Met (unchanged from round 1) | `--force` conflict warning test passes. |
| AC-6 | Met (unchanged from round 1) | Unsupported, fail-closed, and probe unit tests pass. |
| AC-7 | Met | `src/cli/index.ts:98-101` `--force` help now names the base-drift gate; doc and mirror in sync. |
| AC-8 | Met | Handoff: lint, type-check, build, sync-templates:check pass. The handoff's docs-refs-check failure and the 6 run-task-safety failures the anchored lens reproduced came from a broken backticked path in this review's round-1 AC-2 row, not from the implementation. The foreman rewrote that row in plain text. Re-verified by the foreman: `npm run docs-refs-check` → "All refs OK"; full `npm test` → 1534 tests, 1534 pass, 0 fail. |

### Verifying Round 1 findings

- _correctness bug:_ "AC-4c dirty-doc and hook tests don't prove a conflict abort" → addressed (`tests/run-task-safety.test.ts:6779-6781`, `:6817-6819`; AC-4c now Met) ✓
- _risk/guardrail:_ "`src/cli/index.ts:98` `--force` help omits the base-drift bypass" → addressed (`src/cli/index.ts:98-101`; AC-7 now Met) ✓
- _nits:_ pipeline-orchestrator opener and change-relative wording → addressed; patterns.md git-version note → addressed; post-conflict info line → addressed (`src/orchestrator/main.ts:1245-1247`). The undo-not-structural nit was not taken; it is still optional.

### New findings

#### Correctness Bugs

(none)

#### Optional Cleanup / Nit

- `src/cli/index.ts:98-101` (and `src/orchestrator/cli.ts`, `docs/pipeline-orchestrator.md:101`): the `--force` "currently:" list omits the docs-refs-check bypass (`src/orchestrator/main.ts:1284-1290`). This predates the task (the new line copies `src/orchestrator/cli.ts`), but it would be worth adding in a later touch. (cold-Claude)
- No test pins the new `hasConflict` info-line wording ("these files were not reported as conflicted") under `--force` + conflict + clean base advance. It is cosmetic text on a forced path. (cold-Claude)

### Dismissed Cold Findings

- Dismissed (cold-Claude): the scope-drift remediation `git checkout origin/<base> -- <path>` "often doesn't work" because the file stays task-changed in the three-dot diff. This does not hold. A file is classified out-of-scope only if it also appears in the two-dot drift list (`origin/<base>` vs `HEAD`), and after checking out the base copy that path no longer differs, so it leaves `drift` and the gate passes. The added-file case (checkout fails) is covered by the `git revert <sha>` alternative. The remediation text predates this task, and spec §Decision item 2 keeps it unchanged.
- Dismissed (cold-Claude): "these files were not reported as conflicted" is meaningless when merge-tree reports a conflict with no paths. This edge only prints under `--force`, after a warning that already says "(git did not report paths)". The wording is accurate, so this is not a defect.
- Dismissed (cold-Claude): the harness change (`git init`, `FAKE_GIT_COMMON_DIR`, `cwd=harness.dir`) silently skips docs-refs-check. Per the anchored lens's call-site check, `runHumanReviewMain` is used only by tests this task added, and none of them cover docs-refs behavior. The `git init` before PATH is faked is harmless for the existing `runHumanReviewCommit` callers. The isolation is intended: it keeps repo-level task artifacts from preempting the merge-tree assertions.
- Cold-Codex: no actionable findings; nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
