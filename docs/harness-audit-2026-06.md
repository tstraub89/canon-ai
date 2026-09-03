# Harness Audit — Agentic-Coding SOTA & Model-Generation Review (June 2026)

> One-time audit of canon's LLM-facing guidance (CLAUDE.md, AGENTS.md, pipeline
> prompts, agent definitions, model/effort matrix) against (a) current agentic-
> coding research and (b) the behavior changes in the model generation canon now
> runs on: **GPT-5.5 / GPT-5.4-mini, Claude Sonnet 4.6, Claude Opus 4.8** (canon
> was originally tuned on roughly GPT-5.3 / Sonnet 4.5 / Opus 4.5).
>
> This is a durable analysis doc, not a spec. Findings are prioritized P0–P2.
> A companion external-research brief informed it but is not part of the repo.

## Headline

Canon is **strongly aligned** with current SOTA — the architecture needs no
rewrite. Four independent 2025–2026 research findings each endorse a design
choice canon already made. The actionable output is a set of targeted prompt and
model/effort-matrix adjustments driven by specific new-model behavior, plus a
re-baselining opportunity that *advances* canon's "smaller models win with
scaffolding" thesis rather than contradicting it.

## What the research validates (do not change; document the backing)

| Canon design | Now backed by |
|---|---|
| Spec = external behavioral contract authored before code | GitHub Spec Kit Specify→Plan→Implement (2025-09-02); Zietsman, *Specification as Quality Gate* (arXiv 2603.25773, 2026-03-26) — the spec is the external reference that breaks the "AI-reviews-AI is circular" failure |
| Single implementer; parallel fan-out only at review | Anthropic, *How we built our multi-agent research system* (2025-06-13): *"most coding tasks involve fewer truly parallelizable tasks than research"* — coding implementation is the canonical *don't-fan-out* case |
| Anchored + cold lenses **adjudicated by a foreman**, never voted | Vallecillos-Ruiz et al., *Wisdom and Delusion of LLM Ensembles* (arXiv 2510.21513, 2025-10): consensus voting triggers the "popularity trap" (amplifies shared errors); **diversity-based** selection recovers up to 95% of ensemble value, "even in small two-model ensembles" |
| Cross-model review (Claude reviews GPT's code) | Same papers: correlated errors are worst when reviewer and implementer share a model. Cross-model review is a structural advantage. |
| Deterministic gates first (validation table), LLM for the residual | Anthropic, *Effective harnesses for long-running agents* (2025-11-26): baseline tests each session, *"unacceptable to remove or edit tests"* — validates canon's "tests change only when behavior intentionally changes" rule |
| Phase-isolated sessions handing off distilled artifacts | Anthropic, *Effective context engineering for AI agents* (2025-09-29): sub-agents return 1–2k-token distilled summaries in clean windows. Canon's `review.md`/`handoff.md` are compaction summaries carrying state across fresh windows. |
| No CoT scaffolding; reasoning via effort knobs | Reasoning-model prompting guidance (OpenAI / Willison, 2025-02-02): "think step by step" hurts reasoning models. Canon controls reasoning via `effort` / `model_reasoning_effort`; no "think step by step" string exists in any prompt. |
| "Spec states contracts, not mechanics" (CLAUDE.md rule of thumb) | OpenAI GPT-5 prompting guide (2025-08-07): over-specified / contradictory prompts damage the implementer with "surgical precision." Canon's anti-over-specification rule is now *higher*-stakes. |
| "Smaller models + scaffolding win" thesis | NVIDIA, *Small Language Models are the Future of Agentic AI* (arXiv 2506.02153, 2025-06) — holds specifically for schema/spec-constrained work, with selective escalation for hard tasks. Exactly canon's delicate-flag + matrix design. |

## Findings & recommendations

> **Outcome (1.11.0, decided 2026-06):** P0 fix shipped (find/filter split + round-3 tightening reworked to a synthesis-stage filter). On closer reading of `pipeline-policy.ts`, the **P1 "raise effort floors" item was found already satisfied** — the matrix's `medium` entries are all on Sonnet/tiny-diff or on phase/size combos that don't run (fast-tier spec is conversational); every Opus exploration tier is already `high`/`xhigh`. The P1 **model re-baseline shipped as: `code_review` L → Sonnet 4.6** (Opus kept for XL/delicate) **and `implement` XL/delicate effort eased `xhigh` → `high`** (GPT-5.5 overthinks at `xhigh` with open-ended tools — token discipline over reflexive max-effort; the original blast-radius argument for keeping `xhigh` didn't hold, since `high` isn't "less careful" and `xhigh` can reduce quality on open-ended work). The Perplexity report (`canon-opus48-gpt55-report.md`, CodeRabbit 100-PR study) corroborated all of this; new larger items it surfaced (test-gen phase, cascaded escalation, micro-specs, spec-lint) are backlogged as separate minors. See `docs/decisions.md` §"Model-generation re-baseline (2026-06)". The sections below are the original analysis; read them with this outcome in mind.

### P0 — Two-lens review prompts likely under-report on Opus 4.8 / Sonnet 4.6

**Evidence.** Anthropic's current best-practices doc has a dedicated *"Code
review harnesses"* section warning that a harness tuned for an older model shows
**lower recall on Opus 4.8** — not because it investigates less, but because it
now *faithfully obeys* conservative instructions ("only report high-severity,"
"don't nitpick") and reports fewer below-bar findings. Prescribed fix: **separate
finding from filtering** — instruct the reviewer to report every issue including
low-confidence ones, tagged with confidence + severity, and filter downstream.

**Canon state (pre-fix).** Partially protected, with a real gap:
- `.claude/agents/code-review-cold.md` says "treat suspicious behavior as
  potentially wrong" and emits `Severity` — good instinct, but no explicit
  report-low-confidence instruction and no confidence field.
- `.claude/agents/code-review-anchored.md` emits findings by category with no
  severity and no confidence.
- The foreman (`src/orchestrator/prompts/templates/code-review-foreman.md`) is
  the right place to filter, but cannot rank by confidence because the lenses
  don't pass it.

**Recommendation (prompt-only; applied 2026-06 — see CHANGELOG / git history):**
1. Add an explicit find-don't-filter instruction to **both** lenses.
2. Add uniform `Severity` + `Confidence` tags to both lenses' return schemas.
3. Have the foreman filter/rank by confidence×severity (below-bar low-confidence
   items become nits or dismissed, not `changes_requested` drivers).

**Watch item.** The round-3+ tightening rule (orchestrator) is itself a
find-stage filter ("findings must be `correctness bug` or `spec gap` only"). On
Opus 4.8 it is obeyed *harder* than on 4.5 — that is the intent (kill nit-creep),
so keep it, but do not extend that conservative style to rounds 1–2.

### P1 — Effort calibration is now provider-asymmetric; the matrix treats it uniformly

**Evidence.** The providers give *opposite* effort advice:
- **Opus 4.8:** start at **xhigh** for coding/agentic; **effort gates tool-call
  frequency** (low effort → fewer tool calls → less codebase grounding). Anthropic:
  effort "is likely more important for this model than any prior Opus."
- **GPT-5.5:** default **medium**; explicit warning that high/xhigh + open-ended
  tools + any instruction conflict → **overthinking**.

**Canon state.** Claude spec at S = `medium`, code_review S/M = `medium`. These
are exploration-heavy phases (they read the codebase); on Opus 4.8, `medium` may
suppress the grounding tool calls. Codex delicate implement = `gpt-5.5 / xhigh` is
exactly OpenAI's documented overthinking combination — though for a delicate task
thoroughness is wanted, so this is a genuine tension, not a clear bug.

**Recommendation.**
- Raise the **effort floor on Opus exploration phases** (spec, code_review) —
  ≥`high`, lean `xhigh` for L/XL. Higher leverage than bumping model size.
- Eval **GPT-5.5 delicate implement `high` vs `xhigh`** by reroute rate.
- Encode the asymmetry in matrix comments; do not assume "higher effort = better"
  uniformly (false for GPT-5.5).

### P1 — Re-baseline opportunity: the cheap tier moved up (advances the thesis)

**Evidence.** Sonnet 4.6 **matches Opus 4.5** (prior flagship) on long-horizon
coding and beat it in 59% of Claude Code head-to-heads at ~1/5 cost. GPT-5.4-mini
approaches GPT-5.4 pass rates at ~30% quota.

**Canon state.** `CLAUDE_MODEL_REVIEW_LARGE = opus` for L tasks, justified by a
comment that *Sonnet was missing lifecycle/state-machine bugs* — a **Sonnet-4.5-era**
finding. Sonnet 4.6 specifically improved on the long-horizon/state-machine
reasoning that forced the Opus bump.

**Recommendation (eval-gated).**
- Eval **L code_review Opus → Sonnet 4.6**, keeping Opus for XL/delicate. Track
  post-PR escapes across ~10 L tasks before/after. On-thesis cost cut.
- Honest counter-direction: GPT-5.5's gains concentrate in **long-horizon /
  multi-file** work (Terminal-Bench +7.6) while single-issue resolution is flat
  (SWE-Bench-Pro +0.9). Canon's **L implement runs on gpt-5.4-mini**. Eval
  **L implement mini vs gpt-5.5** by reroute rate — gpt-5.5's ~40% output-token
  reduction narrows the cost gap. Do not over-rotate for short M tasks.

### P2 — Stale rationale in matrix comments / decisions

`src/lib/pipeline-policy.ts` / `src/orchestrator/env.ts` carry 4.5-era comments
("sonnet doesn't support xhigh" — false for 4.6, which added the effort param; the
REVIEW_LARGE justification above). No behavior impact, but misleads the next
tuner. Refresh comments; add a `docs/decisions.md` entry noting the matrix was
re-baselined for the 4.6/4.8/5.5 generation.

### P2 — Positive-framing is mostly good; high-stakes negations carry rationale

CLAUDE.md already preaches positive/structural framing over prose negation (and
cites the negation-neglect paper) — ahead of the curve. Model literalism raises
the stakes. The Codex git-ownership negation (`helpers.ts`) is fine because it
gives the *why* (which Anthropic now explicitly recommends). Canon does **not**
use the ALL-CAPS "CRITICAL: you MUST use this tool" pattern that over-triggers on
4.8 — no action.

## Proposed model/effort matrix (concrete; EVAL = eval-gated)

```
                 S               M              L                      XL/delicate
Codex spec_rev   —               mini/med       mini/high              gpt-5.5/high
Codex implement  mini/med        mini/high      mini/high →EVAL gpt-5.5 gpt-5.5/xhigh →EVAL /high
Claude spec      opus/med→high   opus/high      opus/high→xhigh        opus/xhigh
Claude plan      sonnet/med      sonnet/high    sonnet/high            sonnet/high
Claude review    sonnet/med→high sonnet/high    opus →EVAL sonnet4.6   opus/xhigh
Claude qa        sonnet/med      sonnet/med     sonnet/high            sonnet/high
```

Direction: cheaper where the cheap tier caught up; more *effort* (not bigger
model) where grounding needs tool calls on Opus 4.8.

## Open questions deferred to external deep research

Handed to an external research brief (not in the repo). The empirical/eval-gated ones my
training knowledge can't settle: recall-mitigation prompt structure with evidence;
whether the spec-blind cold lens still earns its cost given an anchored lens;
effort-saturation points; whether Sonnet 4.6 / GPT-5.5 moved enough to re-baseline
the L tier; spec-weight evidence; diminishing returns on added reviewers.

## Sources (with dates)

Model behavior:
- Anthropic, *Claude Opus 4.8* news + *What's new* + *Effort* + *Prompting best
  practices (Code review harnesses)* docs — May 2026, accessed Jun 2026
- Anthropic, *Claude Sonnet 4.6* — 2026-02-17
- OpenAI, *GPT-5.5* intro + API/Codex model docs + *Using GPT-5.5* guide — Apr 2026
- OpenAI, *GPT-5.4-mini/nano* — 2026; Codex model lineup docs
- Zvi, *Claude Opus 4.8 system card analysis* — 2026-05-29 (honesty/equivocation)

Agentic-coding practice:
- Anthropic, *Building Effective AI Agents* — 2024-12-19
- Anthropic, *Multi-agent research system* — 2025-06-13
- Anthropic, *Effective context engineering* — 2025-09-29
- Anthropic, *Effective harnesses for long-running agents* — 2025-11-26
- GitHub, *Spec Kit / Spec-Driven Development* — 2025-09-02
- OpenAI / Willison, *Reasoning models: advice on prompting* — 2025-02-02
- OpenAI, *GPT-5 Prompting Guide* (Cookbook) — 2025-08-07
- Vallecillos-Ruiz et al., *Wisdom and Delusion of LLM Ensembles* (arXiv 2510.21513) — 2025-10
- Yu, *When AIs Judge AIs* (arXiv 2508.02994) — 2025-08
- *Trust but Verify: Verification Design for Test-time Scaling* (arXiv 2508.16665) — 2025-08
- Zietsman, *The Specification as Quality Gate* (arXiv 2603.25773) — 2026-03-26
- NVIDIA, *Small Language Models are the Future of Agentic AI* (arXiv 2506.02153) — 2025-06
```
