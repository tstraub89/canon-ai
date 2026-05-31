declare module '*.mjs' {
    export interface Finding {
        file: string;
        line: number;
        ref: string;
        reason: string;
    }

    export interface AdopterConfig {
        noisySourcePaths?: string[];
        validDirs?: string[];
        markdownRootDirs?: string[];
    }

    export function mergeAdopterConfig(adopterConfig?: AdopterConfig | null): {
        validDirs: Set<string>;
        noisySourcePaths: string[];
        markdownRootDirs: string[];
    };
    export function loadAdopterConfig(configPath: string): Promise<AdopterConfig | null>;
    export function runChecks(repoRoot: string, options?: {
        skipPaths?: readonly string[];
        adopterConfig?: AdopterConfig | null;
    }): Finding[];
    export const NOISY_SOURCE_PATHS: string[];
    export const VALID_DIRS: Set<string>;
    export const WHOLESALE_SYNC: readonly string[];
    export const DELIMITED_SYNC: readonly string[];
    export function mergeDelimitedForSync(rootContent: string, templatesContent: string): string | null;
    export function checkSync(repoRoot: string): string[];
    export function findSyncErrors(repoRoot: string): string[];
    export function applySync(repoRoot: string): string[];
    export function main(argv?: string[]): Promise<number>;
}
