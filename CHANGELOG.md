# Changelog

> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [Unreleased]

### Fixed

- **`--reroute` and `canon task reset-code-review` re-scaffold `review.md` after archiving it.** Both commands moved the filled review to `review-prior-<n>.md` and left nothing behind, so the code-review foreman was told to "fill the existing template structure" with no template on disk, and a foreman that failed to write the file left the phase with no artifact to inspect. The archive step now writes a fresh scaffold from the project's `review.md` override under `tasks/_templates/` when it keeps one, otherwise from `.canon/templates/review.md`, rendered exactly as `canon task new` would. The pristine-scaffold check that skips archiving now also recognizes a rendered scaffold (task id substituted), so a repeat reroute no longer archives a blank file.

## [3.1.0] — 2026-09-05

### Changed

- **`canon update` installs stable releases from the npm registry.** It resolves the latest release tag on GitHub as before, confirms that version is published to npm, then installs `canon-ai@<version>` from the registry; a project-local install is pinned to the exact version. A tagged release that has not reached npm yet refuses with a retry note and the `--ref v<version>` GitHub fallback. `--channel main`, `--ref`, and `CANON_UPSTREAM_REPO` fork overrides still install from GitHub, since those builds are not on the registry.

### Removed

- **No install scripts in the published package.** The `postinstall` hook installer only ever set up canon-ai's own contributor pre-commit hook and did nothing in adopter repos, but it triggered npm's install-scripts warning on every install. Contributors run `npm run hooks` once after cloning instead.

## [3.0.0] — 2026-09-04

### Changed

> **Breaking (adopters):** Task worktrees now live at `.canon/worktrees/<id>/` inside the repository instead of the `../dev-worktrees/<id>` sibling. A task whose worktree is still at the old root refuses to run until you move it to `.canon/worktrees/<id>/` and run `git worktree repair .canon/worktrees/<id>` from the main checkout, or pin `CANON_WORKTREES_ROOT=../dev-worktrees` (the parent directory, not the worktree). `canon run` and `canon task` invoked from inside the old directory are refused; run them from the main checkout. `--ship` still merges and archives an unmigrated task but leaves the old directory behind. Tooling that walks the repo with root-anchored `**/` globs should exclude `.canon/worktrees/`, and `git clean -ffdx` or removing `.canon` destroys in-flight worktrees (plain `git clean -fdx` skips them). `canon upgrade` adds the ignore rule; `canon doctor` warns when it is missing.

### Added

- **The README documents the trust model.** What headless pipeline sessions can do, what confines them, where your code goes, and which flags gate pushes, merges, and publishing.

### Fixed

- **A hand-deleted task worktree no longer crashes a later phase midway.** If a canon worktree is registered with git but missing on disk, `canon run` (except `--dry-run` and `--ship`) stops before any phase, names it, and gives one command to restore it from its branch and one to discard the registration. Uncommitted work in the deleted directory is gone; canon does not prune or recreate anything itself.
- **A `done.md` left with the template's files-changed stub is now caught.** That stub detector compared against text the shipped template never contained, so it could never fire.

## [2.9.0] — 2026-08-22

### Changed

- **`--reroute` now works from any point after a completed `implement` round, not just `human_review` or a `spec_gap`-blocked `code_review`.** It now also covers a task auto-blocked at `code_review` after too many review rounds, or one simply waiting on `qa`. Same mechanism as before — write an `## Amendment` section and reroute, `--force` still bypasses the check.

### Fixed

- **Rerouting a task with a multi-round `review.md` no longer wedges the next code review on a stale verdict.** Reroute now archives the prior `review.md` to `review-prior-<n>.md` (a blank template is left in place) and drops the carried-over review session, so the post-reroute review starts a genuine round 1; prompts that pointed a bundle sibling at its outstanding findings now point at the archived file.

## [2.8.0] — 2026-08-13

### Changed

- **canon-ai is now MIT-licensed.** The proprietary placeholder license is replaced with MIT ahead of the public open-source release. `package.json` gains the npm registry metadata (`repository`, `homepage`, `bugs`, `author`, `keywords`), the README drops its private-distribution framing in favor of npm as the primary install path, and a `CONTRIBUTING.md` documents the build/validation workflow and the repo's derived-mirror and committed-`dist/` rules.

- **The detach banner is now an imperative `canon watch` directive, not a command menu.** v2.7.0 added `canon watch` to the banner as one line among `Stop:`/`Watch:`/`Tail:` peers — and agent operators kept skimming past it into hand-rolled `sleep` + `status.json` poll loops, which miss halt states `canon watch` classifies (auto-block, crash, checkpoint). The banner now ends in a ruled **NEXT STEP** block: the `canon watch <id>` command on its own line, its blocking semantics, `--timeout` guidance for shell tools that cap command duration (exit code 5 = timeout elapsed, re-invoke), and an explicit "do not hand-roll a poll loop" prohibition. The `tail -f` suggestion is gone — it invited exactly the log-polling the directive forbids. The "task already running" errors lead with the same watch-first, do-not-poll note.

### Removed

- **Auto-commit no longer appends `[auto-commit-debug]` JSON lines to the task's `notes.md`.** The instrumentation dated from the auto-commit hardening rounds and dumped the full staging state — dirty files, staged sets, raw porcelain output, commit stderr — into `tasks/<id>/notes.md` on every auto-commit attempt, drowning the human-readable scratchpad in machine payload. A review of every entry accumulated on canon-ai's own history found no failure the surviving checks hadn't already surfaced through their `die()` messages: those messages carry the same actionable detail (dirty paths, uncovered files, git stderr), so the shadow log earned its retirement. All checks, abort paths, and the post-commit coverage verifier are unchanged — this is a pure logging removal.

### Fixed

- **The invalid-Codex-effort error no longer sends adopters to a canon-ai source file.** When canon resolved a reasoning effort the Codex CLI won't accept, the resulting failure told the operator to "fix the resolved value in `src/lib/pipeline-policy.ts`" — a path that exists only in canon-ai's own checkout, never in a repo that installed canon from npm. Reasoning effort is not configurable from outside canon: no environment variable feeds it, and every value in the phase/size matrix is a literal, so this condition can only arise from a bug in canon itself. The message now says that plainly and asks for a report naming the task size and phase, while keeping the one actionable fact the old wording carried — that editing `model_reasoning_effort` in `~/.codex/config.toml` cannot fix it, because canon's per-invocation override supersedes it.
- **The deprecated-`CODEX_EFFORT_*` warning no longer contradicts itself or names canon-ai internals.** Setting `CODEX_EFFORT_DEFAULT` or `CODEX_EFFORT_DELICATE` printed "no equivalent knob" and then, in the same line, told the reader to "update the matrix in `src/lib/pipeline-policy.ts` if you need different effort" — advice both unavailable to an adopter and at odds with the clause preceding it. The trailing sentence is gone, and the reason text no longer cites a canon-internal function name.

## [2.7.1] — 2026-08-11

> Spec-authoring guidance distilled from a `docs/lessons-learned.md` sweep, plus a pass removing canon-ai-only references from what canon ships to adopters.

### Added

- **New spec-writing rule of thumb: enumerate every caller and classify its execution context before asserting how a mechanism works.** "Counter X only increments on event Y" is a control-flow claim, and a helper named for one trigger routinely serves several — while whether a call site runs in an agent's own session or in the orchestrator's process is invisible from the function body. Authors now grep every caller, including skills and docs, and classify each site before the spec asserts anything about the mechanism. Reaches the `spec` and `spec-revision` phase prompts via `canon update`, and the `canon-spec` skill via `canon upgrade`.

### Changed

- **Two spec-writing rules of thumb sharpened, on review-round shape and spec altitude.** The `≥3 spec_review iterations` rule now keys off the rounds' *content* rather than the count: a round that narrows an already-identified case is convergence, while one naming a new structural case is a real design gap. On genuine scope-expansion it points at dropping the mechanism class, or deferring to a layer that already owns the concern, over another round of hardening. `Behavioral contracts, not mechanics` gains the symptom of a spec that has dropped to code altitude — rounds re-litigating literal regexes, file layouts, or verbatim commands — and the fix of moving mechanics into a non-binding *Implementation Notes* section. The `canon-spec` skill additionally gains a paraphrase-sweep and permitted-to-remain check on zero-result grep ACs for retired terms.

### Fixed

- **Shipped agent guidance no longer assumes the adopter is a consumer app with paid tiers.** The context-loading instructions injected into every Claude and Codex session gated doc reads on "Pro features" and "explicit UX tradeoffs" — a paid tier and a UX surface are properties of the project canon was extracted from, not of an adopter's repo. Each doc now carries its own predicate drawn from that doc's documented scope: architecture on first-time orientation or a tech-stack, dependency, data-flow, or boundary change; product-context on user-visible behavior, terminology, or a business rule; decisions whenever a settled decision governs the area being changed, not only when the task would revisit one.
- **`canon doctor` no longer points adopters at paths that exist only in canon-ai's repo.** A malformed `docs/task-quality-log.md` warned "compare with `templates/docs/task-quality-log.md`" — a path in canon-ai's own checkout and in no adopter repo. The warning now states the requirement directly from `CANON_LOG_HEADERS` (every header cell unique, plus the full required column set), so it cannot drift from the check and needs no reference file, and it now describes the duplicate-header failure mode the old wording omitted. Three permission-check warnings that said "see README" now name it as the canon-ai README.
- **The QA session no longer assumes every adopter keeps a changelog.** `Read CHANGELOG.md for voice and version reference` was unconditional, but `canon init` does not scaffold a changelog and canon deliberately prescribes no release model — a no-versioning adopter was sent to a file that does not exist. Now conditional on the project keeping one.

## [2.7.0] — 2026-08-10

### Changed

- **`canon watch` prints a quiet `.` per healthy poll instead of a `heartbeat Ns ago` line every 3 seconds.** The per-poll age line buried phase transitions ~20 noise lines a minute deep, so a `tail` of captured watch output could easily miss them. Healthy ticks now collapse into dot runs, the heartbeat-age notice only prints once the heartbeat is older than one heartbeat interval (30s — a missed tick), and the stale-but-progressing phase-boundary window reports its age instead of staying silent. Classification, exit codes, and the machine-readable summary line are unchanged.
- **The detach banner now points at `canon watch`.** When `canon run` auto-detaches, the banner it prints only suggested `tail -f` on the raw run log for monitoring; it now also lists `canon watch <id>`, the purpose-built blocking observer, with the log tail kept as a separate line.

### Fixed

- **`canon watch` no longer reports phantom phase transitions during a reroute.** When a review verdict of `changes_requested` came back, `status.json` transiently shows the review phase `done` before the orchestrator routes back, so watch's derived pointer flapped forward and printed e.g. `code_review → qa` then `qa → implement` when the real transition was `code_review → implement`. Watch now holds the pointer through that window and reports the single backwards move, annotated `(reroute)`.

## [2.6.0] — 2026-08-10

### Added

- **Task worktrees now link every npm workspace's own `node_modules`, not just the repo root's.** In an npm-workspaces monorepo, a workspace's dependencies that npm didn't hoist to the root were never linked into a task's worktree, silently leaving it missing packages until someone ran a full install by hand. Canon now discovers every eligible workspace from the root `package.json` and links each one's `node_modules` the same way it already links the root's; the QA-end and human-review dirty-tree gates were widened to match so a verified workspace-level symlink is never mistaken for an unexpected file. Ships via `canon upgrade`. (#219)

## [2.5.0] — 2026-08-01

### Added

- **`canon doctor` now detects a stale or malformed `docs/task-quality-log.md` header.** The QA-phase writer is fail-soft — a bad header just warns and skips the row, with no other signal. `canon doctor` now checks the same header requirement directly: missing file (with `docs/` present) passes, a malformed header, unreadable file, or missing `docs/` directory warns, naming the file and the reference template. `canon upgrade` is unchanged. Ships via `canon upgrade`. (#216)

### Fixed

- **The `spec_review` auto-block message now recommends raising the review cap, not resetting the counter, as the default recovery.** Hitting the `MAX_REVIEW_LOOPS` cap on repeated `changes_requested` isn't reliably a sign the spec has a structural issue — it can be legitimate slow convergence — but the message only ever pointed operators at resetting `iterations_current_loop` to 0 in `status.json`, discarding that signal. It now leads with raising `MAX_REVIEW_LOOPS` and continuing, and reserves the counter reset for when the spec is genuinely being rescoped. Ships to adopters via `canon upgrade`.
- **Codex code-review token usage is no longer misreported as zero.** `codex exec review` — the cold-Codex lens in `code_review` — never reports real token counts on its completion event, unlike canon's other Codex invocations. Canon was recording that as a literal `0` in `docs/pipeline-invocations.md`, implying the lens ran for free; it now records `-` (unavailable), matching the existing convention for missing usage data. Ships to adopters via `canon upgrade`.
- **The `spec_review` and `code_review` auto-block on a runaway review loop now fires before wasting one more revision, not after.** The check used to run only when the review phase was re-entered — always after a `changes_requested` verdict had already sent the pipeline back for a fresh spec write or re-implementation. It now also fires at the revision phase's own entry, before any work starts, with the existing review-phase check kept as a backstop; the auto-block message, `canon task accept --force`, and `reset-spec-review`/`reset-code-review` are all updated to match. `MAX_REVIEW_LOOPS` also now rejects malformed values (e.g. `1.5`, `-1`) with a warning instead of silently weakening the guard. Ships to adopters via `canon upgrade`. (#217)
- **`canon watch` no longer misreports a healthy resume as blocked, or a stale block marker as settled.** Classification now checks whether the orchestrator process is actually still running, not just which phase carries a `blocked` status. Ships to adopters via `canon upgrade`.

## [2.4.0] — 2026-07-25

### Changed

- **The implement→code-review validation gate no longer matches spec checks to handoff rows by prose; it verifies the outcomes table structurally and leaves per-check coverage to code review.** The pre-flight used to pair each `## Validation Required` item in the spec to a `## Validation Outcomes` row in the handoff by canonicalizing the two prose labels and comparing them — and when the wordings drifted (a mid-sentence backticked token, a command-vs-short-name mismatch, a base check vs. a suffixed variant), it falsely reported a required check as "missing" and bounced the handoff, burning a full implement respawn on a formatting mismatch — sometimes to the auto-block cap — for checks that had actually passed (hit repeatedly: #163, #200, and canon-ai's own `add-xs-tier`). The gate now makes only the assertions it can judge unambiguously from the outcomes table itself — no unexplained `Fail`, no unfilled placeholder row, `blocked` rows surfaced for triage, and a `Fail – unrelated` row citing a file the task changed still fails as a regression (anti-laundering) — and accepts `Pass` / `N/A` / `not_configured` / `deferred_by_spec` / `human_pending`. Whether a *specific* required check was actually run (present, and not wrongly skipped) is now judged by Claude's Stage 1 code review, which already reads the outcomes table against the spec (see [`docs/decisions.md`](docs/decisions.md) "Validation runs inside agent phases"). There is no handoff or spec format change and no cutover — in-flight tasks keep working. Ships to adopters via `canon upgrade`.
- **The `spec_review` prompt now asks the Codex reviewer for precision, not just recall.** Under the newer, more literal 5.6-generation reviewer, the prior "push to find fault" framing was manufacturing blocking findings on specs that were already sound — including flagging pre-existing behavior a spec had explicitly excluded and verified unaffected. The reviewer's objective now states plainly that a spec with no blocking findings is a valid, expected result; "silence is the default" now covers the whole review, not just the initial shape check; and a new scope boundary lets it set aside genuinely out-of-scope, unaffected behavior as a minor note at most, while still treating a missing required change as a serious finding. What counts as blocking, and the evidence bar for bug/flake fixes, are unchanged. Ships to adopters via `canon upgrade`. (#210)
- **Canon's shipped Codex model defaults are now the 5.6 generation.** Adopters who don't set `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` previously got two generations behind current — `gpt-5.4-mini` (mini tier) and `gpt-5.5` (full tier). The defaults are now `gpt-5.6-luna` (mini) and `gpt-5.6-sol` (full); override env-var names and precedence, routing, and effort tiers are unchanged. See [`docs/decisions.md`](docs/decisions.md) §"Model-generation re-baseline (2026-07)". Ships to adopters via `canon upgrade`. (#211)
- **`docs-refs-check` now validates prose section pointers (`§"Section Title"`), not just anchor links.** Docs point at a section two ways: `[text](file.md#anchor)`, which was checked, and the prose convention `` `docs/decisions.md` §"Section Title" ``, which was checked only in its plainest form — write the same pointer as `` `docs/decisions.md §"Section Title"` `` or `[`docs/decisions.md`](docs/decisions.md) §"Section Title"` and it passed silently no matter which heading it named. All three forms are now checked against the target file's headings, and a markdown link whose path doesn't resolve from the file it's written in is reported on its own (`link path does not resolve from this file`) instead of being swallowed. Only the quoted form is validated; the unquoted shorthand (`docs/architecture.md §Validation`) has no unambiguous end boundary in prose and stays free text. Canon-managed markdown is also now scanned wherever it lives: the walker skips dot-directories, so the skills under `.claude/` and the task templates under `.canon/` were never checked at all, and a broken ref in one of them shipped silently. Expect a one-time round of findings on docs whose section names have drifted. Ships to adopters via `canon upgrade`.

### Fixed

- **Canon now refuses to run task commands from a hand-created linked git worktree instead of silently reading and writing task state in two different checkouts.** If you ran `canon task new` from a `git worktree` you created yourself, canon wrote the task under that worktree, but `canon task status`, `canon run`, and the dirty-state / base-branch / worktree-safety checks all looked in the main checkout — so they silently disagreed about where the task lived and could evaluate a tree you weren't working in (#202). Canon manages task worktrees itself, so it now detects this case and stops with a message pointing at the main checkout rather than proceeding against the wrong one. Its own pipeline agents, which run from canon-created worktrees, are unaffected. Ships to adopters via `canon upgrade`.
- **Installed-package provenance stamp no longer records the adopter's commit as canon's identity.** An installed canon (global CLI or project dependency) misclassified its run and stamped the adopter repo's `HEAD` as canon's `upstream_commit`; it now records `<unavailable>` plus a new `canon_version` field, since version is canon's identity when no commit is recoverable (#196). Ships to adopters via `canon upgrade`.
- **The QA task-quality-log row is now written from task state at the `qa → done` transition instead of being appended by the QA agent — so it survives a reroute and always lands inside the log table.** Previously it was a prompt instruction with no code behind it: a rerouted task's row was never revisited, so it kept the first pass's counts (one task logged `1 / 1` after actually running 6 spec-review and 2 code-review rounds), and nothing anchored the write, so rows could land below "Periodic Reviews" and vanish from trend analysis. A deterministic writer now recomputes the derivable counters, takes QA's judgment cells from a new `## Quality Log` block in `done.md`, and reconciles misplaced or duplicated rows — a write failure warns rather than blocking the phase. Ships to adopters via `canon upgrade`. (#198, #213)

## [2.3.0] — 2026-07-18

### Added

- **New spec-writing rule of thumb in `/canon-spec`: codebase-wide term renames gate per string family, not per enumerated hit.** Hand-enumerated grep lists cause round-over-round scope expansion in spec review — each round surfaces a new label family, not a missed instance. The skill now directs authors to decompose the stale term into its string families up front, gate each family with a zero-result word-bounded grep AC that can't match the new term, and fall back to positive targeted ACs (with the asymmetry documented) where the old string is a substring of the new. Distilled from a 7-round spec_review on canon-ai's own XS-tier rename. Ships to adopters via `canon upgrade`.

### Changed

- **`canon-inline-review` now documents `codex review`'s actual stdout format in its reporting guidance.** Verified against a live `codex review --uncommitted` run: stdout is pre-formatted prose (`Review comment: - [P0]-[P3] <title> — <file>:<line>` plus body), not raw JSON, unless `--json`/`--output-schema` is passed. The skill previously had no guidance on the output shape; it now tells Claude to relay the existing `[P0]`-`[P3]` tags and summary line as-is instead of re-deriving severity.

- **`spec_review` effort for `M`-sized tasks raised `medium` → `high`, matching `L`.** Task-history analysis (canon-ai + a second production project) found M's higher code_review iteration counts weren't an implement-quality gap — non-rerouted M and L tasks ran nearly identical (~1.0–1.4 rounds) — but a reroute-severity gap tracking M's lighter spec_review scrutiny (M's rerouted-task average was the worst of any size band). `implement` is unchanged; M and L now share the same Codex model/effort on both phases. See [`docs/decisions.md`](docs/decisions.md) §"`spec_review` M effort raised medium → high (2026-07)".
- **The cold-Codex `code_review` lens now runs through canon's own Codex invocation policy instead of inheriting the operator's personal reasoning-effort setting.** Previously, the mandatory third review lens spawned with no `-c model_reasoning_effort` override, so it silently inherited whatever value sat in the operator's `~/.codex/config.toml` — and because the Codex CLI only accepts `none|minimal|low|medium|high|xhigh`, a personal setting outside that set (reported as `ultra` in #195) made every `code_review` hard-fail with no diagnostic trail, since the lens wrote no telemetry either. The cold lens now resolves its effort from the same policy matrix as other Codex calls (`high` at every task size; model is unchanged), passes it explicitly on the command line without touching the operator's config file, and writes exactly one telemetry row per attempt — successful or failed — to `docs/pipeline-invocations.md`, matching the existing per-invocation contract. A new shared guard also rejects any effort value the Codex CLI can't accept before spawning, across all Codex call sites, with a message naming the invalid value, the valid set, and that canon's per-invocation override always wins. (#203)
- **Handoff `## Changes` and spec `### Affected Files` cells now accept comma-separated lists of file paths, not just one path per row.** Combined rows like `` `a.ts`, `b.ts` + mirrors `` used to be rejected outright, forcing the operator to hand-split them; now every path in the list is extracted and validated individually. Ambiguous cells (prose mixed between paths, missing commas) are still rejected loudly — never parsed to a subset of their paths. Ships to adopters via `canon upgrade`. (#205)
- **`CLAUDE_BUDGET` now gives `code_review` its own, higher per-size curve instead of sharing a flat cap with `spec`/`plan`/`qa`.** `code_review` runs a three-lens review (anchored Claude, cold Claude, and a cold-Codex diff review, synthesized by a foreman — sometimes including an empirical test re-run to confirm a finding), making it a structurally costlier session than the other three, single-pass phases. `spec`/`plan`/`qa` keep `XS`/`S` $5.00, `M`/`L` $10.00, `XL` $20.00; `code_review` now runs `XS` $5.00, `S` $10.00, `M` $15.00, `L` $20.00, `XL` $40.00. The `CLAUDE_BUDGET` env var still overrides every phase flat, regardless of size. See the Claude Budget Matrix in [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md).

### Fixed

- **`canon run` no longer fabricates a `spec_review` verdict when Codex crashes mid-review.** When a Codex `spec_review` invocation exited non-zero without completing — out of credits, auth, network, or an MCP crash — recovery read the verdict left in the cumulative review artifact from the *prior* round and advanced the phase anyway, silently inflating the durable iteration counters (confirmed live: two consecutive out-of-credits crashes each recorded a phantom `changes_requested`, driving the loop to its auto-block cap before the revised spec was ever reviewed). A crashed Codex `spec_review` now parks instead of advancing — no verdict is read, no counters move — and prints the exit code, the likely recoverable cause, and the re-run command. Clean-exit and `code_review` recovery paths are unchanged. Ships to adopters via `canon upgrade`. (#204)
- **Canon's own worktree `node_modules` symlink no longer hard-stops the QA-end and human-review commit gates.** Worktree setup symlinks a task's `node_modules` to the supervising checkout's install, but the common trailing-slash `node_modules/` gitignore style doesn't match a symlink — so `git status` reported it untracked and both dirty-tree gates aborted on an artifact canon created itself (#197). Both gates now exempt a top-level `node_modules` entry only when a filesystem probe confirms it's a symlink resolving to the supervising checkout's `node_modules`; a real file, real directory, or wrong-target symlink still blocks exactly as before. Worktree setup is also idempotent now — re-running it no longer crashes on its own prior symlink. Ships to adopters via `canon upgrade`. (#201)
- **`canon update` now targets its own install root and pins to an immutable release commit instead of the mutable default branch.** Previously it ran `npm install` in whatever directory you invoked it from — potentially adding `canon-ai` to an unrelated project (#188) — and installed unpinned, so unreleased `main` code was indistinguishable from the tagged release (#189). It now resolves the real install root, refuses unless that root's manifest lists `canon-ai`, and installs the latest release's commit pinned by SHA; `--channel main` / `--ref <ref-or-sha>` install a labeled development commit instead. Each run announces the target and records provenance under `.canon/`. Globally pnpm-installed canon-ai now refuses instead of "updating" a directory that was never the running install. (#207)
- **The handoff AC-Coverage gate now recognizes lettered-section AC IDs (`AC-A1`), not just flat numbering (`AC-1`).** Specs written by the pipeline's own spec phase routinely group acceptance criteria under section letters, but the handoff validator only counted `AC-<number>` rows — a handoff whose table used the lettered scheme was falsely rejected as "missing or contains no AC rows", blocking `code_review` (hit live by an adopter, GalleryPlanner 2026-07-13). The gate now accepts both documented schemes and nothing broader (a multi-letter ID like `AC-XYZ9` still rejects), and the handoff template tells implementers to mirror whichever scheme spec.md uses. Ships to adopters via `canon upgrade`.
- **Bundle runs in worktree mode no longer dirty the main checkout with a secondary task's branch write.** The first-implement bootstrap wrote a secondary member's branch to the main checkout instead of the shared worktree, leaving main dirty and the worktree copy blank — while the log claimed main was untouched. Bootstrap now writes every member directly to the worktree, and task-state resolution matches a secondary to the worktree that owns it via a fail-closed content scan instead of a mutable main-checkout hint. (#206)
- **`canon upgrade` now refuses to overwrite a canon-managed file that git cannot restore, and fails closed instead of open when git itself can't be checked.** Previously, an untracked (or gitignored) file sitting at a canon-managed path was treated as "clean" and silently overwritten — unrecoverable, since git never had a copy. And if the underlying `git status` probe failed for any reason, every target was treated as safe to write. `canon upgrade` now classifies every target before writing: untracked-but-present and gitignored-but-present files refuse (new), and an existing target refuses when git's own state can't be determined (new) — both overridable with `--force`, same as the existing tracked-and-modified refusal. Absent targets and byte-identical content are unaffected, so fresh scaffolds and idempotent re-runs still proceed without `--force` even when git is unavailable. `--check` reports the identical classification a real run would enforce. (#199)

## [2.2.0] — 2026-07-10

### Added

- **`canon task set <id> <field> <value>` — update task metadata without hand-editing `status.json`.** Settable fields: `task_size`, `delicate`, `worktree`, `base_branch`, `title`. Guarded run-stance fields (`full_send`, `human_spec_gate`) redirect to the correct command instead of writing; derived and orchestrator-owned fields refuse with clear guidance. Topology fields (`worktree`, `base_branch`) lock once a branch is recorded, preventing task-state corruption. Setting a field on an in-progress task succeeds but warns the change takes effect on the next `canon run`. (#184)

### Fixed

- **The `code_review` diff→handoff pre-flight rejection now says where coverage rows must live — and names near-miss tables.** The coverage parser reads rows only from the baseline `## Changes` table and `### Changes` tables inside `## Iteration` sections, but the rejection never said so. An adopter incident (GalleryPlanner, 2026-07-06) showed the failure mode: Codex parked amendment-pass coverage rows in a well-formed table under an invented heading (`### Changes Added For Coverage`), got the bare "in diff but not in any bundle handoff" rejection, verified the rows existed, re-closed — and the loop ran to an auto-block with zero reviewer rounds. Every diff→handoff rejection now ends with the list of scanned surfaces, and when a missing file has a valid row in an unscanned table, the rejection names that table's heading and first column header so the fix is "move the rows", not another guess. Coverage itself stays heading-scoped by design — accepting any `File`-columned table anywhere was tried and rejected because it turns informational file lists into load-bearing coverage claims. The handoff template now states the two scanned surfaces up front. Ships to adopters via `canon upgrade`.
- **`--ship` no longer silently discards uncommitted edits to shared docs in the supervising checkout.** Shipping any worktree-mode task used to run a blanket revert of every dirty file it found there — sweeping up both a sibling task's pending telemetry rows and an operator's hand-edited knowledge docs. `--ship` now classifies shared-doc dirt via `git status` before merging anything: a dirty managed doc (`docs/patterns.md`, `docs/decisions.md`, etc.) aborts the ship, names the file, and tells the operator to commit or stash (`--force` does not bypass this). Telemetry dirt is preserved only when it's a plain unstaged pure append over the committed copy — backed up, reverted for the merge, and re-appended once the ship's own archive commit is staged (but before it's committed) — so in-flight rows from sibling tasks survive without landing in the wrong commit. Ships to adopters via `canon upgrade`. (#185)
- **Canon provenance stamps now correctly attribute forks, mirrors, and plain-vendored layouts.** `captureCanonSnapshot()` reads `upstream_repo` from a `CANON_UPSTREAM_REPO` env var at call time (falling back to `tstraub89/canon-ai`), so forks and mirrors can correct their attribution without a code change. An orchestrator running as a plain git clone nested inside a host repo now stamps the host's HEAD as `orchestrator_commit` instead of copying canon's own HEAD. (#184)

## [2.1.0] — 2026-06-27

### Added

- **`XS` task size — the new fast-tier floor.** Tasks sized `XS` run the fast tier (spec and plan combined in one Claude session, Codex `spec_review` skipped) — the smallest way into the pipeline. Use it for work past a trivial inline edit (>1 file, or real logic) whose spec premise needs no challenging; it still buys written ACs, a plan, and a real `code_review`. The inline → XS → S decision rule is documented in the spec-authoring skill and orchestrator doc. (#183)
- **`code_review` now runs three independent reviewers — an anchored Claude lens, a cold (spec-blind) Claude lens, and a cold Codex (GPT-family) lens, synthesized by the foreman.** Cold findings are verified against the diff before being carried, and a verified finding can't be dismissed merely for being off-AC. A Codex review that can't be obtained stops the phase hard — no silent fallback to two lenses. The cross-family pairing was the driver: Codex routinely surfaced P2s the Claude lenses missed. (#182)
- **Bug- and flake-fix specs now must confirm the failure mechanism before the fix.** `/canon-spec`, the spec template, and the runtime prompts direct authors to state how the mechanism was confirmed (reproduction, trace, or forced repro) and to include a regression-test AC that fails pre-fix and passes after. When the mechanism is environment-bound and a faithful repro is impractical, they must say so and supply a deterministic alternative rather than skip verification silently. Feature and refactor authoring is unchanged. (#181)

### Changed

- **`S` tasks now run the full pipeline.** `S` gets a separate plan and a Codex `spec_review` pass — the same treatment as `M/L/XL`, but lighter. `spec_review` is the formal XS→S dividing line: `XS` when the spec premise needs no Codex challenge, `S` when it does. No effort, model, budget, or loop-cap value changed for any existing size. (#183)

## [2.0.1] — 2026-06-20

### Fixed

- **`/canon-changelog`'s release-rules guidance no longer contains a broken reference to `qa.md`, a canon-internal file adopters don't have.** The phrase "inlined in `qa.md`" was a bare backtick ref to an internal per-phase prompt template absent from adopter repos — `docs-refs-check` would flag it as a missing file in any upgraded repo. The sentence is reframed to say the release rules are enforced during canon's QA phase, preserving the meaning while removing the invalid reference. Ships to adopters via `canon upgrade`. (#179)

## [2.0.0] — 2026-06-20

> **Breaking (adopters):** Canon no longer ships or manages a canon-owned content block in your `AGENTS.md` / `CLAUDE.md`. `canon upgrade` no longer touches these files — they are fully adopter-owned; canon does not create, modify, or read them. A legacy v1 managed block is **not** removed automatically: strip it with the one-off `tools/strip-canon-block.mjs` (in the repo checkout; not shipped via npm) or delete the `<!-- canon:start -->`…`<!-- canon:end -->` block manually. Canon's operating rules now arrive just-in-time through the per-phase prompt templates, agent charters, and `/canon-*` skills; generate your agent files with the tool-native `/init` (Claude Code's `/init` → `CLAUDE.md`, Codex's init → `AGENTS.md`). `canon doctor` guides the transition.

### Added

- **`canon doctor` now nudges toward a canon orientation line when neither `CLAUDE.md` nor `AGENTS.md` mentions canon.** A warn-only check (case-insensitive substring test, never `fail`) surfaces the recommended orientation line so agents discover canon on session start; it passes silently when either file already mentions canon. The recommended text is exported as `RECOMMENDED_NUDGE` (mirroring the existing `RECOMMENDED_ALLOW`), documented in a new README subsection, and drift-tested so the README and the constant can't diverge. Canon never writes the nudge into adopter files — `init`, `upgrade`, and templates are untouched. Part of the program to vacate canon-managed content from adopter `CLAUDE.md` / `AGENTS.md`; it becomes the discovery backstop once the managed block is removed. (#175)

### Changed

- **Canon's docs, skills, and prompts no longer reference, read, or generate `AGENTS.md` / `CLAUDE.md` — agent files come from the tool-native `/init`.** Each agent already auto-loads its own file (Claude Code → `CLAUDE.md`, Codex → `AGENTS.md`), so canon's instructional references were dead weight and are stripped from the docs, the `/canon-*` skills, and the pipeline prompts. `/canon-init` is now scoped to the `docs/` knowledge corpus only and no longer claims to generate agent files; the built-in `/init` produces them as high-level overviews. `canon doctor` gained a warn-only advisory — suggest `/init` when neither file exists, suggest the discovery nudge when one exists without mentioning canon (it never fails). The README recommends generating agent files via `/init` and documents the optional `CLAUDE.md` = `@AGENTS.md` consolidation, which converges both auto-loaded agents on one shared overview while keeping Claude-only operator norms out of Codex's context. canon-ai dogfoods the result. Ships to adopters via `canon upgrade`. (#177)
- **Sole-homed pipeline rules relocated from the `AGENTS.md` / `CLAUDE.md` canon blocks into the per-phase surfaces that consume them.** ~22 operating rules that previously lived only in the broadcast MD blocks now travel with the prompt template, agent charter, startup constant, or skill for the phase that uses them — each phase carries only its own rules instead of receiving all of them. `canon task new` scaffolds are now self-contained (`spec.md` inlines the validation matrix and protected-docs list; `done.md` / `status.json` point at surviving project docs rather than `AGENTS.md`), and a structural test greps presence/absence tokens and sweeps `.canon/templates/` so a dropped rule or cross-phase bleed can't slip back in. `AGENTS.md` and `CLAUDE.md` are unchanged — the rules are now dual-homed; the single-source cleanup is the follow-on vacate task. Ships to adopters via `canon upgrade`. (#174)

### Removed

- **The canon-owned content block is no longer shipped into adopter `AGENTS.md` / `CLAUDE.md`.** Canon ships zero managed content into adopter agent files; the operating rules once broadcast into those blocks now travel just-in-time with the per-phase prompt templates, agent charters, startup constants, and `/canon-*` skills (completing the relocation begun in #174). `canon upgrade` no longer touches the files — they are fully adopter-owned; canon does not create, modify, or read them, and an existing v1 managed block is left in place for the adopter to strip (`tools/strip-canon-block.mjs` or by hand). A recommend-only `canon doctor` discovery nudge is the backstop so fresh sessions still learn a repo uses canon. (#176)

### Fixed

- **`docs-refs-check` now tolerates the `~` approximate-line hedge in line citations.** Operators routinely write `` `src/foo.ts:~140` `` to mean "around line 140" (line numbers in prose drift, so the hedge is honest), but the citation-stripping regex required a digit immediately after the colon — so `:~140` wasn't stripped and the literal path `src/foo.ts:~140` was reported as a missing file. The strip and detection patterns now accept an optional `~` after the colon (including on range bounds like `:~140-~160`); the suffix is still discarded before path validation, so accepting it changes nothing about which paths the gate accepts or rejects. Ships to adopters via `canon upgrade`.
- **`/canon-status`'s commit-count header no longer trips the permission gate.** The header's `` ```! `` block counted commits with `git rev-list @{u}..HEAD --count` (the form 1.9.0 switched to), but the `@{u}` brace pattern doesn't match the skill's `Bash(git rev-list *)` allow-rule — the Bash permission matcher treats `{…}` specially — so the line was gated/denied instead of running, and the `|| echo '?'` fallback couldn't rescue it. It now uses the brace-free `git rev-list --count HEAD --not --remotes`, which matches the allow-rule, prints `0` when nothing is ahead (no `|| echo` fallback needed), and is more robust than `@{u}` (which errors with no upstream configured). The label is now "Unpushed commits:" to match the `--not --remotes` semantics. Ships to adopters via `canon upgrade`.
- **The QA phase no longer proposes a version number or bump tier in its changelog draft.** The QA prompt asked for changelog *entry text only*, but the prohibition was buried and a `docs/decisions.md` line ("agents propose the bump tier") gave agents a clause to rationalize past it — a real QA run proposed "1.15.0 minor" in `done.md`. The negative is now pointed and attached to the Proposed Changelog instruction, and bump-tier selection is scoped to the release/changelog step, not QA. Ships to adopters via `canon upgrade`.
- **`/canon-pipeline` now states the full-tier human spec gate fires *after* `spec_review` approves (before `plan`), not before `spec_review`.** The operator-facing skill where pipeline-driving knowledge belongs now documents the actual halt point. Ships to adopters via `canon upgrade`.

## [1.14.0] — 2026-06-17

### Added

- **`canon run` now blocks if the same task already has a live orchestrator.** At startup, before writing any runtime files, the orchestrator checks `.canon-pid` (written by the detaching parent) and `.heartbeat.json` (written by the child) for each task. If either points to a live foreign process the run dies with a clear message naming the PID and the `canon stop` / `canon watch` commands. The self-PID check ensures a detached child never blocks itself. `--ship` is exempt (terminal one-shot); `--dry-run` is exempt (read-only inspection that should be allowed through even during a live run). The residual simultaneous-start race (<200ms Node boot window) is documented in `docs/BACKLOG.md`; it doesn't affect the operator use case (accidentally launching a second run after the first is established).

### Fixed

- **`/canon-inline-review` now keeps your steering when reviewing the uncommitted tree.** Asking for an inline review *and* telling it what to look for (e.g. "watch for stale-closure risk") previously ran a generic cold review with the steering silently dropped — the skill treated the review target and the steering instruction as mutually exclusive. It now passes your steering as the review prompt (which already targets the uncommitted tree), so a steered uncommitted review does what you asked. Ships to adopters via `canon upgrade`.

## [1.13.0] — 2026-06-16

### Added

- **`/canon-inline-review` — a Claude Code skill for an independent second-model cross-review of below-pipeline work.** For non-trivial inline edits and XS fixes too small for a full canon task, it runs `codex review` (Claude never self-reviews its own inline code) and reports findings inline. The review target comes from operator intent — the request, the conversation, and `$ARGUMENTS` map to `--commit <SHA>` / `--base <branch>` / `--uncommitted` / a steering prompt — rather than being inferred from git state, with a no-op guard for a clean tree and an `AskUserQuestion` fallback when genuinely ambiguous. Ships to adopters via `canon upgrade`.

### Changed

- **The pre-pipeline spec review skill is renamed `/canon-spec-review` (was `/canon-review`).** The new name aligns with the pipeline phase it pre-empts (`spec_review`) and disambiguates it from the sibling `/canon-inline-review` skill (code-diff review). Behavior is unchanged: same three-sub-agent fan-out, same BLOCKING / STRONG / NIT report, same read-only advisory output. Existing adopters should remove the stale `.claude/skills/canon-review/` directory after `canon upgrade`; upgrade does not prune it automatically.

- **Canon's adopter-facing release guidance is now model-agnostic.** The `/canon-pipeline` skill's release-and-shipping section is rewritten from a single release-branch-per-version walkthrough into a model-neutral core plus four named recipes — *release-branch-per-version*, *trunk-from-main*, *tag-from-main*, and *no versioning* — each deferring to your own release policy doc as the source of truth. It now states explicitly that `base_branch` is per-task, so one repository may mix release models across surfaces. The `/canon-changelog` skill's base-detection and finalize notes are updated to match (no longer assuming release-branch as the only model).

- **Shipped `CLAUDE.md` and `AGENTS.md` slimmed without dropping guardrails.** Deduplication, removed war-story tails, and mechanics rerouted to doc pointers; `AGENTS.md` is back under Codex's 32 KiB `project_doc_max_bytes` cap, so its tail reliably reaches Codex again. Ships to adopters via `canon upgrade`.

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

- **`--reroute` help text now reflects v1.9.0's tier-specific re-entry.** `canon --help`, `canon run --help`, and the README quick reference still said `--reroute` sends a task back to `implement` — true only for fast-tier. They now state that full-tier tasks (M/L/XL or delicate) re-enter at `spec_review` while fast-tier (S) re-enter at `implement`, matching `docs/pipeline-orchestrator.md`. An operator following the old help could hit a phase mismatch running `--step --expect implement` after a full-tier reroute. (#135)

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
- **`canon task accept` accepts multiple task IDs for bundle mode.** Closes #89.

### Fixed

- **`canon task accept` parser rejects absolute paths and `..`-traversals.** Closes #90.
- **Gitignored handoff entries exempt from existence and coverage checks** — build-generated artifacts no longer trip auto-commit.
- **`canon task list` no longer crashes on non-canonical `status.json`** — invalid rows render as `INVALID: <reason>`. Closes #83.
- **`canon run --pr` uses the repo's `.github/pull_request_template.md`** if present. `CANON_PR_BODY` override available.
- **`canon run --pr` at `human_review` is idempotent** — both code paths check for an open PR before recreating.
- **`docs/pipeline-orchestrator.md` lists all four `canon task accept` guards.** Closes #91.

### Changed

- **`auto-release.yml` extracts release notes from the tagged tree, not the workflow's checkout.** Adds post-publish verification. Closes #92.

## [1.3.0] — 2026-05-19

Hotfix release for two failure classes exposed by a GP dogfood.

> **Note (added 2026-05-19):** v1.3.0's GitHub release was originally published with notes describing six fixes that weren't in the tagged code (#87); the page has been corrected and the missing fixes ship in [v1.3.1](#131--2026-05-19).

### Added

- **`canon task accept <id> <phase> [--force]`** — operator escape hatch for manually-committed work. Marks the phase done and sets `operator_accepted: true` so post-phase dispatch is skipped on subsequent runs. Only `implement` is supported today.

### Fixed

- **Strict handoff Changes-table parser rejects combined rows, wildcards, and unfilled placeholders.**
- **Handoff template no longer ships a literal `` | `<path>` | ... | `` example row.**

## [1.2.0] — 2026-05-18

### Added

- **`canon upgrade --check`, `--force`, `--no-stage`** — `canon upgrade` refuses to overwrite dirty managed files by default (exit 2). Closes #63.
- **`canon upgrade` header-only-syncs `docs/pipeline-invocations.md`** — refreshes the canon-owned header while preserving telemetry rows. Closes #67.
- **`canon doctor` enforces Claude Code ≥ 2.1.72.** Closes #70.
- **Release process documented + automated** — new `docs/release-process.md` and `.github/workflows/auto-release.yml`. Closes #66.
- **Private-distribution and license language made explicit in README.** Closes #68.

### Fixed

- **`canon run <id> --pr` handles `complete` and stays idempotent when a PR already exists.** Closes #72.
- **`canon run <id> --ship` is idempotent on partial cleanup and auto-deletes a stale remote task branch.**
- **`canon task post-merge-sync` nudges archive-ready tasks instead of going silent.**
- **Auto-commit handles markdown-link handoff paths and hard-fails on source-dirty empty handoff.**
- **Validation pre-flight diagnostics sharpened.** Closes #71.
- **Retired `runtime_validation` phase removed from shipped pipeline docs.** Closes #64.
- **README permission allowlist re-synced with `canon doctor`.** Closes #65.

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

- **`npm install -g github:tstraub89/canon-ai` now works reliably.** See PR #58.
- **`syncWorktreeTelemetry` no longer strands managed-doc edits on the task author.**
- **CI's `npm install -g` verify step uses `--install-links`.**

### Removed

- **`scripts/task.sh`** (replaced by `src/task/index.ts` — same API), **`jq` hard dependency**, **`tsx` from runtime `dependencies`**, **`mustache` from runtime dependencies**, and the `npm run-task` dev shortcut.

## [1.0.2] — 2026-05-16

### Fixed

- **Git-based installs work now — commit `dist/` instead of building at install time.** Supersedes 1.0.1's `prepare: "tsup"` hook ([npm/cli#8440](https://github.com/npm/cli/issues/8440)).

## [1.0.1] — 2026-05-16

### Fixed

- **Git-based installs now produce a working `canon` binary.** Added `"prepare": "tsup"` so `npm install github:tstraub89/canon-ai` builds `dist/` before install. (Superseded by 1.0.2's commit-dist approach.) Reported in discussion #56.

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

- **Code-review diff injection** — orchestrator pre-computes `git diff <baseBranch>...HEAD` and injects it into the review prompt. Closes #46.
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
