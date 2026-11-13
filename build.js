#!/usr/bin/env node
/*
  Static site builder. No dependencies.

  node build.js            build into ./dist (prices from Gainora admin, or site.config.json if it can't be reached)
  node build.js --offline  build with the prices in site.config.json only
  node build.js --serve    build, then preview at http://localhost:8080

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
// The prices the build used, for tests/check.js (site.config.json, updated from the admin's price book when reachable).
const BUILD_PRICES = path.join(ROOT, ".build-prices.json");

/*
  Prices come from Gainora admin → Prices (https://app.gainora.co.uk/api/prices), so changing a price there and
  pressing "Save and update the website" rebuilds this site with it. If the admin can't be reached, or answers with
  anything unexpected, the build uses the prices in site.config.json instead. Keep those as the fallback.
    GAINORA_PRICES=off      build with site.config.json only
    GAINORA_PRICES_URL=…    read prices from somewhere else (for testing)
*/
async function livePrices() {
  if (process.env.GAINORA_PRICES === "off" || process.argv.includes("--offline")) return "site.config.json (live prices switched off)";
  const url = process.env.GAINORA_PRICES_URL || "https://app.gainora.co.uk/api/prices";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const live = (await res.json()).prices;
    const problems = [];
    const merged = mergePrices(config.prices, live, "prices", problems);
    if (problems.length) throw new Error(problems.slice(0, 3).join("; "));
    config.prices = merged;
    return `Gainora admin (${url})`;
  } catch (e) {
    console.warn(`Note: couldn't read prices from Gainora admin (${e.message}); using site.config.json.`);
    return "site.config.json";
  }
}

/** Live values replace the config's, key by key; keys only the config has (notes, counts) are kept. */
function mergePrices(base, live, at, problems) {
  if (!live || typeof live !== "object" || Array.isArray(live)) { problems.push(`${at} is not an object`); return base; }
  const out = Object.assign({}, base);
  for (const [k, v] of Object.entries(live)) {
    if (!(k in base)) continue;                       // only prices the site already knows about
    if (base[k] && typeof base[k] === "object") out[k] = mergePrices(base[k], v, `${at}.${k}`, problems);
    else if (typeof v !== "string" || !v.trim()) problems.push(`${at}.${k} is empty`);
    else if (/^£\d{1,3}(,\d{3})*$/.test(base[k]) && !/^£\d{1,3}(,\d{3})*$/.test(v)) problems.push(`${at}.${k} isn't a price (${v})`);
    else out[k] = v;
  }
  return out;
}

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
    launchGrowMonthly: num(config.prices.launchGrow.monthly),
    launchGrowSetup: num(config.prices.launchGrow.setup),
    cc: { setup: num(config.prices.cc.setup), monthly: num(config.prices.cc.monthly), minutes: num(config.prices.cc.minutes), extraPer100: num(String(config.prices.cc.extraMinutes).split(" per ")[0]) },
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

function build(pricesFrom = "site.config.json") {
  fs.writeFileSync(BUILD_PRICES, JSON.stringify(config.prices, null, 1));
  if (config.demo.phone && !/^\+44\d{9,10}$/.test(config.demo.phoneHref || "")) {
    throw new Error("demo.phone is set but demo.phoneHref isn't a +44 number. The 'Ring our receptionist' block needs the number and its tel: value.");
  }
  if (config.demo.recordingUrl && !/^https:\/\//.test(config.demo.recordingUrl)) {
    throw new Error("demo.recordingUrl must be an https address.");
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
      year: String(new Date().getFullYear()),
      // The recording under the demo number is optional: shown only once there is one.
      demoRecording: config.demo.recordingUrl
        ? `<p class="demo-label">A real call, 90 seconds</p><audio controls preload="none" src="${escapeHtml(config.demo.recordingUrl)}"></audio>`
        : ""
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

  console.log(`Built ${pages.length} pages into dist/ (prices from ${pricesFrom})`);
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

module.exports = { build, mergePrices };
if (require.main === module) {
  livePrices().then((from) => {
    build(from);
    if (process.argv.includes("--serve")) serve();
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
