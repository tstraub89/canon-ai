import { readFileSync } from 'node:fs';

export function load(url, context, nextLoad) {
    if (url.endsWith('.md')) {
        const content = readFileSync(new URL(url), 'utf8');
        return {
            format: 'module',
            shortCircuit: true,
            source: `export default ${JSON.stringify(content)};`,
        };
    }
    return nextLoad(url, context);
}
