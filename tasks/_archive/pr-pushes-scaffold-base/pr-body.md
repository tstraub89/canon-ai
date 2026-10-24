# PR Body: pr-pushes-scaffold-base - --pr and --push push canon's own scaffold commits to base

## Summary

- `--pr` and `--push` now push canon's own scaffold commits to the base branch before the base-divergence check, the same way `--full-send` already did. You no longer push the base by hand before a non-full-send task's PR can open.
- The push is all-or-nothing. It runs only when every unpushed base commit is a task scaffold or pipeline telemetry commit. Any other commit blocks the whole push, and the existing divergence gate stops the run.
- If the base branch exists only locally, `--pr`/`--push` create it on origin when every local-only commit is canon's own, or when every commit is already on a live origin branch. A branch with your own commits is refused, even with `--allow-divergent-base`.
- A rejected base push now distinguishes a non-fast-forward (origin's base moved ahead, so the message says to rebase) from a protection-style rejection.
- A fetch failure during `--full-send` warns and skips the base push instead of stopping at the fetch.
- `--full-send` and `--pr`/`--push` share one helper. The old full-send-only push is removed.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- `docs/decisions.md` records the consent decision. It reverses the archived full-send-only non-goal in `tasks/_archive/full-send-tail-push-and-watch/spec.md`.
- `--allow-divergent-base` on an existing base now means "try the safe push, and continue if it is refused." It never bypasses a missing remote base or a rejected creation push.
- Creating a missing remote base is a new outward action. It is limited to the cases above, and an empty local-only range publishes no new commit.
- Non-fast-forward detection matches git's stderr wording. A git version with different wording falls back to the generic rejection message.
- Still to run by hand against a real GitHub remote: the protected-main and moved-main scenarios. The automated tests used local bare origins, real git, and rejecting hooks.
- Non-blocking review nits are open (fetch-prune refspec scope, push ordering before local preconditions, one weak probe assertion).
