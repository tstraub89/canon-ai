# PR Body: spec-manifest-lint - Reject malformed Affected Files manifests when the spec is marked done

## Summary

- Marking a spec done now lints its `### Affected Files` table. Fused cells, header-less blocks, unreadable path cells, ignored or duplicated scope headings, and empty first cells that hide a path are reported with the section, row, and fix. Before, these dropped paths silently or only warned at `code_review` or `--pr`.
- Plan and implement entry run the same lint on every bundle member before any agent starts. A bad manifest auto-blocks the phase and exits non-zero; `--force` proceeds with a warning that lists the issues.
- Evidence recovery for the spec phase returns "not advanced" with the issues instead of throwing, so the agent's retry sees what to fix.
- Fenced code examples and HTML-commented tables no longer count as scope. A fenced example ahead of the real table used to displace the real rows, and a commented-out table was read as live scope. All manifest consumers share one scan, so the lint and the parser agree.
- Authoring guidance (spec template, spec self-check, revision prompt, `/canon-spec` and `/canon-spec-review` skills) and the pipeline orchestrator docs state the manifest contract and the new gates.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Behavior change for existing tasks: an in-flight spec with a malformed table is now blocked at its next gate (`spec done`, plan entry, implement entry, or a reroute). Fix the table and rerun, or pass `--force` for a warning. `CANON_SKIP_PHASE_GATE` still bypasses the spec-done gate.
- Archive calibration: all 127 archived specs were scanned. 15 would be flagged, and archived consumer path output is unchanged. Archives were not edited.
- Red-first evidence for the fence and comment fix is recorded in `tasks/spec-manifest-lint/handoff.md`: both regressions failed on the pre-fix parser and pass now.
- `--full-send` on delicate tasks requires `--force`, so the plan and implement pre-flights run as warnings there. The spec-done gate still enforces.
- Known gap, not addressed here: an unterminated fence or comment still hides the rest of a spec without an error. Foreman-written full-send amendments are also not linted, because `src/orchestrator/prompts/templates/code-review-foreman.md` is outside this change's scope.
- Follow-up: the docs-refs half of the `--pr` shift-left backlog item is still open.
