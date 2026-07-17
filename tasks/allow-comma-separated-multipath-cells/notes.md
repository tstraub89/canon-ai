# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Semantic inventories need a broader search than the proposed
retired-wording grep: `tests/task-cli.test.ts` still treats the newly accepted
comma form as malformed, while `docs/BACKLOG.md` retains `rejects >1 backtick`
and `single-path-per-row` wording that AC-9's exact regex does not match.

[spec] Revision round 1 — addressed all four Codex blockers + both nits:
- Blocker (task-cli conflict) → AC-13 splits the malformed-row test into an
  acceptance test (comma form flows through `taskAccept`) + a retained refusal
  test with a genuinely-malformed fixture; added `tests/task-cli.test.ts` to
  Affected Files; AC-11 now spans both suites.
- Blocker (BACKLOG stale wording) → AC-9 grep broadened to catch
  `single-path-per-row` + `rejects >1 backtick`; Affected-Files row + AC-9
  enumerate all three occurrences (~48/49/51); deletion-handling entry (~789)
  explicitly left untouched.
- Blocker (missing validation) → `npm run docs-refs-check` added to Validation
  Required (edits touch docs/ + templates/).
- Blocker (collectUnscannedTableHits) → AC-14 asserts every comma-listed path
  gets a map entry in an unrecognized-table row.
- Nit (codebase-map:54 stale parser desc) → implement-owned freshness row +
  Docs Impact; confirmed root-only (no `templates/` mirror).
- Nit (nested-paren md-link boundary) → folded into AC-2, preserving the
  behavior from the deleted `extractHandoffPath` parens test.

[spec_review] Fresh round: `docs/BACKLOG.md` marks the multi-table item resolved
and current `parseAffectedFilesFromSpec` uses `parseAllTablesH3`; revision-round
wording that calls the multi-table problem still open should be handled as
historical-tense cleanup in the plan, not as an active parser limitation.

