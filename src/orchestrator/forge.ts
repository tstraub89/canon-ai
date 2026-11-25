import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as splitGit from './git.js';
import type { ShipMergeMethod } from './docs-freshness.js';
import type { CommandResult } from './types.js';

export type ExactPRLookup = { kind: 'found'; number: number } | { kind: 'none' } | { kind: 'unreadable'; reason: string };
export type PRFields = { state: 'OPEN' | 'CLOSED' | 'MERGED' | null; headSha: string | null; baseRef: string | null; url: string | null };
export type GhRunner = (argv: string[]) => CommandResult;
export type GitLogRunner = (...args: string[]) => CommandResult;
export type OriginUrlReader = () => CommandResult;
const defaultRunner: GhRunner = argv => splitGit.runCommand('gh', argv);
const defaultGitLogRunner: GitLogRunner = (...args) => splitGit.gitSafe(...args);
const defaultOriginUrlReader: OriginUrlReader = () => splitGit.gitSafe('remote', 'get-url', 'origin');
let runner = defaultRunner;
let gitLogRunner = defaultGitLogRunner;
let originUrlReader = defaultOriginUrlReader;
const ghHostKnown = new Map<string, boolean>();

export function setGhRunnerForTest(next: GhRunner | null): void { runner = next ?? defaultRunner; ghHostKnown.clear(); }
export function setGitLogRunnerForTest(next: GitLogRunner | null): void { gitLogRunner = next ?? defaultGitLogRunner; }
export function setOriginUrlReaderForTest(next: OriginUrlReader | null): void { originUrlReader = next ?? defaultOriginUrlReader; ghHostKnown.clear(); }
export function parseRemoteHost(url: string): string | null {
    const value = url.trim();
    if (!value) return null;
    const scheme = value.match(/^(?:https?|ssh):\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d*)?(?:[/?#]|$)/i);
    if (scheme?.[1]) return scheme[1].toLowerCase();
    if (value.includes('://')) return null;
    const scp = value.match(/^(?:[^@/:]+@)?([^/:]+):(?!\/)/);
    return scp?.[1] ? scp[1].toLowerCase() : null;
}
function originHost(): string | null {
    const result = originUrlReader();
    return result.ok ? parseRemoteHost(result.stdout) : null;
}
function normaliseGhHost(host: string): string {
    const value = host.toLowerCase();
    return value === 'github.com' || value.endsWith('.github.com') ? 'github.com' : value;
}
function apiHost(): string | null {
    const raw = originHost();
    if (!raw) return null;
    const host = normaliseGhHost(raw);
    let known = ghHostKnown.get(host);
    if (known === undefined) {
        // gh auth token is an offline credential probe; discard both token output and errors.
        known = runner(['auth', 'token', '--hostname', host]).ok;
        ghHostKnown.set(host, known);
    }
    return known ? host : null;
}
// gh resolves {owner}/{repo} from its base-repo selection, but its API host defaults independently.
// Normalise github.com subdomains and pin origin's host only when gh auth recognises it.
function ghApi(argv: string[]): CommandResult {
    const host = apiHost();
    return runner(['api', ...(host ? ['--hostname', host] : []), ...argv]);
}
const REPO = 'repos/{owner}/{repo}';
const MERGE_ALLOWED_FIELD: Record<ShipMergeMethod, string> = { squash: 'allow_squash_merge', rebase: 'allow_rebase_merge', merge: 'allow_merge_commit' };
function isMergedAt(value: unknown): boolean { return typeof value === 'string' && value.length > 0; }
function object(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function fieldString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function encodeQuery(value: string): string { return encodeURIComponent(value).replace(/%2F/gi, '/'); }

export function parseAllowedMergeMethods(stdout: string): { ok: true; allowed: Record<ShipMergeMethod, boolean> } | { ok: false } {
    let parsed: unknown;
    try { parsed = JSON.parse(stdout); } catch { return { ok: false }; }
    const record = object(parsed);
    if (!record) return { ok: false };
    const allowed = {} as Record<ShipMergeMethod, boolean>;
    for (const method of Object.keys(MERGE_ALLOWED_FIELD) as ShipMergeMethod[]) {
        const value = record[MERGE_ALLOWED_FIELD[method]];
        if (typeof value !== 'boolean') return { ok: false };
        allowed[method] = value;
    }
    return { ok: true, allowed };
}

export function lookupPRByBranch(branch: string, baseBranch: string | null, state: 'open' | 'merged' | 'closed'): ExactPRLookup {
    const query = `state=${state === 'open' ? 'open' : 'closed'}&head={owner}%3A${encodeQuery(branch)}` +
        (baseBranch === null ? '' : `&base=${encodeQuery(baseBranch)}`) + '&per_page=100';
    const result = ghApi(['-X', 'GET', '--paginate', '--jq', '.[]', `${REPO}/pulls?${query}`]);
    const prefix = 'GitHub REST pull-request listing';
    if (!result.ok) return { kind: 'unreadable', reason: result.stderr.trim() || `${prefix} (gh api) exited unsuccessfully` };
    const output = result.stdout.trim();
    if (!output) return { kind: 'none' };
    const entries: unknown[] = [];
    for (const line of output.split(/\r?\n/)) {
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { return { kind: 'unreadable', reason: `${prefix} returned malformed JSON` }; }
        if (!object(parsed)) return { kind: 'unreadable', reason: `${prefix} did not return a JSON object per result` };
        entries.push(parsed);
    }
    for (const raw of entries) {
        const entry = object(raw);
        const head = object(entry?.head);
        const base = object(entry?.base);
        if (!entry || head?.ref !== branch || typeof entry.number !== 'number') continue;
        if (baseBranch !== null && base?.ref !== baseBranch) continue;
        if (state === 'open' ? entry.state !== 'open' : state === 'merged' ? !isMergedAt(entry.merged_at) : entry.state !== 'closed' || isMergedAt(entry.merged_at)) continue;
        return { kind: 'found', number: entry.number };
    }
    return { kind: 'none' };
}

export function readPR(prNum: number): { ok: true; pr: PRFields } | { ok: false } {
    const result = ghApi(['-X', 'GET', `${REPO}/pulls/${prNum}`]);
    if (!result.ok) return { ok: false };
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch { return { ok: false }; }
    const record = object(parsed);
    if (!record) return { ok: false };
    const state = record.state === 'open' ? 'OPEN' : record.state === 'closed' ? (isMergedAt(record.merged_at) ? 'MERGED' : 'CLOSED') : null;
    return { ok: true, pr: { state, headSha: fieldString(object(record.head)?.sha), baseRef: fieldString(object(record.base)?.ref), url: fieldString(record.html_url) } };
}

export function isPRMerged(prNum: number): boolean { const result = readPR(prNum); return result.ok && result.pr.state === 'MERGED'; }
export function mergePR(prNum: number, method: ShipMergeMethod): CommandResult { return ghApi(['-X', 'PUT', `${REPO}/pulls/${prNum}/merge`, '-f', `merge_method=${method}`]); }
export function readAllowedMergeMethods(): { ok: true; allowed: Record<ShipMergeMethod, boolean> } | { ok: false } {
    const result = ghApi(['-X', 'GET', REPO]);
    return result.ok ? parseAllowedMergeMethods(result.stdout) : { ok: false };
}

export function createDraftPR(options: { base: string; head: string; title: string; body: string }): { ok: true; number: number | null; url: string | null } | { ok: false; stderr: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-pr-'));
    const payloadPath = path.join(dir, 'payload.json');
    try {
        fs.writeFileSync(payloadPath, JSON.stringify({ ...options, draft: true }), 'utf8');
        const result = ghApi(['-X', 'POST', `${REPO}/pulls`, '--input', payloadPath]);
        if (!result.ok) return { ok: false, stderr: result.stderr };
        try {
            const record = object(JSON.parse(result.stdout));
            return { ok: true, number: typeof record?.number === 'number' ? record.number : null, url: fieldString(record?.html_url) };
        } catch { return { ok: true, number: null, url: null }; }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function commitSubjectsBody(branch: string, baseBranch: string): { ok: true; body: string } | { ok: false; reason: string } {
    const result = gitLogRunner('log', '--reverse', '--format=%s', `origin/${baseBranch}..${branch}`);
    if (!result.ok) return { ok: false, reason: result.stderr || 'git log failed' };
    return { ok: true, body: result.stdout.split('\n').map(line => line.trim()).filter(Boolean).map(subject => `- ${subject}`).join('\n') };
}
