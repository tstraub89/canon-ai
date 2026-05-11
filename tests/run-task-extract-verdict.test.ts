import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCheckedVerdict } from '../scripts/run-task/main.js';

void test('extractCheckedVerdict: single-round review returns the checked verdict', () => {
    const content = [
        '# Code Review',
        '',
        '## Final Verdict',
        '',
        '- [x] **Approved**',
        '- [ ] **Approved with nits**',
        '- [ ] **Changes requested**',
        '- [ ] **Needs re-review**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'approved');
});

void test('extractCheckedVerdict: multi-round — latest round Changes Requested overrides earlier Approved', () => {
    const content = [
        '# Code Review',
        '',
        '## Final Verdict',
        '',
        '- [x] **Approved**',
        '- [ ] **Changes requested**',
        '',
        '## Round 2 — verifying iteration 2',
        '',
        '### Verdict for this round',
        '',
        '- [ ] **Approved**',
        '- [x] **Changes requested**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'changes_requested');
});

void test('extractCheckedVerdict: multi-round — latest round Approved overrides earlier Changes Requested', () => {
    const content = [
        '## Final Verdict',
        '',
        '- [ ] **Approved**',
        '- [x] **Changes requested**',
        '',
        '## Round 2',
        '',
        '### Verdict',
        '',
        '- [x] **Approved**',
        '- [ ] **Changes requested**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'approved');
});

void test('extractCheckedVerdict: three rounds, latest wins', () => {
    const content = [
        '## Final Verdict',
        '',
        '- [x] **Changes requested**',
        '',
        '## Round 2',
        '',
        '- [x] **Approved**',
        '',
        '## Round 3',
        '',
        '- [x] **Needs re-review**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'needs_re_review');
});

void test('extractCheckedVerdict: no verdict checked returns null', () => {
    const content = [
        '## Final Verdict',
        '',
        '- [ ] **Approved**',
        '- [ ] **Changes requested**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), null);
});

void test('extractCheckedVerdict: latest Round section with no checked verdict returns null even if earlier round had one', () => {
    const content = [
        '## Final Verdict',
        '',
        '- [x] **Approved**',
        '',
        '## Round 2',
        '',
        '### Verdict',
        '',
        '- [ ] **Approved**',
        '- [ ] **Changes requested**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), null, 'latest round has no checked box — must not fall through to earlier round');
});

// ─── Codex P1 regression: HTML-commented template placeholders must not match ───

void test('extractCheckedVerdict: HTML-commented ## Round N placeholder in template does NOT shadow real verdict', () => {
    // This mirrors the actual review.md template shape: top-level Stage 1 / Stage 2 / Final
    // Verdict for round 1, plus an HTML comment block containing a `## Round N` placeholder
    // for future re-review rounds. Without the comment-skip, the placeholder becomes the
    // "latest" round and we'd never see the real approved verdict.
    const content = [
        '# Code Review: x',
        '',
        '## Stage 1 — Spec Compliance (gate)',
        '',
        '### Stage 1 Verdict',
        '',
        '- [x] **Pass**',
        '',
        '## Final Verdict',
        '',
        '- [x] **Approved**',
        '- [ ] **Approved with nits**',
        '- [ ] **Changes requested**',
        '- [ ] **Needs re-review**',
        '',
        '---',
        '',
        '<!--',
        'On re-review, append below this line:',
        '',
        '## Round N — verifying iteration N\'s response to round N-1',
        '',
        '### Verdict for this round',
        '',
        '- [ ] Approved',
        '- [ ] Changes requested',
        '-->',
        '',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'approved');
});

void test('extractCheckedVerdict: real ## Round 2 after HTML-commented placeholder still wins', () => {
    // Multi-round: comment placeholder is present AND a real Round 2 was appended.
    // Latest real round must still be returned.
    const content = [
        '## Final Verdict',
        '',
        '- [x] **Approved**',
        '',
        '<!--',
        '## Round N — placeholder',
        '- [ ] **Approved**',
        '-->',
        '',
        '## Round 2 — actual re-review',
        '',
        '### Verdict for this round',
        '',
        '- [ ] **Approved**',
        '- [x] **Changes requested**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'changes_requested');
});

// ─── Codex PR #36 P2 regression: unbolded template checkboxes ───

void test('extractCheckedVerdict: round-N template uses unbolded checkboxes (template inconsistency)', () => {
    // The `## Round N` re-review template ships with unbolded labels
    // (- [x] Approved), unlike round-1's bolded `## Final Verdict` template.
    // Pre-fix regex required bold and silently failed on populated re-reviews.
    const content = [
        '## Final Verdict',
        '',
        '- [ ] **Approved**',
        '- [x] **Changes requested**',
        '',
        '## Round 2 — verifying iteration 2',
        '',
        '### Verdict for this round',
        '',
        '- [x] Approved',
        '- [ ] Approved with nits',
        '- [ ] Changes requested',
        '- [ ] Needs re-review',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'approved');
});

void test('extractCheckedVerdict: unbolded "Approved with nits" must not be shadowed by plain "Approved"', () => {
    const content = [
        '## Round 2',
        '',
        '- [ ] Approved',
        '- [x] Approved with nits',
        '- [ ] Changes requested',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'approved_with_nits');
});

void test('extractCheckedVerdict: bolded "Approved with nits" also wins over plain Approved (regression)', () => {
    const content = [
        '## Final Verdict',
        '',
        '- [ ] **Approved**',
        '- [x] **Approved with nits**',
        '- [ ] **Changes requested**',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'approved_with_nits');
});

void test('extractCheckedVerdict: unbolded Needs re-review in round-N', () => {
    const content = [
        '## Round 2',
        '',
        '- [ ] Approved',
        '- [x] Needs re-review',
    ].join('\n');
    assert.equal(extractCheckedVerdict(content), 'needs_re_review');
});
