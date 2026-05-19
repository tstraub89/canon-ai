#!/usr/bin/env node

// scripts/run-task/main.ts
import { spawnSync as spawnSync6 } from "child_process";
import fs14 from "fs";
import path15 from "path";

// scripts/run-task/phases/code-review.ts
import fs9 from "fs";
import path10 from "path";

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
  console.log("  --push              Push branch at human_review");
  console.log("  --pr                Push + create draft PR at human_review");
  console.log("  --reroute           Reset from human_review back to implement AND re-invoke the pipeline");
  console.log("  --ship              Merge open PR, pull, archive task, commit+push, clean branches");
  console.log("  --dry-run           Print each planned phase and exit without spawning any LLM");
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
  if (taskIds.length === 0) die("At least one TASK-ID is required.");
  return { taskIds, interactive, step, expectPhase, push: push2, pr, reroute, ship, dryRun };
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
import path4 from "path";

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
  claudeModelQa: process.env.CLAUDE_MODEL_QA ?? process.env.CLAUDE_MODEL ?? "sonnet",
  codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? "gpt-5.4-mini",
  codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? "gpt-5.5",
  maxReviewLoops: process.env.MAX_REVIEW_LOOPS ? Number.parseInt(process.env.MAX_REVIEW_LOOPS, 10) : null,
  maxContextBytes: Number.parseInt(process.env.MAX_CONTEXT_BYTES ?? String(64 * 1024), 10)
};

// scripts/run-task/state.ts
import fs2 from "fs";
import { spawnSync as spawnSync2 } from "child_process";
import path2 from "path";

// scripts/run-task/types.ts
var PHASE_ORDER = ["spec", "spec_review", "plan", "implement", "code_review", "qa", "human_review"];
var _PHASE_STATUS_VALUES = ["pending", "in_progress", "done", "changes_requested", "blocked"];
var _VERDICT_VALUES = ["approved", "approved_with_nits", "changes_requested", "needs_re_review"];
function isPhaseStatus(value) {
  return typeof value === "string" && _PHASE_STATUS_VALUES.includes(value);
}
function isVerdict(value) {
  return typeof value === "string" && _VERDICT_VALUES.includes(value);
}

// scripts/run-task/state.ts
function effectiveWorktreesRoot() {
  return process.env.CANON_WORKTREES_ROOT ? path2.resolve(process.env.CANON_WORKTREES_ROOT) : WORKTREES_ROOT;
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
function taskDirFor(taskId) {
  const tasksDir = process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR;
  return path2.join(tasksDir, taskId);
}
function resolveTaskCwd(taskId) {
  const worktreesRoot = effectiveWorktreesRoot();
  const directWorktree = path2.join(worktreesRoot, taskId);
  const directStatus = path2.join(directWorktree, "tasks", taskId, "status.json");
  if (fs2.existsSync(directStatus)) return directWorktree;
  const statusPath = path2.join(taskDirFor(taskId), "status.json");
  try {
    const parsed = JSON.parse(fs2.readFileSync(statusPath, "utf8"));
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
    return path2.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId, "status.json");
  }
  return path2.join(resolveTaskCwd(taskId), "tasks", taskId, "status.json");
}
function validateBranchField(value, taskId, fieldName) {
  if (value === void 0) return;
  if (typeof value !== "string") {
    die(`Invalid ${fieldName} in task '${taskId}': expected string, got ${typeof value}. Edit status.json.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return;
  if (trimmed.startsWith("-")) {
    die(`Invalid ${fieldName} in task '${taskId}': '${value}' looks like a flag, not a branch name. Edit status.json.`);
  }
  if (/[\x00-\x1F\x7F\s:]/.test(trimmed)) {
    die(`Invalid ${fieldName} in task '${taskId}': '${value}' contains control chars, whitespace, or refspec separator. Edit status.json.`);
  }
}
function validateNonNegativeInt(value, taskId, fieldPath) {
  if (value === void 0) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    die(`Invalid ${fieldPath} in task '${taskId}': expected non-negative integer, got ${JSON.stringify(value)}. Edit status.json.`);
  }
}
function validateStatus(taskId, parsed) {
  validateBranchField(parsed.branch, taskId, "branch");
  validateBranchField(parsed.base_branch, taskId, "base_branch");
  const phases = parsed.phases ?? {};
  for (const [phaseName, entry] of Object.entries(phases)) {
    if (!entry) continue;
    for (const field of ["iterations", "iterations_current_loop", "iterations_total", "changes_requested_total", "auto_block_count", "reroute_count"]) {
      validateNonNegativeInt(entry[field], taskId, `phases.${phaseName}.${field}`);
    }
  }
}
function readStatus(taskId) {
  const parsed = JSON.parse(fs2.readFileSync(statusFileFor(taskId), "utf8"));
  validateStatus(taskId, parsed);
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
  fs2.writeFileSync(tmpFile, `${JSON.stringify(status, null, 2)}
`, "utf8");
  fs2.renameSync(tmpFile, statusFile);
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
import fs3 from "fs";
import path3 from "path";
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
  "notes.md"
]);
function worktreePath(taskId) {
  return path3.join(WORKTREES_ROOT, taskId);
}
function isWorktreeEnabled(taskIds) {
  return readStatus(taskIds[0]).worktree === true;
}
function getActiveCwd(taskIds, options = {}) {
  if (isWorktreeEnabled(taskIds)) {
    const wt = worktreePath(taskIds[0]);
    if (fs3.existsSync(wt)) return wt;
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
  if (!fs3.existsSync(WORKTREES_ROOT)) {
    fs3.mkdirSync(WORKTREES_ROOT, { recursive: true });
  }
  const wt = worktreePath(taskId);
  if (fs3.existsSync(wt)) {
    info(`Worktree already exists: ${wt}`);
    return wt;
  }
  const existingWt = findExistingWorktreeForBranch2(branch);
  if (existingWt) {
    info(`Worktree already exists for branch '${branch}': ${existingWt}`);
    return existingWt;
  }
  const repoModulesSrc = path3.join(REPO_ROOT, "node_modules");
  const repoPackageJson = path3.join(REPO_ROOT, "package.json");
  if (fs3.existsSync(repoPackageJson) && !fs3.existsSync(repoModulesSrc)) {
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
  const wtModules = path3.join(wt, "node_modules");
  if (fs3.existsSync(repoPackageJson) && !fs3.existsSync(wtModules)) {
    fs3.symlinkSync(repoModulesSrc, wtModules);
    info("Symlinked node_modules into worktree.");
  }
  const envFiles = fs3.readdirSync(REPO_ROOT).filter(
    (name) => name.startsWith(".env") && fs3.statSync(path3.join(REPO_ROOT, name)).isFile()
  );
  const linkedEnvFiles = [];
  for (const envFile of envFiles) {
    const dst = path3.join(wt, envFile);
    if (!fs3.existsSync(dst)) {
      fs3.symlinkSync(path3.join(REPO_ROOT, envFile), dst);
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
  if (!fs3.existsSync(wt)) return;
  info(`Removing worktree ${wt}...`);
  const result = gitSafe("worktree", "remove", "--force", wt);
  if (!result.ok) warn(`Could not remove worktree: ${result.stderr}`);
  else info("Worktree removed.");
}
function flushWorktreeTelemetry() {
  const allFiles = [...PIPELINE_SHARED_DOCS];
  const present = allFiles.filter((f) => fs3.existsSync(path3.join(REPO_ROOT, f)));
  if (present.length === 0) return;
  const status = gitSafe("status", "--porcelain", ...present);
  if (!status.ok || !status.stdout.trim()) return;
  for (const f of present) gitSafe("add", "--", f);
  const staged = gitSafe("diff", "--cached", "--name-only");
  if (!staged.stdout.trim()) return;
  const targetBranch = getCurrentBranch();
  const result = gitSafe("commit", "-m", "chore: flush pipeline telemetry");
  if (!result.ok) warn(`Could not flush telemetry to ${targetBranch}: ${result.stderr}`);
  else info(`Flushed pipeline telemetry to ${targetBranch}.`);
}
function syncWorktreeArtifacts(taskIds) {
  for (const taskId of taskIds) {
    const wt = worktreePath(taskId);
    const wtDir = path3.join(wt, "tasks", taskId);
    const mainDir = path3.join(REPO_ROOT, "tasks", taskId);
    if (!fs3.existsSync(wtDir)) continue;
    const wtFiles = new Set(
      fs3.readdirSync(wtDir).filter((f) => {
        try {
          const st = fs3.lstatSync(path3.join(wtDir, f));
          return st.isFile() && !st.isSymbolicLink();
        } catch {
          return false;
        }
      })
    );
    for (const name of TASK_ARTIFACT_FILES) {
      const src = path3.join(wtDir, name);
      const dest = path3.join(mainDir, name);
      try {
        if (wtFiles.has(name)) {
          fs3.copyFileSync(src, dest);
        } else if (fs3.existsSync(dest)) {
          fs3.unlinkSync(dest);
        }
      } catch {
      }
    }
  }
}
function syncWorktreeTelemetry(taskIds) {
  for (const taskId of taskIds) {
    const wt = worktreePath(taskId);
    if (!fs3.existsSync(wt)) continue;
    const sourceHead = gitSafeAtRaw(wt, "rev-parse", "HEAD");
    const destHead = gitSafeAtRaw(REPO_ROOT, "rev-parse", "HEAD");
    if (!sourceHead.ok || !destHead.ok) {
      warn(`Skipping shared-doc sync for ${taskId}: could not resolve HEAD SHAs`);
      continue;
    }
    const sourceSHA = sourceHead.stdout.trim();
    const destSHA = destHead.stdout.trim();
    for (const relPath of PIPELINE_SHARED_DOCS) {
      if (relPath === "docs/pipeline-invocations.md") continue;
      const isManagedDoc = PIPELINE_MANAGED_DOCS.includes(relPath);
      const src = path3.join(wt, relPath);
      const dest = path3.join(REPO_ROOT, relPath);
      if (!fs3.existsSync(src)) continue;
      try {
        if (fs3.lstatSync(src).isSymbolicLink()) continue;
        const dirty = gitSafeAtRaw(REPO_ROOT, "status", "--porcelain=v1", "-uall", "--", relPath);
        if (dirty.ok && dirty.stdout.trim()) {
          if (!isManagedDoc) {
            warn(`Skipping shared-doc sync for ${taskId} (${relPath}): destination has uncommitted changes`);
            continue;
          }
          try {
            const sourceContent = fs3.readFileSync(src, "utf8");
            const destContent = fs3.readFileSync(dest, "utf8");
            if (sourceContent !== destContent) {
              warn(`Skipping managed-doc sync for ${taskId} (${relPath}): destination has uncommitted changes that diverge from the worktree (preserving external edits)`);
              continue;
            }
          } catch {
            warn(`Skipping managed-doc sync for ${taskId} (${relPath}): could not compare destination to worktree`);
            continue;
          }
        }
        if (sourceSHA !== destSHA) {
          const destAhead = gitSafeAtRaw(wt, "log", "--oneline", `${sourceSHA}..${destSHA}`, "--", relPath);
          if (destAhead.ok && destAhead.stdout.trim()) {
            warn(`Skipping shared-doc sync for ${taskId} (${relPath}): destination has commits source lacks`);
            continue;
          }
        }
        let needsCopy = !fs3.existsSync(dest);
        if (!needsCopy) {
          const sourceContent = fs3.readFileSync(src, "utf8");
          const destinationContent = fs3.readFileSync(dest, "utf8");
          needsCopy = sourceContent !== destinationContent;
        }
        if (needsCopy) {
          fs3.copyFileSync(src, dest);
        }
        if (!isManagedDoc) {
          gitSafeAt(wt, "checkout", "HEAD", "--", relPath);
        }
      } catch {
      }
    }
  }
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
    const taskDir = path4.relative(REPO_ROOT, taskDirFor(taskId));
    const status = gitSafe("status", "--porcelain", "--", taskDir);
    if (!status.ok || status.stdout.trim().length === 0) continue;
    git("add", "--", taskDir);
    git("commit", "-m", `task(${taskId}): commit artifacts pre-pipeline`);
    info(`Committed task artifacts for ${taskId} to base branch.`);
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
function ensureBranch(taskIds) {
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
    ensureWorktree(taskIds[0], branchName, baseBranch);
    for (const taskId of taskIds) {
      const s = readStatus(taskId);
      s.branch = branchName;
      writeStatus(taskId, s);
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
    case "code_review":
      return config3.claudeModelReview;
    case "qa":
      return config3.claudeModelQa;
    // spec_review, implement, human_review aren't Claude phases; fall back
    // to the spec model so resumed Claude sessions survive accidental use.
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
  return {
    spec: buildHigh("spec"),
    plan: buildHigh("plan", "high"),
    // sonnet doesn't support xhigh
    code_review: buildHigh("code_review"),
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
import fs4 from "fs";
import path5 from "path";
var METRICS_FILE = path5.join(REPO_ROOT, "docs/pipeline-invocations.md");
function recordMetric(entry) {
  if (!fs4.existsSync(METRICS_FILE)) {
    fs4.writeFileSync(METRICS_FILE, [
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
  fs4.appendFileSync(
    METRICS_FILE,
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
      stdio: ["inherit", "pipe", "pipe"]
    });
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        warn(`${options.label} stalled \u2014 no output for ${Math.round(stallMs / 1e3)}s. Sending SIGTERM.`);
        try {
          child.kill("SIGTERM");
        } catch {
        }
        killTimer = setTimeout(() => {
          if (!closed) {
            warn(`${options.label} did not exit after SIGTERM \u2014 sending SIGKILL.`);
            try {
              child.kill("SIGKILL");
            } catch {
            }
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
import fs5 from "fs";
import path6 from "path";

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
function validateHandoff(taskId) {
  const handoffPath = path6.join(taskDirFor(taskId), "handoff.md");
  const specPath = path6.join(taskDirFor(taskId), "spec.md");
  const issues = [];
  try {
    const content = fs5.readFileSync(handoffPath, "utf8");
    const latestResults = computeLatestValidationResults(content);
    const hasFail = Array.from(latestResults.values()).some((row) => row.result.trim().toLowerCase() === "fail");
    if (hasFail) {
      issues.push("Validation Outcomes table has one or more Fail results");
    }
    issues.push(...checkAcCoveragePlaceholders(content));
    issues.push(...validateHandoffAgainstSpec(specPath, handoffPath, latestResults));
    const { malformed } = parseHandoffChangesRows(taskId);
    for (const entry of malformed) {
      issues.push(`Changes table row '${entry.cell}': ${entry.reason}`);
    }
  } catch {
    issues.push("handoff.md not found");
  }
  return issues;
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
    const content = fs5.readFileSync(specPath, "utf8");
    const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
    if (!section) return null;
    const checks = [];
    for (const line of section[1].split("\n")) {
      const match = line.match(/^-\s+\[x\]\s+(.+?)\s*$/i);
      if (match?.[1]) checks.push(match[1].trim());
    }
    return checks.length > 0 ? checks : null;
  } catch {
    return null;
  }
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
function isUnrelatedFailResult(result) {
  return /^fail\s*[–—-]\s*unrelated\b/i.test(result.trim());
}
function isPendingResult(result) {
  const trimmed = result.trim();
  if (!trimmed) return true;
  if (/\bPass\s*\/\s*Fail\b/i.test(trimmed)) return true;
  return false;
}
function validateHandoffAgainstSpec(specPath, handoffPath, latestResults) {
  const requiredChecks = parseValidationRequiredChecks(specPath);
  if (requiredChecks === null) {
    return ["Validation Required section is missing from spec.md"];
  }
  if (requiredChecks.length === 0) return [];
  let rowMap;
  if (latestResults) {
    rowMap = latestResults;
  } else {
    try {
      const content = fs5.readFileSync(handoffPath, "utf8");
      rowMap = computeLatestValidationResults(content);
    } catch {
      rowMap = /* @__PURE__ */ new Map();
    }
  }
  const issues = [];
  for (const required of requiredChecks) {
    const canonical = canonicalizeValidationCheck(required);
    const row = rowMap.get(canonical);
    if (!row) {
      const present = [...rowMap.keys()];
      const hint = present.length > 0 ? ` Handoff has rows for: ${present.join(", ")}. (Required canonicalized to: '${canonical}'.)` : " Handoff has no Validation Outcomes rows.";
      issues.push(`Validation Required item missing from handoff.md: ${required}.${hint}`);
      continue;
    }
    const note = row.notes ? ` (${row.notes})` : "";
    if (isPendingResult(row.result)) {
      issues.push(`Validation Required item present but unfilled (still in template 'pending' state): ${required}.`);
      continue;
    }
    if (isNAResult(row.result) || isNotConfiguredResult(row.result)) {
      issues.push(`Validation Required item marked ${row.result} in handoff.md: ${required} (required checks cannot be skipped \u2014 adjust spec or run the check)`);
      continue;
    }
    if (isDeferredBySpecResult(row.result)) {
      if (!/spec[:.-]/i.test(row.notes ?? "")) {
        issues.push(`Validation Required item marked deferred_by_spec without a spec citation in Notes: ${required}`);
      }
      continue;
    }
    if (isHumanPendingResult(row.result)) {
      continue;
    }
    if (isBlockedResult(row.result)) {
      issues.push(`Validation Required item marked blocked in handoff.md: ${required}${note} \u2014 triage required (CI/network/infrastructure)`);
      continue;
    }
    if (isUnrelatedFailResult(row.result)) {
      const hasFileRef = /\w+\.\w+|:\d+/.test(row.notes ?? "");
      if (!hasFileRef) {
        issues.push(`Validation Required item marked Fail \u2013 unrelated needs a specific test/file reference in Notes (e.g., \`src/foo.test.ts\` or \`file:42\`; vague prose like "pre-existing flake" is rejected): ${required}`);
      }
      continue;
    }
    if (!isPassResult(row.result)) {
      issues.push(`Validation Required item did not pass in handoff.md: ${required} \u2014 ${row.result}${note}`);
    }
  }
  return issues;
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
function isTemplateUnfilled(content) {
  if (content === null) return true;
  return content.includes("[TASK-ID]");
}
function isDoneMdTemplate(donePath) {
  let content;
  try {
    content = fs5.readFileSync(donePath, "utf8");
  } catch {
    return true;
  }
  return DONE_MD_TEMPLATE_SENTINELS.some((s) => content.includes(s));
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
  return taskDirOverride ? path6.join(taskDirOverride, taskId) : taskDirFor(taskId);
}
function checkPhaseGate(taskId, phase, verdict, taskDirOverride) {
  const config3 = PHASE_GATE_CONFIG[phase];
  const taskDir = resolveTaskDirForValidation(taskId, taskDirOverride);
  if (config3.artifactName) {
    const artifactPath = path6.join(taskDir, config3.artifactName);
    let content;
    try {
      content = fs5.readFileSync(artifactPath, "utf8");
    } catch {
      return { ok: false, reason: `${config3.artifactName} is missing for phase '${phase}'` };
    }
    const isTemplate = config3.customTemplateCheck ? config3.customTemplateCheck(artifactPath) : isTemplateUnfilled(content);
    if (isTemplate) {
      return { ok: false, reason: `${config3.artifactName} is still the unfilled template for phase '${phase}'` };
    }
    if (config3.verdictMustMatchArtifact) {
      if (!verdict) {
        return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
      }
      const extracted = extractCheckedVerdict(content);
      if (!extracted) {
        return { ok: false, reason: `${config3.artifactName} has no checked verdict checkbox` };
      }
      if (extracted !== verdict) {
        return { ok: false, reason: `verdict mismatch: status.json wants '${verdict}', ${config3.artifactName} has '${extracted}'` };
      }
    }
  }
  if (config3.requiresVerdict && !config3.verdictMustMatchArtifact) {
    if (!verdict) {
      return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
    }
  }
  if (phase === "human_review") {
    const handoffPath = path6.join(taskDir, "handoff.md");
    let handoffContent;
    try {
      handoffContent = fs5.readFileSync(handoffPath, "utf8");
    } catch {
      return { ok: false, reason: `closing human_review requires a handoff.md \u2014 none found in ${taskDir}` };
    }
    const pending = countHumanPendingChecks(handoffContent);
    if (pending.length === 0) return { ok: true };
    const donePath = path6.join(taskDir, "done.md");
    let doneContent = "";
    try {
      doneContent = fs5.readFileSync(donePath, "utf8");
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
  const handoffPath = path6.join(taskDirFor(taskId), "handoff.md");
  let content;
  try {
    content = fs5.readFileSync(handoffPath, "utf8");
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
function parseHandoffPathCell(cell) {
  const trimmed = cell.trim();
  if (!trimmed) return { kind: "malformed", reason: "empty cell" };
  const backtickGroups = [...trimmed.matchAll(/`([^`]+)`/g)];
  const mdLinkGroups = [...trimmed.matchAll(/\[([^\]]+)\]\([^)]*\)/g)];
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
    if (!/^\[[^\]]+\]\(.*\)(?:\s+.*)?$/.test(trimmed)) {
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
  return { kind: "ok", path: extracted };
}
var HANDOFF_DIFF_EXEMPT_PATHS = /* @__PURE__ */ new Set([]);
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

// scripts/run-task/context.ts
import fs6 from "fs";
import path7 from "path";
function extractAffectedFiles(taskId) {
  const specPath = path7.join(taskDirFor(taskId), "spec.md");
  try {
    const content = fs6.readFileSync(specPath, "utf8");
    const match = content.match(/### Affected Files\n\n\|[^\n]+\|\n\|[^\n]+\|\n((?:\|[^\n]+\|\n?)*)/);
    if (!match) return [];
    return match[1].split("\n").filter((l) => l.startsWith("|")).map((row) => row.match(/\|\s*`([^`]+)`/)?.[1]).filter((f) => !!f);
  } catch {
    return [];
  }
}
function isSafeRepoPath(file) {
  if (path7.isAbsolute(file) || file.includes("..")) return false;
  const resolved = path7.resolve(REPO_ROOT, file);
  if (!resolved.startsWith(REPO_ROOT + path7.sep)) return false;
  try {
    const real = fs6.realpathSync(resolved);
    if (!real.startsWith(REPO_ROOT + path7.sep)) return false;
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
      const filePath = path7.join(REPO_ROOT, file);
      try {
        allFiles.set(file, fs6.readFileSync(filePath, "utf8"));
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
    const ext = path7.extname(file).slice(1) || "text";
    block += `### \`${file}\`
\`\`\`${ext}
${content}
\`\`\`

`;
  }
  return block;
}
function buildKnownPitfalls() {
  const patternsPath = process.env.CANON_PATTERNS_MD_PATH ?? path7.join(REPO_ROOT, "docs/patterns.md");
  try {
    const content = fs6.readFileSync(patternsPath, "utf8");
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
    const specPath = path7.join(taskDirFor(taskId), "spec.md");
    try {
      const content = fs6.readFileSync(specPath, "utf8");
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
      const filePath = path7.join(REPO_ROOT, file);
      try {
        files.set(file, fs6.statSync(filePath).size);
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
  const specPath = path7.join(taskDirFor(taskId), "spec.md");
  try {
    const content = fs6.readFileSync(specPath, "utf8");
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
  const specPath = path7.join(taskDirFor(taskId), "spec.md");
  try {
    const content = fs6.readFileSync(specPath, "utf8");
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

// scripts/run-task/prompts/templates/code-review-round-1.md
var code_review_round_1_default = "You are reviewing implementation for {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nTasks to review:\n{{{taskLines}}}\n\nGrounding rule: inspect the current diff and changed files before you trust any statement in handoff.md. If a claim is not visible in the current artifact, treat it as unverified.\n\n**Read in this order: spec.md \u2192 handoff.md \u2192 diff.** Do not read handoff.md first \u2014 Codex's explanation of what it did will anchor your review before you've formed an independent read of the requirements. Let the spec set the frame, then check whether the handoff and diff match it.\n\n{{#hasDiff}}\n**Task diff against {{{baseBranch}}}**\n\n```diff\n{{{diffContent}}}\n```\n{{#diffTruncated}}\n> Diff truncated at 50 000 bytes \u2014 read changed files listed in handoff.md Changes table directly for the remainder.\n{{/diffTruncated}}\n{{/hasDiff}}\n{{^hasDiff}}\nRead the actual diff: `git diff {{{baseBranch}}}...HEAD`.\n{{/hasDiff}}\n{{#isBundle}}\nAlso check for cross-task interactions \u2014 unintended coupling or conflicts between tasks.{{/isBundle}}\n\n**Validation gate**: verify each handoff.md Validation Outcomes table has no Fail results and all applicable checks were run.\n`Fail \u2013 unrelated` rows are permitted only when the Notes column names the specific failing test/file \u2014 assess whether the explanation is credible and the failure is genuinely outside the task's Affected Files.\nTreat a required check marked N/A as a failure of the handoff.\n\n**On plan deviations**: Codex may deviate from plan.md if the deviation is documented with justification in handoff.md. Treat documented deviations as design decisions to evaluate \u2014 not automatic violations. Ask: is the AC still met? Is the approach sound?\n\n**Always flag**: dropped or partially-met ACs, undocumented behavior changes, skipped or failed validation checks.\n\nFor each task, write tasks/<id>/review.md. Label every finding: `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, or `spec gap` (something ambiguous or missing in the spec that caused Codex to guess \u2014 flag it so the spec template can improve). On re-review (round 2+), append a `## Round N` section rather than rewriting \u2014 the template's \"On re-review\" comment shows the shape.\n\nSet verdict per task: approved, approved_with_nits, changes_requested, or needs_re_review.\n\nWhen done, run (one per task with actual verdict):\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/code-review-round-n.md
var code_review_round_n_default = "[REVIEW ROUND {{roundN}} \u2014 verifying iteration {{priorIteration}}'s response to round {{maxIter}} findings]\n\nCodex appended `## Iteration {{priorIteration}}` to `handoff.md` addressing your prior round's findings. If you're resuming the prior review session, the full task framing (spec, prior review history, repo conventions) is already in context \u2014 skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and the earlier `## Round` sections of `tasks/<id>/review.md` before verifying the new iteration.\n\nTasks to re-review:\n{{{taskLines}}}\n{{{tightenLine}}}\n{{#hasDiff}}\n**Task diff against {{{baseBranch}}}**\n\n```diff\n{{{diffContent}}}\n```\n{{#diffTruncated}}\n> Diff truncated at 50 000 bytes \u2014 read changed files listed in handoff.md Changes table directly for the remainder.\n{{/diffTruncated}}\n{{/hasDiff}}\n{{^hasDiff}}\nRead the actual code diff since your prior review: `git diff {{{baseBranch}}}...HEAD -- <files-from-iteration-{{priorIteration}}>`.\n{{/hasDiff}}\n\nFor each task:\n1. Read the `## Iteration {{priorIteration}}` section of `tasks/<id>/handoff.md` \u2014 that's the diff under review this round.\n{{#hasDiff}}\n2. Read the pre-computed code diff above. Do not trust handoff claims that are not visible in the diff.\n{{/hasDiff}}\n{{^hasDiff}}\n2. Read the actual code diff since your prior review using `git diff {{{baseBranch}}}...HEAD -- <files-from-iteration-{{priorIteration}}>` when the diff was not precomputed. Do not trust handoff claims that are not visible in the diff.\n{{/hasDiff}}\n3. For each finding in your prior `## Round {{maxIter}}` section of `review.md`, verify whether iteration {{priorIteration}} addressed it. **Do NOT redo the Stage 1 AC table** \u2014 that gate already passed in round 1.\n4. **APPEND** `## Round {{roundN}} \u2014 verifying iteration {{priorIteration}}'s response to round {{maxIter}}` to `review.md` (the template's \"On re-review\" comment shows the shape). Do not rewrite earlier rounds. Include only:\n   - Per-finding verification (addressed / still open / no longer relevant)\n   - NEW findings introduced by iteration {{priorIteration}}'s changes \u2014 don't re-litigate decisions from earlier rounds\n   - Verdict for this round\n\nSet verdict per task: `approved`, `approved_with_nits`, `changes_requested`, or `needs_re_review`.\n\nWhen done, run (one per task with actual verdict):\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/implement.md
var implement_default = 'You are implementing {{taskScope}} for {{projectName}}.\n\n{{{stateHeader}}}\n{{{startup}}}\n{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}\n{{{affectedFilesBlock}}}\nTasks to implement:\n{{{taskLines}}}{{#isBundle}}\nThese tasks are related \u2014 implement them together. Consider shared code paths and cross-task interactions.{{/isBundle}}\n\nGrounding rule: before you write handoff.md, re-open the files you changed and verify the current diff against the spec. Do not treat a previous session\'s memory as proof that the work is already in place.\n\n**Spec ACs are binding. Plan approach is guidance.**\n- Every Acceptance Criterion in spec.md MUST be met \u2014 these are non-negotiable.\n- If you find a better implementation approach than what\'s in the plan, use it. Document every deviation in handoff.md under "Deviations" with specific rationale.\n- You may NOT silently drop an AC, skip a required validation check, or omit a spec requirement.\n- If an AC is infeasible as written, document it in Blockers \u2014 do not silently skip.\n- If an AC is ambiguous enough that two reasonable implementations exist, document your interpretation in handoff.md under Blockers with label `[ambiguity]` \u2014 do not silently guess. Claude will evaluate whether the interpretation was correct.\n\nRun ALL applicable validation checks before writing handoff. See "Validation Required" in each spec.md and the matrix in AGENTS.md. Required checks must be recorded as Pass or Fail; do not mark a required check N/A unless the spec explicitly removed it.\n\n**Test flakiness in your sandbox.** Validation suites \u2014 especially E2E or integration tests \u2014 can hit transient failures (timing races, environment quirks, network jitter) that have nothing to do with the code in your spec\'s Affected Files. **If a failure is in a test / file outside your Affected Files table, do NOT fix it.** Note the observed test name, file, line, and a one-line repro hint in handoff.md \u2192 Blockers (or "Validation Outcomes" Notes column with status `Fail \u2013 unrelated`), then continue. Scope discipline > fixing adjacent bugs you spot during validation. The reviewer/operator will decide whether to triage the unrelated failure separately.\n\nFor each task, write tasks/<id>/handoff.md using the template. The Validation Outcomes table must have no Fail results EXCEPT for unrelated-flake rows clearly labeled in the Notes column.\nAppend to tasks/<id>/notes.md for any surprising codebase behavior (prefix: [implement]).\n\nWhen done, run:\n{{{phaseCommands}}}\n';

// scripts/run-task/prompts/templates/implement-reroute.md
var implement_reroute_default = 'You are addressing **human-review feedback** on {{taskScope}} for {{projectName}}.\n\n{{{stateHeader}}}\n{{{roundBanner}}}{{{preamble}}}\n\n{{#startup}}{{{startup}}}\n{{/startup}}{{{risksBlock}}}{{{pitfallsBlock}}}{{{contextBlock}}}\n{{{affectedFilesBlock}}}\nTasks with amended specs:\n{{{taskLines}}}\n\n{{{groundingRule}}}\n\n**How to approach this:**\n1. Read tasks/<id>/spec.md top-to-bottom. Scan for any section added after the original spec (e.g. "Amendment", "Round N", "Follow-up", "Post-review"). Those are the new requirements.\n2. Read tasks/<id>/handoff.md to understand what you previously shipped. Do NOT assume the handoff covers the amendment \u2014 it was written before the amendment existed.\n3. Identify the delta: which ACs are new, which changed, which were already addressed by the previous implementation.\n4. Implement the delta. Previously-correct work stays; only change what the amendment requires. If the amendment conflicts with a prior AC, the amendment wins.\n5. Re-run ALL applicable validation checks (lint, type-check, test, build, e2e as applicable per the spec\'s Validation Required). Required checks must be recorded as Pass or Fail; do not mark a required check N/A.\n6. **Rewrite handoff.md** to reflect the complete current state of the implementation \u2014 including the round-1 work that still applies plus the new amendment work. The reviewer reads handoff.md as the single source of truth, not your prior session\'s context.\n\n**Spec ACs are binding** \u2014 including both original ACs and amendment ACs. If you think an amendment AC is infeasible as written, document it under Blockers in handoff.md. Do not silently drop any AC.\n\nAppend to tasks/<id>/notes.md for any surprising behavior found while re-reading the codebase (prefix: `[implement-reroute]`).\n\nWhen done, run:\n{{{phaseCommands}}}\n';

// scripts/run-task/prompts/templates/implement-revisions.md
var implement_revisions_default = "{{{iterBanner}}}\n\n{{{stateHeader}}}\n{{{startup}}}\n\n{{{affectedFilesBlock}}}\n\n{{#hasReviewFindings}}\nYour prior iteration shipped; the reviewer (Claude) appended findings to `review.md` as `## Round {{priorRound}}`. If you're resuming the prior session, the full task framing (spec, plan, repo conventions) is already in context \u2014 skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and `tasks/<id>/plan.md` before addressing findings.\n\nTasks with new review feedback:\n{{{reviewLines}}}\n\nFor each task:\n1. Read the most recent `## Round {{priorRound}}` section of `tasks/<id>/review.md`. That is the entire scope of this iteration.\n2. Address every `correctness bug`, `risk/guardrail`, and `spec gap` finding from that round (blocking). `optional cleanup/nit` is at your discretion{{#tightenLine}}{{{tightenLine}}}{{/tightenLine}}\n3. Re-run only the validation checks affected by your changes (typically lint, type-check, plus whatever the diff touches).\n{{/hasReviewFindings}}\n{{#hasReviewFindings}}\n4. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}` (the template's \"On revision rounds\" comment shows the shape). Do NOT rewrite the file from scratch \u2014 earlier iterations stay as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation results.\n{{/hasReviewFindings}}\n\nSpec ACs remain binding. If the review identifies a dropped AC, restore it.\nAppend to `tasks/<id>/notes.md` for new pitfalls found (prefix: `[implement-revision]`).\n\nWhen done, run:\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/plan.md
var plan_default = "You are writing implementation plans for {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\n{{{verdictLines}}}\n\nFor each task, read tasks/<id>/spec.md and tasks/<id>/spec-review.md. Address any `changes_requested` items before writing the plan. If the verdict is `approved_with_nits`, incorporate the nits into the plan \u2014 they don't require spec changes but should inform implementation decisions.\n\nWrite tasks/<id>/plan.md for each task with ordered implementation steps. Reference specific files, existing patterns, and code examples from the codebase. Codex implements directly from this plan.\n\nIf you encounter spec gaps, append to tasks/<id>/notes.md (prefix: [plan]).\n\nWhen done, run:\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/qa.md
var qa_default = `You are writing QA summaries for {{taskScope}} for {{projectName}}.

{{{startup}}}

Tasks:
{{{taskLines}}}

For each task:
1. **Use the Write tool** to create tasks/<id>/done.md \u2014 plain-English summary for the human. Include: what changed, files changed, how to test, test results, decisions made, open questions.
   \u26A0\uFE0F CRITICAL: Use the \`Write\` tool \u2014 do NOT simply output the done.md content as text in your response. Content in your chat reply does not get saved to disk. The pipeline validates that done.md contains real content (not the template) before advancing. Write the file.
2. Include a **Proposed Changelog** section in done.md:
   - Read AGENTS.md \xA7"Release Rules" for the project's changelog audience and SemVer interpretation before writing. Apply the project's defined scope.
   - If CHANGELOG.md exists, read the top of it (the most recent version section) to calibrate on scope and voice.
   - Apply the "would a user notice" test to every candidate bullet (or the project's equivalent scope test): if a candidate falls outside the project's defined changelog scope, omit it. If a task is entirely out of scope, say so explicitly ("no user-facing change \u2014 omit from changelog") rather than inventing a bullet.
   - Implementation mechanics belong in the "What Changed" section above \u2014 not in the proposed changelog.
   - Proposed version bump per the project's SemVer interpretation, with brief rationale.
   The human finalizes both.

After writing all done.md files:
- Read tasks/<id>/notes.md for each task. For each insight, ask: "would this have changed how a *different* task was approached?" Only write to docs/lessons-learned.md if yes. Task-specific details stay in notes.md only.
- Append one row per task to docs/task-quality-log.md (see that file for column definitions).
- **Docs freshness**: scan the protected docs in AGENTS.md (architecture.md, codebase-map.md, patterns.md, product-context.md, decisions.md) for anything contradicted by {{docsScope}}. Update stale references if found.
- **Lessons sweep** (periodic \u2014 not every task): scan docs/lessons-learned.md. For each entry: promote durable truths to the right permanent doc (patterns.md / decisions.md / AGENTS.md), OR prune entries that turned out to be task-specific after all (just delete them \u2014 the detail lives in the task's notes.md). Leave a tombstone only for promoted entries. Do this when lessons-learned exceeds ~15 entries or at the end of a release milestone.

When done, run (use the Bash tool \u2014 do not just output the command as text):
{{{phaseCommands}}}
`;

// scripts/run-task/prompts/templates/spec.md
var spec_default = "{{{header}}}\n\n{{{startup}}}\n\n{{{instructions}}}\n{{{bundleNote}}}\n{{#doneNote}}\nNote: {{{doneNote}}}{{/doneNote}}\n\n{{{selfCheck}}}\n\nWhen done, run (one per task):\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/spec-revision.md
var spec_revision_default = "You are revising specs for {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nTasks with review feedback:\n{{{reviewLines}}}\n\nAddress every `changes_requested` finding in each spec.md.{{#combined}}\nAlso update plan.md if spec changes affect the implementation approach.{{/combined}}\n\nWhen done, run:\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/templates/spec-review.md
var spec_review_default = "You are reviewing {{taskScope}} for {{projectName}}.\n\n{{{startup}}}\n\nTasks to review:\n{{{taskLines}}}\n\nGrounding rule: if a finding depends on code, a symbol, or a validation result, verify the current file or diff before you claim it exists. If you did not re-open it, do not infer it from memory.\n\n**Your job is to find what's wrong or missing \u2014 not to validate what's there.** Approach this as the implementer: if you had to build this, what would break, be ambiguous, or be missing? Neutral or confirmatory review is a failure mode.\n\n**First, a strategic read of the spec itself \u2014 shape before implementability.** Ask:\n- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)\n- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)\n- Is there a materially simpler solution that changes the shape of the work?\n- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)\n\n**Silence is the default.** Only flag a Shape Check concern if something is actually off \u2014 do not manufacture one. A real shape concern becomes the lead reason for a `changes_requested` verdict; write it under the Shape Check section in spec-review.md. If none, leave that section as \"no concerns\" and proceed.\n\nThen for each task, actively probe implementability: Can this be implemented as written? Are ACs testable and unambiguous? Are edge cases handled? Are there type safety gaps? Are there file/interaction dependencies Claude missed? Does this conflict with existing patterns in the codebase?{{#isBundle}}\nAlso probe for cross-task conflicts or missing dependencies between tasks.{{/isBundle}}\n{{#combined}}\nReview plan.md for each task as well \u2014 flag if the approach is unsound.{{/combined}}\n\n**Classify every finding before deciding your verdict:**\n- **Blocking**: would cause wrong behavior, a silent bug, or make an AC unimplementable as written. Requires `changes_requested`.\n- **Non-blocking (nit)**: an implementation detail Codex can resolve by reading the codebase (prop flow, state threading, naming); a minor ambiguity with an obvious default; a question the plan phase should address. Does NOT require `changes_requested`.\n\n**Verdict rules:**\n- `changes_requested` \u2014 one or more blocking findings. Spec must be revised before the plan phase.\n- `approved_with_nits` \u2014 no blocking findings, but non-blocking nits worth passing forward. **Loop exits immediately.** Nits are written to spec-review.md and the plan phase picks them up.\n- `approved` \u2014 no findings worth noting.\n\n**Batch related nits.** If you have multiple non-blocking observations, include them all in one `approved_with_nits` verdict rather than raising one per round.\n\nIf you encounter surprising codebase behavior, append to tasks/<id>/notes.md (prefix: [spec_review]).\n\nFor each task, write tasks/<id>/spec-review.md using the template. Set your verdict: approved, approved_with_nits, or changes_requested.\n\nWhen done, run (one per task with actual verdict):\n{{{phaseCommands}}}\n";

// scripts/run-task/prompts/index.ts
var TEMPLATES = {
  "code-review-round-1.md": code_review_round_1_default,
  "code-review-round-n.md": code_review_round_n_default,
  "implement.md": implement_default,
  "implement-reroute.md": implement_reroute_default,
  "implement-revisions.md": implement_revisions_default,
  "plan.md": plan_default,
  "qa.md": qa_default,
  "spec.md": spec_default,
  "spec-revision.md": spec_revision_default,
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
  const combined = tier === "fast";
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
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "spec_review", "done", "<verdict>")
  });
}
function promptPlan(state) {
  const { tasks } = state;
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
    pitfallsBlock: buildKnownPitfalls(),
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
  const hasReviewFindings = maxCodeReviewIter > 0;
  const iterationN = maxCodeReviewIter + 1;
  const priorRound = maxCodeReviewIter;
  const iterBanner = `[ITERATION ${iterationN} \u2014 addressing code review round ${priorRound}]`;
  const handoffAppend = `## Iteration ${iterationN} \u2014 addressing review round ${priorRound}`;
  const reviewLines = hasReviewFindings ? tasks.map(
    (t) => `- \`${t.taskId}\` \u2192 read \`tasks/${t.taskId}/review.md\` (most recent \`## Round ${priorRound}\` section only \u2014 earlier rounds are already addressed)`
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
  const maxReroute = tasks.reduce((m, t) => Math.max(m, t.rerouteCount), 0);
  const roundNum = maxReroute + 1;
  const priorReroutes = maxReroute - 1;
  const roundBanner = maxReroute >= 2 ? `\u26A0\uFE0F  **THIS IS ROUND ${roundNum} OF HUMAN REVIEW \u2014 REROUTE #${maxReroute}.** You have already been sent back ${priorReroutes} time${priorReroutes === 1 ? "" : "s"} before this one. This prompt is **not** a duplicate of the previous reroute you already addressed \u2014 the human has provided **new** feedback beyond what you fixed in reroute #${priorReroutes}. If your session memory says "I just finished this," that memory is from the PRIOR round. The spec has additional amendments since then. If your handoff.md references "round ${priorReroutes + 1}" or earlier, it is out-of-date \u2014 the current round is ${roundNum}.

` : `**This is round 2 of human review \u2014 the first reroute for this task.** The human has reviewed your original implementation and sent it back with feedback that requires spec amendments.

`;
  const taskLines = tasks.map(
    (t) => `- \`${t.taskId}\`: "${t.title}" (reroute #${t.rerouteCount}) \u2014 the spec was amended after human review. Read tasks/${t.taskId}/spec.md carefully (look for "Amendment", "Round N", "Follow-up", "Revision Notes", or similar sections that were added since your last handoff). Your previous handoff is at tasks/${t.taskId}/handoff.md.`
  ).join("\n");
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
    pitfallsBlock: buildKnownPitfalls(),
    contextBlock: buildContextBlock(taskIds),
    affectedFilesBlock: buildAffectedFilesBlock(affectedFiles, baseBranch),
    taskLines,
    phaseCommands: phaseCommands(taskIds, "implement", "done")
  });
}
function promptCodeReview(state, baseBranch, scopedDiff = null) {
  const { tasks } = state;
  const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
  const resolvedBaseBranch = baseBranch ?? getBaseBranch(tasks.map((t) => t.taskId));
  const hasDiff = scopedDiff !== null;
  if (maxIter > 0) {
    const roundN = maxIter + 1;
    const priorIteration = maxIter;
    const diffView2 = hasDiff ? {
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
    const taskLines2 = tasks.map(
      (t) => `- \`${t.taskId}\` \u2192 read the \`## Iteration ${priorIteration} \u2014 addressing review round ${maxIter}\` section of \`tasks/${t.taskId}/handoff.md\``
    ).join("\n");
    const tightenLine = roundN >= 3 ? `
**Round ${roundN} discipline.** This is round ${roundN}+. Findings must be \`correctness bug\` or \`spec gap\` only \u2014 NO \`optional cleanup/nit\` and no wording-only changes. We are tightening, not exploring. If your only finding is a wording preference, approve.
` : "";
    return render3("code-review-round-n.md", {
      projectName: config.projectName,
      roundN,
      priorIteration,
      maxIter,
      taskLines: taskLines2,
      tightenLine,
      ...diffView2,
      phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "code_review", "done", "<verdict>")
    });
  }
  const taskLines = tasks.map(
    (t) => `- \`${t.taskId}\`: read tasks/${t.taskId}/handoff.md and cross-reference tasks/${t.taskId}/spec.md ACs`
  ).join("\n");
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
  return render3("code-review-round-1.md", {
    projectName: config.projectName,
    startup: CLAUDE_STARTUP,
    taskScope: tasks.length > 1 ? "a bundle of tasks" : `task "${tasks[0].taskId}"`,
    taskLines,
    isBundle: tasks.length > 1,
    ...diffView,
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "code_review", "done", "<verdict>")
  });
}
function promptQa(state) {
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
    phaseCommands: phaseCommands(tasks.map((t) => t.taskId), "qa", "done")
  });
}

// src/task/index.ts
import { spawnSync as spawnSync5 } from "child_process";
import fs8 from "fs";
import path9 from "path";

// scripts/run-task/canon-snapshot.ts
import { spawnSync as spawnSync4 } from "child_process";
import fs7 from "fs";
import path8 from "path";
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
  const orchestratorCommit = superprojectWorkingTree ? captureGitOutput(path8.resolve(superprojectWorkingTree), ["rev-parse", "HEAD"], runGitAt) || "<unavailable>" : upstreamCommit;
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
  const status = JSON.parse(fs7.readFileSync(statusFilePath, "utf8"));
  const canon = captureCanonSnapshot(REPO_ROOT, options);
  const next = applyCanonSnapshot(status, canon);
  const serialized = `${JSON.stringify(next, null, 2)}
`;
  const current = fs7.readFileSync(statusFilePath, "utf8");
  if (current !== serialized) {
    fs7.writeFileSync(statusFilePath, serialized, "utf8");
  }
  return canon;
}
function refreshCanonSnapshotsAtPaths(statusFilePaths, options = {}) {
  return statusFilePaths.map((statusFilePath) => refreshCanonSnapshotAtPath(statusFilePath, options));
}

// src/task/index.ts
var VALID_PHASES = new Set(PHASE_ORDER);
var VALID_STATUSES = /* @__PURE__ */ new Set(["pending", "in_progress", "done", "changes_requested", "blocked"]);
var VALID_VERDICTS = /* @__PURE__ */ new Set(["approved", "approved_with_nits", "changes_requested", "needs_re_review"]);
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
function taskDirForCwd(cwd, taskId) {
  const root = tasksRoot();
  return path9.isAbsolute(root) ? path9.join(root, taskId) : path9.join(cwd, root, taskId);
}
function taskStatusFileForCwd(cwd, taskId) {
  return path9.join(taskDirForCwd(cwd, taskId), "status.json");
}
function taskRootForGate(cwd) {
  const root = tasksRoot();
  return path9.isAbsolute(root) ? root : path9.join(cwd, root);
}
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs8.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error: failed to read ${filePath}: ${message}`);
  }
}
function writeJsonAtomic(filePath, data) {
  const tmpFile = `${filePath}.tmp`;
  fs8.writeFileSync(tmpFile, `${JSON.stringify(data, null, 2)}
`, "utf8");
  fs8.renameSync(tmpFile, filePath);
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
    throw new Error(`Error: invalid verdict '${verdict}'. Must be one of: approved, approved_with_nits, changes_requested, needs_re_review`);
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
  } else if (verdict === "approved" || verdict === "approved_with_nits") {
    entry.iterations_total += 1;
    entry.iterations_current_loop = 0;
    entry.iterations = 0;
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
  if (!fs8.existsSync(statusPath)) {
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

// scripts/run-task/phases/code-review.ts
async function runCodeReviewPhase(state, interactive, resumeId) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  verifyBranch(taskIds);
  const baseBranch = getBaseBranch(taskIds);
  const activeCwd = getActiveCwd(taskIds);
  const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations_current_loop), 0);
  const codeReviewLoopCap = getMaxReviewLoops(tasks);
  if (maxIter >= codeReviewLoopCap) {
    const reason = `Code review hit ${maxIter} changes_requested iterations in a row (limit: ${codeReviewLoopCap}). Pipeline auto-blocked. Read tasks/<id>/review.md \u2014 if the same finding keeps recurring, the spec or approach may need revisiting rather than another implementation pass. To resume after fixing: set phases.code_review.status = "pending" and phases.code_review.iterations_current_loop = 0 in status.json, then re-run the pipeline.`;
    warn(reason);
    autoBlockPhase(taskIds, "code_review", maxIter, reason);
    process.exit(2);
  }
  const preflightFailed = [];
  for (const t of tasks) {
    const issues = validateHandoff(t.taskId);
    if (issues.length > 0) preflightFailed.push({ taskId: t.taskId, issues });
  }
  const bundleIssues = verifyHandoffAgainstDiff(taskIds, baseBranch);
  if (bundleIssues.length > 0) {
    for (const taskId of taskIds) {
      const existing = preflightFailed.find((entry) => entry.taskId === taskId);
      if (existing) {
        existing.bundleIssues = bundleIssues;
      } else {
        preflightFailed.push({ taskId, issues: [], bundleIssues });
      }
    }
  }
  if (preflightFailed.length > 0) {
    warn("Validation pre-flight FAILED \u2014 rejecting handoff without Claude review:");
    for (const { taskId, issues, bundleIssues: taskBundleIssues } of preflightFailed) {
      for (const issue of issues) warn(`  [${taskId}] ${issue}`);
      if (taskBundleIssues) {
        for (const issue of taskBundleIssues) warn(`  [bundle:${taskId}] ${issue}`);
      }
      const perTaskSection = issues.length > 0 ? `${issues.map((i) => `- ${i}`).join("\n")}
` : "";
      const bundleSection = taskBundleIssues && taskBundleIssues.length > 0 ? `
### Bundle-Level Handoff Verification

${taskBundleIssues.map((i) => `- ${i}`).join("\n")}
` : "";
      const reviewContent = `# Code Review: ${taskId}

## Validation Gate

**BLOCKED \u2014 pre-flight rejected handoff before full review:**

` + perTaskSection + bundleSection + `
## Verdict

- [x] **Changes requested** \u2014 fix the above and resubmit handoff.
`;
      fs9.writeFileSync(path10.join(resolveTaskCwd(taskId), "tasks", taskId, "review.md"), reviewContent);
      taskPhase(taskId, "code_review", "done", "changes_requested");
    }
    return { agent: "claude", sessionId: null, exitCode: 0 };
  }
  info(`Phase: code_review (Claude${state.isBundle ? " bundle" : ""}, iteration ${maxIter + 1})`);
  for (const t of tasks) taskPhase(t.taskId, "code_review", "in_progress");
  if (isWorktreeEnabled(taskIds)) {
    const artifacts = ["spec.md", "spec-review.md", "plan.md", "notes.md"];
    for (const taskId of taskIds) {
      const srcDir = taskDirFor(taskId);
      const dstDir = path10.join(activeCwd, "tasks", taskId);
      fs9.mkdirSync(dstDir, { recursive: true });
      for (const file of artifacts) {
        const src = path10.join(srcDir, file);
        const dst = path10.join(dstDir, file);
        if (fs9.existsSync(src)) {
          try {
            fs9.copyFileSync(src, dst);
          } catch {
          }
        }
      }
    }
    info("Synced task artifacts from main worktree into task worktree for review.");
  }
  const cfg = getClaudeConfig("code_review", tasks);
  const reviewResumeId = maxIter > 0 ? resumeId : null;
  const scopedDiff = getScopedDiff(baseBranch, activeCwd);
  const result = await runClaude(promptCodeReview(state, baseBranch, scopedDiff), interactive, reviewResumeId, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "code_review",
    iteration: maxIter
  }, activeCwd);
  for (const t of tasks) {
    const reviewPath = path10.join(resolveTaskCwd(t.taskId), "tasks", t.taskId, "review.md");
    let reviewContent = null;
    try {
      reviewContent = fs9.readFileSync(reviewPath, "utf8");
    } catch {
    }
    if (isTemplateUnfilled(reviewContent)) {
      warn(`[${t.taskId}] review.md is still the template after code_review run \u2014 sub-agent did not write it. Resetting to pending for retry.`);
      taskPhase(t.taskId, "code_review", "pending");
    }
  }
  return { agent: "claude", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/phases/implement.ts
import fs10 from "fs";
import path11 from "path";

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
    const args = resumeId ? ["exec", "resume", resumeId, "--json", ...effortFlag, effectivePrompt, "-m", model] : ["exec", "--json", ...effortFlag, effectivePrompt, "-m", model, "-C", cwd];
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
  return tasks.some((t) => t.iterations_current_loop > 0);
}
async function runImplementPhase(state, interactive, resumeId) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  commitTaskArtifactsToBase(taskIds, TASK_ARTIFACT_FILES);
  ensureBranch(taskIds);
  if (isWorktreeEnabled(taskIds)) {
    const wt = getActiveCwd(taskIds);
    const artifacts = ["spec.md", "spec-review.md", "plan.md", "notes.md"];
    for (const taskId of taskIds) {
      const srcDir = taskDirFor(taskId);
      const dstDir = path11.join(wt, "tasks", taskId);
      fs10.mkdirSync(dstDir, { recursive: true });
      for (const file of artifacts) {
        const src = path11.join(srcDir, file);
        const dst = path11.join(dstDir, file);
        if (fs10.existsSync(src)) {
          try {
            fs10.copyFileSync(src, dst);
          } catch {
          }
        }
      }
    }
    info("Synced task artifacts from main worktree into task worktree for implement.");
  }
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
      iteration: tasks[0].iterations_current_loop
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
import fs11 from "fs";
import path12 from "path";
async function runPlanPhase(state, interactive) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  info(`Phase: plan (Claude writes plan${state.isBundle ? "s" : ""})`);
  for (const t of tasks) taskPhase(t.taskId, "plan", "in_progress");
  const cfg = getClaudeConfig("plan", tasks);
  const result = await runClaude(promptPlan(state), interactive, null, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "plan",
    iteration: tasks[0].status.phases.plan?.iterations_current_loop ?? tasks[0].status.phases.plan?.iterations ?? 0
  });
  for (const t of tasks) {
    const planPath = path12.join(taskDirFor(t.taskId), "plan.md");
    let planContent = null;
    try {
      planContent = fs11.readFileSync(planPath, "utf8");
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
import fs12 from "fs";
import path13 from "path";
async function runQaPhase(state, interactive) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  verifyBranch(taskIds);
  info(`Phase: qa (Claude writes QA${state.isBundle ? " for bundle" : ""})`);
  for (const t of tasks) taskPhase(t.taskId, "qa", "in_progress");
  const cfg = getClaudeConfig("qa", tasks);
  const result = await runClaude(promptQa(state), interactive, null, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "qa",
    iteration: tasks[0].status.phases.qa?.iterations_current_loop ?? tasks[0].status.phases.qa?.iterations ?? 0
  }, getActiveCwd(taskIds));
  if (!state.isBundle && result.capturedStdout) {
    const taskId = taskIds[0];
    const donePath = path13.join(getActiveCwd(taskIds), "tasks", taskId, "done.md");
    if (isDoneMdTemplate(donePath)) {
      const salvaged = extractDoneMdFromStdout(result.capturedStdout);
      if (salvaged) {
        fs12.writeFileSync(donePath, salvaged);
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
    const result2 = await runClaude(promptSpecRevision(state), interactive, resumeId, cfg2.model, cfg2.effort, {
      taskId: taskIds.join("+"),
      phase: "spec",
      iteration: tasks[0].status.phases.spec?.iterations_current_loop ?? tasks[0].status.phases.spec?.iterations ?? 0
    });
    return { agent: "claude", sessionId: result2.sessionId, exitCode: result2.exitCode };
  }
  const label = state.tier === "fast" ? "spec+plan" : "spec";
  info(`Phase: spec (Claude writes ${label}${state.isBundle ? " for bundle" : ""})`);
  for (const t of tasks) taskPhase(t.taskId, "spec", "in_progress");
  const cfg = getClaudeConfig("spec", tasks);
  const result = await runClaude(promptSpec(state), interactive, null, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "spec",
    iteration: tasks[0].status.phases.spec?.iterations_current_loop ?? tasks[0].status.phases.spec?.iterations ?? 0
  });
  return { agent: "claude", sessionId: result.sessionId, exitCode: result.exitCode };
}

// scripts/run-task/phases/spec-review.ts
import fs13 from "fs";
import path14 from "path";
function autoBlockSpecReview(taskIds, iterationCount, reason) {
  autoBlockPhase(taskIds, "spec_review", iterationCount, reason);
}
async function runSpecReviewPhase(state, interactive, resumeId) {
  const { tasks } = state;
  const taskIds = tasks.map((t) => t.taskId);
  if (state.tier === "fast") {
    const anyGateOn = tasks.some((t) => t.status.human_spec_gate);
    if (anyGateOn) {
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
  const result = await runCodex(specReviewPrompt, interactive, resumeId, cfg.model, cfg.effort, {
    taskId: taskIds.join("+"),
    phase: "spec_review",
    iteration: maxSpecIter
  });
  for (const t of tasks) {
    const reviewPath = path14.join(resolveTaskCwd(t.taskId), "tasks", t.taskId, "spec-review.md");
    let reviewContent = null;
    try {
      reviewContent = fs13.readFileSync(reviewPath, "utf8");
    } catch {
    }
    if (isTemplateUnfilled(reviewContent)) {
      warn(`[${t.taskId}] spec-review.md is still the template after spec_review run \u2014 sub-agent did not write it. Resetting to pending for retry.`);
      taskPhase(t.taskId, "spec_review", "pending");
    }
  }
  return { agent: "codex", sessionId: result.sessionId, exitCode: result.exitCode };
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
  dryRun: false
};
var ghAvailable = false;
var lastClaudeSessionId = null;
var lastCodexSessionId = null;
var lastCodexExitStatus = 0;
var die2 = die;
var info2 = info;
var warn2 = warn;
var taskDirFor2 = taskDirFor;
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
  const notesPath = path15.join(taskDirFor2(taskIds[0]), "notes.md");
  try {
    fs14.mkdirSync(path15.dirname(notesPath), { recursive: true });
    fs14.appendFileSync(
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
  const baseRefForLog = getBaseBranch(taskIds);
  for (const f of allHandoffFiles) {
    if (dirtyFiles.has(f)) continue;
    if (gitIgnoredHandoffFiles.has(f)) continue;
    const exists = fs14.existsSync(path15.join(cwd, f));
    if (!exists) {
      const committed = gitSafeAt(cwd, "log", "--format=%H", "--max-count=1", `${baseRefForLog}..HEAD`, "--", f);
      if (committed.ok && committed.stdout.trim()) continue;
      missing.push(`${f} \u2014 listed in handoff but missing from working tree (and no commit in ${baseRefForLog}..HEAD touches this path)`);
      continue;
    }
    const tracked = gitSafeAt2(cwd, "ls-files", "--error-unmatch", "--", f).ok;
    if (!tracked) {
      missing.push(`${f} \u2014 untracked on disk but git status did not report it (report this as a bug)`);
    }
  }
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
  const addResult = gitSafeAt(cwd, "add", "-A", "--", ...handoffFiles);
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
function humanReviewAllowedPath(taskIds, filePath) {
  return taskIds.some((taskId) => filePath === `tasks/${taskId}` || filePath.startsWith(`tasks/${taskId}/`)) || PIPELINE_SHARED_DOCS.some((pathName) => pathName === filePath);
}
function mirrorHumanReviewDocsToCwd(cwd) {
  if (cwd === REPO_ROOT2) return;
  for (const relPath of PIPELINE_SHARED_DOCS) {
    const src = path15.join(REPO_ROOT2, relPath);
    const dest = path15.join(cwd, relPath);
    if (!fs14.existsSync(src)) continue;
    const dirty = gitSafeAtRaw(cwd, "status", "--porcelain=v1", "--", relPath);
    if (dirty.ok && dirty.stdout.trim()) continue;
    try {
      fs14.mkdirSync(path15.dirname(dest), { recursive: true });
      fs14.copyFileSync(src, dest);
    } catch {
    }
  }
}
function buildHumanReviewStagePaths(taskIds, dirtyEntries) {
  const stagePaths = /* @__PURE__ */ new Set();
  for (const taskId of taskIds) {
    if (dirtyEntries.some((entry) => entry.paths.some((pathName) => pathName === `tasks/${taskId}` || pathName.startsWith(`tasks/${taskId}/`)))) {
      stagePaths.add(path15.join("tasks", taskId));
    }
  }
  for (const relPath of PIPELINE_SHARED_DOCS) {
    if (dirtyEntries.some((entry) => entry.paths.some((pathName) => pathName === relPath))) {
      stagePaths.add(relPath);
    }
  }
  return [...stagePaths];
}
function findPullRequestTemplate(repoRoot) {
  const candidates = [
    path15.join(repoRoot, ".github", "pull_request_template.md"),
    path15.join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE.md"),
    path15.join(repoRoot, "docs", "pull_request_template.md"),
    path15.join(repoRoot, "docs", "PULL_REQUEST_TEMPLATE.md"),
    path15.join(repoRoot, "pull_request_template.md"),
    path15.join(repoRoot, "PULL_REQUEST_TEMPLATE.md")
  ];
  for (const candidate of candidates) {
    if (fs14.existsSync(candidate)) return candidate;
  }
  return null;
}
function resolveCanonPrBody(taskIds, title, env = process.env) {
  const template = env.CANON_PR_BODY;
  if (template === void 0 || template === "") return null;
  const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(", ");
  return template.replaceAll("$LABEL", label).replaceAll("$TITLE", title);
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
    const templatePath = findPullRequestTemplate(REPO_ROOT2);
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
function commitHumanReviewFiles(taskIds, cwd) {
  mirrorHumanReviewDocsToCwd(cwd);
  const dirtyResult = gitSafeAtRaw2(cwd, "status", "--porcelain=v1", "-uall");
  if (!dirtyResult.ok) {
    die2(`Human review commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || "unknown error"}`);
  }
  const dirtyEntries = parsePorcelainEntries(dirtyResult.stdout);
  if (dirtyEntries.length === 0 && (cliArgs.pr || cliArgs.push)) {
    const branchResult2 = gitSafeAt2(cwd, "rev-parse", "--abbrev-ref", "HEAD");
    const branchName2 = branchResult2.ok ? branchResult2.stdout.trim() : "";
    if (branchName2) {
      const baseBranch = getBaseBranch(taskIds);
      const openPR = cliArgs.pr && ghAvailable ? findOpenPRNumber(branchName2, baseBranch) : null;
      info2(`Clean tree. Pushing ${branchName2}...`);
      const pushResult2 = gitSafeAt2(cwd, "push", "origin", branchName2);
      if (!pushResult2.ok) {
        die2(`Human review push failed: ${pushResult2.stderr || "unknown error"}`);
      }
      if (cliArgs.pr && openPR !== null) {
        const prUrl = lookupPRUrl(openPR);
        info2(formatExistingPRMessage(openPR, prUrl));
        return;
      }
      if (cliArgs.pr) {
        createDraftPRForTask(taskIds, branchName2);
      }
      return;
    }
  }
  if (dirtyEntries.length === 0) {
    die2("Human review commit aborted: no dirty task artifacts, telemetry, or managed docs to commit.");
  }
  const unexpected = dirtyEntries.filter((entry) => !entry.paths.every((pathName) => humanReviewAllowedPath(taskIds, pathName)));
  if (unexpected.length > 0) {
    die2(
      `Human review commit aborted: working tree has dirty files outside the human_review allowlist.
` + unexpected.map((entry) => `    ${entry.raw}`).join("\n") + `
  Stage only task artifacts, telemetry, and managed docs before rerunning.`
    );
  }
  const stagePaths = new Set(buildHumanReviewStagePaths(taskIds, dirtyEntries));
  if (stagePaths.size === 0) {
    die2("Human review commit aborted: no allowed dirty files found to stage.");
  }
  const stagedBefore = gitSafeAt2(cwd, "diff", "--cached", "--name-only");
  if (!stagedBefore.ok) {
    die2(`Human review commit aborted: could not inspect staged files: ${stagedBefore.stderr || "unknown error"}`);
  }
  const stagedBeforeUnexpected = stagedBefore.stdout.split("\n").map((line) => line.trim()).filter(Boolean).filter((filePath) => !humanReviewAllowedPath(taskIds, filePath));
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
  const stagedUnexpected = stagedNames.filter((filePath) => !humanReviewAllowedPath(taskIds, filePath));
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
  if (cliArgs.pr) {
    createDraftPRForTask(taskIds, branchName);
  }
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
function assertLocalBaseInSyncWithOrigin(taskIds) {
  const baseBranch = getBaseBranch2(taskIds);
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
function assertOriginTaskBranchAbsent(taskId) {
  const branchName = resolveTaskBranchName(taskId);
  const baseBranch = getBaseBranch([taskId]);
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
function assertNoOpenPRForTask(taskId) {
  const branchName = resolveTaskBranchName(taskId);
  const baseBranch = getBaseBranch([taskId]);
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
function mergeOpenPRsAndPull(taskIds) {
  const baseBranch = getBaseBranch(taskIds);
  const branches = [...new Set(taskIds.map((id) => resolveTaskBranchName(id)))];
  let anyMerged = false;
  for (const branch of branches) {
    const prNum = findOpenPRNumber(branch, baseBranch);
    if (!prNum) continue;
    info(`Merging PR #${prNum} (${branch} \u2192 ${baseBranch}) via squash...`);
    const result = runCommand("gh", ["pr", "merge", String(prNum), "--squash", "--delete-branch"]);
    if (!result.ok && !result.stderr.includes("already merged")) {
      die(`Failed to merge PR #${prNum}: ${result.stderr}`);
    }
    info(`PR #${prNum} merged.`);
    anyMerged = true;
  }
  if (anyMerged) {
    info(`Pulling ${baseBranch}...`);
    git("pull", "origin", baseBranch);
  }
  return anyMerged;
}
function runPostMergeHook() {
  const hookPath = path15.join(REPO_ROOT2, ".canon/hooks/post-merge.sh");
  if (!fs14.existsSync(hookPath)) return;
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
function maybeCreateGitHubRelease(baseBranch) {
  if (!ghAvailable) return;
  if (!baseBranch.startsWith("release/")) return;
  let version;
  try {
    const pkg = JSON.parse(fs14.readFileSync(path15.join(REPO_ROOT2, "package.json"), "utf8"));
    version = pkg.version ?? "";
  } catch {
    warn2("Could not read package.json version \u2014 skipping GitHub release creation.");
    return;
  }
  if (!version) {
    warn2("package.json has no version field \u2014 skipping GitHub release creation.");
    return;
  }
  const tag = `v${version}`;
  info2(`Creating GitHub release ${tag}...`);
  let notes = `Release ${tag}`;
  try {
    const changelog = fs14.readFileSync(path15.join(REPO_ROOT2, "CHANGELOG.md"), "utf8");
    const match = changelog.match(new RegExp(`(## v${version.replace(".", "\\.")}[\\s\\S]*?)(?=
## |$)`));
    if (match) notes = match[1].trim();
  } catch {
  }
  const result = runCommand2("gh", [
    "release",
    "create",
    tag,
    "--title",
    tag,
    "--notes",
    notes
  ]);
  if (!result.ok) {
    warn2(`GitHub release creation failed: ${result.stderr || "unknown error"}`);
  } else {
    info2(`GitHub release ${tag} created: ${result.stdout.trim()}`);
  }
}
function rewriteArchivedTaskRefs(taskIds) {
  const targets = [
    path15.join(REPO_ROOT2, "docs", "lessons-learned.md"),
    path15.join(REPO_ROOT2, "docs", "task-quality-log.md")
  ];
  for (const filePath of targets) {
    if (!fs14.existsSync(filePath)) continue;
    let content = fs14.readFileSync(filePath, "utf8");
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
      fs14.writeFileSync(filePath, content, "utf8");
      info2(`Updated stale task refs in ${path15.relative(REPO_ROOT2, filePath)}.`);
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
    const tasksRootForGate = process.env.CANON_TASKS_DIR_OVERRIDE ?? path15.join(taskCwd, "tasks");
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
  if (taskIds.some((id) => readStatus(id).worktree === true)) flushWorktreeTelemetry();
  ensureCheckedOutBaseBranch(taskIds);
  const merged = mergeOpenPRsAndPull(taskIds);
  if (!merged) {
    assertLocalBaseInSyncWithOrigin(taskIds);
    for (const taskId of taskIds) assertNoOpenPRForTask(taskId);
    for (const taskId of taskIds) assertOriginTaskBranchAbsent(taskId);
  }
  runPostMergeHook();
  const baseBranch = getBaseBranch(taskIds);
  const archiveDir = path15.join(TASKS_DIR2, "_archive");
  if (!fs14.existsSync(archiveDir)) fs14.mkdirSync(archiveDir, { recursive: true });
  const localBranchesToDelete = [];
  for (const taskId of taskIds) {
    const status = readStatus(taskId);
    const hasWorktree = status.worktree === true;
    if (hasWorktree) teardownWorktree(taskId);
    status.updated = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const humanReview = status.phases.human_review;
    if (humanReview) humanReview.status = "done";
    writeStatusToFile(path15.join(REPO_ROOT2, "tasks", taskId, "status.json"), status);
    const src = taskDirFor2(taskId);
    const dest = path15.join(archiveDir, taskId);
    fs14.renameSync(src, dest);
    info2(`\u{1F4E6} ${taskId} \u2192 tasks/_archive/${taskId}`);
    const branchName = resolveTaskBranchName(taskId);
    if (branchExistsLocally(branchName)) localBranchesToDelete.push(branchName);
  }
  rewriteArchivedTaskRefs(taskIds);
  const stagedPaths = taskIds.flatMap((id) => [
    path15.join(TASKS_DIR2, id),
    // deleted source (if not cleaned up)
    path15.join(TASKS_DIR2, "_archive", id),
    // new archive destination
    path15.join(REPO_ROOT2, "docs", "lessons-learned.md"),
    path15.join(REPO_ROOT2, "docs", "task-quality-log.md")
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
  maybeCreateGitHubRelease(baseBranch);
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
  info(`Rerouting: human_review \u2192 implement (resetting implement, code_review, qa)`);
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
    }
    const qa = status.phases.qa;
    if (qa) qa.status = "pending";
    const humanReview = status.phases.human_review;
    if (humanReview) humanReview.status = "pending";
    writeStatus(taskId, status);
  }
  info("Status reset. Pipeline will resume from implement phase with amended-spec context.");
  info("Note: Codex will re-read spec.md carefully (looking for new Amendment sections) and update the implementation.");
  info("");
  info("\u26A0  Before invoking the pipeline: ensure tasks/<id>/spec.md (in the MAIN repo, not the worktree) has an");
  info("   Amendment section with the new requirements. review.md alone is not sufficient \u2014 Codex reads spec.md");
  info("   as the contract. The main-repo spec is synced into the worktree at the start of implement.");
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
    return runImplementPhase(state, cliArgs.interactive, codexSession);
  }
  if (phase === "code_review") {
    return runCodeReviewPhase(state, cliArgs.interactive, reviewClaudeSession);
  }
  if (phase === "qa") {
    return runQaPhase(state, cliArgs.interactive);
  }
  if (phase === "human_review") {
    const taskIds2 = tasks.map((t) => t.taskId);
    if (cliArgs.push || cliArgs.pr) {
      const cwd = getActiveCwd(taskIds2);
      commitHumanReviewFiles(taskIds2, cwd);
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
      commitHumanReviewFiles(taskIds2, cwd);
      process.exit(0);
    }
    printCompleteStateBanner(taskIds2);
    process.exit(0);
  }
  die2(`Unknown phase: ${String(phase)}`);
}
var extractCheckedVerdict2 = extractCheckedVerdict;
function readArtifact(taskId, name) {
  const p = path15.join(taskDirFor2(taskId), name);
  try {
    return fs14.readFileSync(p, "utf8");
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
        path15.join(taskDirFor2(taskId), "spec.md"),
        path15.join(taskDirFor2(taskId), "handoff.md")
      );
      if (issues.length > 0) return { advanced: false, note: `handoff.md validation failed: ${issues.join("; ")}` };
      const checkRoots = [REPO_ROOT2];
      const sForEvidence = readStatus(taskId);
      if (sForEvidence.worktree === true) {
        const wt = worktreePath(taskId);
        if (fs14.existsSync(wt)) checkRoots.push(wt);
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
        (f) => checkRoots.some((root) => fs14.existsSync(path15.join(root, f)))
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
      const verdict = extractCheckedVerdict2(content);
      if (!verdict) return { advanced: false, note: "no verdict box checked in spec-review.md" };
      taskPhase(taskId, "spec_review", "done", verdict);
      return { advanced: true, verdict, note: `verdict=${verdict}` };
    }
    case "plan": {
      const content = readArtifact(taskId, "plan.md");
      if (isTemplateUnfilled(content)) return { advanced: false, note: "plan.md is missing or still the template" };
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
      const donePath = path15.join(taskDirFor(taskId), "done.md");
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
  const isWorktreePhase = phase === "implement" || phase === "code_review";
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
      if (anyChangesRequested) {
        info2("Spec review requested changes \u2014 routing back to spec.");
        routeBackTo(taskIds, "spec");
        return;
      }
      const tier = detectTier2(statuses);
      if (tier === "full" && statuses.some((s) => s.human_spec_gate)) {
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
    ghAvailable = isCommandAvailable("gh");
    info(ghAvailable ? "gh CLI found \u2014 draft PR creation is available." : "gh CLI not found \u2014 PR creation will be unavailable. Push still works.");
  }
  for (const taskId of taskIds) {
    validateTaskId(taskId);
    if (!fs14.existsSync(statusFileFor(taskId))) {
      die(`No status.json at tasks/${taskId}/status.json \u2014 run canon task new ${taskId} first`);
    }
  }
}
async function main() {
  process.env.RUN_TASK_ORCHESTRATOR = "1";
  cliArgs = parseArgs(process.argv.slice(2));
  warnLegacyEnvVars();
  warnWorktreesRootMismatch();
  const skipAgentDeps = cliArgs.ship || cliArgs.dryRun;
  checkDeps(cliArgs.taskIds, skipAgentDeps);
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
  refreshCanonSnapshotsAtPaths(taskIds.map(statusFileFor));
  const initialState = buildPipelineState(taskIds);
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
    if (isWorktreeEnabled(taskIds)) {
      syncWorktreeArtifacts(taskIds);
      syncWorktreeTelemetry(taskIds);
    }
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
void main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
/*! Bundled license information:

mustache/mustache.mjs:
  (*!
   * mustache.js - Logic-less {{mustache}} templates with JavaScript
   * http://github.com/janl/mustache.js
   *)
*/
