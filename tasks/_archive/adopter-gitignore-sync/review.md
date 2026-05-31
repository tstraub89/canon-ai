# Code Review: adopter-gitignore-sync

> Reviewer: Claude | Round: 1 | Spec: `tasks/adopter-gitignore-sync/spec.md`

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, tests, build, docs-refs-check, sync-templates:check). E2E is `not_configured` per spec (no UI).
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 (`upsertCanonBlock` pure helper, marker-line anchored, null on malformed, append when absent) | Pass | `src/lib/canon-block.ts:54-60` + helpers 22-46. Marker regex `/^[ \t]*# canon:start[ \t]*(?:\r?\n|$)/gm` is functionally equivalent to the spec regex — anchors on the full line, rejects substring matches and trailing-text. Module-level `g`-flag regex state is reset before each `exec` (line 23) so calls are independent. Pure, no I/O, never throws. |
| AC-2 (single source-of-truth constant) | Pass | `CANON_GITIGNORE_BLOCK` + `CANON_RUNTIME_GITIGNORE_PATTERNS` exported from `src/lib/canon-block.ts:4-15`. Imported by init, upgrade, doctor, sync `.mjs`, and tests — no duplicate definition. Block contains the marker lines, "managed by canon" comment, and exactly the three `tasks/**/…` patterns. |
| AC-3 (`canon init` explicit `.gitignore` handling) | Pass | `src/cli/commands/init.ts:62-70`. Reads existing → upserts → writes only if changed → warns and continues on malformed (`null`). Outside `scaffoldTemplates`'s skip-if-exists copy. Idempotent: a second `init` re-reads the just-written file, gets identical content from `upsertCanonBlock`, and skips the write. |
| AC-4 (`runUpgrade` enqueues into the existing `pending` queue) | Pass | `src/cli/commands/upgrade.ts:231-244`. Uses the same `WriteOp` shape as DELIMITED/CANON_OWNED/header-only. `.gitignore` flows through `isPathDirty` (line 257), `--check` (262-265), `--force`/dirty refusal (268-273), and `--no-stage` staging (362-367). Malformed populates the new `malformed` bucket and is **never** added to `pending`, so `--force` cannot override (verified at `tests/cli.test.ts:1083-1101`). No parallel `writeFileSync` outside the queue. |
| AC-5 (`checkRuntimeFilesGitignored` doctor check) | Pass | `src/cli/commands/doctor.ts:496-518`. Severity is `pass`/`warn` only (never `fail`). Line-trimmed match accepts patterns inside or outside the canon block. Registered in `doctorCmd` config-checks (line 638). |
| AC-6 (`templates/.gitignore` + root self-hosting) | Pass | `templates/.gitignore` is block-only (6 lines + trailing newline). Root `.gitignore` removes the prior standalone patterns + hand-added comment and contains the three patterns exactly once, inside the block (lines 21-26). Other root entries (`node_modules`, `*.log`, etc.) preserved. |
| AC-7 (sync script uses constant-source model) | Pass | `scripts/sync-canon-templates.mjs:6` imports the constant; dedicated step at lines 273-282 writes/verifies `templates/.gitignore` directly against `CANON_GITIGNORE_BLOCK`. Does **not** use `mergeDelimitedForSync` and does **not** add `.gitignore` to `DELIMITED_SYNC`. First-create handled (the `||` covers a missing target). |
| AC-8 (leak scan not false-positive on `.gitignore`) | Pass | Leak-scan loops iterate `WHOLESALE_SYNC` (line 293) and `DELIMITED_SYNC` (305), both of which exclude `.gitignore`. Inner `findCanonInternalRefs` is also gated to `.md` only. `sync-templates:check` is green. |
| AC-9 (`upsertCanonBlock` unit tests a–g) | Pass | All seven cases at `tests/cli.test.ts:119-165`: empty, append-preserving, replace (with CRLF surrounds), idempotency, near-marker mention, malformed → null, orphan end. |
| AC-10 (`checkRuntimeFilesGitignored` tests) | Pass | Three cases at `tests/cli.test.ts:506-534`: all-present pass, missing-`.gitignore` warn, missing-pattern warn naming the pattern. |
| AC-11 (`runUpgrade` `.gitignore` tests) | Pass | All five cases at `tests/cli.test.ts:1013-1102`: insert, unchanged, dirty refusal without `--force`, `--check` reports `wouldUpgrade`, malformed with `--force` re-asserted untouched. |
| AC-12 (`docs/codebase-map.md` pointer + adopter-facing note) | Pass | `docs/codebase-map.md:45` adds the row with all four touchpoints and the one-sentence adopter-facing note. No other docs touched (e.g., `docs/pipeline-orchestrator.md` correctly left alone). |
| AC-13 (sync-template tests extended) | Pass | `seedCanonFixture` seeds `templates/.gitignore` at `tests/sync-canon-templates.test.ts:59`. Three new tests at lines 189-220 exercise drift, clean, and first-create. Existing exact-drift-list assertions remain unmodified and pass. |
| AC-14 (root `.gitignore` self-hosting guard) | Pass (with documented deviation) | `tests/cli.test.ts:167-170` uses `extractCanonBlock` against the active checkout root. Deviation: reads from `WORKTREE_ROOT` (= `process.cwd()`) rather than `REPO_ROOT`. Rationale (per handoff) is correct: under linked-worktree runs `REPO_ROOT` resolves to the supervising checkout, not the worktree being validated; in non-worktree runs the two paths are identical. The guard still catches drift between the constant and whatever checkout the test runs in, which is the intent. |

### Dropped Sections Check

- [x] **Non-goals respected**: canon block contains only the three runtime patterns; `mergeDelimited` and the DELIMITED docs path are byte-for-byte unchanged; adopter content outside the block is preserved (verified by the replace-with-CRLF-surrounds test); no untracking automation; no `.gitignore`-specific flags; block placement is append-at-end.
- [x] **Known Risks addressed**: splice preservation tested (AC-9c). Marker collision rejected via line-anchor regex + AC-9e. Malformed fail-safe wired through helper → init warn → upgrade `malformed` bucket → `--force` does not override (AC-9f, AC-11e). Sync ordering OK (constant-source, no merge asymmetry). Dirty-refusal scope expansion acknowledged in handoff's Edge Cases.
- [x] **Human Test Plan satisfiable** by the implementation (init create / append / idempotent; upgrade retrofit / dirty / `--check`; doctor warn / pass).

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality

### Summary

Small, pure, and well-tested. The new `upsertCanonBlock` is the load-bearing piece and is isolated, regex-line-anchored, and idempotent. The upgrade integration cleanly piggybacks on the existing `pending` queue so dirty refusal, `--check`, `--force`, and `--no-stage` all apply uniformly — and the malformed bucket sits *outside* the queue so `--force` is correctly unable to override it. The constant-source sync model avoids the delimiter-merge asymmetry that would have been a footgun. Test coverage exercises every AC's failure mode (CRLF preservation, marker collision near-miss, malformed-and-force, dirty-refusal, first-create on templates, root self-hosting).

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- The malformed-summary block in `upgrade.ts` is printed verbatim in three places (lines 329-335, 349-355, 390-396). A tiny helper would deduplicate, but the duplication is local and readable as-is. Not blocking.

#### Spec Gaps

(none)

#### Out-of-scope observation (no action)

- A pathological adopter file with nested `# canon:start` markers (`start … start … end`) would have its inner content spliced out on replace, since the helper finds the first start and the next end. Not realistic — canon never writes nested blocks, and an adopter would have to author them. The spec scope is "first/normal block," not nested. Flagging only for future awareness.

## Final Verdict

- [x] **Approved** — ship as-is

All 14 ACs met, all validations green, AC-14 deviation is justified and preserves the spec's intent under worktree isolation.
