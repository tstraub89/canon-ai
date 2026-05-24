declare module '*.mjs' {
    export interface Finding {
        file: string;
        line: number;
        ref: string;
        reason: string;
    }

    export function runChecks(repoRoot: string): Finding[];
}
