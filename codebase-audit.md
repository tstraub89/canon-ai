# Codebase audit

Reviewed 2026-09-06, commit `308dddc73abda9fa7cfe6d1d4645ee82d20165db`, package 3.1.0, Node 24.20.0.

The strongest findings concern filesystem and process boundaries, inconsistent parsing, and growing maintenance overhead. The existing test suite is healthy, but disposable reproductions expose several gaps. Fix those before adding more pipeline gates or doing a broad architectural rewrite.

This is an inspection and audit, not implementation or independent cross-review of a proposed patch. No product code was changed and no GitHub issues were created. “New” means no matching issue was found among the 32 GitHub issues returned by the all-state query, or in the current backlog. Existing issues below were cross-referenced; they were not all independently reproduced.

## New bugs, in priority order

### 1. P1 — Upgrade follows clean tracked symlinks and overwrites external files

**Security and data-loss risk. Reproduced. New.**

[Destination classification](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/upgrade.ts:235) treats a tracked, unchanged symlink as a safe tracked file. The [write loop](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/upgrade.ts:519) then uses `writeFileSync`, following the link. Git tracks the link target string, not the destination file's contents, so the premise that Git can recover an overwrite is false.

Disposable reproduction: commit a symlink at `.canon/templates/spec.md` pointing to a sibling file outside the repo, then call `runUpgrade` with an updated template and no force flag. Result: no refusals; external contents changed from `original external data` to `replacement template`. A tracked `.gitignore` symlink also caused the external target to receive canon's ignore block.

Impact requires a symlink at an upgrade destination; this is not a remote network endpoint or arbitrary attacker-selected replacement content. Nevertheless, an ordinary upgrade can destroy data outside its stated scope, and a repository can supply such links.

**Fix:** inspect destination types and parent components before queuing writes. Refuse external or dangling symlinks explicitly, or deliberately replace the link itself if that is the documented policy. Cover symlinked parent directories and missing targets too; checking only `existsSync` misses dangling links. Review init's [copy/write paths](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/init.ts:51) for the same class; the executed reproduction covered upgrade.

### 2. P1 — Shutdown can leave an agent running after canon reports it stopped

**Process lifecycle bug. Reproduced. New; adjacent to issue #17, not the same failure.**

[forwardAndExit](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/signals.ts:95) forwards one signal to each detached agent group, runs cleanup hooks, and immediately terminates the orchestrator. It does not wait or escalate against those groups. [canon stop](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/stop.ts:496) checks the orchestrator PID, so its later SIGKILL escalation cannot rescue an agent in a different process group after the orchestrator has already exited.

Disposable reproduction: register a detached Node child that installs a SIGTERM handler and keeps running; SIGTERM the parent using the real signals module. Parent terminated with SIGTERM while the child remained alive. The fixture killed its own child afterward.

An agent performing slow cleanup or ignoring SIGTERM can keep consuming resources or editing files after runtime markers disappear. A subsequent run can overlap it.

**Fix:** retain supervision until child groups terminate; use a bounded grace period and group SIGKILL before removing runtime state and exiting. Test cooperative and resistant descendants. An uncatchable orchestrator SIGKILL requires a separate ownership/recovery design; this finding concerns catchable shutdown.

### 3. P2 — Git path parsing breaks ordinary Unicode filenames

**Correctness/portability. Reproduced with real Git output. New.**

[parsePorcelainEntries](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/git.ts:369) removes surrounding quotes but does not decode Git's quoted-path escapes. It also interprets every ` -> ` substring as a rename, regardless of the status columns or quoting.

With Git's default path quoting:

| Actual file | Parsed result |
|---|---|
| café.ts | Literal `caf\303\251.ts` |
| a → b.ts, using ASCII ` -> ` in the filename | Two nonexistent files: `a` and `b.ts` |

The parsed set feeds [auto-commit coverage](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/main.ts:457), so a correctly populated handoff disagrees with actual dirty files and can abort the run. This is different from [#14](https://github.com/tstraub89/canon-ai/issues/14), which concerns directory-form coverage.

**Fix:** use NUL-delimited porcelain and parse status-coded rename records. Apply the same raw-path convention to staged and diff queries; changing one parser while leaving quoted `--name-only` consumers would leave the bug class alive. The code already uses NUL-delimited parsing in other Git helpers.

### 4. P2 — `watch --follow` skips log data after non-ASCII output

**Correctness and performance. Reproduced through watchCmd. New.**

[tailRunLog](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/watch.ts:513) records `stat.size` in bytes, reads the log as a UTF-8 string, and passes that byte position to `String.slice`, whose positions are UTF-16 code units.

Disposable reproduction: begin with 100 arrow characters and a newline, attach follow mode, append `APPENDED-LINE`, and advance the injected polling clock. The line never appears. This affects canon's own output, which routinely includes arrows and emoji.

It also reads and decodes the entire growing log on every update. With similarly sized appends, cumulative work grows quadratically with the number of updates.

**Fix:** read only the appended byte range and decode incrementally, preserving partial UTF-8 sequences. Maintain byte offsets consistently and handle truncation/replacement explicitly.

### 5. P2 — Repository discovery assumes Git metadata lives directly under the checkout

**Portability. Reproduced. New.**

[resolveRepoRoot](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/env.ts:40) derives the checkout as the parent of `git rev-parse --git-common-dir`. That works for a conventional `.git` directory and its linked worktrees, but not a separate Git directory or absorbed submodule layout.

Disposable reproduction: create `checkout/` with `git init --separate-git-dir ../metadata`. Expected root: `checkout/`; actual root: its parent directory. This misanchors task paths and can make the managed-invocation guard reject a legitimate checkout. No destructive operation was exercised.

**Fix:** resolve the supervising checkout using Git's worktree/top-level information rather than the metadata directory's parent. Preserve the intentional distinction between the supervising checkout and linked task worktrees; simply switching every call to `--show-toplevel` would regress that distinction. Alternatively, reject unsupported layouts at discovery with an accurate explanation.

### 6. P3 — Task titles containing dollar replacement tokens render incorrectly

**Artifact formatting. Reproduced. New.**

[renderTaskTemplate](/Users/tstraub/canon-ai/canon-ai-dev/src/task/templates.ts:35) passes the user title as a string replacement to `replaceAll`. JavaScript interprets replacement tokens such as `$&` instead of inserting them literally.

Reproduction: title `Fix $& handling` renders as `Fix [Title] handling`. Other replacement tokens can duplicate surrounding template text. This is a small but concrete bug for tasks about regexes or shell syntax.

**Fix:** use a replacement callback returning the title. Add a literal-token case rather than a large scaffolding test matrix.

## Additional reproduced evidence for an existing issue

### 7. P2 — Verdict extraction can select an approval example over the actual rejection

[extractCheckedVerdict](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/validation.ts:827) searches the selected round/body for approval before rejection, without locating a verdict section or excluding code fences. Both executed inputs returned `approved`:

- A document with both Approved and Changes requested checked.
- A fenced Markdown example containing a checked Approved line, followed by an actual Final Verdict checking Changes requested.

[checkPhaseGate](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/validation.ts:885) and evidence recovery consume this parser, so malformed or explanatory text can satisfy the wrong review decision.

**Tracking:** expand [#18](https://github.com/tstraub89/canon-ai/issues/18), which already identifies the missing structural verdict locator. These are concrete acceptance cases for that work, distinct from per-invocation freshness. Require a unique checked verdict in the intended visible section; ambiguous decisions should refuse advancement.

## Performance opportunities

These are code-path observations, not production latency benchmarks.

1. **Bound agent output retention.** [streamProcess](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/agents/stream.ts:33) retains every stdout line and stderr chunk, then joins full copies at completion. Agent wrappers separately retain display text. Memory grows with total tool output rather than the small result needed by orchestration. Keep streaming event parsing; retain a bounded diagnostic tail and the specific final/session fields, or spool raw output to disk. Preserve Claude's salvage behavior deliberately. No OOM was induced during this audit.

2. **Apply preload limits before reading every file.** [buildContextBlock](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/context.ts:37) loads every affected file before checking the cap. It calls string length “bytes,” while the banner uses file byte sizes. A 30,000-character CJK file is about 90,000 UTF-8 bytes but passes a 65,536 “byte” cap. Stat regular files first, then read within a real byte budget; share that decision with the banner. Fold this into [#28](https://github.com/tstraub89/canon-ai/issues/28), which already needs changes to preload root selection.

3. **Batch repeated external probes.** [#24](https://github.com/tstraub89/canon-ai/issues/24) remains the clearest existing performance ticket: one network `git ls-remote` per shippable task. Also [refreshCanonSnapshotsAtPaths](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/canon-snapshot.ts:134) captures the same Git identity and launches both CLI version commands for every bundle member. Capture once per refresh operation, then stamp each task. Avoid process-lifetime caches that would obscure actual version or checkout changes.

4. **Fix follow-mode range reads as part of finding 4.** This removes repeated whole-log I/O while correcting lost output. It offers more value than micro-optimizing collection operations.

## “AI slop” and maintainability

The concern is observable maintenance cost, not whether an AI wrote a particular line. Much of the defensive code protects real, documented incidents. The weak parts are historical explanation preserved indefinitely, duplicated implementations that drift, and scaffolding left after refactors.

- **Delete disabled implementation and stale history.** [init.ts](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/init.ts:125) keeps a commented-out package updater “once canon-ai ships to npm,” even though npm distribution is current. [heartbeat.ts](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/heartbeat.ts:3) says a gap over 120 seconds is stale and detach is still open; the constant is 60 seconds and detach exists. Keep explanations of current invariants; move abandoned approaches and review chronology into history or design records.

- **Remove contradictory comments and meaningless parameters.** [blockedPhaseLivenessTrusted](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/watch.ts:26) takes context and time but returns its boolean argument unchanged. Nearby comments describe a grace bound the implementation explicitly does not apply. [orchestratorStillProgressing](/Users/tstraub/canon-ai/canon-ai-dev/src/cli/commands/watch.ts:470) repeats that obsolete explanation. Likewise, [commitTaskArtifactsToBase](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/git.ts:84) accepts and discards an artifact set. Simplify these signatures and document the actual policy.

- **Consolidate repeated boundary logic.** Worktree lookup is separately implemented in [state.ts](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/state.ts:269) and [worktree.ts](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/worktree.ts:71), with different directory-validity assumptions. Markdown parsing has near-copy H2/H3 scanners plus a more capable all-table scanner. Git helpers mix trimmed/raw and newline/NUL protocols. These differences correspond to real issues, including #23, #27 and finding 3. Consolidate one boundary at a time with tests that prove the different supported cases.

- **Finish the orchestrator module split.** [main.ts](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/main.ts:1) is 3,698 lines and still owns auto-commit, PR handling, merge proof, shipping, rerouting, and recovery. Its `split*` namespace aliases coexist with named imports and test compatibility exports. Extract cohesive operations—shipping and commit policy are natural candidates—while keeping state transitions explicit. Avoid adding a generic workflow framework or a universal dependency-injection layer.

- **Keep useful structure.** The pure policy tables, explicit refusal-result unions, worktree isolation, atomic task writes, and behavioral process fixtures earn their complexity. Removing them to lower line count would make the system less understandable or less safe. Prefer boundary-focused tests to additional source-string assertions of incidental implementation shape.

## Backlog and GitHub cross-reference

Highest existing priorities from this review: [#33](https://github.com/tstraub89/canon-ai/issues/33) (stale QA evidence), [#18](https://github.com/tstraub89/canon-ai/issues/18) (verdict structure/freshness), then [#17](https://github.com/tstraub89/canon-ai/issues/17) and [#19](https://github.com/tstraub89/canon-ai/issues/19) (recoverable failures). These concern false completion or broken recovery. #25 deserves higher priority if scripted/CI concurrent starts are a supported usage pattern.

| Existing cluster | Issues | Disposition |
|---|---|---|
| Review correctness and recovery | [#11](https://github.com/tstraub89/canon-ai/issues/11), [#17](https://github.com/tstraub89/canon-ai/issues/17), [#18](https://github.com/tstraub89/canon-ai/issues/18), [#19](https://github.com/tstraub89/canon-ai/issues/19), [#33](https://github.com/tstraub89/canon-ai/issues/33) | Fix before broad refactoring; add finding 7 to #18. |
| Worktree setup and reuse | [#12](https://github.com/tstraub89/canon-ai/issues/12), [#13](https://github.com/tstraub89/canon-ai/issues/13), [#23](https://github.com/tstraub89/canon-ai/issues/23), [#26](https://github.com/tstraub89/canon-ai/issues/26), [#27](https://github.com/tstraub89/canon-ai/issues/27), [#29](https://github.com/tstraub89/canon-ai/issues/29) | Shared invariant drift; consolidate while fixing specific cases. #26 still requires its own faithful reproduction. |
| Concurrency and synchronization | [#20](https://github.com/tstraub89/canon-ai/issues/20), [#25](https://github.com/tstraub89/canon-ai/issues/25), [#32](https://github.com/tstraub89/canon-ai/issues/32) | Preserve product decisions; avoid treating a cleanup rewrite as a fix. |
| Validation and parser friction | [#10](https://github.com/tstraub89/canon-ai/issues/10), [#14](https://github.com/tstraub89/canon-ai/issues/14), [#15](https://github.com/tstraub89/canon-ai/issues/15), [#34](https://github.com/tstraub89/canon-ai/issues/34) | Existing bounded work; finding 3 is a separate filename-protocol bug. |
| Performance and preload | [#24](https://github.com/tstraub89/canon-ai/issues/24), [#28](https://github.com/tstraub89/canon-ai/issues/28) | Batch probes; combine preload root and byte-budget fixes. |
| Security recommendations | [#38](https://github.com/tstraub89/canon-ai/issues/38) | Already tracked. Keep its requirement to verify actual CLI permission behavior. |
| Adopter configuration and installs | [#7](https://github.com/tstraub89/canon-ai/issues/7), [#8](https://github.com/tstraub89/canon-ai/issues/8), [#9](https://github.com/tstraub89/canon-ai/issues/9), [#22](https://github.com/tstraub89/canon-ai/issues/22), [#35](https://github.com/tstraub89/canon-ai/issues/35), [#36](https://github.com/tstraub89/canon-ai/issues/36) | Existing compatibility/product work; do not refile. |
| Lower-priority metadata/cosmetics | [#16](https://github.com/tstraub89/canon-ai/issues/16), [#21](https://github.com/tstraub89/canon-ai/issues/21), [#30](https://github.com/tstraub89/canon-ai/issues/30), [#31](https://github.com/tstraub89/canon-ai/issues/31), [#37](https://github.com/tstraub89/canon-ai/issues/37) | Retain as scoped work; #31's worktree regression coverage is more valuable than cosmetic cleanup. |

Two backlog observations matter:

- The [Claude confinement evaluation](/Users/tstraub/canon-ai/canon-ai-dev/docs/BACKLOG.md:11) already covers headless permission bypass. The current runner does pass the bypass flag; this is an explicit trust-model tradeoff, not a newly discovered vulnerability. Do not silently substitute a sandbox without testing adopter commands. The security skill has no dedicated Node CLI reference; this review used the actual filesystem/process boundaries rather than unrelated web-app guidance. Process execution predominantly uses argument arrays, consistent with [Node's subprocess guidance](https://nodejs.org/api/child_process.html); I found no confirmed shell-string injection in the inspected runtime paths.

- The parked [telemetry discrimination design](/Users/tstraub/canon-ai/canon-ai-dev/docs/BACKLOG.md:44) assumes telemetry files are exclusively appended. The [quality-log writer](/Users/tstraub/canon-ai/canon-ai-dev/src/orchestrator/quality-log.ts:281) already rewrites via temporary file and rename. That is a stale design premise, not a defect in the current writer. Revalidate it before reviving the proposed snapshot-offset gate. Keep the broader scoped-audits and attestation proposals deferred until a concrete use case justifies their additional machinery.

## Validation and limits

- Full suite: 1,212 tests; 1,211 passed, one skipped, zero failures; approximately 90.5 seconds.
- Lint, type check, template-sync check, docs-reference check, and build passed.
- Fresh build matched committed dist output.
- Production dependency audit reported zero vulnerabilities. The manifest has no runtime npm dependencies; this result does not audit external agent CLIs or prove bundled/build-tool code vulnerability-free.
- Reproductions ran in disposable local fixtures, with no live agent sessions, remote writes, or production merges. Process fixtures used Node stand-ins and cleaned up their own child processes.
- Reviewed CLI installation/update paths, task state and routing, Git/worktree handling, process supervision, watch/stop, artifact parsing, prompts, telemetry, and representative tests/CI. This was a broad manual review, not an exhaustive proof of every branch or a live end-to-end Claude/Codex pipeline run.

Recommended sequence: fix upgrade symlinks and supervised shutdown; fix Git paths and follow-mode byte handling; expand #18/#33 coverage; then take the bounded performance and cleanup work. Keep each behavior change separate enough for Claude cross-review under the project's normal workflow.
