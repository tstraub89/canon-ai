# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Installed-package detection based only on `__dirname` being outside `REPO_ROOT` misclassifies native source executed from a linked worktree: `scripts/run-task/env.ts` intentionally anchors `REPO_ROOT` at the supervising checkout via `--git-common-dir`, while the active worktree path differs.

[spec_review] Revised precedence still risks misclassifying an installed package when the adopter checkout is itself a git submodule: `captureCanonSnapshot()` currently treats any `--show-superproject-working-tree` result at `REPO_ROOT` as canon-vendored before an installed-source check, so the adopter HEAD can remain stamped as canon's `upstream_commit`.

[spec_review] AC-5b now covers installed source plus adopter superproject precedence, but does not assert `orchestrator_commit` remains the distinct host HEAD; an implementation could suppress `upstream_commit` while silently changing or dropping the host-driving field.

[spec_review] AC-2 requires a behavioral red-first test with injected source-path and baked-version seams, but the current typed `CanonSnapshotOptions` only has `runGitAt`/`runCommand`; adding those seams is part of the fix, so the spec needs a type-safe pre-fix fixture strategy rather than an implicit compile failure or untyped cast.

[spec_review] The revised AC-4b promises the linked-worktree checkout's commit, but `refreshCanonSnapshotAtPath()` currently hardcodes `captureCanonSnapshot(REPO_ROOT, ...)` while `env.ts` anchors `REPO_ROOT` at the supervising checkout; a source-path classification seam alone does not select the worktree git root for the production writer.

[spec_review] The revised behavioral spec no longer names the persisted version field, although `CanonStamp` uses explicit snake_case field names; AC-3/AC-7 need to state the exact field (the intended `canon_version`).

[spec_review] A real submodule fixture shows `git rev-parse --git-common-dir` returns the host `.git/modules/<submodule>` directory; `env.ts` then derives a `.git` path as `REPO_ROOT`, while the existing vendored snapshot test bypasses this by injecting a synthetic submodule path. AC-5 claims vendored behavior is guarded but does not cover this live root-resolution topology.

[spec] Round-3 resolution: AC-5b now asserts `orchestrator_commit === <host HEAD>` with three distinct SHAs in the fixture (adopter HEAD, host HEAD, canon slug). Confirmed against canon-snapshot.ts:69-70 — in installed+adopter-is-submodule mode orchestrator_commit resolves from the non-empty superproject probe to the host HEAD, so locking it to host HEAD both matches current resolution and blocks an implementation that suppresses upstream_commit while dropping/relabeling the host-driving field. Round shape read: r1 (worktree) + r2 (submodule) hardened detection against real git topologies; r3 is single-assertion edge-fine-tune, converging — not a redesign signal.

[2026-07-22] Operator accepted spec_review via `canon task accept` — sanctioned (agent verdict overridden). Reason: Operator sanction: 6 spec_review rounds, Shape Check clean throughout; all in-scope findings addressed. Round 6 targeted pre-existing untouched vendored code (out of scope). Churn diagnosed as a 5.6-reviewer/prompt-calibration artifact, not a spec defect. code_review is the downstream backstop..
[implement] `refreshCanonSnapshotAtPath` deliberately captures git state from `REPO_ROOT`, so installed refresh fixtures must key fake git responses to the active supervising checkout rather than the temporary status-file directory.
[implement] `docs-refs-check` treats literal backtick paths as references; the decisions note describes the updater's `.canon` receipt without naming the non-existent file path directly so the required docs check remains clean.

