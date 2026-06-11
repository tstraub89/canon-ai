import { REPO_ROOT } from '../env.js';
import { info, setExitReason, warn } from '../cli.js';
import { recordMetric } from '../metrics.js';
import { runCommandOrDie } from '../git.js';
import { toResumePrompt } from '../prompts/helpers.js';
import { formatLiveTick, streamProcess } from './stream.js';
import type { CodexRunResult } from '../types.js';

export async function runCodex(
    prompt: string,
    interactive: boolean,
    resumeId: string | null,
    model: string,
    effort: string,
    metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string },
    cwd = REPO_ROOT,
    wrapForResume = true, // set false when the prompt is already purpose-built for a resumed session
): Promise<CodexRunResult> {
    const effectivePrompt = resumeId && wrapForResume ? toResumePrompt(prompt) : prompt;
    info(resumeId ? `Calling Codex (resuming ${resumeId.slice(0, 8)}...)...` : 'Calling Codex...');
    info(`Model: ${model} | Effort: ${effort}`);

    const startMs = Date.now();
    let status: 'ok' | 'failed' = 'ok';
    let tokens: number | undefined;
    let sessionId: string | null = null;

    try {
        if (interactive) {
            console.log('');
            console.log(resumeId ? '─── Resuming interactive Codex session ───' : '─── Opening interactive Codex session ───');
            console.log("Prompt loaded. You're in the driver's seat.");
            console.log('───────────────────────────────────────────');
            console.log('');
            runCommandOrDie('codex', ['-m', model, '-C', cwd, effectivePrompt], { cwd });
            return {
                exitCode: 0,
                signal: null,
                spawnError: null,
                stalled: false,
                capturedStdout: '',
                capturedStderr: '',
                sessionId: null,
            };
        }

        const effortFlag = ['-c', `model_reasoning_effort=${effort}`];
        const sandboxFlags = resumeId ? [] : ['--sandbox', 'workspace-write'];
        const args = resumeId
            ? ['exec', 'resume', resumeId, '--json', ...effortFlag, effectivePrompt, '-m', model]
            : ['exec', '--json', ...effortFlag, ...sandboxFlags, effectivePrompt, '-m', model, '-C', cwd];

        const displayChunks: string[] = [];
        let tokenTotal = 0;
        let sawUsage = false;

        const onLine = (line: string): void => {
            let event: {
                type?: string;
                thread_id?: string;
                item?: { type?: string; text?: string; name?: string };
                usage?: { input_tokens?: number; output_tokens?: number };
            };
            try { event = JSON.parse(line) as typeof event; } catch { return; }
            const tick = formatLiveTick(event);
            if (tick) console.log(tick);
            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
                sessionId = event.thread_id;
            } else if (event.type === 'turn.completed' && event.usage) {
                tokenTotal += (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
                sawUsage = true;
            } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
                displayChunks.push(event.item.text);
            }
        };

        const result = await streamProcess('codex', args, {
            cwd,
            label: 'Codex',
            onLine,
        });

        if (sawUsage) tokens = tokenTotal;
        if (displayChunks.length > 0) {
            process.stdout.write(`${displayChunks.join('\n\n')}\n`);
        }

        if (result.spawnError) {
            console.error(result.spawnError.message);
            status = 'failed';
            setExitReason(`codex session spawn error: ${result.spawnError.message}`);
            process.exit(1);
        }
        if (result.stalled) {
            status = 'failed';
            setExitReason('codex session stalled');
            process.exit(1);
        }
        if (result.signal) {
            status = 'failed';
            setExitReason(`codex session received signal ${result.signal}`);
            process.exit(1);
        }

        if (result.exitCode !== 0) {
            status = 'failed';
            warn(`Codex exited with status ${result.exitCode ?? 0} — will verify phase completion via status.json.`);
        }

        return {
            ...result,
            sessionId,
        };
    } catch (err) {
        status = 'failed';
        throw err;
    } finally {
        if (metricsContext) recordMetric({ ...metricsContext, agent: 'codex', model, durationMs: Date.now() - startMs, status, tokens });
    }
}
