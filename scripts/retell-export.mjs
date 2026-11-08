import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['scripts/retell-export.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/retell-export.mjs', define: { __DEMO__: 'true' }, logLevel: 'warning', packages: 'external' });
const r = spawnSync(process.execPath, ['.test-build/retell-export.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
