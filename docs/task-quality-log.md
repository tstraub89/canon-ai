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

---

## Periodic Reviews

> **TODO[canon]: Append a "Review: YYYY-MM-DD" subsection here at the end of each release milestone summarizing trends and the actions taken (rule updates in AGENTS.md, prompt tweaks in run-task.ts, etc.). The point of the log is to feed these reviews; without periodic scans the log is just cold data.**
