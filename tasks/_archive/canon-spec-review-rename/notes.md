# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] Root canon-managed edits that sync into `templates/` need both sides named in scope; this spec lists the roots but omits the generated mirrors, which would leave real diff paths out of the handoff table.
[implement] `npm run sync-templates` regenerates the new mirror path but does not prune the old `templates/.claude/skills/canon-review/` orphan; the old file has to be removed explicitly before the sync check goes green.

[2026-06-16] Operator accepted implement phase via `canon task accept` — auto-commit will be skipped.
