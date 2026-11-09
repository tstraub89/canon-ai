# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- spec: revised after spec_review round 1: fix-up now also follows the recovery session (AC-10); verdict guard runs on failed fix sessions (AC-3). Reused stored reviewer session id rather than lastSessionId.
- spec: revised after spec_review round 2: reviewer-blocked reviews get no fix-up (not done; reset re-runs foreman which gets its own); AC-6 narrowed to spec_gap + blocked-no-fixup test.
- spec: revised after spec_review round 3: archived review-prior-N.md now exempt in docs-refs-check (blocked-review → reset flow, AC-11); judgment call recorded (Author).
- [plan] No spec contradictions. Judgment calls: (1) the post-fix-session 'could not inspect the working tree' stop also auto-blocks code_review via the onStop callback (same hazard as scope stop). (2) Interactive mode, or a foreman return without a captured session id, passes sessionId=null so a stale stored reviewer id from an earlier round is never resumed. (3) At-most-one fix-up falls out of control flow (post-foreman runs only if all tasks done; recovery fix-up only if recoverPhaseForTask ran), no module flag.
