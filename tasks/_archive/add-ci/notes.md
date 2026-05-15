# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `docs/architecture.md` has two CI staleness points: the Tech Stack bullet and the dedicated CI section. The spec only names the latter.
[spec_review] The workflow includes `npm run lint`, but the spec's validation table does not require local lint verification. Keep the listed validation set aligned with the workflow steps.
[spec_review] The revised spec still has a lint scope contradiction: the workflow and validation table include lint, but `Non-Goals` says any CI check beyond type-check and test is out of scope.
[implement] Changing the `npm test` glob also made the `docs/architecture.md` Unit tests binding stale, so I updated that row while keeping the spec's CI/docs scope intact.

