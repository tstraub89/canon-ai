# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Spec contradiction: the spec excludes lesson H3s "under an H2 starting with Example", but in canon-ai's real `docs/lessons-learned.md` (and the scaffold) there is no H2 after `## Example entry` — every real lesson sits under it, separated only by `---` thematic breaks. Read literally, the Lessons channel would select nothing. Interpretation chosen (plan Step 2): an excluded H2's scope ends at the next H2/H1 *or* the first `---` thematic-break line outside a fence, whichever comes first. AC-7's fixture mirrors the real layout and the AC-13 real-file test asserts a real lesson is selectable. Spec not changed.
- [plan] Unspecified: demotion order *within* a channel when over the cap. Chosen: largest entry first (keeps the most rules in full), ties by later document position first.
- [plan] Spec-review nit (park-resume coverage): handled by an assertion in the existing park-resume test in `tests/run-task-prompts.test.ts`, not a new golden.
- [implement-revision] Choosing the first cell that resolves by heading prefix lets a short area label shadow the actual target; rank target cells by explicit doc paths and exact heading matches before prefixes.
- [implement-revision] A `.md` key path can parse as a linked-doc target and steal an exact section target; prefer candidates that leave path-like keys in other cells, then exact targets, and keep wildcard `.md` tokens as keys.
- [implement-revision] Index tables may be nested under H3 headings in either supported section; recognize them by target/path content and remove recognized Known Pitfalls index rows from the entry body before matching.
- [implement-revision] The last-resort byte-cap summary must fit as a complete line; truncate demoted-title detail first, and omit the block when even the complete summary exceeds an intentionally tiny test cap.
- [implement-reroute] The amendment settles table membership by position: Known Pitfalls tables before the first H3 are indexes even when their cells have no detectable signals; any later table stays in the H3 entry body and can provide its direct-match path tokens.
- [plan] Reroute round 1: Amendment 1's AC-15 says "The AC-4 fixture's nested table carries a path token again", but AC-4 itself describes no nested table (spec-review nit). Interpretation: it means the `### Entry with an explanatory table` fixture in the AC-4 unit test; the reroute plan restores a non-matching path token (`src/z/q.ts`) there. The existing `indexAfterEntry` test pinned behavior Amendment A drops; it is rewritten to pin the entry-content reading.
