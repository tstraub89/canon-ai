# PR Body: post-ship-cleanup - Cleanup of trivial leftovers from blast-radius, self-check evidence, and path-scoped pitfalls

## Summary

- Blast-radius map: skip literal and status words (`True`, `None`, `Pass`, …) and acronym plurals (`IDs`, `URLs`) as identifiers; skip the three pipeline log docs; treat any git grep failure other than "no matches" as an error. The map stays fail-open at its caller.
- Self-Check evidence: catch the template placeholder when it is wrapped in bold or code marks, and reject a copied `<reason>` placeholder with a message that asks for the real reason. `N/A — no tests changed` and real evidence still pass.
- Pitfall selection: accept one-dash table separators (`|-|-|`) in index tables, matching GFM. An empty `CANON_PATTERNS_MD_PATH` now falls back to `docs/patterns.md` instead of dropping it.
- Docs: say how a path counts as a pitfall citation (backticks or a markdown link target, trailing `/` for directories, `*` for globs), name `classifyPreflightBlockers()` as the live per-task gate with `validateHandoff()` as its test-parity function, and document that index tables are not injected as prose.
- Fixed the comment above `checkImplementEvidence` in `src/orchestrator/main.ts` so it names `validateHandoffAgainstSpec` and describes what that function checks.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Judgment calls:
- **Literal and status words.** I used a fixed, case-sensitive list of exact tokens rather than dropping the single-capitalized-word rule, so component names like `Widget` are still searched. The trade-off: a real identifier named `Note` or `Done` is now skipped by the map. The map is advisory, so I accepted that.
- **Placeholder shape.** The Self-Check check now treats an Evidence cell as a placeholder when the whole cell is in parentheses after markup is stripped. I did not match the template's exact placeholder strings, so the check survives template rewording. The cost is that evidence written entirely in parentheses, such as `(verified both entry points)`, is rejected and the implementer gets one retry. Cold code review flagged this as rejecting legitimate evidence. If retries show up in practice, I would narrow the rule to the exact placeholder strings.
- **Telemetry exclusion.** The map reuses `PIPELINE_TELEMETRY_FILES` instead of keeping its own list, so the files the pipeline folds and the files the map skips stay in one place.
