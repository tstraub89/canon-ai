import { parseProvider, type Provider } from '../lib/pipeline-policy.js';
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
    claudeModelSpecReview: process.env.CLAUDE_MODEL_SPEC_REVIEW ?? null,
    claudeModelImplement: process.env.CLAUDE_MODEL_IMPLEMENT ?? null,
    claudeModelSpec: process.env.CLAUDE_MODEL_SPEC ?? null,
    claudeModelPlan: process.env.CLAUDE_MODEL_PLAN ?? null,
    claudeModelReview: process.env.CLAUDE_MODEL_REVIEW ?? null,
    claudeModelReviewLarge: process.env.CLAUDE_MODEL_REVIEW_LARGE ?? null,
    claudeModelQa: process.env.CLAUDE_MODEL_QA ?? null,
    claudeModelLight: process.env.CLAUDE_MODEL_LIGHT || null,
    claudeModelStrong: process.env.CLAUDE_MODEL_STRONG || null,
    claudeModelLegacy: process.env.CLAUDE_MODEL ?? null,
    codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-6-luna',
    codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-6.1-sol',
    maxReviewLoops: parseMaxReviewLoops(process.env.MAX_REVIEW_LOOPS),
    claudeBudget: process.env.CLAUDE_BUDGET ?? null,
};

export function policyConfig(): PolicyConfig {
    return {
        claudeModelSpecReview: config.claudeModelSpecReview,
        claudeModelImplement: config.claudeModelImplement,
        claudeModelSpec: config.claudeModelSpec,
        claudeModelPlan: config.claudeModelPlan,
        claudeModelReview: config.claudeModelReview,
        claudeModelReviewLarge: config.claudeModelReviewLarge,
        claudeModelQa: config.claudeModelQa,
        claudeModelLight: config.claudeModelLight,
        claudeModelStrong: config.claudeModelStrong,
        claudeModelLegacy: config.claudeModelLegacy,
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

export { roleBackendId, phasePrimaryRole, phaseSessionSlot, requiredAgentBackends } from '../lib/pipeline-policy.js';
export type { AgentRole, AgentBackendId, PipelinePhase, SessionSlot } from '../lib/pipeline-policy.js';

export { parseProvider, roleAssignmentFor, MIXED_ROLE_ASSIGNMENT, providerRunsColdLens } from '../lib/pipeline-policy.js';
export type { Provider, RoleAssignment } from '../lib/pipeline-policy.js';
export const PROVIDER_SETTING_NAME = 'CANON_PROVIDER';
export function resolveProviderSetting(): Provider {
    const value = process.env[PROVIDER_SETTING_NAME];
    return value === undefined || value === '' ? 'mixed' : parseProvider(value);
}
export function resolveTaskProvider(status: StatusJson): Provider {
    try { return status.provider === undefined ? 'mixed' : parseProvider(status.provider); }
    catch (error) { throw new Error(`Task '${status.id}' status.json: ${error instanceof Error ? error.message : String(error)}`); }
}
export function resolveBundleProvider(statuses: readonly StatusJson[]): Provider {
    const providers = statuses.map(status => ({ id: status.id, provider: resolveTaskProvider(status) }));
    if (new Set(providers.map(task => task.provider)).size > 1) {
        throw new Error(`Cannot run a mixed-provider bundle: ${providers.map(task => `${task.id}: ${task.provider}`).join(', ')}.`);
    }
    return providers[0]?.provider ?? 'mixed';
}
