#!/usr/bin/env node --import tsx
// CLI wrapper around `checkPhaseGate` (validation.ts). Invoked by
// `scripts/task.sh phase <id> <phase> done [verdict]` before the jq
// status-write runs, so a phase transition that doesn't satisfy the
// artifact + verdict invariants is rejected before status.json mutates.
//
// Usage: tsx scripts/run-task/check-phase-gate.ts <task-id> <phase> [verdict]
// Exits 0 if the gate passes; exits 1 with the rejection reason on stderr
// if the gate fails. task.sh aborts on non-zero, so the phase status
// stays at its prior value.

import { PHASE_ORDER, type Phase } from './types.js';
import { checkPhaseGate } from './validation.js';

const [, , taskId, phaseArg, verdictArg] = process.argv;

if (!taskId || !phaseArg) {
    console.error('Usage: check-phase-gate.ts <task-id> <phase> [verdict]');
    process.exit(2);
}

if (!(PHASE_ORDER as readonly string[]).includes(phaseArg)) {
    console.error(`check-phase-gate: unknown phase '${phaseArg}' (expected one of: ${PHASE_ORDER.join(', ')})`);
    process.exit(2);
}

const phase = phaseArg as Phase;
const verdict = verdictArg && verdictArg.length > 0 ? verdictArg : undefined;
const result = checkPhaseGate(taskId, phase, verdict);

if (result.ok) {
    process.exit(0);
}

console.error(`check-phase-gate: ${result.reason}`);
console.error(`  Resolution: either fix the artifact (most common) or, for a known-template case, do not advance the phase to 'done'.`);
process.exit(1);
