# Code Review: per-command-help

> Reviewer: Claude | Spec: `tasks/per-command-help/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored Claude (returned, `changes_requested`), cold Claude (returned, `changes_requested`), cold Codex (injected; no findings, tests pass).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (feature task; red-first does not apply. The handoff still records red checks for the AC-3 ordering cases.)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Declarations, usage, and parsers agree | Pass | `tests/cli-args.test.ts` checks all 8 command declarations and all 9 task-subcommand declarations: usage prefix, every flag in the usage, and the parser adapters (including `--timeout=` and `--base=`). |
| AC-2: Help works at any position and wins | Partial | All 8 named cases are tested and pass. The run cases go through `dist`. Help is silently lost when it follows an `=`-form value flag (finding 1), which breaks Decision 4. |
| AC-3: Help has no command-level side effects | Pass | init uses an empty PATH and writes nothing. The upgrade listing is unchanged. The update runners and stop `kill` are not called. `run --pr --help` passes without `gh`. The foreign-worktree task test deletes `CANON_TASKS_DIR_OVERRIDE`, and its control case dies, so it is not vacuous. |
| AC-4: Flag values stay literal | Pass | The `--reason --help` case is tested at parse level, which the spec allows. `watch foo --until --help` gives "Invalid phase", exit 2. |
| AC-5: Unknown arguments are rejected everywhere | Pass | Tests cover every command and task subcommand: exit codes, pointers, no stack trace for upgrade, `Unexpected argument` for update/upgrade, and `run -z foo`. |
| AC-6: Free-text slots and `=` forms still work | Partial | The behavior works, but the tests call `taskNew`/`taskSet` directly and skip the `taskCmd` pre-scan, the only new code that could reject them (finding 2). |
| AC-7: Top-level and `task` help are summaries | Partial | Top-level summary assertions are correct. Nothing asserts that `canon task --help` lists the nine subcommand names. The `set <id> <field> <value>` pin was turned into an absence check and not moved to its new home (finding 3). |
| AC-8: Help detail has a single home | Pass | The grep returns no matches. |
| AC-9: Existing behavior unchanged | Pass | The full suite passes (1,630). Existing-test edits are limited to help, unknown-flag, and moved-string assertions. The shared `runCanonCliIn` loader-path change is not named in the handoff (nit). |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 passes because every AC is materially implemented. The Partial rows come from the Stage 2 findings below, and those findings drive the verdict.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The design is clean. One declaration per command feeds the pre-scan, the usage, and the AC-1 test. Side-effect ordering is correct and well tested, and moving help detail out of `printHelp()` met AC-7 and AC-8. There is one real correctness bug: the pre-scan's value-slot check mistakes a complete `--flag=value` for a flag still waiting for its value. Both Claude lenses found it independently, and I reproduced it against the built CLI. There is also one test-integrity gap: the AC-6 free-text tests skip the code they are meant to prove.

### Findings

#### Correctness Bugs

1. **`--help` after an `=`-form value flag is swallowed** — `code-bug`, flagged by 2 lenses (anchored Claude, cold Claude). `src/lib/cli-args.ts:28`: `consumedAsValue` also matches when `args[i-1]` is a complete `--timeout=5s` or `--base=main`, because it calls `equalsValues.has(args[i-1].split('=',1)[0])`. An `=` form never takes the next token, so the `--help` after it is dropped. Reproduced: `node dist/cli/index.js watch foo --timeout=5s --help` → `canon watch: Unknown option: --help`, `state=usage reason=usage_error`, exit 2. `canon task new id "Title" --base=main --help` → no help, and the parser fails with "unexpected argument '--help'". This violates Decision 4: help is honoured anywhere, and the only exception is a token consumed as a value. A second shape: `task accept id qa --reason --reason --help` also suppresses help, because the `values.has(args[i-1])` clause fires on a token that was itself consumed as a value. Fix: the spaced value-flag branch already skips its value with `i += 1`, so a `--help` that reaches this branch was never consumed. Drop the `consumedAsValue` look-behind entirely (free-text handling is unaffected). Add `preScanArgs` regression tests for `--timeout=5s --help`, `--base=main --help`, and `--reason --reason --help`.

2. **AC-6 tests bypass the pre-scan they must prove** — `code-bug` (test integrity), anchored lens. `tests/task-cli.test.ts:2936-2946` calls `taskNew`/`taskSet`/`parseTaskNewArgs` directly. The new failure mode, the `taskCmd` pre-scan rejecting `-draft` or `--base=main` as an unknown option, is never exercised. The test would still pass with `freeTextSlots` or `equalsValueFlags` removed from `TASK_SUBCOMMAND_ARGS.set`/`.new`, and the `cli-args` unit test uses only a synthetic declaration. Route these cases through `taskCmd` (or a spawned `canon task …` with the override set), or at least add `preScanArgs(TASK_SUBCOMMAND_ARGS.set, ['foo','title','-draft'])`, `preScanArgs(TASK_SUBCOMMAND_ARGS.new, ['foo','-draft title'])`, and `preScanArgs(TASK_SUBCOMMAND_ARGS.new, ['bar','Title','--base=main'])` → `proceed`.

#### Risk / Guardrails

3. **AC-7 retarget gaps** — `code-bug` (test integrity: AC-7 says moved pins are retargeted, not deleted), anchored lens. `tests/cli.test.ts:1066`: the old `set <id> <field> <value>` assertion survives only as an absence check, and no test asserts the string's new home (`TASK_USAGE` / `task set` usage). `tests/task-cli.test.ts:~2909` asserts the `canon task <subcommand> --help` pointer but not that the nine subcommand names appear, which AC-7 requires. Add both assertions.

4. **`init --bogus` no-side-effect test runs in the repo checkout** — `code-bug` (test integrity, low), anchored lens. `tests/cli.test.ts:~1115` runs `init --bogus` in `WORKTREE_ROOT` and never checks that init did not run. If the pre-scan regressed, the test would scaffold into the checkout and might still pass on an unrelated non-zero exit. Run it in an empty temp dir and assert the listing is unchanged, as the `init --help` case does.

5. **Stale restatements in docs** — anchored lens. `docs/BACKLOG.md:~483` (shell-completion entry): "gains a fifth place" is stale now that the codebase-map chain says "all three". Its Design bullet also still proposes a separate src/cli/completion-spec.ts (old proposed path) table, which contradicts the rewritten "read those declarations" note. Fix both in this task: the file is in Affected Files, and AGENTS.md treats a stale restatement as a P2. `docs/patterns.md:27,276` still cites the removed `printHelp()`/`printUsage()` `--reroute` duplication as its example. The spec routes that one to QA (Docs Impact), so it is left for QA and is not required here.

#### Optional Cleanup / Nit

- `src/lib/cli-args.ts:~81`: `handlePreScan`'s `decl.command === 'watch' ? 2 : 1` branch is unreachable (watch calls `preScanArgs` directly), and the return type advertises `'help' | 'error'`, which is never returned. Prefer a declaration field (e.g. `usageExitCode`) or drop the branch. (anchored + cold Claude)
- `src/cli/commands/watch.ts:~226` and `~710`: `stderr(WATCH_USAGE)` has no trailing newline, so the usage block and the error message run together (`…usage_error.canon watch: Unknown option: --bogus`). The pointer is also rebuilt by splitting `unknownOptionMessage` on a newline; a separate pointer builder would be clearer. (anchored)
- `src/orchestrator/cli.ts` `parseArgs`: help and unknown-option exits through `handlePreScan` no longer call `setExitReason`, so a direct `run-task.js --help` logs a generic `process.exit` marker. This is only reachable on direct child invocation. (cold Claude)
- `tests/recovery-hints.test.ts:49,428`: duplicate HINT_SITES entry and stray blank lines. (anchored + cold Claude)
- `src/cli/commands/update.ts:51-52`: typographic `’` in the usage text, while the rest of the help is ASCII. The `TASK_USAGE` column alignment is uneven. (anchored)
- The handoff does not name the shared `runCanonCliIn` loader-path change in `tests/cli.test.ts:67` (AC-9 asks for each edited existing test to be named). (anchored)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): A literal `--help`/`-h` in a free-text slot (`task new id --help`) shows help instead of being stored as the title. Reason: Decision 4 says explicitly that "`--help` in a positional slot (a task id, a `task new` title, a `task set` value) is a help request."
- Dismissed (cold-Claude): A bare `--` is now rejected as an unknown option on stop/task. Reason: a `--` end-of-options marker is a listed Non-Goal, and Decision 5 rejects every undeclared dash-prefixed argument.
- Dismissed (cold-Claude): `TASK_ARGS` is unused at runtime, and `canon task --bogus` doesn't print the standard "Unknown option" line. Reason: AC-5 scopes unknown-flag rejection to each task *subcommand*. `canon task --bogus` still fails through the existing unknown-subcommand path with usage, exit 1.
- Dismissed (cold-Claude): Watch adds the `--help` pointer only on unknown-option errors, not on other usage errors. Reason: Decision 6 asks for the pointer on the unknown-option path only. The other usage errors are unchanged.
- Dismissed (cold-Claude): `task accept --reason=foo` and `run --expect=plan` are rejected. Reason: these were never accepted forms. Before this change, `--reason=foo` became a positional id and `--expect=plan` died as an unknown option. The Non-Goals forbid changing a flag's accepted forms, and the spec names only `--base=` and `--timeout=` as existing `=` forms.
- Dismissed (cold-Claude): The AC-1 test checks declared⊆parser but not parser⊆declared. Reason: the reverse direction is enforced at runtime, because the pre-scan runs before the parser and rejects any undeclared flag. A missing declaration fails loudly in any test that exercises the flag, and AC-1 asks only for the stated direction.
- Dismissed (cold-Claude): Recovery-hint exemptions are pinned to whole usage-literal lines. Reason: this is how the existing registry works. Brittleness in a guard test is accepted by design, and the low-confidence finding names no failure.
- Cold-Codex returned no findings, so nothing was dismissed.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required for the next iteration: findings 1–5 (finding 5 covers `docs/BACKLOG.md` only). The nits are optional.

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

**Scope:** Delta — base `4b18056690a994e9fd8ed6d1d0b10f14a3da2ffb` — reason: small fix within the files already under review

Lenses: anchored Claude (returned, `changes_requested`), cold Claude (returned, `changes_requested`), cold Codex (injected; one P2 on this review artifact).

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: pass. The handoff's `docs-refs-check` row is "Fail – unrelated". The cause was two backticked paths in the review artifacts, not code; the foreman fixed it this round (finding 2). Red-first does not apply (feature task).

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | The declarations were not touched by the iteration. |
| AC-2 | Met | The look-behind was removed at `src/lib/cli-args.ts:27-33`, and both dist bundles were rebuilt. Verified: `watch foo --timeout=5s --help` prints usage and exits 0. The tests that guard this fix are vacuous (finding 1). |
| AC-3 | Met (unchanged from round 1) | Side-effect tests are unchanged and pass. |
| AC-4 | Met | `--reason --help` still returns `proceed`, because the spaced value-flag branch consumes the value. `watch foo --until --help` still gives "Invalid phase", exit 2. |
| AC-5 | Met | `init --bogus` now runs in an empty temp dir and asserts the listing is unchanged (`tests/cli.test.ts:1119-1127`). |
| AC-6 | Met | The real `TASK_SUBCOMMAND_ARGS.set`/`.new` declarations go through `preScanArgs` (`tests/cli-args.test.ts:88-92`). |
| AC-7 | Met | The `task --help` overview lists all nine subcommands (`tests/task-cli.test.ts:2879-2884`). The `task set` usage pin moved to its new home (`tests/cli.test.ts:1074-1076`). |
| AC-8 | Met (unchanged from round 1) | `src/cli/index.ts` is unchanged. |
| AC-9 | Met | The anchored lens's targeted run passed 529/529. The handoff reports 1,631 passing. |

### Verifying Round 1 findings

- _code-bug 1:_ "`--help` after an `=`-form flag is swallowed" → code fixed (`src/lib/cli-args.ts:27-33`, dist rebuilt) ✓. The regression tests are vacuous; see new finding 1.
- _code-bug 2:_ "AC-6 tests bypass the pre-scan" → addressed (`tests/cli-args.test.ts:88-92`) ✓
- _code-bug 3:_ "AC-7 retarget gaps" → addressed (`tests/task-cli.test.ts:2879-2884`, `tests/cli.test.ts:1074-1076`) ✓
- _code-bug 4:_ "`init --bogus` test runs in the checkout" → addressed (`tests/cli.test.ts:1119-1127`) ✓
- _risk 5:_ "Stale BACKLOG completion entry" → addressed (`docs/BACKLOG.md:480,483`) ✓

### New findings

1. **The new regression tests for round-1 finding 1 cannot fail** — `code-bug` (test integrity). Flagged by 2 lenses (anchored Claude, cold Claude). `tests/cli-args.test.ts:41-43` spreads the shared `decl` (line 29), which has `freeTextSlots: [0]`. Neither `=` forms nor value flags advance `position`, so the `--help` lands in free-text slot 0, and the pre-fix code already set help through its `|| freeText` escape. Both lenses ran the three cases against `4b18056:src/lib/cli-args.ts`, and all three return `help`. If the look-behind came back, the suite would stay green. Nothing else in the suite tests `=`-form-then-`--help` on a real declaration. Fix: use the production declarations, which do go red against the old code: `preScanArgs(WATCH_ARGS, ['foo','--timeout=5s','--help'])`, `preScanArgs(TASK_SUBCOMMAND_ARGS.new, ['id','Title','--base=main','--help'])`, and `preScanArgs(TASK_SUBCOMMAND_ARGS.accept, ['id','qa','--reason','--reason','--help'])`, all expecting `help`. At minimum, override `freeTextSlots: []`. Confirm each assertion goes red with the look-behind restored (docs/patterns.md:188).

2. **Broken doc reference in review artifacts** — cold Codex (P2), confirmed by the anchored lens. `npm run docs-refs-check`, which runs in CI, failed on the backticked path of the BACKLOG's old completion-spec proposal at `tasks/per-command-help/review.md:73` and `review-cold-codex.md:6`. These are foreman/orchestrator artifacts, not implementer code, so the **foreman fixed them in this round**: the path is now un-backticked in `review.md`, `review-cold-codex.md`, and `review-cold-codex-run-2.md`, and `npm run docs-refs-check` now prints "All refs OK". No implementer action is needed.

#### Optional Cleanup / Nit

- `tests/task-cli.test.ts:2881-2883`: the `\b<name>\b` overview match is loose. Short names (`new`, `list`, `status`, `set`) can match prose elsewhere in the overview. Anchor each to its row instead (`^\s+<name>\b`, `m` flag). (anchored + cold Claude)
- No CLI-level test covers `canon task new foo Title --base=main --help` or `canon watch foo --timeout=5s -h`. Fixing finding 1 with the production declarations covers the parser layer, which is enough. (cold Claude)
- Round-1 nits still open (optional): the missing newline after the watch usage on stderr, the unreachable `watch ? 2 : 1` branch in `handlePreScan`, the `setExitReason` gap in `parseArgs`, the duplicate HINT_SITES entry, and the typographic apostrophe in the update usage. (anchored)

### Dismissed Cold Findings

- Dismissed (cold-Claude): A literal `--help` in a free-text slot always triggers help, unlike a flag value. Reason: Decision 4 requires this ("`--help` in a positional slot … is a help request"). It also predates this delta.
- Dismissed (cold-Claude): A flag in `equalsValueFlags` but not in `valueFlags` would reject its spaced form. Reason: this is a latent trap with no current instance. Every declaration lists such flags in both arrays, and the lens rated it low confidence.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Required: new finding 1 only. Finding 2 is resolved and the nits are optional.

## Round 3 — verifying iteration 3's response to round 2

**Scope:** Delta — base `ecdbb7b1786613eb2004e447a69f2d88d1781927` — reason: small fix within the files already under review

Lenses: anchored Claude (returned, `approve`), cold Claude (returned, `approve`), cold Codex (injected; no findings).

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: pass. Iteration 3 changed only a test file. The anchored lens independently ran the full `npm test`: 1635 passed, 0 failed.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | Declarations, usage, and parsers are unchanged. The table-driven test passes. |
| AC-2 | Met | `tests/cli-args.test.ts:91-101` now uses `WATCH_ARGS`, `TASK_SUBCOMMAND_ARGS.new`, and `TASK_SUBCOMMAND_ARGS.accept`. The anchored lens ran these cases against `4b18056:src/lib/cli-args.ts`: all three return `proceed` there and `help` now. |
| AC-3 | Met (unchanged from round 2) | Side-effect tests pass. |
| AC-4 | Met (unchanged from round 2) | `--reason --help` still returns `proceed`, so the value stays literal. |
| AC-5 | Met (unchanged from round 2) | Unknown-option tests pass. |
| AC-6 | Met (unchanged from round 2) | The real-declaration free-text and `=` cases at `tests/cli-args.test.ts:85-89` pass. |
| AC-7 | Met (unchanged from round 2) | Summary and overview assertions pass. |
| AC-8 | Met | The grep returns no matches. |
| AC-9 | Met | The full suite passes (1635). The iteration replaced three vacuous assertions with real-declaration equivalents. No test of a declared flag's behavior was weakened. |

### Verifying Round 2 findings

- _code-bug 1:_ "The new regression tests for round-1 finding 1 cannot fail" → addressed (`tests/cli-args.test.ts:91-101`; verified red against the pre-fix look-behind) ✓
- _finding 2:_ "Broken doc ref in review artifacts" → fixed by the foreman in round 2. `docs-refs-check` passes ✓

### New findings

None that drive the verdict. Under round-3 discipline, these optional observations are folded in:
- The Iteration 3 handoff lists a focused re-run, not a full `npm test`. The anchored lens's full run passes, so only the record is incomplete.
- There is no CLI-level (spawned) test of `--timeout=5s --help` or `--base=main --help`. The built `dist` was verified by hand, and the pre-scan is the only code path.

### Dismissed Cold Findings

- Dismissed (cold-Claude): The equals-form help tests would not catch the `equalsValueFlags` entry being dropped from a declaration. Reason: those tests target the look-behind regression and do catch it. Equals-form recognition is pinned elsewhere: the AC-1 table test feeds each declared `--flag=value` form through the pre-scan and parser, and `tests/cli-args.test.ts:88` checks that `--base=main` returns `proceed`. Low severity.
- Dismissed (cold-Claude): Moving from a synthetic declaration to production declarations ties the tests to declaration shapes. Reason: that coupling is the point of the fix, because the synthetic declaration's free-text slot is what made the old tests vacuous. A later shape change would surface in the AC-1 and AC-6 tests. Low severity, no current failure.
- Dismissed (cold-Claude): The `task accept` help case tests only the pre-scan, not the dispatcher's exit-0 path. Reason: `taskCmd` dispatch through `handlePreScan` is already tested end to end by the spawned `task accept foo code_review -h` case (`tests/task-cli.test.ts`, AC-2).

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
