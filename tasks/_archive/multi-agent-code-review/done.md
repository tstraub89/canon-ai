# Done: multi-agent-code-review — anchored + cold lenses, synthesis foreman

## What Changed

Canon's `code_review` phase now runs as a **synthesis foreman** that spawns two isolated review lenses in parallel and adjudicates their findings into a single `review.md` + verdict.

**Two new lens sub-agents**:
- **Anchored lens** (`.claude/agents/code-review-anchored.md`): applies canon's existing Stage 1 AC-compliance gate + Stage 2 code-quality + test-integrity charter, then returns structured findings to the foreman rather than writing the review artifact itself.
- **Cold lens** (`.claude/agents/code-review-cold.md`): reads the diff against `base_branch` with no spec, ACs, handoff, or canon context injected — spec-blind adversarial review. The isolation is enforced at injection; the cold lens cannot see the spec.

**Foreman** (`scripts/run-task/prompts/templates/code-review-foreman.md`): deduplicates overlapping findings, resolves cold-lens calls that the spec explains as intended behavior, classifies surviving findings as `code-bug` or `spec-gap`, and writes the single `review.md` with the verdict.

**New verdict: `spec_gap`**: when the root cause is a missing or wrong requirement (not an implementer error), the phase halts for human amendment rather than routing back to implementation. Wired across all seven verdict-surface locations: the `Verdict` type union, runtime `VALID_VERDICTS` + `assertValidVerdict()`, CLI help list, `status.json` template hint, `extractCheckedVerdict()` regex + `PHASE_GATE_CONFIG`, `review.md` template checkbox, and `checkAndRoute()` intercept in `main.ts`.

**No `PHASE_ORDER` change**: the phase name, artifact path, reroute target, bundle behavior, and iteration counters are unchanged. The restructuring is internal to `code_review`.

**Models**: both lenses and the foreman inherit the existing `code_review` model tier — sonnet on S/M, opus on L/XL/delicate — with no new model matrix. The diversity is framing (anchored vs cold), not model family.

## Files Changed

**New files**:
- `.claude/agents/code-review-anchored.md` — anchored lens agent definition
- `.claude/agents/code-review-cold.md` — cold (spec-blind) lens agent definition
- `scripts/run-task/prompts/templates/code-review-foreman.md` — foreman synthesis prompt
- `templates/.claude/agents/code-review-anchored.md` — adopter mirror
- `templates/.claude/agents/code-review-cold.md` — adopter mirror

**Modified**:
- `scripts/run-task/prompts/index.ts` — `promptCodeReview()` now always renders the foreman prompt
- `scripts/run-task/main.ts` — `checkAndRoute()` intercepts `spec_gap` before fall-through, auto-blocks with escalation
- `scripts/run-task/types.ts` — `spec_gap` added to `_VERDICT_VALUES` and `Verdict` union
- `scripts/run-task/validation.ts` — `extractCheckedVerdict()` regex + `PHASE_GATE_CONFIG` acceptance for `spec_gap`
- `src/task/index.ts` — `spec_gap` added to runtime `VALID_VERDICTS` and `assertValidVerdict()`
- `src/cli/index.ts` — `spec_gap` in CLI help verdict list
- `src/lib/canon-owned.ts` — lens defs registered as canon-owned
- `.canon/templates/review.md` + mirror — `Spec gap` verdict checkbox added
- `.canon/templates/status.json` + mirror — `spec_gap` in `_verdict_values` hint
- `AGENTS.md`, `CLAUDE.md`, `docs/pipeline-orchestrator.md` + all `templates/` mirrors — two-lens + foreman + `spec_gap` documentation
- `scripts/run-task/prompts/templates/code-review-round-1.md`, `-round-n.md` — marked as retained for anchored lens charter reference; no longer dispatched directly
- `dist/cli/index.js`, `dist/scripts/run-task.js` — rebuilt

**Tests added or extended**:
- `tests/run-task-extract-verdict.test.ts` — `Spec gap` checkbox extraction (bolded, unbolded, unchecked, misspelled)
- `tests/run-task-validation.test.ts` — `spec_gap` phase-gate acceptance
- `tests/task-cli.test.ts` — `canon task phase ... code_review done spec_gap` accepted at runtime; counters correct
- `tests/run-task-safety.test.ts` — `spec_gap` routing: blocks `code_review`, appends escalation, does NOT advance `qa`
- `tests/run-task-counter-schema.test.ts` — `spec_gap` increments total review iterations, resets current-loop counters
- `tests/run-task-prompts.test.ts` + `tests/run-task-prompts.golden.json` — foreman + both lens subagent types asserted; golden regenerated

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (753 passing, 1 skipped) | Pass |
| `npm run build` | Pass |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| End-to-end tests | not_configured — no E2E surface in canon-ai per `docs/architecture.md` |

Code review verdict: **Approved with nits**. No correctness bugs or spec gaps. Two risk items (cold-lens isolation is prompt-enforced not sandboxed; lens model tier is runtime-inherited not unit-verified) are accepted by design per the spec's Known Risks and Human Test Plan.

## Human Verification Required

None. (No `human_pending` validation checks.)

## Human Test Plan — verify before relying on the new gate

The reviewer flagged these as confirm-during-testing items (not blocking code defects). Run them on the first real task exercising the new foreman:

1. **`spec_gap` halt** (HTP step 2): run a task where the code faithfully matches the spec but the spec itself is wrong/incomplete. Confirm the run halts and prompts for human amendment — it must NOT loop back to implementation.
2. **Fail-loud** (HTP step 6): if the foreman or a lens errors or returns garbage, confirm the run visibly fails/retries rather than silently approving.
3. **Lens model tier** (Risk-2): on a `delicate: true` task, confirm the spawned lens sub-agents actually run at opus. The unit test covers the policy function for the foreman, not the inherited model the sub-agents run at — observe it once on a real delicate task.
4. **Spec-blind bug caught** (HTP step 1): run a task with a deliberate lifecycle/race bug that no AC names. Confirm it blocks.
5. **Trust audit** (HTP step 8): read the review output on a real task — are duplicate findings collapsed, are dismissed findings genuinely intended, are code-bug vs spec-gap calls correct?

## Decisions Made

- **All-LLM foreman (no Node synthesis layer)**: dedup, cold-vs-spec reconciliation, and altitude classification happen inside the foreman's LLM reasoning. Automated tests cover only the deterministic Node-level surface. Synthesis quality is validated by the Human Test Plan. Reversible — if the foreman is sloppy, introduce structured lens outputs and a Node synthesis layer.
- **`spec_gap` always halts for human** even under full-send; autonomous amendment is a deferred follow-up task.
- **No FP-revalidation pass**: canon's empirical FP rate in code review is ~0; same-model revalidation would rubber-stamp. Reversible if a nonzero FP rate appears.
- **Cold-lens isolation is prompt-enforced, not sandboxed**: the strongest mechanism available within the chosen all-LLM design. A `tools:` allow-list could harden it if a leak is observed.

## Open Questions / Follow-up

- **Nit-1 (optional)**: handoff deviation table omits that `scripts/run-task/phases/code-review.ts` was left untouched despite being in Affected Files — the all-LLM approach made the restructure unnecessary. Add a one-line deviation row if desired.
- **Nit-2 (optional)**: `code-review-round-1.md` / `-round-n.md` remain in the `TEMPLATES` map but are never dispatched. Consider removing them once the anchored lens def is settled; they will drift from `.claude/agents/code-review-anchored.md` over time.
- **Architect lens (backlog)**: a third cold lens asking "did we solve the right problem?" is deferred to a follow-up once this foreman infrastructure is validated. See `docs/BACKLOG.md` → `architect_review` lens.
- **Full-send auto-amend of `spec_gap`**: deferred to a separate task.

## Proposed Changelog

Audience: canon-ai contributors and adopters upgrading to v1.10.0. Version is already pinned as 1.10.0 on `release/v1.10`. This is a new agent capability — **minor** bump, no breaking changes. Human finalizes wording.

Proposed entry under `## [1.10.0] → ### Added`:

> **`code_review` now runs as a synthesis foreman over two isolated review lenses.** An anchored lens applies the existing Stage 1 spec-compliance gate + Stage 2 code-quality charter (unchanged); a cold, spec-blind lens reads the diff adversarially with no spec context injected. The foreman deduplicates overlapping findings, resolves cold-lens calls that the spec explains as intended behavior, classifies surviving findings as code-bug or spec-gap, and writes the single `review.md`. No `PHASE_ORDER` change; artifact path, reroute target, bundle behavior, and iteration counters are unchanged. Models: both lenses and the foreman inherit the existing `code_review` tier (sonnet S/M, opus L/XL/delicate). New lens agent definitions are canon-owned and ship to adopters via `canon upgrade`.
>
> **New `spec_gap` verdict halts `code_review` for human amendment instead of rerouting to implementation.** When the root cause of a review finding is a missing or wrong requirement, `code_review` sets its status to `blocked` + appends an escalation and stops. The human's path back: revise the spec's Amendment section and re-run. `spec_gap` is wired across all verdict surfaces; `canon task phase <id> code_review done spec_gap` is accepted.
