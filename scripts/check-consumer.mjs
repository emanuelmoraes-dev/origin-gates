import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = resolve(tmpdir(), 'origin-gates-consumers');
mkdirSync(temporaryRoot, { recursive: true });
const session = mkdtempSync(resolve(temporaryRoot, 'consumer-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Execute via npm run test:consumer');
const require = createRequire(import.meta.url);
const tsc = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
const run = (args, cwd) => execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const packed = JSON.parse(run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', session], resolve(root, 'packages/narrative-engine')))[0];
  if (packed.files.some(f => /^(src|tests)\//.test(f.path))) throw new Error('Source/tests leaked into the package');
  const consumer = resolve(session, 'app'); mkdirSync(consumer);
  writeFileSync(resolve(consumer, 'package.json'), JSON.stringify({ name: 'independent-consumer', private: true, type: 'module', dependencies: { '@origin-gates/narrative-engine': `file:${resolve(session, packed.filename).replaceAll('\\', '/')}` } }));
  writeFileSync(resolve(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022'], types: [], strict: true, outDir: 'out', skipLibCheck: false }, include: ['index.ts'] }));
  copyFileSync(resolve(root, 'scripts/consumer/index.ts'), resolve(consumer, 'index.ts'));
  run([npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  run([tsc, '-p', 'tsconfig.json'], consumer);
  run([resolve(consumer, 'out/index.js')], consumer);
  console.log(`Independent packed consumer passed: ${packed.filename}; ESM, declarations, compositions, interaction, queries and blocked deep imports.`);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  const target = relative(temporaryRoot, session);
  if (!target || target.startsWith('..') || isAbsolute(target)) throw new Error('Refusing cleanup outside the task temporary directory');
  rmSync(session, { recursive: true, force: true });
}
