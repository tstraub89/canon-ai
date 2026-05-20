import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { refreshCanonSnapshotAtPath } from '../../scripts/run-task/canon-snapshot.js';
import {
    checkPhaseGate,
    parseDiffNameStatus,
    parseHandoffChangesRows,
    verifyHandoffAgainstDiffFromData,
} from '../../scripts/run-task/validation.js';
import { filterGitIgnoredPaths } from '../../scripts/run-task/git.js';
import { deriveTopLevelStatus, resolveTaskCwd } from '../../scripts/run-task/state.js';
import { PIPELINE_TELEMETRY_FILES } from '../../scripts/run-task/worktree.js';
import { PHASE_ORDER, type Phase, type PhaseEntry, type PhaseStatus, type StatusJson, type Verdict } from '../../scripts/run-task/types.js';

const VALID_PHASES = new Set<string>(PHASE_ORDER);
const VALID_STATUSES = new Set<string>(['pending', 'in_progress', 'done', 'changes_requested', 'blocked']);
const VALID_VERDICTS = new Set<string>(['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review']);
const REVIEW_PHASES = new Set<string>(['spec_review', 'code_review']);

type GitResult = SpawnSyncReturns<string>;

export type ReleaseInitOptions = {
    pushFn?: (branch: string) => void;
};

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function usage(): string {
    return [
        'Usage: canon task <command> [args]',
        '',
        'Commands:',
        '  new <TASK-ID> <title> [--base <branch>]',
        '  list',
        '  status <TASK-ID>',
        '  phase <TASK-ID> <phase> <status> [verdict]',
        '  accept <TASK-ID...> <phase> [--force]',
        '  reset-spec-review <TASK-ID>',
        '  post-merge-sync [<branch>]',
        '  release-init <version>',
    ].join('\n');
}

export function validateTaskId(id: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
        throw new Error(`Error: invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores. No slashes, spaces, or leading special characters.`);
    }
    if (id.includes('..')) {
        throw new Error(`Error: invalid task ID '${id}'. Must not contain '..'.`);
    }
}

function tasksRoot(): string {
    return process.env.CANON_TASKS_DIR_OVERRIDE ?? 'tasks';
}

function taskDirFromRoot(taskId: string): string {
    return path.join(tasksRoot(), taskId);
}

function taskDirForCwd(cwd: string, taskId: string): string {
    const root = tasksRoot();
    return path.isAbsolute(root)
        ? path.join(root, taskId)
        : path.join(cwd, root, taskId);
}

function taskStatusFileForCwd(cwd: string, taskId: string): string {
    return path.join(taskDirForCwd(cwd, taskId), 'status.json');
}

function taskRootForGate(cwd: string): string {
    const root = tasksRoot();
    return path.isAbsolute(root) ? root : path.join(cwd, root);
}

function templatesRoot(): string {
    return path.join(process.cwd(), '.canon', 'templates');
}

function taskTemplateOverrideRoot(): string {
    return path.join(tasksRoot(), '_templates');
}

function readJsonFile<T>(filePath: string): T {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Error: failed to read ${filePath}: ${message}`);
    }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpFile, filePath);
}

function writeStatusAtomic(filePath: string, status: StatusJson): void {
    status.status = deriveTopLevelStatus(status);
    writeJsonAtomic(filePath, status);
}

function runGit(args: string[], options: { cwd?: string; stdio?: 'pipe' | 'inherit' } = {}): GitResult {
    if (options.stdio === 'inherit') {
        return spawnSync('git', args, {
            cwd: options.cwd ?? process.cwd(),
            encoding: 'utf8',
            stdio: 'inherit',
        });
    }
    return spawnSync('git', args, {
        cwd: options.cwd ?? process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function git(args: string[], options: { cwd?: string } = {}): string {
    const result = runGit(args, options);
    if (result.error) {
        throw new Error(result.error.message);
    }
    if (result.status !== 0) {
        throw new Error((result.stderr ?? '').trim() || `git ${args.join(' ')} failed`);
    }
    return (result.stdout ?? '').trim();
}

function gitOk(args: string[], options: { cwd?: string } = {}): boolean {
    const result = runGit(args, options);
    return !result.error && result.status === 0;
}

function currentBranchOrEmpty(): string {
    const result = runGit(['branch', '--show-current']);
    if (result.error || result.status !== 0) return '';
    return (result.stdout ?? '').trim();
}

function copyTemplateFile(source: string, destination: string, taskId: string, title: string): void {
    const content = fs.readFileSync(source, 'utf8')
        .replaceAll('[TASK-ID]', taskId)
        .replaceAll('[Title]', title);
    fs.writeFileSync(destination, content, 'utf8');
}

function listTemplateFiles(): string[] {
    const root = templatesRoot();
    if (!fs.existsSync(root)) {
        throw new Error(`Error: templates directory not found at ${root}`);
    }
    return fs.readdirSync(root)
        .filter(name => name.endsWith('.md') || name.endsWith('.json'))
        .sort();
}

function printCreatedTask(taskDir: string, baseBranch: string): void {
    console.log(`Created task: ${taskDir}`);
    console.log('Files:');
    for (const file of fs.readdirSync(taskDir).sort()) {
        console.log(file);
    }
    console.log('');
    console.log(`Next: Write the spec in ${taskDir}/spec.md`);
    console.log('');
    console.log(`  Defaults: task_size=M, delicate=false, human_spec_gate=true, base_branch=${baseBranch}`);
    console.log(`  Edit ${taskDir}/status.json to adjust before running the pipeline.`);
}

export function taskNew(args: string[]): void {
    let id = '';
    let title = '';
    let baseBranch = '';

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i] ?? '';
        if (arg === '--base') {
            const next = args[i + 1];
            if (!next) throw new Error('--base requires a branch name');
            baseBranch = next;
            i += 1;
        } else if (arg.startsWith('--base=')) {
            baseBranch = arg.slice('--base='.length);
        } else if (!id) {
            id = arg;
        } else if (!title) {
            title = arg;
        } else {
            throw new Error(`Error: unexpected argument '${arg}'.`);
        }
    }

    if (!id || !title) {
        throw new Error('Error: usage: canon task new <TASK-ID> <title> [--base <branch>]');
    }
    validateTaskId(id);
    if (title.includes('\n')) {
        throw new Error('Error: title must be single-line (no embedded newlines).');
    }

    const taskDir = taskDirFromRoot(id);
    if (fs.existsSync(taskDir)) {
        throw new Error(`Error: Task directory ${taskDir} already exists.`);
    }

    if (!baseBranch) {
        baseBranch = currentBranchOrEmpty() || 'main';
    }

    fs.mkdirSync(taskDir, { recursive: true });
    const overrideRoot = taskTemplateOverrideRoot();
    for (const basename of listTemplateFiles()) {
        const override = path.join(overrideRoot, basename);
        const source = fs.existsSync(override) ? override : path.join(templatesRoot(), basename);
        copyTemplateFile(source, path.join(taskDir, basename), id, title);
    }

    const statusPath = path.join(taskDir, 'status.json');
    const status = readJsonFile<StatusJson>(statusPath);
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

function derivePhase(status: StatusJson): string {
    return deriveTopLevelStatus(status);
}

export function taskList(): void {
    const root = tasksRoot();
    if (!fs.existsSync(root)) {
        console.log('No tasks found.');
        return;
    }
    const rows: Array<{ id: string; title: string; phase: string }> = [];
    // Track invalid tasks so we can exit non-zero — one malformed status.json
    // should not crash the entire listing (issue #83), but the operator
    // shouldn't be left thinking everything is fine either.
    let invalidCount = 0;
    for (const entry of fs.readdirSync(root).sort()) {
        if (entry === '_archive') continue;
        const statusPath = path.join(root, entry, 'status.json');
        if (!fs.existsSync(statusPath)) continue;
        try {
            const status = readJsonFile<StatusJson>(statusPath);
            // `derivePhase` reads `status.phases[...].status` and crashes if
            // `phases` is missing — easy to hit with hand-written or imported
            // status.json shapes. Wrap so a single bad row degrades gracefully.
            const phase = derivePhase(status);
            rows.push({
                id: entry,
                title: status.title ?? '(untitled)',
                phase,
            });
        } catch (error) {
            invalidCount += 1;
            const message = error instanceof Error ? error.message : String(error);
            rows.push({
                id: entry,
                title: '(invalid status.json)',
                phase: `INVALID: ${message}`,
            });
        }
    }

    if (rows.length === 0) {
        console.log('No tasks found.');
        return;
    }

    console.log(`${'TASK'.padEnd(25)} ${'TITLE'.padEnd(40)} CURRENT PHASE`);
    console.log(`${'----'.padEnd(25)} ${'-----'.padEnd(40)} -------------`);
    for (const row of rows) {
        console.log(`${row.id.padEnd(25)} ${row.title.padEnd(40)} ${row.phase}`);
    }
    if (invalidCount > 0) {
        throw new Error(`${invalidCount} task(s) had invalid status.json — see INVALID: rows above. Fix the malformed files or remove the task dir.`);
    }
}

export function taskStatus(id: string): void {
    if (!id) throw new Error('Task ID required');
    validateTaskId(id);
    const cwd = resolveTaskCwd(id);
    const statusPath = taskStatusFileForCwd(cwd, id);
    if (!fs.existsSync(statusPath)) {
        throw new Error(`Error: No status.json found for task ${id}`);
    }
    const status = readJsonFile<unknown>(statusPath);
    console.log(JSON.stringify(status, null, 2));
}

function assertValidPhase(phase: string): asserts phase is Phase {
    if (!VALID_PHASES.has(phase)) {
        throw new Error(`Error: invalid phase '${phase}'. Must be one of: ${PHASE_ORDER.join(', ')}`);
    }
}

function assertValidStatus(status: string): asserts status is PhaseStatus {
    if (!VALID_STATUSES.has(status)) {
        throw new Error(`Error: invalid status '${status}'. Must be one of: pending, in_progress, done, changes_requested, blocked`);
    }
}

function assertValidVerdict(phase: Phase, verdict: string | undefined): asserts verdict is Verdict | undefined {
    if (!verdict) return;
    if (!REVIEW_PHASES.has(phase)) {
        throw new Error('Error: verdict is only valid for spec_review and code_review phases');
    }
    if (!VALID_VERDICTS.has(verdict)) {
        throw new Error(`Error: invalid verdict '${verdict}'. Must be one of: approved, approved_with_nits, changes_requested, needs_re_review`);
    }
}

function priorIncompletePhases(status: StatusJson, phase: Phase): Phase[] {
    const index = PHASE_ORDER.indexOf(phase);
    if (index <= 0) return [];
    return PHASE_ORDER.slice(0, index).filter(prior => (status.phases[prior]?.status ?? 'pending') !== 'done');
}

function ensurePhaseEntry(status: StatusJson, phase: Phase): PhaseEntry {
    const existing = status.phases[phase];
    if (existing) return existing;
    const next: PhaseEntry = { status: 'pending', agent: '' };
    status.phases[phase] = next;
    return next;
}

function updateReviewCounters(entry: PhaseEntry, verdict: Verdict | undefined): void {
    entry.iterations_current_loop ??= entry.iterations ?? 0;
    entry.iterations_total ??= entry.iterations ?? 0;
    entry.changes_requested_total ??= 0;
    entry.auto_block_count ??= 0;

    if (verdict === 'changes_requested' || verdict === 'needs_re_review') {
        entry.iterations_current_loop += 1;
        entry.iterations_total += 1;
        entry.changes_requested_total += 1;
        entry.iterations = entry.iterations_current_loop;
    } else if (verdict === 'approved' || verdict === 'approved_with_nits') {
        entry.iterations_total += 1;
        entry.iterations_current_loop = 0;
        entry.iterations = 0;
    }
}

export function taskPhase(id: string, phaseArg: string, statusArg: string, verdictArg?: string): void {
    if (!id) throw new Error('Task ID required');
    if (!phaseArg) throw new Error('Phase required (spec, spec_review, plan, implement, code_review, qa, human_review)');
    if (!statusArg) throw new Error('Status required (pending, in_progress, done, changes_requested, blocked)');
    validateTaskId(id);
    assertValidPhase(phaseArg);
    assertValidStatus(statusArg);
    assertValidVerdict(phaseArg, verdictArg);

    const taskCwd = resolveTaskCwd(id);
    const statusPath = taskStatusFileForCwd(taskCwd, id);
    if (!fs.existsSync(statusPath)) {
        throw new Error(`Error: No status.json found for task ${id} (looked in ${taskDirForCwd(taskCwd, id)}/)`);
    }

    const status = readJsonFile<StatusJson>(statusPath);
    if (statusArg !== 'pending') {
        const blocked = priorIncompletePhases(status, phaseArg);
        if (blocked.length > 0) {
            throw new Error(`Error: cannot mark ${phaseArg} as ${statusArg} — prior phases not done: ${blocked.join(',')}`);
        }
    }

    if (statusArg === 'done' && !process.env.CANON_SKIP_PHASE_GATE) {
        const result = checkPhaseGate(id, phaseArg, verdictArg, taskRootForGate(taskCwd));
        if (!result.ok) {
            throw new Error(
                `check-phase-gate: ${result.reason}\n` +
                `  Resolution: either fix the artifact (most common) or, for a known-template case, do not advance the phase to 'done'.`,
            );
        }
    }

    const entry = ensurePhaseEntry(status, phaseArg);
    const previousStatus = entry.status;
    entry.status = statusArg;
    status.updated = today();
    if (verdictArg && Object.hasOwn(entry, 'verdict')) {
        entry.verdict = verdictArg;
    }
    if (REVIEW_PHASES.has(phaseArg)) {
        updateReviewCounters(entry, verdictArg);
    }
    // Any manual move of implement away from `done` invalidates a prior
    // `canon task accept` — the recorded SHA belongs to a discarded iteration.
    // Without this, an operator who runs `canon task phase <id> implement pending`
    // (or `changes_requested`) after an accept would still have the next
    // dispatch skip auto-commit against fresh implement work.
    if (phaseArg === 'implement' && previousStatus === 'done' && statusArg !== 'done') {
        delete entry.operator_accepted;
        delete entry.operator_accepted_sha;
        delete entry.operator_accepted_at;
    }
    writeStatusAtomic(statusPath, status);

    if (verdictArg) {
        console.log(`Updated ${id}: ${phaseArg} → ${statusArg} (verdict: ${verdictArg})`);
    } else {
        console.log(`Updated ${id}: ${phaseArg} → ${statusArg}`);
    }
}

/**
 * Marks a phase done AND flags it as operator-accepted so the orchestrator's
 * post-phase dispatch (e.g. autoCommitCode for implement) early-returns
 * without running its own validation. Required because canon's normal
 * dispatch assumes "uncommitted work + handoff describes it" and there is
 * no path through it once the operator has manually committed and pushed
 * past a transient failure.
 *
 * Today this is implement-only; the helper validates the phase argument so
 * future phases (qa accept? code_review accept?) can be added the same way.
 *
 * Guards: (1) base branch on origin is reachable and the task branch's
 * `baseRef..HEAD` is non-empty (we won't accept zero work as "done"),
 * (2) `git status` reports a clean tree (no surprise uncommitted work that
 * would silently be skipped), (3) every handoff path is either in
 * `baseRef..HEAD` or absent from the worktree (matching autoCommitCode's
 * own coverage rule). Bypass the guards with `--force` when recovering from
 * a fundamentally broken state.
 */
export function taskAccept(ids: readonly string[], phaseArg: string, options: { force?: boolean } = {}): void {
    if (ids.length === 0) throw new Error('Error: usage: canon task accept <TASK-ID...> <phase> [--force]');
    if (!phaseArg) throw new Error('Error: phase required (currently only `implement` is supported)');
    for (const id of ids) validateTaskId(id);
    assertValidPhase(phaseArg);

    if (phaseArg !== 'implement') {
        throw new Error(
            `Error: 'canon task accept' currently only supports the implement phase. ` +
            `Got '${phaseArg}'. For other phases use \`canon task phase <id> ${phaseArg} done [verdict]\`.`
        );
    }

    type TaskCtx = {
        id: string;
        taskCwd: string;
        statusPath: string;
        status: StatusJson;
    };

    const ctxByTask = new Map<string, TaskCtx>();
    for (const id of ids) {
        const taskCwd = resolveTaskCwd(id);
        const statusPath = taskStatusFileForCwd(taskCwd, id);
        if (!fs.existsSync(statusPath)) {
            throw new Error(`Error: No status.json found for task ${id} (looked in ${taskDirForCwd(taskCwd, id)}/)`);
        }
        const status = readJsonFile<StatusJson>(statusPath);
        ctxByTask.set(id, { id, taskCwd, statusPath, status });
    }

    // All bundled tasks must share a single working tree — accept's coverage
    // check unions every task's handoff against ONE `baseRef..HEAD` diff.
    //
    // First: bundles that mix `worktree: true` and `worktree: false` tasks
    // are rejected outright. There is no `process.cwd()` value that maps
    // sensibly to both the main checkout AND a worktree at once, so attempting
    // a unified diff baseline would silently target only one of them (Codex
    // P1, rounds 9-10). Operators with mixed bundles must accept each tree
    // separately.
    const worktreeModes = new Set<boolean>();
    for (const ctx of ctxByTask.values()) {
        worktreeModes.add(ctx.status.worktree === true);
    }
    if (worktreeModes.size > 1) {
        const worktreeTasks: string[] = [];
        const mainTasks: string[] = [];
        for (const ctx of ctxByTask.values()) {
            (ctx.status.worktree === true ? worktreeTasks : mainTasks).push(ctx.id);
        }
        throw new Error(
            `Error: bundled accept cannot mix worktree and non-worktree tasks. ` +
            `Worktree tasks: [${worktreeTasks.join(', ')}]. Non-worktree tasks: [${mainTasks.join(', ')}]. ` +
            `Run accept separately for each tree.`
        );
    }

    // Same-tree check for the homogeneous case:
    //   - All worktree → each task's resolveTaskCwd points at its own worktree.
    //     Two different worktrees → reject.
    //   - All non-worktree → there's only one main checkout per repo by
    //     definition, so the comparison is a no-op but harmless.
    //
    // For non-worktree tasks, we deliberately do NOT use `process.cwd()` or
    // `git rev-parse --show-toplevel` as the reference — both are sensitive to
    // where the operator invoked canon from. If the shell is inside a linked
    // worktree, `--show-toplevel` returns the worktree path even though the
    // non-worktree task's files live in the main checkout (codex P1, round 11).
    // Resolve through `--git-common-dir` instead: its parent is the main
    // checkout regardless of which worktree the operator launched from.
    // Canonicalize via realpath before comparing — macOS aliases `/var` and
    // `/private/var`, and resolveTaskCwd() vs. the derived root can return
    // equivalent directories with different string spellings.
    function resolveExpectedTreeForCtx(ctx: TaskCtx): string {
        if (ctx.status.worktree === true) return ctx.taskCwd;
        return resolveMainCheckoutRoot();
    }
    const primary = ctxByTask.get(ids[0])!;
    const gitCwdRaw = resolveExpectedTreeForCtx(primary);
    const gitCwd = safeRealpath(gitCwdRaw);
    for (const ctx of ctxByTask.values()) {
        const expectedRaw = resolveExpectedTreeForCtx(ctx);
        const expected = safeRealpath(expectedRaw);
        if (expected !== gitCwd) {
            throw new Error(
                `Error: bundled accept requires all tasks to share a working tree. ` +
                `Task '${ids[0]}' resolves to ${gitCwdRaw} but task '${ctx.id}' resolves to ${expectedRaw}. ` +
                `Run accept once per worktree.`
            );
        }
    }

    if (!options.force) {
        for (const ctx of ctxByTask.values()) {
            const blocked = priorIncompletePhases(ctx.status, phaseArg);
            if (blocked.length > 0) {
                throw new Error(`Error: cannot accept ${phaseArg} for '${ctx.id}' — prior phases not done: ${blocked.join(',')}`);
            }
        }

        ensureGitAvailable();

        // Filter out pipeline-owned paths from the dirty check:
        //   - `tasks/<id>/...` for every task being accepted (each command run
        //     mutates that task's status.json and notes.md, so these are always
        //     "dirty" by the time the check runs)
        //   - pipeline telemetry files
        // Surprises from genuine uncommitted source edits still trip the guard.
        const dirty = git(['status', '--porcelain=v1', '-uall'], { cwd: gitCwd });
        const dirtyLines = dirty.split('\n').filter(line => line.trim() !== '');
        const sourceDirty = dirtyLines.filter(line => {
            const dirtyPath = parsePorcelainPath(line);
            if (!dirtyPath) return true;
            return !ids.some(id => isPipelineOwnedAcceptPath(dirtyPath, id, gitCwd));
        });
        if (sourceDirty.length > 0) {
            throw new Error(
                `Error: working tree is not clean — accept would silently skip uncommitted changes.\n` +
                `  Dirty source paths (first 20):\n` +
                sourceDirty.slice(0, 20).map(line => `    ${line}`).join('\n') +
                `\n  Commit or stash these changes first, or re-run with --force if you genuinely want to ignore them.`
            );
        }

        // Every task in a bundle must agree on base_branch. Mismatched bases
        // would imply two separate diff baselines — there's no single
        // `baseRef..HEAD` that satisfies coverage for both.
        const baseBranches = new Set<string>();
        for (const ctx of ctxByTask.values()) {
            const b = (ctx.status.base_branch ?? '').trim();
            if (!b) throw new Error(`Error: status.json for '${ctx.id}' is missing base_branch — cannot determine the diff baseline for accept.`);
            baseBranches.add(b);
        }
        if (baseBranches.size > 1) {
            throw new Error(
                `Error: bundled accept requires all tasks to share base_branch. ` +
                `Got: ${[...baseBranches].join(', ')}. Accept one bundle at a time.`
            );
        }
        const baseBranch = [...baseBranches][0];
        if (!gitOk(['rev-parse', '--verify', baseBranch], { cwd: gitCwd })) {
            throw new Error(
                `Error: base branch '${baseBranch}' is not reachable from ${gitCwd}. ` +
                `Fetch it or pass --force if you know the diff baseline is intentional.`
            );
        }

        const diffResult = runGit(['diff', `${baseBranch}...HEAD`, '--name-status', '-M'], { cwd: gitCwd });
        if (diffResult.error || diffResult.status !== 0) {
            throw new Error(`Error: git diff ${baseBranch}...HEAD failed: ${(diffResult.stderr ?? '').trim() || 'unknown error'}`);
        }
        const { diffFiles, renamePairs } = parseDiffNameStatus(diffResult.stdout ?? '');
        if (diffFiles.length === 0 && renamePairs.length === 0) {
            throw new Error(
                `Error: ${baseBranch}...HEAD is empty — no work has landed on this branch.\n` +
                `  Commit your changes on the task branch first, or pass --force to accept an empty implement phase anyway.`
            );
        }

        // Per-task handoff parse, then union for coverage. Each task's
        // malformed rows are reported with the task ID so the operator can
        // fix the right file. Coverage is bundle-wide: a single manual commit
        // can legitimately contain files belonging to multiple tasks, and
        // each task's handoff only lists its own.
        const handoffFilesByTask = new Map<string, string[]>();
        const allHandoffFiles = new Set<string>();
        const allMalformed: Array<{ taskId: string; cell: string; reason: string }> = [];
        for (const ctx of ctxByTask.values()) {
            const { files, malformed } = parseHandoffChangesRows(ctx.id);
            handoffFilesByTask.set(ctx.id, files);
            for (const file of files) allHandoffFiles.add(file);
            for (const m of malformed) allMalformed.push({ taskId: ctx.id, cell: m.cell, reason: m.reason });
        }
        if (allMalformed.length > 0) {
            const lines = allMalformed.slice(0, 10).map(m => `    [${m.taskId}] '${m.cell}': ${m.reason}`);
            const tail = allMalformed.length > 10 ? `\n    (+${allMalformed.length - 10} more)` : '';
            throw new Error(
                `Error: handoff.md has malformed Changes rows — fix these before accepting.\n` +
                lines.join('\n') + tail +
                `\n  Use --force to accept anyway, but the code_review pre-flight will still reject the run.`
            );
        }
        const gitIgnoredHandoffFiles = filterGitIgnoredPaths([...allHandoffFiles], gitCwd);
        const coverageIssues = verifyHandoffAgainstDiffFromData(
            [...ids],
            {
                diffFiles,
                renamePairs,
                handoffFilesByTask,
                gitIgnoredHandoffFiles,
            },
        );
        if (coverageIssues.length > 0) {
            const lines = coverageIssues.slice(0, 10).map(i => `    ${i}`);
            const tail = coverageIssues.length > 10 ? `\n    (+${coverageIssues.length - 10} more)` : '';
            throw new Error(
                `Error: handoff.md does not match \`git diff ${baseBranch}...HEAD\` — fix the Changes table before accepting:\n` +
                lines.join('\n') + tail +
                `\n  Use --force to accept anyway, but the code_review pre-flight will still reject the run.`
            );
        }
    }

    // Capture HEAD once for the whole bundle — every accepted task pins the
    // same SHA so the orchestrator's all-or-nothing skip logic remains
    // symmetric across the bundle. Refuse to write an empty SHA: the
    // orchestrator correctly rejects empty SHAs at skip-time, so writing
    // accepted=true with sha='' silently demotes the accept (operator thinks
    // it stuck; the next run runs auto-commit normally anyway, no harm done
    // but the report is misleading). Better to fail loudly here so the
    // operator can resolve the HEAD lookup issue first.
    const headRevParse = runGit(['rev-parse', 'HEAD'], { cwd: gitCwd });
    if (headRevParse.error || headRevParse.status !== 0) {
        const stderr = (headRevParse.stderr ?? '').trim() || 'unknown error';
        throw new Error(
            `Error: failed to read HEAD from ${gitCwd} (${stderr}). ` +
            `Cannot pin operator_accepted_sha — accept would silently demote on the next run. ` +
            `Verify the working tree has a HEAD (no unborn branch / detached state issues), then re-run.`
        );
    }
    const sharedSha = (headRevParse.stdout ?? '').trim();
    if (!sharedSha) {
        throw new Error(
            `Error: \`git rev-parse HEAD\` from ${gitCwd} returned an empty string. ` +
            `Refusing to accept without a usable SHA — see above for the working-tree state.`
        );
    }

    // Snapshot original status.json bytes BEFORE any mutation so a mid-bundle
    // write failure can roll the bundle back to its pre-accept state. POSIX
    // doesn't give us cross-file atomicity, but rollback is the next-best
    // guarantee: either every task in the bundle ends accepted, or none do.
    const originalSnapshots = new Map<string, string>();
    for (const ctx of ctxByTask.values()) {
        try {
            originalSnapshots.set(ctx.statusPath, fs.readFileSync(ctx.statusPath, 'utf8'));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Error: failed to read ${ctx.statusPath} for rollback snapshot: ${message}`);
        }
    }

    const completedWrites: string[] = [];
    try {
        for (const ctx of ctxByTask.values()) {
            const implementEntry = ensurePhaseEntry(ctx.status, 'implement');
            implementEntry.status = 'done';
            implementEntry.operator_accepted = true;
            implementEntry.operator_accepted_at = today();
            implementEntry.operator_accepted_sha = sharedSha;
            ctx.status.updated = today();
            writeStatusAtomic(ctx.statusPath, ctx.status);
            completedWrites.push(ctx.statusPath);
        }
    } catch (error) {
        // Roll back any status writes that already succeeded before the failure.
        // Use tmp+rename (same shape as writeStatusAtomic) instead of a direct
        // writeFileSync — the forward path writes atomically, so rollback must
        // too. A signal/crash mid-rollback with a non-atomic writeFileSync
        // would corrupt the very file rollback was trying to restore.
        const rollbackErrors: string[] = [];
        for (const filePath of completedWrites) {
            const original = originalSnapshots.get(filePath);
            if (original === undefined) continue;
            try {
                const tmpFile = `${filePath}.rollback.tmp`;
                fs.writeFileSync(tmpFile, original, 'utf8');
                fs.renameSync(tmpFile, filePath);
            } catch (rollbackErr) {
                const message = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
                rollbackErrors.push(`    ${filePath}: ${message}`);
            }
        }
        const originalMessage = error instanceof Error ? error.message : String(error);
        if (rollbackErrors.length > 0) {
            throw new Error(
                `Error: bundled accept failed mid-write AND rollback also failed.\n` +
                `  Original error: ${originalMessage}\n` +
                `  Rollback failures (the following status.json files are in an inconsistent state):\n` +
                rollbackErrors.join('\n') +
                `\n  Restore manually from git history.`
            );
        }
        throw new Error(`Error: bundled accept failed; rolled back to pre-accept state. Original error: ${originalMessage}`);
    }

    for (const ctx of ctxByTask.values()) {
        const notesPath = path.join(taskDirForCwd(ctx.taskCwd, ctx.id), 'notes.md');
        const noteLine = `[${today()}] Operator accepted implement phase via \`canon task accept\` — auto-commit will be skipped.${options.force ? ' (--force)' : ''}`;
        try {
            if (fs.existsSync(notesPath)) {
                fs.appendFileSync(notesPath, `\n${noteLine}\n`, 'utf8');
            } else {
                fs.writeFileSync(notesPath, `${noteLine}\n`, 'utf8');
            }
        } catch (error) {
            // notes.md is diagnostic-only — a write failure here doesn't
            // invalidate the accept itself. Warn and continue.
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Warning: failed to log to notes.md for ${ctx.id}: ${message}`);
        }
    }

    const label = ids.length === 1 ? ids[0] : `[${ids.join(', ')}]`;
    console.log(
        `Accepted ${label}: implement → done (operator_accepted=true).` +
        (options.force ? ' (--force)' : '') +
        `\n  Auto-commit will be skipped on subsequent \`canon run\` invocations. The next phase (code_review) will run normally against the committed work.`
    );
}

export function taskResetSpecReview(id: string): void {
    if (!id) throw new Error('Error: usage: canon task reset-spec-review <TASK-ID>');
    validateTaskId(id);
    const taskCwd = resolveTaskCwd(id);
    const taskDir = taskDirForCwd(taskCwd, id);
    const statusPath = path.join(taskDir, 'status.json');
    if (!fs.existsSync(statusPath)) {
        throw new Error(`Error: no status.json at ${statusPath}`);
    }

    const reviewPath = path.join(taskDir, 'spec-review.md');
    if (fs.existsSync(reviewPath)) {
        let n = 1;
        while (fs.existsSync(path.join(taskDir, `spec-review-prior-${n}.md`))) n += 1;
        fs.renameSync(reviewPath, path.join(taskDir, `spec-review-prior-${n}.md`));
        console.log(`Archived prior spec-review.md → spec-review-prior-${n}.md`);
    }

    const status = readJsonFile<StatusJson>(statusPath);
    const spec = ensurePhaseEntry(status, 'spec');
    const specReview = ensurePhaseEntry(status, 'spec_review');
    spec.status = 'done';
    specReview.status = 'pending';
    specReview.iterations = 0;
    specReview.iterations_current_loop = 0;
    specReview.verdict = '';
    if (status.sessions && Object.hasOwn(status.sessions, 'claude_spec')) {
        delete status.sessions.claude_spec;
    }
    status.updated = today();
    writeStatusAtomic(statusPath, status);
    console.log(`Reset ${id}: spec → done, spec_review → pending (iter=0, verdict cleared, claude_spec session dropped)`);
}

function ensureGitAvailable(): void {
    const result = spawnSync('git', ['--version'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error('Error: git is required.');
    }
}

/**
 * Extracts the path from a single `git status --porcelain=v1 -uall` line.
 * Returns null for malformed lines. Handles rename arrows (` -> `) by
 * returning the post-image path, which is what's relevant for "is this a
 * task artifact?" filtering.
 */
function parsePorcelainPath(line: string): string | null {
    if (line.length < 3) return null;
    const raw = line.slice(3).trim();
    if (!raw) return null;
    const arrow = raw.lastIndexOf(' -> ');
    const tail = arrow >= 0 ? raw.slice(arrow + 4) : raw;
    return tail.replace(/^"|"$/g, '');
}

/**
 * Pipeline-owned paths exempt from accept's dirty-tree guard:
 *   - `tasks/<id>/...` for the accepting task (the accept command itself
 *     writes to status.json and notes.md)
 *   - PIPELINE_TELEMETRY_FILES (append-only telemetry like docs/lessons-learned.md
 *     that gets touched between phases; rejecting accept because of these
 *     blocks the operator on noise rather than real uncommitted work)
 *
 * Resolves relative paths against the git repo root (not `process.cwd()`) so
 * the matcher works the same whether canon is invoked from the repo root or a
 * subdirectory. Canonicalizes symlinks before comparison so macOS's
 * `/var → /private/var` cwd quirk doesn't cause spurious mismatches.
 */
function isPipelineOwnedAcceptPath(filePath: string, taskId: string, gitCwd: string): boolean {
    const repoRootForPaths = resolveRepoRootForAccept(gitCwd);
    const dirtyAbsolute = path.isAbsolute(filePath) ? filePath : path.resolve(repoRootForPaths, filePath);
    const canonicalDirty = safeRealpath(dirtyAbsolute);

    const root = tasksRoot();
    const rootAbsolute = path.isAbsolute(root) ? root : path.resolve(repoRootForPaths, root);
    const canonicalRoot = safeRealpath(rootAbsolute);
    const taskCanonical = path.join(canonicalRoot, taskId);
    if (canonicalDirty === taskCanonical) return true;
    if (canonicalDirty.startsWith(`${taskCanonical}${path.sep}`)) return true;

    for (const telemetry of PIPELINE_TELEMETRY_FILES) {
        const telemetryAbsolute = path.resolve(repoRootForPaths, telemetry);
        if (safeRealpath(telemetryAbsolute) === canonicalDirty) return true;
    }
    return false;
}

/** Repo (or worktree) toplevel for the given cwd. Falls back to cwd if git lookup fails. */
function resolveRepoRootForAccept(gitCwd: string): string {
    const result = runGit(['rev-parse', '--show-toplevel'], { cwd: gitCwd });
    if (result.error || result.status !== 0) return gitCwd;
    return (result.stdout ?? '').trim() || gitCwd;
}

/**
 * realpath that gracefully falls back to canonicalizing each existing ancestor
 * if the leaf doesn't exist yet (e.g., an untracked file's parent dir exists
 * but the file does not at check time on some platforms).
 */
/**
 * Returns the main checkout's working-tree root, regardless of whether the
 * shell is currently inside the main checkout, a linked worktree, or a
 * subdirectory. Used by `taskAccept` for non-worktree tasks so the diff
 * baseline and HEAD pin target the same checkout the task's files live in,
 * not whatever happens to be the operator's cwd.
 *
 * Mechanism: `git rev-parse --git-common-dir` returns the shared `.git`
 * directory's path; its parent directory is the main checkout. From a linked
 * worktree, `--show-toplevel` would return the worktree root instead — that
 * was the cwd-sensitive bug codex flagged on round 11 of PR #86.
 *
 * Falls back to `process.cwd()` if git fails (e.g., test fixture without git).
 */
function resolveMainCheckoutRoot(): string {
    const out = runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: process.cwd() });
    if (out.error || out.status !== 0) return process.cwd();
    const gitCommonDir = (out.stdout ?? '').trim();
    if (!gitCommonDir) return process.cwd();
    return path.dirname(gitCommonDir);
}

function safeRealpath(target: string): string {
    try {
        return fs.realpathSync(target);
    } catch {
        const parent = path.dirname(target);
        if (parent === target) return target;
        try {
            return path.join(fs.realpathSync(parent), path.basename(target));
        } catch {
            return target;
        }
    }
}

/**
 * Returns the subset of `untracked` paths that `git reset --hard <target>`
 * would clobber. Three collision modes:
 *
 *   (A) Exact match: untracked `foo/bar.txt` AND target `foo/bar.txt`.
 *   (B) Local dir / target file: untracked `foo/bar.txt` AND target tracks
 *       `foo` as a file. Reset wipes the `foo/` directory to make room.
 *   (C) Local file / target dir: untracked `foo` AND target tracks
 *       `foo/bar.txt`. Reset removes the file to make a `foo/` directory.
 *
 * `git ls-files --others --exclude-standard` lists files, so `untracked`
 * entries are always file paths. Exported for unit testing without the
 * full git fixture setup.
 */
export function findUntrackedClobberPaths(
    untracked: readonly string[],
    targetTreeFiles: ReadonlySet<string>,
): string[] {
    const conflicts: string[] = [];
    for (const u of untracked) {
        // Case A
        if (targetTreeFiles.has(u)) { conflicts.push(u); continue; }
        // Case B: walk up u's ancestors; if any is a tracked target file, conflict.
        let p = u;
        let hit = false;
        while (true) {
            const slash = p.lastIndexOf('/');
            if (slash === -1) break;
            p = p.slice(0, slash);
            if (targetTreeFiles.has(p)) { conflicts.push(u); hit = true; break; }
        }
        if (hit) continue;
        // Case C: any target path under `u/` means u (a file locally) collides
        // with a directory in target.
        const prefix = `${u}/`;
        for (const t of targetTreeFiles) {
            if (t.startsWith(prefix)) { conflicts.push(u); break; }
        }
    }
    return conflicts;
}

export function taskPostMergeSync(branchArg?: string): void {
    ensureGitAvailable();
    let targetBranch = branchArg ?? '';
    if (!targetBranch) targetBranch = currentBranchOrEmpty();
    if (!targetBranch) {
        throw new Error('Error: could not determine current branch (detached HEAD?). Pass branch as arg.');
    }

    const current = currentBranchOrEmpty();
    if (current !== targetBranch) {
        throw new Error(`Error: post-merge-sync expects you to be on '${targetBranch}' (you are on '${current}').`);
    }
    // Note: no blanket dirty-tree check here. `git fetch` doesn't care about
    // the working tree; `git pull --ff-only` will error on real conflicts
    // itself; the only destructive op is `git reset --hard` below, which we
    // guard specifically before invoking.

    console.log(`→ Fetching origin/${targetBranch}...`);
    const fetch = runGit(['fetch', 'origin', targetBranch]);
    if (fetch.error || fetch.status !== 0) {
        throw new Error('Error: git fetch failed.');
    }

    const ahead = Number.parseInt(git(['rev-list', '--count', `origin/${targetBranch}..${targetBranch}`]) || '0', 10);
    const behind = Number.parseInt(git(['rev-list', '--count', `${targetBranch}..origin/${targetBranch}`]) || '0', 10);

    if (ahead === 0 && behind === 0) {
        console.log(`✓ ${targetBranch} is in sync with origin/${targetBranch}.`);
        nudgeShippableTasks();
        return;
    }

    if (ahead === 0 && behind > 0) {
        console.log(`→ ${targetBranch} is ${behind} commit(s) behind origin/${targetBranch}, fast-forwarding...`);
        const pull = runGit(['pull', '--ff-only', 'origin', targetBranch], { stdio: 'inherit' });
        if (pull.error || pull.status !== 0) throw new Error(pull.error?.message ?? 'git pull failed');
        nudgeShippableTasks();
        return;
    }

    const diff = git(['diff', '--name-only', `origin/${targetBranch}..${targetBranch}`]);
    const sourcePaths = diff.split('\n').filter(Boolean).filter(file =>
        !/^(docs\/pipeline-invocations\.md|docs\/task-quality-log\.md|docs\/lessons-learned\.md|tasks\/)/.test(file),
    );

    if (sourcePaths.length === 0) {
        // About to `git reset --hard` — narrow guard that refuses only in the
        // cases where reset --hard can destroy real local work:
        //   1. Dirty tracked files (modified/staged): reset --hard discards them.
        //   2. Untracked files whose path is tracked in the target tree:
        //      reset --hard silently overwrites them.
        // Untracked files NOT in the target tree, and `.gitignore`-ignored
        // files, are safe — reset --hard leaves them alone. That carve-out
        // is the point: the previous blanket `git status --porcelain` check
        // refused on any untracked file even when it could not be clobbered,
        // forcing adopters into needless stash/pop dances over unrelated work.
        if (git(['diff', '--name-only', 'HEAD']) || git(['diff', '--cached', '--name-only'])) {
            throw new Error(
                'Error: working tree has dirty tracked files and post-merge-sync is about to `git reset --hard`.\n' +
                '  Commit or stash the tracked changes before re-running.',
            );
        }
        // `--others` without `--exclude-standard` lists both untracked AND
        // .gitignore'd files. We need both: gitignored content at a
        // target-tracked path is just as clobber-prone as plain untracked
        // content. The non-colliding ignored content (the common case, e.g.
        // a `dist/` or `_scratch/` dir not present in origin) passes the
        // collision check below and never blocks the reset.
        const localFiles = git(['ls-files', '--others']).split('\n').filter(Boolean);
        if (localFiles.length > 0) {
            const targetTreeFiles = new Set(
                git(['ls-tree', '-r', `origin/${targetBranch}`, '--name-only']).split('\n').filter(Boolean),
            );
            const conflicting = findUntrackedClobberPaths(localFiles, targetTreeFiles);
            if (conflicting.length > 0) {
                throw new Error(
                    'Error: local files (untracked or gitignored) match paths tracked in `origin/' + targetBranch + '`.\n' +
                    '  `git reset --hard` would silently overwrite them:\n' +
                    conflicting.map(f => `    ${f}`).join('\n') +
                    '\n  Move, rename, or remove these files before re-running.',
                );
            }
        }
        console.log(`→ ${targetBranch} is ${ahead} commit(s) ahead of origin/${targetBranch}, but only via`);
        console.log('  pipeline telemetry / task-state edits that have been absorbed by squash merges.');
        console.log(`  Hard-resetting to origin/${targetBranch}...`);
        const reset = runGit(['reset', '--hard', `origin/${targetBranch}`], { stdio: 'inherit' });
        if (reset.error || reset.status !== 0) throw new Error(reset.error?.message ?? 'git reset failed');
        console.log(`✓ ${targetBranch} reset to origin/${targetBranch} (${git(['log', '-1', '--format=%h'])}).`);
        nudgeShippableTasks();
        return;
    }

    console.log(`⚠️  ${targetBranch} is ${ahead} commit(s) ahead of origin/${targetBranch} with non-telemetry changes:`);
    console.log('');
    for (const file of sourcePaths) console.log(`    ${file}`);
    console.log('');
    console.log('Refusing to hard-reset. Either push these commits to origin');
    console.log(`(\`git push origin ${targetBranch}\`) if they're real work, or rebase manually`);
    console.log('if they conflict with the squash merge.');
    throw new Error('');
}

/**
 * After a successful post-merge-sync, surface any task that looks "merged but
 * not archived" — i.e., still at human_review locally, but its remote task
 * branch is gone (typical of a squash-merge with --delete-branch). Routes the
 * user to `canon run <id> --ship`, which is the canonical archive command.
 *
 * Intentionally silent on false negatives: we don't fail or warn if we can't
 * tell. This is a nudge, not a guard.
 */
function nudgeShippableTasks(): void {
    const root = tasksRoot();
    if (!fs.existsSync(root)) return;
    const shippable: string[] = [];
    for (const entry of fs.readdirSync(root).sort()) {
        if (entry === '_archive' || entry.startsWith('_')) continue;
        const statusPath = path.join(root, entry, 'status.json');
        if (!fs.existsSync(statusPath)) continue;
        let status: StatusJson;
        try { status = readJsonFile<StatusJson>(statusPath); }
        catch { continue; }
        // Derive the phase from phases[] (authoritative) rather than trusting
        // status.status (cached pointer; can be stale if a ship was
        // interrupted mid-flight). Include both `human_review` (the typical
        // case: pipeline parked, PR merged elsewhere, no --ship yet) and
        // `complete` (the off-script case: user manually advanced
        // human_review without running --ship — still archive-ready).
        // (Codex P2 on PR #76.)
        const phase = derivePhase(status);
        if (phase !== 'human_review' && phase !== 'complete') continue;
        const branchName = status.branch?.trim();
        if (!branchName) continue;
        // Hit origin directly to determine whether the branch still exists.
        // The local `refs/remotes/origin/<branch>` cache is only updated when
        // we fetch that specific branch; post-merge-sync fetched only the
        // base branch, so the cache for deleted task branches is unreliable.
        // `git ls-remote` queries origin authoritatively.
        const ls = runGit(['ls-remote', '--heads', '--exit-code', 'origin', branchName]);
        // exit 0 = branch exists; exit 2 = no matching ref (deleted); other = network/other failure.
        if (ls.error) continue;       // network/git error — stay silent, don't false-alarm.
        if (ls.status === 0) continue; // branch still on origin — not yet merged.
        if (ls.status === 2) shippable.push(entry);
    }
    if (shippable.length === 0) return;
    console.log('');
    console.log('ℹ Task(s) appear merged (remote branch gone) but not yet archived:');
    for (const id of shippable) console.log(`    ${id}`);
    console.log('  Run `canon run <id> --ship` on each to archive + clean up.');
}

function updatePackageVersion(filePath: string, version: string, updateLockRoot = false): void {
    const parsed = readJsonFile<Record<string, unknown>>(filePath);
    parsed.version = version;
    if (updateLockRoot) {
        const packages = parsed.packages;
        if (packages && typeof packages === 'object') {
            const rootPackage = (packages as Record<string, unknown>)[''];
            if (rootPackage && typeof rootPackage === 'object') {
                (rootPackage as Record<string, unknown>).version = version;
            }
        }
    }
    writeJsonAtomic(filePath, parsed);
}

function insertChangelogBlock(filePath: string, short: string): void {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const first = lines.shift() ?? '';
    const block = [
        first,
        '',
        `## ${short} - unreleased`,
        '',
        `<!-- Bullets land here as tasks for ${short} ship. The single squash-merge of release/${short} → main carries this entry to production. -->`,
        ...lines,
    ];
    fs.writeFileSync(filePath, block.join('\n'), 'utf8');
}

function defaultPush(branch: string): void {
    const result = runGit(['push', '-u', 'origin', branch], { stdio: 'inherit' });
    if (result.error) throw new Error(result.error.message);
    if (result.status !== 0) throw new Error(`git push -u origin ${branch} failed`);
}

export function taskReleaseInit(version: string, options: ReleaseInitOptions = {}): void {
    if (!version) {
        throw new Error('Error: usage: canon task release-init <version>\n       e.g.: canon task release-init 1.6.0');
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Error: version must be semver (e.g. 1.6.0). Got: ${version}`);
    }
    ensureGitAvailable();

    const short = `v${version.replace(/\.0$/, '')}`;
    const branch = `release/${short}`;
    const current = currentBranchOrEmpty();
    if (current !== 'main') {
        throw new Error(`Error: release-init expects you to start on 'main' (you are on '${current}').`);
    }
    if (git(['status', '--porcelain'])) {
        throw new Error('Error: working tree is dirty. Commit or stash first.');
    }

    console.log('→ Fetching origin/main...');
    const fetch = runGit(['fetch', 'origin', 'main']);
    if (fetch.error || fetch.status !== 0) {
        throw new Error('Error: git fetch failed.');
    }
    const behind = Number.parseInt(git(['rev-list', '--count', 'main..origin/main']) || '0', 10);
    if (behind > 0) {
        throw new Error(`Error: local main is ${behind} commit(s) behind origin/main. Pull first.`);
    }

    if (gitOk(['rev-parse', '--verify', branch])) {
        throw new Error(`Error: branch '${branch}' already exists locally.`);
    }
    if (gitOk(['rev-parse', '--verify', `origin/${branch}`])) {
        throw new Error(`Error: branch '${branch}' already exists on origin.`);
    }

    console.log(`→ Creating ${branch} off main...`);
    git(['checkout', '-b', branch, 'main']);

    const filesToAdd: string[] = [];
    if (fs.existsSync('package.json')) {
        console.log(`→ Bumping package.json version to ${version}...`);
        updatePackageVersion('package.json', version);
        filesToAdd.push('package.json');

        if (fs.existsSync('package-lock.json')) {
            console.log('→ Bumping package-lock.json...');
            updatePackageVersion('package-lock.json', version, true);
            filesToAdd.push('package-lock.json');
        }
    }

    if (fs.existsSync('CHANGELOG.md')) {
        console.log(`→ Inserting empty changelog block for ${short}...`);
        insertChangelogBlock('CHANGELOG.md', short);
        filesToAdd.push('CHANGELOG.md');
    }

    if (filesToAdd.length > 0) {
        git(['add', ...filesToAdd]);
        git(['commit', '-m', `chore: initialize ${branch} (version ${version})`]);
    } else {
        git(['commit', '--allow-empty', '-m', `chore: initialize ${branch} (version ${version}, no version files to bump)`]);
    }

    if (options.pushFn) options.pushFn(branch);
    else defaultPush(branch);

    console.log('');
    console.log(`✓ Release branch ${branch} initialized and pushed.`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Create tasks on this branch: canon task new <id> <title>');
    console.log(`     (auto-detects base_branch=${branch} from your current checkout)`);
    console.log(`  2. Each task PR targets ${branch} (not main).`);
    console.log(`  3. As tasks ship, append bullets to the ${short} block in CHANGELOG.md.`);
    console.log(`  4. When ready: open PR ${branch} → main, squash-merge for the release.`);
}

export function taskCmd(args: string[]): void {
    const [subcommand, ...rest] = args;
    try {
        switch (subcommand) {
            case 'new':
                taskNew(rest);
                break;
            case 'list':
                taskList();
                break;
            case 'status':
                taskStatus(rest[0] ?? '');
                break;
            case 'phase':
                taskPhase(rest[0] ?? '', rest[1] ?? '', rest[2] ?? '', rest[3]);
                break;
            case 'accept': {
                const force = rest.includes('--force');
                const positional = rest.filter(arg => arg !== '--force');
                if (positional.length < 2) {
                    throw new Error('Error: usage: canon task accept <TASK-ID...> <phase> [--force]');
                }
                // Last positional arg is the phase; everything before is a task ID.
                const acceptPhase = positional[positional.length - 1];
                const acceptIds = positional.slice(0, -1);
                taskAccept(acceptIds, acceptPhase, { force });
                break;
            }
            case 'reset-spec-review':
                taskResetSpecReview(rest[0] ?? '');
                break;
            case 'post-merge-sync':
                taskPostMergeSync(rest[0]);
                break;
            case 'release-init':
                taskReleaseInit(rest[0] ?? '');
                break;
            default:
                console.error(`Unknown subcommand: ${subcommand ?? '(none)'}\n${usage()}`);
                process.exit(1);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message) console.error(message);
        process.exit(1);
    }
}
