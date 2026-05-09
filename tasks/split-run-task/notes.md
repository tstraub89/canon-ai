# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[plan] `canPhaseAdvance()` is referenced in AC-3 and `docs/patterns.md` as one of four phase-aware switches, but does not exist anywhere in the current codebase (confirmed by grep). The plan preserves the three switches that do exist (`PHASE_ORDER`, `runPhase`, `checkAndRoute`) in `main.ts` and does not introduce `canPhaseAdvance`. The patterns.md entry will be updated during docs step to note this discrepancy.


