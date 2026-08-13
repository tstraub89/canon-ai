# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[2026-07-22] Operator accepted spec_review via `canon task accept` — sanctioned (agent verdict overridden). Reason: Round-1 blocker (AC-3 downgrading omitted-required dependencies to nits) fixed and confirmed resolved by round 2. Remaining round-2 blocker demands an executed prompt A/B precision/recall eval; operator override on proportionality grounds: the recalibration direction is supported by convergent evidence — three over-firing 5.6-generation tasks (update-install-root-provenance, stable-validation-ids, fix-installed-provenance-version) plus vendor guidance (OpenAI 5.6 'stop over-prompting'; CodeRabbit recall-over-precision review benchmark). Canon has no reviewer-disposition eval harness, and building one for a prose calibration is the over-mechanization this task exists to fix. Empirical guard is the dogfood loop: default-codex-models-to-5-6-generation runs first under the recalibrated prompt. Round-2 nit (Human Test Plan carve-out) fixed..
