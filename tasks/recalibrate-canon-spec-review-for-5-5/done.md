# Done: recalibrate-canon-spec-review-for-5-5 — Recalibrate canon-spec-review for the Claude 5.5 generation

## Summary

`/canon-spec-review` now dispatches its three review angles (shape, factual, spec-quality) to one new read-only reviewer, `spec-review-lens`, instead of `general-purpose` and `Explore` agents. The reviewer can only Read, Grep, Glob and run read-only Bash, so it cannot edit files or launch further agents or skills. The skill now carries Codex spec_review's severity definitions and its scope-boundary rule, and it applies the reviewer's filtering once, at synthesis, rather than in each angle. It also gets a sharper Affected Files check and corrected stale pointers. The charter is a canon-managed file, so `canon init` and `canon upgrade` ship it to adopters.

## Files Changed

- `.claude/agents/spec-review-lens.md` and `templates/.claude/agents/spec-review-lens.md` — new shared reviewer charter and its mirror.
- `.claude/skills/canon-spec-review/SKILL.md` and its `templates/` mirror — angles repointed to the charter, filtering moved to synthesis, scope and C3 clarified, drift fixed.
- `src/lib/canon-owned.ts` — registers the charter as canon-managed.
- `dist/cli/index.js` — rebuilt bundle.
- `tests/run-task-prompts.test.ts` — structural assertions for AC-1 through AC-7.
- `docs/decisions.md` — calibration decision recorded under the Claude prompt calibration audit.

## How to Test

1. Start a fresh Claude Code session (so the new reviewer type loads) and run `/canon-spec-review` on an existing spec.
2. Confirm three reviewers are dispatched and each returns findings or an explicit "no findings".
3. Confirm factual findings cite specific file locations.
4. Confirm the report groups BLOCKING / STRONG / NIT and ends with a recommendation.
5. Confirm a finding about behavior the spec's Non-Goals explicitly exclude is not reported as BLOCKING.
6. Confirm the working tree shows no new or modified files afterward, and no reviewer launched further reviewers or skills.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,333 passed; one unrelated test (`tests/run-task-safety.test.ts:2522`, linked-worktree `REPO_ROOT`) was skipped because the sandbox restricts `.git/` writes. It is unverified, not passing. |
| `npm run build` | Pass | `spec-review-lens.md` appears once in `dist/cli/index.js`. |
| `npm run sync-templates` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |
| `tests/run-task-prompts.test.ts` | Pass | 46 tests, including the new structural test. |

Code review verdict: approved_with_nits.

## Human Verification Required

None in the handoff's validation tables (no `human_pending` rows). Still open outside them:

- The spec's Human Test Plan (real dispatch in a fresh session, steps under How to Test) has not been run. No live dispatch was possible in an unattended session, so the frontmatter `tools:` syntax is confirmed only by documentation and the structural test, not at runtime.
- The skipped `tests/run-task-safety.test.ts:2522` case should be run in an environment that allows `.git/` writes.

Pre-merge checklist (unconfirmed by QA):
- [ ] Version correct — unchanged here; release step decides
- [ ] Changelog updated if needed — release step
- [ ] PR body current
- [ ] Final CI/CD checks green
- [ ] Final diff matches spec intent

## Decisions Made

- Bash is kept in the reviewer's tool list (some Claude surfaces lack Grep/Glob) and is restricted to read-only commands by instruction.
- Definitions from Codex spec_review are inlined rather than referenced, since adopters cannot open that prompt; AC-3 pins the load-bearing tokens in both copies.
- If the charter is missing (mixed-version adopter), the skill stops and says to upgrade and start a fresh session, rather than falling back to a broader agent type.
- No deviations from the plan.

## Open Questions

- Should the frontmatter `tools:` syntax be confirmed by the human test plan before release? (Recommended.)

## Proposed Changelog

### Changed

- **`/canon-spec-review` reviewers are now read-only.** The three review angles run as a single shipped `spec-review-lens` reviewer that can read and search but not edit files or launch other agents or skills. It reports every cited finding and leaves filtering to the final report, and it uses Codex spec review's blocking/nit definitions, including the rule that behavior a spec explicitly excludes and verifies as unaffected is a nit at most. The Affected Files check now names the exact heading the pipeline parses and includes generated or rebuilt outputs. Run `canon upgrade` and start a fresh Claude Code session to pick up the new reviewer.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: One unrelated linked-worktree test skipped by sandbox; live-dispatch Human Test Plan not run unattended.
