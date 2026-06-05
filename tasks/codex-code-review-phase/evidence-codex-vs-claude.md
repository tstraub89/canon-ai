# Evidence: Codex PR-review value + cold-Claude vs cold-Codex head-to-head

> Gathered 2026-06 to inform the codex-code-review-phase revival (the parked-task
> "observe first" gate). Read-only analysis of merged PRs on tstraub89/canon-ai
> and tstraub89/gallery_wall. Codex posts as `chatgpt-codex-connector[bot]`.

## Part 1 — What Codex catches across all PRs (aggregate)

| | canon-ai | gallery_wall | Combined |
|---|---|---|---|
| Distinct findings | 69 | 104 | **173** |
| Clean passes | 15 | 3 | 18 |
| P0 / P1 / P2 / P3 | 0/15/54/0 | 0/30/74/0 | **0 / 45 / 128 / 0** |
| **False positives** | 0 | 0 | **0** |
| cold-read-advantage | 59% | 63% | **62%** |
| claude-likely-catches | 22% | 26% | **24%** |
| spec-level | 19% | 11% | **14%** |

Headline: **~76% of Codex's findings sit at an altitude a spec-anchored AC-checklist
review (= Claude `code_review`) structurally misses** (cold-read lifecycle/race/
consistency 62% + spec-level 14%). Zero false positives, zero pure nits, no P0
(earlier gates catch catastrophic) and no P3 (Codex skips trivia). The recurring
texture is identical across a CLI orchestrator and a React PWA: stale-snapshot-
after-await, single-active-transaction races, parsers stopping at the first of N
sections, worktree/counter state divergence, event-driven gate bypasses.

## Part 2 — Head-to-head: blind cold-Claude vs Codex on 5 PRs

Method: 5 PRs chosen for focused diffs + gradeable Codex P1/P2 findings. For each,
a fresh Claude agent reviewed ONLY the diff (no spec injected, no sight of Codex's
comments) with an adversarial cold-review prompt, then scored against Codex's
actual findings. Caveat: "cold" is equally imperfect for both reviewers — canon
PRs carry task artifacts in the diff, visible to Codex too, so it's fair for the
Claude-vs-Codex comparison but not a pure zero-context test. Small sample; hit/
partial/miss is author judgment.

| PR | Codex finding | cold-Claude |
|---|---|---|
| canon #77 | P1 exact-head prefix match (#10816) | HIT (+ found `--limit 20` truncation + test-stub blindness) |
| canon #77 | P1 constrain merged-PR lookup to base branch | partial |
| canon #77 | P2 human_review gate uses wrong cwd | MISS |
| canon #4 | P2 worktree QA doc edits clobbered pre-staging | HIT |
| canon #4 | P2 require real AC rows in coverage table | MISS (found a different validation.ts bug) |
| canon #95 | P1 `some()`→`every()` gate bypass (main) | partial (found `enableFullSend` writes-all + sticky auto-PR) |
| canon #95 | P1 same bypass (spec-review) | partial |
| GW #108 | P1 GDPR reentrancy loses erasure inputs | MISS (analyzed it, concluded "self-correcting" — wrong) |
| GW #58 | P1 `setTimeout(0)` transaction → undo loss | HIT |

**Aggregate: clean hits 3/9, partial 3/9, miss 3/9. Top-bug-per-PR matched 3/5.**

### Conclusions
1. **Complementary, not substitutes.** They overlap on the most-material bug ~60%
   of PRs — so much of Codex's value is reproducible by a cold-Claude pass (the
   lever is cold framing, not the model alone). But each has real blind spots the
   other covers: Codex caught 2 sharp bugs Claude missed (and Claude *declared one
   safe*); Claude surfaced several real net-new bugs Codex didn't.
2. **Precision vs recall.** Codex = high precision (0 FP across 173). cold-Claude =
   higher recall (5–8 findings/PR) but noisier (more hedged/latent findings).
3. **Framing splits the same bug** (#95: each found a different half of one
   vulnerability). Running both catches strictly more than either alone.

### Design implications for codex-code-review-phase
- Strongest evidence yet that a **cold review phase** earns its keep — every one of
  these P1/P2s shipped to PR *after* Claude `code_review` approved.
- Codex is **already free on every PR** and high-precision → the highest-value
  *marginal* add is a **cold-Claude pass in-pipeline** (complementary ~33%, more
  recall, model already in the loop, no new dependency).
- BUT cold-Claude shares `code_review`'s model blind spots and is noisier → the
  **adjudication/precision layer matters MORE with a Claude reviewer than a Codex
  one** (Codex's 0-FP rate had nearly made adjudication's false-positive branch
  look redundant; with Claude it isn't).
- Open option: support cold review by **either or both** agents (config), rather
  than hard-coding Codex. Revisit before unparking.
