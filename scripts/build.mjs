// Builds the web app into dist/ (or dist-demo/ with --demo).
// Uses esbuild only, so it works without a full npm install.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const out = join(root, demo ? 'dist-demo' : 'dist');
const nodePaths = [join(root, 'node_modules'), '/opt/npm-tools/node_modules'].filter(existsSync);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  write: false,
  outdir: join(out, 'assets'),
  nodePaths,
  define: {
    'process.env.NODE_ENV': '"production"',
    __DEMO__: demo ? 'true' : 'false',
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL || ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY || ''),
  },
  loader: { '.css': 'css' },
  logLevel: 'warning',
});

const files = {};
for (const f of result.outputFiles) {
  const ext = f.path.endsWith('.css') ? 'css' : 'js';
  const hash = createHash('sha256').update(f.contents).digest('hex').slice(0, 10);
  const name = `app-${hash}.${ext}`;
  writeFileSync(join(out, 'assets', name), f.contents);
  files[ext] = `assets/${name}`;
}

cpSync(join(root, 'public'), out, { recursive: true });
const base = demo ? './' : '/';
let html = readFileSync(join(root, 'index.html'), 'utf8')
  .replaceAll('%BASE%', base)
  .replace('%CSS%', base + files.css)
  .replace('%JS%', base + files.js);
if (demo) {
  // Hosted demo page: the host adds the document skeleton, so publish only the head tags and body content.
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '').replace(/<title>[^<]*<\/title>/, '<title>Gainora Capture & Convert</title>').replace(/<link rel="manifest"[^>]*>\s*/, '');
  const bodyHtml = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace('<!--SW-->', '');
  html = head.trim() + '\n' + bodyHtml.trim() + '\n';
}
else html = html.replace('<!--SW-->', `<script>if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}</script>`);
writeFileSync(join(out, 'index.html'), html);

// The clinics' public booking page (/book/<slug>): its own small bundle, no app code, no sign-in.
if (!demo) {
  const page = await build({
    entryPoints: [join(root, 'src/book/main.tsx')], bundle: true, minify: true, format: 'esm', target: 'es2020', jsx: 'automatic',
    write: false, outdir: join(out, 'assets'), nodePaths, define: { 'process.env.NODE_ENV': '"production"', __DEMO__: 'false' }, loader: { '.css': 'css' }, logLevel: 'warning',
  });
  const pf = {};
  for (const f of page.outputFiles) {
    const ext = f.path.endsWith('.css') ? 'css' : 'js';
    const name = `book-${createHash('sha256').update(f.contents).digest('hex').slice(0, 10)}.${ext}`;
    writeFileSync(join(out, 'assets', name), f.contents);
    pf[ext] = `/assets/${name}`;
  }
  writeFileSync(join(out, 'book.html'), readFileSync(join(root, 'book.html'), 'utf8').replace('%CSS%', pf.css).replace('%JS%', pf.js));
  files.book = pf;
}
console.log(`Built ${demo ? 'demo' : 'app'} → ${out}`, files);
