import fs from 'node:fs';
import path from 'node:path';

import { warn } from './cli.js';
import { REPO_ROOT } from './env.js';
import type { MetricEntry } from './types.js';

export const METRICS_SKELETON = [
    '# Workflow Metrics',
    '',
    '> Auto-logged by canon\'s orchestrator. One row per agent invocation.',
    '> Tokens: per-invocation total (input + cache + output). Parsed from the agent\'s structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.',
    '> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent\'s own cumulative usage and are separate from (not included in) the session row.',
    '',
    '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |',
    '|---|---|---|---|---|---|---|---|---|',
    '',
].join('\n');

export function getMetricsFile(taskLabel: string, activeCwd?: string): string {
    return process.env.CANON_METRICS_FILE_OVERRIDE
        ? path.resolve(process.env.CANON_METRICS_FILE_OVERRIDE)
        : path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? path.join(activeCwd ?? REPO_ROOT, 'tasks'),
            taskLabel.split('+')[0], 'metrics.md');
}

export function getSharedMetricsFile(repoRoot: string): string {
    return path.join(repoRoot, 'docs/pipeline-invocations.md');
}

export function recordMetric(entry: MetricEntry): void {
    try {
        if (!process.env.CANON_METRICS_FILE_OVERRIDE && !entry.taskId.split('+')[0]) {
            throw new Error('empty task label');
        }
        const metricsFile = getMetricsFile(entry.taskId, entry.activeCwd);
        if (!process.env.CANON_METRICS_FILE_OVERRIDE) fs.mkdirSync(path.dirname(metricsFile), { recursive: true });
        if (!fs.existsSync(metricsFile)) fs.writeFileSync(metricsFile, METRICS_SKELETON);
        const safeCell = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
        const dur = (entry.durationMs / 1000).toFixed(1) + 's';
        const tok = entry.tokens != null ? String(entry.tokens) : '-';
        fs.appendFileSync(
            metricsFile,
            `| ${new Date().toISOString()} | ${entry.taskId} | ${entry.phase} | ${safeCell(entry.agent)} | ${safeCell(entry.model)} | ${entry.iteration ?? '-'} | ${dur} | ${tok} | ${entry.status} |\n`
        );
    } catch (error) {
        warn(`metrics: could not record ${entry.phase} row for '${entry.taskId}': ${error instanceof Error ? error.message : String(error)}`);
    }
}
