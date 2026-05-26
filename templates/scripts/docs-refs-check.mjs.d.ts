declare module '*.mjs' {
    export interface Finding {
        file: string;
        line: number;
        ref: string;
        reason: string;
    }

    export function runChecks(repoRoot: string, options?: { skipPaths?: readonly string[] }): Finding[];
    export const NOISY_SOURCE_PATHS: string[];
    export const WHOLESALE_SYNC: readonly string[];
    export const DELIMITED_SYNC: readonly string[];
    export function mergeDelimitedForSync(rootContent: string, templatesContent: string): string | null;
    export function checkSync(repoRoot: string): string[];
    export function findSyncErrors(repoRoot: string): string[];
    export function applySync(repoRoot: string): string[];
    export function main(argv?: string[]): number;
}
