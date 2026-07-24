# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] The two current Codex config objects are intentionally not whole-object duplicates: env.ts has projectName/maxContextBytes and policy.ts does not. A literal byte-identical-object AC would imply an unrelated refactor.

[spec_review] The spec's AC-2 repo-wide retired-model allowlist conflicts with current non-allowlisted hits in CHANGELOG.md, docs/BACKLOG.md, and incidental test fixtures; AC-7 and Docs Impact explicitly treat some of those as allowed/non-required.

[implement] The existing 2026-07 guardrail-calibration decision already references the 5.6 generation; the required new entry was still appended separately to record the shipped-default change and reconcile the earlier `spec_review` caution.

