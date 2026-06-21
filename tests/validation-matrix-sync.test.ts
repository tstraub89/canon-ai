import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MATRIX_HEADER = '| Change Type | Required Check Categories |';
const IMPLEMENT_MATRIX_PATH = path.join(process.cwd(), 'scripts/run-task/prompts/templates/implement.md');
const SPEC_MATRIX_PATH = path.join(process.cwd(), '.canon/templates/spec.md');

function extractMatrixBlock(filePath: string): string {
    assert.ok(
        fs.existsSync(filePath),
        `Validation Matrix source not found: ${filePath} (run the test suite from the repo root)`,
    );
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const headerIndex = lines.findIndex(line => line === MATRIX_HEADER);
    assert.notEqual(headerIndex, -1, `missing Validation Matrix header in ${filePath}`);

    const block: string[] = [];
    for (let i = headerIndex; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.startsWith('|')) break;
        block.push(line);
    }

    assert.ok(block.length > 0, `empty Validation Matrix block in ${filePath}`);
    return block.join('\n');
}

void test('Validation Matrix is byte-identical between implement and spec templates', () => {
    const implementMatrix = extractMatrixBlock(IMPLEMENT_MATRIX_PATH);
    const specMatrix = extractMatrixBlock(SPEC_MATRIX_PATH);

    assert.equal(implementMatrix, specMatrix);
});
