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

/** Bundles one entry (the client app or Gainora's admin) into hashed files under assets/. */
async function bundle(entry, prefix) {
  const result = await build({
    entryPoints: [join(root, entry)],
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
    const name = `${prefix}-${hash}.${ext}`;
    writeFileSync(join(out, 'assets', name), f.contents);
    files[ext] = `assets/${name}`;
  }
  return files;
}

const files = await bundle('src/main.tsx', 'app');
const adminFiles = await bundle('src/admin/main.tsx', 'admin');

cpSync(join(root, 'public'), out, { recursive: true });
const base = demo ? './' : '/';
function page(template, f, title) {
  let html = readFileSync(join(root, template), 'utf8')
    .replaceAll('%BASE%', base)
    .replace('%CSS%', base + f.css)
    .replace('%JS%', base + f.js);
  if (demo) {
    // Hosted demo page: the host adds the document skeleton, so publish only the head tags and body content.
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace(/<link rel="manifest"[^>]*>\s*/, '');
    const bodyHtml = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace('<!--SW-->', '');
    return head.trim() + '\n' + bodyHtml.trim() + '\n';
  }
  return html.replace('<!--SW-->', template === 'index.html' ? `<script>if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}</script>` : '');
}
writeFileSync(join(out, 'index.html'), page('index.html', files, 'Gainora Agents'));
writeFileSync(join(out, 'admin.html'), page('admin.html', adminFiles, 'Gainora Admin'));
console.log(`Built ${demo ? 'demo' : 'app'} → ${out}`, files, adminFiles);
