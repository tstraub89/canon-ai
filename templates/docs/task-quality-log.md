# Task Quality Log

> Upserted by the qa → done phase transition — one row per task, keyed by Task id. QA supplies five judgment cells via done.md; the remaining cells are derived from status.json.

## How to use this doc

Each row records what *actually happened* in a task — spec verdicts, review iteration counts, dropped ACs, validation gaps, failure phases. Trends across rows surface pipeline-quality issues:

- Many tasks needing 3+ spec_review iterations? → Spec authorship rules need work.
- Repeated dropped ACs in code review? → Codex prompts or AC clarity need work.
- Validation gaps slipping through to human_review? → Validation matrix or handoff template needs work.

The qa → done transition writes or updates this task's row in place. The product owner reviews trends periodically (e.g., end of release milestone) and uses signals to update `AGENTS.md`, prompts, or templates.

## Columns

| Column | Meaning |
|---|---|
| Task | TASK-ID |
| Size | XS / S / M / L / XL (and `delicate: true` if applicable) |
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

---

## Periodic Reviews

> **TODO[canon]: Append a "Review: YYYY-MM-DD" subsection here at the end of each release milestone summarizing trends and the actions taken (rule updates in AGENTS.md, new pattern entries in docs/patterns.md, validation tweaks, etc.). The point of the log is to feed these reviews; without periodic scans the log is just cold data.**
