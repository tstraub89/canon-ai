# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Verdict/doc changes that touch canon-managed roots also need the synced templates in Affected Files; otherwise `sync-templates:check` requires edits outside Codex's scope cap.

[spec_review] The current code_review spec_gap handler computes specGapIds but auto-blocks the full taskIds bundle; specs changing spec_gap recovery need an explicit mixed-bundle story.

[spec_review] Mixed-bundle spec_gap recovery must cover both fix and bless paths; accepting only the gap task leaves non-gap blocked siblings stranded.

[implement] Review accept validates `--reason` with trim-empty semantics but writes the original string to notes.md so the audit line preserves operator text.
