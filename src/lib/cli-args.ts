export interface ArgDeclaration {
    command: string;
    usage: string;
    booleanFlags: readonly string[];
    valueFlags: readonly string[];
    equalsValueFlags?: readonly string[];
    freeTextSlots?: readonly number[];
    rejectPositionals?: boolean;
}

export type PreScanResult =
    | { kind: 'help' }
    | { kind: 'unknown'; argument: string }
    | { kind: 'unexpected'; argument: string }
    | { kind: 'proceed' };

export function preScanArgs(decl: ArgDeclaration, args: readonly string[]): PreScanResult {
    const booleans = new Set(decl.booleanFlags);
    const values = new Set(decl.valueFlags);
    const equalsValues = new Set(decl.equalsValueFlags ?? []);
    let position = 0;
    let help = false;
    let firstError: PreScanResult | null = null;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            const freeText = decl.freeTextSlots?.includes(position) ?? false;
            help = true;
            if (freeText) {
                position += 1;
            }
            continue;
        }

        const equalsFlag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : '';
        if (booleans.has(arg)) continue;
        if (values.has(arg)) {
            if (i + 1 < args.length) {
                i += 1;
            }
            continue;
        }
        if (equalsValues.has(equalsFlag)) continue;
        const freeText = decl.freeTextSlots?.includes(position) ?? false;
        if (arg.startsWith('-') && !freeText) {
            if (firstError == null) firstError = { kind: 'unknown', argument: arg };
            continue;
        }
        if (decl.rejectPositionals && !freeText && firstError == null) {
            firstError = { kind: 'unexpected', argument: arg };
        }
        position += 1;
    }
    return help ? { kind: 'help' } : (firstError ?? { kind: 'proceed' });
}

export function unknownOptionMessage(command: string, argument: string): string {
    return `Unknown option: ${argument}\nRun 'canon ${command} --help' for usage.`;
}

export function unexpectedArgumentMessage(command: string, argument: string): string {
    return `Unexpected argument: ${argument}\nRun 'canon ${command} --help' for usage.`;
}

export function handlePreScan(
    decl: ArgDeclaration,
    args: readonly string[],
    io: { out: (message: string) => void; err: (message: string) => void; exit: (code: number) => never },
): 'help' | 'error' | 'proceed' {
    const result = preScanArgs(decl, args);
    if (result.kind === 'help') {
        io.out(decl.usage);
        io.exit(0);
    }
    if (result.kind === 'unknown' || result.kind === 'unexpected') {
        io.err(result.kind === 'unknown'
            ? unknownOptionMessage(decl.command, result.argument)
            : unexpectedArgumentMessage(decl.command, result.argument));
        io.exit(decl.command === 'watch' ? 2 : 1);
    }
    return 'proceed';
}
