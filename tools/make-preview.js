#!/usr/bin/env node
/* Makes a self-contained preview copy of dist/ with relative links (for hosts that serve the site from a sub-path). */
const fs = require("fs"), path = require("path");
const DIST = path.join(__dirname, "..", "dist"), OUT = path.join(__dirname, "..", "preview");
fs.rmSync(OUT, { recursive: true, force: true });
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
for (const file of walk(DIST)) {
  const rel = path.relative(DIST, file);
  const out = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!file.endsWith(".html")) { fs.copyFileSync(file, out); continue; }
  const depth = rel.split(path.sep).length - 1;
  const up = depth ? "../".repeat(depth) : "./";
  let html = fs.readFileSync(file, "utf8");
  html = html.replace(/(href|src|action)="\/(?!\/)([^"]*)"/g, (m, attr, p) => {
    let [pathPart, hash = ""] = p.split("#");
    let q = "";
    if (pathPart.includes("?")) { [pathPart, q] = pathPart.split("?"); q = "?" + q; }
    if (pathPart === "" ) pathPart = "index.html";
    else if (pathPart.endsWith("/")) pathPart += "index.html";
    return `${attr}="${up}${pathPart}${q}${hash ? "#" + hash : ""}"`;
  });
  // Forms can't submit in a preview: drop the provider so the form says so honestly.
  html = html.replace(/data-form-provider="[^"]*"/, 'data-form-provider="none"');
  if (rel === "index.html") {
    // Root page is wrapped by the preview host: keep head contents and body contents only.
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*/g, "");
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
    html = head.trim() + "\n<style>html,body{background:#F1EFEA;color:#1C1E1F;font-size:16px}</style>\n" + body.trim() + "\n";
  }
  fs.writeFileSync(out, html);
}
console.log("Preview written to preview/");
