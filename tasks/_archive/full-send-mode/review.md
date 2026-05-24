# Code Review: full-send-mode

## Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**


### Bundle-Level Handoff Verification

- diff→handoff: docs/lessons-learned.md in diff but not in any bundle handoff
- diff→handoff: docs/pipeline-invocations.md in diff but not in any bundle handoff
- diff→handoff: docs/task-quality-log.md in diff but not in any bundle handoff

## Verdict

- [x] **Changes requested** — fix the above and resubmit handoff.

---

## Round 2 — verifying iteration 1's response to round 1

### Pre-flight block clarification

The three docs files flagged by the pre-flight (`docs/lessons-learned.md`, `docs/pipeline-invocations.md`, `docs/task-quality-log.md`) are orchestrator-logged telemetry and Claude QA phase artifacts — they appear in the diff because the orchestrator auto-logs every pipeline invocation and the QA phase wrote a quality-log row and a lessons-learned entry. These are not Codex implementation artifacts and do not belong in Codex's handoff Changes table. The pre-flight check is overzealous for these specific files; no action required.

### Verifying Round 1 findings

- _correctness bug:_ AC-8(e) missing prescribed acknowledgment text → addressed at `.claude/skills/canon-spec/SKILL.md:170-177`. Phase 6 now includes the exact `⚠ Delicate + full-send: canon's review chains still run with the upgraded model...` block with the "Reply 'stop' within 5 seconds to abort" instruction. Both SKILL.md and `templates/.claude/skills/canon-spec/SKILL.md` identical. ✓

- _correctness bug:_ AC-9 spec.md banner write missing from SKILL.md Phase 5 → addressed at `.claude/skills/canon-spec/SKILL.md:131-132`. Phase 5 step 3 now contains the conditional instruction to prepend `> **Full-send mode**: This spec was produced in full-send mode.` when full-send is active. Both SKILL.md files identical. ✓

- _spec gap:_ AC-12 missing sub-items → all required items confirmed present:
  - (a2) `--force` standalone parseArgs test → `tests/run-task-cli.test.ts:82` ✓
  - (e) gate-fail in full-send tail → `tests/run-task-safety.test.ts:1845` — asserts status non-zero and `human_review.status` stays `pending` ✓
  - (j2) hand-edit `full_send: true + delicate: true` without `--full-send` flag and without `--force` → `tests/run-task-safety.test.ts:1954` ✓
  - (f) `commitHumanReviewFiles` PR-creation failure → `FAKE_GH_PR_CREATE_FAIL: '1'` path confirms `human_review.status` stays `pending` ✓
  - (f2)/(f3) direct `commitHumanReviewFiles(createPR = false|true)` tests → `tests/run-task-safety.test.ts:1428` and `1489` ✓
  - (f4) clean-tree retry keys off `createPR` not `cliArgs.pr` → verified by line 1489 test invoking `commitHumanReviewFiles(..., true)` with `cliArgs.pr` defaulting to `false` ✓
  - (f5)/(f6) `inspectCompleteState` returns `pushed_no_pr`, banner shows placeholder, `human_review.status` still advances → covered by the no-`FAKE_GH_PR_STATE_FILE` path ✓

### New findings

None. The following new changes in iteration 1 are all correct:

- **`.every()` semantics for spec gate bypass**: `runSpecReviewPhase` (fast tier) and `checkAndRoute` (full tier) now use `allFullSend = tasks.every(...)` so a single non-full-send task in a bundle re-engages the gate for all. Correct — `.every()` prevents accidentally bypassing the gate for non-full-send tasks. The AGENTS.md bundle semantics bullet documents this accurately. Both `AGENTS.md` and `templates/AGENTS.md` identical.

- **`promptSpecReview` keeps `.some()`**: the full-send rigor note is injected when ANY task in the bundle is full-send. This is intentionally different from the gate bypass (`.every()`) — in a mixed bundle, the full-send tasks still need Codex to know their spec had no human review. Using `.every()` here would silently drop the rigor note for those tasks. Correct as-is.

- **`ghAvailable` refresh in `commitHumanReviewFiles` when `createPR: true`**: direct-call test paths that bypass `main()`'s dep-check need `ghAvailable` initialized. The module-level default of `false` is safe for `createPR: false` callers. Correct.

### Verdict for this round

- [x] **Approved**
