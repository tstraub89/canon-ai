import { REPO_ROOT, config } from '../env.js';
import { info, warn } from '../cli.js';
import { recordMetric } from '../metrics.js';
import { runCommandOrDie } from '../git.js';
import { toResumePrompt } from '../prompts/helpers.js';
import { formatLiveTick, streamProcess } from './stream.js';
import type { ClaudeRunResult } from '../types.js';

export const CLAUDE_RESUME_NOT_FOUND_RE = /No conversation found with session ID/i;

export async function runClaude(
    prompt: string,
    interactive: boolean,
    resumeId: string | null,
    model: string,
    effort: string,
    metricsContext?: { taskId: string; phase: string; iteration?: number },
    cwd = REPO_ROOT,
): Promise<ClaudeRunResult> {
    info(resumeId ? `Calling Claude Code (resuming ${resumeId.slice(0, 8)}...)...` : 'Calling Claude Code...');
    info(`Model: ${model} | Effort: ${effort}`);

    const startMs = Date.now();
    let status: 'ok' | 'failed' = 'ok';
    let tokens: number | undefined;
    let processedText = '';
    let sessionId: string | null = null;

    try {
        if (interactive) {
            console.log('');
            console.log(resumeId ? '─── Resuming interactive Claude session ───' : '─── Opening interactive Claude session ───');
            console.log("Prompt loaded. You're in the driver's seat.");
            console.log('───────────────────────────────────────────');
            console.log('');
            const args = ['--model', model, '--effort', effort, '--add-dir', REPO_ROOT];
            if (cwd !== REPO_ROOT) args.push('--add-dir', cwd);
            if (resumeId) args.push('--resume', resumeId);
            args.push(resumeId ? toResumePrompt(prompt) : prompt);
            runCommandOrDie('claude', args, { cwd });
            return {
                exitCode: 0,
                signal: null,
                spawnError: null,
                stalled: false,
                capturedStdout: '',
                capturedStderr: '',
                sessionId: null,
                processedText: '',
            };
        }

        const attempt = async (useResumeId: string | null): Promise<{ resumeNotFound: boolean; result: ClaudeRunResult | null }> => {
            const effectivePrompt = useResumeId ? toResumePrompt(prompt) : prompt;
            const args = [
                '-p', effectivePrompt,
                '--model', model,
                '--effort', effort,
                '--add-dir', REPO_ROOT,
                '--max-budget-usd', config.claudeBudget,
                '--dangerously-skip-permissions',
                '--output-format', 'stream-json',
                '--verbose',
            ];
            if (cwd !== REPO_ROOT) args.push('--add-dir', cwd);
            if (useResumeId) args.push('--resume', useResumeId);

            type ClaudeUsage = {
                input_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
                output_tokens?: number;
            };
            const captured: { text: string | null; sessionId: string | null; usage: ClaudeUsage | null } = {
                text: null,
                sessionId: null,
                usage: null,
            };
            const assistantTextChunks: string[] = [];

            const onLine = (line: string): void => {
                let event: Record<string, unknown>;
                try { event = JSON.parse(line) as typeof event; } catch { return; }
                const tick = formatLiveTick(event);
                if (tick) console.log(tick);
                if (event.type === 'assistant') {
                    const message = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
                    for (const block of message?.content ?? []) {
                        if (block.type === 'text' && block.text) assistantTextChunks.push(block.text);
                    }
                }
                if (event.type === 'result') {
                    captured.text = (event.result as string | undefined) ?? null;
                    captured.sessionId = (event.session_id as string | undefined) ?? null;
                    captured.usage = (event.usage as ClaudeUsage | undefined) ?? null;
                }
            };

            const result = await streamProcess('claude', args, {
                cwd,
                label: 'Claude',
                onLine,
            });

            if (useResumeId && CLAUDE_RESUME_NOT_FOUND_RE.test(result.capturedStderr)) {
                return { resumeNotFound: true, result: null };
            }

            if (captured.usage) {
                tokens =
                    (captured.usage.input_tokens ?? 0) +
                    (captured.usage.cache_creation_input_tokens ?? 0) +
                    (captured.usage.cache_read_input_tokens ?? 0) +
                    (captured.usage.output_tokens ?? 0);
                if (tokens === 0) tokens = undefined;
            }
            if (captured.text !== null) {
                processedText = captured.text;
            } else if (assistantTextChunks.length > 0) {
                warn('Claude did not emit a final result event — using accumulated assistant text.');
                processedText = assistantTextChunks.join('\n');
            } else {
                processedText = result.capturedStdout;
            }
            if (captured.sessionId) {
                sessionId = captured.sessionId;
            } else {
                const sidMatch = result.capturedStdout.match(/"session_id"\s*:\s*"([0-9a-f-]{36})"/i);
                if (sidMatch) sessionId = sidMatch[1];
            }

            if (processedText) process.stdout.write(processedText);

            if (result.spawnError) { console.error(result.spawnError.message); status = 'failed'; process.exit(1); }
            if (result.stalled) { status = 'failed'; process.exit(1); }
            if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
                status = 'failed';
                process.exit(result.exitCode);
            }
            if (result.signal) { status = 'failed'; process.exit(1); }

            return {
                resumeNotFound: false,
                result: {
                    ...result,
                    sessionId,
                    processedText,
                },
            };
        };

        const first = await attempt(resumeId);
        if (first.resumeNotFound && resumeId) {
            warn(`Claude session ${resumeId.slice(0, 8)}... was not found — falling back to a fresh session. (Stale ID will be overwritten by post-phase session discovery.)`);
            const second = await attempt(null);
            if (second.result) return second.result;
        }
        if (first.result) return first.result;

        return {
            exitCode: 0,
            signal: null,
            spawnError: null,
            stalled: false,
            capturedStdout: processedText,
            capturedStderr: '',
            sessionId,
            processedText,
        };
    } catch (err) {
        status = 'failed';
        throw err;
    } finally {
        if (metricsContext) recordMetric({ ...metricsContext, agent: 'claude', model, durationMs: Date.now() - startMs, status, tokens });
    }
}
