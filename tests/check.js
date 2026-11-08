#!/usr/bin/env node
/*
  Static checks on the built site (dist/). Run after: node build.js
  Exits with code 1 if any check fails.
*/
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "site.config.json"), "utf8"));
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

const htmlFiles = walk(DIST).filter(f => f.endsWith(".html") && !f.includes(path.sep + "assets" + path.sep + "dl" + path.sep));
const rel = f => "/" + path.relative(DIST, f).replace(/index\.html$/, "");
const titles = new Map();

console.log(`Checking ${htmlFiles.length} pages`);

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const page = rel(file);
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

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

  // No inline styles (blocked by the Content-Security-Policy)
  check(!/\sstyle="/.test(html), `${page}: inline style attribute (blocked by CSP)`);

  // Internal links resolve
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
    if (href.startsWith("//")) continue;
    let target = path.join(DIST, href);
    if (href.endsWith("/")) target = path.join(target, "index.html");
    check(fs.existsSync(target), `${page}: broken internal link ${href}`);
  }
  // In-page anchors resolve
  for (const [, id] of html.matchAll(/href="#([\w-]+)"/g)) {
    check(new RegExp(`id="${id}"`).test(html), `${page}: anchor #${id} has no target`);
  }
  // Cross-page anchors resolve
  for (const [, p, id] of html.matchAll(/href="(\/[^"#]*)#([\w-]+)"/g)) {
    const t = path.join(DIST, p, p.endsWith("/") ? "index.html" : "");
    if (fs.existsSync(t)) check(new RegExp(`id="${id}"`).test(fs.readFileSync(t, "utf8")), `${page}: ${p}#${id} target missing`);
  }

  // Images have alt text
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) check(/\balt="/.test(tag), `${page}: <img> without alt`);

  // Form controls have labels
  for (const [tag] of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    if (/type="hidden"/.test(tag) || /name="bot-field"/.test(tag)) continue;
    const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
    check(id && new RegExp(`<label[^>]*for="${id}"`).test(html), `${page}: form control without a label: ${tag.slice(0, 60)}`);
  }

  // Forms: Netlify registration, honeypot and form-name
  for (const [form] of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
    const name = (form.match(/<form[^>]*name="([^"]+)"/) || [])[1];
    check(!!name, `${page}: form without a name`);
    check(/data-netlify="true"/.test(form), `${page}: form ${name} not registered with Netlify`);
    check(/name="bot-field"/.test(form), `${page}: form ${name} has no spam honeypot`);
    check(new RegExp(`name="form-name" value="${name}"`).test(form), `${page}: form ${name} missing hidden form-name`);
    check(/type="checkbox"[^>]*required/.test(form), `${page}: form ${name} missing consent checkbox`);
  }

  // Honesty rules: no fabricated social proof or urgency
  const banned = [
    /testimonial/i, /trusted by/i, /our clients include/i, /case stud(y|ies) of/i, /\b\d+\+?\s*(happy )?clients\b/i,
    /award[- ]winning/i, /guarantee(d)? (results|growth|revenue|sales)/i, /limited[- ]time/i, /only \d+ (places|spots) left/i,
    /years of experience/i, /\b\d+% (increase|more|growth)\b/i
  ];
  for (const re of banned) check(!re.test(text), `${page}: contains banned claim pattern ${re}`);

  // Services we don't sell must not be offered
  check(!/social media management|ad management|advertising management|content retainer/i.test(text.replace(/don't (run|sell|manage)[^.]*\./gi, "")),
    `${page}: appears to offer marketing services`);

  // Pablo must stay private
  check(!/\bPablo\b/.test(text), `${page}: mentions the private Pablo system`);
}

// Shop: buttons must match each item's status in site.config.json
const shopHtml = fs.readFileSync(path.join(DIST, "shop/index.html"), "utf8");
const PAID = ["available", "preorder"];
for (const item of config.shop.items) {
  const card = (shopHtml.match(new RegExp(`<article class="shop-card[^"]*" id="${item.id}">[\\s\\S]*?</article>`)) || [])[0];
  check(!!card, `shop: no card for ${item.id}`);
  if (!card) continue;
  check(card.includes(item.price), `shop: ${item.id} card does not show its price ${item.price}`);
  if (PAID.includes(item.status)) {
    check(card.includes(`href="${item.checkoutUrl}"`) && /data-paid="true"/.test(card), `shop: ${item.id} is ${item.status} but has no payment button`);
  } else {
    check(!/data-paid/.test(card), `shop: ${item.id} is ${item.status} but shows a payment button`);
    check(card.includes(`/shop/?item=${item.id}#join`), `shop: ${item.id} sign-up button doesn't point at the join form`);
    check(shopHtml.includes(`<option value="${item.id}">`), `shop: ${item.id} missing from the join form`);
  }
}
// No payment links anywhere except the configured ones
const allowedCheckout = new Set(config.shop.items.filter(i => PAID.includes(i.status)).map(i => i.checkoutUrl));
for (const u of Object.values(config.payments || {})) allowedCheckout.add(u);
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  for (const [, href] of html.matchAll(/href="(https:\/\/(?:buy\.stripe\.com|checkout\.stripe\.com)[^"]*)"/g)) {
    check(allowedCheckout.has(href), `${rel(file)}: payment link ${href} isn't a configured, available item`);
  }
}

// Prices come from config
const home = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const diag = fs.readFileSync(path.join(DIST, "diagnosis/index.html"), "utf8");
check(home.includes(config.prices.diagnosis) && diag.includes(config.prices.diagnosis), "diagnosis price from config not shown");
check(home.includes(config.brand.name), "brand name from config not shown");

// Required pages exist
for (const p of ["index.html", "diagnosis/index.html", "solutions/index.html", "custom-solutions/index.html", "how-we-work/index.html",
  "shop/index.html", "ai-training/index.html", "about/index.html", "contact/index.html", "privacy/index.html",
  "terms/index.html", "cookies/index.html", "thanks/index.html", "404.html", "robots.txt", "_headers"]) {
  check(fs.existsSync(path.join(DIST, p)), `missing ${p}`);
}

console.log(`${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
