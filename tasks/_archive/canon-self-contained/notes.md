# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Deleting `scripts/task.sh` requires updating the generated phase-command prompt seam in `scripts/run-task/prompts/helpers.ts`; replacing only orchestrator `runTaskShFor()` callers leaves spawned agents pointed at a missing file.

[spec_review] `canon init` has a separate hard-dependency gate in `src/cli/deps.ts`; removing jq from `doctor.ts` alone does not make init/global-install smoke paths jq-free.

[spec_review] Keep install smoke checks aligned: `canon task new` is only valid after `.canon/templates/` exists, so local/CI smokes need `canon init` or an initialized fixture before task creation.

[spec_review] Self-repair bootstrap: the parent orchestrator process driving this task holds in-memory references to `scripts/task.sh` (via `phaseCommands()` and `runTaskShFor()` evidence-fallback at `main.ts:1335`). Deleting the bash script mid-task breaks the running pipeline. Spec now includes a Bootstrap & Self-Repair section. Human may want to consider inline mode for this task per the project's inline-mode-for-canon-self-repair convention.

[implement] Static `.md` prompt imports work in the tsup bundle, but source tests need a test-only markdown loader (`tests/md-loader-register.mjs`) because Node+tsx does not load `.md` modules by default.

[implement] The `dist/` freshness gate is committed-state validation: after the required local rebuild, `git diff --exit-code -- dist/` remains nonzero until the orchestrator commits the regenerated bundle.

[implement] Temp-prefix simulations of `npm install -g git+file://...` needed `npm_config_install_links=true`; without it, npm linked to a pruned cache clone under the custom prefix. The raw tarball extraction smoke still passed without `node_modules`.

