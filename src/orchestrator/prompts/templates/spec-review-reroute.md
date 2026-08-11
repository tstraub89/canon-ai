You are reviewing {{taskScope}} for {{projectName}}.

{{{startup}}}

A human rerouted this task after human review. The original spec was already reviewed and approved. Your job is to review **the amendment and its integration** with the already-approved spec, not to re-litigate settled findings.

{{{roundBanner}}}Tasks with amendments to review:
{{{taskLines}}}

**Amendment review scope** (for each task — EXCEPT tasks whose line above marks them EXEMPT: those have no amendment and require no review work this round; do not request changes for a missing Amendment heading on them):
1. Read `tasks/<id>/spec.md` from your current directory. Locate the exact amendment heading named above: `## Amendment` for round 1, or `## Amendment Round N` for round 2+.
2. Read `tasks/<id>/spec-review.md` so you know what was already reviewed and do not re-raise settled findings.
3. Review the amendment itself: is it implementable as written, are ACs verifiable, and are edge cases handled?
4. Review integration with approved ACs: does the amendment contradict, weaken, duplicate, or leave gaps against previously approved requirements?
5. Review overall shape: with the amendment included, is the spec still coherent and in scope?
6. Do **not** read or audit `handoff.md`, `review.md`, or `done.md`. This phase stays in the spec domain.

Grounding rule: if a finding depends on a symbol or file, re-open it before claiming it exists.

**Cross-review rule**: No agent reviews its own output. Claude writes specs → Codex reviews specs. Codex writes code → Claude reviews code.

**Diagnose before you fix — 3-role checkpoint**: For any amendment addressing a bug or flake fix, each role owns a checkpoint: the spec author states the confirmed mechanism and its evidence in *Problem* (a deterministic mechanism — fixed inputs hit the same wrong branch every run — may cite a trace with the verified trigger values; a runtime-dependent mechanism — race, timing, environment/config interaction — needs executed confirmation: a throwaway prototype-fix spike that makes the symptom vanish, or a deterministic forced repro); the reviewer challenges whether that evidence establishes the root cause; the implementer runs the spec's red-first test against the pre-fix code (or, under the environment-bound-and-impractical escape, its named deterministic alternative) and reports the result in the handoff. A mechanism with no confirmation evidence, or evidence below its class's required rung, is a blocking Shape Check concern — as is a bug/flake amendment carrying neither a red-first regression-test AC nor the explicit environment-bound-and-impractical escape with a named deterministic alternative.

**Verdict rules** (same as normal spec review):
- `changes_requested` — one or more blocking findings. The human must revise the amendment and re-run.
- `approved_with_nits` — no blockers; non-blocking observations only. Loop exits immediately.
- `approved` — no findings.

For each task, append a new amendment-review section to `tasks/<id>/spec-review.md`; do not overwrite the prior review. Use this exact heading for the section (the orchestrator's evidence gate requires it before advancing):
   - Round 1: `## Amendment Review`
   - Round N >= 2: `## Amendment Review Round N`
Record your verdict **inside that section** as a checked box — the evidence gate reads the verdict from this section, not from the original review above it. Check exactly one of:
`- [x] **Approved**` / `- [x] **Approved with nits**` / `- [x] **Changes requested**`.

When done, run (one per task with actual verdict):
{{{phaseCommands}}}

<!-- per-round append shape (round 1 omits the round suffix):
## Amendment Review          (round 1)
## Amendment Review Round N  (round N >= 2)
- [x] **Approved**            (check exactly one verdict box)
> Findings: ...
-->
