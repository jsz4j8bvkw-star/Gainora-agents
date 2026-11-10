#!/usr/bin/env node
/*
  Static checks on the built site (dist/). Run after: node build.js
  Exits with code 1 if any check fails. Also runs tests/calc.test.js.
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
const calcData = JSON.parse(fs.readFileSync(path.join(ROOT, "calculator.json"), "utf8"));
let failures = 0;
let passes = 0;

function fail(msg) { failures++; console.log("  FAIL " + msg); }
function pass() { passes++; }
function check(cond, msg) { cond ? pass() : fail(msg); }

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const htmlFiles = walk(DIST).filter(f => f.endsWith(".html"));
const rel = f => "/" + path.relative(DIST, f).replace(/index\.html$/, "");
const titles = new Map();

console.log(`Checking ${htmlFiles.length} pages`);

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const page = rel(file);
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<noscript>[\s\S]*?<\/noscript>/g, "").replace(/<[^>]+>/g, " ");

  // Metadata
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  check(title && title.length > 10, `${page}: missing or short <title>`);
  if (title) {
    check(!titles.has(title), `${page}: duplicate title "${title}" (also ${titles.get(title)})`);
    titles.set(title, page);
  }
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  check(desc && desc.length >= 50 && desc.length <= 170, `${page}: meta description missing or not 50–170 characters (${desc ? desc.length : 0})`);
  check(/<html lang="en-GB">/.test(html), `${page}: missing lang="en-GB"`);

  // Headings
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  check(h1s === 1, `${page}: expected exactly one <h1>, found ${h1s}`);

  // Template leftovers
  check(!/\{\{|\}\}/.test(html), `${page}: unreplaced template token`);

  // No inline styles or inline scripts (blocked by the Content-Security-Policy)
  check(!/\sstyle="/.test(html), `${page}: inline style attribute (blocked by CSP)`);
  check(!/<script(?![^>]*\bsrc=)[^>]*>(?!\s*<\/script>)[\s\S]*?<\/script>/.test(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")), `${page}: inline script (blocked by CSP)`);

  // Internal links resolve
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
    if (href.startsWith("//")) continue;
    let target = path.join(DIST, href);
    if (href.endsWith("/")) target = path.join(target, "index.html");
    check(fs.existsSync(target), `${page}: broken internal link ${href}`);
  }
  for (const [, src] of html.matchAll(/src="(\/assets\/[^"]+)"/g)) {
    check(fs.existsSync(path.join(DIST, src)), `${page}: missing asset ${src}`);
  }
  // In-page anchors resolve
  for (const [, id] of html.matchAll(/href="#([\w-]+)"/g)) {
    check(new RegExp(`id="${id}"`).test(html), `${page}: anchor #${id} has no target`);
  }
  // Cross-page anchors resolve
  for (const [, p, id] of html.matchAll(/href="(\/[^"#?]*)#([\w-]+)"/g)) {
    const t = path.join(DIST, p, p.endsWith("/") ? "index.html" : "");
    if (fs.existsSync(t)) check(new RegExp(`id="${id}"`).test(fs.readFileSync(t, "utf8")), `${page}: ${p}#${id} target missing`);
  }

  // Images have alt text; iframes have titles
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) check(/\balt="/.test(tag), `${page}: <img> without alt`);
  for (const [tag] of html.matchAll(/<iframe\b[^>]*>/g)) check(/\btitle="/.test(tag), `${page}: <iframe> without title`);

  // Form controls have labels
  for (const [tag] of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    if (/type="hidden"/.test(tag) || /name="bot-field"/.test(tag)) continue;
    const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
    check(id && new RegExp(`<label[^>]*for="${id}"`).test(html), `${page}: form control without a label: ${tag.slice(0, 60)}`);
  }

  // Forms: Netlify registration, honeypot and form-name
  for (const [form] of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
    if (/class="calc-form"/.test(form)) continue; // the calculator form sends nothing
    const name = (form.match(/<form[^>]*name="([^"]+)"/) || [])[1];
    check(!!name, `${page}: form without a name`);
    check(/data-netlify="true"/.test(form), `${page}: form ${name} not registered with Netlify`);
    check(/name="bot-field"/.test(form), `${page}: form ${name} has no spam honeypot`);
    check(new RegExp(`name="form-name" value="${name}"`).test(form), `${page}: form ${name} missing hidden form-name`);
    check(/type="checkbox"[^>]*required/.test(form), `${page}: form ${name} missing consent checkbox`);
  }

  // Honesty rules: no fabricated social proof or urgency
  const banned = [
    /testimonial/i, /trusted by/i, /our clients include/i, /\b\d+\+?\s*(happy )?clients\b/i,
    /award[- ]winning/i, /guarantee(d)? (results|growth|revenue|sales)/i, /limited[- ]time/i, /only \d+ (places|spots) left/i,
    /years of experience/i, /\b\d+% (increase|more|growth)\b/i
  ];
  for (const re of banned) check(!re.test(text), `${page}: contains banned claim pattern ${re}`);

  // Offer rules from the brief: fixed prices, no "from", no "illustrative", "businesses" not "small businesses", no AI-first framing
  check(!/\bfrom\s+£/i.test(text), `${page}: a price written as "from £…" (prices are fixed)`);
  check(!/£[\d,]+\s*\+(?!\s*VAT)/.test(text), `${page}: a price written with a trailing "+"`);
  check(!/illustrative/i.test(text), `${page}: uses "illustrative" (use the calculator or a labelled sample instead)`);
  check(!/small business(es)?\b/i.test(text.replace(/Small Business Call Report/g, "")), `${page}: says "small business" (say "businesses")`);
  check(!/\bSMEs?\b/.test(text.replace(/UK SME owners/g, "")), `${page}: says "SME"`);
  check(!/for trades\b|for clinics\b|trades only|clinics only/i.test(text), `${page}: positions Gainora as for one type of business`);
  check(!/\b(AI receptionist|AI-powered|powered by AI)\b/i.test(text), `${page}: leads with "AI" instead of the outcome`);
  check(!/\bBook a free call\b|\bGet a diagnosis\b|\bRequest (a|your) (Business )?Diagnosis\b/i.test(text), `${page}: old call-to-action wording`);

  // Nothing for sale outside the five offers
  check(!/\b(The Brief|The Scout)\b(?![^.]*Command Centre)/.test(text) || page === "/packages/", `${page}: The Brief or The Scout offered outside Command Centre`);
  check(!/buy\.stripe\.com|checkout\.stripe\.com/.test(html), `${page}: contains a payment link (packages are sold after the diagnostic)`);
  check(!/\b(the shop|our shop|visit the shop|AI course|the course|digital products?|toolkit|download page)\b/i.test(text), `${page}: mentions the removed shop, course or products`);

  // Pablo must stay private
  check(!/\bPablo\b/.test(text), `${page}: mentions the private Pablo system`);
}

// Prices: every published price comes from config and appears where it should
const read = p => fs.readFileSync(path.join(DIST, p), "utf8");
const home = read("index.html"), packages = read("packages/index.html"), audit = read("audit/index.html");
// The prices this build used (from Gainora admin, or site.config.json); see build.js.
const builtPrices = path.join(ROOT, ".build-prices.json");
const P = fs.existsSync(builtPrices) ? JSON.parse(fs.readFileSync(builtPrices, "utf8")) : config.prices;
for (const [label, price, pages] of [
  ["audit", P.audit, [home, packages, audit]],
  ["Command Centre monthly", P.commandCentre, [home, packages]],
  ["Launch & Grow setup", P.launchGrow.setup, [home, packages]],
  ["Launch & Grow monthly", P.launchGrow.monthly, [home, packages]],
  ["bundle setup", P.bundle.setup, [packages]],
  ["bundle monthly", P.bundle.monthly, [packages]],
  ["Never Miss a Call setup", P.cc.never.setup, [home, packages]],
  ["Never Miss a Call monthly", P.cc.never.monthly, [home, packages]],
  ["Call to Booking setup", P.cc.booking.setup, [home, packages]],
  ["Call to Booking monthly", P.cc.booking.monthly, [home, packages]],
  ["Full Front Desk setup", P.cc.desk.setup, [home, packages]],
  ["Full Front Desk monthly", P.cc.desk.monthly, [home, packages]],
  ["Partner focused", P.partner.focused, [home, packages]],
  ["Partner core", P.partner.core, [home, packages]],
  ["Partner whole", P.partner.whole, [home, packages]],
  ["Partner monthly", P.partner.monthly, [home, packages]]
]) {
  check(pages.every(h => h.includes(price)), `price: ${label} (${price}) missing from a page that should show it`);
}
// No stray prices: every £ figure on home and packages must be one from config (or a sourced figure in the calculator)
const PRICE = /£\d{1,3}(?:,\d{3})*/g;
const configPrices = new Set(JSON.stringify(P).match(PRICE));
for (const [name, html] of [["home", home], ["packages", packages], ["audit", audit]]) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
  for (const m of text.matchAll(PRICE)) {
    check(configPrices.has(m[0]), `${name}: price ${m[0]} is not one of the prices (admin price book or site.config.json)`);
  }
}
check(/ex-VAT|exclude VAT|excludes VAT|excluding VAT/.test(packages.replace(/<[^>]+>/g, " ")), "packages: prices not marked ex-VAT");
check(home.includes(config.brand.name), "brand name from config not shown");
check(/book\/"|book\/\?/.test(home) && /Book a 15-minute diagnostic/.test(home), "home: main call to action missing");

// Booking page: calendar present (embed or link) and intake fields
const book = read("book/index.html");
check(book.includes(config.contact.bookingUrl), "book: booking link missing");
if (config.contact.bookingEmbedUrl) check(book.includes(`src="${config.contact.bookingEmbedUrl}"`), "book: calendar embed missing");
for (const f of ["name", "business", "email", "mobile", "business_type", "size", "channels", "message", "consent", "package"]) {
  check(new RegExp(`name="${f}"`).test(book), `book: intake field "${f}" missing`);
}
check(/data-netlify="true"/.test(book), "book: form not registered with Netlify");
if (config.contact.bookingEmbedUrl) {
  const headers = fs.readFileSync(path.join(DIST, "_headers"), "utf8");
  check(/frame-src [^\n]*calendar\.google\.com/.test(headers), "_headers: CSP frame-src must allow calendar.google.com for the embed");
}

// Demo block hidden until both number and recording exist
check(config.demo.phone ? home.includes('id="receptionist"') : !home.includes('id="receptionist"'), "home: demo block visibility doesn't match config");

// Redirects: old addresses land somewhere that exists, and both redirect files agree
const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
const redirectsFile = fs.readFileSync(path.join(DIST, "_redirects"), "utf8");
const tomlRules = [...toml.matchAll(/from = "([^"]+)"\s*\n\s*to = "([^"]+)"\s*\n\s*status = (\d+)/g)].map(m => ({ from: m[1], to: m[2], status: m[3] }));
const plainRules = redirectsFile.split("\n").filter(l => l.trim() && !l.startsWith("#")).map(l => { const [from, to, status] = l.trim().split(/\s+/); return { from, to, status }; });
for (const old of ["/diagnosis/", "/contact/", "/solutions/*", "/shop/*", "/ai-training/", "/products/*", "/custom-solutions/", "/download/*"]) {
  const t = tomlRules.find(r => r.from === old), p = plainRules.find(r => r.from === old);
  check(t && t.status === "301", `netlify.toml: no 301 redirect for ${old}`);
  check(p && p.status === "301", `_redirects: no 301 redirect for ${old}`);
  if (t && p) check(t.to === p.to, `redirects for ${old} differ between netlify.toml and _redirects`);
  if (t) {
    const dest = t.to.split("#")[0];
    check(fs.existsSync(path.join(DIST, dest, "index.html")), `redirect target ${dest} does not exist`);
  }
}
// Removed pages are really gone
for (const gone of ["shop/index.html", "solutions/index.html", "ai-training/index.html", "contact/index.html", "diagnosis/index.html", "custom-solutions/index.html"]) {
  check(!fs.existsSync(path.join(DIST, gone)), `removed page still built: ${gone}`);
}

// Required pages exist
for (const p of ["index.html", "packages/index.html", "audit/index.html", "how-we-work/index.html", "calculator/index.html", "book/index.html",
  "about/index.html", "privacy/index.html", "terms/index.html", "cookies/index.html", "thanks/index.html", "signin/index.html", "404.html", "robots.txt", "_headers", "_redirects",
  "assets/calc-data.js", "assets/calc.js", "assets/home.js", "assets/book.js"]) {
  check(fs.existsSync(path.join(DIST, p)), `missing ${p}`);
}

// Calculator data: every research default names a source that exists and has a URL we opened
for (const [key, def] of Object.entries(calcData.defaults)) {
  if (def.basis === "research") {
    check(def.source && calcData.sources[def.source], `calculator.json: research default "${key}" has no source`);
    if (def.source && calcData.sources[def.source]) check(/^https:\/\//.test(calcData.sources[def.source].url), `calculator.json: source ${def.source} has no URL`);
  } else {
    check(["assumption", "yours"].includes(def.basis), `calculator.json: default "${key}" needs a basis of research, assumption or yours`);
  }
}
for (const t of calcData.types) {
  if (t.jobValueBasis === "research") check(t.jobValueSource && calcData.sources[t.jobValueSource], `calculator.json: type ${t.id} job value claims research without a source`);
  check(typeof t.visitRate === "number", `calculator.json: type ${t.id} has no visit rate`);
}
const calcPage = read("calculator/index.html");
for (const s of Object.values(calcData.sources)) check(calcPage.includes(s.url), `calculator page: source not listed: ${s.name}`);
const calcDataJs = read("assets/calc-data.js");
check(calcDataJs.includes(`"commandCentre":${Number(P.commandCentre.replace(/[^\d]/g, ""))}`), "calc-data.js: Command Centre price not taken from config");

// Calculator arithmetic
const calcTests = require("./calc.test.js");
const r = calcTests.run();
passes += r.passes; failures += r.failures;

console.log(`${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
