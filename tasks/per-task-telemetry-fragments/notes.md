# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `promptQa()` exposes task identity only through formatted strings, not a task-id field or per-task Mustache list. AC-3's substituted lesson paths require changing `src/orchestrator/prompts/index.ts` as well as the QA template; the builder is absent from Affected Files (F1).
[spec] Round 2: accepted spec_review F1 (verified: `promptQa()` in src/orchestrator/prompts/index.ts passes only formatted `taskLines`/`taskScope`). Added the builder to Affected Files; AC-3 now pins single-task and bundle substitution and forbids literal `<id>` / empty-id paths.
[plan] Fold ignores CANON_METRICS_FILE_OVERRIDE / CANON_QUALITY_LOG_FILE_OVERRIDE and always targets REPO_ROOT/docs/*: the overrides redirect run-time writers only, the archive commit stages REPO_ROOT/docs paths, and ship tests' runCanon always sets the metrics override (honoring it would break AC-4(a)/(e)).
[plan] A malformed fragment or an unparseable shared log aborts --ship (fail closed, docs and fragments unchanged) rather than being skipped; spec says compute failures abort.
[plan] AC-2 wording vs. existing semantics: today's upsert lets a QA-supplied non-empty Spec verdict win; earliest-wins applies only when QA omits it (which the QA prompt instructs on re-runs). Writer kept unchanged; AC-2 test's second pass omits Spec verdict. The --ship fold reconciles shared+fragment rows with reconcileHistory, so the earliest verdict wins there (AC-4(b)).
[plan] writeQualityLogForTask keeps its signature (caller src/task/index.ts is outside Affected Files); fragment path derives from path.dirname(donePath). Override parents are not auto-created (preserves the existing unwritable-log-task warning test).
[plan] AC-10's grep criterion also requires editing the "writes or updates this task's row in place" line in docs/task-quality-log.md and its template (same files as the header blockquote).
[plan] --pr drift warning fires on --pr only (createPR), not --push, per spec wording.
[plan] Lessons fold "standard skeleton" is a minimal constant in code; the init scaffold under templates/ is not a runtime path for adopters.
[plan] docs/patterns.md may want a pitfall update about telemetry dirt now being fragment-based — outside Affected Files; QA to check per spec Docs Impact.

[implement] Runtime quality-log routing can use dirname(donePath): taskPhase already resolved that path through the active task/worktree or CANON_TASKS_DIR_OVERRIDE. This keeps src/task/index.ts unchanged and leaves getQualityLogFile as the shared-doc reader for doctor.

[implement] Full-suite scope gap: tests/run-task-safety.test.ts:4606 still asserts that an implement invocation appends to the worktree's docs/pipeline-invocations.md. AC-1 requires that doc to stay unchanged and writes tasks/<id>/metrics.md instead. The assertion cannot pass under the new contract; that test file is outside the spec's Affected Files cap and was left unchanged. Scope amendment is needed to update the stale expectation.

[implement] Fold failure coverage uses a malformed shared quality table for a real --ship abort/retry and deterministic injected rename/unlink errors for partial-apply rollback. This avoids permission-based skips under elevated users while checking both restored docs and restored fragments.

[code_review] Round 1 foreman: changes_requested for code-bugs C1 (quality-log backslash round-trip doubles on fold) and C2 (stale task-quality-log.md:13 line). Open question for human: protocol routes code-bugs to implement, but S1 (tests/run-task-safety.test.ts:4606) and S2 (src/cli/commands/doctor.ts) sit outside Affected Files; amend the spec Affected Files before/around the re-implement or npm test stays red. S3 (post-fold failure re-run vs classifyAndPreserveSharedDocDirt) needs a recovery decision.

[implement-revision] C1 reproduced before the fix: quality-log history parsing preserved paired backslashes before ordinary characters, then serialization doubled them again. The decoder now collapses pairs, preserving an unpaired legacy backslash; a done.md → QA writer → rerun → fold regression pins byte-stable judgment rows, including Windows paths, regexes, UNC paths, escaped pipes, and a trailing backslash.

[implement-revision] S1/S2 remain outside the unchanged spec file cap: the stale worktree metrics assertion and doctor's shared-log creation messages need a scope amendment. No test weakening or compatibility write to the shared metrics doc was added.

[implement-revision] S3 headless interpretation chooses documented manual recovery (review option c), retaining the automatic-retry limitation. Folded docs must be preserved before any retry; archive/commit/push failures can require manual completion after fragment deletion. This does not add retry-state machinery.

[implement-revision] docs-refs-check now fails on the pre-existing reviewer artifact, review.md lines 27 and 34, because it backticks temporary fixture paths as if they were repository files. Preserve the reviewer-authored text and carry this artifact-reference failure in the handoff.

[code_review] Round 2 foreman: C1/C2 verified fixed; verdict spec_gap. Open for human: amend Affected Files for tests/run-task-safety.test.ts (S1, sole failing test) and src/cli/commands/doctor.ts (S2); confirm S3 option (c) + Known Risks line. Foreman also neutralized two broken fixture refs it had written into review.md round 1 (they broke docs-refs-check and 6 --pr tests in iteration 1).

spec_review: Amendment round 1 requests changes: S3 needs confirmed diagnostic-failure evidence and an explicit red-first AC. Non-blocking risk correction: failed archive push leaves folded rows committed locally. Treated the existing Amendment 1 heading as the round-1 amendment; current gates accept it.

spec_review: Fresh revised-amendment review approved with nits. The deterministic failure trace and red-first AC are sufficient. An isolated rename probe confirms AC-11's existing archive destination must contain a sentinel file to force ENOTEMPTY.

[plan] Reroute 1: post-fold hint fires only when foldTelemetryFragments returned written docs; no-fold failures keep today's rethrow/die unchanged. Push failure detected by a try/catch around commitArchiveChanges (its only throw is the post-commit push), so its exported contract and the run-task-safety commit-failure test stay untouched.
[plan] Reroute 1: AC-11 archive-rename fixture must commit a sentinel file inside tasks/_archive/<id>/ (an empty dir is silently replaced by renameSync). Doctor rewording keeps "parent directory" + "does not exist" so tests/cli.test.ts needs no edit.

[implement-reroute] AC-11 red-first checkpoint reproduced all three failures before changing main.ts or the hint builder. Each test failed on the missing "Failure after the telemetry fold" reference: rename emitted raw ENOTEMPTY, commit emitted its existing abort prefix, and push emitted a raw git push failure. The rename fixture uses a non-empty archive destination with a sentinel file, since renaming onto an empty directory can succeed.

[implement-reroute] The post-fold hint is keyed to actual shared-doc writes, and one parameterized builder distinguishes uncommitted/staged rows from a locally committed but unpushed archive. No-fold commit/push failure tests still omit the hint. commitArchiveChanges retains its exported contract; only its push uses throwing git(), so the call-site catch describes an unpushed local commit.

[implement-reroute] S1's worktree fragment assertion and unchanged docs assertions pass; the supervising checkout has no implement metrics fragment in this fixture. Existing doctor tests assert status and parent-directory text, not the obsolete message, so tests/cli.test.ts needs no edit. The doctor warning now names the ship fold without incorrectly claiming a missing docs directory makes folding impossible (the fold creates parent directories).
