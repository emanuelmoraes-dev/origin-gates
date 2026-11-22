import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tsc = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const children = [
  spawn(process.execPath, [tsc, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], { cwd: resolve(root, 'packages/narrative-engine'), stdio: 'inherit' }),
  spawn(process.execPath, [vite, '--host', '0.0.0.0'], { cwd: resolve(root, 'packages/origin-gates'), stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
