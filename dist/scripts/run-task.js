#!/usr/bin/env node

// scripts/run-task/signals.ts
var activeChildren = /* @__PURE__ */ new Set();
var shutdownHooks = [];
function registerShutdownHook(hook) {
  shutdownHooks.push(hook);
}
function registerActiveChild(child) {
  activeChildren.add(child);
  const drop = () => {
    activeChildren.delete(child);
  };
  child.once("close", drop);
  child.once("error", drop);
}
function killChildGroup(child, sig) {
  if (child.pid == null) return false;
  try {
    process.kill(-child.pid, sig);
    return true;
  } catch {
    try {
      child.kill(sig);
      return true;
    } catch {
      return false;
    }
  }
}
process.on("SIGHUP", () => {
  process.stderr.write("WARN: SIGHUP received; ignoring (orchestrator survives supervising-shell exit).\n");
});
function forwardAndExit(sig) {
  for (const child of activeChildren) {
    killChildGroup(child, sig);
  }
  for (const hook of shutdownHooks) {
    try {
      hook();
    } catch {
    }
  }
  process.removeAllListeners(sig);
  process.kill(process.pid, sig);
}
process.on("SIGINT", () => forwardAndExit("SIGINT"));
process.on("SIGTERM", () => forwardAndExit("SIGTERM"));

// scripts/run-task.ts
import { pathToFileURL } from "url";

// scripts/run-task/main.ts
import { spawnSync as spawnSync6 } from "child_process";
import fs16 from "fs";
import path17 from "path";

// scripts/run-task/phases/code-review.ts
import fs11 from "fs";
import path12 from "path";

// scripts/run-task/cli.ts
function die(message) {
  console.error(`\u274C ${message}`);
  process.exit(1);
}
function info(message) {
  console.log(`\u2192 ${message}`);
}
function warn(message) {
  console.error(`\u26A0\uFE0F  ${message}`);
}
function printUsage() {
  console.log("Usage: canon run <TASK-ID...> [options]");
  console.log("");
  console.log("  Single task:  canon run fix-hover-state");
  console.log("  Bundle:       canon run fix-hover-state dark-tokens empty-cta");
  console.log("");
  console.log("  Bundle mode runs all tasks together per phase (one agent session each).");
  console.log("  Fast tier (S, non-delicate only) skips Codex spec review. Full tier (any M/L/XL");
  console.log("  or delicate task) runs the complete pipeline \u2014 any such task pulls the entire");
  console.log("  bundle to full tier.");
  console.log("");
  console.log("Options:");
  console.log("  --interactive, -I   Open interactive agent sessions");
  console.log("  --step, -1          Run one phase then stop");
  console.log("  --expect <phase>    Assert current phase before running");
  console.log("  --pr                At human_review: push branch and open a draft PR (requires gh).");
  console.log("                      Auto-commit allow-list: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and");
  console.log(`                      managed docs listed in spec.md's "### Affected Files" table. Dirty`);
  console.log("                      files outside that set die with a remediation message.");
  console.log("                      Aborts if HEAD's tree differs from origin/<base> on files not in");
  console.log("                      spec's Affected Files (bypass with --force).");
  console.log("  --push              At human_review: push branch only, no PR (requires gh). Same");
  console.log("                      allow-list as --pr. Aborts if HEAD's tree differs from origin/<base>");
  console.log("                      on files not in spec's Affected Files (bypass with --force).");
  console.log("  --full-send         Skip the spec gate and auto-open a draft PR after clean QA");
  console.log("  --force             Acknowledge high-commitment combinations and bypass");
  console.log("                      explicit safety gates where documented (currently:");
  console.log("                      --full-send on delicate tasks, reroute amendment gate,");
  console.log("                      base-drift gate, and dirty REPO_ROOT worktree-start gate).");
  console.log("  --allow-divergent-base");
  console.log("                      At --push, --pr, and --ship: bypass only the commit-divergence");
  console.log("                      block when local <base> has commits not yet on origin/<base>.");
  console.log("                      Does NOT bypass the file-allow-list gate; use --force for that.");
  console.log("                      Independent of --force \u2014 both may be needed to pass both gates.");
  console.log("  --ship              Merge the open PR (calls gh pr merge --squash --delete-branch), tear");
  console.log("                      down the worktree, archive the task dir, and pull the base branch. Run");
  console.log("                      after the PR is approved \u2014 do NOT merge the PR manually first. If you");
  console.log("                      already merged externally, --ship detects the merged state and resumes");
  console.log("                      at cleanup.");
  console.log("  --dry-run           Print each planned phase and exit without spawning any LLM");
  console.log("  --reroute           Reset a task from human_review back into the post-review fix path after");
  console.log("                      human feedback. Full-tier tasks (M/L/XL or delicate) re-enter at");
  console.log("                      spec_review; fast-tier tasks (S) re-enter at implement.");
  console.log("                      Feedback channel: append a new section to tasks/<id>/spec.md describing");
  console.log("                      what to address. Codex re-reads spec.md only \u2014 additions to review.md");
  console.log("                      or PR comments are NOT consulted on reroute.");
  console.log("                      Pre-flight requires `## Amendment` on round 1 or `## Amendment Round N`");
  console.log('                      on round 2+. Bypass with --force. See CLAUDE.md "Reroute feedback');
  console.log('                      channel."');
}
function parseArgs(argv) {
  if (argv.length === 0) {
    printUsage();
    process.exit(1);
  }
  if (argv[0] === "--help") {
    printUsage();
    process.exit(0);
  }
  const taskIds = [];
  let interactive = false;
  let step = false;
  let expectPhase = null;
  let push2 = false;
  let pr = false;
  let reroute = false;
  let ship = false;
  let dryRun = false;
  let fullSend = false;
  let force = false;
  let allowDivergentBase = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--interactive":
      case "-I":
        interactive = true;
        break;
      case "--step":
      case "-1":
        step = true;
        break;
      case "--expect":
        index += 1;
        if (index >= argv.length) die("--expect requires a phase argument");
        expectPhase = argv[index];
        break;
      case "--push":
        push2 = true;
        break;
      case "--pr":
        pr = true;
        break;
      case "--reroute":
        reroute = true;
        break;
      case "--full-send":
        fullSend = true;
        break;
      case "--force":
        force = true;
        break;
      case "--allow-divergent-base":
        allowDivergentBase = true;
        break;
      case "--ship":
        ship = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        if (arg.startsWith("--")) die(`Unknown option: ${arg}`);
        taskIds.push(arg);
    }
  }
  if (reroute && fullSend) {
    die("--reroute and --full-send are mutually exclusive in a single invocation. Run --reroute first, then --full-send if you want to re-trust the result.");
  }
  if (taskIds.length === 0) die("At least one TASK-ID is required.");
  return { taskIds, interactive, step, expectPhase, push: push2, pr, reroute, ship, dryRun, fullSend, force, allowDivergentBase };
}
function validateTaskId(id) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    die(`Invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores.`);
  }
  if (id.includes("..")) {
    die(`Invalid task ID '${id}'. Must not contain '..'.`);
  }
}

// scripts/run-task/git.ts
import { spawnSync as spawnSync3 } from "child_process";
import path5 from "path";

// scripts/run-task/env.ts
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function resolveRepoRoot() {
  try {
    const result = spawnSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(result.stderr || "git rev-parse --git-common-dir failed");
    }
    const gitCommonDir = result.stdout.trim();
    if (!gitCommonDir) throw new Error("git rev-parse --git-common-dir returned no path");
    const resolvedGitCommonDir = path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(process.cwd(), gitCommonDir);
    return path.dirname(resolvedGitCommonDir);
  } catch {
    return path.resolve(__dirname, "../..");
  }
}
var REPO_ROOT = resolveRepoRoot();
var TASKS_DIR = path.join(REPO_ROOT, "tasks");
var WORKTREES_ROOT = process.env.CANON_WORKTREES_ROOT ? path.resolve(process.env.CANON_WORKTREES_ROOT) : path.resolve(REPO_ROOT, "../dev-worktrees");
var STALL_TIMEOUT_MS = Number(process.env.PIPELINE_STALL_TIMEOUT_MS) || 10 * 60 * 1e3;
var STALL_KILL_GRACE_MS = 3e3;
var LEGACY_FALLBACK_ENV_VARS = [
  { old: "CLAUDE_MODEL", replacement: "CLAUDE_MODEL_SPEC / _PLAN / _REVIEW (still honored as fallback for those three; not applied to qa)" },
  { old: "CODEX_MODEL_DEFAULT", replacement: "CODEX_MODEL_MINI (still honored as fallback)" },
  { old: "CODEX_MODEL_DELICATE", replacement: "CODEX_MODEL_FULL (still honored as fallback)" }
];
var LEGACY_IGNORED_ENV_VARS = [
  { old: "CODEX_EFFORT_DEFAULT", reason: "effort is now matrix-driven by task size in getCodexConfig() \u2014 no equivalent knob" },
  { old: "CODEX_EFFORT_DELICATE", reason: "effort is now matrix-driven by task size in getCodexConfig() \u2014 no equivalent knob" }
];
function warnLegacyEnvVars() {
  for (const { old, replacement } of LEGACY_FALLBACK_ENV_VARS) {
    if (process.env[old]) {
      console.error(`\u26A0\uFE0F  ${old} is deprecated \u2014 use ${replacement}. Current run still honors it.`);
    }
  }
  for (const { old, reason } of LEGACY_IGNORED_ENV_VARS) {
    if (process.env[old]) {
      console.error(`\u26A0\uFE0F  ${old} is no longer honored \u2014 ${reason}. Update the matrix in scripts/run-task.ts if you need different effort.`);
    }
  }
}
function warnWorktreesRootMismatch() {
  if (!process.env.CANON_WORKTREES_ROOT) return;
  const candidates = [
    path.join(REPO_ROOT, ".claude/settings.json"),
    path.join(REPO_ROOT, ".claude/settings.local.json")
  ];
  const declaredDirs = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const dirs = parsed.permissions?.additionalDirectories ?? [];
      for (const dir of dirs) {
        declaredDirs.push(path.resolve(REPO_ROOT, dir));
      }
    } catch {
    }
  }
  if (declaredDirs.length === 0) return;
  const matches = declaredDirs.some((dir) => dir === WORKTREES_ROOT);
  if (matches) return;
  console.error(
    `\u26A0\uFE0F  CANON_WORKTREES_ROOT is set to ${WORKTREES_ROOT}, but no \`additionalDirectories\` entry in .claude/settings.json or .claude/settings.local.json matches that path. Claude Code will not be able to read/write inside the worktree. Add ${WORKTREES_ROOT} to additionalDirectories in one of those files (settings.local.json is the right place for per-machine overrides).`
  );
}
function resolveProjectName() {
  if (process.env.CANON_PROJECT_NAME) return process.env.CANON_PROJECT_NAME;
  try {
    const pkgPath = path.join(REPO_ROOT, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.name) return pkg.name;
    }
  } catch {
  }
  return "your project";
}
var config = {
  projectName: resolveProjectName(),
  claudeBudget: process.env.CLAUDE_BUDGET ?? "5.00",
  claudeModelSpec: process.env.CLAUDE_MODEL_SPEC ?? process.env.CLAUDE_MODEL ?? "opus",
  claudeModelPlan: process.env.CLAUDE_MODEL_PLAN ?? process.env.CLAUDE_MODEL ?? "sonnet",
  claudeModelReview: process.env.CLAUDE_MODEL_REVIEW ?? process.env.CLAUDE_MODEL ?? "sonnet",
  claudeModelReviewLarge: process.env.CLAUDE_MODEL_REVIEW_LARGE ?? process.env.CLAUDE_MODEL ?? "opus",
  claudeModelQa: process.env.CLAUDE_MODEL_QA ?? process.env.CLAUDE_MODEL ?? "sonnet",
  codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? "gpt-5.4-mini",
  codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? "gpt-5.5",
  maxReviewLoops: process.env.MAX_REVIEW_LOOPS ? Number.parseInt(process.env.MAX_REVIEW_LOOPS, 10) : null,
  maxContextBytes: Number.parseInt(process.env.MAX_CONTEXT_BYTES ?? String(64 * 1024), 10)
};

// scripts/run-task/heartbeat.ts
import fs2 from "fs";
import path2 from "path";
var HEARTBEAT_FILENAME = ".heartbeat.json";
var HEARTBEAT_INTERVAL_MS = 3e4;
var HEARTBEAT_STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 2;
var activeHandles = /* @__PURE__ */ new Set();
function startHeartbeat(taskIds, resolveTaskDir, options = {}) {
  const startedAtMs = Date.now();
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const writeOnce = () => {
    const record = {
      pid: process.pid,
      started_at_ms: startedAtMs,
      last_update_ms: Date.now(),
      task_ids: [...taskIds]
    };
    const payload = `${JSON.stringify(record, null, 2)}
`;
    for (const taskId of taskIds) {
      let dir;
      try {
        dir = resolveTaskDir(taskId);
      } catch {
        continue;
      }
      const file = path2.join(dir, HEARTBEAT_FILENAME);
      const tmp = `${file}.tmp`;
      try {
        fs2.mkdirSync(dir, { recursive: true });
        fs2.writeFileSync(tmp, payload, "utf8");
        fs2.renameSync(tmp, file);
      } catch {
      }
    }
  };
  writeOnce();
  const timer = setInterval(writeOnce, intervalMs);
  timer.unref();
  const handle = {
    tick: writeOnce,
    stop: () => {
      clearInterval(timer);
      activeHandles.delete(handle);
      for (const taskId of taskIds) {
        let dir;
        try {
          dir = resolveTaskDir(taskId);
        } catch {
          continue;
        }
        try {
          fs2.unlinkSync(path2.join(dir, HEARTBEAT_FILENAME));
        } catch {
        }
      }
    }
  };
  activeHandles.add(handle);
  return handle;
}
function stopAllHeartbeats() {
  for (const handle of [...activeHandles]) {
    handle.stop();
  }
}
function tickAllHeartbeats() {
  for (const handle of [...activeHandles]) {
    handle.tick();
  }
}

// scripts/run-task/state.ts
import fs3 from "fs";
import { spawnSync as spawnSync2 } from "child_process";
import path3 from "path";

// scripts/run-task/types.ts
var PHASE_ORDER = ["spec", "spec_review", "plan", "implement", "code_review", "qa", "human_review"];
var _PHASE_STATUS_VALUES = ["pending", "in_progress", "done", "changes_requested", "blocked"];
var _VERDICT_VALUES = ["approved", "approved_with_nits", "changes_requested", "needs_re_review", "spec_gap"];
function isPhaseStatus(value) {
  return typeof value === "string" && _PHASE_STATUS_VALUES.includes(value);
}
function isVerdict(value) {
  return typeof value === "string" && _VERDICT_VALUES.includes(value);
}

// scripts/run-task/state.ts
function effectiveWorktreesRoot() {
  return process.env.CANON_WORKTREES_ROOT ? path3.resolve(process.env.CANON_WORKTREES_ROOT) : WORKTREES_ROOT;
}
function findExistingWorktreeForBranch(branch) {
  const result = spawnSync2("git", ["worktree", "list", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) return null;
  const lines = (result.stdout ?? "").split("\n");
  let currentPath = null;
  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch refs/heads/") && currentPath && currentPath !== REPO_ROOT) {
      const lineBranch = line.slice("branch refs/heads/".length).trim();
      if (lineBranch === branch) return currentPath;
    }
  }
  return null;
}
function taskDirForRepoRoot(taskId) {
  return path3.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR, taskId);
}
function taskDirFor(taskId) {
  if (process.env.CANON_TASKS_DIR_OVERRIDE) {
    return path3.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId);
  }
  return path3.join(resolveTaskCwd(taskId), "tasks", taskId);
}
function resolveTaskCwd(taskId) {
  const worktreesRoot = effectiveWorktreesRoot();
  const directWorktree = path3.join(worktreesRoot, taskId);
  const directStatus = path3.join(directWorktree, "tasks", taskId, "status.json");
  if (fs3.existsSync(directStatus)) return directWorktree;
  const statusPath = path3.join(taskDirForRepoRoot(taskId), "status.json");
  try {
    const parsed = JSON.parse(fs3.readFileSync(statusPath, "utf8"));
    if (parsed.worktree === true) {
      const branch = parsed.branch?.trim() ?? "";
      if (branch) {
        const existing = findExistingWorktreeForBranch(branch);
        if (existing) return existing;
        die(
          `Worktree for task '${taskId}' is expected but missing.
  Looked for ${directWorktree} and a worktree for branch '${branch}'.
  Restore or recreate the worktree before continuing.`
        );
      }
    }
  } catch {
  }
  return REPO_ROOT;
}
function statusFileFor(taskId) {
  if (process.env.CANON_TASKS_DIR_OVERRIDE) {
    return path3.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId, "status.json");
  }
  return path3.join(resolveTaskCwd(taskId), "tasks", taskId, "status.json");
}
function validateBranchField(value, taskId, fieldName) {
  if (value === void 0) return;
  if (typeof value !== "string") {
    throw new Error(`Invalid ${fieldName} in task '${taskId}': expected string, got ${typeof value}. Edit status.json.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return;
  if (trimmed.startsWith("-")) {
    throw new Error(`Invalid ${fieldName} in task '${taskId}': '${value}' looks like a flag, not a branch name. Edit status.json.`);
  }
  if (/[\x00-\x1F\x7F\s:]/.test(trimmed)) {
    throw new Error(`Invalid ${fieldName} in task '${taskId}': '${value}' contains control chars, whitespace, or refspec separator. Edit status.json.`);
  }
}
function validateNonNegativeInt(value, taskId, fieldPath) {
  if (value === void 0) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${fieldPath} in task '${taskId}': expected non-negative integer, got ${JSON.stringify(value)}. Edit status.json.`);
  }
}
function validateStatus(taskId, parsed) {
  validateBranchField(parsed.branch, taskId, "branch");
  validateBranchField(parsed.base_branch, taskId, "base_branch");
  const phases = parsed.phases ?? {};
  for (const [phaseName, entry] of Object.entries(phases)) {
    if (!entry) continue;
    for (const field of ["iterations", "iterations_current_loop", "iterations_total", "changes_requested_total", "preflight_rejections_current_loop", "preflight_rejections_total", "auto_block_count", "reroute_count"]) {
      validateNonNegativeInt(entry[field], taskId, `phases.${phaseName}.${field}`);
    }
  }
}
function readStatus(taskId) {
  return readStatusFromPath(statusFileFor(taskId), taskId);
}
function readStatusFromPath(statusFile, taskIdForErrors = "<unknown>") {
  const parsed = JSON.parse(fs3.readFileSync(statusFile, "utf8"));
  validateStatus(taskIdForErrors, parsed);
  return parsed;
}
function deriveTopLevelStatus(status) {
  for (const phase of PHASE_ORDER) {
    const phaseStatus = status.phases[phase]?.status ?? "pending";
    if (phaseStatus !== "done") return phase;
  }
  return "complete";
}
function writeStatus(taskId, status) {
  writeStatusToFile(statusFileFor(taskId), status);
}
function writeStatusToFile(statusFile, status) {
  status.status = deriveTopLevelStatus(status);
  const tmpFile = `${statusFile}.tmp`;
  fs3.writeFileSync(tmpFile, `${JSON.stringify(status, null, 2)}
`, "utf8");
  fs3.renameSync(tmpFile, statusFile);
}
function storeSessionId(taskIds, agent, sessionId) {
  for (const taskId of taskIds) {
    const s = readStatus(taskId);
    if (!s.sessions) s.sessions = {};
    s.sessions[agent] = sessionId;
    writeStatus(taskId, s);
  }
}
function getStoredSessionId(taskIds, agent) {
  return readStatus(taskIds[0]).sessions?.[agent] ?? null;
}
function autoBlockPhase(taskIds, phase, iterationCount, reason) {
  const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    const phaseEntry = status.phases[phase];
    if (phaseEntry) {
      phaseEntry.status = "blocked";
      phaseEntry.auto_block_count = (phaseEntry.auto_block_count ?? 0) + 1;
    }
    status.escalations = status.escalations ?? [];
    status.escalations.push({ date: today2, phase, iteration_count: iterationCount, reason });
    status.updated = today2;
    writeStatus(taskId, status);
  }
}

// scripts/run-task/worktree.ts
import fs4 from "fs";
import path4 from "path";
var PIPELINE_TELEMETRY_FILES = [
  "docs/pipeline-invocations.md",
  "docs/task-quality-log.md",
  "docs/lessons-learned.md"
];
var PIPELINE_MANAGED_DOCS = [
  "docs/architecture.md",
  "docs/codebase-map.md",
  "docs/decisions.md",
  "docs/patterns.md",
  "docs/pipeline-orchestrator.md",
  "docs/product-context.md"
];
var PIPELINE_SHARED_DOCS = [...PIPELINE_TELEMETRY_FILES, ...PIPELINE_MANAGED_DOCS];
var TASK_ARTIFACT_FILES = /* @__PURE__ */ new Set([
  "spec.md",
  "spec-review.md",
  "plan.md",
  "handoff.md",
  "review.md",
  "done.md",
  "pr-body.md",
  "notes.md"
]);
function worktreePath(taskId) {
  return path4.join(WORKTREES_ROOT, taskId);
}
function isWorktreeEnabled(taskIds) {
  return readStatus(taskIds[0]).worktree === true;
}
function getActiveCwd(taskIds, options = {}) {
  if (isWorktreeEnabled(taskIds)) {
    const wt = worktreePath(taskIds[0]);
    if (fs4.existsSync(wt)) return wt;
    const branch = readStatus(taskIds[0]).branch;
    if (branch) {
      const existing = findExistingWorktreeForBranch2(branch);
      if (existing) return existing;
      if (options.tolerateMissingWorktree) {
        warn(
          `Worktree for task '${taskIds[0]}' is expected but missing \u2014 continuing with REPO_ROOT. (Partial-cleanup state recovery.)`
        );
        return REPO_ROOT;
      }
      die(
        `Worktree for task '${taskIds[0]}' is expected but missing.
  Restore or recreate the worktree before continuing.`
      );
    }
  }
  return REPO_ROOT;
}
function findExistingWorktreeForBranch2(branch) {
  const result = gitSafe("worktree", "list", "--porcelain");
  if (!result.ok) return null;
  const lines = result.stdout.split("\n");
  let currentPath = null;
  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch refs/heads/") && currentPath && currentPath !== REPO_ROOT) {
      const lineBranch = line.slice("branch refs/heads/".length).trim();
      if (lineBranch === branch) return currentPath;
    }
  }
  return null;
}
function ensureWorktree(taskId, branch, startPoint) {
  if (!fs4.existsSync(WORKTREES_ROOT)) {
    fs4.mkdirSync(WORKTREES_ROOT, { recursive: true });
  }
  const wt = worktreePath(taskId);
  if (fs4.existsSync(wt)) {
    info(`Worktree already exists: ${wt}`);
    return wt;
  }
  const existingWt = findExistingWorktreeForBranch2(branch);
  if (existingWt) {
    info(`Worktree already exists for branch '${branch}': ${existingWt}`);
    return existingWt;
  }
  const repoModulesSrc = path4.join(REPO_ROOT, "node_modules");
  const repoPackageJson = path4.join(REPO_ROOT, "package.json");
  if (fs4.existsSync(repoPackageJson) && !fs4.existsSync(repoModulesSrc)) {
    die(
      `Worktree setup aborted: ${REPO_ROOT}/node_modules does not exist, but package.json does. The orchestrator symlinks node_modules from REPO_ROOT into each worktree; that requires REPO_ROOT to have its dependencies installed first. Run \`npm install\` (or \`npm ci\`) in ${REPO_ROOT} and try again.`
    );
  }
  if (gitSafe("show-ref", "--verify", "--quiet", `refs/heads/${branch}`).ok) {
    info(`Creating worktree at ${wt} (branch: ${branch})...`);
    git("worktree", "add", wt, branch);
  } else {
    const startSuffix = startPoint ? ` from ${startPoint}` : "";
    info(`Creating worktree at ${wt} (new branch: ${branch}${startSuffix})...`);
    const args = ["worktree", "add", "-b", branch, wt];
    if (startPoint) args.push(startPoint);
    git(...args);
  }
  const wtModules = path4.join(wt, "node_modules");
  if (fs4.existsSync(repoPackageJson) && !fs4.existsSync(wtModules)) {
    fs4.symlinkSync(repoModulesSrc, wtModules);
    info("Symlinked node_modules into worktree.");
  }
  const envFiles = fs4.readdirSync(REPO_ROOT).filter(
    (name) => name.startsWith(".env") && fs4.statSync(path4.join(REPO_ROOT, name)).isFile()
  );
  const linkedEnvFiles = [];
  for (const envFile of envFiles) {
    const dst = path4.join(wt, envFile);
    if (!fs4.existsSync(dst)) {
      fs4.symlinkSync(path4.join(REPO_ROOT, envFile), dst);
      linkedEnvFiles.push(envFile);
    }
  }
  if (linkedEnvFiles.length > 0) {
    info(`Symlinked env file(s) into worktree: ${linkedEnvFiles.join(", ")}.`);
  }
  info("Worktree ready.");
  return wt;
}
function teardownWorktree(taskId) {
  const wt = worktreePath(taskId);
  if (!fs4.existsSync(wt)) return;
  info(`Removing worktree ${wt}...`);
  const result = gitSafe("worktree", "remove", "--force", wt);
  if (!result.ok) warn(`Could not remove worktree: ${result.stderr}`);
  else info("Worktree removed.");
}

// scripts/run-task/git.ts
function runCommand(command, args) {
  const result = spawnSync3(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) return { ok: false, stdout: "", stderr: result.error.message };
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim()
  };
}
function runCommandOrDie(command, args, options = {}) {
  const result = spawnSync3(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (typeof result.status === "number" && result.status !== 0) process.exit(result.status);
  if (result.signal) process.exit(1);
}
function git(...args) {
  const result = runCommand("git", args);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || "unknown error"}`);
  return result.stdout;
}
function gitSafe(...args) {
  return runCommand("git", args);
}
function gitSafeAt(cwd, ...args) {
  const result = spawnSync3("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { ok: false, stdout: "", stderr: result.error.message };
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
function gitSafeAtRaw(cwd, ...args) {
  const result = spawnSync3("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { ok: false, stdout: "", stderr: result.error.message };
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: (result.stderr ?? "").trim() };
}
function filterGitIgnoredPaths(paths, cwd) {
  if (paths.length === 0) return /* @__PURE__ */ new Set();
  const result = spawnSync3("git", ["check-ignore", "--stdin", "-z"], {
    cwd,
    input: `${paths.join("\0")}\0`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0 && result.status !== 1) {
    return /* @__PURE__ */ new Set();
  }
  const stdout = result.stdout ?? "";
  return new Set(stdout.split("\0").filter((p) => p.length > 0));
}
function commitTaskArtifactsToBase(taskIds, _artifactFiles) {
  void _artifactFiles;
  for (const taskId of taskIds) {
    const taskDir = path5.relative(REPO_ROOT, taskDirForRepoRoot(taskId));
    const status = gitSafe("status", "--porcelain", "--", taskDir);
    if (!status.ok || status.stdout.trim().length === 0) continue;
    git("add", "--", taskDir);
    git("commit", "-m", `task(${taskId}): commit artifacts pre-pipeline`, "--only", "--", taskDir);
    info(`Committed task artifacts for ${taskId} to base branch.`);
  }
  const dirtyTelemetry = [];
  for (const relPath of PIPELINE_TELEMETRY_FILES) {
    const status = gitSafe("status", "--porcelain", "--", relPath);
    if (status.ok && status.stdout.trim().length > 0) dirtyTelemetry.push(relPath);
  }
  if (dirtyTelemetry.length > 0) {
    for (const relPath of dirtyTelemetry) git("add", "--", relPath);
    git(
      "commit",
      "-m",
      `chore: absorb pre-implement telemetry into scaffold for ${taskIds.join(", ")}`,
      "--only",
      "--",
      ...dirtyTelemetry
    );
    info(`Absorbed pre-implement telemetry into scaffold for ${taskIds.join(", ")}.`);
  }
}
function getCurrentBranch() {
  return git("rev-parse", "--abbrev-ref", "HEAD");
}
function branchExistsLocally(name) {
  return gitSafe("show-ref", "--verify", "--quiet", `refs/heads/${name}`).ok;
}
function getDefaultBaseBranch() {
  if (branchExistsLocally("main")) return "main";
  if (branchExistsLocally("master")) return "master";
  die("Neither main nor master branch found locally.");
}
function getBaseBranch(taskIds) {
  if (taskIds && taskIds.length > 0) {
    const bases = /* @__PURE__ */ new Set();
    for (const id of taskIds) {
      const status = readStatus(id);
      const declared = (status.base_branch ?? "").trim();
      bases.add(declared || getDefaultBaseBranch());
    }
    if (bases.size > 1) {
      die(
        `Bundle base_branch mismatch: tasks have different base branches (${[...bases].join(", ")}). All tasks in a bundle must target the same base. Edit status.json to align before invoking.`
      );
    }
    return [...bases][0];
  }
  return getDefaultBaseBranch();
}
function getUnpushedBaseCommits(baseBranch, cwd) {
  const result = gitSafeAtRaw(cwd, "log", `origin/${baseBranch}..${baseBranch}`, "--format=%H%x09%s");
  if (!result.ok) {
    return { commits: [], ok: false, stderr: result.stderr };
  }
  const commits = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const tabIndex = line.indexOf("	");
    if (tabIndex === -1) continue;
    commits.push({
      sha: line.slice(0, tabIndex),
      subject: line.slice(tabIndex + 1)
    });
  }
  return { commits, ok: true, stderr: "" };
}
function truncateUtf8(input, capBytes) {
  const bytes = Buffer.from(input, "utf8");
  if (bytes.length <= capBytes) return input;
  let end = capBytes;
  while (end > 0 && (bytes[end] & 192) === 128) end--;
  return bytes.subarray(0, end).toString("utf8");
}
function getScopedDiff(baseBranch, cwd, capBytes = 5e4) {
  const result = gitSafeAtRaw(cwd, "diff", `${baseBranch}...HEAD`);
  if (!result.ok) return null;
  const raw = result.stdout;
  if (Buffer.byteLength(raw, "utf8") <= capBytes) {
    return { diff: raw, truncated: false };
  }
  return {
    diff: truncateUtf8(raw, capBytes),
    truncated: true
  };
}
function isCommandAvailable(command) {
  const result = spawnSync3("which", [command], { stdio: "ignore" });
  return !result.error && result.status === 0;
}
function isPipelineOwnedDirtyPath(filePath) {
  if (filePath.startsWith("tasks/")) return true;
  return PIPELINE_TELEMETRY_FILES.includes(filePath);
}
function findDirtyRepoRootSourcePaths(statusOutput) {
  return parsePorcelainEntries(statusOutput).flatMap((entry) => entry.paths).filter((filePath) => !isPipelineOwnedDirtyPath(filePath));
}
function assertRepoRootCleanBeforeFirstWorktree(force) {
  const status = gitSafeAtRaw(REPO_ROOT, "status", "--porcelain=v1", "-uall");
  if (!status.ok) {
    die(`Could not inspect REPO_ROOT dirty state before creating a task worktree: ${status.stderr || "unknown git status error"}`);
  }
  const dirtySourcePaths = findDirtyRepoRootSourcePaths(status.stdout);
  if (dirtySourcePaths.length === 0) return;
  const list = dirtySourcePaths.map((filePath) => `  - ${filePath}`).join("\n");
  if (!force) {
    die(
      `Worktree creation aborted: REPO_ROOT has uncommitted source edits that would not be present in the new task worktree.
${list}

Commit or stash intentional edits before creating the worktree, or rerun with --force if this task should intentionally start from base without those edits.`
    );
  }
  warn(
    `--force override: creating task worktree from base despite uncommitted REPO_ROOT source edits:
${list}`
  );
}
function ensureBranch(taskIds, options = {}) {
  const primaryStatus = readStatus(taskIds[0]);
  const useWorktree = primaryStatus.worktree === true;
  if (taskIds.length > 1) {
    for (const id of taskIds.slice(1)) {
      if (readStatus(id).worktree === true !== useWorktree) {
        die(`Mixed-worktree bundle: '${taskIds[0]}' has worktree=${useWorktree} but '${id}' differs. All bundled tasks must use the same worktree setting.`);
      }
    }
  }
  if (primaryStatus.branch) {
    if (useWorktree) {
      ensureWorktree(taskIds[0], primaryStatus.branch);
      try {
        tickAllHeartbeats();
      } catch {
      }
    } else {
      const current2 = getCurrentBranch();
      if (current2 !== primaryStatus.branch) {
        info(`Switching from '${current2}' to recorded branch '${primaryStatus.branch}'...`);
        git("checkout", primaryStatus.branch);
      }
    }
    return;
  }
  const branchName = `task/${taskIds[0]}`;
  const baseBranch = getBaseBranch(taskIds);
  if (useWorktree) {
    assertRepoRootCleanBeforeFirstWorktree(options.force === true);
    ensureWorktree(taskIds[0], branchName, baseBranch);
    for (const taskId of taskIds) {
      const s = readStatus(taskId);
      s.branch = branchName;
      writeStatus(taskId, s);
    }
    try {
      tickAllHeartbeats();
    } catch {
    }
    info(`Branch recorded: ${branchName} (worktree mode \u2014 main checkout untouched)`);
    return;
  }
  const current = getCurrentBranch();
  if (current !== branchName && current !== baseBranch) {
    if (!branchExistsLocally(baseBranch)) {
      die(
        `Task '${taskIds[0]}' declares base branch '${baseBranch}', but the current checkout is '${current}' and '${baseBranch}' is not available locally. Check out the declared base branch first or fetch it, then re-run.`
      );
    }
    info(`Switching from '${current}' to declared base '${baseBranch}' before creating '${branchName}'...`);
    git("checkout", baseBranch);
  }
  const checkoutBase = getCurrentBranch();
  if (branchExistsLocally(branchName)) {
    info(`Branch '${branchName}' already exists \u2014 checking out.`);
    git("checkout", branchName);
  } else if (checkoutBase === baseBranch) {
    info(`Creating branch '${branchName}' off ${baseBranch}...`);
    git("checkout", "-b", branchName);
  } else {
    die(`Unable to create '${branchName}': expected to be on '${baseBranch}', but are on '${checkoutBase}'.`);
  }
  const resolvedBranch = getCurrentBranch();
  for (const taskId of taskIds) {
    const s = readStatus(taskId);
    s.branch = resolvedBranch;
    writeStatus(taskId, s);
  }
  info(`Branch recorded: ${resolvedBranch}`);
}
function ensureCheckedOutBaseBranch(taskIds) {
  const baseBranch = getBaseBranch(taskIds);
  const current = getCurrentBranch();
  if (current === baseBranch) return baseBranch;
  if (!branchExistsLocally(baseBranch)) {
    die(
      `Task bundle targets base branch '${baseBranch}', but the current checkout is '${current}' and '${baseBranch}' is not available locally. Check out the declared base branch first or fetch it, then re-run.`
    );
  }
  info(`Switching from '${current}' to base branch '${baseBranch}' before shipping...`);
  git("checkout", baseBranch);
  return baseBranch;
}
function verifyBranch(taskIds) {
  const status = readStatus(taskIds[0]);
  if (!status.branch) return;
  if (status.worktree === true) return;
  const current = getCurrentBranch();
  if (current !== status.branch) {
    warn(`Expected branch '${status.branch}' but on '${current}'. Continuing anyway.`);
  }
}
function stripPorcelainQuotes(filePath) {
  return filePath.replace(/^"|"$/g, "");
}
function parsePorcelainEntries(output) {
  return output.split("\n").filter((line) => line.length >= 3).flatMap((line) => {
    if (!line.trim()) return [];
    if (line[2] !== " ") {
      throw new Error(`Malformed git porcelain line. Preserve leading whitespace before parsing: ${JSON.stringify(line)}`);
    }
    const raw = line.slice(3).trim();
    if (!raw) return [];
    const paths = raw.includes(" -> ") ? raw.split(" -> ").map(stripPorcelainQuotes) : [stripPorcelainQuotes(raw)];
    return [{
      raw: line,
      indexStatus: line[0],
      worktreeStatus: line[1],
      paths
    }];
  });
}
function parsePorcelain(output) {
  return new Set(parsePorcelainEntries(output).flatMap((entry) => entry.paths));
}
function parseNameStatusOutput(raw) {
  const paths = /* @__PURE__ */ new Set();
  const tokens = raw.split("\0").filter((t) => t.length > 0);
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    if ((status.startsWith("R") || status.startsWith("C")) && i + 1 < tokens.length) {
      paths.add(tokens[i++]);
      paths.add(tokens[i++]);
    } else if (i < tokens.length) {
      paths.add(tokens[i++]);
    }
  }
  return [...paths].sort();
}
function getAffectedFiles(baseRef, cwd) {
  const result = gitSafeAtRaw(cwd, "diff", `${baseRef}...HEAD`, "--name-status", "-M", "-z");
  if (!result.ok || !result.stdout) return [];
  return parseNameStatusOutput(result.stdout);
}
function getTreeDriftFiles(baseRef, cwd) {
  const result = gitSafeAtRaw(cwd, "diff", baseRef, "HEAD", "--name-status", "-M", "-z");
  if (!result.ok) {
    return { files: [], ok: false, stderr: result.stderr };
  }
  return { files: parseNameStatusOutput(result.stdout), ok: true, stderr: "" };
}

// scripts/pipeline-policy.ts
var SIZE_ORDER = ["S", "M", "L", "XL"];
function maxSize(tasks) {
  let max = "S";
  for (const t of tasks) {
    const size = t.task_size ?? "M";
    if (SIZE_ORDER.indexOf(size) > SIZE_ORDER.indexOf(max)) max = size;
  }
  return max;
}
function anyDelicate(tasks) {
  return tasks.some((t) => t.delicate ?? false);
}
function detectTier(tasks) {
  return tasks.some((t) => (t.task_size ?? "M") !== "S" || (t.delicate ?? false)) ? "full" : "fast";
}
function isPlanCombined(task) {
  return task.task_size === "S" && !(task.delicate ?? false);
}
function getNominalSize(tasks) {
  return maxSize(tasks);
}
function getEffectiveSize(tasks) {
  if (anyDelicate(tasks)) return "XL";
  return maxSize(tasks);
}
function defaultMaxReviewLoops(nominalSize) {
  return nominalSize === "S" || nominalSize === "M" ? 3 : 5;
}
function codexMatrix(config3) {
  return {
    spec_review: {
      S: { model: config3.codexModelMini, effort: "medium" },
      M: { model: config3.codexModelMini, effort: "medium" },
      L: { model: config3.codexModelMini, effort: "high" },
      XL: { model: config3.codexModelFull, effort: "high" }
    },
    implement: {
      S: { model: config3.codexModelMini, effort: "medium" },
      M: { model: config3.codexModelMini, effort: "high" },
      L: { model: config3.codexModelMini, effort: "high" },
      XL: { model: config3.codexModelFull, effort: "xhigh" }
    }
  };
}
function claudeModelFor(config3, phase) {
  switch (phase) {
    case "spec":
      return config3.claudeModelSpec;
    case "plan":
      return config3.claudeModelPlan;
    case "qa":
      return config3.claudeModelQa;
    // code_review is size-keyed (see codeReviewMatrix in claudeMatrix); not
    // resolved through this helper. spec_review, implement, human_review
    // aren't Claude phases; fall back to the spec model so resumed Claude
    // sessions survive accidental use.
    default:
      return config3.claudeModelSpec;
  }
}
function claudeMatrix(config3) {
  const buildHigh = (phase, xlEffort = "xhigh") => {
    const model = claudeModelFor(config3, phase);
    return {
      S: { model, effort: "medium" },
      M: { model, effort: "high" },
      L: { model, effort: "high" },
      XL: { model, effort: xlEffort }
    };
  };
  const buildMedium = (phase) => {
    const model = claudeModelFor(config3, phase);
    return {
      S: { model, effort: "medium" },
      M: { model, effort: "medium" },
      L: { model, effort: "high" },
      XL: { model, effort: "high" }
    };
  };
  const codeReviewMatrix = () => ({
    S: { model: config3.claudeModelReview, effort: "medium" },
    M: { model: config3.claudeModelReview, effort: "high" },
    L: { model: config3.claudeModelReviewLarge, effort: "high" },
    XL: { model: config3.claudeModelReviewLarge, effort: "xhigh" }
  });
  return {
    spec: buildHigh("spec"),
    plan: buildHigh("plan", "high"),
    // sonnet doesn't support xhigh
    code_review: codeReviewMatrix(),
    qa: buildMedium("qa")
  };
}
function getPipelinePolicy(tasks, config3) {
  const tier = detectTier(tasks);
  const nominalSize = getNominalSize(tasks);
  const effectiveSize = getEffectiveSize(tasks);
  const matrix = codexMatrix(config3);
  const claudeMat = claudeMatrix(config3);
  const maxReviewLoops = config3.maxReviewLoops ?? defaultMaxReviewLoops(nominalSize);
  return {
    tier,
    nominalSize,
    effectiveSize,
    planCombined: tier === "fast",
    maxReviewLoops,
    codex: (phase) => matrix[phase][effectiveSize],
    claude: (phase) => claudeMat[phase][effectiveSize]
  };
}

// scripts/run-task/policy.ts
var config2 = {
  claudeModelSpec: process.env.CLAUDE_MODEL_SPEC ?? process.env.CLAUDE_MODEL ?? "opus",
  claudeModelPlan: process.env.CLAUDE_MODEL_PLAN ?? process.env.CLAUDE_MODEL ?? "sonnet",
  claudeModelReview: process.env.CLAUDE_MODEL_REVIEW ?? process.env.CLAUDE_MODEL ?? "sonnet",
  claudeModelReviewLarge: process.env.CLAUDE_MODEL_REVIEW_LARGE ?? process.env.CLAUDE_MODEL ?? "opus",
  claudeModelQa: process.env.CLAUDE_MODEL_QA ?? process.env.CLAUDE_MODEL ?? "sonnet",
  codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? "gpt-5.4-mini",
  codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? "gpt-5.5",
  maxReviewLoops: process.env.MAX_REVIEW_LOOPS ? Number.parseInt(process.env.MAX_REVIEW_LOOPS, 10) : null
};
function policyConfig() {
  return {
    claudeModelSpec: config2.claudeModelSpec,
    claudeModelPlan: config2.claudeModelPlan,
    claudeModelReview: config2.claudeModelReview,
    claudeModelReviewLarge: config2.claudeModelReviewLarge,
    claudeModelQa: config2.claudeModelQa,
    codexModelMini: config2.codexModelMini,
    codexModelFull: config2.codexModelFull,
    maxReviewLoops: config2.maxReviewLoops
  };
}
function toPolicyInputs(tasks) {
  return tasks.map((t) => ({ task_size: t.status.task_size, delicate: t.status.delicate }));
}
function getClaudeConfig(phase, tasks) {
  return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).claude(phase);
}
function getCodexConfig(phase, tasks) {
  return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).codex(phase);
}
function getNominalSize2(tasks) {
  return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).nominalSize;
}
function getEffectiveSize2(tasks) {
  return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).effectiveSize;
}
function getMaxReviewLoops(tasks) {
  return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).maxReviewLoops;
}
function detectTier2(statuses) {
  return detectTier(statuses.map((s) => ({ task_size: s.task_size, delicate: s.delicate })));
}
function isPlanCombined2(status) {
  return isPlanCombined({ task_size: status.task_size, delicate: status.delicate });
}

// scripts/run-task/agents/claude.ts
import { spawn as spawn2 } from "child_process";

// scripts/run-task/metrics.ts
import fs5 from "fs";
import path6 from "path";
function getMetricsFile(activeCwd) {
  return process.env.CANON_METRICS_FILE_OVERRIDE ? path6.resolve(process.env.CANON_METRICS_FILE_OVERRIDE) : path6.join(activeCwd ?? REPO_ROOT, "docs/pipeline-invocations.md");
}
function recordMetric(entry) {
  const metricsFile = getMetricsFile(entry.activeCwd);
  if (!fs5.existsSync(metricsFile)) {
    fs5.writeFileSync(metricsFile, [
      "# Workflow Metrics",
      "",
      "> Auto-logged by `scripts/run-task.ts`. One row per agent invocation.",
      "> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output \u2014 `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.",
      "",
      "| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |",
      "|---|---|---|---|---|---|---|---|---|",
      ""
    ].join("\n"));
  }
  const safeCell = (v) => v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const dur = (entry.durationMs / 1e3).toFixed(1) + "s";
  const tok = entry.tokens != null ? String(entry.tokens) : "-";
  fs5.appendFileSync(
    metricsFile,
    `| ${(/* @__PURE__ */ new Date()).toISOString()} | ${entry.taskId} | ${entry.phase} | ${entry.agent} | ${safeCell(entry.model)} | ${entry.iteration ?? "-"} | ${dur} | ${tok} | ${entry.status} |
`
  );
}

// scripts/run-task/prompts/helpers.ts
var CLAUDE_STARTUP = "Read AGENTS.md and docs/patterns.md before starting.\nSkim docs/lessons-learned.md for entries relevant to your task area.\nRead docs/architecture.md if the task touches core data flow or state management.\nRead docs/product-context.md if the task touches user-visible behavior or Pro features.\nSkip docs/decisions.md unless the task involves explicit UX tradeoffs.";
var CODEX_STARTUP = 'Read AGENTS.md, docs/patterns.md, and docs/codebase-map.md before starting.\nSkim docs/lessons-learned.md for entries relevant to your task area.\nSkip docs/decisions.md, docs/product-context.md unless the task explicitly involves product or UX decisions.\nGround every claim in the current file, diff, or artifact before you state it. Do not rely on prior-session memory for code existence, validation results, or completion status.\nOn resumed sessions, re-read the task-specific files named in the prompt and inspect the current working tree before saying anything is already done.\n\nGit ownership: the pipeline orchestrator handles staging, committing, and pushing \u2014 do NOT run `git add`, `git commit`, or `git push`. Edit files in the working tree only; the orchestrator reads `git status` after your session and stages every file listed in handoff.md\'s Changes table. Read-only git is fine (`git status`, `git diff`, `git log`, `git show`).\n\nIf a code review claims a file is "missing from the commit" or "staged but not committed," that is a pipeline-orchestration issue, not an implementation issue. Record it as a Blocker in handoff.md with the `[pipeline]` label and do not retry `git add`/`git commit` to recover \u2014 the sandbox blocks `.git` writes by design, and the orchestrator owns the recovery path.';
var QA_STARTUP = "Read CHANGELOG.md for voice and version reference.\nRead docs/lessons-learned.md for recent insights to distill.\nNo full codebase context needed for QA \u2014 read each task's spec.md, handoff.md, and notes.md directly.";
function taskList(tasks) {
  return tasks.map((t) => `- \`${t.taskId}\`: "${t.title}" \u2192 tasks/${t.taskId}/`).join("\n");
}
function phaseCommands(taskIds, phase, status, verdict = "") {
  return taskIds.map((id) => {
    const cmd = verdict ? `canon task phase ${id} ${phase} ${status} ${verdict}` : `canon task phase ${id} ${phase} ${status}`;
    return `(cd '${resolveTaskCwd(id)}' && ${cmd})`;
  }).join("\n");
}
function toResumePrompt(prompt) {
  let trimmed = prompt;
  for (const block of [CLAUDE_STARTUP, CODEX_STARTUP, QA_STARTUP]) {
    trimmed = trimmed.replace(`

${block}

`, "\n\n");
  }
  return `[Resumed session \u2014 project context loaded. Skip startup boilerplate re-reads (AGENTS.md, architecture docs, etc.) \u2014 re-read any task-specific files explicitly requested in this prompt, then verify the current working tree or artifact before claiming anything is already done.]

${trimmed.trimStart()}`;
}

// scripts/run-task/agents/stream.ts
import { spawn } from "child_process";
import readline from "readline";
function streamProcess(command, args, options) {
  return new Promise((resolve) => {
    const stallMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS;
    let stalled = false;
    let closed = false;
    let stallTimer = null;
    let killTimer = null;
    const capturedStdout = [];
    const capturedStderr = [];
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    registerActiveChild(child);
    options.onSpawn?.(child);
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        warn(`${options.label} stalled \u2014 no output for ${Math.round(stallMs / 1e3)}s. Sending SIGTERM.`);
        killChildGroup(child, "SIGTERM");
        killTimer = setTimeout(() => {
          if (!closed) {
            warn(`${options.label} did not exit after SIGTERM \u2014 sending SIGKILL.`);
            killChildGroup(child, "SIGKILL");
          }
        }, STALL_KILL_GRACE_MS);
      }, stallMs);
    };
    if (child.stdout) {
      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        resetStallTimer();
        capturedStdout.push(line);
        if (line.trim()) {
          try {
            options.onLine(line);
          } catch {
          }
        }
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        resetStallTimer();
        capturedStderr.push(chunk);
        if (options.onStderrChunk) {
          try {
            options.onStderrChunk(chunk);
          } catch {
          }
        } else {
          process.stderr.write(chunk);
        }
      });
    }
    child.on("error", (err) => {
      if (stallTimer) clearTimeout(stallTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: null,
        signal: null,
        spawnError: err,
        stalled,
        capturedStdout: capturedStdout.join("\n"),
        capturedStderr: capturedStderr.join("")
      });
    });
    child.on("close", (code, signal) => {
      closed = true;
      if (stallTimer) clearTimeout(stallTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: code,
        signal,
        spawnError: null,
        stalled,
        capturedStdout: capturedStdout.join("\n"),
        capturedStderr: capturedStderr.join("")
      });
    });
    resetStallTimer();
  });
}
function formatLiveTick(event) {
  const type = event.type;
  if (type === "thread.started") return `  \u2192 session started`;
  if (type === "turn.started") return `  \u2192 turn started`;
  if (type === "turn.completed") return `  \u2190 turn completed`;
  if (type === "item.started" || type === "item.completed") {
    const item = event.item ?? {};
    if (item.type === "tool_call" || item.type === "function_call") {
      return `  ${type === "item.started" ? "\u2192" : "\u2190"} ${item.name ?? "tool"}`;
    }
  }
  if (type === "system") {
    const subtype = event.subtype;
    if (subtype === "init") return `  \u2192 claude session init`;
  }
  if (type === "assistant") {
    const message = event.message;
    const blocks = message?.content ?? [];
    for (const b of blocks) {
      if (b.type === "tool_use" && b.name) return `  \u2192 ${b.name}`;
    }
  }
  if (type === "user") {
    const message = event.message;
    const blocks = message?.content ?? [];
    if (blocks.some((b) => b.type === "tool_result")) return `  \u2190 tool result`;
  }
  return null;
}

// scripts/run-task/agents/claude.ts
var CLAUDE_RESUME_NOT_FOUND_RE = /No conversation found with session ID/i;
var CLAUDE_UNKNOWN_EFFORT_RE = /unknown (?:option|flag)[^\n]*--effort/i;
var CLAUDE_TOO_OLD_HINT = "Claude Code is too old for canon \u2014 run `canon doctor` to verify (canon requires Claude Code 2.1.72+).";
function printClaudeTooOldHint(capturedStderr) {
  if (CLAUDE_UNKNOWN_EFFORT_RE.test(capturedStderr)) {
    console.error(CLAUDE_TOO_OLD_HINT);
  }
}
function runInteractiveClaude(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn2("claude", args, {
      cwd,
      stdio: ["inherit", "inherit", "pipe"]
    });
    let capturedStderr = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        capturedStderr += chunk;
        process.stderr.write(chunk);
      });
    }
    child.on("error", (err) => {
      console.error(err.message);
      finish(1);
    });
    child.on("close", (code) => {
      if (typeof code === "number" && code !== 0) {
        printClaudeTooOldHint(capturedStderr);
      }
      finish(typeof code === "number" ? code : 1);
    });
  });
}
async function runClaude(prompt, interactive, resumeId, model, effort, metricsContext, cwd = REPO_ROOT) {
  info(resumeId ? `Calling Claude Code (resuming ${resumeId.slice(0, 8)}...)...` : "Calling Claude Code...");
  info(`Model: ${model} | Effort: ${effort}`);
  const startMs = Date.now();
  let status = "ok";
  let tokens;
  let processedText = "";
  let sessionId = null;
  try {
    if (interactive) {
      console.log("");
      console.log(resumeId ? "\u2500\u2500\u2500 Resuming interactive Claude session \u2500\u2500\u2500" : "\u2500\u2500\u2500 Opening interactive Claude session \u2500\u2500\u2500");
      console.log("Prompt loaded. You're in the driver's seat.");
      console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
      console.log("");
      const args = ["--model", model, "--effort", effort, "--add-dir", REPO_ROOT];
      if (cwd !== REPO_ROOT) args.push("--add-dir", cwd);
      if (resumeId) args.push("--resume", resumeId);
      args.push(resumeId ? toResumePrompt(prompt) : prompt);
      const exitCode = await runInteractiveClaude(args, cwd);
      if (exitCode !== 0) {
        status = "failed";
        process.exit(exitCode);
      }
      return {
        exitCode: 0,
        signal: null,
        spawnError: null,
        stalled: false,
        capturedStdout: "",
        capturedStderr: "",
        sessionId: null,
        processedText: ""
      };
    }
    const attempt = async (useResumeId) => {
      const effectivePrompt = useResumeId ? toResumePrompt(prompt) : prompt;
      const args = [
        "-p",
        effectivePrompt,
        "--model",
        model,
        "--effort",
        effort,
        "--add-dir",
        REPO_ROOT,
        "--max-budget-usd",
        config.claudeBudget,
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--verbose"
      ];
      if (cwd !== REPO_ROOT) args.push("--add-dir", cwd);
      if (useResumeId) args.push("--resume", useResumeId);
      const captured = {
        text: null,
        sessionId: null,
        usage: null
      };
      const assistantTextChunks = [];
      const onLine = (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        const tick = formatLiveTick(event);
        if (tick) console.log(tick);
        if (event.type === "assistant") {
          const message = event.message;
          for (const block of message?.content ?? []) {
            if (block.type === "text" && block.text) assistantTextChunks.push(block.text);
          }
        }
        if (event.type === "result") {
          captured.text = event.result ?? null;
          captured.sessionId = event.session_id ?? null;
          captured.usage = event.usage ?? null;
        }
      };
      const result = await streamProcess("claude", args, {
        cwd,
        label: "Claude",
        onLine
      });
      if (useResumeId && CLAUDE_RESUME_NOT_FOUND_RE.test(result.capturedStderr)) {
        return { resumeNotFound: true, result: null };
      }
      if (captured.usage) {
        tokens = (captured.usage.input_tokens ?? 0) + (captured.usage.cache_creation_input_tokens ?? 0) + (captured.usage.cache_read_input_tokens ?? 0) + (captured.usage.output_tokens ?? 0);
        if (tokens === 0) tokens = void 0;
      }
      if (captured.text !== null) {
        processedText = captured.text;
      } else if (assistantTextChunks.length > 0) {
        warn("Claude did not emit a final result event \u2014 using accumulated assistant text.");
        processedText = assistantTextChunks.join("\n");
      } else {
        processedText = result.capturedStdout;
      }
      if (captured.sessionId) {
        sessionId = captured.sessionId;
      } else {
        const sidMatch = result.capturedStdout.match(/"session_id"\s*:\s*"([0-9a-f-]{36})"/i);
        if (sidMatch) sessionId = sidMatch[1];
      }
      if (processedText) process.stdout.write(processedText);
      if (result.spawnError) {
        console.error(result.spawnError.message);
        status = "failed";
        process.exit(1);
      }
      if (result.stalled) {
        status = "failed";
        process.exit(1);
      }
      if (typeof result.exitCode === "number" && result.exitCode !== 0) {
        printClaudeTooOldHint(result.capturedStderr);
        status = "failed";
        process.exit(result.exitCode);
      }
      if (result.signal) {
        status = "failed";
        process.exit(1);
      }
      return {
        resumeNotFound: false,
        result: {
          ...result,
          sessionId,
          processedText
        }
      };
    };
    const first = await attempt(resumeId);
    if (first.resumeNotFound && resumeId) {
      warn(`Claude session ${resumeId.slice(0, 8)}... was not found \u2014 falling back to a fresh session. (Stale ID will be overwritten by post-phase session discovery.)`);
      const second = await attempt(null);
      if (second.result) return second.result;
    }
    if (first.result) return first.result;
    return {
      exitCode: 0,
      signal: null,
      spawnError: null,
      stalled: false,
      capturedStdout: processedText,
      capturedStderr: "",
      sessionId,
      processedText
    };
  } catch (err) {
    status = "failed";
    throw err;
  } finally {
    if (metricsContext) recordMetric({ ...metricsContext, agent: "claude", model, durationMs: Date.now() - startMs, status, tokens });
  }
}

// scripts/run-task/validation.ts
import fs6 from "fs";
import path7 from "path";

// scripts/run-task/markdown-table.ts
function splitTableLine(line) {
  const cells = [];
  let cell = "";
  let backslashes = 0;
  for (const char of line) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === "|") {
      if (backslashes % 2 === 1) {
        cell += "\\".repeat((backslashes - 1) / 2) + "|";
      } else {
        cell += "\\".repeat(backslashes / 2);
        cells.push(cell);
        cell = "";
      }
      backslashes = 0;
      continue;
    }
    if (backslashes > 0) {
      cell += "\\".repeat(backslashes);
      backslashes = 0;
    }
    cell += char;
  }
  if (backslashes > 0) cell += "\\".repeat(backslashes);
  cells.push(cell);
  return cells;
}
function normalizeCells(line) {
  const cells = splitTableLine(line.trim());
  const innerCells = cells.slice(
    (cells[0] ?? "").trim() === "" ? 1 : 0,
    (cells[cells.length - 1] ?? "").trim() === "" ? -1 : void 0
  );
  return innerCells.map((cell) => cell.trim());
}
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}
function isSectionHeading(line, sectionHeading) {
  return line.trimEnd() === `## ${sectionHeading}`;
}
function isHeadingBoundary(line) {
  return /^#{1,2}\s/.test(line);
}
function extractSectionBodies(markdown, pattern) {
  const lines = markdown.split("\n");
  const bodies = [];
  let activeStart = -1;
  let inHtmlComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const opensComment = /<!--/.test(line);
    const closesComment = /-->/.test(line);
    const startsInComment = inHtmlComment;
    if (opensComment && !closesComment) inHtmlComment = true;
    else if (closesComment && !opensComment) inHtmlComment = false;
    else if (opensComment && closesComment) {
      inHtmlComment = false;
    }
    if (startsInComment) continue;
    if (opensComment && !closesComment) continue;
    const isH2 = /^## /.test(line);
    const isH1 = /^# /.test(line);
    if (isH2 || isH1) {
      if (activeStart !== -1) {
        bodies.push(lines.slice(activeStart, i).join("\n"));
        activeStart = -1;
      }
      if (isH2 && pattern.test(line)) {
        activeStart = i + 1;
      }
    }
  }
  if (activeStart !== -1) bodies.push(lines.slice(activeStart).join("\n"));
  return bodies;
}
function parseTableH3(markdown, sectionHeading) {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trimEnd() === `### ${sectionHeading}`);
  if (headingIndex === -1) return [];
  let tableStart = -1;
  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,3}\s/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
    if (tableStart === -1 && lines[index].trimStart().startsWith("|")) {
      tableStart = index;
    }
  }
  if (tableStart === -1 || tableStart >= sectionEnd) return [];
  const headerCells = normalizeCells(lines[tableStart]);
  if (headerCells.length === 0) return [];
  let rowStart = tableStart + 1;
  if (rowStart < sectionEnd) {
    const separatorCells = normalizeCells(lines[rowStart]);
    if (isSeparatorRow(separatorCells)) rowStart += 1;
  }
  const rows = [];
  for (let index = rowStart; index < sectionEnd; index += 1) {
    const line = lines[index];
    if (!line.trimStart().startsWith("|")) break;
    const cells = normalizeCells(line);
    if (isSeparatorRow(cells)) continue;
    const row = {};
    for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
      row[headerCells[cellIndex]] = cells[cellIndex] ?? "";
    }
    rows.push(row);
  }
  return rows;
}
function parseAllTablesH3(markdown, sectionHeading) {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trimEnd() === `### ${sectionHeading}`);
  if (headingIndex === -1) return [];
  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,3}\s/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }
  const allRows = [];
  let scanFrom = headingIndex + 1;
  while (scanFrom < sectionEnd) {
    let tableStart = -1;
    for (let i = scanFrom; i < sectionEnd; i += 1) {
      if (lines[i].trimStart().startsWith("|")) {
        tableStart = i;
        break;
      }
    }
    if (tableStart === -1) break;
    const headerCells = normalizeCells(lines[tableStart]);
    if (headerCells.length === 0) {
      scanFrom = tableStart + 1;
      continue;
    }
    let rowStart = tableStart + 1;
    if (rowStart < sectionEnd) {
      const maybeSep = normalizeCells(lines[rowStart]);
      if (isSeparatorRow(maybeSep)) rowStart += 1;
    }
    let tableEnd = rowStart;
    while (tableEnd < sectionEnd && lines[tableEnd].trimStart().startsWith("|")) {
      tableEnd += 1;
    }
    for (let index = rowStart; index < tableEnd; index += 1) {
      const cells = normalizeCells(lines[index]);
      if (isSeparatorRow(cells)) continue;
      const row = {};
      for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
        row[headerCells[cellIndex]] = cells[cellIndex] ?? "";
      }
      allRows.push(row);
    }
    scanFrom = tableEnd;
  }
  return allRows;
}
function parseTable(markdown, sectionHeading) {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => isSectionHeading(line, sectionHeading));
  if (headingIndex === -1) return [];
  let tableStart = -1;
  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (isHeadingBoundary(lines[index])) {
      sectionEnd = index;
      break;
    }
    if (tableStart === -1 && lines[index].trimStart().startsWith("|")) {
      tableStart = index;
    }
  }
  if (tableStart === -1 || tableStart >= sectionEnd) return [];
  const headerCells = normalizeCells(lines[tableStart]);
  if (headerCells.length === 0) return [];
  let rowStart = tableStart + 1;
  if (rowStart < sectionEnd) {
    const separatorCells = normalizeCells(lines[rowStart]);
    if (isSeparatorRow(separatorCells)) rowStart += 1;
  }
  const rows = [];
  for (let index = rowStart; index < sectionEnd; index += 1) {
    const line = lines[index];
    if (!line.trimStart().startsWith("|")) break;
    const cells = normalizeCells(line);
    if (isSeparatorRow(cells)) continue;
    const row = {};
    for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
      row[headerCells[cellIndex]] = cells[cellIndex] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

// scripts/run-task/validation.ts
function checkAcCoveragePlaceholders(handoffContent) {
  if (!handoffContent.split("\n").some((line) => line.trimEnd() === "## AC Coverage")) {
    return ["AC Coverage section is missing"];
  }
  const rows = parseTable(handoffContent, "AC Coverage");
  if (rows.length === 0) return ["AC Coverage table is missing or contains no AC rows"];
  const hasAcRow = rows.some((row) => /AC-\d+/i.test(Object.values(row)[0] ?? ""));
  if (!hasAcRow) return ["AC Coverage table is missing or contains no AC rows"];
  const PLACEHOLDER = "Met / Partial / Not met";
  const allPlaceholder = rows.every((row) => (row["Status"] ?? "") === PLACEHOLDER);
  if (allPlaceholder) {
    return ['AC Coverage table only contains template placeholder rows (Status "Met / Partial / Not met") \u2014 fill in actual AC statuses'];
  }
  return [];
}
function computeLatestValidationResults(handoffContent) {
  const latest = /* @__PURE__ */ new Map();
  const baseline = parseTable(handoffContent, "Validation Outcomes");
  for (const row of baseline) {
    const check = (row["Check"] ?? "").trim();
    if (!check) continue;
    latest.set(canonicalizeValidationCheck(check), {
      check,
      result: row["Result"] ?? "",
      notes: row["Notes"] ?? ""
    });
  }
  const iterationBodies = extractSectionBodies(handoffContent, /^## Iteration\b/);
  for (const body of iterationBodies) {
    const reruns = parseTableH3(body, "Re-run validation (only checks that re-ran)").concat(parseTableH3(body, "Re-run validation"));
    for (const row of reruns) {
      const check = (row["Check"] ?? "").trim();
      if (!check) continue;
      latest.set(canonicalizeValidationCheck(check), {
        check,
        result: row["Result"] ?? "",
        notes: row["Notes"] ?? ""
      });
    }
  }
  return latest;
}
function canonicalizeValidationCheck(value) {
  const backtickMatch = value.match(/`([^`]+)`/);
  let base;
  if (backtickMatch && !backtickMatch[1].endsWith("\\")) {
    base = backtickMatch[1];
  } else {
    const stripped = value.replace(/\\`/g, "").replace(/`/g, "");
    base = stripped.split(/\s+[—–-]\s+/)[0];
  }
  const normalized = base.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.includes(" ")) {
    return normalized.split(" ").at(-1) ?? normalized;
  }
  return normalized;
}
function parseValidationRequiredChecks(specPath) {
  try {
    const content = fs6.readFileSync(specPath, "utf8");
    const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
    if (!section) return null;
    const checks = [];
    for (const line of section[1].split("\n")) {
      const match = line.match(/^-\s+\[x\]\s+(.+?)\s*$/i);
      if (match?.[1]) checks.push(match[1].trim());
    }
    return checks;
  } catch {
    return null;
  }
}
function sliceRerouteRoundSection(content, label, round) {
  const esc = label.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ \t]+/g, "[ \\t]+");
  const headingRe = round >= 2 ? new RegExp(`^#{2,6}[ \\t]+${esc}[ \\t]+Round[ \\t]+${round}[ \\t]*$`, "i") : new RegExp(`^#{2,6}[ \\t]+${esc}[ \\t]*$`, "i");
  const lines = content.split("\n");
  let inFence = false;
  let inComment = false;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const opensComment = /<!--/.test(line);
    const closesComment = /-->/.test(line);
    const wasInComment = inComment;
    if (opensComment && !closesComment) inComment = true;
    else if (closesComment && !opensComment) inComment = false;
    else if (opensComment && closesComment) inComment = false;
    if (wasInComment || opensComment && !closesComment) continue;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (headingRe.test(line)) start = i;
  }
  if (start === -1) return null;
  inFence = false;
  inComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const opensComment = /<!--/.test(line);
    const closesComment = /-->/.test(line);
    const wasInComment = inComment;
    if (opensComment && !closesComment) inComment = true;
    else if (closesComment && !opensComment) inComment = false;
    else if (opensComment && closesComment) inComment = false;
    if (wasInComment || opensComment && !closesComment) continue;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || i <= start) continue;
    if (/^#{1,2}[ \t]+\S/.test(line)) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}
function checkRerouteEvidence(phase, artifactContent, status) {
  if (phase !== "spec_review" && phase !== "plan") return { reroute: false };
  const impl = status.phases?.implement;
  const rerouted = typeof impl === "object" && impl !== null ? impl.rerouted : void 0;
  if (rerouted !== void 0 && typeof rerouted !== "boolean") {
    return { reroute: true, ok: false, reason: "cannot determine reroute state \u2014 status.phases.implement.rerouted is present but not a boolean" };
  }
  if (rerouted !== true) return { reroute: false };
  const round = impl.reroute_count;
  if (typeof round !== "number" || round < 1) {
    return { reroute: true, ok: false, reason: "reroute in progress but reroute_count is missing/invalid (<1) \u2014 cannot determine the amendment round" };
  }
  if (phase === "spec_review") {
    const section = sliceRerouteRoundSection(artifactContent, "Amendment Review", round);
    if (section === null) {
      const expected = round >= 2 ? `## Amendment Review Round ${round}` : "## Amendment Review";
      return { reroute: true, ok: false, reason: `no \`${expected}\` section \u2014 a fresh amendment review for round ${round} is required (the original review does not count)` };
    }
    const verdict = extractCheckedVerdict(section);
    if (!verdict) return { reroute: true, ok: false, reason: `the round-${round} Amendment Review section has no checked verdict box` };
    return { reroute: true, ok: true, verdict };
  }
  if (sliceRerouteRoundSection(artifactContent, "Reroute Plan", round) === null) {
    const expected = round >= 2 ? `## Reroute Plan Round ${round}` : "## Reroute Plan";
    return { reroute: true, ok: false, reason: `no \`${expected}\` section \u2014 the reroute plan delta for round ${round} is required` };
  }
  return { reroute: true, ok: true };
}
function verifyRerouteAmendment(taskId, requiredRound) {
  const specPath = path7.join(taskDirFor(taskId), "spec.md");
  let content;
  try {
    content = fs6.readFileSync(specPath, "utf8");
  } catch {
    return { amended: false, reason: `spec.md missing at ${specPath}` };
  }
  if (requiredRound === 1) {
    if (/^#{2,6}[ \t]+Amendment\b/im.test(content)) {
      return { amended: true, reason: "" };
    }
    return {
      amended: false,
      reason: `no \`## Amendment\` heading found in ${specPath}`
    };
  }
  const matches = content.matchAll(/^#{2,6}[ \t]+Amendment[ \t]+Round[ \t]+(\d+)\b/gim);
  let seenRound = null;
  for (const match of matches) {
    const foundRound = Number(match[1]);
    if (foundRound === requiredRound) {
      return { amended: true, reason: "" };
    }
    if (seenRound === null) {
      seenRound = foundRound;
    }
  }
  if (seenRound !== null) {
    return {
      amended: false,
      reason: `found \`## Amendment Round ${seenRound}\` in ${specPath}, expected \`## Amendment Round ${requiredRound}\``
    };
  }
  if (/^#{2,6}[ \t]+Amendment\b/im.test(content)) {
    return {
      amended: false,
      reason: `found \`## Amendment\` in ${specPath}, expected \`## Amendment Round ${requiredRound}\``
    };
  }
  return {
    amended: false,
    reason: `no \`## Amendment Round ${requiredRound}\` heading found in ${specPath}`
  };
}
function cleanCitedPathToken(rawToken) {
  return rawToken.trim().replace(/^[`'"\[({<]+/, "").replace(/[>`'"\])}.,;]+$/, "");
}
function stripCitedLocation(token) {
  return token.replace(/:\d+(?::\d+)?$/, "");
}
function hasLineLocation(token) {
  return /:\d+(?::\d+)?$/.test(token);
}
function hasSpecificFailUnrelatedReference(notes) {
  for (const rawToken of notes.split(/\s+/)) {
    const cleaned = cleanCitedPathToken(rawToken);
    if (!cleaned) continue;
    if (hasLineLocation(cleaned)) return true;
    const withoutLocation = stripCitedLocation(cleaned);
    const hasPathSeparator = withoutLocation.includes("/") || withoutLocation.includes("\\");
    const hasFilenameExtension = /\.[A-Za-z0-9]+$/.test(withoutLocation);
    if (hasPathSeparator && hasFilenameExtension) return true;
  }
  return false;
}
function extractCitedFilePaths(notes) {
  const seen = /* @__PURE__ */ new Set();
  const paths = [];
  for (const rawToken of notes.split(/\s+/)) {
    const cleaned = cleanCitedPathToken(rawToken);
    const hasLine = hasLineLocation(cleaned);
    const withoutLocation = stripCitedLocation(cleaned);
    if (!withoutLocation || !(withoutLocation.includes("/") || withoutLocation.includes("\\") || /\.[A-Za-z0-9]+$/.test(withoutLocation) || hasLine)) {
      continue;
    }
    const normalized = withoutLocation.replace(/^\.\//, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}
function matchAgainstChangedFiles(citedPath, changedFiles) {
  const normalized = citedPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("../");
  if (!isAbsolute) {
    if (normalized.includes("/")) return changedFiles.has(normalized);
    for (const changedFile of changedFiles) {
      const lastSegment = changedFile.replace(/\\/g, "/").split("/").pop() ?? "";
      if (lastSegment === normalized) return true;
    }
    return false;
  }
  const parts = normalized.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const suffix = parts.slice(i).join("/");
    if (suffix && changedFiles.has(suffix)) return true;
  }
  return false;
}
function isPassResult(result) {
  return result.trim().toLowerCase().startsWith("pass");
}
function isNAResult(result) {
  return /^n\/?a\b/i.test(result.trim());
}
function isNotConfiguredResult(result) {
  return /^not[_ -]?configured\b/i.test(result.trim());
}
function isHumanPendingResult(result) {
  return /^human[_ -]?pending\b/i.test(result.trim());
}
function isDeferredBySpecResult(result) {
  return /^deferred[_ -]?by[_ -]?spec\b/i.test(result.trim());
}
function isBlockedResult(result) {
  return /^blocked\b/i.test(result.trim());
}
function isFailResult(result) {
  return /^fail/i.test(result.trim());
}
function isUnrelatedFailResult(result) {
  return /^fail\s*[–—-]\s*unrelated\b/i.test(result.trim());
}
function isPendingResult(result) {
  const trimmed = result.trim();
  if (!trimmed) return true;
  if (/\bPass\s*\/\s*Fail\b/i.test(trimmed)) return true;
  return false;
}
function classifyValidationChecks(requiredChecks, latestResults, changedFiles) {
  const format = (message) => ({ bucket: "format", message });
  const regression = (message) => ({ bucket: "regression", message });
  const blocked = (message) => ({ bucket: "blocked", message });
  const issues = [];
  if (requiredChecks === null) {
    return [format("Validation Required section is missing from spec.md")];
  }
  if (requiredChecks.length === 0) {
    return [
      format(
        "Validation Required section in spec.md has no `[x]`-checked items \u2014 mark at least one required check `[x]`. The template ships with `[ ]` placeholders; the spec author marks the required checks before invoking canon. If no checks apply, use a single `[x] None \u2014 <reason>` entry to document the decision."
      )
    ];
  }
  for (const required of requiredChecks) {
    const canonical = canonicalizeValidationCheck(required);
    const row = latestResults.get(canonical);
    if (!row) {
      const present = [...latestResults.keys()];
      const hint = present.length > 0 ? ` Handoff has rows for: ${present.join(", ")}. (Required canonicalized to: '${canonical}'.)` : " Handoff has no Validation Outcomes rows.";
      issues.push(format(`Validation Required item missing from handoff.md: ${required}.${hint}`));
      continue;
    }
    const note = row.notes ? ` (${row.notes})` : "";
    if (isPendingResult(row.result)) {
      issues.push(format(`Validation Required item present but unfilled (still in template 'pending' state): ${required}.`));
      continue;
    }
    if (isNAResult(row.result) || isNotConfiguredResult(row.result)) {
      issues.push(format(`Validation Required item marked ${row.result} in handoff.md: ${required} (required checks cannot be skipped \u2014 adjust spec or run the check)`));
      continue;
    }
    if (isDeferredBySpecResult(row.result)) {
      if (!/spec[:.-]/i.test(row.notes ?? "")) {
        issues.push(format(`Validation Required item marked deferred_by_spec without a spec citation in Notes: ${required}`));
      }
      continue;
    }
    if (isHumanPendingResult(row.result)) {
      continue;
    }
    if (isBlockedResult(row.result)) {
      issues.push(blocked(`Validation Required item marked blocked in handoff.md: ${required}${note} \u2014 triage required (CI/network/infrastructure)`));
      continue;
    }
    if (isUnrelatedFailResult(row.result)) {
      const hasFileRef = hasSpecificFailUnrelatedReference(row.notes ?? "");
      if (!hasFileRef) {
        issues.push(format(`Validation Required item marked Fail \u2013 unrelated needs a specific test/file reference in Notes (e.g., \`src/foo.test.ts\` or \`file:42\`; vague prose like "pre-existing flake" is rejected): ${required}`));
        continue;
      }
      if (changedFiles.size > 0) {
        const citedPaths = extractCitedFilePaths(row.notes ?? "");
        const citedChangedFiles = citedPaths.filter((citedPath) => matchAgainstChangedFiles(citedPath, changedFiles));
        if (citedChangedFiles.length > 0) {
          issues.push(regression(
            `Validation Required item marked Fail \u2013 unrelated cites a file changed by this task: ${required}. A failure in a file you modified is yours to fix; if genuinely unrelated, cite a file outside your diff. (cited changed file${citedChangedFiles.length === 1 ? "" : "s"}: ${citedChangedFiles.join(", ")})`
          ));
          continue;
        }
      }
      continue;
    }
    if (!isPassResult(row.result)) {
      issues.push(regression(`Validation Required item did not pass in handoff.md: ${required} \u2014 ${row.result}${note}`));
    }
  }
  return issues;
}
function classifyPreflightBlockersFromData(data) {
  const format = (message) => ({ bucket: "format", message });
  const regression = (message) => ({ bucket: "regression", message });
  if (data.handoffMissing) return [format("handoff.md not found")];
  const requiredCanonicalKeys = new Set(
    (data.requiredChecks ?? []).map((required) => canonicalizeValidationCheck(required))
  );
  const fromRequired = classifyValidationChecks(data.requiredChecks, data.latestResults, data.changedFiles);
  const fromNonRequired = [];
  for (const [canonical, row] of data.latestResults) {
    if (requiredCanonicalKeys.has(canonical)) continue;
    if (isFailResult(row.result) && !isUnrelatedFailResult(row.result)) {
      const note = row.notes ? ` (${row.notes})` : "";
      fromNonRequired.push(regression(
        `Validation Outcomes row not listed in spec's required checks has a plain Fail: ${row.check}${note} \u2014 fix the regression.`
      ));
    }
  }
  return [
    ...data.acCoverageIssues.map(format),
    ...data.changesTableIssues.map(format),
    ...data.bundleDiffIssues.map(format),
    ...fromRequired,
    ...fromNonRequired
  ];
}
function classifyPreflightBlockers(taskId, changedFiles, bundleDiffIssues = []) {
  const handoffPath = path7.join(taskDirFor(taskId), "handoff.md");
  const specPath = path7.join(taskDirFor(taskId), "spec.md");
  try {
    const content = fs6.readFileSync(handoffPath, "utf8");
    const latestResults = computeLatestValidationResults(content);
    const requiredChecks = parseValidationRequiredChecks(specPath);
    const { malformed } = parseHandoffChangesRows(taskId);
    return classifyPreflightBlockersFromData({
      latestResults,
      requiredChecks,
      changedFiles,
      acCoverageIssues: checkAcCoveragePlaceholders(content),
      changesTableIssues: malformed.map((entry) => `Changes table row '${entry.cell}': ${entry.reason}`),
      bundleDiffIssues: [...bundleDiffIssues],
      handoffMissing: false
    });
  } catch {
    return classifyPreflightBlockersFromData({
      latestResults: /* @__PURE__ */ new Map(),
      requiredChecks: null,
      changedFiles,
      acCoverageIssues: [],
      changesTableIssues: [],
      bundleDiffIssues: [...bundleDiffIssues],
      handoffMissing: true
    });
  }
}
function validateHandoffAgainstSpec(specPath, handoffPath, latestResults, changedFiles = /* @__PURE__ */ new Set()) {
  const requiredChecks = parseValidationRequiredChecks(specPath);
  let rowMap;
  if (latestResults) {
    rowMap = latestResults;
  } else {
    try {
      const content = fs6.readFileSync(handoffPath, "utf8");
      rowMap = computeLatestValidationResults(content);
    } catch {
      rowMap = /* @__PURE__ */ new Map();
    }
  }
  return classifyValidationChecks(requiredChecks, rowMap, changedFiles).map((issue) => issue.message);
}
function countHumanPendingChecks(handoffContent) {
  const latest = computeLatestValidationResults(handoffContent);
  const pending = [];
  for (const row of latest.values()) {
    if (isHumanPendingResult(row.result)) pending.push({ check: row.check, notes: row.notes });
  }
  return pending;
}
function hasHumanPendingWaiver(doneContent) {
  return /^\s*acknowledged\s*:/im.test(doneContent);
}
function autoCommitAllowedSourceBypass(filePath) {
  if (filePath.startsWith("tasks/")) return true;
  return PIPELINE_TELEMETRY_FILES.includes(filePath);
}
function toFileSet(files) {
  return files instanceof Set ? files : new Set(files);
}
function findUncoveredTrackedChanges(statusOutput, handoffFiles) {
  const allowed = toFileSet(handoffFiles);
  return parsePorcelainEntries(statusOutput).filter((entry) => {
    const untrackedOnly = entry.indexStatus === "?" && entry.worktreeStatus === "?";
    if (untrackedOnly) return false;
    return entry.paths.some((filePath) => !allowed.has(filePath) && !autoCommitAllowedSourceBypass(filePath));
  }).map((entry) => entry.raw);
}
function findStagedFilesOutsideHandoff(stagedNameOnlyOutput, handoffFiles) {
  const allowed = toFileSet(handoffFiles);
  return stagedNameOnlyOutput.split("\n").map((line) => line.trim()).filter(Boolean).filter((filePath) => !allowed.has(filePath));
}
var DONE_MD_TEMPLATE_SENTINELS = [
  "[TASK-ID]",
  "One paragraph, plain English. No code jargon.",
  "`src/...` \u2014 brief note"
];
var PR_BODY_TEMPLATE_SENTINELS = [
  "[pr-body-stub]",
  "[TASK-ID]"
];
function isTemplateUnfilled(content) {
  if (content === null) return true;
  return content.includes("[TASK-ID]");
}
function isDoneMdTemplate(donePath) {
  let content;
  try {
    content = fs6.readFileSync(donePath, "utf8");
  } catch {
    return true;
  }
  return DONE_MD_TEMPLATE_SENTINELS.some((s) => content.includes(s));
}
function isPrBodyTemplate(prBodyPath) {
  let content;
  try {
    content = fs6.readFileSync(prBodyPath, "utf8");
  } catch {
    return true;
  }
  if (content.trim() === "") return true;
  return PR_BODY_TEMPLATE_SENTINELS.some((s) => content.includes(s));
}
function extractDoneMdFromStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  if (!/^#\s+(QA Summary|Completion Summary)\b/m.test(trimmed)) return "";
  return trimmed + "\n";
}
function extractCheckedVerdict(content) {
  const roundBodies = extractSectionBodies(content, /^## Round\b/);
  const scope = roundBodies.length > 0 ? roundBodies[roundBodies.length - 1] : content;
  if (/^- \[x\] (?:\*\*)?Approved with nits(?:\*\*)?(?:\s|$)/mi.test(scope)) return "approved_with_nits";
  if (/^- \[x\] (?:\*\*)?Approved(?:\*\*)?(?:\s|$)/mi.test(scope)) return "approved";
  if (/^- \[x\] (?:\*\*)?Changes requested(?:\*\*)?(?:\s|$)/mi.test(scope)) return "changes_requested";
  if (/^- \[x\] (?:\*\*)?Needs re-review(?:\*\*)?(?:\s|$)/mi.test(scope)) return "needs_re_review";
  if (/^- \[x\] (?:\*\*)?Spec gap(?:\*\*)?(?:\s|$)/mi.test(scope)) return "spec_gap";
  return null;
}
var PHASE_GATE_CONFIG = {
  spec: { artifactName: "spec.md" },
  spec_review: { artifactName: "spec-review.md", requiresVerdict: true, verdictMustMatchArtifact: true },
  plan: { artifactName: "plan.md" },
  implement: { artifactName: "handoff.md" },
  code_review: { artifactName: "review.md", requiresVerdict: true, verdictMustMatchArtifact: true },
  qa: { artifactName: "done.md", customTemplateCheck: isDoneMdTemplate },
  // human_review's gate logic lives in checkPhaseGate's switch below — it
  // can't be expressed by the standard artifact/verdict config because the
  // rule cross-references handoff.md (validation outcomes) + done.md
  // (waiver text).
  human_review: {}
};
function resolveTaskDirForValidation(taskId, taskDirOverride) {
  return taskDirOverride ? path7.join(taskDirOverride, taskId) : taskDirFor(taskId);
}
function checkPhaseGate(taskId, phase, verdict, taskDirOverride) {
  const config3 = PHASE_GATE_CONFIG[phase];
  const taskDir = resolveTaskDirForValidation(taskId, taskDirOverride);
  if (config3.artifactName) {
    const artifactPath = path7.join(taskDir, config3.artifactName);
    let content;
    try {
      content = fs6.readFileSync(artifactPath, "utf8");
    } catch {
      return { ok: false, reason: `${config3.artifactName} is missing for phase '${phase}'` };
    }
    const isTemplate = config3.customTemplateCheck ? config3.customTemplateCheck(artifactPath) : isTemplateUnfilled(content);
    if (isTemplate) {
      return { ok: false, reason: `${config3.artifactName} is still the unfilled template for phase '${phase}'` };
    }
    let rerouteEv = { reroute: false };
    if (phase === "spec_review" || phase === "plan") {
      let statusRaw;
      try {
        statusRaw = fs6.readFileSync(path7.join(taskDir, "status.json"), "utf8");
      } catch {
        return { ok: false, reason: `cannot determine reroute state for '${phase}': status.json in ${taskDir} is missing or unreadable` };
      }
      let st;
      try {
        st = JSON.parse(statusRaw);
      } catch {
        return { ok: false, reason: `cannot determine reroute state for '${phase}': status.json in ${taskDir} is unparseable` };
      }
      rerouteEv = checkRerouteEvidence(phase, content, st);
      if (rerouteEv.reroute && !rerouteEv.ok) {
        return { ok: false, reason: `${config3.artifactName}: ${rerouteEv.reason}` };
      }
    }
    if (config3.verdictMustMatchArtifact) {
      if (!verdict) {
        return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
      }
      const extracted = rerouteEv.reroute && rerouteEv.ok ? rerouteEv.verdict : extractCheckedVerdict(content);
      const scopeLabel = rerouteEv.reroute && rerouteEv.ok ? `${config3.artifactName} reroute amendment-review section` : config3.artifactName;
      if (!extracted) {
        return { ok: false, reason: `${scopeLabel} has no checked verdict checkbox` };
      }
      if (extracted !== verdict) {
        return { ok: false, reason: `verdict mismatch: status.json wants '${verdict}', ${scopeLabel} has '${extracted}'` };
      }
    }
  }
  if (config3.requiresVerdict && !config3.verdictMustMatchArtifact) {
    if (!verdict) {
      return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
    }
  }
  if (phase === "human_review") {
    const handoffPath = path7.join(taskDir, "handoff.md");
    let handoffContent;
    try {
      handoffContent = fs6.readFileSync(handoffPath, "utf8");
    } catch {
      return { ok: false, reason: `closing human_review requires a handoff.md \u2014 none found in ${taskDir}` };
    }
    const pending = countHumanPendingChecks(handoffContent);
    if (pending.length === 0) return { ok: true };
    const donePath = path7.join(taskDir, "done.md");
    let doneContent = "";
    try {
      doneContent = fs6.readFileSync(donePath, "utf8");
    } catch {
    }
    if (hasHumanPendingWaiver(doneContent)) return { ok: true };
    const list = pending.map((p) => `    - ${p.check}${p.notes ? ` (${p.notes})` : ""}`).join("\n");
    return {
      ok: false,
      reason: `human_review cannot close with ${pending.length} unresolved human_pending check${pending.length === 1 ? "" : "s"}:
${list}
  Resolve: either run the check and update its row in handoff.md to Pass/Fail, or add an explicit waiver to done.md (a line beginning with "Acknowledged: ...") documenting the deferral and rationale.`
    };
  }
  return { ok: true };
}
function parseHandoffFiles(taskId) {
  return parseHandoffChangesRows(taskId).files;
}
function parseHandoffChangesRows(taskId) {
  const handoffPath = path7.join(taskDirFor(taskId), "handoff.md");
  let content;
  try {
    content = fs6.readFileSync(handoffPath, "utf8");
  } catch {
    return { files: [], malformed: [] };
  }
  const files = /* @__PURE__ */ new Set();
  const malformed = [];
  const tables = [
    parseTable(content, "Changes"),
    ...extractSectionBodies(content, /^## Iteration\b/).map((body) => parseTableH3(body, "Changes"))
  ];
  for (const rows of tables) {
    for (const row of rows) {
      const firstColumn = Object.values(row)[0] ?? "";
      if (!firstColumn.trim()) continue;
      const result = parseHandoffPathCell(firstColumn);
      if (result.kind === "ok") {
        files.add(result.path);
      } else {
        malformed.push({ cell: firstColumn.trim(), reason: result.reason });
      }
    }
  }
  return { files: [...files], malformed };
}
function parseAffectedFilesFromSpec(taskId) {
  const specPath = path7.join(taskDirFor(taskId), "spec.md");
  let content;
  try {
    content = fs6.readFileSync(specPath, "utf8");
  } catch {
    return { files: [], malformed: [] };
  }
  const sectionBodies = [
    ...extractSectionBodies(content, /^## Design\b/),
    ...extractSectionBodies(content, /^## Amendment\b/)
  ];
  if (sectionBodies.length === 0) return { files: [], malformed: [] };
  const files = /* @__PURE__ */ new Set();
  const malformed = [];
  for (const body of sectionBodies) {
    const rows = parseAllTablesH3(body, "Affected Files");
    for (const row of rows) {
      const firstColumn = Object.values(row)[0] ?? "";
      if (!firstColumn.trim()) continue;
      const result = parseHandoffPathCell(firstColumn);
      if (result.kind === "ok") {
        files.add(result.path);
      } else {
        malformed.push({ cell: firstColumn.trim(), reason: result.reason });
      }
    }
  }
  return { files: [...files], malformed };
}
function parseHandoffPathCell(cell) {
  const trimmed = cell.trim();
  if (!trimmed) return { kind: "malformed", reason: "empty cell" };
  const backtickGroups = [...trimmed.matchAll(/`([^`]+)`/g)];
  const mdLinkGroups = [...trimmed.matchAll(/\[([^\]]+)\]\([^)]+\)/g)];
  if (backtickGroups.length + mdLinkGroups.length > 1) {
    const tokens = [
      ...backtickGroups.map((m) => `\`${m[1]}\``),
      ...mdLinkGroups.map((m) => `[${m[1]}](...)`)
    ];
    return {
      kind: "malformed",
      reason: `multiple paths in one cell (${tokens.join(", ")}) \u2014 list one path per row`
    };
  }
  if (backtickGroups.length === 1) {
    if (!/^`[^`]+`(?:\s+.*)?$/.test(trimmed)) {
      return {
        kind: "malformed",
        reason: `backticked path must be at the start of the cell, optionally followed by an annotation \u2014 got: ${snippet(trimmed)}`
      };
    }
    return validateExtractedPath(backtickGroups[0][1].trim());
  }
  if (mdLinkGroups.length === 1) {
    if (!/^\[[^\]]+\]\(.+\)(?:\s+.*)?$/.test(trimmed)) {
      return {
        kind: "malformed",
        reason: `markdown link must be at the start of the cell \u2014 got: ${snippet(trimmed)}`
      };
    }
    return validateExtractedPath(mdLinkGroups[0][1].trim());
  }
  return {
    kind: "malformed",
    reason: `no recognized path \u2014 first column must be \`backtick-path\` or [markdown-link](url): ${snippet(trimmed)}`
  };
}
function snippet(value) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}
function validateExtractedPath(extracted) {
  if (!extracted) return { kind: "malformed", reason: "empty path inside backticks/link" };
  if (/[*?]/.test(extracted)) {
    return {
      kind: "malformed",
      reason: `wildcard not allowed in '${extracted}' \u2014 list each file explicitly so the diff\u2192handoff check can match`
    };
  }
  if (extracted.includes("<") || extracted.includes(">")) {
    return {
      kind: "malformed",
      reason: `template placeholder left unfilled in '${extracted}' \u2014 replace with a real file path`
    };
  }
  if (/^([a-zA-Z]:)?[\\/]/.test(extracted)) {
    return {
      kind: "malformed",
      reason: `absolute path '${extracted}' not allowed \u2014 handoff paths must be repo-relative`
    };
  }
  if (extracted.split(/[\\/]/).includes("..")) {
    return {
      kind: "malformed",
      reason: `parent-directory traversal in '${extracted}' not allowed \u2014 handoff paths must be repo-relative`
    };
  }
  return { kind: "ok", path: extracted };
}
var HANDOFF_DIFF_EXEMPT_PATHS = new Set(PIPELINE_TELEMETRY_FILES);
function isPipelineOwnedTaskArtifact(filePath, taskIds) {
  return taskIds.some((id) => filePath === `tasks/${id}` || filePath.startsWith(`tasks/${id}/`));
}
function verifyHandoffAgainstDiffFromData(taskIds, inputs) {
  const renamePairs = inputs.renamePairs ?? [];
  const gitIgnored = inputs.gitIgnoredHandoffFiles ?? /* @__PURE__ */ new Set();
  const coveredPaths = new Set(inputs.diffFiles);
  for (const [oldPath, newPath] of renamePairs) {
    coveredPaths.add(oldPath);
    coveredPaths.add(newPath);
  }
  const handoffFilesByTask = /* @__PURE__ */ new Map();
  const bundleHandoffFiles = /* @__PURE__ */ new Set();
  for (const taskId of taskIds) {
    const files = inputs.handoffFilesByTask.get(taskId) ?? [];
    handoffFilesByTask.set(taskId, files);
    for (const filePath of files) bundleHandoffFiles.add(filePath);
  }
  const issues = [];
  for (const taskId of taskIds) {
    const files = handoffFilesByTask.get(taskId) ?? [];
    for (const filePath of files) {
      if (gitIgnored.has(filePath)) continue;
      if (!coveredPaths.has(filePath)) {
        issues.push(`[${taskId}] handoff\u2192diff: ${filePath} listed in handoff but not in diff`);
      }
    }
  }
  for (const filePath of inputs.diffFiles) {
    if (HANDOFF_DIFF_EXEMPT_PATHS.has(filePath)) continue;
    if (isPipelineOwnedTaskArtifact(filePath, taskIds)) continue;
    if (bundleHandoffFiles.has(filePath)) continue;
    issues.push(`diff\u2192handoff: ${filePath} in diff but not in any bundle handoff`);
  }
  for (const [oldPath, newPath] of renamePairs) {
    if (HANDOFF_DIFF_EXEMPT_PATHS.has(oldPath) && HANDOFF_DIFF_EXEMPT_PATHS.has(newPath)) continue;
    if (isPipelineOwnedTaskArtifact(oldPath, taskIds) || isPipelineOwnedTaskArtifact(newPath, taskIds)) continue;
    if (bundleHandoffFiles.has(oldPath) || bundleHandoffFiles.has(newPath)) continue;
    issues.push(`diff\u2192handoff: rename ${oldPath} \u2192 ${newPath} \u2014 neither path in any bundle handoff`);
  }
  return issues;
}
function verifyBaseDriftFromData(diffFiles, allowedPaths, taskIds, allowedPrefixes = []) {
  const drift = [];
  for (const filePath of diffFiles) {
    if (allowedPaths.has(filePath)) continue;
    if (allowedPrefixes.some((prefix) => filePath.startsWith(prefix))) continue;
    if (taskIds.some((taskId) => filePath === `tasks/${taskId}` || filePath.startsWith(`tasks/${taskId}/`))) continue;
    drift.push(filePath);
  }
  return drift;
}
function parseDiffNameStatus(stdout) {
  const diffFiles = [];
  const renamePairs = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("	");
    const status = parts[0];
    if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
      renamePairs.push([parts[1], parts[2]]);
    } else if (parts.length >= 2) {
      diffFiles.push(parts[1]);
    }
  }
  return { diffFiles, renamePairs };
}
function verifyHandoffAgainstDiff(taskIds, baseRef) {
  const cwd = getActiveCwd(taskIds);
  const diffResult = gitSafeAtRaw(cwd, "diff", `${baseRef}...HEAD`, "--name-status", "-M");
  if (!diffResult.ok) {
    return [`git diff failed: ${diffResult.stderr || "unknown error"}`];
  }
  const { diffFiles, renamePairs } = parseDiffNameStatus(diffResult.stdout);
  const handoffFilesByTask = new Map(
    taskIds.map((taskId) => [taskId, parseHandoffFiles(taskId)])
  );
  const allHandoffPaths = [...new Set([...handoffFilesByTask.values()].flat())];
  const gitIgnoredHandoffFiles = filterGitIgnoredPaths(allHandoffPaths, cwd);
  return verifyHandoffAgainstDiffFromData(taskIds, {
    diffFiles,
    renamePairs,
    handoffFilesByTask,
    gitIgnoredHandoffFiles
  });
}
function verifyBaseDrift(taskIds, baseBranch, cwd) {
  const fetchResult = gitSafeAt(cwd, "fetch", "origin", baseBranch);
  if (!fetchResult.ok) {
    warn(
      `Could not fetch origin/${baseBranch} (${fetchResult.stderr.trim() || "unknown"}). Skipping base-drift check \u2014 re-run --pr when network access is restored if you want this verified.`
    );
    return { drift: [], fetchFailed: true, diffFailed: false };
  }
  const driftResult = getTreeDriftFiles(`origin/${baseBranch}`, cwd);
  if (!driftResult.ok) {
    return { drift: [], fetchFailed: false, diffFailed: true, diffError: driftResult.stderr };
  }
  const allowedPaths = new Set(PIPELINE_TELEMETRY_FILES);
  const allowedPrefixes = [];
  for (const taskId of taskIds) {
    const parsed = parseAffectedFilesFromSpec(taskId);
    for (const filePath of parsed.files) {
      if (filePath.endsWith("/")) {
        allowedPrefixes.push(filePath);
      } else {
        allowedPaths.add(filePath);
      }
    }
    for (const malformed of parsed.malformed) {
      warn(`${taskId} spec.md Affected Files row malformed: ${malformed.reason}`);
    }
    try {
      if (readStatus(taskId).phases.qa?.status === "done") {
        for (const doc of PIPELINE_MANAGED_DOCS) {
          allowedPaths.add(doc);
        }
      }
    } catch {
    }
  }
  return {
    drift: verifyBaseDriftFromData(driftResult.files, allowedPaths, taskIds, allowedPrefixes),
    fetchFailed: false,
    diffFailed: false
  };
}
function verifyBaseDivergenceFromData(commits) {
  if (commits.length === 0) return "";
  const noun = commits.length === 1 ? "commit" : "commits";
  return [
    `Base divergence detected: ${commits.length} colliding ${noun} on <base> not yet on origin/<base>; they will collide when <base> is pulled:`,
    ...commits.map((commit) => `  ${commit.sha.slice(0, 7)}  ${commit.subject}`),
    "Fix: git push origin <base>",
    "Override: rerun with --allow-divergent-base to skip this commit-divergence check only."
  ].join("\n");
}
function verifyBaseDivergence(baseBranch, cwd) {
  const fetchResult = gitSafeAt(cwd, "fetch", "origin", baseBranch);
  if (!fetchResult.ok) {
    if (!fs6.existsSync(cwd)) {
      return { commits: [], ok: false, stderr: fetchResult.stderr, fetchFailed: false };
    }
    warn(
      `Could not fetch origin/${baseBranch} (${fetchResult.stderr.trim() || "unknown"}). Skipping base-divergence check \u2014 re-run when network access is restored if you want this verified.`
    );
    return { commits: [], ok: true, stderr: "", fetchFailed: true };
  }
  const result = getUnpushedBaseCommits(baseBranch, cwd);
  if (!result.ok) {
    return { commits: result.commits, ok: false, stderr: result.stderr, fetchFailed: false };
  }
  return { commits: result.commits, ok: true, stderr: "", fetchFailed: false };
}

// scripts/run-task/prompts/index.ts
import fs8 from "fs";
import path9 from "path";

// scripts/run-task/context.ts
import fs7 from "fs";
import path8 from "path";
function extractAffectedFiles(taskId) {
  try {
    return parseAffectedFilesFromSpec(taskId).files;
  } catch {
    return [];
  }
}
function isSafeRepoPath(file) {
  if (path8.isAbsolute(file) || file.includes("..")) return false;
  const resolved = path8.resolve(REPO_ROOT, file);
  if (!resolved.startsWith(REPO_ROOT + path8.sep)) return false;
  try {
    const real = fs7.realpathSync(resolved);
    if (!real.startsWith(REPO_ROOT + path8.sep)) return false;
  } catch {
  }
  return true;
}
function buildContextBlock(taskIds) {
  const allFiles = /* @__PURE__ */ new Map();
  for (const taskId of taskIds) {
    for (const file of extractAffectedFiles(taskId)) {
      if (allFiles.has(file)) continue;
      if (!isSafeRepoPath(file)) continue;
      const filePath = path8.join(REPO_ROOT, file);
      try {
        allFiles.set(file, fs7.readFileSync(filePath, "utf8"));
      } catch {
      }
    }
  }
  if (allFiles.size === 0) return "";
  let totalBytes = 0;
  for (const content of allFiles.values()) totalBytes += content.length;
  if (totalBytes > config.maxContextBytes) {
    const list = [...allFiles.keys()].map((f) => `  - ${f}`).join("\n");
    return `
## Relevant Files (too large to pre-load \u2014 read these manually)

${list}
`;
  }
  let block = "\n## Relevant Files (pre-loaded from spec Affected Files)\n\n";
  for (const [file, content] of allFiles.entries()) {
    const ext = path8.extname(file).slice(1) || "text";
    block += `### \`${file}\`
\`\`\`${ext}
${content}
\`\`\`

`;
  }
  return block;
}
function buildKnownPitfalls(taskIds) {
  const patternsPath = process.env.CANON_PATTERNS_MD_PATH ?? path8.join(getActiveCwd(taskIds), "docs/patterns.md");
  try {
    const content = fs7.readFileSync(patternsPath, "utf8");
    const match = content.match(/## Known Pitfalls\n\n([\s\S]*?)(?:\n## |\n---|\n# |$)/);
    if (!match) return "";
    return `
## Known Codebase Pitfalls (from docs/patterns.md \u2014 read before touching these areas)

${match[1].trimEnd()}

`;
  } catch {
    return "";
  }
}
function buildKnownRisks(taskIds) {
  const riskBlocks = taskIds.map((taskId) => {
    const specPath = path8.join(taskDirFor(taskId), "spec.md");
    try {
      const content = fs7.readFileSync(specPath, "utf8");
      const match = content.match(/## Known Risks\n\n([\s\S]*?)(?:\n## |\n# |$)/);
      if (!match) return "";
      const risks = match[1].trim();
      if (!risks || /^n\/?a$/i.test(risks) || /^none$/i.test(risks)) return "";
      return taskIds.length > 1 ? `**\`${taskId}\` Known Risks:**
${risks}` : risks;
    } catch {
      return "";
    }
  }).filter(Boolean);
  if (riskBlocks.length === 0) return "";
  return `
## Known Risks (from spec \u2014 read before writing any code)

${riskBlocks.join("\n\n")}

`;
}
function summarizePreloadStatus(taskIds) {
  const files = /* @__PURE__ */ new Map();
  for (const taskId of taskIds) {
    for (const file of extractAffectedFiles(taskId)) {
      if (files.has(file)) continue;
      if (!isSafeRepoPath(file)) continue;
      const filePath = path8.join(REPO_ROOT, file);
      try {
        files.set(file, fs7.statSync(filePath).size);
      } catch {
        files.set(file, 0);
      }
    }
  }
  if (files.size === 0) return "none (spec has no Affected Files table)";
  const totalBytes = [...files.values()].reduce((sum, n) => sum + n, 0);
  const kb = (totalBytes / 1024).toFixed(1);
  if (totalBytes > config.maxContextBytes) {
    return `${files.size} file(s) listed (${kb} KB) \u2014 too large to pre-load, read them manually`;
  }
  return `${files.size} file(s) pre-loaded inline (${kb} KB)`;
}
function extractValidationChecks(taskId) {
  const specPath = path8.join(taskDirFor(taskId), "spec.md");
  try {
    const content = fs7.readFileSync(specPath, "utf8");
    const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
    if (!section) return [];
    const checks = [];
    for (const line of section[1].split("\n")) {
      const match = line.match(/^-\s+\[[ x]\]\s+`?([^`]+?)`?\s*(?:\(|$)/i);
      if (match?.[1]) checks.push(match[1].trim());
    }
    return checks;
  } catch {
    return [];
  }
}
function extractAcSummary(taskId) {
  const specPath = path8.join(taskDirFor(taskId), "spec.md");
  try {
    const content = fs7.readFileSync(specPath, "utf8");
    const lines = [];
    for (const line of content.split("\n")) {
      const match = line.match(/^-\s+\[[ x]\]\s+(AC-[\w.-]+):\s+(.+)$/);
      if (match) lines.push(`- ${match[1]}: ${match[2].trim()}`);
    }
    return lines;
  } catch {
    return [];
  }
}
function buildImplementStateHeader(state, mode) {
  const { tasks, tier, isBundle } = state;
  const taskIds = tasks.map((t) => t.taskId);
  const primary = tasks[0];
  const maxCodeReviewIter = tasks.reduce((max, task) => Math.max(max, task.iterations_current_loop), 0);
  const revisionExplain = `addressing code-review feedback (iteration ${maxCodeReviewIter + 1}) \u2014 read tasks/<id>/review.md`;
  const modeExplain = {
    fresh: "first implementation pass \u2014 no prior work on this phase",
    revision: revisionExplain,
    reroute: `spec was amended after human_review (reroute #${primary.rerouteCount}) \u2014 re-read spec.md for new sections`,
    resume: "previous implement pass was interrupted after code changes were made \u2014 finish validation + handoff only"
  };
  const sizes = new Set(tasks.map((t) => t.status.task_size ?? "M"));
  const nominalLabel = sizes.size === 1 ? [...sizes][0] : `mixed (${[...sizes].sort().join(",")})`;
  const effective = getEffectiveSize2(tasks);
  const nominal = getNominalSize2(tasks);
  const sizeLabel = effective !== nominal ? `${nominalLabel} (effective: ${effective} via delicate)` : nominalLabel;
  const bundleLabel = isBundle ? `${tasks.length}-task bundle` : "single task";
  const preloadLabel = summarizePreloadStatus(taskIds);
  const allChecks = /* @__PURE__ */ new Set();
  for (const id of taskIds) for (const c of extractValidationChecks(id)) allChecks.add(c);
  const checksLabel = allChecks.size > 0 ? [...allChecks].join(", ") : "see each spec's Validation Required section";
  const AC_SECTION_CAP = 3e3;
  let acSection = "";
  let truncatedLabel = "no";
  if (mode === "resume") {
    acSection = "\n## Acceptance Criteria\n\nCode changes are already in place \u2014 ensure handoff.md's AC coverage table lists every AC in spec.md.\n";
    truncatedLabel = "n/a (resume \u2014 see spec.md + handoff.md)";
  } else {
    const perTaskBlocks = taskIds.map((id) => {
      const acs = extractAcSummary(id);
      if (acs.length === 0) return { id, lines: [] };
      return { id, lines: acs };
    }).filter((b) => b.lines.length > 0);
    if (perTaskBlocks.length > 0) {
      let used = 0;
      const renderedBlocks = [];
      const dropped = {};
      for (const block of perTaskBlocks) {
        const header = isBundle ? `**\`${block.id}\`:**
` : "";
        const kept = [];
        for (const line of block.lines) {
          const cost = line.length + 1;
          if (used + cost > AC_SECTION_CAP) {
            dropped[block.id] = (dropped[block.id] ?? 0) + 1;
            continue;
          }
          kept.push(line);
          used += cost;
        }
        if (kept.length > 0) renderedBlocks.push(`${header}${kept.join("\n")}`);
      }
      const droppedEntries = Object.entries(dropped).filter(([, n]) => n > 0);
      const totalDropped = droppedEntries.reduce((sum, [, n]) => sum + n, 0);
      const truncMarker = droppedEntries.length > 0 ? `

*\u2026${droppedEntries.map(([id, n]) => isBundle ? `${n} more ACs in ${id}` : `${n} more ACs`).join(", ")} \u2014 see spec.md for full text*` : "";
      acSection = `
## Acceptance Criteria Summary (binding \u2014 full text and verification notes in spec.md)

${renderedBlocks.join("\n\n")}${truncMarker}
`;
      if (totalDropped > 0) truncatedLabel = `yes \u2014 ${totalDropped} AC${totalDropped === 1 ? "" : "s"} elided, fall back to spec.md`;
    }
  }
  return `## Task State

- Phase: **implement**
- Mode: **${mode}** \u2014 ${modeExplain[mode]}
- Tier / task size: ${tier} / ${sizeLabel}
- Scope: ${bundleLabel}
- Relevant files: ${preloadLabel}
- Required validation: ${checksLabel}
- ACs truncated: ${truncatedLabel}
${acSection}`;
}

// node_modules/mustache/mustache.mjs
var objectToString = Object.prototype.toString;
var isArray = Array.isArray || function isArrayPolyfill(object) {
  return objectToString.call(object) === "[object Array]";
};
function isFunction(object) {
  return typeof object === "function";
}
function typeStr(obj) {
  return isArray(obj) ? "array" : typeof obj;
}
function escapeRegExp(string) {
  return string.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, "\\$&");
}
function hasProperty(obj, propName) {
  return obj != null && typeof obj === "object" && propName in obj;
}
function primitiveHasOwnProperty(primitive, propName) {
  return primitive != null && typeof primitive !== "object" && primitive.hasOwnProperty && primitive.hasOwnProperty(propName);
}
var regExpTest = RegExp.prototype.test;
function testRegExp(re, string) {
  return regExpTest.call(re, string);
}
var nonSpaceRe = /\S/;
function isWhitespace(string) {
  return !testRegExp(nonSpaceRe, string);
}
var entityMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;"
};
function escapeHtml(string) {
  return String(string).replace(/[&<>"'`=\/]/g, function fromEntityMap(s) {
    return entityMap[s];
  });
}
var whiteRe = /\s*/;
var spaceRe = /\s+/;
var equalsRe = /\s*=/;
var curlyRe = /\s*\}/;
var tagRe = /#|\^|\/|>|\{|&|=|!/;
function parseTemplate(template, tags) {
  if (!template)
    return [];
  var lineHasNonSpace = false;
  var sections = [];
  var tokens = [];
  var spaces = [];
  var hasTag = false;
  var nonSpace = false;
  var indentation = "";
  var tagIndex = 0;
  function stripSpace() {
    if (hasTag && !nonSpace) {
      while (spaces.length)
        delete tokens[spaces.pop()];
    } else {
      spaces = [];
    }
    hasTag = false;
    nonSpace = false;
  }
  var openingTagRe, closingTagRe, closingCurlyRe;
  function compileTags(tagsToCompile) {
    if (typeof tagsToCompile === "string")
      tagsToCompile = tagsToCompile.split(spaceRe, 2);
    if (!isArray(tagsToCompile) || tagsToCompile.length !== 2)
      throw new Error("Invalid tags: " + tagsToCompile);
    openingTagRe = new RegExp(escapeRegExp(tagsToCompile[0]) + "\\s*");
    closingTagRe = new RegExp("\\s*" + escapeRegExp(tagsToCompile[1]));
    closingCurlyRe = new RegExp("\\s*" + escapeRegExp("}" + tagsToCompile[1]));
  }
  compileTags(tags || mustache.tags);
  var scanner = new Scanner(template);
  var start, type, value, chr, token, openSection;
  while (!scanner.eos()) {
    start = scanner.pos;
    value = scanner.scanUntil(openingTagRe);
    if (value) {
      for (var i = 0, valueLength = value.length; i < valueLength; ++i) {
        chr = value.charAt(i);
        if (isWhitespace(chr)) {
          spaces.push(tokens.length);
          indentation += chr;
        } else {
          nonSpace = true;
          lineHasNonSpace = true;
          indentation += " ";
        }
        tokens.push(["text", chr, start, start + 1]);
        start += 1;
        if (chr === "\n") {
          stripSpace();
          indentation = "";
          tagIndex = 0;
          lineHasNonSpace = false;
        }
      }
    }
    if (!scanner.scan(openingTagRe))
      break;
    hasTag = true;
    type = scanner.scan(tagRe) || "name";
    scanner.scan(whiteRe);
    if (type === "=") {
      value = scanner.scanUntil(equalsRe);
      scanner.scan(equalsRe);
      scanner.scanUntil(closingTagRe);
    } else if (type === "{") {
      value = scanner.scanUntil(closingCurlyRe);
      scanner.scan(curlyRe);
      scanner.scanUntil(closingTagRe);
      type = "&";
    } else {
      value = scanner.scanUntil(closingTagRe);
    }
    if (!scanner.scan(closingTagRe))
      throw new Error("Unclosed tag at " + scanner.pos);
    if (type == ">") {
      token = [type, value, start, scanner.pos, indentation, tagIndex, lineHasNonSpace];
    } else {
      token = [type, value, start, scanner.pos];
    }
    tagIndex++;
    tokens.push(token);
    if (type === "#" || type === "^") {
      sections.push(token);
    } else if (type === "/") {
      openSection = sections.pop();
      if (!openSection)
        throw new Error('Unopened section "' + value + '" at ' + start);
      if (openSection[1] !== value)
        throw new Error('Unclosed section "' + openSection[1] + '" at ' + start);
    } else if (type === "name" || type === "{" || type === "&") {
      nonSpace = true;
    } else if (type === "=") {
      compileTags(value);
    }
  }
  stripSpace();
  openSection = sections.pop();
  if (openSection)
    throw new Error('Unclosed section "' + openSection[1] + '" at ' + scanner.pos);
  return nestTokens(squashTokens(tokens));
}
function squashTokens(tokens) {
  var squashedTokens = [];
  var token, lastToken;
  for (var i = 0, numTokens = tokens.length; i < numTokens; ++i) {
    token = tokens[i];
    if (token) {
      if (token[0] === "text" && lastToken && lastToken[0] === "text") {
        lastToken[1] += token[1];
        lastToken[3] = token[3];
      } else {
        squashedTokens.push(token);
        lastToken = token;
      }
    }
  }
  return squashedTokens;
}
function nestTokens(tokens) {
  var nestedTokens = [];
  var collector = nestedTokens;
  var sections = [];
  var token, section;
  for (var i = 0, numTokens = tokens.length; i < numTokens; ++i) {
    token = tokens[i];
    switch (token[0]) {
      case "#":
      case "^":
        collector.push(token);
        sections.push(token);
        collector = token[4] = [];
        break;
      case "/":
        section = sections.pop();
        section[5] = token[2];
        collector = sections.length > 0 ? sections[sections.length - 1][4] : nestedTokens;
        break;
      default:
        collector.push(token);
    }
  }
  return nestedTokens;
}
function Scanner(string) {
  this.string = string;
  this.tail = string;
  this.pos = 0;
}
Scanner.prototype.eos = function eos() {
  return this.tail === "";
};
Scanner.prototype.scan = function scan(re) {
  var match = this.tail.match(re);
  if (!match || match.index !== 0)
    return "";
  var string = match[0];
  this.tail = this.tail.substring(string.length);
  this.pos += string.length;
  return string;
};
Scanner.prototype.scanUntil = function scanUntil(re) {
  var index = this.tail.search(re), match;
  switch (index) {
    case -1:
      match = this.tail;
      this.tail = "";
      break;
    case 0:
      match = "";
      break;
    default:
      match = this.tail.substring(0, index);
      this.tail = this.tail.substring(index);
  }
  this.pos += match.length;
  return match;
};
function Context(view, parentContext) {
  this.view = view;
  this.cache = { ".": this.view };
  this.parent = parentContext;
}
Context.prototype.push = function push(view) {
  return new Context(view, this);
};
Context.prototype.lookup = function lookup(name) {
  var cache = this.cache;
  var value;
  if (cache.hasOwnProperty(name)) {
    value = cache[name];
  } else {
    var context = this, intermediateValue, names, index, lookupHit = false;
    while (context) {
      if (name.indexOf(".") > 0) {
        intermediateValue = context.view;
        names = name.split(".");
        index = 0;
        while (intermediateValue != null && index < names.length) {
          if (index === names.length - 1)
            lookupHit = hasProperty(intermediateValue, names[index]) || primitiveHasOwnProperty(intermediateValue, names[index]);
          intermediateValue = intermediateValue[names[index++]];
        }
      } else {
        intermediateValue = context.view[name];
        lookupHit = hasProperty(context.view, name);
      }
      if (lookupHit) {
        value = intermediateValue;
        break;
      }
      context = context.parent;
    }
    cache[name] = value;
  }
  if (isFunction(value))
    value = value.call(this.view);
  return value;
};
function Writer() {
  this.templateCache = {
    _cache: {},
    set: function set(key, value) {
      this._cache[key] = value;
    },
    get: function get(key) {
      return this._cache[key];
    },
    clear: function clear() {
      this._cache = {};
    }
  };
}
Writer.prototype.clearCache = function clearCache() {
  if (typeof this.templateCache !== "undefined") {
    this.templateCache.clear();
  }
};
Writer.prototype.parse = function parse(template, tags) {
  var cache = this.templateCache;
  var cacheKey = template + ":" + (tags || mustache.tags).join(":");
  var isCacheEnabled = typeof cache !== "undefined";
  var tokens = isCacheEnabled ? cache.get(cacheKey) : void 0;
  if (tokens == void 0) {
    tokens = parseTemplate(template, tags);
    isCacheEnabled && cache.set(cacheKey, tokens);
  }
  return tokens;
};
Writer.prototype.render = function render(template, view, partials, config3) {
  var tags = this.getConfigTags(config3);
  var tokens = this.parse(template, tags);
  var context = view instanceof Context ? view : new Context(view, void 0);
  return this.renderTokens(tokens, context, partials, template, config3);
};
Writer.prototype.renderTokens = function renderTokens(tokens, context, partials, originalTemplate, config3) {
  var buffer = "";
  var token, symbol, value;
  for (var i = 0, numTokens = tokens.length; i < numTokens; ++i) {
    value = void 0;
    token = tokens[i];
    symbol = token[0];
    if (symbol === "#") value = this.renderSection(token, context, partials, originalTemplate, config3);
    else if (symbol === "^") value = this.renderInverted(token, context, partials, originalTemplate, config3);
    else if (symbol === ">") value = this.renderPartial(token, context, partials, config3);
    else if (symbol === "&") value = this.unescapedValue(token, context);
    else if (symbol === "name") value = this.escapedValue(token, context, config3);
    else if (symbol === "text") value = this.rawValue(token);
    if (value !== void 0)
      buffer += value;
  }
  return buffer;
};
Writer.prototype.renderSection = function renderSection(token, context, partials, originalTemplate, config3) {
  var self = this;
  var buffer = "";
  var value = context.lookup(token[1]);
  function subRender(template) {
    return self.render(template, context, partials, config3);
  }
  if (!value) return;
  if (isArray(value)) {
    for (var j = 0, valueLength = value.length; j < valueLength; ++j) {
      buffer += this.renderTokens(token[4], context.push(value[j]), partials, originalTemplate, config3);
    }
  } else if (typeof value === "object" || typeof value === "string" || typeof value === "number") {
    buffer += this.renderTokens(token[4], context.push(value), partials, originalTemplate, config3);
  } else if (isFunction(value)) {
    if (typeof originalTemplate !== "string")
      throw new Error("Cannot use higher-order sections without the original template");
    value = value.call(context.view, originalTemplate.slice(token[3], token[5]), subRender);
    if (value != null)
      buffer += value;
  } else {
    buffer += this.renderTokens(token[4], context, partials, originalTemplate, config3);
  }
  return buffer;
};
Writer.prototype.renderInverted = function renderInverted(token, context, partials, originalTemplate, config3) {
  var value = context.lookup(token[1]);
  if (!value || isArray(value) && value.length === 0)
    return this.renderTokens(token[4], context, partials, originalTemplate, config3);
};
Writer.prototype.indentPartial = function indentPartial(partial, indentation, lineHasNonSpace) {
  var filteredIndentation = indentation.replace(/[^ \t]/g, "");
  var partialByNl = partial.split("\n");
  for (var i = 0; i < partialByNl.length; i++) {
    if (partialByNl[i].length && (i > 0 || !lineHasNonSpace)) {
      partialByNl[i] = filteredIndentation + partialByNl[i];
    }
  }
  return partialByNl.join("\n");
};
Writer.prototype.renderPartial = function renderPartial(token, context, partials, config3) {
  if (!partials) return;
  var tags = this.getConfigTags(config3);
  var value = isFunction(partials) ? partials(token[1]) : partials[token[1]];
  if (value != null) {
    var lineHasNonSpace = token[6];
    var tagIndex = token[5];
    var indentation = token[4];
    var indentedValue = value;
    if (tagIndex == 0 && indentation) {
      indentedValue = this.indentPartial(value, indentation, lineHasNonSpace);
    }
    var tokens = this.parse(indentedValue, tags);
    return this.renderTokens(tokens, context, partials, indentedValue, config3);
  }
};
Writer.prototype.unescapedValue = function unescapedValue(token, context) {
  var value = context.lookup(token[1]);
  if (value != null)
    return value;
};
Writer.prototype.escapedValue = function escapedValue(token, context, config3) {
  var escape = this.getConfigEscape(config3) || mustache.escape;
  var value = context.lookup(token[1]);
  if (value != null)
    return typeof value === "number" && escape === mustache.escape ? String(value) : escape(value);
};
Writer.prototype.rawValue = function rawValue(token) {
  return token[1];
};
Writer.prototype.getConfigTags = function getConfigTags(config3) {
  if (isArray(config3)) {
    return config3;
  } else if (config3 && typeof config3 === "object") {
    return config3.tags;
  } else {
    return void 0;
  }
};
Writer.prototype.getConfigEscape = function getConfigEscape(config3) {
  if (config3 && typeof config3 === "object" && !isArray(config3)) {
    return config3.escape;
  } else {
    return void 0;
  }
};
var mustache = {
  name: "mustache.js",
  version: "4.2.0",
  tags: ["{{", "}}"],
  clearCache: void 0,
  escape: void 0,
  parse: void 0,
  render: void 0,
  Scanner: void 0,
  Context: void 0,
  Writer: void 0,
  /**
   * Allows a user to override the default caching strategy, by providing an
   * object with set, get and clear methods. This can also be used to disable
   * the cache by setting it to the literal `undefined`.
   */
  set templateCache(cache) {
    defaultWriter.templateCache = cache;
  },
  /**
   * Gets the default or overridden caching object from the default writer.
   */
  get templateCache() {
    return defaultWriter.templateCache;
  }
};
var defaultWriter = new Writer();
mustache.clearCache = function clearCache2() {
  return defaultWriter.clearCache();
};
mustache.parse = function parse2(template, tags) {
  return defaultWriter.parse(template, tags);
};
mustache.render = function render2(template, view, partials, config3) {
  if (typeof template !== "string") {
    throw new TypeError('Invalid template! Template should be a "string" but "' + typeStr(template) + '" was given as the first argument for mustache#render(template, view, partials)');
  }
  return defaultWriter.render(template, view, partials, config3);
};
mustache.escape = escapeHtml;
mustache.Scanner = Scanner;
mustache.Context = Context;
mustache.Writer = Writer;
var mustache_default = mustache;

// scripts/run-task/prompts/render.ts
function renderTemplate(template, view) {
  const prevEscape = mustache_default.escape;
  mustache_default.escape = (text) => text;
  try {
    return mustache_default.render(template, view).replace(/\n+$/, "");
  } finally {
    mustache_default.escape = prevEscape;
  }
}

// scripts/run-task/prompts/templates/code-review-foreman.md
var code_review_foreman_default = "You are the synthesis foreman for the code review phase for {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nYour job is to spawn two review lenses as isolated sub-agents, collect their findings, adjudicate using the spec (which you hold and the cold lens does not), then write one `review.md` and set the verdict.\n\nTasks:\n{{{taskLines}}}\n\n{{#isRound1}}\nThis is Round 1, the initial code review.\n{{/isRound1}}\n{{^isRound1}}\nThis is Round {{roundN}}: re-review after iteration {{priorIteration}}. Both lenses re-run from scratch. Direct the anchored lens to read the Iteration {{priorIteration}} section of `handoff.md` that addresses review round {{priorIteration}}.\n{{#tightenLine}}\n{{{tightenLine}}}\n{{/tightenLine}}\n{{/isRound1}}\n\n{{#hasDiff}}\nTask diff against {{{baseBranch}}}:\n\n```diff\n{{{diffContent}}}\n```\n{{#diffTruncated}}\n> Diff truncated at 50 000 bytes. Give both lenses the visible diff first; for the omitted remainder, direct them to inspect only the changed files named in the handoff Changes table. Do not give the cold lens spec, AC, or canon-doc context.\n{{/diffTruncated}}\n{{/hasDiff}}\n{{^hasDiff}}\nRetrieve the task diff with `git diff {{{baseBranch}}}...HEAD`.\n{{/hasDiff}}\n\n## Foreman Protocol\n\n### 1. Spawn Lenses In Parallel\n\nUse the Task tool to spawn both lenses simultaneously:\n\n**Anchored lens** (`subagent_type: code-review-anchored`)\n- Give it the full diff, `spec.md`, `handoff.md`, and prior `review.md` if this is a re-review.\n- It applies canon's anchored Stage 1 / Stage 2 code-review charter.\n- It returns structured findings to you. It must not write `review.md` or run `canon task phase`.\n\n**Cold lens** (`subagent_type: code-review-cold`)\n- Give it the full diff and base ref only.\n- Do not give it `spec.md`, ACs, handoff rationale, canon docs, known risks, or your anchored-lens prompt.\n- If it needs to inspect files for truncated diff context, constrain it to changed files only and preserve the spec-blind framing.\n- It returns structured findings to you. It must not write `review.md` or run `canon task phase`.\n\nDo not let either lens see the other lens's output.\n\n### 2. Adjudicate\n\nUse the two lens outputs and the spec. Do not perform a new full diff review for novel bugs; your role is synthesis and adjudication.\n\n1. Dedup: if both lenses flagged the same behavior, collapse it to one finding and record \"flagged by both lenses.\"\n2. Cold-vs-spec reconciliation: if a cold finding is explained as intended by the spec, drop it and record `Dismissed (cold): <finding> - <spec reason>` in `review.md`.\n3. Altitude classification: every surviving finding is either:\n   - `code-bug`: the implementation is wrong or test integrity is compromised.\n   - `spec-gap`: the implementation may match the written spec, but the spec is missing, wrong, or too ambiguous for the implementer to fix.\n\n### 3. Choose Verdict\n\n- Any `code-bug` finding -> `changes_requested`.\n- Any `spec-gap` finding and no code-bugs -> `spec_gap`.\n- Only optional nits or cleanup -> `approved_with_nits`.\n- No surviving findings -> `approved`.\n\nTest-integrity findings are always code-bugs.\n\n### 4. Write `review.md`\n\nFor each task, write `tasks/<id>/review.md`.\n\nRound 1 fills the existing template structure. Re-review appends a new `## Round {{roundN}}` section near the bottom, preserving earlier rounds.\n\nInclude:\n- Stage 1: anchored lens validation gate result and AC table.\n- Stage 2 / Findings: surviving findings with altitude (`code-bug` or `spec-gap`), source lens, and file:line.\n- Dismissed Cold Findings: every dropped cold finding plus the spec reason.\n- Final Verdict: check exactly one verdict checkbox, including `Spec gap` when applicable.\n\n### 5. Set Phase Verdict\n\nRun one command per task with the actual verdict:\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/implement.md
var implement_default = 'You are implementing {{taskScope}} for {{projectName}}.\n\n{{{stateHeader}}}\n{{{startup}}}\n{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}\n{{{affectedFilesBlock}}}\nTasks to implement:\n{{{taskLines}}}{{#isBundle}}\nThese tasks are related \u2014 implement them together. Consider shared code paths and cross-task interactions.{{/isBundle}}\n\nGrounding rule: before you write handoff.md, re-open the files you changed and verify the current diff against the spec. Do not treat a previous session\'s memory as proof that the work is already in place.\n\n**Spec ACs are binding. Plan approach is guidance.**\n- Every Acceptance Criterion in spec.md MUST be met \u2014 these are non-negotiable.\n- If you find a better implementation approach than what\'s in the plan, use it. Document every deviation in handoff.md under "Deviations" with specific rationale.\n- You may NOT silently drop an AC, skip a required validation check, or omit a spec requirement.\n- If an AC is infeasible as written, document it in Blockers \u2014 do not silently skip.\n- If an AC is ambiguous enough that two reasonable implementations exist, document your interpretation in handoff.md under Blockers with label `[ambiguity]` \u2014 do not silently guess. Claude will evaluate whether the interpretation was correct.\n\nRun ALL applicable validation checks before writing handoff. See "Validation Required" in each spec.md and the matrix in AGENTS.md. Required checks must be recorded as Pass or Fail; do not mark a required check N/A unless the spec explicitly removed it.\n\n**Test flakiness in your sandbox.** Validation suites \u2014 especially E2E or integration tests \u2014 can hit transient failures (timing races, environment quirks, network jitter) that have nothing to do with the code in your spec\'s Affected Files. **If a failure is in a test / file outside your Affected Files table, do NOT fix it.** Note the observed test name, file, line, and a one-line repro hint in handoff.md \u2192 Blockers (or "Validation Outcomes" Notes column with status `Fail \u2013 unrelated`), then continue. `Fail \u2013 unrelated` is only valid for failures in files outside your Affected Files; a failure in a file you changed is yours to fix. Scope discipline > fixing adjacent bugs you spot during validation. The reviewer/operator will decide whether to triage the unrelated failure separately.\n\nFor each task, write tasks/<id>/handoff.md using the template. The Validation Outcomes table must have no Fail results EXCEPT for unrelated-flake rows clearly labeled in the Notes column.\nAppend to tasks/<id>/notes.md for any surprising codebase behavior (prefix: [implement]).\n\nWhen done, run:\n{{{phaseCommands}}}\n';

// scripts/run-task/prompts/templates/implement-reroute.md
var implement_reroute_default = "You are addressing **human-review feedback** on {{taskScope}} for {{projectName}}.\n\n{{{stateHeader}}}\n{{{roundBanner}}}{{{preamble}}}\n\n{{#startup}}{{{startup}}}\n{{/startup}}{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}\n{{{affectedFilesBlock}}}\nTasks with amended specs:\n{{{taskLines}}}\n\n{{{groundingRule}}}\n\n**How to approach this:**\n1. For each task above, read `tasks/<id>/spec.md` from your current working directory (the worktree). REPO_ROOT's copy is the pre-implement scaffold and does NOT contain operator amendments. Locate the exact heading named in its entry \u2014 `## Amendment` for round 1, or `## Amendment Round N` for round 2+. Each task carries its own reroute round (bundles may mix rounds), so use the heading specified in that task's line, not a bundle-wide assumption. Treat that section's content as the new requirements; ignore prior-round sections when implementing this one.\n2. Check `tasks/<id>/plan.md` for `## Reroute Plan` (round 1) or `## Reroute Plan Round N` (N = that task's reroute round). If present, use that section as the delta guide. If absent (fast-tier reroute with no conversational reroute plan), read the base plan for orientation.\n3. Read tasks/<id>/handoff.md to understand what you previously shipped. Do NOT assume the handoff covers the amendment \u2014 it was written before the amendment existed.\n4. Identify the delta: which ACs are new, which changed, which were already addressed by the previous implementation.\n5. Implement the delta. Previously-correct work stays; only change what the amendment requires. If the amendment conflicts with a prior AC, the amendment wins.\n6. Re-run ALL applicable validation checks (lint, type-check, test, build, e2e as applicable per the spec's Validation Required). Required checks must be recorded as Pass or Fail; do not mark a required check N/A.\n7. **Rewrite handoff.md** to reflect the complete current state of the implementation \u2014 including the round-1 work that still applies plus the new amendment work. The reviewer reads handoff.md as the single source of truth, not your prior session's context.\n\n**Spec ACs are binding** \u2014 including both original ACs and amendment ACs. If you think an amendment AC is infeasible as written, document it under Blockers in handoff.md. Do not silently drop any AC.\n\nAppend to tasks/<id>/notes.md for any surprising behavior found while re-reading the codebase (prefix: `[implement-reroute]`).\n\nWhen done, run:\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/implement-revisions.md
var implement_revisions_default = '{{{iterBanner}}}\n\n{{{stateHeader}}}\n{{{startup}}}\n\n{{{affectedFilesBlock}}}\n\n{{#hasReviewFindings}}\nYour prior iteration shipped; the reviewer (Claude) appended findings to `review.md` as `## Round {{priorRound}}`. If you\'re resuming the prior session, the full task framing (spec, plan, repo conventions) is already in context \u2014 skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and `tasks/<id>/plan.md` before addressing findings.\n\nTasks with new review feedback:\n{{{reviewLines}}}\n\nFor each task:\n1. Read the most recent `## Round {{priorRound}}` section of `tasks/<id>/review.md`. That is the entire scope of this iteration.\n2. Address every `correctness bug`, `risk/guardrail`, and `spec gap` finding from that round (blocking). `optional cleanup/nit` is at your discretion{{#tightenLine}}{{{tightenLine}}}{{/tightenLine}}\n3. Re-run only the validation checks affected by your changes (typically lint, type-check, plus whatever the diff touches).\n4. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}` (the template\'s "On revision rounds" comment shows the shape). Do NOT rewrite the file from scratch \u2014 earlier iterations stay as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation results.\n{{/hasReviewFindings}}\n{{#hasPreflightFindings}}\nYour prior iteration was rejected by the orchestrator\'s pre-flight gate **before any Claude review ran**. The rejection details are recorded in `review.md` under `## Validation Gate` / `## Pre-Flight Rejection`.\n\nTasks with pre-flight rejection feedback:\n{{{reviewLines}}}\n\nFor each task:\n1. Read the pre-flight block in `tasks/<id>/review.md` and follow **whichever framing it carries**:\n   - **"Fix the handoff"** items \u2192 fix `handoff.md` (Validation Outcomes rows, AC Coverage table, Changes table).\n   - **"Fix the code"** items \u2192 a required check failed on a file you changed. Fix the regression, re-run the check, and update the handoff.\n   - Both framings may be present \u2014 address all items from both before resubmitting.\n2. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}`. Include the delta: which items you addressed and how.\n{{/hasPreflightFindings}}\n\nSpec ACs remain binding. If the review identifies a dropped AC, restore it.\nAppend to `tasks/<id>/notes.md` for new pitfalls found (prefix: `[implement-revision]`).\n\nWhen done, run:\n{{{phaseCommands}}}\n';

// scripts/run-task/prompts/templates/plan-reroute.md
var plan_reroute_default = "You are updating the implementation plan for {{taskScope}} for {{projectName}} after a human reroute.\n\n{{{startup}}}\n\nThe spec was amended after human review and Codex has reviewed the amendment. Your job is to **append** a reroute plan section to `plan.md`; do not rewrite or remove existing plan content.\n\n{{{roundBanner}}}Amendment review verdicts:\n{{{verdictLines}}}\n\nFor each task:\n1. Read `tasks/<id>/spec.md` from your current directory, including the amendment for the round listed above.\n2. Read `tasks/<id>/plan.md` to understand the prior plan.\n3. Read `tasks/<id>/handoff.md` to understand what Codex previously shipped.\n4. Read `tasks/<id>/spec-review.md` for the latest reroute amendment review and any nits to incorporate.\n5. Append a new section to `tasks/<id>/plan.md`:\n   - Round 1: `## Reroute Plan`\n   - Round N >= 2: `## Reroute Plan Round N`\n6. Plan only the delta from the amendment. Reference specific files, functions, and existing patterns. Acknowledge prior plan steps that still apply without re-planning them.\n\nDo **not** rewrite or remove existing sections from `plan.md`. The appended reroute plan is what implement-reroute reads as its delta guide.\n\nWhen done, run:\n{{{phaseCommands}}}\n\n<!-- per-round append shape:\n## Reroute Plan [Round N]\n### Delta\n- ...ordered steps for the amendment delta only...\n-->\n";

// scripts/run-task/prompts/templates/plan.md
var plan_default = "You are writing implementation plans for {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\n{{{verdictLines}}}\n\nFor each task, read tasks/<id>/spec.md and tasks/<id>/spec-review.md. Address any `changes_requested` items before writing the plan. If the verdict is `approved_with_nits`, incorporate the nits into the plan \u2014 they don't require spec changes but should inform implementation decisions.\n\nWrite tasks/<id>/plan.md for each task with ordered implementation steps. Reference specific files, existing patterns, and code examples from the codebase. Codex implements directly from this plan.\n\nIf you encounter spec gaps, append to tasks/<id>/notes.md (prefix: [plan]).\n\nWhen done, run:\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/qa.md
var qa_default = 'You are writing QA summaries for {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nTasks:\n{{{taskLines}}}\n\nFor each task:\n1. **Use the Write tool** to create tasks/<id>/done.md \u2014 plain-English summary for the human. Include: what changed, files changed, how to test, test results, human verification required, decisions made, open questions.\n   \u26A0\uFE0F CRITICAL: Use the `Write` tool \u2014 do NOT simply output the done.md content as text in your response. Content in your chat reply does not get saved to disk. The pipeline validates that done.md contains real content (not the template) before advancing. Write the file.\n2. Read the latest `## Validation Outcomes` table in `tasks/<id>/handoff.md`, including any later iteration `### Re-run validation` tables. If any check\'s latest result is `human_pending`, include a **Human Verification Required** section in done.md that lists each pending check and its Notes. If none remain, write `None.` in that section. Do not hide `human_pending` checks inside the generic Test Results table.\n   - If the human chooses to waive or defer a pending check later, the waiver line in done.md must begin with `Acknowledged:`. The `human_review` gate only treats that explicit prefix as a waiver.\n   - Preserve `deferred_by_spec` rows in Test Results with the spec citation from Notes; do not translate them to `Pass`.\n3. Include a **Proposed Changelog** section in done.md:\n   - Read AGENTS.md \xA7"Release Rules" for the project\'s changelog audience and SemVer interpretation before writing. Apply the project\'s defined scope.\n   - If CHANGELOG.md exists, read the top of it (the most recent version section) to calibrate on scope and voice.\n   - Apply the "would a user notice" test to every candidate bullet (or the project\'s equivalent scope test): if a candidate falls outside the project\'s defined changelog scope, omit it. If a task is entirely out of scope, say so explicitly ("no user-facing change \u2014 omit from changelog") rather than inventing a bullet.\n   - Implementation mechanics belong in the "What Changed" section above \u2014 not in the proposed changelog.\n   - Proposed version bump per the project\'s SemVer interpretation, with brief rationale.\n   The human finalizes both.\n4. **For single tasks only \u2014 use the Write tool** to create `tasks/<id>/pr-body.md` \u2014 the outward-facing PR body draft for `--pr`. Write it as if a human wrote it after doing the work.\n   {{#prTemplate}}\n   The repo has this PR template. Fill every section with specifics from what shipped. Keep the headings; replace every placeholder:\n\n   {{{prTemplate}}}\n   {{/prTemplate}}\n   {{^prTemplate}}\n   No PR template found. Use this structure:\n\n   ## Summary\n   1\u20133 bullets: what changed and why.\n\n   ## Changes\n   Key files or areas touched, described for a reviewer.\n\n   ## How to Test\n   Steps a reviewer can follow to verify the change.\n\n   ## Notes for Reviewer\n   Any context, caveats, or follow-up items.\n   {{/prTemplate}}\n   \u26A0\uFE0F Write as the human engineer who did the work \u2014 not as the AI or tool that produced it (Claude, Codex, canon, an LLM). \u2705 e.g. "Fix the pagination off-by-one that dropped the last row." \u274C e.g. "\u{1F916} Generated with Claude Code."\n   Skip this step entirely for bundle tasks \u2014 per-task bodies are not combined for bundle PRs.\n\nAfter writing all done.md files:\n- Read tasks/<id>/notes.md for each task. For each insight, ask: "would this have changed how a *different* task was approached?" If yes, **append** one new entry for *this* task to docs/lessons-learned.md. If no, the detail stays in notes.md only. Append-only: never edit, prune, promote, reorganize, or delete existing entries \u2014 not this task\'s earlier entries, and never another task\'s. Promoting entries into permanent docs (patterns.md / decisions.md / AGENTS.md) and pruning the buffer is a **human-initiated, human-approved** action \u2014 never perform it during QA, and no entry count ever triggers it. (See docs/lessons-learned.md \u2192 "How to use this doc".)\n- Append one row per task to docs/task-quality-log.md (see that file for column definitions).\n- **Docs freshness**: scan the protected docs in AGENTS.md (architecture.md, codebase-map.md, patterns.md, product-context.md, decisions.md) for references that {{docsScope}} *contradicts* \u2014 a renamed symbol, a moved file, a behavior this task changed \u2014 and correct those stale references. That is the only edit QA makes to permanent docs. Do not add new lessons, pitfalls, or decisions here, and do not promote buffer entries \u2014 promotion is the human sweep, not Docs freshness.\n- **Buffer signal** (not an action): after appending, if docs/lessons-learned.md now holds more than ~15 entries, add one line to this task\'s done.md \u2014 `Maintenance: lessons-learned.md has N entries; a human lessons sweep is due (see docs/lessons-learned.md \u2192 "How to use this doc").` Do not perform the sweep yourself.\n\nWhen done, run (use the Bash tool \u2014 do not just output the command as text):\n{{{phaseCommands}}}\n';

// scripts/run-task/prompts/templates/spec.md
var spec_default = "{{{header}}}\n\n{{{startup}}}\n\n{{{instructions}}}\n{{{bundleNote}}}\n{{#doneNote}}\nNote: {{{doneNote}}}{{/doneNote}}\n\n{{{selfCheck}}}\n\nWhen done, run (one per task):\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/spec-revision.md
var spec_revision_default = "You are revising specs for {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nTasks with review feedback:\n{{{reviewLines}}}\n\nAddress every `changes_requested` finding in each spec.md.{{#combined}}\nAlso update plan.md if spec changes affect the implementation approach.{{/combined}}\n\nWhen done, run:\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/spec-review-reroute.md
var spec_review_reroute_default = "You are reviewing {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nA human rerouted this task after human review. The original spec was already reviewed and approved. Your job is to review **the amendment and its integration** with the already-approved spec, not to re-litigate settled findings.\n\n{{{roundBanner}}}Tasks with amendments to review:\n{{{taskLines}}}\n\n**Amendment review scope** (for each task):\n1. Read `tasks/<id>/spec.md` from your current directory. Locate the exact amendment heading named above: `## Amendment` for round 1, or `## Amendment Round N` for round 2+.\n2. Read `tasks/<id>/spec-review.md` so you know what was already reviewed and do not re-raise settled findings.\n3. Review the amendment itself: is it implementable as written, are ACs verifiable, and are edge cases handled?\n4. Review integration with approved ACs: does the amendment contradict, weaken, duplicate, or leave gaps against previously approved requirements?\n5. Review overall shape: with the amendment included, is the spec still coherent and in scope?\n6. Do **not** read or audit `handoff.md`, `review.md`, or `done.md`. This phase stays in the spec domain.\n\nGrounding rule: if a finding depends on a symbol or file, re-open it before claiming it exists.\n\n**Verdict rules** (same as normal spec review):\n- `changes_requested` \u2014 one or more blocking findings. The human must revise the amendment and re-run.\n- `approved_with_nits` \u2014 no blockers; non-blocking observations only. Loop exits immediately.\n- `approved` \u2014 no findings.\n\nFor each task, append a new amendment-review section to `tasks/<id>/spec-review.md`; do not overwrite the prior review. Use this exact heading for the section (the orchestrator's evidence gate requires it before advancing):\n   - Round 1: `## Amendment Review`\n   - Round N >= 2: `## Amendment Review Round N`\nRecord your verdict **inside that section** as a checked box \u2014 the evidence gate reads the verdict from this section, not from the original review above it. Check exactly one of:\n`- [x] **Approved**` / `- [x] **Approved with nits**` / `- [x] **Changes requested**`.\n\nWhen done, run (one per task with actual verdict):\n{{{phaseCommands}}}\n\n<!-- per-round append shape (round 1 omits the round suffix):\n## Amendment Review          (round 1)\n## Amendment Review Round N  (round N >= 2)\n- [x] **Approved**            (check exactly one verdict box)\n> Findings: ...\n-->\n";

// scripts/run-task/prompts/templates/spec-review.md
var spec_review_default = "You are reviewing {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nTasks to review:\n{{{taskLines}}}\n\n{{#fullSendActive}}\n**Full-send mode active**: The human grilled Claude to resolve the decision tree but did not read this spec before pipeline execution. Your review is the primary rigor layer before implementation. Apply your existing review rubric, but raise the bar specifically on: (1) missed cases the spec's ACs might overlook; (2) scope drift between the Decision section and the ACs; (3) ambiguity in AC verification steps. Verdict thresholds are unchanged; expectations for thoroughness are higher.\n{{/fullSendActive}}\nGrounding rule: if a finding depends on code, a symbol, or a validation result, verify the current file or diff before you claim it exists. If you did not re-open it, do not infer it from memory.\n\n**Your job is to find what's wrong or missing \u2014 not to validate what's there.** Approach this as the implementer: if you had to build this, what would break, be ambiguous, or be missing? Neutral or confirmatory review is a failure mode.\n\n**First, a strategic read of the spec itself \u2014 shape before implementability.** Ask:\n- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)\n- For a bug or flake fix: has the targeted root cause been *verified by reproducing the mechanism* (deterministically \u2014 fault injection, forced race, targeted repro)? A paper argument can rule out a wrong hypothesis but doesn't by itself verify the real cause, so a fix on an unreproduced mechanism may just be the first plausible story that fit the symptom. An unverified mechanism is a blocking Shape Check concern. (See AGENTS.md \xA7\"Diagnose Before You Fix\".)\n- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)\n- Is there a materially simpler solution that changes the shape of the work?\n- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)\n\n**Silence is the default.** Only flag a Shape Check concern if something is actually off \u2014 do not manufacture one. A real shape concern becomes the lead reason for a `changes_requested` verdict; write it under the Shape Check section in spec-review.md. If none, leave that section as \"no concerns\" and proceed.\n\nThen for each task, actively probe implementability: Can this be implemented as written? Are ACs testable and unambiguous? Are edge cases handled? Are there type safety gaps? Are there file/interaction dependencies Claude missed? Does this conflict with existing patterns in the codebase?{{#isBundle}}\nAlso probe for cross-task conflicts or missing dependencies between tasks.{{/isBundle}}\n{{#combined}}\nReview plan.md for each task as well \u2014 flag if the approach is unsound.{{/combined}}\n\n**Classify every finding before deciding your verdict:**\n- **Blocking**: would cause wrong behavior, a silent bug, or make an AC unimplementable as written. Requires `changes_requested`.\n- **Non-blocking (nit)**: an implementation detail Codex can resolve by reading the codebase (prop flow, state threading, naming); a minor ambiguity with an obvious default; a question the plan phase should address. Does NOT require `changes_requested`.\n\n**Verdict rules:**\n- `changes_requested` \u2014 one or more blocking findings. Spec must be revised before the plan phase.\n- `approved_with_nits` \u2014 no blocking findings, but non-blocking nits worth passing forward. **Loop exits immediately.** Nits are written to spec-review.md and the plan phase picks them up.\n- `approved` \u2014 no findings worth noting.\n\n**Batch related nits.** If you have multiple non-blocking observations, include them all in one `approved_with_nits` verdict rather than raising one per round.\n\nIf you encounter surprising codebase behavior, append to tasks/<id>/notes.md (prefix: [spec_review]).\n\nFor each task, write tasks/<id>/spec-review.md using the template. Set your verdict: approved, approved_with_nits, or changes_requested.\n\nWhen done, run (one per task with actual verdict):\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/index.ts
var TEMPLATES = {
  "code-review-foreman.md": code_review_foreman_default,
  "implement.md": implement_default,
  "implement-reroute.md": implement_reroute_default,
  "implement-revisions.md": implement_revisions_default,
  "plan-reroute.md": plan_reroute_default,
  "plan.md": plan_default,
  "qa.md": qa_default,
  "spec.md": spec_default,
  "spec-revision.md": spec_revision_default,
  "spec-review-reroute.md": spec_review_reroute_default,
  "spec-review.md": spec_review_default
};
function loadTemplate(name) {
  const template = TEMPLATES[name];
  if (!template) throw new Error(`Unknown template: ${name}`);
  return template;
}
function render3(name, view) {
  return renderTemplate(loadTemplate(name), view);
}
function buildAffectedFilesBlock(affectedFiles, baseBranch) {
  if (!affectedFiles) return "";
  if (affectedFiles.length === 0) {
    return [
      "## Affected files (committed diff vs base branch)",
      "",
      "No prior commits on this task's branch yet. Apply the full default check matrix from the spec's *Validation Required* section \u2014 every check runs unconditionally on this first implement pass. Predicate gating is meaningful only once the task branch has committed changes.",
      ""
    ].join("\n");
  }
  const branch = baseBranch ?? "base branch";
  return [
    "## Affected files (committed diff vs base branch)",
    "",
    `The following files have committed changes on this task's branch vs \`${branch}\`:`,
    "",
    ...affectedFiles.map((file) => `- \`${file}\``),
    "",
    "Use this set when applying predicate-gated checks from the spec's *Validation Required* section. If a check is gated (e.g., \"run e2e only if `src/` changed\"), evaluate the predicate against the affected-files set; when the predicate is false, skip the check and record the skip in the Validation Outcomes table with the predicate's verbatim condition in the Notes column. When no predicate gates a check in the spec, run the check unconditionally.",
    ""
  ].join("\n");
}
function promptSpec(state) {
  const { tasks, tier, isBundle } = state;
  const combined = tier === "fast";
  const task = tasks[0];
  return render3("spec.md", {
    header: isBundle ? `You are writing specs for a bundle of ${tasks.length} related tasks for ${config.projectName}.

Bundle tasks:
${taskList(tasks)}` : `You are working on task "${task.taskId}" for ${config.projectName}.

Task: ${task.title}
Directory: tasks/${task.taskId}/`,
    startup: CLAUDE_STARTUP,
    instructions: isBundle ? tasks.map(
      (t) => `**Task \`${t.taskId}\`**: Write tasks/${t.taskId}/spec.md using the template.` + (combined ? ` Also write tasks/${t.taskId}/plan.md with ordered implementation steps, specific file references, and existing patterns.` : "")
    ).join("\n\n") : `Write tasks/${task.taskId}/spec.md using the template in .canon/templates/spec.md. Be concrete \u2014 Codex implements directly from this.` + (combined ? `

Also write tasks/${task.taskId}/plan.md with ordered implementation steps, specific file references, and existing patterns to use.` : ""),
    bundleNote: isBundle ? "\nThese tasks are related \u2014 consider cross-task interactions while speccing." : "",
    doneNote: combined ? "The orchestrator will handle spec_review and plan-phase advancement automatically for fast-tier tasks." : "",
    selfCheck: [
      "Before running the canon task command, self-check each spec against this list. Fix anything that fails:",
      '- Every AC is verifiable with a specific test (not just "it works" \u2014 state exactly how to verify)',
      "- Affected Files lists specific files (not directories) with specific, actionable change descriptions",
      combined ? "- Plan steps reference actual function/file names from the codebase (not just concepts)" : null,
      "- Known Risks covers failure modes for the trickiest ACs",
      "- Human Test Plan describes product behavior only (no code, no file names, no TypeScript)",
      '- Validation Required has at least one entry checked (or explicitly "None" with a reason)'
    ].filter(Boolean).join("\n"),
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "spec", "done")
  });
}
function promptSpecRevision(state) {
  const { tasks, tier } = state;
  const combined = tier === "fast";
  const reviewLines = tasks.filter((t) => t.specReviewVerdict === "changes_requested").map((t) => `- \`${t.taskId}\`: read tasks/${t.taskId}/spec-review.md for findings`).join("\n");
  return render3("spec-revision.md", {
    projectName: config.projectName,
    startup: CLAUDE_STARTUP,
    taskScope: tasks.length > 1 ? "a bundle of tasks" : `task "${tasks[0].taskId}"`,
    reviewLines,
    combined,
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "spec", "done")
  });
}
function promptSpecReview(state) {
  const { tasks, tier } = state;
  const isReroute = tasks.some((t) => t.status.phases.implement?.rerouted === true);
  if (isReroute) {
    const roundBanner = tasks.length === 1 ? (() => {
      const rerouteCount = tasks[0].rerouteCount;
      return rerouteCount <= 1 ? "**This is reroute amendment review round 1.** Review the `## Amendment` section.\n\n" : `**This is reroute amendment review round ${rerouteCount}.** Review the \`## Amendment Round ${rerouteCount}\` section.

`;
    })() : "**This is a reroute amendment review for a bundle.** Each task has its own round; use the per-task heading below.\n\n";
    const taskLines2 = tasks.map((t) => {
      const expectedHeading = t.rerouteCount <= 1 ? "`## Amendment`" : `\`## Amendment Round ${t.rerouteCount}\``;
      return `- \`${t.taskId}\`: "${t.title}" (reroute round ${t.rerouteCount}) \u2192 review ${expectedHeading} in tasks/${t.taskId}/spec.md`;
    }).join("\n");
    return render3("spec-review-reroute.md", {
      projectName: config.projectName,
      startup: CODEX_STARTUP,
      taskScope: tasks.length > 1 ? "a bundle of amended specs" : "an amended spec",
      roundBanner,
      taskLines: taskLines2,
      phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "spec_review", "done", "<verdict>")
    });
  }
  const combined = tier === "fast";
  const fullSendActive = tasks.some((t) => t.status.full_send === true);
  const taskLines = tasks.map(
    (t) => `- \`${t.taskId}\`: "${t.title}" \u2192 tasks/${t.taskId}/spec.md${combined ? ` and tasks/${t.taskId}/plan.md` : ""}`
  ).join("\n");
  return render3("spec-review.md", {
    projectName: config.projectName,
    startup: CODEX_STARTUP,
    taskScope: tasks.length > 1 ? "a bundle of specs" : "a spec",
    taskLines,
    combined,
    isBundle: tasks.length > 1,
    fullSendActive,
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "spec_review", "done", "<verdict>")
  });
}
function promptPlan(state) {
  const { tasks } = state;
  const isReroute = tasks.some((t) => t.status.phases.implement?.rerouted === true);
  if (isReroute) {
    const roundBanner = tasks.length === 1 ? (() => {
      const rerouteCount = tasks[0].rerouteCount;
      return rerouteCount <= 1 ? "**Reroute round 1.** Append `## Reroute Plan` to plan.md.\n\n" : `**Reroute round ${rerouteCount}.** Append \`## Reroute Plan Round ${rerouteCount}\` to plan.md.

`;
    })() : "**Bundle reroute.** Each task has its own round; use the per-task lines below for the exact section heading.\n\n";
    const verdictLines2 = tasks.map((t) => {
      const planHeading = t.rerouteCount <= 1 ? "`## Reroute Plan`" : `\`## Reroute Plan Round ${t.rerouteCount}\``;
      return `- \`${t.taskId}\`: amendment review verdict = ${t.specReviewVerdict}; reroute round ${t.rerouteCount}; append ${planHeading}`;
    }).join("\n");
    return render3("plan-reroute.md", {
      projectName: config.projectName,
      startup: CLAUDE_STARTUP,
      taskScope: tasks.length > 1 ? "a bundle of tasks" : `task "${tasks[0].taskId}"`,
      roundBanner,
      verdictLines: verdictLines2,
      phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "plan", "done")
    });
  }
  const verdictLines = tasks.map(
    (t) => `- \`${t.taskId}\`: spec review verdict = ${t.specReviewVerdict}`
  ).join("\n");
  return render3("plan.md", {
    projectName: config.projectName,
    startup: CLAUDE_STARTUP,
    taskScope: tasks.length > 1 ? "a bundle of tasks" : `task "${tasks[0].taskId}"`,
    verdictLines,
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "plan", "done")
  });
}
function promptImplement(state, mode = "fresh", affectedFiles, baseBranch) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  const taskLines = tasks.map(
    (t) => `- \`${t.taskId}\`: "${t.title}" \u2192 read tasks/${t.taskId}/spec.md and tasks/${t.taskId}/plan.md`
  ).join("\n");
  return render3("implement.md", {
    projectName: config.projectName,
    taskScope: tasks.length > 1 ? "a bundle of related tasks" : `task "${tasks[0].taskId}"`,
    stateHeader: buildImplementStateHeader(state, mode),
    startup: CODEX_STARTUP,
    risksBlock: buildKnownRisks(taskIds),
    pitfallsBlock: buildKnownPitfalls(taskIds),
    contextBlock: buildContextBlock(taskIds),
    affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
    taskLines,
    isBundle: tasks.length > 1,
    phaseCommands: phaseCommands(taskIds, "implement", "done")
  });
}
function promptImplementResume(state) {
  return [
    "Your implementation session was interrupted before you could write handoffs.",
    "The code changes are already complete in the working tree.",
    "",
    "Your only remaining tasks:",
    `1. Run the project's validation commands (see AGENTS.md "Validation Matrix" and each spec's "Validation Required" section) and record results.`,
    "2. Write handoff.md for each task (intent/rationale, deviations, AC coverage, validation outcomes).",
    "3. Run canon task to mark implement done for each task.",
    "",
    promptImplement(state, "resume")
  ].join("\n");
}
function promptImplementRevisions(state, affectedFiles, baseBranch) {
  const { tasks } = state;
  const stateHeader = buildImplementStateHeader(state, "revision");
  const maxCodeReviewIter = tasks.reduce((m, t) => Math.max(m, t.iterations), 0);
  const maxPreflightRejections = tasks.reduce(
    (m, t) => Math.max(m, t.status.phases.code_review?.preflight_rejections_current_loop ?? 0),
    0
  );
  const hasPreflightFindings = maxPreflightRejections > 0;
  const hasReviewFindings = maxCodeReviewIter > 0 && !hasPreflightFindings;
  const iterationN = maxCodeReviewIter + 1;
  const priorRound = maxCodeReviewIter;
  const iterBanner = hasPreflightFindings ? `[ITERATION ${iterationN} \u2014 addressing pre-flight rejection]` : `[ITERATION ${iterationN} \u2014 addressing code review round ${priorRound}]`;
  const handoffAppend = hasPreflightFindings ? `## Iteration ${iterationN} \u2014 addressing pre-flight rejection` : `## Iteration ${iterationN} \u2014 addressing review round ${priorRound}`;
  const reviewLines = hasReviewFindings ? tasks.map(
    (t) => `- \`${t.taskId}\` \u2192 read \`tasks/${t.taskId}/review.md\` (most recent \`## Round ${priorRound}\` section only \u2014 earlier rounds are already addressed)`
  ).join("\n") : hasPreflightFindings ? tasks.map(
    (t) => `- \`${t.taskId}\` \u2192 read \`tasks/${t.taskId}/review.md\` (\`## Validation Gate\` / \`## Pre-Flight Rejection\` block). Follow whichever framing it carries: fix the handoff, fix the code, or both.`
  ).join("\n") : "";
  return render3("implement-revisions.md", {
    projectName: config.projectName,
    taskScope: tasks.length > 1 ? "a bundle of related tasks" : `task "${tasks[0].taskId}"`,
    stateHeader,
    startup: CODEX_STARTUP,
    affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
    iterBanner,
    handoffAppend,
    hasReviewFindings,
    hasPreflightFindings,
    iterationN,
    priorRound,
    reviewLines,
    tightenLine: iterationN >= 3 ? ` (note: round ${iterationN} is tightening \u2014 prefer to defer nits).` : "",
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "implement", "done")
  });
}
function promptImplementReroute(state, isResumedSession = false, affectedFiles, baseBranch) {
  const { tasks } = state;
  const stateHeader = buildImplementStateHeader(state, "reroute");
  const taskIds = tasks.map((t) => t.taskId);
  const roundBanner = tasks.length === 1 ? (() => {
    const rerouteCount = tasks[0].rerouteCount;
    const humanReviewRound = rerouteCount + 1;
    const priorReroutes = rerouteCount - 1;
    return rerouteCount >= 2 ? `\u26A0\uFE0F  **THIS IS ROUND ${humanReviewRound} OF HUMAN REVIEW \u2014 REROUTE #${rerouteCount}.** You have already been sent back ${priorReroutes} time${priorReroutes === 1 ? "" : "s"} before this one. This prompt is **not** a duplicate of the previous reroute you already addressed \u2014 the human has provided **new** feedback beyond what you fixed in reroute #${priorReroutes}. If your session memory says "I just finished this," that memory is from the PRIOR round. The spec has additional amendments since then. If your handoff.md references "round ${rerouteCount}" or earlier, it is out-of-date \u2014 the current round is ${humanReviewRound}.

` : `**This is round 2 of human review \u2014 the first reroute for this task.** The human has reviewed your original implementation and sent it back with feedback that requires spec amendments.

`;
  })() : `\u26A0\uFE0F  **This is a reroute round for a bundle of tasks.** Each task carries its own reroute count \u2014 see the per-task lines below for the round number and amendment heading specific to each task. Do **not** assume a single bundle-wide round: a bundle can mix tasks on different reroute rounds. The human has reviewed prior implementations and sent the bundle back with **new** feedback that requires spec amendments. If your session memory says "I just finished this," that memory is from a prior round \u2014 re-read each task's amended spec before changing anything.

`;
  const taskLines = tasks.map((t) => {
    const expectedHeading = t.rerouteCount <= 1 ? "`## Amendment`" : `\`## Amendment Round ${t.rerouteCount}\``;
    return `- \`${t.taskId}\`: "${t.title}" (entering reroute round ${t.rerouteCount}) \u2014 the spec was amended after human review. Locate ${expectedHeading} in tasks/${t.taskId}/spec.md and treat that section's content as the new requirements. Ignore prior-round sections when implementing this one. Your previous handoff is at tasks/${t.taskId}/handoff.md.`;
  }).join("\n");
  const preamble = isResumedSession ? "Your session is being continued with spec amendments. The spec has been updated since your last turn \u2014 new ACs, new sections, or revised requirements have been added. Your existing code and codebase context are still valid; only the spec has changed." : "A human reviewed your previous implementation and sent it back with additional feedback. The spec has been updated in place \u2014 new ACs, new sections, or revised requirements have been added since you last read it. This is **not** a resume of an interrupted session: your previous work shipped, the human tried it, and now there's more to do.";
  const startup = isResumedSession ? "" : CODEX_STARTUP;
  const groundingRule = isResumedSession ? "Grounding rule: re-read the amended spec.md and your handoff.md before changing anything. Your codebase context is current, but the spec has new requirements \u2014 do not assume your prior memory of the spec is complete." : "Grounding rule: re-open the amended spec and the current handoff before changing anything. Session memory is stale by design on reroute rounds.";
  return render3("implement-reroute.md", {
    projectName: config.projectName,
    taskScope: tasks.length > 1 ? "a bundle of tasks" : `task "${tasks[0].taskId}"`,
    stateHeader,
    startup,
    roundBanner,
    preamble,
    groundingRule,
    risksBlock: buildKnownRisks(taskIds),
    pitfallsBlock: buildKnownPitfalls(taskIds),
    contextBlock: buildContextBlock(taskIds),
    affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
    taskLines,
    phaseCommands: phaseCommands(taskIds, "implement", "done")
  });
}
function bundleHasRealPriorReview(taskIds) {
  return taskIds.every((taskId) => {
    const reviewPath = path9.join(taskDirFor(taskId), "review.md");
    try {
      const content = fs8.readFileSync(reviewPath, "utf8");
      return /^## Stage 1\b/m.test(content) && !content.includes("[TASK-ID]");
    } catch {
      return false;
    }
  });
}
function promptCodeReview(state, baseBranch, scopedDiff = null) {
  const { tasks } = state;
  const rawMaxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
  const maxIter = bundleHasRealPriorReview(tasks.map((t) => t.taskId)) ? rawMaxIter : 0;
  const resolvedBaseBranch = baseBranch ?? getBaseBranch(tasks.map((t) => t.taskId));
  const hasDiff = scopedDiff !== null;
  const isRound1 = maxIter === 0;
  const roundN = maxIter + 1;
  const priorIteration = maxIter;
  const diffView = hasDiff ? {
    hasDiff,
    baseBranch: resolvedBaseBranch,
    diffContent: scopedDiff.diff,
    diffTruncated: scopedDiff.truncated
  } : {
    hasDiff,
    baseBranch: resolvedBaseBranch,
    diffContent: "",
    diffTruncated: false
  };
  const taskLines = isRound1 ? tasks.map(
    (t) => `- \`${t.taskId}\`: read tasks/${t.taskId}/handoff.md and cross-reference tasks/${t.taskId}/spec.md ACs`
  ).join("\n") : tasks.map(
    (t) => `- \`${t.taskId}\` -> read the Iteration ${priorIteration} section of \`tasks/${t.taskId}/handoff.md\` that addresses review round ${priorIteration}`
  ).join("\n");
  const tightenLine = roundN >= 3 ? `**Round ${roundN} discipline.** Findings must be \`correctness bug\` or \`spec gap\` only - no \`optional cleanup/nit\` and no wording-only changes. We are tightening, not exploring. If your only finding is a wording preference, approve.` : "";
  return render3("code-review-foreman.md", {
    projectName: config.projectName,
    startup: CLAUDE_STARTUP,
    taskScope: tasks.length > 1 ? "a bundle of tasks" : `task "${tasks[0].taskId}"`,
    taskLines,
    isBundle: tasks.length > 1,
    isRound1,
    roundN,
    priorIteration,
    maxIter,
    tightenLine,
    ...diffView,
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "code_review", "done", "<verdict>")
  });
}
function promptQa(state, prTemplate) {
  const { tasks } = state;
  const taskLines = tasks.map(
    (t) => `- \`${t.taskId}\`: "${t.title}" \u2192 tasks/${t.taskId}/`
  ).join("\n");
  return render3("qa.md", {
    projectName: config.projectName,
    docsScope: tasks.length > 1 ? "these tasks" : "this task",
    startup: QA_STARTUP,
    taskScope: tasks.length > 1 ? "a bundle of tasks" : `task "${tasks[0].taskId}"`,
    taskLines,
    prTemplate: prTemplate ?? null,
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "qa", "done")
  });
}

// src/task/index.ts
import { spawnSync as spawnSync5 } from "child_process";
import fs10 from "fs";
import path11 from "path";

// scripts/run-task/canon-snapshot.ts
import { spawnSync as spawnSync4 } from "child_process";
import fs9 from "fs";
import path10 from "path";
var CANON_UPSTREAM_REPO = "tstraub89/canon-ai";
function defaultRunCommand(command, args) {
  const result = spawnSync4(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) {
    return { ok: false, stdout: "", stderr: result.error.message };
  }
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim()
  };
}
function captureGitOutput(cwd, args, runGitAt) {
  const result = runGitAt(cwd, ...args);
  return result.ok ? result.stdout.trim() : "";
}
function captureVersion(command, runCommand3) {
  const result = runCommand3(command, ["--version"]);
  if (!result.ok) return "<unavailable>";
  const version = result.stdout.trim();
  return version.length > 0 ? version : "<unavailable>";
}
function captureCanonSnapshot(repoRoot = REPO_ROOT, options = {}) {
  const runGitAt = options.runGitAt ?? gitSafeAt;
  const runCommand3 = options.runCommand ?? defaultRunCommand;
  const superprojectWorkingTree = captureGitOutput(repoRoot, ["rev-parse", "--show-superproject-working-tree"], runGitAt);
  const upstreamCommit = captureGitOutput(repoRoot, ["rev-parse", "HEAD"], runGitAt) || "<unavailable>";
  const orchestratorCommit = superprojectWorkingTree ? captureGitOutput(path10.resolve(superprojectWorkingTree), ["rev-parse", "HEAD"], runGitAt) || "<unavailable>" : upstreamCommit;
  return {
    upstream_repo: CANON_UPSTREAM_REPO,
    upstream_commit: upstreamCommit,
    orchestrator_commit: orchestratorCommit,
    codex_cli: captureVersion("codex", runCommand3),
    claude_code: captureVersion("claude", runCommand3)
  };
}
function applyCanonSnapshot(status, canon) {
  const next = {
    ...status,
    canon,
    updated: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
  };
  next.status = deriveTopLevelStatus(next);
  return next;
}
function refreshCanonSnapshotAtPath(statusFilePath, options = {}) {
  const status = JSON.parse(fs9.readFileSync(statusFilePath, "utf8"));
  const canon = captureCanonSnapshot(REPO_ROOT, options);
  const next = applyCanonSnapshot(status, canon);
  const serialized = `${JSON.stringify(next, null, 2)}
`;
  const current = fs9.readFileSync(statusFilePath, "utf8");
  if (current !== serialized) {
    fs9.writeFileSync(statusFilePath, serialized, "utf8");
  }
  return canon;
}
function refreshCanonSnapshotsAtPaths(statusFilePaths, options = {}) {
  return statusFilePaths.map((statusFilePath) => refreshCanonSnapshotAtPath(statusFilePath, options));
}

// src/task/index.ts
var VALID_PHASES = new Set(PHASE_ORDER);
var VALID_STATUSES = /* @__PURE__ */ new Set(["pending", "in_progress", "done", "changes_requested", "blocked"]);
var VALID_VERDICTS = /* @__PURE__ */ new Set(["approved", "approved_with_nits", "changes_requested", "needs_re_review", "spec_gap"]);
var REVIEW_PHASES = /* @__PURE__ */ new Set(["spec_review", "code_review"]);
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function validateTaskId2(id) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`Error: invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores. No slashes, spaces, or leading special characters.`);
  }
  if (id.includes("..")) {
    throw new Error(`Error: invalid task ID '${id}'. Must not contain '..'.`);
  }
}
function tasksRoot() {
  return process.env.CANON_TASKS_DIR_OVERRIDE ?? "tasks";
}
function taskDirForCwd(_cwd, taskId) {
  const root = tasksRoot();
  if (path11.isAbsolute(root)) {
    return path11.join(root, taskId);
  }
  return path11.join(resolveTaskCwd(taskId), root, taskId);
}
function taskStatusFileForCwd(cwd, taskId) {
  return path11.join(taskDirForCwd(cwd, taskId), "status.json");
}
function taskRootForGate(cwd) {
  const root = tasksRoot();
  return path11.isAbsolute(root) ? root : path11.join(cwd, root);
}
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs10.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error: failed to read ${filePath}: ${message}`);
  }
}
function writeJsonAtomic(filePath, data) {
  const tmpFile = `${filePath}.tmp`;
  fs10.writeFileSync(tmpFile, `${JSON.stringify(data, null, 2)}
`, "utf8");
  fs10.renameSync(tmpFile, filePath);
}
function writeStatusAtomic(filePath, status) {
  status.status = deriveTopLevelStatus(status);
  writeJsonAtomic(filePath, status);
}
function assertValidPhase(phase) {
  if (!VALID_PHASES.has(phase)) {
    throw new Error(`Error: invalid phase '${phase}'. Must be one of: ${PHASE_ORDER.join(", ")}`);
  }
}
function assertValidStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Error: invalid status '${status}'. Must be one of: pending, in_progress, done, changes_requested, blocked`);
  }
}
function assertValidVerdict(phase, verdict) {
  if (!verdict) return;
  if (!REVIEW_PHASES.has(phase)) {
    throw new Error("Error: verdict is only valid for spec_review and code_review phases");
  }
  if (!VALID_VERDICTS.has(verdict)) {
    throw new Error(`Error: invalid verdict '${verdict}'. Must be one of: approved, approved_with_nits, changes_requested, needs_re_review, spec_gap`);
  }
  if (verdict === "spec_gap" && phase !== "code_review") {
    throw new Error(`Error: verdict 'spec_gap' is only valid for the code_review phase, not '${phase}'.`);
  }
}
function priorIncompletePhases(status, phase) {
  const index = PHASE_ORDER.indexOf(phase);
  if (index <= 0) return [];
  return PHASE_ORDER.slice(0, index).filter((prior) => (status.phases[prior]?.status ?? "pending") !== "done");
}
function ensurePhaseEntry(status, phase) {
  const existing = status.phases[phase];
  if (existing) return existing;
  const next = { status: "pending", agent: "" };
  status.phases[phase] = next;
  return next;
}
function updateReviewCounters(entry, verdict) {
  entry.iterations_current_loop ??= entry.iterations ?? 0;
  entry.iterations_total ??= entry.iterations ?? 0;
  entry.changes_requested_total ??= 0;
  entry.auto_block_count ??= 0;
  if (verdict === "changes_requested" || verdict === "needs_re_review") {
    entry.iterations_current_loop += 1;
    entry.iterations_total += 1;
    entry.changes_requested_total += 1;
    entry.iterations = entry.iterations_current_loop;
    entry.preflight_rejections_current_loop = 0;
  } else if (verdict === "approved" || verdict === "approved_with_nits" || verdict === "spec_gap") {
    entry.iterations_total += 1;
    entry.iterations_current_loop = 0;
    entry.iterations = 0;
    entry.preflight_rejections_current_loop = 0;
  }
}
function taskPhase(id, phaseArg, statusArg, verdictArg) {
  if (!id) throw new Error("Task ID required");
  if (!phaseArg) throw new Error("Phase required (spec, spec_review, plan, implement, code_review, qa, human_review)");
  if (!statusArg) throw new Error("Status required (pending, in_progress, done, changes_requested, blocked)");
  validateTaskId2(id);
  assertValidPhase(phaseArg);
  assertValidStatus(statusArg);
  assertValidVerdict(phaseArg, verdictArg);
  const taskCwd = resolveTaskCwd(id);
  const statusPath = taskStatusFileForCwd(taskCwd, id);
  if (!fs10.existsSync(statusPath)) {
    throw new Error(`Error: No status.json found for task ${id} (looked in ${taskDirForCwd(taskCwd, id)}/)`);
  }
  const status = readJsonFile(statusPath);
  if (statusArg !== "pending") {
    const blocked = priorIncompletePhases(status, phaseArg);
    if (blocked.length > 0) {
      throw new Error(`Error: cannot mark ${phaseArg} as ${statusArg} \u2014 prior phases not done: ${blocked.join(",")}`);
    }
  }
  if (statusArg === "done" && !process.env.CANON_SKIP_PHASE_GATE) {
    const result = checkPhaseGate(id, phaseArg, verdictArg, taskRootForGate(taskCwd));
    if (!result.ok) {
      throw new Error(
        `check-phase-gate: ${result.reason}
  Resolution: either fix the artifact (most common) or, for a known-template case, do not advance the phase to 'done'.`
      );
    }
  }
  const entry = ensurePhaseEntry(status, phaseArg);
  const previousStatus = entry.status;
  entry.status = statusArg;
  status.updated = today();
  if (verdictArg && Object.hasOwn(entry, "verdict")) {
    entry.verdict = verdictArg;
  }
  if (REVIEW_PHASES.has(phaseArg)) {
    updateReviewCounters(entry, verdictArg);
  }
  if (phaseArg === "implement" && previousStatus === "done" && statusArg !== "done") {
    delete entry.operator_accepted;
    delete entry.operator_accepted_sha;
    delete entry.operator_accepted_at;
  }
  writeStatusAtomic(statusPath, status);
  if (verdictArg) {
    console.log(`Updated ${id}: ${phaseArg} \u2192 ${statusArg} (verdict: ${verdictArg})`);
  } else {
    console.log(`Updated ${id}: ${phaseArg} \u2192 ${statusArg}`);
  }
}
function taskPhasePreflightRejected(id, phaseArg) {
  if (!id) throw new Error("Task ID required");
  if (!phaseArg) throw new Error("Phase required");
  validateTaskId2(id);
  assertValidPhase(phaseArg);
  if (!REVIEW_PHASES.has(phaseArg)) {
    throw new Error(`taskPhasePreflightRejected: phase '${phaseArg}' is not a review phase; only ${[...REVIEW_PHASES].join(", ")} support pre-flight rejection.`);
  }
  const taskCwd = resolveTaskCwd(id);
  const statusPath = taskStatusFileForCwd(taskCwd, id);
  if (!fs10.existsSync(statusPath)) {
    throw new Error(`Error: No status.json found for task ${id} (looked in ${taskDirForCwd(taskCwd, id)}/)`);
  }
  const status = readJsonFile(statusPath);
  const entry = ensurePhaseEntry(status, phaseArg);
  entry.status = "done";
  entry.verdict = "changes_requested";
  entry.iterations_current_loop ??= entry.iterations ?? 0;
  entry.iterations_total ??= entry.iterations ?? 0;
  entry.changes_requested_total ??= 0;
  entry.preflight_rejections_current_loop ??= 0;
  entry.preflight_rejections_total ??= 0;
  entry.auto_block_count ??= 0;
  entry.changes_requested_total += 1;
  entry.preflight_rejections_current_loop += 1;
  entry.preflight_rejections_total += 1;
  status.updated = today();
  status.status = deriveTopLevelStatus(status);
  writeStatusAtomic(statusPath, status);
  console.log(`Updated ${id}: ${phaseArg} \u2192 done (verdict: changes_requested, pre-flight; iteration counters preserved)`);
}

// scripts/run-task/phases/code-review.ts
function determinePreflightRoute(failures) {
  const allClassified = failures.flatMap((failure) => failure.classified);
  const hasFixable = allClassified.some((blocker) => blocker.bucket === "format" || blocker.bucket === "regression");
  return hasFixable ? "implement" : "auto_block";
}
function bullets(issues) {
  return issues.map((issue) => `- ${issue.message}`).join("\n");
}
function buildPreflightReviewBlock(classified, route) {
  const formatIssues = classified.filter((issue) => issue.bucket === "format");
  const regressionIssues = classified.filter((issue) => issue.bucket === "regression");
  const blockedIssues = classified.filter((issue) => issue.bucket === "blocked");
  const sections = [
    "## Validation Gate",
    "",
    "## Pre-Flight Rejection",
    ""
  ];
  if (route === "auto_block") {
    sections.push(
      "**HALTED \u2014 infrastructure unavailable before full review:**",
      "",
      "### Human triage required",
      "",
      bullets(blockedIssues),
      "",
      "Infrastructure was unavailable, so the required check status is unknown. Re-implementing cannot resolve this. Triage the infrastructure, update the Validation Outcomes rows once the checks can run, reset `phases.code_review.status` to `pending`, and re-run the pipeline."
    );
    return `${sections.join("\n")}
`;
  }
  sections.push("**BLOCKED \u2014 pre-flight rejected before full review:**", "");
  if (formatIssues.length > 0) {
    sections.push(
      "### Fix the handoff",
      "",
      bullets(formatIssues),
      "",
      "Fix the handoff structure called out above, then resubmit.",
      ""
    );
  }
  if (regressionIssues.length > 0) {
    sections.push(
      "### Fix the code",
      "",
      bullets(regressionIssues),
      "",
      "You broke one or more required checks. Fix the regression, re-run the failing check, and update the Validation Outcomes row. Use `Fail \u2013 unrelated` only when the failure is genuinely outside your changed files and the Notes cite a specific file/line reference outside your diff.",
      ""
    );
  }
  if (blockedIssues.length > 0) {
    sections.push(
      "### Infra note (address the above first)",
      "",
      bullets(blockedIssues),
      "",
      "Address the fixable items above first; blocked rows will be re-evaluated on the next pre-flight.",
      ""
    );
  }
  sections.push(
    "## Verdict",
    "",
    "- [x] **Changes requested** \u2014 address the items above and resubmit."
  );
  return `${sections.join("\n")}
`;
}
function siblingBullets(siblingTaskIds) {
  return siblingTaskIds.map((taskId) => `- \`${taskId}\` \u2014 see \`tasks/${taskId}/review.md\``).join("\n");
}
function buildCleanTaskReviewStub(taskId, siblingTaskIds, route, appendHeadingN) {
  const siblings = siblingBullets(siblingTaskIds);
  if (route === "auto_block") {
    const heading2 = appendHeadingN === null ? "## Bundle Pre-Flight Halt" : `## Bundle Pre-Flight Halt (round ${appendHeadingN}) \u2014 sibling infrastructure unavailable`;
    const sections2 = [
      ...appendHeadingN === null ? [`# Code Review: ${taskId}`, ""] : [],
      heading2,
      "",
      "This task is part of a bundle whose handoff pre-flight found only infrastructure-blocked validation rows. The required checks could not run, so no Claude review ran and re-implementation cannot resolve it.",
      "",
      "This task itself had no per-task pre-flight findings \u2014 the halt was triggered by sibling task(s) in the bundle:",
      "",
      siblings,
      "",
      'Human triage required: restore the infrastructure, update the affected sibling\'s `handoff.md` Validation Outcomes rows, set `phases.code_review.status = "pending"` for all bundle tasks, and re-run the pipeline.'
    ];
    return `${sections2.join("\n")}
`;
  }
  const heading = appendHeadingN === null ? "## Bundle Pre-Flight Rejection" : `## Bundle Pre-Flight Rejection (round ${appendHeadingN}) \u2014 sibling task(s) failed`;
  const sections = [
    ...appendHeadingN === null ? [`# Code Review: ${taskId}`, ""] : [],
    heading,
    "",
    "This task is part of a bundle whose handoff failed orchestrator pre-flight validation. No Claude review ran for the bundle.",
    "",
    "This task itself had no per-task pre-flight findings \u2014 the rejection was triggered by sibling task(s) in the bundle:",
    "",
    siblings
  ];
  if (appendHeadingN === null) {
    sections.push(
      "",
      "## Verdict",
      "",
      "- [x] **Changes requested** \u2014 fix the sibling task(s) above and resubmit handoff."
    );
  }
  return `${sections.join("\n")}
`;
}
function writePreflightReviewArtifacts(tasks, preflightFailed, route) {
  if (preflightFailed.length === 0) return false;
  const failuresByTask = new Map(preflightFailed.map((failure) => [failure.taskId, failure]));
  const siblingTaskIds = preflightFailed.map((failure) => failure.taskId);
  for (const t of tasks) {
    const reviewPath = path12.join(taskDirFor(t.taskId), "review.md");
    let existing = "";
    try {
      existing = fs11.readFileSync(reviewPath, "utf8");
    } catch {
    }
    const hasPriorRealReview = existing.length > 0 && !isTemplateUnfilled(existing) && /^## Stage 1\b/m.test(existing);
    const failure = failuresByTask.get(t.taskId);
    if (failure) {
      const blockedBlock = buildPreflightReviewBlock(failure.classified, route);
      const reviewContent2 = hasPriorRealReview ? `${existing.replace(/\s*$/, "")}

---

${blockedBlock}` : `# Code Review: ${t.taskId}

${blockedBlock}`;
      fs11.writeFileSync(reviewPath, reviewContent2, "utf8");
      continue;
    }
    const currentPreflight = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
    const appendHeadingN = hasPriorRealReview ? currentPreflight + 1 : null;
    const stub = buildCleanTaskReviewStub(t.taskId, siblingTaskIds, route, appendHeadingN);
    const reviewContent = hasPriorRealReview ? `${existing.replace(/\s*$/, "")}

---

${stub}` : stub;
    fs11.writeFileSync(reviewPath, reviewContent, "utf8");
  }
  return true;
}
async function runCodeReviewPhase(state, interactive, resumeId) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  verifyBranch(taskIds);
  const baseBranch = getBaseBranch(taskIds);
  const activeCwd = getActiveCwd(taskIds);
  const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations_current_loop), 0);
  const perTaskCombined = tasks.map((t) => {
    const preflight = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
    return {
      taskId: t.taskId,
      real: t.iterations_current_loop,
      preflight,
      combined: t.iterations_current_loop + preflight
    };
  });
  const worstTask = perTaskCombined.reduce((worst, curr) => curr.combined > worst.combined ? curr : worst, perTaskCombined[0]);
  const codeReviewLoopCap = getMaxReviewLoops(tasks);
  if (worstTask.combined >= codeReviewLoopCap) {
    const reason = `Code review hit ${worstTask.combined} attempts in a row for task ${worstTask.taskId} (${worstTask.real} reviewer rounds + ${worstTask.preflight} pre-flight rejections; limit: ${codeReviewLoopCap}). Pipeline auto-blocked. Read tasks/<id>/review.md \u2014 if the same finding keeps recurring, the spec or approach may need revisiting rather than another implementation pass. If repeated failures were all pre-flight, the handoff format itself may be wrong (e.g., Validation Outcomes rows using prose labels instead of backticked check keys). To resume after fixing: set phases.code_review.status = "pending", phases.code_review.iterations_current_loop = 0, and phases.code_review.preflight_rejections_current_loop = 0 in status.json, then re-run the pipeline.`;
    warn(reason);
    autoBlockPhase(taskIds, "code_review", worstTask.combined, reason);
    process.exit(2);
  }
  const changedFiles = new Set(getAffectedFiles(baseBranch, activeCwd));
  const bundleIssues = verifyHandoffAgainstDiff(taskIds, baseBranch);
  const preflightFailed = [];
  for (const t of tasks) {
    const taskBundleIssues = bundleIssues.filter(
      (issue) => !issue.startsWith("[") || issue.startsWith(`[${t.taskId}]`)
    );
    const classified = classifyPreflightBlockers(t.taskId, changedFiles, taskBundleIssues);
    if (classified.length > 0) preflightFailed.push({ taskId: t.taskId, classified });
  }
  if (preflightFailed.length > 0) {
    const route = determinePreflightRoute(preflightFailed);
    warn("Validation pre-flight FAILED \u2014 rejecting handoff without Claude review:");
    for (const { taskId, classified } of preflightFailed) {
      for (const issue of classified) warn(`  [${taskId}:${issue.bucket}] ${issue.message}`);
    }
    writePreflightReviewArtifacts(tasks, preflightFailed, route);
    if (route === "auto_block") {
      const reason = `Code review pre-flight found only blocked validation rows for task(s) ${preflightFailed.map((f) => f.taskId).join(", ")}. Infrastructure was unavailable, and re-implementation cannot resolve it. Human triage required. To resume after infrastructure is restored: update the affected handoff.md Validation Outcomes rows, set phases.code_review.status = "pending" for all bundle tasks in status.json, and re-run the pipeline.`;
      warn(reason);
      autoBlockPhase(taskIds, "code_review", worstTask.combined, reason);
      process.exit(2);
    }
    for (const { taskId } of tasks) {
      taskPhasePreflightRejected(taskId, "code_review");
    }
    return { agent: "claude", sessionId: null, exitCode: 0 };
  }
  info(`Phase: code_review (Claude${state.isBundle ? " bundle" : ""}, iteration ${maxIter + 1})`);
  for (const t of tasks) taskPhase(t.taskId, "code_review", "in_progress");
  const cfg = getClaudeConfig("code_review", tasks);
  const reviewResumeId = maxIter > 0 ? resumeId : null;
  const scopedDiff = getScopedDiff(baseBranch, activeCwd);
  const result = await runClaude(promptCodeReview(state, baseBranch, scopedDiff), interactive, reviewResumeId, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "code_review",
    iteration: maxIter,
    activeCwd
  }, activeCwd);
  for (const t of tasks) {
    const reviewPath = path12.join(taskDirFor(t.taskId), "review.md");
    let reviewContent = null;
    try {
      reviewContent = fs11.readFileSync(reviewPath, "utf8");
    } catch {
    }
    if (isTemplateUnfilled(reviewContent)) {
      warn(`[${t.taskId}] review.md is still the template after code_review run \u2014 sub-agent did not write it. Resetting to pending for retry.`);
      taskPhase(t.taskId, "code_review", "pending");
    }
  }
  return { agent: "claude", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/agents/codex.ts
async function runCodex(prompt, interactive, resumeId, model, effort, metricsContext, cwd = REPO_ROOT, wrapForResume = true) {
  const effectivePrompt = resumeId && wrapForResume ? toResumePrompt(prompt) : prompt;
  info(resumeId ? `Calling Codex (resuming ${resumeId.slice(0, 8)}...)...` : "Calling Codex...");
  info(`Model: ${model} | Effort: ${effort}`);
  const startMs = Date.now();
  let status = "ok";
  let tokens;
  let sessionId = null;
  try {
    if (interactive) {
      console.log("");
      console.log(resumeId ? "\u2500\u2500\u2500 Resuming interactive Codex session \u2500\u2500\u2500" : "\u2500\u2500\u2500 Opening interactive Codex session \u2500\u2500\u2500");
      console.log("Prompt loaded. You're in the driver's seat.");
      console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
      console.log("");
      runCommandOrDie("codex", ["-m", model, "-C", cwd, effectivePrompt], { cwd });
      return {
        exitCode: 0,
        signal: null,
        spawnError: null,
        stalled: false,
        capturedStdout: "",
        capturedStderr: "",
        sessionId: null
      };
    }
    const effortFlag = ["-c", `model_reasoning_effort=${effort}`];
    const sandboxFlags = resumeId ? [] : ["--sandbox", "workspace-write"];
    const args = resumeId ? ["exec", "resume", resumeId, "--json", ...effortFlag, effectivePrompt, "-m", model] : ["exec", "--json", ...effortFlag, ...sandboxFlags, effectivePrompt, "-m", model, "-C", cwd];
    const displayChunks = [];
    let tokenTotal = 0;
    let sawUsage = false;
    const onLine = (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const tick = formatLiveTick(event);
      if (tick) console.log(tick);
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        sessionId = event.thread_id;
      } else if (event.type === "turn.completed" && event.usage) {
        tokenTotal += (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
        sawUsage = true;
      } else if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        displayChunks.push(event.item.text);
      }
    };
    const result = await streamProcess("codex", args, {
      cwd,
      label: "Codex",
      onLine
    });
    if (sawUsage) tokens = tokenTotal;
    if (displayChunks.length > 0) {
      process.stdout.write(`${displayChunks.join("\n\n")}
`);
    }
    if (result.spawnError) {
      console.error(result.spawnError.message);
      status = "failed";
      process.exit(1);
    }
    if (result.stalled) {
      status = "failed";
      process.exit(1);
    }
    if (result.signal) {
      status = "failed";
      process.exit(1);
    }
    if (result.exitCode !== 0) {
      status = "failed";
      warn(`Codex exited with status ${result.exitCode ?? 0} \u2014 will verify phase completion via status.json.`);
    }
    return {
      ...result,
      sessionId
    };
  } catch (err) {
    status = "failed";
    throw err;
  } finally {
    if (metricsContext) recordMetric({ ...metricsContext, agent: "codex", model, durationMs: Date.now() - startMs, status, tokens });
  }
}

// scripts/run-task/phases/implement.ts
function shouldUseImplementRevision(tasks) {
  return tasks.some((t) => {
    const preflightCount = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
    return t.iterations_current_loop > 0 || preflightCount > 0;
  });
}
async function runImplementPhase(state, interactive, resumeId, force = false) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  const primaryStatus = readStatus(taskIds[0]);
  const worktreeAlreadyCreated = primaryStatus.worktree === true && Boolean(primaryStatus.branch);
  if (!worktreeAlreadyCreated) {
    commitTaskArtifactsToBase(taskIds, TASK_ARTIFACT_FILES);
    const scaffoldBase = getBaseBranch(taskIds);
    info(
      `Scaffold committed to local ${scaffoldBase}; run \`git push origin ${scaffoldBase}\` to keep origin in sync and avoid base-divergence at --push/--pr/--ship.`
    );
  }
  ensureBranch(taskIds, { force });
  const activeCwd = getActiveCwd(taskIds);
  const baseBranch = getBaseBranch(taskIds);
  const affectedFiles = getAffectedFiles(baseBranch, activeCwd);
  const isRevision = shouldUseImplementRevision(tasks);
  const isRerouted = tasks.some((t) => t.status.phases.implement?.rerouted === true);
  const wasImplementInProgress = tasks.some((t) => t.status.phases.implement?.status === "in_progress");
  const phaseLabel = isRevision ? ", revision" : isRerouted ? ", reroute (spec amended)" : "";
  info(`Phase: implement (Codex${state.isBundle ? " bundle" : ""}${phaseLabel})`);
  for (const t of tasks) taskPhase(t.taskId, "implement", "in_progress");
  const codexCfg = getCodexConfig("implement", tasks);
  const isResume = resumeId !== null && !isRevision && !isRerouted && wasImplementInProgress;
  const shouldResume = isRevision || isRerouted || isResume;
  const implementPrompt = isRevision ? promptImplementRevisions(state, affectedFiles, baseBranch) : isRerouted ? promptImplementReroute(state, resumeId !== null, affectedFiles, baseBranch) : isResume ? promptImplementResume(state) : promptImplement(state, "fresh", affectedFiles, baseBranch);
  const result = await runCodex(
    implementPrompt,
    interactive,
    shouldResume ? resumeId : null,
    codexCfg.model,
    codexCfg.effort,
    {
      taskId: taskIds.join("+"),
      phase: "implement",
      iteration: tasks[0].iterations_current_loop,
      activeCwd
    },
    activeCwd,
    /* wrapForResume */
    !isRerouted
  );
  if (isRevision) {
    const dirtyResult = gitSafeAtRaw(activeCwd, "status", "--porcelain=v1", "-uall");
    const meaningfulChanges = dirtyResult.ok ? [...parsePorcelain(dirtyResult.stdout)].filter((f) => {
      if (!f.startsWith("tasks/")) return true;
      if (f.endsWith("/handoff.md")) return true;
      if (f.endsWith("/notes.md")) return true;
      return false;
    }) : ["<git-status-failed>"];
    if (dirtyResult.ok && meaningfulChanges.length === 0) {
      warn("");
      warn("\u26A0\uFE0F  Codex revision iteration produced no source-file changes.");
      warn("    This is the resumed-session hallucination signature: Codex believed");
      warn("    the work was already done from a prior round and skipped re-editing.");
      warn("    Dropping the stored Codex session so the next run starts fresh.");
      warn("");
      for (const taskId of taskIds) {
        const s = readStatus(taskId);
        if (s.sessions) {
          delete s.sessions.codex;
          writeStatus(taskId, s);
        }
      }
      autoBlockPhase(
        taskIds,
        "implement",
        tasks[0].iterations_current_loop + 1,
        "Revision iteration produced no source-file diff \u2014 Codex resumed-session hallucination signature. Stored session cleared. Re-run pipeline for a fresh attempt, or apply the fix inline."
      );
      process.exit(2);
    }
  }
  return { agent: "codex", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/phases/plan.ts
import fs12 from "fs";
import path13 from "path";
async function runPlanPhase(state, interactive) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  info(`Phase: plan (Claude writes plan${state.isBundle ? "s" : ""})`);
  for (const t of tasks) taskPhase(t.taskId, "plan", "in_progress");
  const cfg = getClaudeConfig("plan", tasks);
  const activeCwd = getActiveCwd(taskIds);
  const result = await runClaude(promptPlan(state), interactive, null, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "plan",
    iteration: tasks[0].status.phases.plan?.iterations_current_loop ?? tasks[0].status.phases.plan?.iterations ?? 0,
    activeCwd
  }, activeCwd);
  for (const t of tasks) {
    const planPath = path13.join(taskDirFor(t.taskId), "plan.md");
    let planContent = null;
    try {
      planContent = fs12.readFileSync(planPath, "utf8");
    } catch {
    }
    if (isTemplateUnfilled(planContent)) {
      warn(`[${t.taskId}] plan.md is still the template after plan phase \u2014 sub-agent did not write it. Resetting to pending for retry.`);
      taskPhase(t.taskId, "plan", "pending");
    }
  }
  return { agent: "claude", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/phases/qa.ts
import fs13 from "fs";
import path14 from "path";
async function runQaPhase(state, interactive, resolvedPrTemplate) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  verifyBranch(taskIds);
  info(`Phase: qa (Claude writes QA${state.isBundle ? " for bundle" : ""})`);
  for (const t of tasks) taskPhase(t.taskId, "qa", "in_progress");
  const cfg = getClaudeConfig("qa", tasks);
  const activeCwd = getActiveCwd(taskIds);
  const result = await runClaude(promptQa(state, resolvedPrTemplate), interactive, null, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "qa",
    iteration: tasks[0].status.phases.qa?.iterations_current_loop ?? tasks[0].status.phases.qa?.iterations ?? 0,
    activeCwd
  }, activeCwd);
  if (!state.isBundle && result.capturedStdout) {
    const taskId = taskIds[0];
    const donePath = path14.join(activeCwd, "tasks", taskId, "done.md");
    if (isDoneMdTemplate(donePath)) {
      const salvaged = extractDoneMdFromStdout(result.capturedStdout);
      if (salvaged) {
        fs13.writeFileSync(donePath, salvaged);
        warn(`Salvaged tasks/${taskId}/done.md from captured stdout \u2014 QA sub-agent streamed content instead of using the Write tool.`);
        const phaseStatus = readStatus(taskId).phases.qa?.status ?? "pending";
        if (phaseStatus !== "done") {
          taskPhase(taskId, "qa", "done");
          warn(`Also advanced qa \u2192 done for ${taskId} (sub-agent skipped canon task).`);
        }
      }
    }
  }
  return { agent: "claude", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/phases/spec.ts
async function runSpecPhase(state, interactive, resumeId) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  const hasChangesRequested = tasks.some((t) => t.specReviewVerdict === "changes_requested");
  if (hasChangesRequested) {
    info("Phase: spec (Claude revises specs after review feedback)");
    for (const t of tasks) taskPhase(t.taskId, "spec", "in_progress");
    const cfg2 = getClaudeConfig("spec", tasks);
    const activeCwd2 = getActiveCwd(taskIds);
    const result2 = await runClaude(promptSpecRevision(state), interactive, resumeId, cfg2.model, cfg2.effort, {
      taskId: taskIds.join("+"),
      phase: "spec",
      iteration: tasks[0].status.phases.spec?.iterations_current_loop ?? tasks[0].status.phases.spec?.iterations ?? 0,
      activeCwd: activeCwd2
    });
    return { agent: "claude", sessionId: result2.sessionId, exitCode: result2.exitCode };
  }
  const label = state.tier === "fast" ? "spec+plan" : "spec";
  info(`Phase: spec (Claude writes ${label}${state.isBundle ? " for bundle" : ""})`);
  for (const t of tasks) taskPhase(t.taskId, "spec", "in_progress");
  const cfg = getClaudeConfig("spec", tasks);
  const activeCwd = getActiveCwd(taskIds);
  const result = await runClaude(promptSpec(state), interactive, null, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "spec",
    iteration: tasks[0].status.phases.spec?.iterations_current_loop ?? tasks[0].status.phases.spec?.iterations ?? 0,
    activeCwd
  });
  return { agent: "claude", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/phases/spec-review.ts
import fs14 from "fs";
import path15 from "path";
function autoBlockSpecReview(taskIds, iterationCount, reason) {
  autoBlockPhase(taskIds, "spec_review", iterationCount, reason);
}
async function runSpecReviewPhase(state, interactive, resumeId) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  if (state.tier === "fast") {
    const anyGateOn = tasks.some((t) => t.status.human_spec_gate);
    const allFullSend = tasks.every((t) => t.status.full_send === true);
    if (anyGateOn && !allFullSend) {
      for (const t of tasks) {
        if (t.status.human_spec_gate) {
          t.status.human_spec_gate = false;
          writeStatus(t.taskId, t.status);
        }
      }
      const specList = taskIds.map((id) => `  tasks/${id}/spec.md`).join("\n");
      const planList = taskIds.map((id) => `  tasks/${id}/plan.md`).join("\n");
      console.log("");
      console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
      console.log(`  \u270B  SPEC GATE \u2014 Review before Codex implements.`);
      console.log("");
      console.log("  Specs:");
      console.log(specList);
      console.log("  Plans:");
      console.log(planList);
      console.log("");
      console.log(`  When ready: canon run ${taskIds.join(" ")}`);
      console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
      console.log("");
      process.exit(0);
    }
    info("Fast tier: auto-advancing spec_review and plan (written during spec phase).");
    for (const t of tasks) {
      taskPhase(t.taskId, "spec_review", "done", "approved");
      if (isPlanCombined2(t.status)) {
        taskPhase(t.taskId, "plan", "done");
      }
    }
    return null;
  }
  const maxSpecIter = tasks.reduce(
    (max, t) => Math.max(
      max,
      t.status.phases.spec_review?.iterations_current_loop ?? t.status.phases.spec_review?.iterations ?? 0
    ),
    0
  );
  const specReviewLoopCap = getMaxReviewLoops(tasks);
  if (maxSpecIter >= specReviewLoopCap) {
    const reason = `Spec review hit ${maxSpecIter} changes_requested iterations in a row (limit: ${specReviewLoopCap}). Pipeline auto-blocked. A repeated pushback usually means the spec has a structural or scope issue that another mechanical revision won't fix \u2014 read the latest spec-review.md and decide whether to revise scope, split the task, or defer. To resume after fixing: set phases.spec_review.status = "pending" and phases.spec_review.iterations_current_loop = 0 in status.json, then re-run the pipeline.`;
    warn(reason);
    autoBlockSpecReview(taskIds, maxSpecIter, reason);
    process.exit(2);
  }
  info(`Phase: spec_review (Codex reviews spec${state.isBundle ? "s" : ""})`);
  for (const t of tasks) taskPhase(t.taskId, "spec_review", "in_progress");
  const isReReview = resumeId !== null;
  const specReviewPrompt = isReReview ? `The spec${state.isBundle ? "s have" : " has"} been revised since your last review. Re-read the current spec.md ${state.isBundle ? "files" : "file"} from disk and produce a completely fresh review \u2014 do not replay or summarise your previous output.

${promptSpecReview(state)}` : promptSpecReview(state);
  const cfg = getCodexConfig("spec_review", tasks);
  const activeCwd = getActiveCwd(taskIds);
  const result = await runCodex(specReviewPrompt, interactive, resumeId, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "spec_review",
    iteration: maxSpecIter,
    activeCwd
  }, activeCwd);
  for (const t of tasks) {
    const reviewPath = path15.join(resolveTaskCwd(t.taskId), "tasks", t.taskId, "spec-review.md");
    let reviewContent = null;
    try {
      reviewContent = fs14.readFileSync(reviewPath, "utf8");
    } catch {
    }
    if (isTemplateUnfilled(reviewContent)) {
      warn(`[${t.taskId}] spec-review.md is still the template after spec_review run \u2014 sub-agent did not write it. Resetting to pending for retry.`);
      taskPhase(t.taskId, "spec_review", "pending");
    }
  }
  return { agent: "codex", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/detach.ts
import { spawn as spawn3 } from "child_process";
import fs15 from "fs";
import path16 from "path";
var DETACH_CHILD_FLAG = "CANON_DETACHED";
var DETACH_DISABLE_FLAG = "CANON_NO_DETACH";
var PID_FILENAME = ".canon-pid";
var LOG_FILENAME = ".canon-run.log";
function shouldAutoDetach(options = {}) {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  if (env[DETACH_CHILD_FLAG] === "1") return false;
  if (env[DETACH_DISABLE_FLAG] === "1") return false;
  if (isUnderNodeTestRunner()) return false;
  if (stdout.isTTY) return false;
  return true;
}
function isUnderNodeTestRunner() {
  if (process.execArgv.some((arg) => arg === "--test" || arg === "--test-only")) return true;
  const nodeOpts = process.env.NODE_OPTIONS ?? "";
  if (/\B--test(\b|-only\b)/.test(nodeOpts)) return true;
  return false;
}
function detachAndExit(options) {
  const exit = options.exit ?? ((code) => process.exit(code));
  const stdoutWrite = options.stdoutWrite ?? ((s) => {
    process.stdout.write(s);
  });
  const stderrWrite = options.stderrWrite ?? ((s) => {
    process.stderr.write(s);
  });
  const spawnFn = options.spawnImpl ?? spawn3;
  const execPath = options.execPath ?? process.execPath;
  if (options.taskIds.length === 0) {
    stderrWrite("canon: detachAndExit called with no task IDs (internal bug)\n");
    return exit(1);
  }
  const primaryDir = options.resolveTaskDir(options.taskIds[0]);
  try {
    fs15.mkdirSync(primaryDir, { recursive: true });
  } catch (error) {
    stderrWrite(`canon: cannot create task dir for log file: ${error.message}
`);
    return exit(1);
  }
  const logPath = path16.join(primaryDir, LOG_FILENAME);
  let logFd;
  try {
    logFd = fs15.openSync(logPath, "a");
  } catch (error) {
    stderrWrite(`canon: cannot open ${logPath}: ${error.message}
`);
    return exit(1);
  }
  const args = options.argv.slice(1);
  const child = spawnFn(execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, [DETACH_CHILD_FLAG]: "1" }
  });
  try {
    fs15.closeSync(logFd);
  } catch {
  }
  if (child.pid == null) {
    stderrWrite("canon: detached spawn failed (no PID returned)\n");
    return exit(1);
  }
  const pidWriteFailures = [];
  for (const taskId of options.taskIds) {
    try {
      const dir = options.resolveTaskDir(taskId);
      fs15.mkdirSync(dir, { recursive: true });
      fs15.writeFileSync(path16.join(dir, PID_FILENAME), `${child.pid}
`, "utf8");
    } catch (error) {
      pidWriteFailures.push({
        taskId,
        reason: error.message
      });
    }
  }
  if (pidWriteFailures.length > 0) {
    stderrWrite(
      `canon: warning \u2014 failed to write .canon-pid for ${pidWriteFailures.length} task(s):
`
    );
    for (const failure of pidWriteFailures) {
      stderrWrite(`  - ${failure.taskId}: ${failure.reason}
`);
    }
    stderrWrite(
      `  canon stop <id> will fall back to .heartbeat.json (parent writes the initial record below).
`
    );
  }
  stdoutWrite(
    `
Detached canon run.
  PID:   ${child.pid}
  Tasks: ${options.taskIds.join(", ")}
  Log:   ${logPath}
  Stop:  canon stop ${options.taskIds[0]}
  Watch: tail -f ${logPath}

`
  );
  child.unref();
  return exit(0);
}
function removeCanonPid(taskDir) {
  try {
    fs15.unlinkSync(path16.join(taskDir, PID_FILENAME));
  } catch {
  }
}

// scripts/run-task/main.ts
var REPO_ROOT2 = REPO_ROOT;
var TASKS_DIR2 = TASKS_DIR;
var PHASE_ORDER2 = PHASE_ORDER;
var isPhaseStatus2 = isPhaseStatus;
var isVerdict2 = isVerdict;
var cliArgs = {
  taskIds: [],
  interactive: false,
  step: false,
  expectPhase: null,
  push: false,
  pr: false,
  reroute: false,
  ship: false,
  dryRun: false,
  fullSend: false,
  force: false,
  allowDivergentBase: false
};
var ghAvailable = false;
var lastClaudeSessionId = null;
var lastCodexSessionId = null;
var lastCodexExitStatus = 0;
function classifyMergeOutcome(opts) {
  if (opts.exitOk) return "tolerate";
  if (opts.mergeConfirmed) return "tolerate";
  return "fail";
}
var die2 = die;
var info2 = info;
var warn2 = warn;
var taskDirFor2 = taskDirFor;
var taskDirForRepoRoot2 = taskDirForRepoRoot;
var readStatus2 = readStatus;
var deriveTopLevelStatus2 = deriveTopLevelStatus;
var runCommand2 = runCommand;
var git2 = git;
var gitSafe2 = gitSafe;
var gitSafeAt2 = gitSafeAt;
var gitSafeAtRaw2 = gitSafeAtRaw;
var getBaseBranch2 = getBaseBranch;
function getCurrentPhase(status) {
  return deriveTopLevelStatus2(status);
}
function getPhaseStatus(status, phase) {
  const value = status.phases[phase]?.status;
  return isPhaseStatus2(value) ? value : "pending";
}
function getVerdict(status, phase) {
  const value = status.phases[phase]?.verdict;
  return isVerdict2(value) ? value : "";
}
function getIterations(status) {
  const codeReview = status.phases.code_review;
  return codeReview?.iterations_current_loop ?? codeReview?.iterations ?? 0;
}
function getTitle(status) {
  return status.title ?? "(untitled)";
}
function buildPipelineState(taskIds) {
  const statuses = taskIds.map(readStatus);
  const tier = detectTier2(statuses);
  const tasks = taskIds.map((taskId, i) => {
    const status = statuses[i];
    const codeReview = status.phases.code_review;
    const codeReviewCurrentLoop = codeReview?.iterations_current_loop ?? codeReview?.iterations ?? 0;
    const codeReviewTotal = codeReview?.iterations_total ?? codeReview?.iterations ?? 0;
    return {
      taskId,
      title: getTitle(status),
      specReviewVerdict: getVerdict(status, "spec_review"),
      iterations: codeReviewCurrentLoop,
      iterations_current_loop: codeReviewCurrentLoop,
      iterations_total: codeReviewTotal,
      rerouteCount: status.phases.implement?.reroute_count ?? 0,
      status
    };
  });
  return { tasks, tier, isBundle: taskIds.length > 1 };
}
function assertSamePhase(taskIds) {
  const phases = taskIds.map((id) => getCurrentPhase(readStatus2(id)));
  const unique = new Set(phases);
  if (unique.size > 1) {
    die2(
      `Bundle tasks are at different phases \u2014 cannot proceed.
` + taskIds.map((id, i) => `  ${id}: ${phases[i]}`).join("\n") + `
  Resolve manually then re-run.`
    );
  }
  return phases[0];
}
function appendAutoCommitDebug(taskIds, details) {
  const notesPath = path17.join(taskDirFor2(taskIds[0]), "notes.md");
  try {
    fs16.mkdirSync(path17.dirname(notesPath), { recursive: true });
    fs16.appendFileSync(
      notesPath,
      `
`,
      "utf8"
    );
  } catch {
  }
}
function verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug) {
  const baseRef = getBaseBranch2(taskIds);
  const gitIgnoredHandoffFiles = filterGitIgnoredPaths(handoffFiles, cwd);
  const verifiableHandoffFiles = handoffFiles.filter((f) => !gitIgnoredHandoffFiles.has(f));
  Object.assign(debug, {
    verifyGitIgnoredHandoffFiles: [...gitIgnoredHandoffFiles]
  });
  if (verifiableHandoffFiles.length === 0) {
    appendAutoCommitDebug(taskIds, { ...debug, result: "verify-all-gitignored" });
    return;
  }
  const postStatus = gitSafeAtRaw2(cwd, "status", "--porcelain=v1", "-uall", "--", ...verifiableHandoffFiles);
  const missing = [];
  if (!postStatus.ok) {
    Object.assign(debug, {
      baseRef,
      postCommitStatusOk: postStatus.ok,
      postCommitStatusRaw: postStatus.stdout,
      postCommitStatusError: postStatus.stderr
    });
    appendAutoCommitDebug(taskIds, debug);
    die2(`Auto-commit coverage check failed: could not inspect post-commit status: ${postStatus.stderr || "unknown error"}`);
  }
  const stillDirty = parsePorcelain(postStatus.stdout);
  for (const filePath of verifiableHandoffFiles) {
    if (stillDirty.has(filePath)) {
      missing.push(`${filePath} \u2014 still dirty after auto-commit`);
      continue;
    }
    const committed = gitSafeAt2(cwd, "log", "--format=%H", "--max-count=1", `${baseRef}..HEAD`, "--", filePath);
    if (!committed.ok || !committed.stdout.trim()) {
      missing.push(`${filePath} \u2014 no commit touches this path in ${baseRef}..HEAD`);
    }
  }
  const wtDiff = gitSafeAtRaw2(cwd, "diff", "HEAD", "--name-only", "--", ...verifiableHandoffFiles);
  if (!wtDiff.ok) {
    Object.assign(debug, { wtDiffOk: false, wtDiffError: wtDiff.stderr });
    appendAutoCommitDebug(taskIds, debug);
    die2(`Auto-commit coverage check failed: \`git diff HEAD\` failed: ${wtDiff.stderr || "unknown error"}`);
  }
  if (wtDiff.stdout.trim()) {
    const stillDifferent = wtDiff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    for (const f of stillDifferent) {
      if (missing.some((m) => m.startsWith(`${f} \u2014`))) continue;
      missing.push(`${f} \u2014 working tree differs from HEAD (status reported clean \u2014 silent-omission failure mode)`);
    }
  }
  Object.assign(debug, {
    baseRef,
    postCommitStatusRaw: postStatus.stdout,
    postCommitWtDiffRaw: wtDiff.stdout,
    postCommitMissingCoverage: missing
  });
  if (missing.length > 0) {
    appendAutoCommitDebug(taskIds, debug);
    die2(
      `Auto-commit coverage check failed: handoff.md lists files that are neither committed nor cleanly staged for review.
` + missing.map((m) => `    ${m}`).join("\n") + `
  To recover: \`cd ${cwd} && git diff HEAD\` to inspect, then stage and commit the missing changes manually before code_review.`
    );
  }
}
function isPipelineOwnedPath(filePath, taskIds) {
  if (taskIds.some((id) => filePath === `tasks/${id}` || filePath.startsWith(`tasks/${id}/`))) return true;
  return PIPELINE_TELEMETRY_FILES.includes(filePath);
}
function operatorAcceptedImplement(taskIds, cwd) {
  const allAccepted = taskIds.every((taskId) => {
    const status = readStatus(taskId);
    return status.phases?.implement?.operator_accepted === true;
  });
  if (!allAccepted) return false;
  const head = gitSafeAt(cwd, "rev-parse", "HEAD");
  if (!head.ok) return false;
  const currentSha = head.stdout.trim();
  if (!currentSha) return false;
  const shaMatch = taskIds.every((taskId) => {
    const status = readStatus(taskId);
    const recorded = (status.phases?.implement?.operator_accepted_sha ?? "").trim();
    return recorded !== "" && recorded === currentSha;
  });
  if (!shaMatch) return false;
  const dirty = gitSafeAtRaw(cwd, "status", "--porcelain=v1", "-uall");
  if (!dirty.ok) return false;
  if (dirty.stdout.trim() === "") return true;
  const dirtyPaths = [...parsePorcelain(dirty.stdout)];
  const sourceDirty = dirtyPaths.filter((p) => !isPipelineOwnedPath(p, taskIds));
  return sourceDirty.length === 0;
}
function autoCommitCode(taskIds, cwd = REPO_ROOT2) {
  const primaryStatus = readStatus(taskIds[0]);
  const title = getTitle(primaryStatus);
  if (operatorAcceptedImplement(taskIds, cwd)) {
    info("Auto-commit skipped \u2014 implement phase was operator-accepted (canon task accept) and HEAD still matches the accepted SHA.");
    return;
  }
  const allHandoffFiles = /* @__PURE__ */ new Set();
  const allMalformed = [];
  for (const taskId of taskIds) {
    const { files, malformed } = parseHandoffChangesRows(taskId);
    for (const file of files) allHandoffFiles.add(file);
    for (const entry of malformed) {
      allMalformed.push({ taskId, cell: entry.cell, reason: entry.reason });
    }
  }
  if (allMalformed.length > 0) {
    const lines = allMalformed.map((m) => `    [${m.taskId}] '${m.cell}': ${m.reason}`);
    die(
      `Auto-commit aborted: handoff.md Changes table has malformed rows.
` + lines.join("\n") + `
  Fix each row to one path per line in the form \`path/to/file.ext\` (or [path/to/file.ext](url)),
  then re-run. Combined paths, wildcards, and unfilled \`<placeholder>\` rows are not accepted.`
    );
  }
  if (allHandoffFiles.size === 0) {
    const emptyDebug = { cwd, handoffFiles: [] };
    const dirtyCheck = gitSafeAtRaw(cwd, "status", "--porcelain=v1", "-uall");
    Object.assign(emptyDebug, {
      dirtyStatusOk: dirtyCheck.ok,
      dirtyStatusRaw: dirtyCheck.stdout,
      dirtyStatusError: dirtyCheck.stderr
    });
    if (!dirtyCheck.ok) {
      appendAutoCommitDebug(taskIds, { ...emptyDebug, result: "empty-handoff-dirty-check-failed" });
      die(`Auto-commit aborted: handoff.md Changes table empty AND failed to inspect dirty files: ${dirtyCheck.stderr || "unknown error"}`);
    }
    const allDirty = [...parsePorcelain(dirtyCheck.stdout)];
    const sourceDirty = allDirty.filter((f) => !isPipelineOwnedPath(f, taskIds));
    Object.assign(emptyDebug, { allDirty, sourceDirty });
    if (sourceDirty.length > 0) {
      appendAutoCommitDebug(taskIds, { ...emptyDebug, result: "empty-handoff-but-source-dirty" });
      die(
        `Auto-commit aborted: handoff.md Changes table is empty but the working tree has
  source-file changes outside the pipeline-owned paths.
  This usually means the agent made changes but did not populate the Changes table
  in handoff.md \u2014 or the table format was not recognized by the parser (backtick
  paths and markdown links are both supported as of 2026-05-18).
  Dirty source files (truncated to first 20):
` + sourceDirty.slice(0, 20).map((f) => `    ${f}`).join("\n") + `
  Resolve manually: fix handoff.md or commit/discard the dirty files.`
      );
    }
    appendAutoCommitDebug(taskIds, { ...emptyDebug, result: "empty-handoff-clean-or-pipeline-only" });
    return;
  }
  const handoffFiles = [...allHandoffFiles];
  const debug = {
    cwd,
    handoffFiles
  };
  const dirtyResult = gitSafeAtRaw(cwd, "status", "--porcelain=v1", "-uall");
  Object.assign(debug, {
    dirtyStatusOk: dirtyResult.ok,
    dirtyStatusRaw: dirtyResult.stdout,
    dirtyStatusError: dirtyResult.stderr
  });
  if (!dirtyResult.ok) {
    appendAutoCommitDebug(taskIds, { ...debug, result: "dirty-status-failed" });
    die(`Auto-commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || "unknown error"}`);
  }
  if (!dirtyResult.stdout.trim()) {
    verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
    appendAutoCommitDebug(taskIds, { ...debug, result: "no-uncommitted-changes" });
    info("No uncommitted changes to auto-commit.");
    return;
  }
  const dirtyFiles = parsePorcelain(dirtyResult.stdout);
  const toStage = handoffFiles.filter((f) => dirtyFiles.has(f));
  const gitIgnoredHandoffFiles = filterGitIgnoredPaths(handoffFiles, cwd);
  Object.assign(debug, {
    dirtyFiles: [...dirtyFiles],
    toStage,
    gitIgnoredHandoffFiles: [...gitIgnoredHandoffFiles]
  });
  const missing = [];
  const settledDeletions = /* @__PURE__ */ new Set();
  const baseRefForLog = getBaseBranch(taskIds);
  for (const f of allHandoffFiles) {
    if (dirtyFiles.has(f)) continue;
    if (gitIgnoredHandoffFiles.has(f)) continue;
    const exists = fs16.existsSync(path17.join(cwd, f));
    if (!exists) {
      const committed = gitSafeAt(cwd, "log", "--format=%H", "--max-count=1", `${baseRefForLog}..HEAD`, "--", f);
      if (committed.ok && committed.stdout.trim()) {
        settledDeletions.add(f);
        continue;
      }
      missing.push(`${f} \u2014 listed in handoff but missing from working tree (and no commit in ${baseRefForLog}..HEAD touches this path)`);
      continue;
    }
    const tracked = gitSafeAt2(cwd, "ls-files", "--error-unmatch", "--", f).ok;
    if (!tracked) {
      missing.push(`${f} \u2014 untracked on disk but git status did not report it (report this as a bug)`);
    }
  }
  Object.assign(debug, { settledDeletions: [...settledDeletions] });
  if (missing.length > 0) {
    appendAutoCommitDebug(taskIds, { ...debug, missing });
    die(
      `Auto-commit aborted: handoff.md lists files that can't be staged:
` + missing.map((m) => `    ${m}`).join("\n") + `
  Verify the files exist and fix handoff.md's Changes table, or stage manually.`
    );
  }
  const stagedBefore = gitSafeAt(cwd, "diff", "--cached", "--name-only");
  const stagedBeforeUnexpected = stagedBefore.ok ? findStagedFilesOutsideHandoff(stagedBefore.stdout, allHandoffFiles) : [];
  Object.assign(debug, {
    stagedBeforeOk: stagedBefore.ok,
    stagedBeforeRaw: stagedBefore.stdout,
    stagedBeforeUnexpected
  });
  if (!stagedBefore.ok) {
    appendAutoCommitDebug(taskIds, { ...debug, result: "staged-before-failed" });
    die(`Auto-commit aborted: failed to inspect staged files: ${stagedBefore.stderr || "unknown error"}`);
  }
  if (stagedBeforeUnexpected.length > 0) {
    appendAutoCommitDebug(taskIds, { ...debug, result: "preexisting-staged-outside-handoff" });
    die(
      `Auto-commit aborted: staged files are not covered by handoff.md.
  Staged files:
${stagedBeforeUnexpected.map((f) => `    ${f}`).join("\n")}
  Unstage them or list them in handoff.md before rerunning.`
    );
  }
  if (toStage.length === 0) {
    verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
    appendAutoCommitDebug(taskIds, { ...debug, result: "already-committed-or-unchanged" });
    info("Handoff files are already committed or unchanged \u2014 skipping auto-commit.");
    return;
  }
  const stageable = handoffFiles.filter((f) => !settledDeletions.has(f));
  Object.assign(debug, { stageable });
  if (stageable.length === 0) {
    verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
    appendAutoCommitDebug(taskIds, { ...debug, result: "all-handoff-files-already-settled" });
    info("All handoff files are already settled in history \u2014 skipping auto-commit.");
    return;
  }
  const addResult = gitSafeAt(cwd, "add", "-A", "--", ...stageable);
  Object.assign(debug, {
    addOk: addResult.ok,
    addError: addResult.stderr
  });
  if (!addResult.ok) die2(`Failed to stage files: ${addResult.stderr || "unknown error"}`);
  const preCheck = gitSafeAtRaw(cwd, "status", "--porcelain=v1", "-uall");
  const remaining = preCheck.ok ? findUncoveredTrackedChanges(preCheck.stdout, allHandoffFiles) : [];
  const stagedAfter = gitSafeAt(cwd, "diff", "--cached", "--name-only");
  const stagedAfterUnexpected = stagedAfter.ok ? findStagedFilesOutsideHandoff(stagedAfter.stdout, allHandoffFiles) : [];
  Object.assign(debug, {
    preCheckOk: preCheck.ok,
    preCheckRaw: preCheck.stdout,
    remaining,
    stagedAfterOk: stagedAfter.ok,
    stagedAfterRaw: stagedAfter.stdout,
    stagedAfterUnexpected
  });
  if (!preCheck.ok) {
    gitSafeAt(cwd, "reset", "HEAD", "--", ...handoffFiles);
    appendAutoCommitDebug(taskIds, { ...debug, result: "precheck-failed" });
    die(`Auto-commit aborted: failed to inspect working tree after staging: ${preCheck.stderr || "unknown error"}`);
  }
  if (remaining.length > 0) {
    gitSafeAt(cwd, "reset", "HEAD", "--", ...handoffFiles);
    appendAutoCommitDebug(taskIds, { ...debug, result: "uncovered-source-changes" });
    die(
      `Auto-commit aborted: working tree has source changes not covered by handoff.md.
  Dirty files:
${remaining.map((l) => `    ${l}`).join("\n")}
  Fix handoff.md to list all changed files (including both sides of renames),
  or stage and commit manually.`
    );
  }
  if (!stagedAfter.ok) {
    gitSafeAt(cwd, "reset", "HEAD", "--", ...handoffFiles);
    appendAutoCommitDebug(taskIds, { ...debug, result: "staged-after-failed" });
    die(`Auto-commit aborted: failed to inspect staged files: ${stagedAfter.stderr || "unknown error"}`);
  }
  if (stagedAfterUnexpected.length > 0) {
    gitSafeAt(cwd, "reset", "HEAD", "--", ...handoffFiles);
    appendAutoCommitDebug(taskIds, { ...debug, result: "staged-after-outside-handoff" });
    die(
      `Auto-commit aborted: staged files are not covered by handoff.md.
  Staged files:
${stagedAfterUnexpected.map((f) => `    ${f}`).join("\n")}
  Unstage them or list them in handoff.md before rerunning.`
    );
  }
  if (!stagedAfter.stdout.trim()) {
    verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
    appendAutoCommitDebug(taskIds, { ...debug, result: "nothing-staged-after-add" });
    info("Handoff files are already committed or unchanged \u2014 skipping auto-commit.");
    return;
  }
  const idSuffix = taskIds.length > 1 ? `[${taskIds.join(", ")}]` : `[${taskIds[0]}]`;
  const message = `${title} ${idSuffix}`;
  const commitResult = gitSafeAt(cwd, "commit", "-m", message);
  Object.assign(debug, {
    commitOk: commitResult.ok,
    commitStdout: commitResult.stdout,
    commitError: commitResult.stderr
  });
  if (!commitResult.ok) {
    appendAutoCommitDebug(taskIds, { ...debug, result: "commit-failed" });
    die(`Auto-commit failed: ${commitResult.stderr || "unknown error"}`);
  }
  verifyHandoffFilesCommitted(taskIds, cwd, handoffFiles, debug);
  appendAutoCommitDebug(taskIds, { ...debug, result: "committed" });
  const stagedCount = stagedAfter.stdout.trim().split("\n").filter(Boolean).length;
  info2(`Auto-committed ${stagedCount} file(s): ${message}`);
}
function humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath, affectedPrefixes = /* @__PURE__ */ new Set()) {
  return taskIds.some((taskId) => filePath === `tasks/${taskId}` || filePath.startsWith(`tasks/${taskId}/`)) || PIPELINE_TELEMETRY_FILES.includes(filePath) || affectedManagedDocs.has(filePath) || [...affectedPrefixes].some((prefix) => filePath.startsWith(prefix));
}
function buildHumanReviewStagePaths(taskIds, affectedManagedDocs, dirtyEntries, affectedPrefixes = /* @__PURE__ */ new Set()) {
  const stagePaths = /* @__PURE__ */ new Set();
  for (const taskId of taskIds) {
    if (dirtyEntries.some((entry) => entry.paths.some((pathName) => pathName === `tasks/${taskId}` || pathName.startsWith(`tasks/${taskId}/`)))) {
      stagePaths.add(path17.join("tasks", taskId));
    }
  }
  for (const relPath of PIPELINE_TELEMETRY_FILES) {
    if (dirtyEntries.some((entry) => entry.paths.some((pathName) => pathName === relPath))) {
      stagePaths.add(relPath);
    }
  }
  for (const relPath of affectedManagedDocs) {
    if (dirtyEntries.some((entry) => entry.paths.some((pathName) => pathName === relPath))) {
      stagePaths.add(relPath);
    }
  }
  for (const prefix of affectedPrefixes) {
    if (dirtyEntries.some((entry) => entry.paths.some((pathName) => pathName.startsWith(prefix)))) {
      stagePaths.add(prefix);
    }
  }
  return [...stagePaths];
}
function findPullRequestTemplate(repoRoot) {
  const candidates = [
    path17.join(repoRoot, ".github", "pull_request_template.md"),
    path17.join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE.md"),
    path17.join(repoRoot, "docs", "pull_request_template.md"),
    path17.join(repoRoot, "docs", "PULL_REQUEST_TEMPLATE.md"),
    path17.join(repoRoot, "pull_request_template.md"),
    path17.join(repoRoot, "PULL_REQUEST_TEMPLATE.md")
  ];
  for (const candidate of candidates) {
    if (fs16.existsSync(candidate)) return candidate;
  }
  return null;
}
function resolveCanonPrBody(taskIds, title, env = process.env) {
  const template = env.CANON_PR_BODY;
  if (template === void 0 || template === "") return null;
  const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(", ");
  return template.replaceAll("$LABEL", label).replaceAll("$TITLE", title);
}
function resolveQaPrBody(taskIds, activeCwd) {
  if (taskIds.length !== 1) {
    return { kind: "fallback", reason: "bundle: per-task pr-body.md files are not combined in this version" };
  }
  const prBodyPath = path17.join(activeCwd, "tasks", taskIds[0], "pr-body.md");
  if (!isPrBodyTemplate(prBodyPath)) {
    return { kind: "body-file", path: prBodyPath };
  }
  return {
    kind: "fallback",
    reason: fs16.existsSync(prBodyPath) ? "pr-body.md is still the stub template" : "pr-body.md not found"
  };
}
function createDraftPRForTask(taskIds, branchName) {
  if (!ghAvailable) die2("--pr requires the gh CLI, but it is not available.");
  const baseBranch = getBaseBranch2(taskIds);
  const title = getTitle(readStatus(taskIds[0]));
  const args = [
    "pr",
    "create",
    "--draft",
    "--base",
    baseBranch,
    "--head",
    branchName,
    "--title",
    title
  ];
  const body = resolveCanonPrBody(taskIds, title);
  if (body !== null) {
    args.push("--body", body);
  } else {
    const activeCwd = getActiveCwd(taskIds);
    const qaPrBody = resolveQaPrBody(taskIds, activeCwd);
    if (qaPrBody.kind === "body-file") {
      args.push("--body-file", qaPrBody.path);
      const prResult2 = runCommand("gh", args);
      if (!prResult2.ok) {
        die2(`Failed to create draft PR: ${prResult2.stderr || "unknown error"}`);
      }
      info2(`Draft PR created: ${prResult2.stdout || branchName}`);
      return;
    }
    warn2(`PR body fallback (${qaPrBody.reason}) \u2014 falling back to repo PR template or --fill`);
    const templatePath = findPullRequestTemplate(activeCwd) ?? findPullRequestTemplate(REPO_ROOT2);
    if (templatePath) {
      args.push("--body-file", templatePath);
    } else {
      args.push("--fill");
    }
  }
  const prResult = runCommand("gh", args);
  if (!prResult.ok) {
    die2(`Failed to create draft PR: ${prResult.stderr || "unknown error"}`);
  }
  info2(`Draft PR created: ${prResult.stdout || branchName}`);
}
function formatExistingPRMessage(prNum, prUrl) {
  return `Existing draft PR: #${prNum} (${prUrl})`;
}
function reportOrCreatePR(taskIds, branchName) {
  if (!ghAvailable) die2("--pr requires the gh CLI, but it is not available.");
  const baseBranch = getBaseBranch(taskIds);
  const openPR = findOpenPRNumber(branchName, baseBranch);
  if (openPR !== null) {
    const prUrl = lookupPRUrl(openPR);
    info2(formatExistingPRMessage(openPR, prUrl));
    return;
  }
  createDraftPRForTask(taskIds, branchName);
}
function parseOriginRepoSlug(remoteUrl) {
  const match = remoteUrl.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}
function lookupPRUrl(prNum) {
  if (ghAvailable) {
    const result = runCommand("gh", ["pr", "view", String(prNum), "--json", "url", "--jq", ".url"]);
    if (result.ok && result.stdout.trim()) return result.stdout.trim();
  }
  const remoteResult = runCommand("git", ["remote", "get-url", "origin"]);
  if (remoteResult.ok) {
    const repoSlug = parseOriginRepoSlug(remoteResult.stdout);
    if (repoSlug) return `https://github.com/${repoSlug}/pull/${prNum}`;
  }
  return `(PR #${prNum})`;
}
function formatCompleteStateBanner(taskIds, state) {
  const body = (() => {
    switch (state.kind) {
      case "open_pr":
        return `  Open PR: #${state.prNum} (${state.prUrl})
  Next:    \`canon run ${taskIds.join(" ")} --ship\` to merge + archive.`;
      case "pushed_no_pr":
        return `  Branch ${state.branch} is on origin but no open PR.
  Next:    \`canon run ${taskIds.join(" ")} --pr\` to (re)open the draft PR, or
           \`canon run ${taskIds.join(" ")} --ship\` if the work is already merged to ${state.baseBranch}.`;
      case "unpushed":
        return `  Local branch ${state.branch} is not on origin.
  Next:    \`canon run ${taskIds.join(" ")} --pr\` to push and open a draft PR.
           (For a no-PR flow: merge to ${state.baseBranch} manually, push, then run --ship.)`;
    }
  })();
  return [
    "",
    "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
    "  TASK COMPLETE \u2014 already past human_review.",
    "",
    body,
    "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
    ""
  ].join("\n");
}
function inspectCompleteState(branch, taskIds) {
  const baseBranch = getBaseBranch(taskIds);
  const remoteExists = gitSafeAt2(REPO_ROOT2, "rev-parse", "--verify", `origin/${branch}`).ok;
  if (!remoteExists) {
    return { kind: "unpushed", branch, baseBranch };
  }
  const prNum = ghAvailable ? findOpenPRNumber(branch, baseBranch) : null;
  if (prNum === null) {
    return { kind: "pushed_no_pr", branch, baseBranch };
  }
  const prUrl = lookupPRUrl(prNum);
  return { kind: "open_pr", branch, prNum, prUrl };
}
function printCompleteStateBanner(taskIds) {
  const branches = [...new Set(taskIds.map((id) => resolveTaskBranchName(id)))];
  for (const branch of branches) {
    const tasksOnBranch = taskIds.filter((id) => resolveTaskBranchName(id) === branch);
    const state = inspectCompleteState(branch, tasksOnBranch);
    console.log(formatCompleteStateBanner(tasksOnBranch, state));
  }
}
function enableFullSend(taskIds) {
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    status.full_send = true;
    status.human_spec_gate = false;
    writeStatus(taskId, status);
  }
}
function shouldRunFullSendTail(taskIds) {
  return taskIds.every((taskId) => {
    const status = readStatus(taskId);
    return status.full_send === true && status.phases.qa?.status === "done" && status.phases.human_review?.status === "pending";
  });
}
function commitHumanReviewFiles(taskIds, cwd, createPR) {
  if (createPR) {
    ghAvailable = isCommandAvailable("gh");
  }
  const baseBranch = getBaseBranch(taskIds);
  const baseDivergenceResult = verifyBaseDivergence(baseBranch, cwd);
  if (!baseDivergenceResult.ok) {
    die2(`--pr aborted: git error checking base divergence: ${baseDivergenceResult.stderr || "unknown error"}`);
  } else if (!baseDivergenceResult.fetchFailed && baseDivergenceResult.commits.length > 0) {
    if (!cliArgs.allowDivergentBase) {
      die2(verifyBaseDivergenceFromData(baseDivergenceResult.commits));
    }
    warn2(
      `--allow-divergent-base override: bypassing base-divergence gate. Divergent commits:
` + baseDivergenceResult.commits.map((commit) => `  ${commit.sha.slice(0, 7)}  ${commit.subject}`).join("\n")
    );
  }
  const docsRefsScript = path17.join(REPO_ROOT2, "scripts", "docs-refs-check.mjs");
  if (fs16.existsSync(docsRefsScript)) {
    const docsRefsResult = spawnSync6("node", [docsRefsScript], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    if (docsRefsResult.status !== 0) {
      const docsRefsOutput = (docsRefsResult.stderr ?? "").trim();
      if (cliArgs.force) {
        warn(`--force: docs-refs-check found broken refs (bypassed):
${docsRefsOutput}`);
      } else {
        die(
          `--pr aborted: docs-refs-check found broken refs in task artifacts that would be committed.
${docsRefsOutput}
Fix the references and re-run --pr/--push. Use --force to bypass.`
        );
      }
    }
  }
  const baseDriftResult = verifyBaseDrift(taskIds, baseBranch, cwd);
  if (baseDriftResult.fetchFailed) {
  } else if (baseDriftResult.diffFailed) {
    die2(
      `--pr aborted: could not compute base-drift diff against origin/${baseBranch}.
Git error: ${baseDriftResult.diffError ?? "unknown error"}
This failure cannot be bypassed with --force.`
    );
  } else if (baseDriftResult.drift.length > 0) {
    if (!cliArgs.force) {
      die2(
        `--pr aborted: base-drift detected. Files in the tree diff between origin/${baseBranch}
and HEAD that are not in the spec's Affected Files (and not task-dir/telemetry):
${baseDriftResult.drift.map((filePath) => `  ${filePath}`).join("\n")}
The allowlist is: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, files listed in
your spec's '### Affected Files' table (directory-form entries like 'dist/' match
subpaths), and PIPELINE_MANAGED_DOCS (auto-allowlisted once qa.status = done).
If this is a legitimate task change, add the path to spec.md '### Affected Files'
and rerun. For a rename, list BOTH the old and new paths. If the drift is
unexpected (likely cross-pipeline contamination from a sibling worktree's
managed-doc sync, OR a third-party commit landed on origin/${baseBranch} while
this pipeline was running), recover with one of:
  - rebase onto current origin/${baseBranch} to absorb the base advance:
      git fetch origin ${baseBranch} && git rebase origin/${baseBranch}
  - reset a specific file to base's content if a stray task-branch commit
    introduced it:
      git checkout origin/${baseBranch} -- <path> && git commit -m 'revert drift on <path>'
  - revert the offending task-branch commit entirely:
      git revert <sha>
Bypass with --force if you've verified the drift is intentional.`
      );
    }
    warn2(
      `--force override: base-drift detected; proceeding at user request. Drifted files:
` + baseDriftResult.drift.map((filePath) => `  ${filePath}`).join("\n")
    );
  }
  const affectedManagedDocs = /* @__PURE__ */ new Set();
  const affectedPrefixes = /* @__PURE__ */ new Set();
  for (const taskId of taskIds) {
    const parsed = parseAffectedFilesFromSpec(taskId);
    for (const filePath of parsed.files) {
      if (filePath.endsWith("/")) {
        affectedPrefixes.add(filePath);
      } else if (PIPELINE_MANAGED_DOCS.includes(filePath)) {
        affectedManagedDocs.add(filePath);
      }
    }
    for (const malformed of parsed.malformed) {
      warn2(`${taskId} spec.md Affected Files row malformed: ${malformed.reason}`);
    }
    try {
      if (readStatus(taskId).phases.qa?.status === "done") {
        for (const doc of PIPELINE_MANAGED_DOCS) {
          affectedManagedDocs.add(doc);
        }
      }
    } catch {
    }
  }
  const dirtyResult = gitSafeAtRaw2(cwd, "status", "--porcelain=v1", "-uall");
  if (!dirtyResult.ok) {
    die2(`Human review commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || "unknown error"}`);
  }
  const dirtyEntries = parsePorcelainEntries(dirtyResult.stdout);
  if (dirtyEntries.length === 0 && (createPR || cliArgs.push)) {
    const branchResult2 = gitSafeAt2(cwd, "rev-parse", "--abbrev-ref", "HEAD");
    const branchName2 = branchResult2.ok ? branchResult2.stdout.trim() : "";
    if (branchName2) {
      info2(`Clean tree. Pushing ${branchName2}...`);
      const pushResult2 = gitSafeAt2(cwd, "push", "origin", branchName2);
      if (!pushResult2.ok) {
        die2(`Human review push failed: ${pushResult2.stderr || "unknown error"}`);
      }
      if (createPR) reportOrCreatePR(taskIds, branchName2);
      return;
    }
  }
  if (dirtyEntries.length === 0) {
    die2("Human review commit aborted: no dirty task artifacts, telemetry, or managed docs to commit.");
  }
  const unexpected = dirtyEntries.filter((entry) => !entry.paths.every((pathName) => humanReviewAllowedPath(taskIds, affectedManagedDocs, pathName, affectedPrefixes)));
  if (unexpected.length > 0) {
    die2(
      `Human review commit aborted: working tree has dirty files outside the human_review allowlist.
` + unexpected.map((entry) => `  ${entry.raw}`).join("\n") + `
The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, PIPELINE_MANAGED_DOCS entries listed
in your spec's '### Affected Files' table (directory-form entries like 'dist/' match subpaths),
and all PIPELINE_MANAGED_DOCS once qa.status = done (QA's Docs Freshness auto-allowlist).
If this is a managed doc this task legitimately edits before QA, add it to spec.md '### Affected Files' and rerun.
If this is a source or test file, it should have been committed during the implement phase \u2014 investigate why it is dirty now (unexpected late edits or base-drift/branch contamination are possible causes) and revert with: git checkout HEAD -- <path>`
    );
  }
  const stagePaths = new Set(buildHumanReviewStagePaths(taskIds, affectedManagedDocs, dirtyEntries, affectedPrefixes));
  for (const relPath of stagePaths) {
    if (affectedManagedDocs.has(relPath)) {
      warn2(
        `WARNING: ${relPath} has uncommitted edits and is in PIPELINE_MANAGED_DOCS \u2014 run \`git diff HEAD -- ${relPath}\` to verify these are this task's work before --ship.`
      );
    }
  }
  if (stagePaths.size === 0) {
    die2("Human review commit aborted: no allowed dirty files found to stage.");
  }
  const stagedBefore = gitSafeAt2(cwd, "diff", "--cached", "--name-only");
  if (!stagedBefore.ok) {
    die2(`Human review commit aborted: could not inspect staged files: ${stagedBefore.stderr || "unknown error"}`);
  }
  const stagedBeforeUnexpected = stagedBefore.stdout.split("\n").map((line) => line.trim()).filter(Boolean).filter((filePath) => !humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath, affectedPrefixes));
  if (stagedBeforeUnexpected.length > 0) {
    die2(
      `Human review commit aborted: staged files are not covered by the human_review allowlist.
` + stagedBeforeUnexpected.map((f) => `    ${f}`).join("\n") + `
  Unstage them or list them in the task artifacts before rerunning.`
    );
  }
  for (const relPath of stagePaths) {
    const addResult = gitSafeAt2(cwd, "add", "-A", "--", relPath);
    if (!addResult.ok) {
      die2(`Human review commit aborted: failed to stage ${relPath}: ${addResult.stderr || "unknown error"}`);
    }
  }
  const stagedResult = gitSafeAt2(cwd, "diff", "--cached", "--name-only");
  if (!stagedResult.ok) {
    die2(`Human review commit aborted: could not inspect staged files after add: ${stagedResult.stderr || "unknown error"}`);
  }
  const stagedNames = stagedResult.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (stagedNames.length === 0) {
    die2("Human review commit aborted: staging produced no commit-ready files.");
  }
  const stagedUnexpected = stagedNames.filter((filePath) => !humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath, affectedPrefixes));
  if (stagedUnexpected.length > 0) {
    die2(
      `Human review commit aborted: staged files escaped the allowlist.
` + stagedUnexpected.map((f) => `    ${f}`).join("\n")
    );
  }
  const branchResult = gitSafeAt2(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  if (!branchResult.ok || !branchResult.stdout.trim()) {
    die2(`Human review commit aborted: could not determine the current branch: ${branchResult.stderr || "unknown error"}`);
  }
  const branchName = branchResult.stdout.trim();
  const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(", ");
  const commitMessage = `chore: add task artifacts for ${label}`;
  const commitResult = gitSafeAt2(cwd, "commit", "-m", commitMessage);
  if (!commitResult.ok) {
    die2(`Human review commit aborted: ${commitResult.stderr || "unknown error"}`);
  }
  info2(`Committed human_review artifacts on ${branchName}: ${commitMessage}`);
  info2(`Pushing ${branchName}...`);
  const pushResult = gitSafeAt2(cwd, "push", "origin", branchName);
  if (!pushResult.ok) {
    die2(`Human review push failed: ${pushResult.stderr || "unknown error"}`);
  }
  if (createPR) reportOrCreatePR(taskIds, branchName);
}
function printDryRunPlan(state) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  const currentPhase = assertSamePhase(taskIds);
  info2(`Dry run (${state.tier} tier${state.isBundle ? `, bundle: ${taskIds.join(", ")}` : ""})`);
  if (currentPhase === "complete") {
    info2("No phases remain \u2014 tasks are already complete.");
    return;
  }
  console.log("Planned phases:");
  const currentIdx = PHASE_ORDER2.indexOf(currentPhase);
  for (const phase of PHASE_ORDER2.slice(currentIdx)) {
    if (phase === "human_review") continue;
    if (phase === "spec_review" && state.tier === "fast") continue;
    if (phase === "spec" || phase === "plan" || phase === "code_review" || phase === "qa") {
      const cfg = getClaudeConfig(phase, tasks);
      console.log(`  - ${phase}: Claude / ${cfg.model} / ${cfg.effort}`);
      continue;
    }
    if (phase === "spec_review" || phase === "implement") {
      const cfg = getCodexConfig(phase, tasks);
      console.log(`  - ${phase}: Codex / ${cfg.model} / ${cfg.effort}`);
    }
  }
  console.log("  - human_review: no LLM");
}
function assertLocalBaseInSyncWithOrigin(baseBranch) {
  const fetchResult = gitSafe2("fetch", "origin", baseBranch);
  if (!fetchResult.ok) {
    warn2(
      `Could not fetch origin/${baseBranch} (network unavailable?). Skipping rebase-safety check; verify locally with \`git pull --rebase origin ${baseBranch}\` if you've recently merged the PR.`
    );
    return;
  }
  const behindResult = gitSafe2("rev-list", "--count", `HEAD..origin/${baseBranch}`);
  if (!behindResult.ok) {
    warn2(`Could not check sync with origin/${baseBranch}: ${behindResult.stderr}. Proceeding without check.`);
    return;
  }
  const behind = Number.parseInt(behindResult.stdout, 10);
  if (Number.isNaN(behind) || behind === 0) return;
  die2(
    `Local ${baseBranch} is ${behind} commit${behind === 1 ? "" : "s"} behind origin/${baseBranch}. Rebase before --ship: \`git pull --rebase origin ${baseBranch}\` (or \`canon task post-merge-sync ${baseBranch}\`). The squash merge of the implement-phase PR re-introduces tasks/<id>/ on origin/${baseBranch}; rebasing first ensures --ship consumes the post-merge files instead of leaving a duplicate. See docs/pipeline-orchestrator.md \xA7Shipping & Post-Merge Reconciliation.`
  );
}
function resolveTaskBranchName(taskId) {
  try {
    const recorded = readStatus(taskId).branch;
    if (recorded && recorded.trim()) return recorded.trim();
  } catch {
  }
  return `task/${taskId}`;
}
function assertTaskBranchPushed(taskId) {
  const branchName = resolveTaskBranchName(taskId);
  if (!branchExistsLocally(branchName)) return;
  gitSafe("fetch", "origin", branchName);
  const remoteRefResult = gitSafe("rev-parse", "--verify", `origin/${branchName}`);
  if (!remoteRefResult.ok) {
    warn2(
      `origin/${branchName} not found (${remoteRefResult.stderr.trim() || "unknown"}). Continuing \u2014 assuming the remote branch was deleted by an earlier merge. If you have unpushed work on local ${branchName} you wanted to ship, abort with Ctrl+C and push it now.`
    );
    return;
  }
  const aheadResult = gitSafe("rev-list", "--count", `origin/${branchName}..${branchName}`);
  if (!aheadResult.ok) {
    warn2(`Could not compute ${branchName} vs origin/${branchName} divergence: ${aheadResult.stderr}. Skipping push-verify.`);
    return;
  }
  const ahead = Number.parseInt(aheadResult.stdout.trim(), 10);
  if (Number.isNaN(ahead) || ahead === 0) return;
  const localSha = gitSafe("rev-parse", branchName).stdout.trim();
  const remoteSha = gitSafe("rev-parse", `origin/${branchName}`).stdout.trim();
  die(
    `--ship aborted: local ${branchName} has ${ahead} commit${ahead === 1 ? "" : "s"} not on origin.
  Local HEAD: ${localSha.slice(0, 7)} | origin/${branchName}: ${remoteSha.slice(0, 7)}
  Pushing first prevents work loss \u2014 --ship destroys the local branch after merging the PR,
  so unpushed commits would be unreachable. Push:
    git push origin ${branchName}
  Then re-run --ship.`
  );
}
function assertOriginTaskBranchAbsent(branchName, baseBranch) {
  const lsRemote = gitSafe("ls-remote", "--heads", "origin", `refs/heads/${branchName}`);
  if (!lsRemote.ok) {
    warn2(
      `Could not query origin for ${branchName} (${lsRemote.stderr.trim() || "unknown"}). Skipping origin-branch-absence check \u2014 re-run --ship when network access is restored if you want this verified.`
    );
    return;
  }
  if (!lsRemote.stdout.trim()) return;
  const remoteSha = lsRemote.stdout.trim().split(/\s+/)[0];
  const mergedPrNum = ghAvailable ? findMergedPRNumber(branchName, baseBranch) : null;
  if (mergedPrNum !== null) {
    const prHead = getMergedPRHeadSha(mergedPrNum);
    if (prHead === null) {
    } else if (prHead !== remoteSha) {
      die(
        `--ship aborted: origin/${branchName} is at ${remoteSha.slice(0, 7)} but the merged PR #${mergedPrNum} merged head ${prHead.slice(0, 7)}. New commits were pushed to the branch after the PR merged. Resolve manually \u2014 those commits are not in the merged work.`
      );
    } else {
      info2(
        `origin/${branchName} still exists at ${remoteSha.slice(0, 7)} (matches merged PR #${mergedPrNum} head). Deleting the remote branch \u2014 the merged content is in the base.`
      );
      const del = gitSafe("push", "origin", `--delete`, branchName);
      if (!del.ok) {
        die(
          `--ship aborted: detected merged PR #${mergedPrNum} for ${branchName}, but \`git push origin --delete ${branchName}\` failed: ${del.stderr.trim() || "unknown error"}. Delete the remote branch manually and re-run --ship.`
        );
      }
      return;
    }
  }
  die(
    `--ship aborted: origin/${branchName} still exists at ${remoteSha.slice(0, 7)} but no PR was merged this run.
  Either the remote branch has commits that were never PR'd, or a prior merge
  failed to delete it. Shipping silently would orphan the remote work.
  Resolve manually:
    - If unmerged work: open + merge a PR (gh pr create --base <base> --head ${branchName} ...).
    - If already merged elsewhere: \`git push origin --delete ${branchName}\` and re-run --ship.`
  );
}
function findMergedPRNumber(branch, baseBranch) {
  if (!ghAvailable) return null;
  return findPRNumberExact(branch, baseBranch, "merged");
}
function getMergedPRHeadSha(prNum) {
  if (!ghAvailable) return null;
  const result = runCommand("gh", ["pr", "view", String(prNum), "--json", "headRefOid", "--jq", ".headRefOid"]);
  if (!result.ok) return null;
  const sha = result.stdout.trim();
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return null;
  return sha;
}
function isPRMerged(prNum) {
  if (!ghAvailable) return false;
  const result = runCommand("gh", ["pr", "view", String(prNum), "--json", "state", "--jq", ".state"]);
  return result.ok && result.stdout.trim() === "MERGED";
}
function assertNoOpenPRForTask(branchName, baseBranch) {
  const prNum = findOpenPRNumber(branchName, baseBranch);
  if (prNum !== null) {
    die(
      `--ship aborted: PR #${prNum} is open for ${branchName} but the merge step did not run.
  This can happen during gh transient hiccups. Re-running --ship usually works; if it
  keeps failing, merge the PR manually (gh pr merge ${prNum} --squash --delete-branch)
  and re-run.`
    );
  }
}
function findOpenPRNumber(branch, baseBranch) {
  if (!ghAvailable) return null;
  return findPRNumberExact(branch, baseBranch, "open");
}
function findPRNumberExact(branch, baseBranch, state) {
  if (!ghAvailable) return null;
  const args = ["pr", "list", "--head", branch, "--state", state, "--limit", "1000", "--json", "number,headRefName"];
  if (baseBranch !== null) args.push("--base", baseBranch);
  const result = runCommand("gh", args);
  if (!result.ok || !result.stdout.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const headRefName = entry.headRefName;
    const number = entry.number;
    if (headRefName === branch && typeof number === "number") return number;
  }
  return null;
}
function mergeOpenPRsAndPull(taskIds, baseBranch, branchByTaskId) {
  const branches = [...new Set(taskIds.map((id) => {
    const branchName = branchByTaskId.get(id);
    if (!branchName) die(`Missing pre-switch branch snapshot for task '${id}'.`);
    return branchName;
  }))];
  let anyMerged = false;
  for (const branch of branches) {
    const prNum = findOpenPRNumber(branch, baseBranch);
    if (!prNum) continue;
    info(`Merging PR #${prNum} (${branch} \u2192 ${baseBranch}) via squash...`);
    const result = runCommand("gh", ["pr", "merge", String(prNum), "--squash", "--delete-branch"]);
    const outcome = classifyMergeOutcome({
      exitOk: result.ok,
      mergeConfirmed: result.ok ? true : isPRMerged(prNum)
    });
    if (outcome === "fail") {
      die(`Failed to merge PR #${prNum}: ${result.stderr}`);
    }
    if (!result.ok) {
      warn(`PR #${prNum} merged; branch-delete step failed and was tolerated: ${result.stderr.trim() || "unknown error"}`);
      for (const taskId of taskIds) {
        const branchName = branchByTaskId.get(taskId);
        if (branchName === branch) {
          assertOriginTaskBranchAbsent(branchName, baseBranch);
        }
      }
    } else {
      info(`PR #${prNum} merged.`);
    }
    anyMerged = true;
  }
  if (anyMerged) {
    info(`Pulling ${baseBranch}...`);
    git("pull", "origin", baseBranch);
  }
  return anyMerged;
}
function runPostMergeHook() {
  const hookPath = path17.join(REPO_ROOT2, ".canon/hooks/post-merge.sh");
  if (!fs16.existsSync(hookPath)) return;
  info2("Running .canon/hooks/post-merge.sh...");
  const result = runCommand2("bash", [hookPath]);
  if (!result.ok) {
    warn2(`.canon/hooks/post-merge.sh exited non-zero \u2014 continuing. stderr: ${result.stderr.slice(0, 400)}`);
  }
}
function commitArchiveChanges(taskIds, baseBranch, stagedPaths) {
  for (const p of stagedPaths) gitSafe2("add", "-A", "--", p);
  const staged = gitSafe2("diff", "--cached", "--name-only");
  if (!staged.stdout.trim()) return { committed: false };
  const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(", ");
  const commitResult = gitSafe2("commit", "-m", `chore: archive ${label}`);
  if (!commitResult.ok) {
    return { committed: false, stderr: commitResult.stderr || "unknown error" };
  }
  info2(`Pushing ${baseBranch}...`);
  git2("push", "origin", baseBranch);
  return { committed: true };
}
function rewriteArchivedTaskRefs(taskIds) {
  const targets = [
    path17.join(REPO_ROOT2, "docs", "lessons-learned.md"),
    path17.join(REPO_ROOT2, "docs", "task-quality-log.md")
  ];
  for (const filePath of targets) {
    if (!fs16.existsSync(filePath)) continue;
    let content = fs16.readFileSync(filePath, "utf8");
    let changed = false;
    for (const taskId of taskIds) {
      const stale = `tasks/${taskId}/`;
      const fresh = `tasks/_archive/${taskId}/`;
      if (content.includes(stale)) {
        content = content.replaceAll(stale, fresh);
        changed = true;
      }
    }
    if (changed) {
      fs16.writeFileSync(filePath, content, "utf8");
      info2(`Updated stale task refs in ${path17.relative(REPO_ROOT2, filePath)}.`);
    }
  }
}
function shipTasks(taskIds) {
  for (const taskId of taskIds) {
    const currentPhase = getCurrentPhase(readStatus(taskId));
    if (currentPhase !== "human_review" && currentPhase !== "complete") {
      die(`--ship requires tasks at human_review or complete. '${taskId}' is at: ${currentPhase}`);
    }
  }
  for (const taskId of taskIds) {
    const currentPhase = getCurrentPhase(readStatus(taskId));
    if (currentPhase !== "human_review") continue;
    const taskCwd = getActiveCwd([taskId], { tolerateMissingWorktree: true });
    const tasksRootForGate = process.env.CANON_TASKS_DIR_OVERRIDE ?? path17.join(taskCwd, "tasks");
    const gateResult = checkPhaseGate(
      taskId,
      "human_review",
      void 0,
      tasksRootForGate
    );
    if (!gateResult.ok) {
      die(`--ship aborted for '${taskId}': ${gateResult.reason}`);
    }
  }
  for (const taskId of taskIds) {
    assertTaskBranchPushed(taskId);
  }
  const baseBranch = getBaseBranch(taskIds);
  const taskSnapshots = /* @__PURE__ */ new Map();
  const branchByTaskId = /* @__PURE__ */ new Map();
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    const branch = resolveTaskBranchName(taskId);
    taskSnapshots.set(taskId, {
      branch,
      worktree: status.worktree === true
    });
    branchByTaskId.set(taskId, branch);
  }
  const taskSnapshot = (taskId) => {
    const snapshot = taskSnapshots.get(taskId);
    if (!snapshot) die(`Missing pre-switch ship snapshot for task '${taskId}'.`);
    return snapshot;
  };
  if (taskIds.some((id) => taskSnapshot(id).worktree)) {
    const presentSharedDocs = PIPELINE_SHARED_DOCS.filter((relPath) => fs16.existsSync(path17.join(REPO_ROOT2, relPath)));
    if (presentSharedDocs.length > 0) {
      gitSafe("checkout", "HEAD", "--", ...presentSharedDocs);
    }
  }
  ensureCheckedOutBaseBranch(taskIds);
  const shipBaseDivergenceResult = verifyBaseDivergence(baseBranch, REPO_ROOT2);
  if (!shipBaseDivergenceResult.ok) {
    die(`--ship aborted: git error checking base divergence: ${shipBaseDivergenceResult.stderr || "unknown error"}`);
  } else if (!shipBaseDivergenceResult.fetchFailed && shipBaseDivergenceResult.commits.length > 0) {
    if (!cliArgs.allowDivergentBase) {
      die(verifyBaseDivergenceFromData(shipBaseDivergenceResult.commits));
    }
    warn(
      `--allow-divergent-base override: bypassing base-divergence gate at --ship. Divergent commits:
` + shipBaseDivergenceResult.commits.map((commit) => `  ${commit.sha.slice(0, 7)}  ${commit.subject}`).join("\n")
    );
  }
  const merged = mergeOpenPRsAndPull(taskIds, baseBranch, branchByTaskId);
  if (!merged) {
    assertLocalBaseInSyncWithOrigin(baseBranch);
    for (const taskId of taskIds) assertNoOpenPRForTask(taskSnapshot(taskId).branch, baseBranch);
    for (const taskId of taskIds) assertOriginTaskBranchAbsent(taskSnapshot(taskId).branch, baseBranch);
  }
  runPostMergeHook();
  const archiveDir = path17.join(TASKS_DIR2, "_archive");
  if (!fs16.existsSync(archiveDir)) fs16.mkdirSync(archiveDir, { recursive: true });
  const localBranchesToDelete = [];
  for (const taskId of taskIds) {
    const { worktree: hasWorktree } = taskSnapshot(taskId);
    const status = readStatus(taskId);
    if (hasWorktree) teardownWorktree(taskId);
    status.updated = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const humanReview = status.phases.human_review;
    if (humanReview) humanReview.status = "done";
    writeStatusToFile(path17.join(REPO_ROOT2, "tasks", taskId, "status.json"), status);
    const src = taskDirForRepoRoot2(taskId);
    const dest = path17.join(archiveDir, taskId);
    fs16.renameSync(src, dest);
    info2(`\u{1F4E6} ${taskId} \u2192 tasks/_archive/${taskId}`);
    const branchName = taskSnapshot(taskId).branch;
    if (branchExistsLocally(branchName)) localBranchesToDelete.push(branchName);
  }
  rewriteArchivedTaskRefs(taskIds);
  const stagedPaths = taskIds.flatMap((id) => [
    path17.join(TASKS_DIR2, id),
    // deleted source (if not cleaned up)
    path17.join(TASKS_DIR2, "_archive", id),
    // new archive destination
    path17.join(REPO_ROOT2, "docs", "lessons-learned.md"),
    path17.join(REPO_ROOT2, "docs", "task-quality-log.md")
  ]);
  const archiveCommit = commitArchiveChanges(taskIds, baseBranch, stagedPaths);
  if (archiveCommit.stderr) {
    die2(`--ship aborted: failed to commit archive changes: ${archiveCommit.stderr}`);
  }
  for (const branch of localBranchesToDelete) {
    const result = gitSafe("branch", "-D", branch);
    if (result.ok) info2(`Deleted local branch ${branch}.`);
    else warn2(`Could not delete local branch ${branch}: ${result.stderr}`);
  }
  info2(`Shipped ${taskIds.length} task${taskIds.length > 1 ? "s" : ""} to _archive/.`);
  process.exit(0);
}
function rerouteFromHumanReview(taskIds) {
  for (const taskId of taskIds) {
    const currentPhase = getCurrentPhase(readStatus(taskId));
    if (currentPhase !== "human_review") {
      die(`--reroute requires all tasks to be at human_review. '${taskId}' is at: ${currentPhase}`);
    }
  }
  const amendmentFailures = [];
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    const requiredRound = (status.phases.implement?.reroute_count ?? 0) + 1;
    const result = verifyRerouteAmendment(taskId, requiredRound);
    if (!result.amended) {
      amendmentFailures.push({
        taskId,
        specPath: path17.join(taskDirFor2(taskId), "spec.md"),
        requiredRound,
        expectedHeading: requiredRound === 1 ? "## Amendment" : `## Amendment Round ${requiredRound}`,
        reason: result.reason
      });
    }
  }
  if (amendmentFailures.length > 0) {
    if (!cliArgs.force) {
      die2(
        `--reroute aborted: spec.md amendment required before reroute.
` + amendmentFailures.map(
          (failure) => [
            `  ${failure.taskId}: ${failure.specPath}`,
            `    required round: ${failure.requiredRound}`,
            `    expected heading: ${failure.expectedHeading}`,
            `    reason: ${failure.reason}`
          ].join("\n")
        ).join("\n") + `
  Bypass with --force if you have verified the lack of amendment is intentional.
  See docs/pipeline-orchestrator.md \xA7 Human Reroute for the contract.`
      );
    }
    for (const failure of amendmentFailures) {
      warn2(
        `--force bypass: ${failure.taskId} spec.md missing required ${failure.expectedHeading} heading for round ${failure.requiredRound}; Codex will re-implement against the existing spec.`
      );
    }
  }
  const rerouteStatuses = taskIds.map(readStatus);
  const reroutableTier = detectTier2(rerouteStatuses);
  const isFullTierReroute = reroutableTier === "full";
  info(isFullTierReroute ? "Rerouting: human_review \u2192 spec_review (resetting spec_review, plan, implement, code_review, qa)" : "Rerouting: human_review \u2192 implement (resetting implement, code_review, qa)");
  let clearedFullSend = false;
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    status.updated = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const implement = status.phases.implement;
    if (implement) {
      implement.status = "pending";
      implement.rerouted = true;
      implement.reroute_count = (implement.reroute_count ?? 0) + 1;
      clearImplementOperatorAcceptance(implement);
    }
    const codeReview = status.phases.code_review;
    if (codeReview) {
      codeReview.status = "pending";
      codeReview.verdict = "";
      codeReview.iterations_current_loop = 0;
      codeReview.iterations = 0;
      codeReview.preflight_rejections_current_loop = 0;
    }
    const qa = status.phases.qa;
    if (qa) qa.status = "pending";
    const humanReview = status.phases.human_review;
    if (humanReview) humanReview.status = "pending";
    if (isFullTierReroute) {
      const specReview = status.phases.spec_review;
      if (specReview) {
        specReview.status = "pending";
        specReview.verdict = "";
        specReview.iterations_current_loop = 0;
        specReview.iterations = 0;
      }
      const plan = status.phases.plan;
      if (plan) plan.status = "pending";
      if (status.sessions) {
        delete status.sessions.codex_spec_review;
      }
    }
    if (status.full_send === true) {
      status.full_send = false;
      clearedFullSend = true;
    }
    writeStatus(taskId, status);
  }
  if (isFullTierReroute) {
    info("Status reset. Pipeline will resume from spec_review, then plan, then implement.");
    info("Stepped reroute now expects spec_review: use --step --expect spec_review.");
  } else {
    info("Status reset. Pipeline will resume from implement phase with amended-spec context.");
    info("Note: Codex will re-read spec.md carefully (looking for new Amendment sections) and update the implementation.");
  }
  info("");
  if (clearedFullSend) {
    info("\u26A0 full_send cleared. Reroutes indicate the prior result needed correction; re-engage at human_review to verify the fix before another PR opens. Re-enable with 'canon run --full-send <id>' if you're confident.");
  }
  info("\u26A0  Before invoking the pipeline: ensure tasks/<id>/spec.md in the active task directory has an");
  info("   Amendment section with the new requirements. For worktree-backed tasks, edit the worktree copy;");
  info("   edit REPO_ROOT only before a worktree exists. review.md alone is not sufficient \u2014 Codex reads spec.md as the contract.");
}
function clearImplementOperatorAcceptance(implement) {
  if (!implement) return;
  delete implement.operator_accepted;
  delete implement.operator_accepted_sha;
  delete implement.operator_accepted_at;
}
function routeBackTo(taskIds, targetPhase) {
  const targetIdx = PHASE_ORDER2.indexOf(targetPhase);
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    if (targetIdx <= PHASE_ORDER2.indexOf("implement")) {
      clearImplementOperatorAcceptance(status.phases.implement);
    }
    for (let i = targetIdx; i < PHASE_ORDER2.length; i += 1) {
      const phaseEntry = status.phases[PHASE_ORDER2[i]];
      if (phaseEntry) phaseEntry.status = "pending";
    }
    writeStatus(taskId, status);
  }
}
async function runPhase(phase, state) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  const specClaudeSession = getStoredSessionId(taskIds, "claude_spec");
  const reviewClaudeSession = getStoredSessionId(taskIds, "claude_review");
  const codexSpecReviewSession = getStoredSessionId(taskIds, "codex_spec_review");
  const codexSession = getStoredSessionId(taskIds, "codex");
  if (phase === "spec") {
    return runSpecPhase(state, cliArgs.interactive, specClaudeSession);
  }
  if (phase === "spec_review") {
    return runSpecReviewPhase(state, cliArgs.interactive, codexSpecReviewSession);
  }
  if (phase === "plan") {
    return runPlanPhase(state, cliArgs.interactive);
  }
  if (phase === "implement") {
    return runImplementPhase(state, cliArgs.interactive, codexSession, cliArgs.force);
  }
  if (phase === "code_review") {
    return runCodeReviewPhase(state, cliArgs.interactive, reviewClaudeSession);
  }
  if (phase === "qa") {
    const activeCwd = getActiveCwd(taskIds);
    const qaTemplatePath = findPullRequestTemplate(activeCwd) ?? findPullRequestTemplate(REPO_ROOT2);
    const resolvedPrTemplate = qaTemplatePath ? fs16.readFileSync(qaTemplatePath, "utf8") : null;
    return runQaPhase(state, cliArgs.interactive, resolvedPrTemplate);
  }
  if (phase === "human_review") {
    const taskIds2 = tasks.map((t) => t.taskId);
    if (shouldRunFullSendTail(taskIds2)) {
      const branches = new Set(taskIds2.map((id) => resolveTaskBranchName(id)));
      if (branches.size !== 1) {
        die2(
          `Full-send tail aborted: bundle spans multiple branches (${[...branches].join(", ")}). Today's --pr flow operates on one branch per invocation; multi-branch full-send is out of scope. Run each branch's tasks as a separate invocation.`
        );
      }
      const branch = [...branches][0];
      const cwd = getActiveCwd(taskIds2);
      const tasksRootForGate = process.env.CANON_TASKS_DIR_OVERRIDE ?? path17.join(cwd, "tasks");
      for (const taskId of taskIds2) {
        const gateResult = checkPhaseGate(taskId, "human_review", void 0, tasksRootForGate);
        if (!gateResult.ok) {
          die2(gateResult.reason);
        }
      }
      commitHumanReviewFiles(taskIds2, cwd, true);
      for (const taskId of taskIds2) {
        const status = readStatus(taskId);
        if (status.phases.human_review) {
          status.phases.human_review.status = "done";
        }
        writeStatus(taskId, status);
      }
      const completeState = inspectCompleteState(branch, taskIds2);
      let prUrl = "(PR URL unavailable \u2014 check GitHub)";
      if (completeState.kind === "open_pr") {
        prUrl = completeState.prUrl;
      } else {
        warn2(`Full-send: PR URL unavailable for branch ${branch}; expected open PR after --pr step`);
      }
      console.log("");
      console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
      console.log("  \u2705 FULL-SEND COMPLETE \u2014 draft PR open.");
      console.log("");
      console.log(`  PR: ${prUrl}`);
      console.log("");
      console.log(`  Merge at your discretion via \`canon run ${taskIds2.join(" ")} --ship\`,`);
      console.log("  or via GitHub once the PR is marked ready.");
      console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
      console.log("");
      process.exit(0);
    }
    if (cliArgs.push || cliArgs.pr) {
      const cwd = getActiveCwd(taskIds2);
      commitHumanReviewFiles(taskIds2, cwd, cliArgs.pr);
      process.exit(0);
    }
    console.log("");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log("  HUMAN REVIEW \u2014 no push requested.");
    console.log("");
    console.log("  Done files:");
    for (const taskId of taskIds2) {
      console.log(`  tasks/${taskId}/done.md`);
    }
    console.log("");
    console.log("  Re-run with --push to commit task artifacts and push, or --pr to also create a draft PR.");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log("");
    process.exit(0);
  }
  if (phase === "complete") {
    const taskIds2 = tasks.map((t) => t.taskId);
    if (cliArgs.push || cliArgs.pr) {
      const cwd = getActiveCwd(taskIds2);
      commitHumanReviewFiles(taskIds2, cwd, cliArgs.pr);
      process.exit(0);
    }
    printCompleteStateBanner(taskIds2);
    process.exit(0);
  }
  die2(`Unknown phase: ${String(phase)}`);
}
var extractCheckedVerdict2 = extractCheckedVerdict;
function readArtifact(taskId, name) {
  const p = path17.join(taskDirFor2(taskId), name);
  try {
    return fs16.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
function tryEvidenceAdvance(taskId, phase) {
  switch (phase) {
    case "implement": {
      const { files, malformed } = parseHandoffChangesRows(taskId);
      if (files.length === 0 && malformed.length === 0) {
        return { advanced: false, note: "handoff.md Changes table is empty" };
      }
      if (malformed.length > 0) {
        const sample = malformed.slice(0, 3).map((m) => `'${m.cell}': ${m.reason}`).join("; ");
        const tail = malformed.length > 3 ? ` (+${malformed.length - 3} more)` : "";
        return { advanced: false, note: `handoff.md Changes table has malformed row(s): ${sample}${tail}` };
      }
      const issues = validateHandoffAgainstSpec(
        path17.join(taskDirFor2(taskId), "spec.md"),
        path17.join(taskDirFor2(taskId), "handoff.md")
      );
      if (issues.length > 0) return { advanced: false, note: `handoff.md validation failed: ${issues.join("; ")}` };
      const checkRoots = [REPO_ROOT2];
      const sForEvidence = readStatus(taskId);
      if (sForEvidence.worktree === true) {
        const wt = worktreePath(taskId);
        if (fs16.existsSync(wt)) checkRoots.push(wt);
      }
      const ignoreCwd = checkRoots[checkRoots.length - 1];
      const gitIgnored = filterGitIgnoredPaths(files, ignoreCwd);
      const verifiableFiles = files.filter((f) => !gitIgnored.has(f));
      if (verifiableFiles.length === 0) {
        return {
          advanced: false,
          note: `handoff.md lists ${files.length} file(s) but all are gitignored \u2014 at least one tracked source file is required as evidence`
        };
      }
      const existingFiles = verifiableFiles.filter(
        (f) => checkRoots.some((root) => fs16.existsSync(path17.join(root, f)))
      );
      if (existingFiles.length === 0) {
        return { advanced: false, note: `handoff.md lists ${files.length} file(s) but none exist on disk` };
      }
      taskPhase(taskId, "implement", "done");
      return { advanced: true, note: `handoff.md lists ${files.length} file(s) (${existingFiles.length} verified on disk, ${gitIgnored.size} gitignored), validation clean` };
    }
    case "code_review": {
      const content = readArtifact(taskId, "review.md");
      if (isTemplateUnfilled(content)) return { advanced: false, note: "review.md is missing or still the template" };
      const verdict = extractCheckedVerdict2(content);
      if (!verdict) return { advanced: false, note: "no verdict box checked in review.md" };
      taskPhase(taskId, "code_review", "done", verdict);
      return { advanced: true, verdict, note: `verdict=${verdict}` };
    }
    case "spec_review": {
      const content = readArtifact(taskId, "spec-review.md");
      if (isTemplateUnfilled(content)) return { advanced: false, note: "spec-review.md is missing or still the template" };
      let sSR;
      try {
        sSR = readStatus(taskId);
      } catch {
        return { advanced: false, note: "spec_review: status.json unreadable \u2014 cannot evaluate reroute evidence" };
      }
      const ev = checkRerouteEvidence("spec_review", content, sSR);
      if (ev.reroute) {
        if (!ev.ok) return { advanced: false, note: `reroute spec_review: ${ev.reason}` };
        taskPhase(taskId, "spec_review", "done", ev.verdict);
        return { advanced: true, verdict: ev.verdict, note: `verdict=${ev.verdict} (reroute amendment review)` };
      }
      const verdict = extractCheckedVerdict2(content);
      if (!verdict) return { advanced: false, note: "no verdict box checked in spec-review.md" };
      taskPhase(taskId, "spec_review", "done", verdict);
      return { advanced: true, verdict, note: `verdict=${verdict}` };
    }
    case "plan": {
      const content = readArtifact(taskId, "plan.md");
      if (isTemplateUnfilled(content)) return { advanced: false, note: "plan.md is missing or still the template" };
      let sPlan;
      try {
        sPlan = readStatus(taskId);
      } catch {
        return { advanced: false, note: "plan: status.json unreadable \u2014 cannot evaluate reroute evidence" };
      }
      const ev = checkRerouteEvidence("plan", content, sPlan);
      if (ev.reroute && !ev.ok) return { advanced: false, note: `reroute plan: ${ev.reason}` };
      taskPhase(taskId, "plan", "done");
      return { advanced: true, note: "plan.md is populated" };
    }
    case "spec": {
      const content = readArtifact(taskId, "spec.md");
      if (isTemplateUnfilled(content)) return { advanced: false, note: "spec.md is missing or still the template" };
      taskPhase(taskId, "spec", "done");
      return { advanced: true, note: "spec.md is populated" };
    }
    case "qa": {
      const donePath = path17.join(taskDirFor(taskId), "done.md");
      if (isDoneMdTemplate(donePath)) return { advanced: false, note: "done.md is still the template" };
      taskPhase(taskId, "qa", "done");
      return { advanced: true, note: "done.md is populated" };
    }
    default:
      return { advanced: false, note: `phase '${phase}' has no evidence rule` };
  }
}
async function retryAgentForPhase(taskId, phase, evidenceNote) {
  const status = readStatus(taskId);
  const agent = status.phases[phase]?.agent;
  if (!agent || agent !== "codex" && agent !== "claude") return "no_session";
  const slot = agent === "codex" ? phase === "spec_review" ? "codex_spec_review" : "codex" : phase === "spec" ? "claude_spec" : phase === "code_review" ? "claude_review" : null;
  const sessionId = slot ? status.sessions?.[slot] ?? null : null;
  if (!sessionId) {
    warn2(`Cannot retry ${phase} for ${taskId}: no ${agent} session ID stored.`);
    return "no_session";
  }
  const verdictHint = phase === "spec_review" || phase === "code_review" ? " <verdict>" : "";
  const prompt = [
    `PIPELINE GUARDRAIL: phases.${phase}.status for task ${taskId} is still '${getPhaseStatus(status, phase)}'.`,
    `Evidence check: ${evidenceNote}.`,
    "",
    "Your previous turn ended without completing the phase. Finish the work now (write the artifact if missing, commit if needed), then run:",
    `  canon task phase ${taskId} ${phase} done${verdictHint}`,
    "",
    "Reply with tool calls only. No summary, no explanation."
  ].join("\n");
  warn2(`Retrying ${agent} session ${sessionId.slice(0, 8)}... for ${taskId} ${phase}.`);
  const isWorktreePhase = phase === "implement" || phase === "code_review" || phase === "spec_review" && status.phases.implement?.rerouted === true;
  const retryCwd = isWorktreePhase ? getActiveCwd([taskId]) : REPO_ROOT2;
  if (agent === "codex") {
    if (phase !== "spec_review" && phase !== "implement") {
      warn2(`Cannot retry ${phase} with Codex \u2014 not a Codex-run phase.`);
      return "no_session";
    }
    const retryTasks = [{
      taskId,
      title: status.title ?? taskId,
      specReviewVerdict: "",
      iterations: 0,
      iterations_current_loop: 0,
      iterations_total: 0,
      rerouteCount: 0,
      status
    }];
    const cfg = getCodexConfig(phase, retryTasks);
    await runCodex(prompt, false, sessionId, cfg.model, cfg.effort, void 0, retryCwd);
  } else {
    if (phase !== "spec" && phase !== "plan" && phase !== "code_review" && phase !== "qa") {
      warn2(`Cannot retry ${phase} with Claude \u2014 not a Claude-run phase.`);
      return "no_session";
    }
    const retryTasks = [{
      taskId,
      title: status.title ?? taskId,
      specReviewVerdict: "",
      iterations: 0,
      iterations_current_loop: 0,
      iterations_total: 0,
      rerouteCount: 0,
      status
    }];
    const cfg = getClaudeConfig(phase, retryTasks);
    await runClaude(prompt, false, sessionId, cfg.model, cfg.effort, void 0, retryCwd);
  }
  return getPhaseStatus(readStatus(taskId), phase) === "done" ? "done" : "drift";
}
async function recoverPhaseForTask(taskId, phase, initialStatus) {
  const evidence = tryEvidenceAdvance(taskId, phase);
  if (evidence.advanced) {
    warn2(`Auto-advanced '${phase}' for '${taskId}' (was ${initialStatus}; ${evidence.note}). Agent skipped canon task bookkeeping.`);
    return true;
  }
  warn2(`Evidence insufficient for '${taskId}' ${phase}: ${evidence.note}. Attempting one-shot retry.`);
  const retry = await retryAgentForPhase(taskId, phase, evidence.note);
  if (retry === "no_session") return false;
  if (retry === "done") {
    warn2(`Retry succeeded \u2014 '${taskId}' ${phase} is now done.`);
    return true;
  }
  const postEvidence = tryEvidenceAdvance(taskId, phase);
  if (postEvidence.advanced) {
    warn2(`Retry produced artifact \u2014 auto-advanced (${postEvidence.note}).`);
    return true;
  }
  warn2(`Retry did not recover '${taskId}' ${phase} (${postEvidence.note}).`);
  return false;
}
async function checkAndRoute(phase, taskIds) {
  let statuses = taskIds.map(readStatus);
  for (let i = 0; i < taskIds.length; i += 1) {
    const phaseStatus = getPhaseStatus(statuses[i], phase);
    if (phaseStatus !== "done") {
      if (lastCodexExitStatus !== 0) {
        warn2(`Codex exited with status ${lastCodexExitStatus} and '${phase}' was not completed for '${taskIds[i]}'.`);
      }
      const recovered = await recoverPhaseForTask(taskIds[i], phase, phaseStatus);
      if (!recovered) {
        warn2(`Phase '${phase}' did not reach 'done' for '${taskIds[i]}'. Stopping for human review.`);
        process.exit(2);
      }
    }
  }
  statuses = taskIds.map(readStatus);
  if (lastCodexExitStatus !== 0) {
    warn2(`Phase '${phase}' completed despite Codex exit status ${lastCodexExitStatus} (likely MCP warnings). Continuing.`);
    lastCodexExitStatus = 0;
  }
  switch (phase) {
    case "spec_review": {
      const anyChangesRequested = statuses.some((s) => getVerdict(s, "spec_review") === "changes_requested");
      const isRerouteInProgress = statuses.some((s) => s.phases.implement?.rerouted === true);
      if (isRerouteInProgress && anyChangesRequested) {
        for (const taskId of taskIds) {
          const s = readStatus(taskId);
          const specReview = s.phases.spec_review;
          if (specReview) {
            specReview.status = "pending";
            specReview.verdict = "";
          }
          writeStatus(taskId, s);
        }
        const rejectedIds = taskIds.filter(
          (_, index) => getVerdict(statuses[index], "spec_review") === "changes_requested"
        );
        console.log("");
        console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        console.log("  \u270B  AMENDMENT REVIEW \u2014 Changes requested.");
        console.log("");
        console.log("  Revise the amendment in these files:");
        for (const taskId of rejectedIds) {
          console.log(`    tasks/${taskId}/spec.md`);
          console.log(`    tasks/${taskId}/spec-review.md  \u2190 review findings`);
        }
        console.log("");
        console.log("  After revising, re-run the normal pipeline command (NOT --reroute):");
        console.log(`  canon run ${taskIds.join(" ")}`);
        console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        console.log("");
        process.exit(0);
      }
      if (anyChangesRequested) {
        info2("Spec review requested changes \u2014 routing back to spec.");
        routeBackTo(taskIds, "spec");
        return;
      }
      const tier = detectTier2(statuses);
      const allFullSend = statuses.every((s) => s.full_send === true);
      if (tier === "full" && statuses.some((s) => s.human_spec_gate) && !allFullSend) {
        for (const taskId of taskIds) {
          const s = readStatus(taskId);
          s.human_spec_gate = false;
          writeStatus(taskId, s);
        }
        const specList = taskIds.map((id) => `  tasks/${id}/spec.md`).join("\n");
        const reviewList = taskIds.map((id) => `  tasks/${id}/spec-review.md`).join("\n");
        console.log("");
        console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        console.log("  \u270B  SPEC GATE \u2014 Human review required before planning.");
        console.log("");
        console.log("  Specs:");
        console.log(specList);
        console.log("  Codex reviews:");
        console.log(reviewList);
        console.log("");
        console.log(`  When ready: canon run ${taskIds.join(" ")}`);
        console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        console.log("");
        process.exit(0);
      }
      return;
    }
    case "implement":
      autoCommitCode(taskIds, getActiveCwd(taskIds));
      return;
    case "code_review": {
      const specGapIds = taskIds.filter((_, index) => getVerdict(statuses[index], "code_review") === "spec_gap");
      if (specGapIds.length > 0) {
        const maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0);
        const reason = `Code review surfaced a spec_gap verdict for task(s): ${specGapIds.join(", ")}. The implementation cannot resolve this because the root cause is the spec. Review tasks/<id>/review.md for the specific spec problem, amend the spec, reset code_review to pending, and re-run.`;
        console.log("");
        console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        console.log("  \u270B  SPEC GAP \u2014 Code review surfaced a spec problem.");
        console.log("");
        console.log("  The code review found a problem in the spec, not a fixable");
        console.log("  implementation bug. Review the findings:");
        for (const id of specGapIds) console.log(`    tasks/${id}/review.md`);
        console.log("");
        console.log("  To resume after human triage:");
        for (const id of specGapIds) {
          console.log(`    # Amend tasks/${id}/spec.md`);
          console.log(`    canon task phase ${id} code_review pending`);
        }
        console.log(`    canon run ${taskIds.join(" ")}`);
        console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        console.log("");
        autoBlockPhase(taskIds, "code_review", maxIter, reason);
        process.exit(2);
      }
      const anyChangesRequested = statuses.some(
        (s) => getVerdict(s, "code_review") === "changes_requested" || getVerdict(s, "code_review") === "needs_re_review"
      );
      if (anyChangesRequested) {
        const maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0);
        info2(`Code review requested changes (iteration ${maxIter}) \u2014 routing back to implement`);
        routeBackTo(taskIds, "implement");
      }
      return;
    }
    default:
      return;
  }
}
function checkDeps(taskIds, skipAgentDeps = false) {
  if (!skipAgentDeps) {
    for (const dep of ["claude", "codex"]) {
      const result = spawnSync6("which", [dep], { stdio: "ignore" });
      if (result.error || result.status !== 0) {
        const label = dep === "claude" ? "Claude Code CLI" : dep === "codex" ? "Codex CLI" : dep;
        die(`${label} is required`);
      }
    }
  }
  ghAvailable = isCommandAvailable("gh");
  if (!skipAgentDeps) {
    info(ghAvailable ? "gh CLI found \u2014 draft PR creation is available." : "gh CLI not found \u2014 PR creation will be unavailable. Push still works.");
  }
  for (const taskId of taskIds) {
    validateTaskId(taskId);
    if (!fs16.existsSync(statusFileFor(taskId))) {
      die(`No status.json at tasks/${taskId}/status.json \u2014 run canon task new ${taskId} first`);
    }
  }
}
function bootHeartbeatWithHooks(taskIds, resolveTaskDir) {
  process.on("exit", () => stopAllHeartbeats());
  registerShutdownHook(stopAllHeartbeats);
  const cleanupCanonPids = () => {
    for (const id of taskIds) {
      try {
        removeCanonPid(resolveTaskDir(id));
      } catch {
      }
    }
  };
  process.on("exit", cleanupCanonPids);
  registerShutdownHook(cleanupCanonPids);
  startHeartbeat(taskIds, resolveTaskDir);
}
async function main() {
  process.env.RUN_TASK_ORCHESTRATOR = "1";
  cliArgs = parseArgs(process.argv.slice(2));
  warnLegacyEnvVars();
  warnWorktreesRootMismatch();
  const skipAgentDeps = cliArgs.ship || cliArgs.dryRun;
  checkDeps(cliArgs.taskIds, skipAgentDeps);
  const earlyHeartbeatTaskIds = cliArgs.taskIds;
  let heartbeatStarted = false;
  const earlyHeartbeatResolver = (id) => path17.dirname(statusFileFor(id));
  if (process.env.CANON_DETACHED === "1" && earlyHeartbeatTaskIds.length > 0) {
    bootHeartbeatWithHooks(earlyHeartbeatTaskIds, earlyHeartbeatResolver);
    heartbeatStarted = true;
  }
  if (cliArgs.dryRun) {
    const state = buildPipelineState(cliArgs.taskIds);
    printDryRunPlan(state);
    process.exit(0);
  }
  if (cliArgs.pr && !ghAvailable) {
    die2("--pr requires the gh CLI, but it is not available.");
  }
  if (cliArgs.ship) {
    shipTasks(cliArgs.taskIds);
  }
  if (cliArgs.reroute) {
    rerouteFromHumanReview(cliArgs.taskIds);
  }
  const { taskIds } = cliArgs;
  if (cliArgs.fullSend) {
    enableFullSend(taskIds);
  }
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    if (status.full_send === true && status.delicate === true && !cliArgs.force) {
      die2(`--full-send on delicate task '${taskId}' requires --force. Canon's full-model review chains still run on delicate tasks under full-send, but the combination is a high-commitment stance. Re-run with --force to acknowledge.`);
    }
  }
  refreshCanonSnapshotsAtPaths(taskIds.map(statusFileFor));
  const initialState = buildPipelineState(taskIds);
  const heartbeatDirResolver = (id) => path17.dirname(statusFileFor(id));
  const isSynchronousMode = cliArgs.pr || cliArgs.push || cliArgs.reroute || cliArgs.ship || cliArgs.step || cliArgs.expectPhase != null;
  if (!isSynchronousMode && shouldAutoDetach()) {
    detachAndExit({
      taskIds,
      resolveTaskDir: heartbeatDirResolver,
      argv: process.argv
    });
  }
  if (!heartbeatStarted) {
    bootHeartbeatWithHooks(taskIds, heartbeatDirResolver);
    heartbeatStarted = true;
  }
  info2(initialState.isBundle ? `Pipeline (bundle, ${initialState.tier} tier): ${taskIds.join(", ")}` : `Pipeline (${initialState.tier} tier): ${taskIds[0]} \u2014 ${initialState.tasks[0].title}`);
  console.log("");
  let expectChecked = false;
  while (true) {
    const currentPhase = assertSamePhase(taskIds);
    if (!expectChecked && cliArgs.expectPhase) {
      if (currentPhase !== cliArgs.expectPhase) {
        die2(`--expect ${cliArgs.expectPhase} but current phase is ${currentPhase}`);
      }
      expectChecked = true;
    }
    console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    info2(`Current phase: ${currentPhase}`);
    console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    const state = buildPipelineState(taskIds);
    const phaseResult = await runPhase(currentPhase, state);
    lastClaudeSessionId = phaseResult?.agent === "claude" ? phaseResult.sessionId : null;
    lastCodexSessionId = phaseResult?.agent === "codex" ? phaseResult.sessionId : null;
    lastCodexExitStatus = phaseResult?.agent === "codex" ? phaseResult.exitCode ?? 0 : 0;
    if (currentPhase !== "complete" && currentPhase !== "human_review") {
      const agentForPhase = state.tasks[0].status.phases[currentPhase]?.agent;
      if (agentForPhase === "claude") {
        const slot = currentPhase === "spec" ? "claude_spec" : currentPhase === "code_review" ? "claude_review" : null;
        if (slot && lastClaudeSessionId) {
          storeSessionId(taskIds, slot, lastClaudeSessionId);
          info(`Claude session stored (${slot}): ${lastClaudeSessionId.slice(0, 8)}...`);
        }
      } else if (agentForPhase === "codex" && lastCodexSessionId) {
        const codexSlot = currentPhase === "spec_review" ? "codex_spec_review" : "codex";
        storeSessionId(taskIds, codexSlot, lastCodexSessionId);
        info(`Codex session stored (${codexSlot}): ${lastCodexSessionId.slice(0, 8)}...`);
      }
      await checkAndRoute(currentPhase, taskIds);
    }
    if (cliArgs.step) {
      const nextPhase = assertSamePhase(taskIds);
      info("Step mode: stopping after one phase.");
      info(`Next phase: ${nextPhase}`);
      if (nextPhase === currentPhase) {
        warn2(`Phase ${currentPhase} did not advance after running \u2014 sub-agent likely failed. Check the artifact and logs.`);
        process.exit(1);
      }
      process.exit(0);
    }
    console.log("");
  }
}

// scripts/run-task.ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
/*! Bundled license information:

mustache/mustache.mjs:
  (*!
   * mustache.js - Logic-less {{mustache}} templates with JavaScript
   * http://github.com/janl/mustache.js
   *)
*/
