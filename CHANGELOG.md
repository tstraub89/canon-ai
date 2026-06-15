# Changelog

> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [Unreleased]

## [1.12.1] — 2026-06-14

### Fixed

- **`canon run <id> --reroute` now auto-detaches**, so rerouted pipelines survive operator-session kills, SSH disconnects, and harness process-group kills. Previously, bare `--reroute` ran the phase loop in the foreground and was orphaned on any parent kill — each orphan required a manual `canon run` recovery. The reset banner and invalid-reroute errors still print inline before detaching; monitor the rerouted run with `canon watch`. The stepped escape hatch is now a single combined command: `canon run <id> --reroute --step --expect <phase>` (full tier: `spec_review`; fast tier: `implement`). The previously-documented two-command sequence is removed — it would otherwise launch two orchestrators on one worktree.
- **`docs-refs-check` now validates the base file path of line-cited backtick refs.** Previously any ref with a line-citation suffix (`:151`, `:10-20`, `#L10-L20`, `:151,254`, etc.) bypassed the missing-file check entirely — adding line numbers made a ref *less* validated. The citation suffix is now stripped and the base path is checked, so a misspelled path stays visible even with line numbers. Comma-list citations (`:151,254`) that previously triggered false-positive "missing file" errors on legitimate refs now pass when the base file exists.
- **`docs-refs-check` gitignore-skip is resilient to unprocessable paths in the candidate batch.** A path that causes `git check-ignore` to exit 128 (e.g., one traversing a symlinked directory) previously disabled gitignore-skip for the *entire* run — silently reporting every gitignored ref as "missing file." The batch now bisects on exit 128, isolating the unprocessable path without affecting its siblings.

## [1.12.0] — 2026-06-12

### Added

- **`canon task reset-code-review <id>` — a safe, helper-driven recovery from a `code_review` auto-block.** It archives the prior `review.md`, zeroes the current-loop counters, clears the stale verdict, and re-derives the top-level status (the `code_review` analogue of `reset-spec-review`). The auto-block recovery message now points operators at this command instead of telling them to hand-edit `status.json`.

### Fixed

- **The worktree is clean when `human_review` opens.** QA-phase output (task artifacts, review notes, QA summary, pr-body draft, and any managed-doc edits) is now committed in a single `chore: QA artifacts for <id>` commit at the QA→`human_review` boundary instead of staying uncommitted until `--pr` — so `--reroute` and base-drift rebases run against a clean tree.
- **`canon run --pr` sets the upstream tracking ref on the pushed task branch.** `git push` was bare, leaving the local branch with no configured upstream. Now `git status` shows the branch up to date with `origin/<branch>`, and bare `git pull` / `git push` work without spelling out the remote and branch. Re-running `--pr` stays idempotent.

### Removed

- **The unenforced "branch is current with `origin/<base>`" checkbox is gone from the handoff template.** Nothing parsed it; it attested to branch sync the orchestrator already owns (and the implementer can't touch `.git`), and satisfying it with a mid-task rebase would corrupt the baseline the reviewer diffs against.

## [1.11.2] — 2026-06-11

### Fixed

- **Fast-tier auto-advance no longer trips its own phase gate.** The orchestrator's fast-tier `spec_review` auto-advance (and the documented operator command `canon task phase <id> spec_review done approved`) failed with "no checked verdict checkbox" because nothing ever wrote to the stub `spec-review.md`. The orchestrator now records the human's conversational approval in the artifact (checked **Approved** box + provenance note) before advancing, keeping the gate intact; CLAUDE.md and the `canon-spec` skill document the same step for the operator path.
- **`/canon-pipeline` and `/canon-init` no longer ship dead links.** `canon-pipeline/recovery.md` (the snag-recovery runbook) and `canon-init/write-guide.md` (the Phase 4 doc-writing guide) are now in `CANON_OWNED` and reach adopters via `init`/`upgrade`. The `canon-init` permission-allowlist step also inlines the recommended block instead of pointing at canon's own README, which adopters don't have.
- **Docs accuracy pass over the delivered surface**, verified claim-by-claim against the implementation: `AGENTS.md` no longer claims XL/delicate implement runs at `xhigh` (it runs at `high`, deliberately); `--ship`'s teardown/archive ordering is stated correctly (worktree teardown before archive); worktree isolation is documented as the scaffolded default (`canon task new` writes `worktree: true`; only an absent field falls back to main-checkout mode); the `canon run` flags table gains the missing `--force` and `--full-send` rows; the env-var table gains `CANON_WORKTREES_ROOT`, `CANON_PR_BODY`, `MAX_CONTEXT_BYTES`, and `CANON_NO_DETACH`; the auto-detach note now says one-shot modes (`--step`, `--pr`, `--push`, `--reroute`, `--ship`) stay foreground; the `human_review` allow-list documents the directory-form (`dist/`) carve-out; auto-block docs cover the pre-flight-rejection counter; and the `status.json` template's `_pr` comment points at the real `.pr-number` sidecar mechanism.
- **Stale skill runbooks corrected.** `/canon-pipeline`'s ship section described the pre-v1.9 external-merge flow (now: `--ship` merges itself — don't merge manually) and its reroute section omitted the mandatory `## Amendment` heading and full-tier `spec_review` re-entry; `/canon-status` now reads live task state via `canon task status` instead of stale REPO_ROOT `status.json` copies; `/canon-spec`'s S-size heuristic matches the sizing table (1–3 files); the fixed 1.4.x `--ship` ENOENT limitation is removed from recovery.md.

### Changed

- **`review.md` template drops the "Needs re-review" verdict checkbox.** The verdict was routed and counted identically to `changes_requested` everywhere, so the menu offered two names for one behavior. The parser still accepts `needs_re_review` from existing artifacts.
- **`done.md` template gains the "Proposed Changelog" section** the QA prompt requires and `/canon-changelog` consumes, so the structure no longer depends solely on prompt compliance.

## [1.11.1] — 2026-06-11

### Fixed

- **`canon task accept` can no longer sanction a review that never ran.** For `spec_review`/`code_review`, accepting a task whose phase has no recorded verdict now refuses with an actionable message before mutating any state — bundle-atomic, naming the verdict-less task(s). `--force` remains the explicit bypass (an infrastructure-halted block carries no verdict and intentionally requires it); blocked reviews with a real verdict sanction exactly as before.
- **Mixed-bundle spec_gap recovery now works as documented.** Following the recovery banner — amend only the gap task's spec — no longer aborts `--reroute` on an approved sibling: the `## Amendment` requirement is scoped to `spec_gap` tasks on the spec_gap entry point (the human_review reroute still requires amendments from every task). Exempt siblings ride the bundle without amendment artifacts at any downstream gate, with collision-free round numbering for later reroutes. Exemption is verdict-aware: an approved sibling is re-verified for shared behavior only, while a sibling blocked with `changes_requested`/`needs_re_review` keeps its review findings binding — the reroute prompts direct the implementer at its existing `review.md` instead of calling it approved.
- **A status-claimed `implement: done` is honored only with real handoff evidence.** If the implementer died after marking the phase done but before finishing `handoff.md` (or a fresh `canon run` encounters that stale state), the orchestrator now treats the task as not-done and routes it through the existing recovery flow — session preserved, one-shot resume retry — instead of advancing and wedging at auto-commit with a hand-edit of `status.json` as the only way out. "Retry succeeded" is only logged when evidence actually passes, and deletion-only implements count git-tracked deletions as evidence.
- **Every orchestrator exit now writes a final, grep-able marker line to the run log** — `■ orchestrator exit code=<N> [reason=…] at <timestamp>` — covering agent-CLI failures (with a budget-exhaustion hint on Claude non-zero exits), `die()` including pre-boot argument/dependency failures, phase auto-blocks, uncaught exceptions/rejections, and graceful signal stops (`canon stop`, Ctrl-C). Multi-line reasons collapse to one line. A run log that ends without a marker now reliably means an un-catchable kill (SIGKILL/OOM), which the heartbeat + `canon doctor` staleness check still covers. The larger no-`process.exit`-in-agent-wrappers refactor remains scheduled for v1.12.

## [1.11.0] — 2026-06-10

### Added

- **`canon upgrade` now nudges you when it changes a canon task template you've overridden.** If an upgrade touches a `.canon/templates/<name>` you've customized under `tasks/_templates/`, it lists the affected override and a `diff` command to reconcile — silent when the template is unchanged or your override already matches. Respects `CANON_TASKS_DIR_OVERRIDE`.
- **Two audited paths to recover from an agent review you disagree with.** When `code_review` returns `spec_gap`, the recovery block now offers a **fix** path — amend `spec.md` and `canon run <ids> --reroute` (now allowed from a spec_gap-blocked `code_review`, running the full reroute machinery: spec re-review, plan refresh, `reroute_count` increment) — and a **bless/override** path — `canon task accept <ids> {spec_review|code_review} --reason "<why>"`, which sets a new `sanctioned` verdict plus a `notes.md` + `operator_accepted*` audit trail. A mandatory `--reason` is required; `sanctioned` can't be minted via `canon task phase` (the paper trail is guaranteed). Both paths are bundle-aware. Replaces the old unaudited `canon task phase … pending` recovery recommendation.

### Changed

- **Code review re-baselined for the Opus 4.8 / Sonnet 4.6 generation.** The two review lenses (anchored + cold) now over-report — surfacing low-confidence and low-severity findings tagged with explicit `Severity` + `Confidence` — and the synthesis foreman ranks and filters, rather than the lenses self-censoring. This counters the literal-instruction recall suppression measured on Opus 4.8, where conservative "only high-severity" prompts drop real-bug recall, not just noise. The round-3+ iteration tightening is now a foreman synthesis-stage filter, so it no longer tells the lenses to stop reporting. The updated lens definitions ship to adopters via `canon upgrade`.
- **Model + effort tiers re-baselined: `code_review` L → Sonnet 4.6, and `implement` XL/delicate effort `xhigh` → `high`.** Sonnet 4.6 matches the prior Opus flagship on long-horizon / lifecycle / state-machine bug detection — the capability that forced the original L→Opus bump on Sonnet 4.5 — so L review returns to Sonnet at a fraction of the cost (Opus reserved for XL/delicate). Separately, XL/delicate `implement` eases from `xhigh` to `high`: GPT-5.5 overthinks at `xhigh` with open-ended tool access (cost/latency without quality gain), and canon favors token discipline over reflexive max-effort. Override via `CLAUDE_MODEL_REVIEW` / `CLAUDE_MODEL_REVIEW_LARGE` and the Codex effort env. Claude review effort floors were audited as already adequate. Rationale: [`docs/decisions.md`](docs/decisions.md) §"Model-generation re-baseline (2026-06)".
- **Agent guidance hardened from this release's dogfood cycle (lessons sweep).** `AGENTS.md`: on rerouted/revised tasks the pre-flight diff is cumulative — handoffs must cover files committed by earlier phases. `CLAUDE.md`: a feature that mirrors an existing path/state resolution must call the existing resolver, never reconstruct the common-case default. The `review.md` template now documents that administrative appends must not use `## Round` headings (the verdict parser scopes to the latest Round). All ship to adopters via `canon upgrade`.
- **Claude phase budget now scales by effective task size instead of a flat $5.** S/M tasks keep the `5.00` cap; L gets `10.00`; XL and `delicate: true` get `20.00` — sized for an Opus `code_review` foreman fanning out two review lenses over a large diff, which previously exhausted the flat cap mid-phase. Setting `CLAUDE_BUDGET` still overrides everything with a flat cap. Interactive sessions (`--interactive`) are excluded: the Claude CLI's budget flag is print-mode-only, so they run uncapped as before.

### Fixed

- **`canon run --pr` no longer cancels its own CI run.** Previously `--pr` pushed two commits (artifacts, then `chore: record pr.number`), firing two `pull_request` events in the same CI concurrency group — whichever run lost the race was cancelled, red-badging the PR head on essentially every canon PR. The PR number now lives in a gitignored task-local sidecar (`tasks/<id>/.pr-number`), so `--pr` makes exactly one pushed commit and the head gets exactly one CI run. `--ship` reads the sidecar for merge evidence — honoring bundle-secondary worktrees and `CANON_TASKS_DIR_OVERRIDE` — and falls back to branch-lookup for tasks created before this release.
- **`CLAUDE.md` now tells agents not to infer phase progress from artifact files.** `canon task new` scaffolds every artifact up front, so the presence of `review.md` / `done.md` (or stub content in them) says nothing about whether a phase ran — phase state lives only in `status.json`. Ships to adopters via `canon upgrade`.
- **`human_spec_gate` is now documented as a single-use latch, not a persistent toggle.** Operators saw the flag flipped to `false` mid-pipeline and assumed the spec gate was bypassed; in fact the orchestrator consumes the latch *at the halt* (`true`→`false` + banner + exit) so the post-approval `canon run` passes through instead of re-halting. A new "Spec gate is a single-use latch" section in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md) covers the per-tier firing points and bundle rule; `CLAUDE.md` carries a one-line summary. Ships to adopters via `canon upgrade`.

## [1.10.2] — 2026-06-07

### Fixed

- **`--ship` is now resilient to interrupted runs, already-deleted remote branches, and stricter about merge evidence before local branch deletion.** After a partial ship (squash-merge landed but pull/archive aborted), a re-run fast-forwards the local base branch and completes cleanly — the non-destructive fast-forward no longer blocks. Remote branch cleanup that finds the ref already gone (e.g. GitHub's auto-delete-head-branches) is treated as a no-op. Merge verification keys off the PR number `--pr` pins in `status.json` (base-ref match + head-ancestor check) rather than a branch-name lookup — closing a data-loss path on branch-name reuse; tasks created before this release fall back to the branch lookup under the same head check. `--force` does not bypass the merge-evidence gate.
- **Pre-flight now correctly preserves a completed `review.md` when the foreman nested round-1 under `## Round 1` / `### Stage 1` instead of the H2 template structure.** `hasPriorRealReview` (and its bundle counterpart `bundleHasRealPriorReview`) now accept `### Stage 1` inside a real `## Round N` section (digit — not the comment scaffold's literal "Round N"). The foreman template instruction is also tightened to explicitly forbid wrapping round-1 in a `## Round 1` container.
- **`canon task phase <id> <phase> pending` now clears the prior `verdict`.** The `spec_review` and `code_review` reset paths previously left it in place; the next review round now always starts with an empty verdict field.
- **The `canon-spec` skill now applies the same replacement-framing guidance as `CLAUDE.md`.** It prefers a single replacement statement backed by a structural/grep AC over paired "remove X"/"add Y" bullets (the style v1.10.1 established), and its Non-Goals check steers load-bearing exclusions toward positive/structural framing.
- **The Negation Neglect citation in `CLAUDE.md` is reworded as a scoped markdown link referencing the paper's finetuning result and its local-vs-separated negation contrast**, removing wording that over-implied the paper demonstrates in-context instruction-following failures.

## [1.10.1] — 2026-06-06

### Changed

- **Spec-authoring guidance now favors replacement framing and structural assertions over prose negations.** The "Name effects to DELETE" rule recommends stating supersession as a single replacement ("replace `oldFn` with `newFn`; `oldFn` must not exist after") rather than an add bullet beside a separate remove bullet, and a new rule of thumb prefers grep-backed or positively-framed constraints over bare "we are NOT doing X" prose for load-bearing exclusions. Ships to adopters via `canon upgrade`.
- **Clarified that round 2+ amendments must use the `## Amendment Round N` heading.** The reroute step-guard guidance now spells out that the orchestrator matches on that heading, so a bare `## Amendment` on a second-round amendment won't be picked up.

## [1.10.0] — 2026-06-06

### Added

- **`code_review` now runs as a synthesis foreman over two independent review lenses.** An *anchored* lens applies the existing spec-compliance + code-quality charter; a *cold*, spec-blind lens reads the diff adversarially with no spec context. The foreman deduplicates them, drops cold findings the spec shows are intended, classifies the rest as code-bug vs. spec-gap, and writes the single review + verdict. Phase order, reroute target, bundle behavior, and model tier are unchanged; the new lens definitions ship to adopters via `canon upgrade`.
- **New `spec_gap` verdict halts `code_review` for a human spec fix instead of looping back to the implementer.** When a finding's real cause is a missing or wrong requirement — not a coding mistake — the reviewer returns `spec_gap`, which blocks for amendment rather than burning another implementation pass. Recover by amending the spec and re-running.
- **`--pr`/`--push` now runs `docs-refs-check` before committing task artifacts, if your project has adopted it.** Broken backtick refs in `done.md`, `review.md`, and `pr-body.md` are caught at push time rather than after CI fails, with the same actionable finding list the CI gate prints. The gate is skipped automatically when `scripts/docs-refs-check.mjs` is absent. `--force` bypasses it, consistent with the base-drift gate.

### Fixed

- **Pre-flight rejection in bundle mode is now all-or-nothing.** When any task in a bundle fails handoff pre-flight, all sibling tasks now receive the same outcome. On the fixable route (`format`/`regression` blocker), all tasks get `changes_requested` and the bundle reroutes to implement together — ending phantom solo Claude retries for clean siblings and divergent per-task counters. On the blocked-only route (infrastructure unavailable), all tasks receive a halt stub `review.md`; previously clean siblings were auto-blocked with no artifact and an incomplete audit trail.
- **`### Affected Files` sections with multiple tables are now fully parsed.** The `--pr` base-drift allow-list and the implement-prompt file preload previously stopped reading at the first blank line, silently dropping any paths declared in a second (or later) table under the same heading. All table blocks are now collected. `extractAffectedFiles()` in the context preloader is unified with `parseAffectedFilesFromSpec()` so both consumers see the same paths, including Amendment sections and markdown-link cell formats.
- **Pre-flight now classifies a failed check by who can fix it instead of always blaming the handoff.** Format problems (missing tables, malformed rows, unfilled template) say "fix the handoff"; a real `Fail` says "fix the code" and names the check; infrastructure failures halt for human triage. As part of this, a `Fail – unrelated` label that cites a file the task itself changed is rejected — a regression can no longer slip through by calling its own failure "unrelated."
- **`canon task list` no longer lists the `tasks/_templates` override directory as a task.** Projects that add `tasks/_templates/` to customize their scaffold saw it appear as a spurious (often "invalid") row; it's now skipped, like `_archive`.

## [1.9.1] — 2026-06-04

### Fixed

- **`--reroute` help text now reflects v1.9.0's tier-specific re-entry.** `canon --help`, `canon run --help`, and the README quick reference still said `--reroute` sends a task back to `implement` — true only for fast-tier. They now state that full-tier tasks (M/L/XL or delicate) re-enter at `spec_review` while fast-tier (S) re-enter at `implement`, matching `docs/pipeline-orchestrator.md`. An operator following the old help could hit a phase mismatch running `--step --expect implement` after a full-tier reroute. ([#135](https://github.com/tstraub89/canon-ai/issues/135))

## [1.9.0] — 2026-06-04

### Added

- **`canon-changelog` and `canon-pipeline` are now release-format-agnostic.** Both shipped skills match your project's *existing* CHANGELOG style instead of imposing canon-ai's bracketed form, and the release-branch flow is an optional recommendation rather than a mandate — adopters with any release process can use them unchanged.
- **QA drafts the PR body for `canon run --pr`.** The `qa` phase writes `tasks/<id>/pr-body.md` — an outward-facing description filling your repo's PR template (or a default skeleton), no tool attribution. `--pr` uses it for single-task runs and falls back gracefully when it's absent; QA never blocks on it. Scaffolded by `canon task new`, synced by `canon upgrade`.

### Changed

- **Full-tier reroutes now re-enter at `spec_review` + `plan`, not just `implement`.** A full-tier (M/L/XL/delicate) amendment gets the same review altitude as its original spec — Codex re-reviews it (and its interaction with approved ACs) before re-implementation, and a `changes_requested` amendment stops cleanly for revision. Fast-tier reroutes are unchanged. **Operator note:** `--step --expect` after a full-tier reroute now expects `spec_review`, not `implement`.

### Fixed

- **`canon watch` no longer false-idles during the plan→implement worktree flip.** A ~30s window where the heartbeat resolver pointed at the still-empty worktree dir could trip a false healthy-stop (`exit 0`) while the run was alive. The worktree is now seeded with a heartbeat the moment it's created (covering bundle secondaries too).
- **Pre-flight rejection counter resets after a real review round.** It previously stayed ≥ 1 after a `changes_requested` round, so every subsequent re-implementation got the "fix your handoff" prompt instead of the reviewer's actual findings until the auto-block cap fired. Now resets on any real verdict; the auto-block safeguard for pure pre-flight loops is preserved.
- **`/canon-status`'s status header no longer silently fails the permission gate.** Its `` ```! `` pre-exec block used nested command substitution (`$(...)`), which can't be allowlisted, so the header failed on every run. Now uses the `@{u}` upstream ref, with `Bash(git rev-list *)` added to `allowed-tools`.

### Removed

- **`CODEX.md` is no longer scaffolded or managed.** No tool read it — the Codex CLI loads `AGENTS.md` natively. `canon doctor` warns (never deletes) on a stale copy; its file-revert guidance moved to `AGENTS.md`.
- **`canon task release-init` has been removed.** It hardcoded canon-ai's changelog format and overwrote `.canon/version` (canon's vendored-files version), making it unusable by adopters. Release branches still start from `main` — follow your project's own release steps.

## [1.8.2] — 2026-05-31

### Fixed

- **The QA phase no longer autonomously rewrites `docs/lessons-learned.md` or promotes entries into permanent docs.** When the lessons-learned buffer exceeded ~15 entries, the QA-phase prompt instructed the agent to run a full "lessons sweep" — promoting entries into `docs/patterns.md` / `docs/decisions.md` / `AGENTS.md` and pruning or editing entries belonging to *other* tasks — with no human-approval gate (and a watchdog `SIGTERM` mid-sweep could strand the docs in a half-promoted state). QA is now strictly **append-only**: it adds only the current task's own entry, still corrects stale references in protected docs via the Docs-freshness step, and when the buffer exceeds ~15 entries it merely *signals* in `done.md` that a human sweep is due. Promoting and pruning the buffer is now a human-initiated, human-approved action, documented as such in the scaffolded `docs/lessons-learned.md` and across the canon-managed docs.

## [1.8.1] — 2026-05-31

### Fixed

- **`canon upgrade` no longer leaves a half-applied docs-refs cutover.** 1.8.0 deferred overwriting the canon-owned `scripts/docs-refs-check.mjs` (requiring a second `canon upgrade`) while updating its `scripts/docs-refs-check.mjs.d.ts` in the same run — leaving the type declaration describing an API the held-back checker lacked, and the scaffolded `scripts/docs-refs-config.mjs` inert until the re-run. The checker and its `.d.ts` now overwrite together in one pass. `scripts/docs-refs-config.mjs` stays adopter-owned (scaffolded only when missing, never overwritten); when a pre-split checker is replaced, upgrade prints a heads-up to recover any inline `noisySourcePaths` / `validDirs` / `markdownRootDirs` customizations from git history (`git diff HEAD -- scripts/docs-refs-check.mjs`) into the config. The warning fires whenever the installed checker predates the config split, even if a config file already exists (e.g. after an interrupted earlier upgrade).

## [1.8.0] — 2026-05-31

### Added

- **`canon watch <id>`.** Blocking observer for detached pipeline runs. Attaches to an already-running orchestrator, streams `phase X → Y` transitions to stderr, and exits with a machine-parseable summary line (`state=… reason=…`) plus a classified exit code: `0` healthy stop (checkpoint / complete / `--step` done), `2` nothing-to-watch / read error / ambiguous PID, `3` auto-block, `4` crash, `5` timeout. Flags: `--until <phase>` (return early when a phase settles), `--timeout <dur>`, `--follow`/`-f` (tail the run log). Refuses to attach when `.canon-pid` and a live heartbeat PID disagree (PID-reuse safety). Settle detection is liveness-gated: a heartbeat that goes stale during a between-phase synchronous window (scaffold commit, `git worktree add`, node_modules symlink, agent session-init — all block the event loop so the heartbeat timer can't tick) does not trip a false `step_done` while the orchestrator pid is still alive and unblocked. Pair with `canon run <id>`: run detaches, watch blocks.
- **Canon manages runtime-file `.gitignore` patterns across `init`, `upgrade`, and `doctor`.** `canon init` ensures an adopter's `.gitignore` contains a canon-owned `# canon:start`/`# canon:end` block with the three orchestrator runtime patterns (`tasks/**/.canon-pid`, `tasks/**/.canon-run.log`, `tasks/**/.heartbeat.json`), so they stop surfacing as untracked. `canon upgrade` retrofits and refreshes the block on existing adopters, routing through the standard dirty-refusal/`--check`/`--force` queue; a malformed block is reported and never auto-repaired, even under `--force`. `canon doctor` warns when the patterns are absent and names the fix. Adopter content outside the canon block is preserved verbatim.

### Fixed

- **`canon upgrade` no longer silently drops adopter `docs-refs-check` customizations.** The tunable allowlists (`noisySourcePaths`, `validDirs`, `markdownRootDirs`) now live in an adopter-owned `scripts/docs-refs-config.mjs` that `canon upgrade` never overwrites and `canon init` scaffolds. Existing adopters get it created on first upgrade with a prompt to move their entries over before the checker updates.

## [1.7.0] — 2026-05-29

### Added

- **`--push` / `--pr` / `--ship` base-divergence gate.** Hard-fails when local `<base_branch>` is ahead of `origin/<base_branch>`, listing the colliding commits with a `git push origin <base>` fix and an `--allow-divergent-base` override. Runs before the file-allow-list gate (so the root-cause message replaces the misleading per-file "drift" error) and before `--ship`'s merge (so divergent commits can't conflict the post-merge pull and strand ship half-complete). The new `--allow-divergent-base` flag bypasses only this commit-divergence check. `--force` does not bypass the new gate; its existing documented bypasses (the file-allow-list gate, the reroute amendment gate, the dirty-`REPO_ROOT` worktree-start gate, and `--full-send` on a delicate task) are unchanged.
- **Scaffold push reminder.** The first `canon run` on a task prints a one-time reminder to `git push origin <base>` after the scaffold commits land on the local base branch. Fires once per bundle, never on reroutes or review iterations; informational only — `canon run` never pushes.

### Changed

- **Canon runs every fresh Codex `exec` with `--sandbox workspace-write`** regardless of the operator's `~/.codex/config.toml` state. Without an explicit baseline, the pipeline previously ran Codex with whatever sandbox the operator's HOME happened to declare. Resumed sessions still inherit their original sandbox.

### Removed

- **`canon init` no longer creates a project-local `.codex/config.toml`.** Codex CLI only reads `~/.codex/config.toml`. Adopters who want personal Codex defaults — sandbox, MCP servers, model preferences — set them in `~/.codex/config.toml`. `canon doctor`'s codex-trust check is unaffected. Upgrading does not delete an existing project-local `.codex/config.toml` left by an older install; the file is inert for Canon (Codex CLI reads `~/.codex/config.toml`, not repo-local config) and can be removed if unmodified.

### Fixed

- **Canon-shipped docs no longer reference orchestrator source paths that don't exist in adopter repos.** `CLAUDE.md`, `docs/pipeline-orchestrator.md`, and the `canon-review` skill referenced canon-internal paths that broke `npm run docs-refs-check` for adopters after upgrading to 1.6.0.
- **`docs-refs-check` recognizes line ranges separated by en-dash (U+2013) and em-dash (U+2014)**, not just ASCII hyphen. Citations like `file.ts:42–50` are no longer flagged as missing refs.
- **`--pr` base-drift gate honors files declared in `## Amendment` / `## Amendment Round N` sections of `spec.md`.** `parseAffectedFilesFromSpec` previously walked only `## Design`, forcing operators to duplicate amendment-added files into the main Affected Files table to clear the gate.
- **`canon run --ship` tolerates a branch already deleted by GitHub's "auto-delete head branches".** When `gh pr merge --squash --delete-branch` fails on branch deletion but the specific attempted PR is confirmed merged, ship warns and completes teardown instead of dying after the irreversible merge.

## [1.6.0] — 2026-05-28

### Added

- **Detach mode for `canon run`.** Non-TTY invocations (Claude Code Bash tool, CI, piped) respawn into their own session so harness pgroup-kill (session-resume, SSH disconnect, terminal close) can't reach them. Interactive terminals stay foreground. Opt out with `CANON_NO_DETACH=1`.
- **`canon stop <id>`.** Gracefully terminate a detached run. Self-heals stale `.canon-pid` / `.heartbeat.json` when the orchestrator is already dead.
- **Heartbeat file + `canon doctor` stale-orchestrator detection.** Flags tasks whose status says in-progress but whose heartbeat is missing or >120s stale, with a `canon run <id>` resume hint.

### Changed

- **`AGENTS.md` commit-ownership rule matches what the orchestrator actually does in worktree mode** — scaffold commits to base before implement; human-review commit is `chore: human review (<TASK-ID>)`.

### Fixed

- **Release-process branch-naming convention corrected.** One release branch per release, named for the version it ships (`release/v1.6` for 1.6.0, `release/v1.5.1` for 1.5.1).

## [1.5.1] — 2026-05-27

### Fixed

- **Round-N code-review docs/templates match the v1.5 executable prompt** — adopter-facing docs require re-filling the Stage 1 AC table every review round, with a `Met (unchanged from round N-1)` shortcut. Fixes #108.
- **Validation enum guidance surfaces human-only checks** — `human_pending`, `deferred_by_spec`, and the `Acknowledged:` waiver convention are documented so unresolved human checks appear in `done.md`. Fixes #109.
- **First worktree creation refuses dirty source edits in `REPO_ROOT`** — only task artifacts and pipeline telemetry are tolerated; dirty source aborts unless `--force` is supplied. Fixes #110.

## [1.5.0] — 2026-05-26

### Changed

- **Claude `code_review` upgrades to Opus on L/XL/delicate.** New `CLAUDE_MODEL_REVIEW_LARGE` env var (default Opus) splits from `CLAUDE_MODEL_REVIEW` (default Sonnet, still used for S/M). Closes the Codex/Claude tier asymmetry on XL/delicate.
- **Worktree-canonical task state from implement onward.** The worktree is canonical for task-scoped state from implement onward; `REPO_ROOT` is canonical for project-level resources and pre-implement task state. `canon task status/list/accept/phase` read from the worktree when one exists past plan. PR #104.

### Added

- **`/canon-review` skill — adversarial pre-pipeline spec review.** Dispatches three parallel sub-agents (structural / factual / spec-quality) at the spec and surfaces BLOCKING / STRONG / NIT findings inline. Opt-in; recommended for M/L/XL or delicate specs.
- **`docs-refs-check` adopter skip-path surface (`NOISY_SOURCE_PATHS`).**
- **`docs-refs-check` treats `...` as a placeholder** in both target-side and symbol-side refs.
- **`docs-refs-check` exempts per-task `notes.md` and `spec-review.md`** — both routinely contain refs to imagined paths.
- **`docs-refs-check` skips gitignored paths** — refs to gitignored files (e.g. `.claude/settings.local.json`) and source markdown files that are themselves gitignored are excluded.

### Fixed

- **`--pr` base-drift gate accepts directory-form Affected Files entries** — `` `dist/` `` matches every subpath. Same prefix semantics in the human-review dirty-tree and staging gates.
- **`--pr` base-drift and human-review gates auto-allowlist `PIPELINE_MANAGED_DOCS` once `qa.status = done`** — QA's "Docs Freshness" sweep no longer forces a spec backfill.
- **Orchestrator survives SIGHUP from a dying supervising shell.** PR #105.
- **Code-review pre-flight exempts pipeline telemetry files from the diff coverage check.** PR #106.
- **`canon run --ship` no longer crashes with ENOENT for tasks created with `worktree: false`.**
- **`canon task release-init` inserts the new CHANGELOG block before the first version block** — file-level meta stays between the H1 and the version entries.
- **Code-review pre-flight rejection no longer skips Stage 1 on subsequent rounds** — the rejection path appends a `## Pre-Flight Rejection` section to `review.md` instead of stomping it.
- **Round-N code_review prompt re-fills the Stage 1 AC table every round** — with a `Met (unchanged from round N-1)` shortcut for untouched ACs.
- **`canon task list` no longer crashes on orphan- or stale-worktree state** — invalid entries render as `INVALID: <reason>` and the listing continues.

## [1.4.0] — 2026-05-24

### Added

- **`canon run --full-send`** — spec to draft PR with no human interrupts. `/canon-spec` detects natural-language full-send intent. Delicate tasks require `--force`.
- **`--pr` base-drift safety gate** — aborts if files outside the spec's *Affected Files* changed on base mid-pipeline. `--force` bypasses. PR #97.
- **`--pr` auto-commit allow-list scoped to *Affected Files*** — out-of-scope dirty files warn instead of being swept in. PR #96.
- **`--reroute` requires `spec.md` amendment** — `## Amendment` or `## Amendment Round N`. `--force` bypasses. PR #99.
- **`docs-refs-check` script + CI gate** — markdown ref hygiene validation. Adopters opt in via `npm run docs-refs-check`.

### Changed

- **`CLAUDE.md` no longer claims `base_branch` is "typically `dev`"** — reflects the variety of adopter branch models.
- **Expanded `--help` for `--reroute`, `--pr` / `--push`, `--ship`** — each flag names its expected starting state, files read/written, and alternatives.

### Fixed

- **Implement phase only commits the task scaffold to base once** — eliminates the recurring pre-pipeline commits that produced PR-merge conflicts.
- **`--ship` actually invokes `gh pr merge`** — silently dead since 1.3.2.
- **`--ship` no longer commits dirty pipeline-shared docs to base** — the squash merge brings docs to base atomically.
- **`--ship` no longer creates a premature GitHub release** — adopters drive release tagging from their own workflow.
- **`--ship` tolerates a worktree-held local branch on `gh pr merge --delete-branch`.**
- **`parseValidationRequiredChecks` distinguishes empty from missing `## Validation Required` section.**
- **`canon task release-init` writes `.canon/version` and uses the canonical `## [<version>] — YYYY-MM-DD` block format.**

## [1.3.2] — 2026-05-19

### Fixed

- **Auto-commit handles files already deleted in earlier task-branch commits.**
- **`canon task accept` rollback uses atomic tmp+rename.**
- **`parseHandoffPathCell` rejects markdown links with empty URL `[foo]()`.**
- **`canon doctor` codex-trust check accepts single-quoted TOML and handles root `/` as a trusted ancestor.**
- **`--ship` operator docs corrected** — `--ship` calls `gh pr merge --squash --delete-branch` itself; do not merge the PR manually.

## [1.3.1] — 2026-05-19

Recovery release for v1.3.0 — the auto-release workflow tagged 1.3.0 at the first version-bump commit while extracting notes from main's HEAD, so the release page advertised fixes that weren't in the tagged code. This release ships them plus the workflow fix.

### Added

- **`canon doctor` checks codex project trust** — parses `~/.codex/config.toml`'s trusted-projects list and prints the exact TOML line to add when missing.
- **`canon task accept` accepts multiple task IDs for bundle mode.** Closes [#89](https://github.com/tstraub89/canon-ai/issues/89).

### Fixed

- **`canon task accept` parser rejects absolute paths and `..`-traversals.** Closes [#90](https://github.com/tstraub89/canon-ai/issues/90).
- **Gitignored handoff entries exempt from existence and coverage checks** — build-generated artifacts no longer trip auto-commit.
- **`canon task list` no longer crashes on non-canonical `status.json`** — invalid rows render as `INVALID: <reason>`. Closes [#83](https://github.com/tstraub89/canon-ai/issues/83).
- **`canon run --pr` uses the repo's `.github/pull_request_template.md`** if present. `CANON_PR_BODY` override available.
- **`canon run --pr` at `human_review` is idempotent** — both code paths check for an open PR before recreating.
- **`docs/pipeline-orchestrator.md` lists all four `canon task accept` guards.** Closes [#91](https://github.com/tstraub89/canon-ai/issues/91).

### Changed

- **`auto-release.yml` extracts release notes from the tagged tree, not the workflow's checkout.** Adds post-publish verification. Closes [#92](https://github.com/tstraub89/canon-ai/issues/92).

## [1.3.0] — 2026-05-19

Hotfix release for two failure classes exposed by a GP dogfood.

> **Note (added 2026-05-19):** v1.3.0's GitHub release was originally published with notes describing six fixes that weren't in the tagged code ([#87](https://github.com/tstraub89/canon-ai/issues/87)); the page has been corrected and the missing fixes ship in [v1.3.1](#131--2026-05-19).

### Added

- **`canon task accept <id> <phase> [--force]`** — operator escape hatch for manually-committed work. Marks the phase done and sets `operator_accepted: true` so post-phase dispatch is skipped on subsequent runs. Only `implement` is supported today.

### Fixed

- **Strict handoff Changes-table parser rejects combined rows, wildcards, and unfilled placeholders.**
- **Handoff template no longer ships a literal `` | `<path>` | ... | `` example row.**

## [1.2.0] — 2026-05-18

### Added

- **`canon upgrade --check`, `--force`, `--no-stage`** — `canon upgrade` refuses to overwrite dirty managed files by default (exit 2). Closes [#63](https://github.com/tstraub89/canon-ai/issues/63).
- **`canon upgrade` header-only-syncs `docs/pipeline-invocations.md`** — refreshes the canon-owned header while preserving telemetry rows. Closes [#67](https://github.com/tstraub89/canon-ai/issues/67).
- **`canon doctor` enforces Claude Code ≥ 2.1.72.** Closes [#70](https://github.com/tstraub89/canon-ai/issues/70).
- **Release process documented + automated** — new `docs/release-process.md` and `.github/workflows/auto-release.yml`. Closes [#66](https://github.com/tstraub89/canon-ai/issues/66).
- **Private-distribution and license language made explicit in README.** Closes [#68](https://github.com/tstraub89/canon-ai/issues/68).

### Fixed

- **`canon run <id> --pr` handles `complete` and stays idempotent when a PR already exists.** Closes [#72](https://github.com/tstraub89/canon-ai/issues/72).
- **`canon run <id> --ship` is idempotent on partial cleanup and auto-deletes a stale remote task branch.**
- **`canon task post-merge-sync` nudges archive-ready tasks instead of going silent.**
- **Auto-commit handles markdown-link handoff paths and hard-fails on source-dirty empty handoff.**
- **Validation pre-flight diagnostics sharpened.** Closes [#71](https://github.com/tstraub89/canon-ai/issues/71).
- **Retired `runtime_validation` phase removed from shipped pipeline docs.** Closes [#64](https://github.com/tstraub89/canon-ai/issues/64).
- **README permission allowlist re-synced with `canon doctor`.** Closes [#65](https://github.com/tstraub89/canon-ai/issues/65).

### Changed

- **`dist/` builds are now reproducible across worktrees.**

## [1.1.3] — 2026-05-17

### Fixed

- **Restored `picocolors` entry in `package-lock.json`** corrupted by a too-broad `sed` substitution during the 1.1.2 release. No adopter impact.

## [1.1.2] — 2026-05-17

### Fixed

- **`canon upgrade` syncs `docs/pipeline-orchestrator.md` to existing adopters** — added to `CANON_OWNED`.

## [1.1.1] — 2026-05-17

Adopter-feedback cleanup from a fresh GP install of 1.1.0. No runtime behavior change; doc + scaffold fixes only.

### Fixed

- **README install command corrected** — `npm install -g --install-links github:tstraub89/canon-ai`. Drops `jq` from Prerequisites.
- **Stale canon-internal source-path references swept from adopter-facing shipping content** — `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/CODEX.md`, both `pipeline-orchestrator.md` copies, and the canon-owned skills. `templates/docs/pipeline-orchestrator.md` reframed as a reference for *using* canon's pipeline.

### Changed

- **`canon init` no longer mutates the adopter's `package.json`.**
- **`canon update` targets the GitHub source.**

## [1.1.0] — 2026-05-17

### Changed

- **canon is self-contained at runtime.** Adopters' runtime requirements drop from `{node, git, bash, jq}` to just `{node, git}`. The 693-line `scripts/task.sh` becomes `src/task/index.ts` with the same `canon task` API. Orchestrator compiles to `dist/scripts/run-task.js`; templates inline as build-time imports.
- **`canon run <id>` spawns `node dist/scripts/run-task.js`** instead of `tsx scripts/run-task.ts`.

### Fixed

- **`npm install -g github:tstraub89/canon-ai` now works reliably.** See [PR #58](https://github.com/tstraub89/canon-ai/pull/58).
- **`syncWorktreeTelemetry` no longer strands managed-doc edits on the task author.**
- **CI's `npm install -g` verify step uses `--install-links`.**

### Removed

- **`scripts/task.sh`** (replaced by `src/task/index.ts` — same API), **`jq` hard dependency**, **`tsx` from runtime `dependencies`**, **`mustache` from runtime dependencies**, and the `npm run-task` dev shortcut.

## [1.0.2] — 2026-05-16

### Fixed

- **Git-based installs work now — commit `dist/` instead of building at install time.** Supersedes 1.0.1's `prepare: "tsup"` hook ([npm/cli#8440](https://github.com/npm/cli/issues/8440)).

## [1.0.1] — 2026-05-16

### Fixed

- **Git-based installs now produce a working `canon` binary.** Added `"prepare": "tsup"` so `npm install github:tstraub89/canon-ai` builds `dist/` before install. (Superseded by 1.0.2's commit-dist approach.) Reported in [discussion #56](https://github.com/tstraub89/canon-ai/discussions/56).

## [1.0.0] — 2026-05-16

First major release. Canon ships as the `canon-ai` npm package with a full CLI, Claude Code skills, and a unit-test suite.

### Added

- **`canon-ai` npm package** — `canon` binary wired through `dist/cli/index.js`.
- **`canon` CLI** — six commands: `init`, `doctor`, `upgrade`, `update`, `run`, `task`.
- **`/canon-spec`, `/canon-pipeline`, `/canon-status`, `/canon-changelog` Claude Code skills** — installed by `canon init`, synced by `canon upgrade`.
- **Unit test suite** — 237 tests covering CLI commands, orchestrator extractors, validation parsers, and phase-gate logic.
- **Affected-files section in implement prompts** — Codex receives the committed diff path set so spec authors can write predicate-gated validation checks.
- **Project template overrides** — `tasks/_templates/` survives `canon upgrade`; `.canon/templates/` is canon-owned.
- **`.canon/README.md`** — "do not edit these files" notice with override workflow.

### Removed

- **`runtime_validation` orchestrator phase** — implement now routes directly to `code_review`. Validation execution lives inside agent phases.

### Changed

- **Codex CLI invocation no longer hardcodes sandbox flags** — `.codex/config.toml` is the authoritative source.
- **Task templates moved** from `tasks/_templates/` to `.canon/templates/`; `tasks/_templates/` is now the override location.
- **`detectInstallType`** inspects the package's own install path.
- **Signal exit propagation** in `run` and `task` no longer swallows non-zero exits.
- **`CANON_VERSION`** injected at build time via tsup `define`.

### Fixed

- `scaffoldTemplates` and `runUpgrade` extracted as testable pure functions.
- `upgrade` no longer stages paths that may not exist when a `CANON_OWNED` template is missing.

## [0.6.1] — 2026-05-15

### Fixed

- **Code-review diff injection** — orchestrator pre-computes `git diff <baseBranch>...HEAD` and injects it into the review prompt. Closes [#46](https://github.com/tstraub89/canon-ai/issues/46).
- **Shared-doc sync over-skipping** — per-file divergence check instead of HEAD-level; unrelated commits on dev no longer block the entire sync.

## [0.6.0] — 2026-05-14

### Fixed

- **Reroute session prompt** — `--reroute` with an existing Codex session uses a purpose-built resumed-reroute prompt instead of the generic resume wrapper.
- **`spec_review` and `implement` use separate Codex session slots** (`codex_spec_review` vs `codex`).

### Added

- `promptImplementResume()` extracted into its own function.
- `wrapForResume` parameter on `runCodex()` — purpose-built resumed prompts can bypass `toResumePrompt` wrapping.

### Changed

- **`--reroute` warns that `spec.md` amendments must be written to the main repo** (not the worktree path).
- **`CODEX.md` and the handoff template document file-revert behavior** — byte-perfect reverts use `git show origin/<base>:<path>` since `git restore` is blocked by the sandbox.

## [0.5.1] — 2026-05-13

### Fixed

- `run-task-safety.test.ts` skips instead of failing with EPERM when `git worktree add` is blocked by the environment.

## [0.5.0] — 2026-05-13

### Added

- **`Fail – unrelated` validation result state** — Codex can record this when a required check fails due to a pre-existing flake outside the task's Affected Files. Notes must contain a specific test/file reference.

## [0.4.5] — 2026-05-12

### Fixed

- `resolveTaskCwd` / `getActiveCwd` no longer die when `branch` is empty on a fresh task.

## [0.4.4] — 2026-05-12

### Fixed

- Runtime-validation retry prompts reference the correct artifact directory using the monotonic `runtimeIterations_total` counter.
- Closing `human_review` without a `handoff.md` now fails closed instead of silently returning ok.

## [0.4.3] — 2026-05-11

### Fixed

- Handoff iteration sections contribute their own `### Changes` tables — files introduced in later review rounds are no longer falsely rejected.

## [0.4.2] — 2026-05-11

### Fixed

- Shared-doc sync uses a shared registry, fails closed on divergence, and compares content instead of byte length.
- Human-review auto-commit stages protected managed docs through the same shared-doc registry.
- Regression coverage added for linked-worktree root resolution and shared-doc sync guardrails.
- `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` defaults documented in orchestrator docs and README.

## [0.4.1] — 2026-05-11

### Fixed

- **`--ship` fails closed** across worktree teardown and archive commit handling.
- **Task branch creation honors `status.base_branch` strictly.**
- **Worktree-backed bundle tasks resolve to the correct worktree.**
- **`validateHandoffAgainstSpec()` rejects specs that omit or empty out `## Validation Required`.**

## [0.4.0] — 2026-05-11

### Added

- GitHub Actions CI workflow and POSIX-safe `npm test` glob.
- `scripts/run-task.ts` split into focused modules; prompt prose moved into Mustache templates with golden-output regression coverage.
- `--dry-run` on `run-task` — prints planned phases, agents, models, and effort without spawning an LLM session.
- `runtime_validation` phase between `implement` and `code_review`. (Removed in 1.0.0.)
- Iterative counter fields on review phases: `iterations_current_loop`, `iterations_total`, `changes_requested_total`, `auto_block_count`.
- Prompt-fidelity regression suite plus `CANON_TASKS_DIR_OVERRIDE` and `CANON_PATTERNS_MD_PATH` test hooks.
- Canon provenance stamping in `status.json.canon` and the `Canon Governance` section in `handoff.md`.

### Fixed

- Worktree telemetry and task-artifact sync no longer clobber main-checkout files with shorter worktree copies.
- AC Coverage check parses the markdown table instead of pattern-matching prose.
- Runtime validation no longer writes a second top-level baseline after a reroute.
- `cmd_reset_spec_review` preserves cumulative counters; `--reroute` resets only the current loop counter.
- `task.sh phase` and `--ship` honor the active task worktree; the shell wrapper prefers the repo-local `tsx` binary.

## [0.3.0] — 2026-05-10

### Added

- Post-Codex `isTemplateUnfilled` check on `spec-review.md` — orchestrator rejects `spec_review: done` when the artifact is still the bare template.
- README "Supported platforms" section — macOS/Linux supported; Windows requires WSL2 (#22).
- Three new `docs/decisions.md` entries — "Declared Canon vs Executable Canon"; "Canon is a quality layer, not an authoring tool"; "Track new work in BACKLOG.md by default".

### Fixed

- `.claude/settings.local.json` filename in `.gitignore` (#14).
- `task.sh release-init` dead `short=` reassignment removed (#21).
- `docs/product-owner.md` reference removed from agent startup prompts (#15).
- `.agent/docs-map.json` Citation grounding block removed from the code-review template (#16).
- GalleryPlanner project names scrubbed from canon-supplied source comments and test fixtures (#18).
- README install step includes `mustache` + `@types/mustache` (#12).
- Node version docs aligned to 24.x only.
- `phaseCommands` quotes the absolute `task.sh` path (#9).
- `retryAgentForPhase` maps phase to session slot instead of the deprecated flat `claude` slot (#10).
- Post-Claude `review.md` template check reads from the active worktree, not REPO_ROOT (#11).
- First-implement worktree creation creates `task/<id>` directly in the worktree from `baseBranch` (#6).
- `code_review` retries run in the active worktree.
- Various script-location references aligned with the `run-task` module split.

### Removed

- `npm run setup-hooks` script on `main` (the merge-guard hook file is deliberately dev-only). Closes #13.

## [0.2.0] — 2026-05-08

### Added

- ESLint with `@typescript-eslint/recommendedTypeChecked` as the repo's lint gate. `npm run lint` required for all changes.

## [0.1.0] — 2026-05-07

### Added

- **Post-commit handoff verification at code-review pre-flight** — the pipeline cross-checks the committed diff against every bundle member's handoff Changes table.

### Fixed (harness safety)

- **`autoCommitCode()` post-commit verification via `git diff HEAD --name-only`** — catches silent-partial-commit failures where `git status` reports clean but the file actually differs from HEAD.
- **`--ship` pre-flight branch safety** — three independent guards (`assertTaskBranchPushed`, `assertNoOpenPRForTask`, `assertOriginTaskBranchAbsent`) prevent destruction of unpushed work and silent shipping of remote-only commits.
- **Worktree creation aborts with "run `npm install` in `REPO_ROOT` first"** when `package.json` exists but `REPO_ROOT/node_modules` is missing.

### Changed

- `--reroute` help text clarified.

## [0.0.1] — 2026-05-07

Initial extraction of canon from its embedded source project. Pipeline built but unverified end-to-end.
