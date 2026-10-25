# Code Review: shell-completion

> Reviewer: Claude | Spec: `tasks/shell-completion/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

A foreman synthesized this review from three lenses: anchored-Claude, cold-Claude, and cold-Codex (pre-obtained).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [ ] No required checks were skipped without justification. The fish `--no-execute` check was skipped locally because fish is absent. The spec allows that skip, but the check would have failed (see F1).
- [x] Red-first evidence recorded for each red-first AC (none are red-first)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: completion metadata | Pass | Metadata is on every named declaration and the value sets are exported. Pinned by `tests/completion.test.ts:22-40`. |
| AC-1a: validators read constants | Pass | None of the retired strings remain in `src/`. Error text is unchanged and the pinned tests are untouched. |
| AC-2: `canon completion` command | Pass | `tests/completion.test.ts:255-285` |
| AC-3: registry ↔ help | Pass | `src/cli/registry.ts` has no side effects. The bidirectional help test is in `tests/cli.test.ts`. |
| AC-3b: what each script completes | **Fail** | The fish script does not parse (F1). In bash/zsh, `task set` offers the wrong values (F2), and accept phases break once a prefix is typed (F3). |
| AC-4: task-id lookup | Pass | Root, subdirectory, worktree, and skipped entries are covered. The no-repo and no-`tasks/` cases are covered in bash only. |
| AC-5: no node per Tab | Pass | `tests/completion.test.ts:47` |
| AC-6: completion ↔ declaration | Partial | The tests pass, but the bash/zsh renderers hardcode the value-flag names and kinds and the free-text field names instead of rendering "only from that model" (F4). |
| AC-7: value sets accepted | Pass | `tests/completion.test.ts:224-253` |
| AC-8: goldens | Pass (mechanically) | The golden pins the broken fish script. |
| AC-9: syntax and smoke | **Fail** | `fish --no-execute` will fail in CI, where fish is installed and `CI` is set. The bash/zsh smoke table is complete, and the `/bin/bash` 3.2 and no-`compdef` cases pass. |
| AC-10: CI shells | Pass | |
| AC-11: adopter-safe output | Pass | |
| AC-12: `COMPLETION_ARGS` in declaration tests | Pass | |
| AC-13: docs | Pass | Nit: the step order in `docs/architecture.md:32` is wrong (N1). |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [ ] Human Test Plan is satisfiable by the implementation. Fish users get a script that fails to source.

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 fails on AC-3b and AC-9. The findings below come from all three lenses and are listed so iteration 2 can fix them in one pass. All are `code-bug` altitude.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Stage 2 was not run as a separate gate because Stage 1 failed. The consolidated findings below are still binding for iteration 2. The model, registry, validator refactors and test scaffolding are sound. The defects are in the per-shell renderers, especially in the parts that bypass the model.

### Findings

#### Correctness Bugs

- **F1 — The fish script is not valid fish** (`code-bug`; flagged by 2 lenses, anchored and cold-Claude; verified against the golden). `src/cli/commands/completion.ts:142-147,184-187,204-206,218-220,229-231,244-246` render each `switch` body in bash `case` syntax: `'init') string split …;; 'doctor') …`. fish needs `case <pattern>` lines. Line 251 renders `case 'task status'|'task phase'|…`, but `|` is a pipe in fish; alternatives are space-separated. Running `canon completion fish | source` hits a parse error, and CI's `fish --no-execute` will fail. Fix the renderer, regenerate the golden, and add a fish smoke test (at least a few AC-9 rows: `canon run `, `task phase alpha code_review done `, `task set alpha delicate `). The test can run whenever fish is present, and must run in CI.
- **F2 — `task set <id> <field> ` offers the wrong values in bash and zsh** (`code-bug`; 2 lenses; reproduced under `/bin/bash` 3.2). `boolValues` (`completion.ts:77,117`) is the union of every `valuesByField` set, and the `*)` arm (`:94,130`) applies it to every field except `task_size`, `title`, and `base_branch`. So `task set alpha delicate ` offers `XS S M L XL true false`. An unknown field also offers values, where AC-3b says "any other field offers nothing". The `title|base_branch` exclusion is hardcoded. Render a per-field `case` from `model.valuesByField`, as fish already does, with no default arm. Add smoke rows for a boolean field (exactly `true false`) and a free-text field (nothing).
- **F3 — bash accept-phase completion fails once a prefix is typed** (`code-bug`; anchored lens; reproduced). The code at `completion.ts:93` is `printf '%s\n' "$(_canon_task_ids) ${acceptValues}"`. `acceptValues` is already `q()`-quoted, so the literal `'implement spec_review code_review'` lands inside double quotes. With `COMP_WORDS=(canon task accept alpha imp)`, COMPREPLY is `[implement][spec_review][code_review]`, so there is no unique completion; with `code` it is empty. Emit the task ids and the accept phases as separate `printf` calls. Add a smoke row with a non-empty prefix, such as `task accept alpha imp` → exactly `implement`.
- **F4 — bash and zsh hardcode the value-flag table** (`code-bug`; 2 lenses). `completion.ts:89,126` count positionals with a fixed list: `--expect|--until` → phase, `--channel` → updateChannel, and `--reason|--timeout|--ref|--base`. That list is command-agnostic, and it bypasses `model.commands[].valueFlags` and `valueFlagKinds`. This breaks AC-6's "each shell renderer renders only from that model". It also reopens the Known-Risk failure mode: a value flag added later counts as a positional and shifts every later slot. The AC-6 synthetic test misses it because it only checks that `--zz-value` appears somewhere in the script. Generate the per-command value-flag `case` from the model, as fish does, and extend the synthetic test. A synthetic value flag placed before a positional must not shift that positional's slot. This is a code-bug, not a spec gap, because the spec already requires model-only rendering.

#### Risk / Guardrails

- **R1 — The phase/field context is read from a fixed word index** (anchored lens; low). `${w[3]}` in bash, `${w[4]}` in zsh, and `$rest[2]` in fish do not track the second counted positional. A flag before the phase or field misreads it. No such flag exists today for `phase` or `set`, but it breaks the "mirrors `preScanArgs`" contract. Fix it together with F4: record the counted positionals and index into them.
- **R2 — Commands that take one task id keep offering ids** (cold-Claude; reproduced). For `stop`, `watch`, `task status`, and `task reset-*`, the shell offers ids again after one is given: bash `stop alpha ` → `alpha`. Gate the task-id case on `n == 0` unless the slot is variadic. `positionals[].variadic` is already in the model and unused.
- **R3 — The zsh unknown-command flag fallback emits one joined candidate** (cold-Claude; reproduced). For `canon foo -<Tab>`, the `*)` arm prints `'--help -h --version -v'` without `${(s: :)}` splitting, so it yields one candidate. Split it like the other arms.
- **R4 — `canon task -<Tab>` never offers `--help`/`-h`** (cold-Claude). In bash and zsh, the subcommand list is returned before the `cur == -*` check. Check for a dash prefix first.
- **R5 — bash `COMP_WORDBREAKS` splits on `=`** (anchored lens; medium confidence). Real bash tokenizes `--timeout=5` as `--timeout`, `=`, `5`, so the `--*=*` arm never fires outside the hand-built smoke tests. It is harmless for today's commands, and fixing F4 should keep it that way. Either rejoin `=` tokens or record it as a Known Risk in the handoff.

#### Optional Cleanup / Nit

- **N1** — `docs/architecture.md:32` reads "…installs zsh fish tcsh via apt, runs npm test, and npm run build". CI's actual order is build → install shells → test, which `:157` already states correctly.
- **N2** — `dependsOn` and `freeTextSlots` in the model have no consumer (cold-Claude). Either use them while fixing F2/F4/R1, or drop them.
- **N3** — The `fail` calls in `completionCmd` (`completion.ts:268-275`) don't return. A stubbed `exit` that doesn't stop execution would make `shell.startsWith` throw on `undefined`. Write `return fail(…)`.
- **N4** — Add the no-repo and no-`tasks/` AC-4 cases to the zsh smoke test too, alongside bash.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): "No actionable defects found in the diff." Contradicted by F1, which two lenses independently confirmed against the golden. Codex did not exercise fish ("fish was not installed locally"). F2 and F3 were also reproduced.
- Dismissed (cold-Claude): "Task-id lookup misses `--separate-git-dir`, submodules, `GIT_DIR`, `CANON_TASKS_DIR_OVERRIDE`, and git < 2.31." The spec mandates this lookup (AC-4: the parent of `--git-common-dir`). Submodules are an accepted Known Risk. `--separate-git-dir` and `GIT_DIR` share the orchestrator's existing limitation, so they are not a new defect. Not a code-bug against this diff.
- Dismissed (cold-Claude): "Unquoted `$(compgen …)` in COMPREPLY is subject to globbing." Candidates are canon command, flag, and value tokens, plus task ids that `validateTaskId` restricts to safe characters. No glob-active candidate can be produced. This is the standard bash completion idiom.
- Dismissed (cold-Claude): "fish `test $cmd = task` misparses a dash-prefixed word." Low confidence and moot until F1 is fixed. The implementer should still quote `"$cmd"` while rewriting the fish renderer.
- Dismissed (cold-Claude): "The zsh `_canon` wrapper and `compdef` registration are untested under compsys." The spec explicitly allows the smoke test to call the helper directly (Implementation Notes, "Smoke-test helpers").
- Dismissed (cold-Claude): "Recovery-hint exemption snippets are now shorter." The spec's Affected Files row for `tests/recovery-hints.test.ts` sanctions updating the pinned snippets, and the registry still requires an exact single-line match. Accepted tradeoff.
- Dismissed (cold-Claude): "tcsh `complete` spec is never invoked." AC-9 requires tcsh only to pass `tcsh -f -n`, and tcsh is best-effort by design. The handoff reports that the tcsh load passed.

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
-->

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Full — base `main` — reason: delta line count 695 exceeds 400

This round was synthesized from three lenses: anchored-Claude, cold-Claude, and cold-Codex. Cold-Codex reported no defects and noted that it skipped the fish checks.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the Validation Outcomes table has no `Fail` rows. Neither the baseline nor Iteration 2 claims red-first evidence; the spec has no red-first ACs. Fish is still absent locally, so every fish check (syntax and the new runtime smoke) is **unverified**, not passing.

| AC | Status | Notes |
|---|---|---|
| AC-1: completion metadata | Met | Unchanged; pinned by the declaration test |
| AC-1a: validators read constants | Met | Retired strings absent; pinned error-text tests unchanged |
| AC-2: `canon completion` command | Met | `fail()` now returns on every error path (`completion.ts:318-327`) |
| AC-3: registry ↔ help | Met | Unchanged |
| AC-3b: what each script completes | Partial | Contextual verdict, field, and accept slots work in `/bin/bash` 3.2 and zsh (reproduced). Variadic `run` stops offering ids after the first one (F6) |
| AC-4: task-id lookup | Met | zsh now covers no-repo and no-`tasks/` (N4) |
| AC-5: no node per Tab | Met | Unchanged |
| AC-6: completion ↔ declaration | Met | Value-flag, equals-flag, value-kind, and positional cases are generated from the model (`completion.ts:88-130`); the synthetic value-before-positional test exists |
| AC-7: value sets accepted | Met | Unchanged |
| AC-8: goldens | Met | `dist` output is byte-identical to the goldens for all four shells |
| AC-9: syntax and smoke | Partial | All bash and zsh rows pass, plus the no-`compdef` case. The new fish smoke test will fail in CI (F5) |
| AC-10: CI shells | Met | |
| AC-11: adopter-safe output | Met | |
| AC-12: `COMPLETION_ARGS` in declaration tests | Met | |
| AC-13: docs | Met | The `architecture.md:32` order is fixed (N1) |

### Verifying Round 1 findings

- F1 fish syntax: addressed by reading. Bodies are `case` blocks and alternatives no longer use `|`. Still unexecuted locally (see F5).
- F2 `task set` values: addressed. `delicate` gives `true false`; `title` and unknown fields give nothing. Reproduced in bash 3.2 and zsh.
- F3 accept prefix: addressed. `task accept alpha imp` gives `implement` under `/bin/bash` 3.2.
- F4 hardcoded value-flag table: addressed. The table is generated from `valueFlagKinds` and `equalsValueFlags`.
- R1 fixed word index: addressed. Context now comes from the collected positionals via `dependsOn`.
- R2 single-id commands repeat ids: addressed, but the fix broke variadic `run` (F6).
- R3, R4, R5, N1–N4: addressed.

### New findings

#### Correctness Bugs

- **F5 — The fish smoke test will fail in CI** (`code-bug`, test integrity; anchored lens; verified by reading). `tests/completion.test.ts:298` expects `['spec_gap']` for `task phase alpha code_review done` with an exact `deepEqual` at `:306`. The generated fish script prints all five `code_review` verdicts for that input. Unlike the bash and zsh tests, the fish test has no "includes" mode. CI installs fish and sets `CI`, so the test cannot skip there. It passed locally only because it was skipped. Fix: expect the full `code_review` verdict list, or use includes semantics as bash and zsh do. In the handoff, record the fish rows as CI-only-verified.
- **F6 — Variadic `run` offers no ids after the first one** (`code-bug`; flagged by 2 lenses, anchored and cold-Claude; reproduced). `positionalCaseEntries` (`completion.ts:112-129`) handles a variadic slot only when fixed slots follow it. `RUN_ARGS`'s single trailing variadic slot falls through to the per-index path, so only `'run:0'` is emitted. In bash, `_canon_candidates "" run alpha` returns nothing; zsh and fish (golden) behave the same. AC-1 says "`RUN_ARGS`: variadic task ids". This is a regression from iteration 1. Fix: when the variadic slot is last, emit `'<path>':*` mapped to that slot's action. Add bash, zsh, and fish rows for `run alpha ` that include `beta`.
- **F7 — bash completion executes code embedded in task directory names** (`code-bug`, security; cold-Claude; **reproduced**). `_canon` passes `_canon_task_ids` output into `compgen -W "…"`, and bash expands `$(…)` inside a `-W` word list. A fixture repo with a task directory whose name is a command substitution that runs `touch PWNED` produced a `PWNED` file in the cwd after one `_canon` call (`COMP_WORDS=(canon run "")`) under `/bin/bash` 3.2. Cloning an untrusted repo and pressing Tab after `canon run ` is enough to run arbitrary commands. The unquoted `COMPREPLY=( $(…) )` also glob-expands candidates. Fix: build `COMPREPLY` without `-W` re-expansion, e.g. a `while IFS= read -r c` loop with a `[[ $c == "$cur"* ]]` prefix filter and `COMPREPLY+=("$c")`. Add a regression test with a `$(…)`-named task directory that asserts no side effect and literal (or no) output. zsh `compadd -a` and fish do not re-expand candidates. This supersedes the round-1 dismissal of the unquoted-`COMPREPLY` concern, which wrongly assumed every task id passes `validateTaskId`; directory names in a cloned repo are not validated.

#### Risk / Guardrails

- **R6 — A lone `=` is accepted after any value flag** (cold-Claude; reproduced by the lens). `canon update --channel=<Tab>` offers `main`, but the CLI rejects `--channel=main`. Accept the `=` separator only when the pending flag is in `equalsValueFlags`.
- **R7 — The variadic-then-fixed branch assumes exactly one trailing slot** (anchored lens). With two trailing fixed slots, `completion.ts:116-121` would offer both value sets at once. No such declaration exists today; a comment or a model-build assertion would make the limitation explicit.
- **R8 — Value-flag completion covers only `model.values` kinds** (anchored lens). A future value flag of kind `taskId` would complete nothing. Add a `taskId` arm, or narrow the type of value-flag kinds.
- **R9 — The tcsh `canon task -<Tab>` fallback offers the global flags** (cold-Claude; reproduced by the lens). The partial `-` becomes `w[3]`, so `--version`/`-v` are offered. tcsh is best-effort, so this is low severity.

#### Optional Cleanup / Nit

- N5 — Fish: `test $cmd = task` (`completion.ts:241`) is still unquoted; use `test "$cmd" = task`.
- N6 — bash `_canon_task_ids` calls `git` without `command`, whereas zsh and fish use `command git`.
- N7 — The fish smoke fixture has only `alpha`. Add `beta`, `_archive`, `.hidden`, accept, single-id, and dash-prefix rows; fish runs only in CI, so the extra coverage is cheap.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): "No actionable defects; fish checks skipped." Contradicted by F6 and F7, both reproduced, and by F5. Codex never exercised fish.
- Dismissed (cold-Claude): "bash tests model `--flag=` as a separate `=` word, which isn't what interactive bash produces." The smoke rows exercise the word-split form, which is what bash produces for `--timeout=5 `. The cursor-on-`=` sub-case gives no candidates and causes no wrong behavior, so it is not a test-integrity defect.
- Dismissed (cold-Claude): "Task-id lookup ignores `CANON_TASKS_DIR_OVERRIDE`, submodules, and git < 2.31." AC-4 mandates this lookup, and submodules are an accepted Known Risk (same disposition as round 1).
- Dismissed (cold-Claude): "Verdicts are offered whatever status was typed." AC-3b keys the verdict slot only on the phase. This matches the spec and is low confidence.
- Dismissed (cold-Claude): "fish one-line `if …; …; else …; end` may not parse." That is valid fish grammar, and the CI `fish --no-execute` check covers it.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

## Round 3 — verifying iteration 3's response to round 2

**Scope:** Delta — base `c0b9cc3581eaed5bc457c1bc8b2354d0a66dd825` — reason: small fix within the files already under review

Synthesized from three lenses: anchored-Claude (full diff), cold-Claude (delta), and cold-Codex (delta: "no definite regressions", full test run unverified). Per Round-3 discipline, only correctness bugs and spec gaps drive the verdict.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate. The handoff reports `docs-refs-check` as "Fail – unrelated". The anchored lens traced the failure to this review file's own round-2 prose, line 161, which quoted a command-substitution task-dir name. The foreman reworded that line in this round so the checker no longer trips on it. No red-first ACs. Fish is still absent locally, so the fish smoke rows are verified by reading only and will run for the first time in CI.

| AC | Status | Notes |
|---|---|---|
| AC-1: completion metadata | Met | Variadic `run` ids complete after the first id (bash 3.2 and zsh reproduced; fish emits `case 'run':*`). |
| AC-1a: validators read constants | Met (unchanged from round 2) | |
| AC-2: `canon completion` command | Met (unchanged) | |
| AC-3: registry ↔ help | Met (unchanged) | |
| AC-3b: what each script completes | **Partial** | bash, zsh and fish are correct. tcsh flag completion (scope item (c)) is broken by this iteration (F8). |
| AC-4: task-id lookup | Met | Only change is `command git`. |
| AC-5: no node per Tab | Met (unchanged) | |
| AC-6: completion ↔ declaration | Met | `taskId` value kinds and `equalsAllowed` come from the model. |
| AC-7: value sets accepted | Met (unchanged) | |
| AC-8: goldens | Met | Regenerated; they match `dist`. |
| AC-9: syntax and smoke | Met | bash/zsh rows pass. Fish rows are corrected and read as passing; not run locally. `tcsh -f -n` passes but misses F8, which is the accepted weakness of that check. |
| AC-10 to AC-13 | Met (unchanged) | |

### Verifying Round 2 findings

- F5, the fish exact-match row: addressed. It now expects the full `code_review` verdict list.
- F6, variadic `run`: addressed. Reproduced in bash and zsh; the fish case is generated.
- F7, bash code execution through `compgen -W`: addressed. `_canon` now filters with `while read` plus a prefix match. The anchored lens reproduced it: no side effect, and names come back literally. The new regression test fails against the `c0b9cc3` script.
- R6 and R7 addressed. R8 addressed (`taskId` arm). R9 is addressed in intent, but its fix caused F8. N5–N7 addressed.

### New findings

#### Correctness Bugs

- **F8: tcsh flag completion is broken by the R9 fix** (`code-bug`; cold-Claude; **reproduced by the foreman**). `tcshFlagProgram` (`src/cli/commands/completion.ts:322`) adds the awk clause `subcmd ~ /^-/`. Its `/` characters sit inside the tcsh `'C/-/…/'` spec, where `/` is the field separator, so the backquoted awk command is cut short.
  - Repro: interactive `tcsh -f -i` through a pty with the generated script. `canon run --p<Tab>` prints `Unmatched '`'.` and completes nothing.
  - Control: the same script with only that clause removed beeps the normal ambiguous `--pr`/`--push` match.
  - Every `C/-/` flag completion in tcsh is affected. That is AC-3b(c), one of the three things tcsh must complete.
  - Fix: avoid `/` in the awk program, e.g. `substr(subcmd,1,1) == "-"`.
  - Add a test asserting the generated tcsh `complete` line contains no `/` inside the backquoted program. Better still, run a pty smoke for `canon run --p`; `tcsh -f -n` and a direct `awk` run cannot see this.

#### Risk / Guardrails (non-blocking)

- **R10: equals-separator tests exercise a path real shells don't deliver** (2 lenses: anchored and cold-Claude). The tests call `_canon_candidates "="` directly. In interactive bash `cur` is `=`, so the `_canon` prefix filter drops every value. In zsh and fish, `--flag=` stays one `-`-word. No shipped equals flag has a value set (`--timeout` and `--base` are kind `none`), so nothing user-visible is affected today. If an equals flag ever gains a value kind, strip a leading `=` from `cur` in `_canon` before filtering.
- **R11: bash `--until=plan <Tab>` now counts `plan` as positional 0** (cold-Claude). That command line is invalid anyway, since `--until` doesn't accept `=`. Low.
- **R12: bash inserts candidates unescaped** (anchored and cold-Claude). Without `compopt -o filenames` or `%q`, a task dir with a space completes as two words. Valid task ids never contain spaces or shell metacharacters, and no code runs during completion, so this is cosmetic. `compopt` is bash-4-only, which the spec excludes.

### Dismissed Cold Findings

- Dismissed (cold-Codex): "no definite regressions". Contradicted by F8, which the foreman reproduced. Codex did not drive tcsh interactively.
- Dismissed (cold-Claude): "fish equals-separator smoke lacks the restricted env / `--no-config`". The fish smoke runs with `fish -c` in CI, where there is no user `config.fish`. Low confidence; fold it into the F8 test pass if convenient.
- Dismissed (cold-Claude): "guard ignores a second variadic slot; `dependsOn` past a variadic slot misindexes". No such declaration exists, and the new model guard plus R7's assertion constrain the shape. Hypothetical.
- Dismissed (cold-Claude): "equals-only flags in `valueFlagKinds` shift positional counts". Every current `equalsValueFlags` entry is also in `valueFlags` (`--timeout`, `--base`), so the bare-flag-consumes-next-word behavior matches the parser for every real flag. Hypothetical.
- Dismissed (cold-Claude): "`--x= <Tab>` stays pending". Low confidence, edge of an edge, and no real equals flag has a value set.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

## Round 4 — verifying iteration 4's response to round 3

**Scope:** Delta — base `5c12221a8538fac3d8358817e55f1f7f11fa93c4` — reason: small fix within the files already under review

Synthesized from three lenses: anchored-Claude (full diff), cold-Claude (delta), and cold-Codex (delta: "no definite regressions"). All three signal approve. Under Round-4 discipline, only correctness bugs and spec gaps drive the verdict.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the Iteration 4 Validation Outcomes have no Fail rows. lint, type-check, test, build, docs-refs-check, and sync-templates:check all ran. The spec has no red-first ACs. Fish is still not installed locally, so the fish runtime smoke rows run for the first time in CI. They are verified by reading only.

| AC | Status | Notes |
|---|---|---|
| AC-1: completion metadata | Met (unchanged from round 3) | |
| AC-1a: validators read constants | Met (unchanged) | |
| AC-2: `canon completion` command | Met (unchanged) | |
| AC-3: registry ↔ help | Met (unchanged) | |
| AC-3b: what each script completes | Met | tcsh flag completion is restored. Confirmed through a pty-driven `tcsh -f -i` by the anchored lens, the cold-Claude lens, and the foreman: completing `--p` after the run command beeps the ambiguous `--pr`/`--push` match, where the round-3 script printed "Unmatched". The task subcommand gives `--help -h` for `-`, and accept completes `--r` to `--reason`. |
| AC-4: task-id lookup | Met (unchanged) | |
| AC-5: no node per Tab | Met (unchanged) | |
| AC-6: completion ↔ declaration | Met (unchanged) | |
| AC-7: value sets accepted | Met (unchanged) | |
| AC-8: goldens | Met | The tcsh golden is regenerated and matches `dist`. |
| AC-9: syntax and smoke | Met | The focused suite passes 11/11 locally, with fish skipped. The new no-slash assertion fails against the round-3 script (anchored lens verified). |
| AC-10 to AC-13 | Met (unchanged) | |

### Verifying Round 3 findings

- F8, tcsh slash inside the `C/-/…/` spec: **addressed**. `completion.ts:322` now uses `substr(subcmd,1,1) == "-"`. Reproduced by three reviewers.
- R10–R12: still deferred and non-blocking, unchanged by this delta.

### New findings

#### Correctness Bugs

(none)

#### Risk / Guardrails (non-blocking)

- **R13 — the tcsh regression guard is a static text scan** (2 lenses: anchored and cold-Claude). `tests/completion.test.ts:361-363` bans slashes inside the first backtick pair. It does not catch other characters that are special to tcsh, nor a second backquoted clause, and no test presses Tab in a real tcsh. Today's program contains no such characters (cold-Claude checked dollar signs, `!=`, and backticks), so this only matters for future edits. tcsh is best-effort per the spec, and `tcsh -f -n` is the accepted check. A pty smoke would be the stronger follow-up.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "tcsh behaviour tests run `tcshFlagProgram` directly, not the quote-escaped embedded text." Low confidence. The model data contains no single quotes today, and the interactive pty runs exercise the embedded text end-to-end. It is folded into R13.
- Dismissed (cold-Claude): "test integrity — first-backtick regex could false-pass if the program contained a backtick". The program has no backtick, and a backtick would itself break the spec. Hypothetical, so it is folded into R13 rather than treated as a test-integrity defect in the current test.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
