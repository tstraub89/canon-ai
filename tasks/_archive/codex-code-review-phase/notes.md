# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `codex review --commit <latest implement SHA>` skips earlier implement commits when Claude rerouted before the first Codex approval; use full base diff or track a Codex-approved baseline.

[spec_review] Current Codex CLI rejects `codex review -m <model>`; use top-level `codex -m <model> review ...` or `codex review -c model="<model>" ...` when specifying review runner argv.

[spec_review] Artifact-gated phases need an explicit skip/disabled artifact or gate exemption; otherwise `taskPhase(... done ...)` conflicts with "no artifact written" skip paths.
