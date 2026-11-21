import { expect, it } from 'vitest';
import ts from 'typescript';

it('the whole core and programmatic proof have no transitive Origin Gates content or Phaser dependency', () => {
  const roots = [...ts.sys.readDirectory('src/game', ['.ts']), 'tests/programmatic.test.ts', 'tests/engine-api.test.ts', 'examples/programmatic-world.ts'];
  const visited = new Set<string>();
  const walk = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = ts.sys.readFile(path)!;
    expect(path).not.toMatch(/\/(data|content|render)\//);
    expect(source).not.toMatch(/\brequire\s*\(|\bimport\s*\(/); // no hidden dynamic dependencies in this boundary
    for (const imported of ts.preProcessFile(source).importedFiles) {
      expect(imported.fileName).not.toMatch(/phaser|\.json$/i);
      if (!imported.fileName.startsWith('.')) continue;
      const resolved = ts.resolveModuleName(imported.fileName, path, { moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true }, ts.sys).resolvedModule;
      expect(resolved, `${path}: ${imported.fileName}`).toBeDefined();
      walk(resolved!.resolvedFileName);
    }
  };
  roots.forEach(walk);
  expect([...visited].some(path => path.endsWith('/fixtures/programmatic.ts'))).toBe(true);
  expect([...visited].some(path => path.endsWith('/game/index.ts'))).toBe(true);
});
