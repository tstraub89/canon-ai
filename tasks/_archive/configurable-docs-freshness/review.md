# Code Review: configurable-docs-freshness

> Reviewer: Claude | Spec: `tasks/configurable-docs-freshness/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored (STAGE_1 pass, signal approve), cold-Claude (13 findings, signal changes_requested), cold-Codex (no actionable findings).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens re-ran the suite in the worktree: `npm test` 1432/1432 passed. Type-check, lint, `docs-refs-check`, and `sync-templates:check` were clean. A fresh `npm run build` in a scratch copy is byte-identical to the committed `dist/`. All 37 non-task changed files match the Affected Files rows.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: pure resolver | Pass | `tests/docs-freshness.test.ts` covers: defaults without pipeline-orchestrator; `protected` replacement including `[]`; diff-independent admission; glob match and no-match; `**` on dot-only paths; `api/**` vs `api/.internal/x.ts`; tasks/telemetry exclusion; dedup; all three flag_only positions. |
| AC-2: loader validation | Pass | One test per malformed form, each naming `.canon/config.json` and the key or path. lessons-learned is rejected in all three lists, and a tasks/x/spec.md doc path is rejected. Absent file, `{}`, and unknown-only configs load as defaults; unknown keys come back as warnings. |
| AC-3: run-start refusal | Pass | Refusal is tested for plain, `--ship`, `--reroute`, `--dry-run`, `--pr`, `--push`, and `--full-send`; status.json stays byte-identical. Both `--ship` source tests are present, and the unknown-key warning test passes. The check sits at `main.ts:3562`, before `guardConcurrentRun`, the heartbeat, and the ship/reroute/full-send paths. (A test-strength nit is listed below.) |
| AC-4: mid-run fails closed | Pass | QA prompt, QA-end commit, and human-review commit are covered in `run-task-safety.test.ts`, and ship classification in `run-task-ship.test.ts`, all with config edited after import. No consumer caches the config. |
| AC-5: QA prompt | Pass | `qa.md` contains none of the five literals. Rendered tests cover: match and no-match; flag-only under Docs drift; drift instruction absent; empty-editable wording; probe-failure warning naming the failure and the mapped docs. Goldens were regenerated and the `Two-checkpoint` token still passes. |
| AC-6: admission uses admitted set | Pass | Tables cover mapped, flag-only (declared and undeclared), and pipeline-orchestrator under defaults and when explicitly protected. They run at QA-end, human-review, and base-drift, with timing preserved. The reroute regression and the pre-flight/full-send sites are tested through the shared `buildAdmittedAllowlist` helper, which both call sites use (coverage nit below). Ship aborts on mapped and flag-only dirt and preserves telemetry. |
| AC-7: `PIPELINE_MANAGED_DOCS` replaced | Pass | The AC grep returns 0 results. Both help renderers and the abort/warn text were updated, and the stderr regexes were updated to match. |
| AC-8: spec authorship surfaces | Pass | The map block appears in both spec prompts, and the no-map goldens are unchanged. The root and mirror spec templates were reworded and no longer say "Five protected docs". The canon-spec skill's Phase 1 carries the instruction. |
| AC-9: `canon doctor` | Pass | `checkDocsFreshness` is wired into `configChecks`. pass, fail, and each warn case are unit-tested. |
| AC-10: adopter-owned | Pass | The file is absent from `CANON_OWNED`, `EXPECTED_TEMPLATES`, and `templates/`. `canon init` does not create it; `canon upgrade` leaves it byte-identical and does not refuse on it. |
| AC-11: canon-ai dogfood | Pass | `.canon/config.json` lists the six docs, and doctor reports "6 protected". |
| AC-12: docs and shipped text | Pass | Completed: `.canon/README.md` carve-out, root README subsection, the four pipeline-orchestrator paragraphs, and the BACKLOG reconciliation. The adopter-fixture docs-refs test includes a live negative control, and both gates pass. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work): no dependency added, no init scaffold, and no `done.md` template change.
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

Recovery-path trace (Known Risks asked for it): the anchored lens traced every route and found none that skips the gate.
- spec_gap and the full-send scope check use `buildAdmittedAllowlist`.
- changes_requested leads to the implement auto-commit, which is unchanged.
- approved, approved_with_nits, and sanctioned (via `canon task accept`) lead to the QA-end commit, which uses the admitted set.
- `--reroute` does no git work, and the next pre-flight admits mapped docs regardless of the diff.
- The `reset-*` paths never admitted managed docs, which is unchanged.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is clean and well-tested. A single loader and a pure resolver drive every consumer, admission timing is preserved at every site, and run-start validation precedes every side effect. One real fail-open survives verification. It sits in the `--ship` shared-doc dirt guard, a delicate mutation chokepoint, and is newly reachable because the config now admits arbitrary doc names. Everything else is low-severity hardening or wording.

### Findings

#### Correctness Bugs

1. **`--ship` dirt guard misses dirty configured docs whose path git quotes** — `code-bug`. Source: anchored lens; the foreman verified it against the code.
   - **Where:** `src/orchestrator/main.ts:2057-2063`. `classifyAndPreserveSharedDocDirt` builds `porcelainByPath` from `parsePorcelainEntries` (`src/orchestrator/git.ts:400-414`). That parser only strips the surrounding quotes through `stripPorcelainQuotes`; it does not decode git's C-style octal escapes.
   - **Failure:** under git's default `core.quotePath=true`, a configured doc with a non-ASCII name, or one with a quote or control character, appears in porcelain output as e.g. `"docs/caf\303\251.md"`. `porcelainByPath.has('docs/café.md')` is then false, so the dirty managed doc is never classified, and `--ship` skips the pre-merge abort that the spec requires: "every configured doc … as managed".
   - **Why this is new:** before this task the set was a hardcoded ASCII list. The QA-end and human-review paths already decode with `normalizeGitPath` (`main.ts:603`), so only this site fails open. This is the same write-safety guard that `docs/patterns.md` says must fail closed.
   - **Fix:** decode the porcelain paths, either by running `normalizeGitPath` here or by switching this probe to `-z` porcelain output, or decode once in `parsePorcelainEntries` if every caller can take decoded paths. Add a `--ship` classification test with a dirty non-ASCII configured doc that expects the managed abort.

#### Risk / Guardrails

> Non-blocking. The implementer may address these in the same iteration; none is required for approval.

2. **A phase-consumer die leaves the phase `in_progress`.** Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/phases/qa.ts:36-39` and `phases/spec.ts:38-41,54-57` load the config after `taskPhase(..., 'in_progress')`, and the QA-end commit runs after qa is `done`. A config broken mid-run still fails closed, as the spec requires. The next `canon run` refuses at start-up until the config is fixed, so this does not strand recovery, and it matches the shape of the existing QA-end allowlist aborts. Optional: resolve the config before marking the phase.
3. **The unknown-key warning prints twice in detached runs.** Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/main.ts:3562-3566`: the parent warns before it detaches, and the child warns again into the run log. Each stream sees it once. The test covers only `--dry-run`, which does not detach. Low severity. A fix is to skip the warning in the detached child (the re-exec path already has a marker).
4. **The pre-flight and full-send call sites are covered only through the shared helper.** Source: anchored. The reroute regression is pinned on `buildAdmittedAllowlist` (`tests/run-task-validation.test.ts:4157`) rather than on `runCodeReviewPhase` or the `checkAndRoute` full-send branch. Both call sites pass `activeCwd` to that helper (verified by inspection), so the risk is limited to future rewiring.

#### Optional Cleanup / Nit

5. **Glob matcher limits are undocumented.** Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/docs-freshness.ts:101-121` mishandles three forms:
   - Nested braces (`{a,{b,c}}`) never match.
   - Braces containing `/` (`{src/a,lib}/**`) never match.
   - A trailing-slash key (`api/`) matches nothing.

   The README advertises `{a,b}` without these limits. Doctor's "matches no tracked file" warning partly mitigates this. Either reject these forms at load time or document the one-level, single-segment brace rule.
6. **Chained `**` segments can backtrack exponentially.** Flagged by 2 lenses (anchored, cold-Claude). `docs-freshness.ts:117-118`: each `**` compiles to `(?:[^/]+/)*`, so 8 chained `**` segments against a 25-deep path took 483 ms. Collapse consecutive `**` segments.
7. **Doc-path validation accepts values that can never match.** Flagged by 2 lenses (anchored, cold-Claude). `docs-freshness.ts:27-43`:
   - `isStrings` trims only to check for emptiness, so `" docs/a.md"` is stored with its leading space.
   - `.`, `docs/`, and pathspec-magic strings such as `:(top)x` are accepted and then passed as pathspecs to `git status` in `--ship`.
   - Case-variant telemetry aliases (`Docs/Lessons-Learned.md`) slip past the disjoint-class rule on case-insensitive filesystems.

   Consider rejecting surrounding whitespace, trailing `/`, a leading `:`, and bare `.`.
8. **Doctor's glob check counts paths the resolver never matches.** Source: cold-Claude. `src/cli/commands/doctor.ts:707` tests globs against every tracked file, including `tasks/**` and the telemetry files, which the resolver strips before matching. A key like `"tasks/**"` therefore passes doctor yet can never fire. Optionally filter with `isPipelinePath` in doctor too.
9. **`promptQa` silently defaults its docs argument.** Source: anchored. `src/orchestrator/prompts/index.ts:608-609` defaults to `DEFAULT_PROTECTED_DOCS`. Making the argument required would stop a future caller from silently getting defaults.
10. **The empty-editable wording can be inaccurate.** Source: anchored. `src/orchestrator/prompts/templates/qa.md:82` says "no docs are configured for correction". That is wrong when mapped docs exist but didn't match, or when every selected doc is flag-only. The wording follows the spec's text, so changing it is optional.
11. **The "main valid" `--ship` source test only checks for an absent message.** Sources: cold-Claude and anchored (the heartbeat/pid assertions). `tests/run-task-ship.test.ts:1355` asserts that stderr lacks the loader message, which is exactly what AC-3 says. Asserting that ship reached its next check (for example, the missing-PR-evidence failure) would pin it more strongly. Separately, the AC-3 heartbeat and `.canon-pid` absence checks are weak under `CANON_NO_DETACH`; the byte-identical status.json assertion carries that test.
12. **The canon-spec skill bullet is misplaced.** Flagged by 2 lenses (anchored, cold-Claude). In `.claude/skills/canon-spec/SKILL.md:33` (and its mirror) the config bullet sits above the "Read before doing anything else:" lead-in. Move it into or after that list.
13. **The README doesn't say the config must be committed.** Flagged by 2 lenses (anchored, cold-Claude). Worktree consumers read the branch checkout, so an uncommitted main-checkout `.canon/config.json` is invisible to them. An untracked one can also block first-worktree creation. Add a sentence to the README subsection. This is a docs nit, not a spec gap: the behavior matches the spec's "checkout the consumer operates in" rule.
14. **Small text fixes:**
    - The new help line in `src/cli/index.ts:89` and `src/orchestrator/cli.ts:128` runs past the help block's column wrap.
    - `docs/codebase-map.md:56` still names `buildAffectedFilesAllowlist()` for the pre-flight; it now goes through `buildAdmittedAllowlist`.
    - The base-drift abort text (`validation.ts:1607`) omits the QA-done admitted docs. This predates the task.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): a task can widen its own scope gates by editing `.canon/config.json` to name arbitrary repo files as docs. The spec accepts this explicitly. Known Risks, "A self-widening task", reads: "consumers read the active checkout. The config edit still needs an Affected Files row, so it is visible in the spec and PR. Accepted." The Decision's malformed list is exhaustive and doesn't restrict docs to documentation files.
- Dismissed (cold-Claude): `DEFAULT_PROTECTED_DOCS` drops `docs/pipeline-orchestrator.md`, which narrows the adopter ship guard. This is intended: the spec's Problem, defect 2, and the Decision say "the defaults are the five docs above, without `docs/pipeline-orchestrator.md`", and AC-1/AC-6 pin it.
- Dismissed (cold-Claude): `--ship` classifies with the REPO_ROOT config rather than the worktree's (part a). This is intended: the Decision says "`--ship`: the main checkout", and Known Risks records "`--ship` checks a different copy … That's correct". Part (b), about the uncommitted main-checkout config, is kept as nit 13.
- Dismissed (cold-Claude): the docs map isn't rendered into the Codex spec_review prompt. This isn't a defect. The Decision scopes the map to the spec and spec-revision prompts plus the canon-spec skill, and a reviewer can read the config file directly. It is worth a follow-up issue if spec reviews miss mapped docs in practice.
- Dismissed (cold-Claude): the redundant `docsConfig.ok &&` guard at `main.ts:3566`. It is harmless defensive narrowing for the type checker. The double-print half of the same finding is kept as risk 3.
- cold-Codex: no actionable findings reported. Nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required for re-review: finding 1, with a regression test. Findings 2–14 are optional; for a delicate task, 5–7 are cheap hardening worth taking in the same pass.

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

**Scope:** Full — base `main` — reason: delicate

Lens returns: anchored (STAGE_1 pass, signal approve); cold-Claude (13 findings, signal changes_requested); cold-Codex ("no actionable defects").

Foreman note: Round 1's AC-2 row backticked an example task path that doesn't exist. That made `npm run docs-refs-check` fail and aborted six PR-path tests, as the iteration handoff reported. The error was the foreman's, not the implementer's. The foreman fixed the reference before this round's lenses ran (it is no longer backticked), and both checks are now green.

### Stage 1 — Acceptance Criteria Re-Check

Validation, re-run by the anchored lens at HEAD 26432a5:
- `npm test`: 1445/1445 passed, 0 skipped.
- lint, type-check, `docs-refs-check` ("All refs OK") and `sync-templates:check` all pass.
- A fresh build from `git archive HEAD` is byte-identical to the committed `dist/`.
- 37 non-task paths changed, matching 37 Affected Files rows.

The handoff's two "Fail – unrelated" rows had the cause described above, which is now fixed.

| AC | Status | Notes |
|---|---|---|
| AC-1: pure resolver | Met | Unchanged from round 1. The globstar collapse keeps match semantics: `**/**`, a trailing `**` (still compiles to `.*`), and `a/**/**/b` on shallow and deep paths were all probed. The new deep-globstar test passes. |
| AC-2: loader validation | Met (unchanged from round 1) | The loader tables in `tests/docs-freshness.test.ts` pass. |
| AC-3: run-start refusal | Met (unchanged from round 1) | The check still precedes guardConcurrentRun, the heartbeat, and the ship, reroute and full-send paths. |
| AC-4: mid-run fails closed | Met (unchanged from round 1) | All four consumer reload tests pass. |
| AC-5: QA prompt | Met (unchanged from round 1) | Goldens pass; the Docs freshness bullet has no literal doc paths. |
| AC-6: admission uses admitted set | Met | The ship guard now decodes git-quoted paths (`src/orchestrator/main.ts:2059`) and compares NFC keys. Twelve real-git regressions pass: non-ASCII, quote, tab and newline names, each across protected, mapped and flag-only docs. A narrower leftover shape is listed as nit 1. |
| AC-7: `PIPELINE_MANAGED_DOCS` replaced | Met | The grep still returns 0 results. Both help renderers are now wrapped. |
| AC-8: spec authorship surfaces | Met | The canon-spec bullet now sits inside the "Read before doing anything else" list, and the mirror is synced. |
| AC-9: `canon doctor` | Met (unchanged from round 1) | |
| AC-10: adopter-owned | Met (unchanged from round 1) | |
| AC-11: canon-ai dogfood | Met (unchanged from round 1) | |
| AC-12: docs and shipped text | Met | The handoff's "Partial" no longer applies, because docs-refs-check passes. The README additions (brace limits, file-matching keys, commit-before-worktree) are accurate, and the codebase-map row now names `buildAdmittedAllowlist`. |

### Verifying Round 1 findings

- _correctness bug:_ "--ship dirt guard misses git-quoted configured docs" → **addressed**.
  - Porcelain paths are decoded with `normalizeGitPath` at `main.ts:2059`, and lookups use the NFC key.
  - The configured spelling is still used for `fs.readFileSync` and `git show`.
  - The regressions in `tests/run-task-ship.test.ts:1420-1449` first assert the quoted porcelain form, then the abort, unchanged content and unchanged status. The handoff records red-first evidence: all 12 failed before the fix.
  - The anchored lens also checked the NFD-config/NFC-disk case by hand, and it aborts correctly.
  - No other caller compares undecoded porcelain paths against configured docs. QA-end and human-review go through `classifyHumanReviewPath`, which calls `normalizeGitPath`, and pre-flight, full-send and base-drift read `-z` output.
- _nits 5, 6, 12, 13, 14 (optional):_ addressed.
  - 5 and 13: README text.
  - 6: consecutive `**` segments now collapse.
  - 12: the skill bullet moved, and the mirror is synced.
  - 14: the help text is wrapped and the codebase-map row is corrected.
  - Still deferred: the pre-existing omission in the base-drift message.
- _risks 2–4 and nits 7–11 (optional):_ deferred, with reasons in the handoff. Round 1 marked them non-blocking, so deferring them is acceptable.

### New findings

No `code-bug` or `spec-gap` findings survive. All of the following are optional.

#### Optional Cleanup / Nit

1. **The ship guard misparses a configured doc whose name contains " -> ".** Source: anchored, reproduced.
   - **Where:** `src/orchestrator/git.ts:412-414`. `parsePorcelainEntries` splits any line containing " -> " as a rename, even when the status is ` M`.
   - **Effect:** a protected doc named like "docs/a -> b.md" that is dirty in the main checkout returns `[]` from `classifyAndPreserveSharedDocDirt`, so ship does not abort. The QA-end and human-review paths still fail closed on that shape.
   - **Why it's a nit:** a filename containing " -> " is extremely unlikely, and git still refuses a merge that would overwrite the dirt. This is the same parsing class as R1-1, though.
   - **Recommended fix:** switch this probe to `--porcelain=v1 -z`, or split only when the index status is R or C. Fixing it in the shared parser covers every caller.
2. **Wildcard backtracking remains within a segment.** Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/docs-freshness.ts:101-123`: runs of `*` inside one segment, and non-adjacent `**` segments, still backtrack. A 12-star key against a 40-character name took 72.8 s. Only pathological, adopter-authored keys trigger this. Collapsing runs of `*` in `segmentRegex` would fix it.
3. **Doc spellings are not NFC-normalized at load time.** Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/docs-freshness.ts:64,78`: the ship guard now compares NFC, but the resolver's flag-only subtraction, `buildAffectedFilesAllowlist`, and the Affected Files filter compare raw strings. An NFD spelling in the config fails closed as a spurious out-of-scope block, or is mishandled if the same doc is spelled two ways. NFC-normalizing once in `parseDocsFreshnessConfig` would fix it. The same applies to the round 1 whitespace and case items (R1-7).
4. **The shipped config example contains a dead `flag_only` entry.** Source: cold-Claude, verified.
   - **Where:** the example config in `README.md:319` and `.canon/README.md:49`.
   - **Problem:** `flag_only` lists AGENTS.md, but AGENTS.md is in neither `protected` nor any `paths` value, so the resolver never selects it. QA is never asked to flag it, and doctor gives no warning.
   - **Why it's a nit:** the example copies the spec's Decision example verbatim, and the README prose right after it states the selection rule.
   - **Fix:** add AGENTS.md to the `"**"` mapping in both examples so the example demonstrates the feature.
5. **Test hardening.** Sources: anchored and cold-Claude.
   - Add an NFD-config/NFC-disk case to the ship regressions, which would pin the `.normalize('NFC')` lookup.
   - The deep-globstar subprocess test in `tests/docs-freshness.test.ts:121` resolves tsx from `process.cwd()`; resolving it from `import.meta.url` would remove the cwd dependency. A different cwd fails loudly rather than passing falsely.
6. **Carried from round 1, still optional:**
   - A phase consumer's die leaves the phase `in_progress` (R1-2, flagged again by cold-Claude).
   - The AC-3 heartbeat and pid absence assertions are weak, and the "main valid" ship-source test only asserts an absent message (R1-11, flagged again by cold-Claude). Both assert what AC-3 literally specifies, so they are not test-integrity defects; byte-identical status.json carries the ordering proof.
   - Glob keys that can never match are now documented in the README; doctor warns on them (R1-5).

### Dismissed Cold Findings

- Dismissed (cold-Claude): QA or a task can widen admission by editing `.canon/config.json` to list source files, or the config itself, as docs. The spec accepts this. Known Risks, "A self-widening task … Accepted", and "Admission is broader than the prompt … same trust model as today's managed docs". The Decision's malformed list is exhaustive and does not restrict docs to documentation files. This repeats the round 1 dismissal. One refinement for the human: if the config lists itself, the spec's mitigation that "the config edit still needs an Affected Files row" no longer holds. Rejecting `.canon/config.json` as a doc value would be a small follow-up spec change; no AC or Decision forbids it today, so it is not a code bug.
- Dismissed (cold-Claude): `--ship` and doctor read the main checkout while phases read the worktree. This is intended. The Decision's run-start rule says "`--ship`: the main checkout"; Known Risks says "`--ship` checks a different copy … That's correct"; the README now says to commit the config before worktree tasks.
- Dismissed (cold-Claude): removing `docs/pipeline-orchestrator.md` from the default set changes adopters' admission and ship abort. This is intended: the spec's Problem (defect 2) and Decision say "the defaults are the five docs above, without `docs/pipeline-orchestrator.md`", and AC-1 and AC-6 pin it.
- Dismissed (cold-Claude): the base-drift "flag declared" case passes regardless of flag-only logic. It is the positive control of a declared/undeclared pair. The discriminating "flag undeclared" row is at `tests/run-task-validation.test.ts:4174`, next to the declared row at line 4175, which together match AC-6's "rejected unless Affected Files lists it".
- Dismissed (cold-Claude): the redundant `docsConfig.ok &&` guard. It is harmless type narrowing, dismissed in round 1 as well.
- cold-Codex: reported no actionable defects, so nothing to dismiss.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

The required round 1 fix landed with a real regression test, and all gates are green. Nit 1 is the most worthwhile follow-up: same guard, same bug class. Its trigger is a filename containing " -> ", which ranks it below blocking.
