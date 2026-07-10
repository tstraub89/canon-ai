# Code Review: ship-shared-doc-dirt-preservation

> Reviewer: Claude | Spec: `tasks/ship-shared-doc-dirt-preservation/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review of the Round-2-amended implementation — the porcelain-first classifier that closes the prior cycle's SG-1). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

The anchored lens re-verified the gate state (not just read the handoff): `main.ts`, `validation.ts`, and all three test files have zero working-tree drift vs HEAD, so the `main...HEAD` diff faithfully represents the reviewed code, and the ship+validation+safety suites (330 tests) pass locally. Handoff Validation Outcomes records `lint`, `type-check`, `test` (939: 938 pass / 1 skipped), `build` (`dist/scripts/run-task.js` rebuilt, `dist/cli/index.js` byte-identical), `docs-refs-check`, `sync-templates:check` all `Pass`, no `Fail`.

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

Cross-reference **every** AC from the spec (AC-1..AC-11 plus Amendment Round 1 A1..A6 and Amendment Round 2 A7..A11). Each AC below is met **as written**. The prior cycle's SG-1 (staged-only shared-doc edit classified `clean` and swept into the archive commit) is **closed** by the Round-2 porcelain-first classifier: a staged-only edit's code is `'M '` (≠ `' M'`) and a working-tree deletion's is `' D'`, both of which now abort. The surviving findings are residual, low-severity edges — see Stage 2.

| AC | Status | Notes |
|---|---|---|
| AC-1 (replacement, same site) | Pass | `grep presentSharedDocs scripts/run-task/main.ts` → none; `classifyAndPreserveSharedDocDirt()` called at the same pre-switch, worktree-guarded site (`main.ts:2139-2141`). Remaining `checkout HEAD --` uses are the telemetry-only revert (`main.ts:1997`) and the untouched `orphanedStatusPaths` block (`main.ts:2147`) — no managed-doc checkout path. |
| AC-2 (red-first, incident file survives uncommitted) | Pass | Ship test appends to `docs/pipeline-invocations.md`, asserts ship succeeds, suffix present as ` M` uncommitted after archive, absent from `HEAD:` blob. Red on pre-fix blanket discard. |
| AC-3 (mixed dirt, abort before mutation) | Pass | Mixed telemetry + dirty `docs/patterns.md`: non-zero exit, no `pr merge` in gh log, both files byte-identical, zero backup entries — two-phase classify (`main.ts:1983-1987`) runs before any `mkdtemp`/checkout. |
| AC-4 (managed abort, `--force` no bypass) | Pass | Loops `force=false/true`; both abort, name `docs/patterns.md`, "commit or stash", no `pr merge`, bytes preserved. No `--force` check in the helper. |
| AC-5 (non-pure-append abort) | Pass | Modified-line telemetry aborts "not a pure append", no merge, bytes untouched. |
| AC-6 (fail closed on unreadable HEAD) | Pass | Untracked telemetry → porcelain `??` branch aborts before any content read or discard. |
| AC-7 (crash safety through staging, amended by A6) | Pass | Backup written + path logged (`main.ts:1995-1996`) before revert; deleted only after re-append (`main.ts:2308`); happy-path test asserts backup absent post-ship. |
| AC-8 (pure logic seam) | Pass | `classifySharedDocDirtFromData(docClass, porcelainCode, headContent, workingContent)` / `classifySharedDocSetFromData` / `buildSharedDocAbortMessage` side-effect-free in `validation.ts`; unit rows cover the porcelain gate + content cases. |
| AC-9 (clean-path regression) | Pass | Absent-from-porcelain / content-identical → `clean`, no abort; full suite green. |
| AC-10 (docs) | Pass | `docs/pipeline-orchestrator.md` + template mirror document the gate and the corrected "after archive staging, before commit/push" 9-step run order; no unconditional-discard wording remains. |
| AC-11 (archive-staged telemetry preserved, not absorbed) | Pass | Committed blob carries the ref-rewrite and excludes the suffix; working copy includes it (` M`). Red on pre-fix and on any re-append-before-`stageArchiveChanges` — pins the insertion point (`main.ts:2301` stage → `2306-2310` re-append → `2312` commit). |
| A1 (named seam, re-append inside it) | Pass | `stageArchiveChanges(stagedPaths)` is the `git add -A` loop only; `commitArchiveChanges(taskIds, baseBranch)` drops `stagedPaths` and keeps cached-diff/commit/push. Call site order: stage → re-append+rm backup → commit. `tests/run-task-safety.test.ts` updated to the two-call form. |
| A2 (commit-failure preserves telemetry) | Pass | Integration test forces archive `git commit` failure; suffix already back in the working tree at non-zero exit. Red on pre-amendment. |
| A3 (push-failure preserves telemetry) | Pass | Same shape, forces archive `push` failure; suffix present in the working tree. |
| A4 (no double-restore, no dup) | Pass | AC-2/AC-3/AC-11/A2/A3 fixtures pass unmodified under the porcelain-gated ordering. |
| A5 (Known Risks rewritten in place) | Pass | Spec Known Risks carries "Crash window, narrowed to staging" + the rejected git-plumbing alternative. |
| A6 (supersedes AC-7 backup lifetime) | Pass | Re-append sits between staging and commit; commit/push failure is covered by the working tree (A2/A3), not the backup. No prose claims backup survives commit/push failure. |
| A7 (staged-only managed-doc edit aborts) | Pass | Ship test stages `docs/patterns.md`, resets working copy to HEAD → porcelain `MM`/`M ` (≠ ` M`) → aborts pre-merge, staged diff intact. Red on pre-Round-2 code (classified `clean`, committed). |
| A8 (staged-only telemetry edit aborts) | Pass | Same staged-only shape on `docs/pipeline-invocations.md` → fail-closed abort pre-merge. |
| A9 (working-tree deletion aborts) | Pass | `rm docs/decisions.md` → porcelain ` D` → aborts pre-merge naming the file. Red on the `fs.existsSync` present-filter skip. |
| A10 (porcelain code seam, unit-tested) | Pass | Unit rows cover `null`, ` M` (preserve + abort-on-non-append, both docClasses), `A `, `M `, `D `, ` D`, `R `, `??`, `MM`, and the HEAD-read-failure defensive fallback. |
| A11 (Known Risks / Design describe git-status detection) | Pass | Spec Design + Known Risks describe the batched `git status --porcelain` call and porcelain-first-then-content order. |

### Dropped Sections Check

- [x] Non-goals respected (`orphanedStatusPaths` block untouched at `main.ts:2143-2148`; no telemetry-write relocation; no `--pr`/`--push` change)
- [x] Known Risks addressed or documented as accepted (re-append insertion point pinned by AC-11/A2/A3; crash window narrowed to staging per A6; no-dedup assumption documented)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2 (every written AC is met, including the Round-2 A7..A11 that close the prior SG-1)
- [ ] **Fail** — skip Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The Round-2 amended design is a faithful, well-structured realization of the spec. Classification is now git-status-derived (batched `git status --porcelain=v1`), gated to the single safe shape (`' M'`) before any content comparison, two-phase (abort-wins before any `mkdtemp`/revert), fail-closed on unreadable/non-append/staged/deleted/renamed states, `--force`-non-bypassing, and the load-bearing re-append sits strictly between `stageArchiveChanges()` and `commitArchiveChanges()` (AC-11/A2/A3-pinned). The prior cycle's SG-1 (staged-only edit → `clean` → committed to base) and its deletion/rename facet are both closed and regression-tested (A7/A8/A9).

All three lenses converged on two residual edges around the `' M'` clean fast-path and the `HEAD:` snapshot. Both are real but **low-severity with no data-loss path**, and both are consistent with the spec as written — the spec's model assumes `' M'` implies a content difference and assumes REPO_ROOT is on base. They are surfaced as the top two nits (N1, N2) rather than as blocking findings; each carries a small, concrete hardening for a fast-follow or a Non-Goal callout. No correctness bug or test-integrity issue survived adjudication. Verdict: **approved with nits**.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none blocking — see N1/N2, which are residual fail-open/base-snapshot edges with no data-loss path)

#### Optional Cleanup / Nit

- **N1 — A mode-only `' M'` (content == HEAD) is classified `clean`, bypassing the fail-closed managed-doc gate** `scripts/run-task/validation.ts:~1608` (`workingContent === headContent → clean`), reached from `main.ts:1972-1980` — *flagged by all three lenses (cold-Codex "P2", anchored, cold-Claude); foreman-verified*. `git status` reports `chmod`-only changes as ` M` with byte-identical content, so the content-equality clean branch returns `clean` for a genuinely git-dirty file. Consequence: a mode-only-dirty **managed** doc skips the abort, and for `docs/lessons-learned.md`/`docs/task-quality-log.md` the mode change is staged by `stageArchiveChanges`'s `git add -A` into the pushed `chore: archive` commit. This is a **fail-open** on the "fail closed on managed-doc dirt" guarantee and a residual of the same class the Round-2 fix targeted — but its **only** trigger is `chmod` on a markdown doc (no real operator workflow), the leaked artifact is a mode bit (cosmetic, visible in the archive diff, trivially reversible), and there is **no content/data loss**. Spec-consistent: the Round-2 seam text and the line-234 unit-row note both assume `' M'` implies a content difference ("identical content never produces a porcelain entry" — false for mode changes), so the spec never contemplated this sub-case. Hardening (one line): gate the `clean` fast-path on `porcelainCode === null` only, so a `' M'` with equal content aborts like any other unrecognized `' M'` state. Fast-follow or explicit Non-Goal — a human/spec call at `human_review`.
- **N2 — `HEAD:<path>` snapshot is taken before the base-branch switch; a non-base supervising checkout validates the suffix against the wrong blob** `scripts/run-task/main.ts:1973` (read) vs `2150-2160` (switch) — *flagged by all three lenses (cold-Codex "P2", anchored, cold-Claude); foreman-verified*. `classifyAndPreserveSharedDocDirt()` reads `git show HEAD:<path>` while REPO_ROOT is still on `currentBaseCheckout`. In the worktree-canonical model REPO_ROOT is on base, so `HEAD` == base and the extraction/revert/re-append is correct (the suffix is deliberately re-appended onto the post-merge/ref-rewritten body — AC-11's intended telemetry-append semantics, which the `startsWith` proof does not need to hold against). The only off-base path is a contrived mixed worktree/non-worktree bundle (a non-worktree task leaves REPO_ROOT on its task branch) or a manual non-base checkout; there the worst realistic outcome is a **fail-closed false-abort** (the working dirt's basis differs from `HEAD` → `startsWith` fails → friction, no loss) or a semantically-fine re-append. **No data-loss branch in any case.** Spec-consistent: the spec's Interaction Dependencies assume REPO_ROOT telemetry dirt is base-relative. Hardening: read `${baseBranch}:<path>` (or assert `getCurrentBranch() === baseBranch`) before classifying, so the snapshot is base-anchored regardless of the current checkout.
- **N3 — Leaked empty backup directory** `scripts/run-task/main.ts:1991,2308` — *cold-Claude, anchored*. `backupDir` from `fs.mkdtempSync` is never removed; the happy path deletes each backup *file* but leaves the empty `canon-ship-shared-doc-backup-XXXX` dir in `os.tmpdir()`, one per preserving ship. Cosmetic tmp litter; `rmSync(backupDir, { recursive: true, force: true })` after the re-append loop.
- **N4 — Misleading reason text on the defensive `workingContent === null` branch** `scripts/run-task/validation.ts:~1611` — *anchored, high confidence*. In the `' M'` path this branch says "present on disk but not readable **at HEAD** (untracked?)", but a null `workingContent` means the **working-copy** read failed, not the HEAD read. Only reachable defensively (`main.ts` always reads working content when the code is `' M'`, and `readFileSync` throws rather than returning null), so it is effectively dead/cosmetic. Reword to reference the working-copy read.
- **N5 — Unsafe-porcelain-code abort asserted only for the `telemetry` docClass** `tests/run-task-validation.test.ts:~274` — *anchored*. A10 states the abort holds for **both** classes; the code aborts before the `docClass` branch so behavior is identical, but the `managed` class is unasserted for unsafe codes. Add a `managed` row to lock it.
- **N6 — Preserve-path fixtures never exercise cross-content re-append** `tests/run-task-ship.test.ts` — *cold-Claude*. Every "preserve" fixture uses telemetry content the simulated squash merge does not modify, so the suffix is always re-appended onto the exact content it was diffed from; the base-advances-under-the-suffix and non-base-supervising-checkout paths (N2) are never covered. No assertion is vacuous, but a fixture that advances the base doc content would make N2's interaction observable to the suite.

#### Spec Gaps

> Root cause is the spec, not the code. Drives the `spec_gap` verdict.

(none blocking) — N1 and N2 are technically un-contemplated by the spec's classification/snapshot model, but both are low-severity edges with no data-loss path and near-zero reachability in a supported environment. They are dispositioned as nits with concrete hardening rather than as blocking spec gaps; the human can elect the fast-follow or a Non-Goal at `human_review`. This is deliberately distinct from the prior cycle's SG-1, which was a plausible-workflow (`git add` + botched reset) path that pushed real unreviewed **content** to base — that one correctly halted and is now closed.

### Dismissed Cold Findings

> Cold-lens findings dropped after verification.

- **Dismissed (cold-Claude): revert-now / re-append-later split strands telemetry in an orphaned backup on `die()` (rated medium/high, "changes_requested")** — `main.ts:1997` revert vs `2306` re-append, with `die()`s between (base-divergence, base checkout, merge/pull, merge-proof). **Spec-accepted with explicit evidence, and NOT cross-model** (cold-Codex did not flag it): Amendment A6 + AC-7 + Known Risks "Crash window, narrowed to staging" consciously accept this revert→staging window, keep the on-disk backup (path logged via `info()`) as the recovery layer, and explicitly reject the git-plumbing alternative that would close it as disproportionate for delicate ship code. The data is not destroyed — it persists in the backup. The residual UX improvement (echo the backup path in the relevant `die()` messages, since `die()` writes to stderr while the backup line is an earlier `info()` to stdout; add a fault-injection test) is worth a fast-follow but is within the spec's accepted design, so non-blocking.
- **Dismissed (cold-Claude): intra-loop partial revert (file 1 reverted, file 2 checkout fails, `die()` before re-append)** — same accepted window and same recovery channel as above; file 1's suffix is written to its backup *before* its checkout (`main.ts:1995-1997`), so it is recoverable exactly as the spec's crash-window design intends. Sub-case of the dismissed finding above, not a distinct defect.
- **Dismissed (cold-Claude): the `startsWith` proof "no longer holds at apply time" because the suffix is re-appended onto post-pull content** — this is the **intended** design, not a defect: AC-11 asserts the suffix is layered on top of the archived/ref-rewritten base content, and the sibling's append-only telemetry rows belong at the end of the (advanced) table regardless. The `startsWith` check proves the dirt is a safe trailing append to *extract*, measured against the checked-out `HEAD` the dirt sits on; it is not a claim that the apply-time body is byte-identical. The genuinely-wrong-base facet is the off-base snapshot, retained as N2.
- **Dismissed (cold-Codex P2 as stated — "recompute against the base branch snapshot"): treated as a correctness bug** — the mechanism is real but the impact is not "restore the wrong text" in the supported path (REPO_ROOT on base → `HEAD` == base). Cross-model agreement (cold-Codex + cold-Claude + anchored) is acknowledged and **retained** as N2 rather than dismissed, but re-ranked from a correctness bug to a no-data-loss hardening nit after tracing the order of operations (`main.ts:2140` classify → `2150` switch → `2193` merge/pull): the dominant path is unaffected and the off-base path fails closed.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** — root cause is the spec, not the code; halt for human instead of routing to implement

**Rationale:** Every written AC is met (AC-1..AC-11, A1..A11), and the Round-2 porcelain-first classifier correctly closes the prior cycle's SG-1 — a staged-only edit and a working-tree deletion/rename now fail closed, regression-tested by A7/A8/A9. The re-append is pinned strictly between `stageArchiveChanges()` and `commitArchiveChanges()` (AC-11/A2/A3), and the crash-window tradeoff is the spec's explicitly-accepted design. All three lenses converged on two residual edges — a mode-only `' M'` treated as `clean` (N1, fail-open but chmod-on-markdown-only, cosmetic) and a `HEAD:` snapshot that assumes REPO_ROOT is on base (N2, fail-closed or benign off-base) — both low-severity, both with no data-loss path, both spec-consistent. Neither rises to the plausible-workflow / real-content-to-base bar that made the prior SG-1 a halt; each carries a one-line/small hardening (gate the clean path on `porcelainCode === null`; read `${baseBranch}:<path>`) that the human can elect as a fast-follow or scope out as a Non-Goal at `human_review`. N3–N6 are cosmetic/test-coverage cleanups. Nothing blocks the ship.
