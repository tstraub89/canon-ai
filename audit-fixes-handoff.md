# Audit fixes handoff

Scope authorized by the user: fix the audit's two P1s, include bounded P2/issue fixes, then obtain independent Claude review. Changes remain uncommitted in the current checkout.

## Changes

- Init and upgrade reject symlinks in destination paths, including parent directories and dangling targets. The preflight occurs before writes and is not bypassed by `--force`. The shared helper allows the checkout root itself to be accessed through an alias, while refusing symlinks beneath it.
- SIGINT/SIGTERM shutdown retains child-group identities, allows three seconds for graceful termination, escalates surviving groups to SIGKILL, and allows up to one second for reaping before cleanup hooks and native signal exit. Repeated signals do not bypass supervision. Agent stream completion does not resume phase logic during shutdown.
- Follow mode reads appended log byte ranges in bounded buffers and decodes split UTF-8 incrementally. It resets on file replacement or truncation.
- GitHub [#15](https://github.com/tstraub89/canon-ai/issues/15): compound line citations accept spaces/tabs after commas, including range/approximate and GitHub-anchor forms. Root checker and shipped template match.
- Updated user-facing documentation, source map, and generated dist bundles.

## Validation

- Red-first: all eight new regression cases failed on the original implementation for their intended failure mechanisms.
- Targeted green: all eight passed after implementation.
- Final full suite after review corrections: 1,222 tests, 1,221 passed, one skipped, zero failures.
- Follow-up process/watch tests after extending replacement/truncation/repeated-stop coverage: 46 passed.
- Final lint, type checking, build, template sync, docs-reference checks, and whitespace checks passed.

Process fixtures use Node stand-ins, including an agent that ignores SIGTERM and a resistant descendant whose leader exits. They clean up their own subprocesses. No real agent session, remote write, commit, PR, or issue closure is part of testing.

## Deferred scope

The audit's Git filename parsing and unusual repository-layout bugs remain open. Phase recovery and review-evidence changes (#17, #18, #33) need their own focused work. This patch does not confine Claude execution, solve uncatchable orchestrator SIGKILL, or claim protection against a concurrently hostile filesystem swapping path components during a write.

## Independent review

Claude completed a review of the complete source/test diff and new helper with Read/Glob/Grep tools only, followed by a focused second pass of the corrections. The first pass found one P2 and three P3 findings: expected-directory stat handling, follow-mode path switching, citation-predicate consistency, and init documentation. All four were addressed. The three behavioral cases were reproduced red, then passed after correction. Claude’s focused second pass found **no remaining actionable findings**. See [the full review](audit-claude-review.md).
