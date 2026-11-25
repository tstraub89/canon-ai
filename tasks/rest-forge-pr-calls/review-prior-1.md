# Code Review: rest-forge-pr-calls

> Reviewer: Claude (foreman synthesis) | Spec: `tasks/rest-forge-pr-calls/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens inputs this round: the anchored Claude lens returned `STAGE_1: fail` with low-confidence observations. The cold-Claude lens returned 13 findings. The cold-Codex lens reported no actionable defects; its test run had not finished when its review ended.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did the implementer's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [ ] Red-first evidence recorded for each red-first AC: **missing.** AC-8 is a regression test that "fails on the pre-change code". That makes it red-first under the spec template's bug-fix rule (`.canon/templates/spec.md:38`). The handoff's Red-First Evidence table says "None — spec has no red-first AC" (`tasks/rest-forge-pr-calls/handoff.md:65`).
- [ ] Self-Check evidence in the effective record is not contradicted by the diff: **contradicted in part.** The handoff's AC-12 edge case says "a host-qualified `-R` is forwarded through `--hostname`". The owner/repo part of that `-R` is dropped (F1). The handoff's AC-10 says the docs describe the moved helper. `docs/patterns.md` names the wrong module for `classifyMergeOutcome` (F5).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: no porcelain; one `api` helper; REST unreadable reasons; `MERGE_FLAG` gone | Pass | `runCommand('gh'` appears only in `src/orchestrator/forge.ts`, and `ghApi` adds `api` first. The porcelain strings left in `src/orchestrator/main.ts` are operator recovery hints, which the Non-Goals allow. |
| AC-2: all forge calls in `forge.ts` | Pass | `main.ts` has no direct gh invocation. |
| AC-3: REST draft create + body sources | Partial | The POST with `draft: true` and the `html_url` print are wired up. But only the template body is pinned through `--pr` (`tests/run-task-safety-worktrees-pr.test.ts`). No integration test sends the canon PR body, the QA `pr-body.md` or the commit-subject body through the REST payload. The commit-subject fallback is covered only as a forge unit with a mocked git runner (`tests/forge-rest.test.ts`). The scaffold-push base assertion was also weakened (F4). |
| AC-4: paginated exact-head lookup, three-way result | Pass | See `src/orchestrator/forge.ts:41-60`. A page-two forge test and the ship pre-flight fail/malformed tests are present. |
| AC-5: REST PR read, state mapping, fresh merge reads | Pass | `isPRMerged` re-reads every time. State mapping is pinned. The ship-proof suite passes against the REST fake (handoff). |
| AC-6: REST merge with `merge_method` | Pass | The per-method tests assert the PUT argv. |
| AC-7: `allow_*` fields, fail closed | Pass | |
| AC-8: GraphQL-blocked regression | Partial | Both shared fakes 403 every non-`api` call, so the `--pr` and `--ship` suites already run GraphQL-blocked. But no red-first evidence is recorded (Validation Gate above). |
| AC-9: #184 text | Pass | `src/cli/commands/doctor.ts`, `src/cli/deps.ts`, `src/orchestrator/cli.ts`. |
| AC-10: docs | Partial | `docs/patterns.md:214` names the wrong module for `classifyMergeOutcome`. The new `docs/codebase-map.md:60` row is malformed (F5). |
| AC-11: `dist/` matches build | Pass | The handoff build passed. `dist/` carries the new forge code and hints. The foreman did not rebuild independently. |
| AC-12: guard REST lookup | Partial | Number, `#n`, URL, `owner:branch`, bare branch and fail-open all work. A host-qualified `-R HOST/OWNER/REPO` drops OWNER/REPO (F1). |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted. The "Multiple remotes" and repo-addressing premises are questioned below as a spec gap (S1).
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 gaps: the AC-8 red-first evidence, AC-12 host-qualified `-R`, AC-3 body-source coverage, and AC-10 doc accuracy. The anchored lens skipped Stage 2 by charter. The cold-lens findings below were still verified and adjudicated, so the implementer gets the full fix list in one round.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The forge module is a clean single boundary. The REST mapping (state, pagination, exact head, fail-closed settings) is correct and well pinned at the unit level. The blocking problems are concentrated in the guard hook's ref handling, a few test-coverage holes the spec asked for explicitly, and doc accuracy. The cold lenses' host/remote-resolution concern traces back to a spec premise, not to the code (S1).

### Findings

#### Correctness Bugs

- **F1 — `code-bug` — guard drops OWNER/REPO from a host-qualified `-R`.** Flagged by 2 lenses (anchored, cold-Claude).
  - Location: `.claude/hooks/canon-guard.mjs:642-644` and the identical `templates/.claude/hooks/canon-guard.mjs`.
  - With `gh -R ghe.example/other/repo pr merge 12`, `explicitHost` is set, but `repoPath` falls back to `repos/{owner}/{repo}`. The guard then reads PR 12 of the local checkout's repo on that host. It either fails open on a task PR or blocks a non-task PR.
  - A URL-form `-R https://host/owner/repo` falls through the same way.
  - AC-12 and the Judgment Calls require "using `-R`/`--repo` when given", with `HOST/OWNER/REPO` selecting the host.
  - Fix: when there are 3 parts, use `repos/${parts[1]}/${parts[2]}`. Also handle (or deliberately fail open on) a URL-form `-R`. Add a guard test for host-qualified `-R` plus a number.
- **F2 — `code-bug` — guard URL regex rejects common PR URL suffixes, a fail-open regression.** Flagged by cold-Claude.
  - Location: `.claude/hooks/canon-guard.mjs:635` (and its mirror).
  - The regex anchors on `/pull/<n>` followed only by `#…`, `?…` or end of string. `…/pull/12/`, `…/pull/12/files` and `…/pull/12/commits` therefore return `null` and the merge is allowed.
  - Before this change, `gh pr view <url>` resolved those forms and the guard blocked them. So `gh pr merge https://github.com/o/r/pull/12/files` on a task PR now bypasses the guard.
  - Fix: accept an optional trailing path (`(?:[/#?].*)?$`) and add a test.
- **F3 — `code-bug` (test integrity / process) — AC-8 red-first evidence is missing.** Flagged by the anchored lens.
  - Location: `tasks/rest-forge-pr-calls/handoff.md:65`.
  - Run the GraphQL-blocked `--pr` and `--ship` cases against pre-fix `src/` (for example, a temporary worktree at `main` running the new fake-gh tests). Record the pre-fix failure (PR creation for `--pr`, pre-flight listing for `--ship`) in the Red-First Evidence table.
  - If a faithful pre-fix run is impractical, record the reason and the deterministic alternative.
- **F4 — `code-bug` (test integrity) — AC-3 body-source and base coverage.** Flagged by anchored and cold-Claude (different facets).
  - (a) No `--pr` integration test pins the REST payload body for the canon PR body, the QA `pr-body.md`, or the commit-subject fallback. The spec asks each body source to be verified in `tests/run-task-safety-worktrees-pr.test.ts` / `tests/run-task-safety-scaffold-push.test.ts`, with "body content pinned". Use the existing `FAKE_GH_CREATE_PAYLOAD` capture.
  - (b) `tests/run-task-safety-scaffold-push.test.ts:197` replaced `/^pr create .*--base feat\/x/` with `/^api -X POST .*pulls/`. The test no longer checks that the PR targets the non-default base `feat/x`, though the spec's Affected Files row says the base and head assertions "move to REST". Restore it by asserting `base`/`head` from the captured payload.
- **F5 — `code-bug` (AC-10 doc accuracy) — the two new doc lines are wrong.** Flagged by the anchored lens.
  - `docs/patterns.md:214` says `classifyMergeOutcome(...)` is in `src/orchestrator/forge.ts`. It is still in `src/orchestrator/main.ts` (line 108); only `isPRMerged` moved.
  - `docs/codebase-map.md:60` is a 2-cell row in a 3-column table. Add the notes cell.

#### Risk / Guardrails

- **R1 — stale GraphQL field-name restatements** (AGENTS.md restatement rule, P2). Flagged by the anchored lens. Fix these with F5:
  - `docs/pipeline-orchestrator.md:612` and its `templates/docs/pipeline-orchestrator.md` mirror still describe proof in terms of `baseRefName` / `headRefOid`.
  - The runtime message at `src/orchestrator/main.ts:2120` says "headRefOid for PR #…".
  - `docs/patterns.md:218` frames the step as tolerating "a `gh pr merge` failure".
  - Name the REST fields (`base.ref`, `head.sha`) or neutral terms ("PR base", "PR head SHA").

#### Optional Cleanup / Nit

- `--paginate --slurp` needs a fairly recent gh (`--slurp` arrived around v2.4x). On an older gh, every lookup becomes `unreadable`. The spec's Implementation Notes chose `--slurp`, so this is not blocking. Consider mentioning a minimum gh version in the doctor hint or the docs. Flagged by anchored and cold-Claude.
- `createDraftPR` / `mergePR` failures surface only `gh api`'s stderr summary (e.g. "Validation Failed (HTTP 422)"). GitHub's `errors[]` detail goes to stdout and is dropped. Consider appending a parsed `message`/`errors` from stdout to the failure text. (cold-Claude)
- `tests/forge-rest.test.ts`: the runner stub reset is not in `try/finally`, so a failing assertion leaks the stub into later tests. (cold-Claude)
- `readPR`'s argv (`-X GET repos/{owner}/{repo}/pulls/{n}`) is not pinned in the forge unit tests. Known Risks says each call's argv is asserted. (anchored)
- The shared fakes ignore `-X GET` / `--paginate` / `--slurp`, and they echo the queried head back as `head.ref`. Only the forge unit tests pin these. (anchored, cold-Claude)
- The tolerated-merge warning changed from "gh exited" to "gh api exited" (`src/orchestrator/main.ts`). That is harmless, but outside AC-3's two permitted message changes. (anchored)

#### Spec Gaps

- **S1 — `spec-gap` — repo/host addressing premise.** Flagged by cold-Claude (findings on forge host, forge `{owner}`, and the guard's bare-number host).
  - The spec's Judgment Calls ("`gh api` uses the same auth and host resolution as porcelain"; placeholders "follow gh's own host and remote resolution, including Enterprise hosts and `gh repo set-default`") and its Known Risk "Multiple remotes" assert that `gh api` matches porcelain.
  - `gh api --help` (gh 2.89.0) documents `--hostname` with default `"github.com"`. Without `--hostname`, the request host comes from gh's default host (`GH_HOST`, or the single authenticated host), not from the checkout's remote.
  - So an adopter whose remote is a GitHub Enterprise host and who is logged in to both that host and github.com would send every forge call to the wrong API host. Porcelain `gh pr …` took the host from the remote.
  - Separately, whether `gh api`'s `{owner}/{repo}` honours `gh repo set-default` the way `gh pr` does (as opposed to the plain upstream/github/origin remote priority) is unverified.
  - This does not affect github.com-only users or the spec's target environment. The implementer followed the spec's chosen addressing, so the fix (derive host/slug from `origin`, or pass `--hostname`) would contradict a recorded judgment call.
  - **Not to be changed by the implementer this round.** Recorded for the human: confirm `gh api` host and placeholder resolution, and either amend the Judgment Call/Known Risk or open a follow-up.

### Dismissed Cold Findings

- Dismissed (cold-Claude): REST merge can't enqueue in merge-queue repos, so `--ship` hard-fails there — the spec's Non-Goals explicitly exclude merge-queue support ("No merge-queue support. REST merge can't enqueue").
- Dismissed (cold-Claude): the hint says gh is needed for `--pr / --ship`, but `src/cli/deps.ts` still gates `--push` — the spec's #184 Judgment Call and Non-Goal ("No change to which CLI flags require `gh`") deliberately fix the text only. The README mismatch is already queued as a QA follow-up in the spec's Docs Impact.
- Dismissed (cold-Claude): an unguarded `fs.readFileSync(qaPrBody.path)` in `createDraftPRForTask` — `resolveQaPrBody` has just confirmed the file is a non-template body. The race window is negligible, and a throw still aborts `--pr` before any remote change.
- Dismissed (cold-Claude): the guard's bare-number lookup sends no `--hostname` on GHE — folded into S1 (same premise), not dismissed on the merits.
- Cold-Codex: no findings to dismiss. It reported "No actionable defects", with type-check and build passing and the test suite still running at review end. That gives no positive test evidence.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Address F1–F5 and R1. Leave S1's addressing model as specified; it is recorded for the human.

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.
-->

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Delta — base `8766faabd654b84588b4c5fff4b610fc3405c885` — reason: small fix within the files already under review

Lens inputs this round:
- The anchored lens read the full `main...HEAD` diff. It returned `STAGE_1: pass` with `OVERALL_SIGNAL: approve`, plus nits and the carried-over S1.
- The cold-Claude lens read the delta only and returned 8 findings, all low or medium severity.
- The cold-Codex lens read the delta only and reported no actionable regressions.

The foreman re-ran the full `npm test` at HEAD: 2268 passed, 0 failed, 0 skipped. This closes the gap that Iteration 2's Validation Outcomes table ran only focused suites. The anchored lens independently re-ran `npm run build` (`dist/` clean), `sync-templates:check` and `docs-refs-check`, and all passed.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | Only the forge helper invokes gh. `MERGE_FLAG` is gone. |
| AC-2 | Met (unchanged from round 1) | `main.ts` reaches gh only through the forge module. |
| AC-3 | Met | Canon and QA body payloads are pinned at `tests/run-task-safety-worktrees-pr.test.ts:1269-1317`. The commit-subject body is pinned through `--pr` at `tests/run-task-safety-scaffold-push.test.ts:212-230`. The scaffold cases re-assert `base: feat/x`, head, title and draft from the payload. |
| AC-4 | Met (unchanged from round 1) | Page-two, unreadable and malformed forge tests are present. |
| AC-5 | Met | `readPR` argv is now pinned at `tests/forge-rest.test.ts:44`. `isPRMerged` re-reads every time. |
| AC-6 | Met (unchanged from round 1) | |
| AC-7 | Met (unchanged from round 1) | |
| AC-8 | Met | Iteration 2's Red-First Evidence runs both GraphQL-blocked scenarios against the merge-base `c505f37`, and each fails on the GraphQL 403. Post-fix runs pass. |
| AC-9 | Met (unchanged from round 1) | |
| AC-10 | Met | `docs/patterns.md:214` and `docs/codebase-map.md:60` are corrected. The pipeline docs and their mirror use neutral field names. |
| AC-11 | Met | The anchored lens rebuilt `dist/` and found no diff. |
| AC-12 | Met | `.claude/hooks/canon-guard.mjs:635-649` (mirror identical) handles host-qualified and URL-form `-R`, and PR URLs with a trailing `/` or a subpath. Tests at `tests/canon-guard.test.ts:333-365` cover them. |

### Verifying Round 1 findings

- _correctness bug:_ F1, host-qualified `-R` dropped owner/repo → addressed. See `.claude/hooks/canon-guard.mjs:642-649`. The tests assert `--hostname ghe.example` and `repos/other/repo/pulls/12`. ✓
- _correctness bug:_ F2, PR URL suffixes failed open → addressed. See `.claude/hooks/canon-guard.mjs:635`, with tests for `/pull/12/` and `/pull/12/files`. ✓
- _test integrity:_ F3, AC-8 red-first evidence missing → addressed in the Iteration 2 Red-First Evidence table. ✓
- _test integrity:_ F4, body-source and base coverage → addressed; see the AC-3 row above. ✓
- _correctness bug:_ F5, doc inaccuracies → addressed. ✓
- _risk/guardrail:_ R1, stale GraphQL field names → addressed. `src/orchestrator/main.ts:2120`, both pipeline docs copies and `docs/patterns.md:218` are updated. ✓
- _spec gap:_ S1, repo/host addressing premise → **still open.** This round correctly left it alone, as directed, and records it as a Blocker in the handoff. It is now the only surviving blocking-class finding.

### New findings (only NEW issues introduced by Iteration 2's changes)

#### Spec Gaps

- **S1 (carried over) — `spec-gap`.** Flagged by 2 lenses: the anchored lens this round, and cold-Claude in round 1.
  - The spec's Judgment Calls (repo addressing) and its Known Risk "Multiple remotes" assume `gh api` resolves the host and `{owner}/{repo}` the same way `gh pr` does.
  - `gh api --help` (gh 2.89.0) documents `--hostname` with default `"github.com"`, so a GitHub Enterprise adopter logged in to more than one host may have every forge call sent to the wrong API host.
  - It is also unverified whether `{owner}/{repo}` honours `gh repo set-default`.
  - The code faithfully implements the spec, so the fix needs a human decision. Either:
    - amend the Judgment Call to derive host and slug from `origin` (or pass `--hostname`), and route back to implement; or
    - accept the limitation, record it as a Known Risk with a follow-up, and accept the task.

#### Risk / Guardrails (non-blocking)

- **N1: some `-R` forms still resolve to the wrong repo.** Flagged by 2 lenses (anchored, cold-Claude).
  - Location: `.claude/hooks/canon-guard.mjs:642-649` (and the mirror).
  - These `-R` values gh accepts still fall through to the cwd `repos/{owner}/{repo}` or produce a bad endpoint:
    - a `.git` suffix: `-R https://host/o/r.git` gives `repos/o/r.git`;
    - scp/ssh forms: `-R git@host:o/r`, `ssh://…`;
    - URLs with extra path segments;
    - an uppercase scheme.
  - The pre-task code passed `-R` straight to `gh pr view`, which handled these.
  - Impact: when no endpoint can be read, the guard fails open, which matches documented policy. The worse case is the cwd fallback, which reads PR N of the local repo when the `-R` value can't be parsed.
  - These are exotic forms for an agent's `gh pr merge`, so this is not blocking. Suggested follow-up: strip `.git`, and return `null` (fail open, no cwd fallback) for any non-empty `-R` that does not parse to 2 or 3 parts.
- **N2: guard ignores `GH_REPO` / `GH_HOST` env prefixes.** Flagged by cold-Claude.
  - Location: `.claude/hooks/canon-guard.mjs:324` and `:525`.
  - `GH_REPO=… gh pr merge 12` is resolved against the cwd repo.
  - This predates the task; it is a sibling of N1. Candidate follow-up.

#### Optional Cleanup / Nit

- `tests/run-task-safety-scaffold-push.test.ts:220`: `assert.notEqual(expectedBody, '')` compares a literal with `''` and asserts nothing. Remove it. The real `deepEqual` payload check is meaningful, so test integrity holds. Flagged by 2 lenses.
- The same test makes the range exactly one commit, so it pins the `origin/<base>` start point only weakly. The forge unit test pins the exact `git log` argv. Flagged by 2 lenses.
- `tests/canon-guard.test.ts:358-365`: the trailing-path and trailing-slash URL cases assert only denial, not the logged endpoint or the absence of `--hostname`. The `-R` cases don't cover the trailing-slash strip, `http://`, or `github.com/o/r`. (cold-Claude)
- Carried over from round 1, still open:
  - `tests/forge-rest.test.ts:19-25`: the stub reset is not in `try/finally`.
  - `--slurp` needs a minimum gh version, which is undocumented.
  - The stdout `errors[]` detail is dropped from create/merge failures.
  - The "gh api exited" wording at `src/orchestrator/main.ts:2264`.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `tests/run-task-safety-worktrees-pr.test.ts:1296-1308` spreads `process.env`, so an outer `CANON_PR_BODY` could leak into the `qa` case. Canon's body takes precedence over the QA body, so a leaked `CANON_PR_BODY` makes the `qa` case fail, not pass falsely. This can't mask a regression; it is environment hygiene only.
- Cold-Codex: no findings this round ("no actionable regressions"). Nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

All round-1 code findings are fixed, and no new code-bug survives adjudication. The single remaining blocking finding is S1, which traces to the spec's repo/host addressing premise. A human must decide whether to amend the spec, and so route back to implement, or to accept the limitation with a follow-up. N1 and N2 should be logged as follow-ups either way.
