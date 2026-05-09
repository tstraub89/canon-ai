import Mustache from 'mustache';

Mustache.escape = (text: string) => text;

export function renderTemplate(template: string, view: object): string {
    return Mustache.render(template, view).replace(/\n+$/, '');
}
