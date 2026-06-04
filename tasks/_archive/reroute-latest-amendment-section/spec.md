# Spec: reroute-latest-amendment-section — Reroute verdict reads the latest same-round amendment section, not the first

> Written by: Claude | Review by: Codex (fast-tier: spec_review auto-approves; human approved spec conversationally)
> Status: draft

## Problem

`sliceRerouteRoundSection` in `scripts/run-task/validation.ts` selects the **first** heading matching the current reroute round and returns that slice (`if (start === -1) { if (headingRe.test(line)) start = i; }` — `start` is set once and never updated). `checkRerouteEvidence` extracts the round's verdict from that slice.

But `spec-review.md` (and `plan.md`) can legitimately contain **two or more sections under the same round heading** (`## Amendment Review Round N`). This happens on the documented rejected-amendment recovery path:

1. A full-tier reroute's amendment review returns `changes_requested` at round N → the orchestrator resets `spec_review` to pending and tells the operator to revise + re-run `canon run` (**not** `--reroute`).
2. That recovery path does **not** increment `reroute_count` — it stays N.
3. The re-run's `spec_review` pass appends a **second** `## Amendment Review Round N` section (the fresh, post-revision verdict).

Because `sliceRerouteRoundSection` takes the *first* match, it returns the **stale** round-N section — the original `changes_requested`. `checkRerouteEvidence` then reads the stale rejected verdict, which either fails with a verdict mismatch against the fresh `status.json` verdict or advances on the wrong (rejected) verdict. The reroute recovery flow breaks.

This is a confirmed true positive (Codex P1 on PR #132). Evidence the precondition occurs in practice: `tasks/_archive/release-agnostic-surface/spec-review.md` contains two `## Amendment Review Round 2` sections. That run was unharmed only because both happened to be `Approved with nits`; the harmful ordering (first = `changes_requested`, second = `approved`) is the *normal* shape of the rejected-amendment recovery path.

## Decision

`sliceRerouteRoundSection` must return the slice for the **last** (most recent) heading matching the current round, not the first. The most recently appended same-round section is the fresh one; earlier same-round sections are stale by construction (append-only artifacts). Everything else about the helper is unchanged:

- Round-number matching is unchanged (round 1 = bare `## <label>`; round N≥2 = `## <label> Round N`, anchored so `Round 2` cannot satisfy a round-1 check).
- Fence-aware and HTML-comment-aware heading detection is unchanged — heading-like lines inside ` ``` ` fences or `<!-- -->` comments must still be ignored, both when locating the selected heading and when finding the section's end boundary.
- The section still ends at the next real `#`/`##` heading after the selected heading, or EOF.
- Return `null` when no matching heading exists (unchanged contract).
- **Remove the first-match selection — replace it, don't supplement it.** The existing set-once logic (`if (start === -1) { start = i }`) must be gone; there must be no fallback path that still resolves to the first matching heading. (Name-effects-to-DELETE.)

Mechanics (single-pass last-match vs. collect-then-take-last) are deferred to implementation, with one hard constraint: **fence/comment state must be tracked continuously from the start of `content`** — a `lastIndexOf`-style regex match or any approach that restarts fence tracking at the chosen heading is wrong, because a ` ``` ` fence opened in an *earlier* same-round section would then mis-classify the real last heading or its end boundary. The fence/comment-awareness and end-boundary behavior must be preserved exactly.

## Non-Goals

- **Not** changing `reroute_count` semantics or making the recovery path increment it. Same-round duplicates are a legitimate, expected artifact shape; the fix is to read them correctly, not to prevent them.
- **Not** changing `checkRerouteEvidence`'s contract, `verifyRerouteAmendment`, the heading conventions, or the `## Reroute Plan` / `## Amendment Review` labels.
- **Not** touching the round-1-vs-round-N anchoring logic.
- **No** changes to reroute routing in `main.ts` / `checkAndRoute`.

## Acceptance Criteria

- [ ] **AC-1 — Last same-round section wins.** When `content` contains multiple headings matching the current round, `sliceRerouteRoundSection` returns the slice beginning at the **last** such heading (down to the next `#`/`##` heading or EOF). *Verify:* a unit test with two `## Amendment Review Round 2` sections — first `Changes requested`, second `Approved` — asserts the returned slice contains the second (`Approved`) verdict and not the first.
- [ ] **AC-2 — Single-section and absent cases covered.** With exactly one matching heading, the returned slice matches today's behavior; with no matching heading, the function returns `null`. There are currently **no** unit tests for `sliceRerouteRoundSection`, so the implementer **adds** single-section and null-case tests (this is new coverage, not "keep existing"). *Verify:* new tests assert the single-match slice and the `null` no-match case.
- [ ] **AC-3 — Fence/comment-awareness preserved, tracked continuously from file start.** A heading-like line inside a ` ``` ` fence or `<!-- -->` comment is not counted as a match (so it can neither be selected nor prematurely end the section). Fence/comment state must be carried continuously across **all** preceding lines, including earlier same-round sections. *Verify:* two tests — (a) a fenced fake `## Amendment Review Round 2` line is ignored and the real last heading is selected; (b) **a ` ``` ` fence opened inside an *earlier* same-round section (and closed before the last heading) does not corrupt selection of the last heading or its end boundary** (guards against a naive last-match that resets fence state at the chosen heading).
- [ ] **AC-4 — `checkRerouteEvidence` reads the fresh verdict end-to-end.** With a rerouted `status` at round N and a `spec-review.md` whose first round-N section is `Changes requested` and whose second is `Approved`, `checkRerouteEvidence` returns the fresh `approved` verdict (`{ reroute: true, ok: true, verdict: 'approved' }`), not the stale rejection. *Verify:* a `checkRerouteEvidence` test asserting the fresh verdict for the duplicate-same-round fixture.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | `sliceRerouteRoundSection`: **replace** the set-once first-match selection with last-match (no fallback to the first heading); keep fence/comment state tracked continuously from file start; preserve end-boundary logic (AC-1/2/3). Update the function's doc-comment to state "latest same-round section" and why (recovery-path duplicates). |
| `tests/run-task-validation.test.ts` | Add tests (none exist today for these functions): duplicate-same-round selection (AC-1), single-match + null cases (AC-2), fence-guarded last-heading **incl. earlier-section fence carry** (AC-3), and `checkRerouteEvidence` end-to-end fresh-verdict (AC-4). |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` — `validation.ts` bundles into it. Declared so the `--pr` base-drift gate accepts the committed rebuild. |
| `dist/cli/index.js` | Regenerated by `npm run build` — `validation.ts` is also bundled into the CLI entry point, so the same change appears here. Declared for the `--pr` base-drift gate. |

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm test` — the new regression tests + full suite
- [x] `npm run build` — `validation.ts` is bundled into `dist/scripts/run-task.js`; rebuild and commit `dist/` so CI's `git diff --exit-code -- dist/` stays clean
- [x] `npm run type-check` — backstop (no type changes expected)
- [ ] `npm run sync-templates:check` — N/A (no canon-owned doc/skill/template touched)
- [ ] E2E — N/A

## Known Risks

- **End-boundary regression**: switching to last-match must not change where the section ends. The end is still "next `#`/`##` after the selected heading." A naive collect-then-rescan that loses fence state for the end-scan could mis-bound; the implementer must keep fence/comment tracking correct from the selected heading onward. AC-3 guards this. (Note: a real `## Amendment Review Round 2` heading after the selected one cannot occur *for the same round* — duplicates of the selected round are exactly what we're selecting the last of — but a *different* `##` heading legitimately ends the section.)
- **Round-1 bare-label duplicates**: the same duplicate shape can occur at round 1 (`## Amendment Review` bare). Last-match must apply uniformly to round 1 and round N≥2 (the round-1 anchoring that excludes `Round 2` headings is unchanged). Add a round-1 duplicate assertion if cheap.
- **Low blast radius**: one pure function + tests, no `main.ts`/routing change. Read-correctness only — it cannot make a genuinely-rejected amendment advance, since the fresh section's verdict is authoritative and the `status.json` cross-check still applies.

## Human Test Plan

1. Picture a full-tier task whose reroute amendment is first rejected (`changes_requested`), then revised and re-run. Before this fix, the pipeline would re-read the *old rejection* and stall or mis-advance. After: it reads the *new* (revised) verdict and proceeds correctly — the same recovery flow we used while shipping the release now works without the stale-verdict hazard.
2. Confirm a normal single-round reroute (amendment approved on the first pass) behaves exactly as before — no change to the common path.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names — `sliceRerouteRoundSection` / `checkRerouteEvidence` / `validation.ts` / `run-task-validation.test.ts`
- [x] Known Risks covers the trickiest parts (end-boundary, round-1 duplicates)
- [x] Human Test Plan uses product/behavior language
- [x] Validation Required entries marked `- [x]` (incl. the `dist/` rebuild)
