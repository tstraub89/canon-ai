import fs from 'node:fs';
import path from 'node:path';

import { parseTable, parseTableH3, parseAllTablesH3, extractSectionBodies, scanAllTables } from './markdown-table.js';
import { PIPELINE_MANAGED_DOCS, PIPELINE_TELEMETRY_FILES, getActiveCwd } from './worktree.js';
import { warn } from './cli.js';
import { filterGitIgnoredPaths, getTreeDriftFiles, getUnpushedBaseCommits, gitSafeAt, gitSafeAtRaw, parsePorcelainEntries } from './git.js';
import { readStatus, taskDirFor } from './state.js';
import type { Phase, Verdict } from './types.js';

export function checkAcCoveragePlaceholders(handoffContent: string): string[] {
    if (!handoffContent.split('\n').some(line => line.trimEnd() === '## AC Coverage')) {
        return ['AC Coverage section is missing'];
    }

    const rows = parseTable(handoffContent, 'AC Coverage');
    if (rows.length === 0) return ['AC Coverage table is missing or contains no AC rows'];

    // Accepts both bare-numeric (`AC-1`) and lettered-section (`AC-A1`) ID schemes —
    // specs group ACs under section letters (A, B, C...) as often as they use flat
    // numbering, and the handoff's AC IDs mirror whatever spec.md uses. Single
    // letter only: multi-letter prefixes (`AC-XYZ9`) are not a documented scheme.
    const hasAcRow = rows.some(row => /AC-[A-Za-z]?\d+/i.test(Object.values(row)[0] ?? ''));
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
        latest.set(normalizeCheckLabel(check), {
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
            latest.set(normalizeCheckLabel(check), {
                check,
                result: row['Result'] ?? '',
                notes: row['Notes'] ?? '',
            });
        }
    }

    return latest;
}

export function validateHandoff(taskId: string, changedFiles: ReadonlySet<string> = new Set<string>()): string[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    const issues: string[] = [];
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        const latestResults = computeLatestValidationResults(content);
        issues.push(...checkAcCoveragePlaceholders(content));
        issues.push(...validateHandoffAgainstSpec(specPath, handoffPath, latestResults, changedFiles));
        const { malformed } = parseHandoffChangesRows(taskId);
        for (const entry of malformed) {
            issues.push(`Changes table row '${entry.cell}': ${entry.reason}`);
        }
    } catch {
        issues.push('handoff.md not found');
    }
    return issues;
}

// Intra-handoff identity for a Validation Outcomes row. Used ONLY as the map
// key in computeLatestValidationResults, so a later `### Re-run validation` row
// overrides the baseline row for the same check. It is deliberately NOT matched
// against spec.md's Validation Required items: that cross-artifact prose
// matching (the former `canonicalizeValidationCheck` with its first-backtick /
// last-word / dash-split heuristics) was the false-"required check missing"
// bug class that blocked valid work three times (#163, #200, add-xs-tier) and
// is removed entirely. Whether each required check is actually satisfied is now
// judged by Claude in Stage 1 code review — see docs/decisions.md "Validation
// runs inside agent phases." This key keeps only what intra-handoff override
// needs: the trimmed literal Check-cell text, with NO other normalization.
//
// This is the fixed point of a deliberate fail-direction argument. As an
// intra-handoff map key (baseline row ↔ its own re-run rows; never compared to
// spec.md), the one thing it must never do is collapse two GENUINELY DISTINCT
// checks to one key — that would let a later row overwrite an earlier one and
// hide a real `Fail` (a fail-OPEN gate). Every normalization that seemed
// harmless turned out to be lossy in exactly that direction and merged distinct
// commands: last-word / first-backtick-span extraction (`test:e2e` vs its
// `@cross-browser` variant, #163), dash-annotation stripping (spaced hyphens in
// quoted args), case folding (`--grep "Checkout"` vs `"checkout"`), internal-
// whitespace collapse (a double-space inside a quoted pattern), and even
// stripping backticks (a label containing a literal `` `date` `` command
// substitution). Trimming leading/trailing whitespace is the only transform
// that cannot merge distinct checks — non-empty, differently-spelled labels
// always yield different keys; identical labels are the same check by
// definition. The accepted, fail-CLOSED cost is that a re-run overrides its
// baseline only when the two Check cells are byte-identical after trim; drift
// (e.g. an annotated baseline vs a terser re-run) yields a spurious block, not
// a hidden failure, so the handoff template instructs authors to keep a check's
// label identical across its baseline and re-run rows.
function normalizeCheckLabel(value: string): string {
    return value.trim();
}

export function parseValidationRequiredChecks(specPath: string): string[] | null {
    // Return semantics:
    //   - `null`            → Validation Required section is missing entirely (no `## Validation Required` header) OR spec file is unreadable.
    //   - `[]` (empty array) → section exists but no `- [x]` items (only `- [ ]` placeholders or no items).
    //   - non-empty `string[]` → the list of checked validation requirements.
    // Callers must distinguish `null` from `[]` to emit the correct error — the
    // two cases look identical to operators but have different remediation
    // (write the section vs. mark checks `[x]`).
    try {
        const content = fs.readFileSync(specPath, 'utf8');
        const section = content.match(/## Validation Required\n\n([\s\S]*?)(?:\n## |\n# |$)/);
        if (!section) return null;
        const checks: string[] = [];
        for (const line of section[1].split('\n')) {
            const match = line.match(/^-\s+\[x\]\s+(.+?)\s*$/i);
            if (match?.[1]) checks.push(match[1].trim());
        }
        return checks;
    } catch {
        return null;
    }
}

// Reroute re-runs spec_review and plan against artifacts that already carry the
// original pass's content (the approved `spec-review.md` / `plan.md`). The
// recovery path that revises a rejected amendment and re-runs canon appends a
// second same-round section, so the freshest same-round heading is the
// authoritative one. Heading convention mirrors the amendment convention:
// round 1 is the bare label (`## Amendment Review`, `## Reroute Plan`); round
// N >= 2 is `<label> Round N`. Horizontal-whitespace classes ([ \t]) keep each
// match on a single line (same gotcha as verifyRerouteAmendment). The round-1
// pattern anchors to end-of-line so a `<label> Round 2` heading cannot satisfy a
// round-1 check. Heading detection must ignore fenced code blocks and HTML
// comments across the whole file so earlier same-round examples do not corrupt
// the latest-match selection or the section boundary.
// Returns the slice of `content` from the latest matching reroute heading down
// to the next h1/h2 heading (or EOF), or null if that heading is absent. The
// caller extracts the round's verdict from this slice — scoping the verdict to
// the fresh section is what stops the original first-pass `- [x] Approved` box
// (still present higher in the cumulative file) from satisfying a reroute that
// was actually marked `Changes requested` or left blank.
export function sliceRerouteRoundSection(content: string, label: string, round: number): string | null {
    const esc = label.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ \t]+/g, '[ \\t]+');
    const headingRe = round >= 2
        ? new RegExp(`^#{2,6}[ \\t]+${esc}[ \\t]+Round[ \\t]+${round}[ \\t]*$`, 'i')
        : new RegExp(`^#{2,6}[ \\t]+${esc}[ \\t]*$`, 'i');
    // Heading detection must ignore heading-like lines inside fenced code blocks
    // and HTML comments — a verdict checkbox can legitimately follow a fenced
    // example that contains a literal `## ...` line, and slicing on that would
    // truncate the section before the verdict (mirrors extractSectionBodies'
    // comment handling, plus fences).
    const lines = content.split('\n');
    let inFence = false;
    let inComment = false;
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // HTML comments take precedence — ignore everything (including fence
        // markers) inside them, so a fenced snippet within a comment can't corrupt
        // fence state or swallow the comment's closing `-->`.
        const opensComment = /<!--/.test(line);
        const closesComment = /-->/.test(line);
        const wasInComment = inComment;
        if (opensComment && !closesComment) inComment = true;
        else if (closesComment && !opensComment) inComment = false;
        else if (opensComment && closesComment) inComment = false;
        if (wasInComment || (opensComment && !closesComment)) continue;
        // Outside comments: track fenced code blocks and skip their contents.
        if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
        if (inFence) continue;
        if (headingRe.test(line)) start = i;
    }
    if (start === -1) return null;

    // Find the end boundary with a second file-wide scan so the same fence /
    // comment state that suppressed earlier fake headings also governs the
    // post-heading boundary detection.
    inFence = false;
    inComment = false;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const opensComment = /<!--/.test(line);
        const closesComment = /-->/.test(line);
        const wasInComment = inComment;
        if (opensComment && !closesComment) inComment = true;
        else if (closesComment && !opensComment) inComment = false;
        else if (opensComment && closesComment) inComment = false;
        if (wasInComment || (opensComment && !closesComment)) continue;
        if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
        if (inFence || i <= start) continue;
        // After the heading: the next real h1/h2 ends the section; `### `+ stay in.
        if (/^#{1,2}[ \t]+\S/.test(line)) return lines.slice(start, i).join('\n');
    }
    return lines.slice(start).join('\n');
}

// Fields are `unknown` on purpose: the status comes from untyped JSON on disk,
// so the helper must runtime-validate the reroute signal rather than trust a
// type that a corrupt status.json could violate (e.g. `rerouted: "true"`).
export type RerouteStatusView = { phases?: { implement?: unknown } };

export type RerouteEvidence =
    | { reroute: false }
    | { reroute: true; ok: false; reason: string }
    | { reroute: true; ok: true; verdict?: Verdict };

// Single source of truth for the reroute-evidence invariant: on a reroute, a
// phase must show FRESH round-N work, not the original first-pass artifact (which
// is still present in the cumulative file). Called by BOTH gates
// (`tryEvidenceAdvance`, `checkPhaseGate`) for spec_review and plan, so they can
// never disagree. Pure — callers fail closed on a missing/unreadable status
// BEFORE invoking this, so `status` is always present + parsed here (no "unknown"
// state to mishandle). `{ reroute: false }` means "not a reroute → caller uses its
// normal first-pass logic"; `{ reroute: true, ok: false }` means the caller must
// reject; `{ reroute: true, ok: true, verdict? }` means advance (verdict set only
// for spec_review).
export function checkRerouteEvidence(phase: Phase, artifactContent: string, status: RerouteStatusView): RerouteEvidence {
    // Only spec_review and plan are reroute-gated; every other phase (code_review,
    // etc.) uses its own first-pass logic regardless of status shape.
    if (phase !== 'spec_review' && phase !== 'plan') return { reroute: false };
    // The reroute signal is status.phases.implement.rerouted. A reroute ALWAYS has a
    // populated implement entry with `rerouted === true` (a task can't reroute
    // without having implemented), so any *absence* of that positive signal —
    // implement entry missing/not an object, `rerouted` absent, or `rerouted ===
    // false` — is a first-pass and uses the normal whole-file logic. Only a
    // PRESENT-but-malformed signal (`rerouted` present yet not a boolean) is
    // indeterminate → FAIL CLOSED, since that could be a corrupted reroute whose
    // stale first-pass approval must not slip through.
    const impl = status.phases?.implement;
    const rerouted = (typeof impl === 'object' && impl !== null)
        ? (impl as { rerouted?: unknown }).rerouted
        : undefined;
    if (rerouted !== undefined && typeof rerouted !== 'boolean') {
        return { reroute: true, ok: false, reason: 'cannot determine reroute state — status.phases.implement.rerouted is present but not a boolean' };
    }
    if (rerouted !== true) return { reroute: false }; // first-pass (signal absent or false)
    const rerouteExempt = (impl as { reroute_exempt?: unknown }).reroute_exempt;
    if (rerouteExempt === true) return { reroute: false };
    const round = (impl as { reroute_count?: unknown }).reroute_count;
    // rerouteFromHumanReview always increments reroute_count to >= 1 before any
    // phase dispatch, so a rerouted task with a missing/zero/non-numeric round is an
    // invalid state — fail closed rather than guess round 1 (which would mis-target
    // round-2+ work or let a stale round-1 section satisfy a later reroute).
    if (typeof round !== 'number' || round < 1) {
        return { reroute: true, ok: false, reason: 'reroute in progress but reroute_count is missing/invalid (<1) — cannot determine the amendment round' };
    }
    if (phase === 'spec_review') {
        const section = sliceRerouteRoundSection(artifactContent, 'Amendment Review', round);
        if (section === null) {
            const expected = round >= 2 ? `## Amendment Review Round ${round}` : '## Amendment Review';
            return { reroute: true, ok: false, reason: `no \`${expected}\` section — a fresh amendment review for round ${round} is required (the original review does not count)` };
        }
        const verdict = extractCheckedVerdict(section);
        if (!verdict) return { reroute: true, ok: false, reason: `the round-${round} Amendment Review section has no checked verdict box` };
        return { reroute: true, ok: true, verdict };
    }
    // phase === 'plan'
    if (sliceRerouteRoundSection(artifactContent, 'Reroute Plan', round) === null) {
        const expected = round >= 2 ? `## Reroute Plan Round ${round}` : '## Reroute Plan';
        return { reroute: true, ok: false, reason: `no \`${expected}\` section — the reroute plan delta for round ${round} is required` };
    }
    return { reroute: true, ok: true };
}

export function verifyRerouteAmendment(
    taskId: string,
    requiredRound: number,
): { amended: boolean; reason: string } {
    // taskDirFor resolves to the active task directory, so reroute pre-flight
    // checks the worktree spec when one exists and REPO_ROOT only before the
    // task has entered worktree-backed phases.
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    let content: string;
    try {
        content = fs.readFileSync(specPath, 'utf8');
    } catch {
        return { amended: false, reason: `spec.md missing at ${specPath}` };
    }

    // Heading-line patterns use horizontal whitespace ([ \t]) to keep the match
    // anchored to a single line. `\s+` includes `\n`, so a spec with `## Amendment`
    // followed by body text starting with "Round 1 amendment only." would falsely
    // satisfy `Amendment\s+Round\s+\d+` by spanning the blank line — making the
    // helper report `found ## Amendment Round 1` for a spec that only has bare
    // `## Amendment`.
    if (requiredRound === 1) {
        if (/^#{2,6}[ \t]+Amendment\b/im.test(content)) {
            return { amended: true, reason: '' };
        }
        return {
            amended: false,
            reason: `no \`## Amendment\` heading found in ${specPath}`,
        };
    }

    const matches = content.matchAll(/^#{2,6}[ \t]+Amendment[ \t]+Round[ \t]+(\d+)\b/gim);
    let seenRound: number | null = null;
    for (const match of matches) {
        const foundRound = Number(match[1]);
        if (foundRound === requiredRound) {
            return { amended: true, reason: '' };
        }
        if (seenRound === null) {
            seenRound = foundRound;
        }
    }
    if (seenRound !== null) {
        return {
            amended: false,
            reason: `found \`## Amendment Round ${seenRound}\` in ${specPath}, expected \`## Amendment Round ${requiredRound}\``,
        };
    }
    if (/^#{2,6}[ \t]+Amendment\b/im.test(content)) {
        return {
            amended: false,
            reason: `found \`## Amendment\` in ${specPath}, expected \`## Amendment Round ${requiredRound}\``,
        };
    }
    return {
        amended: false,
        reason: `no \`## Amendment Round ${requiredRound}\` heading found in ${specPath}`,
    };
}

export type ValidationOutcomeRow = {
    check: string;
    result: string;
    notes: string;
};

export type BlockerBucket = 'format' | 'regression' | 'blocked';

export type ClassifiedBlocker = {
    bucket: BlockerBucket;
    message: string;
};

export type PreflightClassificationData = {
    latestResults: Map<string, ValidationOutcomeRow>;
    requiredChecks: string[] | null;
    changedFiles: ReadonlySet<string>;
    acCoverageIssues: string[];
    changesTableIssues: string[];
    bundleDiffIssues: string[];
    handoffMissing: boolean;
};

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

function cleanCitedPathToken(rawToken: string): string {
    return rawToken
        .trim()
        .replace(/^[`'"\[({<]+/, '')
        .replace(/[>`'"\])}.,;]+$/, '');
}

function stripCitedLocation(token: string): string {
    return token.replace(/:\d+(?::\d+)?$/, '');
}

function hasLineLocation(token: string): boolean {
    return /:\d+(?::\d+)?$/.test(token);
}

export function extractCitedFilePaths(notes: string): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const rawToken of notes.split(/\s+/)) {
        const cleaned = cleanCitedPathToken(rawToken);
        // Check for a line-location marker BEFORE stripping it, so extensionless
        // filenames like `Dockerfile:17` or `Makefile:42` are not dropped by the
        // extension filter below. The marker alone (`:1231` with no leading filename)
        // is still filtered because `withoutLocation` will be empty after stripping.
        const hasLine = hasLineLocation(cleaned);
        const withoutLocation = stripCitedLocation(cleaned);
        if (!withoutLocation || !(withoutLocation.includes('/') || withoutLocation.includes('\\') || /\.[A-Za-z0-9]+$/.test(withoutLocation) || hasLine)) {
            continue;
        }
        const normalized = withoutLocation.replace(/^\.\//, '');
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        paths.push(normalized);
    }
    return paths;
}

export function matchAgainstChangedFiles(citedPath: string, changedFiles: ReadonlySet<string>): boolean {
    const normalized = citedPath.replace(/\\/g, '/').replace(/^\.\//, '');
    // Treat `../`-prefixed relative paths as absolute-style so they get the
    // suffix walk below. CI tools often emit paths relative to a subdirectory
    // (e.g. `../src/foo.ts` from the `e2e/` runner root). The suffix walk
    // correctly resolves `../src/foo.ts` → tries `src/foo.ts` at depth 1.
    const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('../');
    if (!isAbsolute) {
        if (normalized.includes('/')) return changedFiles.has(normalized);

        for (const changedFile of changedFiles) {
            const lastSegment = changedFile.replace(/\\/g, '/').split('/').pop() ?? '';
            if (lastSegment === normalized) return true;
        }
        return false;
    }

    const parts = normalized.split('/');
    for (let i = 1; i < parts.length; i += 1) {
        const suffix = parts.slice(i).join('/');
        if (suffix && changedFiles.has(suffix)) return true;
    }
    return false;
}

export function isPassResult(result: string): boolean {
    return result.trim().toLowerCase().startsWith('pass');
}

// Legacy `N/A` value. Pre-enum tasks use it for "doesn't apply." Kept as a
// recognized state forever — adopters mid-flight have it in their handoffs.
export function isNAResult(result: string): boolean {
    return /^n\/?a\b/i.test(result.trim());
}

// 1b validation-result enum extensions.
//
// Replaces the binary pass/fail (+ ambiguous N/A) classification with
// finer-grained states surfaced from TokenAnxiety's ui-002 dogfood report:
// human-only checks (OAuth, cross-browser, deployed-only smoke) were being
// approved before the human actually ran them, because there was no enum
// state distinguishing "agent skipped this because it can't run it" from
// "this passed" or "this doesn't apply."

// `not_configured` — the spec doesn't require this check for this task
// type. Replaces most current N/A uses on a forward-looking basis.
export function isNotConfiguredResult(result: string): boolean {
    return /^not[_ -]?configured\b/i.test(result.trim());
}

// `human_pending` — only a human can run this check (OAuth, cross-browser,
// deployed-only smoke). Task cannot close `human_review` until resolved
// unless the human writes an explicit waiver in done.md.
export function isHumanPendingResult(result: string): boolean {
    return /^human[_ -]?pending\b/i.test(result.trim());
}

// `deferred_by_spec` — explicitly out of scope per the spec. Requires
// spec citation in the row's Notes column to be valid.
export function isDeferredBySpecResult(result: string): boolean {
    return /^deferred[_ -]?by[_ -]?spec\b/i.test(result.trim());
}

// `blocked` — check would have run but infrastructure was unavailable
// (CI down, network out). Distinct from `fail` (real defect) — triage
// is required before deciding pass/fail. Treated as a soft fail in
// validateHandoffAgainstSpec so the operator notices.
export function isBlockedResult(result: string): boolean {
    return /^blocked\b/i.test(result.trim());
}

// `fail – unrelated` — the check failed, but the failure is outside the
// task's Affected Files (pre-existing flake, unrelated test, environment
// issue). Codex is instructed to write this state when a required check
// fails for reasons it must not fix. Accepted in validateHandoffAgainstSpec
// ONLY when Notes is non-empty — the agent must name the failing test/file
// so the reviewer can assess. Unlike `blocked`, this is a deliberate "I ran
// it, it failed, it's not mine" declaration.
export function isUnrelatedFailResult(result: string): boolean {
    return /^fail\s*[–—-]\s*unrelated\b/i.test(result.trim());
}

// `pending` — verdict not yet recorded for the row. Validation result
// rows that are still in the template state or blank get this. Treated
// as "missing" by validateHandoffAgainstSpec.
//
// CRITICAL: `isPassResult` is prefix-based — `Pass / Fail / ...` would
// otherwise be parsed as a real Pass, silently approving untouched
// template rows. The `/\bPass\s*\/\s*Fail\b/i` check catches both the
// legacy template (`Pass / Fail / N/A`) and the 1b template (which
// adds more result names after `Pass / Fail / ...`). Codex P1 on the
// 1b inline change.
export function isPendingResult(result: string): boolean {
    const trimmed = result.trim();
    if (!trimmed) return true;
    if (/\bPass\s*\/\s*Fail\b/i.test(trimmed)) return true;
    return false;
}

// Classify the handoff's Validation Outcomes rows for the pre-flight gate.
//
// This gate no longer pairs each spec-required check to a handoff row by prose
// (the removed `canonicalizeValidationCheck` matching, source of the false
// "required check missing" blocks in #163 / #200 / add-xs-tier). Instead it
// makes two cheap, unambiguous assertions and leaves the judgment calls to
// Claude's Stage 1 code review (docs/decisions.md "Validation runs inside agent
// phases"):
//   1. Spec-side presence: spec.md actually declares required checks.
//   2. Per-row sanity over EVERY recorded outcome, keyed only off the literal
//      Result value (never spec matching): no unexplained Fail, no unfilled
//      placeholder row, blocked rows surfaced for triage, and a Fail – unrelated
//      row that cites a file THIS task changed is a regression (anti-laundering).
//
// Deliberately NOT enforced here anymore (moved to Stage 1 review): whether a
// *specific* required check is present, and whether a required check may be
// N/A / not_configured / deferred / human_pending. Those need spec↔handoff
// correspondence, which is exactly the prose matching that kept false-blocking.
function classifyValidationChecks(
    requiredChecks: string[] | null,
    latestResults: Map<string, ValidationOutcomeRow>,
    changedFiles: ReadonlySet<string>,
): ClassifiedBlocker[] {
    const format = (message: string): ClassifiedBlocker => ({ bucket: 'format', message });
    const regression = (message: string): ClassifiedBlocker => ({ bucket: 'regression', message });
    const blocked = (message: string): ClassifiedBlocker => ({ bucket: 'blocked', message });
    const issues: ClassifiedBlocker[] = [];

    // Spec-side presence blockers are ACCUMULATED, not early-returned: a
    // malformed Validation Required section must not suppress classification of
    // the recorded outcome rows (a plain Fail alongside a missing section is
    // still a regression — the per-row scan below always runs).
    if (requiredChecks === null) {
        issues.push(format('Validation Required section is missing from spec.md'));
    } else if (requiredChecks.length === 0) {
        issues.push(format(
            'Validation Required section in spec.md has no `[x]`-checked items — ' +
            'mark at least one required check `[x]`. The template ships with `[ ]` placeholders; ' +
            'the spec author marks the required checks before invoking canon. ' +
            'If no checks apply, use a single `[x] None — <reason>` entry to document the decision.',
        ));
    } else if (latestResults.size === 0) {
        issues.push(format(
            'spec.md lists required validation checks but handoff.md has no Validation Outcomes rows — ' +
            'record each check you ran (Check / Result / Notes).',
        ));
    }

    for (const row of latestResults.values()) {
        const label = row.check;
        const note = row.notes ? ` (${row.notes})` : '';

        // Unfilled template placeholder row — the agent left the "Pass / Fail /
        // ..." stub instead of recording a result.
        if (isPendingResult(row.result)) {
            issues.push(format(`Validation Outcomes row still in template placeholder state — fill it in or remove it: ${label}.`));
            continue;
        }
        // Pass and the deliberate non-failure states are accepted. Whether a
        // *required* check should have been skipped/deferred is Stage 1's call.
        if (
            isPassResult(row.result)
            || isNAResult(row.result)
            || isNotConfiguredResult(row.result)
            || isDeferredBySpecResult(row.result)
        ) {
            continue;
        }
        // `human_pending` is a soft state — the `human_review.done` gate
        // (via countHumanPendingChecks) enforces resolution before the task closes.
        if (isHumanPendingResult(row.result)) {
            continue;
        }
        // `blocked` means infrastructure was unavailable — surfaced for triage.
        if (isBlockedResult(row.result)) {
            issues.push(blocked(`Validation Outcomes row marked blocked: ${label}${note} — triage required (CI/network/infrastructure)`));
            continue;
        }
        // `Fail – unrelated` is accepted (Stage 1 assesses credibility), EXCEPT
        // when the cited file is one this task changed — a failure in your own
        // diff can't be laundered as unrelated. This keys off the changed-file
        // set, not spec matching, and fails safe: if the note can't be parsed
        // for a changed-file citation it is accepted and Stage 1 reviews it.
        if (isUnrelatedFailResult(row.result)) {
            if (changedFiles.size > 0) {
                const citedChangedFiles = extractCitedFilePaths(row.notes ?? '')
                    .filter(citedPath => matchAgainstChangedFiles(citedPath, changedFiles));
                if (citedChangedFiles.length > 0) {
                    issues.push(regression(
                        `Validation Outcomes row marked Fail – unrelated cites a file changed by this task: ${label}. ` +
                        `A failure in a file you modified is yours to fix; if genuinely unrelated, cite a file outside your diff. ` +
                        `(cited changed file${citedChangedFiles.length === 1 ? '' : 's'}: ${citedChangedFiles.join(', ')})`,
                    ));
                }
            }
            continue;
        }
        // Anything still here is a plain Fail or an unrecognized result — every
        // accepted/soft/blocked state above has already `continue`d, so this is
        // unconditionally an unexplained failure.
        issues.push(regression(`Validation Outcomes row did not pass: ${label} — ${row.result}${note}`));
    }

    return issues;
}

export function classifyPreflightBlockersFromData(data: PreflightClassificationData): ClassifiedBlocker[] {
    const format = (message: string): ClassifiedBlocker => ({ bucket: 'format', message });
    if (data.handoffMissing) return [format('handoff.md not found')];

    // classifyValidationChecks now inspects every recorded outcome row, so the
    // former separate "non-required plain Fail" sweep is folded into it — a
    // Fail is a Fail regardless of whether the spec named the check.
    const fromRows = classifyValidationChecks(data.requiredChecks, data.latestResults, data.changedFiles);

    return [
        ...data.acCoverageIssues.map(format),
        ...data.changesTableIssues.map(format),
        ...data.bundleDiffIssues.map(format),
        ...fromRows,
    ];
}

export function classifyPreflightBlockers(
    taskId: string,
    changedFiles: ReadonlySet<string>,
    bundleDiffIssues: readonly string[] = [],
): ClassifiedBlocker[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        const latestResults = computeLatestValidationResults(content);
        const requiredChecks = parseValidationRequiredChecks(specPath);
        const { malformed } = parseHandoffChangesRows(taskId);
        return classifyPreflightBlockersFromData({
            latestResults,
            requiredChecks,
            changedFiles,
            acCoverageIssues: checkAcCoveragePlaceholders(content),
            changesTableIssues: malformed.map(entry => `Changes table row '${entry.cell}': ${entry.reason}`),
            bundleDiffIssues: [...bundleDiffIssues],
            handoffMissing: false,
        });
    } catch {
        return classifyPreflightBlockersFromData({
            latestResults: new Map(),
            requiredChecks: null,
            changedFiles,
            acCoverageIssues: [],
            changesTableIssues: [],
            bundleDiffIssues: [...bundleDiffIssues],
            handoffMissing: true,
        });
    }
}

export function validateHandoffAgainstSpec(
    specPath: string,
    handoffPath: string,
    latestResults?: Map<string, ValidationOutcomeRow>,
    changedFiles: ReadonlySet<string> = new Set<string>(),
): string[] {
    const requiredChecks = parseValidationRequiredChecks(specPath);

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
    return classifyValidationChecks(requiredChecks, rowMap, changedFiles).map(issue => issue.message);
}

// Count `human_pending` rows in a handoff's Validation Outcomes table (latest
// iteration's results, computed via the cumulative reader). Used by
// `checkPhaseGate` to gate `human_review.done` — a task closing the human
// gate with unresolved human_pending checks is closing on incomplete
// evidence (TokenAnxiety ui-002 pattern).
export function countHumanPendingChecks(handoffContent: string): { check: string; notes: string }[] {
    const latest = computeLatestValidationResults(handoffContent);
    const pending: { check: string; notes: string }[] = [];
    for (const row of latest.values()) {
        if (isHumanPendingResult(row.result)) pending.push({ check: row.check, notes: row.notes });
    }
    return pending;
}

// Detects an operator-written waiver for human_pending checks in done.md.
// Pattern: a line starting with "Acknowledged:" — case-insensitive, leading
// whitespace allowed. The human types this to explicitly defer follow-up.
export function hasHumanPendingWaiver(doneContent: string): boolean {
    return /^\s*acknowledged\s*:/im.test(doneContent);
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
    '`<path>` — brief note',
];

const PR_BODY_TEMPLATE_SENTINELS = [
    '[pr-body-stub]',
    '[TASK-ID]',
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

export function isPrBodyTemplate(prBodyPath: string): boolean {
    let content: string;
    try {
        content = fs.readFileSync(prBodyPath, 'utf8');
    } catch {
        return true;
    }
    if (content.trim() === '') return true;
    return PR_BODY_TEMPLATE_SENTINELS.some(s => content.includes(s));
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
    if (/^- \[x\] (?:\*\*)?Spec gap(?:\*\*)?(?:\s|$)/mi.test(scope)) return 'spec_gap';
    return null;
}

// 1a-2 phase gate.
//
// Centralized invariant check called before `canon task phase <id> <phase> done`
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
// gate now also covers the manual `canon task phase` path so operators can't
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
    code_review: { artifactName: 'review.md', requiresVerdict: true, verdictMustMatchArtifact: true },
    qa: { artifactName: 'done.md', customTemplateCheck: isDoneMdTemplate },
    // human_review's gate logic lives in checkPhaseGate's switch below — it
    // can't be expressed by the standard artifact/verdict config because the
    // rule cross-references handoff.md (validation outcomes) + done.md
    // (waiver text).
    human_review: {},
};

function resolveTaskDirForValidation(taskId: string, taskDirOverride?: string): string {
    return taskDirOverride ? path.join(taskDirOverride, taskId) : taskDirFor(taskId);
}

export function checkPhaseGate(
    taskId: string,
    phase: Phase,
    verdict?: string,
    taskDirOverride?: string,
): PhaseGateResult {
    const config = PHASE_GATE_CONFIG[phase];
    const taskDir = resolveTaskDirForValidation(taskId, taskDirOverride);

    if (config.artifactName) {
        const artifactPath = path.join(taskDir, config.artifactName);
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

        // Reroute evidence (spec_review + plan), shared with tryEvidenceAdvance via
        // checkRerouteEvidence so the two gates can never disagree. Only reroute-
        // capable phases read status; for them a missing/unreadable/malformed
        // status.json FAILS CLOSED — we cannot rule out a reroute, and falling back
        // to whole-file evidence would re-accept the stale first-pass artifact.
        let rerouteEv: RerouteEvidence = { reroute: false };
        if (phase === 'spec_review' || phase === 'plan') {
            let statusRaw: string;
            try { statusRaw = fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'); }
            catch { return { ok: false, reason: `cannot determine reroute state for '${phase}': status.json in ${taskDir} is missing or unreadable` }; }
            let st: RerouteStatusView;
            try { st = JSON.parse(statusRaw) as RerouteStatusView; }
            catch { return { ok: false, reason: `cannot determine reroute state for '${phase}': status.json in ${taskDir} is unparseable` }; }
            rerouteEv = checkRerouteEvidence(phase, content, st);
            if (rerouteEv.reroute && !rerouteEv.ok) {
                return { ok: false, reason: `${config.artifactName}: ${rerouteEv.reason}` };
            }
        }

        if (config.verdictMustMatchArtifact) {
            if (!verdict) {
                return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
            }
            // On a reroute the verdict comes from the round's `## Amendment Review`
            // section (checkRerouteEvidence); otherwise from the whole file, which
            // already narrows code_review's `## Round N` re-reviews.
            const extracted = (rerouteEv.reroute && rerouteEv.ok) ? rerouteEv.verdict : extractCheckedVerdict(content);
            const scopeLabel = (rerouteEv.reroute && rerouteEv.ok)
                ? `${config.artifactName} reroute amendment-review section`
                : config.artifactName;
            if (!extracted) {
                return { ok: false, reason: `${scopeLabel} has no checked verdict checkbox` };
            }
            if (extracted !== verdict) {
                return { ok: false, reason: `verdict mismatch: status.json wants '${verdict}', ${scopeLabel} has '${extracted}'` };
            }
        }
    }

    if (config.requiresVerdict && !config.verdictMustMatchArtifact) {
        if (!verdict) {
            return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
        }
    }

    // human_review.done: reject if any handoff validation row is human_pending
    // and the operator hasn't written an explicit waiver in done.md. Catches
    // the TokenAnxiety ui-002 pattern (task closed before the human ran OAuth
    // / cross-browser / deployed-only smoke checks).
    if (phase === 'human_review') {
        const handoffPath = path.join(taskDir, 'handoff.md');
        let handoffContent: string;
        try {
            handoffContent = fs.readFileSync(handoffPath, 'utf8');
        } catch {
            return { ok: false, reason: `closing human_review requires a handoff.md — none found in ${taskDir}` };
        }
        const pending = countHumanPendingChecks(handoffContent);
        if (pending.length === 0) return { ok: true };

        const donePath = path.join(taskDir, 'done.md');
        let doneContent = '';
        try { doneContent = fs.readFileSync(donePath, 'utf8'); } catch { /* missing — fall through */ }
        if (hasHumanPendingWaiver(doneContent)) return { ok: true };

        const list = pending.map(p => `    - ${p.check}${p.notes ? ` (${p.notes})` : ''}`).join('\n');
        return {
            ok: false,
            reason:
                `human_review cannot close with ${pending.length} unresolved human_pending check${pending.length === 1 ? '' : 's'}:\n${list}\n` +
                `  Resolve: either run the check and update its row in handoff.md to Pass/Fail, ` +
                `or add an explicit waiver to done.md (a line beginning with "Acknowledged: ...") ` +
                `documenting the deferral and rationale.`,
        };
    }

    return { ok: true };
}

export function parseHandoffFiles(taskId: string): string[] {
    return parseHandoffChangesRows(taskId).files;
}

/**
 * Parses the handoff's baseline `## Changes` and per-iteration `### Changes`
 * tables. Returns both the accepted paths and any rows whose first-column cell
 * failed strict path validation (so callers can surface actionable errors
 * instead of silently dropping the row).
 *
 * These two exact headings are deliberately the ONLY coverage surfaces.
 * Accepting shape-matched tables anywhere (e.g. anything with a `File` first
 * column) was tried and rejected: it turns informational file lists into
 * load-bearing coverage claims, so a "files reviewed, unchanged" table starts
 * failing the handoff→diff direction. Instead, rows parked under an
 * unrecognized heading are caught by `collectUnscannedTableHits` and named in
 * the rejection message so the implementer moves them in one round — GP task
 * multi-wall-ux-cleanup (2026-07-06) looped to an auto-block with zero
 * reviewer rounds because the old rejection never said which headings are
 * scanned.
 *
 * "Malformed" covers the failure classes that bit the GP starter-preview
 * bundle in 1.2.0. Comma-separated rows like `` `a.ts`, `b.ts` `` are now
 * parsed in full, removing the first-path-only behavior that silently dropped
 * siblings. The remaining malformed classes include:
 *
 *   - prose-with-embedded-paths like `` `sitemap.xml` regenerated `` (the bare
 *     filename got extracted instead of the real `public/sitemap.xml` path).
 *   - wildcards like `src/content/examples/*.md` (extracted verbatim, then
 *     failed the existence check because no file is literally named `*.md`).
 *   - left-in template placeholders like `` `<path>` ``.
 *
 * Rejecting these loudly at parse time is what the strict 1.2.0 preflight
 * was supposed to do — it just rejected too late in the wrong place.
 */
export function parseHandoffChangesRows(taskId: string): {
    files: string[];
    malformed: Array<{ cell: string; reason: string }>;
} {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    let content: string;
    try {
        content = fs.readFileSync(handoffPath, 'utf8');
    } catch {
        return { files: [], malformed: [] };
    }
    const files = new Set<string>();
    const malformed: Array<{ cell: string; reason: string }> = [];
    const tables = [
        parseTable(content, 'Changes'),
        ...extractSectionBodies(content, /^## Iteration\b/).map(body => parseTableH3(body, 'Changes')),
    ];
    for (const rows of tables) {
        for (const row of rows) {
            const firstColumn = Object.values(row)[0] ?? '';
            if (!firstColumn.trim()) continue;
            const result = parseHandoffPathCell(firstColumn);
            for (const filePath of result.paths) files.add(filePath);
            for (const entry of result.malformed) {
                malformed.push({ cell: firstColumn.trim(), reason: entry.reason });
            }
        }
    }
    return { files: [...files], malformed };
}

export function parseAffectedFilesFromSpec(taskId: string): {
    files: string[];
    malformed: Array<{ cell: string; reason: string }>;
} {
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    let content: string;
    try {
        content = fs.readFileSync(specPath, 'utf8');
    } catch {
        return { files: [], malformed: [] };
    }

    // Walk both `## Design` and `## Amendment` / `## Amendment Round N` H2 bodies.
    // Reroute amendments are a first-class spec surface where Codex declares
    // newly-touched files; the base-drift gate must honor them or operators have
    // to duplicate rows into the main Design table. The `\b` word boundary matches
    // both bare `## Amendment` (round 1) and `## Amendment Round N` (round 2+) and
    // rejects `## Amendments` etc. Mirrors the reroute heading gate's matching
    // strategy at L184.
    const sectionBodies = [
        ...extractSectionBodies(content, /^## Design\b/),
        ...extractSectionBodies(content, /^## Amendment\b/),
    ];
    if (sectionBodies.length === 0) return { files: [], malformed: [] };

    const files = new Set<string>();
    const malformed: Array<{ cell: string; reason: string }> = [];
    for (const body of sectionBodies) {
        const rows = parseAllTablesH3(body, 'Affected Files');
        for (const row of rows) {
            const firstColumn = Object.values(row)[0] ?? '';
            if (!firstColumn.trim()) continue;
            const result = parseHandoffPathCell(firstColumn);
            for (const filePath of result.paths) files.add(filePath);
            for (const entry of result.malformed) {
                malformed.push({ cell: firstColumn.trim(), reason: entry.reason });
            }
        }
    }

    return { files: [...files], malformed };
}

export type HandoffPathCellResult = {
    paths: string[];
    malformed: Array<{ token: string; reason: string }>;
};

type PathToken = { label: string; end: number };

function matchPathTokenAt(value: string, start: number): PathToken | null {
    if (value[start] === '`') {
        const close = value.indexOf('`', start + 1);
        if (close === -1) return null;
        return { label: value.slice(start + 1, close), end: close + 1 };
    }

    if (value[start] !== '[') return null;
    const labelClose = value.indexOf(']', start + 1);
    if (labelClose === -1 || value[labelClose + 1] !== '(') return null;

    const end = matchLinkTail(value, labelClose + 2);
    if (end === null) return null;
    return { label: value.slice(start + 1, labelClose), end };
}

/**
 * Parses the parenthesized tail of an inline markdown link, starting just
 * after its opening `(`: a destination — bare (balanced parens, no
 * whitespace) or angle-bracket-wrapped (parens need not balance) — then an
 * optional whitespace-separated title in any of CommonMark's three delimiter
 * styles (`"…"`, `'…'`, balanced `(…)`), then the closing `)`. Backslash
 * escapes are honored throughout. Returns the index just past the closing
 * `)`, or null when the tail is not a valid link tail.
 *
 * This is CommonMark's complete inline-link tail grammar, implemented after
 * three successive Codex P2s on PR #205 (escaped parens, angle destinations,
 * titles) showed that any partial scan leaves a `)` shape that truncates the
 * token in list context. The grammar is closed — destination + optional
 * title is everything `(…)` can contain — so there is no fourth case.
 * Empty destinations (`()`, `(<>)`) are rejected: a template-substitution
 * bug that strips a URL should surface loudly (see the shape check note in
 * `parseHandoffPathCell`).
 */
function matchLinkTail(value: string, tailStart: number): number | null {
    let cursor = tailStart;

    if (value[cursor] === '<') {
        cursor += 1;
        const destStart = cursor;
        let closed = false;
        while (cursor < value.length) {
            if (value[cursor] === '\\') {
                cursor += 2;
            } else if (value[cursor] === '>') {
                closed = true;
                break;
            } else {
                cursor += 1;
            }
        }
        if (!closed || cursor === destStart) return null;
        cursor += 1;
    } else {
        const destStart = cursor;
        let depth = 0;
        while (cursor < value.length) {
            const ch = value[cursor];
            if (ch === '\\') {
                cursor += 2;
            } else if (ch === '(') {
                depth += 1;
                cursor += 1;
            } else if (ch === ')' && depth > 0) {
                depth -= 1;
                cursor += 1;
            } else if (ch === ')' || ((ch === ' ' || ch === '\t') && depth === 0)) {
                break;
            } else {
                cursor += 1;
            }
        }
        if (depth !== 0 || cursor === destStart) return null;
    }

    let sawWhitespace = false;
    while (value[cursor] === ' ' || value[cursor] === '\t') {
        cursor += 1;
        sawWhitespace = true;
    }
    if (value[cursor] === ')') return cursor + 1;

    // A title must be whitespace-separated from the destination.
    if (!sawWhitespace) return null;
    const open = value[cursor];
    if (open !== '"' && open !== "'" && open !== '(') return null;
    cursor += 1;
    if (open === '(') {
        let depth = 1;
        while (cursor < value.length && depth > 0) {
            if (value[cursor] === '\\') {
                cursor += 2;
            } else if (value[cursor] === '(') {
                depth += 1;
                cursor += 1;
            } else if (value[cursor] === ')') {
                depth -= 1;
                cursor += 1;
            } else {
                cursor += 1;
            }
        }
        if (depth !== 0) return null;
    } else {
        let closed = false;
        while (cursor < value.length) {
            if (value[cursor] === '\\') {
                cursor += 2;
            } else if (value[cursor] === open) {
                closed = true;
                cursor += 1;
                break;
            } else {
                cursor += 1;
            }
        }
        if (!closed) return null;
    }
    while (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
    if (value[cursor] !== ')') return null;
    return cursor + 1;
}

function findPathToken(value: string): { token: PathToken; start: number } | null {
    for (let start = 0; start < value.length; start += 1) {
        const token = matchPathTokenAt(value, start);
        if (token) return { token, start };
    }
    return null;
}

/**
 * Strictly parses a single handoff Changes table cell as one or more backtick
 * or markdown-link path tokens separated by commas, with an optional non-path
 * annotation after the last token. Structural violations produce one
 * malformed entry and no paths; per-path validation runs independently, so a
 * valid token and a wildcard/placeholder/absolute/traversal sibling can be
 * returned together.
 *
 * The lax pre-1.3.0 form returned only the first match. Parsing the complete
 * comma-joined list removes that silent-drop failure mode while retaining
 * strict rejection of prose-embedded paths and validation of every extracted
 * path.
 */
export function parseHandoffPathCell(cell: string): HandoffPathCellResult {
    const trimmed = cell.trim();
    const structuralFailure = (reason: string): HandoffPathCellResult => ({
        paths: [],
        malformed: [{ token: trimmed, reason }],
    });
    if (!trimmed) return structuralFailure('empty cell');

    const first = matchPathTokenAt(trimmed, 0);
    if (!first) {
        const embedded = findPathToken(trimmed);
        if (embedded?.token && trimmed[embedded.start] === '`') {
            return structuralFailure(
                `backticked path must be at the start of the cell, optionally followed by an annotation — got: ${snippet(trimmed)}`,
            );
        }
        if (embedded?.token) {
            return structuralFailure(
                `markdown link must be at the start of the cell — got: ${snippet(trimmed)}`,
            );
        }
        return structuralFailure(
            `no recognized path — first column must be \`backtick-path\` or [markdown-link](url): ${snippet(trimmed)}`,
        );
    }

    const tokens = [first];
    let position = first.end;
    for (;;) {
        const separator = /^\s*,\s*/.exec(trimmed.slice(position));
        if (!separator) break;
        const nextStart = position + separator[0].length;
        const next = matchPathTokenAt(trimmed, nextStart);
        if (!next) {
            return structuralFailure(
                `comma must be followed by another path token — got: ${snippet(trimmed)}`,
            );
        }
        tokens.push(next);
        position = next.end;
    }

    const remainder = trimmed.slice(position);
    const extra = findPathToken(remainder);
    if (extra) {
        if (remainder.trimStart().startsWith('`') || remainder.trimStart().startsWith('[')) {
            return structuralFailure(
                `path tokens must be comma-separated — got: ${snippet(trimmed)}`,
            );
        }
        return structuralFailure(
            `extra path token found — extra paths must be comma-joined, not left as prose or trailing annotation: ${snippet(trimmed)}`,
        );
    }
    if (remainder && !/^\s/.test(remainder)) {
        return structuralFailure(
            `trailing annotation must be separated from the last path token by whitespace — got: ${snippet(trimmed)}`,
        );
    }

    const paths: string[] = [];
    const malformed: Array<{ token: string; reason: string }> = [];
    for (const token of tokens) {
        const extracted = token.label.trim();
        const result = validateExtractedPath(extracted);
        if (result.kind === 'ok') {
            paths.push(result.path);
        } else {
            malformed.push({ token: extracted, reason: result.reason });
        }
    }
    return { paths, malformed };
}

function snippet(value: string): string {
    return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

type SinglePathValidation =
    | { kind: 'ok'; path: string }
    | { kind: 'malformed'; reason: string };

function validateExtractedPath(extracted: string): SinglePathValidation {
    if (!extracted) return { kind: 'malformed', reason: 'empty path inside backticks/link' };
    // Only `*` and `?` are rejected as wildcards — both are invalid characters
    // in real filenames on every supported platform, so their presence is
    // unambiguously a glob. Square brackets ARE valid in filenames (e.g.
    // `src/foo[beta].ts`) so we don't flag those even though they're shell-glob
    // character classes in principle.
    if (/[*?]/.test(extracted)) {
        return {
            kind: 'malformed',
            reason: `wildcard not allowed in '${extracted}' — list each file explicitly so the diff→handoff check can match`,
        };
    }
    if (extracted.includes('<') || extracted.includes('>')) {
        return {
            kind: 'malformed',
            reason: `template placeholder left unfilled in '${extracted}' — replace with a real file path`,
        };
    }
    // Absolute paths and `..`-traversals can never be valid repo-relative
    // entries — handoff paths must resolve under the worktree. More importantly:
    // `git check-ignore --stdin` exits 128 (no partial stdout) the moment ONE
    // input resolves outside the cwd, which would poison the entire batched
    // gitignored-filter call and silently fail back to "treat nothing as
    // gitignored" for the legitimate entries in the same handoff. Reject these
    // at the parse boundary so downstream batches stay clean.
    if (/^([a-zA-Z]:)?[\\/]/.test(extracted)) {
        return {
            kind: 'malformed',
            reason: `absolute path '${extracted}' not allowed — handoff paths must be repo-relative`,
        };
    }
    if (extracted.split(/[\\/]/).includes('..')) {
        return {
            kind: 'malformed',
            reason: `parent-directory traversal in '${extracted}' not allowed — handoff paths must be repo-relative`,
        };
    }
    return { kind: 'ok', path: extracted };
}

// Pipeline telemetry files are written by Claude QA (`done.md`) and the
// orchestrator itself (`pipeline-invocations.md`), not by Codex. After a reroute,
// prior-cycle telemetry edits can remain in the cumulative branch diff and
// otherwise trigger false diff→handoff failures on the next implement pass.
// PR #107 surfaced the bug: Codex's round-2 handoff ended up mirroring QA's
// telemetry writes just to satisfy this pre-flight. Exempt telemetry here so
// the handoff stays scoped to current-cycle Codex work; the handoff→diff check
// below still rejects telemetry paths if Codex claims them in the handoff.
const HANDOFF_DIFF_EXEMPT_PATHS: ReadonlySet<string> = new Set<string>(PIPELINE_TELEMETRY_FILES);

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
    /**
     * Handoff paths that are gitignored in the active worktree (e.g. build-
     * generated artifacts like `public/sitemap.xml` regenerated by a tracked
     * script). These are exempt from the handoff→diff check because they
     * cannot legitimately appear in the diff — the script that generates
     * them is the real change. Callers compute this via `filterGitIgnoredPaths`.
     */
    gitIgnoredHandoffFiles?: ReadonlySet<string>;
    /**
     * Paths that appear as valid rows in handoff tables the coverage parser
     * does NOT scan (first column header other than `File`), mapped to a
     * description of where each row was found. Used to turn a bare "not in
     * any bundle handoff" rejection into an actionable near-miss message.
     * Callers compute this via `collectUnscannedTableHits`.
     */
    unscannedTableHits?: ReadonlyMap<string, readonly string[]>;
};

/**
 * Human-readable enumeration of every surface the diff→handoff coverage
 * parser reads. Appended to rejections so the implementer knows exactly where
 * coverage rows must live instead of guessing heading names (the guessing is
 * what looped GP task multi-wall-ux-cleanup into an auto-block).
 */
export const HANDOFF_COVERAGE_SURFACES =
    "the baseline '## Changes' table and '### Changes' tables inside '## Iteration' sections";

/**
 * Scans a handoff for valid path rows in ANY table, recognized or not.
 * Returns path → list of "under <heading> (first column header '<header>')"
 * descriptions. Rows in the recognized Changes tables show up here too, but
 * that's harmless: callers only consult this map for files that are MISSING
 * coverage, and a valid row in a recognized table means the file is covered
 * and never looked up.
 */
export function collectUnscannedTableHits(handoffContent: string): Map<string, string[]> {
    const hits = new Map<string, string[]>();
    for (const table of scanAllTables(handoffContent)) {
        const firstHeader = (table.headerCells[0] ?? '').trim();
        for (const row of table.rows) {
            const firstColumn = Object.values(row)[0] ?? '';
            const parsed = parseHandoffPathCell(firstColumn);
            for (const filePath of parsed.paths) {
                const where = `'${table.heading ?? '(no heading)'}' (first column header '${firstHeader}')`;
                const existing = hits.get(filePath) ?? [];
                if (!existing.includes(where)) existing.push(where);
                hits.set(filePath, existing);
            }
        }
    }
    return hits;
}

export function verifyHandoffAgainstDiffFromData(
    taskIds: string[],
    inputs: HandoffDiffInputs,
): string[] {
    const renamePairs = inputs.renamePairs ?? [];
    const gitIgnored = inputs.gitIgnoredHandoffFiles ?? new Set<string>();
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
            if (gitIgnored.has(filePath)) continue;
            if (!coveredPaths.has(filePath)) {
                issues.push(`[${taskId}] handoff→diff: ${filePath} listed in handoff but not in diff`);
            }
        }
    }

    // Near-miss context: the row exists, but in a table this check never
    // reads. Naming the table is the difference between "add the row" (wrong
    // — Codex verifies the row exists, re-closes, and loops) and "move the
    // row" (right).
    const nearMiss = (filePath: string): string => {
        const found = inputs.unscannedTableHits?.get(filePath) ?? [];
        return found.length > 0
            ? ` — a row for it exists under ${found.join(' and ')}, which this check does not scan`
            : '';
    };

    let missingCoverage = false;
    for (const filePath of inputs.diffFiles) {
        if (HANDOFF_DIFF_EXEMPT_PATHS.has(filePath)) continue;
        if (isPipelineOwnedTaskArtifact(filePath, taskIds)) continue;
        if (bundleHandoffFiles.has(filePath)) continue;
        missingCoverage = true;
        issues.push(`diff→handoff: ${filePath} in diff but not in any bundle handoff${nearMiss(filePath)}`);
    }

    for (const [oldPath, newPath] of renamePairs) {
        if (HANDOFF_DIFF_EXEMPT_PATHS.has(oldPath) && HANDOFF_DIFF_EXEMPT_PATHS.has(newPath)) continue;
        // Either side being a pipeline-owned task artifact is enough — pipeline
        // artifacts move within/between task dirs all the time (e.g., archive
        // moves) and never belong in a handoff Changes table.
        if (isPipelineOwnedTaskArtifact(oldPath, taskIds) || isPipelineOwnedTaskArtifact(newPath, taskIds)) continue;
        if (bundleHandoffFiles.has(oldPath) || bundleHandoffFiles.has(newPath)) continue;
        missingCoverage = true;
        issues.push(`diff→handoff: rename ${oldPath} → ${newPath} — neither path in any bundle handoff${nearMiss(newPath) || nearMiss(oldPath)}`);
    }

    if (missingCoverage) {
        issues.push(
            `diff→handoff: coverage rows are read only from ${HANDOFF_COVERAGE_SURFACES} — ` +
            `rows under any other heading or column layout are invisible to this check.`,
        );
    }

    return issues;
}

export function verifyBaseDriftFromData(
    diffFiles: readonly string[],
    allowedPaths: ReadonlySet<string>,
    taskIds: readonly string[],
    allowedPrefixes: readonly string[] = [],
): string[] {
    const drift: string[] = [];
    for (const filePath of diffFiles) {
        if (allowedPaths.has(filePath)) continue;
        if (allowedPrefixes.some(prefix => filePath.startsWith(prefix))) continue;
        if (taskIds.some(taskId => filePath === `tasks/${taskId}` || filePath.startsWith(`tasks/${taskId}/`))) continue;
        drift.push(filePath);
    }
    return drift;
}

export function parseDiffNameStatus(stdout: string): { diffFiles: string[]; renamePairs: Array<[string, string]> } {
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
    const allHandoffPaths = [...new Set([...handoffFilesByTask.values()].flat())];
    const gitIgnoredHandoffFiles = filterGitIgnoredPaths(allHandoffPaths, cwd);
    const unscannedTableHits = new Map<string, string[]>();
    for (const taskId of taskIds) {
        let content: string;
        try {
            content = fs.readFileSync(path.join(taskDirFor(taskId), 'handoff.md'), 'utf8');
        } catch {
            continue;
        }
        for (const [filePath, found] of collectUnscannedTableHits(content)) {
            const existing = unscannedTableHits.get(filePath) ?? [];
            for (const where of found) {
                if (!existing.includes(where)) existing.push(where);
            }
            unscannedTableHits.set(filePath, existing);
        }
    }
    return verifyHandoffAgainstDiffFromData(taskIds, {
        diffFiles,
        renamePairs,
        handoffFilesByTask,
        gitIgnoredHandoffFiles,
        unscannedTableHits,
    });
}

export function verifyBaseDrift(
    taskIds: string[],
    baseBranch: string,
    cwd: string,
): { drift: string[]; fetchFailed: boolean; diffFailed: boolean; diffError?: string } {
    const fetchResult = gitSafeAt(cwd, 'fetch', 'origin', baseBranch);
    if (!fetchResult.ok) {
        warn(
            `Could not fetch origin/${baseBranch} (${fetchResult.stderr.trim() || 'unknown'}). ` +
            `Skipping base-drift check — re-run --pr when network access is restored if you want this verified.`,
        );
        return { drift: [], fetchFailed: true, diffFailed: false };
    }

    const driftResult = getTreeDriftFiles(`origin/${baseBranch}`, cwd);
    if (!driftResult.ok) {
        return { drift: [], fetchFailed: false, diffFailed: true, diffError: driftResult.stderr };
    }

    const allowedPaths = new Set<string>(PIPELINE_TELEMETRY_FILES);
    const allowedPrefixes: string[] = [];
    for (const taskId of taskIds) {
        const parsed = parseAffectedFilesFromSpec(taskId);
        for (const filePath of parsed.files) {
            // Trailing-slash entries are directory-form scope (e.g., `dist/` covers
            // `dist/cli/index.js`). Kept with the slash so prefix matching is
            // boundary-correct: `dist/` does not accept `dist-other/foo`.
            if (filePath.endsWith('/')) {
                allowedPrefixes.push(filePath);
            } else {
                allowedPaths.add(filePath);
            }
        }
        for (const malformed of parsed.malformed) {
            warn(`${taskId} spec.md Affected Files row malformed: ${malformed.reason}`);
        }

        // QA's "Docs Freshness" sweep promotes lessons into PIPELINE_MANAGED_DOCS.
        // The promotion target is downstream of what the spec author could have
        // predicted, so once qa is done, auto-allowlist managed docs to avoid
        // forcing a spec backfill before --pr.
        try {
            if (readStatus(taskId).phases.qa?.status === 'done') {
                for (const doc of PIPELINE_MANAGED_DOCS) {
                    allowedPaths.add(doc);
                }
            }
        } catch {
            // readStatus failures (missing/malformed status.json) leave the
            // pre-QA allowlist in place — strictly safer than auto-widening.
        }
    }

    return {
        drift: verifyBaseDriftFromData(driftResult.files, allowedPaths, taskIds, allowedPrefixes),
        fetchFailed: false,
        diffFailed: false,
    };
}

export function verifyBaseDivergenceFromData(
    commits: readonly { sha: string; subject: string }[],
): string {
    if (commits.length === 0) return '';
    const noun = commits.length === 1 ? 'commit' : 'commits';
    return [
        `Base divergence detected: ${commits.length} colliding ${noun} on <base> not yet on origin/<base>; they will collide when <base> is pulled:`,
        ...commits.map(commit => `  ${commit.sha.slice(0, 7)}  ${commit.subject}`),
        'Fix: git push origin <base>',
        'Override: rerun with --allow-divergent-base to skip this commit-divergence check only.',
    ].join('\n');
}

export function verifyBaseDivergence(
    baseBranch: string,
    cwd: string,
): { commits: { sha: string; subject: string }[]; ok: boolean; stderr: string; fetchFailed: boolean } {
    const fetchResult = gitSafeAt(cwd, 'fetch', 'origin', baseBranch);
    if (!fetchResult.ok) {
        if (!fs.existsSync(cwd)) {
            return { commits: [], ok: false, stderr: fetchResult.stderr, fetchFailed: false };
        }
        warn(
            `Could not fetch origin/${baseBranch} (${fetchResult.stderr.trim() || 'unknown'}). ` +
            `Skipping base-divergence check — re-run when network access is restored if you want this verified.`,
        );
        return { commits: [], ok: true, stderr: '', fetchFailed: true };
    }

    const result = getUnpushedBaseCommits(baseBranch, cwd);
    if (!result.ok) {
        return { commits: result.commits, ok: false, stderr: result.stderr, fetchFailed: false };
    }
    return { commits: result.commits, ok: true, stderr: '', fetchFailed: false };
}

export type SharedDocClass = 'managed' | 'telemetry';

export type SharedDocClassification =
    | { verdict: 'clean' }
    | { verdict: 'preserve'; suffix: string }
    | { verdict: 'abort'; reason: string };

export function classifySharedDocDirtFromData(
    docClass: SharedDocClass,
    porcelainCode: string | null,
    headContent: string | null,
    workingContent: string | null,
): SharedDocClassification {
    if (porcelainCode === null) {
        return { verdict: 'clean' };
    }
    if (porcelainCode !== ' M') {
        return {
            verdict: 'abort',
            reason: `git status shows this path as '${porcelainCode.trim()}' — only a plain unstaged modification ` +
                'is eligible for preservation; staged changes, deletions, untracked files, and renames abort',
        };
    }
    if (workingContent === null) {
        return {
            verdict: 'abort',
            reason: 'present on disk but not readable at HEAD (untracked?) — cannot verify pure-append safety',
        };
    }
    if (headContent !== null && workingContent === headContent) {
        return { verdict: 'clean' };
    }
    if (docClass === 'managed') {
        return {
            verdict: 'abort',
            reason: headContent === null
                ? 'present on disk but not readable at HEAD (untracked?) — cannot verify it is safe to leave in place'
                : 'has uncommitted edits',
        };
    }
    if (headContent === null) {
        return {
            verdict: 'abort',
            reason: 'present on disk but not readable at HEAD (untracked?) — cannot verify pure-append safety',
        };
    }
    if (workingContent.startsWith(headContent)) {
        return { verdict: 'preserve', suffix: workingContent.slice(headContent.length) };
    }
    return {
        verdict: 'abort',
        reason: 'uncommitted edits are not a pure append over HEAD content — cannot safely preserve',
    };
}

export type SharedDocEntryInput = {
    relPath: string;
    docClass: SharedDocClass;
    porcelainCode: string | null;
    headContent: string | null;
    workingContent: string | null;
};

export type SharedDocSetVerdict =
    | { ok: true; preserve: { relPath: string; suffix: string }[] }
    | { ok: false; abortedFiles: { relPath: string; reason: string }[] };

export function classifySharedDocSetFromData(entries: readonly SharedDocEntryInput[]): SharedDocSetVerdict {
    const preserve: { relPath: string; suffix: string }[] = [];
    const abortedFiles: { relPath: string; reason: string }[] = [];

    for (const entry of entries) {
        const result = classifySharedDocDirtFromData(
            entry.docClass,
            entry.porcelainCode,
            entry.headContent,
            entry.workingContent,
        );
        if (result.verdict === 'abort') {
            abortedFiles.push({ relPath: entry.relPath, reason: result.reason });
        } else if (result.verdict === 'preserve') {
            preserve.push({ relPath: entry.relPath, suffix: result.suffix });
        }
    }

    if (abortedFiles.length > 0) return { ok: false, abortedFiles };
    return { ok: true, preserve };
}

export function buildSharedDocAbortMessage(abortedFiles: readonly { relPath: string; reason: string }[]): string {
    const list = abortedFiles.map(file => `  - ${file.relPath}: ${file.reason}`).join('\n');
    return [
        '--ship aborted: uncommitted shared-doc edits could not be safely resolved before merging:',
        list,
        '',
        'Recovery: commit or stash your edits, then re-run --ship.',
        '--force does not bypass this gate.',
    ].join('\n');
}
