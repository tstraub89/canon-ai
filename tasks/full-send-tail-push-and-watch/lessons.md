### Inject a concurrent base commit before ref resolution, not from a pre-push hook

*(2026-10-21, source: full-send-tail-push-and-watch)*

A real-git test that asserts "a push by SHA excludes a commit that lands after the listing" cannot inject that commit from a `pre-push` hook. Git resolves the refspec before it runs the hook, so a branch-name push and a SHA push both look correct, and the test stays green for the wrong reason. The working injection point is a `git` wrapper earlier on PATH that commits to local base and then `exec`s the real git, so the commit lands before ref resolution. Rule of thumb: for any race test around a push, check the push variant that should fail (a push by branch name) turns the test red with the injection in place, and inject from a wrapper or before the listing call, not from a hook.
