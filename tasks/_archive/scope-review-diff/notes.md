# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] Existing tests still call `promptCodeReview(state)` with the old arity; kept a backward-compatible `baseBranch` fallback so type-check stays green while the code-review phase passes the resolved branch explicitly.
