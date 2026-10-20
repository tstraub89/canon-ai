# Code Review: watch-crash-not-step-done

> Reviewer: Claude (foreman synthesis: anchored Claude + cold-Claude + cold-Codex) | Spec: `tasks/watch-crash-not-step-done/spec.md`

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Caveat: `npm run build` was run, but the regenerated `dist/` was restored, so the committed `dist/` is stale (see Finding 1).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Red-first test: fresh non-zero marker gives `death` and carries the CLAUDE_BUDGET reason. |
| AC-2 | Pass | Dead-pid evidence gives `death`. |
| AC-3 | Pass | Existing `step_done` test is untouched and passes. |
| AC-4 | Pass | A clean `code=0` marker stays `step_done`. |
| AC-5 | Pass | A stale non-zero marker (older than `status.json`) stays `step_done`. |
| AC-6 | Pass | `readLastExitMarker` tests cover last-marker-wins, malformed and absent logs, and `signal:` codes. |
| AC-7 | Pass | `watchCmd` exits 4 and stdout is exactly `state=plan reason=death\n`. |
| AC-8 | Pass | One stderr diagnostic with the reason and a `canon run` hint; the SIGTERM case is covered. |
| AC-9 | Pass | Exit-code table and stderr note updated; the `templates/` mirror is identical. |
| AC-10 | Partial | Required checks ran, but `dist/` is stale (Finding 1). |

## Stage 2 — Findings

### Finding 1 — Committed `dist/` is stale (spec-gap)

- **Altitude:** spec-gap. **Source:** anchored. **Location:** `dist/cli/index.js`, bundling `src/cli/commands/watch.ts` and `src/orchestrator/run-context.ts`.
- `dist/` is tracked. CI (`.github/workflows/ci.yml`) runs `npm run build` and `git diff --exit-code -- dist/`, so the PR fails with "dist/ is out of date". Adopters installing from git would also keep the old behaviour. Earlier feature PRs (#88, #89, #91) committed `dist/` alongside `src/`.
- The spec lists `npm run build` under Validation Required but omits `dist/**` from Affected Files, and the validation gate has no `dist/` exemption. Codex therefore reverted the build output, which followed the written spec.
- **Fix:** amend the spec's Affected Files to include `dist/**`, then rebuild and commit `dist/`.

### Nits (non-blocking)

1. `docs/pipeline-orchestrator.md:~45` and its `templates/` mirror: the stderr sentence sits between the "Summary line … `key=value`:" lead-in and its code block. Move it below the block. Flagged by anchored and cold-Claude.
2. `src/cli/commands/watch.ts:~442`: on the dead-pid branch the generic reason drops a more specific non-zero marker reason, if both exist. The spec only requires the generic text.
3. `tests/watch.test.ts`: no coverage for the 1s tolerance boundary or the `statSync`-failure fallback, which treats the marker as fresh. Existing `classifyIdle` tests that use the default `/tmp/t1` task dir read the real filesystem, so a leftover `/tmp/t1/.canon-run.log` could affect them (cold-Claude, test-isolation hazard; low).
4. `EXIT_MARKER_RE` is not anchored at line start, so a mid-line 64 KiB tail boundary or quoted marker text can match (anchored and cold-Claude; low). It is also greedy in `[reason=(.*)\]`, and it requires the marker to be the last content on its line.
5. `changes_requested` branch of `classifyIdle` returns `step_done` without crash evidence (cold-Claude; low). It is a sibling gap outside the spec's `pending`/`in_progress` scope. Consider a follow-up.
6. `status.json` mtime freshness is a heuristic: a later `status.json` write masks a crash, and the 1s slack can misreport a stale marker (cold-Claude; low). This is the spec's chosen design, and AC-5 pins it.

## Dismissed Cold Findings

- Dismissed (cold-Claude): a dead-pid check could produce a false exit 4 if a clean exit leaves `.canon-pid` or the heartbeat behind. `bootHeartbeatWithHooks` registers `process.on('exit', cleanupCanonPids)` and `stopAllHeartbeats`, so both are removed on clean exit paths. The finding was low-confidence and unverified, and a live pid does not override `step_done`.
- Dismissed (cold-Claude): `reportInitialFailure` and `classifyAttach` do not consult the exit marker. The spec scopes the change to `classifyIdle`, and the finding names no concrete wrong output.
- Dismissed (cold-Codex): no findings.

## Final Verdict

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap
