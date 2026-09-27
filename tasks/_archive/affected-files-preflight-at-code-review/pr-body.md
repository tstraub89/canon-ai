## Summary

- Catch files outside the spec's Affected Files at the `code_review` pre-flight, instead of only at `--pr`. A normal run now halts before any reviewer runs and names the file with two fixes (edit the spec and re-run, or reroute to remove it); a full-send run instead has the code-review foreman judge each out-of-scope file (scope expansion, spec miss, or should-not-have-changed) and record the outcome, with a spec addendum for the first two cases.
- `--pr`'s base-drift abort message now separates "the base branch advanced" from "this file is out of scope" instead of always blaming scope for both.
- Both gates share one allowlist builder now (`buildAffectedFilesAllowlist`), so the new pre-flight can never be stricter than `--pr` ends up being later.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Round 2 code review found that enforcing the full-send scope check right after the foreman's session blocks a legitimately recoverable state (a partial `review.md` with no checked verdict yet, which the existing retry path would otherwise finish normally). Enforcement now happens once, at the router boundary that runs after that retry path has settled.
- `spec_gap` keeps its own human-triage route rather than being folded into the same "block on unamended file" rule as other unjudged out-of-scope files — flagged as an open product question rather than resolved here (see task's `done.md` → Open Questions).
- There's a separate, pre-existing spec gap this surfaced but didn't fix: a foreman-written `## Amendment` in full-send satisfies the same human-reroute amendment gate a human-written one would. Worth a follow-up if that distinction matters.
- Code review ran 3 rounds and hit the auto-block cap; I accepted the implementation as-is (`canon task accept`) since the only thing left was a test-only gap (missing router coverage for a directory-form amendment and a sibling-bundle amendment), then added that coverage inline and verified it with `codex review` plus a full local re-run (lint, type-check, full suite, build, docs-refs-check, sync-templates-check) before opening this PR.
- Also fixed a stale line in `docs/codebase-map.md` that only listed `verifyBaseDrift` as a consumer of the Affected Files parser — it now mentions the new pre-flight too.
- Code review auto-blocked at the 3-round cap with one test-integrity finding left (R3-1): after full-send post-foreman enforcement moved into `checkAndRoute`, the runner-level outcome tests passed vacuously and the router lacked directory-form and bundle sibling-spec cases. The operator sanctioned code_review and the tests were fixed inline after QA, reviewed by `codex review` (clean). Mutation-checked: ignoring directory-form amendments now fails 2 tests (was 0); disabling the router block fails 2 tests (was 1).
- Carried, non-blocking: an operator override or a crash between the foreman's verdict and `checkAndRoute` can reach QA without the full-send scope check; `--pr` base-drift remains the backstop. A QA-entry check would close it; follow-up issue suggested.
