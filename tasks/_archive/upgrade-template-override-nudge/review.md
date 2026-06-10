# Code Review: upgrade-template-override-nudge

> Reviewer: Claude | Spec: `tasks/upgrade-template-override-nudge/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `UpgradeResult` gains `staleOverrides: string[]` at all three return points | Pass | Field declared at `upgrade.ts:152-169`; all three `return` statements in `runUpgrade()` carry it (--check return, dirty-refusal return, final return); tests cover all three paths |
| AC-2: checked basename set equals `CANON_OWNED` task-template basenames | Pass | `getTaskTemplateBasenames()` at `upgrade.ts:121-125` filters `CANON_OWNED` on `.canon/templates/` and maps to `basename`; drift-guard test at `cli.test.ts:1074-1083` independently asserts the same derivation |
| AC-3: differing override under resolved root listed when template changes this run | Pass | `getStaleOverrides()` gates on `changedByRel` membership (clean ops only), `existsSync` override check, and content diff vs new template bytes; positive test verifies override appears in `staleOverrides` |
| AC-4: unchanged template does not nudge differing override | Pass | Unchanged templates never enter `pending`/`clean`, so `changedByRel.get()` returns `undefined` → continue; unchanged-template test asserts `deepEqual(staleOverrides, [])` |
| AC-5: byte-identical override suppressed | Pass | `overrideContent === newTemplateContent` check at `upgrade.ts:144`; suppress-identical test asserts empty |
| AC-6: `--check` parity — computes from `wouldUpgrade`, dry-run unaffected | Pass | `getStaleOverrides(cwd, clean)` runs before the `options.check` branch; `clean[]` in check mode contains the would-write ops; check-mode return carries `staleOverrides`; --check test asserts override listed and file unwritten |
| AC-7: dirty-refusal → no nudge when template itself is dirty | Pass | Dirty template goes to `dirty[]`, not `clean[]`, so `changedByRel` never contains it; dirty-refusal return carries `staleOverrides` computed from empty `clean[]`; dirty-refusal test asserts `deepEqual(staleOverrides, [])` |
| AC-8: no behavior change — no exit-code impact from non-empty `staleOverrides` | Pass | `upgradeCmd()` calls `process.exit(2)` in refusal path before reading `staleOverrides`; apply-mode staleOverrides does not reach any exit path; existing dirty-refusal exit-2 coverage unmodified |
| AC-9: output helper prints reminder, each entry, and per-file diff command | Pass | `printStaleOverrideNudge` at `upgrade.ts:107-117` emits "NOT updated automatically", each `overridePath`, and `diff .canon/templates/<name> <overridePath>`; called in both check and apply branches; output test asserts all three elements present and empty-list is silent |
| AC-10: absent/stray override root handled without throw | Pass | `existsSync(overridePathAbs)` guard at `upgrade.ts:141`; loop is over CANON_OWNED basenames (not `readdir`), so absent root and stray files produce no entries and no throw |
| AC-11: `.canon/README.md` updated to describe automatic heads-up; mirror in sync | Pass | Root README lines 20-23 updated; `templates/.canon/README.md` mirror matches; `sync-templates:check` reports Pass |
| AC-12: override root resolved through `taskTemplateOverrideRoot()`, honors `CANON_TASKS_DIR_OVERRIDE` | Pass | `resolve(cwd, taskTemplateOverrideRoot())` at `upgrade.ts:132`; `path.resolve` (not `path.join`) so absolute `CANON_TASKS_DIR_OVERRIDE` honored verbatim; `CANON_TASKS_DIR_OVERRIDE` test verifies custom path listed and default path excluded; env var saved/restored in `finally` |

### Dropped Sections Check

- [x] Non-goals respected — no override files written, moved, or staged; write/refusal/exit behavior unchanged
- [x] Known Risks addressed — all five risk items have corresponding ACs with tests; `--force` / `--no-stage` semantics unchanged
- [x] Human Test Plan is satisfiable — apply and dry-run flows both implemented; manual diff step preserved in README

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is compact, follows the `cutoverWarnings` precedent faithfully, and covers every AC with well-structured tests. One spec gap surfaced across both lenses: the `--force` + dirty template scenario is unaddressed by the spec and the implementation silently omits the nudge in that case despite the template being written. All other findings are optional nits.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **optional nit** (`upgrade.ts:109`, flagged by both lenses): Nudge header reads "overrides that were updated this run differ from canon templates" — but the overrides were **not** updated; the canon templates were. Clearer: "canon templates updated this run have customized overrides that were not auto-synced" or the spec's own phrasing: "task-template overrides differ from a canon template changed by that upgrade." No behavior impact.

- **optional nit** (`upgrade.ts:146`, cold lens): The fallback `relative(cwd, overridePathAbs) || overridePathAbs` is dead code — `overridePathAbs` is always a file path (a basename appended to a directory), so `relative()` never returns `''` for this input. Harmless safety guard, no action required.

#### Spec Gaps

- **spec-gap** (`upgrade.ts:127-150` / `upgrade.ts:368-375`, flagged by both lenses): **`--force` + dirty template → nudge silently absent despite template being written.**

  The spec's Decision section states: "The nudge fires **only** when this upgrade actually touched that template." When `--force` is passed and `.canon/templates/<name>` is dirty, `runUpgrade()` writes it (via `toWrite = options.force ? pending : clean`) and adds it to `upgraded[]`. But `getStaleOverrides(cwd, clean)` is called before the write loop and uses `clean[]` only — dirty-but-force-written templates are never in `changedByRel`. A stale override in this scenario gets no nudge even though the template changed.

  The spec's AC-7 explicitly scopes the no-nudge guarantee to "dirty and the run **refuses** without `--force`." It does not address the `--force` write-despite-dirty case, and the Known Risks do not mention it. The fix (e.g. `options.force ? pending : clean` in the `getStaleOverrides` call, or computing after the write loop) requires a human decision on the intended behavior — the Non-Goals say not to change `--force` semantics, but this is nudge behavior, not write behavior. Human amendment needed before re-routing to implement.

### Dismissed Cold Findings

- **Dismissed (cold):** "dirty-refusal with clean template and non-template dirty files produces non-empty `staleOverrides` but `upgradeCmd` exits before printing it." — Spec says nudge fires "in both apply mode and `--check` mode" (AC-9); dirty-refusal is neither; the spec is intentionally silent on this path. Behavior is reasonable (refusal output dominates) and not required by any AC.

- **Dismissed (cold):** "No test for clean-template + non-template-dirty scenario." — Corresponds to the dismissed finding above; not an AC requirement.

- **Dismissed (anchored):** Windows path separator in test assertion (`cli.test.ts:1278`). Platform not in scope; very low confidence.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration
- [x] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Spec gap summary:** The spec is silent on whether the nudge should fire when `--force` writes a dirty canon template that has a stale override. The implementation consistently uses `clean[]` (correct for the refusal case per AC-7), but this means `--force` can write a template while its stale override goes unmentioned. Human amendment needed: either confirm the no-nudge behavior for force-dirty writes (and add a Known Risks entry), or extend the changed set to `options.force ? pending : clean` and add a corresponding AC + test.

---

<!--
On re-review, append below this line:
-->

## Round 2 — Reviewing post-amendment implementation

> Spec was amended to add AC-13 (`--force` + dirty template → nudge fires) and refine AC-9 wording (Amendment D). This is the first review of the implementation produced after the amendment.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `UpgradeResult` gains `staleOverrides: string[]` at all three return points | Met | All three `return` statements in `runUpgrade()` carry the field; `tsc` passes per handoff. |
| AC-2: checked basename set equals `CANON_OWNED` task-template basenames | Met | `getTaskTemplateBasenames()` derives from `CANON_OWNED`; drift-guard test at `cli.test.ts:1074-1083` asserts equality. |
| AC-3: differing override listed when template in changed set | Met (for clean path) | Positive test passes for the clean/no-force case. See AC-13 for force-write gap. |
| AC-4: unchanged template does not nudge | Met | |
| AC-5: byte-identical override suppressed | Met | |
| AC-6: `--check` parity | Met | |
| AC-7: dirty-refusal (no `--force`) → no nudge | Met | Dirty template in `dirty[]`, not `clean[]`; `staleOverrides` empty; test asserts it. |
| AC-8: no exit-code change | Met | |
| AC-9: output — per-entry paths, diff commands, correct wording | **Not Met** | The nudge header at `upgrade.ts:109` reads "task-template overrides **that were updated this run** differ from canon templates" — this implies the *overrides* were updated, which Amendment D explicitly forbids. Required wording: "canon templates changed by this upgrade have customized overrides that were not auto-updated" (or equivalent). The AC-9 output test at `cli.test.ts:1283` only checks for the substring `"would be"`, which happens to match the flawed header, so the test does not catch the wording violation. |
| AC-10: absent/stray override root — no throw | Met | |
| AC-11: `.canon/README.md` updated; mirror in sync | Met | |
| AC-12: `taskTemplateOverrideRoot()` resolver used; `CANON_TASKS_DIR_OVERRIDE` honored | Met | |
| AC-13: `--force` + dirty template → nudge fires | **Not Met** | **Implementation bug + missing test.** `getStaleOverrides(cwd, clean)` at `upgrade.ts:375` passes only the `clean` slice. When `--force` is set, dirty template ops land in `dirty[]` (not `clean[]`), so `getStaleOverrides` never sees them. Yet `toWrite = options.force ? pending : clean` writes them and they appear in `upgraded`. A stale override of a dirty-force-written template is therefore never listed in `staleOverrides`. The Amendment §A mechanics note states explicitly: "pass `options.force ? pending : clean` rather than `clean` alone." That fix was not applied. No test for this path exists in the suite. |

### Stage 1 Verdict

**FAIL** — two ACs not met (AC-9 wording, AC-13 implementation + test).

Stage 2 not run.

### Findings

#### code-bug: AC-13 — `--force` + dirty template silently omits nudge for stale override
*Flagged by both lenses.*

`src/cli/commands/upgrade.ts:375`:
```ts
const staleOverrides = getStaleOverrides(cwd, clean);
```

`clean[]` contains only non-dirty ops. When `--force` is active, the write loop uses `toWrite = options.force ? pending : clean` (line ~393), writing dirty templates and adding them to `upgraded`. But `getStaleOverrides` was already called with `clean` only, so those templates are absent from `changedByRel` and their stale overrides get no nudge — a silent miss in the exact scenario (power-user `--force` run with in-flight customizations) where the nudge matters most.

**Fix** (per Amendment §A mechanics note): change line 375 to:
```ts
const staleOverrides = getStaleOverrides(cwd, options.force ? pending : clean);
```

Also add the AC-13 test: call `runUpgrade(projectDir, pkgDir, { force: true })` with a dirty canon template path and a differing override, assert the override path appears in `staleOverrides` and the template path appears in `upgraded`.

#### code-bug: AC-9 Amendment D — nudge header implies overrides were updated when they were not
*Flagged by both lenses.*

`src/cli/commands/upgrade.ts:109`:
```ts
console.log(`Heads-up: task-template overrides ${check ? 'that would be' : 'that were'} updated this run differ from canon templates:`);
```

In apply mode this reads "task-template overrides **that were updated** this run differ from canon templates" — the overrides were NOT updated; the canon templates were. Amendment D requires wording that makes clear the canon templates changed and the overrides were not auto-synced. Suggested: "canon templates changed by this upgrade have customized overrides that were not auto-updated:" (or the spec's own phrasing). The AC-9 test must also be updated to assert the corrected header text rather than just the `"would be"` / `"were"` substring that currently lets the bad wording pass.

### Dismissed Cold Findings

- **Dismissed (cold)**: `taskTemplateOverrideRoot()` uses `process.cwd()` implicitly rather than taking a `cwd` parameter — interface fragility concern. The function is shared with `canon task new` (same pre-existing design); `upgrade.ts` already applies `resolve(cwd, taskTemplateOverrideRoot())` to anchor the relative result. Not a current bug and outside this task's scope.

- **Dismissed (cold)**: Dead-code `|| overridePathAbs` at `upgrade.ts:146` — unreachable since `relative()` never returns `''` for a file path. Noted as optional/non-blocking in Amendment E. Retain or drop — not blocking.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Needs re-review
- [ ] Spec gap

## Round 3 — Verifying iteration 2's response to round 2

> Iteration 2 addressed both round-2 code-bugs: AC-13 force-path fix and AC-9 wording fix. Both lenses re-run from scratch.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `staleOverrides: string[]` at all three return points | Met | Unchanged from round 2; all three returns carry the field. |
| AC-2: basename set = CANON_OWNED task-template entries | Met | Unchanged. |
| AC-3: differing override listed when template in changed set | Met | Positive test; `reportedWrites = clean` for clean apply path. |
| AC-4: unchanged template does not nudge | Met | |
| AC-5: byte-identical override suppressed | Met | |
| AC-6: `--check` parity | Met | `reportedWrites = clean` for `--check` path; dry-run preserved. |
| AC-7: dirty-refusal (no `--force`) → dirty template's override not listed | Met | `reportedWrites = clean` for dirty-refusal; dirty template absent from `clean[]`; dirty-refusal test asserts `staleOverrides` empty (single-template setup). |
| AC-8: no exit-code change | Met | |
| AC-9: wording — canon templates framed as changed, overrides as not auto-updated | Met | Header: "Heads-up: canon templates changed by this upgrade have customized task-template overrides that were not auto-updated:" (apply); "...that would be changed...would not be auto-updated:" (check). Output test at `cli.test.ts` now uses `assert.equal` on the exact header text for both modes. Both lenses verified. |
| AC-10: absent/stray override root handled | Met | |
| AC-11: README updated; mirror in sync | Met | |
| AC-12: `taskTemplateOverrideRoot()` resolver; `CANON_TASKS_DIR_OVERRIDE` honored | Met | |
| AC-13: `--force` + dirty template → override listed | Met | `const reportedWrites = options.check ? clean : (options.force ? pending : clean)` at `upgrade.ts:375`. When `--force`: `reportedWrites = pending` → dirty template op is in `changedByRel` → stale override listed. AC-13 test at `cli.test.ts` seeds a dirty template (committed then dirtified), places a differing override, calls `runUpgrade({ force: true })`, asserts override in `staleOverrides` and template in `upgraded`. Both lenses verified. |

### Validation Gate

Iteration 2 re-ran all required checks:
- [x] `npm run lint` — Pass
- [x] `npm run type-check` — Pass
- [x] `npm test` — Pass (new AC-13 test and tightened header assertions pass)
- [x] `npm run build` — Pass

### Stage 1 Verdict

**PASS** — all 13 ACs met, validation clean.

### Stage 2 — Code Quality

#### Nits (both lenses)

- **optional nit** (`upgrade.ts:371-374`, both lenses): Block comment above `reportedWrites` still reads "Only clean writes count here: if the canon template itself is dirty and we refuse the run, it stays out of the changed set and therefore out of the nudge." Under `--force`, dirty writes DO count — the comment is now misleading. Should read something like: "Use `pending` when `--force` (dirty ops are written too); `clean` otherwise; always `clean` under `--check` (dry run never forces)." No behavior impact.

- **optional nit** (`upgrade.ts:127` parameter name, both lenses): `getStaleOverrides(cwd: string, clean: ReadonlyArray<WriteOp>)` — the parameter is still named `clean` but now receives `pending` (all ops including dirty) when `--force` is active. Renaming to `writes` or `changedOps` would match actual semantics. No behavior impact.

- **optional nit** (`upgrade.ts:146`, both lenses): Dead-code fallback `relative(cwd, overridePathAbs) || overridePathAbs` — `relative()` never returns `''` for a file path under `cwd`. Previously noted in Amendment E as non-blocking. No action required.

#### Latent observation (non-blocking, for human awareness)

The cold lens surfaced a theoretical inconsistency in the mixed dirty-refusal case: if ≥2 canon templates are pending (one dirty, one clean) and both have overrides, `reportedWrites = clean` in the dirty-refusal path means the clean template's stale override appears in the return value's `staleOverrides` even though nothing was written. Amendment §A's contract ("changed set iff in `upgraded`") implies `staleOverrides` should be empty when `upgraded = []`.

This is **not a blocking finding**:
- The CLI is correct: `process.exit(2)` fires before the nudge block, so no misleading output reaches the user.
- No explicit AC covers this mixed scenario; AC-7's test uses a single-template setup where `clean[]` is empty.
- The behavior is defensible (analogous to `--check`: showing what would be stale).
- Impact is limited to programmatic `runUpgrade()` callers in this specific mixed scenario.

Flagging for human awareness only. A follow-up task can choose to return `staleOverrides: []` in dirty-refusal or leave as-is with a clarifying comment.

### Dismissed Cold Findings

- **Dismissed (cold)**: Behavioral asymmetry — dirty-refusal CLI exits before printing nudge while `--check` shows it. Intentional per AC-9 scope: nudge fires in "apply mode and `--check` mode"; dirty-refusal is neither.
- **Dismissed (cold)**: Test gap for mixed dirty-refusal — flows from the latent observation above; not required by any AC; not blocking.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review
- [ ] Spec gap

---

## Round 4 — Verifying iteration 3's response to Amendment Round 2

> Iteration 3 addressed AC-14 (dirty-refusal mixed-case returns `staleOverrides: []`) and the three round-3 nits (comment fix, parameter rename, dead-code removal). Both lenses re-run from scratch.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 through AC-13 | Met (carried forward) | All confirmed in round 3; iteration 3 made no changes to the AC-1–13 code paths. |
| AC-14: dirty-refusal returns `staleOverrides: []` even with a clean would-change template | Met | `upgrade.ts:383` returns `staleOverrides: []` on the `dirty.length > 0 && !options.force` path; the staleOverrides computation moved entirely below this branch at `upgrade.ts:391`; mixed dirty-refusal regression test at `tests/cli.test.ts:1201-1231` seeds a clean `spec.md` would-change (with a differing override) + a dirty `plan.md`, asserts `deepEqual(staleOverrides, [])` and `deepEqual(upgraded, [])`. |

**Nit cleanups (Amendment Round 2 §B — non-AC):**
1. Stale comment — Met: block comment at `upgrade.ts:386-389` now reads "Under --force that includes dirty writes; otherwise it's just the clean subset. If the run refused above, the changed set is empty and we returned staleOverrides: []." Accurately describes the actual behavior.
2. Parameter rename — Met: `getStaleOverrides` parameter renamed to `changedOps` at `upgrade.ts:127`.
3. Dead-code removal — Met: `|| overridePathAbs` fallback removed; sole push is `staleOverrides.push(relative(cwd, overridePathAbs))` at `upgrade.ts:146`.

### Validation Gate

Iteration 3 re-ran all required checks:
- [x] `npm run lint` — Pass
- [x] `npm run type-check` — Pass
- [x] `npm test` — Pass (new AC-14 mixed dirty-refusal test passes)
- [x] `npm run build` — Pass
- [x] `npm run docs-refs-check` — Pass

### Stage 1 Verdict

**PASS** — AC-14 met, all three nits addressed, validation clean.

### Stage 2 — Code Quality

#### Nits (both lenses)

- **optional nit** (`upgrade.ts:390,395`, both lenses): `reportedWrites` and `toWrite` are computed with identical expressions (`options.force ? pending : clean`). A single variable would remove the duplication. Keeping them separate is defensible (one names the nudge input, one names the write target), but the separation adds minor reader overhead. No behavior impact.

- **optional nit** (`upgrade.ts:371-372`, anchored lens): The `--check` block comment ("Dry-run: report what would change, including dirty conflicts.") does not mention the staleOverrides computation that now runs inside it, unlike the apply-path comment added in this iteration. Minor consistency gap with the new comment style.

### Dismissed Cold Findings

- **Dismissed (cold)**: `taskTemplateOverrideRoot()` uses `process.cwd()` internally, while the nudge resolves it with `resolve(cwd, ...)`. Pre-existing design; not introduced by this task. The spec explicitly documents `resolve(cwd, ...)` as the correct anchoring for the `cwd` argument. No regression.
- **Dismissed (cold)**: Under `--check`, dirty-template overrides are absent from `staleOverrides`. Intentional per AC-6 (`--check` computes from `wouldUpgrade`) and Amendment Round 2 AC-14 (scoped to apply-mode refusal only). The `--check` path shows overrides for clean would-upgrade templates, which is the correct and specified behavior.
- **Dismissed (cold)**: `diff .canon/templates/${name} ${overridePath}` uses relative paths. Pre-existing nudge-formatting design per AC-9; both paths are relative to the project root where `canon upgrade` runs.
- **Dismissed (cold)**: Duplicated `.canon/templates/` prefix string between `getTaskTemplateBasenames()` and `getStaleOverrides()`. Pre-existing from iterations 1-2; not introduced by iteration 3.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review
- [ ] Spec gap
