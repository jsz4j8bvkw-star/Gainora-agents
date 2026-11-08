#!/usr/bin/env node
/*
  Static site builder. No dependencies.

  node build.js          build into ./dist
  node build.js --serve  build, then preview at http://localhost:8080

  Pages live in src/pages/*.html and start with a meta comment:
    <!--meta {"title": "...", "description": "...", "path": "/diagnosis/", "nav": "diagnosis"} -->

  Template syntax:
    {{brand.name}}           value from site.config.json
    {{> partial-name}}       insert src/partials/partial-name.html
    {{#if contact.email}}…{{/if}}   keep the block only if the value is set
*/
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));

function get(obj, keyPath) {
  return keyPath.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function render(tpl, ctx, depth = 0) {
  if (depth > 10) throw new Error("Partial nesting too deep");
  // partials
  tpl = tpl.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
    const file = path.join(SRC, "partials", name + ".html");
    if (!fs.existsSync(file)) throw new Error("Missing partial: " + name);
    return render(fs.readFileSync(file, "utf8"), ctx, depth + 1);
  });
  // conditionals (no nesting of the same block type needed here)
  tpl = tpl.replace(/\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) => {
    const v = get(ctx, key);
    return v ? inner : "";
  });
  tpl = tpl.replace(/\{\{#unless\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_, key, inner) => {
    const v = get(ctx, key);
    return v ? "" : inner;
  });
  // raw HTML values (only for HTML the build itself generates)
  tpl = tpl.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (m, key) => {
    const v = get(ctx, key);
    if (v === undefined) throw new Error("Unknown raw template value: " + key);
    return String(v);
  });
  // values
  tpl = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const v = get(ctx, key);
    if (v === undefined) throw new Error("Unknown template value: " + key);
    return escapeHtml(v);
  });
  return tpl;
}


/* ---------- Calculator data: calculator.json becomes a small script the page loads ---------- */
function calculatorScript() {
  const file = path.join(ROOT, "calculator.json");
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  // Prices the calculator compares against come from site.config.json, never from calculator.json
  const num = s => Number(String(s).replace(/[^0-9.]/g, ""));
  data.prices = {
    commandCentre: num(config.prices.commandCentre),
    launchGrowMonthly: num(config.prices.launchGrow.monthly),
    launchGrowSetup: num(config.prices.launchGrow.setup),
    cc: {
      never: { setup: num(config.prices.cc.never.setup), monthly: num(config.prices.cc.never.monthly), minutes: num(config.prices.cc.never.minutes) },
      booking: { setup: num(config.prices.cc.booking.setup), monthly: num(config.prices.cc.booking.monthly), minutes: num(config.prices.cc.booking.minutes) },
      desk: { setup: num(config.prices.cc.desk.setup), monthly: num(config.prices.cc.desk.monthly), minutes: num(config.prices.cc.desk.minutes) }
    },
    partnerMonthly: num(config.prices.partner.monthly)
  };
  return "window.GAINORA_CALC = " + JSON.stringify(data) + ";\n";
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name), d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function build() {
  if (config.demo.phone && !(config.demo.phoneHref && /^https:\/\//.test(config.demo.recordingUrl || ""))) {
    throw new Error("demo.phone is set but demo.phoneHref or demo.recordingUrl is missing. The 'Ring our receptionist' block needs the number, a tel: value and a recording.");
  }
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  copyDir(path.join(SRC, "assets"), path.join(DIST, "assets"));

  const layout = fs.readFileSync(path.join(SRC, "layout.html"), "utf8");
  const siteUrl = (config.site.url || "").replace(/\/$/, "");
  const pages = [];
  const calc = calculatorScript();
  if (calc) fs.writeFileSync(path.join(DIST, "assets", "calc-data.js"), calc);

  for (const file of fs.readdirSync(path.join(SRC, "pages")).filter(f => f.endsWith(".html"))) {
    const raw = fs.readFileSync(path.join(SRC, "pages", file), "utf8");
    const m = raw.match(/^<!--meta\s+([\s\S]*?)-->\s*/);
    if (!m) throw new Error("Missing meta comment in " + file);
    const meta = JSON.parse(m[1]);
    const body = raw.slice(m[0].length);

    const navState = {};
    for (const k of ["home", "packages", "how", "calculator", "about", "book", "audit"]) {
      navState[k] = meta.nav === k ? ' aria-current="page"' : "";
    }

    const ctx = Object.assign({}, config, {
      page: {
        title: meta.title.replace("{brand}", config.brand.name),
        description: meta.description.replace("{brand}", config.brand.name),
        path: meta.path,
        canonical: siteUrl ? siteUrl + meta.path : "",
        robots: meta.noindex ? "noindex" : "index, follow",
        bodyClass: meta.bodyClass || "",
        scripts: (meta.scripts || []).map(s => `<script src="${escapeHtml(s)}" defer></script>`).join("\n")
      },
      year: String(new Date().getFullYear())
    });

    let html = render(layout.replace("{{content}}", body), ctx);
    // aria-current markers for navigation (inserted raw, not escaped)
    html = html.replace(/<!--nav:(\w+)-->/g, (_, k) => navState[k] || "");

    const outDir = meta.path === "/" ? DIST : path.join(DIST, meta.path);
    const outFile = meta.file ? path.join(DIST, meta.file) : path.join(outDir, "index.html");
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, html);
    pages.push(meta);
  }

  // robots.txt and sitemap.xml (sitemap only when the real site URL is known)
  const indexable = pages.filter(p => !p.noindex);
  let robots = "User-agent: *\nAllow: /\n";
  if (siteUrl) {
    const today = new Date().toISOString().slice(0, 10);
    const urls = indexable.map(p => `  <url><loc>${siteUrl}${p.path}</loc><lastmod>${today}</lastmod></url>`).join("\n");
    fs.writeFileSync(path.join(DIST, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    robots += `Sitemap: ${siteUrl}/sitemap.xml\n`;
  } else {
    console.warn("Note: site.url is empty in site.config.json, so canonical URLs and sitemap.xml are skipped.");
  }
  fs.writeFileSync(path.join(DIST, "robots.txt"), robots);
  for (const special of ["_headers", "_redirects"]) {
    // Honoured by Netlify (and Cloudflare Pages), including drag-and-drop deploys of dist/
    if (fs.existsSync(path.join(SRC, special))) {
      fs.copyFileSync(path.join(SRC, special), path.join(DIST, special));
    }
  }

  console.log(`Built ${pages.length} pages into dist/`);
  return pages;
}

function serve(port = 8080) {
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".xml": "application/xml", ".txt": "text/plain" };
  http.createServer((req, res) => {
    if (req.method === "POST") {
      // Local preview has no form backend: report that honestly.
      res.writeHead(501, { "Content-Type": "text/plain" });
      return res.end("Forms are not connected in local preview.");
    }
    let p = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(DIST, p);
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": types[".html"] }); return res.end(fs.readFileSync(path.join(DIST, "404.html"))); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`Preview: http://localhost:${port}`));
}

build();
if (process.argv.includes("--serve")) serve();
module.exports = { build };
