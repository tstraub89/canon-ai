# Implementation Plan: reroute-latest-amendment-section

> Written by: Claude | Implements: `tasks/reroute-latest-amendment-section/spec.md`

## Step 1 — Rewrite `sliceRerouteRoundSection` to select the LAST matching heading

File: `scripts/run-task/validation.ts` (function currently at ~line 173).

Replace the set-once first-match selection. The existing loop sets `start` on the first `headingRe.test(line)` match and returns at the next `#`/`##`. Change it so:

- Keep the **continuous** fence/comment-aware line scan exactly as-is (the `inFence` / `inComment` tracking from the top of `content` — do **not** restart it partway). This is the hard constraint from AC-3: a ` ``` ` fence opened in an earlier same-round section must still be tracked when we reach the last heading.
- Suggested mechanics (single pass): track `lastHeadingIdx = -1`. On each line that is outside fence/comment and matches `headingRe`, set `lastHeadingIdx = i` (always overwrite — do **not** `break`/early-return). Also need the section end. Two clean options, implementer's choice:
  - **(a) one pass + bounded end-scan:** record `lastHeadingIdx` during the main fence-aware pass; after the loop, if `lastHeadingIdx === -1` return `null`; else re-scan from `lastHeadingIdx + 1` (fence/comment state re-initialized to `false`/`false`, which is correct because a matched heading is by definition outside a fence) for the first `^#{1,2}[ \t]+\S` → that index is the end; slice `[lastHeadingIdx, end)`, else `slice(lastHeadingIdx)` to EOF.
  - **(b) single pass with deferred emit:** when a new heading matches, set `start = i` and clear any pending end; when a `^#{1,2}` line is seen *after* a `start`, remember it as a candidate end but keep scanning (a later same-round heading resets `start` and discards the candidate). Emit at EOF.
- Remove the `if (start === -1)` guard entirely — there must be no path that resolves to the first heading.
- Preserve: round-1 vs round-N regex (`headingRe`), the `^#{1,2}[ \t]+\S` end-boundary test, and the `null`-on-no-match contract.

## Step 2 — Update the doc-comment

Above the function, revise the comment (currently lines ~167-172) to state it returns the **latest** same-round section and why: the `changes_requested → revise → plain canon run` recovery path appends a second `## <label> Round N` at the same `reroute_count`, and the freshest section is authoritative. Note the continuous-fence-tracking requirement so a future refactor doesn't reintroduce the reset-at-heading bug.

## Step 3 — Add tests

File: `tests/run-task-validation.test.ts` (no tests exist for these functions today — this is all new coverage).

Mirror the existing describe-block style in that file. Add:

- **AC-1** — `sliceRerouteRoundSection(content, 'Amendment Review', 2)` where `content` has two `## Amendment Review Round 2` sections (first body `- [x] **Changes requested**`, second `- [x] **Approved**`) → returned slice contains `Approved`, not `Changes requested`.
- **AC-2** — single `## Amendment Review Round 2` → slice is that section; content with no matching heading → `null`. Also a round-1 bare-label duplicate (`## Amendment Review` ×2) → returns the last (cheap, covers the Known-Risk).
- **AC-3a** — a ` ``` `-fenced line that looks like `## Amendment Review Round 2` is ignored; the real (unfenced) last heading is selected.
- **AC-3b** — a ` ``` ` fence opened **inside an earlier** `## Amendment Review Round 2` section and closed before the real last heading → selection of the last heading and its end boundary is uncorrupted (this fails a reset-fence-at-heading impl).
- **AC-4** — `checkRerouteEvidence('spec_review', content, status)` with `status.phases.implement = { rerouted: true, reroute_count: 2 }` and `content` whose first Round-2 section is `Changes requested` and second is `Approved` → returns `{ reroute: true, ok: true, verdict: 'approved' }`.

Use the `Verdict` / verdict-checkbox conventions already in `validation.ts` (`extractCheckedVerdict` is what `checkRerouteEvidence` runs on the slice — match its expected checkbox text).

## Step 4 — Validate + rebuild dist

- `npm run lint`
- `npm run type-check`
- `npm test` (new tests + full suite green)
- `npm run build` — `validation.ts` bundles into `dist/scripts/run-task.js` (per `tsup.config.ts`); commit the rebuilt `dist/` so CI's `git diff --exit-code -- dist/` stays clean. Confirm `git diff --stat -- dist/` shows only the expected bundle change.

## Notes

- Pure-function change; no `main.ts` / routing edits (Non-Goal).
- `dist/` is in Affected Files so the `--pr` base-drift gate accepts the rebuild.
