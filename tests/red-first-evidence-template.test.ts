import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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
