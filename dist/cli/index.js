#!/usr/bin/env node

// src/cli/commands/doctor.ts
import { execSync as execSync2 } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

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
    "--push": { cmd: "gh", installHint: "brew install gh && gh auth login" }
  };
  const dep = flagDeps[flag];
  if (dep && !isAvailable(dep.cmd)) {
    console.error(`${flag} requires the GitHub CLI:
  ${dep.installHint}`);
    process.exit(1);
  }
}

// src/cli/commands/doctor.ts
var CANON_END = "<!-- canon:end -->";
var CANON_START_RE = /<!-- canon:start[^>]* -->/;
var EXPECTED_TEMPLATES = [
  "spec.md",
  "plan.md",
  "handoff.md",
  "review.md",
  "done.md",
  "spec-review.md",
  "notes.md",
  "status.json"
];
var RECOMMENDED_ALLOW = [
  "Bash(git *)",
  "Bash(gh *)",
  "Bash(sed *)",
  "Bash(awk *)",
  "Bash(ls *)",
  "Bash(find *)",
  "Bash(cat *)",
  "Bash(head *)",
  "Bash(tail *)",
  "Bash(grep *)",
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
  "Skill(canon-changelog:*)"
];
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
function checkAgentFile(cwd, filename) {
  const path8 = join(cwd, filename);
  if (!existsSync(path8)) {
    return { label: filename, status: "fail", detail: "missing \u2014 run `canon init`" };
  }
  const content = readFileSync(path8, "utf8");
  if (!CANON_START_RE.test(content) || !content.includes(CANON_END)) {
    return { label: filename, status: "warn", detail: "no canon delimiters \u2014 run `canon init` to add them" };
  }
  return { label: filename, status: "pass" };
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
  const installedVersion = "1.3.0";
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
  const skillNames = ["canon-spec", "canon-pipeline", "canon-status", "canon-changelog"];
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
function checkCodexConfig(cwd) {
  const path8 = join(cwd, ".codex", "config.toml");
  if (existsSync(path8)) return { label: ".codex/config.toml", status: "pass" };
  return { label: ".codex/config.toml", status: "warn", detail: "missing \u2014 Codex will use defaults" };
}
function readAllowFromSettings(path8) {
  if (!existsSync(path8)) return { allow: /* @__PURE__ */ new Set(), status: "missing" };
  try {
    const parsed = JSON.parse(readFileSync(path8, "utf8"));
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
  const canonChecks = [
    checkAgentFile(cwd, "AGENTS.md"),
    checkAgentFile(cwd, "CLAUDE.md"),
    checkAgentFile(cwd, "CODEX.md"),
    checkTemplates(cwd),
    checkCanonVersion(cwd),
    checkSkills(cwd)
  ];
  const configChecks = [
    checkCodexConfig(cwd),
    checkRecommendedPermissions(cwd),
    checkLocalSettingsGitignored(cwd)
  ];
  console.log("\ncanon doctor\n");
  printSection("Environment");
  for (const c of envChecks) printCheck(c);
  printSection("Canon setup");
  for (const c of canonChecks) printCheck(c);
  printSection("Config");
  for (const c of configChecks) printCheck(c);
  const all = [...envChecks, ...canonChecks, ...configChecks];
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
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync
} from "fs";
import { fileURLToPath } from "url";
import { dirname, join as join2, relative } from "path";
var packageDir = join2(dirname(fileURLToPath(import.meta.url)), "../..");
var templatesDir = join2(packageDir, "templates");
var AGENT_FILES = /* @__PURE__ */ new Set(["AGENTS.md", "CLAUDE.md", "CODEX.md"]);
function walkDir(dir, base = dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
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
  const hasExistingAgentFiles = skipped.some((f) => AGENT_FILES.has(f));
  console.log("");
  launchGrill(cwd, hasExistingAgentFiles);
}
function writeCanonVersion(cwd) {
  const versionPath = join2(cwd, ".canon", "version");
  const version = "1.3.0";
  mkdirSync(dirname(versionPath), { recursive: true });
  writeFileSync(versionPath, version + "\n");
}
function launchGrill(cwd, hasExistingAgentFiles) {
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
  if (hasExistingAgentFiles) {
    console.log("\nNote: existing AGENTS.md / CLAUDE.md / CODEX.md detected \u2014 the grill");
    console.log("will run the merge protocol on them automatically.");
  }
  console.log("");
}

// src/cli/commands/run-task.ts
import { spawnSync } from "child_process";
import { fileURLToPath as fileURLToPath2 } from "url";
import { dirname as dirname2, join as join3 } from "path";
var packageDir2 = join3(dirname2(fileURLToPath2(import.meta.url)), "../..");
var runTaskScript = join3(packageDir2, "dist/scripts/run-task.js");
function runCmd(args2) {
  for (const arg of args2) {
    checkDepForFlag(arg);
  }
  const result = spawnSync(process.execPath, [runTaskScript, ...args2], {
    stdio: "inherit",
    cwd: process.cwd()
  });
  process.exit(result.status ?? 1);
}

// src/task/index.ts
import { spawnSync as spawnSync6 } from "child_process";
import fs6 from "fs";
import path7 from "path";

// scripts/run-task/canon-snapshot.ts
import { spawnSync as spawnSync5 } from "child_process";
import fs4 from "fs";
import path5 from "path";

// scripts/run-task/env.ts
import { spawnSync as spawnSync2 } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
var __filename = fileURLToPath3(import.meta.url);
var __dirname = path.dirname(__filename);
function resolveRepoRoot() {
  try {
    const result = spawnSync2("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" });
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

// scripts/run-task/git.ts
import { spawnSync as spawnSync4 } from "child_process";
import path4 from "path";

// scripts/run-task/cli.ts
function die(message) {
  console.error(`\u274C ${message}`);
  process.exit(1);
}

// scripts/run-task/state.ts
import fs2 from "fs";
import { spawnSync as spawnSync3 } from "child_process";
import path2 from "path";

// scripts/run-task/types.ts
var PHASE_ORDER = ["spec", "spec_review", "plan", "implement", "code_review", "qa", "human_review"];

// scripts/run-task/state.ts
function effectiveWorktreesRoot() {
  return process.env.CANON_WORKTREES_ROOT ? path2.resolve(process.env.CANON_WORKTREES_ROOT) : WORKTREES_ROOT;
}
function findExistingWorktreeForBranch(branch) {
  const result = spawnSync3("git", ["worktree", "list", "--porcelain"], {
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
function deriveTopLevelStatus(status) {
  for (const phase of PHASE_ORDER) {
    const phaseStatus = status.phases[phase]?.status ?? "pending";
    if (phaseStatus !== "done") return phase;
  }
  return "complete";
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

// scripts/run-task/git.ts
function gitSafeAt(cwd, ...args2) {
  const result = spawnSync4("git", args2, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { ok: false, stdout: "", stderr: result.error.message };
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

// scripts/run-task/canon-snapshot.ts
var CANON_UPSTREAM_REPO = "tstraub89/canon-ai";
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
  const orchestratorCommit = superprojectWorkingTree ? captureGitOutput(path5.resolve(superprojectWorkingTree), ["rev-parse", "HEAD"], runGitAt) || "<unavailable>" : upstreamCommit;
  return {
    upstream_repo: CANON_UPSTREAM_REPO,
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
  const status = JSON.parse(fs4.readFileSync(statusFilePath, "utf8"));
  const canon = captureCanonSnapshot(REPO_ROOT, options);
  const next = applyCanonSnapshot(status, canon);
  const serialized = `${JSON.stringify(next, null, 2)}
`;
  const current = fs4.readFileSync(statusFilePath, "utf8");
  if (current !== serialized) {
    fs4.writeFileSync(statusFilePath, serialized, "utf8");
  }
  return canon;
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
    content = fs5.readFileSync(donePath, "utf8");
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
  const config2 = PHASE_GATE_CONFIG[phase];
  const taskDir = resolveTaskDirForValidation(taskId, taskDirOverride);
  if (config2.artifactName) {
    const artifactPath = path6.join(taskDir, config2.artifactName);
    let content;
    try {
      content = fs5.readFileSync(artifactPath, "utf8");
    } catch {
      return { ok: false, reason: `${config2.artifactName} is missing for phase '${phase}'` };
    }
    const isTemplate = config2.customTemplateCheck ? config2.customTemplateCheck(artifactPath) : isTemplateUnfilled(content);
    if (isTemplate) {
      return { ok: false, reason: `${config2.artifactName} is still the unfilled template for phase '${phase}'` };
    }
    if (config2.verdictMustMatchArtifact) {
      if (!verdict) {
        return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
      }
      const extracted = extractCheckedVerdict(content);
      if (!extracted) {
        return { ok: false, reason: `${config2.artifactName} has no checked verdict checkbox` };
      }
      if (extracted !== verdict) {
        return { ok: false, reason: `verdict mismatch: status.json wants '${verdict}', ${config2.artifactName} has '${extracted}'` };
      }
    }
  }
  if (config2.requiresVerdict && !config2.verdictMustMatchArtifact) {
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

// src/task/index.ts
var VALID_PHASES = new Set(PHASE_ORDER);
var VALID_STATUSES = /* @__PURE__ */ new Set(["pending", "in_progress", "done", "changes_requested", "blocked"]);
var VALID_VERDICTS = /* @__PURE__ */ new Set(["approved", "approved_with_nits", "changes_requested", "needs_re_review"]);
var REVIEW_PHASES = /* @__PURE__ */ new Set(["spec_review", "code_review"]);
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
    "  accept <TASK-ID> <phase> [--force]",
    "  reset-spec-review <TASK-ID>",
    "  post-merge-sync [<branch>]",
    "  release-init <version>"
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
  return path7.join(tasksRoot(), taskId);
}
function taskDirForCwd(cwd, taskId) {
  const root = tasksRoot();
  return path7.isAbsolute(root) ? path7.join(root, taskId) : path7.join(cwd, root, taskId);
}
function taskStatusFileForCwd(cwd, taskId) {
  return path7.join(taskDirForCwd(cwd, taskId), "status.json");
}
function taskRootForGate(cwd) {
  const root = tasksRoot();
  return path7.isAbsolute(root) ? root : path7.join(cwd, root);
}
function templatesRoot() {
  return path7.join(process.cwd(), ".canon", "templates");
}
function taskTemplateOverrideRoot() {
  return path7.join(tasksRoot(), "_templates");
}
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs6.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error: failed to read ${filePath}: ${message}`);
  }
}
function writeJsonAtomic(filePath, data) {
  const tmpFile = `${filePath}.tmp`;
  fs6.writeFileSync(tmpFile, `${JSON.stringify(data, null, 2)}
`, "utf8");
  fs6.renameSync(tmpFile, filePath);
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
  const content = fs6.readFileSync(source, "utf8").replaceAll("[TASK-ID]", taskId).replaceAll("[Title]", title);
  fs6.writeFileSync(destination, content, "utf8");
}
function listTemplateFiles() {
  const root = templatesRoot();
  if (!fs6.existsSync(root)) {
    throw new Error(`Error: templates directory not found at ${root}`);
  }
  return fs6.readdirSync(root).filter((name) => name.endsWith(".md") || name.endsWith(".json")).sort();
}
function printCreatedTask(taskDir, baseBranch) {
  console.log(`Created task: ${taskDir}`);
  console.log("Files:");
  for (const file of fs6.readdirSync(taskDir).sort()) {
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
  if (fs6.existsSync(taskDir)) {
    throw new Error(`Error: Task directory ${taskDir} already exists.`);
  }
  if (!baseBranch) {
    baseBranch = currentBranchOrEmpty() || "main";
  }
  fs6.mkdirSync(taskDir, { recursive: true });
  const overrideRoot = taskTemplateOverrideRoot();
  for (const basename of listTemplateFiles()) {
    const override = path7.join(overrideRoot, basename);
    const source = fs6.existsSync(override) ? override : path7.join(templatesRoot(), basename);
    copyTemplateFile(source, path7.join(taskDir, basename), id, title);
  }
  const statusPath = path7.join(taskDir, "status.json");
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
  if (!fs6.existsSync(root)) {
    console.log("No tasks found.");
    return;
  }
  const rows = [];
  for (const entry of fs6.readdirSync(root).sort()) {
    if (entry === "_archive") continue;
    const statusPath = path7.join(root, entry, "status.json");
    if (!fs6.existsSync(statusPath)) continue;
    const status = readJsonFile(statusPath);
    rows.push({
      id: entry,
      title: status.title ?? "(untitled)",
      phase: derivePhase(status)
    });
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
}
function taskStatus(id) {
  if (!id) throw new Error("Task ID required");
  validateTaskId(id);
  const cwd = resolveTaskCwd(id);
  const statusPath = taskStatusFileForCwd(cwd, id);
  if (!fs6.existsSync(statusPath)) {
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
  validateTaskId(id);
  assertValidPhase(phaseArg);
  assertValidStatus(statusArg);
  assertValidVerdict(phaseArg, verdictArg);
  const taskCwd = resolveTaskCwd(id);
  const statusPath = taskStatusFileForCwd(taskCwd, id);
  if (!fs6.existsSync(statusPath)) {
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
function taskAccept(id, phaseArg, options = {}) {
  if (!id) throw new Error("Error: usage: canon task accept <TASK-ID> <phase> [--force]");
  if (!phaseArg) throw new Error("Error: phase required (currently only `implement` is supported)");
  validateTaskId(id);
  assertValidPhase(phaseArg);
  if (phaseArg !== "implement") {
    throw new Error(
      `Error: 'canon task accept' currently only supports the implement phase. Got '${phaseArg}'. For other phases use \`canon task phase ${id} ${phaseArg} done [verdict]\`.`
    );
  }
  const taskCwd = resolveTaskCwd(id);
  const statusPath = taskStatusFileForCwd(taskCwd, id);
  if (!fs6.existsSync(statusPath)) {
    throw new Error(`Error: No status.json found for task ${id} (looked in ${taskDirForCwd(taskCwd, id)}/)`);
  }
  const status = readJsonFile(statusPath);
  const gitCwd = status.worktree === true ? taskCwd : process.cwd();
  if (!options.force) {
    const blocked = priorIncompletePhases(status, phaseArg);
    if (blocked.length > 0) {
      throw new Error(`Error: cannot accept ${phaseArg} \u2014 prior phases not done: ${blocked.join(",")}`);
    }
    ensureGitAvailable();
    const dirty = git2(["status", "--porcelain=v1", "-uall"], { cwd: gitCwd });
    const dirtyLines = dirty.split("\n").filter((line) => line.trim() !== "");
    const sourceDirty = dirtyLines.filter((line) => {
      const dirtyPath = parsePorcelainPath(line);
      if (!dirtyPath) return true;
      return !isPipelineOwnedAcceptPath(dirtyPath, id, gitCwd);
    });
    if (sourceDirty.length > 0) {
      throw new Error(
        `Error: working tree is not clean \u2014 accept would silently skip uncommitted changes.
  Dirty source paths (first 20):
` + sourceDirty.slice(0, 20).map((line) => `    ${line}`).join("\n") + `
  Commit or stash these changes first, or re-run with --force if you genuinely want to ignore them.`
      );
    }
    const baseBranch = (status.base_branch ?? "").trim();
    if (!baseBranch) {
      throw new Error("Error: status.json is missing base_branch \u2014 cannot determine the diff baseline for accept.");
    }
    if (!gitOk(["rev-parse", "--verify", baseBranch], { cwd: gitCwd })) {
      throw new Error(
        `Error: base branch '${baseBranch}' is not reachable from ${taskCwd}. Fetch it or pass --force if you know the diff baseline is intentional.`
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
    const { files: handoffFiles, malformed } = parseHandoffChangesRows(id);
    if (malformed.length > 0) {
      const lines = malformed.slice(0, 10).map((m) => `    '${m.cell}': ${m.reason}`);
      const tail = malformed.length > 10 ? `
    (+${malformed.length - 10} more)` : "";
      throw new Error(
        `Error: handoff.md has malformed Changes rows \u2014 fix these before accepting.
` + lines.join("\n") + tail + `
  Use --force to accept anyway, but the code_review pre-flight will still reject the run.`
      );
    }
    const coverageIssues = verifyHandoffAgainstDiffFromData(
      [id],
      { diffFiles, renamePairs, handoffFilesByTask: /* @__PURE__ */ new Map([[id, handoffFiles]]) }
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
  const implementEntry = ensurePhaseEntry(status, "implement");
  implementEntry.status = "done";
  implementEntry.operator_accepted = true;
  implementEntry.operator_accepted_at = today();
  const headRevParse = runGit(["rev-parse", "HEAD"], { cwd: gitCwd });
  if (!headRevParse.error && headRevParse.status === 0) {
    implementEntry.operator_accepted_sha = (headRevParse.stdout ?? "").trim();
  } else {
    implementEntry.operator_accepted_sha = "";
  }
  status.updated = today();
  writeStatusAtomic(statusPath, status);
  const notesPath = path7.join(taskDirForCwd(taskCwd, id), "notes.md");
  const noteLine = `[${today()}] Operator accepted implement phase via \`canon task accept\` \u2014 auto-commit will be skipped.${options.force ? " (--force)" : ""}`;
  try {
    if (fs6.existsSync(notesPath)) {
      fs6.appendFileSync(notesPath, `
${noteLine}
`, "utf8");
    } else {
      fs6.writeFileSync(notesPath, `${noteLine}
`, "utf8");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: failed to log to notes.md: ${message}`);
  }
  console.log(
    `Accepted ${id}: implement \u2192 done (operator_accepted=true).` + (options.force ? " (--force)" : "") + `
  Auto-commit will be skipped on subsequent \`canon run\` invocations. The next phase (code_review) will run normally against the committed work.`
  );
}
function taskResetSpecReview(id) {
  if (!id) throw new Error("Error: usage: canon task reset-spec-review <TASK-ID>");
  validateTaskId(id);
  const taskCwd = resolveTaskCwd(id);
  const taskDir = taskDirForCwd(taskCwd, id);
  const statusPath = path7.join(taskDir, "status.json");
  if (!fs6.existsSync(statusPath)) {
    throw new Error(`Error: no status.json at ${statusPath}`);
  }
  const reviewPath = path7.join(taskDir, "spec-review.md");
  if (fs6.existsSync(reviewPath)) {
    let n = 1;
    while (fs6.existsSync(path7.join(taskDir, `spec-review-prior-${n}.md`))) n += 1;
    fs6.renameSync(reviewPath, path7.join(taskDir, `spec-review-prior-${n}.md`));
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
  const dirtyAbsolute = path7.isAbsolute(filePath) ? filePath : path7.resolve(repoRootForPaths, filePath);
  const canonicalDirty = safeRealpath(dirtyAbsolute);
  const root = tasksRoot();
  const rootAbsolute = path7.isAbsolute(root) ? root : path7.resolve(repoRootForPaths, root);
  const canonicalRoot = safeRealpath(rootAbsolute);
  const taskCanonical = path7.join(canonicalRoot, taskId);
  if (canonicalDirty === taskCanonical) return true;
  if (canonicalDirty.startsWith(`${taskCanonical}${path7.sep}`)) return true;
  for (const telemetry of PIPELINE_TELEMETRY_FILES) {
    const telemetryAbsolute = path7.resolve(repoRootForPaths, telemetry);
    if (safeRealpath(telemetryAbsolute) === canonicalDirty) return true;
  }
  return false;
}
function resolveRepoRootForAccept(gitCwd) {
  const result = runGit(["rev-parse", "--show-toplevel"], { cwd: gitCwd });
  if (result.error || result.status !== 0) return gitCwd;
  return (result.stdout ?? "").trim() || gitCwd;
}
function safeRealpath(target) {
  try {
    return fs6.realpathSync(target);
  } catch {
    const parent = path7.dirname(target);
    if (parent === target) return target;
    try {
      return path7.join(fs6.realpathSync(parent), path7.basename(target));
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
  if (!fs6.existsSync(root)) return;
  const shippable = [];
  for (const entry of fs6.readdirSync(root).sort()) {
    if (entry === "_archive" || entry.startsWith("_")) continue;
    const statusPath = path7.join(root, entry, "status.json");
    if (!fs6.existsSync(statusPath)) continue;
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
function updatePackageVersion(filePath, version, updateLockRoot = false) {
  const parsed = readJsonFile(filePath);
  parsed.version = version;
  if (updateLockRoot) {
    const packages = parsed.packages;
    if (packages && typeof packages === "object") {
      const rootPackage = packages[""];
      if (rootPackage && typeof rootPackage === "object") {
        rootPackage.version = version;
      }
    }
  }
  writeJsonAtomic(filePath, parsed);
}
function insertChangelogBlock(filePath, short) {
  const content = fs6.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const first = lines.shift() ?? "";
  const block = [
    first,
    "",
    `## ${short} - unreleased`,
    "",
    `<!-- Bullets land here as tasks for ${short} ship. The single squash-merge of release/${short} \u2192 main carries this entry to production. -->`,
    ...lines
  ];
  fs6.writeFileSync(filePath, block.join("\n"), "utf8");
}
function defaultPush(branch) {
  const result = runGit(["push", "-u", "origin", branch], { stdio: "inherit" });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error(`git push -u origin ${branch} failed`);
}
function taskReleaseInit(version, options = {}) {
  if (!version) {
    throw new Error("Error: usage: canon task release-init <version>\n       e.g.: canon task release-init 1.6.0");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Error: version must be semver (e.g. 1.6.0). Got: ${version}`);
  }
  ensureGitAvailable();
  const short = `v${version.replace(/\.0$/, "")}`;
  const branch = `release/${short}`;
  const current = currentBranchOrEmpty();
  if (current !== "main") {
    throw new Error(`Error: release-init expects you to start on 'main' (you are on '${current}').`);
  }
  if (git2(["status", "--porcelain"])) {
    throw new Error("Error: working tree is dirty. Commit or stash first.");
  }
  console.log("\u2192 Fetching origin/main...");
  const fetch = runGit(["fetch", "origin", "main"]);
  if (fetch.error || fetch.status !== 0) {
    throw new Error("Error: git fetch failed.");
  }
  const behind = Number.parseInt(git2(["rev-list", "--count", "main..origin/main"]) || "0", 10);
  if (behind > 0) {
    throw new Error(`Error: local main is ${behind} commit(s) behind origin/main. Pull first.`);
  }
  if (gitOk(["rev-parse", "--verify", branch])) {
    throw new Error(`Error: branch '${branch}' already exists locally.`);
  }
  if (gitOk(["rev-parse", "--verify", `origin/${branch}`])) {
    throw new Error(`Error: branch '${branch}' already exists on origin.`);
  }
  console.log(`\u2192 Creating ${branch} off main...`);
  git2(["checkout", "-b", branch, "main"]);
  const filesToAdd = [];
  if (fs6.existsSync("package.json")) {
    console.log(`\u2192 Bumping package.json version to ${version}...`);
    updatePackageVersion("package.json", version);
    filesToAdd.push("package.json");
    if (fs6.existsSync("package-lock.json")) {
      console.log("\u2192 Bumping package-lock.json...");
      updatePackageVersion("package-lock.json", version, true);
      filesToAdd.push("package-lock.json");
    }
  }
  if (fs6.existsSync("CHANGELOG.md")) {
    console.log(`\u2192 Inserting empty changelog block for ${short}...`);
    insertChangelogBlock("CHANGELOG.md", short);
    filesToAdd.push("CHANGELOG.md");
  }
  if (filesToAdd.length > 0) {
    git2(["add", ...filesToAdd]);
    git2(["commit", "-m", `chore: initialize ${branch} (version ${version})`]);
  } else {
    git2(["commit", "--allow-empty", "-m", `chore: initialize ${branch} (version ${version}, no version files to bump)`]);
  }
  if (options.pushFn) options.pushFn(branch);
  else defaultPush(branch);
  console.log("");
  console.log(`\u2713 Release branch ${branch} initialized and pushed.`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Create tasks on this branch: canon task new <id> <title>");
  console.log(`     (auto-detects base_branch=${branch} from your current checkout)`);
  console.log(`  2. Each task PR targets ${branch} (not main).`);
  console.log(`  3. As tasks ship, append bullets to the ${short} block in CHANGELOG.md.`);
  console.log(`  4. When ready: open PR ${branch} \u2192 main, squash-merge for the release.`);
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
      case "accept": {
        const force = rest.includes("--force");
        const positional = rest.filter((arg) => arg !== "--force");
        taskAccept(positional[0] ?? "", positional[1] ?? "", { force });
        break;
      }
      case "reset-spec-review":
        taskResetSpecReview(rest[0] ?? "");
        break;
      case "post-merge-sync":
        taskPostMergeSync(rest[0]);
        break;
      case "release-init":
        taskReleaseInit(rest[0] ?? "");
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
import { existsSync as existsSync3 } from "fs";
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
    if (existsSync3(join4(projectRoot, "package.json"))) return "local";
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
import { existsSync as existsSync4, readFileSync as readFileSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { fileURLToPath as fileURLToPath5 } from "url";
import { dirname as dirname4, join as join5 } from "path";
import { spawnSync as spawnSync8 } from "child_process";
var packageDir4 = join5(dirname4(fileURLToPath5(import.meta.url)), "../..");
var CANON_END2 = "<!-- canon:end -->";
var CANON_START_RE2 = /<!-- canon:start[^>]* -->/;
var DELIMITED = ["AGENTS.md", "CLAUDE.md", "CODEX.md"];
var CANON_OWNED = [
  ".canon/README.md",
  ".claude/skills/canon-init/SKILL.md",
  ".claude/skills/canon-spec/SKILL.md",
  ".claude/skills/canon-pipeline/SKILL.md",
  ".claude/skills/canon-status/SKILL.md",
  ".claude/skills/canon-changelog/SKILL.md",
  ".canon/templates/status.json",
  ".canon/templates/spec.md",
  ".canon/templates/plan.md",
  ".canon/templates/handoff.md",
  ".canon/templates/spec-review.md",
  ".canon/templates/review.md",
  ".canon/templates/done.md",
  ".canon/templates/notes.md",
  // Pure canon documentation — adopters don't customize. Listed here so future
  // canon releases (post-1.1.x reframes etc.) flow through `canon upgrade`
  // instead of going stale in every existing install. See 1.1.2 CHANGELOG.
  "docs/pipeline-orchestrator.md"
];
var HEADER_ONLY_SYNC = [
  "docs/pipeline-invocations.md"
];
function mergeDelimited(templateContent, projectContent) {
  if (!CANON_START_RE2.test(templateContent)) return null;
  if (!CANON_START_RE2.test(projectContent)) return null;
  const templateEnd = templateContent.indexOf(CANON_END2);
  const projectEnd = projectContent.indexOf(CANON_END2);
  if (templateEnd === -1 || projectEnd === -1) return null;
  return templateContent.slice(0, templateEnd + CANON_END2.length) + projectContent.slice(projectEnd + CANON_END2.length);
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
function isPathDirty(cwd, relPath) {
  const result = spawnSync8("git", ["status", "--porcelain", "--", relPath], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0 || result.error) return false;
  for (const line of (result.stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    if (xy === "??") continue;
    return true;
  }
  return false;
}
function runUpgrade(cwd, pkgDir, options = {}) {
  const upgraded = [];
  const unchanged = [];
  const skipped = [];
  const wouldUpgrade = [];
  const dirtyRefused = [];
  const pending = [];
  for (const rel of DELIMITED) {
    const projectPath = join5(cwd, rel);
    const templatePath = join5(pkgDir, "templates", rel);
    if (!existsSync4(projectPath) || !existsSync4(templatePath)) {
      skipped.push(rel);
      continue;
    }
    const projectContent = readFileSync2(projectPath, "utf8");
    const templateContent = readFileSync2(templatePath, "utf8");
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
    if (!existsSync4(templatePath)) {
      skipped.push(rel);
      continue;
    }
    const templateContent = readFileSync2(templatePath, "utf8");
    if (!existsSync4(projectPath)) {
      pending.push({ rel, projectPath, content: templateContent });
      continue;
    }
    const projectContent = readFileSync2(projectPath, "utf8");
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
    if (!existsSync4(templatePath)) {
      skipped.push(rel);
      continue;
    }
    const templateContent = readFileSync2(templatePath, "utf8");
    if (existsSync4(projectPath)) {
      const projectContent = readFileSync2(projectPath, "utf8");
      if (projectContent === templateContent) {
        unchanged.push(rel);
        continue;
      }
    }
    pending.push({ rel, projectPath, content: templateContent });
  }
  const versionPath = join5(cwd, ".canon", "version");
  const newVersion = "1.3.0";
  const currentVersion = existsSync4(versionPath) ? readFileSync2(versionPath, "utf8").trim() : null;
  if (currentVersion !== newVersion) {
    pending.push({ rel: ".canon/version", projectPath: versionPath, content: newVersion + "\n" });
  }
  const dirty = [];
  const clean = [];
  for (const op of pending) {
    if (isPathDirty(cwd, op.rel)) dirty.push(op);
    else clean.push(op);
  }
  if (options.check) {
    for (const op of clean) wouldUpgrade.push(op.rel);
    for (const op of dirty) dirtyRefused.push(op.rel);
    return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused };
  }
  if (dirty.length > 0 && !options.force) {
    for (const op of dirty) dirtyRefused.push(op.rel);
    return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused };
  }
  const toWrite = options.force ? pending : clean;
  for (const op of toWrite) {
    mkdirSync2(dirname4(op.projectPath), { recursive: true });
    writeFileSync2(op.projectPath, op.content);
    upgraded.push(op.rel);
  }
  return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused };
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
  const { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused } = result;
  console.log("\ncanon upgrade" + (options.check ? " --check" : "") + "\n");
  if (options.check) {
    if (wouldUpgrade.length > 0) {
      console.log("Would update:");
      for (const f of wouldUpgrade) console.log(`  \u2191 ${f}`);
      console.log("");
    }
    if (dirtyRefused.length > 0) {
      console.log("Would refuse (dirty in git \u2014 pass --force to overwrite):");
      for (const f of dirtyRefused) console.log(`  \u26A0 ${f}`);
      console.log("");
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
    if (wouldUpgrade.length === 0 && dirtyRefused.length === 0 && unchanged.length === 0 && skipped.length === 0) {
      console.log("No canon-managed files found. Run `canon init` to set up canon in this repo.\n");
    } else {
      console.log("(dry run \u2014 no files written.) Re-run without --check to apply.\n");
    }
    return;
  }
  if (dirtyRefused.length > 0) {
    console.log("Refused (dirty in git \u2014 pass --force to overwrite, or commit/stash these paths first):");
    for (const f of dirtyRefused) console.log(`  \u26A0 ${f}`);
    console.log("");
    console.log("No files were upgraded. Resolve the dirty paths and re-run, or pass `--force`.");
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
      console.log("Revert:  git checkout -- <file>\n");
    } else {
      console.log("\n(--no-stage: files written but not staged. Review:  git diff)");
      console.log("Stage:   git add <file>\n");
    }
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
  if (upgraded.length === 0 && unchanged.length === 0) {
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
                            verdict:  approved | approved_with_nits | changes_requested | needs_re_review
                                      (verdict applies to spec_review and code_review only)
  reset-spec-review <id>  Clear state for a fresh spec-review pass after an auto-block.
                          Zeroes iterations, clears verdict, archives prior spec-review.md.
  post-merge-sync [<branch>]
                          After a squash-merge PR lands, reconcile local branch with origin.
                          Hard-resets if the only divergence is pipeline telemetry; refuses
                          if real unmerged work is present.
  release-init <version>  Create release/v<MAJ.MIN> off main with version bumped and an
                          empty in-progress CHANGELOG block.

canon run options:
  --step, -1              Run one phase then stop
  --expect <phase>        Fail fast if current phase doesn't match
                            phases: spec | spec_review | plan | implement |
                                    code_review | qa | human_review
  --interactive, -I       Open interactive agent sessions (default: non-interactive)
  --pr                    At human_review: push branch and open a draft PR (requires gh)
  --push                  At human_review: push branch only (requires gh)
  --ship                  Post-merge cleanup: archive task dir (run after PR merges, not before)
  --dry-run               Print planned phases without running any agents
  --reroute               Reset a task from human_review back to implement

Global:
  --version           Print canon-ai version
  --help              Show this help
`);
}
function printVersion() {
  console.log("1.3.0");
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
  case "task":
    taskCmd2(args);
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
