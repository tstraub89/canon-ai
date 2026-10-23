import { AgentSessionError } from './errors.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { REPO_ROOT } from '../env.js';
import { info, setExitReason, warn } from '../cli.js';
import { recordMetric } from '../metrics.js';
import { CLAUDE_HEADLESS, toResumePrompt } from '../prompts/helpers.js';
import { formatLiveTick, streamProcess } from './stream.js';
import type { ClaudeRunResult } from '../types.js';

export const CLAUDE_RESUME_NOT_FOUND_RE = /No conversation found with session ID/i;
export const CLAUDE_UNKNOWN_EFFORT_RE = /unknown (?:option|flag)[^\n]*--effort/i;

function sumTranscriptTokens(file: string): number | undefined {
    try {
        const seen = new Set<string>();
        let total = 0;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            let entry: Record<string, unknown>;
            try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
            if (entry.type !== 'assistant') continue;
            const message = entry.message as { id?: unknown; usage?: Record<string, unknown> } | undefined;
            if (!message?.usage) continue;
            if (typeof message.id === 'string') {
                if (seen.has(message.id)) continue;
                seen.add(message.id);
            }
            const usage = message.usage;
            for (const key of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) {
                const value = usage[key];
                if (typeof value === 'number' && Number.isFinite(value)) total += value;
            }
        }
        return total > 0 ? total : undefined;
    } catch {
        return undefined;
    }
}

const CLAUDE_TOO_OLD_HINT = 'Claude Code is too old for canon — run `canon doctor` to verify (canon requires Claude Code 2.1.72+).';

function printClaudeTooOldHint(capturedStderr: string): void {
    if (CLAUDE_UNKNOWN_EFFORT_RE.test(capturedStderr)) {
        console.error(CLAUDE_TOO_OLD_HINT);
    }
}

function runInteractiveClaude(args: string[], cwd: string): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn('claude', args, {
            cwd,
            stdio: ['inherit', 'inherit', 'pipe'],
        });
        let capturedStderr = '';
        let settled = false;

        const finish = (code: number): void => {
            if (settled) return;
            settled = true;
            resolve(code);
        };

        if (child.stderr) {
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => {
                capturedStderr += chunk;
                process.stderr.write(chunk);
            });
        }

        child.on('error', err => {
            console.error(err.message);
            finish(1);
        });

        child.on('close', code => {
            if (typeof code === 'number' && code !== 0) {
                printClaudeTooOldHint(capturedStderr);
            }
            finish(typeof code === 'number' ? code : 1);
        });
    });
}

export async function runClaude(
    prompt: string,
    interactive: boolean,
    resumeId: string | null,
    model: string,
    effort: string,
    budget: string,
    metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string },
    cwd = REPO_ROOT,
): Promise<ClaudeRunResult> {
    info(resumeId ? `Calling Claude Code (resuming ${resumeId.slice(0, 8)}...)...` : 'Calling Claude Code...');
    info(interactive
        ? `Model: ${model} | Effort: ${effort} | Budget: uncapped (interactive)`
        : `Model: ${model} | Effort: ${effort} | Budget: ${budget}`);

    const startMs = Date.now();
    let status: 'ok' | 'failed' = 'ok';
    let tokens: number | undefined;
    let processedText = '';
    let sessionId: string | null = null;
    const subagentResults: Array<{ toolUseId: string | null; agentType: string; resolvedModel: string | null; durationMs: number; ok: boolean }> = [];
    const notificationFiles = new Map<string, string>();

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
            const exitCode = await runInteractiveClaude(args, cwd);
            if (exitCode !== 0) {
                status = 'failed';
                setExitReason(`claude interactive session exited ${exitCode}`);
                process.exit(exitCode);
            }
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
            const renderedPrompt = useResumeId ? toResumePrompt(prompt) : prompt;
            const effectivePrompt = `${CLAUDE_HEADLESS}\n\n${renderedPrompt}`;
            const args = [
                '-p', effectivePrompt,
                '--model', model,
                '--effort', effort,
                '--add-dir', REPO_ROOT,
                '--max-budget-usd', budget,
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
                if (event.type === 'system' && event.subtype === 'task_notification'
                    && typeof event.tool_use_id === 'string' && typeof event.output_file === 'string') {
                    notificationFiles.set(event.tool_use_id, event.output_file);
                }
                if (event.type === 'user' && event.parent_tool_use_id == null) {
                    const result = event.tool_use_result as Record<string, unknown> | undefined;
                    if (result && typeof result.agentType === 'string'
                        && typeof result.totalDurationMs === 'number' && Number.isFinite(result.totalDurationMs)) {
                        const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
                        const toolResult = message?.content?.find(block => block.type === 'tool_result' && typeof block.tool_use_id === 'string');
                        const toolUseId = toolResult && typeof toolResult.tool_use_id === 'string' ? toolResult.tool_use_id : null;
                        if (!toolUseId || !subagentResults.some(item => item.toolUseId === toolUseId)) {
                            subagentResults.push({
                                toolUseId,
                                agentType: result.agentType,
                                resolvedModel: typeof result.resolvedModel === 'string' ? result.resolvedModel : null,
                                durationMs: result.totalDurationMs,
                                ok: result.status === 'completed',
                            });
                        }
                    }
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

            if (result.spawnError) {
                console.error(result.spawnError.message);
                status = 'failed';
                throw new AgentSessionError({ agent: 'claude', kind: 'spawn_error', reason: `claude session spawn error: ${result.spawnError.message}` });
            }
            if (result.stalled) {
                status = 'failed';
                throw new AgentSessionError({ agent: 'claude', kind: 'stalled', reason: 'claude session stalled' });
            }
            if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
                printClaudeTooOldHint(result.capturedStderr);
                status = 'failed';
                throw new AgentSessionError({ agent: 'claude', kind: 'exit_code', reason: `claude session exited ${result.exitCode} (possible budget exhaustion — see CLAUDE_BUDGET)`, exitCode: result.exitCode });
            }
            if (result.signal) {
                status = 'failed';
                throw new AgentSessionError({ agent: 'claude', kind: 'signal', reason: `claude session received signal ${result.signal}`, signal: result.signal });
            }

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
        if (metricsContext) {
            try {
                for (const result of subagentResults) {
                    const file = result.toolUseId ? notificationFiles.get(result.toolUseId) : undefined;
                    recordMetric({ ...metricsContext, agent: `claude:${result.agentType}`, model: result.resolvedModel ?? model,
                        durationMs: result.durationMs, status: result.ok ? 'ok' : 'failed', tokens: file ? sumTranscriptTokens(file) : undefined });
                }
            } catch (error) {
                warn(`metrics: could not record Claude sub-agent rows: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
