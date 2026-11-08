import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runClaude } from '../src/orchestrator/agents/claude.js';
import { runCodex } from '../src/orchestrator/agents/codex.js';
import { makePromptArgSafe } from '../src/orchestrator/prompts/helpers.js';

void test('prompt argv escaping leaves ordinary content unchanged and replaces every NUL', () => {
    for (const prompt of ['', 'Review café 🐈\n\\0 literal escape\n', 'line\r\ntwo']) {
        assert.equal(makePromptArgSafe(prompt), prompt);
    }
    assert.equal(makePromptArgSafe('\0before\0after\0'), '\\0before\\0after\\0');
});

void test('agent argv safely preserves a text diff with late NUL bytes across session paths', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prompt-argv-'));
    const previousPath = process.env.PATH;
    try {
        // Git misses binary content when its first NUL is past the initial 8000 bytes.
        const prefix = 'A'.repeat(9000) + '\n';
        fs.writeFileSync(path.join(dir, 'before.pdf'), prefix + 'old\0payload\n');
        fs.writeFileSync(path.join(dir, 'after.pdf'), prefix + 'new\0payload\0\n');
        const diff = spawnSync('git', ['diff', '--no-index', '--', 'before.pdf', 'after.pdf'], {
            cwd: dir, encoding: 'utf8',
        });
        assert.equal(diff.status, 1, diff.stderr);
        assert.ok(diff.stdout.includes('@@'));
        assert.ok(diff.stdout.includes('\0'));
        const prompt = `Review this task diff:\n${diff.stdout}`;
        const expectedPrompt = prompt.replaceAll('\0', '\\0');
        const capture = path.join(dir, 'args.jsonl');
        for (const agent of ['claude', 'codex']) {
            fs.writeFileSync(path.join(dir, agent), [
                '#!/usr/bin/env node',
                `require('node:fs').appendFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
                "if (process.argv.includes('missing-session')) { console.error('No conversation found with session ID'); process.exit(1); }",
                'console.log(JSON.stringify({type: "result", result: ""}));',
            ].join('\n'), { mode: 0o755 });
        }
        process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

        for (const agent of ['claude', 'codex'] as const) {
            for (const scenario of ['fresh', 'resumed', 'interactive', 'interactive-resumed', 'unwrapped', 'fallback'] as const) {
                if (agent === 'codex' && scenario === 'fallback') continue;
                fs.writeFileSync(capture, '');
                const interactive = scenario === 'interactive' || scenario === 'interactive-resumed';
                const resumeId = scenario === 'fallback' ? 'missing-session'
                    : scenario === 'resumed' || scenario === 'interactive-resumed' || scenario === 'unwrapped' ? 'session-id' : null;
                const wrapForResume = scenario !== 'unwrapped';
                if (agent === 'claude') {
                    await runClaude(prompt, interactive, resumeId, 'sonnet', 'medium', '1', undefined, dir, wrapForResume);
                } else {
                    await runCodex(prompt, interactive, resumeId, 'gpt-mini', 'high', undefined, dir, wrapForResume);
                }
                const calls = fs.readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
                assert.equal(calls.length, scenario === 'fallback' ? 2 : 1, `${agent}: ${scenario}`);
                for (const args of calls) {
                    const sentPrompt = agent === 'claude' && !interactive
                        ? args[args.indexOf('-p') + 1] : args.find(arg => arg.includes('Review this task diff:'));
                    assert.ok(sentPrompt?.endsWith(expectedPrompt), `${agent}: ${scenario} must preserve the diff with visible NUL escapes`);
                    assert.ok(args.every(arg => !arg.includes('\0')), `${agent}: ${scenario} must contain no NUL in argv`);
                }
                if (scenario === 'fallback') assert.ok(!calls[1].includes('--resume'));
            }
        }
    } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
