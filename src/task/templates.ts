import fs from 'node:fs';
import path from 'node:path';

// Task-artifact template resolution, shared by `canon task new` (initial
// scaffold) and the review re-scaffold that runs after `--reroute` and
// `canon task reset-code-review` archive a filled review.md. Keeping both
// on one resolver guarantees a re-scaffolded artifact is byte-identical to
// what `canon task new` would have produced for the same task.

export function tasksRoot(): string {
    return process.env.CANON_TASKS_DIR_OVERRIDE ?? 'tasks';
}

export function templatesRoot(): string {
    return path.join(process.cwd(), '.canon', 'templates');
}

/** Adopter-owned per-artifact overrides, checked before `.canon/templates/`. */
export function taskTemplateOverrideRoot(): string {
    return path.join(tasksRoot(), '_templates');
}

/**
 * Returns the template file that scaffolds `basename` for this repo: the
 * adopter override when one exists, otherwise the canon-managed template.
 * Returns null when neither is present.
 */
export function resolveTaskTemplateSource(basename: string): string | null {
    const override = path.join(taskTemplateOverrideRoot(), basename);
    if (fs.existsSync(override)) return override;
    const managed = path.join(templatesRoot(), basename);
    return fs.existsSync(managed) ? managed : null;
}

export function renderTaskTemplate(source: string, taskId: string, title: string): string {
    return fs.readFileSync(source, 'utf8')
        .replaceAll('[TASK-ID]', taskId)
        .replaceAll('[Title]', title);
}

/**
 * Writes a fresh scaffold of `basename` into `taskDir`. Returns the source
 * template path used, or null when no template exists for that artifact.
 */
export function scaffoldTaskArtifact(
    taskDir: string,
    basename: string,
    taskId: string,
    title: string,
): string | null {
    const source = resolveTaskTemplateSource(basename);
    if (!source) return null;
    fs.writeFileSync(path.join(taskDir, basename), renderTaskTemplate(source, taskId, title), 'utf8');
    return source;
}

/**
 * True when `content` is an untouched scaffold: either the raw template
 * (placeholders still present) or exactly what scaffolding would render for
 * this task. `canon task new` substitutes the placeholders, so a placeholder
 * check alone never recognizes a real fresh scaffold.
 */
export function isPristineTaskArtifact(
    content: string,
    basename: string,
    taskId: string,
    title: string,
): boolean {
    if (content.includes('[TASK-ID]')) return true;
    const source = resolveTaskTemplateSource(basename);
    if (!source) return false;
    // An unreadable template must not fail the caller (the archive step runs
    // before any status mutation); treat it as "cannot prove pristine".
    try {
        return content === renderTaskTemplate(source, taskId, title);
    } catch {
        return false;
    }
}
