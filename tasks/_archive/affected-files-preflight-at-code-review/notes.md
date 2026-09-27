# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] Running `npm test` concurrently with `npm run build` let CLI fixtures start while tsup had cleaned dist; two temporary CLI imports failed. The sequential post-build full suite passed (1278 pass, 1 skip). Scope auto-block needs `canon task reset-code-review <id>` before a spec-only correction can resume; this is stated in the halt reason.

[implement-revision] A code-review scope auto-block can resume directly after a spec edit; `reset-code-review` needlessly archives review evidence and resets loop counters. Full-send scope must also be checked after `checkAndRoute` recovers an unfilled review, using the same directory-aware matcher as pre-flight. The reviewer artifact currently contains backticked fixture paths that make docs-refs-check and six unrelated PR-path tests fail; left untouched under the Affected Files cap.

[implement-revision] A foreman may leave partial review content without a checked verdict. Post-review scope enforcement inside the phase blocks this recoverable state and skips session persistence; enforce after the router's retry path instead. A spec-gap BLESS needs the remaining out-of-scope file list visible in both the persisted escalation and terminal banner.

[2026-09-27] Operator accepted code_review via `canon task accept` — sanctioned (agent verdict overridden). Reason: Round 3 converged: enforcement moved to checkAndRoute and verified; only R3-1 (vacuous runner outcome tests, missing router directory-form and sibling-bundle cases) remains, test-only. Human accepted; tests fixed inline after QA with codex review..
