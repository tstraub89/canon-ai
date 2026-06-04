# Completion Summary: reroute-latest-amendment-section — Reroute verdict reads the latest same-round amendment section, not the first

> For the human. This is what you need to know.

## What Changed

The reroute evidence validator was reading the wrong amendment verdict when a full-tier task's amendment review was rejected and then re-run. On the rejected-amendment recovery path, the operator revises the spec and re-runs without incrementing the round counter, so the spec_review pass appends a *second* `## Amendment Review Round N` section to the same file. The validator was taking the *first* match — the old stale rejection — instead of the fresh approval. The fix makes it take the *last* matching section. Fence and HTML-comment awareness is preserved end-to-end, including across earlier same-round sections, so fenced examples can't masquerade as real headings.

## Files Changed

- `scripts/run-task/validation.ts` — reworked `sliceRerouteRoundSection` to select the last same-round heading; updated doc-comment
- `tests/run-task-validation.test.ts` — added tests: duplicate round-2 selection, round-1 bare-label duplicates, single-match + null cases, fenced fake heading, earlier-section fence carry, `checkRerouteEvidence` end-to-end fresh-verdict path
- `dist/scripts/run-task.js` — rebuilt via `npm run build`
- `dist/cli/index.js` — rebuilt via `npm run build` (`validation.ts` bundles into both entrypoints)

## How to Test

1. Run a full-tier reroute where the amendment is initially rejected at round N. Revise the spec section and re-run `canon run <id>` (not `--reroute`). The pipeline should read the fresh revised verdict and advance past `spec_review` — before this fix it would re-read the stale `changes_requested` and stall or misfire.
2. Run a normal single-round reroute (amendment approved on first pass) and confirm behavior is unchanged.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — all new regression tests pass |
| `npm run build` | Pass — both dist bundles rebuilt |
| `npm run sync-templates:check` | N/A — no canon-owned template touched |
| E2E | N/A |

## Human Verification Required

None.

## Decisions Made

- **Last-match via single-pass overwrite**: The function overwrites the candidate heading on every same-round heading match in a single pass, then slices from the final winner. This keeps fence/comment state continuous without a two-pass approach (first locate last, then rescan).
- **Both dist artifacts required**: `npm run build` regenerates both `dist/scripts/run-task.js` and `dist/cli/index.js`; both are declared in Affected Files and committed.

## Open Questions

None.

## Proposed Changelog

**Proposed entry** (under `[1.9.0] Fixed`):

> **Reroute verdict now reads the latest same-round amendment section, not the first.** When a full-tier amendment is rejected at round N, revised, and re-run without incrementing the round counter, the spec_review pass appends a second `## Amendment Review Round N` section. The validator previously read the stale first section (the rejected verdict), causing the recovery flow to stall or mis-advance. `sliceRerouteRoundSection` now takes the last matching section, with fence/comment awareness carried continuously across all preceding sections.

**Proposed version bump**: No additional bump — this fix is part of the v1.9.0 release being assembled on `release/v1.9`. The human finalizes entry placement.
