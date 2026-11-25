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
import { envModel, parseMaxReviewLoops, REPO_ROOT } from './env.js';
import { loadCodexSection, formatUnknownKeysWarning, type CodexSectionConfig } from './docs-freshness.js';
import { die, warn } from './cli.js';

const config = {
    claudeModelSpecReview: envModel('CLAUDE_MODEL_SPEC_REVIEW'),
    claudeModelImplement: envModel('CLAUDE_MODEL_IMPLEMENT'),
    claudeModelSpec: envModel('CLAUDE_MODEL_SPEC'),
    claudeModelPlan: envModel('CLAUDE_MODEL_PLAN'),
    claudeModelReview: envModel('CLAUDE_MODEL_REVIEW'),
    claudeModelReviewLarge: envModel('CLAUDE_MODEL_REVIEW_LARGE'),
    claudeModelQa: envModel('CLAUDE_MODEL_QA'),
    claudeModelLight: envModel('CLAUDE_MODEL_LIGHT'),
    claudeModelStrong: envModel('CLAUDE_MODEL_STRONG'),
    claudeModelLegacy: envModel('CLAUDE_MODEL'),
    codexModelMini: envModel('CODEX_MODEL_MINI') ?? envModel('CODEX_MODEL_DEFAULT'),
    codexModelFull: envModel('CODEX_MODEL_FULL') ?? envModel('CODEX_MODEL_DELICATE'),
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
        codexModelMini: config.codexModelMini ?? 'gpt-6-luna',
        codexModelFull: config.codexModelFull ?? 'gpt-6.2-sol',
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

let warnedCodexKeys = false;
export function requireCodexSection(root = REPO_ROOT): CodexSectionConfig {
    const loaded = loadCodexSection(root);
    if (!loaded.ok) die(loaded.message);
    if (loaded.unknownKeys.length && !warnedCodexKeys) {
        warn(formatUnknownKeysWarning(loaded.unknownKeys));
        warnedCodexKeys = true;
    }
    return loaded.section;
}
export function getCodexConfig(phase: CodexPhase, tasks: readonly TaskContext[], root = REPO_ROOT): CodexModelConfig {
    const section = requireCodexSection(root);
    return getPipelinePolicy(toPolicyInputs(tasks), {
        ...policyConfig(),
        codexModelMini: config.codexModelMini ?? section.models.mini ?? 'gpt-6-luna',
        codexModelFull: config.codexModelFull ?? section.models.full ?? 'gpt-6.2-sol',
        codexImplementEffort: section.implementEffort,
    }).codex(phase);
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
