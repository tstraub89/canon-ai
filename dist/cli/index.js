#!/usr/bin/env node

// src/cli/commands/doctor.ts
import { execSync as execSync2 } from "child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "fs";
import { homedir } from "os";
import { join, sep as pathSep } from "path";

// scripts/run-task/heartbeat.ts
import fs from "fs";
import path from "path";
var HEARTBEAT_FILENAME = ".heartbeat.json";
var HEARTBEAT_INTERVAL_MS = 3e4;
var HEARTBEAT_STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 2;
function removeHeartbeat(taskDir) {
  try {
    fs.unlinkSync(path.join(taskDir, ".heartbeat.json"));
  } catch {
  }
}
function readHeartbeatStatus(taskDir) {
  const file = path.join(taskDir, HEARTBEAT_FILENAME);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    const err = error;
    if (err.code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable", reason: err.message ?? String(error) };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "corrupt", reason: `invalid JSON: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || typeof parsed.pid !== "number" || typeof parsed.started_at_ms !== "number" || typeof parsed.last_update_ms !== "number" || !Array.isArray(parsed.task_ids)) {
    return { kind: "corrupt", reason: "wrong shape \u2014 missing or mistyped required fields" };
  }
  return { kind: "found", record: parsed };
}
function isHeartbeatStale(record, now = Date.now()) {
  if (!record) return true;
  return now - record.last_update_ms > HEARTBEAT_STALE_AFTER_MS;
}

// scripts/run-task/run-context.ts
import path5 from "path";

// scripts/run-task/detach.ts
import { spawn } from "child_process";
import fs2 from "fs";
import path2 from "path";
var PID_FILENAME = ".canon-pid";
var LOG_FILENAME = ".canon-run.log";
function readCanonPid(taskDir) {
  const file = path2.join(taskDir, PID_FILENAME);
  try {
    const raw = fs2.readFileSync(file, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
function removeCanonPid(taskDir) {
  try {
    fs2.unlinkSync(path2.join(taskDir, PID_FILENAME));
  } catch {
  }
}
function runLogPathFor(taskDir) {
  return path2.join(taskDir, LOG_FILENAME);
}

// scripts/run-task/state.ts
import fs5 from "fs";
import { spawnSync as spawnSync2 } from "child_process";
import path4 from "path";

// scripts/run-task/cli.ts
import fs3 from "fs";
var exitReason = null;
var originalProcessExit = process.exit.bind(process);
function setExitReason(reason) {
  exitReason = reason;
}
function die(message) {
  setExitReason(message);
  console.error(`\u274C ${message}`);
  process.exit(1);
}

// scripts/run-task/env.ts
import { spawnSync } from "child_process";
import fs4 from "fs";
import path3 from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
function resolveRepoRoot() {
  try {
    const result = spawnSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(result.stderr || "git rev-parse --git-common-dir failed");
    }
    const gitCommonDir = result.stdout.trim();
    if (!gitCommonDir) throw new Error("git rev-parse --git-common-dir returned no path");
    const resolvedGitCommonDir = path3.isAbsolute(gitCommonDir) ? gitCommonDir : path3.resolve(process.cwd(), gitCommonDir);
    return path3.dirname(resolvedGitCommonDir);
  } catch {
    return path3.resolve(__dirname, "../..");
  }
}
var REPO_ROOT = resolveRepoRoot();
var TASKS_DIR = path3.join(REPO_ROOT, "tasks");
var WORKTREES_ROOT = process.env.CANON_WORKTREES_ROOT ? path3.resolve(process.env.CANON_WORKTREES_ROOT) : path3.resolve(REPO_ROOT, "../dev-worktrees");
var STALL_TIMEOUT_MS = Number(process.env.PIPELINE_STALL_TIMEOUT_MS) || 10 * 60 * 1e3;
function resolveProjectName() {
  if (process.env.CANON_PROJECT_NAME) return process.env.CANON_PROJECT_NAME;
  try {
    const pkgPath = path3.join(REPO_ROOT, "package.json");
    if (fs4.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs4.readFileSync(pkgPath, "utf8"));
      if (pkg.name) return pkg.name;
    }
  } catch {
  }
  return "your project";
}
var config = {
  projectName: resolveProjectName(),
  claudeBudget: process.env.CLAUDE_BUDGET ?? null,
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

// scripts/run-task/types.ts
var PHASE_ORDER = ["spec", "spec_review", "plan", "implement", "code_review", "qa", "human_review"];

// scripts/run-task/state.ts
function effectiveWorktreesRoot() {
  return process.env.CANON_WORKTREES_ROOT ? path4.resolve(process.env.CANON_WORKTREES_ROOT) : WORKTREES_ROOT;
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
  return path4.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR, taskId);
}
function taskDirFor(taskId) {
  if (process.env.CANON_TASKS_DIR_OVERRIDE) {
    return path4.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId);
  }
  return path4.join(resolveTaskCwd(taskId), "tasks", taskId);
}
function isOrphanedWorktreeState(taskId) {
  const worktreesRoot = effectiveWorktreesRoot();
  const directWorktree = path4.join(worktreesRoot, taskId);
  const directStatus = path4.join(directWorktree, "tasks", taskId, "status.json");
  if (fs5.existsSync(directStatus)) return false;
  const statusPath = path4.join(taskDirForRepoRoot(taskId), "status.json");
  try {
    const parsed = JSON.parse(fs5.readFileSync(statusPath, "utf8"));
    if (parsed.worktree !== true) return false;
    const branch = parsed.branch?.trim() ?? "";
    if (!branch) return false;
    return findExistingWorktreeForBranch(branch) === null;
  } catch {
    return false;
  }
}
function resolveTaskCwd(taskId) {
  const worktreesRoot = effectiveWorktreesRoot();
  const directWorktree = path4.join(worktreesRoot, taskId);
  const directStatus = path4.join(directWorktree, "tasks", taskId, "status.json");
  if (fs5.existsSync(directStatus)) return directWorktree;
  const statusPath = path4.join(taskDirForRepoRoot(taskId), "status.json");
  try {
    const parsed = JSON.parse(fs5.readFileSync(statusPath, "utf8"));
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
    return path4.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId, "status.json");
  }
  return path4.join(resolveTaskCwd(taskId), "tasks", taskId, "status.json");
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
function readStatusFromPath(statusFile, taskIdForErrors = "<unknown>") {
  const parsed = JSON.parse(fs5.readFileSync(statusFile, "utf8"));
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

// scripts/run-task/run-context.ts
function statusReadResult(taskId, statusFile, readImpl) {
  try {
    if (readImpl) {
      return { kind: "ok", file: statusFile, status: readImpl(statusFile) };
    }
    return { kind: "ok", file: statusFile, status: readStatusFromPath(statusFile, taskId) };
  } catch (error) {
    if (getErrnoCode(error) === "ENOENT") {
      return { kind: "missing", file: statusFile };
    }
    return {
      kind: "error",
      file: statusFile,
      reason: errorMessage(error)
    };
  }
}
function tolerantTaskDir(taskId) {
  if (isOrphanedWorktreeState(taskId)) return taskDirForRepoRoot(taskId);
  return path5.dirname(statusFileFor(taskId));
}
function defaultProbeAlive(pid) {
  process.kill(pid, 0);
}
function getErrnoCode(error) {
  if (typeof error !== "object" || error === null) return void 0;
  const code = error.code;
  return typeof code === "string" ? code : void 0;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isStatusJson(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.id === "string" && typeof record.phases === "object" && record.phases !== null;
}
function probePidAlive(pid, probeImpl = defaultProbeAlive) {
  try {
    probeImpl(pid);
    return true;
  } catch (error) {
    return getErrnoCode(error) === "EPERM";
  }
}
function gatherRunContext(taskId, deps = {}) {
  const taskDir = (deps.resolveTaskDirImpl ?? tolerantTaskDir)(taskId);
  const statusFile = path5.join(taskDir, "status.json");
  const heartbeatFile = path5.join(taskDir, ".heartbeat.json");
  const statusResult = statusReadResult(taskId, statusFile, deps.readStatusImpl);
  const heartbeatResult = (deps.readHeartbeatImpl ?? readHeartbeatStatus)(taskDir);
  const canonPid = (deps.readCanonPidImpl ?? readCanonPid)(taskDir);
  const probeImpl = deps.probeAliveImpl;
  const canonAlive = canonPid != null ? probePidAlive(canonPid, probeImpl) : false;
  const heartbeatPid = heartbeatResult.kind === "found" ? heartbeatResult.record.pid : null;
  const heartbeatAlive = heartbeatPid != null ? probePidAlive(heartbeatPid, probeImpl) : false;
  const ambiguousPid = canonPid != null && heartbeatPid != null && canonPid !== heartbeatPid && canonAlive && heartbeatAlive ? { canonPid, heartbeatPid } : null;
  const heartbeatDisagrees = canonPid != null && heartbeatPid != null && heartbeatPid !== canonPid;
  let resolvedPid = null;
  if (ambiguousPid != null) {
    resolvedPid = null;
  } else if (heartbeatDisagrees) {
    resolvedPid = heartbeatPid;
  } else if (canonAlive) {
    resolvedPid = canonPid;
  } else if (heartbeatAlive) {
    resolvedPid = heartbeatPid;
  } else if (canonPid != null) {
    resolvedPid = canonPid;
  } else if (heartbeatResult.kind === "found") {
    resolvedPid = heartbeatResult.record.pid;
  }
  const launchWindow = canonPid != null && canonAlive && heartbeatResult.kind === "missing";
  return {
    taskId,
    taskDir,
    statusFile,
    heartbeatFile,
    statusResult,
    heartbeatResult,
    canonPid,
    resolvedPid,
    ambiguousPid,
    launchWindow
  };
}

// src/lib/canon-block.ts
var CANON_START_LINE_RE = /^[ \t]*# canon:start[ \t]*(?:\r?\n|$)/gm;
var CANON_END_LINE_RE = /^[ \t]*# canon:end[ \t]*(?:\r?\n|$)/gm;
var CANON_RUNTIME_GITIGNORE_PATTERNS = [
  "tasks/**/.canon-pid",
  "tasks/**/.canon-run.log",
  "tasks/**/.heartbeat.json",
  "tasks/**/.pr-number"
];
var CANON_GITIGNORE_BLOCK = [
  "# canon:start",
  "# This block is managed by canon. Edits are overwritten on `canon upgrade`.",
  ...CANON_RUNTIME_GITIGNORE_PATTERNS,
  "# canon:end"
].join("\n") + "\n";
function findCanonBlockRange(content) {
  CANON_START_LINE_RE.lastIndex = 0;
  const startMatch = CANON_START_LINE_RE.exec(content);
  if (!startMatch) return null;
  CANON_END_LINE_RE.lastIndex = startMatch.index + startMatch[0].length;
  const endMatch = CANON_END_LINE_RE.exec(content);
  if (!endMatch) return "malformed";
  return {
    startIndex: startMatch.index,
    endIndex: endMatch.index + endMatch[0].length
  };
}
function withSingleTrailingNewline(content) {
  return content.replace(/(?:\r?\n)*$/, "") + "\n";
}
function appendCanonBlock(content, block) {
  if (content.length === 0) return block;
  if (/(?:\r?\n){2}$/.test(content)) return content + block;
  if (/\r?\n$/.test(content)) return content + "\n" + block;
  return content + "\n\n" + block;
}
function upsertCanonBlock(content, block) {
  const normalizedBlock = withSingleTrailingNewline(block);
  const range = findCanonBlockRange(content);
  if (range === "malformed") return null;
  if (range === null) return appendCanonBlock(content, normalizedBlock);
  return content.slice(0, range.startIndex) + normalizedBlock + content.slice(range.endIndex);
}

// src/cli/deps.ts
import { execSync } from "child_process";
var HARD_DEPS = [
  { cmd: "git", installHint: "https://git-scm.com/downloads" },
  { cmd: "claude", installHint: "npm install -g @anthropic-ai/claude-code" },
  { cmd: "codex", installHint: "npm install -g @openai/codex" }
];
var SOFT_DEPS = [
  { cmd: "gh", installHint: "brew install gh && gh auth login  (required for --pr / --push)" }
];
function isAvailable(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function checkDeps() {
  const missing = HARD_DEPS.filter((d) => !isAvailable(d.cmd));
  if (missing.length > 0) {
    console.error("canon init requires the following tools to be installed:\n");
    for (const dep of missing) {
      console.error(`  \u2717 ${dep.cmd}
    ${dep.installHint}`);
    }
    console.error("");
    process.exit(1);
  }
  const softMissing = SOFT_DEPS.filter((d) => !isAvailable(d.cmd));
  for (const dep of softMissing) {
    console.warn(`  \u26A0  ${dep.cmd} not found \u2014 needed later: ${dep.installHint}`);
  }
}
function checkDepForFlag(flag) {
  const flagDeps = {
    "--pr": { cmd: "gh", installHint: "brew install gh && gh auth login" },
    "--push": { cmd: "gh", installHint: "brew install gh && gh auth login" },
    "--full-send": { cmd: "gh", installHint: "brew install gh && gh auth login" }
  };
  const dep = flagDeps[flag];
  if (dep && !isAvailable(dep.cmd)) {
    console.error(`${flag} requires the GitHub CLI:
  ${dep.installHint}`);
    process.exit(1);
  }
}

// src/cli/commands/doctor.ts
var EXPECTED_TEMPLATES = [
  "spec.md",
  "plan.md",
  "handoff.md",
  "review.md",
  "done.md",
  "spec-review.md",
  "notes.md",
  "status.json",
  "pr-body.md"
];
var RECOMMENDED_ALLOW = [
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
  // Both bare and `*`-suffixed forms are required: Claude Code's `Bash(npm
  // test *)` pattern matches `npm test --watch` etc. but does not match
  // bare `npm test` (no trailing space for the glob to consume). Bare and
  // flagged forms are both common — CI runs `npm test` bare and
  // `npm audit --omit=dev` flagged.
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
];
var RECOMMENDED_NUDGE = [
  "This project uses canon, a spec-first multi-agent pipeline.",
  "Route new features / fixes / refactors through the canon skills.",
  "Start with `/canon-spec` rather than implementing directly."
].join("\n");
var MIN_CLAUDE_VERSION = { major: 2, minor: 1, patch: 72 };
function parseClaudeVersion(raw) {
  const match = raw.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}
function checkPlatform() {
  const isWindows = process.platform === "win32";
  if (!isWindows) return { label: "platform", status: "pass" };
  const isWSL = existsSync("/proc/version") && readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  if (isWSL) return { label: "platform (WSL)", status: "pass" };
  return {
    label: "platform",
    status: "warn",
    detail: "Windows without WSL \u2014 canon is untested here; use WSL for best results"
  };
}
function checkNodeVersion() {
  const match = process.version.match(/^v(\d+)/);
  const major = match ? parseInt(match[1], 10) : 0;
  if (major >= 24) return { label: `node ${process.version}`, status: "pass" };
  return {
    label: `node ${process.version}`,
    status: "fail",
    detail: "node 24+ required \u2014 https://nodejs.org"
  };
}
function checkBinary(cmd, required, hint) {
  if (isAvailable(cmd)) return { label: cmd, status: "pass" };
  return {
    label: cmd,
    status: required ? "fail" : "warn",
    detail: hint
  };
}
var defaultClaudeVersionRunner = () => execSync2("claude --version", { encoding: "utf8" });
function checkClaudeVersion(runner = defaultClaudeVersionRunner) {
  let raw;
  try {
    raw = runner();
  } catch {
    return {
      label: "claude (version unreadable)",
      status: "warn",
      detail: "Could not read `claude --version` output \u2014 verify your Claude Code install"
    };
  }
  const parsed = parseClaudeVersion(raw);
  if (!parsed) {
    const preview = raw.trim() || "<empty>";
    return {
      label: `claude (unparseable: ${preview.slice(0, 32)})`,
      status: "warn",
      detail: "Could not parse `claude --version` output \u2014 verify your Claude Code install"
    };
  }
  const label = `claude ${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const tooOld = parsed.major < MIN_CLAUDE_VERSION.major || parsed.major === MIN_CLAUDE_VERSION.major && parsed.minor < MIN_CLAUDE_VERSION.minor || parsed.major === MIN_CLAUDE_VERSION.major && parsed.minor === MIN_CLAUDE_VERSION.minor && parsed.patch < MIN_CLAUDE_VERSION.patch;
  if (tooOld) {
    return {
      label,
      status: "fail",
      detail: "Claude Code 2.1.72+ required \u2014 npm install -g @anthropic-ai/claude-code"
    };
  }
  return { label, status: "pass" };
}
function checkCanonDiscoveryNudge(cwd) {
  const filenames = ["CLAUDE.md", "AGENTS.md"];
  const existingFiles = filenames.filter((filename) => existsSync(join(cwd, filename)));
  if (existingFiles.length === 0) {
    return {
      label: "canon discovery nudge",
      status: "warn",
      detail: `no AGENTS.md or CLAUDE.md found \u2014 run the built-in \`/init\` (Claude Code) or Codex init to generate a high-level project overview, then add this to it:
${RECOMMENDED_NUDGE}`
    };
  }
  const mentionsCanon = existingFiles.some((filename) => {
    const path11 = join(cwd, filename);
    return /canon/i.test(readFileSync(path11, "utf8"));
  });
  if (mentionsCanon) {
    return { label: "canon discovery nudge", status: "pass" };
  }
  return {
    label: "canon discovery nudge",
    status: "warn",
    detail: `add this to CLAUDE.md:
${RECOMMENDED_NUDGE}`
  };
}
function checkCodexMdDeprecated(cwd) {
  if (!existsSync(join(cwd, "CODEX.md"))) return null;
  return {
    label: "CODEX.md",
    status: "warn",
    detail: "deprecated \u2014 no tool reads this file; it is safe to delete"
  };
}
function checkTemplates(cwd) {
  const dir = join(cwd, ".canon", "templates");
  if (!existsSync(dir)) {
    return { label: ".canon/templates/", status: "fail", detail: "missing \u2014 run `canon init`" };
  }
  const missing = EXPECTED_TEMPLATES.filter((f) => !existsSync(join(dir, f)));
  if (missing.length > 0) {
    return {
      label: ".canon/templates/",
      status: "warn",
      detail: `missing: ${missing.join(", ")}`
    };
  }
  return { label: ".canon/templates/", status: "pass" };
}
function checkCanonVersion(cwd) {
  const versionPath = join(cwd, ".canon", "version");
  const installedVersion = "2.2.0";
  if (!existsSync(versionPath)) {
    return { label: ".canon/version", status: "warn", detail: "missing \u2014 run `canon upgrade`" };
  }
  const vendoredVersion = readFileSync(versionPath, "utf8").trim();
  if (vendoredVersion !== installedVersion) {
    return {
      label: ".canon/version",
      status: "warn",
      detail: `vendored ${vendoredVersion} \u2260 installed ${installedVersion} \u2014 run \`canon upgrade\``
    };
  }
  return { label: `.canon/version (${vendoredVersion})`, status: "pass" };
}
function checkSkills(cwd) {
  const initSkill = join(cwd, ".claude", "skills", "canon-init", "SKILL.md");
  if (!existsSync(initSkill)) {
    return {
      label: ".claude/skills/",
      status: "warn",
      detail: "canon-init skill missing \u2014 run `canon init` or `canon upgrade`"
    };
  }
  const skillNames = ["canon-spec", "canon-pipeline", "canon-status", "canon-changelog", "canon-spec-review", "canon-inline-review"];
  const missing = skillNames.filter((s) => !existsSync(join(cwd, ".claude", "skills", s, "SKILL.md")));
  if (missing.length > 0) {
    return {
      label: ".claude/skills/",
      status: "warn",
      detail: `operational skills missing: ${missing.join(", ")} \u2014 run \`canon upgrade\``
    };
  }
  return { label: ".claude/skills/", status: "pass" };
}
function parseCodexProjectTrust(tomlContent) {
  const result = /* @__PURE__ */ new Map();
  const lines = tomlContent.split("\n");
  let currentProject = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\[projects\."(.+)"\]\s*(?:#.*)?$/);
    if (header) {
      currentProject = header[1];
      continue;
    }
    if (trimmed.startsWith("[")) {
      currentProject = null;
      continue;
    }
    if (currentProject) {
      const trust = trimmed.match(/^trust_level\s*=\s*(?:"([^"]+)"|'([^']+)')\s*(?:#.*)?$/);
      if (trust) {
        result.set(currentProject, trust[1] ?? trust[2]);
      }
    }
  }
  return result;
}
function safeRealpathOrSelf(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}
function checkCodexProjectTrust(cwd) {
  const label = "codex project trust";
  const configPath = join(homedir(), ".codex", "config.toml");
  if (!existsSync(configPath)) {
    return {
      label,
      status: "warn",
      detail: `${configPath} not found \u2014 run \`codex\` once interactively to initialize, or add a [projects."<path>"] entry manually before \`canon run\``
    };
  }
  let trustMap;
  try {
    const content = readFileSync(configPath, "utf8");
    trustMap = parseCodexProjectTrust(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { label, status: "warn", detail: `failed to read ${configPath}: ${message}` };
  }
  let workspaceRoot = cwd;
  try {
    const out = execSync2("git rev-parse --show-toplevel", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (out) workspaceRoot = out;
  } catch {
  }
  const canonicalWorkspace = safeRealpathOrSelf(workspaceRoot);
  for (const [project, level] of trustMap) {
    const canonicalProject = safeRealpathOrSelf(project);
    if (canonicalProject === canonicalWorkspace) {
      if (level === "trusted") {
        return { label, status: "pass", detail: `${workspaceRoot} is trusted` };
      }
      return {
        label,
        status: "warn",
        detail: `${workspaceRoot} has an explicit trust_level = "${level}" in ${configPath}. Change it to "trusted" or remove the block:
        [projects."${workspaceRoot}"]
        trust_level = "trusted"`
      };
    }
  }
  const ancestors = [];
  for (const [project, level] of trustMap) {
    const canonicalProject = safeRealpathOrSelf(project);
    const prefix = canonicalProject.endsWith(pathSep) ? canonicalProject : `${canonicalProject}${pathSep}`;
    if (canonicalWorkspace.startsWith(prefix)) {
      ancestors.push({ project, level, depth: canonicalProject.length });
    }
  }
  if (ancestors.length > 0) {
    ancestors.sort((a, b) => b.depth - a.depth);
    const nearest = ancestors[0];
    if (nearest.level === "trusted") {
      return {
        label,
        status: "pass",
        detail: `inherited from trusted parent ${nearest.project}`
      };
    }
    return {
      label,
      status: "warn",
      detail: `nearest ancestor ${nearest.project} has trust_level = "${nearest.level}" \u2014 codex exec will fail. Add an explicit trusted entry for this workspace:
        [projects."${workspaceRoot}"]
        trust_level = "trusted"`
    };
  }
  return {
    label,
    status: "warn",
    detail: `${workspaceRoot} is not in ${configPath} \u2014 codex exec will fail hard on first invocation. Add this block to fix:
        [projects."${workspaceRoot}"]
        trust_level = "trusted"`
  };
}
function readAllowFromSettings(path11) {
  if (!existsSync(path11)) return { allow: /* @__PURE__ */ new Set(), status: "missing" };
  try {
    const parsed = JSON.parse(readFileSync(path11, "utf8"));
    const raw = parsed?.permissions?.allow;
    const allow = new Set(
      Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []
    );
    return { allow, status: "ok" };
  } catch {
    return { allow: /* @__PURE__ */ new Set(), status: "invalid" };
  }
}
function checkRecommendedPermissions(cwd) {
  const label = ".claude/settings.json";
  const committed = readAllowFromSettings(join(cwd, ".claude", "settings.json"));
  const local = readAllowFromSettings(join(cwd, ".claude", "settings.local.json"));
  if (committed.status === "invalid") {
    return { label, status: "warn", detail: "present but not valid JSON \u2014 review manually" };
  }
  if (local.status === "invalid") {
    return {
      label: ".claude/settings.local.json",
      status: "warn",
      detail: "present but not valid JSON \u2014 review manually"
    };
  }
  if (committed.status === "missing" && local.status === "missing") {
    return {
      label,
      status: "warn",
      detail: 'not present \u2014 see README "Skip the permission prompts" for the recommended allowlist, or rerun `/canon-init`'
    };
  }
  const allow = /* @__PURE__ */ new Set([...committed.allow, ...local.allow]);
  const missing = RECOMMENDED_ALLOW.filter((p) => !allow.has(p));
  if (missing.length === 0) {
    return { label, status: "pass", detail: "recommended canon perms present" };
  }
  if (missing.length === RECOMMENDED_ALLOW.length) {
    return {
      label,
      status: "warn",
      detail: 'no recommended canon perms allowlisted \u2014 see README "Skip the permission prompts"'
    };
  }
  const preview = missing.slice(0, 3).join(", ");
  const more = missing.length > 3 ? ` (+${missing.length - 3} more)` : "";
  return {
    label,
    status: "warn",
    detail: `missing ${missing.length} recommended perm(s): ${preview}${more} \u2014 see README`
  };
}
function checkLocalSettingsGitignored(cwd) {
  const settingsPath = join(cwd, ".claude", "settings.local.json");
  const gitignorePath = join(cwd, ".gitignore");
  if (!existsSync(settingsPath)) return { label: ".claude/settings.local.json", status: "pass", detail: "not present" };
  if (!existsSync(gitignorePath)) {
    return {
      label: ".claude/settings.local.json",
      status: "warn",
      detail: "present but no .gitignore found \u2014 add it to .gitignore to avoid leaking local settings"
    };
  }
  const gitignore = readFileSync(gitignorePath, "utf8");
  const isIgnored = gitignore.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed === ".claude/settings.local.json" || trimmed === "settings.local.json" || trimmed === ".claude/";
  });
  if (isIgnored) return { label: ".claude/settings.local.json", status: "pass", detail: "gitignored" };
  return {
    label: ".claude/settings.local.json",
    status: "warn",
    detail: "present but not in .gitignore \u2014 add `.claude/settings.local.json` to avoid leaking local settings"
  };
}
function checkRuntimeFilesGitignored(cwd) {
  const label = "runtime files .gitignored";
  const gitignorePath = join(cwd, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return {
      label,
      status: "warn",
      detail: "no .gitignore found \u2014 run `canon upgrade` to add the canon runtime block"
    };
  }
  const lines = readFileSync(gitignorePath, "utf8").split("\n").map((line) => line.trim());
  const missing = CANON_RUNTIME_GITIGNORE_PATTERNS.filter((pattern) => !lines.includes(pattern));
  if (missing.length === 0) {
    return { label, status: "pass", detail: "all runtime patterns present" };
  }
  return {
    label,
    status: "warn",
    detail: `missing runtime pattern(s): ${missing.join(", ")} \u2014 run \`canon upgrade\` to add them`
  };
}
function formatAge(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1e3));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return remSec > 0 ? `${minutes}m ${remSec}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}
function checkActiveOrchestrators(cwd, now = Date.now()) {
  const tasksDir = join(cwd, "tasks");
  if (!existsSync(tasksDir)) return [];
  const checks = [];
  let entries;
  try {
    entries = readdirSync(tasksDir).sort();
  } catch {
    return [];
  }
  for (const id of entries) {
    if (id === "_archive") continue;
    const ctx = gatherRunContext(id);
    const status = ctx.statusResult.kind === "ok" && isStatusJson(ctx.statusResult.status) ? ctx.statusResult.status : null;
    if (status == null) continue;
    const phases = status.phases ?? {};
    const hasInProgressPhase = Object.values(phases).some(
      (entry) => entry?.status === "in_progress"
    );
    if (!hasInProgressPhase) continue;
    const record = ctx.heartbeatResult.kind === "found" ? ctx.heartbeatResult.record : null;
    const label = `orchestrator ${id}`;
    if (isHeartbeatStale(record, now)) {
      const detail = record === null ? `status.json shows in_progress but no .heartbeat.json \u2014 orchestrator was killed or never wrote one. Run \`canon run ${id}\` to resume.` : `status.json shows in_progress but last heartbeat was ${formatAge(now - record.last_update_ms)} ago (>${HEARTBEAT_STALE_AFTER_MS / 1e3}s) \u2014 orchestrator likely killed. Run \`canon run ${id}\` to resume.`;
      checks.push({ label, status: "warn", detail });
    } else if (record) {
      checks.push({
        label,
        status: "pass",
        detail: `alive (pid ${record.pid}, heartbeat ${formatAge(now - record.last_update_ms)} ago)`
      });
    }
  }
  return checks;
}
function printSection(title) {
  console.log(`
${title}`);
  console.log("\u2500".repeat(title.length));
}
function printCheck(c) {
  const icon = c.status === "pass" ? "\u2713" : c.status === "warn" ? "!" : "\u2717";
  const line = `  ${icon} ${c.label}`;
  console.log(c.detail ? `${line} \u2014 ${c.detail}` : line);
}
function doctorCmd(_args) {
  const cwd = process.cwd();
  const envChecks = [
    checkPlatform(),
    checkNodeVersion(),
    checkBinary("git", true, "https://git-scm.com/downloads"),
    checkBinary("claude", true, "npm install -g @anthropic-ai/claude-code"),
    ...isAvailable("claude") ? [checkClaudeVersion()] : [],
    checkBinary("codex", true, "npm install -g @openai/codex"),
    checkBinary("gh", false, "brew install gh && gh auth login  (required for --pr / --push)")
  ];
  const codexDeprecated = checkCodexMdDeprecated(cwd);
  const canonChecks = [
    checkCanonDiscoveryNudge(cwd),
    ...codexDeprecated ? [codexDeprecated] : [],
    checkTemplates(cwd),
    checkCanonVersion(cwd),
    checkSkills(cwd)
  ];
  const configChecks = [
    checkCodexProjectTrust(cwd),
    checkRecommendedPermissions(cwd),
    checkLocalSettingsGitignored(cwd),
    checkRuntimeFilesGitignored(cwd)
  ];
  const orchestratorChecks = checkActiveOrchestrators(cwd);
  console.log("\ncanon doctor\n");
  printSection("Environment");
  for (const c of envChecks) printCheck(c);
  printSection("Canon setup");
  for (const c of canonChecks) printCheck(c);
  printSection("Config");
  for (const c of configChecks) printCheck(c);
  if (orchestratorChecks.length > 0) {
    printSection("Active orchestrators");
    for (const c of orchestratorChecks) printCheck(c);
  }
  const all = [...envChecks, ...canonChecks, ...configChecks, ...orchestratorChecks];
  const failures = all.filter((c) => c.status === "fail");
  const warnings = all.filter((c) => c.status === "warn");
  console.log("");
  if (failures.length > 0) {
    console.log(`${failures.length} failure(s) \u2014 fix the above before running tasks.
`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s) \u2014 canon should work; review above.
`);
    return;
  }
  console.log("All checks passed.\n");
}

// src/cli/commands/init.ts
import {
  copyFileSync,
  existsSync as existsSync2,
  readFileSync as readFileSync2,
  mkdirSync,
  readdirSync as readdirSync2,
  statSync,
  writeFileSync
} from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
import { dirname, join as join2, relative } from "path";
var packageDir = join2(dirname(fileURLToPath2(import.meta.url)), "../..");
var templatesDir = join2(packageDir, "templates");
var AGENT_FILES = /* @__PURE__ */ new Set(["AGENTS.md", "CLAUDE.md"]);
function hasExistingAgentFiles(cwd) {
  return [...AGENT_FILES].some((f) => existsSync2(join2(cwd, f)));
}
function existingAgentFilesNoticeLines() {
  return [
    "\nNote: existing AGENTS.md / CLAUDE.md detected \u2014 they are adopter-owned;",
    "canon does not insert, merge, or read managed content into them."
  ];
}
function walkDir(dir, base = dir) {
  const results = [];
  for (const entry of readdirSync2(dir)) {
    const full = join2(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full, base));
    } else {
      results.push(relative(base, full));
    }
  }
  return results;
}
function scaffoldTemplates(cwd, srcTemplatesDir) {
  const templateFiles = walkDir(srcTemplatesDir);
  const scaffolded = [];
  const skipped = [];
  for (const rel of templateFiles) {
    const dest = join2(cwd, rel);
    if (existsSync2(dest)) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join2(srcTemplatesDir, rel), dest);
    scaffolded.push(rel);
  }
  return { scaffolded, skipped };
}
function initCmd(_args) {
  checkDeps();
  const cwd = process.cwd();
  const { scaffolded, skipped } = scaffoldTemplates(cwd, templatesDir);
  const gitignorePath = join2(cwd, ".gitignore");
  const existingGitignore = existsSync2(gitignorePath) ? readFileSync2(gitignorePath, "utf8") : "";
  const gitignoreResult = upsertCanonBlock(existingGitignore, CANON_GITIGNORE_BLOCK);
  if (gitignoreResult === null) {
    console.warn("warning: .gitignore has an unclosed `# canon:start` marker \u2014 add a matching `# canon:end` line manually, then re-run `canon init`.");
  } else if (gitignoreResult !== existingGitignore) {
    mkdirSync(dirname(gitignorePath), { recursive: true });
    writeFileSync(gitignorePath, gitignoreResult);
  }
  const pkgPath = join2(cwd, "package.json");
  const isJsProject = existsSync2(pkgPath);
  console.log("\ncanon init\n");
  if (scaffolded.length > 0) {
    console.log("Scaffolded:");
    for (const f of scaffolded) console.log(`  + ${f}`);
  }
  if (skipped.length > 0) {
    console.log("\nExisting files (will be merged during grill):");
    for (const f of skipped) console.log(`  ~ ${f}`);
  }
  if (!isJsProject) {
    console.log("\nNo package.json found \u2014 running canon directly:");
    console.log("  canon run <id>          # run the pipeline");
    console.log("  canon run <id> --pr     # push + open draft PR");
  }
  writeCanonVersion(cwd);
  const detectedExistingAgentFiles = hasExistingAgentFiles(cwd);
  console.log("");
  launchGrill(cwd, detectedExistingAgentFiles);
}
function writeCanonVersion(cwd) {
  const versionPath = join2(cwd, ".canon", "version");
  const version = "2.2.0";
  mkdirSync(dirname(versionPath), { recursive: true });
  writeFileSync(versionPath, version + "\n");
}
function launchGrill(cwd, hasExistingAgentFiles2) {
  const skillPath = join2(cwd, ".claude", "skills", "canon-init", "SKILL.md");
  if (!existsSync2(skillPath)) {
    console.log("(grill skill not installed \u2014 fill docs manually for now)");
    return;
  }
  console.log("Grill skill installed at .claude/skills/canon-init/SKILL.md\n");
  console.log("To fill your scaffold docs, open Claude Code in this directory and run:\n");
  console.log("  /canon-init\n");
  console.log("Claude will read your codebase, confirm its inferences, and ask targeted");
  console.log("questions to fill all docs in one pass.");
  if (hasExistingAgentFiles2) {
    for (const line of existingAgentFilesNoticeLines()) console.log(line);
  }
  console.log("");
}

// src/cli/commands/run-task.ts
import { spawnSync as spawnSync3 } from "child_process";
import { fileURLToPath as fileURLToPath3 } from "url";
import { dirname as dirname2, join as join3 } from "path";
var packageDir2 = join3(dirname2(fileURLToPath3(import.meta.url)), "../..");
var runTaskScript = join3(packageDir2, "dist/scripts/run-task.js");
function runCmd(args2) {
  for (const arg of args2) {
    checkDepForFlag(arg);
  }
  const result = spawnSync3(process.execPath, [runTaskScript, ...args2], {
    stdio: "inherit",
    cwd: process.cwd()
  });
  process.exit(result.status ?? 1);
}

// src/cli/commands/watch.ts
import fs6 from "fs";

// src/cli/commands/stop.ts
import { existsSync as existsSync3 } from "fs";
var SIGTERM_GRACE_MS = 1e4;
var SIGTERM_POLL_INTERVAL_MS = 200;
var STOP_WAIT_DEFAULT_MS = 3e4;
var STOP_WAIT_POLL_INTERVAL_MS = 250;
function waitForHeartbeat(dir, opts) {
  const read = opts.readImpl ?? readHeartbeatStatus;
  const sleep = opts.sleepImpl ?? sleepSync;
  const now = opts.nowImpl ?? Date.now;
  const interval = opts.pollIntervalMs ?? STOP_WAIT_POLL_INTERVAL_MS;
  const deadline = now() + opts.timeoutMs;
  let onWaitStartInvoked = false;
  const announce = () => {
    if (onWaitStartInvoked) return;
    onWaitStartInvoked = true;
    if (opts.onWaitStart) opts.onWaitStart();
  };
  while (now() < deadline) {
    const result = read(dir);
    if (result.kind === "found") return { kind: "found", record: result.record };
    if (result.kind === "corrupt") return { kind: "corrupt", reason: result.reason };
    if (result.kind === "unreadable") return { kind: "unreadable", reason: result.reason };
    if (opts.isStillAlive && !opts.isStillAlive()) return { kind: "pid-died" };
    announce();
    sleep(interval);
  }
  const final = read(dir);
  if (final.kind === "found") return { kind: "found", record: final.record };
  if (final.kind === "corrupt") return { kind: "corrupt", reason: final.reason };
  if (final.kind === "unreadable") return { kind: "unreadable", reason: final.reason };
  return { kind: "timeout" };
}
function decideStopAction(inputs) {
  const { taskId, canonPid, heartbeat, probeAlive } = inputs;
  const now = inputs.now ?? Date.now();
  const heartbeatFresh = heartbeat != null && !isHeartbeatStale(heartbeat, now);
  const heartbeatStale = heartbeat != null && isHeartbeatStale(heartbeat, now);
  if (canonPid == null && heartbeat == null) {
    return {
      kind: "noop",
      message: `canon stop: task '${taskId}' is not running detached (no .canon-pid or .heartbeat.json found, or already stopped).`
    };
  }
  if (canonPid != null && heartbeat == null) {
    if (!probeAlive(canonPid)) {
      return {
        kind: "cleanup-stale-pid",
        pid: canonPid,
        cleanCanonPid: true,
        cleanHeartbeat: false,
        message: `canon stop: PID ${canonPid} for task '${taskId}' is not alive. Cleaning up stale .canon-pid.`
      };
    }
    return {
      kind: "refuse",
      pid: canonPid,
      message: `canon stop: .canon-pid says pid=${canonPid} but no .heartbeat.json appeared. The orchestrator either crashed before its first heartbeat tick or the system is too slow. Signaling would risk hitting an unrelated process if the OS recycled the PID. Check the run log for boot output, then: rm tasks/${taskId}/.canon-pid before retrying.`
    };
  }
  if (canonPid == null && heartbeat != null) {
    const heartbeatPidAlive2 = probeAlive(heartbeat.pid);
    if (!heartbeatPidAlive2) {
      return {
        kind: "cleanup-stale-pid",
        pid: heartbeat.pid,
        cleanCanonPid: false,
        cleanHeartbeat: true,
        message: `canon stop: heartbeat PID ${heartbeat.pid} for task '${taskId}' is not alive. Cleaning up stale .heartbeat.json.`
      };
    }
    if (heartbeatStale) {
      const age = formatAge(now - heartbeat.last_update_ms);
      return {
        kind: "refuse",
        pid: heartbeat.pid,
        message: `canon stop: heartbeat is stale (${age} ago) and there is no .canon-pid, but PID ${heartbeat.pid} is alive. Cannot determine if it's our canon orchestrator or a recycled PID. Refusing to signal. If you're sure: rm tasks/${taskId}/.heartbeat.json`
      };
    }
    return {
      kind: "signal",
      pid: heartbeat.pid,
      source: ".heartbeat.json",
      message: `canon stop: sending SIGTERM to canon orchestrator (pid=${heartbeat.pid}, task='${taskId}', source=.heartbeat.json)`
    };
  }
  if (canonPid == null || heartbeat == null) {
    return {
      kind: "noop",
      message: `canon stop: task '${taskId}' is not running detached (state classification bug).`
    };
  }
  const canonAlive = probeAlive(canonPid);
  if (canonPid === heartbeat.pid) {
    if (!canonAlive) {
      return {
        kind: "cleanup-stale-pid",
        pid: canonPid,
        cleanCanonPid: true,
        cleanHeartbeat: true,
        message: `canon stop: PID ${canonPid} for task '${taskId}' is not alive. Cleaning up both .canon-pid and .heartbeat.json.`
      };
    }
    if (heartbeatStale) {
      const age = formatAge(now - heartbeat.last_update_ms);
      return {
        kind: "refuse",
        pid: canonPid,
        message: `canon stop: heartbeat is stale (${age} ago) for task '${taskId}'. Orchestrator may already be dead and PID ${canonPid} may have been recycled. Refusing to signal. If you're sure: rm tasks/${taskId}/.canon-pid tasks/${taskId}/.heartbeat.json`
      };
    }
    return {
      kind: "signal",
      pid: canonPid,
      source: ".canon-pid",
      message: `canon stop: sending SIGTERM to canon orchestrator (pid=${canonPid}, task='${taskId}', source=.canon-pid)`
    };
  }
  const heartbeatPidAlive = probeAlive(heartbeat.pid);
  if (!canonAlive && heartbeatPidAlive && heartbeatFresh) {
    return {
      kind: "signal",
      pid: heartbeat.pid,
      source: ".heartbeat.json",
      message: `canon stop: .canon-pid (${canonPid}) is stale; signaling live heartbeat PID ${heartbeat.pid} (task='${taskId}', source=.heartbeat.json)`
    };
  }
  if (canonAlive && heartbeatPidAlive && heartbeatFresh) {
    return {
      kind: "refuse",
      pid: canonPid,
      message: `canon stop: .canon-pid (${canonPid}) and heartbeat pid (${heartbeat.pid}) are both alive but disagree. This is the signature of PID reuse or a stale state. Refusing to signal. Investigate manually.`
    };
  }
  if (!canonAlive && !heartbeatPidAlive) {
    return {
      kind: "cleanup-stale-pid",
      pid: canonPid,
      cleanCanonPid: true,
      cleanHeartbeat: true,
      message: `canon stop: both .canon-pid (${canonPid}) and heartbeat pid (${heartbeat.pid}) are dead for task '${taskId}'. Cleaning up stale runtime state.`
    };
  }
  return {
    kind: "refuse",
    pid: canonPid,
    message: `canon stop: ambiguous state for task '${taskId}' \u2014 .canon-pid=${canonPid} (alive=${canonAlive}), heartbeat.pid=${heartbeat.pid} (alive=${heartbeatPidAlive}, fresh=${heartbeatFresh}). Refusing to signal. Investigate; if needed: rm tasks/${taskId}/.canon-pid tasks/${taskId}/.heartbeat.json`
  };
}
function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  const view = new Int32Array(buf);
  Atomics.wait(view, 0, 0, ms);
}
function readWaitTimeoutMs(deps) {
  if (typeof deps.waitTimeoutMs === "number" && deps.waitTimeoutMs >= 0) {
    return deps.waitTimeoutMs;
  }
  const raw = process.env.CANON_STOP_WAIT_MS;
  if (raw != null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return STOP_WAIT_DEFAULT_MS;
}
function stopCmd(args2, deps = {}) {
  const kill = deps.kill ?? ((pid2, sig) => {
    process.kill(pid2, sig);
  });
  const exit = deps.exit ?? ((code) => process.exit(code));
  const stdout = deps.stdout ?? ((s) => {
    console.log(s);
  });
  const stderr = deps.stderr ?? ((s) => {
    console.error(s);
  });
  const sleep = deps.sleepImpl ?? sleepSync;
  const now = deps.nowImpl ?? Date.now;
  const readCanonPidFn = deps.readCanonPidImpl ?? readCanonPid;
  const readHeartbeatStatusFn = deps.readHeartbeatStatusImpl ?? readHeartbeatStatus;
  const waitTimeoutMs = readWaitTimeoutMs(deps);
  const probeAlive = (pid2) => probePidAlive(pid2, (value) => {
    kill(value, 0);
  });
  const taskId = args2[0];
  if (!taskId) {
    stderr("Usage: canon stop <task-id>");
    return exit(1);
  }
  const dir = deps.dirOverride ?? tolerantTaskDir(taskId);
  if (!deps.dirOverride && !existsSync3(dir)) {
    stderr(`canon stop: task '${taskId}' not found (looked in ${dir})`);
    return exit(1);
  }
  let canonPid = readCanonPidFn(dir);
  let heartbeatStatus = readHeartbeatStatusFn(dir);
  let heartbeat = heartbeatStatus.kind === "found" ? heartbeatStatus.record : null;
  if (canonPid != null && heartbeat == null && heartbeatStatus.kind === "missing" && probeAlive(canonPid)) {
    const pidBeforeWait = canonPid;
    const waitResult = waitForHeartbeat(dir, {
      timeoutMs: waitTimeoutMs,
      readImpl: readHeartbeatStatusFn,
      sleepImpl: sleep,
      nowImpl: now,
      isStillAlive: () => probeAlive(pidBeforeWait),
      onWaitStart: () => {
        stdout(`canon stop: waiting for orchestrator's first heartbeat tick (up to ${waitTimeoutMs / 1e3}s)...`);
      }
    });
    if (waitResult.kind === "corrupt" || waitResult.kind === "unreadable") {
      stderr(
        `canon stop: .heartbeat.json is ${waitResult.kind} (${waitResult.reason}) for task '${taskId}'. Refusing to signal pid ${canonPid} without proof of life. Check ${runLogPathFor(dir)} for boot output; if you're sure: rm tasks/${taskId}/.canon-pid tasks/${taskId}/.heartbeat.json`
      );
      return exit(1);
    }
    canonPid = readCanonPidFn(dir);
    heartbeatStatus = readHeartbeatStatusFn(dir);
    heartbeat = heartbeatStatus.kind === "found" ? heartbeatStatus.record : null;
  }
  const decision = decideStopAction({
    taskId,
    canonPid,
    heartbeat,
    probeAlive,
    now: now()
  });
  if (decision.kind === "noop") {
    stdout(decision.message);
    return exit(0);
  }
  if (decision.kind === "cleanup-stale-pid") {
    stdout(decision.message);
    if (!deps.skipFsCleanup) {
      if (decision.cleanCanonPid) removeCanonPid(dir);
      if (decision.cleanHeartbeat) removeHeartbeat(dir);
    }
    return exit(0);
  }
  if (decision.kind === "refuse") {
    stderr(decision.message);
    return exit(1);
  }
  const pid = decision.pid;
  stdout(decision.message);
  try {
    kill(-pid, "SIGTERM");
  } catch {
    try {
      kill(pid, "SIGTERM");
    } catch {
    }
  }
  const sigtermDeadline = now() + SIGTERM_GRACE_MS;
  while (now() < sigtermDeadline) {
    if (!probeAlive(pid)) {
      stdout(`canon stop: task '${taskId}' stopped cleanly.`);
      if (!deps.skipFsCleanup) removeCanonPid(dir);
      return exit(0);
    }
    sleep(SIGTERM_POLL_INTERVAL_MS);
  }
  stdout(`canon stop: SIGTERM didn't take after ${SIGTERM_GRACE_MS / 1e3}s \u2014 escalating to SIGKILL.`);
  try {
    kill(-pid, "SIGKILL");
  } catch {
    try {
      kill(pid, "SIGKILL");
    } catch {
    }
  }
  sleep(500);
  if (probeAlive(pid)) {
    stderr(`canon stop: pid ${pid} survived SIGKILL \u2014 investigate manually.`);
    stderr(`  Log: ${runLogPathFor(dir)}`);
    return exit(1);
  }
  stdout(`canon stop: task '${taskId}' stopped (SIGKILL).`);
  if (!deps.skipFsCleanup) removeCanonPid(dir);
  return exit(0);
}

// src/cli/commands/watch.ts
var WATCH_POLL_INTERVAL_MS = 3e3;
function sleepSync2(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}
function summaryStateForStatus(status) {
  return status.status ?? "unknown";
}
function getErrnoCode2(error) {
  if (typeof error !== "object" || error === null) return void 0;
  const code = error.code;
  return typeof code === "string" ? code : void 0;
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
function isPhaseSettled(status, phase) {
  const phaseStatus = status.phases[phase]?.status ?? "pending";
  return phaseStatus === "done" || phaseStatus === "changes_requested" || phaseStatus === "blocked";
}
function findFirstBlockedPhase(status) {
  for (const phase of PHASE_ORDER) {
    if ((status.phases[phase]?.status ?? "pending") === "blocked") return phase;
  }
  return null;
}
function findPreviousDonePhase(status, beforePhase) {
  const index = PHASE_ORDER.indexOf(beforePhase);
  for (let i = index - 1; i >= 0; i -= 1) {
    const phase = PHASE_ORDER[i];
    if ((status.phases[phase]?.status ?? "pending") === "done") return phase;
  }
  return null;
}
function formatPhaseTransition(from, to) {
  return `${from}\u2192${to}`;
}
function formatPhasePointerTransition(from, to) {
  return `${from} \u2192 ${to}`;
}
function displayedPhasePointer(ctx) {
  if (ctx.statusResult.kind !== "ok" || !isStatusJson(ctx.statusResult.status)) return null;
  return deriveTopLevelStatus(ctx.statusResult.status);
}
function formatSummaryLine(summary) {
  const parts = [`state=${summary.state}`, `reason=${summary.reason}`];
  if (summary.phase) parts.push(`phase=${summary.phase}`);
  if (summary.verdict) parts.push(`verdict=${summary.verdict}`);
  if (summary.pid != null) parts.push(`pid=${summary.pid}`);
  return parts.join(" ");
}
function emitSummary(stdout, summary) {
  stdout(`${formatSummaryLine(summary)}
`);
}
function printUsage(stderr) {
  stderr("Usage: canon watch <task-id> [--until <phase>] [--timeout <dur>] [--follow|-f]");
  stderr("");
  stderr("  Blocks until the detached orchestrator settles, then prints one summary line.");
  stderr("  Exit codes: 0 healthy stop/until, 2 usage/nothing-to-watch/read-error/ambiguous_pid/launch-window-timeout,");
  stderr("              3 auto-block, 4 death, 5 timeout.");
  stderr("  Summary line: state=<state> reason=<reason> [phase=<phase>] [verdict=<verdict>] [pid=<pid>]");
  stderr("  Reasons: checkpoint, complete, auto_block, step_done, death, timeout, until, nothing_to_watch,");
  stderr("           launch_window_timeout, ambiguous_pid, read_error, usage_error.");
}
function parseDurationMs(raw) {
  const trimmed = raw.trim();
  const secondsMatch = trimmed.match(/^(\d+)s$/);
  if (secondsMatch) return Number.parseInt(secondsMatch[1], 10) * 1e3;
  const minutesMatch = trimmed.match(/^(\d+)m$/);
  if (minutesMatch) return Number.parseInt(minutesMatch[1], 10) * 6e4;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1e3;
  return null;
}
function parseWatchArgs(args2) {
  let taskId = null;
  let follow = false;
  let untilPhase = null;
  let timeoutMs = null;
  let usageError = null;
  for (let index = 0; index < args2.length; index += 1) {
    const arg = args2[index];
    if (arg === "--follow" || arg === "-f") {
      follow = true;
      continue;
    }
    if (arg === "--until") {
      const value = args2[index + 1];
      if (!value) {
        usageError = "--until requires a phase argument";
        break;
      }
      index += 1;
      if (!PHASE_ORDER.includes(value)) {
        usageError = `Invalid phase for --until: ${value}`;
        break;
      }
      untilPhase = value;
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      const value = arg.slice("--timeout=".length);
      const parsed = parseDurationMs(value);
      if (parsed == null) {
        usageError = `Invalid --timeout value: ${value}`;
        break;
      }
      timeoutMs = parsed;
      continue;
    }
    if (arg === "--timeout") {
      const value = args2[index + 1];
      if (!value) {
        usageError = "--timeout requires a duration argument";
        break;
      }
      index += 1;
      const parsed = parseDurationMs(value);
      if (parsed == null) {
        usageError = `Invalid --timeout value: ${value}`;
        break;
      }
      timeoutMs = parsed;
      continue;
    }
    if (arg.startsWith("-")) {
      usageError = `Unknown option: ${arg}`;
      break;
    }
    if (taskId != null) {
      usageError = "canon watch accepts exactly one TASK-ID";
      break;
    }
    taskId = arg;
  }
  if (!taskId && usageError == null) usageError = "At least one TASK-ID is required.";
  return {
    taskId: taskId ?? "",
    follow,
    untilPhase,
    timeoutMs,
    usageError
  };
}
function summarizeIdle(result) {
  switch (result.kind) {
    case "checkpoint":
      return { state: result.state, reason: "checkpoint", phase: result.phase, verdict: result.verdict, pid: result.pid };
    case "complete":
      return { state: result.state, reason: "complete", pid: result.pid };
    case "auto_block":
      return { state: result.state, reason: "auto_block", phase: result.phase, pid: result.pid };
    case "step_done":
      return { state: result.state, reason: "step_done", phase: result.phase, verdict: result.verdict, pid: result.pid };
    case "death":
      return { state: result.state, reason: "death", pid: result.pid };
    case "ambiguous_pid":
      return { state: result.state, reason: "ambiguous_pid" };
    case "read_error":
      return { state: "unknown", reason: "read_error" };
  }
}
function classifyStatusErrors(ctx) {
  if (ctx.statusResult.kind === "error") {
    return { kind: "read_error", file: ctx.statusResult.file, reason: ctx.statusResult.reason };
  }
  if (ctx.heartbeatResult.kind === "corrupt" || ctx.heartbeatResult.kind === "unreadable") {
    return { kind: "read_error", file: ctx.heartbeatFile, reason: ctx.heartbeatResult.reason };
  }
  return null;
}
function classifyAttach(ctx, taskId, probeAlive, now) {
  const readError = classifyStatusErrors(ctx);
  if (readError) return readError;
  const status = ctx.statusResult.kind === "ok" && isStatusJson(ctx.statusResult.status) ? ctx.statusResult.status : null;
  const state = status?.status ?? "unknown";
  const blockedPhase = status ? findFirstBlockedPhase(status) : null;
  if (blockedPhase) {
    return { kind: "auto_block", state: "blocked", phase: blockedPhase };
  }
  if (ctx.ambiguousPid != null) {
    return {
      kind: "ambiguous_pid",
      state,
      canonPid: ctx.ambiguousPid.canonPid,
      heartbeatPid: ctx.ambiguousPid.heartbeatPid
    };
  }
  if (ctx.resolvedPid != null && probeAlive(ctx.resolvedPid) && ctx.heartbeatResult.kind === "found" && !isHeartbeatStale(ctx.heartbeatResult.record, now)) {
    return { kind: "live", pid: ctx.resolvedPid, state };
  }
  if (ctx.launchWindow) {
    return { kind: "launch_window", state };
  }
  if (status) {
    const inProgress = PHASE_ORDER.some((phase) => (status.phases[phase]?.status ?? "pending") === "in_progress");
    if (inProgress) {
      return {
        kind: "death",
        state,
        hint: `run \`canon run ${taskId}\` to resume`
      };
    }
  }
  return {
    kind: "nothing_to_watch",
    state,
    hint: `Use \`canon task status ${taskId}\` for a non-blocking snapshot of the task state.`
  };
}
function classifyIdle(ctx, _taskId) {
  const readError = classifyStatusErrors(ctx);
  if (readError) return readError;
  const status = ctx.statusResult.kind === "ok" && isStatusJson(ctx.statusResult.status) ? ctx.statusResult.status : null;
  if (status == null) {
    return { kind: "death", state: "unknown" };
  }
  const state = summaryStateForStatus(status);
  const blockedPhase = findFirstBlockedPhase(status);
  if (blockedPhase) {
    return { kind: "auto_block", state: "blocked", phase: blockedPhase, pid: ctx.resolvedPid ?? void 0 };
  }
  if (ctx.ambiguousPid != null) {
    return {
      kind: "ambiguous_pid",
      state,
      canonPid: ctx.ambiguousPid.canonPid,
      heartbeatPid: ctx.ambiguousPid.heartbeatPid
    };
  }
  if (state === "human_review") {
    const verdict = status.phases.code_review?.verdict || void 0;
    return {
      kind: "checkpoint",
      state: "human_review",
      phase: "qa\u2192human_review",
      verdict,
      pid: ctx.resolvedPid ?? void 0
    };
  }
  if (state === "complete") {
    return { kind: "complete", state: "complete", pid: ctx.resolvedPid ?? void 0 };
  }
  const currentPhase = PHASE_ORDER.includes(state) ? state : null;
  if (currentPhase) {
    const currentPhaseStatus = status.phases[currentPhase]?.status ?? "pending";
    if (currentPhaseStatus === "changes_requested") {
      return {
        kind: "step_done",
        state,
        phase: currentPhase,
        verdict: status.phases[currentPhase]?.verdict || "changes_requested",
        pid: ctx.resolvedPid ?? void 0
      };
    }
    if (currentPhaseStatus === "pending" || currentPhaseStatus === "in_progress") {
      const previousPhase = findPreviousDonePhase(status, currentPhase);
      if (previousPhase) {
        return {
          kind: "step_done",
          state,
          phase: formatPhaseTransition(previousPhase, currentPhase),
          pid: ctx.resolvedPid ?? void 0
        };
      }
    }
  }
  if (PHASE_ORDER.some((phase) => (status.phases[phase]?.status ?? "pending") === "in_progress")) {
    return { kind: "death", state, pid: ctx.resolvedPid ?? void 0 };
  }
  return { kind: "death", state, pid: ctx.resolvedPid ?? void 0 };
}
function phaseSettled(ctx, phase) {
  const status = ctx.statusResult.kind === "ok" && isStatusJson(ctx.statusResult.status) ? ctx.statusResult.status : null;
  if (status == null) return false;
  return isPhaseSettled(status, phase);
}
function orchestratorStillProgressing(ctx, probeAlive) {
  if (ctx.resolvedPid == null || !probeAlive(ctx.resolvedPid)) return false;
  const status = ctx.statusResult.kind === "ok" && isStatusJson(ctx.statusResult.status) ? ctx.statusResult.status : null;
  if (status == null) return false;
  if (findFirstBlockedPhase(status)) return false;
  const state = status.status;
  return state !== "human_review" && state !== "complete";
}
function primaryLogTaskId(ctx, fallbackTaskId) {
  if (ctx.heartbeatResult.kind === "found") {
    return ctx.heartbeatResult.record.task_ids[0] ?? fallbackTaskId;
  }
  return fallbackTaskId;
}
function tailRunLog(ctx, taskId, deps, tailState) {
  const logTaskDir = tolerantTaskDir(primaryLogTaskId(ctx, taskId));
  const logPath = runLogPathFor(logTaskDir);
  try {
    const stat = fs6.statSync(logPath);
    if (tailState.position == null) {
      tailState.position = stat.size;
      return;
    }
    if (stat.size < tailState.position) {
      tailState.position = 0;
    }
    if (stat.size === tailState.position) return;
    const content = fs6.readFileSync(logPath, "utf8");
    const chunk = content.slice(tailState.position);
    if (chunk.length > 0) deps.stderr?.(chunk);
    tailState.position = stat.size;
  } catch (error) {
    const code = getErrnoCode2(error);
    if (code === "ENOENT") return;
    deps.stderr?.(`canon watch: failed to tail ${logPath}: ${errorMessage2(error)}
`);
  }
}
function gatherContext(taskId, deps) {
  if (deps.gatherContextImpl) return deps.gatherContextImpl(taskId);
  return gatherRunContext(taskId, {
    readHeartbeatImpl: deps.readHeartbeatImpl,
    readCanonPidImpl: deps.readCanonPidImpl,
    probeAliveImpl: deps.probeAliveImpl
  });
}
function watchCmd(args2, deps = {}) {
  const exit = deps.exit ?? ((code) => process.exit(code));
  const stdout = deps.stdout ?? ((s) => {
    process.stdout.write(s);
  });
  const stderr = deps.stderr ?? ((s) => {
    process.stderr.write(s);
  });
  const sleep = deps.sleepImpl ?? sleepSync2;
  const now = deps.nowImpl ?? Date.now;
  const pollIntervalMs = deps.pollIntervalMs ?? WATCH_POLL_INTERVAL_MS;
  const waitTimeoutMs = deps.waitTimeoutMs ?? STOP_WAIT_DEFAULT_MS;
  const parsed = parseWatchArgs(args2);
  if (parsed.usageError) {
    printUsage(stderr);
    stderr(`canon watch: ${parsed.usageError}
`);
    emitSummary(stdout, { state: "usage", reason: "usage_error" });
    return exit(2);
  }
  const taskId = parsed.taskId;
  const timeoutDeadline = parsed.timeoutMs == null ? null : now() + parsed.timeoutMs;
  const tailState = { position: null };
  const withinTimeout = () => timeoutDeadline != null && now() >= timeoutDeadline;
  const remainingTimeoutMs = () => {
    if (timeoutDeadline == null) return null;
    return Math.max(0, timeoutDeadline - now());
  };
  const reportTimeout = () => {
    emitSummary(stdout, { state: "timeout", reason: "timeout" });
    return exit(5);
  };
  const reportInitialFailure = (result) => {
    switch (result.kind) {
      case "auto_block":
        emitSummary(stdout, { state: "blocked", reason: "auto_block", phase: result.phase });
        return exit(3);
      case "death":
        stderr(`canon watch: ${result.hint}
`);
        emitSummary(stdout, { state: result.state, reason: "death" });
        return exit(4);
      case "nothing_to_watch":
        stderr(`canon watch: ${result.hint}
`);
        emitSummary(stdout, { state: result.state, reason: "nothing_to_watch" });
        return exit(2);
      case "read_error":
        stderr(`canon watch: cannot read ${result.file}: ${result.reason}
`);
        stderr(`canon watch: run \`canon task status ${taskId}\` to inspect the task state.
`);
        emitSummary(stdout, { state: "unknown", reason: "read_error" });
        return exit(2);
      case "launch_window":
        stderr(`canon watch: orchestrator is still starting; try again in a moment.
`);
        emitSummary(stdout, { state: result.state, reason: "nothing_to_watch" });
        return exit(2);
      case "ambiguous_pid":
        stderr(
          `canon watch: .canon-pid (${result.canonPid}) and heartbeat pid (${result.heartbeatPid}) are both alive but disagree. Refusing to attach.
`
        );
        stderr(`canon watch: run \`canon task status ${taskId}\` to inspect the task state.
`);
        emitSummary(stdout, { state: result.state, reason: "ambiguous_pid" });
        return exit(2);
      case "live":
        throw new Error("reportInitialFailure called for live result");
    }
  };
  let ctx = gatherContext(taskId, deps);
  if (parsed.untilPhase && phaseSettled(ctx, parsed.untilPhase)) {
    emitSummary(stdout, {
      state: parsed.untilPhase,
      reason: "until",
      phase: parsed.untilPhase,
      pid: ctx.resolvedPid ?? void 0
    });
    return exit(0);
  }
  const initialAttach = classifyAttach(ctx, taskId, (pid) => probePidAlive(pid, deps.probeAliveImpl), now());
  if (initialAttach.kind !== "live" && initialAttach.kind !== "launch_window") {
    return reportInitialFailure(initialAttach);
  }
  let previousPhasePointer = displayedPhasePointer(ctx);
  if (initialAttach.kind === "launch_window") {
    const remaining = remainingTimeoutMs();
    if (remaining != null && remaining <= 0) return reportTimeout();
    const launchTimeout = remaining == null ? waitTimeoutMs : Math.min(waitTimeoutMs, remaining);
    const launchTimeoutCappedByWatch = remaining != null && remaining < waitTimeoutMs;
    const waitResult = waitForHeartbeat(ctx.taskDir, {
      timeoutMs: launchTimeout,
      pollIntervalMs: STOP_WAIT_POLL_INTERVAL_MS,
      readImpl: deps.readHeartbeatImpl,
      sleepImpl: sleep,
      nowImpl: now,
      isStillAlive: () => ctx.canonPid == null ? false : probePidAlive(ctx.canonPid, deps.probeAliveImpl),
      onWaitStart: () => {
        stderr(`canon watch: waiting for orchestrator's first heartbeat tick (up to ${Math.floor(launchTimeout / 1e3)}s)...
`);
      }
    });
    if (waitResult.kind === "found") {
      ctx = gatherContext(taskId, deps);
      const postWaitAttach = classifyAttach(ctx, taskId, (pid) => probePidAlive(pid, deps.probeAliveImpl), now());
      if (postWaitAttach.kind !== "live") {
        return reportInitialFailure(postWaitAttach);
      }
      previousPhasePointer = displayedPhasePointer(ctx);
    } else if (waitResult.kind === "pid-died") {
      emitSummary(stdout, { state: "in_progress", reason: "death" });
      return exit(4);
    } else if (waitResult.kind === "timeout") {
      if (launchTimeoutCappedByWatch) {
        return reportTimeout();
      }
      emitSummary(stdout, { state: "launch_window", reason: "launch_window_timeout" });
      return exit(2);
    } else {
      stderr(`canon watch: cannot read ${ctx.heartbeatFile}: ${waitResult.reason}
`);
      emitSummary(stdout, { state: "unknown", reason: "read_error" });
      return exit(2);
    }
  }
  stderr(`canon watch: attached to task '${taskId}' (pid=${ctx.resolvedPid ?? "unknown"})
`);
  if (parsed.follow) tailRunLog(ctx, taskId, { stderr }, tailState);
  for (; ; ) {
    if (withinTimeout()) return reportTimeout();
    sleep(pollIntervalMs);
    if (withinTimeout()) return reportTimeout();
    ctx = gatherContext(taskId, deps);
    if (parsed.untilPhase && phaseSettled(ctx, parsed.untilPhase)) {
      emitSummary(stdout, {
        state: parsed.untilPhase,
        reason: "until",
        phase: parsed.untilPhase,
        pid: ctx.resolvedPid ?? void 0
      });
      return exit(0);
    }
    const liveResult = classifyAttach(ctx, taskId, (pid) => probePidAlive(pid, deps.probeAliveImpl), now());
    if (liveResult.kind === "live") {
      const currentPhase = displayedPhasePointer(ctx);
      if (previousPhasePointer != null && currentPhase != null && previousPhasePointer !== currentPhase) {
        stderr(`canon watch: phase ${formatPhasePointerTransition(previousPhasePointer, currentPhase)}
`);
      }
      previousPhasePointer = currentPhase;
      stderr(`canon watch: heartbeat ${formatAge(now() - (ctx.heartbeatResult.kind === "found" ? ctx.heartbeatResult.record.last_update_ms : now()))} ago
`);
      if (parsed.follow) tailRunLog(ctx, taskId, { stderr }, tailState);
      continue;
    }
    if (liveResult.kind === "read_error") {
      stderr(`canon watch: cannot read ${liveResult.file}: ${liveResult.reason}
`);
      emitSummary(stdout, { state: "unknown", reason: "read_error" });
      return exit(2);
    }
    if (liveResult.kind === "ambiguous_pid") {
      stderr(
        `canon watch: .canon-pid (${liveResult.canonPid}) and heartbeat pid (${liveResult.heartbeatPid}) are both alive but disagree. Refusing to attach.
`
      );
      emitSummary(stdout, { state: liveResult.state, reason: "ambiguous_pid" });
      return exit(2);
    }
    if (orchestratorStillProgressing(ctx, (pid) => probePidAlive(pid, deps.probeAliveImpl))) {
      const currentPhase = displayedPhasePointer(ctx);
      if (previousPhasePointer != null && currentPhase != null && previousPhasePointer !== currentPhase) {
        stderr(`canon watch: phase ${formatPhasePointerTransition(previousPhasePointer, currentPhase)}
`);
      }
      previousPhasePointer = currentPhase;
      if (parsed.follow) tailRunLog(ctx, taskId, { stderr }, tailState);
      continue;
    }
    stderr("canon watch: orchestrator appears idle; re-reading status.json after a grace interval...\n");
    sleep(pollIntervalMs);
    if (withinTimeout()) return reportTimeout();
    const freshCtx = gatherContext(taskId, deps);
    if (parsed.untilPhase && phaseSettled(freshCtx, parsed.untilPhase)) {
      emitSummary(stdout, {
        state: parsed.untilPhase,
        reason: "until",
        phase: parsed.untilPhase,
        pid: freshCtx.resolvedPid ?? void 0
      });
      return exit(0);
    }
    const idleResult = classifyIdle(freshCtx, taskId);
    emitSummary(stdout, summarizeIdle(idleResult));
    switch (idleResult.kind) {
      case "checkpoint":
      case "complete":
      case "step_done":
        return exit(0);
      case "auto_block":
        return exit(3);
      case "death":
        return exit(4);
      case "ambiguous_pid":
        stderr(
          `canon watch: .canon-pid (${idleResult.canonPid}) and heartbeat pid (${idleResult.heartbeatPid}) are both alive but disagree. Refusing to attach.
`
        );
        return exit(2);
      case "read_error":
        stderr(`canon watch: cannot read ${idleResult.file}: ${idleResult.reason}
`);
        return exit(2);
    }
  }
}

// src/task/index.ts
import { spawnSync as spawnSync6 } from "child_process";
import fs10 from "fs";
import path10 from "path";

// scripts/run-task/canon-snapshot.ts
import { spawnSync as spawnSync5 } from "child_process";
import fs8 from "fs";
import path8 from "path";

// scripts/run-task/git.ts
import { spawnSync as spawnSync4 } from "child_process";
import path7 from "path";

// scripts/run-task/worktree.ts
import fs7 from "fs";
import path6 from "path";
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

// scripts/run-task/git.ts
function gitSafeAt(cwd, ...args2) {
  const result = spawnSync4("git", args2, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { ok: false, stdout: "", stderr: result.error.message };
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
function filterGitIgnoredPaths(paths, cwd) {
  if (paths.length === 0) return /* @__PURE__ */ new Set();
  const result = spawnSync4("git", ["check-ignore", "--stdin", "-z"], {
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

// scripts/run-task/canon-snapshot.ts
var CANON_UPSTREAM_REPO = "tstraub89/canon-ai";
function resolveOrchestratorCommit(repoRoot, upstreamCommit, runGitAt) {
  const ownToplevel = captureGitOutput(repoRoot, ["rev-parse", "--show-toplevel"], runGitAt);
  if (!ownToplevel) return upstreamCommit;
  const parentDir = path8.dirname(repoRoot);
  const parentToplevel = captureGitOutput(parentDir, ["rev-parse", "--show-toplevel"], runGitAt);
  if (!parentToplevel) return upstreamCommit;
  if (path8.resolve(parentToplevel) === path8.resolve(ownToplevel)) {
    return upstreamCommit;
  }
  return captureGitOutput(path8.resolve(parentToplevel), ["rev-parse", "HEAD"], runGitAt) || upstreamCommit;
}
function defaultRunCommand(command2, args2) {
  const result = spawnSync5(command2, args2, {
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
function captureGitOutput(cwd, args2, runGitAt) {
  const result = runGitAt(cwd, ...args2);
  return result.ok ? result.stdout.trim() : "";
}
function captureVersion(command2, runCommand) {
  const result = runCommand(command2, ["--version"]);
  if (!result.ok) return "<unavailable>";
  const version = result.stdout.trim();
  return version.length > 0 ? version : "<unavailable>";
}
function captureCanonSnapshot(repoRoot = REPO_ROOT, options = {}) {
  const runGitAt = options.runGitAt ?? gitSafeAt;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const superprojectWorkingTree = captureGitOutput(repoRoot, ["rev-parse", "--show-superproject-working-tree"], runGitAt);
  const upstreamCommit = captureGitOutput(repoRoot, ["rev-parse", "HEAD"], runGitAt) || "<unavailable>";
  const orchestratorCommit = superprojectWorkingTree ? captureGitOutput(path8.resolve(superprojectWorkingTree), ["rev-parse", "HEAD"], runGitAt) || "<unavailable>" : resolveOrchestratorCommit(repoRoot, upstreamCommit, runGitAt);
  const envUpstreamRepo = process.env.CANON_UPSTREAM_REPO?.trim();
  const upstreamRepo = envUpstreamRepo ? envUpstreamRepo : CANON_UPSTREAM_REPO;
  return {
    upstream_repo: upstreamRepo,
    upstream_commit: upstreamCommit,
    orchestrator_commit: orchestratorCommit,
    codex_cli: captureVersion("codex", runCommand),
    claude_code: captureVersion("claude", runCommand)
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
  const status = JSON.parse(fs8.readFileSync(statusFilePath, "utf8"));
  const canon = captureCanonSnapshot(REPO_ROOT, options);
  const next = applyCanonSnapshot(status, canon);
  const serialized = `${JSON.stringify(next, null, 2)}
`;
  const current = fs8.readFileSync(statusFilePath, "utf8");
  if (current !== serialized) {
    fs8.writeFileSync(statusFilePath, serialized, "utf8");
  }
  return canon;
}

// scripts/run-task/validation.ts
import fs9 from "fs";
import path9 from "path";

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
function computeCommentHiddenLines(lines) {
  const hidden = new Array(lines.length).fill(false);
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
    hidden[i] = startsInComment || opensComment && !closesComment;
  }
  return hidden;
}
function extractSectionBodies(markdown, pattern) {
  const lines = markdown.split("\n");
  const hidden = computeCommentHiddenLines(lines);
  const bodies = [];
  let activeStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (hidden[i]) continue;
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
  const rerouteExempt = impl.reroute_exempt;
  if (rerouteExempt === true) return { reroute: false };
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
function isHumanPendingResult(result) {
  return /^human[_ -]?pending\b/i.test(result.trim());
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
    content = fs9.readFileSync(donePath, "utf8");
  } catch {
    return true;
  }
  return DONE_MD_TEMPLATE_SENTINELS.some((s) => content.includes(s));
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
  return taskDirOverride ? path9.join(taskDirOverride, taskId) : taskDirFor(taskId);
}
function checkPhaseGate(taskId, phase, verdict, taskDirOverride) {
  const config2 = PHASE_GATE_CONFIG[phase];
  const taskDir = resolveTaskDirForValidation(taskId, taskDirOverride);
  if (config2.artifactName) {
    const artifactPath = path9.join(taskDir, config2.artifactName);
    let content;
    try {
      content = fs9.readFileSync(artifactPath, "utf8");
    } catch {
      return { ok: false, reason: `${config2.artifactName} is missing for phase '${phase}'` };
    }
    const isTemplate = config2.customTemplateCheck ? config2.customTemplateCheck(artifactPath) : isTemplateUnfilled(content);
    if (isTemplate) {
      return { ok: false, reason: `${config2.artifactName} is still the unfilled template for phase '${phase}'` };
    }
    let rerouteEv = { reroute: false };
    if (phase === "spec_review" || phase === "plan") {
      let statusRaw;
      try {
        statusRaw = fs9.readFileSync(path9.join(taskDir, "status.json"), "utf8");
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
        return { ok: false, reason: `${config2.artifactName}: ${rerouteEv.reason}` };
      }
    }
    if (config2.verdictMustMatchArtifact) {
      if (!verdict) {
        return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
      }
      const extracted = rerouteEv.reroute && rerouteEv.ok ? rerouteEv.verdict : extractCheckedVerdict(content);
      const scopeLabel = rerouteEv.reroute && rerouteEv.ok ? `${config2.artifactName} reroute amendment-review section` : config2.artifactName;
      if (!extracted) {
        return { ok: false, reason: `${scopeLabel} has no checked verdict checkbox` };
      }
      if (extracted !== verdict) {
        return { ok: false, reason: `verdict mismatch: status.json wants '${verdict}', ${scopeLabel} has '${extracted}'` };
      }
    }
  }
  if (config2.requiresVerdict && !config2.verdictMustMatchArtifact) {
    if (!verdict) {
      return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
    }
  }
  if (phase === "human_review") {
    const handoffPath = path9.join(taskDir, "handoff.md");
    let handoffContent;
    try {
      handoffContent = fs9.readFileSync(handoffPath, "utf8");
    } catch {
      return { ok: false, reason: `closing human_review requires a handoff.md \u2014 none found in ${taskDir}` };
    }
    const pending = countHumanPendingChecks(handoffContent);
    if (pending.length === 0) return { ok: true };
    const donePath = path9.join(taskDir, "done.md");
    let doneContent = "";
    try {
      doneContent = fs9.readFileSync(donePath, "utf8");
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
function parseHandoffChangesRows(taskId) {
  const handoffPath = path9.join(taskDirFor(taskId), "handoff.md");
  let content;
  try {
    content = fs9.readFileSync(handoffPath, "utf8");
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
      for (const filePath of result.paths) files.add(filePath);
      for (const entry of result.malformed) {
        malformed.push({ cell: firstColumn.trim(), reason: entry.reason });
      }
    }
  }
  return { files: [...files], malformed };
}
function matchPathTokenAt(value, start) {
  if (value[start] === "`") {
    const close = value.indexOf("`", start + 1);
    if (close === -1) return null;
    return { label: value.slice(start + 1, close), end: close + 1 };
  }
  if (value[start] !== "[") return null;
  const labelClose = value.indexOf("]", start + 1);
  if (labelClose === -1 || value[labelClose + 1] !== "(") return null;
  const end = matchLinkTail(value, labelClose + 2);
  if (end === null) return null;
  return { label: value.slice(start + 1, labelClose), end };
}
function matchLinkTail(value, tailStart) {
  let cursor = tailStart;
  if (value[cursor] === "<") {
    cursor += 1;
    const destStart = cursor;
    let closed = false;
    while (cursor < value.length) {
      if (value[cursor] === "\\") {
        cursor += 2;
      } else if (value[cursor] === ">") {
        closed = true;
        break;
      } else {
        cursor += 1;
      }
    }
    if (!closed || cursor === destStart) return null;
    cursor += 1;
  } else {
    const destStart = cursor;
    let depth = 0;
    while (cursor < value.length) {
      const ch = value[cursor];
      if (ch === "\\") {
        cursor += 2;
      } else if (ch === "(") {
        depth += 1;
        cursor += 1;
      } else if (ch === ")" && depth > 0) {
        depth -= 1;
        cursor += 1;
      } else if (ch === ")" || (ch === " " || ch === "	") && depth === 0) {
        break;
      } else {
        cursor += 1;
      }
    }
    if (depth !== 0 || cursor === destStart) return null;
  }
  let sawWhitespace = false;
  while (value[cursor] === " " || value[cursor] === "	") {
    cursor += 1;
    sawWhitespace = true;
  }
  if (value[cursor] === ")") return cursor + 1;
  if (!sawWhitespace) return null;
  const open = value[cursor];
  if (open !== '"' && open !== "'" && open !== "(") return null;
  cursor += 1;
  if (open === "(") {
    let depth = 1;
    while (cursor < value.length && depth > 0) {
      if (value[cursor] === "\\") {
        cursor += 2;
      } else if (value[cursor] === "(") {
        depth += 1;
        cursor += 1;
      } else if (value[cursor] === ")") {
        depth -= 1;
        cursor += 1;
      } else {
        cursor += 1;
      }
    }
    if (depth !== 0) return null;
  } else {
    let closed = false;
    while (cursor < value.length) {
      if (value[cursor] === "\\") {
        cursor += 2;
      } else if (value[cursor] === open) {
        closed = true;
        cursor += 1;
        break;
      } else {
        cursor += 1;
      }
    }
    if (!closed) return null;
  }
  while (value[cursor] === " " || value[cursor] === "	") cursor += 1;
  if (value[cursor] !== ")") return null;
  return cursor + 1;
}
function findPathToken(value) {
  for (let start = 0; start < value.length; start += 1) {
    const token = matchPathTokenAt(value, start);
    if (token) return { token, start };
  }
  return null;
}
function parseHandoffPathCell(cell) {
  const trimmed = cell.trim();
  const structuralFailure = (reason) => ({
    paths: [],
    malformed: [{ token: trimmed, reason }]
  });
  if (!trimmed) return structuralFailure("empty cell");
  const first = matchPathTokenAt(trimmed, 0);
  if (!first) {
    const embedded = findPathToken(trimmed);
    if (embedded?.token && trimmed[embedded.start] === "`") {
      return structuralFailure(
        `backticked path must be at the start of the cell, optionally followed by an annotation \u2014 got: ${snippet(trimmed)}`
      );
    }
    if (embedded?.token) {
      return structuralFailure(
        `markdown link must be at the start of the cell \u2014 got: ${snippet(trimmed)}`
      );
    }
    return structuralFailure(
      `no recognized path \u2014 first column must be \`backtick-path\` or [markdown-link](url): ${snippet(trimmed)}`
    );
  }
  const tokens = [first];
  let position = first.end;
  for (; ; ) {
    const separator = /^\s*,\s*/.exec(trimmed.slice(position));
    if (!separator) break;
    const nextStart = position + separator[0].length;
    const next = matchPathTokenAt(trimmed, nextStart);
    if (!next) {
      return structuralFailure(
        `comma must be followed by another path token \u2014 got: ${snippet(trimmed)}`
      );
    }
    tokens.push(next);
    position = next.end;
  }
  const remainder = trimmed.slice(position);
  const extra = findPathToken(remainder);
  if (extra) {
    if (remainder.trimStart().startsWith("`") || remainder.trimStart().startsWith("[")) {
      return structuralFailure(
        `path tokens must be comma-separated \u2014 got: ${snippet(trimmed)}`
      );
    }
    return structuralFailure(
      `extra path token found \u2014 extra paths must be comma-joined, not left as prose or trailing annotation: ${snippet(trimmed)}`
    );
  }
  if (remainder && !/^\s/.test(remainder)) {
    return structuralFailure(
      `trailing annotation must be separated from the last path token by whitespace \u2014 got: ${snippet(trimmed)}`
    );
  }
  const paths = [];
  const malformed = [];
  for (const token of tokens) {
    const extracted = token.label.trim();
    const result = validateExtractedPath(extracted);
    if (result.kind === "ok") {
      paths.push(result.path);
    } else {
      malformed.push({ token: extracted, reason: result.reason });
    }
  }
  return { paths, malformed };
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
var HANDOFF_COVERAGE_SURFACES = "the baseline '## Changes' table and '### Changes' tables inside '## Iteration' sections";
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
  const nearMiss = (filePath) => {
    const found = inputs.unscannedTableHits?.get(filePath) ?? [];
    return found.length > 0 ? ` \u2014 a row for it exists under ${found.join(" and ")}, which this check does not scan` : "";
  };
  let missingCoverage = false;
  for (const filePath of inputs.diffFiles) {
    if (HANDOFF_DIFF_EXEMPT_PATHS.has(filePath)) continue;
    if (isPipelineOwnedTaskArtifact(filePath, taskIds)) continue;
    if (bundleHandoffFiles.has(filePath)) continue;
    missingCoverage = true;
    issues.push(`diff\u2192handoff: ${filePath} in diff but not in any bundle handoff${nearMiss(filePath)}`);
  }
  for (const [oldPath, newPath] of renamePairs) {
    if (HANDOFF_DIFF_EXEMPT_PATHS.has(oldPath) && HANDOFF_DIFF_EXEMPT_PATHS.has(newPath)) continue;
    if (isPipelineOwnedTaskArtifact(oldPath, taskIds) || isPipelineOwnedTaskArtifact(newPath, taskIds)) continue;
    if (bundleHandoffFiles.has(oldPath) || bundleHandoffFiles.has(newPath)) continue;
    missingCoverage = true;
    issues.push(`diff\u2192handoff: rename ${oldPath} \u2192 ${newPath} \u2014 neither path in any bundle handoff${nearMiss(newPath) || nearMiss(oldPath)}`);
  }
  if (missingCoverage) {
    issues.push(
      `diff\u2192handoff: coverage rows are read only from ${HANDOFF_COVERAGE_SURFACES} \u2014 rows under any other heading or column layout are invisible to this check.`
    );
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

// src/task/index.ts
var VALID_PHASES = new Set(PHASE_ORDER);
var VALID_STATUSES = /* @__PURE__ */ new Set(["pending", "in_progress", "done", "changes_requested", "blocked"]);
var VALID_VERDICTS = /* @__PURE__ */ new Set(["approved", "approved_with_nits", "changes_requested", "needs_re_review", "spec_gap", "sanctioned"]);
var REVIEW_PHASES = /* @__PURE__ */ new Set(["spec_review", "code_review"]);
var SETTABLE_FIELDS = ["title", "task_size", "delicate", "worktree", "base_branch"];
var SETTABLE_FIELD_SET = new Set(SETTABLE_FIELDS);
var IMMUTABLE_FIELDS = /* @__PURE__ */ new Set(["id", "created", "updated"]);
var REDIRECT_MESSAGES = {
  full_send: "a per-run stance, not durable metadata. Use `canon run --full-send <id>`, which also clears the spec gate and enforces the delicate\u2192`--force` guard.",
  human_spec_gate: "the spec gate is self-clearing. Re-run `canon run <id>` to proceed past it, or use `canon run --full-send <id>` to skip it entirely.",
  status: "derived from phase states. Use `canon task phase <id> <phase> <status>`.",
  branch: "load-bearing git identity; retargeting it desyncs the worktree. Not settable via `canon task set`.",
  phases: "nested orchestrator-owned state. Use `canon task phase`, `canon task reset-spec-review`, `canon task reset-code-review`, or `canon task accept` instead.",
  sessions: "nested orchestrator-owned state. Use `canon task phase`, `canon task reset-spec-review`, `canon task reset-code-review`, or `canon task accept` instead.",
  canon: "nested orchestrator-owned state. `status.json.canon` is stamped by canon snapshot; use `CANON_UPSTREAM_REPO` to override the upstream slug, not `canon task set`.",
  escalations: "nested orchestrator-owned state. Use `canon task phase`, `canon task reset-spec-review`, `canon task reset-code-review`, or `canon task accept` instead."
};
var TASK_SIZE_VALUES = /* @__PURE__ */ new Set(["XS", "S", "M", "L", "XL"]);
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function usage() {
  return [
    "Usage: canon task <command> [args]",
    "",
    "Commands:",
    "  new <TASK-ID> <title> [--base <branch>]",
    "  list",
    "  status <TASK-ID>",
    "  phase <TASK-ID> <phase> <status> [verdict]",
    '  accept <TASK-ID...> <phase> [--reason "<text>"] [--force]',
    "  set <TASK-ID> <field> <value>",
    "  reset-spec-review <TASK-ID>",
    "  reset-code-review <TASK-ID>",
    "  post-merge-sync [<branch>]"
  ].join("\n");
}
function validateTaskId(id) {
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
function taskDirFromRoot(taskId) {
  return path10.join(tasksRoot(), taskId);
}
function taskDirForCwd(_cwd, taskId) {
  const root = tasksRoot();
  if (path10.isAbsolute(root)) {
    return path10.join(root, taskId);
  }
  return path10.join(resolveTaskCwd(taskId), root, taskId);
}
function taskStatusFileForCwd(cwd, taskId) {
  return path10.join(taskDirForCwd(cwd, taskId), "status.json");
}
function taskRootForGate(cwd) {
  const root = tasksRoot();
  return path10.isAbsolute(root) ? root : path10.join(cwd, root);
}
function templatesRoot() {
  return path10.join(process.cwd(), ".canon", "templates");
}
function taskTemplateOverrideRoot() {
  return path10.join(tasksRoot(), "_templates");
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
function runGit(args2, options = {}) {
  if (options.stdio === "inherit") {
    return spawnSync6("git", args2, {
      cwd: options.cwd ?? process.cwd(),
      encoding: "utf8",
      stdio: "inherit"
    });
  }
  return spawnSync6("git", args2, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
function git2(args2, options = {}) {
  const result = runGit(args2, options);
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr ?? "").trim() || `git ${args2.join(" ")} failed`);
  }
  return (result.stdout ?? "").trim();
}
function gitOk(args2, options = {}) {
  const result = runGit(args2, options);
  return !result.error && result.status === 0;
}
function currentBranchOrEmpty() {
  const result = runGit(["branch", "--show-current"]);
  if (result.error || result.status !== 0) return "";
  return (result.stdout ?? "").trim();
}
function copyTemplateFile(source, destination, taskId, title) {
  const content = fs10.readFileSync(source, "utf8").replaceAll("[TASK-ID]", taskId).replaceAll("[Title]", title);
  fs10.writeFileSync(destination, content, "utf8");
}
function listTemplateFiles() {
  const root = templatesRoot();
  if (!fs10.existsSync(root)) {
    throw new Error(`Error: templates directory not found at ${root}`);
  }
  return fs10.readdirSync(root).filter((name) => name.endsWith(".md") || name.endsWith(".json")).sort();
}
function printCreatedTask(taskDir, baseBranch) {
  console.log(`Created task: ${taskDir}`);
  console.log("Files:");
  for (const file of fs10.readdirSync(taskDir).sort()) {
    console.log(file);
  }
  console.log("");
  console.log(`Next: Write the spec in ${taskDir}/spec.md`);
  console.log("");
  console.log(`  Defaults: task_size=M, delicate=false, human_spec_gate=true, base_branch=${baseBranch}`);
  console.log(`  Edit ${taskDir}/status.json to adjust before running the pipeline.`);
}
function taskNew(args2) {
  let id = "";
  let title = "";
  let baseBranch = "";
  for (let i = 0; i < args2.length; i += 1) {
    const arg = args2[i] ?? "";
    if (arg === "--base") {
      const next = args2[i + 1];
      if (!next) throw new Error("--base requires a branch name");
      baseBranch = next;
      i += 1;
    } else if (arg.startsWith("--base=")) {
      baseBranch = arg.slice("--base=".length);
    } else if (!id) {
      id = arg;
    } else if (!title) {
      title = arg;
    } else {
      throw new Error(`Error: unexpected argument '${arg}'.`);
    }
  }
  if (!id || !title) {
    throw new Error("Error: usage: canon task new <TASK-ID> <title> [--base <branch>]");
  }
  validateTaskId(id);
  if (title.includes("\n")) {
    throw new Error("Error: title must be single-line (no embedded newlines).");
  }
  const taskDir = taskDirFromRoot(id);
  if (fs10.existsSync(taskDir)) {
    throw new Error(`Error: Task directory ${taskDir} already exists.`);
  }
  if (!baseBranch) {
    baseBranch = currentBranchOrEmpty() || "main";
  }
  fs10.mkdirSync(taskDir, { recursive: true });
  const overrideRoot = taskTemplateOverrideRoot();
  for (const basename2 of listTemplateFiles()) {
    const override = path10.join(overrideRoot, basename2);
    const source = fs10.existsSync(override) ? override : path10.join(templatesRoot(), basename2);
    copyTemplateFile(source, path10.join(taskDir, basename2), id, title);
  }
  const statusPath = path10.join(taskDir, "status.json");
  const status = readJsonFile(statusPath);
  status.id = id;
  status.title = title;
  status.created = today();
  status.updated = today();
  status.base_branch = baseBranch;
  writeStatusAtomic(statusPath, status);
  try {
    refreshCanonSnapshotAtPath(statusPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: created task without canon snapshot refresh: ${message}`);
  }
  printCreatedTask(taskDir, baseBranch);
}
function derivePhase(status) {
  return deriveTopLevelStatus(status);
}
function taskList() {
  const root = tasksRoot();
  if (!fs10.existsSync(root)) {
    console.log("No tasks found.");
    return;
  }
  const rows = [];
  let invalidCount = 0;
  for (const entry of fs10.readdirSync(root).sort()) {
    if (entry === "_archive" || entry === "_templates") continue;
    if (isOrphanedWorktreeState(entry)) {
      invalidCount += 1;
      let title = "(untitled)";
      try {
        const frozen = readJsonFile(path10.join(taskDirForRepoRoot(entry), "status.json"));
        title = frozen.title ?? title;
      } catch {
      }
      rows.push({
        id: entry,
        title,
        phase: `INVALID: worktree missing \u2014 restore dev-worktrees/${entry} or archive the task`
      });
      continue;
    }
    const statusPath = path10.join(taskDirForCwd(process.cwd(), entry), "status.json");
    if (!fs10.existsSync(statusPath)) continue;
    try {
      const status = readJsonFile(statusPath);
      const phase = derivePhase(status);
      rows.push({
        id: entry,
        title: status.title ?? "(untitled)",
        phase
      });
    } catch (error) {
      invalidCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      rows.push({
        id: entry,
        title: "(invalid status.json)",
        phase: `INVALID: ${message}`
      });
    }
  }
  if (rows.length === 0) {
    console.log("No tasks found.");
    return;
  }
  console.log(`${"TASK".padEnd(25)} ${"TITLE".padEnd(40)} CURRENT PHASE`);
  console.log(`${"----".padEnd(25)} ${"-----".padEnd(40)} -------------`);
  for (const row of rows) {
    console.log(`${row.id.padEnd(25)} ${row.title.padEnd(40)} ${row.phase}`);
  }
  if (invalidCount > 0) {
    throw new Error(`${invalidCount} task(s) had invalid status.json \u2014 see INVALID: rows above. Fix the malformed files or remove the task dir.`);
  }
}
function taskStatus(id) {
  if (!id) throw new Error("Task ID required");
  validateTaskId(id);
  const cwd = resolveTaskCwd(id);
  const statusPath = taskStatusFileForCwd(cwd, id);
  if (!fs10.existsSync(statusPath)) {
    throw new Error(`Error: No status.json found for task ${id}`);
  }
  const status = readJsonFile(statusPath);
  console.log(JSON.stringify(status, null, 2));
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
    throw new Error(`Error: invalid verdict '${verdict}'. Must be one of: approved, approved_with_nits, changes_requested, needs_re_review, spec_gap, sanctioned`);
  }
  if (verdict === "spec_gap" && phase !== "code_review") {
    throw new Error(`Error: verdict 'spec_gap' is only valid for the code_review phase, not '${phase}'.`);
  }
  if (verdict === "sanctioned") {
    throw new Error(
      `Error: verdict 'sanctioned' cannot be set via \`canon task phase\`. Use \`canon task accept <id> ${phase} --reason "<why>"\` instead so operator_accepted audit fields and notes.md are written.`
    );
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
  validateTaskId(id);
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
  if (statusArg === "pending" && Object.hasOwn(entry, "verdict")) {
    entry.verdict = "";
  }
  if (verdictArg && Object.hasOwn(entry, "verdict")) {
    entry.verdict = verdictArg;
  }
  if (REVIEW_PHASES.has(phaseArg)) {
    updateReviewCounters(entry, verdictArg);
  }
  if ((phaseArg === "implement" || phaseArg === "spec_review" || phaseArg === "code_review") && previousStatus === "done" && statusArg !== "done") {
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
function taskAccept(ids, phaseArg, options = {}) {
  if (ids.length === 0) throw new Error('Error: usage: canon task accept <TASK-ID...> <phase> [--reason "<text>"] [--force]');
  if (!phaseArg) throw new Error("Error: phase required (implement, spec_review, or code_review)");
  for (const id of ids) validateTaskId(id);
  assertValidPhase(phaseArg);
  if (phaseArg !== "implement" && phaseArg !== "spec_review" && phaseArg !== "code_review") {
    throw new Error(
      `Error: 'canon task accept' supports implement, spec_review, and code_review phases. Got '${phaseArg}'. For other phases use \`canon task phase <id> ${phaseArg} done [verdict]\`.`
    );
  }
  const ctxByTask = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const taskCwd = resolveTaskCwd(id);
    const statusPath = taskStatusFileForCwd(taskCwd, id);
    if (!fs10.existsSync(statusPath)) {
      throw new Error(`Error: No status.json found for task ${id} (looked in ${taskDirForCwd(taskCwd, id)}/)`);
    }
    const status = readJsonFile(statusPath);
    ctxByTask.set(id, { id, taskCwd, statusPath, status });
  }
  const worktreeModes = /* @__PURE__ */ new Set();
  for (const ctx of ctxByTask.values()) {
    worktreeModes.add(ctx.status.worktree === true);
  }
  if (worktreeModes.size > 1) {
    const worktreeTasks = [];
    const mainTasks = [];
    for (const ctx of ctxByTask.values()) {
      (ctx.status.worktree === true ? worktreeTasks : mainTasks).push(ctx.id);
    }
    throw new Error(
      `Error: bundled accept cannot mix worktree and non-worktree tasks. Worktree tasks: [${worktreeTasks.join(", ")}]. Non-worktree tasks: [${mainTasks.join(", ")}]. Run accept separately for each tree.`
    );
  }
  function resolveExpectedTreeForCtx(ctx) {
    if (ctx.status.worktree === true) return ctx.taskCwd;
    return resolveMainCheckoutRoot();
  }
  const primary = ctxByTask.get(ids[0]);
  const gitCwdRaw = resolveExpectedTreeForCtx(primary);
  const gitCwd = safeRealpath(gitCwdRaw);
  for (const ctx of ctxByTask.values()) {
    const expectedRaw = resolveExpectedTreeForCtx(ctx);
    const expected = safeRealpath(expectedRaw);
    if (expected !== gitCwd) {
      throw new Error(
        `Error: bundled accept requires all tasks to share a working tree. Task '${ids[0]}' resolves to ${gitCwdRaw} but task '${ctx.id}' resolves to ${expectedRaw}. Run accept once per worktree.`
      );
    }
  }
  if (phaseArg === "spec_review" || phaseArg === "code_review") {
    const reason = options.reason;
    if (!reason?.trim()) {
      throw new Error(
        `Error: --reason "<text>" is required when accepting ${phaseArg}. Use it to record why the review verdict is being sanctioned.`
      );
    }
    if (!options.force) {
      for (const ctx of ctxByTask.values()) {
        const blocked = priorIncompletePhases(ctx.status, phaseArg);
        if (blocked.length > 0) {
          throw new Error(`Error: cannot accept ${phaseArg} for '${ctx.id}' \u2014 prior phases not done: ${blocked.join(",")}`);
        }
      }
    }
    const baseBranches = /* @__PURE__ */ new Set();
    for (const ctx of ctxByTask.values()) {
      const b = (ctx.status.base_branch ?? "").trim();
      if (!b) throw new Error(`Error: status.json for '${ctx.id}' is missing base_branch \u2014 cannot accept a bundled review phase.`);
      baseBranches.add(b);
    }
    if (baseBranches.size > 1) {
      throw new Error(
        `Error: bundled accept requires all tasks to share base_branch. Got: ${[...baseBranches].join(", ")}. Accept one bundle at a time.`
      );
    }
    const verdictlessTasks = [...ctxByTask.values()].filter((ctx) => !(ctx.status.phases[phaseArg]?.verdict ?? "").trim()).map((ctx) => ctx.id);
    if (verdictlessTasks.length > 0) {
      const taskList2 = verdictlessTasks.join(", ");
      const message = `Error: cannot accept ${phaseArg} for [${taskList2}] - no review verdict exists to sanction. Run the review first, or pass --force to override.`;
      if (!options.force) throw new Error(message);
      for (const id of verdictlessTasks) {
        console.error(`Warning: --force bypass: ${id} has no ${phaseArg} verdict; sanctioning anyway.`);
      }
    }
    const headRevParse2 = runGit(["rev-parse", "HEAD"], { cwd: gitCwd });
    if (headRevParse2.error || headRevParse2.status !== 0) {
      const stderr = (headRevParse2.stderr ?? "").trim() || "unknown error";
      throw new Error(
        `Error: failed to read HEAD from ${gitCwd} (${stderr}). Cannot record operator_accepted_sha for ${phaseArg}; verify the working tree has a HEAD, then re-run.`
      );
    }
    const sharedSha2 = (headRevParse2.stdout ?? "").trim();
    if (!sharedSha2) {
      throw new Error(`Error: \`git rev-parse HEAD\` from ${gitCwd} returned an empty string; refusing to accept without a usable SHA.`);
    }
    const originalSnapshots2 = /* @__PURE__ */ new Map();
    for (const ctx of ctxByTask.values()) {
      try {
        originalSnapshots2.set(ctx.statusPath, fs10.readFileSync(ctx.statusPath, "utf8"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Error: failed to read ${ctx.statusPath} for rollback snapshot: ${message}`);
      }
    }
    const advancingVerdicts = /* @__PURE__ */ new Set(["approved", "approved_with_nits"]);
    const completedWrites2 = [];
    try {
      for (const ctx of ctxByTask.values()) {
        const reviewEntry = ensurePhaseEntry(ctx.status, phaseArg);
        const currentVerdict = reviewEntry.verdict ?? "";
        if (!advancingVerdicts.has(currentVerdict)) {
          reviewEntry.verdict = "sanctioned";
          reviewEntry.operator_accepted = true;
          reviewEntry.operator_accepted_at = today();
          reviewEntry.operator_accepted_sha = sharedSha2;
        } else {
          delete reviewEntry.operator_accepted;
          delete reviewEntry.operator_accepted_at;
          delete reviewEntry.operator_accepted_sha;
        }
        reviewEntry.status = "done";
        ctx.status.updated = today();
        writeStatusAtomic(ctx.statusPath, ctx.status);
        completedWrites2.push(ctx.statusPath);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const filePath of completedWrites2) {
        const original = originalSnapshots2.get(filePath);
        if (original === void 0) continue;
        try {
          const tmpFile = `${filePath}.rollback.tmp`;
          fs10.writeFileSync(tmpFile, original, "utf8");
          fs10.renameSync(tmpFile, filePath);
        } catch (rollbackErr) {
          const message = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          rollbackErrors.push(`    ${filePath}: ${message}`);
        }
      }
      const originalMessage = error instanceof Error ? error.message : String(error);
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Error: bundled review accept failed mid-write AND rollback also failed.
  Original error: ${originalMessage}
  Rollback failures:
${rollbackErrors.join("\n")}`
        );
      }
      throw new Error(`Error: bundled review accept failed; rolled back to pre-accept state. Original error: ${originalMessage}`);
    }
    for (const ctx of ctxByTask.values()) {
      const notesPath = path10.join(taskDirForCwd(ctx.taskCwd, ctx.id), "notes.md");
      const entry = ctx.status.phases[phaseArg];
      const sanctioned = entry?.verdict === "sanctioned";
      const bundleNote = ids.length > 1 ? ` Bundle: ${ids.join(", ")}.` : "";
      const noteLine = `[${today()}] Operator accepted ${phaseArg} via \`canon task accept\` \u2014 ${sanctioned ? "sanctioned (agent verdict overridden)" : "unblocked (advancing verdict preserved)"}. Reason: ${reason}.${bundleNote}`;
      try {
        if (fs10.existsSync(notesPath)) {
          fs10.appendFileSync(notesPath, `
${noteLine}
`, "utf8");
        } else {
          fs10.writeFileSync(notesPath, `${noteLine}
`, "utf8");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Warning: failed to log to notes.md for ${ctx.id}: ${message}`);
      }
    }
    const label2 = ids.length === 1 ? ids[0] : `[${ids.join(", ")}]`;
    const nextPhase = phaseArg === "spec_review" ? "plan" : "qa";
    console.log(
      `Accepted ${label2}: ${phaseArg} \u2192 done.
  Next phase: ${nextPhase}. Run \`canon run ${ids.join(" ")}\` to continue.`
    );
    return;
  }
  if (!options.force) {
    for (const ctx of ctxByTask.values()) {
      const blocked = priorIncompletePhases(ctx.status, phaseArg);
      if (blocked.length > 0) {
        throw new Error(`Error: cannot accept ${phaseArg} for '${ctx.id}' \u2014 prior phases not done: ${blocked.join(",")}`);
      }
    }
    ensureGitAvailable();
    const dirty = git2(["status", "--porcelain=v1", "-uall"], { cwd: gitCwd });
    const dirtyLines = dirty.split("\n").filter((line) => line.trim() !== "");
    const sourceDirty = dirtyLines.filter((line) => {
      const dirtyPath = parsePorcelainPath(line);
      if (!dirtyPath) return true;
      return !ids.some((id) => isPipelineOwnedAcceptPath(dirtyPath, id, gitCwd));
    });
    if (sourceDirty.length > 0) {
      throw new Error(
        `Error: working tree is not clean \u2014 accept would silently skip uncommitted changes.
  Dirty source paths (first 20):
` + sourceDirty.slice(0, 20).map((line) => `    ${line}`).join("\n") + `
  Commit or stash these changes first, or re-run with --force if you genuinely want to ignore them.`
      );
    }
    const baseBranches = /* @__PURE__ */ new Set();
    for (const ctx of ctxByTask.values()) {
      const b = (ctx.status.base_branch ?? "").trim();
      if (!b) throw new Error(`Error: status.json for '${ctx.id}' is missing base_branch \u2014 cannot determine the diff baseline for accept.`);
      baseBranches.add(b);
    }
    if (baseBranches.size > 1) {
      throw new Error(
        `Error: bundled accept requires all tasks to share base_branch. Got: ${[...baseBranches].join(", ")}. Accept one bundle at a time.`
      );
    }
    const baseBranch = [...baseBranches][0];
    if (!gitOk(["rev-parse", "--verify", baseBranch], { cwd: gitCwd })) {
      throw new Error(
        `Error: base branch '${baseBranch}' is not reachable from ${gitCwd}. Fetch it or pass --force if you know the diff baseline is intentional.`
      );
    }
    const diffResult = runGit(["diff", `${baseBranch}...HEAD`, "--name-status", "-M"], { cwd: gitCwd });
    if (diffResult.error || diffResult.status !== 0) {
      throw new Error(`Error: git diff ${baseBranch}...HEAD failed: ${(diffResult.stderr ?? "").trim() || "unknown error"}`);
    }
    const { diffFiles, renamePairs } = parseDiffNameStatus(diffResult.stdout ?? "");
    if (diffFiles.length === 0 && renamePairs.length === 0) {
      throw new Error(
        `Error: ${baseBranch}...HEAD is empty \u2014 no work has landed on this branch.
  Commit your changes on the task branch first, or pass --force to accept an empty implement phase anyway.`
      );
    }
    const handoffFilesByTask = /* @__PURE__ */ new Map();
    const allHandoffFiles = /* @__PURE__ */ new Set();
    const allMalformed = [];
    for (const ctx of ctxByTask.values()) {
      const { files, malformed } = parseHandoffChangesRows(ctx.id);
      handoffFilesByTask.set(ctx.id, files);
      for (const file of files) allHandoffFiles.add(file);
      for (const m of malformed) allMalformed.push({ taskId: ctx.id, cell: m.cell, reason: m.reason });
    }
    if (allMalformed.length > 0) {
      const lines = allMalformed.slice(0, 10).map((m) => `    [${m.taskId}] '${m.cell}': ${m.reason}`);
      const tail = allMalformed.length > 10 ? `
    (+${allMalformed.length - 10} more)` : "";
      throw new Error(
        `Error: handoff.md has malformed Changes rows \u2014 fix these before accepting.
` + lines.join("\n") + tail + `
  Use --force to accept anyway, but the code_review pre-flight will still reject the run.`
      );
    }
    const gitIgnoredHandoffFiles = filterGitIgnoredPaths([...allHandoffFiles], gitCwd);
    const coverageIssues = verifyHandoffAgainstDiffFromData(
      [...ids],
      {
        diffFiles,
        renamePairs,
        handoffFilesByTask,
        gitIgnoredHandoffFiles
      }
    );
    if (coverageIssues.length > 0) {
      const lines = coverageIssues.slice(0, 10).map((i) => `    ${i}`);
      const tail = coverageIssues.length > 10 ? `
    (+${coverageIssues.length - 10} more)` : "";
      throw new Error(
        `Error: handoff.md does not match \`git diff ${baseBranch}...HEAD\` \u2014 fix the Changes table before accepting:
` + lines.join("\n") + tail + `
  Use --force to accept anyway, but the code_review pre-flight will still reject the run.`
      );
    }
  }
  const headRevParse = runGit(["rev-parse", "HEAD"], { cwd: gitCwd });
  if (headRevParse.error || headRevParse.status !== 0) {
    const stderr = (headRevParse.stderr ?? "").trim() || "unknown error";
    throw new Error(
      `Error: failed to read HEAD from ${gitCwd} (${stderr}). Cannot pin operator_accepted_sha \u2014 accept would silently demote on the next run. Verify the working tree has a HEAD (no unborn branch / detached state issues), then re-run.`
    );
  }
  const sharedSha = (headRevParse.stdout ?? "").trim();
  if (!sharedSha) {
    throw new Error(
      `Error: \`git rev-parse HEAD\` from ${gitCwd} returned an empty string. Refusing to accept without a usable SHA \u2014 see above for the working-tree state.`
    );
  }
  const originalSnapshots = /* @__PURE__ */ new Map();
  for (const ctx of ctxByTask.values()) {
    try {
      originalSnapshots.set(ctx.statusPath, fs10.readFileSync(ctx.statusPath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Error: failed to read ${ctx.statusPath} for rollback snapshot: ${message}`);
    }
  }
  const completedWrites = [];
  try {
    for (const ctx of ctxByTask.values()) {
      const implementEntry = ensurePhaseEntry(ctx.status, "implement");
      implementEntry.status = "done";
      implementEntry.operator_accepted = true;
      implementEntry.operator_accepted_at = today();
      implementEntry.operator_accepted_sha = sharedSha;
      ctx.status.updated = today();
      writeStatusAtomic(ctx.statusPath, ctx.status);
      completedWrites.push(ctx.statusPath);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const filePath of completedWrites) {
      const original = originalSnapshots.get(filePath);
      if (original === void 0) continue;
      try {
        const tmpFile = `${filePath}.rollback.tmp`;
        fs10.writeFileSync(tmpFile, original, "utf8");
        fs10.renameSync(tmpFile, filePath);
      } catch (rollbackErr) {
        const message = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        rollbackErrors.push(`    ${filePath}: ${message}`);
      }
    }
    const originalMessage = error instanceof Error ? error.message : String(error);
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Error: bundled accept failed mid-write AND rollback also failed.
  Original error: ${originalMessage}
  Rollback failures (the following status.json files are in an inconsistent state):
` + rollbackErrors.join("\n") + `
  Restore manually from git history.`
      );
    }
    throw new Error(`Error: bundled accept failed; rolled back to pre-accept state. Original error: ${originalMessage}`);
  }
  for (const ctx of ctxByTask.values()) {
    const notesPath = path10.join(taskDirForCwd(ctx.taskCwd, ctx.id), "notes.md");
    const noteLine = `[${today()}] Operator accepted implement phase via \`canon task accept\` \u2014 auto-commit will be skipped.${options.force ? " (--force)" : ""}`;
    try {
      if (fs10.existsSync(notesPath)) {
        fs10.appendFileSync(notesPath, `
${noteLine}
`, "utf8");
      } else {
        fs10.writeFileSync(notesPath, `${noteLine}
`, "utf8");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Warning: failed to log to notes.md for ${ctx.id}: ${message}`);
    }
  }
  const label = ids.length === 1 ? ids[0] : `[${ids.join(", ")}]`;
  console.log(
    `Accepted ${label}: implement \u2192 done (operator_accepted=true).` + (options.force ? " (--force)" : "") + `
  Auto-commit will be skipped on subsequent \`canon run\` invocations. The next phase (code_review) will run normally against the committed work.`
  );
}
function taskResetSpecReview(id) {
  if (!id) throw new Error("Error: usage: canon task reset-spec-review <TASK-ID>");
  validateTaskId(id);
  const taskCwd = resolveTaskCwd(id);
  const taskDir = taskDirForCwd(taskCwd, id);
  const statusPath = path10.join(taskDir, "status.json");
  if (!fs10.existsSync(statusPath)) {
    throw new Error(`Error: no status.json at ${statusPath}`);
  }
  const reviewPath = path10.join(taskDir, "spec-review.md");
  if (fs10.existsSync(reviewPath)) {
    let n = 1;
    while (fs10.existsSync(path10.join(taskDir, `spec-review-prior-${n}.md`))) n += 1;
    fs10.renameSync(reviewPath, path10.join(taskDir, `spec-review-prior-${n}.md`));
    console.log(`Archived prior spec-review.md \u2192 spec-review-prior-${n}.md`);
  }
  const status = readJsonFile(statusPath);
  const spec = ensurePhaseEntry(status, "spec");
  const specReview = ensurePhaseEntry(status, "spec_review");
  spec.status = "done";
  specReview.status = "pending";
  specReview.iterations = 0;
  specReview.iterations_current_loop = 0;
  specReview.verdict = "";
  if (status.sessions && Object.hasOwn(status.sessions, "claude_spec")) {
    delete status.sessions.claude_spec;
  }
  status.updated = today();
  writeStatusAtomic(statusPath, status);
  console.log(`Reset ${id}: spec \u2192 done, spec_review \u2192 pending (iter=0, verdict cleared, claude_spec session dropped)`);
}
function taskResetCodeReview(id) {
  if (!id) throw new Error("Error: usage: canon task reset-code-review <TASK-ID>");
  validateTaskId(id);
  const taskCwd = resolveTaskCwd(id);
  const taskDir = taskDirForCwd(taskCwd, id);
  const statusPath = path10.join(taskDir, "status.json");
  if (!fs10.existsSync(statusPath)) {
    throw new Error(`Error: no status.json at ${statusPath}`);
  }
  const status = readJsonFile(statusPath);
  const currentPhase = deriveTopLevelStatus(status);
  if (currentPhase !== "code_review") {
    throw new Error(`Error: reset-code-review only operates on tasks currently at code_review. Current phase: ${currentPhase}.`);
  }
  const reviewPath = path10.join(taskDir, "review.md");
  if (fs10.existsSync(reviewPath)) {
    let n = 1;
    while (fs10.existsSync(path10.join(taskDir, `review-prior-${n}.md`))) n += 1;
    fs10.renameSync(reviewPath, path10.join(taskDir, `review-prior-${n}.md`));
    console.log(`Archived prior review.md \u2192 review-prior-${n}.md`);
  }
  const codeReview = ensurePhaseEntry(status, "code_review");
  codeReview.status = "pending";
  codeReview.iterations_current_loop = 0;
  codeReview.iterations = 0;
  codeReview.preflight_rejections_current_loop = 0;
  codeReview.verdict = "";
  if (status.sessions && Object.hasOwn(status.sessions, "claude_review")) {
    delete status.sessions.claude_review;
  }
  status.updated = today();
  writeStatusAtomic(statusPath, status);
  console.log(
    `Reset ${id}: code_review \u2192 pending (iter_current_loop=0, iterations=0, preflight_rejections_current_loop=0, verdict cleared, claude_review session dropped)`
  );
}
function ensureGitAvailable() {
  const result = spawnSync6("git", ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error("Error: git is required.");
  }
}
function parsePorcelainPath(line) {
  if (line.length < 3) return null;
  const raw = line.slice(3).trim();
  if (!raw) return null;
  const arrow = raw.lastIndexOf(" -> ");
  const tail = arrow >= 0 ? raw.slice(arrow + 4) : raw;
  return tail.replace(/^"|"$/g, "");
}
function isPipelineOwnedAcceptPath(filePath, taskId, gitCwd) {
  const repoRootForPaths = resolveRepoRootForAccept(gitCwd);
  const dirtyAbsolute = path10.isAbsolute(filePath) ? filePath : path10.resolve(repoRootForPaths, filePath);
  const canonicalDirty = safeRealpath(dirtyAbsolute);
  const root = tasksRoot();
  const rootAbsolute = path10.isAbsolute(root) ? root : path10.resolve(repoRootForPaths, root);
  const canonicalRoot = safeRealpath(rootAbsolute);
  const taskCanonical = path10.join(canonicalRoot, taskId);
  if (canonicalDirty === taskCanonical) return true;
  if (canonicalDirty.startsWith(`${taskCanonical}${path10.sep}`)) return true;
  for (const telemetry of PIPELINE_TELEMETRY_FILES) {
    const telemetryAbsolute = path10.resolve(repoRootForPaths, telemetry);
    if (safeRealpath(telemetryAbsolute) === canonicalDirty) return true;
  }
  return false;
}
function resolveRepoRootForAccept(gitCwd) {
  const result = runGit(["rev-parse", "--show-toplevel"], { cwd: gitCwd });
  if (result.error || result.status !== 0) return gitCwd;
  return (result.stdout ?? "").trim() || gitCwd;
}
function resolveMainCheckoutRoot() {
  const out = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: process.cwd() });
  if (out.error || out.status !== 0) return process.cwd();
  const gitCommonDir = (out.stdout ?? "").trim();
  if (!gitCommonDir) return process.cwd();
  return path10.dirname(gitCommonDir);
}
function safeRealpath(target) {
  try {
    return fs10.realpathSync(target);
  } catch {
    const parent = path10.dirname(target);
    if (parent === target) return target;
    try {
      return path10.join(fs10.realpathSync(parent), path10.basename(target));
    } catch {
      return target;
    }
  }
}
function findUntrackedClobberPaths(untracked, targetTreeFiles) {
  const conflicts = [];
  for (const u of untracked) {
    if (targetTreeFiles.has(u)) {
      conflicts.push(u);
      continue;
    }
    let p = u;
    let hit = false;
    while (true) {
      const slash = p.lastIndexOf("/");
      if (slash === -1) break;
      p = p.slice(0, slash);
      if (targetTreeFiles.has(p)) {
        conflicts.push(u);
        hit = true;
        break;
      }
    }
    if (hit) continue;
    const prefix = `${u}/`;
    for (const t of targetTreeFiles) {
      if (t.startsWith(prefix)) {
        conflicts.push(u);
        break;
      }
    }
  }
  return conflicts;
}
function taskPostMergeSync(branchArg) {
  ensureGitAvailable();
  let targetBranch = branchArg ?? "";
  if (!targetBranch) targetBranch = currentBranchOrEmpty();
  if (!targetBranch) {
    throw new Error("Error: could not determine current branch (detached HEAD?). Pass branch as arg.");
  }
  const current = currentBranchOrEmpty();
  if (current !== targetBranch) {
    throw new Error(`Error: post-merge-sync expects you to be on '${targetBranch}' (you are on '${current}').`);
  }
  console.log(`\u2192 Fetching origin/${targetBranch}...`);
  const fetch = runGit(["fetch", "origin", targetBranch]);
  if (fetch.error || fetch.status !== 0) {
    throw new Error("Error: git fetch failed.");
  }
  const ahead = Number.parseInt(git2(["rev-list", "--count", `origin/${targetBranch}..${targetBranch}`]) || "0", 10);
  const behind = Number.parseInt(git2(["rev-list", "--count", `${targetBranch}..origin/${targetBranch}`]) || "0", 10);
  if (ahead === 0 && behind === 0) {
    console.log(`\u2713 ${targetBranch} is in sync with origin/${targetBranch}.`);
    nudgeShippableTasks();
    return;
  }
  if (ahead === 0 && behind > 0) {
    console.log(`\u2192 ${targetBranch} is ${behind} commit(s) behind origin/${targetBranch}, fast-forwarding...`);
    const pull = runGit(["pull", "--ff-only", "origin", targetBranch], { stdio: "inherit" });
    if (pull.error || pull.status !== 0) throw new Error(pull.error?.message ?? "git pull failed");
    nudgeShippableTasks();
    return;
  }
  const diff = git2(["diff", "--name-only", `origin/${targetBranch}..${targetBranch}`]);
  const sourcePaths = diff.split("\n").filter(Boolean).filter(
    (file) => !/^(docs\/pipeline-invocations\.md|docs\/task-quality-log\.md|docs\/lessons-learned\.md|tasks\/)/.test(file)
  );
  if (sourcePaths.length === 0) {
    if (git2(["diff", "--name-only", "HEAD"]) || git2(["diff", "--cached", "--name-only"])) {
      throw new Error(
        "Error: working tree has dirty tracked files and post-merge-sync is about to `git reset --hard`.\n  Commit or stash the tracked changes before re-running."
      );
    }
    const localFiles = git2(["ls-files", "--others"]).split("\n").filter(Boolean);
    if (localFiles.length > 0) {
      const targetTreeFiles = new Set(
        git2(["ls-tree", "-r", `origin/${targetBranch}`, "--name-only"]).split("\n").filter(Boolean)
      );
      const conflicting = findUntrackedClobberPaths(localFiles, targetTreeFiles);
      if (conflicting.length > 0) {
        throw new Error(
          "Error: local files (untracked or gitignored) match paths tracked in `origin/" + targetBranch + "`.\n  `git reset --hard` would silently overwrite them:\n" + conflicting.map((f) => `    ${f}`).join("\n") + "\n  Move, rename, or remove these files before re-running."
        );
      }
    }
    console.log(`\u2192 ${targetBranch} is ${ahead} commit(s) ahead of origin/${targetBranch}, but only via`);
    console.log("  pipeline telemetry / task-state edits that have been absorbed by squash merges.");
    console.log(`  Hard-resetting to origin/${targetBranch}...`);
    const reset = runGit(["reset", "--hard", `origin/${targetBranch}`], { stdio: "inherit" });
    if (reset.error || reset.status !== 0) throw new Error(reset.error?.message ?? "git reset failed");
    console.log(`\u2713 ${targetBranch} reset to origin/${targetBranch} (${git2(["log", "-1", "--format=%h"])}).`);
    nudgeShippableTasks();
    return;
  }
  console.log(`\u26A0\uFE0F  ${targetBranch} is ${ahead} commit(s) ahead of origin/${targetBranch} with non-telemetry changes:`);
  console.log("");
  for (const file of sourcePaths) console.log(`    ${file}`);
  console.log("");
  console.log("Refusing to hard-reset. Either push these commits to origin");
  console.log(`(\`git push origin ${targetBranch}\`) if they're real work, or rebase manually`);
  console.log("if they conflict with the squash merge.");
  throw new Error("");
}
function nudgeShippableTasks() {
  const root = tasksRoot();
  if (!fs10.existsSync(root)) return;
  const shippable = [];
  for (const entry of fs10.readdirSync(root).sort()) {
    if (entry === "_archive" || entry.startsWith("_")) continue;
    const statusPath = path10.join(root, entry, "status.json");
    if (!fs10.existsSync(statusPath)) continue;
    let status;
    try {
      status = readJsonFile(statusPath);
    } catch {
      continue;
    }
    const phase = derivePhase(status);
    if (phase !== "human_review" && phase !== "complete") continue;
    const branchName = status.branch?.trim();
    if (!branchName) continue;
    const ls = runGit(["ls-remote", "--heads", "--exit-code", "origin", branchName]);
    if (ls.error) continue;
    if (ls.status === 0) continue;
    if (ls.status === 2) shippable.push(entry);
  }
  if (shippable.length === 0) return;
  console.log("");
  console.log("\u2139 Task(s) appear merged (remote branch gone) but not yet archived:");
  for (const id of shippable) console.log(`    ${id}`);
  console.log("  Run `canon run <id> --ship` on each to archive + clean up.");
}
function taskSetValue(taskId, field, value, status) {
  switch (field) {
    case "title":
      if (value.includes("\n") || value.includes("\r")) {
        throw new Error("Error: title must be single-line (no embedded newlines).");
      }
      status.title = value;
      return;
    case "task_size":
      if (!TASK_SIZE_VALUES.has(value)) {
        throw new Error(`Error: invalid task_size '${value}'. Must be one of: XS, S, M, L, XL.`);
      }
      status.task_size = value;
      return;
    case "delicate":
    case "worktree": {
      const normalized = value.toLowerCase();
      if (normalized !== "true" && normalized !== "false") {
        throw new Error(`Error: invalid ${field} '${value}'. Must be true or false.`);
      }
      status[field] = normalized === "true";
      return;
    }
    case "base_branch": {
      const trimmed = value.trim();
      if (trimmed === "") {
        throw new Error("Error: base_branch must not be empty or whitespace-only.");
      }
      validateBranchField(trimmed, taskId, "base_branch");
      status.base_branch = trimmed;
      return;
    }
    default:
      throw new Error(`Error: internal error \u2014 unsupported settable field '${field}'.`);
  }
}
function taskSetRedirectMessage(field) {
  return REDIRECT_MESSAGES[field] ?? "nested orchestrator-owned state. Use the owning canon task command instead.";
}
function taskHasStarted(status) {
  return Object.values(status.phases).some((entry) => (entry?.status ?? "pending") !== "pending");
}
function taskSet(args2) {
  const [id, field, value] = args2;
  if (!id || !field || value === void 0) {
    throw new Error("Error: usage: canon task set <TASK-ID> <field> <value>");
  }
  if (args2.length > 3) {
    throw new Error(`Error: unexpected argument '${args2[3]}'. Quote multi-word values, e.g. canon task set <id> title "My Title".`);
  }
  validateTaskId(id);
  const taskCwd = resolveTaskCwd(id);
  const statusPath = taskStatusFileForCwd(taskCwd, id);
  if (!fs10.existsSync(statusPath)) {
    throw new Error(`Error: No status.json found for task ${id}`);
  }
  const status = readJsonFile(statusPath);
  const recordedBranch = (status.branch ?? "").trim();
  if (recordedBranch && (field === "worktree" || field === "base_branch")) {
    throw new Error(
      `Error: ${field} is locked once branch '${recordedBranch}' is recorded. Topology changes are only allowed before branching; recreate the task or migrate status.json manually.`
    );
  }
  if (SETTABLE_FIELD_SET.has(field)) {
    taskSetValue(id, field, value, status);
    status.updated = today();
    writeStatusAtomic(statusPath, status);
    if (taskHasStarted(status)) {
      console.log(`Warning: ${field} on task ${id} takes effect on the next canon run.`);
    }
    return;
  }
  if (field === "full_send") {
    throw new Error(`Error: full_send is ${taskSetRedirectMessage(field)}`);
  }
  if (field === "human_spec_gate") {
    throw new Error(`Error: human_spec_gate is ${taskSetRedirectMessage(field)}`);
  }
  if (field === "status") {
    throw new Error(`Error: status is ${taskSetRedirectMessage(field)}`);
  }
  if (field === "branch") {
    throw new Error(`Error: branch is ${taskSetRedirectMessage(field)}`);
  }
  if (field === "phases" || field === "sessions" || field === "canon" || field === "escalations") {
    throw new Error(`Error: ${field} is ${taskSetRedirectMessage(field)}`);
  }
  if (IMMUTABLE_FIELDS.has(field) || field.startsWith("_")) {
    throw new Error(`Error: field '${field}' is immutable / not editable.`);
  }
  throw new Error(
    `Error: unknown field '${field}'. Settable fields: ${SETTABLE_FIELDS.join(", ")}. Other recognized fields are redirected or immutable.`
  );
}
function taskCmd(args2) {
  const [subcommand, ...rest] = args2;
  try {
    switch (subcommand) {
      case "new":
        taskNew(rest);
        break;
      case "list":
        taskList();
        break;
      case "status":
        taskStatus(rest[0] ?? "");
        break;
      case "phase":
        taskPhase(rest[0] ?? "", rest[1] ?? "", rest[2] ?? "", rest[3]);
        break;
      case "set":
        taskSet(rest);
        break;
      case "accept": {
        const force = rest.includes("--force");
        let reason;
        const positional = [];
        for (let i = 0; i < rest.length; i += 1) {
          const arg = rest[i];
          if (arg === "--force") continue;
          if (arg === "--reason") {
            reason = rest[i + 1];
            i += 1;
            continue;
          }
          positional.push(arg);
        }
        if (positional.length < 2) {
          throw new Error('Error: usage: canon task accept <TASK-ID...> <phase> [--reason "<text>"] [--force]');
        }
        const acceptPhase = positional[positional.length - 1];
        const acceptIds = positional.slice(0, -1);
        taskAccept(acceptIds, acceptPhase, { force, reason });
        break;
      }
      case "reset-spec-review":
        taskResetSpecReview(rest[0] ?? "");
        break;
      case "reset-code-review":
        taskResetCodeReview(rest[0] ?? "");
        break;
      case "post-merge-sync":
        taskPostMergeSync(rest[0]);
        break;
      default:
        console.error(`Unknown subcommand: ${subcommand ?? "(none)"}
${usage()}`);
        process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message) console.error(message);
    process.exit(1);
  }
}

// src/cli/commands/task.ts
function taskCmd2(args2) {
  taskCmd(args2);
}

// src/cli/commands/update.ts
import { existsSync as existsSync4 } from "fs";
import { fileURLToPath as fileURLToPath4 } from "url";
import { dirname as dirname3, join as join4 } from "path";
import { spawnSync as spawnSync7 } from "child_process";
var packageDir3 = join4(dirname3(fileURLToPath4(import.meta.url)), "../..");
function detectInstallType(pkgDirOverride) {
  const dir = pkgDirOverride ?? packageDir3;
  if (dir.includes("/_npx/") || dir.includes("\\_npx\\")) return "npx";
  const nodeModulesIdx = dir.lastIndexOf("/node_modules/");
  if (nodeModulesIdx !== -1) {
    const projectRoot = dir.slice(0, nodeModulesIdx);
    if (existsSync4(join4(projectRoot, "package.json"))) return "local";
  }
  return "global";
}
var CANON_GITHUB_SOURCE = "github:tstraub89/canon-ai";
function updateCmd(_args) {
  const cwd = process.cwd();
  const installType = detectInstallType();
  if (installType === "npx") {
    console.log("\nRunning via npx \u2014 no persistent install to update.");
    console.log("To apply the latest templates, re-run from the latest source:\n");
    console.log(`  npx --install-links ${CANON_GITHUB_SOURCE} upgrade
`);
    return;
  }
  let cmdArgs;
  if (installType === "local") {
    cmdArgs = ["install", "--save-dev", "--install-links", CANON_GITHUB_SOURCE];
    console.log("\nUpdating canon-ai (local devDependency, from GitHub)...\n");
  } else {
    cmdArgs = ["install", "-g", "--install-links", CANON_GITHUB_SOURCE];
    console.log("\nUpdating canon-ai (global install, from GitHub)...\n");
  }
  const result = spawnSync7("npm", cmdArgs, { stdio: "inherit", cwd });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log("\ncanon-ai updated. Run `canon upgrade` to sync vendored files in this repo.\n");
}

// src/cli/commands/upgrade.ts
import { existsSync as existsSync5, readFileSync as readFileSync3, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { fileURLToPath as fileURLToPath5 } from "url";
import { basename, dirname as dirname4, join as join5, relative as relative2, resolve } from "path";
import { spawnSync as spawnSync8 } from "child_process";

// src/lib/canon-owned.ts
var CANON_OWNED = [
  ".canon/README.md",
  ".claude/skills/canon-init/SKILL.md",
  ".claude/skills/canon-spec/SKILL.md",
  ".claude/skills/canon-init/write-guide.md",
  ".claude/skills/canon-pipeline/SKILL.md",
  ".claude/skills/canon-pipeline/recovery.md",
  ".claude/skills/canon-status/SKILL.md",
  ".claude/skills/canon-changelog/SKILL.md",
  ".claude/skills/canon-spec-review/SKILL.md",
  ".claude/skills/canon-inline-review/SKILL.md",
  ".claude/agents/code-review-anchored.md",
  ".claude/agents/code-review-cold.md",
  ".canon/templates/status.json",
  ".canon/templates/spec.md",
  ".canon/templates/plan.md",
  ".canon/templates/handoff.md",
  ".canon/templates/spec-review.md",
  ".canon/templates/review.md",
  ".canon/templates/done.md",
  ".canon/templates/pr-body.md",
  ".canon/templates/notes.md",
  "docs/pipeline-orchestrator.md",
  "scripts/docs-refs-check.mjs",
  "scripts/docs-refs-check.mjs.d.ts"
];
var DELIMITED = [];

// src/cli/commands/upgrade.ts
var packageDir4 = join5(dirname4(fileURLToPath5(import.meta.url)), "../..");
var CANON_END = "<!-- canon:end -->";
var CANON_START_RE = /<!-- canon:start[^>]* -->/;
var HEADER_ONLY_SYNC = [
  "docs/pipeline-invocations.md"
];
function mergeDelimited(templateContent, projectContent) {
  if (!CANON_START_RE.test(templateContent)) return null;
  if (!CANON_START_RE.test(projectContent)) return null;
  const templateEnd = templateContent.indexOf(CANON_END);
  const projectEnd = projectContent.indexOf(CANON_END);
  if (templateEnd === -1 || projectEnd === -1) return null;
  return templateContent.slice(0, templateEnd + CANON_END.length) + projectContent.slice(projectEnd + CANON_END.length);
}
var TABLE_SEPARATOR_RE = /^[^\S\r\n]*\|[-:|\s]+\|[^\S\r\n]*(?=\r?\n|$)/m;
function mergeHeaderOnly(templateContent, projectContent) {
  const projectMatch = TABLE_SEPARATOR_RE.exec(projectContent);
  const templateMatch = TABLE_SEPARATOR_RE.exec(templateContent);
  if (!projectMatch || !templateMatch) return null;
  const templateSepEnd = (templateMatch.index ?? 0) + templateMatch[0].length;
  const projectSepEnd = (projectMatch.index ?? 0) + projectMatch[0].length;
  const templateHeader = templateContent.slice(0, templateSepEnd);
  const projectTail = projectContent.slice(projectSepEnd);
  return templateHeader + projectTail;
}
function printDocsRefsCutoverWarning(cutoverWarnings, check) {
  if (cutoverWarnings.length === 0) return;
  console.log(`Heads-up: pre-split docs-refs checker ${check ? "would be" : "was"} replaced (inline config superseded by scripts/docs-refs-config.mjs):`);
  for (const f of cutoverWarnings) console.log(`  \u21BB ${f}`);
  console.log("");
  console.log("  If you hand-edited VALID_DIRS / NOISY_SOURCE_PATHS / MARKDOWN_ROOT_DIRS in the old");
  console.log("  checker, inspect the diff and move any custom entries into scripts/docs-refs-config.mjs:");
  if (check) {
    console.log("    (after upgrading) git diff HEAD -- scripts/docs-refs-check.mjs\n");
  } else {
    console.log("    git diff HEAD -- scripts/docs-refs-check.mjs      # what changed");
    console.log("    git show HEAD:scripts/docs-refs-check.mjs         # the pre-upgrade checker\n");
  }
}
function printStaleOverrideNudge(staleOverrides, check) {
  if (staleOverrides.length === 0) return;
  console.log(`Heads-up: canon templates ${check ? "that would be changed by this upgrade" : "changed by this upgrade"} have customized task-template overrides that ${check ? "would not be auto-updated" : "were not auto-updated"}:`);
  console.log("  These override files were NOT updated automatically; review them manually:");
  for (const overridePath of staleOverrides) {
    const name = basename(overridePath);
    console.log(`  \u21BB ${overridePath}`);
    console.log(`    diff .canon/templates/${name} ${overridePath}`);
  }
  console.log("");
}
function getTaskTemplateBasenames() {
  return CANON_OWNED.filter((rel) => rel.startsWith(".canon/templates/")).map((rel) => basename(rel));
}
function getStaleOverrides(cwd, changedOps) {
  const changedByRel = new Map(changedOps.map((op) => [op.rel, op.content]));
  if (changedByRel.size === 0) return [];
  const templateBasenames = getTaskTemplateBasenames();
  const overrideRootAbs = resolve(cwd, taskTemplateOverrideRoot());
  const staleOverrides = [];
  for (const name of templateBasenames) {
    const canonRel = `.canon/templates/${name}`;
    const newTemplateContent = changedByRel.get(canonRel);
    if (newTemplateContent === void 0) continue;
    const overridePathAbs = join5(overrideRootAbs, name);
    if (!existsSync5(overridePathAbs)) continue;
    const overrideContent = readFileSync3(overridePathAbs, "utf8");
    if (overrideContent === newTemplateContent) continue;
    staleOverrides.push(relative2(cwd, overridePathAbs));
  }
  return staleOverrides;
}
function classifyDestinations(cwd, relPaths) {
  const classes = /* @__PURE__ */ new Map();
  const uniqueRelPaths = [...new Set(relPaths)];
  if (uniqueRelPaths.length === 0) return classes;
  const probe = spawnSync8("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const gitAvailable = probe.status === 0 && !probe.error && probe.stdout.trim() === "true";
  if (!gitAvailable) {
    for (const rel of uniqueRelPaths) {
      classes.set(rel, existsSync5(join5(cwd, rel)) ? "unverifiable" : "absent");
    }
    return classes;
  }
  const lsFiles = spawnSync8("git", ["ls-files", "-z", "--", ...uniqueRelPaths], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const status = spawnSync8("git", ["status", "--porcelain=v1", "-z", "--", ...uniqueRelPaths], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (lsFiles.status !== 0 || lsFiles.error || status.status !== 0 || status.error) {
    for (const rel of uniqueRelPaths) {
      classes.set(rel, existsSync5(join5(cwd, rel)) ? "unverifiable" : "absent");
    }
    return classes;
  }
  const tracked = new Set((lsFiles.stdout ?? "").split("\0").filter(Boolean));
  const dirty = /* @__PURE__ */ new Set();
  const statusEntries = (status.stdout ?? "").split("\0");
  for (let i = 0; i < statusEntries.length; i += 1) {
    const entry = statusEntries[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    const rel = entry.slice(3);
    if (xy !== "??") dirty.add(rel);
    if (xy[0] === "R" || xy[0] === "C") i += 1;
  }
  for (const rel of uniqueRelPaths) {
    if (dirty.has(rel)) {
      classes.set(rel, "tracked-dirty");
      continue;
    }
    if (!tracked.has(rel)) {
      classes.set(rel, existsSync5(join5(cwd, rel)) ? "untracked-existing" : "absent");
      continue;
    }
    classes.set(rel, dirty.has(rel) ? "tracked-dirty" : "tracked-clean");
  }
  return classes;
}
function emptyRefusals() {
  return {
    trackedDirty: [],
    untrackedExisting: [],
    unverifiable: []
  };
}
function printUpgradeRefusals(refusals, prefix) {
  if (refusals.trackedDirty.length > 0) {
    console.log(`${prefix} \u2014 tracked and locally modified (commit/stash first, or pass --force):`);
    for (const f of refusals.trackedDirty) console.log(`  \u26A0 ${f}`);
    console.log("");
  }
  if (refusals.untrackedExisting.length > 0) {
    console.log(`${prefix} \u2014 exists but not tracked by git (git could not restore it after an overwrite; commit it, move it aside, or pass --force):`);
    for (const f of refusals.untrackedExisting) console.log(`  \u26A0 ${f}`);
    console.log("");
  }
  if (refusals.unverifiable.length > 0) {
    console.log(`${prefix} \u2014 git state could not be verified (git is canon upgrade's safety boundary; repair git or run inside a git repo, or pass --force):`);
    for (const f of refusals.unverifiable) console.log(`  \u26A0 ${f}`);
    console.log("");
  }
}
function runUpgrade(cwd, pkgDir, options = {}) {
  const upgraded = [];
  const unchanged = [];
  const skipped = [];
  const wouldUpgrade = [];
  const dirtyRefused = [];
  const refusals = emptyRefusals();
  const malformed = [];
  const cutoverWarnings = [];
  const pending = [];
  const delimitedFiles = DELIMITED;
  for (const rel of delimitedFiles) {
    const projectPath = join5(cwd, rel);
    const templatePath = join5(pkgDir, "templates", rel);
    if (!existsSync5(projectPath) || !existsSync5(templatePath)) {
      skipped.push(rel);
      continue;
    }
    const projectContent = readFileSync3(projectPath, "utf8");
    const templateContent = readFileSync3(templatePath, "utf8");
    const merged = mergeDelimited(templateContent, projectContent);
    if (merged === null) {
      skipped.push(`${rel} (no canon delimiters \u2014 run \`canon init\` to add them)`);
      continue;
    }
    if (merged === projectContent) {
      unchanged.push(rel);
      continue;
    }
    pending.push({ rel, projectPath, content: merged });
  }
  for (const rel of HEADER_ONLY_SYNC) {
    const projectPath = join5(cwd, rel);
    const templatePath = join5(pkgDir, "templates", rel);
    if (!existsSync5(templatePath)) {
      skipped.push(rel);
      continue;
    }
    const templateContent = readFileSync3(templatePath, "utf8");
    if (!existsSync5(projectPath)) {
      pending.push({ rel, projectPath, content: templateContent });
      continue;
    }
    const projectContent = readFileSync3(projectPath, "utf8");
    const merged = mergeHeaderOnly(templateContent, projectContent);
    if (merged === null) {
      skipped.push(`${rel} (no markdown table separator found \u2014 header-only sync needs the rows-below boundary)`);
      continue;
    }
    if (merged === projectContent) {
      unchanged.push(rel);
      continue;
    }
    pending.push({ rel, projectPath, content: merged });
  }
  for (const rel of CANON_OWNED) {
    const projectPath = join5(cwd, rel);
    const templatePath = join5(pkgDir, "templates", rel);
    if (!existsSync5(templatePath)) {
      skipped.push(rel);
      continue;
    }
    const templateContent = readFileSync3(templatePath, "utf8");
    if (existsSync5(projectPath)) {
      const projectContent = readFileSync3(projectPath, "utf8");
      if (projectContent === templateContent) {
        unchanged.push(rel);
        continue;
      }
    }
    pending.push({ rel, projectPath, content: templateContent });
  }
  const docsRefsCheckRel = "scripts/docs-refs-check.mjs";
  const docsRefsConfigRel = "scripts/docs-refs-config.mjs";
  const docsRefsCheckPath = join5(cwd, docsRefsCheckRel);
  const docsRefsConfigPath = join5(cwd, docsRefsConfigRel);
  const docsRefsCheckContent = existsSync5(docsRefsCheckPath) ? readFileSync3(docsRefsCheckPath, "utf8") : null;
  const docsRefsConfigExists = existsSync5(docsRefsConfigPath);
  const docsRefsConfigTemplatePath = join5(pkgDir, "templates", docsRefsConfigRel);
  const docsRefsConfigTemplateContent = existsSync5(docsRefsConfigTemplatePath) ? readFileSync3(docsRefsConfigTemplatePath, "utf8") : null;
  const isPreSplitDocsRefs = docsRefsCheckContent !== null && !docsRefsCheckContent.includes("./docs-refs-config.mjs");
  if (isPreSplitDocsRefs) {
    cutoverWarnings.push(docsRefsCheckRel);
  }
  const versionPath = join5(cwd, ".canon", "version");
  const newVersion = "2.2.0";
  const currentVersion = existsSync5(versionPath) ? readFileSync3(versionPath, "utf8").trim() : null;
  if (currentVersion !== newVersion) {
    pending.push({ rel: ".canon/version", projectPath: versionPath, content: newVersion + "\n" });
  }
  const gitignoreRel = ".gitignore";
  const gitignorePath = join5(cwd, gitignoreRel);
  const existingGitignore = existsSync5(gitignorePath) ? readFileSync3(gitignorePath, "utf8") : "";
  const desiredGitignore = upsertCanonBlock(existingGitignore, CANON_GITIGNORE_BLOCK);
  if (desiredGitignore === null) {
    malformed.push(gitignoreRel);
  } else if (desiredGitignore === existingGitignore) {
    unchanged.push(gitignoreRel);
  } else {
    pending.push({ rel: gitignoreRel, projectPath: gitignorePath, content: desiredGitignore });
  }
  const destinationClasses = classifyDestinations(cwd, [
    ...pending.map((op) => op.rel),
    docsRefsConfigRel
  ]);
  if (docsRefsConfigTemplateContent === null) {
    if (!docsRefsConfigExists) {
      skipped.push(`${docsRefsConfigRel} (missing template for cutover scaffold)`);
    }
  } else {
    const docsRefsConfigClass = destinationClasses.get(docsRefsConfigRel);
    if (docsRefsConfigClass === "absent") {
      pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
    } else if (!docsRefsConfigExists) {
      pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
    } else {
      const existingConfigContent = readFileSync3(docsRefsConfigPath, "utf8");
      if (existingConfigContent !== docsRefsConfigTemplateContent && (docsRefsConfigClass === "untracked-existing" || docsRefsConfigClass === "unverifiable")) {
        pending.push({ rel: docsRefsConfigRel, projectPath: docsRefsConfigPath, content: docsRefsConfigTemplateContent });
      }
    }
  }
  const clean = [];
  const trackedDirtyOps = [];
  const untrackedExistingOps = [];
  const unverifiableOps = [];
  for (const op of pending) {
    switch (destinationClasses.get(op.rel)) {
      case "tracked-dirty":
        trackedDirtyOps.push(op);
        break;
      case "untracked-existing":
        untrackedExistingOps.push(op);
        break;
      case "unverifiable":
        unverifiableOps.push(op);
        break;
      case "absent":
      case "tracked-clean":
        clean.push(op);
        break;
      default:
        unverifiableOps.push(op);
        break;
    }
  }
  const dirty = [...trackedDirtyOps, ...untrackedExistingOps, ...unverifiableOps];
  refusals.trackedDirty.push(...trackedDirtyOps.map((op) => op.rel));
  refusals.untrackedExisting.push(...untrackedExistingOps.map((op) => op.rel));
  refusals.unverifiable.push(...unverifiableOps.map((op) => op.rel));
  if (options.check) {
    const staleOverrides2 = getStaleOverrides(cwd, clean);
    for (const op of clean) wouldUpgrade.push(op.rel);
    for (const op of dirty) dirtyRefused.push(op.rel);
    return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals, malformed, cutoverWarnings, staleOverrides: staleOverrides2 };
  }
  if (dirty.length > 0 && !options.force) {
    for (const op of dirty) dirtyRefused.push(op.rel);
    return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals, malformed, cutoverWarnings, staleOverrides: [] };
  }
  const reportedWrites = options.force ? pending : clean;
  const staleOverrides = getStaleOverrides(cwd, reportedWrites);
  const toWrite = options.force ? pending : clean;
  for (const op of toWrite) {
    mkdirSync2(dirname4(op.projectPath), { recursive: true });
    writeFileSync2(op.projectPath, op.content);
    upgraded.push(op.rel);
  }
  return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals: emptyRefusals(), malformed, cutoverWarnings, staleOverrides };
}
function parseUpgradeArgs(args2) {
  const options = {};
  for (const arg of args2) {
    if (arg === "--check" || arg === "--dry-run") options.check = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--no-stage") options.noStage = true;
    else {
      throw new Error(`canon upgrade: unknown flag '${arg}'. Supported: --check (--dry-run), --force, --no-stage.`);
    }
  }
  return options;
}
function upgradeCmd(args2) {
  const options = parseUpgradeArgs(args2);
  const result = runUpgrade(process.cwd(), packageDir4, options);
  const { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, refusals, malformed, cutoverWarnings, staleOverrides } = result;
  console.log("\ncanon upgrade" + (options.check ? " --check" : "") + "\n");
  if (options.check) {
    if (wouldUpgrade.length > 0) {
      console.log("Would update:");
      for (const f of wouldUpgrade) console.log(`  \u2191 ${f}`);
      console.log("");
    }
    if (cutoverWarnings.length > 0) {
      printDocsRefsCutoverWarning(cutoverWarnings, true);
    }
    if (staleOverrides.length > 0) {
      printStaleOverrideNudge(staleOverrides, true);
    }
    printUpgradeRefusals(refusals, "Would refuse");
    if (unchanged.length > 0) {
      console.log("Already up to date:");
      for (const f of unchanged) console.log(`  = ${f}`);
      console.log("");
    }
    if (skipped.length > 0) {
      console.log("Skipped:");
      for (const f of skipped) console.log(`  ? ${f}`);
      console.log("");
    }
    if (malformed.length > 0) {
      console.log("Malformed (manual fix needed):");
      for (const f of malformed) {
        console.log(`  \u26A0 ${f} \u2014 \`# canon:start\` has no \`# canon:end\`; add it manually, then re-run upgrade`);
      }
      console.log("");
    }
    if (wouldUpgrade.length === 0 && dirtyRefused.length === 0 && unchanged.length === 0 && skipped.length === 0 && malformed.length === 0) {
      console.log("No canon-managed files found. Run `canon init` to set up canon in this repo.\n");
    } else {
      console.log("(dry run \u2014 no files written.) Re-run without --check to apply.\n");
    }
    return;
  }
  if (dirtyRefused.length > 0) {
    printUpgradeRefusals(refusals, "Refused");
    if (malformed.length > 0) {
      console.log("Malformed (manual fix needed):");
      for (const f of malformed) {
        console.log(`  \u26A0 ${f} \u2014 \`# canon:start\` has no \`# canon:end\`; add it manually, then re-run upgrade`);
      }
      console.log("");
    }
    console.log("No files were upgraded. Resolve the refused paths and re-run, or pass `--force`.");
    process.exit(2);
  }
  if (upgraded.length > 0 && !options.noStage) {
    const r = spawnSync8("git", ["add", ...upgraded], { cwd: process.cwd(), stdio: "inherit" });
    if (r.status !== 0) {
      console.error("\nwarning: failed to stage changes \u2014 run `git add` manually.");
    }
  }
  if (upgraded.length > 0) {
    console.log("Updated:");
    for (const f of upgraded) console.log(`  \u2191 ${f}`);
    if (!options.noStage) {
      console.log("\nReview:  git diff --staged");
      console.log("Revert:  git checkout HEAD -- <file>\n");
    } else {
      console.log("\n(--no-stage: files written but not staged. Review:  git diff)");
      console.log("Stage:   git add <file>\n");
    }
  }
  if (cutoverWarnings.length > 0) {
    printDocsRefsCutoverWarning(cutoverWarnings, false);
  }
  if (staleOverrides.length > 0) {
    printStaleOverrideNudge(staleOverrides, false);
  }
  if (unchanged.length > 0) {
    console.log("Already up to date:");
    for (const f of unchanged) console.log(`  = ${f}`);
    console.log("");
  }
  if (skipped.length > 0) {
    console.log("Skipped:");
    for (const f of skipped) console.log(`  ? ${f}`);
    console.log("");
  }
  if (malformed.length > 0) {
    console.log("Malformed (manual fix needed):");
    for (const f of malformed) {
      console.log(`  \u26A0 ${f} \u2014 \`# canon:start\` has no \`# canon:end\`; add it manually, then re-run upgrade`);
    }
    console.log("");
  }
  if (upgraded.length === 0 && unchanged.length === 0 && skipped.length === 0 && malformed.length === 0) {
    console.log("No canon-managed files found. Run `canon init` to set up canon in this repo.\n");
  } else {
    console.log("Orchestrator scripts update automatically \u2014 run `npm update canon-ai` to pull the latest.\n");
  }
}

// src/cli/index.ts
var [, , command, ...args] = process.argv;
function printHelp() {
  console.log(`
canon-ai \u2014 spec-first multi-agent coding pipeline

Usage:
  canon init                  Set up canon in the current repo
  canon doctor                Verify environment and canon setup
  canon task <sub> [args]     Create tasks and track pipeline phases
  canon run <id> [opts]       Run the pipeline for a task
  canon stop <id>             Stop a detached canon run (SIGTERM \u2192 SIGKILL after 10s).
                                During the launch window before the child writes its first
                                heartbeat, waits up to CANON_STOP_WAIT_MS for proof of life
                                (default 30000) before deciding whether to signal.
  canon watch <id>            Blocking observer for an already-detached canon run.
                                Waits for idle / checkpoint / death / timeout and prints
                                one final summary line to stdout. Progress and any log
                                tailing go to stderr.
                                Flags: --until <phase>, --timeout <dur>, --follow, -f
                                Exit codes: 0 healthy stop/until, 2 usage/nothing/read
                                error/ambiguous_pid/launch-window timeout, 3 auto-block, 4 death,
                                5 timeout.
  canon update                Update the canon-ai package itself
  canon upgrade               Sync vendored files to match the installed version

Typical workflow:
  canon task new <id> "Title"   Create the task dir, then write spec.md
                                  conversationally with Claude Code
  canon run <id>                Run the pipeline (after spec is approved)
  canon run <id> --pr           Open a draft PR when the task reaches human_review

Pipeline phases (in order):
  spec \u2192 spec_review \u2192 plan \u2192 implement \u2192 code_review \u2192 qa \u2192 human_review

  canon task subcommands:
  new <id> "Title" [--base <branch>]
                          Scaffold tasks/<id>/ from .canon/templates/. Auto-detects
                          base branch from current checkout; --base to override.
  list                    Show all tasks and their current phase
  status <id>             Show full status.json detail for a task
  phase <id> <phase> <status> [verdict]
                          Update a phase and re-derive the top-level status pointer.
                            phases:   spec | spec_review | plan | implement |
                                      code_review | qa | human_review
                            status:   pending | in_progress | done | changes_requested | blocked
                            verdict:  approved | approved_with_nits | changes_requested | needs_re_review | spec_gap | sanctioned
                                      (verdict applies to spec_review and code_review only; sanctioned is written via canon task accept --reason)
  accept <id...> <phase> [--reason "<text>"] [--force]
                          Accept implement, or sanction spec_review/code_review with an audit reason.
                          --reason is required for spec_review and code_review.
  set <id> <field> <value>
                          Set task metadata fields with validation, redirects for guarded fields,
                          and immutable-field refusals instead of raw status.json edits.
  reset-spec-review <id>  Clear state for a fresh spec-review pass after an auto-block.
                          Zeroes iterations, clears verdict, archives prior spec-review.md.
  reset-code-review <id>  Clear state for a fresh code-review pass after an auto-block.
                          Zeroes loop counters, clears verdict, archives prior review.md.
  post-merge-sync [<branch>]
                          After a squash-merge PR lands, reconcile local branch with origin.
                          Hard-resets if the only divergence is pipeline telemetry; refuses
                          if real unmerged work is present.

canon run options:
  --step, -1              Run one phase then stop
  --expect <phase>        Fail fast if current phase doesn't match
                            phases: spec | spec_review | plan | implement |
                                    code_review | qa | human_review
  --interactive, -I       Open interactive agent sessions (default: non-interactive)
  --pr                    At human_review: push branch and open a draft PR (requires gh).
                          Auto-commit allow-list: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and
                          managed docs listed in spec.md's "### Affected Files" table. Dirty
                          files outside that set die with a remediation message.
                          Aborts if HEAD's tree differs from origin/<base> on files not in
                          spec's Affected Files (bypass with --force).
  --push                  At human_review: push branch only, no PR (requires gh). Same allow-list
                          as --pr. Aborts if HEAD's tree differs from origin/<base> on files not
                          in spec's Affected Files (bypass with --force).
  --full-send             Skip the spec gate and auto-open a draft PR after clean QA
  --force                 Acknowledge high-commitment combinations (currently: --full-send on a delicate task)
  --ship                  Merge the open PR (calls gh pr merge --squash --delete-branch), tear
                          down the worktree, archive the task dir, and pull the base branch. Run
                          after the PR is approved \u2014 do NOT merge the PR manually first. If you
                          already merged externally, --ship detects the merged state and resumes
                          at cleanup.
  --dry-run               Print planned phases without running any agents
  --reroute               Reset a task from human_review back into the post-review fix path after
                          human feedback. Full-tier tasks (S/M/L/XL or delicate) re-enter at
                          spec_review; fast-tier tasks (XS) re-enter at implement.
                          Feedback channel: append a new section to tasks/<id>/spec.md describing
                          what to address. Codex re-reads spec.md only \u2014 additions to review.md
                          or PR comments are NOT consulted on reroute. See docs/pipeline-orchestrator.md
                          \xA7"Human Reroute."

Global:
  --version           Print canon-ai version
  --help              Show this help
`);
}
function printVersion() {
  console.log("2.2.0");
}
switch (command) {
  case "doctor":
    doctorCmd(args);
    break;
  case "init":
    initCmd(args);
    break;
  case "run":
    runCmd(args);
    break;
  case "stop":
    stopCmd(args);
    break;
  case "task":
    taskCmd2(args);
    break;
  case "watch":
    watchCmd(args);
    break;
  case "update":
    updateCmd(args);
    break;
  case "upgrade":
    upgradeCmd(args);
    break;
  case "--version":
  case "-v":
    printVersion();
    break;
  case "--help":
  case "-h":
  case void 0:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}
`);
    printHelp();
    process.exit(1);
}
