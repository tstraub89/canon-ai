// Side-effect import FIRST — installs the SIGHUP handler at module-evaluation
// time, before main.ts's heavy import graph (env.ts's synchronous git
// rev-parse and friends) starts loading. See run-task/signals.ts for why
// the placement and the side-effect-only shape matter.
import './run-task/signals.js';

import { pathToFileURL } from 'node:url';
import { main } from './run-task/main.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main().catch((err) => {
        console.error(err instanceof Error ? err.stack ?? err.message : err);
        process.exit(1);
    });
}
