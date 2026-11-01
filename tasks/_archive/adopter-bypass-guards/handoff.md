# Implementation Handoff: adopter-bypass-guards

> Author: implementer | Spec: `tasks/adopter-bypass-guards/spec.md` | Plan: `tasks/adopter-bypass-guards/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | Added the fail-open PreToolUse guard and generated adopter template. |
| `src/lib/canon-owned.ts` | Added the hook script to the canon-managed files. |
| `src/cli/commands/doctor.ts` | Added the exported settings snippet, registration detection, and non-failing doctor warning. |
| `src/cli/commands/upgrade.ts` | Added the not-registered notice after an upgrade. |
| `README.md` | Added guard-hook setup and coverage guidance; removed direct status-file setup guidance and corrected the shipped-files list. |
| `.claude/skills/canon-init/SKILL.md`, `templates/.claude/skills/canon-init/SKILL.md` | Added the consent-gated hook-registration step and updated the phase framing. |
| `.claude/settings.json` | Registered the guard for canon-ai while preserving the existing SessionStart entry. |
| `src/orchestrator/state.ts` | Routed invalid-field guidance through `canon task set` where supported and to a human otherwise. |
| `src/orchestrator/git.ts` | Replaced the direct-edit bundle mismatch instruction with the supported setter and human fallback. |
| `src/orchestrator/main.ts` | Reworded bundle mismatch and ship recovery messages; recovery commands include all task IDs in a bundle. |
| `src/orchestrator/detach.ts` | Replaced the `tail -f` recommendation with `canon watch` and a single-read alternative. |
| `src/task/index.ts` | Directed topology migration and malformed-status repair to a human. |
| `src/orchestrator/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec-revision.md` | Replaced the direct `delicate` status-file instruction with `canon task set`. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Reworded task metadata and worktree guidance; added the conditional guard-hook note. |
| `tests/canon-guard.test.ts` | Added subprocess coverage for status writes, worktree anchoring, shell parsing, monitoring, merges, fail-open behavior, snippet behavior, and deny reasons. |
| `tests/cli.test.ts` | Added init/upgrade, doctor, registration, README drift, and shipped-content coverage. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt snapshots for the revised `delicate` guidance. |
| `docs/decisions.md` | Recorded the managed-script and recommend-only registration decision. |
| `docs/BACKLOG.md` | Marked the pipe guard as ported while retaining remaining operator-local guard behavior. |
| `docs/codebase-map.md` | Added the guard-hook entry and registration source. |
| `.canon/hooks/README.md` | Distinguished orchestrator shell hooks from the Claude Code guard. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt the shipped bundles. |

## Canon Governance

The implementation does not change task provenance fields in `status.json.canon`.

## Intent & Rationale

The hook denies direct task-state writes, piped run/watch monitoring and log polling, and squash/default merges of task PRs. Its messages name supported canon commands or direct the agent to give the human an exact edit. Registration remains opt-in: init and upgrade install the script, doctor explains missing or partial registration, and canon never writes adopter settings.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| The init/upgrade CLI integration test invokes the built `dist/cli/index.js` entry instead of the source-tree CLI helper. | Running the source entry through `tsx` resolves init's package-relative templates from the source directory and failed with ENOENT. The built entry exercises the installed package layout used by adopters. | No behavior change; AC-1 and AC-8 are verified against the shipped CLI. |
| Added the hook path to `CANON_OWNED` next to the Claude skills, before the agent entries. | The grouping keeps the new Claude project-level hook with other `.claude` user-facing surfaces; ordering has no runtime effect. | None. |
| Reworded the parallel README delicate note and the pipeline-tier task-size summary in addition to the listed prompt and task-sizing lead-in. | The supplementary text sweep found direct `status.json` setup guidance in those same in-scope docs; leaving it would keep inviting a guarded edit. | Supports AC-10. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Managed and installed | Met | `CANON_OWNED`, init, upgrade restoration/refusal behavior, template mirror, and leak-scan list are covered. |
| AC-2: Status writes denied, neighbors allowed | Met | Tests cover main checkout, in-repo and external linked worktrees by absolute and relative paths, Bash write forms, reads, neighboring paths, and non-canon repos. |
| AC-3: Hand-rolled monitoring denied, neighbors allowed | Met | Tests cover pipe forms, wrappers, heredocs, comments, quoting, redirects, foreground modes, log follow/polling, and allowed neighbors. |
| AC-4: Task PR squash/default merge denied | Met | Tests cover explicit and implicit PR targets, allowed strategies, non-task PRs, lookup failure, and timeout. |
| AC-5: Fail-open | Met | Malformed/incomplete input, unknown tools, missing cwd, and a forced internal error exit 0 without a deny. |
| AC-6: Missing script is a no-op | Met | The settings command is tested both with a missing script and with an installed script that returns a deny. |
| AC-7: Adopter-safe actionable reasons | Met | A reason test checks all rule/mode builders for adopter-safe wording and a retry or human handoff. |
| AC-8: Recommend-only registration | Met | Snippet/README drift, exact tool matcher, doctor warn/pass cases, upgrade notice, and no settings writes are covered. |
| AC-9: canon-init offers the merge | Met | The skill's settings step asks owner consent, preserves existing hook keys, and its canon-managed mirror matches. |
| AC-10: No canon text invites a denied action | Met | The specified zero-match sweep and supplementary literal check pass. Prompt hits are classified below. |
| AC-11: Dogfood registration | Partial | The settings diff adds the exported snippet and preserves SessionStart; `checkGuardHook(process.cwd())` passes. The full doctor command from this linked worktree resolves the supervising checkout and warns because that checkout predates this task's files; see Blockers. |
| AC-12: Decision and docs recorded | Met | Decision, backlog, README, hook README, code map, detach comment, and docs references are updated. |

**AC-10 prompt sweep:** `src/orchestrator/prompts/index.ts` mentions `status.json` only in a prohibition against changing it. `src/orchestrator/prompts/templates/qa.md` mentions it as the source for a derived quality-log row and says not to overwrite a verdict from it; neither instructs an edit. The grep found no `gh pr merge` or piped `canon run`/`canon watch` instruction.

The supplied AC-10 pattern `migrate .status.json. manually` cannot match the no-backtick wording. The specified sweep returned zero matches after the doc mirror was synchronized; the supplementary literal scan also returned zero.

## Edge Cases Considered

- The status path is anchored to its own working-tree root, including external linked worktrees, and requires `.canon/`; unrelated repositories and non-root `tasks/` paths remain allowed.
- Shell parsing preserves quoted text, comments, heredoc bodies, line continuations, fd redirects, and read-plus-redirect commands while detecting the specified write and monitoring forms.
- PR lookup failures and timeouts allow the command; rebase and merge-commit strategies remain allowed.
- The hook fails open on malformed input, absent fields, lookup failures, and internal exceptions. PowerShell shell bypasses and Codex sessions remain outside coverage as specified.
- Registration unions supported matchers from project and local settings; partial registration and missing scripts remain warnings, not doctor failures.

## Blockers

- `[validation] AC-11 full doctor smoke`: `node dist/cli/index.js doctor` exited successfully but reported the hook as missing/unregistered because `doctorCmd` resolves a linked worktree to the supervising checkout through `src/lib/project-root.ts`. The task worktree itself has the hook and registration, and `checkGuardHook(process.cwd())` returns pass. Re-run `canon doctor` after the task changes reach the main checkout to verify the no-warning state. No ambiguity remains in the implementation choices.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| _(none — no red-first ACs)_ | | | | |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final run passed. |
| `npm run type-check` | Pass | Final run passed. |
| `npm test` | Pass | Final full suite: 2,016 passed, 1 skipped, 0 failed (2,017 total). The earlier golden-generation run exposed a source-entry fixture issue; after changing that test to invoke the built package entry, the full suite passed. |
| `npm run build` | Pass | Bundles rebuilt after source changes. |
| `npm run sync-templates:check` | Pass | All canon-managed mirrors are in sync. |
| `npm run docs-refs-check` | Pass | Passed after handoff and notes were written. |
| `E2E` | deferred_by_spec | Spec: `tasks/adopter-bypass-guards/spec.md`, Validation Required — E2E is not applicable for this CLI task. |
| Focused guard tests | Pass | 80 passed, 0 failed. |
| AC-10 pattern and prompt sweeps | Pass | Required patterns returned zero matches; remaining prompt hits are mentions/prohibitions classified above. |
| `git diff --check` | Pass | No whitespace errors. |
| `checkGuardHook(process.cwd())` | Pass | Active task worktree reports registration for all four tools. |
| `node dist/cli/index.js doctor` | human_pending | Ran in linked worktree; it warned against the pre-task supervising checkout. Re-run after task changes reach main to verify AC-11. |

## Ready for Review

- [ ] All spec ACs met (AC-11 full doctor verification remains pending in the supervising checkout)
- [ ] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes in this iteration

| File | What Changed |
|---|---|
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | Stop Perl option scanning at value-taking flags without losing `-i` backup-extension handling; parse leading GitHub CLI `-R` / `--repo` options and carry the selected repository into the PR-head lookup. |
| `tests/canon-guard.test.ts` | Pin the `perl -Mstrict` read allow case, `perl -pi.bak` write denial, and all three leading GitHub CLI repository-option forms, including repository forwarding to the lookup. |

### Findings addressed

- **Correctness bug 1:** `isPerlInPlace` now stops at value-taking flags (`M`, `m`, `I`, `e`, `E`, `x`, `l`, `0`, `C`, `d`, `D`, `V`), so `perl -Mstrict -ne 'print' tasks/foo/status.json` is allowed. It still detects the in-place `i` flag before an optional backup suffix, including `-pi.bak`.
- **Correctness bug 2:** `parseGhMergeArgs` skips leading `-R <repo>`, `--repo <repo>`, and `--repo=<repo>` options before recognizing `pr merge`. The selected repo is forwarded to `gh pr view`, and task PR squash/default merges are denied for each form.

### AC deltas

| AC | Delta |
|---|---|
| AC-2 | Added coverage that a Perl module/read command is allowed while `perl -pi.bak` remains denied as a status write. |
| AC-4 | Added deny coverage for all three leading repository-option forms and an assertion that the PR-head lookup uses the selected repository. |

### Red-First Evidence

| Finding / AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| Correctness bug 1 / AC-2 | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/canon-guard.test.ts` | Pre-iteration `HEAD` `2ba16915463ca0b8fce866a760f69cbd19c4361b` | The `perl -Mstrict` read case was denied by the in-place matcher. | Focused suite passes: 85 tests, 0 failures; the read is allowed and `-pi.bak` remains denied. |
| Correctness bug 2 / AC-4 | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/canon-guard.test.ts` | Pre-iteration `HEAD` `2ba16915463ca0b8fce866a760f69cbd19c4361b` | `gh -R`, `gh --repo`, and `gh --repo=...` merge commands were allowed because the parser expected `pr` first. | Focused suite passes: 85 tests, 0 failures; each command is denied and the lookup log contains `-R owner/repo`. |

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final revision run passed. |
| `npm run type-check` | Pass | Final revision run passed. |
| `npm run build` | Pass | Rebuilt CLI bundles successfully. |
| `npm run sync-templates` | Pass | Synchronized the hook template mirror. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |
| `npm run docs-refs-check` | Fail – unrelated | Reports one broken reference at [tasks/adopter-bypass-guards/review.md](tasks/adopter-bypass-guards/review.md):71. This review artifact is outside the spec's Affected Files; details are in Blockers below. |
| Focused guard tests | Pass | `tests/canon-guard.test.ts`: 85 passed, 0 failed. |
| `git diff --check` | Pass | No whitespace errors. |
| E2E | deferred_by_spec | Spec: `tasks/adopter-bypass-guards/spec.md`, Validation Required — CLI task with no UI. |

### Blockers

- `[validation]` `npm run docs-refs-check` reports a broken reference at [tasks/adopter-bypass-guards/review.md](tasks/adopter-bypass-guards/review.md):71. The reviewer-maintained artifact contains a backticked pseudo-path with `.` as the task ID; no matching repository file exists. `review.md` is outside Affected Files, so it was left unchanged. Reproduction: run `npm run docs-refs-check`; it reports that single reference.

## Iteration 3 — addressing review round 2

### Changes in this iteration

| File | What Changed |
|---|---|
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | Parse Perl short-option clusters with optional values accurately; recognize GitHub repository flags before `pr`, between `pr` and `merge`, and among merge arguments. Keep joined `-R` values out of merge-strategy detection. |
| `tests/canon-guard.test.ts` | Add Perl denial cases for `-lpi`, `-0777pi`, and `-C16pi`, allow cases for `-Fi`, `-Ci`, and `-Dpi`, and GitHub repo-flag cases for all requested spellings and positions. |

### Findings addressed

- **Correctness bug 1:** The Perl scanner now continues after optional `-l`, `-0`, and `-C` values, including octal/hex record separators and Unicode flag lists. It stops at `-F` patterns and handles conditional `-d` / `-D` values, so `-lpi` and `-0777pi` remain guarded while `-Fi`, `-Ci`, and `-Dpi` reads are allowed. The debug flag set includes `i` and `y` to avoid treating those `-D` value letters as `-i`.
- **Correctness bug 2:** Shared `parseGhRepoOption` handling accepts `-R <repo>`, `--repo <repo>`, `--repo=<repo>`, `-R=<repo>`, and `-R<repo>` before or after `pr`; `findPRReference` reuses it across merge arguments. The selected repository reaches `gh pr view`. Merge short-cluster detection now matches only `-r` / `-m` combinations, so a joined `-Rowner/repo` is not mistaken for a merge strategy.

### AC deltas

| AC | Delta |
|---|---|
| AC-2 | Covers the reported in-place bypasses, the `-Fi` read neighbor, and additional Perl optional-value cases. |
| AC-4 | Covers all supported repository flag spellings before `pr`, between `pr` and `merge`, and in merge arguments; asserts the lookup receives `owner/repo`. |
| AC-12 | `npm run docs-refs-check` now passes after the Round 1 review artifact's pseudo-path was corrected by the reviewer. |

### Red-First Evidence

| Finding / AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| Correctness bugs 1 and 2 / AC-2 and AC-4 | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/canon-guard.test.ts` | Pre-iteration `HEAD` `5938661d0350b35a376bc35470143ca378f35c07` | The new suite reported 14 failures: `-lpi` and `-0777pi` were allowed, `-Fi` was denied, and the added GitHub repo-option forms bypassed the deny or lookup. | Focused suite passes: 102 tests, 0 failures. |

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final revision run passed. |
| `npm run type-check` | Pass | Final revision run passed. |
| `npm test` | Pass | 2,038 passed, 1 skipped, 0 failed (2,039 total). |
| `npm run build` | Pass | CLI bundles rebuilt successfully. |
| `npm run sync-templates` | Pass | Synchronized the hook template mirror. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| Focused guard tests | Pass | `tests/canon-guard.test.ts`: 102 passed, 0 failed. |
| E2E | deferred_by_spec | Spec: `tasks/adopter-bypass-guards/spec.md`, Validation Required — CLI task with no UI. |

### Blockers

- No new blockers in this iteration. The earlier AC-11 doctor smoke remains `human_pending` until the task changes reach the supervising checkout.

## Iteration 4 — addressing review round 3

### Changes in this iteration

| File | What Changed |
|---|---|
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | Stop treating letters after Perl `-C` as independent switches; recognize a short merge-option cluster as an allowed merge strategy only when it contains `r` or `m` and otherwise uses the known `d` / `s` / `r` / `m` flags. |
| `tests/canon-guard.test.ts` | Replace the invalid `perl -C16pi` test command with the valid `perl -C16 -pi` write form; add denial coverage for `-ds` and allow coverage for `-dr` and `-dm`. |

### Findings addressed

- **Correctness bug 1 / AC-4:** Short clusters that combine delete-branch with rebase or merge-commit (`-dr`, `-dm`) remain allowed. A non-strategy cluster (`-ds`) does not bypass the task-PR squash/default guard.
- **Test-integrity finding / AC-2:** Perl `-C` consumes the rest of its option word as its value, so `-C16pi` is not a valid in-place invocation. The test now uses `-C16 -pi`, which exercises an actual in-place option after the Unicode setting. The scanner stops at `-C` within that word and still sees the following `-pi` argument.

### AC deltas

| AC | Delta |
|---|---|
| AC-2 | Replaced the invalid Perl test form with a valid Unicode-setting plus separate in-place flag command. |
| AC-4 | Pins allowed `-dr` / `-dm` merge clusters and denial of a cluster without a merge strategy. |

### Red-First Evidence

| Finding / AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| Correctness bug 1 / AC-4 | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/canon-guard.test.ts` | Pre-iteration `HEAD` `89137cb` | Both new allowed-strategy assertions failed: `gh pr merge 12 -dr` and `gh pr merge 12 -dm` were denied. The new `-ds` denial assertion passed. | Focused suite passes: 105 tests, 0 failures. |

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Ran after hook, mirror, and test changes. |
| `npm run type-check` | Pass | Ran after hook, mirror, and test changes. |
| `npm test` | Pass | 2,041 passed, 1 skipped, 0 failed (2,042 total). |
| `npm run sync-templates` | Pass | Synchronized the managed hook mirror. |
| `npm run sync-templates:check` | Pass | All canon-managed files are in sync. |
| Focused guard tests | Pass | `tests/canon-guard.test.ts`: 105 passed, 0 failed. |
| `git diff --check` | Pass | No whitespace errors. |
| `npm run docs-refs-check` | Pass | `All refs OK`. |

### Blockers

- No new blockers. The existing AC-11 doctor smoke remains `human_pending` until the task changes reach the supervising checkout.
