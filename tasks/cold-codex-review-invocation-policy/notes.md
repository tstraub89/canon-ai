# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `templates/docs/decisions.md` exists but is not a mirror of canon-ai's root `docs/decisions.md`: only `docs/pipeline-orchestrator.md` is registered in `CANON_OWNED`, and the sync script operates from that registry. Specs that amend canon-ai-specific decisions must treat `docs/decisions.md` as root-only unless template ownership is deliberately redesigned.
