# Code Review: codex-config-models-effort

> Reviewer: Claude | Spec: `tasks/codex-config-models-effort/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens inputs this round: anchored Claude (Stage 1 pass, signal approve, 12 findings); cold-Claude (11 findings, signal changes_requested); cold-Codex (no findings; 757 scoped tests, type-check, lint, template sync, docs-refs and fresh-build comparison passed).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, full `npm test` 2,245 pass / 1 skipped, build, docs-refs-check, sync-templates:check)
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (none required — feature/default change)
- [x] Self-Check evidence in the effective record is not contradicted by the diff (anchored lens re-ran `npm run build` with no `dist/` diff, sync/docs-refs checks, and all 11 changed test files; confirmed shared-loader consumers in `src/orchestrator/phases/spec.ts`, `src/orchestrator/phases/qa.ts`, `src/orchestrator/validation.ts`, `src/orchestrator/main.ts`)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: defaults | Pass | Implement cells medium/high/high/xhigh/high in `src/lib/pipeline-policy.ts`; literal matrix in `tests/pipeline-policy.test.ts`. |
| AC-2: effort config | Pass | Distinct per-size override values, partial fallback, delicate S → XL key, largest-member and delicate-member bundles. |
| AC-3: scope bound | Pass | All-`low` implement overrides leave spec_review, code_review and every Claude cell unchanged. |
| AC-4: model precedence | Pass | Six spawned precedence cases per tier with distinct literals; real `-m` argv captured for spec_review, implement and cold lens. |
| AC-5: config root | Pass | Linked-worktree fixture resolves main values, sees a later uncommitted main edit, ignores an invalid worktree `codex` copy at startup and in shared loaders. |
| AC-6: validation errors | Pass | Parser table covers every named shape; startup fails in mixed and Claude mode with and without `--dry-run`, no spawn, `status.json` unchanged; doctor fails Codex while docs freshness passes; unknown key warns once. |
| AC-7: mid-run edit | Pass | Claude, size and loop-cap lookups succeed after the bad edit; next `getCodexConfig` exits with the M/ultra message. |
| AC-8: `--ship` exemption | Pass | Plain `--ship` with invalid main `codex` reaches archive. |
| AC-9: telemetry column | Pass | Ten-cell rows: session `medium`, sub-agent `-`, cold-lens success/fail `high`, rejected `ultra`; every `recordMetric` caller passes effort, including the subprocess-string caller. |
| AC-10: upgrade compatibility | Pass | Upgrade/header-only keep nine-cell rows byte-identical; fold appends a legacy fragment unchanged. |
| AC-11: cold-lens run log | Pass | `src/orchestrator/agents/codex.ts` prints `Model: … \| Effort: …`; console capture asserts it. |
| AC-12: parsing bound | Pass | `parseCodexSection` accepts only `mini`/`full` and XS–XL; shared parser knows `codex`, still reports `claude` as unknown. |
| AC-13: contract sweep | Pass | Superseded notes on the historical decisions; new decision entry; orchestrator doc and mirror cover the contract and keep the `max` note. |
| AC-14: error text | Pass | Message drops "not configurable", keeps bug attribution and the `~/.codex/config.toml` line, no `src/` path; asserted. |
| AC-15: purity | Pass | `src/lib/pipeline-policy.ts` gains only the effort constant/type and optional input; no fs or env reads. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Handoff Blocker (`--ship --dry-run` validates): agreed. The `--dry-run` branch runs before `--ship` and `printDryRunPlan` resolves backend configs, so the predicate `!cliArgs.ship || cliArgs.dryRun` matches the provider-pin precedent on the line above it. Spec §4 exempts only `--ship`, which "spawns no agent"; a dry-run plan does resolve agents.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is tight and well tested: the `codex` section has its own loader on `REPO_ROOT`, the shared docs/ship parser only recognizes the key, env precedence survives because built-in model fallbacks moved out of the import-time snapshot, and telemetry plumbing reaches every caller. Build output matches source. One blocking item: a pre-existing run-level test lost the property it guarded (below). One behavior change the human should see, which is spec-sanctioned: **malformed JSON in the main checkout's `.canon/config.json` now stops every non-ship run at startup, including worktree tasks whose own copy is valid and `claude`-mode runs, and stops in-flight mixed tasks at their next Codex call.** Before this task a worktree run read only its branch copy. See the dismissal below for the spec basis.

### Findings

#### Correctness Bugs

1. **`code-bug` (test integrity) — the dry-run "config source" test no longer proves a worktree task ignores the main checkout's docs-freshness settings.** `tests/run-task-ship-docs-fold.test.ts:503-518`. Source: cold-Claude (the anchored lens noted the same flipped assertion while discussing malformed JSON).
   - Before this diff, the `worktreeInvalid=false` arm wrote `{` to main and `{}` to the worktree and asserted exit 0. That proved the startup docs/ship loader reads only the active checkout. The diff keeps main as malformed JSON, so the new `requireCodexSection()` (`src/orchestrator/main.ts:4255`) now dies first, and the assertion was flipped to expect the codex "cannot be read" failure.
   - What still holds: the `worktreeInvalid=true` arm (main `{}`, worktree `{`) still catches a loader pointed back at `REPO_ROOT`. So the cold lens's "would still pass if repointed at REPO_ROOT" sub-claim does not hold.
   - What is lost: no run-level non-ship test has main with valid JSON and invalid `docs_freshness`/`ship` settings, a valid worktree, and an exit-0 run. Searched `tests/*.test.ts`; the only worktree-plus-main config fixtures are this one, the `--ship` variant at `tests/run-task-ship-docs-fold.test.ts:456-473` (ship reads main by design), and the codex-only fixtures in `tests/run-task-codex-config.test.ts`. Failure scenario: a change that also validates main's docs settings at startup for a worktree task (for example deriving the codex section via `loadDocsFreshnessConfig(REPO_ROOT)`) passes every test, which violates spec §3 "`docs_freshness` and `ship` keep their current root resolution". This diff added a new startup read of main, so this is the regression class the old assertion guarded.
   - Fix: in the `worktreeInvalid=false` arm, write main as valid JSON with an invalid docs setting (for example `{"docs_freshness":false}`), restore the exit-0 assertion, and keep a malformed-main case as its own assertion or test so the new codex-unreadable behavior stays covered.

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

Not blocking; address while fixing the item above if convenient.

1. **Doc gap on malformed main JSON** — `README.md:414-416` and `docs/pipeline-orchestrator.md` §"Codex settings" never say that malformed JSON in the main checkout stops worktree-task and `claude`-mode runs (and in-flight tasks at their next Codex call). The README also says malformed JSON fails "the docs-freshness check" in doctor; both checks fail. Spec Known Risk "Mid-run malformed config" says this is documented for operators; state it once. Flagged by anchored and cold-Claude.
2. **Misleading error for repos with no `codex` key** — `src/orchestrator/docs-freshness.ts` `unreadableCodex`, reached from `src/orchestrator/main.ts:4255` before the docs-freshness loader. A non-worktree adopter who never used `codex` and has malformed JSON now gets "…so its "codex" section cannot be read" instead of the docs-freshness message. Consider wording it as a whole-file JSON error. Flagged by anchored and cold-Claude.
3. **Empty env var and untrimmed model strings** — `src/orchestrator/policy.ts:32-33,79-80`: an exported empty `CODEX_MODEL_MINI=""`/`CODEX_MODEL_FULL=""` beats a configured model and yields `-m ''` (the `??` semantics predate this diff, but it now overrides config too). `src/orchestrator/docs-freshness.ts` validates `.trim()` but stores the raw value, so `" gpt-6-luna "` passes and reaches `-m` with spaces. Flagged by anchored and cold-Claude.
4. **Unknown-key hint and doctor pass text** — Codex unknown keys reuse `formatUnknownKeysWarning`, whose "(for example docs_freshness)" hint doesn't fit `codex.reasoning` (`src/orchestrator/policy.ts:70`, `src/cli/commands/doctor.ts`). Doctor says "codex section is valid" when the file has no `codex` key. Flagged by anchored and cold-Claude.
5. **Doubled "ignored"** — `src/orchestrator/env.ts:48-49` renders "is no longer honored — ignored; configure …". Flagged by anchored and cold-Claude.
6. **Worktree-root pattern has no stated exception** — `docs/patterns.md` §"Worktree runs: read files and set subprocess cwd from the active checkout, not REPO_ROOT" doesn't mention that the `codex` section deliberately reads `REPO_ROOT`. Spec Known Risk "Root confusion" names this pull; a one-line exception (or a source comment at `src/orchestrator/policy.ts:66`) would stop a future "fix". Anchored.
7. **Doctor wiring untested** — `tests/cli.test.ts:4473-4490` calls `checkCodexConfig` directly, so removing it from `doctorCmd`'s check list (`src/cli/commands/doctor.ts`) leaves tests green. This matches how `checkDocsFreshness` is already tested, so it's a convention gap rather than a regression. Anchored.
8. **Untested edges** — `--ship --dry-run` validating (documented, not tested); no spawned-argv assertion that a configured `implement_effort` reaches `model_reasoning_effort` (policy → argv plumbing is pre-existing and the resolved value is tested); `tests/agent-backend.test.ts:71` reads canon-ai's real config instead of the injectable `root` (spec Known Risk "In-process tests reading canon-ai's own config"). Anchored + cold-Claude.
9. **Duplicated built-in model defaults** — `gpt-6-luna`/`gpt-6.2-sol` now appear in both `policyConfig()` and `getCodexConfig()` (`src/orchestrator/policy.ts:50-51,79-80`); a future default bump could drift. Cold-Claude.
10. **Gate scope wording** — only plain `--ship` is exempt; `--pr`, `--reroute` and other no-spawn forms are blocked by an invalid `codex` section. Consistent with spec §4; the docs could say "only `--ship`". Anchored.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): malformed main-checkout JSON stops worktree and `claude`-mode runs (also raised by the anchored lens) - spec-intended. Spec §3 reads the `codex` section "only from the main checkout's `.canon/config.json`… once at orchestrator startup"; §4 says validation "follows the existing loader's style: hard errors stop the run" and "In `claude` provider mode the section is still validated at startup"; Known Risks "Mid-run malformed config (AC-7)" calls stopping at the next Codex call "intended". An unparseable file cannot yield a `codex` section, and silently falling back to defaults would drop operator settings. The documentation and message wording are kept as nits 1-2.
- Dismissed (cold-Claude): a non-worktree implementer can edit `codex.models.*` to change the model of the cold-Codex lens that reviews it, or halt the run - spec-sanctioned. Spec §3 "In a non-worktree task, the main checkout is the task's own working tree, so such an edit does take effect. That is accepted and documented", and the Human-decided "Config root" judgment call. The edit would also appear in the reviewed diff.
- Dismissed (cold-Claude): a read during an editor's truncate-then-write save can kill an in-flight run via `die()` instead of an `AgentSessionError` - the spec requires a bad mid-run edit to "stop the next Codex invocation with the same message" (§4, AC-7), and `die()` matches the existing startup config path. The race window is a partial write observed at the instant of a Codex resolution; low likelihood, no data loss.
- Dismissed (cold-Claude): `codex exec resume` after a mid-run edit may run with a different `-m`/effort than the original session - spec §3: "An edit on main therefore reaches the next Codex invocation of a task already in flight". Intended.
- Dismissed (cold-Claude): in-flight tasks' nine-column `metrics.md` fragments get ten-cell rows appended after upgrade - spec Known Risks "Mixed-width telemetry tables in adopters' repos": cosmetic and covered by the release note; Non-Goals exclude rewriting existing rows.
- Dismissed (cold-Claude): "if the docs loader were pointed back at REPO_ROOT, the dry-run config-source test would still pass" - does not hold; the `worktreeInvalid=true` arm (main `{}`, worktree `{`, expects failure) would exit 0 under that mutation and fail. The rest of that finding survives as Correctness Bug 1.
- Cold-Claude findings kept as nits: empty env/untrimmed model (nit 3), unknown-key hint/doctor text (nit 4), doubled "ignored" (nit 5), missing effort-argv test (nit 8), duplicated defaults (nit 9).
- Cold-Codex: no findings to dismiss.

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

**Scope:** Full — base `main` — reason: delicate

Lens inputs this round: anchored Claude (Stage 1 pass, signal changes_requested on one doc restatement); cold-Claude (11 findings, signal approve); cold-Codex (one P2 doc finding; 676 targeted tests, static checks and fresh-build comparison passed).

### Stage 1 — Acceptance Criteria Re-Check

The iteration changed tests and docs only; no `src/` or `dist/` delta (`git diff --stat 1d63a02 HEAD`). Anchored lens re-ran `npm run build` (no `dist/` diff), type-check, lint, `sync-templates:check`, `docs-refs-check`, and `tests/run-task-codex-config.test.ts` + `tests/run-task-ship-docs-fold.test.ts` (73/73). Effective Self-Check (Iteration 2 rows) is not contradicted by the diff.

| AC | Status | Notes |
|---|---|---|
| AC-1: defaults | Met (unchanged from round 1) | `src/lib/pipeline-policy.ts` implement cells unchanged; literals pinned in `tests/pipeline-policy.test.ts`. |
| AC-2: effort config | Met | New argv assertions in `tests/run-task-codex-config.test.ts` require `model_reasoning_effort=low` (M) and `max` (XL) on the real implement spawn. |
| AC-3: scope bound | Met | Same test keeps spec_review and cold-lens argv at `high` while `implement_effort` is set. |
| AC-4: model precedence | Met (unchanged from round 1) | Spawned precedence and `-m` routing tests unchanged and passing. |
| AC-5: config root | Met | Restored exit-0 dry-run cases at `tests/run-task-ship-docs-fold.test.ts:503-526`; anchored mutation (`configRoot = REPO_ROOT`) makes both fail. |
| AC-6: validation errors | Met | Startup-invalid loop now includes `--ship --dry-run` for both providers. |
| AC-7: mid-run edit | Met (unchanged from round 1) | Mid-run test passes. |
| AC-8: `--ship` exemption | Met | Plain `--ship` with invalid main `codex` still archives. |
| AC-9: telemetry column | Met (unchanged from round 1) | All `recordMetric` callers pass effort. |
| AC-10: upgrade compatibility | Met (unchanged from round 1) | Legacy fold test passes. |
| AC-11: cold-lens run log | Met (unchanged from round 1) | No source change. |
| AC-12: parsing bound | Met (unchanged from round 1) | No source change. |
| AC-13: contract sweep | Met | §7-named decisions entries carry superseded notes; malformed-JSON behavior documented. The repo-rule restatements outside §7's list are Stage 2 finding 1. |
| AC-14: error text | Met (unchanged from round 1) | No source change. |
| AC-15: purity | Met (unchanged from round 1) | No fs/env reads in `src/lib/pipeline-policy.ts`. |

### Verifying Round 1 findings

- _correctness bug 1 (test integrity, dry-run config source):_ addressed — `tests/run-task-ship-docs-fold.test.ts:503-526` has separate exit-0 cases for invalid main `docs_freshness` and invalid main `ship.merge_method` with a valid worktree, plus separate malformed-main and malformed-worktree failures. Anchored lens confirmed by mutation that pointing the startup loader at `REPO_ROOT` fails the restored cases. ✓
- _nit 1 (malformed-main JSON docs):_ addressed in `README.md` and `docs/pipeline-orchestrator.md` §"Codex settings" (mirror synced). ✓
- _nit 6 (patterns exception):_ addressed in `docs/patterns.md` §"Worktree runs: read files and set subprocess cwd from the active checkout, not REPO_ROOT". ✓
- _nit 8:_ partially addressed (combined ship/dry-run and effort-argv coverage added). Remaining nits 2, 3, 4, 5, 7, 9, 10 deferred by the implementer; still optional.

### New findings

1. **`code-bug` — stale contract restatements of the implement matrix and the config root.** Flagged by 2 lenses (cold-Codex P2 and anchored) for the first site; the foreman verified the second site while checking a cold-Claude sibling finding. AGENTS.md "Code Review Rules" makes a stale or contradictory restatement a P2.
   - `docs/decisions.md:252` — the "`spec_review` M effort" Rule still says M "now runs `mini/high`, identical to L on both `spec_review` and `implement`". True on `main` (implement M and L were both `max`); false under this diff's defaults (implement M `high`, L `xhigh`), and the clause has no superseded note. A reader attributing M-vs-L reroute deltas (the re-measurement this entry asks for) would wrongly treat implement effort as equal. Fix: add a superseded note on the implement-equivalence clause pointing to "Codex models and implement effort in .canon/config.json (2026-11)".
   - `docs/pipeline-orchestrator.md:369` (§Project-level resources, and its `templates/docs/pipeline-orchestrator.md` mirror via sync) — still says "Make config or managed-doc edits for an in-flight task in its worktree." For the `codex` section that is now wrong: a worktree copy is neither validated nor applied, so an operator following this line gets their Codex edit silently ignored. `docs/architecture.md:131` was already updated to "docs-freshness/ship config" plus the `codex` exception; mirror that wording here.
   - Not Stage 1 gaps (spec §7 enumerates other entries), but the edits sit in Affected Files and fall under the repo's contract-sweep rule.

#### Optional Cleanup / Nit (new this round; not blocking)

1. `README.md:414-420` — the rewrite dropped "Malformed JSON stops runs, including reroute and ship". Plain `--ship` still dies on malformed main JSON via `loadDocsFreshnessConfig(REPO_ROOT)` (`src/orchestrator/main.ts:4253-4257`), but the new text reads as if only worktree/`claude`-mode runs stop. Restore the general sentence ahead of the "also" sentence. Anchored.
2. `docs/patterns.md:159` — the new exception omits that plain `--ship` skips the `codex` read. Anchored.
3. `tests/run-task-ship-docs-fold.test.ts:503-526` — the malformed-worktree row's regex `/\.canon\/config\.json.*not valid JSON/` would also match the codex-unreadable message; add a negative match on `main checkout`. Anchored.
4. `tests/run-task-codex-config.test.ts:66` — the mixed arm of the `--ship --dry-run` row can't distinguish startup validation from dry-run plan resolution; only the claude arm pins the predicate. A comment would prevent a future dedupe. Anchored.
5. `src/orchestrator/agents/codex.ts:43-44` (pre-existing) — `runCodex`'s invalid-effort `die()` writes no metric row, so `docs/pipeline-orchestrator.md:262` "rejected effort when recorded before spawn" holds only for the cold lens. The doc's qualifier keeps it accurate; optional. Cold-Claude.
6. Round 1 nits 2, 3, 4, 5, 7, 9, 10 remain open (cold-Claude re-raised 3, 4, 5, 10 this round).

### Dismissed Cold Findings (Round 2)

- Dismissed (cold-Claude): re-reading the main checkout's file each Codex resolution can race a non-atomic write or branch switch (ENOENT → defaults, truncated → `die()`), and a main branch switch changes an in-flight task's model/effort - spec-intended. Spec §3 "An edit on main therefore reaches the next Codex invocation of a task already in flight, committed or not", §4 "A bad edit made mid-run stops the next Codex invocation", and Known Risks "Mid-run malformed config (AC-7)". The partial-write window is narrow; recorded as residual risk.
- Dismissed (cold-Claude): worktree `codex` section is silently accepted with no warning - spec §3 "a task worktree's copy of the section is never validated and has no effect" and AC-5/AC-12 require shared loaders to accept it without validating. The misleading doc line that would send operators there is folded into new finding 1.
- Dismissed (cold-Claude): `.claude/skills/canon-pipeline/recovery.md:84` "A one-step bump often raises effort" is stale - still true under the new defaults (XS→S, M→L, L→XL raise effort; "often", not "always").
- Dismissed (cold-Claude): `src/orchestrator/policy.ts` now imports `docs-freshness`, enlarging the import graph - no cycle or breakage (type-check, build and tests pass); code-quality preference only.
- Dismissed (cold-Claude): `REPO_ROOT` is not a checkout in bare-repo/`--separate-git-dir` layouts - pre-existing derivation in `src/orchestrator/env.ts`, used by every main-checkout read (ship, tasks); not introduced here, and spec §3 names `REPO_ROOT` as the root.
- Cold-Claude findings kept as carried nits: untrimmed model strings and empty env (Round 1 nit 3), `--pr`/`--push` gated (nit 10), unknown-key hint/doctor text (nit 4), doubled "ignored" (nit 5).
- Cold-Codex: its single finding survives as new finding 1.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

## Round 3 — verifying iteration 2's response to round 2

**Scope:** Full — base `main` — reason: delicate

Lens inputs this round: anchored Claude (Stage 1 pass, signal approve, nits only); cold-Claude (11 findings, signal changes_requested); cold-Codex (no findings; 592 scoped tests, type-check, lint, template sync, docs-refs and fresh-build comparison passed).

### Stage 1 — Acceptance Criteria Re-Check

This iteration changed docs only: `docs/decisions.md`, `docs/pipeline-orchestrator.md` and its `templates/docs/pipeline-orchestrator.md` mirror (`git diff --stat de14a7e HEAD`). The anchored lens re-ran `npm run build` (no `dist/` diff), `sync-templates:check` and `docs-refs-check`, and confirmed the mirror is byte-equal. Cold-Claude ran the full `npm test` (2248/2248). The effective Self-Check is not contradicted.

| AC | Status | Notes |
|---|---|---|
| AC-1: defaults | Met (unchanged from round 2) | `src/lib/pipeline-policy.ts` implement cells medium/high/high/xhigh/high. |
| AC-2: effort config | Met (unchanged from round 2) | Per-size overrides, delicate→XL, bundles, and argv low/max assertions. |
| AC-3: scope bound | Met (unchanged from round 2) | spec_review and code_review cells are not overridable; argv stays `high`. |
| AC-4: model precedence | Met (unchanged from round 2) | Spawned precedence and routing tests. |
| AC-5: config root | Met (unchanged from round 2) | Main/worktree fixture plus restored exit-0 root cases. |
| AC-6: validation errors | Met (unchanged from round 2) | Parser, startup/`--dry-run`/`--ship --dry-run` for both providers, doctor. |
| AC-7: mid-run edit | Met (unchanged from round 2) | Mid-run test. |
| AC-8: `--ship` exemption | Met (unchanged from round 2) | `src/orchestrator/main.ts:4255` predicate; plain-ship archive test. |
| AC-9: telemetry column | Met (unchanged from round 2) | Every `recordMetric` caller passes effort. |
| AC-10: upgrade compatibility | Met (unchanged from round 2) | Upgrade and fold legacy-row tests. |
| AC-11: cold-lens run log | Met (unchanged from round 2) | No source change. |
| AC-12: parsing bound | Met (unchanged from round 2) | No source change. |
| AC-13: contract sweep | Met | `docs/decisions.md:252` has a superseded note on the implement-equivalence clause (M mini/high, L mini/xhigh). `docs/pipeline-orchestrator.md:369` now limits worktree edits to docs-freshness/ship config and states the main-checkout `codex` rule, matching `docs/architecture.md:131`. The anchored sweep found no other stale restatement; cold-Claude's stale-restatement sweep was also clean. |
| AC-14: error text | Met (unchanged from round 2) | No source change. |
| AC-15: purity | Met (unchanged from round 2) | No fs/env reads in `src/lib/pipeline-policy.ts`. |

### Verifying Round 2 findings

- _code-bug 1 (stale restatements):_ addressed at both sites, `docs/decisions.md:252` and `docs/pipeline-orchestrator.md:369` plus its mirror. Cold-Codex, the lens that raised it in Round 2, returned no findings this round. ✓
- Round 2 optional nits and the deferred Round 1 nits stay open by the implementer's choice. Per Round 3 discipline they do not affect the verdict.

### New findings

(none) — no `correctness bug` or `spec gap` survives synthesis.

### Dismissed Cold Findings (Round 3)

- Dismissed (cold-Claude), as a test-integrity code-bug: `tests/agent-backend.test.ts:55-71` calls `getCodexConfig` without `root`, so it reads the main checkout's config and pins `gpt-6-luna`/`xhigh`. This is real environmental coupling, but it fails loudly when an operator adds a `codex` section to canon-ai's own main config. It never passes vacuously, so the test still verifies what it claims. canon-ai's `.canon/config.json` has no `codex` section today. The spec's Known Risks entry "In-process tests reading canon-ai's own config" asks for an injectable source, which exists (`root` parameter). Kept as Round 1 nit 8 (carried); not verdict-driving under Round 3 rules.
- Dismissed (cold-Claude): a transient partial read during an editor save or a main-checkout checkout can `die()` an in-flight run. Spec-intended; already dismissed in Round 2 (spec §3 and §4, Known Risks "Mid-run malformed config (AC-7)").
- Dismissed (cold-Claude): agents that can write the main checkout, whether a non-worktree Codex implementer or a Claude session with `--add-dir REPO_ROOT`, can change later Codex models. Spec §3 accepts non-worktree edits, and the config root was decided by the human ("Config root" judgment call). Claude sessions' write access to the main checkout predates this diff and already covers `src/` and every other file there.
- Dismissed (cold-Claude): untrimmed model strings (`src/orchestrator/docs-freshness.ts:158-159`) and empty env vars masking config (`src/orchestrator/policy.ts:32`). Carried Round 1 nit 3. These fail loudly at the first Codex spawn, and env `??` semantics predate the diff.
- Dismissed (cold-Claude): `policyConfig()` still reports env/built-in Codex models. No spawn path uses it for Codex. Every Codex spawn goes through `getCodexConfig`, which the lens itself confirmed. Code quality only.
- Dismissed (cold-Claude): `--pr`/`--push` are gated by an invalid `codex` section. Spec §4 exempts only `--ship`; carried Round 1 nit 10.
- Dismissed (cold-Claude): a misspelled top-level key (`"Codex"`) in the main config isn't warned on worktree runs. `canon doctor` in the main checkout warns about it through the docs-freshness check. This is a wording/UX nit, not a defect against spec §4.
- Dismissed (cold-Claude): doctor's "codex section is valid" text and the reused unknown-key hint. Carried Round 1 nit 4 (wording).
- Dismissed (cold-Claude): `tests/run-task-codex-config.test.ts:51` doesn't assert `main-mini` in the dry-run plan. The main-root resolution it would cover is pinned by the AC-5 main/worktree test in the same file (main-mini/minimal, then edited-mini/low). Coverage nit.
- Dismissed (cold-Claude): `runCodex` writes no metric row for an invalid effort. The asymmetry predates this diff, and config validation makes the path unreachable. Carried Round 2 nit 5.
- Anchored nits (config-root rule now has two full homes, `docs/architecture.md:131` and `docs/pipeline-orchestrator.md:369`; "the exception" phrasing): wording only, omitted from the verdict.
- Cold-Codex: no findings.

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
