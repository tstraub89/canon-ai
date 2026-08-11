import {
    detectTier as policyDetectTier,
    getPipelinePolicy,
    isPlanCombined as policyIsPlanCombined,
    type ClaudeModelConfig,
    type ClaudePhase,
    type CodexModelConfig,
    type CodexPhase,
    type PipelineTier,
    type PolicyConfig,
    type PolicyInput,
    type TaskSize,
} from '../lib/pipeline-policy.js';

import type { StatusJson, TaskContext } from './types.js';
import { parseMaxReviewLoops } from './env.js';

const config = {
    claudeModelSpec: process.env.CLAUDE_MODEL_SPEC ?? process.env.CLAUDE_MODEL ?? 'opus',
    claudeModelPlan: process.env.CLAUDE_MODEL_PLAN ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeModelReview: process.env.CLAUDE_MODEL_REVIEW ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    claudeModelReviewLarge: process.env.CLAUDE_MODEL_REVIEW_LARGE ?? process.env.CLAUDE_MODEL ?? 'opus',
    claudeModelQa: process.env.CLAUDE_MODEL_QA ?? process.env.CLAUDE_MODEL ?? 'sonnet',
    codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-5.6-luna',
    codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-5.6-sol',
    maxReviewLoops: parseMaxReviewLoops(process.env.MAX_REVIEW_LOOPS),
    claudeBudget: process.env.CLAUDE_BUDGET ?? null,
};

export function policyConfig(): PolicyConfig {
    return {
        claudeModelSpec: config.claudeModelSpec,
        claudeModelPlan: config.claudeModelPlan,
        claudeModelReview: config.claudeModelReview,
        claudeModelReviewLarge: config.claudeModelReviewLarge,
        claudeModelQa: config.claudeModelQa,
        codexModelMini: config.codexModelMini,
        codexModelFull: config.codexModelFull,
        maxReviewLoops: config.maxReviewLoops,
        claudeBudget: config.claudeBudget,
    };
}

export function toPolicyInputs(tasks: readonly TaskContext[]): PolicyInput[] {
    return tasks.map(t => ({ task_size: t.status.task_size, delicate: t.status.delicate }));
}

export function getClaudeConfig(phase: ClaudePhase, tasks: readonly TaskContext[]): ClaudeModelConfig {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).claude(phase);
}

export function getCodexConfig(phase: CodexPhase, tasks: readonly TaskContext[]): CodexModelConfig {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).codex(phase);
}

export function getNominalSize(tasks: readonly TaskContext[]): TaskSize {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).nominalSize;
}

export function getEffectiveSize(tasks: readonly TaskContext[]): TaskSize {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).effectiveSize;
}

export function getMaxReviewLoops(tasks: readonly TaskContext[]): number {
    return getPipelinePolicy(toPolicyInputs(tasks), policyConfig()).maxReviewLoops;
}

export function detectTier(statuses: readonly StatusJson[]): PipelineTier {
    return policyDetectTier(statuses.map(s => ({ task_size: s.task_size, delicate: s.delicate })));
}

export function isPlanCombined(status: StatusJson): boolean {
    return policyIsPlanCombined({ task_size: status.task_size, delicate: status.delicate });
}

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
