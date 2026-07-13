# Code Review: upgrade-destination-classification

> Reviewer: Claude | Spec: `tasks/upgrade-destination-classification/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results (lint / type-check / test / build / docs-refs-check all Pass)
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Foreman re-verified independently: `npm run type-check` exit 0; `tests/cli.test.ts` 163 pass / 0 fail; `dist/cli/index.js` rebuilds with zero drift (the handoff's `[scope]` blocker on the built bin is a non-issue — regenerating from the authorized source change is correct).

### Acceptance Criteria Check

Cross-reference **every** AC from the spec. Missing an AC from this table is itself a Stage 1 failure.

| AC | Status | Notes |
|---|---|---|
| AC-1 untracked sentinel (red-first) | Pass | Old `does NOT trigger refusal` test gone (grep rc=1); new sentinel test asserts `refusals.untrackedExisting` + `dirtyRefused` + `upgraded==[]` + sentinel bytes intact. |
| AC-2 forced git failure (red-first) | Pass | Non-git dir with existing non-identical target → `unverifiable`, nothing written. Fail-closed probe branch (upgrade.ts:204-209). |
| AC-3 absent under git failure | Pass | Non-git dir, no existing file → `absent` → scaffolds without `--force`. |
| AC-3b locally-deleted tracked (working-tree `rm`) | Pass | Existing deletion test retained; classifier checks `tracked.has(rel)` before `existsSync`. **See Stage 2 Finding 1: this holds only for `rm`, not staged `git rm`.** |
| AC-4 gitignored-existing | Pass (non-vacuous) | Fixture commits an ignore pattern and asserts `porcelain.stdout===''` before asserting `untrackedExisting`; classifier establishes trackedness via `ls-files`, not porcelain alone. |
| AC-5 `--force` overrides all classes | Pass | `--force` writes tracked-dirty, untracked-existing, and unverifiable scenarios. |
| AC-5b malformed `.gitignore` NOT force-overridable | Pass | Malformed path never enters `pending`; both plain and `--force` leave it reported-not-written. |
| AC-6 tracked-clean still writes | Pass | Committed unmodified divergent file overwrites on plain run. |
| AC-7 canon-identical without git | Pass | Byte-identical file in non-git dir reported unchanged; short-circuits before classification. |
| AC-8 `--check` parity | Pass (normalized) | Table-driven test covers all six classes; compares classified path sets across `wouldUpgrade`/`upgraded`/`unchanged`/refusal buckets. |
| AC-8b mixed pending all-or-nothing | Pass | Untracked refusal withholds an otherwise-writable target until a subsequent `--force` run writes both. |
| AC-9 per-class refusal messages | Pass | `printUpgradeRefusals()` emits three distinct class-specific remedies; asserted directly. |
| AC-10 design-comment replacement | Pass | `don't refuse on untracked` and `treat as clean` both grep rc=1; replacement docstring states the classification model + fail-closed polarity. |
| AC-11 README wording | Pass | README:235 row names locally-modified / untracked-but-present / git-unverifiable + `--force`; `docs-refs-check` passes. |
| AC-12 existing suite green + fixtures accounted | Pass | Suite green; 19 fixture repairs each justified in handoff (all convert non-git overwrite fixtures to tracked-clean, preserving original test intent). |
| AC-13 docs-refs-config scaffold source covered | Pass | Untracked non-identical `scripts/docs-refs-config.mjs` refuses as `untrackedExisting`. |

### Dropped Sections Check

- [x] Non-goals respected (no backup/diff feature, no adoption mode, no new flags, `strip-canon-block.mjs` untouched, no cwd change)
- [x] Known Risks addressed or documented as accepted (over-tightening guard rails AC-3/AC-6 hold; gitignored trap AC-4 non-vacuous; sixth write source AC-13 covered)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Every AC as written is met and non-vacuously tested. The correctness hole below is a class of deletion the ACs did not enumerate, not a failure of a written AC — hence Stage 1 passes and the finding lands in Stage 2.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-structured implementation of the classifier fix: a single write chokepoint (`writeFileSync`, upgrade.ts:502) fed by all six write sources through one shared `pending` → `classifyDestinations` gate; fail-closed polarity correct on both git probes (`rev-parse` and `ls-files`/`status`); per-class messaging factored into a tested `printUpgradeRefusals()`. The delicate-task guard audit found no bypass. One correctness gap in the classifier's handling of *staged* deletions defeats the exact invariant this task hardens and regresses `main`, which is the reason for the verdict.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

**Finding 1 — [code-bug, P2] `src/cli/commands/upgrade.ts:232-237` — staged deletion (`git rm`) of a tracked managed file is classified `absent` and silently recreated, bypassing the refusal net.** Source: cold-Claude (verified by foreman empirically + against spec).

The classifier checks `!tracked.has(rel)` (from `git ls-files`) *before* consulting the `dirty` set. `git rm <path>` removes the path from the index, so `git ls-files -- <path>` lists nothing, and the working-tree copy is gone — so the path lands in `existsSync(...) ? 'untracked-existing' : 'absent'` → **`absent`** → treated as clean → recreated (CANON_OWNED loop at :360-368 and header-only at :326-330 push missing files into `pending`; the write loop at :500-503 writes them). The `git status --porcelain` output *does* contain the `D  <path>` staged-deletion entry, but the `dirty` set is never consulted for a non-`ls-files` path.

Foreman verification (empirical, throwaway repo): after `git rm managed.txt`, `git ls-files -- managed.txt` → empty; `git status --porcelain -- managed.txt` → `D  managed.txt`; file absent on disk. → classified `absent` → written.

Why this is a code-bug and not a spec gap:
- The spec's Decision table defines **tracked-dirty** as "Tracked with staged/unstaged changes, **including local deletion**" → Refuse. A `git rm` is a *staged* deletion of a file that was tracked at HEAD — squarely inside that definition.
- The change contradicts the classifier's own docstring (upgrade.ts:189-191): "a locally deleted tracked file remains tracked-dirty instead of falling through to absent." That claim holds for working-tree `rm` only.
- It is a **regression from `main`**: the old `isPathDirty` saw `D ` (≠ `??`) and refused. This task is supposed to *tighten* the refusal net; here it loosens it.
- The two deletion forms get opposite treatment — `rm` (working-tree) refuses (AC-3b), `git rm` (staged) recreates — an inconsistency driven by an implementation artifact (whether `ls-files` still lists the path), not a meaningful distinction. AC-3b tested only `rm`, so the gap is untested.

Fix direction (clear from the spec, so this routes to implement, not human): a path absent from `ls-files` but present in `git status` as a staged deletion (`D` in the index column) must classify as `tracked-dirty`, not `absent`. Add a red-first test for the `git rm` case alongside the existing `rm` test.

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

**[nit → hardening] `src/cli/commands/upgrade.ts:465-467` — the `switch` `default` case fails OPEN (`clean` → written).** Source: cold-Claude (P3). Not reachable today (every `pending` rel is included in the `classifyDestinations` input, including `docsRefsConfigRel`), so not a live defect. But it is an inconsistent safety posture next to the deliberately fail-closed `unverifiable` handling: any future `pending` op pushed after the `classifyDestinations` call, or any unmapped class, would be silently written. Consider routing `default`/`undefined` to a refusal bucket so the fail-closed posture is total. Non-blocking.

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **`src/cli/commands/upgrade.ts:229` — porcelain path extraction via `line.slice(3)` does not handle C-quoted (non-ASCII, quote, control-char) or renamed paths.** Flagged by three lenses (anchored, cold-Codex, cold-Claude). **Not exploitable here** — every managed `rel` is a fixed ASCII, whitespace-free constant that git never quotes, and rename destinations under the pathspec-limited `git status -- <dest>` calls surface as `A <dest>` (not `R old -> new`), so `slice(3)` extracts them correctly (cold-Claude verified). Latent brittleness only; would matter if the managed set ever included paths needing quoting. If the implementer touches this file for Finding 1, hardening this (`-z` or `-c core.quotePath=false`) is cheap and welcome, but optional.
- **`src/cli/commands/upgrade.ts:436-439` — the `absent` and `!docsRefsConfigExists` branches push byte-identical ops** and read as redundant. They are **not** dead code: branch 2 is load-bearing — it guards branch 3's `readFileSync(docsRefsConfigPath)` against ENOENT on a locally-deleted-but-tracked config (exercised at tests/cli.test.ts:1830). A one-line comment ("branch 2 keeps the else-branch readFileSync from crashing on a locally-deleted tracked config") would stop a future refactor from collapsing them wrongly.
- **`src/cli/commands/upgrade.ts:475-481` — `canon upgrade --check --force` labels refused paths "Would refuse"** even though a real `--force` run would write them. Pre-existing pattern (the old `dirtyRefused` reporting had the same asymmetry); minor UX inaccuracy. Cold-Claude (P3).
- **`tests/cli.test.ts` non-git cases depend on the OS temp dir not being inside a git worktree.** Cold-Claude (P3, test-robustness). The `unverifiable`/`absent` assertions only hold if `git rev-parse --is-inside-work-tree` fails in the temp dir; if `TMPDIR` is redirected under a git repo these tests silently exercise a different path. Unlikely on default macOS/Linux temp dirs; the tests never assert the dir is non-git. Not vacuous or wrong — just environmentally fragile.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong. If a surviving finding's root cause is the spec rather than the code, the final verdict is `spec_gap`.

**Finding 2 — [spec-gap, P3, low severity] `src/cli/commands/upgrade.ts:440-444` — a tracked-dirty-but-present `scripts/docs-refs-config.mjs` aborts the entire upgrade run.** Source: anchored (cold-Claude examined the same block and rated it clean for the tracked-clean case; only the tracked-*dirty* sub-case is at issue). An adopter who committed a customized docs-refs-config, then made an uncommitted edit, and runs `canon upgrade` for unrelated skill updates gets the whole run refused (exit 2) naming their own adopter-owned config as "tracked and locally modified" — even though canon would silently leave that file alone if it were committed (the `!== 'tracked-clean'` guard one line up). On `main` this scenario was a no-op. Data is safe (git-restorable), so this is not a correctness bug; it is a spec silence — AC-13 mandated only the *untracked-existing* config refusal, and the spec's "existing config remains adopter-owned" note did not resolve the tracked-dirty-present sub-case. It does not independently drive the verdict (Finding 1 already routes this back to implement), but the implementer/human should decide the intended polarity: leave an adopter-owned dirty config alone (as `main` did) vs. nudge "commit your config." Note this shares a root theme with Finding 1 — the classifier's treatment of dirty/deleted states across write sources deserves one consistent rule.

### Dismissed Cold Findings

> Cold-lens findings dropped after verification.

- **Dismissed (cold-Codex): "porcelain `line.slice(3)` lets a tracked-dirty file be overwritten without `--force`" (claimed P2).** The stated failure *direction* is inverted. `git ls-files` C-quotes special-char paths identically to `git status --porcelain`, so a path git would quote appears quoted in *both* outputs and fails `tracked.has(rel)` against the raw `rel` → it classifies as `untracked-existing` (**refuse — fail-safe**), never `tracked-clean` (overwrite). To reach `tracked-clean` via mis-parse you would need `ls-files` to emit the raw form while `status` emits a differing form — which does not happen (consistent quoting). Additionally the managed-target set is a fixed internal ASCII/whitespace-free constant set that git never quotes, so the trigger cannot occur in practice. The underlying brittleness is retained as a non-blocking nit above (flagged by three lenses, agreed non-exploitable). Not a correctness defect.
- **Dismissed (cold-Claude): "an untracked-existing / unverifiable path refuses the ENTIRE run, withholding otherwise-writable targets" (P3 design note).** This is intended and explicitly specified/tested: spec Decision — "Refusal remains all-or-nothing (one refused target aborts all writes, exit code 2)" — and AC-8b — "mixed pending set — all-or-nothing withholds the writable target too." Spec evidence cited; not dismissed for being off-AC.
- **Cold-Claude rename-parsing check** self-cleared (the lens verified pathspec-limited `git status -- <dest>` reports a rename destination as `A <dest>`, so `slice(3)` is correct) — no finding to carry.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

**Rationale:** Finding 1 is a verified correctness bug (staged `git rm` deletion silently recreated, defeating the tracked-dirty refusal this task builds and regressing `main`), with a fix direction the spec already settles — so route to implement, not human. Address Finding 1 (and add its red-first `git rm` test); consider Finding 2 and the `default`-fails-open hardening in the same pass. The nits are optional.

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

## Round 2 — verifying iteration 1's response to round 1

Synthesized from three fresh lenses (anchored Claude, cold-Claude, pre-obtained cold-Codex). All three signal **approve**. Both Round 1 blocking findings are fixed with non-vacuous red-first coverage; the residual items are all low-severity nits.

### Stage 1 — Acceptance Criteria Re-Check

**Validation gate:** Iteration 2 Validation Outcomes has no `Fail` (lint / type-check / build / docs-refs-check / `npm test` 952 pass, 1 skip, 0 fail). Foreman re-verified independently: `tsx --test tests/cli.test.ts` green (165 tests), `npm run type-check` clean, and `npm run build` yields **zero `dist/cli/index.js` drift** (committed bundle matches source).

| AC | Status | Evidence |
|---|---|---|
| AC-1 untracked sentinel | Met | Old `does NOT trigger refusal` gone (grep rc=1); new test asserts `refusals.untrackedExisting` + `dirtyRefused` + `upgraded==[]` + sentinel bytes intact. |
| AC-2 forced git-failure | Met | Non-git existing target → `refusals.unverifiable`, nothing written, clean `.gitignore` withheld. Fail-closed on both probes. |
| AC-3 absent under git-failure | Met | Non-git absent target scaffolds without `--force`. |
| AC-3b working-tree deletion (`rm`) | Met | Existing deletion test refuses via dirty-first + `tracked.has` before `existsSync`. |
| AC-3b staged deletion (`git rm`) | **Met (NEW — Round 1 code-bug closed)** | New red-first test: `git rm` → `refusals.trackedDirty`, file not recreated. Foreman-verified empirically: `git status -z -- rel` emits `D  rel`, and dirty-first classification (upgrade.ts:238-242) now yields `tracked-dirty`. |
| AC-4 gitignored-existing | Met (non-vacuous) | Fixture commits ignore pattern, asserts `porcelain.stdout===''` before asserting `untrackedExisting`; trackedness via `ls-files -z`. |
| AC-5 `--force` overrides all classes | Met | Force tests for tracked-dirty, untracked-existing, unverifiable. |
| AC-5b malformed `.gitignore` NOT force-overridable | Met | Malformed reported + not written under plain and `--force`; never enters `pending`. |
| AC-6 tracked-clean writes | Met | Committed divergent file overwrites on plain run. |
| AC-7 canon-identical without git | Met | Byte-identical file in non-git dir → `unchanged`, not refused. |
| AC-8 `--check` parity | Met | Table-driven over all six classes; classified sets match across `wouldUpgrade`/`upgraded`/`unchanged`/refusal buckets. |
| AC-8b mixed all-or-nothing | Met | Untracked refusal withholds tracked-clean target; both written on subsequent `--force`. |
| AC-9 per-class messages | Met | `printUpgradeRefusals()` emits three distinct class-specific remedies; asserted directly. |
| AC-10 design-comment replacement | Met | Both forbidden phrases grep rc=1; docstring states classification model + fail-closed polarity. |
| AC-11 README wording | Met | README row names locally-modified / untracked-but-present / git-unverifiable + `--force`; docs-refs-check passes. |
| AC-12 suite green + fixtures justified | Met | Suite green; 19 fixture repairs enumerated and justified. |
| AC-13 docs-refs-config scaffold source | Met | Untracked non-identical config → `untrackedExisting`; locally-deleted config refused; **tracked-dirty-present config now left adopter-owned (NEW test)**. |

**Stage 1 verdict: Pass.** No AC regressed; the two new deletion/ownership cases are covered.

### Verifying Round 1 findings

- _correctness bug (Finding 1):_ staged `git rm` classified `absent` and silently recreated → **ADDRESSED.** Classifier now checks `dirty.has(rel)` first (upgrade.ts:238-242), parses NUL-delimited `git ls-files -z` + `git status --porcelain=v1 -z`, and skips the origPath token on `R`/`C` entries. Red-first test added. Empirically confirmed by foreman.
- _spec-gap (Finding 2):_ tracked-dirty-present docs-refs-config aborted the whole run → **ADDRESSED.** The config `else` branch now queues only `untracked-existing`/`unverifiable` (upgrade.ts:452-459); tracked-dirty and tracked-clean present configs are left adopter-owned. New test confirms an unrelated skill still upgrades while the dirty config is untouched. The implementer chose the "leave adopter-owned config alone" polarity (matching `main`) rather than the "commit your config" nudge — a reasonable resolution of the Round 1 spec silence.
- _nit — `switch` default fails open_ → **ADDRESSED.** `default` now routes to `unverifiableOps` (fail-closed); `absent`/`tracked-clean` are explicit clean cases.
- _nit — porcelain newline/`slice(3)` brittleness_ → **ADDRESSED.** Now `-z` NUL-delimited parsing for both git calls.
- _nit — redundant docs-refs branch needs a comment_ → **ADDRESSED.** Comment added at upgrade.ts:449-450.

### Stage 2 — New / residual findings (all low; none blocking)

- **[nit] `src/cli/commands/upgrade.ts:247` — dead ternary.** Flagged by anchored + cold-Claude (high confidence). `dirty.has(rel) ? 'tracked-dirty' : 'tracked-clean'` is reached only after the `if (dirty.has(rel)) { … continue; }` at :239, so it always resolves to `'tracked-clean'`; the `'tracked-dirty'` arm is unreachable. Harmless but misleading — simplify to the literal.
- **[nit] `src/cli/commands/upgrade.ts:229-236` — rename-source of a managed→managed staged rename can classify as `absent`.** Flagged by anchored + cold-Claude (low severity, medium confidence on mechanism). The `-z` rename entry is `R  <dest>\0<source>\0` (foreman-verified); the loop adds only `<dest>` to `dirty` and `i += 1` skips `<source>`. If a managed path is the *source* of a rename whose *destination is also a managed path*, the source falls to `!tracked` + `!existsSync` → `absent`. **Practically unreachable and safe:** (a) the realistic single-endpoint rename (managed ↔ non-managed) degrades under the batched pathspec to a plain `D`/`A` that dirty-first catches (foreman-verified: `git status -z -- <managed-source>` reports `D  <source>`); (b) on the non-`--force` path the managed *destination* is itself dirty → all-or-nothing refuses the whole run, so the source scaffold never fires — effectively self-defeating; (c) content is git-restorable. Worth a `git rm`-style guard if the classifier is touched again, but does not block. The `i += 1` skip itself is correct for the format.
- **[nit] `src/cli/commands/upgrade.ts:453` — unguarded `readFileSync(docsRefsConfigPath)` throws EISDIR if that path is a directory.** Flagged by cold-Codex + anchored + cold-Claude (low severity). `existsSync` returns true for a directory, so a malformed checkout with a directory (or symlink-to-dir) at `scripts/docs-refs-config.mjs` crashes rather than refusing. **Consistent with the existing idiom** — the same unguarded `existsSync`-then-`readFileSync(projectPath)` pattern already exists in the delimited (:294), header-only (:333), CANON_OWNED (:361), `.canon/version` (:405), and `.gitignore` (:415) reads, all of which crash on a directory-at-managed-path; the whole command assumes managed paths are regular files. Exotic trigger, not a novel class of fragility. If hardened, harden all read sites (or none) for consistency — a separate cleanup, not this task.
- **[nit, test-robustness] `tests/cli.test.ts` non-git cases depend on the OS temp dir not being inside a git worktree.** Flagged by anchored + cold-Claude. The `unverifiable`/`absent` assertions hold only if `git rev-parse --is-inside-work-tree` fails in the temp dir; a `TMPDIR` redirected under a git repo would silently exercise a different path. Pre-existing (carried from Round 1), holds on default macOS/Linux/CI temp dirs, and not vacuous. Optional: assert the fixture dir is non-git.

### Dismissed Cold Findings (Round 2)

- **Dismissed (cold-Claude): "`cutoverWarnings` can fire without a corresponding overwrite" (upgrade.ts:397-410, low confidence).** Pre-existing and unchanged by this task — `isPreSplitDocsRefs` and the `cutoverWarnings.push` are context lines, not diff hunks. The checker template ships in practice (canon-owned), so the warning-without-overwrite path is not exercised. Cosmetic, out of this task's scope, low confidence. Not carried.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

**Rationale:** Both Round 1 blocking findings (the staged-`git rm` correctness bug and the tracked-dirty-present docs-refs-config spec-gap) are genuinely fixed with non-vacuous red-first tests; all three Round 1 nits are addressed; every AC is Met and non-vacuously tested; build is clean with zero dist drift; suite green; and all three lenses independently signal approve. The only residual items are low-severity nits — a dead ternary, a practically-unreachable-and-git-restorable rename-source edge, an EISDIR sharp edge consistent with five sibling reads, and pre-existing test-env fragility. None represents incorrect behavior under any realistic input, so none blocks. Ships as-is; the dead ternary and a rename-source guard are cheap tidy-ups if the classifier is revisited. Proportionality note: after two clean rounds, routing back into another implement loop for a self-defeating, git-restorable edge would exceed the blast radius.
