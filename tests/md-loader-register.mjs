import { register } from 'node:module';

register('./md-loader-hooks.mjs', import.meta.url);

// Tests that import scripts/run-task/main.ts and call main() expect synchronous
// side-effects visible to the test runner — they spawn the orchestrator as a
// piped child (so process.stdout.isTTY === false), then read stdout/stderr to
// assert behavior. The auto-detach in scripts/run-task/detach.ts would respawn
// every such test as a background process and exit 0 immediately, breaking
// every main()-invoking test. Disable detach globally inside the test runner.
// Adopter projects don't ship this file (it lives in tests/, never templates/),
// so this opt-out doesn't leak.
process.env.CANON_NO_DETACH = '1';
