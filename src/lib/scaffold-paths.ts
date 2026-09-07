import { lstatSync } from 'node:fs';
import path from 'node:path';

/** Git tracks a symlink's target name, not the data a write through it destroys. */
export function assertNoSymlinkDestinations(root: string, relativePaths: readonly string[]): void {
    for (const relativePath of relativePaths) {
        let current = root;
        for (const segment of relativePath.split(/[\\/]/)) {
            current = path.join(current, segment);
            let entry;
            try {
                entry = lstatSync(current);
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === 'ENOENT' || code === 'ENOTDIR') break;
                throw error;
            }
            if (entry.isSymbolicLink()) {
                throw new Error(`Refusing to write ${relativePath}: ${current} is a symlink. Replace it with a regular file or directory before running canon init or upgrade; --force does not bypass this check.`);
            }
        }
    }
}
