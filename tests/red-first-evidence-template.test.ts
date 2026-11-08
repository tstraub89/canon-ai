import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseTable, parseTableH3 } from '../src/orchestrator/markdown-table.js';
import { extractCheckedVerdict } from '../src/orchestrator/validation.js';

const read = (file: string): string => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const columns = '| AC | Command | Ran against | Pre-fix failure | Post-fix result |';

void test('handoff template defines baseline and iteration red-first evidence', () => {
    const handoff = read('.canon/templates/handoff.md');
    assert.equal((handoff.match(/^## Red-First Evidence$/gm) ?? []).length, 1);
    assert.ok(handoff.indexOf('## Blockers') < handoff.indexOf('## Red-First Evidence'));
    assert.ok(handoff.indexOf('## Red-First Evidence') < handoff.indexOf('## Validation Outcomes'));
    assert.ok(handoff.includes(columns));
    assert.match(handoff, /none — no red-first ACs/);
    assert.match(handoff, /\[wrong-premise\]/);
    assert.match(handoff, /\[ambiguity\]/);
    const comment = handoff.slice(handoff.indexOf('<!--'));
    assert.match(comment, /### Red-First Evidence/);
    assert.ok(comment.includes(columns));
});

void test('anchored charter checks red-first evidence and review template gates it', () => {
    const charter = read('.claude/agents/code-review-anchored.md');
    const stage1 = charter.split('## Stage 2')[0];
    assert.match(stage1, /Red-First Evidence/);
    assert.match(stage1, /\[wrong-premise\]/);
    assert.match(stage1, /pre-fix/);
    assert.doesNotMatch(stage1, /implement(?:-revisions|-reroute)?\.md/);

    const review = read('.canon/templates/review.md');
    assert.match(review, /^- \[ \].*red-first evidence/im);
});


void test('handoff Self-Check template defines all baseline rows and whole-branch iteration supersession', () => {
    const handoff = read('.canon/templates/handoff.md');
    assert.deepEqual(parseTable(handoff, 'Self-Check').map(row => row.Check), ['Test integrity', 'Restatement sweep', 'Sibling parity']);
    assert.ok(parseTable(handoff, 'Self-Check').every(row => /^_\(/.test(row.Evidence)));
    assert.ok(handoff.indexOf('## Red-First Evidence') < handoff.indexOf('## Self-Check'));
    assert.ok(handoff.indexOf('## Self-Check') < handoff.indexOf('## Validation Outcomes'));
    const baseline = handoff.split('## Self-Check\n')[1].split('## Validation Outcomes')[0];
    assert.match(baseline, /N\/A — <reason>/);
    assert.ok(baseline.includes('`\\|`'));
    assert.match(baseline, /same file-citation rule/);
    const iteration = handoff.slice(handoff.indexOf('<!--'));
    assert.ok(iteration.indexOf('### Red-First Evidence') < iteration.indexOf('### Self-Check'));
    assert.ok(iteration.indexOf('### Self-Check') < iteration.indexOf('### Re-run validation'));
    const selfCheck = iteration.split('### Self-Check\n')[1].split('### Re-run validation')[0];
    assert.match(selfCheck, /include only the rows it updates/);
    assert.match(selfCheck, /Each row restates that check's evidence for all work on the branch, not only this round, and supersedes every earlier version of that row/);
});

void test('anchored Self-Check judges only effective rows and routes omissions to Stage 2', () => {
    const charter = read('.claude/agents/code-review-anchored.md');
    const stage1 = charter.split('## Stage 2')[0];
    assert.ok(stage1.indexOf('5. For each AC') < stage1.indexOf('6. Check the Self-Check'));
    const check = stage1.split('6. Check the Self-Check')[1].split('7. If Stage 1 fails')[0];
    assert.match(check, /latest block that has a filled row for that check/);
    assert.match(check, /Iteration row that is empty or still a placeholder supersedes nothing/);
    assert.match(check, /Superseded rows are history and are not judged/);
    assert.match(check, /baseline row reads `N\/A — no tests changed` and a later Iteration row names a behavioral test the revision added, the Iteration row is effective and the baseline `N\/A` is not a gap/);
    assert.match(check, /review round found a baseline row contradicted and the next Iteration row restates corrected evidence, judge only the corrected row/);
    assert.match(check, /Only contradictions are Stage 1 gaps; omissions belong in Stage 2/);
    const stage2 = charter.split('## Stage 2')[1];
    assert.match(stage2, /behavioral test file the diff changes that no Self-Check evidence mentions is a `risk\/guardrail` finding, not a Stage 1 gap/);
});

void test('review template Self-Check checklist follows red-first and preserves parsing', () => {
    const review = read('.canon/templates/review.md');
    assert.match(review, /- \[ \] Red-first evidence[^\n]*\n- \[ \] Self-Check evidence in the effective record is not contradicted by the diff/);
    assert.equal(parseTableH3(review, 'Acceptance Criteria Check').length, 2);
    assert.equal(extractCheckedVerdict(review.replace('- [ ] **Approved**', '- [x] **Approved**')), 'approved');
});
