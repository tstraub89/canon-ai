# Code Review: rest-forge-pr-calls

> Reviewer: Claude | Spec: `tasks/rest-forge-pr-calls/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens inputs: the anchored Claude lens returned `STAGE_1: pass` with `OVERALL_SIGNAL: changes_requested`. The cold-Claude lens returned 11 findings with `COLD_OVERALL_SIGNAL: changes_requested`. Cold-Codex found no actionable defects; it reported type-check and sync-templates passing. An earlier handoff-structure pre-flight rejection (Self-Check table shape) was resolved before this review.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC. AC-8 was run against `main`. AC-15 was run against pre-amendment `bd37a01`; the forge run needed seam-only stubs, as disclosed.
- [x] Self-Check evidence in the effective record is not contradicted by the diff

The anchored lens independently checked several of the handoff's claims:
- A fresh build from `git archive HEAD` matches the committed `dist/`.
- The forge and guard suites (172 tests) pass, and the ship-proof, ship-docs-fold, scaffold-push and base-drift suites (188 tests) pass.
- `sync-templates:check` and `type-check` pass.

The lens did not re-run the full `npm test` suite or `tests/run-task-safety-worktrees-pr.test.ts`; for those, the handoff's Pass is unverified.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: REST-only gh via one helper | Pass | `ghApi` in `src/orchestrator/forge.ts:38` is the only `runCommand('gh'` site and always puts `api` first. `MERGE_FLAG` is gone. The `unreadable` reasons describe the REST listing. |
| AC-2: all forge calls in forge.ts | Pass | `src/orchestrator/main.ts` calls `splitForge.*` and has no direct gh calls. |
| AC-3: draft create + body sources | Pass | `POST …/pulls --input` sends `draft:true`. Payload tests cover the canon body, QA body, template and commit-subject fallback. The warning text is updated. The `html_url` print is unasserted (nit N5). |
| AC-4: paginated exact lookup | Pass | `--paginate --slurp`, exact `head={owner}:<b>`, base filter, and a re-check of `head.ref`/`base.ref` in code. A forge test covers a match on page two, and ship tests cover unreadable and malformed responses. See C2 on `--slurp`. |
| AC-5: PR fields and merge proof | Pass | `readPR` maps the state as the spec requires. Nothing is cached. The ship-proof suite passes against the REST fake. |
| AC-6: REST merge + tolerated failure | Partial | Per-method `PUT …/merge -f merge_method=<m>` is pinned. The merge-fail-not-merged case exists (`tests/run-task-ship-docs-fold.test.ts:677`). The AC also requires a **merge-fail-but-merged** case, and none exists end to end. See C1. |
| AC-7: allowed merge methods | Pass | The `allow_*` fields are parsed in forge and fail closed. The present/absent/fail/malformed ship tests use the REST call. |
| AC-8: GraphQL-blocked regression | Pass | Both fake gh helpers reject every non-`api` call with the GraphQL 403. Red-first run against `main`. |
| AC-9: #184 text | Pass | `src/cli/commands/doctor.ts`, `src/cli/deps.ts` and the `--force` help in `src/orchestrator/cli.ts` are updated. |
| AC-10: docs | Pass | The pipeline doc and its mirror, the skill and its mirror, `docs/patterns.md` and the `docs/codebase-map.md` row are all updated. sync-templates passes. |
| AC-11: dist matches build | Pass | Verified by the anchored lens's clean rebuild. |
| AC-12: guard REST lookup | Pass | Handles a number, `#n`, a URL, `-R`, `owner:branch` and a branch ref. Still fails open, and the mirror is identical. |
| AC-13: forge `--hostname` | Pass | The https, scp, `ssh://` with port, and no-origin cases are pinned. See SG1 for a spec-level problem with the literal-host rule. |
| AC-14: guard host and `-R` parsing | Pass | Covers the origin-host fallback, the `-R` forms, `.git` and `/` stripping, and no read for an unparseable `-R`. |
| AC-15: red-first for the amendment | Pass | Recorded against `bd37a01`, failing for the spec's stated reasons. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work). One recovery string was reworded against the Non-Goal; see nit N1.
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

The AC-6 Partial is a missing required test case, not a gap in the implementation. It is carried as a Stage 2 code-bug (C1) rather than failing the gate.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The migration is clean and complete. All forge traffic goes through one REST helper, caller contracts and messages are preserved, the merge-proof state mapping is correct and read fresh, and the guard's REST lookup matches AC-12/AC-14. Two things block it:
- **A required AC-6 test is missing.** The merge-fail-but-merged case has no end-to-end test.
- **The `--slurp` listing needs a recent gh.** On older gh it fails, so `--pr` and `--ship` stop working there, even though the spec allowed a flatten that works on any version.

Separately, two lenses independently found that Amendment 1's literal-origin-host rule breaks SSH-alias and `ssh.github.com` origins that worked on `main`. That is a spec gap the human has to settle (SG1).

### Findings

#### Correctness Bugs

- **C1 (code-bug, test integrity / AC-6 verification). Source: anchored lens.**
  - **Problem:** AC-6 says to verify the merge step with "the merge-fail-but-merged and merge-fail-not-merged cases". No end-to-end `--ship` test sets `FAKE_GH_MERGE_FAIL=1` together with a merged read-back. So nothing pins the wiring at `src/orchestrator/main.ts:2258` (`splitForge.isPRMerged(prNum)` after a failed `PUT`), the fresh `GET …/pulls/<n>` read, or the "exited non-zero and was tolerated" warning. `FAKE_GH_MERGE_FAIL` is used only at `tests/run-task-ship-docs-fold.test.ts:677`, the not-merged case. That test also doesn't assert that the per-number read happened.
  - **Fix:** add the merge-fail-but-merged ship test. It should assert the tolerated warning, the `GET` after the failed `PUT`, and that cleanup proceeds. Also assert the `GET` in the existing not-merged case.
- **C2 (code-bug, regression risk). Flagged by 2 lenses (anchored and cold-Claude).**
  - **Problem:** `src/orchestrator/forge.ts:66` lists PRs with `gh api --paginate --slurp`, and `--slurp` exists only in newer gh releases (about 2.48+). On older gh, which includes some distro-packaged builds, the listing exits non-zero, so the lookup always returns `unreadable`.
    - `--ship` dies at its pre-flight.
    - `--pr` treats the PR as absent, really creates it, then dies on the follow-up re-list (`src/orchestrator/main.ts:1328`). A re-run tries to create the PR again and gets GitHub's "already exists" 422. The recovery the error message advertises can't succeed.
    - The porcelain path worked on those versions, and `canon doctor` doesn't check the gh version.
  - **Why it's a code-bug:** the spec's Implementation Notes allowed "`--slurp` (or a jq flatten)". The implementer can avoid the version floor within the spec.
  - **Fix:** paginate without `--slurp`, either with `--jq '.[]'` per page or by parsing the concatenated page arrays. Optionally fall back to `created.number` when the post-create re-list fails (see N2).

#### Risk / Guardrails

(none beyond C2)

#### Optional Cleanup / Nit

- **N1** `src/orchestrator/main.ts:2192` (cold-Claude): the recovery text now says the guard "blocks direct merges of task PRs". That is broader than the truth: the guard blocks only `gh pr merge`, not `gh api …/merge` (a Non-Goal) and not UI merges. The spec's Non-Goals also say recovery hint strings are left unchanged. Restore the precise wording, for example "blocks `gh pr merge` of task PRs".
- **N2** `src/orchestrator/main.ts:1272` and `:1328` (both Claude lenses): `createDraftPR` returns `number`, but it is discarded and the PR is re-listed. The spec allows the re-list. Using `created.number` as a fallback when the re-list fails would remove the duplicate-create loop described in C2.
- **N3** `.claude/hooks/canon-guard.mjs:635` (anchored): the PR-URL regex has no `i` flag, so `HTTPS://…/pull/12` fails open. A URL with a port passes `host:port` to `--hostname`.
- **N4** `tests/forge-rest.test.ts:114-116` (anchored): `argv.includes('/pulls?')` and the two similar checks test whole elements, so these routing branches are dead code. The assertions don't depend on the responses, so this is misleading rather than unsound. The host-case test also pins the exact argv for only one operation.
- **N5** AC-3's `html_url` "Draft PR created:" output is not asserted by any test (anchored).
- **N6** `tests/run-task-safety-scaffold-push.test.ts:220` (anchored): `assert.notEqual(expectedBody, '')` compares a literal against itself and can never fail. The body is still asserted at line 226, so it is harmless, but it should be removed.
- **N7** `tests/run-task-ship-helpers.ts:79` (anchored): the ship fake marks every `state=closed` listing entry as merged, so it can't model a closed-but-unmerged PR. The guard test shim (`tests/canon-guard.test.ts`) also depends on argv order.
- **N8** `src/orchestrator/main.ts:2045` (anchored): an edited doc comment starts mid-sentence in lowercase.
- **N9** `docs/pipeline-orchestrator.md:602` and its mirror (anchored): the docs don't say that the API host follows `origin`. That would help operators debugging GHE or alias setups, especially after SG1 is resolved.
- **N10** `src/orchestrator/forge.ts:65` (cold-Claude, low confidence, unverified): gh's placeholder filling also recognizes `:owner` and `:repo`. In `head={owner}:<branch>`, a branch whose name starts with `owner`, `repo` or `branch` followed by a word boundary could be rewritten. Canon's `task/<id>` branches are unaffected.

#### Spec Gaps

- **SG1 (spec-gap). Flagged by 2 lenses (anchored and cold-Claude).** Affects `src/orchestrator/forge.ts:23-41`, `.claude/hooks/canon-guard.mjs:662` and its mirror.
  - **Problem:** Amendment 1 / AC-13 / AC-14 require `--hostname` to be the origin URL's host taken literally. gh doesn't resolve hosts that way: it translates SSH config aliases and normalizes `*.github.com` hosts (for example `ssh.github.com`) to `github.com`.
    - Origins like `git@github-work:o/r.git` (multi-account alias) or `ssh://git@ssh.github.com:443/o/r.git` (GitHub's port-443 firewall form) now send `gh api --hostname github-work|ssh.github.com`, which gh has no login for. Every forge call fails: `--ship` dies in its pre-flight and `--pr` can't find or create a PR. These setups worked on `main`.
    - The guard's numeric lookup fails and silently fails open.
    - Whenever origin parses, `--hostname` also overrides a user's `GH_HOST`.
  - **Why it's a spec gap:** the implementation matches AC-13 exactly; the spec's host rule is wrong. The fix needs a decision only the spec can make:
    - normalize `*.github.com` to `github.com`;
    - resolve aliases with `ssh -G`;
    - pass `--hostname` only when gh is logged in to that host;
    - or retry without `--hostname` before reporting `unreadable`.
  - **Test gap:** the guard test shim and forge tests don't model a host gh can't authenticate to, so no test covers this.
  - **Next step:** the human should amend the spec. Unless it is amended, the next review round will return `spec_gap` once C1 and C2 are fixed.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the guard doesn't block `gh api -X PUT …/pulls/N/merge` (or GraphQL `mergePullRequest`). This is out of scope: the spec's Non-Goals say "The guard hook does not start blocking `gh api -X PUT …/pulls/<n>/merge` … Track it as a follow-up." The overclaiming message text is kept as N1.
- Dismissed (cold-Claude): a fork origin combined with `gh repo set-default` pointing upstream breaks the `{owner}:<branch>` head filter and the same-repo `head` on create. The spec accepts this: see the *Repo addressing* judgment call and the *Head filter owner* Known Risk ("A PR opened from a fork wouldn't match, the same as today").
- Dismissed (cold-Claude): the recovery hint still tells operators to run `gh pr list --head <branch> --state merged`. The spec's Non-Goals say "No change to recovery hint strings that suggest a `gh` command for the operator to run (e.g. 'Verify the PR was merged: gh pr list …')".
- Dismissed (cold-Claude): the guard returns a non-numeric, non-URL ref unchanged as the head, and a scheme-less URL is treated as a branch. This is spec-defined: AC-12's classification says "Any other ref is a branch name and is treated as the head directly", and URLs are `http(s)://` only.
- Dismissed (cold-Claude): `originHost()` spawns `git remote get-url` on every REST call. Amendment 1's Affected Files row asks for exactly that ("Derive the `origin` host once per call"), and the cost is negligible.
- Dismissed (cold-Claude): the guard test shim ignores `--hostname`. This is folded into SG1's test-gap note rather than treated as a separate test-integrity defect, because the current tests do assert the logged `--hostname` (AC-14).
- Cold-Codex: no findings to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Code-bugs C1 and C2 drive `changes_requested`. SG1 is a real spec gap, recorded for the human. The implementer should not change the AC-13 host rule without a spec amendment.

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

**Scope:** Delta — base `8d098d1fac27a5cd9cfd926a78b668fc1e8b08b3` — reason: small fix within the files already under review

Lens inputs:
- **Anchored lens** (full `main...HEAD` diff, spec, handoff, round-1 review): `STAGE_1: pass`, `OVERALL_SIGNAL: approve`. It noted that SG1 is still binding.
- **Cold-Claude lens** (delta only): six findings, `changes_requested`.
- **Cold-Codex** (delta only): one P1, multi-line jq objects.

The handoff section that addresses round 1 is headed `## Iteration 2 — addressing review round 1`. Its `## Iteration 1` section covered the earlier pre-flight rejection.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | `ghApi` in `src/orchestrator/forge.ts:38` is still the only gh runner and always puts `api` first. |
| AC-2 | Met (unchanged from round 1) | `src/orchestrator/main.ts` calls only `splitForge.*`. |
| AC-3 | Met (unchanged from round 1) | The `html_url` print is still unasserted (N5). |
| AC-4 | Met | The listing is now `-X GET --paginate --jq .[]` (`src/orchestrator/forge.ts:66`), parsed as one object per line, with the head/base/state re-check kept. The argv and the second-result match are pinned in `tests/forge-rest.test.ts:17-24`. Output format checked against real gh 2.89.0 (see the Codex dismissal). |
| AC-5 | Met (unchanged from round 1) | `readPR` mapping is unchanged and read fresh each time. |
| AC-6 | Met | The new test `tests/run-task-ship-docs-fold.test.ts:698` covers merge-fail-but-merged: exit 0, the tolerated warning, archive and branch deletion, and a GET of `pulls/107` after the failed PUT. The not-merged test (`:656-695`) now also asserts that GET. |
| AC-7 | Met (unchanged from round 1) | |
| AC-8 | Met | Both fakes still return the GraphQL 403 for anything that isn't `api`. |
| AC-9 | Met (unchanged from round 1) | |
| AC-10 | Met | Restatement sweep for `--slurp`, "direct merges" and "array of pages" is clean. |
| AC-11 | Met | Anchored lens rebuild: `dist/cli/index.js` is byte-identical. `dist/orchestrator/run-task.js` differs only in one esbuild path comment, caused by the lens's node_modules symlink. |
| AC-12 | Met (unchanged from round 1) | |
| AC-13 | Met (unchanged from round 1) | Matches the spec as written; SG1 still applies. |
| AC-14 | Met (unchanged from round 1) | |
| AC-15 | Met (unchanged from round 1) | Baseline red-first evidence against `bd37a01` stands. |

Validation gate: the Iteration 2 Validation table re-ran only the 5 affected suites (249 tests), not the full `npm test` the spec requires. The anchored lens ran the full `npm test` on HEAD itself: 2304 tests, 2304 pass, 0 fail. So the check passes, but the handoff's own record for this iteration is incomplete (nit R2-N1). The effective Self-Check record (Iteration 2 rows) is not contradicted by the diff.

### Verifying Round 1 findings

- _correctness bug:_ C1, the AC-6 merge-fail-but-merged test, was missing → **addressed**. See `tests/run-task-ship-docs-fold.test.ts:698` and the added GET assertion at `:690-694`. AC-6 is now Met.
- _correctness bug:_ C2, the `--slurp` version floor → **addressed**. `src/orchestrator/forge.ts:66` uses `--paginate --jq .[]`, which works on long-standing gh versions. With C2 fixed, N2's duplicate-create loop now needs a real listing failure after a successful create.
- _nit:_ N1, the recovery text overstated the guard → **addressed**. `src/orchestrator/main.ts:2192` now says "blocks \`gh pr merge\` of task PRs", and `dist/` matches.
- _nits:_ N2–N10 → not claimed and still open. They are non-blocking.
- _spec gap:_ SG1, literal origin host vs gh's SSH-alias and `ssh.github.com` normalization → **still open**.
  - `tasks/rest-forge-pr-calls/spec.md` has not been amended; only Amendment 1 exists.
  - The implementer correctly recorded it as a `[spec-gap]` Blocker in Iteration 2 and left the AC-13 rule as written.

### New findings (only NEW issues introduced by Iteration 2's changes)

No new code-bugs.

**Spec gap (carried from round 1)**
- **SG1 (spec-gap).** Flagged by 2 lenses in round 1; the anchored lens carries it forward this round. Affects `src/orchestrator/forge.ts:23-41`, `.claude/hooks/canon-guard.mjs:662` and its mirror. See the round-1 SG1 entry for details.
  - **Problem:** origins such as `git@github-work:o/r.git` and `ssh://git@ssh.github.com:443/o/r.git` produce a `--hostname` that gh has no login for. Every forge call then fails, and the guard silently fails open. Both setups worked on `main`.
  - **Next step:** the human has to choose the host rule and amend the spec: normalize `*.github.com`, resolve aliases with `ssh -G`, pass `--hostname` only for hosts gh is logged in to, or retry without it.

**Nits**

The 2-lens items below were each verified and judged non-blocking.

- **R2-N1** `tasks/rest-forge-pr-calls/handoff.md` (Iteration 2 Validation), anchored lens: the full `npm test` the spec requires was not re-run for this iteration. It passes on HEAD per the anchored lens (2304/2304).
- **R2-N2** `src/orchestrator/forge.ts:69`, flagged by 2 lenses (anchored and cold-Claude): a successful empty output now maps to `none` instead of `unreadable`.
  - **Why it is needed:** with `--jq '.[]'`, gh prints nothing for an empty page, so empty output is gh's real signal for "no PRs". Verified: `[]` gives empty stdout with exit 0. An empty or HTML 200 body makes gh exit 1, which maps to `unreadable`.
  - **Why it is not blocking:** only an anomalous empty success, such as a 204 on a list endpoint, is misread as `none`. That still can't trigger the destructive `--ship` steps, because merge proof needs a `found` merged PR or a pinned PR read back as MERGED.
  - **Suggestions:** record the change of meaning in the handoff Interpretations, or use a sentinel filter such as `--jq '"page", .[]'` if a positive "got a page" signal is wanted.
- **R2-N3** `src/orchestrator/forge.ts:70-75`, flagged by 2 lenses (anchored and cold-Claude): with `GH_FORCE_TTY` or `CLICOLOR_FORCE=1` in the operator's environment, gh prints indented, ANSI-colored JSON over several lines.
  - **Effect:** every listing becomes `unreadable`. This fails closed.
  - **Not new:** the same environment breaks every other forge `JSON.parse` site, and it broke `gh pr list --json` on `main`.
  - **Suggestion:** clear those variables, or set `NO_COLOR=1`, in the forge runner.
- **R2-N4** `tests/forge-rest.test.ts:17-33`, anchored and cold-Claude:
  - The "every REST page" test can't tell pages apart under `--jq`; rename it or add a comment.
  - The `'[]'` fixture is not something real gh prints; a raw scalar like `'"x"'` matches gh's error-object output.
  - Untested parse paths: a good line followed by a malformed or scalar line, and a `{}` line.
- **R2-N5** `tests/run-task-ship-docs-fold.test.ts:698`, cold-Claude: `FAKE_GH_PR_STATE=MERGED` makes every per-number read report MERGED, so the test proves that a GET follows the PUT, not that the post-failure read caused the outcome. A fake that flips to MERGED only after the PUT would pin that causality. It is not blocking because AC-6's "read fresh" requirement is otherwise met.
- **R2-N6** `src/orchestrator/forge.ts:76-77`, anchored and cold-Claude: the second `object(raw)` and the `!entry` guard are redundant after the parse loop, which already filtered with `object()`.

### Dismissed Cold Findings

- **Dismissed (cold-Codex):** [P1] "`gh api --jq '.[]'` can pretty-print each object across multiple lines, so the line-split parser rejects valid responses." This does not hold for how canon runs gh. Canon captures gh's stdout through a pipe, so stdout is not a terminal, and in that mode gh 2.89.0 prints `--jq` object results as compact JSON, one per line. Embedded newlines stay escaped (`"line1\nline2"`).
  - Two independent checks against a local fake API confirmed this: one by the foreman, and the anchored lens's probe, which included paginated `Link` pages and U+2028.
  - Multi-line output appears only when the operator forces terminal/color mode (`GH_FORCE_TTY`, `CLICOLOR_FORCE`). That fails closed and predates this change; it is kept as nit R2-N3.
- **Dismissed (cold-Claude):** the reworded hint "blocks \`gh pr merge\` of task PRs" might read as sanctioning `gh api` merges. Round 1's N1 asked for exactly this wording because it is accurate. The `gh api` merge block is an explicit Non-Goal in `tasks/rest-forge-pr-calls/spec.md` ("The guard hook does not start blocking `gh api -X PUT …/pulls/<n>/merge`"), and the hint directs the operator to the GitHub UI.
- The other cold-Claude findings (empty→none, forced color, missing parse-path tests, merge-fail test causality, redundant `object()`) were verified and kept as nits R2-N2 to R2-N6.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

The round-1 code-bugs C1 and C2 are fixed, and no new code-bugs survive adjudication. SG1 remains: the implementation matches AC-13 / AC-14 as written, but the spec's literal-origin-host rule breaks SSH-alias and `ssh.github.com` origins that worked on `main`. Fixing it needs a decision from the human and a spec amendment, so this halts for the human rather than routing back to implement.
