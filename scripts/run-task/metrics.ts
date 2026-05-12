import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from './env.js';
import type { MetricEntry } from './types.js';

export const METRICS_FILE = path.join(REPO_ROOT, 'docs/pipeline-invocations.md');

export function recordMetric(entry: MetricEntry): void {
    if (!fs.existsSync(METRICS_FILE)) {
        fs.writeFileSync(METRICS_FILE, [
            '# Workflow Metrics',
            '',
            '> Auto-logged by `scripts/run-task.ts`. One row per agent invocation.',
            '> Tokens: per-invocation total (input + cache + output). Parsed from the agent\'s structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.',
            '',
            '| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |',
            '|---|---|---|---|---|---|---|---|---|',
            '',
        ].join('\n'));
    }
    const safeCell = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const dur = (entry.durationMs / 1000).toFixed(1) + 's';
    const tok = entry.tokens != null ? String(entry.tokens) : '-';
    fs.appendFileSync(
        METRICS_FILE,
        `| ${new Date().toISOString()} | ${entry.taskId} | ${entry.phase} | ${entry.agent} | ${safeCell(entry.model)} | ${entry.iteration ?? '-'} | ${dur} | ${tok} | ${entry.status} |\n`
    );
}
