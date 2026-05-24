# Code Review: reroute-preflight-spec-amendment-check

> Reviewer: Claude | Spec: `tasks/reroute-preflight-spec-amendment-check/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

## Round 1

### Stage 1 — Spec Compliance

#### Validation Gate

Handoff reports all required checks passing: lint ✓, type-check ✓, unit tests ✓, docs-refs-check ✓, build ✓. `E2E` is `deferred_by_spec` with valid spec citation. No unexplained failures.

One required build artifact (`dist/cli/index.js`) is stale — see AC-6 finding below.

#### AC Cross-Reference

| AC | Status | Notes |
|---|---|---|
| AC-1: `verifyRerouteAmendment` in `validation.ts` with round-aware logic, missing-file fallback, reason strings | Met | Source matches spec. All regex branches and reason messages present. |
| AC-2: `rerouteFromHumanReview` preflights before mutation, aborts with required message | Met | Loop runs after phase check, before any `writeStatus`. Abort message format matches spec. |
| AC-3: `--force` bypass emits one warning per failing task, proceeds | Met | Warning format matches spec. |
| AC-4: helper reads from `cwd`, returns missing-file reason (no throw) | Met | `path.join(cwd, 'tasks', taskId, 'spec.md')` used; `catch` returns `{ amended: false, reason: ... }`. |
| AC-5: nine unit tests covering round-1 cases A–E, round-2+ cases F–H, edge case I | Met | Test names and coverage match the spec matrix. |
| AC-6: `--reroute` help text updated in `cli.ts` | **Partial** | `scripts/run-task/cli.ts` updated. `dist/cli/index.js` **not** rebuilt — stale output still shows old text. See finding F3. |
| AC-7: no-force abort integration test, status.json untouched | Met | Worktree-backed subprocess test asserts non-zero exit and unchanged status. |
| AC-8: `--force` bypass integration test, reroute metadata in status.json, warning in stderr | Met | Test asserts status fields and warning text. |
| AC-9: bundle multi-failure names all tasks, no status mutation | Met | Three-task fixture, all three task names checked. |
| AC-10: round-2 boundary test — bare `## Amendment` rejected at round 2, strict form accepted | **Partial** | Test logic is structurally correct but assertion at line 216 checks for the wrong string. See finding F2. |
| AC-11: reroute prompt template updated, round number injected, legacy variants dropped | **Partial** | Template file updated, `roundNum` threaded. Two issues: (1) `roundNum` is off by 1 — see finding F1; (2) legacy variants remain in `taskLines` in `prompts/index.ts`. See F4. |
| AC-12: `docs/pipeline-orchestrator.md` documents pre-flight contract | Met | Paragraph added with all four required elements (asymmetric requirement, pre-flight behavior, `--force` bypass, rationale + legacy-variant rejection). |

#### Dropped Sections Check

Non-goals respected. Known Risks addressed. Human Test Plan satisfiable.

**Stage 1 verdict: FAIL** — three correctness findings below block approval. Stage 2 not run.

---

### Stage 2

Not run — Stage 1 failed.

---

### Findings

#### F1 — `correctness bug`: `roundNum` off by 1 → Codex misdirected on every first reroute (AC-11)

`scripts/run-task/prompts/index.ts:238`:
```ts
const maxReroute = tasks.reduce((m, t) => Math.max(m, t.rerouteCount), 0);
const roundNum = maxReroute + 1;
```

`t.rerouteCount` is the **post-increment** `reroute_count` (already written by the reroute operation before the implement prompt is generated). For the first reroute this is `1`, so `maxReroute = 1` and `roundNum = 2`.

The template (`implement-reroute.md`) uses `roundNum` to direct Codex:
> "The current reroute round is {{roundNum}}. For round 1, find `## Amendment`; for round 2+, find `## Amendment Round {{roundNum}}`."

With `roundNum = 2`, the "for round 2+" branch fires: Codex is told to find `## Amendment Round 2`. But the pre-flight (AC-2) ran with `requiredRound = 1` and only required the bare `## Amendment` heading. The operator added `## Amendment`; Codex now looks for `## Amendment Round 2` and finds nothing.

AC-11 specifies the injected value should be "the post-increment `reroute_count`, i.e., the round Codex is being asked to implement." Post-increment `reroute_count = 1` for the first reroute — the spec's intended value is `1`, not `2`.

The `+1` is correct for the **banner** (`roundNum` = human-review-round = 2 for first reroute), but wrong for the **template heading lookup**, which needs the reroute round number (`maxReroute`).

Fix: pass a separate `rerouteRound = maxReroute` to the template for the heading lookup, or change the template to use `maxReroute` directly and rename the variable/wording so the "round 1" / "round 2+" branches align with the reroute count (1 for first reroute, 2 for second).

#### F2 — `correctness bug`: integration test AC-10 asserts wrong reason string (AC-10)

`tests/run-task-reroute-preflight.test.ts:216`:
```ts
assert.match(first.stderr, /found `## Amendment Round 1`/);
```

The fixture spec contains `## Amendment` (bare form). For `requiredRound = 2`, `verifyRerouteAmendment` traces:
1. `matchAll` for `Amendment\s+Round\s+(\d+)` on `## Amendment` — no matches, `seenRound = null`
2. Bare-`## Amendment` fallback fires — returns `reason: "found \`## Amendment\` in ..., expected \`## Amendment Round 2\`"`

The reason says `found \`## Amendment\`` — not `found \`## Amendment Round 1\``. The assertion matches a string that does not appear; the test fails.

Fix at `tests/run-task-reroute-preflight.test.ts:216`:
```ts
assert.match(first.stderr, /found `## Amendment`/);
```

#### F3 — `correctness bug`: `dist/cli/index.js` not rebuilt (AC-6)

`dist/cli/index.js:2617-2620` still shows the pre-task help text — the amendment preflight note added to `scripts/run-task/cli.ts` is absent. The spec explicitly lists `dist/cli/index.js` as a required rebuild, and AC-6's verification step is `canon run --help`, which reads the `dist/` output.

Fix: `npm run build` and commit the resulting `dist/cli/index.js` delta alongside the already-committed `dist/scripts/run-task.js`.

#### F4 — `spec gap`: legacy variants still in `taskLines` in `prompts/index.ts` (AC-11)

`scripts/run-task/prompts/index.ts:244` still says:
```
...look for "Amendment", "Round N", "Follow-up", "Revision Notes", or similar sections...
```

AC-11 requires: "Legacy variants ('Follow-up', 'Post-review') are explicitly removed from the prompt." `"Follow-up"` is still present in the `taskLines` string that becomes part of the rendered reroute prompt. The `implement-reroute.md` template step-1 was correctly narrowed, but this per-task context line was not updated to match. Codex reading this line may still act on `## Follow-up` headings that the pre-flight gate now rejects.

Fix: update line 244 to drop the legacy variant list. Suggested replacement:
```
...look for `## Amendment` (round 1) or `## Amendment Round N` (round 2+) sections added since your last handoff...
```

---

**Verdict: `changes_requested`** — F1, F2, F3 are correctness bugs; F4 is a spec gap. Address all four before re-review.


- [x] **Changes requested** — F1, F2, F3 are correctness bugs; F4 is a spec gap. Address all four before re-review.
