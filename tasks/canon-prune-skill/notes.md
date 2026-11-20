# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
[plan] AC-10 nit: spec step 6 already defines the locator; plan fixes the commit-body format (`<doc path> :: <heading>[ :: <row key>]`, row key = first cell), and adds a `Canon-Prune: <date>` trailer beside the `docs: canon-prune` subject so `git log --grep` (two ORed patterns) survives a squash-merge subject rewrite.
[plan] docs-refs-check validates skill-to-skill `§"…"` refs only in backticked-path form (`` `.claude/skills/canon-sweep/SKILL.md` §"Preconditions" ``); plan uses that form and has implement prove resolution by breaking one ref once.
[plan] Skill's concrete canon-managed list adds the guard hook and docs-refs checker script to the spec's by-kind list; neither is a doc, so scope is unchanged.
[plan] docs/lessons-learned.md is a PIPELINE_TELEMETRY_FILES entry: auto-commit allows it, handoff diff exempts it, `--pr` will warn about a shared-log edit — expected for AC-16.
