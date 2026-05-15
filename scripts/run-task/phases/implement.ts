import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getCodexConfig } from '../policy.js';
import { runCodex } from '../agents/codex.js';
import { promptImplement, promptImplementResume, promptImplementReroute, promptImplementRevisions } from '../prompts/index.js';
import { commitTaskArtifactsToBase, gitSafeAtRaw, parsePorcelain, ensureBranch } from '../git.js';
import { runTaskShFor } from '../task-sh.js';
import { getActiveCwd, isWorktreeEnabled, TASK_ARTIFACT_FILES } from '../worktree.js';
import { autoBlockPhase, readStatus, taskDirFor, writeStatus } from '../state.js';
import type { PipelineState, PhaseRunResult, TaskContext } from '../types.js';

export function shouldUseImplementRevision(
    tasks: readonly Pick<TaskContext, 'iterations_current_loop' | 'runtimeIterations_current_loop'>[],
): boolean {
    return tasks.some(t => t.iterations_current_loop > 0 || t.runtimeIterations_current_loop > 0);
}

export async function runImplementPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    commitTaskArtifactsToBase(taskIds, TASK_ARTIFACT_FILES);
    ensureBranch(taskIds);

    if (isWorktreeEnabled(taskIds)) {
        const wt = getActiveCwd(taskIds);
        const artifacts = ['spec.md', 'spec-review.md', 'plan.md', 'notes.md'];
        for (const taskId of taskIds) {
            const srcDir = taskDirFor(taskId);
            const dstDir = path.join(wt, 'tasks', taskId);
            fs.mkdirSync(dstDir, { recursive: true });
            for (const file of artifacts) {
                const src = path.join(srcDir, file);
                const dst = path.join(dstDir, file);
                if (fs.existsSync(src)) {
                    try { fs.copyFileSync(src, dst); } catch { /* best-effort */ }
                }
            }
        }
        info('Synced task artifacts from main worktree into task worktree for implement.');
    }

    const activeCwd = getActiveCwd(taskIds);
    const isRevision = shouldUseImplementRevision(tasks);
    const isRerouted = tasks.some(t => t.status.phases.implement?.rerouted === true);
    const wasImplementInProgress = tasks.some(t => t.status.phases.implement?.status === 'in_progress');
    const phaseLabel = isRevision ? ', revision' : isRerouted ? ', reroute (spec amended)' : '';
    info(`Phase: implement (Codex${state.isBundle ? ' bundle' : ''}${phaseLabel})`);
    for (const t of tasks) runTaskShFor(t.taskId, 'phase', t.taskId, 'implement', 'in_progress');

    const codexCfg = getCodexConfig('implement', tasks);
    const isResume = resumeId !== null && !isRevision && !isRerouted && wasImplementInProgress;
    // Only pass a resumeId when we're deliberately continuing an implement session.
    // A stored codex session from spec_review (full-tier tasks) must not bleed into
    // implement: that session's project root is REPO_ROOT, not the worktree, so Codex
    // file ops would land in the wrong tree.
    const shouldResume = isRevision || isRerouted || isResume;
    const implementPrompt = isRevision
        ? promptImplementRevisions(state)
        : isRerouted
            ? promptImplementReroute(state, resumeId !== null)
            : isResume
                ? promptImplementResume(state)
                : promptImplement(state, 'fresh');
    const result = await runCodex(
        implementPrompt,
        interactive,
        shouldResume ? resumeId : null,
        codexCfg.model,
        codexCfg.effort,
        {
            taskId: taskIds.join('+'),
            phase: 'implement',
            iteration: tasks[0].iterations_current_loop,
        },
        activeCwd,
        /* wrapForResume */ !isRerouted,
    );

    if (isRevision) {
        const dirtyResult = gitSafeAtRaw(activeCwd, 'status', '--porcelain=v1', '-uall');
        const meaningfulChanges = dirtyResult.ok
            ? [...parsePorcelain(dirtyResult.stdout)].filter(f => {
                if (!f.startsWith('tasks/')) return true;
                if (f.endsWith('/handoff.md')) return true;
                if (f.endsWith('/notes.md')) return true;
                return false;
            })
            : ['<git-status-failed>'];
        if (dirtyResult.ok && meaningfulChanges.length === 0) {
            warn('');
            warn('⚠️  Codex revision iteration produced no source-file changes.');
            warn('    This is the resumed-session hallucination signature: Codex believed');
            warn('    the work was already done from a prior round and skipped re-editing.');
            warn('    Dropping the stored Codex session so the next run starts fresh.');
            warn('');
            for (const taskId of taskIds) {
                const s = readStatus(taskId);
                if (s.sessions) {
                    delete s.sessions.codex;
                    writeStatus(taskId, s);
                }
            }
            autoBlockPhase(taskIds, 'implement', tasks[0].iterations_current_loop + 1,
                'Revision iteration produced no source-file diff — Codex resumed-session hallucination signature. Stored session cleared. Re-run pipeline for a fresh attempt, or apply the fix inline.');
            process.exit(2);
        }
    }

    return { agent: 'codex', sessionId: result.sessionId, exitCode: result.exitCode };
}
