// Pure pipeline routing policy: given a set of tasks + a resolved config,
// returns the tier, sizing, model/effort, and loop-cap decisions the
// orchestrator uses. Extracted from run-task.ts so it can be tested
// table-driven in isolation, and so drift between the several size/tier
// checks has one place to live.
//
// This file has no side effects: it reads only what is passed in. Env-var
// resolution + legacy-shim warnings stay in run-task.ts.

export type TaskSize = 'S' | 'M' | 'L' | 'XL';
export type PipelineTier = 'fast' | 'full';
export type CodexPhase = 'spec_review' | 'implement';
export type ClaudePhase = 'spec' | 'plan' | 'code_review' | 'qa';
export type CodexModelConfig = { model: string; effort: string };

// Minimal shape the policy needs. StatusJson and TaskContext.status both
// satisfy this — callers don't have to reshape their data.
export type PolicyInput = {
    task_size?: TaskSize;
    delicate?: boolean;
};

// Config values the policy consumes. Run-task.ts resolves these from env
// vars (with legacy fallbacks) and passes the resolved struct in.
export type PolicyConfig = {
    claudeModelSpec: string;
    claudeModelPlan: string;
    claudeModelReview: string;
    claudeModelQa: string;
    codexModelMini: string;
    codexModelFull: string;
    // null → use size-aware default (2 for S/M, 3 for L/XL). A number here
    // (from MAX_REVIEW_LOOPS env var) applies uniformly across all sizes.
    maxReviewLoops: number | null;
};

export type ClaudeModelConfig = { model: string; effort: string };

export type PipelinePolicy = {
    tier: PipelineTier;
    // Highest scope in the bundle, ignoring `delicate`. Drives loop caps —
    // scope complexity sets how many review rounds make sense before an
    // auto-block.
    nominalSize: TaskSize;
    // Nominal size with `delicate` promoting to XL. Drives model/effort —
    // any auth/Pro/storage-sensitive task gets the full model at xhigh.
    effectiveSize: TaskSize;
    // True when the whole bundle runs the fast tier (S, non-delicate): spec
    // and plan collapse into one Claude session.
    planCombined: boolean;
    maxReviewLoops: number;
    codex: (phase: CodexPhase) => CodexModelConfig;
    claude: (phase: ClaudePhase) => ClaudeModelConfig;
};

const SIZE_ORDER: readonly TaskSize[] = ['S', 'M', 'L', 'XL'];

function maxSize(tasks: readonly PolicyInput[]): TaskSize {
    let max: TaskSize = 'S';
    for (const t of tasks) {
        const size = t.task_size ?? 'M';
        if (SIZE_ORDER.indexOf(size) > SIZE_ORDER.indexOf(max)) max = size;
    }
    return max;
}

function anyDelicate(tasks: readonly PolicyInput[]): boolean {
    return tasks.some(t => t.delicate ?? false);
}

// Fast tier: S only, non-delicate. Full tier: anything else — any M/L/XL,
// or any delicate task regardless of nominal size.
export function detectTier(tasks: readonly PolicyInput[]): PipelineTier {
    return tasks.some(t => (t.task_size ?? 'M') !== 'S' || (t.delicate ?? false))
        ? 'full'
        : 'fast';
}

// Per-task answer to "does this task skip a separate plan phase?". True
// only for S non-delicate — the fast-tier invariant. Exposed for callers
// that don't build a full policy (e.g. per-task loops inside the pipeline).
export function isPlanCombined(task: PolicyInput): boolean {
    return task.task_size === 'S' && !(task.delicate ?? false);
}

export function getNominalSize(tasks: readonly PolicyInput[]): TaskSize {
    return maxSize(tasks);
}

export function getEffectiveSize(tasks: readonly PolicyInput[]): TaskSize {
    if (anyDelicate(tasks)) return 'XL';
    return maxSize(tasks);
}

// Per-size review-loop cap. Defaults bumped 2026-04-30 after a quality-log
// review showed M+ tasks routinely needed 3-6 spec_review cycles for
// legitimate convergence (one L-tier task hit 15+; an M-tier task hit 6+2
// escalations; another hit 4+2). The old caps (2 for S/M, 3 for L/XL) were
// auto-blocking real spec convergence and forcing manual MAX_REVIEW_LOOPS
// overrides. New floor: 3 for S/M (S rarely hits even 1; defensive cushion),
// 5 for L/XL (matches the manual-override sweet spot). Env override
// (PolicyConfig.maxReviewLoops) wins if non-null.
export function defaultMaxReviewLoops(nominalSize: TaskSize): number {
    return nominalSize === 'S' || nominalSize === 'M' ? 3 : 5;
}

function codexMatrix(config: PolicyConfig): Record<CodexPhase, Record<TaskSize, CodexModelConfig>> {
    // Rows: phase × effective size.
    //
    //   spec_review: read-heavy, structured output → mini handles up through
    //                L; effort scales with size. XL/delicate needs full-model
    //                shape-checking because that's where expensive mistakes lurk.
    //   implement:   mini through L. S gets medium effort (token savings on
    //                trivial changes). XL/delicate: full model at xhigh.
    //
    // The `S` row under spec_review is unused in practice (S fast tier skips
    // Codex spec review entirely) but kept for completeness and testability.
    return {
        spec_review: {
            S:  { model: config.codexModelMini, effort: 'medium' },
            M:  { model: config.codexModelMini, effort: 'medium' },
            L:  { model: config.codexModelMini, effort: 'high' },
            XL: { model: config.codexModelFull, effort: 'high' },
        },
        implement: {
            S:  { model: config.codexModelMini, effort: 'medium' },
            M:  { model: config.codexModelMini, effort: 'high' },
            L:  { model: config.codexModelMini, effort: 'high' },
            XL: { model: config.codexModelFull, effort: 'xhigh' },
        },
    };
}

function claudeModelFor(config: PolicyConfig, phase: ClaudePhase): string {
    switch (phase) {
        case 'spec': return config.claudeModelSpec;
        case 'plan': return config.claudeModelPlan;
        case 'code_review': return config.claudeModelReview;
        case 'qa': return config.claudeModelQa;
        // spec_review, implement, human_review aren't Claude phases; fall back
        // to the spec model so resumed Claude sessions survive accidental use.
        default: return config.claudeModelSpec;
    }
}

function claudeMatrix(config: PolicyConfig): Record<ClaudePhase, Record<TaskSize, ClaudeModelConfig>> {
    const buildHigh = (phase: ClaudePhase, xlEffort = 'xhigh'): Record<TaskSize, ClaudeModelConfig> => {
        const model = claudeModelFor(config, phase);
        return {
            S:  { model, effort: 'medium' },
            M:  { model, effort: 'high' },
            L:  { model, effort: 'high' },
            XL: { model, effort: xlEffort },
        };
    };
    const buildMedium = (phase: ClaudePhase): Record<TaskSize, ClaudeModelConfig> => {
        const model = claudeModelFor(config, phase);
        return {
            S:  { model, effort: 'medium' },
            M:  { model, effort: 'medium' },
            L:  { model, effort: 'high' },
            XL: { model, effort: 'high' },
        };
    };
    return {
        spec:        buildHigh('spec'),
        plan:        buildHigh('plan', 'high'),  // sonnet doesn't support xhigh
        code_review: buildHigh('code_review'),
        qa:          buildMedium('qa'),
    };
}

export function getPipelinePolicy(
    tasks: readonly PolicyInput[],
    config: PolicyConfig,
): PipelinePolicy {
    const tier = detectTier(tasks);
    const nominalSize = getNominalSize(tasks);
    const effectiveSize = getEffectiveSize(tasks);
    const matrix = codexMatrix(config);
    const claudeMat = claudeMatrix(config);
    const maxReviewLoops = config.maxReviewLoops ?? defaultMaxReviewLoops(nominalSize);
    return {
        tier,
        nominalSize,
        effectiveSize,
        planCombined: tier === 'fast',
        maxReviewLoops,
        codex: (phase) => matrix[phase][effectiveSize],
        claude: (phase) => claudeMat[phase][effectiveSize],
    };
}
