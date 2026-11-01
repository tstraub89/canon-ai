#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const WRAPPERS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'npx', 'sudo']);
const GH_VALUE_FLAGS = new Set(['-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '--match-head-commit']);
const GH_VALUE_SHORTS = new Set(['t', 'b', 'F', 'A', 'R']);
const PERL_VALUE_FLAGS = new Set(['M', 'm', 'I', 'e', 'E', 'F', 'x', 'V']);
const PERL_DEBUG_FLAGS = new Set(['p', 's', 'l', 't', 'o', 'c', 'P', 'm', 'f', 'r', 'x', 'u', 'U', 'X', 'D', 'S', 'T', 'R', 'J', 'v', 'C', 'A', 'q', 'M', 'B', 'L', 'i', 'y']);
const GH_TIMEOUT_MS = Number(process.env.CANON_GUARD_GH_TIMEOUT_MS) || 3000;

function main() {
    if (process.env.CANON_GUARD_TEST_THROW === '1') throw new Error('test seam');
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    const reason = evaluate(payload);
    if (reason) {
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: reason,
            },
        }));
    }
}

try {
    main();
} catch {
    // A malformed payload or an internal error must not block the tool call.
}
process.exit(0);

function evaluate(payload) {
    if (!isRecord(payload) || typeof payload.cwd !== 'string' || payload.cwd === '' || !isRecord(payload.tool_input)) {
        return null;
    }

    if (['Edit', 'Write', 'MultiEdit'].includes(payload.tool_name)) {
        return isTaskStatusFile(payload.tool_input.file_path, payload.cwd)
            ? statusReason(path.basename(path.dirname(payload.tool_input.file_path)))
            : null;
    }

    if (payload.tool_name !== 'Bash' || typeof payload.tool_input.command !== 'string') return null;

    const commands = scan(payload.tool_input.command);
    return statusRuleBash(commands, payload.cwd) ??
        monitorRule(commands) ??
        mergeRule(commands, payload.cwd);
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statusReason(taskId) {
    return `canon guard: tasks/${taskId}/status.json is canon's task state — change it only through canon. ` +
        `Use \`canon task phase ${taskId} <phase> <status>\` for phase state, ` +
        `\`canon task set ${taskId} <field> <value>\` for task fields, ` +
        `\`canon task accept ${taskId} <phase>\` to accept a phase, or ` +
        `\`canon task reset-spec-review ${taskId}\` / \`canon task reset-code-review ${taskId}\` to clear a review loop. ` +
        `If none covers the change, stop and give the human the exact edit to apply; in a headless pipeline session, ` +
        `record that request in tasks/${taskId}/notes.md and end your turn. ` +
        `Retry with the matching canon command, or hand the edit to the human.`;
}

function detachingReason() {
    return "canon guard: don't pipe `canon run` / `canon watch` or poll the run log — a pipe buffers canon's live output and masks its exit code, and polling misses the halt states `canon watch` reports. " +
        'Run `canon run <id>` bare (it detaches and prints the PID and log path), then `canon watch <id>` with no pipe, in the background if your tool caps command duration. Retry that way.';
}

function foregroundReason(flag) {
    return `canon guard: \`canon run … ${flag}\` runs in the foreground and prints its own result; a pipe buffers that output and masks the exit code. Retry the same command without the pipe.`;
}

function mergeReason(taskId, taskIds = [taskId]) {
    const ids = taskIds.join(' ');
    const subject = taskIds.length > 1 ? `bundle tasks ${taskIds.join(', ')}` : 'the task';
    return `canon guard: this PR's head is task/${taskId}, a canon task branch. Merge task PRs through ` +
        `\`canon run ${ids} --ship\`, which uses the project's configured method (\`ship.merge_method\`, squash by default) ` +
        `and then archives ${subject} and cleans up the worktree and branches. ` +
        `--ship archives only the task ids it is given, so name every task whose status.json records this branch. ` +
        `Retry with \`canon run ${ids} --ship\`.`;
}

function isTaskStatusFile(filePath, cwd) {
    if (typeof filePath !== 'string' || filePath === '') return false;

    const expanded = filePath.startsWith('~/')
        ? path.join(os.homedir(), filePath.slice(2))
        : filePath;
    const absolute = path.resolve(cwd, expanded);
    if (path.basename(absolute) !== 'status.json' || path.basename(path.dirname(path.dirname(absolute))) !== 'tasks') {
        return false;
    }

    const taskId = path.basename(path.dirname(absolute));
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(taskId) || taskId.includes('..')) return false;

    const candidateRoot = path.dirname(path.dirname(path.dirname(absolute)));
    let ancestor = path.dirname(absolute);
    try {
        while (!statSync(ancestor).isDirectory()) {
            const parent = path.dirname(ancestor);
            if (parent === ancestor) return false;
            ancestor = parent;
        }
    } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) return false;
        ancestor = parent;
        while (ancestor !== path.dirname(ancestor)) {
            try {
                if (statSync(ancestor).isDirectory()) break;
            } catch {
                // Continue to the nearest existing directory.
            }
            ancestor = path.dirname(ancestor);
        }
    }

    const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: ancestor,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
    });
    if (git.error || git.status !== 0 || typeof git.stdout !== 'string' || git.stdout.trim() === '') return false;

    try {
        const topLevel = realpathSync(git.stdout.trim());
        const expectedRoot = realpathSync(candidateRoot);
        const canonDirectory = path.join(topLevel, '.canon');
        return topLevel === expectedRoot && existsSync(canonDirectory) && statSync(canonDirectory).isDirectory();
    } catch {
        return false;
    }
}

function scan(source) {
    const commands = [];
    const pendingHeredocs = [];
    let words = [];
    let redirects = [];
    let word = '';
    let wordStarted = false;
    let redirectTarget = null;
    let quote = null;

    const finishWord = () => {
        if (!wordStarted) return;
        if (redirectTarget) {
            redirectTarget.target = word;
            if (redirectTarget.op.replace(/^\d+/, '') === '<<' || redirectTarget.op.replace(/^\d+/, '') === '<<-') {
                pendingHeredocs.push({
                    delimiter: word,
                    stripTabs: redirectTarget.op.replace(/^\d+/, '') === '<<-',
                });
            }
            redirectTarget = null;
        } else {
            words.push(word);
        }
        word = '';
        wordStarted = false;
    };

    const finishCommand = (end) => {
        finishWord();
        if (words.length > 0 || redirects.length > 0 || end !== '') commands.push({ words, redirects, end });
        words = [];
        redirects = [];
        redirectTarget = null;
    };

    const skipHeredocBodies = (start) => {
        let cursor = start;
        for (const heredoc of pendingHeredocs.splice(0)) {
            let found = false;
            while (cursor <= source.length) {
                const newline = source.indexOf('\n', cursor);
                const end = newline === -1 ? source.length : newline;
                let line = source.slice(cursor, end);
                if (line.endsWith('\r')) line = line.slice(0, -1);
                const candidate = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
                cursor = newline === -1 ? source.length : newline + 1;
                if (candidate === heredoc.delimiter) {
                    found = true;
                    break;
                }
                if (newline === -1) break;
            }
            if (!found) return source.length;
        }
        return cursor;
    };

    for (let i = 0; i < source.length;) {
        const char = source[i];

        if (quote === "'") {
            if (char === "'") quote = null;
            else word += char;
            i += 1;
            continue;
        }
        if (quote === '"') {
            if (char === '"') {
                quote = null;
            } else if (char === '\\' && i + 1 < source.length) {
                word += source[i + 1];
                i += 1;
            } else {
                word += char;
            }
            i += 1;
            continue;
        }

        if (char === '\\') {
            if (source[i + 1] === '\n') {
                i += 2;
                continue;
            }
            if (source[i + 1] === '\r' && source[i + 2] === '\n') {
                i += 3;
                continue;
            }
            if (i + 1 < source.length) {
                word += source[i + 1];
                wordStarted = true;
                i += 2;
                continue;
            }
            word += char;
            wordStarted = true;
            i += 1;
            continue;
        }

        if (char === "'" || char === '"') {
            quote = char;
            wordStarted = true;
            i += 1;
            continue;
        }

        if (char === '#' && !wordStarted) {
            const newline = source.indexOf('\n', i);
            i = newline === -1 ? source.length : newline;
            continue;
        }

        const redirection = redirectionAt(source, i);
        if (redirection) {
            let fdPrefix = '';
            if (wordStarted && /^\d+$/.test(word)) {
                fdPrefix = word;
                word = '';
                wordStarted = false;
            } else {
                finishWord();
            }
            const entry = { op: `${fdPrefix}${redirection.operator}`, target: '' };
            redirects.push(entry);
            redirectTarget = entry;
            i += redirection.operator.length;
            continue;
        }

        if (char === ' ' || char === '\t' || char === '\r') {
            finishWord();
            i += 1;
            continue;
        }

        if (char === '\n') {
            finishCommand('\n');
            i = pendingHeredocs.length > 0 ? skipHeredocBodies(i + 1) : i + 1;
            continue;
        }

        const separator = separatorAt(source, i);
        if (separator) {
            finishCommand(separator.operator);
            i += separator.operator.length;
            continue;
        }

        word += char;
        wordStarted = true;
        i += 1;
    }

    finishCommand('');
    return commands;
}

function redirectionAt(source, index) {
    for (const operator of ['&>>', '<<<', '<<-', '<<', '&>', '>>', '>|', '>&', '<&', '>', '<']) {
        if (source.startsWith(operator, index)) return { operator };
    }
    return null;
}

function separatorAt(source, index) {
    for (const operator of ['|&', '||', '|', '&&', ';;', ';', '&']) {
        if (source.startsWith(operator, index)) return { operator };
    }
    return null;
}

function commandProgram(command) {
    const words = [...command.words];
    if (words.length === 0) return null;
    let index = 0;
    let name = stripLeadingGrouping(words[index]);
    while (index < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name) || WRAPPERS.has(name))) {
        index += 1;
        if (index >= words.length) return null;
        name = stripLeadingGrouping(words[index]);
    }
    return {
        name: basename(name),
        args: words.slice(index + 1),
    };
}

function stripLeadingGrouping(word) {
    return word.replace(/^(?:\(|\{|\$\()/, '');
}

function basename(value) {
    return value.replaceAll('\\', '/').split('/').at(-1) ?? value;
}

function canonInvocation(command) {
    const invocation = commandProgram(command);
    if (!invocation) return null;
    if (invocation.name === 'canon' || invocation.name === 'canon-dev') return invocation;
    if (invocation.name === 'node' && invocation.args[0]?.replaceAll('\\', '/').endsWith('dist/cli/index.js')) {
        return { name: 'canon', args: invocation.args.slice(1) };
    }
    return null;
}

function isTaskId(value) {
    return /^[a-z0-9][a-z0-9._-]*$/.test(value) && !value.includes('..');
}

function statusRuleBash(commands, cwd) {
    for (const command of commands) {
        for (const redirection of command.redirects) {
            const operator = redirection.op.replace(/^\d+/, '');
            const outputRedirect = ['>', '>>', '>|', '&>', '&>>', '>&'].includes(operator);
            const fdDuplicate = operator === '>&' && /^(?:\d+|-)$/.test(redirection.target);
            if (outputRedirect && !fdDuplicate && !redirection.target.startsWith('/dev/') && isTaskStatusFile(redirection.target, cwd)) {
                return statusReason(path.basename(path.dirname(path.resolve(cwd, redirection.target))));
            }
        }

        const invocation = commandProgram(command);
        if (!invocation) continue;
        if (invocation.name === 'tee' && hasStatusPathArg(invocation.args, cwd)) return statusReason(taskIdFromArgs(invocation.args, cwd));
        if (invocation.name === 'sed' && invocation.args.some(isSedInPlace) && hasStatusPathArg(invocation.args, cwd)) {
            return statusReason(taskIdFromArgs(invocation.args, cwd));
        }
        if (invocation.name === 'perl' && invocation.args.some(isPerlInPlace) && hasStatusPathArg(invocation.args, cwd)) {
            return statusReason(taskIdFromArgs(invocation.args, cwd));
        }
        if (['mv', 'cp', 'install'].includes(invocation.name)) {
            const destination = copyDestination(invocation.args);
            if (destination && isTaskStatusFile(destination, cwd)) {
                return statusReason(path.basename(path.dirname(path.resolve(cwd, destination))));
            }
        }
    }
    return null;
}

// mv/cp/install write to their last operand. With -t/--target-directory the
// destination is a directory, which cannot be status.json itself.
function copyDestination(args) {
    const operands = [];
    let endOfOptions = false;
    for (const arg of args) {
        if (!endOfOptions && arg === '--') { endOfOptions = true; continue; }
        if (!endOfOptions && (arg === '-t' || /^--target-directory(?:=|$)/.test(arg) || /^-[a-zA-Z]*t/.test(arg) && !arg.startsWith('--'))) return null;
        if (!endOfOptions && arg.startsWith('-')) continue;
        operands.push(arg);
    }
    return operands.length >= 2 ? operands.at(-1) : null;
}

function hasStatusPathArg(args, cwd) {
    return args.some(arg => !arg.startsWith('-') && isTaskStatusFile(arg, cwd));
}

function taskIdFromArgs(args, cwd) {
    const target = args.find(arg => !arg.startsWith('-') && isTaskStatusFile(arg, cwd));
    return target ? path.basename(path.dirname(path.resolve(cwd, target))) : '<unknown>';
}

function isSedInPlace(arg) {
    return /^-i/.test(arg) || /^--in-place(?:=|$)/.test(arg) || /^-[a-zA-Z]*i/.test(arg);
}

function isPerlInPlace(arg) {
    if (!/^-(?!-)[a-zA-Z0-9]/.test(arg)) return false;
    for (let index = 1; index < arg.length; index += 1) {
        const flag = arg[index];
        if (flag === 'i') return true;
        if (PERL_VALUE_FLAGS.has(flag)) return false;

        if (flag === '0') {
            index = skipPerlZeroValue(arg, index);
            continue;
        }
        if (!/[a-zA-Z]/.test(flag)) return false;

        if (flag === 'l') {
            index = skipPerlDigits(arg, index, /[0-7]/);
            continue;
        }
        if (flag === 'C') {
            // Perl consumes the rest of this short-option word as the -C value.
            return false;
        }
        if (flag === 'd') {
            if (arg[index + 1] === 't') index += 1;
            if (arg[index + 1] === ':' || arg[index + 1] === '=') return false;
            continue;
        }
        if (flag === 'D') {
            if (arg[index + 1] === ':' || arg[index + 1] === '=') return false;
            if (/[0-9]/.test(arg[index + 1] ?? '')) {
                index = skipPerlDigits(arg, index, /[0-9]/);
            } else {
                while (PERL_DEBUG_FLAGS.has(arg[index + 1] ?? '')) index += 1;
            }
        }
    }
    return false;
}

function skipPerlDigits(arg, optionIndex, digitPattern) {
    let index = optionIndex;
    while (digitPattern.test(arg[index + 1] ?? '')) index += 1;
    return index;
}

function skipPerlZeroValue(arg, optionIndex) {
    let index = optionIndex;
    if (/[xX]/.test(arg[index + 1] ?? '')) {
        index += 1;
        while (/[0-9a-fA-F]/.test(arg[index + 1] ?? '')) index += 1;
        return index;
    }
    return skipPerlDigits(arg, index, /[0-7]/);
}

function monitorRule(commands) {
    for (const command of commands) {
        if (command.end === '|' || command.end === '|&') {
            const invocation = canonInvocation(command);
            if (invocation) {
                const subcommand = invocation.args.find(arg => !arg.startsWith('-'));
                if ((subcommand === 'run' || subcommand === 'watch') && !(subcommand === 'run' && invocation.args.some(arg => arg === '--dry-run' || arg === '--help'))) {
                    if (subcommand === 'run') {
                        const flag = invocation.args.find(arg => ['--pr', '--push', '--ship', '--step', '-1'].includes(arg) || arg === '--expect' || arg.startsWith('--expect='));
                        if (flag) return foregroundReason(flag === '--expect' ? '--expect' : flag);
                    }
                    return detachingReason();
                }
            }
        }

        const invocation = commandProgram(command);
        if (invocation?.name === 'tail' && invocation.args.some(isTailFollow) && invocation.args.some(arg => basename(arg) === '.canon-run.log')) {
            return detachingReason();
        }
    }

    const loops = [];
    for (const command of commands) {
        const words = command.words.map(stripLeadingGrouping);
        const head = words[0];
        if (head === 'while' || head === 'until' || head === 'for') loops.push({ sawSleep: false, sawLog: false });

        if (loops.length > 0) {
            const rootLoop = loops[0];
            if (words.some(word => basename(word) === '.canon-run.log')) rootLoop.sawLog = true;
            const candidateHead = words.find(word => !['while', 'until', 'for', 'do', 'then', 'else', 'if', '!'].includes(word));
            if (candidateHead === 'sleep') rootLoop.sawSleep = true;
        }

        if (head === 'done') {
            const finished = loops.pop();
            if (loops.length === 0 && finished?.sawSleep && finished.sawLog) return detachingReason();
        }
    }
    return null;
}

function isTailFollow(arg) {
    return arg === '-f' || arg === '-F' || arg === '--follow' || arg.startsWith('--follow=') ||
        (!arg.startsWith('--') && /^-[a-zA-Z]*[fF]/.test(arg));
}

function mergeRule(commands, cwd) {
    for (const command of commands) {
        const invocation = commandProgram(command);
        if (invocation?.name !== 'gh') continue;
        const parsed = parseGhMergeArgs(invocation.args);
        if (!parsed) continue;

        const { args, repo: globalRepo } = parsed;
        if (hasNonSquashStrategy(args)) continue;

        const { ref, repo } = findPRReference(args, globalRepo);
        const head = ref === null ? lookupCurrentBranch(cwd) : lookupPRHead(ref, repo, cwd);
        if (typeof head !== 'string' || !head.startsWith('task/')) continue;
        const taskId = head.slice('task/'.length);
        if (!isTaskId(taskId)) return mergeReason(taskId || '<id>');
        return mergeReason(taskId, tasksOnBranch(head, taskId, cwd));
    }
    return null;
}

// Bundle members share the leader's task/<id> branch, and canon records it in
// each member's status.json inside the leader worktree. Scan that worktree and
// the current checkout so the --ship hint names every member.
function tasksOnBranch(branch, leaderId, cwd) {
    const roots = new Set();
    const toplevel = gitOutput(['rev-parse', '--show-toplevel'], cwd);
    if (toplevel) roots.add(toplevel);
    const worktrees = gitOutput(['worktree', 'list', '--porcelain'], cwd);
    if (worktrees) {
        let current = null;
        for (const line of worktrees.split('\n')) {
            if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
            else if (line === `branch refs/heads/${branch}` && current) roots.add(current);
        }
    }

    const ids = new Set([leaderId]);
    for (const root of roots) {
        let entries;
        try { entries = readdirSync(path.join(root, 'tasks'), { withFileTypes: true }); }
        catch { continue; }
        for (const entry of entries) {
            if (!entry.isDirectory() || !isTaskId(entry.name)) continue;
            try {
                const status = JSON.parse(readFileSync(path.join(root, 'tasks', entry.name, 'status.json'), 'utf8'));
                if (isRecord(status) && typeof status.branch === 'string' && status.branch.trim() === branch) ids.add(entry.name);
            } catch {
                // Missing or malformed status files cannot name a bundle member.
            }
        }
    }
    return [leaderId, ...[...ids].filter(id => id !== leaderId).sort()];
}

function gitOutput(args, cwd) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
    });
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return null;
    return result.stdout.trim() || null;
}

function parseGhMergeArgs(args) {
    let { index, repo } = consumeGhRepoOptions(args, 0, null);
    if (args[index] !== 'pr') return null;
    ({ index, repo } = consumeGhRepoOptions(args, index + 1, repo));
    if (args[index] !== 'merge') return null;
    return { args: args.slice(index + 1), repo };
}

function consumeGhRepoOptions(args, startIndex, initialRepo) {
    let index = startIndex;
    let repo = initialRepo;
    while (index < args.length) {
        const parsed = parseGhRepoOption(args, index);
        if (!parsed) break;
        index = parsed.nextIndex;
        repo = parsed.repo;
    }
    return { index, repo };
}

function parseGhRepoOption(args, index) {
    const arg = args[index];
    if (arg === '-R' || arg === '--repo') {
        const repo = args[index + 1];
        return typeof repo === 'string' ? { nextIndex: index + 2, repo } : null;
    }
    if (arg.startsWith('--repo=')) return { nextIndex: index + 1, repo: arg.slice('--repo='.length) };
    if (arg.startsWith('-R=')) return { nextIndex: index + 1, repo: arg.slice(3) };
    if (arg.startsWith('-R') && arg.length > 2) return { nextIndex: index + 1, repo: arg.slice(2) };
    return null;
}

// Walks gh's merge options the way gh parses them, so a flag value such as a
// `-t -dr` title is never read as a strategy and `-rt subject` still counts.
function hasNonSquashStrategy(args) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (/^--(rebase|merge)(=true)?$/.test(arg)) return true;
        if (GH_VALUE_FLAGS.has(arg) || arg === '-R' || arg === '--repo') {
            index += 1;
            continue;
        }
        if (arg.startsWith('--') || !arg.startsWith('-')) continue;
        const letters = arg.slice(1);
        let booleans = '';
        for (const [position, letter] of [...letters].entries()) {
            if (GH_VALUE_SHORTS.has(letter)) {
                if (position === letters.length - 1) index += 1;
                break;
            }
            if (!'dsrm'.includes(letter)) break;
            booleans += letter;
        }
        // gh refuses a cluster that mixes squash with another strategy.
        if (/[rm]/.test(booleans) && !booleans.includes('s')) return true;
    }
    return false;
}

function findPRReference(args, initialRepo = null) {
    let ref = null;
    let repo = initialRepo;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const repoOption = parseGhRepoOption(args, index);
        if (repoOption) {
            repo = repoOption.repo;
            index = repoOption.nextIndex - 1;
            continue;
        }
        if (GH_VALUE_FLAGS.has(arg)) {
            index += 1;
            continue;
        }
        if (arg.startsWith('--') || arg.startsWith('-')) continue;
        if (ref === null) ref = arg;
    }
    return { ref, repo };
}

function lookupPRHead(ref, repo, cwd) {
    const result = spawnSync('gh', [
        'pr', 'view', ref,
        ...(repo ? ['-R', repo] : []),
        '--json', 'headRefName', '--jq', '.headRefName',
    ], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GH_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return null;
    const head = result.stdout.trim();
    return head || null;
}

function lookupCurrentBranch(cwd) {
    const result = spawnSync('git', ['branch', '--show-current'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
    });
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return null;
    const branch = result.stdout.trim();
    return branch || null;
}
