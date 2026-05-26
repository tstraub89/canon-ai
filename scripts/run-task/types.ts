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

export const PHASE_ORDER = ['spec', 'spec_review', 'plan', 'implement', 'code_review', 'qa', 'human_review'] as const;
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
    /**
     * Counts orchestrator-side pre-flight rejections (handoff validation
     * failures that reject without invoking the reviewer) in the current
     * loop. Reset to 0 when a real reviewer round returns approved /
     * approved_with_nits. Watched alongside `iterations_current_loop` by the
     * review-loop auto-block — persistent pre-flight failures must trip the
     * cap so the pipeline can't bounce implement→pre-flight→implement
     * forever. Separate from `iterations_current_loop` because pre-flight
     * rejection isn't a Claude review round — counting it there would skip
     * Stage 1 on the next real review via the round-N prompt path.
     */
    preflight_rejections_current_loop?: number;
    preflight_rejections_total?: number;
    auto_block_count?: number;
    rerouted?: boolean;
    reroute_count?: number;
    /**
     * Set by `canon task accept <id> implement` when an operator has manually
     * committed work outside the pipeline and wants to advance past auto-commit.
     * Causes the post-implement dispatch to skip `autoCommitCode` — but only
     * when the current HEAD still matches `operator_accepted_sha`. If HEAD has
     * moved past the accepted commit, the flag is treated as stale and normal
     * auto-commit validation runs.
     */
    operator_accepted?: boolean;
    /** ISO date the phase was operator-accepted. Diagnostic-only. */
    operator_accepted_at?: string;
    /**
     * HEAD SHA at the time of `canon task accept`. Pairs with `operator_accepted`
     * so a stale flag from a prior accept does not silently bypass auto-commit
     * after later edits land on the task branch.
     */
    operator_accepted_sha?: string;
};

export type Escalation = {
    date: string;
    phase: Phase;
    iteration_count?: number;
    reason: string;
};

export type CanonStamp = {
    upstream_repo: string;
    upstream_commit: string;
    orchestrator_commit: string;
    codex_cli: string;
    claude_code: string;
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
    /**
     * When true: collapses the human_spec_gate interrupt and, after a clean
     * QA pass, auto-runs the PR-creation branch of the human_review flow.
     * Future human-interrupt gates should honor this flag by convention.
     */
    full_send?: boolean;
    worktree?: boolean;
    canon?: CanonStamp;
    phases: Partial<Record<Phase, PhaseEntry>>;
    escalations?: Escalation[];
    sessions?: {
        claude_spec?: string | null;
        claude_review?: string | null;
        /** @deprecated use claude_spec or claude_review */
        claude?: string | null;
        codex?: string | null;
        codex_spec_review?: string | null;
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
    fullSend: boolean;
    force: boolean;
};

export type TaskContext = {
    taskId: string;
    title: string;
    specReviewVerdict: Verdict;
    iterations: number;
    iterations_current_loop: number;
    iterations_total: number;
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
    activeCwd?: string;
};

export type ImplementMode = 'fresh' | 'revision' | 'reroute' | 'resume';

export type SessionSlot = 'claude_spec' | 'claude_review' | 'codex' | 'codex_spec_review';

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
