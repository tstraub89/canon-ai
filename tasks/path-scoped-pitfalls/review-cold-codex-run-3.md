<!-- round=3 reviewed_sha=f8af39de60b62750d293499a8c9b8b583fe4aaa2 scope=delta base=7cc77d2ba682f0dff67539dc4e96c0aa052c0afa reason="delta" -->

The new heuristic can misclassify explanatory tables in Known Pitfalls entries as indexes and discard their content. The test suite passed, but does not cover this case.

Review comment:

- [P2] Distinguish index markers from explanatory table values — /Users/tstraub/canon-ai/.canon/worktrees/path-scoped-pitfalls/src/orchestrator/pitfalls.ts:368-368
  When an explanatory table inside a Known Pitfalls entry contains a standalone em dash (for example, as an output for a missing value), this classifies the whole table as an index. Its rows are then emitted in the area index and removed from the entry body, so readers lose the explanation and see unrelated index rows. Recognize the marker in table context, such as by checking the header, rather than matching any cell value.