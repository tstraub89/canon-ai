# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[plan] No spec contradictions. Spec says dist/ is committed; HEAD~ commit "stop committing dist/" exists but `git ls-files dist` still lists two files — plan tells implementer to commit whatever `npm run build` changes. Adopter-scope: plan keeps docs/pipeline-orchestrator.md free of canon-ai-only cross-references.
