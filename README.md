# Canon

![Canon](public/canon-logo.webp)

> **The law your agents work under.**
>
> A spec-first, multi-agent coding pipeline you drop into any repo.

---

## What this is

Canon is an opinionated workflow framework for AI-driven software development. It encodes a hard-won discipline — accumulated over many shipped features and many post-mortems — into scripts, templates, and rules that two AI agents (an architect and an implementer) operate under, with a human as the final arbiter.

The goal: make AI coding agents reliably ship correct, on-spec, well-reviewed work without constant babysitting. Not "the agents do everything" — **the agents do the right thing, and the human catches what they miss, and over time the rules absorb every miss so the next miss never happens**.

![Canon framework](public/canon-framework.webp)

That accumulation is the canon. The protected docs corpus, the phase prompts, and the `/canon-*` skills carry the rules — not adopter agent files. Agents auto-load their own agent file at session start, and canon layers its operating rules just in time through prompts, skills, and docs. When a rule is violated and a bug ships, the lesson goes into `docs/lessons-learned.md` and eventually gets promoted into the canon, so the next agent can't make the same mistake.

## Why it exists

LLMs are extraordinary at writing code. They're mediocre at:

- **Knowing when to ask vs. assume**
- **Holding the full context of a project's conventions in their head over a long session**
- **Catching their own scope creep, dropped requirements, or silent regressions**
- **Distinguishing settled architectural decisions from open questions**

Canon is what happens when you treat those failure modes as engineering problems instead of "well, AI is what it is" shrugs. Each one gets a structural answer:

| Failure mode | Canon's answer |
|---|---|
| Agent jumps to implementation before requirements are clear | **Spec phase** before code, written conversationally with grilling for non-trivial tasks |
| Agent silently drops a requirement | **Two-stage code review** — Stage 1 is a spec-compliance gate that fails the whole review if any AC is missing from the cross-reference table |
| Agent reinvents an existing pattern | **`docs/patterns.md` trigger table** + Known Pitfalls injected into implement prompts |
| Agent re-debates a settled decision | **`docs/decisions.md`** — agents read, don't re-propose |
| Agent forgets a past mistake | **`docs/lessons-learned.md`** — distilled cross-task wisdom that promotes into permanent rules over time |
| Reviews loop forever on the same disagreement | **Auto-block on runaway review loops** — per-size caps (see `pipeline-policy.ts`), escalation to human after the cap |
| Spec drift between conversation and pipeline | **File-based handoff protocol** — every artifact lives in `tasks/<id>/`, no copy-pasting |
| Sensitive surfaces (auth, payments) get refactored on theoretical grounds | **`delicate: true` flag** that promotes the task to highest-effort tier and triggers extra review discipline |

## How it works

Canon orchestrates two AI coding CLIs:

- **Claude Code** (Anthropic) plays the **architect**: writes specs, reviews code, writes QA summaries.
- **Codex CLI** (OpenAI) plays the **implementer**: reviews specs (full-tier tasks), writes code, writes handoff reports.

A **human** is the product owner: approves specs, runs final behavioral tests, ships.

The orchestrator drives this. For each task:

```
spec → spec_review → plan → implement → code_review → qa → human_review
```

The human gates between `spec_review` and `plan` — they approve the spec before the pipeline advances to implementation. Within the chain: automatic loops on `changes_requested` verdicts, model/effort scaling by task size, optional git-worktree isolation, session resumption across phases, and auto-block on runaway loops. See `docs/pipeline-orchestrator.md` for the full mechanics.

The pipeline supports two tiers:

- **Fast tier** (XS tasks): spec + plan in one Claude session, skip Codex spec review, human gate replaces it.
- **Full tier** (S / M / L / XL / delicate tasks): every phase runs separately, Codex reviews specs before they reach the human.

`delicate: true` (set in `status.json` at task creation) promotes any task to full tier and upgrades the orchestrator's model and effort across every phase. Use it for sensitive surfaces — auth, payments, persistent storage, anything where a regression has unbounded blast radius.

A single command runs a task end-to-end:

```bash
canon run <task-id>
```

`--step --expect <phase>` runs one phase with a phase-mismatch guard. `--pr` pushes and opens a draft PR at `human_review`. `--ship` runs *after* PR approval — it squash-merges the PR, deletes the branch, tears down the worktree, archives the task, and pulls the base branch (don't merge the PR manually first). `--reroute` resets a task from `human_review` back into the post-review fix path after human feedback on the diff — full-tier tasks (S/M/L/XL or delicate) re-enter at `spec_review`, fast-tier tasks (XS) re-enter at `implement`. `--full-send` skips the spec gate and auto-opens a draft PR on clean QA. `--dry-run` prints planned phases without spawning agents.

Multiple task IDs in one invocation activates **bundle mode** — `canon run id1 id2 id3` runs all tasks together per phase under a single review loop with one commit history and one PR. Any full-tier task in the bundle promotes the entire bundle to full tier.

## Getting started

### Prerequisites

- **Node 24+**
- **git**
- **Claude Code (≥ 2.1.72)** — `npm install -g @anthropic-ai/claude-code`
- **Codex CLI** — `npm install -g @openai/codex`
- **gh** (optional, for `--pr` / `--push`) — `brew install gh && gh auth login`

### Install

```bash
npm install -g canon-ai
```

Or install straight from GitHub:

```bash
npm install -g --install-links github:tstraub89/canon-ai
```

> When installing from GitHub, `--install-links` is required because npm otherwise symlinks the global install to its git cache rather than copying the committed `dist/`, which leaves the `canon` bin pointing at a transient path and command-not-found after the install reports success. The flag packs+installs as a regular dependency, which is what you want for a stable global CLI.

> **Updating.** Once installed, use `canon update` rather than re-running `npm install` by hand — it resolves the exact install this binary is running from, pins to the latest tagged release by default (or a labeled development commit via `--channel main` / `--ref <ref|sha>`), and records what it installed in `provenance.json` under `.canon` for future tooling to read.

### Set up in a repo

```bash
cd your-project

# Install canon into this repo
canon init
```

`canon init` installs the canon task templates and Claude Code skills in your project. Open Claude Code in your project directory and run `/canon-init` to start the interactive setup. The skill grills Claude on your codebase — one question at a time, with recommended answers — and generates the `docs/` knowledge corpus tailored to your project. If you want agent files, generate them separately with the built-in `/init` in Claude Code or Codex; those files are adopter-owned and canon does not scaffold, modify, or read them.

### Generate your agent files with the built-in `/init`

After setup, generate your agent files with the built-in init command for your tool. Claude Code's `/init` produces `CLAUDE.md`; Codex's init produces `AGENTS.md`. These files are high-level codebase overviews that each agent auto-loads at session start.

Optional consolidation: put the shared overview once in `AGENTS.md` and make `CLAUDE.md` import it with a single line:

```text
@AGENTS.md
```

Then append only Claude-specific operator norms below the import. Claude Code expands `@path` imports into context at launch, and Codex auto-loads `AGENTS.md` natively, so both agents converge on one shared overview while operator-only norms stay out of Codex's context.

The other installed skills (auto-trigger on natural-language phrases — see each skill's frontmatter for the trigger set):

| Skill | When it fires |
|---|---|
| `/canon-spec` | Authoring a new task — "let's add X", "start a task for…" |
| `/canon-spec-review` | Pre-flighting a spec before invoking the pipeline |
| `/canon-inline-review` | Independent cross-review of inline or below-pipeline changes before commit or PR |
| `/canon-pipeline` | Driving an existing task forward (`canon run`, `--pr`, `--ship`, recovery) |
| `/canon-status` | "Where are we?" — surfaces phases and blockers across in-flight tasks |
| `/canon-changelog` | Drafting release notes (projects that version their releases) |

After setup:

```bash
# Create your first task (Claude writes the spec conversationally)
canon task new my-first-feature "Short description"

# Run the pipeline
canon run my-first-feature
```

Run `canon doctor` after install to verify your environment — it checks Node/git/Claude Code/Codex versions, codex project trust, allowlist coverage, and that any local Claude settings file is gitignored.

### Discovery nudge (recommended)

If this repo uses canon, add the following to `CLAUDE.md`:

```text
This project uses canon, a spec-first multi-agent pipeline.
Route new features / fixes / refactors through the canon skills.
Start with `/canon-spec` rather than implementing directly.
```

### Independent review for inline work

For below-pipeline changes or trivial inline work, do not self-review. Use `/canon-inline-review` for an independent cross-review before committing, or `codex review` if you are not running canon.

### Skip the permission prompts (optional)

If you run Claude Code in auto mode you'll see few prompts regardless; this allowlist matters most in the default permission mode, and `canon doctor` checks your coverage against it.

Canon drives a lot of `git`, `gh`, `codex`, and `npm` invocations, plus short shell pipelines for inspecting task state (`cat tasks/X/status.json | jq '.phases'`). To avoid a Claude Code permission prompt on every step, drop these into `.claude/settings.json` under `permissions.allow`:

```json
{
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Bash(gh *)",
      "Bash(sed *)",
      "Bash(awk *)",
      "Bash(ls *)",
      "Bash(find *)",
      "Bash(fd *)",
      "Bash(cat *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(wc *)",
      "Bash(echo *)",
      "Bash(tr *)",
      "Bash(xargs *)",
      "Bash(tee *)",
      "Bash(jq *)",
      "Bash(npm run *)",
      "Bash(npm test)",
      "Bash(npm test *)",
      "Bash(npm audit)",
      "Bash(npm audit *)",
      "Bash(npm ci)",
      "Bash(npm ci *)",
      "Bash(npx canon *)",
      "Bash(npx tsc *)",
      "Bash(canon *)",
      "Bash(codex *)",
      "Skill(canon-init)",
      "Skill(canon-spec)",
      "Skill(canon-spec:*)",
      "Skill(canon-pipeline)",
      "Skill(canon-pipeline:*)",
      "Skill(canon-status)",
      "Skill(canon-status:*)",
      "Skill(canon-changelog)",
      "Skill(canon-changelog:*)",
      "Skill(canon-spec-review)",
      "Skill(canon-spec-review:*)",
      "Skill(canon-inline-review)",
      "Skill(canon-inline-review:*)"
    ]
  }
}
```

> The shell-tool entries above (`cat`, `head`, `grep`, `wc`, …) are for **pipeline composition**, not raw file reads. Claude prefers its built-in `Read` / `Glob` / `Grep` tools when fetching a file's contents or searching the codebase; the bash equivalents only get reached for when commands need to be chained (e.g., `cat foo.json | jq '.bar'`, `git diff | grep "version" | head -20`).

Claude Code creates `settings.json` on first use — check what's already there before pasting. For a personal "full send" allowlist that doesn't get committed, use your local Claude Code settings file (and make sure it is gitignored — `canon doctor` will warn you if it isn't).

### Key commands

| Command | What it does |
|---|---|
| `canon init` | Install canon into the current repo |
| `canon doctor` | Verify environment and canon setup — Node/git versions, Claude Code (≥ 2.1.72) and Codex CLI presence, codex project trust, recommended-permission coverage in `.claude/settings.json`, and that any local settings file is gitignored. |
| `canon task new <id> "Title"` | Scaffold a new task from templates |
| `canon task list` | Show all tasks and their pipeline phase |
| `canon task phase <id> <phase> <status>` | Advance a task phase manually |
| `canon task accept <id...> implement [--force]` | Accept a manually-committed `implement` phase outside the pipeline (e.g. after a manual recovery commit). `implement` is the only supported phase today — for other phases use `canon task phase`. |
| `canon run <id>` | Run the full pipeline for a task. Auto-detaches into its own session when stdout is not a TTY (so harness/process-group kills don't take it down); opt out with `CANON_NO_DETACH=1`. |
| `canon run <id> --step --expect <phase>` | Run one phase then stop, with a phase-mismatch guard |
| `canon run <id> --pr` | Push branch and open a draft PR (at `human_review`) |
| `canon run <id> --push` | Push branch only, no PR |
| `canon run <id> --reroute` | Reset a task from `human_review` back into the post-review fix path after appending an `## Amendment` section to `spec.md` (full-tier re-enters at `spec_review`, fast-tier at `implement`) |
| `canon run <id> --full-send` | Skip the spec gate and auto-open a draft PR after clean QA |
| `canon run <id> --ship` | After PR approval: squash-merge, delete branch, tear down worktree, archive the task, pull base branch. Don't merge the PR manually first. |
| `canon run <id> --dry-run` | Print each planned phase and exit without spawning any agent |
| `canon stop <id>` | Stop a detached canon run (SIGTERM → SIGKILL after 10s). Waits up to 30s — override via `CANON_STOP_WAIT_MS` — for the orchestrator's first heartbeat to verify the PID before signaling. |
| `canon upgrade` | Sync vendored canon-owned files to match the installed version. It does not touch adopter-owned `AGENTS.md` or `CLAUDE.md`. Refuses to overwrite canon-owned targets that are locally modified, untracked but present, or whose git state cannot be verified unless `--force` is set. Use `--check` (or `--dry-run`) to preview, `--no-stage` to skip the auto-`git add`. |
| `canon update` | Update the canon-ai package itself. Targets the install's own root (never the invocation directory) and pins to the latest final release by default; refuses rather than installing an unpinned branch. `--channel main` / `--ref <ref\|sha>` pin a labeled development commit instead. Writes `provenance.json` in `.canon` after a successful install — recorded for future tooling, nothing reads it yet. |

Full `canon task` subcommand reference is in `docs/pipeline-orchestrator.md`.

### Customizing task templates

Task templates live in `.canon/templates/` and are managed by canon — `canon upgrade` overwrites them. To customize a template for your project, copy it to `tasks/_templates/`:

```bash
cp .canon/templates/spec.md tasks/_templates/spec.md
# edit tasks/_templates/spec.md — add your validation commands, project-specific sections, etc.
```

`canon task new` checks `tasks/_templates/` first and falls back to `.canon/templates/`. Files in `tasks/_templates/` are never touched by `canon upgrade`.

After upgrading, check whether structural changes landed in the canonical template that you should incorporate into your override:

```bash
diff .canon/templates/spec.md tasks/_templates/spec.md
```

See `.canon/README.md` for a quick reference.

## Architecture: two layers

Canon is two products:

### Layer 1: The Scaffold

The portable structure: orchestration scripts, task templates, the agent rules (delivered just-in-time through the per-phase prompt templates and `/canon-*` skills), knowledge corpus templates (`docs/patterns.md`, `docs/decisions.md`, etc.), config files for both CLIs. `AGENTS.md` / `CLAUDE.md` are adopter-owned — canon does not ship or modify them, and they come from the built-in `/init` flow rather than `/canon-init`.

Drop this into any repo and you have:

- A working multi-agent pipeline that runs spec → review → implement → review → QA without intervention
- Templates for every artifact the pipeline produces
- The discipline (low-padding communication norms, two-stage code review, code-is-canonical, etc.) carried by the pipeline's per-phase prompts and `/canon-*` skills
- A knowledge corpus structure (`docs/patterns.md`, `docs/decisions.md`, `docs/codebase-map.md`) you fill in as your project's conventions emerge

### Layer 2: The Bootstrap CLI

`canon init` + `/canon-init` — installed as a Claude Code skill in your project. Grills Claude on your codebase and generates the initial knowledge corpus: codebase map, decisions surfaced from your existing conventions, patterns you're already using. The goal: collapse the "fill in your canon as you go" cold start into a single onboarding session.

## Current scope

✅ **Built and working:**

- `canon` CLI — `init`, `doctor`, `run`, `stop`, `task`, `update`, `upgrade`
- Full pipeline orchestrator with phase routing, worktree isolation, session resumption, auto-block, bundle mode, `--reroute`, `--ship`. Bundled into `dist/orchestrator/run-task.js` and invoked via `canon run`.
- Pure routing policy module (tier/sizing/model/effort matrix), table-tested.
- `canon task` lifecycle CLI (new / list / status / phase / accept / reset-spec-review / post-merge-sync), in-process TS.
- `.canon/templates/` — artifact templates (status, spec, spec-review, plan, handoff, review, done, notes)
- Agent rules and per-agent guidance delivered just-in-time via per-phase prompt templates (`src/orchestrator/prompts/templates/`) and the `/canon-*` skills; adopters generate their own `AGENTS.md` / `CLAUDE.md` with the built-in `/init`
- `docs/` — knowledge corpus templates with detailed scaffolding
- `.claude/settings.json` — Claude Code permissions + SessionStart hook
- Claude Code skills installed by `canon init`: `/canon-init` (knowledge-corpus bootstrap), `/canon-spec` (new task authoring), `/canon-spec-review` (pre-flight a spec), `/canon-inline-review` (independent cross-review of below-pipeline work), `/canon-pipeline` (drive an existing task), `/canon-status` (in-flight task map), `/canon-changelog` (release notes for versioned projects)
- Unit-test suite covering the policy module, orchestrator extractors, and validation parsers (`npm test`)

## Where to Go Deeper

- `docs/pipeline-orchestrator.md` for orchestrator mechanics, reroute, worktrees, and PR/ship flow.
- `docs/release-process.md` for release-cut mechanics and branch/version flow.
- `docs/patterns.md` for implementation pitfalls and load-bearing patterns.
- `docs/decisions.md` for settled rules and architecture decisions.
- `docs/codebase-map.md` for file locations and entry points.

🚧 **Stubbed with `TODO[canon]:` markers — fill in for your project:**

- Validation command bindings in `docs/architecture.md` §Validation (which commands satisfy each check category — the universal category matrix ships complete in `implement.md` / `.canon/templates/spec.md`)
- Project-specific implementation conventions (state, styling, perf, testing, gating, assets, analytics) captured in `docs/patterns.md` / `docs/decisions.md` as they emerge (the universal implementation rules ship complete in `implement.md`)
- All `docs/*.md` content (the templates teach you the format; the substance is yours — partially generated by `/canon-init`)

❌ **Not in scope for MVP:**

- Adapters for other agentic CLIs (Gemini CLI, Aider, etc.) — assumed Claude Code + Codex CLI
- Pre-built docs-check / external-API-citation tooling (project-specific)
- Per-language project bootstrappers (Python / Rust / Go variants)

## Supported platforms

- **macOS** and **Linux** are the supported targets. Canon's worktree helpers shell out to `git` for `worktree add`/`remove` and `worktree list --porcelain` parsing.
- **Windows is not supported.** Use WSL2.
- **Node**: 24.x.

## The canon philosophy

The metaphor matters. A *canon* is a body of accumulated, authoritative work — the texts that define a tradition. It accrues over time. New work is judged against it. Once something is canonical, you don't re-debate it.

That's exactly what `docs/patterns.md`, `docs/decisions.md`, and the `docs/` knowledge corpus are. They start small. They grow as the project ships features and absorbs lessons. They become more authoritative over time. And the more authoritative they are, the better the agents perform — because the agents stop having to guess.

The implication: **the value of canon compounds with use**. A 6-month-old canon repo on a real project is dramatically more useful than a fresh canon repo on a fresh project.

## Roadmap

**Phase 1 (now)**: Layer 1 + Layer 2 ship. Full CLI, open source, installable from npm or GitHub. `/canon-init` skill for interactive project bootstrap. Validate against real projects.

**Phase 2 (next)**: Make the implementer slot pluggable — adapter interface for Codex CLI, Gemini CLI, Aider, others. Architect slot stays Claude Code (skills are load-bearing).

**Phase 3 (research)**: Productize. Hosted bootstrap service? Per-language scaffolds? Marketplace for `docs/patterns.md` starter packs (Next.js patterns, Rails patterns, etc.)? TBD based on Phase 1 validation.

## License

[MIT](LICENSE).

## Origin

Canon is the result of pulling the multi-agent pipeline out of [GalleryPlanner](https://gallery-planner.com), where it was developed and refined over several months of shipping features. The discipline encoded here was earned the hard way — every rule corresponds to a bug that shipped because the rule wasn't there yet.

That's the asset. The scripts are easy. The accumulated discipline is the moat.
