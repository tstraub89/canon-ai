### A carve-out's condition must match the rows it covers, not a run of another skill

*(date 2026-11-20, source: canon-prune-run-lessons)*

A docs-audit carve-out said the "describes a canon mechanism" delete rule does not apply "when pruning canon-ai's own root docs with `/canon-prune`." The rows it covers are canon-managed root copies, and `/canon-prune` excludes canon-managed files from its input, so the condition could never be true for them. Two cold reviewers flagged it as unreachable. Prevention: when a carve-out covers a set of files, state the exception unconditionally for those rows and say why it applies. Do not condition it on a run of another skill that never touches those files. Before writing the wording, check the other skill's input rule for those same files. Canonical example: the docs-audit prune row in `.claude/skills/docs-audit/SKILL.md` (line 26), against the exclusion in `.claude/skills/canon-prune/SKILL.md`.
