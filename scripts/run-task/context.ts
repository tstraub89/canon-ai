import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, config } from './env.js';
import { getEffectiveSize, getNominalSize } from './policy.js';
import { taskDirFor } from './state.js';
import type { ImplementMode, PipelineState } from './types.js';

export function extractAffectedFiles(taskId: string): string[] {
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const match = content.match(/### Affected Files\n\n\|[^\n]+\|\n\|[^\n]+\|\n((?:\|[^\n]+\|\n?)*)/);
        if (!match) return [];
        return match[1]
            .split('\n')
            .filter(l => l.startsWith('|'))
            .map(row => row.match(/\|\s*`([^`]+)`/)?.[1])
            .filter((f): f is string => !!f);
    } catch {
        return [];
    }
}

export function buildContextBlock(taskIds: string[]): string {
    const allFiles = new Map<string, string>();
    for (const taskId of taskIds) {
        for (const file of extractAffectedFiles(taskId)) {
            if (allFiles.has(file)) continue;
            const filePath = path.join(REPO_ROOT, file);
            try {
                allFiles.set(file, fs.readFileSync(filePath, 'utf8'));
            } catch {
                // File may be new (not yet created) — skip silently
            }
        }
    }
    if (allFiles.size === 0) return '';

    let totalBytes = 0;
    for (const content of allFiles.values()) totalBytes += content.length;

    if (totalBytes > config.maxContextBytes) {
        const list = [...allFiles.keys()].map(f => `  - ${f}`).join('\n');
        return `\n## Relevant Files (too large to pre-load — read these manually)\n\n${list}\n`;
    }

    let block = '\n## Relevant Files (pre-loaded from spec Affected Files)\n\n';
    for (const [file, content] of allFiles.entries()) {
        const ext = path.extname(file).slice(1) || 'text';
        block += `### \`${file}\`\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
    }
    return block;
}

export function buildKnownPitfalls(): string {
    const patternsPath = process.env.CANON_PATTERNS_MD_PATH ?? path.join(REPO_ROOT, 'docs/patterns.md');
    try {
        const content = fs.readFileSync(patternsPath, 'utf8');
        const match = content.match(/## Known Pitfalls\n\n([\s\S]*?)(?:\n## |\n---|\n# |$)/);
        if (!match) return '';
        return `\n## Known Codebase Pitfalls (from docs/patterns.md — read before touching these areas)\n\n${match[1].trimEnd()}\n\n`;
    } catch {
        return '';
    }
}

export function buildKnownRisks(taskIds: string[]): string {
    const riskBlocks = taskIds.map(taskId => {
        const specPath = path.join(taskDirFor(taskId), 'spec.md');
        try {
            const content = fs.readFileSync(specPath, 'utf8');
            const match = content.match(/## Known Risks\n\n([\s\S]*?)(?:\n## |\n# |$)/);
            if (!match) return '';
            const risks = match[1].trim();
            if (!risks || /^n\/?a$/i.test(risks) || /^none$/i.test(risks)) return '';
            return taskIds.length > 1
                ? `**\`${taskId}\` Known Risks:**\n${risks}`
                : risks;
        } catch {
            return '';
        }
    }).filter(Boolean);

    if (riskBlocks.length === 0) return '';
    return `\n## Known Risks (from spec — read before writing any code)\n\n${riskBlocks.join('\n\n')}\n\n`;
}

export function summarizePreloadStatus(taskIds: string[]): string {
    const files = new Map<string, number>();
    for (const taskId of taskIds) {
        for (const file of extractAffectedFiles(taskId)) {
            if (files.has(file)) continue;
            const filePath = path.join(REPO_ROOT, file);
            try {
                files.set(file, fs.statSync(filePath).size);
            } catch {
                files.set(file, 0);
            }
        }
    }
    if (files.size === 0) return 'none (spec has no Affected Files table)';
    const totalBytes = [...files.values()].reduce((sum, n) => sum + n, 0);
    const kb = (totalBytes / 1024).toFixed(1);
    if (totalBytes > config.maxContextBytes) {
        return `${files.size} file(s) listed (${kb} KB) — too large to pre-load, read them manually`;
    }
    return `${files.size} file(s) pre-loaded inline (${kb} KB)`;
}

export function extractValidationChecks(taskId: string): string[] {
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
        if (!section) return [];
        const checks: string[] = [];
        for (const line of section[1].split('\n')) {
            const match = line.match(/^-\s+\[[ x]\]\s+`?([^`]+?)`?\s*(?:\(|$)/i);
            if (match?.[1]) checks.push(match[1].trim());
        }
        return checks;
    } catch {
        return [];
    }
}

export function extractAcSummary(taskId: string): string[] {
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const lines: string[] = [];
        for (const line of content.split('\n')) {
            const match = line.match(/^-\s+\[[ x]\]\s+(AC-[\w.-]+):\s+(.+)$/);
            if (match) lines.push(`- ${match[1]}: ${match[2].trim()}`);
        }
        return lines;
    } catch {
        return [];
    }
}

export function buildImplementStateHeader(state: PipelineState, mode: ImplementMode): string {
    const { tasks, tier, isBundle } = state;
    const taskIds = tasks.map(t => t.taskId);
    const primary = tasks[0];

    const maxCodeReviewIter = tasks.reduce((max, task) => Math.max(max, task.iterations), 0);
    const maxRuntimeIter = tasks.reduce((max, task) => Math.max(max, task.runtimeIterations), 0);
    const revisionExplain = maxCodeReviewIter > 0 && maxRuntimeIter > 0
        ? `addressing code-review feedback (iteration ${maxCodeReviewIter + 1}) and runtime validation failures — read tasks/<id>/review.md and the runtime failure section below`
        : maxCodeReviewIter > 0
            ? `addressing code-review feedback (iteration ${maxCodeReviewIter + 1}) — read tasks/<id>/review.md`
            : `addressing runtime validation failures (iteration ${maxRuntimeIter + 1}) — read the runtime failure section below`;
    const modeExplain: Record<ImplementMode, string> = {
        fresh: 'first implementation pass — no prior work on this phase',
        revision: revisionExplain,
        reroute: `spec was amended after human_review (reroute #${primary.rerouteCount}) — re-read spec.md for new sections`,
        resume: 'previous implement pass was interrupted after code changes were made — finish validation + handoff only',
    };

    const sizes = new Set(tasks.map(t => t.status.task_size ?? 'M'));
    const nominalLabel = sizes.size === 1 ? [...sizes][0] : `mixed (${[...sizes].sort().join(',')})`;
    const effective = getEffectiveSize(tasks);
    const nominal = getNominalSize(tasks);
    const sizeLabel = effective !== nominal
        ? `${nominalLabel} (effective: ${effective} via delicate)`
        : nominalLabel;
    const bundleLabel = isBundle ? `${tasks.length}-task bundle` : 'single task';
    const preloadLabel = summarizePreloadStatus(taskIds);

    const allChecks = new Set<string>();
    for (const id of taskIds) for (const c of extractValidationChecks(id)) allChecks.add(c);
    const checksLabel = allChecks.size > 0 ? [...allChecks].join(', ') : 'see each spec\'s Validation Required section';

    const AC_SECTION_CAP = 3000;
    let acSection = '';
    let truncatedLabel = 'no';
    if (mode === 'resume') {
        acSection = '\n## Acceptance Criteria\n\nCode changes are already in place — ensure handoff.md\'s AC coverage table lists every AC in spec.md.\n';
        truncatedLabel = 'n/a (resume — see spec.md + handoff.md)';
    } else {
        const perTaskBlocks = taskIds.map(id => {
            const acs = extractAcSummary(id);
            if (acs.length === 0) return { id, lines: [] as string[] };
            return { id, lines: acs };
        }).filter(b => b.lines.length > 0);

        if (perTaskBlocks.length > 0) {
            let used = 0;
            const renderedBlocks: string[] = [];
            const dropped: Record<string, number> = {};
            for (const block of perTaskBlocks) {
                const header = isBundle ? `**\`${block.id}\`:**\n` : '';
                const kept: string[] = [];
                for (const line of block.lines) {
                    const cost = line.length + 1;
                    if (used + cost > AC_SECTION_CAP) {
                        dropped[block.id] = (dropped[block.id] ?? 0) + 1;
                        continue;
                    }
                    kept.push(line);
                    used += cost;
                }
                if (kept.length > 0) renderedBlocks.push(`${header}${kept.join('\n')}`);
            }
            const droppedEntries = Object.entries(dropped).filter(([, n]) => n > 0);
            const totalDropped = droppedEntries.reduce((sum, [, n]) => sum + n, 0);
            const truncMarker = droppedEntries.length > 0
                ? `\n\n*…${droppedEntries.map(([id, n]) => isBundle ? `${n} more ACs in ${id}` : `${n} more ACs`).join(', ')} — see spec.md for full text*`
                : '';
            acSection = `\n## Acceptance Criteria Summary (binding — full text and verification notes in spec.md)\n\n${renderedBlocks.join('\n\n')}${truncMarker}\n`;
            if (totalDropped > 0) truncatedLabel = `yes — ${totalDropped} AC${totalDropped === 1 ? '' : 's'} elided, fall back to spec.md`;
        }
    }

    return `## Task State\n\n- Phase: **implement**\n- Mode: **${mode}** — ${modeExplain[mode]}\n- Tier / task size: ${tier} / ${sizeLabel}\n- Scope: ${bundleLabel}\n- Relevant files: ${preloadLabel}\n- Required validation: ${checksLabel}\n- ACs truncated: ${truncatedLabel}\n${acSection}`;
}
