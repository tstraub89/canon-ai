# Spec Review: rest-forge-pr-calls

Reviewer: Codex | Spec: `tasks/rest-forge-pr-calls/spec.md`

## Shape Check

No concerns. The problem is confirmed with an executed GraphQL-blocked call, and the spec records an executed REST-wrapper run that completed PR creation and shipping. AC-8 adds a regression test for the reported failure mode.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

## Amendment Review
- [x] **Changes requested**
> Findings:
> - **Shape Check (blocking):** Amendment 1 addresses two bug fixes, but its Problem/Why section does not provide the confirmation evidence required by the diagnosis checkpoint. It explains the proposed `gh api` host mismatch and says round 2 found malformed `-R` handling, but gives no trace with verified trigger values showing either behavior. Add deterministic evidence for the Enterprise `origin`/GitHub.com default case and a concrete `-R` value that is mishandled and falls back to cwd; the reviewer needs to assess whether those inputs establish the stated root causes.
> - **Shape Check (blocking):** AC-13 and AC-14 require tests for the new cases but do not require a red-first regression test that fails against the pre-amendment implementation. State that the host-routing and malformed-`-R` regression tests are run against pre-fix code and fail for the corresponding reasons, or use the explicit environment-bound-and-impractical escape with a named deterministic alternative. The original AC-8 red-first test covers the GraphQL-blocked REST migration, not these amended bugs.

## Amendment Review
- [x] **Changes requested**
> Findings:
> - **Integration (blocking):** The existing “REST always vs fallback” judgment call still says `gh api` uses the same host resolution as porcelain. Amendment 1's executed confirmation establishes the opposite: with an Enterprise `origin`, `gh api` sent the request to `api.github.com` while `gh pr` used the Enterprise host. Update that judgment call so the approved spec and amendment do not make contradictory claims about host resolution.

## Amendment Review
- [x] **Changes requested**
> Findings:
> - **Integration (blocking):** The amendment says the *Repo addressing* judgment and *Multiple remotes* Known Risk are superseded, but both original statements remain unchanged. The judgment still says gh's placeholders follow gh's host resolution, including Enterprise hosts, matching porcelain; the Known Risk still says `gh repo set-default` behavior is unchanged. These conflict with the amendment's confirmed host mismatch and its new unsupported cross-host `set-default` case. Rewrite or remove both stale statements so the original spec and amendment describe slug resolution separately from API host selection.

## Amendment Review
- [x] **Approved with nits**
> Findings:
> - AC-13 tests the no-`origin` case, but the Change to the Decision also specifies omitting `--hostname` when an `origin` URL exists and cannot be parsed. Add a malformed-origin argv case to pin that fallback. This is non-blocking because the behavior is stated clearly and the listed AC cases remain verifiable.

## Amendment Review Round 2
- [x] **Approved with nits**
> Findings:
> - **Verification (non-blocking):** The revised rule says explicit hosts from `-R HOST/OWNER/REPO` or a PR URL are normalized without the auth-token gate, but AC-16's listed cases cover `origin` hosts and the cwd fallback only. Add a case for an explicit `-R` or PR URL host such as `api.github.com` and assert it becomes `--hostname github.com`. The behavior is clear and the amendment is otherwise coherent; this is a coverage gap, not a blocker.
