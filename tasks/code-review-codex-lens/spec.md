# Spec: code-review-codex-lens — Add cold-Codex third lens to code_review

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's `code_review` runs two Claude lenses — an **anchored** lens (Stage 1 AC-compliance gate + Stage 2 quality, spec/handoff in context) and a **cold** spec-blind lens (diff + base ref only) — synthesized by a foreman. Empirically that's under-catching: **Codex's PR-level review routinely finds real P2s on canon's own PRs** — often enough that the operator now runs `codex review` by hand before opening every PR. Task 1 (`spec-bugfix-diagnosis-rule`) is a concrete instance: the cold-Claude lens raised the issue in `code_review`, the foreman dismissed it as off-AC, and Codex's PR review caught it anyway — the P2 shipped as a follow-up fix.

The catch is real but lands **too late** — at PR-review time, after the whole pipeline has run — so the fix becomes a post-PR follow-up commit instead of a pre-PR reroute.

Add a **third lens** to `code_review`: a cold (unanchored — unprompted, not bounded by the ACs; see AC-3) reviewer that runs on **Codex** (a different model family), invoked by the **orchestrator** as a step within the `code_review` phase, whose findings are fed to the foreman and synthesized alongside the two Claude lenses. This moves the Codex catch from PR-time into `code_review`, driving a reroute before the PR opens — institutionalizing what the operator already does by hand.

**Why this is not the "near-clone" the canon warns against.** [`docs/decisions.md:202`](docs/decisions.md:202) (the v1.11.0 re-baseline) says "Lens count stays two… added reviewers are near-clones. Do not add a third lens." That caveat is about adding reviewers **of the same model** — correlated blind spots, more noise, no recall gain. A cold-**Codex** lens is a **different model family** (GPT vs Claude), the documented exception: decorrelated blind spots, genuinely additive recall. Canon's own archived head-to-head ([`docs/decisions.md:301`](docs/decisions.md:301)) found Codex and cold-Claude are "**complementary, not substitutes**" (173 Codex PR findings, 0 false positives, ~76% off-AC). And the operator's lived experience — Codex repeatedly finding P2s the two Claude lenses miss — is direct evidence of decorrelation. So this task **overturns** [`docs/decisions.md:202`](docs/decisions.md:202) and the "park the Codex code-review phase" rule at [`docs/decisions.md:303`](docs/decisions.md:303) (which parked it "without fresh human direction" — now provided), reframing the rule as "one anchored + two **cross-family** adversarial lenses."

## Decision

Within the `code_review` phase, the **orchestrator** runs a Codex review of the task diff (`codex review --base <baseBranch>`, model = canon's resolved **mini** model) in the task worktree, **sequentially, before spawning the foreman**, capturing its findings to an artifact and recording how long it took. If that Codex review **fails to produce a review** (process error / no captured output — e.g. rate-limit, crash), the orchestrator **aborts the `code_review` phase before synthesis and stops the run for human re-run**, reusing the existing "a Codex invocation failed → stop" handling that already governs `spec_review`/`implement` — **no new verdict, no new routing**. On success, the orchestrator injects the captured Codex findings into the foreman prompt; the foreman spawns its two Claude lenses (anchored, cold-Claude) as before and synthesizes **all three** sets of findings, verifying each cold finding against the code.

**Why orchestrator-run (not foreman-run).** A foreman-owned `codex review` (the foreman shelling out in a tool-batch) would need either a fragile foreman-built poller or a new `codex_error` verdict threaded through the verdict enum / extraction / routing to make hard-fail deterministic. Orchestrator-run reuses canon's robust `codex`-invocation + failure-halt machinery, gets **deterministic hard-fail for free** (the orchestrator holds the exit code and stops before any verdict path), and adds **zero** new verdict surface. This is the design that resolved the round-1 spec-review blocker (a foreman "write a failure note and end the turn" contract collides with `checkAndRoute()` → `recoverPhaseForTask()`'s one-shot retry; the orchestrator-side stop bypasses recovery entirely). The cost is that the Codex review runs **sequentially** (not overlapped with the Claude lenses), adding its wall-clock to the phase. We accept that for v1 and **record the duration to the run log** (AC-4) so a later "build concurrent execution?" decision is data-driven rather than guessed.

## Non-Goals

- **No new verdict and no `codex_error`.** Hard-fail reuses the orchestrator's existing Codex-invocation-failure halt (the phase aborts before synthesis); the verdict enum, `extractCheckedVerdict`, and `checkAndRoute` are **untouched**.
- **No graceful degradation to a 2-lens review.** When the Codex lens can't run, the phase **stops** (it does not silently fall back to anchored + cold-Claude and approve). Rationale: a gate that quietly drops to the two lenses that already under-catch would ship the very findings this task exists to surface; codex unavailability is transient and re-runnable, and this matches how `spec_review`/`implement` already treat a failed Codex call.
- **No concurrent execution in v1.** The Codex review runs sequentially before the foreman. Concurrency (overlapping it with the Claude lenses) is explicitly deferred; AC-4's run-log duration line exists to decide whether it's worth building. No foreman-built poller, no file/PID-polling, no canon-supplied poller script.
- **No new `codexMatrix` phase / no `CodexPhase` member.** The cold-Codex model is the resolved **mini** model read from canon's existing policy config (`config.codexModelMini`, which already honors `CODEX_MODEL_MINI` / `CODEX_MODEL_DEFAULT` — `scripts/run-task/policy.ts:23`) — **not** a hardcoded literal, and **not** a new `codexMatrix` phase. This keeps the change off the `CodexPhase` union + `codexMatrix` + `tests/pipeline-policy.test.ts` surface while still avoiding a magic model string and honoring the env override. Per-size / per-shape lens gating is deferred.
- **No new agent definition.** `codex review` is a CLI subcommand the orchestrator shells, not a Claude Task subagent — there is no `code-review-codex-cold.md` agent file. The two existing Claude lens agents are unchanged in behavior (only their "two-lens" wording updates).
- **No change to the two Claude lenses' charters** (anchored Stage 1/2; cold spec-blind). The foreman still spawns them via the Task tool exactly as today.
- **No task-shape / size gating of lenses** — deferred.
- **PR-level Codex review stays ON.** This adds an in-pipeline lens; it does not remove the PR-level pass (which remains a belt-and-suspenders backstop).
- **`spec_review` and `implement` are untouched.**
- **No edit to historical / point-in-time records** — `CHANGELOG.md`, `docs/lessons-learned.md`, `docs/BACKLOG.md`, and the dated reports `docs/harness-audit-2026-06.md` + `docs/canon-opus48-gpt55-report.md` carry the old "two lenses / do not add a third lens" framing as accurate past record; excluded from the structural sweep (AC-10).

## Acceptance Criteria

> Feature/policy change, not a bug fix → red-first regression-test AC is N/A. Verification is the unit/integration tests + prompt golden (AC-14), the structural grep gate (AC-10), and the live dogfood run (the first task to run `code_review` *after* this merges is the first real exercise — see Known Risks + Human Test Plan).

### Orchestrator: run + capture + hard-fail (the core change)

- [ ] AC-1: In the `code_review` phase, **before** the foreman runs, the orchestrator obtains a cold (unanchored — see AC-3) Codex review of the task diff using canon's resolved **mini** Codex model, and captures the review's findings verbatim to a per-task artifact (`review-cold-codex.md`). The orchestrator does **not** interpret or parse the findings (no severity/P-level parsing) — it captures the review text as-is and hands it to the foreman (AC-8), which interprets it. Verify: a `code_review` phase test asserts the review step runs before the foreman and produces the artifact.
- [ ] AC-2: **If the Codex review can't be obtained, `code_review` stops for human re-run — it does not proceed on the two Claude lenses, does not approve, and does not advance to `qa`.** The stop happens before the foreman runs and is re-runnable (a later `canon run` retries the review when Codex is available) — matching how a failed Codex call already halts `implement`/`spec_review`. "Can't be obtained" means the review produced no findings output (error/crash/rate-limit), **not** a review that ran and merely reported issues — a review that runs is a success whose findings flow to the foreman, regardless of how Codex signals findings. (There is no graceful 2-lens fallback — see Non-Goals; and no new verdict — see Non-Goals.) Verify: a phase test where the review can't be obtained asserts the phase stops before the foreman with no advance to `qa`.
- [ ] AC-3: The cold-Codex review is **"cold" in the sense of unprompted + unanchored** — the orchestrator gives Codex no custom prompt and does not feed it the spec/ACs as a checklist to grade against; Codex runs its default adversarial review of the task's branch diff. **"Cold" does not mean engineered spec-blindness:** the review is *not* constructed to strip or hide task artifacts, and whether a committed doc happens to appear in the diff is immaterial — the PR-level `codex review` sees the whole diff (spec, plan, handoff included) and still surfaces real code findings; the value is being *unbounded by the ACs*, not blindfolded to them. Implementation is just a `codex review` over the task's branch diff — no artifact-filtering construction. (The branch is frozen post-`implement`, so the lens and the foreman see identical code.)
- [ ] AC-4: The orchestrator **records the cold-Codex review wall-clock duration to the run log** — a single `info()` line (e.g. `→ cold-codex review (<taskIds>): <n>s`) emitted after the timed review, so the sequential-vs-concurrent decision (Non-Goals; AC-13) can be revisited from real run data. The duration is measured with a `Date.now()` bracket around the review call (the timing approach `scripts/run-task/agents/codex.ts` already uses) and emitted via the orchestrator's existing `info()` logger (`scripts/run-task/cli.ts:103`). **No durable-metrics change:** this AC does **not** add a `MetricEntry` field, does **not** write a row to `docs/pipeline-invocations.md`, and does **not** touch `scripts/run-task/metrics.ts` or `scripts/run-task/types.ts` — the run-log line *is* the telemetry. (Rationale: the duration is secondary instrumentation for one future decision; a `metrics.ts` row would force an additive `MetricEntry`/`types.ts` change this spec disallows, and the foreman's own `code_review` metrics row already exists for diff-size correlation.) Verify: observable in the run log (Human Test Plan step 5) — a log-only line needs no automated assertion; the timing bracket lives in the `code_review` phase around the review call.

### Bundle contract (resolves the spec-review blocker)

- [ ] AC-5: **Bundle contract.** A bundle shares one branch and one combined diff, and a single cold review can't disentangle per-task changes — so the cold-Codex review runs **once over the combined diff per `code_review` invocation, not once per task**, exactly mirroring the two Claude lenses (which already review the combined diff and are attributed per-task by the foreman). Its findings reach **every** bundle member's review, and if the review can't be obtained the **whole** bundle stops (no member advances) — matching how the bundle already halts together. Verify: a 2-task bundle test asserts a single review run, that both members' reviews reflect its findings, and that a failed review stops the whole bundle with no member advancing to `qa`.

### Foreman: inject + 3-way synthesis

- [ ] AC-6: The foreman receives the captured cold-Codex findings as a **third lens input**, alongside the two Claude lenses it spawns. On a re-review round the foreman gets that round's fresh cold-Codex findings (the review is re-obtained each round on the current diff, consistent with "code review re-runs lenses from scratch each round"). Verify: the foreman prompt presents the cold-Codex findings and refers to three lenses (prompt test + golden).
- [ ] AC-7: The foreman still spawns the **two Claude lenses** (`code-review-anchored`, `code-review-cold`) via the Task tool, and now synthesizes **three** inputs: those two plus the injected cold-Codex findings. It does **not** run `codex` itself.
- [ ] AC-8: The Adjudicate step keeps **two distinct reconciliation checks separate** (load-bearing — conflating them re-introduces the Task-1 miss):
  - **"Does it hold against the code?"** — for the cold lenses (cold-Claude *and* cold-Codex), verify each finding against the actual diff/code. Codex P-levels (P1/P2/…) are inputs, not verdicts; a Codex finding that doesn't hold is dropped and recorded as `Dismissed (cold-Codex): <finding> - <reason>` (analogous to the existing `Dismissed (cold)`).
  - **"Is it in spec scope?"** — only the *anchored* lens reconciles against the spec/ACs.
  The template must **explicitly forbid dismissing a *verified* cold-Codex (or cold-Claude) finding merely for being off-AC / out of spec scope** — a real bug a cold lens caught is still a bug even if no AC named it (that off-AC dismissal is exactly the Task-1 failure this task exists to fix). Dedup across all three lenses: a finding flagged by **2+ lenses** is higher-confidence, and **cross-model agreement** (the same behavior flagged by *both* cold lenses — Claude and Codex) must **not** be dismissed as spec-intended without explicit spec evidence cited in `review.md`.

### Artifacts, agent wording, decisions

- [ ] AC-9: Lens-count wording → three, across **every** surviving "two/both/either lens" phrasing on the live surfaces:
  - `scripts/run-task/prompts/templates/code-review-foreman.md` — intro `:12` ("spawn two review lenses"), `:58` ("either lens"), `:62` ("two lens outputs"), `:66` ("flagged by both lenses" → "flagged by 2+ lenses"), and the "Spawn Lenses" / "Adjudicate" prose, all moved to three-lens framing (two spawned Claude lenses + one injected cold-Codex lens).
  - `.canon/templates/review.md:7` ("two review lenses: an anchored lens… and a cold lens" → three: anchored Claude, cold Claude, cold Codex; add a cold-Codex findings + `Dismissed (cold-Codex)` slot).
  - `.claude/agents/code-review-anchored.md:6` and `.claude/agents/code-review-cold.md:6` ("two-lens review pipeline" → "three-lens review pipeline").
  No surviving "two-lens" / "two review lenses" phrasing on these surfaces. (No `code_review` verdict checkbox change — there is no `codex_error`.)
- [ ] AC-10: **Structural sweep** — after the change, no live guidance surface asserts the old two-lens rule:
  ```
  rg -n --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' \
     -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
     -g '!docs/harness-audit-2026-06.md' -g '!docs/canon-opus48-gpt55-report.md' \
     -e 'two-lens' -e 'two review lenses' -e 'Lens count stays two' -e 'Do not add a third lens'
  ```
  returns no matches. (Auto-synced `CANON_OWNED` mirrors regenerate via sync; the non-managed `templates/docs/{decisions,product-context}.md` snapshots carry no lens content. **Classification rule for the exclusion list:** dated analysis reports + `CHANGELOG`/`lessons-learned`/`BACKLOG` are point-in-time/past record → excluded; `decisions.md` entries, `docs/` guidance, prompts/skills/templates are live → must be consistent.)

### Decisions overturned + recorded

- [ ] AC-11: [`docs/decisions.md:202`](docs/decisions.md:202) is rewritten: "Lens count stays two / **Do not add a third lens**" → "one anchored + two **cross-family** adversarial lenses (cold-Claude + cold-Codex)", with the correlated-error caveat scoped to **same-model** near-clones and cross-family decorrelation named as the exception. Generalize the count phrasing at [`docs/decisions.md:193`](docs/decisions.md:193) ("the **two** review lenses…" → "the review lenses…"; the find/filter decision is count-agnostic). No surviving "do not add a third lens" / "lens count stays two" / "two review lenses" in `decisions.md`.
- [ ] AC-12: The "park the Codex code-review phase" decision ([`docs/decisions.md:297`](docs/decisions.md:297) heading; rationale at `:299`–`:303`) is rewritten to record that the Codex cold lens is now **adopted in-pipeline** on fresh human direction, citing the empirical driver (Codex routinely finds PR P2s the two Claude lenses miss; operator pre-runs `codex review`). The `:303` rule ("Don't build the opt-in Codex code-review phase without fresh human direction") is updated to reflect that direction is now given and the in-pipeline cold-Codex lens is the realization.
- [ ] AC-13: A new `docs/decisions.md` entry documents the design: **orchestrator-run, sequential** cold-Codex review (`codex review --base …`, resolved mini model), findings injected into the foreman for 3-way **verify-don't-relay** synthesis; **deterministic hard-fail** by reusing the Codex-invocation-failure stop (no new verdict); the **bundle contract** (one review over the combined diff, atomic failure); and the **adjudicated tradeoff** — orchestrator-run chosen over foreman-owned (which would need a foreman poller or a new `codex_error` verdict); sequential chosen over concurrent for v1, with the run-log duration line (AC-4) to revisit. Cross-family-decorrelation rationale included.

### Docs, tests, build

- [ ] AC-14: Tests cover the new behavior: (a) the `code_review` phase invokes the Codex review and writes `review-cold-codex.md` before the foreman, passing the mini model (AC-1); (b) a failed Codex review aborts the phase and stops the run — no advance to `qa`, no foreman synthesis (AC-2); (c) the bundle case — one invocation, both task dirs written, atomic failure (AC-5); (d) the foreman prompt renders the injected cold-Codex findings slot + references three lenses (AC-6/7). Existing foreman-prompt tests (`tests/run-task-prompts.test.ts`) are updated and `tests/run-task-prompts.golden.json` regenerated (`UPDATE_GOLDENS=1 npm test`).
- [ ] AC-15: Docs updated: `docs/pipeline-orchestrator.md` — the **Code Review Diff Injection** / lens-description passages (≈lines 374/378) describe **three** lenses and the orchestrator-run sequential `codex review` step + its hard-fail + the run-log duration line; `docs/product-context.md` — the **Review** glossary row (`:38`, "by Claude" → reflects the independent cross-model lens; keep "two-stage", which is the anchored gate's structure) and the lens roadmap line (`:128`, "anchored + cold lenses" → three lenses incl. cold-Codex). (No `§Phase Routing` verdict row — there is no new verdict.)
- [ ] AC-16: `npm run build` is run and `dist/` is committed; `git diff --exit-code dist/` is clean. `npm run sync-templates` + `:check` pass. `npm run lint`, `npm run type-check`, `npm test` all pass; `npm run docs-refs-check` passes; the AC-10 grep gate returns zero matches.

## Design

### Affected Files

**A. Orchestrator — run codex review + hard-fail + duration + bundle (the core)**

| File | Change |
|---|---|
| `scripts/run-task/phases/code-review.ts` | Before spawning the foreman: obtain the cold Codex review over the (combined, for bundles) diff, capture its findings to `review-cold-codex.md`, time it; if the review can't be obtained, stop the phase before the foreman (AC-1/2/5); log the duration (AC-4); hand the findings to the foreman (AC-6). |
| `scripts/run-task/agents/codex.ts` | Add a helper to obtain a cold Codex review (unanchored, mini model) and return its findings text + whether it succeeded. (Confirmed invocation + parsing approach noted in Known Risks.) |
| `scripts/run-task/prompts/index.ts` | Thread the captured cold-Codex findings through to the foreman prompt as the third lens input (AC-6). |

**B. Foreman prompt + artifacts (mirrored where noted)**

| File | Change | Mirror? |
|---|---|---|
| `scripts/run-task/prompts/templates/code-review-foreman.md` | Spawn 2 Claude lenses (unchanged) + a slot presenting the **injected** cold-Codex findings as the third lens; 3-way verify-don't-relay synthesis + two-reconciliations + no-off-AC-dismissal + cross-model-agreement rule (AC-7/8); all "two/both/either lens" phrasing → three (AC-9). | No (bundles to `dist/`) |
| `.canon/templates/review.md` | "two review lenses" → three; cold-Codex findings + `Dismissed (cold-Codex)` slot (AC-9). | Yes |
| `.claude/agents/code-review-anchored.md` | "two-lens" → "three-lens" (AC-9). | Yes |
| `.claude/agents/code-review-cold.md` | "two-lens" → "three-lens" (AC-9). | Yes |

**C. Docs**

> Only `docs/pipeline-orchestrator.md` is canon-managed (`CANON_OWNED`) with an auto-synced mirror. `docs/decisions.md` + `docs/product-context.md` are **not** in `CANON_OWNED` — their `templates/docs/*.md` are independent scaffolds (sync neither regenerates nor polices them). Edit the root docs; leave those two scaffolds untouched.

| File | Change | Mirror? |
|---|---|---|
| `docs/decisions.md` | Generalize `:193`; rewrite `:202` (AC-11) + the `:297`/`:299`–`:303` Codex-phase decision (AC-12); add new design entry (AC-13). | No (not `CANON_OWNED`) |
| `docs/product-context.md` | Review glossary row (`:38`) + lens roadmap line (`:128`) → 3 lenses / cross-model (AC-15). | No (not `CANON_OWNED`) |
| `docs/pipeline-orchestrator.md` | Lens passages (≈374/378) → 3 lenses + orchestrator-run sequential codex step + hard-fail + duration telemetry (AC-15). | Yes (auto-synced) |

**D. Tests / generated / mirrors**

| File | Change |
|---|---|
| `tests/run-task-prompts.test.ts` | Foreman-prompt asserts injected cold-Codex slot + 3 lenses (AC-14d). |
| `tests/run-task-prompts.golden.json` | Regenerated via `UPDATE_GOLDENS=1 npm test`. |
| `tests/run-task-code-review.test.ts` (or the existing code-review phase test home) | New/extended coverage: phase invokes codex review + writes artifact before foreman + passes mini model (AC-14a); failed review aborts + stops, no advance to qa (AC-14b); bundle — one invocation, both dirs written, atomic failure (AC-14c). |
| `dist/` | Rebuilt via `npm run build` (AC-16). |
| `templates/.canon/templates/review.md`, `templates/.claude/agents/code-review-{cold,anchored}.md`, `templates/docs/pipeline-orchestrator.md` | Auto-synced mirrors of edited `CANON_OWNED` roots — do not hand-edit; listed for the `--pr` base-drift allowlist (regenerated by `npm run sync-templates`). |

> **Not edited** (excluded from AC-10 per its classification rule): `CHANGELOG.md`, `docs/lessons-learned.md`, `docs/BACKLOG.md`, `docs/harness-audit-2026-06.md`, `docs/canon-opus48-gpt55-report.md`. `docs/architecture.md` carries no lens content (verified) — not affected. No verdict-enum files (`types.ts`, `src/task/index.ts`, `validation.ts`) — there is no new verdict. **No telemetry-schema files** — `scripts/run-task/metrics.ts`, `MetricEntry` in `scripts/run-task/types.ts`, and `docs/pipeline-invocations.md` are untouched; the cold-Codex duration is a run-log line only (AC-4). No `scripts/pipeline-policy.ts` / `tests/pipeline-policy.test.ts` change — the mini model is read from existing policy config, not a new matrix phase (see Non-Goals).

### Interaction Dependencies

- The `code_review` phase gains a Codex-subprocess step. It must run in the worktree (`activeCwd`) so `codex review --base` diffs the task branch vs base. The branch is frozen post-`implement`, so no staleness race. The review surface must be the committed `<base>...HEAD` range (matching `getScopedDiff()` / the cold-Claude lens), not the uncommitted working tree (AC-3) — verify `--base`'s diff scope and pin to the committed range if needed.
- A failed cold-Codex review is a **phase-execution failure** surfaced before any verdict — it stops the run via the same path a failed `implement`/`spec_review` Codex call uses, bypassing `checkAndRoute` / `recoverPhaseForTask` entirely. Verdict extraction, iteration counters, and routing are unchanged.
- **Bundle interaction** (AC-5): the Codex review, the foreman, and the two Claude lenses all operate on the single combined branch diff; the foreman attributes findings per task during synthesis. The captured artifact is written per task; the failure is atomic across the bundle. No per-task Codex invocation.
- **`add-xs-tier` (in flight)** does not collide: this task makes no `pipeline-policy.ts` / `tests/pipeline-policy.test.ts` change, so there is no shared-file base-drift with that task on the policy surface. (Both may touch `docs/` + `dist/`; standard rebase resolves those.)

### Data Model Changes

None to `status.json` schema or the verdict enum. New per-task artifact `tasks/<id>/review-cold-codex.md` (captured Codex output). **No telemetry-schema change** — the cold-Codex duration is a run-log line only (AC-4), so `scripts/run-task/metrics.ts`, `MetricEntry` in `scripts/run-task/types.ts`, and `docs/pipeline-invocations.md` are untouched.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite (incl. the new code-review phase coverage + bundle case)
- [x] `UPDATE_GOLDENS=1 npm test` — regenerate `tests/run-task-prompts.golden.json`; commit; plain `npm test` passes
- [x] `npm run build` — compile to `dist/`; commit; `git diff --exit-code dist/` clean
- [x] `npm run sync-templates` + `:check` — regenerate/verify `CANON_OWNED` mirrors
- [x] `npm run docs-refs-check` — several docs edited
- [x] Structural grep gate (AC-10) — zero "two-lens" / "do not add a third lens" on live surfaces

## Docs Impact

- `docs/decisions.md`, `docs/product-context.md`, `docs/pipeline-orchestrator.md` are **changed** (see Affected Files).
- `docs/architecture.md`, `docs/codebase-map.md`, `docs/patterns.md` — no change (architecture.md carries no lens content; verified). `docs/codebase-map.md` adds no new top-level file/agent worth indexing (no new agent definition).

## Known Risks

- **The gate activates only post-merge — this task can't self-test the 3-lens behavior pre-merge.** The orchestrator runs from the base checkout, so the new Codex-review step only takes effect for tasks that run `code_review` *after* this merges (same bootstrap property the original multi-agent code-review task had). This task's own `code_review` runs under the **current two-lens** path. The live 3-lens exercise (Human Test Plan) lands on the next task on the merged base; plan the dogfood accordingly.
- **Can the orchestrator invoke `codex review` cleanly?** Lower risk than a foreman-spawned call — the orchestrator already drives `codex` (via `runCodex`/`streamProcess`) for `spec_review`/`implement`, and `streamProcess` controls child stdio (so the interactive-stdin hang that bites raw `codex exec` in a shell does not apply here). the operator-verified invocation is `codex exec review --json --base <branch> -m <model>`, which emits the same NDJSON `agent_message` stream `codex exec --json` does (so the existing parse path applies). Residual: collecting the `agent_message` text robustly across the stream; output shape + exit convention are operator-confirmed (findings ride in the `agent_message` text as prose + `[Pn] — file:line`; exit 0 whether clean or findings-present, so "review couldn't be obtained" = no `agent_message` / error, not a non-zero-on-findings code).
- **"Cold" = unanchored, not spec-blind.** The lens's value is being *unbounded by the ACs* (Codex reviews adversarially without a spec checklist), not being blindfolded to the spec — the PR-level `codex review` sees the full committed diff incl. task docs and still finds real code issues. So the implementation deliberately does **no** artifact-filtering: it just runs `codex review` over the task's branch diff. (Whatever `codex review --base` naturally reviews is acceptable; there is no requirement to exclude any file.)
- **Sequential latency on large diffs.** The Codex review is additive to the phase wall-clock and can exceed a few minutes on large diffs. Accepted for v1; AC-4's run-log duration line is the data to decide whether to build concurrent execution later.
- **Hard-fail vs. liveness on transient Codex outages.** A rate-limited Codex (the `gpt-5.4-mini` status-1 outage has bitten the pipeline before) will **stop** `code_review` until capacity returns, rather than degrade. This is the deliberate choice (Non-Goals): the operator is in the loop, the stop is re-runnable with a plain `canon run <id>`, and it matches how `implement`/`spec_review` already treat a failed Codex call. The cost is a potentially stalled phase during an outage; the PR-level Codex pass remains a backstop, but the in-pipeline gate prefers stopping to silently shipping a weaker review.
- **Foreman wrongly dismisses a verified Codex finding.** AC-8's separate-reconciliations + no-off-AC-dismissal + cross-model-agreement rule guards the Task-1 failure mode, but the foreman can still mis-verify — the same irreducible judgment risk as cold-Claude today. The third lens adds findings to weigh; it doesn't worsen the risk.
- **Codex false positives / staleness.** `codex review` is high-recall and emits findings that don't hold (the operator's manual test surfaced a stale P1). AC-8's verify-against-code is the mitigation; P-levels are claims to check, not verdicts.
- **Bundle mis-scoping (the resolved blocker).** AC-5's contract: one review over the combined diff, its findings reaching every member, atomic failure. The risk if mis-implemented is a bundle member's review not reflecting the cold-Codex findings, or a sibling failure leaving some members advanced — the bundle test (AC-14c) is the guard.

## Human Test Plan

> The first real exercise is the next task that runs code review **after this ships** (this task's own code review still runs the old two-lens path — see Known Risks).

1. Run a task through the pipeline to the code-review step.
2. Expected: code review now consults **three** independent reviewers — the two existing ones plus a reviewer based on a different AI model — and the resulting review reflects all three.
3. When the new reviewer flags something, expected: the review shows whether each item was **confirmed** or **dismissed (with a reason)** — not echoed verbatim — and a real issue is **not** waved off just because no acceptance criterion named it. Where two of the reviewers independently flag the same thing, expected: it's treated as high-confidence, not dismissed.
4. If the new reviewer can't run (e.g. rate-limited), expected: the review does **not** come back approved — the run stops and asks for attention, to be re-run when that model is available again.
5. After a run, expected: there's a recorded measurement of how long the new review took (so we can later judge whether running it alongside the other reviewers, to save time, is worth building).
6. Run a two-task bundle through code review. Expected: the new reviewer runs **once** over the combined change set, both tasks' reviews reflect its findings, and if it can't run, **both** tasks stop together (neither advances).

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (test / golden / grep / observable behavior)
- [x] Affected Files lists specific files with specific changes; mirrors declared (only `CANON_OWNED` roots) for `--pr` base-drift
- [x] Plan steps (fast tier) reference real names — N/A (full tier: delicate); ACs name real, grep-verified files/symbols (`code-review.ts`, `agents/codex.ts`, `promptCodeReview`, `streamProcess`, `getScopedDiff`, `config.codexModelMini`, `code-review-foreman.md`, `review.md:7`, agent defs:6, `decisions.md:193/202/297/299/303`, `product-context.md:38/128`) — all confirmed present this session
- [x] Known Risks covers the load-bearing risks (post-merge bootstrap, orchestrator→codex invocation, sequential latency, hard-fail-vs-liveness, off-AC dismissal, bundle mis-scoping)
- [x] Human Test Plan uses product language only (incl. the bundle case)
- [x] Validation Required has checked entries
- [x] (Bug/flake fixes; N/A for features/refactors) — N/A: feature/policy change; verified via tests + golden + structural gate + dogfood
- [x] "Cold" reframed (operator clarification) to **unprompted + unanchored**, not engineered spec-blindness (AC-3): the value is being unbounded by the ACs, not blindfolded — so no artifact-filtering construction, just `codex review` over the branch diff. Prior blockers stay resolved: AC-4 telemetry is a run-log line only (no `MetricEntry`/`types.ts`/`metrics.ts` change); orchestrator-run hard-fail (round 1) and the bundle contract (AC-5) are unchanged.
