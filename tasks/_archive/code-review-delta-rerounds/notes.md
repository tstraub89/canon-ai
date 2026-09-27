# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
- spec (rev 1): addressed spec_review r1 rename finding — trigger-4 path sets now rename-aware (AC-14, red on post-image-only). Scenario verified in scratch git: prior deletes Y, fix `git mv X Y` → name-only {Y}, name-status R100 X Y.
- [implement] The pure review-scope resolver repeats the small task-artifact/telemetry path predicate because importing orchestrator worktree state would break the policy module's no-I/O boundary. A later consolidation could move the shared rule to a pure module.
- [implement] A malformed numbered archive without a parseable round cannot be attributed to one loop. If no valid previous-round record exists, scope falls back to full and names the malformed archive; this is conservative.
- [implement] The rename regression's post-image-only mutation returned only Y, while the correct name-status collector returned X and Y; the targeted red and green runs confirmed the test guards trigger 4.
- [implement-revision] Git's synchronous diff probes can fail on large output (including the default maxBuffer limit). Empty output and probe failure now have separate representations; review scope falls back to full when a required delta fact is unavailable.
- [implement-revision] Capture reviewed HEAD before cold-Codex runs. A later HEAD move must not advance the archive's reviewed SHA past what the cold lens could have seen.
