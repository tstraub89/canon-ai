import Mustache from 'mustache';

export function renderTemplate(template: string, view: object): string {
    // Mustache's default escape mangles & < > " in template variables, which
    // corrupts LLM prompts. Disable escaping for this render only; restore
    // afterward so the global singleton is not permanently mutated.
    const prevEscape = Mustache.escape;
    Mustache.escape = (text: string) => text;
    try {
        return Mustache.render(template, view).replace(/\n+$/, '');
    } finally {
        Mustache.escape = prevEscape;
    }
}
