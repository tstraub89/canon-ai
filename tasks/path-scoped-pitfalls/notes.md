# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Spec contradiction: the spec excludes lesson H3s "under an H2 starting with Example", but in canon-ai's real `docs/lessons-learned.md` (and the scaffold) there is no H2 after `## Example entry` — every real lesson sits under it, separated only by `---` thematic breaks. Read literally, the Lessons channel would select nothing. Interpretation chosen (plan Step 2): an excluded H2's scope ends at the next H2/H1 *or* the first `---` thematic-break line outside a fence, whichever comes first. AC-7's fixture mirrors the real layout and the AC-13 real-file test asserts a real lesson is selectable. Spec not changed.
- [plan] Unspecified: demotion order *within* a channel when over the cap. Chosen: largest entry first (keeps the most rules in full), ties by later document position first.
- [plan] Spec-review nit (park-resume coverage): handled by an assertion in the existing park-resume test in `tests/run-task-prompts.test.ts`, not a new golden.
- [implement-revision] Choosing the first cell that resolves by heading prefix lets a short area label shadow the actual target; rank target cells by explicit doc paths and exact heading matches before prefixes.
