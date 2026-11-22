import { expect, it } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

it('the whole core and programmatic proof have no transitive game, JSON, DOM or Phaser dependency', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const roots = [...ts.sys.readDirectory(resolve(root, 'src'), ['.ts']), ...[
    'tests/programmatic.test.ts', 'tests/engine-api.test.ts', 'tests/compositions.test.ts',
    'tests/composition-integrity.test.ts', 'examples/programmatic-world.ts', 'examples/compositions.ts',
  ].map(path => resolve(root, path))];
  const visited = new Set<string>();
  const walk = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = ts.sys.readFile(path)!;
    const normalized = path.replaceAll(String.fromCharCode(92), '/');
    expect(normalized).not.toMatch(/\/(data|content|render)\//);
    for (const imported of ts.preProcessFile(source).importedFiles) {
      expect(imported.fileName).not.toMatch(/phaser|\.json$|@origin-gates\/game/i);
      if (!imported.fileName.startsWith('.') && imported.fileName !== '@origin-gates/narrative-engine') continue;
      const resolved = ts.resolveModuleName(imported.fileName, path, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }, ts.sys).resolvedModule;
      expect(resolved, `${path}: ${imported.fileName}`).toBeDefined();
      walk(resolved!.resolvedFileName);
    }
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) expect(node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')).toBe(false);
      if (normalized.includes('/src/') && ts.isIdentifier(node)) expect(['document', 'window', 'HTMLElement', 'localStorage', 'navigator', 'Phaser']).not.toContain(node.text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true));
  };
  roots.forEach(walk);
  expect([...visited].some(path => path.replaceAll(String.fromCharCode(92), '/').endsWith('/fixtures/programmatic.ts'))).toBe(true);
  expect([...visited].some(path => path.replaceAll(String.fromCharCode(92), '/').endsWith('/src/index.ts'))).toBe(true);
});
