# Code Review: retire-codex-md

> Reviewer: Claude | Spec: `tasks/retire-codex-md/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [ ] Validation Outcomes table has no `Fail` results — **the `docs-refs` row claims `Pass` ("All refs OK") but `npm run docs-refs-check` fails right now.**
- [x] All checks required by the spec's "Validation Required" section were run
- [ ] No required checks were skipped without justification

**Gate failure — the `docs-refs` Pass claim is false against the filled handoff.** Re-running `npm run docs-refs-check` against the working tree:

```
tasks/retire-codex-md/handoff.md:39: templates/CODEX.md — missing file
tasks/retire-codex-md/handoff.md:77: templates/CODEX.md — missing file
Found 2 broken refs
```

Why the handoff reported a false Pass: the committed handoff at HEAD (`94e3baf`) is still the *unfilled template* (placeholder Changes table / `AC-N: …` rows), which contains no templates/CODEX.md refs — so `docs-refs-check` passed when run against it. The real, filled handoff is the **uncommitted working-tree copy** (`git status` shows `handoff.md` as `M`), and filling its Changes table introduced the two backtick refs to the deleted file. `docs-refs` was not re-run after the fill.

This is not merely a stale claim — it is a structural conflict this deletion task surfaced (see the blocking finding below). It fails AC-8 directly and puts AC-7 (CI passes on the PR) at risk: the `docs-refs-check` GitHub workflow runs `npm run docs-refs-check` as a full tree walk, and the active task's `handoff.md` is in scope (only `tasks/_archive/**` and `spec`/`plan`/`notes`/`spec-review`.md are exempt; `handoff.md` is explicitly **not** exempt — `scripts/docs-refs-check.mjs:292-297`).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: content rescue, no loss | Pass | File-revert mechanics present in `AGENTS.md:117-120` — `git show origin/<base-branch>:<path>` technique + perfect/imperfect revert split, materially intact. |
| AC-2: file removed | Pass | `CODEX.md` and templates/CODEX.md both `D` in `git diff release/v1.9...HEAD`. |
| AC-3: out of canon-managed sets | Pass | `DELIMITED` (`src/lib/canon-owned.ts`), `AGENT_FILES` (`init.ts`), `ROOT_MARKDOWN_FILES` (`docs-refs-check.mjs`) all updated; `npm run sync-templates:check` → "All canon-managed files in sync" (re-verified). |
| AC-4: `canon init` stops shipping it | Pass | `init.ts` `AGENT_FILES` = `{AGENTS.md, CLAUDE.md}`; skill `SKILL.md`/`write-guide.md` no longer read/merge/`git add` `CODEX.md`. |
| AC-5: `canon doctor` warn semantics | Pass | `checkCodexMdDeprecated()` returns `null` when absent (filtered out of `canonChecks`), `warn` when present; never mutates. Logic `doctor.ts:197-204`; tests at `tests/cli.test.ts:335-350`. |
| AC-6: `canon upgrade` stops managing it | Pass | Follows from `DELIMITED` removal; comment updated `upgrade.ts:161`. |
| AC-7: CI updated | **At risk** | `test -f CODEX.md` and both `!CODEX.md`/`CODEX.md` path-filter pairs removed from `ci.yml`; `docs-refs-check.yml` filter removed. BUT "CI passes on the PR" will fail at the `docs-refs-check` job — see Validation Gate + blocking finding. |
| AC-8: references swept, lockstep | **Not Met** | `npm run docs-refs-check` does **not** pass — 2 broken refs to the deleted templates/CODEX.md in `handoff.md`. AC-8 explicitly requires "no dangling ref to the deleted file." |
| AC-9: structural allow-list — regenerated | Pass | Re-ran `git grep -l "CODEX\.md"`; every residual is allowed: historical (`CHANGELOG.md`, `docs/BACKLOG.md`, `docs/packaging-plan.md`, `tasks/_archive/**`), other live tasks (`tasks/{bundle-preflight-atomic-rejection,codex-code-review-phase}/**`), or intentional warn/test/dist (`doctor.ts`, `tests/cli.test.ts`, `dist/cli/index.js`). No missed canon surface. |
| AC-10: tests reflect intended behavior | Pass | `tests/cli.test.ts` expected-file arrays no longer list `CODEX.md`/templates/CODEX.md; new `checkCodexMdDeprecated` tests cover present→warn and absent→null. Suite reported 704 pass. |
| AC-11: build artifact declared + regenerated | Pass | `dist/cli/index.js` rebuilt (bundles `checkCodexMdDeprecated` + `DELIMITED` change) and present in diff; declared in Affected Files. |

### Dropped Sections Check

- [x] Non-goals respected (no adopter `CODEX.md` auto-deletion; historical docs untouched; no `@AGENTS.md` import change)
- [x] Known Risks addressed or documented as accepted
- [ ] Human Test Plan is satisfiable — steps 1-5 are; **step 6 ("Confirm the PR's CI checks pass") is not satisfiable** while the `docs-refs-check` job fails.

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

The implementation is otherwise strong — the code/doc sweep is complete and correct, AC-9's grep is clean, and the `doctor` warn behavior + tests are exactly right. A single blocking defect (a spec gap surfacing as a `docs-refs-check` failure) sends it back. Stage 2 not run — Stage 1 failed.

## Stage 2 — Code Quality

**Not run — Stage 1 failed.**

## Blocking finding

### Correctness bug / spec gap — `docs-refs-check` fails on the handoff's mandatory deleted-file entry (AC-8, AC-7)

**What:** `npm run docs-refs-check` fails with 2 broken refs (`handoff.md:39`, `:77`) pointing at the deleted templates/CODEX.md. AC-8 requires the check to pass; AC-7 requires the PR's CI (which runs this check as a full tree walk) to pass.

**Root cause — a catch-22 the spec did not anticipate:**

1. The orchestrator's diff→handoff reconciliation requires **every** file in `git diff <base>...HEAD` — including deletions, which `parseDiffNameStatus` pushes into `diffFiles` (`scripts/run-task/validation.ts:1148-1161`) — to appear in the handoff Changes table with a backtick-path first column (`validation.ts:1112-1116`; `parseHandoffPathCell` requires `` `path` `` or `[path](url)`). So templates/CODEX.md **must** be listed.
2. `docs-refs-check` treats a backtick ref to a non-existent file as a broken ref. `templates` **is** a valid dir (adopter config `scripts/docs-refs-config.mjs` → `validDirs: ['templates']`), so templates/CODEX.md resolves and is flagged as missing. `handoff.md` is **not** in the exempt set (`docs-refs-check.mjs:292-297` — only `spec`/`plan`/`notes`/`spec-review`.md and `_archive` are exempt; the comment states catching broken handoff refs is "the Stage 1 code reviewer's job").
3. Asymmetry that hid this: bare `` `CODEX.md` `` (top-level — e.g. the first ref on `handoff.md:77`, and the many spec.md refs) is **not** flagged because a top-level filename isn't a `validDirs` prefix. Only templates/CODEX.md trips the check. It looks identical to `CODEX.md` but is caught by path shape.

**Why "just re-run docs-refs and tidy the handoff" isn't enough:** the deleted file is *mandatory* in the Changes table (gate 1), and listing it with a backtick path *fails* gate 2. No committed state satisfies both with current tooling, so this needs a real resolution, not a wording tweak.

**Suggested resolution (implementer to choose; flag as a Blocker if neither is acceptable):**
- **Preferred — teach `docs-refs-check` to skip deletions:** ignore a backtick file-path ref whose target is a deletion in the current `git diff <base>...HEAD` (a file the same change removes and which the handoff is *required* to list). This fixes the conflict generally for any task that deletes a file under a `validDir`, and keeps the handoff's mandatory entry honest. Add a focused test. This is a small scope expansion the spec missed — document it under *Deviations*/*Blockers* and note it likely warrants a `lessons-learned` entry.
- **Alternative — verify the markdown-link form is exempt:** if `[templates/CODEX.md](…)` (the other first-column form `parseHandoffPathCell` accepts) is *not* validated as a file-path ref by `docs-refs-check`, the Changes-table row could use it. Confirm against the check before relying on it; if it's also flagged, this option is dead.

**Independent of the chosen fix:** commit the **filled** handoff (the working-tree copy) so both the diff→handoff check and the shipped record see real content — the committed HEAD handoff is still the placeholder template — and re-run `npm run docs-refs-check` against that committed state until green before `--pr`.

## Final Verdict

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested** — resolve the `docs-refs-check` / mandatory-deleted-file-entry conflict (AC-8, AC-7), commit the filled handoff, and re-run `docs-refs-check` green.
- [ ] **Needs re-review**

---

## Round 2 — verifying iteration 1's response to round 1

Iteration (Codex labels it "Iteration 2") addressed the single round-1 blocker via the *alternative* I offered: the deleted-file Changes-table cell now uses the markdown-link form `[templates/CODEX.md](templates/CODEX.md)` instead of a backtick path, and the round-1 review's prose literals were de-backticked. The code/doc diff is byte-identical to round 1 — only task artifacts (`handoff.md`, `review.md`, `notes.md`) changed.

**Independently verified (not trusting the handoff claim):**
- `npm run docs-refs-check` → **`All refs OK`** (re-ran against the working tree, which includes the committed handoff + de-referenced review.md).
- The orchestrator's diff→handoff reconciliation still covers the deleted file: `parseHandoffPathCell` extracts the path from the link **label** (`validation.ts:968-980`, `mdLinkGroups[0][1]` = the templates-mirror path), so the mandatory deletion entry is honored while docs-refs-check no longer flags it. Both gates now pass simultaneously — the catch-22 is resolved.
- The filled handoff and de-referenced review.md are now **committed** (round 1 flagged them as uncommitted); `git status` shows only `notes.md`/`status.json` (+ unrelated operator-session `docs/pipeline-invocations.md`) dirty.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: content rescue, no loss | Met (unchanged from round 1) | `AGENTS.md:117-120` — code path untouched this iteration. |
| AC-2: file removed | Met (unchanged from round 1) | `CODEX.md` + its `templates/` mirror still `D` in diff; markdown link does not recreate the file. |
| AC-3: out of canon-managed sets | Met (unchanged from round 1) | Code unchanged; `sync-templates:check` still green. |
| AC-4: `canon init` stops shipping it | Met (unchanged from round 1) | `init.ts` / skill code unchanged. |
| AC-5: `canon doctor` warn semantics | Met (unchanged from round 1) | `doctor.ts` unchanged. |
| AC-6: `canon upgrade` stops managing it | Met (unchanged from round 1) | `DELIMITED` / `upgrade.ts` unchanged. |
| AC-7: CI updated | **Met** (was At risk) | Workflow edits unchanged; the `docs-refs-check` CI job now passes (verified locally), so "CI passes on the PR" is no longer blocked. Live `canon init`+`doctor` smoke remains `human_pending` as the spec allows. |
| AC-8: references swept, lockstep | **Met** (was Not Met) | `npm run docs-refs-check` now passes — no dangling ref to the deleted file. |
| AC-9: structural allow-list — regenerated | Met (unchanged from round 1) | Canon-managed surface diff is identical to round 1; residuals still only historical / other-task / intentional warn-test-dist. The new handoff/review refs live in this task's own artifacts, outside AC-9's owned surface. |
| AC-10: tests reflect intended behavior | Met (unchanged from round 1) | `tests/cli.test.ts` / `tests/sync-canon-templates.test.ts` unchanged. |
| AC-11: build artifact declared + regenerated | Met (unchanged from round 1) | `dist/cli/index.js` unchanged this iteration. |

### Verifying Round 1 findings

- _correctness bug / spec gap — `docs-refs-check` fails on the mandatory deleted-file entry (AC-8, AC-7):_ → **addressed.** Resolved via the markdown-link cell form; docs-refs-check green and diff→handoff coverage preserved (verified above). AC-8 and AC-7 now Met.

### New findings (introduced by this iteration)

- **None blocking.** No AC regressed; no code changed.
- _optional / non-blocking (for QA + a future backlog item, not this task):_ Codex took the lower-risk **alternative** fix, not the **preferred** one (teaching `docs-refs-check` to skip files deleted in the current diff). The underlying tooling catch-22 — any task deleting a file under a `validDir` must hand-author the markdown-link cell or trip docs-refs-check — still exists for future tasks. Worth a `docs/lessons-learned.md` entry (QA owns) and/or a BACKLOG item to make `docs-refs-check` deletion-aware. This is a canon-harness improvement, correctly out of scope for retiring `CODEX.md`.
- _nit (non-blocking):_ the iteration is labeled "Iteration 2" while it addresses review round 1; the baseline implementation was the unlabeled initial pass. Harmless, no action needed.

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

The single round-1 blocker is resolved and independently verified; every AC is Met. Approved.
