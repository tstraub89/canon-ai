# Code Review: scope-review-diff

> Reviewer: Claude | Spec: `tasks/scope-review-diff/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

| Check | Handoff Result | Assessment |
|---|---|---|
| `npm run lint` | Pass | Accepted |
| `npm run type-check` | Pass | Accepted |
| Unit tests | deferred_by_spec | Spec §Validation Required explicitly defers: "no new unit tests are required." Valid. |
| Build | deferred_by_spec | Spec §Validation Required explicitly defers: "NoEmit TypeScript project; type-check covers build correctness." Valid. |
| E2E | not_configured | Spec marks E2E not applicable. Valid. |
| Runtime validation | Pass (orchestrator-authored) | `orchestrator-phase-smoke` exit 0. |

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: round-1 prompt contains full diff inline (≤ 50 000 bytes), preceded by "Task diff against {baseBranch}" header; `git diff` instruction removed from the primary path | Pass | `code-review-round-1.md` `{{#hasDiff}}` block renders `**Task diff against {{{baseBranch}}}**` followed by a fenced diff. `{{^hasDiff}}` retains the command only as a fallback (AC-3). |
| AC-2: diff > 50 000 bytes → truncated at byte limit + exact note | Pass | `git.ts:truncateUtf8()` is UTF-8-safe. `getScopedDiff()` returns `{ truncated: true }`. Both templates render the exact note inside `{{#diffTruncated}}`. |
| AC-3: git failure → fallback to original `git diff` instruction, no pipeline error | Pass | `getScopedDiff()` returns `null` on non-zero exit or `spawnSync` error. `{{^hasDiff}}` renders the original instruction. No throw. |
| AC-4: round-N prompt includes pre-computed diff; "or read the changed files directly" removed | Pass | `code-review-round-n.md` has the same conditional diff block. Original "(or read the changed files directly)" text is absent from all paths. |
| AC-5: diff computed using `getActiveCwd(taskIds)` | Pass | `phases/code-review.ts` resolves `activeCwd = getActiveCwd(taskIds)` once and passes it to `getScopedDiff(baseBranch, activeCwd)`. |
| AC-6: `npm run type-check` passes | Pass | Handoff: Pass. Backward-compatible `baseBranch?` param preserves old call sites. |
| AC-7: `npm run lint` passes | Pass | Handoff: Pass. |

### Dropped Sections Check

- [x] Non-goals respected — no `--diff-base` flag, no pipeline error on dirty worktree, three-dot syntax unchanged
- [x] Known Risks addressed — large-diff truncation implemented; Mustache conditionals confirmed via existing usage before coding
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, focused implementation. `getScopedDiff()` is a thin, correct wrapper — UTF-8-safe truncation, null on failure. The phase wiring resolves `baseBranch` and `activeCwd` once at the top and threads them through consistently. Templates use Mustache conditionals correctly. One minor inconsistency in `prompts/index.ts` noted below.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

**optional cleanup/nit** — `prompts/index.ts`, round-1 `hasDiff = true` branch uses raw `baseBranch` parameter instead of `resolvedBaseBranch`

The round-1 `diffView` object (`prompts/index.ts` around line 330):
```typescript
const diffView = hasDiff
    ? { hasDiff, baseBranch, ... }            // raw optional param
    : { hasDiff, baseBranch: resolvedBaseBranch, ... };
```

The round-N path (earlier in the same function) correctly uses `resolvedBaseBranch` in both branches. The `hasDiff = true` branch here should also use `resolvedBaseBranch`. Not a runtime bug — the only caller that sets `scopedDiff != null` always supplies `baseBranch` explicitly — but the type allows `promptCodeReview(state, undefined, someDiff)`, which would silently render an empty `**Task diff against **` header. Fix: replace `baseBranch` with `resolvedBaseBranch` in that branch.

#### Spec Gaps

(none)

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
