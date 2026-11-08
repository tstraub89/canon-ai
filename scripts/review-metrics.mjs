#!/usr/bin/env node
// Round-1 code-review metrics: what the first code_review round caught in each
// archived task, by finding category and failure kind. Round 1 is the only
// round that reflects what the implementer produced from its prompt context;
// later rounds measure fix-after-feedback. canon-ai-local, not shipped.
//
// Usage: node scripts/review-metrics.mjs [--dir tasks/_archive] [--since YYYY-MM-DD]
//                                         [--by month|version] [--tasks] [--untagged] [--json]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dir = opt('--dir', 'tasks/_archive');
const since = opt('--since', null);
const groupBy = opt('--by', 'month');

const BLOCKING = ['correctness', 'risk', 'specGap'];

// Keyword heuristics for the failure kinds seen in past reviews. Deliberately
// rough: --untagged prints what fell through so the rules can be tuned.
const KINDS = {
    restatement: /still (says|reads|names|describes|lists|claims|mentions|documents)|stale|restat|\bmirror|help (text|line)|out of (date|sync)|not updated|no longer (true|accurate|matches)|contradict|misdescribe|never mentions|doc(s)? (now )?(say|describe|claim)/i,
    sibling: /sibling|\bunlike\b|the other (path|branch|caller|site|command|mode)|parity|asymmetr|same (check|guard|class)|bypass|skips? the (gate|guard|check)|every\(\)|some\(\)|(doesn't|does not) use the|inconsisten|collides/i,
    callerImpact: /unreachable|never (reached|runs|fires)|every [^ ]+ caller|callers?\b|consumers?\b|reads? the removed|outside [^ ]+ reads/i,
    testIntegrity: /test integrity|wrong reason|\bloose|vacuous|tautolog|does(n't| not) (exercise|assert|cover|pin)|not (asserted|pinned|exercised)|coverage gap|no (test|regression test|coverage)|untested|would (still )?pass/i,
};

const CHECKED_VERDICT = /^- \[x\] \*{0,2}(Approved with nits|Approved|Changes requested|Spec gap)\b/m;

function categorize(heading) {
    const h = heading.toLowerCase();
    if (/dismissed/.test(h)) return null;
    if (/correctness|code-bug/.test(h)) return 'correctness';
    if (/risk|guardrail/.test(h)) return 'risk';
    if (/spec[ -]gap/.test(h)) return 'specGap';
    if (/nit|cleanup/.test(h)) return 'nit';
    return null;
}

// A section heading names a category ("#### Risk / Guardrails (non-blocking)"); a finding
// heading carries the finding itself ("### 1. correctness bug — X", "### Correctness bug — X").
function isFindingHeading(heading) {
    const bare = heading.replace(/\([^)]*\)/g, '').trim();
    return /^\d+\.\s/.test(bare) || /\s[—–]\s|:\s/.test(bare);
}

// Round 1 = the first complete review in the file. If an unnumbered review with a checked
// verdict precedes the first `## Round N` heading, that is round 1; otherwise a leading
// `## Round 1` block is.
function roundOne(text) {
    const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/^```[\s\S]*?^```/gm, '');
    const rounds = [...clean.matchAll(/^## Round (\d+)\b/gm)];
    if (!rounds.length) return clean;
    const prefix = clean.slice(0, rounds[0].index);
    if (CHECKED_VERDICT.test(prefix) || rounds[0][1] !== '1') return prefix;
    return clean.slice(rounds[0].index, rounds[1]?.index ?? clean.length);
}

// An explicit label at the start of an item, for findings listed under a generic `### Findings`.
const labelOf = t => {
    const m = t.match(/^\**\[?`?(code-bug|correctness bug|risk\/guardrail|spec[ -]gap|optional cleanup\/nit|nit)\b/i)
        ?? t.match(/^\*\*[^*]{0,40}?`(code-bug|risk\/guardrail|spec-gap)`/i);
    return m ? categorize(m[1]) : null;
};
const NON_BLOCKING = /non-blocking|not blocking|not a blocker|none blocking/i;
// Review IDs like F1, N-2, CB-1, SG-3 mark finding starts when a section uses them.
const ID_LEAD = /^\*\*\[?[A-Z]{1,3}-?\d+\b/;

// Bold-lead paragraphs like "**Fix**:" or "**Evidence:**" are finding detail, not findings.
const isDetailLead = t => /^\*\*[A-Za-z][\w /-]{0,20}(:\*\*|\*\*:)/.test(t);

function parseReview(text) {
    const r1 = roundOne(text);
    const findings = [];
    // Collect the candidate finding starts per section, then decide which shape the section uses.
    let section = null;
    const flush = () => {
        if (!section) return;
        const ided = section.items.filter(i => ID_LEAD.test(i.text));
        const bold = section.items.filter(i => i.bold);
        // Prefer ID-led items, then bold-led ones; the rest are supporting detail.
        const starts = ided.length ? ided : bold.length ? bold : section.items;
        for (const i of starts) {
            const category = section.category ?? labelOf(i.text);
            if (category) findings.push({ category, text: i.text, nonBlocking: section.nonBlocking });
        }
        section = null;
    };
    let prevBlank = true;
    for (const line of r1.split('\n')) {
        const h = line.match(/^#{2,4} (.+)$/);
        if (h) {
            flush();
            const cat = categorize(h[1]);
            if (cat && isFindingHeading(h[1])) findings.push({ category: cat, text: h[1].replace(/^\d+\.\s+/, '').trim() });
            else if (cat) section = { category: cat, items: [], nonBlocking: NON_BLOCKING.test(h[1]) };
            // A generic findings heading: keep only items that carry their own label.
            else if (/findings/i.test(h[1]) && !/dismissed|verifying/i.test(h[1])) section = { category: null, items: [], nonBlocking: false };
            prevBlank = true;
            continue;
        }
        if (section) {
            // A section-wide note such as "None blocking. Optional items below." applies to every item.
            if (section.items.length === 0 && NON_BLOCKING.test(line) && !/^(?:[-*]|\d+\.) /.test(line)) section.nonBlocking = true;
            const item = line.match(/^(?:[-*]|\d+\.) (.+)$/);
            const para = prevBlank && /^\*\*/.test(line) ? line : null;
            const t = (item ? item[1] : para ?? '').trim();
            if (t && !/^\[[ x]\]/.test(t) && !/^(_?none\b|n\/a\b|\(none)/i.test(t) && !isDetailLead(t) && !/not a finding/i.test(t)) {
                section.items.push({ text: t, bold: /^\*\*/.test(t) });
            }
        }
        prevBlank = line.trim() === '';
    }
    flush();
    for (const f of findings) {
        f.kinds = Object.entries(KINDS).filter(([, re]) => re.test(f.text)).map(([k]) => k);
    }
    const missedAcs = r1.split('\n').filter(l => {
        if (!/^\| *\*{0,2}AC/i.test(l)) return false;
        const status = (l.split('|')[2] ?? '').trim();
        if (/\//.test(status)) return false; // template header rows like "Met / Partial / Not Met"
        return /not met|fail|partial/i.test(status);
    }).length;
    const stage1Raw = r1.match(/Stage 1 Verdict[\s\S]*?^- \[x\] \*\*(Pass|Fail)\*\*/im)?.[1]
        ?? r1.match(/Stage 1 verdict:?\**:?\s*\**\s*(pass|fail)\b/i)?.[1];
    const stage1 = stage1Raw ? stage1Raw[0].toUpperCase() + stage1Raw.slice(1).toLowerCase() : null;
    const verdict = r1.match(CHECKED_VERDICT)?.[1] ?? null;
    // A review counts as completed only when it carries a checked verdict; unfilled templates don't.
    return { findings, missedAcs, stage1, verdict, parsed: verdict !== null || stage1 !== null };
}

function readTask(taskDir) {
    const reviewPath = path.join(taskDir, 'review.md');
    if (!fs.existsSync(reviewPath)) return null;
    let status = {};
    try { status = JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8')); } catch { /* optional */ }
    const review = parseReview(fs.readFileSync(reviewPath, 'utf8'));
    // Reviewers sometimes park explicitly non-blocking items under Risk / Spec Gaps; count those as nits.
    const isBlocking = f => BLOCKING.includes(f.category) && !f.nonBlocking && !NON_BLOCKING.test(f.text);
    const blocking = review.findings.filter(isBlocking);
    const count = cat => (cat === 'nit'
        ? review.findings.filter(f => !isBlocking(f))
        : blocking.filter(f => f.category === cat)).length;
    const kindCount = k => blocking.filter(f => f.kinds.includes(k)).length;
    return {
        id: path.basename(taskDir),
        created: (status.created ?? '').slice(0, 10),
        version: status.canon?.canon_version ?? '?',
        size: (status.task_size ?? '?') + (status.delicate ? '*' : ''),
        implementer: status.phases?.implement?.agent ?? '?',
        parsed: review.parsed,
        stage1: review.stage1,
        verdict: review.verdict,
        missedAcs: review.missedAcs,
        correctness: count('correctness'),
        risk: count('risk'),
        specGap: count('specGap'),
        nit: count('nit'),
        blocking: blocking.length,
        restatement: kindCount('restatement'),
        sibling: kindCount('sibling'),
        testIntegrity: kindCount('testIntegrity'),
        callerImpact: kindCount('callerImpact'),
        untagged: blocking.filter(f => f.kinds.length === 0).map(f => f.text),
    };
}

const tasks = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => readTask(path.join(dir, d.name)))
    .filter(Boolean)
    .filter(t => !since || (t.created && t.created >= since))
    .sort((a, b) => a.created.localeCompare(b.created));

const parsed = tasks.filter(t => t.parsed);
const unparsed = tasks.filter(t => !t.parsed);

const groupKey = t => groupBy === 'month'
    ? (t.created.slice(0, 7) || '?')
    : (t.version.split('.').slice(0, 2).join('.') || '?');
const groups = new Map();
for (const t of parsed) {
    const k = groupKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
}
const per = (list, field) => (list.reduce((s, t) => s + t[field], 0) / list.length).toFixed(2);
const pct = (list, pred) => (list.length ? `${Math.round((100 * list.filter(pred).length) / list.length)}%` : 'n/a');
const rollupRow = (label, list) => ({
    group: label,
    tasks: list.length,
    blockingPerTask: per(list, 'blocking'),
    correctness: per(list, 'correctness'),
    risk: per(list, 'risk'),
    specGap: per(list, 'specGap'),
    restatement: per(list, 'restatement'),
    sibling: per(list, 'sibling'),
    testIntegrity: per(list, 'testIntegrity'),
    callerImpact: per(list, 'callerImpact'),
    untagged: (list.reduce((s, t) => s + t.untagged.length, 0) / list.length).toFixed(2),
    missedAcs: per(list, 'missedAcs'),
    stage1Fail: pct(list.filter(t => t.stage1), t => t.stage1 === 'Fail'),
    stage1Unknown: list.filter(t => !t.stage1).length,
    changesRequested: pct(list.filter(t => t.verdict), t => t.verdict === 'Changes requested' || t.verdict === 'Spec gap'),
});
const rollup = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([k, list]) => rollupRow(k, list));
if (parsed.length) rollup.push(rollupRow('ALL', parsed));

const table = rows => {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    return [
        `| ${cols.join(' | ')} |`,
        `|${cols.map(() => '---').join('|')}|`,
        ...rows.map(r => `| ${cols.map(c => r[c]).join(' | ')} |`),
    ].join('\n');
};

// No process.exit after writing: it can truncate piped stdout before the write drains.
if (flag('--json')) {
    process.stdout.write(JSON.stringify({ rollup, tasks, unparsed: unparsed.map(t => t.id) }, null, 2) + '\n');
} else {
    console.log(`# Round-1 code_review metrics (${dir}${since ? `, since ${since}` : ''})\n`);
    console.log(`${parsed.length} tasks parsed, ${unparsed.length} without a checked verdict (unfilled or unrecognized).`);
    console.log('Per-task means; stage1Fail is over tasks with a recognized Stage 1 verdict; kind tags count blocking findings (correctness + risk + spec gap) and may overlap.\n');
    console.log(`## By ${groupBy}\n`);
    console.log(table(rollup));

    if (flag('--tasks')) {
        console.log('\n## Tasks\n');
        console.log(table(parsed.map(({ untagged: _u, parsed: _p, ...t }) => t)));
    }
    if (flag('--untagged')) {
        console.log('\n## Untagged blocking findings\n');
        for (const t of parsed) for (const u of t.untagged) console.log(`- ${t.id}: ${u.slice(0, 200)}`);
    }
    if (unparsed.length) console.log(`\nUnparsed: ${unparsed.map(t => t.id).join(', ')}`);
}
