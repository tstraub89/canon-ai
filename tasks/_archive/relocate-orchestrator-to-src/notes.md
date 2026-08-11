# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `parseAffectedFilesFromSpec()` reads only first-column path tokens while base-drift expands both sides of renames. The current move rows authorize only old paths, and the dist `old → new` cell is malformed because multi-path cells must be comma-separated.

[spec] Fixed the above by restructuring the moved tables to one rename pair per row, first column `` `old`, `new` ``. Verified empirically against the real parser: malformed 0 (was 1), parsed paths 144 (was 96), all 46 source and 46 destination paths present. Also cross-checked that every tracked file containing a retired path string is declared (0 undeclared).

[spec] Canon's two path-reconciliation gates read renames differently and are NOT interchangeable. Base-drift (`getTreeDriftFiles` → `parseNameStatusOutput`) flattens `R100\told\tnew` into two independent paths, so the spec must declare BOTH sides; it supports trailing-slash directory prefixes. The code_review handoff check (`parseDiffNameStatus` → `verifyHandoffAgainstDiffFromData`) keeps `renamePairs` intact and accepts EITHER side, but matches by exact string with no prefix support. Consequence: directory form in the spec would have been legal but would have pushed the 47-path enumeration into the handoff, where getting it wrong loops the pre-flight. Enumerated explicitly in the spec so implement can transcribe. Candidate for `docs/patterns.md` if it survives QA.

[spec] Round-1 spec claimed `implement.md` and `qa.md` were "the two internal-only basenames" the leak gate keys on. Wrong — evaluated the real module: `INTERNAL_ONLY_TEMPLATE_BASENAMES` has 8 members (all 11 prompt templates minus `plan.md`/`spec.md`/`spec-review.md`, which also exist in `.canon/templates/`). AC-5's new test would have been written against a wrong baseline. Corrected in AC-5 with the verified list.

[spec_review] Fresh import-graph trace found three `../pipeline-policy.js` importers (`policy.ts`, `types.ts`, `quality-log.ts`). Moving them under `src/orchestrator/` requires all three to target `../lib/pipeline-policy.js`; the revised spec currently updates only `policy.ts` and declares the other two byte-identical.

[spec_review] AC-14 describes the code-review rename-pair check, where either side is sufficient, but omits the earlier auto-commit coverage check. `findUncoveredTrackedChanges()` requires both paths of an `R  old -> new` porcelain entry; direct execution confirmed old-only and new-only remain uncovered, while both clears it.

[spec] Round-2 revision. Both blocking findings confirmed against source before revising. (1) Three `../pipeline-policy.js` importers, not one: `policy.ts:13`, `types.ts:10`, `quality-log.ts:4`. Two are `import type` — erased at emit, so a missed re-point produces no runtime symptom and no dist diff, only a type-check failure. Added a policy-importer note under the moved table and AC-15 (scoped zero-hit search). (2) `findUncoveredTrackedChanges()` uses `entry.paths.some(p => !allowed.has(p))`, so a rename entry is uncovered if EITHER side is missing — strictest of the gates and the FIRST to fire (implement close), not last. Production abort text at `main.ts:658-660` already says "including both sides of renames".

[spec] There are THREE path-reconciliation gates, not two, and the strictest fires first. Ordering matters because an implementer who designs to the code_review pre-flight's either-side leniency gets rejected one phase earlier by auto-commit. Rewrote AC-14 as a three-gate table (fires-at / reads / input shape / rename representation / declaration needed / directory-form / token form).

[spec] Discovered while checking the handoff token form: `isNoisySourceFile()` (`scripts/docs-refs-check.mjs:512`) exempts only `spec|plan|notes|spec-review.md` under `tasks/<id>/` — `handoff.md` is deliberately NOT exempt. So the same rename must be written two DIFFERENT ways: backticks on both sides in spec.md (exempt, and `parseAffectedFilesFromSpec` requires backticked tokens), but `[old](old)` markdown-link + `` `new` `` in handoff.md (a backticked deleted path is a broken ref there). Collapsing the asymmetry in either direction breaks a gate. Strong `docs/patterns.md` candidate if it survives QA — it generalizes to any rename-heavy task, not just this one.

[spec] Re-ran `parseAffectedFilesFromSpec` after every edit round: 0 malformed, 144 paths, 46/46 source and destination present. The added prose inside the Affected Files section (blockquote note) does not affect the parse — only table rows are read.

[implement] The approved Affected Files manifest omits `tests/run-task-ship.test.ts`, whose `MAIN_HREF` constructs the retired module path as separate `path.join(..., 'scripts', 'run-task', 'main.ts')` cells. Literal-family greps do not see that split spelling. The full suite therefore reports 29 `ERR_MODULE_NOT_FOUND` failures from that one file; all 1,117 non-ship tests pass. Scope discipline forbids editing it without a spec amendment.

[implement] `npm pack --dry-run` initially hit the host's unwritable npm cache (`EPERM` under the user cache). Re-running with a task-scoped cache under `/tmp` passed and showed exactly one packaged `scripts/` file: `scripts/install-git-hooks.mjs`.

[implement] Resumed implementation explicitly authorized finishing the omitted `tests/run-task-ship.test.ts` path fixture. Added an Amendment Affected Files row before editing it so the base-drift and handoff manifests remain complete.

[implement-revision] Round 1 confirmed the active-checkout test-path pitfall in two remaining sites: a supervising-root import made a worktree regression load stale code, while an `existsSync` guard silently skipped the newly relocated bundle. Active test targets now resolve from `process.cwd()` / `WORKTREE_ROOT`, and declared shipped paths fail closed when absent.

[implement-revision] The reviewer-authored `review.md` used nine checker-invalid backtick refs (deleted paths plus extensionless live paths). Because review artifacts are intentionally scanned, those refs broke `docs-refs-check` and six full-suite subprocess cases. Repaired only reference formatting/path completeness without changing review substance.


