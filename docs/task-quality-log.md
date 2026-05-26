# Task Quality Log

> Appended by Claude during the QA/done step. One row per task. Tracks pipeline health signals over time.

## How to use this doc

Each row records what *actually happened* in a task — spec verdicts, review iteration counts, dropped ACs, validation gaps, failure phases. Trends across rows surface pipeline-quality issues:

- Many tasks needing 3+ spec_review iterations? → Spec authorship rules need work.
- Repeated dropped ACs in code review? → Codex prompts or AC clarity need work.
- Validation gaps slipping through to human_review? → Validation matrix or handoff template needs work.

The QA phase appends a row at the end of every task. The product owner reviews trends periodically (e.g., end of release milestone) and uses signals to update `AGENTS.md`, prompts, or templates.

## Columns

| Column | Meaning |
|---|---|
| Task | TASK-ID |
| Size | S / M / L / XL (and `delicate: true` if applicable) |
| Spec verdict | First Codex spec_review verdict (approved / approved_with_nits / changes_requested) |
| Spec iterations | How many spec_review rounds before approval |
| Code review iterations | How many code_review rounds before approval |
| Dropped ACs | Count of ACs that the implementation missed (caught in code review) |
| Validation gaps | Count of validation checks that should have run but didn't |
| Human reroute? | Yes/No — did the human reject at human_review and force a re-implement? |
| Notes | One-line summary of anything notable |

## Log

| Date | Task | Size | Spec verdict | Spec iter | Review iter | Dropped ACs | Validation gaps | Human reroute? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| _(rows land here as tasks ship)_ | | | | | | | | | |
| 2026-05-08 | handoff-verifier | M | approved_with_nits | 1 | 3 | 0 | 0 | No | Rename-pair handling (`--name-only` vs `--name-status`) missed in round 1, caught in round 3; correctness bug fixed before ship |
| 2026-05-08 | adopt-eslint | M | approved | 1 | 1 | 0 | 0 | No | Clean first-pass; Codex added `isPhaseStatus`/`isVerdict` runtime guards as a sound improvement over `_`-prefix-only suppression |
| 2026-05-09 | fix-pipeline-bugs | M | approved_with_nits | 1 | 1 | 0 | 0 | No | Five bugs fixed in one pass; one spec-text gap (AC-3c over-specified `PIPELINE_MANAGED_DOCS` consumers) caught in Stage 2 but not blocking |
| 2026-05-09 | add-ci | M | approved | 1 | 1 | 0 | 0 | No | Clean first pass; stale test count (spec said 58, actual 69) flagged as a spec gap but not blocking; branch protection follow-up in GitHub UI |
| 2026-05-11 | runtime-validation-phase | M delicate | approved_with_nits | 5 (auto-blocked at 3, reset+2 more) | 0 | 0 | 0 | No | Complex spec — AC-9b, AC-11 artifact preservation, AC-12b template composability all emerged iteratively through spec review; clean single-pass implementation once spec settled |
| 2026-05-11 | counter-schema-migration | L | approved | 1 | 2 | 0 | 0 | No | Round 1 blocked by sandbox write-path failure in runtime-validation regression test; round 2 clean. Nit: `cwd: 'repo_root'` test case dropped for sandbox compat (coverage gap, non-blocking). Docs-impact items (pipeline-orchestrator.md, decisions.md) not in handoff — updated inline at QA. |
| 2026-05-14 | scope-review-diff | S | approved (human fast-tier) | 1 | 1 | 0 | 0 | No | Clean single-pass; approved with nits — round-1 `baseBranch` vs `resolvedBaseBranch` inconsistency in `prompts/index.ts` non-blocking. Eliminates noisy-worktree review stall (issue #46). |
| 2026-05-16 | retire-runtime-validation | L delicate | approved_with_nits | 4 (3 changes_requested) | 1 | 0 | 0 | No | 4 spec-review rounds to resolve allow-list scope (grep-discovered historical telemetry + archived tasks) and template-mirror details; clean single-pass implementation; delicate self-modification — pipeline retires itself via worktree isolation. |
| 2026-05-16 | canon-self-contained | L delicate | approved | 1 | 1 | 0 | 0 | No | Clean single-pass; 27 ACs, 42 files changed, 693-line bash port. Worktree-sync bug silently dropped 3 doc files from main commit — recovered in follow-up commit; post-commit coverage check correctly flagged the miss. |
| 2026-05-17 | claude-min-version | S | approved (human fast-tier) | 1 | 1 | 0 | 0 | No | Clean first pass; bespoke spawn wrapper deviation documented in handoff (needed for stderr capture on interactive path). Single cosmetic nit in dist artifact path comment — not blocking. |
| 2026-05-18 | pr-at-complete | S | approved | 1 | 1 | 0 | 0 | No | Clean single-pass; code review approved_with_nits (no iteration); Codex used subprocess-level tests instead of unit-testing runPhase() — valid implementer's call documented in handoff. |
| 2026-05-21 | full-send-mode | M | approved_with_nits | 4 (1 auto-block) | 3+reroute | 0 (AC-13+AC-14 post-QA amendments) | 0 | Yes (AC-13 telemetry pollution + AC-14 some→every bundle gate) | Spec 4 rounds: void-return URL gap + single-branch constraint; reroute for test telemetry pollution (AC-13); async Codex PR review caught `some→every` bundle-gate P1 (AC-14); 14 ACs met after iteration 4. |
| 2026-05-22 | scope-pr-auto-commit-to-affected-files-v2 | M delicate | approved_with_nits | 2 (1 changes_requested) | 1 | 0 | 0 | No | v1 archived after 5 spec_review CRs on warn-and-skip gate interactions; v2 pivoted to die + narrowed allow-list; single-pass impl, code review approved with one cosmetic nit (warning loop ordering). |
| 2026-05-23 | prepr-base-drift-check | M delicate | approved_with_nits | 3 (2 changes_requested) | 1 | 0 | 0 | No | Spec review 2 CRs on die-message wording (`git checkout HEAD --` confusion) and malformed-cell handling; clean single-pass impl; code review approved first round; two-dot vs three-dot semantics distinction proved critical for Mode 1 correctness. |
| 2026-05-24 | docs-refs-check-canon-template | M | approved_with_nits | 2 (1 changes_requested) | 4 (3 changes_requested, 1 auto-block) | 0 | 0 | No | Code review auto-blocked at 3 iterations: gate kept failing because pre-existing stale refs in CLAUDE.md, docs/decisions.md, docs/lessons-learned.md, docs/pipeline-orchestrator.md, README.md weren't yet fixed; rounds 1–3 also included a phantom "missing Validation Required" finding that was already in spec.md. Resolved by prose-ifying all stale path citations. |
| 2026-05-24 | reroute-preflight-spec-amendment-check | S | approved | 1 | 1 (changes_requested — 4 findings; F1 roundNum off-by-1, F2 wrong assertion string, F3 stale dist/cli/index.js, F4 legacy variants in taskLines) | 2 (AC-11 partial: F1+F4; AC-6 partial: F3) | 1 (dist/cli/index.js not rebuilt) | No | Code review returned changes_requested; task advanced to QA with open findings. F1 is a logic bug in prompt round injection; F2 a test assertion mismatch; F3 a missing build artifact; F4 a spec-gap on legacy variant removal in prompts/index.ts. All four must be addressed before ship. |
| 2026-05-24 | docs-refs-adopter-skip-and-ellipsis | M | changes_requested | 7 (5 CR, 1 auto-block) | 3 (2 CR) | 0 | 0 | No | Spec review high churn: AC-2b negative control used `.md.bak` extension walker never visits, causing repeated fixture-design rejections + auto-block. Code review 2 iterations: handoff artifact cleanup only (backtick fixture paths in notes/spec-review failing docs-refs gate; validation label formatting issues). |
| 2026-05-24 | canon-docs-dedup | M | approved_with_nits | 2 (1 spec amendment post-review) | 3 (0 source changes in rounds 2–3; handoff accuracy only) | 0 | 0 | No | AC-12 placement error: convention paragraph was inside canon-delimited region and would have leaked dev-only tooling refs to adopters via `canon upgrade`; spec amended, rerouted; rounds 2–3 were handoff cleanup only (stale baseline Changes table row). Clean single-pass implementation. |
| 2026-05-25 | fix-ship-non-worktree-enoent | S delicate | approved (human fast-tier, full-send) | 1 | 1 | 0 | 0 | No | Clean single-pass; 11 ACs met; pre-fix ENOENT reproduced and captured in handoff; two new real-git `--ship` tests fill coverage gap for both worktree modes; spec audit revealed existing fake-git smoke test cannot reproduce missing-task-dir failure. |
| 2026-05-25 | worktree-canonical-task-state | L delicate | changes_requested (iter 1) | 5 | 2 (iter 2 handoff-only, no source changes) | 0 | 0 | No | 26 ACs, 40+ files, structural rewire of core task-dir resolver. AC-22g (telemetry discrimination gate) accumulated 5 spec_review rounds and was carved out to BACKLOG after establishing the parser surface was intrinsically too complex; byte-offset snapshotting filed as successor. Two known 1.4.0 bugs closed (stale-mirror parser reads + --ship pull conflicts). |
| 2026-05-25 | orchestrator-survive-sighup | S | approved | 1 | 1 | 0 | 0 | No | Clean single-pass; SIGHUP handler + stdin sever; `import.meta.url` guard needed for focused-harness testability; all 5 checks pass first try. |
| 2026-05-26 | preflight-exempt-telemetry | S | approved (human fast-tier) | 1 | 1 (approved, no findings) | 0 | 0 | No | Clean single-pass; all 7 ACs met; fixes false-positive diff→handoff pre-flight on post-reroute runs where prior-cycle QA telemetry commits appear in cumulative branch diff. Surfaced by gallery_wall PR #107. |

---

## Periodic Reviews

> **TODO[canon]: Append a "Review: YYYY-MM-DD" subsection here at the end of each release milestone summarizing trends and the actions taken (rule updates in AGENTS.md, prompt tweaks in run-task.ts, etc.). The point of the log is to feed these reviews; without periodic scans the log is just cold data.**
