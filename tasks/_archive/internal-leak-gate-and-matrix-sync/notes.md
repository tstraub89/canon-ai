# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `docs/architecture.md` says `npm run docs-refs-check` is required for any change touching `docs/`, `templates/`, or root-level agent files; this spec edits `docs/decisions.md` and `.claude/skills/canon-changelog/SKILL.md` but does not include that validation gate.

[implement] `INTERNAL_ONLY_TEMPLATE_BASENAMES` is derived from the canon checkout at module load time, so the temp-repo leak tests only need fixture markdown content; they do not need to create matching `scripts/run-task/prompts/templates/` or `.canon/templates/` directories in the temp root.

