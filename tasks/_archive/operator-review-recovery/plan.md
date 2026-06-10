# Plan: operator-review-recovery

> Written by: Claude | Source: spec.md (approved_with_nits), spec-review.md

## Spec-review nit carried forward

The spec-review nit flags that "sanctions both" phrasing in AC-5 / the Affected Files table row is easily misread as "both verdicts become `sanctioned`." The plan carries forward the AC-15 per-task rule precisely: a multi-ID `canon task accept A B code_review --reason` **recovers/unblocks both** — only tasks carrying a non-advancing verdict (`spec_gap`/`changes_requested`/`needs_re_review`/`''`) become `sanctioned`; tasks already carrying an advancing verdict (`approved`/`approved_with_nits`) keep their verdict and receive no `operator_accepted*` fields.

---

## Step 1 — Add `sanctioned` to the TypeScript type union

**File**: `scripts/run-task/types.ts:14`

Add `'sanctioned'` to `_VERDICT_VALUES`:
```
export const _VERDICT_VALUES = ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review', 'spec_gap', 'sanctioned'] as const;
```

`Verdict` and `isVerdict` are derived from this array, so both update automatically. No other changes to this file.

---

## Step 2 — Register `sanctioned` in the runtime validator

**File**: `src/task/index.ts`

**2a.** Add `'sanctioned'` to `VALID_VERDICTS` (`:19`):
```
const VALID_VERDICTS = new Set<string>(['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review', 'spec_gap', 'sanctioned']);
```

**2b.** Update the error message in `assertValidVerdict` (`:344`) to include `sanctioned` in the list.

**2c.** Add a mint-by-accept-only guard inside `assertValidVerdict`: after the existing `spec_gap`-phase guard, add a check that rejects `verdict === 'sanctioned'` with a redirect to `canon task accept --reason` (AC-8):
```typescript
if (verdict === 'sanctioned') {
    throw new Error(
        `Error: verdict 'sanctioned' cannot be set via \`canon task phase\`. ` +
        `Use \`canon task accept <id> ${phase} --reason "<why>"\` instead — ` +
        `it ensures the operator_accepted audit fields and notes.md entry are written.`
    );
}
```
This rejects `canon task phase <id> code_review done sanctioned` while leaving all pre-existing verdicts reachable through `canon task phase` (Non-Goals).

---

## Step 3 — Clear `operator_accepted*` on review-phase reopen in `taskPhase`

**File**: `src/task/index.ts` (~`:448-452`)

The existing block clears `operator_accepted*` only when `implement` moves away from `done`. Extend it to also cover `spec_review` and `code_review` (AC-11):

```typescript
if (
    (phaseArg === 'implement' || phaseArg === 'spec_review' || phaseArg === 'code_review') &&
    previousStatus === 'done' &&
    statusArg !== 'done'
) {
    delete entry.operator_accepted;
    delete entry.operator_accepted_sha;
    delete entry.operator_accepted_at;
}
```

---

## Step 4 — Add `--reason` parsing in `taskCmd`

**File**: `src/task/index.ts` — `taskCmd` accept case (~`:1208`)

Current arg parsing strips `--force`. Extend to also consume `--reason <value>` (value-bearing — consume the following token):
```typescript
const force = rest.includes('--force');
let reason: string | undefined;
const filtered: string[] = [];
for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--reason') {
        reason = rest[i + 1];
        i++; // consume the value token
    } else if (rest[i] !== '--force') {
        filtered.push(rest[i]);
    }
}
const positional = filtered;
// ...
taskAccept(acceptIds, acceptPhase, { force, reason });
```

Pass `reason` through to `taskAccept`.

---

## Step 5 — Generalize `taskAccept` to support review phases

**File**: `src/task/index.ts` — `taskAccept` (~`:551`)

Update the function signature to `options: { force?: boolean; reason?: string }`.

Replace the current implement-only hard-reject (`:557-562`) with a phase-based dispatch:
```typescript
if (phaseArg !== 'implement' && phaseArg !== 'spec_review' && phaseArg !== 'code_review') {
    throw new Error(
        `Error: 'canon task accept' supports implement, spec_review, and code_review phases. ` +
        `Got '${phaseArg}'. For other phases use \`canon task phase <id> ${phaseArg} done [verdict]\`.`
    );
}
```

Keep the existing implement path intact. Below it, add the **review-accept path** entered when `phaseArg === 'spec_review' || phaseArg === 'code_review'`:

**5a. Mandatory `--reason` check** (AC-5):
```typescript
if (!options.reason?.trim()) {
    throw new Error(
        `Error: --reason "<text>" is required when accepting a review phase. ` +
        `Provide a reason explaining why the agent verdict is being overridden.`
    );
}
const reason = options.reason.trim();
```

**5b. Build `ctxByTask`** — same pattern as the implement path: `resolveTaskCwd`, read `status.json` via `readJsonFile`, populate map.

**5c. Bundle structural guards** — run the same guards as the implement path, but **skip** the implement-only git guards (clean-tree check, non-empty `baseRef..HEAD` diff, handoff coverage check). Keep:
- Worktree-mode homogeneity check (no mixed `worktree: true/false` bundles)
- Same-tree check (all tasks resolve to the same working tree)
- Prior phases complete check (unless `--force`) via `priorIncompletePhases`
- Same `base_branch` check (bundle coherence — not used for diff here, but still a valid invariant)

The spec Known Risks is explicit: "implement-only git guards (non-empty `baseRef..HEAD` diff, handoff coverage, SHA-pin) do NOT run on the review-accept path." A `spec_review` accept may run before any code exists (empty diff); neither review phase auto-commits. Reusing those guards would wrongly reject a legitimate review sanction.

**5d. Get HEAD SHA** for `operator_accepted_sha` (record-only on review phases — no auto-commit-skip semantics, just an audit timestamp):
```typescript
const headRevParse = runGit(['rev-parse', 'HEAD'], { cwd: gitCwd });
// ... same error handling pattern as implement path
const sharedSha = (headRevParse.stdout ?? '').trim();
```

**5e. Snapshot originals for rollback** — same `originalSnapshots` map pattern as implement path (POSIX cross-file atomicity guarantee).

**5f. Write per-task review-accept state** (AC-6, AC-15):

Define `ADVANCING_VERDICTS = new Set(['approved', 'approved_with_nits'])` locally. For each task:
```typescript
const ADVANCING_VERDICTS = new Set(['approved', 'approved_with_nits']);

for (const ctx of ctxByTask.values()) {
    const reviewEntry = ensurePhaseEntry(ctx.status, phaseArg as Phase);
    const currentVerdict = reviewEntry.verdict ?? '';

    if (!ADVANCING_VERDICTS.has(currentVerdict)) {
        // Non-advancing verdict (spec_gap / changes_requested / needs_re_review / '')
        // → sanctioned + audit fields (operator is overriding the agent)
        reviewEntry.verdict = 'sanctioned';
        reviewEntry.operator_accepted = true;
        reviewEntry.operator_accepted_at = today();
        reviewEntry.operator_accepted_sha = sharedSha;
    }
    // Advancing verdict: reviewEntry.verdict stays as-is; no operator_accepted* set
    // (the task was blocked only by the whole-bundle autoBlockPhase, not by its own verdict)

    reviewEntry.status = 'done';
    ctx.status.updated = today();
    // Write directly — no checkPhaseGate. The accept path IS the authorized override;
    // the artifact-verdict-match gate does not apply here (review.md / spec-review.md
    // legitimately keeps the agent's original verdict as the historical record).
    writeStatusAtomic(ctx.statusPath, ctx.status);
    // writeStatusAtomic calls writeStatus which calls deriveTopLevelStatus, so the
    // top-level status pointer automatically advances to the next phase
    // (spec_review → plan; code_review → qa).
    completedWrites.push(ctx.statusPath);
}
```

**5g. Rollback on mid-write failure** — same `completedWrites` / `originalSnapshots` rollback pattern as implement path.

**5h. Append `notes.md` audit line** (AC-7) for each task:
```typescript
for (const ctx of ctxByTask.values()) {
    const notesPath = path.join(taskDirForCwd(ctx.taskCwd, ctx.id), 'notes.md');
    const entry = ctx.status.phases[phaseArg as Phase];
    const wasSanctioned = entry?.verdict === 'sanctioned';
    const bundleNote = ids.length > 1
        ? ` Bundle: ${ids.join(', ')}.`
        : '';
    const noteLine =
        `[${today()}] Operator ${phaseArg} accept via \`canon task accept\` — ` +
        `${wasSanctioned ? 'sanctioned (agent verdict overridden)' : 'unblocked (advancing verdict preserved)'}. ` +
        `Reason: ${reason}.${bundleNote}`;
    try {
        if (fs.existsSync(notesPath)) {
            fs.appendFileSync(notesPath, `\n${noteLine}\n`, 'utf8');
        } else {
            fs.writeFileSync(notesPath, `${noteLine}\n`, 'utf8');
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Warning: failed to log to notes.md for ${ctx.id}: ${message}`);
    }
}
```

**5i. Console output**:
```typescript
const label = ids.length === 1 ? ids[0] : `[${ids.join(', ')}]`;
const nextPhase = phaseArg === 'spec_review' ? 'plan' : 'qa';
console.log(
    `Accepted ${label}: ${phaseArg} → done.\n` +
    `  Next phase: ${nextPhase}. Run \`canon run ${ids.join(' ')}\` to continue.`
);
```

---

## Step 6 — Update `usage()` and CLI help

**File**: `src/task/index.ts` — `usage()` (~`:37`):

Update the `accept` line to show the expanded phase set and `--reason`:
```
  accept <TASK-ID...> <phase> [--reason "<text>"] [--force]
         phase: implement | spec_review | code_review
         --reason required for spec_review and code_review
```

**File**: `src/cli/index.ts`:

**6a.** Add `sanctioned` to the verdict list in the `phase` help text (~`:56`). Append a note: `sanctioned` is write-only via `canon task accept --reason`, not via `canon task phase`.

**6b.** Update the `accept` help text to show the expanded phase set and `--reason`.

---

## Step 7 — Add `sanctioned` to status template

**File**: `.canon/templates/status.json:52`

Add `sanctioned` to the `_verdict_values` help string so newly scaffolded tasks advertise the full verdict set (AC-8).

---

## Step 8 — Generalize `clearImplementOperatorAcceptance` to review phases

**File**: `scripts/run-task/main.ts` (~`:2240`)

Rename `clearImplementOperatorAcceptance` → `clearPhaseOperatorAcceptance` and make it accept any `PhaseEntry`:

```typescript
function clearPhaseOperatorAcceptance(entry: PhaseEntry | undefined): void {
    if (!entry) return;
    delete entry.operator_accepted;
    delete entry.operator_accepted_sha;
    delete entry.operator_accepted_at;
}
```

Update existing call sites (`:2176`, `:2256` via `routeBackTo`) to use the new name.

**Update `routeBackTo` (~`:2270`)**: in the phase-reset loop where `verdict` is cleared, also call `clearPhaseOperatorAcceptance(phaseEntry)` for any phase entry being reset to `pending`. This ensures `canon task phase <id> code_review pending` clears a stale sanction (AC-11 manual-reopen path).

**Update `rerouteFromHumanReview` full-tier reset block (~`:2202-2217`)**: after resetting `specReview` (clearing verdict/counters), call `clearPhaseOperatorAcceptance(specReview)`. After resetting `codeReview`, call `clearPhaseOperatorAcceptance(codeReview)`. This handles the AC-11 reroute-path clear for any prior `sanctioned` verdict.

---

## Step 9 — Relax `rerouteFromHumanReview` precondition

**File**: `scripts/run-task/main.ts:2096`

Replace the per-task `currentPhase !== 'human_review'` check with a bundle-aware precondition (AC-1):

```typescript
export function rerouteFromHumanReview(taskIds: string[]): void {
    const statuses = taskIds.map(id => ({ id, status: splitState.readStatus(id) }));

    // Accept two reroute entry points:
    //   (A) all tasks at human_review — the original path
    //   (B) all tasks at code_review + blocked, with at least one spec_gap verdict —
    //       allows --reroute as the audited fix path from a spec_gap escalation.
    //
    // Quantifier rationale (docs/patterns.md "Bundle-gate conditions must use every()"):
    //   `every` blocked = safety floor: a single spec_gap task must not drag a
    //   sibling that is mid-implement into a destructive reset.
    //   `some` spec_gap = trigger: that is what justified blocking the bundle.
    const allAtHumanReview = statuses.every(({ status }) =>
        getCurrentPhase(status) === 'human_review'
    );
    const allAtCodeReviewBlocked = statuses.every(({ status }) => {
        const cr = status.phases.code_review;
        return cr?.status === 'blocked';
    });
    const someSpecGap = statuses.some(({ status }) =>
        getVerdict(status, 'code_review') === 'spec_gap'
    );
    const isSpecGapReroute = allAtCodeReviewBlocked && someSpecGap;

    if (!allAtHumanReview && !isSpecGapReroute) {
        const summary = statuses
            .map(({ id, status }) => `'${id}': ${getCurrentPhase(status)}`)
            .join(', ');
        splitCli.die(
            `--reroute requires either:\n` +
            `  (a) all tasks at human_review, or\n` +
            `  (b) all tasks at code_review blocked, with at least one spec_gap verdict.\n` +
            `Current phases: ${summary}`
        );
    }
    // ... rest of function unchanged (amendment verification, reset loop, etc.)
```

Update the progress log (`:2150-2152`) to note the spec_gap entry point when relevant.

The existing reset loop (`:2154-2222`) already handles the complete reset correctly: `codeReview.status = 'pending'` overwrites `blocked`, `codeReview.verdict = ''` clears `spec_gap`, `iterations_current_loop`/`preflight_rejections_current_loop` are zeroed. The `clearPhaseOperatorAcceptance` calls added in Step 8 handle the stale-sanction clear. No changes to the reset loop body needed (AC-2, AC-13).

---

## Step 10 — Rewrite the spec_gap recovery message

**File**: `scripts/run-task/main.ts` — `checkAndRoute` `code_review` case (~`:2792-2818`)

**10a.** Rewrite both the console block (`:2801-2816`) and the persisted `reason` string (`:2796-2800`) to present the two audited paths. Both must use the full `taskIds` (not narrowed to `specGapIds`) because the whole bundle is blocked and recovery must name every blocked member (AC-4):

```typescript
const idsArg = taskIds.join(' ');
const reason =
    `Code review surfaced a spec_gap verdict for task(s): ${specGapIds.join(', ')}. ` +
    `The implementation cannot resolve this — the root cause is in the spec. ` +
    `Recovery options (both operate on the full blocked bundle [${idsArg}]):\n` +
    `  FIX: amend spec.md with ## Amendment, then: canon run ${idsArg} --reroute\n` +
    `  BLESS: canon task accept ${idsArg} code_review --reason "<why>"`;

console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  ✋  SPEC GAP — Code review surfaced a spec problem.');
console.log('');
console.log('  The code review found a problem in the spec, not a fixable');
console.log('  implementation bug. Review the findings:');
for (const id of specGapIds) console.log(`    tasks/${id}/review.md`);
console.log('');
console.log('  Two recovery options:');
console.log('');
console.log('  FIX  — Amend the spec and re-run the full review chain:');
for (const id of specGapIds) {
    console.log(`    # Edit tasks/${id}/spec.md — add a ## Amendment section`);
}
console.log(`    canon run ${idsArg} --reroute`);
console.log('');
console.log('  BLESS — Sanction the gap as acceptable (adds an audit trail):');
console.log(`    canon task accept ${idsArg} code_review --reason "<why this gap is acceptable>"`);
console.log('════════════════════════════════════════════════════════');
console.log('');
```

**10b.** Add a comment on `autoBlockPhase(taskIds, ...)` (`:2817`) explaining why the scope stays on the full bundle — not narrowed to `specGapIds` (AC-14):
```typescript
// Block the entire bundle, not just specGapIds. Bundle members share one branch
// and one commit history: an approved sibling must not advance to qa while a
// rerouted gap task forces a re-implementation of the shared tree.
// Both recovery paths (--reroute, accept) operate on the full bundle.
splitState.autoBlockPhase(taskIds, 'code_review', maxIter, reason);
```

**10c.** `sanctioned` handling: no explicit code change needed — `specGapIds` already filters for `=== 'spec_gap'` only, `anyChangesRequested` filters for `changes_requested`/`needs_re_review` only, so `sanctioned` tasks naturally fall through to the `return` and advance. Add a comment for future-reader clarity (AC-9).

---

## Step 11 — Tests: `tests/run-task-reroute-preflight.test.ts`

Add the following test cases (AC-1, AC-2, AC-3, AC-13, AC-14):

**AC-1 precondition cases (single-task fixtures)**:
- `human_review` → allowed (existing; confirm still passes)
- `code_review` `status: 'blocked'` + `verdict: 'spec_gap'` → allowed (no die called)
- `code_review` `status: 'blocked'` + `verdict: 'approved'` (no spec_gap) → rejected with new die message containing both allowed-case descriptions
- `code_review` `status: 'done'` (non-blocked) → rejected
- `implement` phase → rejected

**AC-2 full machinery reset**: fixture with spec_gap-blocked `code_review`; call `rerouteFromHumanReview`; assert post-reroute state matches a `human_review` reroute: `reroute_count` incremented, `implement.rerouted = true`, `implement`/`code_review`/`qa`/`human_review` all `pending`, `spec_review`/`plan` pending for full-tier, `sessions.codex_spec_review` deleted for full-tier.

**AC-13 clean spec_gap-entry-state reset**: fixture where `code_review` is `blocked`+`spec_gap` with non-zero `iterations_current_loop`/`preflight_rejections_current_loop`; call `rerouteFromHumanReview`; assert `code_review.status === 'pending'`, `code_review.verdict === ''`, `iterations_current_loop === 0`, `preflight_rejections_current_loop === 0`; drive one dispatch step and assert it routes to `spec_review` (full-tier), not back to `code_review`.

**AC-3 amendment round numbering**: drive spec_gap → `--reroute` (round 1, requires bare `## Amendment`) → `human_review` → `--reroute` (round 2, requires `## Amendment Round 2`); assert leftover bare `## Amendment` does NOT satisfy round-2 pre-flight.

**AC-14 mixed-bundle**:
- (a) A=`code_review` `blocked`+`spec_gap`, B=`code_review` `blocked`+`approved`: `rerouteFromHumanReview(['A','B'])` accepted; post-reroute both A and B have `code_review.status === 'pending'`, `verdict === ''`, `iterations_current_loop === 0`, `preflight_rejections_current_loop === 0`
- (b) A=`code_review` `blocked`+`spec_gap`, B=`implement` `pending`: `rerouteFromHumanReview(['A','B'])` rejected with die message; neither task's status mutated

---

## Step 12 — Tests: `tests/run-task-validation.test.ts`

**AC-8 drift guard**: assert `sanctioned` appears in `_VERDICT_VALUES`-derived value list, `VALID_VERDICTS`, the CLI help string, and the status-template `_verdict_values` string. Per lessons-learned ("drift-guard tests require the guarded list to be exported"): if `VALID_VERDICTS` is not currently exported, export it from `src/task/index.ts`.

**AC-9 routing**:
- Feed `checkAndRoute('code_review', ...)` with a fixture where `code_review.verdict === 'sanctioned'`; assert the `spec_gap` escalation does NOT fire and the call returns normally.
- Feed `checkAndRoute('spec_review', ...)` with a fixture where `spec_review.verdict === 'sanctioned'`; assert the `changes_requested` branch does NOT route back to `spec`.

**AC-3 `verifyRerouteAmendment` round numbering** (add here if not already in the reroute-preflight tests): bare `## Amendment` satisfies round 1; `## Amendment Round 2` satisfies round 2; bare `## Amendment` does NOT satisfy round 2.

---

## Step 13 — Tests: `tests/task-cli.test.ts`

Consolidate all `canon task accept` tests here (existing file for accept tests). Add (AC-5, AC-6, AC-7, AC-8(b,c), AC-10, AC-11, AC-15):

**AC-5 mandatory reason**:
- `accept <id> code_review --reason "x"` → exits zero
- `accept <id> code_review` (no `--reason`) → exits non-zero with clear message
- `accept <id> spec_review --reason "x"` → exits zero
- `accept <id> spec_review` (no `--reason`) → exits non-zero
- `accept <id> implement` (no `--reason`) → exits zero (backward compat; reason optional for implement)
- Two-ID `accept A B code_review --reason "x"` → exits zero (bundle-aware)

**AC-6 sanction + advance (single-task fixtures)**:
- From `code_review` `blocked`+`spec_gap`: after accept → `status === 'done'`, `verdict === 'sanctioned'`, top-level `status === 'qa'`; one dispatch step routes to `qa`, not `code_review`
- From `spec_review` `changes_requested`: after accept → `status === 'done'`, `verdict === 'sanctioned'`, top-level `status === 'plan'`

**AC-7 paper trail**:
- After accept, `notes.md` contains the phase name and the exact `--reason` text verbatim
- `status.json` phase entry has `operator_accepted === true`, `operator_accepted_at` (non-empty date), `operator_accepted_sha` (non-empty SHA)
- Any prior `escalations[]` entry on the phase is still present (not erased)

**AC-8(b,c) mint-by-accept-only rejection**:
- `canon task phase <id> code_review done sanctioned` → exits non-zero with message naming `canon task accept --reason`
- `canon task phase <id> plan done sanctioned` → exits non-zero (rejected by existing review-phase guard before reaching the `sanctioned` check — this exercises the defense-in-depth; confirm the error message is still user-readable)

**AC-10 invariant**:
- Snapshot `spec.md` bytes and `reroute_count` before accept; assert both unchanged after accept

**AC-11 reopen clears**:
- Sanction `code_review`; then `canon task phase <id> code_review pending`; assert `operator_accepted*` fields absent, `verdict === ''`
- Sanction `code_review`; then call `rerouteFromHumanReview` on a fixture at `code_review` blocked; assert `operator_accepted*` fields absent, `verdict === ''` post-reroute

**AC-15 mixed-bundle bless** — two-task fixture where A=`code_review` `blocked`+`spec_gap`, B=`code_review` `blocked`+`approved`:
- `accept A B code_review --reason "x"` → A: `status === 'done'`, `verdict === 'sanctioned'`, `operator_accepted*` set; B: `status === 'done'`, `verdict === 'approved'` (preserved, NOT `sanctioned`), no `operator_accepted*` fields; both top-level pointers → `qa`; both `notes.md` files gain an audit line; prior `escalations[]` entries intact
- Partial bless: `accept A code_review --reason "x"` (A only) → B remains at `code_review` `blocked`; A advances normally (documents why AC-4's message lists all blocked IDs)

---

## Step 14 — Docs update

**`AGENTS.md`** — in the `canon task` key ops table, add:
- `canon task accept <id...> spec_review|code_review --reason "<text>"` — operator override of a review verdict; sets `sanctioned`, writes audit trail to `notes.md`; `--reason` is mandatory
- Prose note: `--reroute` is also allowed from a `code_review` spec_gap block (in addition to `human_review`)
- Document the fix-vs-bless taxonomy and the `sanctioned` verdict

**`CLAUDE.md`** Quick-refs — add:
- `--reroute` from spec_gap: `canon run <ids> --reroute` when `code_review` is blocked with `spec_gap`
- `canon task accept <ids> code_review --reason "<why>"` for the bless path (false positive or trivial gap); same for `spec_review`
- The `## Amendment` ⇔ `reroute_count` invariant (so operators don't hand-add amendments without rerouting, which produces the desync the fix path closes)

**`docs/pipeline-orchestrator.md`** — update sections covering:
- Human Reroute: relax precondition description to include the spec_gap entry point
- spec_gap escalation: present both recovery paths (fix and bless)
- Verdict routing table: add `sanctioned` row ("operator accept, advances like approval")
- `canon task accept`: document the phase expansion and mandatory `--reason`

**`docs/BACKLOG.md`** — mark the `` `code_review` `spec_gap` recovery skips spec_review re-validation and plan refresh — asymmetric with `human_review` reroute `` entry as resolved by this task.

---

## Step 15 — Build

Run `npm run build` to regenerate:
- `dist/scripts/run-task.js` (bundles `scripts/run-task/**`)
- `dist/cli/index.js` (bundles `src/**` and `scripts/run-task/validation.ts`)

Commit both with the implementation.

---

## Step 16 — Sync templates

The pre-commit hook auto-runs `npm run sync-templates` on `git commit`. After editing `AGENTS.md`, `CLAUDE.md`, `docs/pipeline-orchestrator.md`, and `.canon/templates/status.json`, run `npm run sync-templates` explicitly before staging so the `templates/` mirror diffs are visible before commit.

---

## Implementation order

Steps are ordered to minimize breakage:
1. Type system first (Step 1) — downstream type checks compile against the new union
2. Runtime validators (Step 2) — `assertValidVerdict` ready before any new verdict is written
3. `taskPhase` reopen guard (Step 3) — before accept path writes `sanctioned`
4. Arg parsing (Step 4) — before `taskAccept` uses `reason`
5. `taskAccept` review-accept path (Step 5) — the main behavioral addition
6. CLI help + template (Steps 6–7) — cosmetic, order-independent
7. `clearPhaseOperatorAcceptance` generalization (Step 8) — before reroute relaxation uses it
8. Reroute precondition relaxation (Step 9) — depends on Step 8 for full-tier reset path
9. Recovery message rewrite (Step 10) — independent of above; no behavioral dependencies
10. Tests (Steps 11–13) — after all source changes
11. Docs (Step 14) — final
12. Build (Step 15) + template sync (Step 16)

## Validation checklist (post-implementation)

- `npm run lint`
- `npm run type-check`
- `npm test` — full suite
- `npm run build` — confirms `dist/` matches fresh build
- `npm run sync-templates:check` — confirms root→`templates/` mirrors are current
- `npm run docs-refs-check` — confirms no broken refs in touched artifacts
