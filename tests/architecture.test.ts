import { expect, it } from 'vitest';
import ts from 'typescript';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engine = resolve(root, 'packages/narrative-engine');
const game = resolve(root, 'packages/origin-gates');
const publicName = '@origin-gates/narrative-engine';
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const config = ts.readConfigFile(resolve(game, 'tsconfig.json'), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, game).options;
const inside = (parent: string, path: string) => { const r = relative(parent, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

function imports(file: string, source: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) found.push(node.argument.literal.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) found.push(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) throw new Error('Computed module access requires an architectural review');
      found.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
  return found;
}
function violations(file: string, source: string, compilerOptions = options): string[] {
  return imports(file, source).filter(specifier => {
    if (specifier === publicName) return false;
    if (specifier.startsWith(publicName + '/')) return true;
    const resolved = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys).resolvedModule;
    return resolved !== undefined && inside(engine, resolved.resolvedFileName);
  });
}

it('declares exactly two workspaces and a real, explicit public package export', () => {
  expect(json(resolve(root, 'package.json')).workspaces).toEqual(['packages/narrative-engine', 'packages/origin-gates']);
  const manifest = json(resolve(engine, 'package.json'));
  expect(Object.keys(manifest.exports)).toEqual(['.']);
  expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
  expect(manifest.dependencies ?? {}).toEqual({});
  expect(json(resolve(game, 'package.json')).dependencies[publicName]).toBe(manifest.version);
});
it('the entire game, including tests, configs and type-only imports, uses only the public engine entry', () => {
  const files = ts.sys.readDirectory(game, ['.ts', '.js', '.mjs'], ['**/dist/**', '**/node_modules/**']);
  for (const file of files) expect(violations(file, ts.sys.readFile(file)!), file).toEqual([]);
  expect(options.paths).toBeUndefined();
  const vite = ts.createSourceFile('vite.config.ts', ts.sys.readFile(resolve(game, 'vite.config.ts'))!, ts.ScriptTarget.Latest, true);
  const check = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) expect(node.name.getText(vite).replace(/['"]/g, '')).not.toBe('alias');
    ts.forEachChild(node, check);
  };
  check(vite);
});
it.each([
  "import type { GameState } from '../../narrative-engine/src/state.js';",
  "export { resolve } from '../../narrative-engine/dist/state.js';",
  "const x = import('@origin-gates/narrative-engine/dist/state.js');",
  "const x = require('@origin-gates/narrative-engine/src/state');",
  "type State = import('../../narrative-engine/src/state.js').GameState;",
  "import state = require('../../narrative-engine/dist/state.js');",
])('detects equivalent attempts to access internals: %s', source => {
  expect(violations(resolve(game, 'tests/virtual.ts'), source)).toHaveLength(1);
});
it('detects a TypeScript alias disguising a relative access to engine internals', () => {
  expect(violations(resolve(game, 'tests/virtual.ts'), "import type { GameState } from 'hidden/state';", {
    ...options, baseUrl: root, paths: { 'hidden/*': ['packages/narrative-engine/src/*'] },
  })).toHaveLength(1);
});
it('does not forbid normal public imports or game-owned data', () => {
  expect(violations(resolve(game, 'src/virtual.ts'), "import { createEngine } from '@origin-gates/narrative-engine'; import data from './data/scenarios.json';")).toEqual([]);
});
