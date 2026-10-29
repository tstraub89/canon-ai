import { roleBackendId, type AgentRole, type AgentBackendId, type PipelinePhase } from '../../lib/pipeline-policy.js';
import type { TaskContext } from '../types.js';
import { claudeBackend } from './claude.js';
import { codexBackend, type ColdCodexReviewResult } from './codex.js';

export type AgentMetricsContext = { taskId: string; phase: string; iteration?: number; activeCwd?: string };
export type AgentRunRequest = {
    role: AgentRole;
    phase: PipelinePhase;
    tasks: readonly TaskContext[];
    prompt: string;
    interactive: boolean;
    resumeId: string | null;
    metricsContext?: AgentMetricsContext;
    cwd?: string;
    wrapForResume?: boolean;
};
export type AgentRunResult = {
    backend: AgentBackendId;
    sessionId: string | null;
    exitCode: number | null;
    capturedStdout: string;
    text: string;
};
export type ColdReviewRequest = {
    role: AgentRole;
    phase: PipelinePhase;
    tasks: readonly TaskContext[];
    baseBranch: string;
    cwd: string;
    metricsContext?: AgentMetricsContext;
};
export type AgentConfig = { model: string; effort: string; budget?: string };
/**
 * Non-interactive failure semantics are backend-specific. Claude throws AgentSessionError
 * on non-zero exit; Codex warns and returns the exit code. Both throw on spawn error,
 * stall or signal. Interactive failures retain their terminal exit behavior. Cold review mirrors codex exec review --base provisionally;
 * Claude reports that operation unsupported.
 */
export interface AgentBackend {
    readonly id: AgentBackendId;
    readonly displayName: string;
    resolveConfig(phase: PipelinePhase, tasks: readonly TaskContext[]): AgentConfig;
    run(request: AgentRunRequest): Promise<AgentRunResult>;
    coldReview(request: ColdReviewRequest): Promise<ColdCodexReviewResult>;
}
export function agentBackendFor(role: AgentRole): AgentBackend {
    return roleBackendId(role) === 'claude' ? claudeBackend : codexBackend;
}
