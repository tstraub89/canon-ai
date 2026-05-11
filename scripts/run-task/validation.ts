import fs from 'node:fs';
import path from 'node:path';

import { parseTable, parseTableH3, extractSectionBodies } from './markdown-table.js';
import { PIPELINE_TELEMETRY_FILES, getActiveCwd } from './worktree.js';
import { gitSafeAtRaw, parsePorcelainEntries } from './git.js';
import { taskDirFor } from './state.js';
import type { Phase, Verdict } from './types.js';

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function checkAcCoveragePlaceholders(handoffContent: string): string[] {
    if (!handoffContent.split('\n').some(line => line.trimEnd() === '## AC Coverage')) {
        return ['AC Coverage section is missing'];
    }

    const rows = parseTable(handoffContent, 'AC Coverage');
    if (rows.length === 0) return ['AC Coverage table is missing or contains no AC rows'];

    const hasAcRow = rows.some(row => /AC-\d+/i.test(Object.values(row)[0] ?? ''));
    if (!hasAcRow) return ['AC Coverage table is missing or contains no AC rows'];

    const PLACEHOLDER = 'Met / Partial / Not met';
    const allPlaceholder = rows.every(row => (row['Status'] ?? '') === PLACEHOLDER);

    if (allPlaceholder) {
        return ['AC Coverage table only contains template placeholder rows (Status "Met / Partial / Not met") — fill in actual AC statuses'];
    }
    return [];
}

// Compute the *current* result for each named validation check in a cumulative
// handoff. Starts with the original `## Validation Outcomes` table, then walks
// `## Iteration N` sections in order, overriding per check name with any rows
// found in the iteration's `### Re-run validation` h3 subsection. The result
// is the latest-recorded outcome per check.
export function computeLatestValidationResults(handoffContent: string): Map<string, ValidationOutcomeRow> {
    const latest = new Map<string, ValidationOutcomeRow>();
    const baseline = parseTable(handoffContent, 'Validation Outcomes');
    for (const row of baseline) {
        const check = (row['Check'] ?? '').trim();
        if (!check) continue;
        latest.set(canonicalizeValidationCheck(check), {
            check,
            result: row['Result'] ?? '',
            notes: row['Notes'] ?? '',
        });
    }

    const iterationBodies = extractSectionBodies(handoffContent, /^## Iteration\b/);
    for (const body of iterationBodies) {
        const reruns = parseTableH3(body, 'Re-run validation (only checks that re-ran)')
            .concat(parseTableH3(body, 'Re-run validation'));
        for (const row of reruns) {
            const check = (row['Check'] ?? '').trim();
            if (!check) continue;
            latest.set(canonicalizeValidationCheck(check), {
                check,
                result: row['Result'] ?? '',
                notes: row['Notes'] ?? '',
            });
        }
    }

    return latest;
}

export function validateHandoff(taskId: string): string[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    const issues: string[] = [];
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        const latestResults = computeLatestValidationResults(content);
        const hasFail = Array.from(latestResults.values())
            .some(row => row.result.trim().toLowerCase() === 'fail');
        if (hasFail) {
            issues.push('Validation Outcomes table has one or more Fail results');
        }
        issues.push(...checkAcCoveragePlaceholders(content));
        issues.push(...validateHandoffAgainstSpec(specPath, handoffPath, latestResults));
    } catch {
        issues.push('handoff.md not found');
    }
    return issues;
}

export function canonicalizeValidationCheck(value: string): string {
    const backtickMatch = value.match(/`([^`]+)`/);
    const base = backtickMatch ? backtickMatch[1] : value.split(/\s+[—–-]\s+/)[0];
    const normalized = base.replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    // If the token looks like a command (contains spaces, e.g. "npm run lint"), use
    // the last word as the canonical key so it matches the short-name form ("lint").
    if (normalized.includes(' ')) {
        return normalized.split(' ').at(-1) ?? normalized;
    }
    return normalized;
}

export function parseValidationRequiredChecks(specPath: string): string[] {
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
        if (!section) return [];
        const checks: string[] = [];
        for (const line of section[1].split('\n')) {
            const match = line.match(/^-\s+\[x\]\s+(.+?)\s*$/i);
            if (match?.[1]) checks.push(match[1].trim());
        }
        return checks;
    } catch {
        return [];
    }
}

export type ValidationOutcomeRow = {
    check: string;
    result: string;
    notes: string;
};

export type RuntimeOutcomeRow = {
    check: string;
    result: string;
    elapsed: string;
    notes: string;
};

function cleanRuntimeCheckName(value: string): string {
    return value.trim().replace(/^`|`$/g, '');
}

export function computeLatestRuntimeResults(handoffContent: string): Map<string, RuntimeOutcomeRow> {
    const latest = new Map<string, RuntimeOutcomeRow>();
    const baseline = parseTable(handoffContent, 'Runtime Validation Outcomes');
    for (const row of baseline) {
        const check = cleanRuntimeCheckName(row['Check'] ?? '');
        if (!check) continue;
        latest.set(check, {
            check,
            result: row['Result'] ?? '',
            elapsed: row['Elapsed'] ?? '',
            notes: row['Notes'] ?? '',
        });
    }

    const iterationBodies = extractSectionBodies(handoffContent, /^## Iteration\b/);
    for (const body of iterationBodies) {
        const reruns = parseTableH3(body, 'Re-run runtime validation');
        for (const row of reruns) {
            const check = cleanRuntimeCheckName(row['Check'] ?? '');
            if (!check) continue;
            latest.set(check, {
                check,
                result: row['Result'] ?? '',
                elapsed: row['Elapsed'] ?? '',
                notes: row['Notes'] ?? '',
            });
        }
    }

    return latest;
}

export function parseValidationOutcomeRows(handoffPath: string): ValidationOutcomeRow[] {
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        return parseTable(content, 'Validation Outcomes').map(row => ({
            check: row['Check'] ?? '',
            result: row['Result'] ?? '',
            notes: row['Notes'] ?? '',
        }));
    } catch {
        return [];
    }
}

export function isPassResult(result: string): boolean {
    return result.trim().toLowerCase().startsWith('pass');
}

export function isNAResult(result: string): boolean {
    return /^n\/?a\b/i.test(result.trim());
}

export function validateHandoffAgainstSpec(
    specPath: string,
    handoffPath: string,
    latestResults?: Map<string, ValidationOutcomeRow>,
): string[] {
    const requiredChecks = parseValidationRequiredChecks(specPath);
    if (requiredChecks.length === 0) return [];

    let rowMap: Map<string, ValidationOutcomeRow>;
    if (latestResults) {
        rowMap = latestResults;
    } else {
        // Fallback for callers that don't yet pass cumulative results.
        // Reads the handoff and computes latest-per-check so that this
        // function is correct even when called standalone.
        try {
            const content = fs.readFileSync(handoffPath, 'utf8');
            rowMap = computeLatestValidationResults(content);
        } catch {
            rowMap = new Map<string, ValidationOutcomeRow>();
        }
    }

    const issues: string[] = [];
    for (const required of requiredChecks) {
        const canonical = canonicalizeValidationCheck(required);
        const row = rowMap.get(canonical);
        if (!row) {
            issues.push(`Validation Required item missing from handoff.md: ${required}`);
            continue;
        }
        if (isNAResult(row.result)) {
            issues.push(`Validation Required item marked N/A in handoff.md: ${required}`);
            continue;
        }
        if (!isPassResult(row.result)) {
            const note = row.notes ? ` (${row.notes})` : '';
            issues.push(`Validation Required item did not pass in handoff.md: ${required} — ${row.result}${note}`);
        }
    }
    return issues;
}

function autoCommitAllowedSourceBypass(filePath: string): boolean {
    if (filePath.startsWith('tasks/')) return true;
    return (PIPELINE_TELEMETRY_FILES as readonly string[]).includes(filePath);
}

function toFileSet(files: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
    return files instanceof Set ? files : new Set(files);
}

export function findUncoveredTrackedChanges(
    statusOutput: string,
    handoffFiles: ReadonlySet<string> | readonly string[],
): string[] {
    const allowed = toFileSet(handoffFiles);
    return parsePorcelainEntries(statusOutput)
        .filter(entry => {
            const untrackedOnly = entry.indexStatus === '?' && entry.worktreeStatus === '?';
            if (untrackedOnly) return false;
            return entry.paths.some(filePath => !allowed.has(filePath) && !autoCommitAllowedSourceBypass(filePath));
        })
        .map(entry => entry.raw);
}

export function findStagedFilesOutsideHandoff(
    stagedNameOnlyOutput: string,
    handoffFiles: ReadonlySet<string> | readonly string[],
): string[] {
    const allowed = toFileSet(handoffFiles);
    return stagedNameOnlyOutput
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(filePath => !allowed.has(filePath));
}

const DONE_MD_TEMPLATE_SENTINELS = [
    '[TASK-ID]',
    'One paragraph, plain English. No code jargon.',
    '`src/...` — brief note',
];

// Generic template-detector for the most common task-artifact templates
// (spec.md, plan.md, spec-review.md, review.md). The `[TASK-ID]` sentinel
// is present in every template's header and survives into rendered tasks
// until an agent rewrites the file substantively. A `null` content (file
// missing on disk) is also treated as "unfilled" so callers can do a
// single check rather than guarding for null first.
//
// Centralized here in validation.ts (rather than the duplicated copies
// previously in main.ts, code-review.ts, spec-review.ts, plan.ts) so that
// 1a-2's `checkPhaseGate` and existing post-Codex template guards share
// one definition.
export function isTemplateUnfilled(content: string | null): boolean {
    if (content === null) return true;
    return content.includes('[TASK-ID]');
}

export function isDoneMdTemplate(donePath: string): boolean {
    let content: string;
    try {
        content = fs.readFileSync(donePath, 'utf8');
    } catch {
        return true;
    }
    return DONE_MD_TEMPLATE_SENTINELS.some(s => content.includes(s));
}

export function extractDoneMdFromStdout(stdout: string): string {
    const trimmed = stdout.trim();
    if (!trimmed) return '';
    if (!/^#\s+(QA Summary|Completion Summary)\b/m.test(trimmed)) return '';
    return trimmed + '\n';
}

// Match `- [x] **Approved**` and variants in a review/spec-review artifact.
//
// Review artifacts are cumulative: round 1 uses the top-level Stage 1 / Stage 2 /
// `## Final Verdict` structure; subsequent rounds append `## Round N — ...` h2
// sections each containing their own `### Verdict for this round` checkboxes.
// On multi-round reviews we must read only the *latest* round's verdict —
// otherwise a stale round-1 "Approved" can advance the pipeline even after a
// later round flipped to "Changes requested".
//
// Templates are inconsistent: `## Final Verdict` (round 1) uses bolded labels
// (`**Approved**`), but the `## Round N` re-review template uses unbolded
// labels (`- [x] Approved`). Accept both so evidence auto-advance works on
// both round-1 and round-N+ reviews.
export function extractCheckedVerdict(content: string): Verdict | null {
    const roundBodies = extractSectionBodies(content, /^## Round\b/);
    const scope = roundBodies.length > 0 ? roundBodies[roundBodies.length - 1] : content;
    // Order matters: check "Approved with nits" *before* plain "Approved" so the
    // shorter prefix doesn't shadow the longer phrase when bold markers are absent.
    if (/^- \[x\] (?:\*\*)?Approved with nits(?:\*\*)?(?:\s|$)/mi.test(scope)) return 'approved_with_nits';
    if (/^- \[x\] (?:\*\*)?Approved(?:\*\*)?(?:\s|$)/mi.test(scope)) return 'approved';
    if (/^- \[x\] (?:\*\*)?Changes requested(?:\*\*)?(?:\s|$)/mi.test(scope)) return 'changes_requested';
    if (/^- \[x\] (?:\*\*)?Needs re-review(?:\*\*)?(?:\s|$)/mi.test(scope)) return 'needs_re_review';
    return null;
}

// 1a-2 phase gate.
//
// Centralized invariant check called before `task.sh phase <id> <phase> done`
// accepts the transition. Per BACKLOG §"Status counter consistency + artifact-
// invariant gate before phase advancement": each phase that produces an
// artifact requires that artifact to exist and be substantively filled
// (not the unfilled template). Each phase that has a verdict requires that
// verdict to be non-empty AND, when the verdict lives in the artifact,
// parseable from the artifact and consistent with what's being recorded
// in status.json.
//
// Replaces the scattered post-Codex template checks in phases/spec-review.ts,
// phases/code-review.ts, phases/plan.ts — those still fire today but the
// gate now also covers the manual `task.sh phase` path so operators can't
// silently advance a phase whose artifact is template-only.

export type PhaseGateResult = { ok: true } | { ok: false; reason: string };

type PhaseGateConfig = {
    artifactName?: string;
    requiresVerdict?: boolean;
    verdictMustMatchArtifact?: boolean;
    // Phase-specific template detector. Defaults to isTemplateUnfilled.
    // qa.done.md uses a stricter multi-sentinel detector.
    customTemplateCheck?: (artifactPath: string) => boolean;
};

const PHASE_GATE_CONFIG: Record<Phase, PhaseGateConfig> = {
    spec: { artifactName: 'spec.md' },
    spec_review: { artifactName: 'spec-review.md', requiresVerdict: true, verdictMustMatchArtifact: true },
    plan: { artifactName: 'plan.md' },
    implement: { artifactName: 'handoff.md' },
    // runtime_validation has no per-task artifact file — the phase's results
    // live in a section appended to handoff.md by the orchestrator. The
    // gate doesn't require a verdict here because (a) the orchestrator's
    // direct setRuntimeValidationPhase() writes always include a verdict
    // and bypass task.sh entirely, and (b) the existing task.sh CLI
    // contract treats verdict as optional for runtime_validation (see
    // the verdict-validation block earlier in cmd_phase). Tightening this
    // would break documented manual-repair paths without adding real
    // enforcement against the orchestrator's own writes.
    runtime_validation: {},
    code_review: { artifactName: 'review.md', requiresVerdict: true, verdictMustMatchArtifact: true },
    qa: { artifactName: 'done.md', customTemplateCheck: isDoneMdTemplate },
    human_review: {},
};

export function checkPhaseGate(taskId: string, phase: Phase, verdict?: string): PhaseGateResult {
    const config = PHASE_GATE_CONFIG[phase];

    if (config.artifactName) {
        const artifactPath = path.join(taskDirFor(taskId), config.artifactName);
        let content: string;
        try {
            content = fs.readFileSync(artifactPath, 'utf8');
        } catch {
            return { ok: false, reason: `${config.artifactName} is missing for phase '${phase}'` };
        }

        const isTemplate = config.customTemplateCheck
            ? config.customTemplateCheck(artifactPath)
            : isTemplateUnfilled(content);
        if (isTemplate) {
            return { ok: false, reason: `${config.artifactName} is still the unfilled template for phase '${phase}'` };
        }

        if (config.verdictMustMatchArtifact) {
            if (!verdict) {
                return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
            }
            const extracted = extractCheckedVerdict(content);
            if (!extracted) {
                return { ok: false, reason: `${config.artifactName} has no checked verdict checkbox` };
            }
            if (extracted !== verdict) {
                return { ok: false, reason: `verdict mismatch: status.json wants '${verdict}', ${config.artifactName} has '${extracted}'` };
            }
        }
    }

    if (config.requiresVerdict && !config.verdictMustMatchArtifact) {
        // Verdict required but not parseable from an artifact (runtime_validation).
        if (!verdict) {
            return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
        }
    }

    return { ok: true };
}

export function parseHandoffFiles(taskId: string): string[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    let content: string;
    try {
        content = fs.readFileSync(handoffPath, 'utf8');
    } catch {
        return [];
    }
    const rows = parseTable(content, 'Changes');
    const files: string[] = [];
    for (const row of rows) {
        const firstColumn = Object.values(row)[0] ?? '';
        const match = firstColumn.match(/`([^`]+)`/);
        if (match?.[1]) files.push(match[1]);
    }
    return files;
}

const HANDOFF_DIFF_EXEMPT_PATHS: ReadonlySet<string> = new Set([]);

// Pipeline-owned task artifacts (anything under `tasks/<active-id>/`) never need
// to appear in the handoff Changes table — they describe the implementation,
// they are not part of it. Pre-existing canon-on-canon flows hide this because
// the orchestrator commits task artifacts to the base branch before code_review
// runs, so they don't appear in `git diff base...HEAD`. Adopters that commit
// task artifacts to the task branch (TokenAnxiety's pattern, surfaced via
// canon-ai issue #41) hit a preflight loop where Codex iterating to address
// nonexistent findings just appends more iteration sections to handoff/notes,
// triggering the same rejection again.
function isPipelineOwnedTaskArtifact(filePath: string, taskIds: readonly string[]): boolean {
    return taskIds.some(id => filePath === `tasks/${id}` || filePath.startsWith(`tasks/${id}/`));
}

export type HandoffDiffInputs = {
    diffFiles: readonly string[];
    renamePairs?: readonly (readonly [string, string])[];
    handoffFilesByTask: ReadonlyMap<string, readonly string[]>;
};

export function verifyHandoffAgainstDiffFromData(
    taskIds: string[],
    inputs: HandoffDiffInputs,
): string[] {
    const renamePairs = inputs.renamePairs ?? [];
    const coveredPaths = new Set<string>(inputs.diffFiles);
    for (const [oldPath, newPath] of renamePairs) {
        coveredPaths.add(oldPath);
        coveredPaths.add(newPath);
    }

    const handoffFilesByTask = new Map<string, readonly string[]>();
    const bundleHandoffFiles = new Set<string>();
    for (const taskId of taskIds) {
        const files = inputs.handoffFilesByTask.get(taskId) ?? [];
        handoffFilesByTask.set(taskId, files);
        for (const filePath of files) bundleHandoffFiles.add(filePath);
    }

    const issues: string[] = [];
    for (const taskId of taskIds) {
        const files = handoffFilesByTask.get(taskId) ?? [];
        for (const filePath of files) {
            if (!coveredPaths.has(filePath)) {
                issues.push(`[${taskId}] handoff→diff: ${filePath} listed in handoff but not in diff`);
            }
        }
    }

    for (const filePath of inputs.diffFiles) {
        if (HANDOFF_DIFF_EXEMPT_PATHS.has(filePath)) continue;
        if (isPipelineOwnedTaskArtifact(filePath, taskIds)) continue;
        if (bundleHandoffFiles.has(filePath)) continue;
        issues.push(`diff→handoff: ${filePath} in diff but not in any bundle handoff`);
    }

    for (const [oldPath, newPath] of renamePairs) {
        if (HANDOFF_DIFF_EXEMPT_PATHS.has(oldPath) && HANDOFF_DIFF_EXEMPT_PATHS.has(newPath)) continue;
        // Either side being a pipeline-owned task artifact is enough — pipeline
        // artifacts move within/between task dirs all the time (e.g., archive
        // moves) and never belong in a handoff Changes table.
        if (isPipelineOwnedTaskArtifact(oldPath, taskIds) || isPipelineOwnedTaskArtifact(newPath, taskIds)) continue;
        if (bundleHandoffFiles.has(oldPath) || bundleHandoffFiles.has(newPath)) continue;
        issues.push(`diff→handoff: rename ${oldPath} → ${newPath} — neither path in any bundle handoff`);
    }

    return issues;
}

function parseDiffNameStatus(stdout: string): { diffFiles: string[]; renamePairs: Array<[string, string]> } {
    const diffFiles: string[] = [];
    const renamePairs: Array<[string, string]> = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const status = parts[0];
        if ((status.startsWith('R') || status.startsWith('C')) && parts.length >= 3) {
            renamePairs.push([parts[1], parts[2]]);
        } else if (parts.length >= 2) {
            diffFiles.push(parts[1]);
        }
    }
    return { diffFiles, renamePairs };
}

export function verifyHandoffAgainstDiff(taskIds: string[], baseRef: string): string[] {
    const cwd = getActiveCwd(taskIds);
    const diffResult = gitSafeAtRaw(cwd, 'diff', `${baseRef}...HEAD`, '--name-status', '-M');
    if (!diffResult.ok) {
        return [`git diff failed: ${diffResult.stderr || 'unknown error'}`];
    }
    const { diffFiles, renamePairs } = parseDiffNameStatus(diffResult.stdout);
    const handoffFilesByTask = new Map<string, readonly string[]>(
        taskIds.map(taskId => [taskId, parseHandoffFiles(taskId)]),
    );
    return verifyHandoffAgainstDiffFromData(taskIds, { diffFiles, renamePairs, handoffFilesByTask });
}
