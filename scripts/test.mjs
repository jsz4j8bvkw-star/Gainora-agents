// Bundles each test with esbuild, then runs them with node's built-in test runner.
import { build } from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.test-build');
rmSync(out, { recursive: true, force: true }); mkdirSync(out);
const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.ts'));
await build({ entryPoints: files.map((f) => join(root, 'tests', f)), bundle: true, platform: 'node', format: 'esm', outdir: out, outExtension: { '.js': '.mjs' }, define: { __DEMO__: 'true' }, logLevel: 'warning', packages: 'external' });
const env = { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' };
const r = spawnSync(process.execPath, ['--test', ...files.map((f) => join(out, f.replace('.ts', '.mjs')))], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
