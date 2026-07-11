// Pure pipeline routing policy: given a set of tasks + a resolved config,
// returns the tier, sizing, model/effort, and loop-cap decisions the
// orchestrator uses. Extracted from run-task.ts so it can be tested
// table-driven in isolation, and so drift between the several size/tier
// checks has one place to live.
//
// This file has no side effects: it reads only what is passed in. Env-var
// resolution + legacy-shim warnings stay in run-task.ts.

export type TaskSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type PipelineTier = 'fast' | 'full';
export type CodexPhase = 'spec_review' | 'implement';
export type ClaudePhase = 'spec' | 'plan' | 'code_review' | 'qa';
export type CodexModelConfig = { model: string; effort: string };
type ClaudeMatrixConfig = { model: string; effort: string };

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
    // Code-review model for XL/delicate only (re-baselined 2026-06; was
    // L/XL/delicate). History: on Sonnet 4.5, Sonnet-at-xhigh missed
    // lifecycle/state-machine bugs Codex CLI review caught at PR open
    // (buffer-arming-on-failure class, project-switch flushes, etc.), so L+
    // ran Opus. Sonnet 4.6 closed that long-horizon gap (matches the prior
    // Opus flagship on long-horizon coding per vendor + practitioner eval), so
    // L review returned to Sonnet. Opus is now reserved for XL/delicate, where
    // the subtlest cross-file bugs and the highest blast radius remain worth
    // the cost.
    claudeModelReviewLarge: string;
    claudeModelQa: string;
    codexModelMini: string;
    codexModelFull: string;
    // null → use size-aware default (3 for XS/S/M, 5 for L/XL). A number here
    // (from MAX_REVIEW_LOOPS env var) applies uniformly across all sizes.
    maxReviewLoops: number | null;
    claudeBudget: string | null;
};

export type ClaudeModelConfig = { model: string; effort: string; budget: string };

export type PipelinePolicy = {
    tier: PipelineTier;
    // Highest scope in the bundle, ignoring `delicate`. Drives loop caps —
    // scope complexity sets how many review rounds make sense before an
    // auto-block.
    nominalSize: TaskSize;
    // Nominal size with `delicate` promoting to XL. Drives model/effort —
    // any auth/Pro/storage-sensitive task gets the full model at xhigh.
    effectiveSize: TaskSize;
    // True when the whole bundle runs the fast tier (XS, non-delicate): spec
    // and plan collapse into one Claude session.
    planCombined: boolean;
    maxReviewLoops: number;
    codex: (phase: CodexPhase) => CodexModelConfig;
    claude: (phase: ClaudePhase) => ClaudeModelConfig;
};

const SIZE_ORDER: readonly TaskSize[] = ['XS', 'S', 'M', 'L', 'XL'];
const SINGLE_PASS_BUDGET_BY_SIZE: Record<TaskSize, string> = {
    XS: '5.00',
    S: '5.00',
    M: '10.00',
    L: '10.00',
    XL: '20.00',
};
const CODE_REVIEW_BUDGET_BY_SIZE: Record<TaskSize, string> = {
    XS: '5.00',
    S: '10.00',
    M: '15.00',
    L: '20.00',
    XL: '40.00',
};
const BUDGET_BY_PHASE_AND_SIZE: Record<ClaudePhase, Record<TaskSize, string>> = {
    spec: SINGLE_PASS_BUDGET_BY_SIZE,
    plan: SINGLE_PASS_BUDGET_BY_SIZE,
    code_review: CODE_REVIEW_BUDGET_BY_SIZE,
    qa: SINGLE_PASS_BUDGET_BY_SIZE,
};

function maxSize(tasks: readonly PolicyInput[]): TaskSize {
    let max: TaskSize = 'XS';
    for (const t of tasks) {
        const size = t.task_size ?? 'M';
        if (SIZE_ORDER.indexOf(size) > SIZE_ORDER.indexOf(max)) max = size;
    }
    return max;
}

function anyDelicate(tasks: readonly PolicyInput[]): boolean {
    return tasks.some(t => t.delicate ?? false);
}

function resolveBudget(phase: ClaudePhase, effectiveSize: TaskSize, claudeBudget: string | null): string {
    return claudeBudget ?? BUDGET_BY_PHASE_AND_SIZE[phase][effectiveSize];
}

// Fast tier: XS only, non-delicate. Full tier: anything else — any S/M/L/XL,
// or any delicate task regardless of nominal size.
export function detectTier(tasks: readonly PolicyInput[]): PipelineTier {
    return tasks.some(t => (t.task_size ?? 'M') !== 'XS' || (t.delicate ?? false))
        ? 'full'
        : 'fast';
}

// Per-task answer to "does this task skip a separate plan phase?". True
// only for XS non-delicate — the fast-tier invariant. Exposed for callers
// that don't build a full policy (e.g. per-task loops inside the pipeline).
export function isPlanCombined(task: PolicyInput): boolean {
    return task.task_size === 'XS' && !(task.delicate ?? false);
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
// overrides. New floor: 3 for XS/S/M (XS/S rarely hit even 1; defensive
// cushion), 5 for L/XL (matches the manual-override sweet spot). Env override
// (PolicyConfig.maxReviewLoops) wins if non-null.
export function defaultMaxReviewLoops(nominalSize: TaskSize): number {
    return nominalSize === 'XS' || nominalSize === 'S' || nominalSize === 'M' ? 3 : 5;
}

function codexMatrix(config: PolicyConfig): Record<CodexPhase, Record<TaskSize, CodexModelConfig>> {
    // Rows: phase × effective size.
    //
    //   spec_review: read-heavy, structured output → mini handles up through
    //                L; effort scales with size. XL/delicate needs full-model
    //                shape-checking because that's where expensive mistakes lurk.
    //                M and L both run at high (M raised from medium 2026-07):
    //                task-history analysis across canon-ai and galleryplanner
    //                showed M's iteration overhead was concentrated almost
    //                entirely in reroute severity, not implement-quality —
    //                non-rerouted tasks were flat across M/L (~1.0-1.4 rounds),
    //                but M's rerouted tasks averaged worse than L's (5.15 vs
    //                4.83). M's lighter spec_review effort is the leading
    //                hypothesis (not a proven sole cause — see decisions.md).
    //   implement:   mini through L. XS/S get medium effort (token savings on
    //                the smallest changes). XL/delicate: full model at high. Not
    //                xhigh — GPT-5.5 tends to overthink at xhigh with open-ended
    //                tool access (cost without quality gain), and canon's thesis
    //                is token discipline over reflexive max-effort. Raise via
    //                env only if eval shows under-reasoning on delicate work.
    //
    // The `XS` row under spec_review is unused in practice (XS fast tier skips
    // Codex spec review entirely) but kept for completeness and testability.
    // The `S` row is active — S is full tier and runs spec_review.
    return {
        spec_review: {
            XS: { model: config.codexModelMini, effort: 'medium' },
            S:  { model: config.codexModelMini, effort: 'medium' },
            M:  { model: config.codexModelMini, effort: 'high' },
            L:  { model: config.codexModelMini, effort: 'high' },
            XL: { model: config.codexModelFull, effort: 'high' },
        },
        implement: {
            XS: { model: config.codexModelMini, effort: 'medium' },
            S:  { model: config.codexModelMini, effort: 'medium' },
            M:  { model: config.codexModelMini, effort: 'high' },
            L:  { model: config.codexModelMini, effort: 'high' },
            XL: { model: config.codexModelFull, effort: 'high' },
        },
    };
}

function claudeModelFor(config: PolicyConfig, phase: ClaudePhase): string {
    switch (phase) {
        case 'spec': return config.claudeModelSpec;
        case 'plan': return config.claudeModelPlan;
        case 'qa': return config.claudeModelQa;
        // code_review is size-keyed (see codeReviewMatrix in claudeMatrix); not
        // resolved through this helper. spec_review, implement, human_review
        // aren't Claude phases; fall back to the spec model so resumed Claude
        // sessions survive accidental use.
        default: return config.claudeModelSpec;
    }
}

function claudeMatrix(config: PolicyConfig): Record<ClaudePhase, Record<TaskSize, ClaudeMatrixConfig>> {
    const buildHigh = (phase: ClaudePhase, xlEffort = 'xhigh'): Record<TaskSize, ClaudeMatrixConfig> => {
        const model = claudeModelFor(config, phase);
        return {
            XS: { model, effort: 'medium' },
            S:  { model, effort: 'medium' },
            M:  { model, effort: 'high' },
            L:  { model, effort: 'high' },
            XL: { model, effort: xlEffort },
        };
    };
    const buildMedium = (phase: ClaudePhase): Record<TaskSize, ClaudeMatrixConfig> => {
        const model = claudeModelFor(config, phase);
        return {
            XS: { model, effort: 'medium' },
            S:  { model, effort: 'medium' },
            M:  { model, effort: 'medium' },
            L:  { model, effort: 'high' },
            XL: { model, effort: 'high' },
        };
    };
    // code_review splits model by size: Sonnet (claudeModelReview) handles
    // XS/S/M/L; Opus (claudeModelReviewLarge) is reserved for XL/delicate.
    // Re-baselined 2026-06 for the Sonnet 4.6 generation — Sonnet 4.6 matches
    // the prior Opus flagship on long-horizon / lifecycle / state-machine bug
    // detection (the class that forced the earlier L→Opus bump on Sonnet 4.5),
    // so L review drops back to Sonnet. XL/delicate stays on Opus, where the
    // most subtle cross-file bugs and the highest blast radius live. Delicate
    // promotes to XL effective size, so it picks up Opus automatically.
    const codeReviewMatrix = (): Record<TaskSize, ClaudeMatrixConfig> => ({
        XS: { model: config.claudeModelReview,      effort: 'medium' },
        S:  { model: config.claudeModelReview,      effort: 'medium' },
        M:  { model: config.claudeModelReview,      effort: 'high' },
        L:  { model: config.claudeModelReview,      effort: 'high' },
        XL: { model: config.claudeModelReviewLarge, effort: 'xhigh' },
    });
    return {
        spec:        buildHigh('spec'),
        plan:        buildHigh('plan', 'high'),  // sonnet doesn't support xhigh
        code_review: codeReviewMatrix(),
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
        claude: (phase) => ({
            ...claudeMat[phase][effectiveSize],
            budget: resolveBudget(phase, effectiveSize, config.claudeBudget),
        }),
    };
}
