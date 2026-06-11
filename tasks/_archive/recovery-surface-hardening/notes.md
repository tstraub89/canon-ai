# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] Updating docs/pipeline-orchestrator.md requires refreshing templates/docs/pipeline-orchestrator.md with npm run sync-templates; sync-templates:check fails on that derived copy until it is updated.

[implement] The plan's shared reroute_exempt type addition would have expanded beyond the spec's source Affected Files; the implementation kept the additive status marker local to main.ts/validation.ts with explicit runtime narrowing.

[implement-reroute] Exempt-sibling prompt flavoring needs both state and template changes: storing the prior verdict is not enough if the generic implement-reroute template still says every exempt task only re-verifies shared behavior.


