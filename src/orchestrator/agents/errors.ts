// Non-interactive session failures propagate to main's durable park boundary.
// Phase runners must not catch these: partial output is not a completed phase.
export class AgentSessionError extends Error {
    readonly agent: 'claude' | 'codex';
    readonly kind: 'spawn_error' | 'stalled' | 'signal' | 'exit_code';
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly reason: string;
    readonly sessionId: string | null;

    constructor(options: {
        sessionId?: string | null;
        agent: AgentSessionError['agent'];
        kind: AgentSessionError['kind'];
        reason: string;
        exitCode?: number | null;
        signal?: NodeJS.Signals | null;
    }) {
        super(options.reason);
        this.name = 'AgentSessionError';
        this.agent = options.agent;
        this.kind = options.kind;
        this.reason = options.reason;
        this.sessionId = options.sessionId ?? null;
        this.exitCode = options.exitCode ?? null;
        this.signal = options.signal ?? null;
    }
}

export function isAgentSessionError(error: unknown): error is AgentSessionError {
    return error instanceof AgentSessionError;
}
