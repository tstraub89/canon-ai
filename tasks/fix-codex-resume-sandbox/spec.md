# Spec: fix-codex-resume-sandbox — Resumed Codex sessions keep the workspace-write sandbox

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

GitHub issue #194. In mixed mode, `runCodex` in `src/orchestrator/agents/codex.ts` builds two non-interactive argv shapes:

- fresh: `codex exec --json <effort> --sandbox workspace-write <prompt> -m <model> -C <cwd>`
- resume: `codex exec resume <id> --json <effort> <prompt> -m <model>`. It carries no sandbox setting.

`codex exec resume` does not accept `--sandbox` or `-C`. Confirmed with codex-cli 0.172.0's `codex exec resume --help`, which lists `-c/--config <key=value>` but neither of those flags. A resumed turn therefore falls back to the operator's own Codex settings. When `~/.codex/config.toml` has no `sandbox_mode` and the project is not marked trusted, that fallback is **read-only**. Every resumed implementer pass then fails to write: a revision after `changes_requested`, a pre-flight rejection, the handoff fix-up, or a guardrail retry. The same rejection repeats until the review-loop cap auto-blocks the task. Operators whose Codex config sets `sandbox_mode = "workspace-write"`, or who trust the project, never see it. Fresh and ephemeral environments, such as cloud containers, do.

**Confirmed mechanism (executed repro, codex-cli 0.172.0, ChatGPT login):** in a scratch git repo with an empty `~/.codex/config.toml`:

1. A fresh `codex exec --sandbox workspace-write … -C <dir>` turn wrote `a.txt`.
2. Resuming that session with today's resume argv (no sandbox) and asking for `b.txt` produced no file, and the turn reported the workspace was "read-only in this turn".
3. Resuming the same session with `-c 'sandbox_mode="workspace-write"'` added, and asking for `c.txt`, wrote the file.

Repeating steps 1–2 with the repo marked `trust_level = "trusted"` let the plain resume write. That is why only some environments hit the bug.

**Working directory on resume:** `codex exec resume` has no `-C`. The spawn already uses the caller's `cwd` for both branches (`streamProcess('codex', args, { cwd, … })`), and every resuming caller passes the same active cwd the session was created in: the task worktree via `getActiveCwd`, or the main checkout before a worktree exists (`docs/patterns.md`: "a **resumed** agent session keeps the project root it was created with"). In step 3 the write landed in the session's directory with no `-C`. No cwd change is needed.

## Decision

Resumed non-interactive Codex runs get the same `workspace-write` sandbox as fresh runs. The resume argv passes it as a config override (`-c sandbox_mode="workspace-write"`), the form `codex exec resume` accepts. Fresh, interactive and cold-review argv are unchanged. The docs that say the sandbox is "not passed on session resumes" are corrected.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Override value form | Quoted TOML string `sandbox_mode="workspace-write"` | Unquoted `sandbox_mode=workspace-write`, matching the `model_reasoning_effort=<effort>` style, which relies on Codex's raw-string fallback | The quoted form is valid TOML and doesn't depend on the fallback. It is the exact form used in the executed repro | `Author` |
| Fresh-path flag | Keep `--sandbox workspace-write` on fresh runs | Switch fresh runs to the same `-c` override for symmetry | Smallest change. The fresh flag works and is pinned by existing exact-argv tests; changing it widens the diff with no behavior gain | `Author` |
| Resume working directory | No change: rely on the spawn cwd and the session's stored root | Add an explicit cwd override on resume | `codex exec resume` has no `-C`. Callers already spawn in the creation cwd, and the repro wrote to the right place without one | `Author` |

## Non-Goals

- No change to the interactive Codex path. It intentionally follows the operator's own settings and ignores `resumeId`, a separate pre-existing quirk.
- No change to the `codex exec review` cold-review lens argv.
- No change to the fresh-exec argv.
- No `canon doctor` check for `sandbox_mode` and no change to Codex project-trust handling.
- No Claude-backend change. Claude has no write sandbox.
- No CHANGELOG edit; the release process writes it.

## Acceptance Criteria

- [ ] AC-1: A non-interactive `runCodex` call with a `resumeId` spawns `codex` with argv `['exec', 'resume', <id>, '--json', '-c', 'model_reasoning_effort=<effort>', '-c', 'sandbox_mode="workspace-write"', <prompt>, '-m', <model>]`. The prompt stays immediately before `-m`. Verify with a unit test that runs `runCodex` against a fake `codex` on `PATH` which logs its argv, and asserts this exact array.
- [ ] AC-2 (red-first regression): AC-1's test asserts that the `-c` / `sandbox_mode="workspace-write"` pair is present in the resume argv. Run against the pre-fix `codex.ts`, the test fails because the pair is missing. After the fix it passes. Record the red run in the handoff.
- [ ] AC-3: The fresh non-interactive argv is unchanged: it still contains `--sandbox`, `workspace-write` and `-C <cwd>`, and has no `sandbox_mode` override. The interactive and cold-review argv are unchanged. Verify that these existing expectations pass without edits: the fresh-branch expected-argv line of the parity test in `tests/agent-backend.test.ts` (only its resume-branch line changes, under AC-4), the fresh-path assertions in `tests/run-task-reroute-preflight.test.ts`, and the interactive and cold-review argv tests in `tests/run-task-code-review.test.ts`.
- [ ] AC-4: Every existing test that asserts the exact resume argv is updated to the AC-1 shape, and `npm test` passes. The known ones are the parity test in `tests/agent-backend.test.ts`, the implement fix-up test in `tests/run-task-safety-scaffold-push.test.ts`, and the guardrail-retry test in `tests/run-task-reroute-preflight.test.ts`. Their spacing and line breaks differ, so a literal grep for `'exec', 'resume'` misses some. Verify with a whitespace-tolerant search (for example `grep -rn "'resume'" tests/` and inspecting each hit that asserts a full argv) that each exact-argv resume assertion includes the sandbox override.
- [ ] AC-5: The docs describe the sandbox by mode, not by flag name, wherever resumes are covered. Resumes use a config override, not `--sandbox`, so deleting "fresh" from "fresh headless Codex runs use `--sandbox workspace-write`" would be wrong. The README's "Trust model" bullet no longer says the sandbox is not applied on session resumes. It states that headless Codex runs, fresh or resumed, use the workspace-write sandbox, and it still names the cold-review lens and interactive sessions as the exceptions. The `.canon/README.md` sentence and its `templates/.canon/README.md` mirror say the same, and `npm run sync-templates:check` passes. The `docs/codebase-map.md` "Codex sandbox baseline" row says the baseline applies to fresh and resumed exec. The two `docs/decisions.md` passages that name the runner-owned baseline as `--sandbox workspace-write` name the workspace-write sandbox instead, so they don't read as fresh-only. Verify by reading these passages, and with `grep -n "not passed on session resumes" README.md` returning nothing.
- [ ] AC-6: The committed `dist/orchestrator/run-task.js` matches a fresh `npm run build`: `git diff --exit-code -- dist/` is clean after building.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/agents/codex.ts` | Add the `-c sandbox_mode="workspace-write"` override to the resume argv, next to the effort flag and before the prompt |
| `tests/agent-backend.test.ts` | Update the resume exact-argv parity assertion. That updated assertion is the AC-1/AC-2 regression test: it runs `runCodex` against a fake `codex` that logs argv, and it fails on pre-fix code. Do not add a duplicate test |
| `tests/run-task-safety-scaffold-push.test.ts` | Update the implement fix-up resume exact-argv assertion |
| `tests/run-task-reroute-preflight.test.ts` | Update the guardrail-retry resume exact-argv assertion |
| `README.md` | "Trust model" bullet: the resume exception is gone; headless runs, fresh or resumed, use workspace-write |
| `.canon/README.md`, `templates/.canon/README.md` | Same sandbox sentence update in the canon-managed file and its mirror |
| `docs/codebase-map.md` | "Codex sandbox baseline" row covers fresh and resumed exec |
| `docs/decisions.md` | The two passages naming the runner-owned baseline as `--sandbox workspace-write` name the workspace-write sandbox instead (mode-level wording) |
| `dist/orchestrator/run-task.js` | Rebuilt bundle (`codex.ts` bundles only into this entry) |

### Implementation Notes (non-binding)

- Placing the override after `effortFlag` keeps the prompt immediately before `-m`. The `replaceCodexPrompt` helper in `tests/run-task-reroute-preflight.test.ts` relies on that.
- `sandboxFlags` becomes a fresh-only constant, or can be inlined into the fresh branch.
- Args go to `spawn` as an array with no shell, so the double quotes reach Codex literally.

### Interaction Dependencies

Every Codex resume path goes through `runCodex`: implement revision, reroute or plain resume, handoff artifact fix-up, guardrail retry, and spec_review re-review. Each one picks up the sandbox. The spec_review re-review runs in the main checkout before a worktree exists. Gaining workspace-write there matches what its fresh first pass already has.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`. Run the full suite; a check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`; commit the rebuilt bundle, then re-run `npm run build` and confirm `git diff --exit-code -- dist/` is clean
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

E2E: N/A. canon has no end-to-end suite; the live repro is in Problem.

## Docs Impact

- `docs/decisions.md`: edited (Affected Files) so the baseline wording doesn't read as fresh-only.
- `docs/pipeline-orchestrator.md` (and its `templates/docs/` mirror): describes `codex exec resume <id>` without sandbox detail. Still accurate.
- `docs/codebase-map.md`: edited (Affected Files).

## Known Risks

- A Codex CLI version that rejects `sandbox_mode` as a `-c` key on resume would fail every resumed turn, not just leave it read-only. Mitigation: `-c` is generic config override, `sandbox_mode` is a documented top-level config key, and 0.172.0 accepted it in the repro.
- Operators who deliberately set a stricter `sandbox_mode` (read-only) in `~/.codex/config.toml` now get workspace-write on resumes, as they already did on fresh runs. `docs/decisions.md` already states canon's runner flags take precedence for canon's invocations.
- Missing one exact-argv test would fail the suite rather than ship silently, so AC-4's grep is a convenience, not a safety net.

## Human Test Plan

1. On a machine where your Codex configuration has no sandbox setting and the project is not marked trusted, run a task until the code review asks for changes.
2. Let the pipeline send the work back to the implementer.
3. Expected: the implementer's revision pass edits files and finishes, with no "read-only" errors, and the task moves on to the next review instead of blocking.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row, each with a specific change description
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] If this spec replaces existing behavior: framed as a replacement with a grep AC (AC-5)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions backed by AC-3
- [x] Symbols named in ACs actually exist in the codebase (grep-verified)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
