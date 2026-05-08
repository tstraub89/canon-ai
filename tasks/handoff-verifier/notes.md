# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `tasks/<id>/handoff.md` is written in the worktree for review, but it is not committed before `code_review`. Any diff verifier must read the handoff from disk and compare it to `git diff` output; do not assume the handoff file itself appears in the diff.

