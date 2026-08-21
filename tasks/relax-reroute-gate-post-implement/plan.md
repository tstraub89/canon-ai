# Plan: relax-reroute-gate-post-implement

> Spec verdict: **Approved** (no nits). Implement exactly as specified; this plan sequences the work and pins the concrete edits per file.

## Sequencing rationale

Land the admission-gate + banner change first (it's the mechanism everything else is documentation/wording around), then the agent-facing prompt wording (context.ts → prompts/index.ts → templates, in that dependency order since prompts/index.ts renders the templates), then the five AC-9 doc/help surfaces, then the AC-9(b) sweep, then tests, then golden regen, then generated bundles. Run `npm run lint && npm run type-check` after Steps 1–3 (the TS surfaces) before touching docs, and run the full suite only after tests are rewritten (Step 6) — don't chase a red suite through doc edits that can't cause it.

This is `delicate: true` orchestrator hot-path work — bias every ambiguous call toward the gate *rejecting* rather than admitting (per `docs/patterns.md` §"Treat the `delicate` flag as load-bearing").

---

## Step 1 — Widen the admission gate in `src/orchestrator/main.ts`

Current code (`rerouteFromHumanReview`, lines 2450–2472):

```ts
export function rerouteFromHumanReview(taskIds: string[]): void {
    const entryStatuses = taskIds.map(taskId => ({ taskId, status: splitState.readStatus(taskId) }));
    const allAtHumanReview = entryStatuses.every(({ status }) => getCurrentPhase(status) === 'human_review');
    const allCodeReviewBlocked = entryStatuses.every(({ status }) => {
        const codeReview = status.phases.code_review;
        return getCurrentPhase(status) === 'code_review' && codeReview?.status === 'blocked';
    });
    const someSpecGap = entryStatuses.some(({ status }) => getVerdict(status, 'code_review') === 'spec_gap');
    const isSpecGapReroute = allCodeReviewBlocked && someSpecGap;
    if (!allAtHumanReview && !isSpecGapReroute) {
        const summary = entryStatuses
            .map(({ taskId, status }) => {
                const currentPhase = getCurrentPhase(status);
                const verdict = getVerdict(status, 'code_review') || 'none';
                const codeReviewStatus = status.phases.code_review?.status ?? 'missing';
                return `'${taskId}': ${currentPhase} (code_review ${codeReviewStatus}, verdict ${verdict})`;
            })
            .join(', ');
        splitCli.die(
            `--reroute requires either all tasks at human_review, or all tasks at code_review blocked with at least one spec_gap verdict. ` +
            `Current state: ${summary}`
        );
    }
```

Replace the admission predicate. Delete `allAtHumanReview` entirely (AC-8 greps for it). Keep `allCodeReviewBlocked` / `someSpecGap` / `isSpecGapReroute` exactly as-is — they still drive the exemption decision (AC-4) and the banner (AC-7), just not admission. Add a module-level membership set near the other reroute constants (or inline in the function — either is fine, but a named set makes the AC-8 grep intent self-documenting):

```ts
const REROUTE_ADMITTED_PHASES: ReadonlySet<CurrentPhase> = new Set(['code_review', 'qa', 'human_review']);
```

New admission block:

```ts
export function rerouteFromHumanReview(taskIds: string[]): void {
    const entryStatuses = taskIds.map(taskId => ({ taskId, status: splitState.readStatus(taskId) }));
    const allCodeReviewBlocked = entryStatuses.every(({ status }) => {
        const codeReview = status.phases.code_review;
        return getCurrentPhase(status) === 'code_review' && codeReview?.status === 'blocked';
    });
    const someSpecGap = entryStatuses.some(({ status }) => getVerdict(status, 'code_review') === 'spec_gap');
    const isSpecGapReroute = allCodeReviewBlocked && someSpecGap;
    const allAdmitted = entryStatuses.every(({ status }) => REROUTE_ADMITTED_PHASES.has(getCurrentPhase(status)));
    if (!allAdmitted) {
        const summary = entryStatuses
            .map(({ taskId, status }) => {
                const currentPhase = getCurrentPhase(status);
                const verdict = getVerdict(status, 'code_review') || 'none';
                const codeReviewStatus = status.phases.code_review?.status ?? 'missing';
                return `'${taskId}': ${currentPhase} (code_review ${codeReviewStatus}, verdict ${verdict})`;
            })
            .join(', ');
        splitCli.die(
            `--reroute requires every named task's current phase to be code_review, qa, or human_review — ` +
            `a phase reached only after a completed implement round. ` +
            `Current state: ${summary}`
        );
    }
```

Everything below this block (the amendment pre-flight loop, `amendmentFailures`, the `--force` handling) is **untouched** — it already operates per-task and doesn't reference `allAtHumanReview`.

### Step 1a — Fix the hard-coded banner (AC-7)

Current (lines 2521–2527):

```ts
    const rerouteStatuses = taskIds.map(splitState.readStatus);
    const reroutableTier = splitPolicy.detectTier(rerouteStatuses);
    const isFullTierReroute = reroutableTier === 'full';
    const rerouteSource = isSpecGapReroute ? 'code_review spec_gap' : 'human_review';
    splitCli.info(isFullTierReroute
        ? `Rerouting: ${rerouteSource} → spec_review (resetting spec_review, plan, implement, code_review, qa)`
        : `Rerouting: ${rerouteSource} → implement (resetting implement, code_review, qa)`);
```

`rerouteSource` must reflect the *actual* entry state per task instead of the hard-coded pair. Add a small label helper right above `rerouteFromHumanReview` (or inline, but a named helper keeps AC-7's single-task vs. bundle logic in one place):

```ts
function describeRerouteEntryPhase(status: StatusJson): string {
    const phase = getCurrentPhase(status);
    if (phase === 'code_review') {
        const codeReviewStatus = status.phases.code_review?.status ?? 'pending';
        const verdict = getVerdict(status, 'code_review');
        return verdict ? `code_review ${codeReviewStatus} (${verdict})` : `code_review ${codeReviewStatus}`;
    }
    return phase; // 'qa' or 'human_review'
}
```

Then:

```ts
    const rerouteStatuses = taskIds.map(splitState.readStatus);
    const reroutableTier = splitPolicy.detectTier(rerouteStatuses);
    const isFullTierReroute = reroutableTier === 'full';
    const rerouteSource = isSpecGapReroute
        ? 'code_review spec_gap'
        : entryStatuses.length === 1
            ? describeRerouteEntryPhase(entryStatuses[0].status)
            : entryStatuses.map(({ taskId, status }) => `${taskId}: ${describeRerouteEntryPhase(status)}`).join(', ');
```

**Why this preserves every pre-existing test unmodified**: `isSpecGapReroute` still yields the literal string `'code_review spec_gap'`, so `rerouteFromHumanReview accepts code_review blocked spec_gap and cleanly resets review state` (`/code_review spec_gap → spec_review/`) keeps passing untouched. A single task whose current phase is `human_review` derives `describeRerouteEntryPhase` → `'human_review'` (the `code_review` branch doesn't fire), so the two existing full-tier/fast-tier reset tests (`/human_review → spec_review/`, `/human_review → implement/`) keep passing untouched.

**Why this satisfies AC-7's state-varying pair**: a single task at `code_review` `blocked` with verdict `changes_requested` (not spec_gap) yields `'code_review blocked (changes_requested)'` — contains neither `human_review` nor `spec_gap`. A single task at `human_review` yields `'human_review'` — contains no `code_review` substring. Both assertions in AC-7's test must target the segment of the printed line **before** the ` → ` arrow (per `docs/patterns.md` §"Build a state-dependent operator message from one parameterized clause builder"), because the text after the arrow always lists `code_review` and `qa` among the phases being reset.

No other line in `rerouteFromHumanReview` changes. The reset loop, exemption writes, and the two `splitCli.info` messages after the reset (`isFullTierReroute ? ... : ...`) are unchanged verbatim.

---

## Step 2 — CLI help surfaces (`src/cli/index.ts`, `src/orchestrator/cli.ts`)

Both blocks describe admission identically today and must both be edited (they are independently authored — editing one does not update the other).

**`src/cli/index.ts` lines 104–110**, replace:

```
  --reroute               Reset a task from human_review back into the post-review fix path after
                          human feedback. Full-tier tasks (S/M/L/XL or delicate) re-enter at
                          spec_review; fast-tier tasks (XS) re-enter at implement.
```

with:

```
  --reroute               Reset a task from any phase reached after a completed implement round
                          (code_review, qa, or human_review) back into the post-review fix path.
                          Full-tier tasks (S/M/L/XL or delicate) re-enter at spec_review; fast-tier
                          tasks (XS) re-enter at implement.
```

Keep the rest of the block (`Feedback channel: ...` through `§"Human Reroute."`) exactly as-is.

**`src/orchestrator/cli.ts` `printUsage()` lines 151–153**, replace:

```ts
    console.log('  --reroute           Reset a task from human_review back into the post-review fix path after');
    console.log('                      human feedback. Full-tier tasks (S/M/L/XL or delicate) re-enter at');
    console.log('                      spec_review; fast-tier tasks (XS) re-enter at implement.');
```

with:

```ts
    console.log('  --reroute           Reset a task from any phase reached after a completed implement round');
    console.log('                      (code_review, qa, or human_review) back into the post-review fix path.');
    console.log('                      Full-tier tasks (S/M/L/XL or delicate) re-enter at spec_review; fast-tier');
    console.log('                      tasks (XS) re-enter at implement.');
```

Keep lines 154–159 (`Feedback channel:` through `§"Human Reroute."`, including the `--force`/Amendment-heading sentence) exactly as-is.

---

## Step 3 — Prompt wording (drop the false `human_review`/reviewed-implementation claim, keep the human actor)

Do this in dependency order: `context.ts` has no internal dependents here; `prompts/index.ts` renders the templates, so fix its inputs before the templates that consume them.

### 3a — `src/orchestrator/context.ts` line 167

```ts
        reroute: `spec was amended after human_review (reroute #${primary.rerouteCount}) — re-read spec.md for new sections`,
```

→

```ts
        reroute: `a human amended the spec after a completed implementation round (reroute #${primary.rerouteCount}) — re-read spec.md for new sections`,
```

### 3b — `src/orchestrator/prompts/index.ts` — `promptImplementReroute()` (lines 379–411)

Delete the `humanReviewRound` derivation entirely (AC-10(b): `grep -n 'humanReviewRound' src/orchestrator/prompts/index.ts` must return nothing). The round banners now anchor on `rerouteCount` directly — that's the value AC-10 says must be named ("its round number is the reroute round").

Replace the `roundBanner` block:

```ts
    const roundBanner = tasks.length === 1
        ? (() => {
            const rerouteCount = tasks[0].rerouteCount;
            const priorReroutes = rerouteCount - 1;
            return rerouteCount >= 2
                ? `⚠️  **THIS IS REROUTE ROUND ${rerouteCount} FOR THIS TASK.** You have already been sent back ${priorReroutes} time${priorReroutes === 1 ? '' : 's'} before this one. This prompt is **not** a duplicate of the previous reroute you already addressed — a human has provided **new** feedback beyond what you fixed in reroute #${priorReroutes}. If your session memory says "I just finished this," that memory is from the PRIOR round. The spec has additional amendments since then. If your handoff.md references reroute round ${rerouteCount - 1} or earlier, it is out-of-date — the current round is ${rerouteCount}.\n\n`
                : `**This is the first reroute for this task.** A human decided this task needed a spec amendment after a completed implementation round, and wrote it into spec.md.\n\n`;
        })()
        : `⚠️  **This is a reroute round for a bundle of tasks.** Each task carries its own reroute count — see the per-task lines below for the round number and amendment heading specific to each task. Do **not** assume a single bundle-wide round: a bundle can mix tasks on different reroute rounds. A human decided these tasks needed spec amendments after their completed implementation rounds and sent the bundle back with **new** feedback. If your session memory says "I just finished this," that memory is from a prior round — re-read each task's amended spec before changing anything.\n\n`;
```

Leave the comment block above `roundBanner` (lines 370–378, the "Banner derivation rule") — it still describes the single-vs-bundle split correctly; only reword any sentence inside it that says "human review" if present (it doesn't — check before committing, the comment talks about "round numbers" and "anchoring problem", not human review).

Leave the `taskLines` exempt branches (lines 397–401, both `if (exemptInfo.exempt)` returns) **completely unchanged** — AC-10 explicitly excludes them (they only ever render for spec_gap-entry siblings, whose origin genuinely was a completed `code_review`, per the spec's Interaction Dependencies section).

Rewrite only the non-exempt per-task line (line 406):

```ts
        return `- \`${t.taskId}\`: "${t.title}" (entering reroute round ${t.rerouteCount}) — the spec was amended after human review. Locate ${expectedHeading} in tasks/${t.taskId}/spec.md and treat that section's content as the new requirements. Ignore prior-round sections when implementing this one. Your previous handoff is at tasks/${t.taskId}/handoff.md.`;
```

→

```ts
        return `- \`${t.taskId}\`: "${t.title}" (entering reroute round ${t.rerouteCount}) — a human amended the spec and rerouted this task after a completed implementation round. Locate ${expectedHeading} in tasks/${t.taskId}/spec.md and treat that section's content as the new requirements. Ignore prior-round sections when implementing this one. Your previous handoff is at tasks/${t.taskId}/handoff.md.`;
```

Rewrite the non-resumed preamble (line 411 — the `isResumedSession` ternary's false branch; leave the true branch alone, it never mentioned human review):

```ts
        : 'A human reviewed your previous implementation and sent it back with additional feedback. The spec has been updated in place — new ACs, new sections, or revised requirements have been added since you last read it. This is **not** a resume of an interrupted session: your previous work shipped, the human tried it, and now there\'s more to do.';
```

→

```ts
        : 'A human decided this task needed a spec amendment after your implementation shipped, and wrote the amendment into spec.md. The spec has been updated in place — new ACs, new sections, or revised requirements have been added since you last read it. This is **not** a resume of an interrupted session: your previous work is complete and shipped, and now there\'s a delta to implement.';
```

Nothing else in this function changes — `getRerouteExemptInfo()`, `isAdvancingPriorVerdict()`, `stateHeader`, `groundingRule`, `startup`, and the `render()` call's variable list are all unchanged.

**Self-check against AC-10(a)'s forbidden pattern** (`/human[^.\n]{0,24}(review|tried|rejected)/i`) before moving on — walk each rewritten string above and confirm no match. All five do not match (verified during spec authorship; re-verify after typing since exact wording may drift).

### 3c — Templates

**`src/orchestrator/prompts/templates/implement-reroute.md` line 1**:

```
You are addressing **human-review feedback** on {{taskScope}} for {{projectName}}.
```

→

```
You are addressing **a human-directed spec amendment** on {{taskScope}} for {{projectName}}.
```

Steps 0–7 and everything else in this file is unchanged.

**`src/orchestrator/prompts/templates/plan-reroute.md` line 5**:

```
The spec was amended after human review and Codex has reviewed the amendment. Your job is to **append** a reroute plan section to `plan.md`; do not rewrite or remove existing plan content.
```

→

```
A human amended the spec after a completed implementation round, and Codex has reviewed the amendment. Your job is to **append** a reroute plan section to `plan.md`; do not rewrite or remove existing plan content.
```

Line 1 (`... after a human reroute.`) is accurate and stays untouched — this is one of the two permitted survivors of AC-10(a)'s regex.

**`src/orchestrator/prompts/templates/spec-review-reroute.md` line 5**:

```
A human rerouted this task after human review. The original spec was already reviewed and approved. Your job is to review **the amendment and its integration** with the already-approved spec, not to re-litigate settled findings.
```

→

```
A human rerouted this task after a completed implementation round. The original spec was already reviewed and approved. Your job is to review **the amendment and its integration** with the already-approved spec, not to re-litigate settled findings.
```

Line 25 (`The human must revise the amendment and re-run`) is accurate and stays untouched — the other permitted survivor of AC-10(a)'s regex.

**AC-10(d) surface count check**: context.ts (1) + prompts/index.ts round-≥2 banner (2) + round-1 banner (3) + bundle banner (4) + non-exempt per-task line (5) + non-resumed preamble (6) + implement-reroute.md opener (7) + plan-reroute.md sentence (8) + spec-review-reroute.md opener (9) = 9 surfaces, matching AC-10(d)'s count exactly.

---

## Step 4 — Doc / skill / README surfaces (AC-9(a), five surfaces)

### 4a — `docs/pipeline-orchestrator.md` flags table, line 94

```
| `--reroute` | — | Reset a task from `human_review`, or from a `code_review` block with a `spec_gap` verdict, back into the post-review fix path. Full-tier tasks re-enter at `spec_review`; fast-tier tasks re-enter at `implement`. |
```

→

```
| `--reroute` | — | Reset a task from any phase reached after a completed `implement` round (`code_review`, `qa`, or `human_review`) back into the post-review fix path. Full-tier tasks re-enter at `spec_review`; fast-tier tasks re-enter at `implement`. |
```

### 4b — `docs/pipeline-orchestrator.md` §"Human Reroute" (lines 454–482)

The section heading (`## Human Reroute`) stays exactly as-is (Non-Goals: three shipped code paths cite it by name).

**Opening paragraph (line 456)** — replace:

```
If the human rejects at `human_review`, or code review blocks with `spec_gap`, use `--reroute` to resume the pipeline against amended requirements. Reroute sets `phases.implement.rerouted = true` so later reroute prompts read `spec.md` for new Amendment sections, compare against prior artifacts, and update only the delta.
```

with:

```
`--reroute` is admitted from any phase reached after a completed `implement` round — `code_review`, `qa`, or `human_review` — regardless of that phase's status or verdict. Reroute sets `phases.implement.rerouted = true` so later reroute prompts read `spec.md` for new Amendment sections, compare against prior artifacts, and update only the delta.

**Deciding to reroute a task is a human decision.** An agent driving canon — including under `--full-send` or another autonomous mode — must obtain an explicit human decision before invoking `--reroute`; it is never something the agent infers or decides on its own initiative. `--reroute` has no interactive confirmation step of its own, so this is a documentation-level requirement, not a code-enforced one.
```

(This second paragraph is the AC-13 addition — a distinct sentence/paragraph, not folded into the admission-rule sentence, containing the required case-insensitive substring `human decision` twice.)

**Amendment-location paragraph (line 458)** — replace:

```
Before rerouting from `human_review`, write the new requirements into **`tasks/<id>/spec.md` in the active task directory** for every task as an Amendment section. Before rerouting from a `code_review` `spec_gap` block, only the tasks with a `spec_gap` verdict need an Amendment section; approved or other non-gap siblings in the same bundle do not. If a worktree exists for the task, edit the worktree copy; edit REPO_ROOT only before the task has a worktree. `review.md` alone is not sufficient — Codex reads `spec.md` as the contract.
```

with:

```
Write the new requirements into **`tasks/<id>/spec.md` in the active task directory** for every named task as an Amendment section — except on a spec_gap-entry reroute (every named task blocked at `code_review` with at least one `spec_gap` verdict), where only the `spec_gap` tasks need an Amendment section; approved or other non-gap siblings in the same bundle do not. If a worktree exists for the task, edit the worktree copy; edit REPO_ROOT only before the task has a worktree. `review.md` alone is not sufficient — Codex reads `spec.md` as the contract.
```

**Full-tier re-entry paragraph (line 460)** — replace:

```
Full-tier reroute (any S/M/L/XL task or any `delicate` task) re-enters at the same review altitude as the original spec: `human_review` or `code_review` `spec_gap` → `spec_review` → `plan` → `implement`. Codex reviews the amendment in the context of the previously approved ACs and prior `spec-review.md`, without auditing `handoff.md`, `review.md`, or `done.md`. If the amendment is approved, the pipeline flows through to `plan` without re-arming the human spec gate; Claude appends a reroute plan section (`## Reroute Plan` or `## Reroute Plan Round N`) to `plan.md`; Codex then implements from the amendment plus that reroute plan.
```

with:

```
Full-tier reroute (any S/M/L/XL task or any `delicate` task) re-enters at the same review altitude as the original spec — `spec_review` → `plan` → `implement` — regardless of which admitted phase (`code_review`, `qa`, or `human_review`) the task was rerouted from. Codex reviews the amendment in the context of the previously approved ACs and prior `spec-review.md`, without auditing `handoff.md`, `review.md`, or `done.md`. If the amendment is approved, the pipeline flows through to `plan` without re-arming the human spec gate; Claude appends a reroute plan section (`## Reroute Plan` or `## Reroute Plan Round N`) to `plan.md`; Codex then implements from the amendment plus that reroute plan.

Rerouting from `code_review` or a `qa` `pending`/`in_progress` entry happens before the QA-end commit, so task artifacts may still be uncommitted in the worktree. `--reroute` performs no git operation itself, so nothing is destroyed by the reroute — but see `docs/patterns.md` §"Operator git surgery before first QA can still discard uncommitted pipeline state" before running any manual git command (`reset --hard`, `stash drop`, etc.) in that window.
```

Leave every other paragraph in this section (the `changes_requested`-blocks-to-human paragraph at 462, the fast-tier paragraph at 470, the stepped-invocation examples at 472–480, the Amendment-heading-convention paragraph at 482) **exactly as-is** — none of them assert the old two-case admission rule; they describe mechanics that this task does not change.

### 4c — `.claude/skills/canon-pipeline/SKILL.md` §6 (lines 148–161)

Rename the heading (line 148) — nothing pins this text (verified by the round-4 spec_review grep):

```
### 6. Reroute after human rejection
```

→

```
### 6. Reroute after review feedback
```

Replace the admission sentence (line 150):

```
`--reroute` is allowed from `human_review` and from a `code_review` block with a `spec_gap` verdict.
```

with:

```
`--reroute` is allowed from any phase reached after a completed `implement` round: `code_review`, `qa`, or `human_review` — for any status or verdict on that phase.

**Deciding to reroute a task is a human decision, not something an agent driving canon infers on its own** — even under `--full-send` or another autonomous mode, get an explicit human decision before invoking `--reroute`.
```

(Second sentence is the AC-13 addition for this surface — the higher-value of the two AC-13 surfaces per the spec, since this is the section an agent following the skill actually reads before acting. Contains the required case-insensitive substring `human decision` as its own sentence, not folded into the admission-rule sentence above it.)

Update step 1 (line 152) to generalize past "required, not optional" — the amendment requirement itself doesn't change, but the sentence shouldn't imply `human_review` is the only entry:

```
1. Write the new requirements into `spec.md` as an Amendment section — **required**, not optional (unless this is a spec_gap-entry reroute, where only the `spec_gap` tasks need one; approved siblings ride along): the reroute pre-flight gate aborts unless the heading `## Amendment` (round 1) or `## Amendment Round N` (round 2+) exists. A note elsewhere doesn't count. Edit the worktree copy if a worktree exists.
```

Steps 2–3 (lines 153–161) are unchanged — they already describe tier-based re-entry and the `changes_requested` revise-and-rerun path without asserting the old admission rule.

### 4d — `README.md`

**Line 73**, replace:

```
`--reroute` resets a task from `human_review` back into the post-review fix path after human feedback on the diff — full-tier tasks (S/M/L/XL or delicate) re-enter at `spec_review`, fast-tier tasks (XS) re-enter at `implement`.
```

with:

```
`--reroute` resets a task from any phase reached after a completed `implement` round (`code_review`, `qa`, or `human_review`) back into the post-review fix path — full-tier tasks (S/M/L/XL or delicate) re-enter at `spec_review`, fast-tier tasks (XS) re-enter at `implement`.
```

**Line 238**, replace:

```
| `canon run <id> --reroute` | Reset a task from `human_review` back into the post-review fix path after appending an `## Amendment` section to `spec.md` (full-tier re-enters at `spec_review`, fast-tier at `implement`) |
```

with:

```
| `canon run <id> --reroute` | Reset a task from any phase reached after a completed `implement` round (`code_review`, `qa`, or `human_review`) back into the post-review fix path after appending an `## Amendment` section to `spec.md` (full-tier re-enters at `spec_review`, fast-tier at `implement`) |
```

No `templates/` mirror for `README.md` — not in `CANON_OWNED`.

---

## Step 5 — AC-9(b) sweep

Run, from repo root, after Steps 1–4 land:

```bash
grep -rniE 'reroute' --include='*.md' --include='*.ts' -l src/ docs/ .claude/ README.md templates/ \
  | xargs grep -niE 'human_review|human review|spec_gap'
```

(Adjust to a single combined grep or two passes — whatever reproduces "reroute co-occurring with human_review / spec_gap" per the AC's wording; the point is completeness, not the exact invocation.)

Classify every hit:

- **Rule 1 (dated record, out of scope by construction)**: any hit inside `docs/BACKLOG.md` or `CHANGELOG.md` — these must not appear in this task's diff at all (mechanically verify with `git diff --name-only main -- docs/BACKLOG.md CHANGELOG.md` returning empty before finishing implement). Also Rule 1's second tier: `docs/task-quality-log.md`, `docs/lessons-learned.md`, `docs/pipeline-invocations.md` and their `templates/` mirrors — these may appear in the diff (the pipeline appends this task's own rows at QA) but must show an **additive-only** diff; a hand-edit to an existing line in any of them is out of scope and must not happen here.
- **Rule 2 (live-contract file, not an admission-rule statement)**: the `spec_gap` rows in `docs/pipeline-orchestrator.md` §"Phase Routing + Auto-Block" and its bundle-mode paragraph (line 176-ish, describes `code_review` routing — unrelated to `--reroute` admission); `docs/decisions.md`'s `reroute_count`/`Human reroute?` rationale (the "conflates genuine human-review reroutes..." sentence and "Do not derive `Human reroute?` from a reroute counter" rule); the `Human reroute?` bullet in `src/orchestrator/prompts/templates/qa.md` (names `human_review` as the precondition for a *metric* answer, not for using `--reroute`).
- **Anything else that is a hit and doesn't fall under Rule 1 or Rule 2**: that's an under-application of AC-9(a) — go back and fix the surface. If a hit's classification is genuinely ambiguous, that's a Blocker to raise in the handoff, not a judgement call to make silently (per the spec's Known Risks).

Record the full classification (every hit, its file, and which rule it falls under) in the handoff so the reviewer can audit it without re-deriving the sweep. This satisfies the "record that classification in the handoff" requirement in AC-9(b)'s closing paragraph.

---

## Step 6 — Tests: `tests/run-task-reroute-preflight.test.ts`

The file already has the fixtures needed: `makeRerouteStatus` (defaults to a fully-`done`-through-`qa` status sitting at `human_review` `pending`), `makeCodeReviewBlockedStatus` (code_review `blocked` at a given verdict, `qa`/`human_review` `pending`), `writeSpec`, `runReroute`. New admitted-phase rows need one more shape not yet covered by either helper: a task whose `code_review` is *not* `blocked` (e.g. `pending`, `in_progress`, `changes_requested`, or `done`) with `qa` still open. Build those inline via `makeRerouteStatus(taskId, branch, rerouteCount, { codeReview: {...}, qa: {...} })` — the same override pattern the existing off-phase fixture at line 507 already uses.

### 6a — Rewrite `rerouteFromHumanReview rejects non-spec-gap code_review and off-phase bundle siblings without mutation` (lines 500–532)

This test's first case (`task-b` lone at `code_review` `blocked` `approved`, asserting rejection) asserts exactly the behavior this task removes — a lone task at `code_review` `blocked` with a non-spec_gap verdict is now **admitted**. Split the test:

- Rename/repurpose the first case into an AC-1 admitted-state assertion: `task-b` (code_review blocked, verdict `approved`, has `## Amendment`) → `runReroute(dir, ['task-b'], false)` now asserts `result.status === 0` and the written `status.json` shows `implement.status === 'pending'`, `implement.rerouted === true`, `implement.reroute_count` incremented.
- Keep the second case (the `task-a` + `task-c` mixed bundle, where `task-c` sits at `implement` `pending`) as the AC-2 "off-phase sibling in an otherwise-admitted bundle" row — this is exactly the invariant that must still reject. Update its message assertion (see 6b) and keep the byte-identical-status-json-before/after check.

Suggested shape (adjust names/wording to taste, but preserve both assertions' intent):

```ts
void test('rerouteFromHumanReview admits a lone non-spec-gap code_review-blocked task', () => {
    withTempDir('reroute-preflight-non-gap-admitted-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const status = makeCodeReviewBlockedStatus('task-b', 'task/task-b', 'approved');
        writeTaskStatus(tasksRoot, 'task-b', status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, 'task-b'), 'task-b', status);
        writeSpec(path.join(worktreesRoot, 'task-b'), 'task-b', '# Spec\n\n## Amendment\n\nAllowed.\n');

        const result = runReroute(dir, ['task-b'], false);

        assert.equal(result.status, 0, result.stderr);
        const updated = readStatus(worktreeTasksRoot(worktreesRoot, 'task-b'), 'task-b') as {
            phases?: { implement?: { status?: string; rerouted?: boolean; reroute_count?: number } };
        };
        assert.equal(updated.phases?.implement?.status, 'pending');
        assert.equal(updated.phases?.implement?.rerouted, true);
        assert.equal(updated.phases?.implement?.reroute_count, 1);
    });
});

void test('rerouteFromHumanReview rejects an off-phase sibling in an otherwise-admitted bundle without mutation', () => {
    withTempDir('reroute-preflight-off-phase-sibling-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const admitted = makeCodeReviewBlockedStatus('task-a', 'task/task-a', 'spec_gap');
        const offPhase = makeRerouteStatus('task-c', 'task/task-c', 0, {
            codeReview: { status: 'pending', verdict: '' },
            implement: { status: 'pending' },
            qa: { status: 'pending' },
        });
        for (const [taskId, status] of [['task-a', admitted], ['task-c', offPhase]] as const) {
            writeTaskStatus(tasksRoot, taskId, status);
            writeTaskStatus(worktreeTasksRoot(worktreesRoot, taskId), taskId, status);
            writeSpec(path.join(worktreesRoot, taskId), taskId, '# Spec\n\n## Amendment\n\nAllowed.\n');
        }

        const beforeA = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a', 'status.json'), 'utf8');
        const beforeC = fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-c'), 'task-c', 'status.json'), 'utf8');
        const mixed = runReroute(dir, ['task-a', 'task-c'], false);
        assert.notEqual(mixed.status, 0);
        assert.match(mixed.stderr, /Current state:/);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a', 'status.json'), 'utf8'), beforeA);
        assert.equal(fs.readFileSync(path.join(worktreeTasksRoot(worktreesRoot, 'task-c'), 'task-c', 'status.json'), 'utf8'), beforeC);
    });
});
```

### 6b — AC-1: admitted-state rows

Add a parameterized (or repeated-literal, matching this file's existing style — it already uses a `for` loop at line 579 for the two-verdict case) set of tests, each: build a status at the given phase/status/verdict, write the Amendment heading, run reroute, assert exit 0 and `implement.status/rerouted/reroute_count`. Cover, at minimum, every row AC-1 names:

1. `code_review` `blocked` + verdict `changes_requested` (loop-cap auto-block) — `makeCodeReviewBlockedStatus(id, branch, 'changes_requested')`.
2. `code_review` `changes_requested` + verdict `changes_requested` (auto-loop state) — `makeRerouteStatus(id, branch, 0, { codeReview: { status: 'changes_requested', verdict: 'changes_requested' }, qa: { status: 'pending' } })`.
3. `code_review` `in_progress` — `makeRerouteStatus(id, branch, 0, { codeReview: { status: 'in_progress', verdict: '' }, qa: { status: 'pending' } })`.
4. `code_review` `pending` + verdict `''` — `makeRerouteStatus(id, branch, 0, { codeReview: { status: 'pending', verdict: '' }, qa: { status: 'pending' } })`.
5. `code_review` `done` + verdict `approved` with `qa` `pending` — `makeRerouteStatus(id, branch, 0, { codeReview: { status: 'done', verdict: 'approved' }, qa: { status: 'pending' } })`.
6. `qa` `in_progress` — `makeRerouteStatus(id, branch, 0, { qa: { status: 'in_progress' } })` (code_review defaults to `done`/`approved` from `makeRerouteStatus`'s base shape, which is correct here).
7. `human_review` `pending` — already covered by the two existing full-tier/fast-tier reset tests; don't duplicate, just confirm they still pass (they will, since `makeRerouteStatus`'s default is exactly this state).
8. `code_review` `blocked` + verdict `spec_gap` — already covered by the existing `accepts code_review blocked spec_gap` test; don't duplicate.

Each new row: write the Amendment heading, run reroute, assert `result.status === 0` and `implement.status === 'pending'`, `implement.rerouted === true`, `implement.reroute_count` incremented by 1 over its starting value.

### 6c — AC-2: rejected-state rows

Add rows for: a single task at `implement` `pending`; a single task at `plan` (`status !== 'done'`); a single task with every phase `done` (`complete`); plus the off-phase-sibling bundle case already handled in 6a's second test. Each asserts non-zero exit, `Current state:` in the message naming the phase, and byte-identical `status.json` before/after (follow the `beforeX`/`fs.readFileSync` comparison pattern already used throughout this file).

For "every phase done" (`complete`), note `makeRerouteStatus`'s base already sets every phase through `qa` to `done` and `human_review` to `pending` — override `humanReview: { status: 'done' }` to reach `complete`.

### 6d — AC-3: mixed-phase bundle, normalized

One task at `qa` (`makeRerouteStatus` override `qa: { status: 'pending' }` with `code_review` left `done`/`approved`), one at `human_review` (base default), both with Amendment headings, both `M` size (or default) so the bundle is full-tier. Assert exit 0 and that both tasks' post-reroute derived phase (`derivePhase()` helper already in this file) is identical (`spec_review` for the full-tier case).

### 6e — AC-4: no-exemption-on-widened-entry

New test: two tasks both at `code_review` `blocked` with verdict `changes_requested` (no `spec_gap` anywhere), only one carrying an Amendment. Assert the invocation aborts (the un-amended task fails the pre-flight, same as today) and that neither task's written `status.json` contains `reroute_exempt`. This is a pre-flight-abort case, so no status mutation happens at all — verify via the same byte-identical-before/after pattern, and additionally assert `!JSON.stringify(status).includes('reroute_exempt')` isn't even a meaningful check here since nothing was written; the real assertion is just "the file is unchanged and the invocation aborted."

Also **do not touch** the four pre-existing AC-4-relevant tests named in the spec (`reroutes mixed spec_gap bundle when only gap task is amended`, both `preserves <verdict> verdict for exempt failing sibling` rows, `second spec_gap reroute requires round-2 headings...` if present) — they must keep passing with their `reroute_exempt` assertions unmodified. Confirm by running them, don't edit them.

### 6f — AC-5: spec_gap unamended in a widened entry

Two new rows:
1. A spec_gap-entry bundle whose gap task lacks the required heading (reuse the existing `reports every failing task in a bundle`-style shape but scoped to just the gap task).
2. A bundle of two tasks where one carries verdict `spec_gap` but `code_review.status === 'changes_requested'` (not `blocked`, so the spec_gap-entry exemption predicate — which requires `blocked` — does **not** apply) and lacks the heading, while its sibling has one. Assert the invocation aborts naming the gap task.

### 6g — AC-6: Amendment pre-flight / `--force` pair

A single task at any newly-admitted phase (e.g. `qa` `in_progress`) without the Amendment heading: assert abort with the existing per-task failure block shape (task id, spec path, required round, expected heading, reason — this format is unchanged, just verify it still fires for a non-`human_review` entry phase). Then the same fixture run with `runReroute(dir, [taskId], true)`: assert exit 0, one warning per failing task on stderr/stdout, and no `reroute_exempt` in the written `status.json`.

### 6h — AC-7: state-varying banner pair

Two tests (or two assertions within one test, matching the "state-varying pair" pattern):

```ts
void test('rerouteFromHumanReview banner names the real code_review entry state, not human_review or spec_gap', () => {
    withTempDir('reroute-preflight-banner-code-review-', dir => {
        initGitRepo(dir);
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const status = makeCodeReviewBlockedStatus('task-a', 'task/task-a', 'changes_requested');
        writeTaskStatus(tasksRoot, 'task-a', status);
        writeTaskStatus(worktreeTasksRoot(worktreesRoot, 'task-a'), 'task-a', status);
        writeSpec(path.join(worktreesRoot, 'task-a'), 'task-a', '# Spec\n\n## Amendment\n\nFix.\n');

        const result = runReroute(dir, ['task-a'], false);

        assert.equal(result.status, 0, result.stderr);
        const label = result.stdout.split('→')[0] ?? '';
        assert.match(label, /code_review/);
        assert.doesNotMatch(label, /human_review/);
        assert.doesNotMatch(label, /spec_gap/);
    });
});
```

Pair it with an equivalent `human_review`-entry test asserting the label matches `/human_review/` and does **not** match `/code_review/` — this can likely reuse one of the existing full-tier/fast-tier reset tests' `result.stdout` if it already extracts the pre-arrow segment, or be a small new test if isolation is clearer. Both assertions must operate on `result.stdout.split('→')[0]` (or equivalent), never the whole line — matching the AC-7 verification note about the reset-phase list after the arrow legitimately containing `code_review`/`qa`.

---

## Step 7 — Tests: `tests/run-task-prompts.test.ts` (AC-10(c))

Two existing assertions pin the old banner text and must be **rewritten**, not deleted (a `doesNotMatch` against deleted text is a tautology per the spec's Known Risks).

**`promptImplementReroute single-task at reroute #2 retains strong-anchor banner`** (lines 503–512): replace

```ts
    assert.match(output, /THIS IS ROUND 3 OF HUMAN REVIEW — REROUTE #2/);
    assert.match(output, /sent back 1 time before this one/);
```

with

```ts
    assert.match(output, /THIS IS REROUTE ROUND 2 FOR THIS TASK/);
    assert.match(output, /sent back 1 time before this one/);
```

(Per Step 3b's rewrite, `task = makeTask({ rerouteCount: 2, ... })` → `priorReroutes = 1` → banner reads `THIS IS REROUTE ROUND 2 FOR THIS TASK.** You have already been sent back 1 time before this one.` Confirm the exact rendered string once Step 3b lands — this test double-checks the banner text, not the other way around.)

**`promptImplementReroute mixed-bundle banner is neutral and per-task lines are correct`** (lines 467–499): replace

```ts
    assert.doesNotMatch(output, /THIS IS ROUND \d+ OF HUMAN REVIEW/);
    assert.doesNotMatch(output, /REROUTE #\d+\.\*\*/);
```

with

```ts
    assert.doesNotMatch(output, /THIS IS REROUTE ROUND \d+ FOR THIS TASK/);
```

(Drop the `REROUTE #\d+\.\*\*` assertion — it pinned the old banner's literal ending, which no longer exists in that shape; re-pointing it at the new single-task anchor's ending would just duplicate the line above. If you'd rather keep two assertions for belt-and-suspenders, the new banner's distinguishing suffix is `FOR THIS TASK.**`, so `assert.doesNotMatch(output, /FOR THIS TASK\.\*\*/)` is an equally valid second guard — pick one, don't leave a dead assertion pointing at deleted text.)

No other test in this file needs to change (per the spec's Affected Files row for this file).

---

## Step 8 — Generated artifacts (AC-11)

In order:

1. `UPDATE_GOLDENS=1 npm test` (or the equivalent this suite documents at its `before()`/`after()` hooks — see `tests/run-task-prompts.test.ts` lines 178–184, 219) to regenerate `tests/run-task-prompts.golden.json`.
2. **Read the full diff of that file line by line.** It must touch exactly six entries: `promptImplementReroute`, `promptSpecReview_reroute_round1`, `promptSpecReview_reroute_round2`, `promptSpecReview_reroute_bundle`, `promptPlan_reroute_round1`, `promptPlan_reroute_bundle`. `promptQa` and `promptQa_withTemplate` must be **byte-identical** to their pre-change values — if either moved, something in Step 3 leaked into a shared helper; find and fix it before proceeding, per the spec's explicit instruction that this is a Blocker, not a regen artifact to accept.
3. Run `npm test` again *without* `UPDATE_GOLDENS` to confirm the suite is green against the regenerated golden file (this also re-runs the Step 6/7 test rewrites).
4. `npm run build` — rebuilds `dist/orchestrator/run-task.js` and `dist/cli/index.js`. Commit the delta.
5. `npm run sync-templates:check` (or `npm run sync-templates` then `:check`) — regenerates `templates/docs/pipeline-orchestrator.md` and `templates/.claude/skills/canon-pipeline/SKILL.md` from their roots. Do not hand-edit either `templates/` file.

List all five generated artifacts in the handoff Changes table (per AC-11 and `docs/patterns.md` §"Declare `templates/` mirrors...").

---

## Step 9 — Full validation

```bash
npm run lint
npm run type-check
npm test
npm run build
npm run sync-templates:check
```

All must pass (AC-12). Confirm specifically that `tests/run-task-reroute-preflight.test.ts` and `tests/run-task-prompts.test.ts` run clean in the full suite, not just in isolation — this repo's test runner is `node --test`, invoked as documented in `docs/architecture.md`'s Validation table (do not use `npm test -- <file>` to scope a single file; it doesn't).

---

## Cross-cutting reminders while implementing

- **Do not touch** `verifyRerouteAmendment()`, `checkRerouteEvidence()`, `getRerouteExemptInfo()`, `isAdvancingPriorVerdict()`, `detectTier()`, `canon task accept`'s `sanctioned` path, `reset-spec-review`/`reset-code-review`, or anything in `src/orchestrator/quality-log.ts` / `src/orchestrator/prompts/templates/qa.md` / `docs/task-quality-log.md`. If you find yourself editing any of these, the change has drifted out of scope — stop (per the spec's Interaction Dependencies section).
- **Do not touch** `docs/BACKLOG.md` or `CHANGELOG.md` — verify with `git diff --name-only main` before finishing that neither appears.
- The exempt-task prompt lines in `promptImplementReroute()` (the two `if (exemptInfo.exempt)` branches) and the templates' exempt-handling steps are out of AC-10's scope — leave them alone.
- Every reroute-related file read/write in tests must go through the worktree copy (`worktreeTasksRoot(...)`), not `tasksRoot` alone, matching this file's existing convention (`docs/patterns.md` §"Worktree runs: read files and set subprocess cwd from the active checkout, not REPO_ROOT").
- Append anything surprising found while re-reading the codebase to `tasks/relax-reroute-gate-post-implement/notes.md` (prefix `[implement]`), per the implement prompt's standing instruction.
