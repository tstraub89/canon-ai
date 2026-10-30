import { requiredAgentBackends, roleAssignmentFor, resolveProviderSetting, type Provider } from '../orchestrator/policy.js';
import { spawnSync } from 'node:child_process';

interface Dep {
    cmd: string;
    installHint: string;
}

function hardDeps(provider: Provider): Dep[] { return [
    { cmd: 'git', installHint: 'https://git-scm.com/downloads' },
    ...requiredAgentBackends(roleAssignmentFor(provider)).map(cmd => ({ cmd, installHint: cmd === 'claude'
        ? 'npm install -g @anthropic-ai/claude-code' : 'npm install -g @openai/codex' })),
]; }

const SOFT_DEPS: Dep[] = [
    { cmd: 'gh', installHint: 'brew install gh && gh auth login  (required for --pr / --push)' },
];

export function isAvailable(cmd: string): boolean {
    const result = spawnSync('which', [cmd], { stdio: 'ignore' });
    return result.status === 0;
}

export function checkDeps(available: (cmd: string) => boolean = isAvailable, provider?: Provider): void {
    let resolved: Provider;
    try { resolved = provider ?? resolveProviderSetting(); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
    const missing = hardDeps(resolved).filter(d => !available(d.cmd));
    if (missing.length > 0) {
        console.error('canon init requires the following tools to be installed:\n');
        for (const dep of missing) {
            console.error(`  ✗ ${dep.cmd}\n    ${dep.installHint}`);
        }
        console.error('');
        process.exit(1);
    }

    const softMissing = SOFT_DEPS.filter(d => !available(d.cmd));
    for (const dep of softMissing) {
        console.warn(`  ⚠  ${dep.cmd} not found — needed later: ${dep.installHint}`);
    }
}

export function checkDepForFlag(flag: string): void {
    const flagDeps: Record<string, Dep> = {
        '--pr': { cmd: 'gh', installHint: 'brew install gh && gh auth login' },
        '--push': { cmd: 'gh', installHint: 'brew install gh && gh auth login' },
        '--full-send': { cmd: 'gh', installHint: 'brew install gh && gh auth login' },
    };
    const dep = flagDeps[flag];
    if (dep && !isAvailable(dep.cmd)) {
        console.error(`${flag} requires the GitHub CLI:\n  ${dep.installHint}`);
        process.exit(1);
    }
}
