// CLI wrapper around `checkPhaseGate` (validation.ts). Invoked by
// `canon task phase <id> <phase> done [verdict]` before the status write runs,
// so a phase transition that doesn't satisfy the artifact + verdict invariants
// is rejected before status.json mutates.
//
// Usage: check-phase-gate <task-id> <phase> [verdict]
// Exits 0 if the gate passes; exits 1 with the rejection reason on stderr
// if the gate fails. Kept as an importable helper for tests and future sidecar
// use; the runtime task CLI calls checkPhaseGate in-process.

import { PHASE_ORDER, type Phase } from './types.js';
import { checkPhaseGate } from './validation.js';

export function runCheckPhaseGateCli(args: string[]): number {
    const [taskId, phaseArg, verdictArg] = args;

    if (!taskId || !phaseArg) {
        console.error('Usage: check-phase-gate <task-id> <phase> [verdict]');
        return 2;
    }

    if (!(PHASE_ORDER as readonly string[]).includes(phaseArg)) {
        console.error(`check-phase-gate: unknown phase '${phaseArg}' (expected one of: ${PHASE_ORDER.join(', ')})`);
        return 2;
    }

    const phase = phaseArg as Phase;
    const verdict = verdictArg && verdictArg.length > 0 ? verdictArg : undefined;
    const result = checkPhaseGate(taskId, phase, verdict);

    if (result.ok) {
        return 0;
    }

    console.error(`check-phase-gate: ${result.reason}`);
    console.error(`  Resolution: either fix the artifact (most common) or, for a known-template case, do not advance the phase to 'done'.`);
    return 1;
}
