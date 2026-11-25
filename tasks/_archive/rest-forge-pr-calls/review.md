# Code Review: rest-forge-pr-calls

> Reviewer: Claude | Spec: `tasks/rest-forge-pr-calls/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude (returned, `STAGE_1: pass`, signal approve), cold Claude (returned, signal changes_requested), cold Codex (injected; no actionable findings).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (AC-8 vs `main` c505f37, AC-15 vs `bd37a01`, AC-17 vs `389251c`)
- [x] Self-Check evidence in the effective record is not contradicted by the diff (record is out of order — see nit N6)

Foreman spot-check: a fresh `npm run build` leaves `dist/` unchanged, and `npm run sync-templates:check` passes.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: no gh porcelain; one forge helper | Pass | `runCommand('gh'` appears only in `src/orchestrator/forge.ts`. `MERGE_FLAG` is removed. The `gh pr …` strings left are recovery hints, which are a Non-Goal. The `gh auth token` probe goes through the same runner because Amendment Round 2 requires it (see nit N5). |
| AC-2: forge calls only in forge.ts | Pass | `src/orchestrator/main.ts` makes no direct gh calls. |
| AC-3: REST create + body order | Pass | `POST pulls` with `draft:true`. Body order is canon, then QA, then template, then commit subjects. Prints `html_url`. All four sources are tested. |
| AC-4: exact-head paginated lookup | Partial | Pagination, exact `head.ref`/base filtering, the `merged_at` mapping and `unreadable` all work. But the `head={owner}:<branch>` filter is not exact for some branch names (finding F1). |
| AC-5: PR read + merge proof | Pass | Fresh read on every call. The state mapping is pinned, and the ship-proof suite passes against the REST fake. |
| AC-6: REST merge | Pass | `PUT …/merge -f merge_method=<m>`. The merge-fail cases re-read the same PR number. |
| AC-7: allowed methods | Pass | `allow_*` booleans, failing closed. Present, absent, fail and malformed are tested. |
| AC-8: GraphQL-blocked regression | Pass | The shared fakes return 403 to porcelain calls. Red-first evidence is recorded. |
| AC-9: #184 text | Pass | doctor and deps hints now read `--pr / --ship`. The `--force` help lists the docs-refs check. |
| AC-10: docs | Pass | pipeline-orchestrator and skill (with mirrors), patterns, and the codebase-map row are updated. |
| AC-11: dist matches build | Pass | Verified by the foreman and by the anchored lens. |
| AC-12: guard REST lookup | Pass | Number, `#n`, URL, `-R`, `owner:branch` and branch forms are covered. Fail-open is kept. The mirror is identical. |
| AC-13: forge host | Pass | https, scp, `ssh://` with port, no-origin and local-path cases are pinned. |
| AC-14: guard host / `-R` parsing | Pass | Origin host on the cwd fallback, `-R` forms, and no cwd fallback for an unparseable `-R`. |
| AC-15: red-first (amendment 1) | Pass | Recorded against `bd37a01`. |
| AC-16: host gating | Pass | Alias, `ssh.github.com`, and Enterprise with and without auth are tested. No token in output. |
| AC-17: red-first (amendment 2) | Pass | Recorded against `389251c`. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is clean and well tested. Every porcelain call is replaced by a small forge module, the merge-proof semantics are kept, and the guard now works where GraphQL is blocked. Two lenses independently found one real defect in how the REST listing query is built. The anchored lens confirmed it against real gh 2.89.0. It is a one-line fix. Everything else is nits, or was dismissed with spec evidence.

### Findings

#### Correctness Bugs

- **F1 (code-bug; flagged by 2 lenses: anchored and cold-Claude; anchored lens confirmed with real gh).** `src/orchestrator/forge.ts:81`: `lookupPRByBranch` builds `head={owner}:${encodeQuery(branch)}`. `gh api` expands both placeholder forms anywhere in the endpoint, query string included: `{owner}` and the legacy `:owner`/`:repo`/`:branch` (regex `:(owner|repo|branch)\b`). For a branch whose name starts with `owner`, `repo` or `branch` followed by a word boundary (for example `repo-x` or `branch/foo`), the separator colon and that word are replaced. The request becomes `head=<owner><reponame>-x`. GitHub ignores the invalid filter and returns every PR in that state, page after page. The exact `head.ref` check in code keeps the answer correct, so this is not data loss. But the lookup is no longer the exact `{owner}:<branch>` filter AC-4 requires, and `--pr`/`--ship` page through the whole repo's PR history. Branch names are not always `task/<id>`: `status.json.branch` and the current-branch path in `--pr`/`--push` can hold any name. Fix: send the separator percent-encoded (`{owner}%3A${encodeQuery(branch)}`). Also make `encodeQuery` stop un-escaping `:`, or keep it un-escaped only where no placeholder can follow. Add a forge test that pins the argv for a branch like `repo-x`. Check whether the guard's endpoint strings need the same treatment. They currently put no `:` before a user-controlled word in a `gh api` path.

#### Risk / Guardrail

(none blocking — see nits)

#### Optional Cleanup / Nit

- **N1** `.claude/hooks/canon-guard.mjs:635` (and its mirror): the PR-URL regex `^https?://` is case-sensitive, while `-R` parsing is case-insensitive. `gh pr merge HTTPS://github.com/o/r/pull/12` fails open. Add the `i` flag, and strip `:port` from the URL host before passing `--hostname` (anchored lens).
- **N2** `.claude/hooks/canon-guard.mjs:653` (and its mirror): the comment "Mirrors parseRemoteHost in canon-ai's forge module" sits above `normaliseGhHost`, not `parseRemoteHost`. This `.mjs` ships to adopters verbatim (tsup does not strip it), so they would read a pointer to canon-ai source they don't have. Reword it to say the helpers mirror canon's own host-resolution rules, and place it correctly (anchored lens).
- **N3** `src/orchestrator/main.ts:1328`: `reportOrCreatePR` discards `createDraftPR`'s returned `number` and lists PRs again. If the re-list fails, canon dies with "could not retrieve its PR number" even though it already has the number. Prefer `created.number` when present. This needs `createDraftPRForTask` to return it. The re-list predates this task (cold-Claude).
- **N4** `src/orchestrator/main.ts` (`establishMergeProof`): `isPRMerged`, `getPRBaseRefName` and `getMergedPRHeadSha` each make their own `readPR` call for the same pinned PR. Immutable fields could share one read. Merge state must still be read fresh, as AC-5 requires (cold-Claude).
- **N5** `tasks/rest-forge-pr-calls/spec.md` AC-1 still says every gh call "always passes `api` as the first argument", while Amendment Round 2 requires `gh auth token` through the same runner. The later amendment governs and the code follows it. QA should note the stale AC wording. This does not drive a verdict (anchored lens; the anchored lens raised it as a spec-gap, and the foreman reclassified it because the amendment already resolves the conflict).
- **N6** `tasks/rest-forge-pr-calls/handoff.md`: the Self-Check record is out of order. The baseline block was overwritten with Iteration-4 content, there is no Iteration-3 section, and Iteration 4 has no `### Self-Check`. On the next iteration, add a proper iteration subsection instead of rewriting the baseline (anchored lens).
- **N7** `tests/forge-rest.test.ts:46-53`: the "two pages" test feeds two NDJSON lines from one fake invocation. That is faithful to `--paginate --jq '.[]'` output, but the test name overstates what it covers. Rename it or add a comment (anchored lens).
- **N8** `src/orchestrator/forge.ts`: when the listing call fails with non-empty stderr, the `unreadable` reason is raw gh stderr with no "GitHub REST pull-request listing" prefix. Consider prefixing it (anchored lens).
- **N9** `src/orchestrator/main.ts` reflowed comments: some very long lines, a sentence that starts lowercase, and the `findMergedPRNumber` comment still cites the gh porcelain issue as the reason for the exact match (anchored lens).
- **N10** `docs/pipeline-orchestrator.md`: the REST statement could explain how the API host is chosen (`origin`'s host, passed only when gh is logged in to it) and mention the `GH_HOST` workaround for SSH-alias Enterprise origins (anchored lens).

#### Spec Gaps

(none — the anchored lens's two spec-gap items are N5, resolved by Amendment Round 2, and the follow-up below)

Follow-ups for QA to log (not blocking):
- The guard does not block `gh api -X PUT …/pulls/<n>/merge`. The spec lists this as a Non-Goal follow-up. Cold-Claude rightly notes that this diff now documents `gh api` as canon's merge path, which makes the bypass more discoverable. This raises the follow-up's priority.
- `mergePR` sends no `sha` pin. Pre-existing gap; REST makes the fix a one-field change (cold-Claude).
- The `lookupPRUrl` fallback when a PR read fails is GitHub.com-only, so an Enterprise origin gets a wrong banner URL. Pre-existing (anchored lens, from the handoff).

### Dismissed Cold Findings

- Dismissed (cold-Claude): an empty listing is now `none`, not `unreadable`, which loosens fail-closed. Reason: required by the design. `--paginate --jq '.[]'` prints nothing for zero results, so empty output is the normal "no PR" signal. A gh that exits 0 with empty output and no data is not a realistic failure. The later merge-proof gate still fails closed before any branch deletion. The anchored lens raised the same point and judged it necessary.
- Dismissed (cold-Claude): guard with `-R owner/name` (no host) on an Enterprise origin reads from gh's default host and fails open. Reason: this is the behavior `gh pr view -R` had before. Amendment Round 2 deliberately gates host selection only for the cwd fallback and for explicit hosts, and the spec keeps fail-open (`docs/decisions.md`).
- Dismissed (cold-Claude): the gh hint says `--pr / --ship`, but `src/cli/deps.ts` still gates `--push`/`--full-send`. Reason: the spec's "#184 scope" judgment call and the Non-Goal "No change to which CLI flags require `gh`" fix the text only. The spec's Docs Impact already routes the gating mismatch to QA as a follow-up.
- Dismissed (cold-Claude): the recovery hint at `src/orchestrator/main.ts:2721` still suggests a prefix-matching `gh pr list --head`. Reason: the spec Non-Goal explicitly excludes recovery hint strings that suggest a `gh` command for the operator to run.
- Dismissed (cold-Claude): NDJSON parsing breaks under forced TTY/color. Reason: gh disables color for piped stdout. The anchored lens verified with real gh 2.89.0 that the output is compact, one object per line. The old `--json` path had the same exposure.
- Dismissed (cold-Claude): the commit-subject fallback differs from `--fill` and needs `origin/<base>` locally. Reason: AC-3 mandates the commit-subject fallback over `origin/<base>..<branch>`. `--pr` has already fetched and pushed relative to `origin/<base>`, and failure degrades to a warning and an empty body.
- Not dismissed but downgraded: the cold-Claude findings on `created.number` reuse, triple `readPR` and the missing merge `sha` are verified. They are recorded as N3, N4 and a follow-up because they predate this task or are efficiency-only.
- Cold-Codex: no findings to adjudicate. Its "no actionable regressions" is outweighed on F1 by two Claude lenses with real-gh evidence.

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

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `4971182971b79cf3302abcaf301701f28bd5fb42` — reason: small fix within the files already under review

Lenses: anchored Claude (returned, `STAGE_1: pass`, signal approve), cold Claude (returned on the delta, signal approve), cold Codex (injected; no actionable issues).

### Stage 1 — Acceptance Criteria Re-Check

Foreman spot-check: a fresh `npm run build` leaves `dist/` unchanged, `npm run sync-templates:check` passes, and `tests/forge-rest.test.ts` passes (30/30). The anchored lens also ran the full `npm test` (2319 pass, 0 fail) plus lint, type-check and `docs-refs-check`, all passing.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | `runCommand('gh'` appears only in `src/orchestrator/forge.ts`. |
| AC-2 | Met (unchanged from round 1) | No direct gh calls in `src/orchestrator/main.ts`. |
| AC-3 | Met (unchanged from round 1) | REST create, the four body sources, and `html_url`. |
| AC-4 | Met | F1 is fixed: `head={owner}%3A<branch>` at `src/orchestrator/forge.ts:81`, and `encodeQuery` no longer un-escapes `:`. The anchored lens confirmed with real gh 2.89.0 that the request is `head=<owner>%3Arepo-x`. Pinned by `tests/forge-rest.test.ts:57`. |
| AC-5 | Met (unchanged from round 1) | The ship-proof suite passes against the REST fake. |
| AC-6 | Met (unchanged from round 1) | REST merge, with read-back on failure. |
| AC-7 | Met (unchanged from round 1) | `allow_*` reads fail closed. |
| AC-8 | Met (unchanged from round 1) | The fakes decode `%3A` correctly, and the GraphQL-blocked flows pass. |
| AC-9 | Met (unchanged from round 1) | |
| AC-10 | Met (unchanged from round 1) | |
| AC-11 | Met | `dist/` matches a fresh build and carries the fix. |
| AC-12 | Met | Only guard comments changed, and the mirror is identical. |
| AC-13 | Met (unchanged from round 1) | |
| AC-14 | Met (unchanged from round 1) | |
| AC-15 | Met (unchanged from round 1) | Red-first evidence against `bd37a01`. |
| AC-16 | Met (unchanged from round 1) | |
| AC-17 | Met (unchanged from round 1) | Red-first evidence against `389251c`. |

### Verifying Round 1 findings

- _correctness bug:_ "F1 — gh placeholder expansion of `head={owner}:<branch>`": addressed at `src/orchestrator/forge.ts:64` and `src/orchestrator/forge.ts:81`. AC-4 is now Met in the table above. ✓
- _nit:_ N2 (adopter-facing guard comment): addressed at `.claude/hooks/canon-guard.mjs:653`, with the mirror synced. ✓
- _nit:_ N7 (pagination test name): addressed at `tests/forge-rest.test.ts:47`. ✓
- _nit:_ N6 (handoff Self-Check order): partly addressed. See R2-N1.
- _nits:_ N1, N3, N4, N5, N8, N9 and N10 are still open. They are optional and non-blocking. N1 (case-insensitive guard URL regex) is the most worthwhile to pick up.

### New findings (only NEW issues introduced by Iteration 1's changes)

- **R2-N1 (nit, anchored).** `tasks/rest-forge-pr-calls/handoff.md:121`: the new iteration section has the same heading as an older section at `tasks/rest-forge-pr-calls/handoff.md:221` ("Iteration 2 — addressing review round 1"), and it sits above "Iteration 4". Document order no longer matches chronology, so a "latest Iteration block" reader could pick the stale block. Number new sections uniquely and append them at the end.
- **R2-N2 (nit, anchored).** `tests/forge-rest.test.ts:57`: the fake returns the match for any endpoint, so the argv assertion is what pins the regression. A one-line comment saying so would make the intent clear.
- **R2-N3 (nit, cold-Claude).** `tests/forge-rest.test.ts:57`: the stub runner cannot prove that real gh leaves `{owner}%3A…` alone. A comment naming gh's `:owner|:repo|:branch` placeholder pattern would document why the encoding is load-bearing. The anchored lens's real-gh run confirms the behavior for now.
- **R2-N4 (nit, cold-Claude).** `.claude/hooks/canon-guard.mjs:653`: "mirrors canon's forge behavior" slightly overstates the match, because the forge also gates on gh auth. This is cosmetic.

### Dismissed Cold Findings

- Dismissed (cold-Claude): no test covers a colon inside a branch or base name, so restoring the `%3A`→`:` un-escape would go undetected. Reason: git ref names cannot contain `:` (`git check-ref-format`), so no valid branch or base name hits that path. The head-separator test pins the reachable regression.
- Dismissed (cold-Claude): the guard puts URL- or `-R`-derived owner/repo into `gh api` endpoints without encoding, so placeholder tokens could expand. Reason: GitHub owner and repo names cannot contain `{`, `}` or `:`, so only a malformed ref reaches this. The guard fails open on lookup failure by settled decision (`docs/decisions.md`), so the worst case equals today's behavior for a bad ref.
- Cold-Codex: no findings this round. It agrees with both Claude lenses that the delta is correct.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
