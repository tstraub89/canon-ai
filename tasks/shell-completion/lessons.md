### A test gated on an absent tool hides its own expectation until CI

*(2026-10-25, source: shell-completion)*

The fish smoke test skipped locally because fish was not installed, so its exact-match expectation (`['spec_gap']` for a `code_review` verdict list) never ran until code review read it against the generator and found the fish script printed all five verdicts. A skip-when-absent test is unverified, not passing, and its expected values can be wrong with no signal. Prevention: when a test skips for a missing tool, review its expected values against the generator by hand, make it fail under `CI`, and record the skipped rows as CI-only-verified in the handoff. Apply the same check to any other environment-gated test, such as a worktree test that skips when the git dir is read-only.
