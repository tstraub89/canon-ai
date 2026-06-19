# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `canon doctor` still hard-fails missing `AGENTS.md` / `CLAUDE.md`; any future spec that stops scaffolding agent files must explicitly re-scope doctor checks and CI smoke assertions.
[spec_review] Stale-reference sweeps for ownership changes must include shipped CLI strings, not only README/docs/skills; `canon init` still says existing agent files will run a merge protocol.
[spec_review] When deleting template files but retaining generic machinery tests, scope "no refs to deleted path" grep checks or rename fixture paths so tests don't become false positives.
