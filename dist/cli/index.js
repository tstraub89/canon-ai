#!/usr/bin/env node

// src/cli/commands/doctor.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// src/cli/deps.ts
import { execSync } from "child_process";
var HARD_DEPS = [
  { cmd: "git", installHint: "https://git-scm.com/downloads" },
  { cmd: "jq", installHint: "brew install jq  (or https://jqlang.github.io/jq/)" },
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
  "Bash(jq *)",
  "Bash(sed *)",
  "Bash(awk *)",
  "Bash(ls *)",
  "Bash(find *)",
  "Bash(npm run *)",
  "Bash(npx canon *)",
  "Bash(canon *)",
  "Bash(npx tsx *)",
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
function checkAgentFile(cwd, filename) {
  const path = join(cwd, filename);
  if (!existsSync(path)) {
    return { label: filename, status: "fail", detail: "missing \u2014 run `canon init`" };
  }
  const content = readFileSync(path, "utf8");
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
  const installedVersion = "1.0.2";
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
  const path = join(cwd, ".codex", "config.toml");
  if (existsSync(path)) return { label: ".codex/config.toml", status: "pass" };
  return { label: ".codex/config.toml", status: "warn", detail: "missing \u2014 Codex will use defaults" };
}
function readAllowFromSettings(path) {
  if (!existsSync(path)) return { allow: /* @__PURE__ */ new Set(), status: "missing" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
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
    checkBinary("jq", true, "brew install jq  (or https://jqlang.github.io/jq/)"),
    checkBinary("claude", true, "npm install -g @anthropic-ai/claude-code"),
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
  readFileSync as readFileSync2,
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
  if (isJsProject) {
    updatePackageJson(pkgPath);
  }
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
  const version = "1.0.2";
  mkdirSync(dirname(versionPath), { recursive: true });
  writeFileSync(versionPath, version + "\n");
}
function updatePackageJson(pkgPath) {
  const raw = readFileSync2(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const canonVersion = "1.0.2";
  const devDeps = pkg["devDependencies"] ?? {};
  devDeps["canon-ai"] = `^${canonVersion}`;
  pkg["devDependencies"] = devDeps;
  const scripts = pkg["scripts"] ?? {};
  if (!scripts["canon"]) scripts["canon"] = "canon";
  pkg["scripts"] = scripts;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("\nUpdated package.json (devDependencies + scripts.canon)");
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
import { existsSync as existsSync3 } from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
import { dirname as dirname2, join as join3 } from "path";
var packageDir2 = join3(dirname2(fileURLToPath2(import.meta.url)), "../..");
var runTaskScript = join3(packageDir2, "scripts/run-task.ts");
function resolveTsx() {
  const candidates = [
    join3(packageDir2, "node_modules/.bin/tsx"),
    // canon-ai's own (most reliable)
    join3(packageDir2, "../.bin/tsx")
    // adopter's node_modules/.bin
  ];
  for (const c of candidates) {
    if (existsSync3(c)) return c;
  }
  return "tsx";
}
function runCmd(args2) {
  for (const arg of args2) {
    checkDepForFlag(arg);
  }
  const result = spawnSync(resolveTsx(), [runTaskScript, ...args2], {
    stdio: "inherit",
    cwd: process.cwd()
  });
  process.exit(result.status ?? 1);
}

// src/cli/commands/task.ts
import { spawnSync as spawnSync2 } from "child_process";
import { existsSync as existsSync4 } from "fs";
import { fileURLToPath as fileURLToPath3 } from "url";
import { dirname as dirname3, join as join4 } from "path";
var packageDir3 = join4(dirname3(fileURLToPath3(import.meta.url)), "../..");
var taskScript = join4(packageDir3, "scripts/task.sh");
function taskCmd(args2) {
  if (!existsSync4(taskScript)) {
    console.error(`task.sh not found at ${taskScript}`);
    process.exit(1);
  }
  const result = spawnSync2("bash", [taskScript, ...args2], {
    stdio: "inherit",
    cwd: process.cwd()
  });
  process.exit(result.status ?? 1);
}

// src/cli/commands/update.ts
import { existsSync as existsSync5 } from "fs";
import { fileURLToPath as fileURLToPath4 } from "url";
import { dirname as dirname4, join as join5 } from "path";
import { spawnSync as spawnSync3 } from "child_process";
var packageDir4 = join5(dirname4(fileURLToPath4(import.meta.url)), "../..");
function detectInstallType(pkgDirOverride) {
  const dir = pkgDirOverride ?? packageDir4;
  if (dir.includes("/_npx/") || dir.includes("\\_npx\\")) return "npx";
  const nodeModulesIdx = dir.lastIndexOf("/node_modules/");
  if (nodeModulesIdx !== -1) {
    const projectRoot = dir.slice(0, nodeModulesIdx);
    if (existsSync5(join5(projectRoot, "package.json"))) return "local";
  }
  return "global";
}
function updateCmd(_args) {
  const cwd = process.cwd();
  const installType = detectInstallType();
  if (installType === "npx") {
    console.log("\nRunning via npx \u2014 no persistent install to update.");
    console.log("To apply the latest templates, run:\n");
    console.log("  npx canon-ai@latest upgrade\n");
    return;
  }
  let cmdArgs;
  if (installType === "local") {
    cmdArgs = ["update", "canon-ai"];
    console.log("\nUpdating canon-ai (local devDependency)...\n");
  } else {
    cmdArgs = ["install", "-g", "canon-ai@latest"];
    console.log("\nUpdating canon-ai (global install)...\n");
  }
  const result = spawnSync3("npm", cmdArgs, { stdio: "inherit", cwd });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log("\ncanon-ai updated. Run `canon upgrade` to sync vendored files in this repo.\n");
}

// src/cli/commands/upgrade.ts
import { existsSync as existsSync6, readFileSync as readFileSync3, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { fileURLToPath as fileURLToPath5 } from "url";
import { dirname as dirname5, join as join6 } from "path";
import { spawnSync as spawnSync4 } from "child_process";
var packageDir5 = join6(dirname5(fileURLToPath5(import.meta.url)), "../..");
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
  ".canon/templates/notes.md"
];
function mergeDelimited(templateContent, projectContent) {
  if (!CANON_START_RE2.test(templateContent)) return null;
  if (!CANON_START_RE2.test(projectContent)) return null;
  const templateEnd = templateContent.indexOf(CANON_END2);
  const projectEnd = projectContent.indexOf(CANON_END2);
  if (templateEnd === -1 || projectEnd === -1) return null;
  return templateContent.slice(0, templateEnd + CANON_END2.length) + projectContent.slice(projectEnd + CANON_END2.length);
}
function runUpgrade(cwd, pkgDir) {
  const upgraded = [];
  const unchanged = [];
  const skipped = [];
  for (const rel of DELIMITED) {
    const projectPath = join6(cwd, rel);
    const templatePath = join6(pkgDir, "templates", rel);
    if (!existsSync6(projectPath) || !existsSync6(templatePath)) {
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
    writeFileSync2(projectPath, merged);
    upgraded.push(rel);
  }
  for (const rel of CANON_OWNED) {
    const projectPath = join6(cwd, rel);
    const templatePath = join6(pkgDir, "templates", rel);
    if (!existsSync6(templatePath)) {
      skipped.push(rel);
      continue;
    }
    const templateContent = readFileSync3(templatePath, "utf8");
    if (existsSync6(projectPath)) {
      const projectContent = readFileSync3(projectPath, "utf8");
      if (projectContent === templateContent) {
        unchanged.push(rel);
        continue;
      }
    } else {
      mkdirSync2(dirname5(projectPath), { recursive: true });
    }
    writeFileSync2(projectPath, templateContent);
    upgraded.push(rel);
  }
  const versionPath = join6(cwd, ".canon", "version");
  const newVersion = "1.0.2";
  const currentVersion = existsSync6(versionPath) ? readFileSync3(versionPath, "utf8").trim() : null;
  if (currentVersion !== newVersion) {
    mkdirSync2(dirname5(versionPath), { recursive: true });
    writeFileSync2(versionPath, newVersion + "\n");
    upgraded.push(".canon/version");
  }
  return { upgraded, unchanged, skipped };
}
function upgradeCmd(_args) {
  const { upgraded, unchanged, skipped } = runUpgrade(process.cwd(), packageDir5);
  if (upgraded.length > 0) {
    const r = spawnSync4("git", ["add", ...upgraded], { cwd: process.cwd(), stdio: "inherit" });
    if (r.status !== 0) {
      console.error("\nwarning: failed to stage changes \u2014 run `git add` manually.");
    }
  }
  console.log("\ncanon upgrade\n");
  if (upgraded.length > 0) {
    console.log("Updated:");
    for (const f of upgraded) console.log(`  \u2191 ${f}`);
    console.log("\nReview:  git diff --staged");
    console.log("Revert:  git checkout -- <file>\n");
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
  console.log("1.0.2");
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
    taskCmd(args);
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
