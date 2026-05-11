import type {
    ClaudeModelConfig,
    ClaudePhase,
    CodexModelConfig,
    CodexPhase,
    PipelineTier,
    PolicyConfig,
    PolicyInput,
    TaskSize,
} from '../pipeline-policy.js';

export const PHASE_ORDER = ['spec', 'spec_review', 'plan', 'implement', 'runtime_validation', 'code_review', 'qa', 'human_review'] as const;
export const _PHASE_STATUS_VALUES = ['pending', 'in_progress', 'done', 'changes_requested', 'blocked'] as const;
export const _VERDICT_VALUES = ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review'] as const;

export type Phase = (typeof PHASE_ORDER)[number];
export type PhaseStatus = (typeof _PHASE_STATUS_VALUES)[number];
export type Verdict = (typeof _VERDICT_VALUES)[number] | '';
export type CurrentPhase = Phase | 'complete';

export function isPhaseStatus(value: unknown): value is PhaseStatus {
    return typeof value === 'string' && _PHASE_STATUS_VALUES.includes(value as PhaseStatus);
}

export function isVerdict(value: unknown): value is Verdict {
    return typeof value === 'string' && _VERDICT_VALUES.includes(value as (typeof _VERDICT_VALUES)[number]);
}

export type PhaseEntry = {
    status: PhaseStatus;
    agent: string;
    verdict?: Verdict;
    iterations?: number;
    iterations_current_loop?: number;
    iterations_total?: number;
    changes_requested_total?: number;
    auto_block_count?: number;
    rerouted?: boolean;
    reroute_count?: number;
};

export type Escalation = {
    date: string;
    phase: Phase;
    iteration_count?: number;
    reason: string;
};

export type StatusJson = {
    id: string;
    title?: string;
    status?: string;
    created?: string;
    updated?: string;
    branch?: string;
    base_branch?: string;
    task_size?: TaskSize;
    delicate?: boolean;
    human_spec_gate?: boolean;
    worktree?: boolean;
    phases: Partial<Record<Phase, PhaseEntry>>;
    escalations?: Escalation[];
    sessions?: {
        claude_spec?: string | null;
        claude_review?: string | null;
        /** @deprecated use claude_spec or claude_review */
        claude?: string | null;
        codex?: string | null;
    };
};

export type CliArgs = {
    taskIds: string[];
    interactive: boolean;
    step: boolean;
    expectPhase: string | null;
    push: boolean;
    pr: boolean;
    reroute: boolean;
    ship: boolean;
    dryRun: boolean;
};

export type TaskContext = {
    taskId: string;
    title: string;
    specReviewVerdict: Verdict;
    iterations: number;
    iterations_current_loop: number;
    iterations_total: number;
    runtimeIterations: number;
    runtimeIterations_current_loop: number;
    runtimeIterations_total: number;
    rerouteCount: number;
    status: StatusJson;
};

export type PipelineState = {
    tasks: TaskContext[];
    tier: PipelineTier;
    isBundle: boolean;
};

export type CommandResult = {
    ok: boolean;
    stdout: string;
    stderr: string;
};

export type MetricEntry = {
    taskId: string;
    phase: string;
    agent: 'claude' | 'codex';
    model: string;
    iteration?: number;
    durationMs: number;
    status: 'ok' | 'failed';
    tokens?: number;
};

export type ImplementMode = 'fresh' | 'revision' | 'reroute' | 'resume';

export type SessionSlot = 'claude_spec' | 'claude_review' | 'codex';

export type ClaudeRunResult = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError: Error | null;
    stalled: boolean;
    capturedStdout: string;
    capturedStderr: string;
    sessionId: string | null;
    processedText: string;
};

export type CodexRunResult = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError: Error | null;
    stalled: boolean;
    capturedStdout: string;
    capturedStderr: string;
    sessionId: string | null;
};

export type PhaseRunResult = {
    agent: 'claude' | 'codex';
    sessionId: string | null;
    exitCode: number | null;
} | null;

export type StreamResult = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    spawnError: Error | null;
    stalled: boolean;
    capturedStdout: string;
    capturedStderr: string;
};

export type PhaseHandlerResult = {
    claudeResult?: ClaudeRunResult;
    codexResult?: CodexRunResult;
};

export type {
    ClaudeModelConfig,
    ClaudePhase,
    CodexModelConfig,
    CodexPhase,
    PipelineTier,
    PolicyConfig,
    PolicyInput,
    TaskSize,
};
