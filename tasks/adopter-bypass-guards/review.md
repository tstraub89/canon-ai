# Code Review: adopter-bypass-guards

> Reviewer: Claude | Spec: `tasks/adopter-bypass-guards/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

Lenses: anchored Claude (returned, `OVERALL_SIGNAL: approve`), cold-Claude (returned, `changes_requested`), cold-Codex (injected, one P2). All three present.

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (E2E `deferred_by_spec`; the AC-11 full-doctor smoke is `human_pending`, environment-bound)
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (no red-first ACs)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `.claude/hooks/canon-guard.mjs` in `CANON_OWNED` (`src/lib/canon-owned.ts`); template mirror byte-identical; init/upgrade/`--force` covered in `tests/cli.test.ts`. |
| AC-2 | Pass | `tests/canon-guard.test.ts` covers main checkout, in-repo and external worktrees, abs/rel paths, without `CANON_WORKTREES_ROOT`; anchored lens ran it (80/80). See finding 1 for an unpinned false-deny neighbor (`perl -M…`). |
| AC-3 | Pass | Heredoc, `<<-`, comments, `2>&1`, continuation, foreground-vs-detaching reasons pinned. |
| AC-4 | Pass | PATH `gh` shim: explicit/default/implicit merge, rebase/merge allowed, non-task PR, lookup failure, timeout. See finding 2 for the global-flag form. |
| AC-5 | Pass | Malformed JSON, unknown tool, missing `tool_input`/`cwd`, throw seam all exit 0 with empty stdout. |
| AC-6 | Pass | Snippet command run via `sh -c`: no-op when script absent, deny when present. |
| AC-7 | Pass | Each reason checked for no `src/`/`scripts/`/`tests/` paths and a closing retry/hand-off sentence. |
| AC-8 | Pass | Snippet constant, README drift test, matcher, doctor (a)/(b)/(c)/pass, upgrade notice, no settings write after init+upgrade. |
| AC-9 | Pass | `/canon-init` Phase 5 retitled, consent-gated merge steps 5–7, framing updated, mirror synced. |
| AC-10 | Pass | Zero-match sweeps re-run by anchored lens: 0 hits; remaining prompt hits are mentions/prohibitions. |
| AC-11 | Partial (accepted) | `.claude/settings.json` adds `PreToolUse`, keeps `SessionStart`; `checkGuardHook(<worktree>)` returns pass. Full `canon doctor` resolves to the supervising checkout, so the no-warning run is verifiable only after merge — environment-bound, recorded `human_pending`. |
| AC-12 | Pass | Decision entry, BACKLOG, README scope, `.canon/hooks/README.md`, codebase-map, detach.ts header updated. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Solid implementation: the scanner follows the Command parsing contract closely, fail-open is tested, and the doctor/upgrade/README/skill surfaces line up. Two hook-matching bugs survive adjudication, both small fixes in `.claude/hooks/canon-guard.mjs` (edit the root copy, then sync the mirror). Everything else is nit-level.

### Findings

#### Correctness Bugs

1. **`code-bug` — `perl` module/value switches read as in-place, denying reads.** `.claude/hooks/canon-guard.mjs:386-388` (`isPerlInPlace`, `/^-(?!-)[a-zA-Z]*i/`) matches any `i` in a switch cluster, so `perl -Mstrict -ne 'print' tasks/<id>/status.json` and `perl -MList::Util …` are DENIED (anchored lens, probe-confirmed). Rule 2 denies only "an in-place `perl -i`" and says everything else, including reads, is allowed; Known Risks names false denies the highest risk. Fix: stop scanning a cluster at a value-taking switch (`M`, `m`, `I`, `e`, `E`, `x`, `l`, `0`, `C`, `d`, `D`, `V`) — i.e. treat `i` as in-place only when every preceding letter is a value-less switch — and add an AC-2 allow case for `perl -Mstrict -ne … status.json`. Source: anchored.
2. **`code-bug` — `gh` global repo flag before `pr` skips the merge rule.** `.claude/hooks/canon-guard.mjs:441` requires `invocation.args[0] === 'pr'`, so `gh -R owner/repo pr merge 12 --squash` (and `--repo owner/repo` / `--repo=…`) is allowed for a `task/*` PR. Rule 4 denies any `gh pr merge` whose head is `task/*`; this is a plain `gh pr merge`, not one of contract item 9's indirect forms. Flagged by 2 lenses (cold-Codex P2, cold-Claude) — cross-model agreement. Fix: skip leading `-R`/`--repo <v>`/`--repo=<v>` before matching `pr merge` and carry the captured repo into `lookupPRHead`; add an AC-4 deny case. Source: cold-Codex, cold-Claude.

#### Risk / Guardrails

None blocking. Optional items below.

#### Optional Cleanup / Nit

- Edit/Write deny reason derives the task id from the raw `file_path` (`.claude/hooks/canon-guard.mjs:41`); a bare relative `status.json` from `cwd=tasks/<id>` yields a reason naming tasks/./status.json and `canon task phase . …`. Resolve against `cwd` first, as line 356 does. (cold-Claude; Claude Code's Edit/Write normally pass absolute paths, so low impact.)
- `canon watch --help | cat` and `canon run foo -h | head` are denied (`canon-guard.mjs:396`); the spec's exemption names only `canon run … --help`, so this is spec-literal, but extending the exemption to `watch` and `-h` is cheap. (anchored, cold-Claude)
- Piping `canon run --interactive` / `-I` / `CANON_NO_DETACH=1 canon run` gets the detaching reason ("run bare, it detaches"), which is wrong for those foreground modes (`canon-guard.mjs:396-401`). Spec-literal list; consider adding `--interactive`/`-I`. (anchored)
- `stdout.write` immediately followed by `process.exit(0)` (`canon-guard.mjs:16-32`): on macOS pipes the write can in principle be async; the failure mode is fail-open. Setting `process.exitCode = 0` and returning removes the doubt. (anchored, cold-Claude; low confidence)
- `isTaskId(taskId) ? taskId : taskId || '<id>'` is redundant (`canon-guard.mjs:450`); either sanitize to `<id>` when invalid or drop the ternary. Bundle PR heads name only the first task id — acceptable. (anchored, cold-Claude)
- `src/cli/commands/doctor.ts:183-192`: `readGuardHookToolsFromProject` duplicates `guardHookRegistration`'s loop and is re-run per tool in the filter; derive both from one tool set. (anchored, cold-Claude)
- `src/cli/commands/doctor.ts:137-145`: regex matchers such as `.*` or `(Bash|Edit|Write|MultiEdit)` read as `none`/`partial` — a false warn only. Treat `.*` like `*`. (anchored, cold-Claude)
- `src/cli/commands/upgrade.ts:32-35`: notice says "not registered" for a `partial` registration too. (anchored, cold-Claude)
- `src/orchestrator/detach.ts:22-23`: header now lists `canon watch <id>` twice. (anchored, cold-Claude)
- `.claude/skills/canon-init/SKILL.md:149-171` restates the hooks snippet with no drift test; consider extending the README drift test to the skill block. (anchored)
- `docs/BACKLOG.md:31`: the rewritten "Explicitly NOT porting" clause splices a semicolon clause into a comma list. (anchored)
- Unquoted `x=$(canon run foo | tail)` is skipped as a `VAR=` assignment (false allow; `canon-guard.mjs:316`). Contract item 6 mandates skipping `VAR=value` and item 9 accepts the quoted form; not listed, but a false allow is tolerated per Known Risks §Command-parsing gaps. Optionally note it in the decision entry. (anchored, cold-Claude)
- Two test seams (`CANON_GUARD_TEST_THROW`, `CANON_GUARD_GH_TIMEOUT_MS`) ship without a comment. (anchored)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): Bash status rule misses `jq … > tmp && mv tmp status.json`, `cp`, `install`, `dd`, `git checkout/restore -- status.json` - spec Non-Goals "Tamper-proofing" explicitly makes `cp`-class indirect writes "a false allow by design" and scopes coverage to the observed forms (redirect, `sed -i`, `perl -i`, `tee`); Known Risks accepts false allows.
- Dismissed (cold-Claude): no negative-coverage test pins the `mv`/`cp` gap (test integrity) - the gap is an accepted design boundary, not a hidden failure; tests faithfully cover the specified rule.
- Dismissed (cold-Claude): case-sensitive `tasks`/`status.json` match lets `Tasks/<id>/status.json` through on case-insensitive filesystems - false allow on a form agents do not produce; accepted per Known Risks §Command-parsing gaps.
- Dismissed (cold-Claude): backtick substitution and nested `do while` loops / `watch -n` not detected - false allows; contract item 9 and Known Risks accept heuristic gaps.
- Dismissed (cold-Claude): a `-t`/`-b` value of exactly `-m`/`-r` exempts a squash merge - contrived false allow; not a habit form.
- Dismissed (cold-Claude): `cd other && gh pr merge` resolves the head against `payload.cwd` - false allow (or allow on lookup failure); accepted fail-open behavior.
- Dismissed (cold-Claude): merge rule lacks a `.canon/` check - the hook only runs where a project registered it, i.e. a canon project; `task/*` heads there are canon task branches by layout.
- Dismissed (cold-Claude): doctor ignores user-level `~/.claude/settings.json` and `disableAllHooks` - spec Decision 5 scopes the check to the two project settings files; result is a warn only.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Implementer: fix Correctness Bugs 1 and 2 in the root `.claude/hooks/canon-guard.mjs`, run `npm run sync-templates`, add the two test cases, and rebuild. Nits are optional.

## Round 2 — verifying iteration response to round 1

**Scope:** Delta — base `2ba16915463ca0b8fce866a760f69cbd19c4361b` — reason: small fix within the files already under review

Lenses: anchored Claude (returned, `OVERALL_SIGNAL: approve`), cold-Claude (returned, `changes_requested`), cold-Codex (injected, no findings). All three present. Note: the handoff heads the fix section "Iteration 2 — addressing review round 1"; the anchored lens read that section and red-first evidence across the whole handoff.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Mirror byte-identical to root hook (`cmp`). |
| AC-2 | Met (but see finding 1) | `perl -Mstrict` read allowed, `perl -pi.bak` denied (`tests/canon-guard.test.ts:176,194`); focused suite 85/85. The new scanner regresses `-lpi`. |
| AC-3 | Met (unchanged from round 1) | Monitor rule untouched. |
| AC-4 | Met (but see finding 2) | `gh -R`/`--repo`/`--repo=` before `pr` now denied; repo reaches `gh pr view` (`tests/canon-guard.test.ts:286-300`). |
| AC-5 | Met (unchanged from round 1) | |
| AC-6 | Met (unchanged from round 1) | |
| AC-7 | Met (unchanged from round 1) | Reasons unchanged. |
| AC-8 | Met (unchanged from round 1) | |
| AC-9 | Met (unchanged from round 1) | |
| AC-10 | Met (unchanged from round 1) | No prompt/doc files touched. |
| AC-11 | Partial (accepted, unchanged) | Full `canon doctor` no-warning run is `human_pending` until after merge. |
| AC-12 | Met | Docs unchanged. `docs-refs-check` failed only on a backticked path in this review file's Round 1 Nit list; the foreman reworded it this round. |

Validation note: iteration re-ran only the focused guard suite, not the full `npm test` the spec requires. The delta is confined to the hook, its mirror and `tests/canon-guard.test.ts`, so not a Stage 1 failure, but the next iteration must record a full `npm test` run.

### Verifying Round 1 findings

- _correctness bug:_ "`perl -M…` read denied as in-place" → addressed (`.claude/hooks/canon-guard.mjs:387-395`; allow case added) ✓ — but the fix introduced finding 1 below.
- _correctness bug:_ "`gh -R owner/repo pr merge` skips merge rule" → addressed for flags before `pr` (`parseGhMergeArgs`, `.claude/hooks/canon-guard.mjs:464-485`) ✓ — the same class remains for flags between `pr` and `merge` (finding 2).

### New findings (only NEW issues introduced by Iteration N's changes)

1. **`code-bug` — perl scanner stops at `l`/`0`, re-opening an in-place bypass; `F` missing.** `.claude/hooks/canon-guard.mjs:8,387-395`. `PERL_VALUE_FLAGS` treats `l` and `0` (and `C`) as consuming the rest of the cluster, but they take only optional digits and perl keeps reading switches. Cold-Claude ran real perl: `perl -lpi -e 's/a/b/' tasks/foo/status.json` and `perl -0777pi -e … tasks/foo/status.json` both edit the file in place and are now allowed. `-lpi` was denied before this iteration, so this is a regression in Rule 2's "in-place `perl -i`" coverage. Flagged by 2 lenses (anchored, cold-Claude). The flag list came from the Round 1 review's own suggested fix; correcting it here. Also, `F` (pattern runs to the end of the argument) is missing, so `perl -Fi -ane 'print' tasks/foo/status.json` is a read that gets denied (2 lenses). Fix: after `l`, `0` or `C`, skip trailing digits (octal/hex for `0`, e.g. `0777`, `0x1F`) and continue scanning; treat `d`/`D` as consuming only when followed by `:`/`=` or other characters per perl's usage, otherwise continue; add `F` to the stop set. Add deny tests for `-lpi` and `-0777pi`, and an allow test for `-Fi -ane`.
2. **`code-bug` — `gh pr -R owner/repo merge …` still skips the merge rule.** `.claude/hooks/canon-guard.mjs:464-485`. `parseGhMergeArgs` accepts repo flags only before `pr`; gh's persistent `--repo` is equally valid between `pr` and `merge`, and the joined forms `-Rowner/repo` / `-R=owner/repo` are not recognized at either position (nor in `findPRReference`, where a joined form is skipped, so the lookup runs against `cwd`'s repo). Same bug class as Round 1's finding 2, now at the adjacent argument position. Flagged by 2 lenses (anchored, cold-Claude). Fix once in a shared helper: walk `gh` args up to `merge`, accepting repo flags in any of `-R v`, `--repo v`, `--repo=v`, `-R=v`, `-Rv` form both before and after `pr`, and reuse it in `findPRReference`. Add deny tests for `gh pr -R owner/repo merge 12 --squash` and `gh -Rowner/repo pr merge 12 --squash`.

#### Optional Cleanup / Nit

- `gh -R o/r pr merge --squash` with no PR ref falls back to the local branch (`canon-guard.mjs:451-456`), so a deny could name the wrong task. gh rejects `--repo` without a ref anyway; consider allowing (skipping the lookup) when a repo override is set and no ref is given. (anchored, cold-Claude)
- `isSedInPlace` keeps the loose cluster scan (`canon-guard.mjs:383-385`); `sed -fix.sed …` (script file `ix.sed`) is a contrived false deny. Optional: apply value-flag awareness for `-e`/`-f`/`-l`. (cold-Claude)
- `isPerlInPlace` scans script arguments too (`perl script.pl -i tasks/foo/status.json`): rare false deny; optional. (cold-Claude)

### Dismissed Cold Findings

- Dismissed (cold-Claude): test-integrity — no tests for value-flag-before-`i` clusters or repo flags between `pr` and `merge` - not a separate defect; the missing cases are folded into findings 1 and 2 as required tests.
- Dismissed (cold-Codex): none to dismiss (clean return; its "no actionable regressions" is outweighed by the cold-Claude real-perl repro of `-lpi`).

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Implementer: fix findings 1 and 2 in the root `.claude/hooks/canon-guard.mjs`, run `npm run sync-templates`, add the listed tests, and record a full `npm test` run in the handoff.


## Round 3 — verifying iteration response to round 2

**Scope:** Delta — base `5938661d0350b35a376bc35470143ca378f35c07` — reason: small fix within the files already under review

Lenses: anchored Claude (returned, `changes_requested`), cold-Claude (returned, `changes_requested`), cold-Codex (injected, no findings). All three present. Round 3 discipline applied: only correctness bugs and spec gaps drive the verdict.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Root hook and mirror byte-identical; `sync-templates:check` passes. |
| AC-2 | Met | `-lpi`, `-0777pi`, `-0x1Fpi` denied; `-Fi -ane`, `-Ci`, `-Dpi` reads allowed (`tests/canon-guard.test.ts:177-200`), checked against real perl 5.34. |
| AC-3 | Met (unchanged from round 2) | |
| AC-4 | Partial | All repo-flag spellings/positions now denied via the shared `parseGhRepoOption` (`.claude/hooks/canon-guard.mjs:534-544`, tests `:292-316`). But the `isMergeFlagCluster` narrowing now denies allowed combined-short rebase/merge-commit merges (finding 1). |
| AC-5 | Met (unchanged from round 2) | |
| AC-6 | Met (unchanged from round 2) | |
| AC-7 | Met (unchanged from round 2) | |
| AC-8 | Met (unchanged from round 2) | |
| AC-9 | Met (unchanged from round 2) | |
| AC-10 | Met (unchanged from round 2) | |
| AC-11 | Partial (accepted, unchanged) | `canon doctor` smoke run `human_pending` until after merge. |
| AC-12 | Met | `docs-refs-check` Pass. |

Validation: full `npm test` recorded (2,038 passed, 1 skipped, 0 failed); red-first evidence for Iteration 3 recorded against `5938661`; focused suite 102/102 on re-run.

### Verifying Round 2 findings

- _correctness bug:_ "perl scanner stops at `l`/`0`; `F` missing" → addressed (`.claude/hooks/canon-guard.mjs:389-445`; deny/allow cases added) ✓
- _correctness bug:_ "`gh pr -R … merge` and joined `-R` forms skip the merge rule" → addressed via one shared `parseGhRepoOption` used before/after `pr` and in `findPRReference` ✓
- _validation:_ "record full `npm test`" → addressed ✓

### New findings (only NEW issues introduced by Iteration N's changes)

1. **`code-bug` — narrowed `isMergeFlagCluster` denies allowed rebase/merge-commit merges.** `.claude/hooks/canon-guard.mjs:546` is now `/^-[rm]{2,}$/`, so `gh pr merge 12 -dr`, `-rd` and `-dm` (delete-branch + rebase/merge) on a `task/*` head are denied. All three were allowed at `5938661` (anchored lens ran base and current hooks against the same fixture). Rule 4 / AC-4 keep rebase and merge-commit merges allowed, and the spec ranks false denies highest. Flagged by 2 lenses (anchored, cold-Claude). The narrowing was meant to stop `-Rowner/repo` from reading as a strategy, which `parseGhRepoOption` now handles. Fix: match a cluster of gh's boolean merge shorts that contains `r` or `m` (e.g. `/^-[dsrm]*[rm][dsrm]*$/`, or walk the cluster and stop at value-taking shorts `t`/`b`/`F`/`A`/`R`). Add allow tests for `-dr` and `-dm` and a deny test for a non-strategy cluster such as `-ds` — the missing coverage is why the suite stayed green (cold-Claude test-integrity finding, folded here). Accepting `--rebase=true` / `--merge=true` in the same check is a cheap optional extra.
2. **`code-bug` (test integrity) — `perl -C16pi` deny case asserts wrong perl semantics.** `tests/canon-guard.test.ts:179`. Real perl's `-C` consumes the rest of the argument, so `perl -C16pi …` fails with "Unknown Unicode option letter 'p'" and edits nothing (both lenses checked with real perl). The test labels it an in-place cluster. Fix either side: make `-C` stop the cluster scan (return false), and change the case to a real in-place form such as `perl -C16 -pi -e … tasks/foo/status.json`. Flagged by 2 lenses (anchored, cold-Claude).

### Dismissed Cold Findings

- Dismissed (cold-Claude): `-D` consumes all word chars in perl, so `-D14pi`/`-Dwi` are over-denied - the denied commands perform no edit in perl (they error or no-op), so the deny blocks nothing usable; no bypass. Not verdict-driving in Round 3.
- Dismissed (cold-Claude): `-l`/`-0` digit-count limits (`-l1234pi`, `-0x1Fpi`) over-denied - same reasoning: perl rejects or no-ops these, so no usable command is blocked.
- Dismissed (cold-Claude): `gh pr merge 12 --squash -t -r` treats the title value `-r` as a strategy (false allow) - contrived; false allows are accepted per the spec's Known Risks (Command-parsing gaps bullet); pre-existing.
- Dismissed (cold-Claude): `GH_REPO=owner/repo gh pr merge 12` not honored in the lookup - false allow or fail-open lookup; accepted per Known Risks; pre-existing.
- Dismissed (cold-Claude): empty `--repo=` / `-R=` value resolves against the cwd repo - gh itself rejects an empty repo; contrived.
- Dismissed (cold-Codex): none to dismiss (clean return; outweighed by the two-lens reproduction of finding 1).

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Implementer: fix finding 1 (with the listed tests) and finding 2 in the root `.claude/hooks/canon-guard.mjs` and `tests/canon-guard.test.ts`, run `npm run sync-templates`, and record focused and full `npm test` runs.


## Round 4 — verifying iteration response to round 3

**Scope:** Delta — base `89137cbffa5a963a9aa97674f039f3f8d0eb3861` — reason: small fix within the files already under review

Lenses: anchored Claude (returned, `approve`), cold-Claude (returned, `approve`), cold-Codex (injected, no findings). All three present. Round 4 discipline applied: only correctness bugs and spec gaps drive the verdict.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Root hook and mirror byte-identical. |
| AC-2 | Met | `-C` now ends the cluster scan; test uses the real in-place form `perl -C16 -pi` (`tests/canon-guard.test.ts:179`). Clustered `-C16pi`/`-CSDpi` confirmed non-editing in real perl. |
| AC-3 | Met (unchanged from round 3) | |
| AC-4 | Met | `isMergeFlagCluster` is `/^-[dsrm]*[rm][dsrm]*$/` (`.claude/hooks/canon-guard.mjs:541`); `-dr`/`-dm` allowed, `-ds` denied; red-first against `89137cb`. |
| AC-5 | Met (unchanged from round 3) | |
| AC-6 | Met (unchanged from round 3) | |
| AC-7 | Met (unchanged from round 3) | |
| AC-8 | Met (unchanged from round 3) | |
| AC-9 | Met (unchanged from round 3) | |
| AC-10 | Met (unchanged from round 3) | |
| AC-11 | Partial (accepted, unchanged) | `canon doctor` smoke run `human_pending` until after merge. |
| AC-12 | Met | `docs-refs-check` Pass. |

Validation: Iteration 4 records lint, type-check, full `npm test` (2041 pass, 1 skip, 0 fail), sync-templates check, focused guard suite (105/105, re-run by both Claude lenses), `git diff --check`, docs-refs-check — no Fail rows.

### Verifying Round 3 findings

- _correctness bug:_ "narrowed `isMergeFlagCluster` denies `-dr`/`-dm`" → addressed (`.claude/hooks/canon-guard.mjs:541`; allow tests for `-dr`/`-dm`, deny test for `-ds`) ✓
- _test integrity:_ "`perl -C16pi` deny case models perl wrongly" → addressed (`-C` returns false; test switched to `-C16 -pi`) ✓

### New findings (only NEW issues introduced by Iteration N's changes)

None that drive the verdict. Nits (non-blocking, optional):

- The strategy check scans flag values too (`.claude/hooks/canon-guard.mjs:498`), so `gh pr merge 12 --squash -t -dr` (title `-dr`) is allowed; the wider cluster regex adds more such values. Flagged by 2 lenses (anchored, cold-Claude). Kept as a nit, not a bug: it is a contrived false allow, and the spec says false allows are acceptable (Known Risks, Command-parsing gaps bullet: "A false allow is acceptable; a false deny is a problem"). Both lenses rated it low and returned approve. Optional fix: skip `GH_VALUE_FLAGS` values in the strategy scan, as `findPRReference` already does.
- Mixed strategy clusters such as `-sr` or `-dsr` match the regex and rely on gh refusing more than one strategy; `^-d*[rm]d*$` would be tighter. (anchored, cold-Claude)
- A cluster ending in a value flag (`-rt subject`, `-mb body`) is denied on a task PR — a rare false deny the agent can recover from, since the reason says to retry with `--rebase`/`--merge`. (anchored, cold-Claude)
- No allow test pins clustered `-C16pi`/`-Cpi`. (cold-Claude)
- The `-C` branch could just be `'C'` in `PERL_VALUE_FLAGS`. (anchored)

### Dismissed Cold Findings

- Dismissed (cold-Claude): test-integrity — no tests for `s`-plus-strategy clusters (`-sr`, `-dsr`) - not compromised integrity; gh rejects those commands outright, so there is no squash path to pin. Recorded as a nit above.
- Dismissed (cold-Codex): none to dismiss (clean return, consistent with both Claude lenses).

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap


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
