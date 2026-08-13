# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] AC-2b's negative-control example uses docs/changelogs.md.bak, but `scripts/docs-refs-check.mjs` only scans files ending in `.md` (via `walkMarkdownTree`), so that path will never be visited by `runChecks`.
[implement] `notes.md` and `spec-review.md` are part of the docs-refs scan, so broken backtick paths in task artifacts can fail the repo-root gate even though task `spec.md` / `plan.md` files are exempt.
[implement-revision] The handoff validation table has to match the required check text exactly; paraphrased labels like "Linting (npm run lint)" were rejected by the review gate even though the commands were correct.
[implement-revision] Keep the Validation Outcomes Check column as plain text; wrapping the whole label in inline code changes canonicalization and makes the required-check matcher miss it.
