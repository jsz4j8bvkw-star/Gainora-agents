// Turns a Site into the pages visitors see. Pure: the same code draws the preview in Command Centre and serves
// the live site, so what the owner sees is exactly what goes out.
//
// Every page: one clear next step (call, book or enquire), the phone number tappable on a phone, the business's
// details marked up for Google (LocalBusiness and FAQ structured data), a unique title and description, and no
// cookies. Visits, call taps and enquiries are counted without cookies or anything stored on the visitor's device
// (see netlify/functions/site-event.ts), so no cookie banner is needed unless the owner adds Google tags.

import {
  areasOf, clock, ctaOf, DAYS, type Faq, fromPrice, hoursLabel, industryOf, iso, nameOf, openDays, personOf, readHours,
  type FontPair, type Service, type Site, slug, telHref, townOf, tradeOf, DEFAULT_SECTIONS,
} from './data';

export interface RenderOptions {
  /** Where the site lives: '/' on its own domain, '/site/<slug>/' before it has one. */
  base: string;
  /** The site's id, for counting visits and receiving enquiries. Empty in the editor preview. */
  siteId: string;
  /** The full address of the home page, for canonical links and the sitemap. */
  origin: string;
  preview?: boolean;
}

export interface PageDef { path: string; nav?: string; title: string; description: string; kind: 'home' | 'services' | 'service' | 'about' | 'areas' | 'contact' | 'privacy' | 'thanks'; service?: Service }

/* ---------- Escaping ---------- */
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const attr = (s: unknown) => esc(s).replace(/"/g, '&quot;');
const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');
const para = (text: string) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const safeUrl = (u: string) => (/^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : '');

/* ---------- The words on the site ---------- */

/** Whole sentences, in order, for as long as they fit. */
const upTo = (max: number, parts: string[]) => parts.filter(Boolean).reduce((out, p) => (out ? `${out} ${p}` : p).length <= max ? (out ? `${out} ${p}` : p) : out, '');

export interface CopyField { key: string; label: string; long?: boolean; page: string }

/** The service pages: the ones the owner ticked, up to four, so the site stays at five to eight pages. */
export const servicePages = (s: Site) => s.services.filter((x) => x.page && x.name.trim()).slice(0, 4);
const svcSlug = (x: Service) => slug(x.name);

/** Every editable block of words, in the order they appear, for the editor. */
export function copyFields(s: Site): CopyField[] {
  const f: CopyField[] = [
    { key: 'home.title', label: 'Main headline', page: 'Home' },
    { key: 'home.intro', label: 'Opening paragraph', long: true, page: 'Home' },
    { key: 'home.services', label: 'Services heading', page: 'Home' },
    { key: 'cta.title', label: 'Call to action heading', page: 'Every page' },
    { key: 'cta.text', label: 'Call to action text', long: true, page: 'Every page' },
    { key: 'about.title', label: 'About headline', page: 'About' },
    { key: 'about.text', label: 'About story', long: true, page: 'About' },
    { key: 'contact.intro', label: 'Contact intro', long: true, page: 'Contact' },
    { key: 'meta.description', label: 'Google description (home page)', long: true, page: 'Home' },
  ];
  for (const x of servicePages(s)) {
    f.push({ key: `svc.${x.id}.title`, label: `${x.name}: headline`, page: x.name });
    f.push({ key: `svc.${x.id}.text`, label: `${x.name}: description`, long: true, page: x.name });
  }
  return f;
}

/** The Studio's own wording for every block, using the business's details. The owner's edits replace these. */
export function defaultCopy(s: Site): Record<string, string> {
  const ind = industryOf(s);
  const name = nameOf(s);
  const town = townOf(s);
  const trade = tradeOf(s);
  const person = personOf(s);
  const people = `${person}s`;
  const areas = areasOf(s);
  const diffs = s.business.differences.filter(Boolean);
  const creds = s.business.credentials.filter(Boolean);
  const owner = s.business.owner.trim();
  const since = s.business.founded.trim();
  const c: Record<string, string> = {
    'home.title': town ? `${ind.heroLine} in ${town}` : ind.heroLine,
    'home.intro': [
      `${name} is ${/^[aeiou]/i.test(trade) ? 'an' : 'a'} ${trade}${town ? ` in ${town}` : ''}${since ? `, looking after ${people} since ${since}` : ''}.`,
      diffs[0] ? `${diffs[0].replace(/\.$/, '')}.` : '',
      ind.mobile ? `We cover ${areas.slice(0, 4).join(', ') || 'the local area'}, with a clear price before any work starts.` : `${openDays(s) ? `${openDays(s)}.` : ''}`,
    ].filter(Boolean).join(' '),
    'home.services': ind.mobile ? 'What we do' : 'Treatments and prices',
    'cta.title': ind.mobile ? 'Need a hand? Get a quote today' : `Ready when you are`,
    'cta.text': ind.mobile
      ? `Call us or send a message with a few details${'' /* photo */} and we’ll come back to you with a clear price.`
      : `${ctaOf(s)} online, give us a call, or send a message and we’ll get back to you.`,
    'about.title': owner ? `Hello, I’m ${owner.split(' ')[0]}` : `About ${name}`,
    'about.text': [
      owner
        ? `I started ${name}${since ? ` in ${since}` : ''} because I wanted ${people} to have ${ind.mobile ? 'a tradesperson who turns up, explains things clearly and does the job properly' : 'somewhere they could trust, with honest advice and time to talk things through'}.`
        : `${name} has been looking after ${people}${town ? ` in and around ${town}` : ''}${since ? ` since ${since}` : ''}.`,
      creds.length ? `${creds.map((x) => x.replace(/\.$/, '')).join('. ')}.` : '',
      diffs.length ? `What ${people} tell us they value: ${diffs.map((d) => d.replace(/\.$/, '').toLowerCase()).join('; ')}.` : '',
    ].filter(Boolean).join('\n\n'),
    'contact.intro': ind.mobile
      ? `Tell us what you need and where you are. We cover ${areas.slice(0, 6).join(', ') || 'the local area'}.`
      : `Call, ${s.booking.url ? 'book online, ' : ''}or send a message and we’ll reply as soon as we can${openDays(s) ? `. ${openDays(s)}` : ''}.`,
    'meta.description': upTo(158, [`${name}: ${trade}${town ? ` in ${town}` : ''}.`, s.services.length ? `${s.services.slice(0, 3).map((x) => x.name).join(', ')}.` : '', fromPrice(s) ? `Prices from ${fromPrice(s)}.` : '', `${ctaOf(s)}.`]),
  };
  for (const x of servicePages(s)) {
    c[`svc.${x.id}.title`] = `${x.name}${town ? ` in ${town}` : ''}`;
    c[`svc.${x.id}.text`] = [
      x.summary.trim(),
      ind.mobile
        ? `We give you a clear price before we start, turn up when we say we will and leave everything clean and tidy.`
        : `Every ${person} starts with a proper conversation about what they want, so the result suits you. We explain the costs, what to expect and the aftercare before anything is booked.`,
    ].filter(Boolean).join('\n\n');
  }
  return c;
}

export const copyOf = (s: Site): Record<string, string> => {
  const d = defaultCopy(s);
  const out = { ...d };
  for (const [k, v] of Object.entries(s.copy || {})) if (typeof v === 'string' && v.trim()) out[k] = v;
  return out;
};

/** Questions people ask, answered from the business's own details. The owner can rewrite or replace them. */
export function defaultFaqs(s: Site): Faq[] {
  const ind = industryOf(s);
  const person = personOf(s);
  const areas = areasOf(s);
  const from = fromPrice(s);
  const days = openDays(s);
  const out: Faq[] = [];
  if (ind.mobile) {
    out.push({ q: 'Which areas do you cover?', a: areas.length ? `We cover ${areas.join(', ')} and nearby. If you’re not sure, call and ask.` : 'Call or send us a message with your postcode and we’ll tell you.' });
    out.push({ q: 'Do you give a price before starting?', a: 'Yes. You get a clear price before any work starts. If something changes once we’re on the job, we talk to you first.' });
    out.push({ q: 'How quickly can you come out?', a: `${days ? `${days}. ` : ''}Call us and we’ll give you the earliest time we can do.` });
  } else {
    out.push({ q: 'How much does it cost?', a: from ? `Prices start from ${from}. Every price is on our ${ind.mobile ? 'services' : 'treatments'} list, and we confirm the cost before anything is booked.` : 'We confirm the cost before anything is booked.' });
    if (ind.id === 'aesthetics' || ind.id === 'dental' || ind.id === 'physio') out.push({ q: `Do I need a consultation first?`, a: `Yes. Every new ${person} starts with a consultation, so we can check the treatment is right for you and answer your questions. There’s no obligation to go ahead.` });
    out.push({ q: 'When are you open?', a: `${days || 'Call us for our opening times'}.${s.booking.url ? ' You can book online at any time.' : ''}` });
    if (s.business.showAddress && s.business.line1) out.push({ q: 'Where are you?', a: `${[s.business.line1, s.business.line2, s.business.town, s.business.postcode].filter(Boolean).join(', ')}.` });
  }
  out.push({ q: 'How do I book?', a: `${s.booking.url ? `${ctaOf(s)} online, ` : ''}call ${s.business.phone || 'us'}${s.business.email ? ` or email ${s.business.email}` : ''}. We’ll reply as soon as we can.` });
  return out;
}
export const faqsOf = (s: Site): Faq[] => (s.faqs && s.faqs.filter((f) => f.q.trim() && f.a.trim()).length ? s.faqs.filter((f) => f.q.trim() && f.a.trim()) : defaultFaqs(s));

/* ---------- Pages ---------- */

export function pagesOf(s: Site): PageDef[] {
  const name = nameOf(s);
  const town = townOf(s);
  const trade = tradeOf(s);
  const copy = copyOf(s);
  const ind = industryOf(s);
  const tt = (t: string) => (`${t} | ${name}`.length <= 62 ? `${t} | ${name}` : t).slice(0, 70);
  const pages: PageDef[] = [
    { path: '', kind: 'home', nav: 'Home', title: `${name}${town ? `: ${trade} in ${town}` : ''}`.slice(0, 70), description: copy['meta.description'] },
    { path: 'services/', kind: 'services', nav: ind.mobile ? 'Services' : 'Treatments', title: tt(`${ind.mobile ? 'Services' : 'Treatments'} and prices${town ? ` in ${town}` : ''}`), description: `${s.services.map((x) => x.name).slice(0, 5).join(', ')}. ${fromPrice(s) ? `From ${fromPrice(s)}. ` : ''}${name}${town ? `, ${town}` : ''}.`.slice(0, 158) },
    ...servicePages(s).map((x): PageDef => ({ path: `services/${svcSlug(x)}/`, kind: 'service', service: x, title: tt(copy[`svc.${x.id}.title`] || x.name), description: `${x.summary || x.name}${x.price ? ` ${x.price}.` : ''}`.slice(0, 158) })),
    { path: 'about/', kind: 'about', nav: 'About', title: tt(`About ${name}`), description: `${copy['about.text'].split('\n')[0]}`.slice(0, 158) },
  ];
  if (ind.mobile && areasOf(s).length >= 2) pages.push({ path: 'areas/', kind: 'areas', nav: 'Areas', title: tt(`Areas we cover${town ? ` around ${town}` : ''}`), description: `${trade} covering ${areasOf(s).join(', ')}.`.slice(0, 158) });
  pages.push({ path: 'contact/', kind: 'contact', nav: 'Contact', title: tt('Contact us'), description: `Call ${s.business.phone || name}${s.booking.url ? `, book online` : ''} or send a message.`.slice(0, 158) });
  pages.push({ path: 'privacy/', kind: 'privacy', title: tt('Privacy'), description: `How ${name} looks after your information.` });
  pages.push({ path: 'thanks/', kind: 'thanks', title: tt('Thank you'), description: 'Your message has been sent.' });
  return pages;
}

/* ---------- Look ---------- */

export const FONTS: Record<FontPair, { label: string; display: string; body: string; href: string; displayWeight: number; serif: boolean }> = {
  classic: { label: 'Classic', display: '"Cormorant Garamond", Georgia, serif', body: '"Figtree", system-ui, sans-serif', displayWeight: 500, serif: true, href: 'family=Cormorant+Garamond:wght@500;600&family=Figtree:wght@400;500;600' },
  editorial: { label: 'Editorial', display: '"Fraunces", Georgia, serif', body: '"Inter", system-ui, sans-serif', displayWeight: 500, serif: true, href: 'family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600' },
  grand: { label: 'Grand', display: '"Playfair Display", Georgia, serif', body: '"Source Sans 3", system-ui, sans-serif', displayWeight: 600, serif: true, href: 'family=Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600' },
  friendly: { label: 'Friendly', display: '"DM Serif Display", Georgia, serif', body: '"Karla", system-ui, sans-serif', displayWeight: 400, serif: true, href: 'family=DM+Serif+Display&family=Karla:wght@400;500;700' },
  modern: { label: 'Modern', display: '"Archivo", system-ui, sans-serif', body: '"Archivo", system-ui, sans-serif', displayWeight: 800, serif: false, href: 'family=Archivo:wght@400;500;600;800' },
  clean: { label: 'Clean', display: '"Manrope", system-ui, sans-serif', body: '"Manrope", system-ui, sans-serif', displayWeight: 700, serif: false, href: 'family=Manrope:wght@400;500;600;700;800' },
  geometric: { label: 'Geometric', display: '"Outfit", system-ui, sans-serif', body: '"Outfit", system-ui, sans-serif', displayWeight: 600, serif: false, href: 'family=Outfit:wght@400;500;600;700' },
};
const fontsOf = (s: Site) => FONTS[s.look.fonts] ?? FONTS.classic;

const hexOk = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? h : '#3D4F6B');
/** Relative luminance, to choose readable text on the accent colour. */
function lum(hex: string) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/** The accent is darkened until white text on it passes WCAG AA (4.5:1). */
export function readableAccent(hex: string): string {
  let h = hexOk(hex);
  for (let i = 0; i < 20 && (1.05 / (lum(h) + 0.05)) < 4.5; i++) {
    h = '#' + [1, 3, 5].map((k) => Math.max(0, Math.round(parseInt(h.slice(k, k + 2), 16) * 0.88)).toString(16).padStart(2, '0')).join('');
  }
  return h;
}

export function siteCss(s: Site): string {
  const f = fontsOf(s);
  const a = readableAccent(s.look.accent);
  const bold = s.look.style === 'bold';
  const warm = s.look.style === 'warm';
  const bg = s.look.surface === 'tinted' ? `color-mix(in srgb,${a} 5%,#FCFBF8)` : bold ? '#FFFFFF' : '#FCFCFA';
  return `:root{--accent:${a};--accent-soft:color-mix(in srgb,${a} 9%,#fff);--accent-line:color-mix(in srgb,${a} 22%,#fff);--deep:color-mix(in srgb,${a} 38%,#0E0F11);--ink:#1B1C1E;--ink-2:#4A4C50;--ink-3:#6B6D72;--bg:${bg};--card:#FFFFFF;--line:#E4E3DF;--display:${f.display};--body:${f.body};--dw:${f.displayWeight};--r:${bold ? '4px' : warm ? '22px' : '12px'}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:400 1.0625rem/1.65 var(--body);padding-bottom:76px}
img{max-width:100%;height:auto;display:block}a{color:var(--accent)}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}
h1,h2,h3{font-family:var(--display);font-weight:var(--dw);line-height:1.08;letter-spacing:${f.serif ? '-0.005em' : '-0.025em'};text-wrap:balance;margin:0}
h1{font-size:clamp(2.3rem,5.4vw,3.9rem)}h2{font-size:clamp(1.75rem,3.4vw,2.6rem)}h3{font-size:1.3rem;${f.serif ? 'font-family:var(--body);font-weight:600;letter-spacing:0;' : ''}}
p{margin:0}.lede{font-size:1.18rem;color:var(--ink-2);max-width:56ch}.muted{color:var(--ink-3)}
.eyebrow{font:600 .78rem/1 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:#fff;padding:8px 12px;z-index:50}
header.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:20px;min-height:72px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font:var(--dw) 1.35rem/1.1 var(--display);margin-right:auto}.brand img{height:40px;width:auto}
nav.main{display:flex;gap:22px}nav.main a{color:var(--ink-2);text-decoration:none;font-weight:500;font-size:.98rem}nav.main a[aria-current=page],nav.main a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:6px;text-decoration-thickness:2px;text-decoration-color:var(--accent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:${bold ? '4px' : warm ? '999px' : '10px'};font:600 1rem/1 var(--body);text-decoration:none;border:2px solid var(--accent);cursor:pointer}
.btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{filter:brightness(1.08)}.btn-ghost{background:transparent;color:var(--accent)}.btn-ghost:hover{background:var(--accent-soft)}
.top .phone{font-weight:600;color:var(--ink);text-decoration:none;white-space:nowrap}
.hero{padding:clamp(40px,7vw,88px) 0 clamp(40px,6vw,72px)}.hero .wrap{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:clamp(28px,5vw,64px);align-items:center}
.hero .stack{display:grid;gap:22px}.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.hero-media{border-radius:var(--r);overflow:hidden;aspect-ratio:4/5;max-width:100%;background:var(--accent-soft)}.hero-media img{width:100%;height:100%;object-fit:cover}
.hero-panel{border-radius:var(--r);background:var(--accent);color:#fff;padding:clamp(24px,4vw,40px);display:grid;gap:18px}.hero-panel dt{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;opacity:.8}.hero-panel dd{margin:2px 0 0;font:var(--dw) 1.5rem/1.2 var(--display)}.hero-panel dl{margin:0;display:grid;gap:16px}
.facts{display:flex;flex-wrap:wrap;gap:8px 18px;padding:0;margin:0;list-style:none;color:var(--ink-2);font-size:.95rem}.facts li::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:middle}
section.band{padding:clamp(48px,7vw,88px) 0}section.band.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.head{display:grid;gap:12px;margin-bottom:32px;max-width:64ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;display:grid;gap:10px;align-content:start}.card .price{font-weight:600;color:var(--accent)}.card .meta{display:flex;gap:14px;flex-wrap:wrap;font-size:.92rem;color:var(--ink-3)}.card a.more{font-weight:600;text-decoration:none}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:26px;counter-reset:s;list-style:none;padding:0;margin:0}.steps li{display:grid;gap:8px;counter-increment:s}.steps li::before{content:counter(s);display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-weight:700}
.quotes{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}.quote{margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:24px;display:grid;gap:12px}.quote p{font-size:1.05rem}.quote footer{font-size:.9rem;color:var(--ink-3)}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(28px,5vw,64px);align-items:start}.split .prose{display:grid;gap:16px;max-width:62ch}
.photo{border-radius:var(--r);overflow:hidden;background:var(--accent-soft)}.photo img{width:100%;aspect-ratio:4/3;object-fit:cover}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}.gallery img{border-radius:var(--r);aspect-ratio:1;object-fit:cover;width:100%}
.ticks{list-style:none;padding:0;margin:0;display:grid;gap:10px}.ticks li{padding-left:30px;position:relative}.ticks li::before{content:"";position:absolute;left:4px;top:.5em;width:14px;height:8px;border-left:2.5px solid var(--accent);border-bottom:2.5px solid var(--accent);transform:rotate(-45deg)}
details.faq{border-top:1px solid var(--line);padding:18px 0}details.faq:last-child{border-bottom:1px solid var(--line)}details.faq summary{cursor:pointer;font-weight:600;font-size:1.08rem;list-style:none;display:flex;justify-content:space-between;gap:16px}details.faq summary::after{content:"+";color:var(--accent);font-size:1.4rem;line-height:1}details.faq[open] summary::after{content:"–"}details.faq p{margin-top:10px;color:var(--ink-2);max-width:68ch}
.cta-band{background:var(--accent);color:#fff;border-radius:var(--r);padding:clamp(28px,5vw,56px);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(24px,4vw,48px)}.cta-band h2{color:#fff}.cta-band .lede{color:rgba(255,255,255,.88)}.cta-band .btn-primary{background:#fff;color:var(--accent);border-color:#fff}.cta-band .btn-ghost{color:#fff;border-color:rgba(255,255,255,.7)}.cta-band .btn-ghost:hover{background:rgba(255,255,255,.1)}
form.enquiry{display:grid;gap:14px;background:var(--card);color:var(--ink);border-radius:var(--r);padding:clamp(20px,3vw,28px);border:1px solid var(--line)}
form.enquiry label{display:grid;gap:6px;font-weight:600;font-size:.95rem}form.enquiry .opt{font-weight:400;color:var(--ink-3)}
form.enquiry input,form.enquiry select,form.enquiry textarea{font:inherit;font-weight:400;padding:12px 14px;border:1.5px solid #CFCDC8;border-radius:${bold ? '4px' : '10px'};background:#fff;color:var(--ink);width:100%}form.enquiry textarea{min-height:110px;resize:vertical}
form.enquiry .row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}form.enquiry .small{font-size:.85rem;color:var(--ink-3)}.hp{position:absolute;left:-5000px}
table.hours{border-collapse:collapse;width:100%;max-width:420px;font-variant-numeric:tabular-nums}table.hours td{padding:8px 0;border-bottom:1px solid var(--line)}table.hours td+td{text-align:right;color:var(--ink-2)}
.areas{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0}.areas li{padding:8px 14px;border-radius:999px;background:var(--accent-soft);color:var(--ink);font-weight:500}
footer.foot{background:#16171A;color:#D9D7D2;padding:48px 0 32px;margin-top:clamp(48px,7vw,88px)}footer.foot .wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:28px}footer.foot a{color:#fff}footer.foot h3{font-size:1rem;color:#fff;font-family:var(--body);font-weight:600;margin-bottom:10px}footer.foot .legal{grid-column:1/-1;border-top:1px solid #2E3034;padding-top:18px;font-size:.85rem;color:#9B9892;display:flex;flex-wrap:wrap;gap:8px 20px}
.mbar{position:fixed;left:0;right:0;bottom:0;z-index:30;display:none;gap:10px;padding:10px max(12px,env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));background:var(--card);border-top:1px solid var(--line)}.mbar .btn{flex:1}
.consent{position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:40;max-width:520px;background:#16171A;color:#fff;border-radius:12px;padding:16px;display:grid;gap:12px;font-size:.92rem}.consent .actions .btn{min-height:40px;padding:0 16px;font-size:.92rem}.consent .btn-ghost{color:#fff;border-color:#fff}
.notice{background:var(--accent-soft);border-radius:var(--r);padding:16px 18px}
.hero.deep{background:var(--deep);color:#F4F2EE}.hero.deep .lede,.hero.deep .facts{color:rgba(244,242,238,.82)}.hero.deep .eyebrow{color:color-mix(in srgb,var(--accent) 35%,#fff)}.hero.deep .btn-ghost{color:#fff;border-color:rgba(255,255,255,.6)}.hero.deep .btn-ghost:hover{background:rgba(255,255,255,.08)}.hero.deep .btn-primary{background:#fff;color:var(--deep);border-color:#fff}.hero.deep .facts li::before{background:#fff}.hero.deep .hero-panel{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16)}
.hero.full{position:relative;color:#fff;min-height:min(78vh,720px);display:flex;align-items:flex-end;background:var(--deep) center/cover no-repeat}.hero.full::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,12,.15) 0%,rgba(10,10,12,.72) 78%)}.hero.full .wrap{position:relative;grid-template-columns:minmax(0,760px)}.hero.full .lede,.hero.full .facts{color:rgba(255,255,255,.88)}.hero.full .eyebrow{color:#fff}.hero.full .btn-ghost{color:#fff;border-color:rgba(255,255,255,.7)}.hero.full .btn-primary{background:#fff;color:var(--ink);border-color:#fff}.hero.full .facts li::before{background:#fff}
.hero.centred .wrap{grid-template-columns:1fr;justify-items:center;text-align:center}.hero.centred .stack{justify-items:center;max-width:820px}.hero.centred .actions,.hero.centred .facts{justify-content:center}.hero.centred .hero-wide{width:100%;border-radius:var(--r);overflow:hidden;aspect-ratio:21/9;background:var(--accent-soft)}.hero.centred .hero-wide img{width:100%;height:100%;object-fit:cover}
.deep-cta .cta-band{background:var(--deep)}
.strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.strip img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r)}@media (max-width:640px){.strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){nav.main{display:none}.top .phone{display:none}.hero .wrap,.split,.cta-band{grid-template-columns:1fr}.hero-media{aspect-ratio:4/3}.mbar{display:flex}}
@media (min-width:861px){body{padding-bottom:0}}
@media (max-width:520px){form.enquiry .row2{grid-template-columns:1fr}.top .btn{display:none}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;
}

/* ---------- Building blocks ---------- */

function businessLd(s: Site, o: RenderOptions) {
  const ind = industryOf(s);
  const b = s.business;
  const hours = DAYS.map((d) => ({ d, r: readHours(b.hours[d.id]) })).filter((x) => x.r).map((x) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: x.d.label, opens: iso(x.r![0]), closes: iso(x.r![1]) }));
  return {
    '@context': 'https://schema.org', '@type': ind.schema, name: nameOf(s), url: o.origin, telephone: b.phone || undefined, email: b.email || undefined,
    image: s.look.hero?.url || s.look.logo?.url || undefined, logo: s.look.logo?.url || undefined,
    address: b.showAddress && b.line1 ? { '@type': 'PostalAddress', streetAddress: [b.line1, b.line2].filter(Boolean).join(', '), addressLocality: b.town, postalCode: b.postcode, addressCountry: 'GB' } : (b.town ? { '@type': 'PostalAddress', addressLocality: b.town, postalCode: b.postcode || undefined, addressCountry: 'GB' } : undefined),
    areaServed: areasOf(s).map((a) => ({ '@type': 'Place', name: a })),
    openingHoursSpecification: hours.length ? hours : undefined,
    sameAs: s.reviewLink ? undefined : undefined,
    makesOffer: s.services.filter((x) => x.name).slice(0, 12).map((x) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: x.name, description: x.summary || undefined } })),
  };
}

function header(s: Site, o: RenderOptions, page: PageDef, pages: PageDef[]) {
  const nav = pages.filter((p) => p.nav && p.kind !== 'home');
  const logo = s.look.logo?.url ? `<img src="${attr(s.look.logo.url)}" alt="${attr(nameOf(s))}" width="160" height="40">` : esc(nameOf(s));
  return `<a class="skip" href="#main">Skip to content</a><header class="top"><div class="wrap"><a class="brand" href="${attr(o.base)}">${logo}</a><nav class="main" aria-label="Main">${nav.map((p) => `<a href="${attr(o.base + p.path)}"${p.path === page.path || (page.kind === 'service' && p.kind === 'services') ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`).join('')}</nav>${s.business.phone ? `<a class="phone" href="${attr(telHref(s.business.phone))}" data-track="call">${esc(s.business.phone)}</a>` : ''}${primaryCta(s, o, 'btn btn-primary')}</div></header>`;
}

function primaryCta(s: Site, o: RenderOptions, cls: string, label?: string) {
  const book = safeUrl(s.booking.url);
  if (book) return `<a class="${cls}" href="${attr(book)}" data-track="book" rel="noopener">${esc(label || ctaOf(s))}</a>`;
  return `<a class="${cls}" href="${attr(o.base)}contact/#enquire">${esc(label || ctaOf(s))}</a>`;
}

function servicesGrid(s: Site, o: RenderOptions, max = 99) {
  const pages = new Set(servicePages(s).map((x) => x.id));
  return `<div class="grid">${s.services.filter((x) => x.name.trim()).slice(0, max).map((x) => `<article class="card"><h3>${esc(x.name)}</h3>${x.summary ? `<p class="muted">${esc(x.summary)}</p>` : ''}<div class="meta">${x.price ? `<span class="price">${esc(x.price)}</span>` : ''}${x.duration ? `<span>${esc(x.duration)}</span>` : ''}</div>${pages.has(x.id) ? `<a class="more" href="${attr(o.base)}services/${attr(svcSlug(x))}/">More about ${esc(x.name.toLowerCase())} →</a>` : ''}</article>`).join('')}</div>`;
}

function reviewsBlock(s: Site) {
  const real = s.reviews.filter((r) => r.text.trim() && r.name.trim()).slice(0, 6);
  const link = safeUrl(s.reviewLink);
  if (!real.length && !link) return '';
  const quotes = real.map((r) => `<blockquote class="quote"><p>“${esc(r.text.trim())}”</p><footer>${esc(r.name)}${r.source ? `, ${esc(r.source)}` : ''}</footer></blockquote>`).join('');
  return `<section class="band alt" aria-labelledby="rev-h"><div class="wrap"><div class="head"><p class="eyebrow">Reviews</p><h2 id="rev-h">What ${esc(personOf(s))}s say</h2></div>${quotes ? `<div class="quotes">${quotes}</div>` : ''}${link ? `<p style="margin-top:24px"><a href="${attr(link)}" rel="noopener">Read our reviews on Google</a></p>` : ''}</div></section>`;
}

function faqBlock(faqs: Faq[]) {
  if (!faqs.length) return '';
  return `<section class="band" aria-labelledby="faq-h"><div class="wrap split"><div class="head"><p class="eyebrow">Questions</p><h2 id="faq-h">Good to know</h2></div><div>${faqs.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div></div></section>`;
}

function enquiryForm(s: Site, o: RenderOptions, preselect?: string) {
  const ind = industryOf(s);
  const action = o.preview ? '#' : `/api/site-enquiry/${attr(o.siteId)}`;
  return `<form class="enquiry" id="enquire" method="post" action="${action}" data-enquiry>
<input type="hidden" name="page" value=""><input type="hidden" name="source" value="">
<label class="hp" aria-hidden="true">Leave this empty<input name="website_url_confirm" tabindex="-1" autocomplete="off"></label>
<div class="row2"><label>Your name<input name="name" autocomplete="name" required maxlength="120"></label><label>Phone<input name="phone" type="tel" autocomplete="tel" inputmode="tel" required maxlength="40"></label></div>
<label>Email <span class="opt">optional</span><input name="email" type="email" autocomplete="email" maxlength="160"></label>
${s.services.length ? `<label>${ind.mobile ? 'What do you need?' : 'What are you interested in?'}<select name="service"><option value="">Not sure yet</option>${s.services.filter((x) => x.name.trim()).map((x) => `<option${preselect === x.name ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
${ind.mobile ? '<label>Postcode<input name="postcode" autocomplete="postal-code" maxlength="10"></label>' : ''}
<label>Message <span class="opt">optional</span><textarea name="message" maxlength="2000"></textarea></label>
<button class="btn btn-primary" type="submit">Send message</button>
<p class="small">We only use your details to reply to you. <a href="${attr(o.base)}privacy/">Privacy</a></p>
</form>`;
}

function ctaBand(s: Site, o: RenderOptions, copy: Record<string, string>, preselect?: string) {
  return `<section class="band${s.look.surface === 'deep' ? ' deep-cta' : ''}" aria-labelledby="cta-h"><div class="wrap"><div class="cta-band"><div class="stack" style="display:grid;gap:18px;align-content:start"><h2 id="cta-h">${esc(copy['cta.title'])}</h2><p class="lede">${esc(copy['cta.text'])}</p><div class="actions">${s.booking.url ? primaryCta(s, o, 'btn btn-primary') : ''}${s.business.phone ? `<a class="btn btn-ghost" href="${attr(telHref(s.business.phone))}" data-track="call">Call ${esc(s.business.phone)}</a>` : ''}</div></div>${enquiryForm(s, o, preselect)}</div></div></section>`;
}

function hoursTable(s: Site) {
  return `<table class="hours"><tbody>${DAYS.map((d) => `<tr><td>${d.label}</td><td>${esc(hoursLabel(s.business.hours[d.id]))}</td></tr>`).join('')}</tbody></table>`;
}

function footer(s: Site, o: RenderOptions, pages: PageDef[]) {
  const b = s.business;
  const year = new Date().getFullYear();
  return `<footer class="foot"><div class="wrap"><div><h3>${esc(nameOf(s))}</h3><p>${esc(tradeOf(s).replace(/^./, (c) => c.toUpperCase()))}${townOf(s) ? ` in ${esc(townOf(s))}` : ''}</p>${b.showAddress && b.line1 ? `<p>${esc([b.line1, b.line2, b.town, b.postcode].filter(Boolean).join(', '))}</p>` : ''}</div><div><h3>Contact</h3>${b.phone ? `<p><a href="${attr(telHref(b.phone))}" data-track="call">${esc(b.phone)}</a></p>` : ''}${b.email ? `<p><a href="mailto:${attr(b.email)}">${esc(b.email)}</a></p>` : ''}${openDays(s) ? `<p>${esc(openDays(s))}</p>` : ''}</div><div><h3>Pages</h3>${pages.filter((p) => p.nav).map((p) => `<p><a href="${attr(o.base + p.path)}">${esc(p.nav)}</a></p>`).join('')}</div><div class="legal"><span>© ${year} ${esc(nameOf(s))}</span><a href="${attr(o.base)}privacy/">Privacy</a></div></div></footer>`;
}

function mobileBar(s: Site, o: RenderOptions) {
  return `<div class="mbar">${s.business.phone ? `<a class="btn btn-ghost" href="${attr(telHref(s.business.phone))}" data-track="call">Call</a>` : ''}${primaryCta(s, o, 'btn btn-primary', industryOf(s).cta.short === 'Book' ? 'Book' : industryOf(s).cta.short === 'Quote' ? 'Get a quote' : 'Enquire')}</div>`;
}

/* ---------- Page bodies ---------- */

function homeBody(s: Site, o: RenderOptions, copy: Record<string, string>) {
  const ind = industryOf(s);
  const sec = { ...DEFAULT_SECTIONS, ...(s.look.sections || {}) };
  const facts = [openDays(s), fromPrice(s) ? `Prices from ${fromPrice(s)}` : '', ...s.business.credentials.slice(0, 2)].filter(Boolean);
  const photo = s.look.hero?.url ? s.look.hero : null;
  const panel = `<div class="hero-panel"><dl>${[
    ['Where', s.business.showAddress && s.business.line1 ? `${s.business.line1}, ${townOf(s)}` : (areasOf(s).slice(0, 3).join(', ') || townOf(s))],
    ['When', openDays(s).replace(/^Open /, '')],
    [ind.mobile ? 'Prices' : 'From', fromPrice(s) ? `${ind.mobile ? 'Clear quotes, from ' : ''}${fromPrice(s)}` : 'Clear prices, agreed first'],
  ].filter((x) => x[1]).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`;
  const text = `<div class="stack"><p class="eyebrow">${esc(tradeOf(s))}${townOf(s) ? ` · ${esc(townOf(s))}` : ''}</p><h1>${esc(copy['home.title'])}</h1><p class="lede">${esc(copy['home.intro'])}</p><div class="actions">${primaryCta(s, o, 'btn btn-primary')}${s.business.phone ? `<a class="btn btn-ghost" href="${attr(telHref(s.business.phone))}" data-track="call">Call ${esc(s.business.phone)}</a>` : ''}</div>${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>`;
  const deep = s.look.surface === 'deep' ? ' deep' : '';
  // Three ways to open the page: text beside a photo, text over a full-width photo, or centred text above a wide photo.
  const layout = s.look.heroLayout === 'full' && photo ? 'full' : s.look.heroLayout === 'centred' ? 'centred' : 'split';
  const hero = layout === 'full'
    ? `<section class="hero full" style="background-image:url('${attr(photo!.url).replace(/'/g, '%27')}')" role="img" aria-label="${attr(photo!.alt || nameOf(s))}"><div class="wrap">${text}</div></section>`
    : layout === 'centred'
      ? `<section class="hero centred${deep}"><div class="wrap">${text}${photo ? `<div class="hero-wide"><img src="${attr(photo.url)}" alt="${attr(photo.alt || nameOf(s))}" width="1600" height="686" fetchpriority="high"></div>` : ''}</div></section>`
      : `<section class="hero${deep}"><div class="wrap">${text}${photo ? `<div class="hero-media"><img src="${attr(photo.url)}" alt="${attr(photo.alt || nameOf(s))}" width="800" height="1000" fetchpriority="high"></div>` : panel}</div></section>`;
  const gallery = sec.gallery && s.look.gallery.length >= 4 ? `<section class="band" aria-label="Photos"><div class="wrap"><div class="strip">${s.look.gallery.slice(0, 4).map((g) => `<img src="${attr(g.url)}" alt="${attr(g.alt || nameOf(s))}" width="400" height="400" loading="lazy">`).join('')}</div></div></section>` : '';
  return `${hero}
<section class="band alt" aria-labelledby="svc-h"><div class="wrap"><div class="head"><p class="eyebrow">${ind.mobile ? 'Services' : 'Treatments'}</p><h2 id="svc-h">${esc(copy['home.services'])}</h2></div>${servicesGrid(s, o, 6)}${s.services.length > 6 ? `<p style="margin-top:20px"><a href="${attr(o.base)}services/">See everything we do →</a></p>` : ''}</div></section>
${sec.how ? `<section class="band" aria-labelledby="how-h"><div class="wrap"><div class="head"><p class="eyebrow">How it works</p><h2 id="how-h">Simple from the first call</h2></div><ol class="steps">${ind.steps.map(([t, d]) => `<li><h3>${esc(t)}</h3><p class="muted">${esc(d)}</p></li>`).join('')}</ol></div></section>` : ''}
${gallery}
${sec.why && (s.business.differences.filter(Boolean).length || s.look.about?.url) ? `<section class="band alt" aria-labelledby="why-h"><div class="wrap split">${s.look.about?.url ? `<div class="photo"><img src="${attr(s.look.about.url)}" alt="${attr(s.look.about.alt || nameOf(s))}" width="800" height="600" loading="lazy"></div>` : ''}<div class="prose"><p class="eyebrow">Why ${esc(nameOf(s))}</p><h2 id="why-h">${esc(copy['about.title'])}</h2>${s.business.differences.filter(Boolean).length ? `<ul class="ticks">${s.business.differences.filter(Boolean).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}<p><a href="${attr(o.base)}about/">About us →</a></p></div></div></section>` : ''}
${sec.reviews ? reviewsBlock(s) : ''}
${sec.faq ? faqBlock(faqsOf(s).slice(0, 5)) : ''}
${ctaBand(s, o, copy)}`;
}

function servicesBody(s: Site, o: RenderOptions, copy: Record<string, string>) {
  const ind = industryOf(s);
  return `<section class="hero"><div class="wrap"><div class="stack"><p class="eyebrow">${ind.mobile ? 'Services' : 'Treatments'}</p><h1>${ind.mobile ? 'What we do' : 'Treatments and prices'}</h1><p class="lede">${ind.mobile ? 'Every job gets a clear price before we start.' : 'Every price is here. We confirm the cost with you before anything is booked.'}</p></div></div></section>
<section class="band alt"><div class="wrap">${servicesGrid(s, o)}</div></section>${ctaBand(s, o, copy)}`;
}

function serviceBody(s: Site, o: RenderOptions, copy: Record<string, string>, x: Service) {
  const faqs: Faq[] = [];
  if (x.price) faqs.push({ q: `How much does ${x.name.toLowerCase()} cost?`, a: `${x.price}. We confirm the exact cost with you before anything goes ahead.` });
  if (x.duration) faqs.push({ q: 'How long does it take?', a: `${x.duration}.` });
  faqs.push(...faqsOf(s).filter((f) => /book|consultation|cover|price before/i.test(f.q)).slice(0, 2));
  const gallery = s.look.gallery.slice(0, 3);
  return `<section class="hero"><div class="wrap"><div class="stack"><p class="eyebrow"><a href="${attr(o.base)}services/">${industryOf(s).mobile ? 'Services' : 'Treatments'}</a></p><h1>${esc(copy[`svc.${x.id}.title`] || x.name)}</h1><div class="lede" style="display:grid;gap:14px">${para(copy[`svc.${x.id}.text`] || x.summary)}</div><div class="actions">${primaryCta(s, o, 'btn btn-primary')}${s.business.phone ? `<a class="btn btn-ghost" href="${attr(telHref(s.business.phone))}" data-track="call">Call ${esc(s.business.phone)}</a>` : ''}</div></div><div class="hero-panel"><dl>${[['Price', x.price], ['Time', x.duration], ['Where', s.business.showAddress && s.business.line1 ? `${s.business.line1}, ${townOf(s)}` : areasOf(s).slice(0, 3).join(', ')]].filter((r) => r[1]).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div></div></section>
${gallery.length ? `<section class="band alt"><div class="wrap"><div class="gallery">${gallery.map((g) => `<img src="${attr(g.url)}" alt="${attr(g.alt || x.name)}" width="400" height="400" loading="lazy">`).join('')}</div></div></section>` : ''}
${faqBlock(faqs)}${ctaBand(s, o, copy, x.name)}`;
}

function aboutBody(s: Site, o: RenderOptions, copy: Record<string, string>) {
  const creds = s.business.credentials.filter(Boolean);
  return `<section class="hero"><div class="wrap split"><div class="prose"><p class="eyebrow">About</p><h1>${esc(copy['about.title'])}</h1>${para(copy['about.text'])}${creds.length ? `<ul class="ticks">${creds.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</div>${s.look.about?.url ? `<div class="photo"><img src="${attr(s.look.about.url)}" alt="${attr(s.look.about.alt || nameOf(s))}" width="800" height="600"></div>` : ''}</div></section>
${s.look.gallery.length ? `<section class="band alt"><div class="wrap"><div class="gallery">${s.look.gallery.slice(0, 8).map((g) => `<img src="${attr(g.url)}" alt="${attr(g.alt || nameOf(s))}" width="400" height="400" loading="lazy">`).join('')}</div></div></section>` : ''}
${reviewsBlock(s)}${ctaBand(s, o, copy)}`;
}

function areasBody(s: Site, o: RenderOptions, copy: Record<string, string>) {
  return `<section class="hero"><div class="wrap"><div class="stack"><p class="eyebrow">Areas</p><h1>Areas we cover</h1><p class="lede">${esc(nameOf(s))} works across ${esc(areasOf(s).join(', '))} and the villages in between. Not sure if we cover you? Call or send your postcode.</p><ul class="areas">${areasOf(s).map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div></div></section>${ctaBand(s, o, copy)}`;
}

function contactBody(s: Site, o: RenderOptions, copy: Record<string, string>) {
  const b = s.business;
  const mapQ = encodeURIComponent([nameOf(s), b.line1, b.town, b.postcode].filter(Boolean).join(', '));
  return `<section class="hero"><div class="wrap split"><div class="prose"><p class="eyebrow">Contact</p><h1>Get in touch</h1><p class="lede">${esc(copy['contact.intro'])}</p>
${b.phone ? `<p><strong>Phone</strong><br><a href="${attr(telHref(b.phone))}" data-track="call">${esc(b.phone)}</a></p>` : ''}${b.email ? `<p><strong>Email</strong><br><a href="mailto:${attr(b.email)}">${esc(b.email)}</a></p>` : ''}
${b.showAddress && b.line1 ? `<p><strong>Address</strong><br>${esc([b.line1, b.line2, b.town, b.postcode].filter(Boolean).join(', '))}<br><a href="https://www.google.com/maps/search/?api=1&amp;query=${attr(mapQ)}" rel="noopener">Open in Google Maps</a></p>` : ''}
${s.booking.url ? `<p>${primaryCta(s, o, 'btn btn-primary')}</p>` : ''}
<h2 style="font-size:1.4rem;margin-top:12px">Opening hours</h2>${hoursTable(s)}
${industryOf(s).mobile && areasOf(s).length ? `<h2 style="font-size:1.4rem;margin-top:12px">Areas we cover</h2><ul class="areas">${areasOf(s).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
</div><div><h2 style="font-size:1.6rem;margin-bottom:16px">Send a message</h2>${enquiryForm(s, o)}</div></div></section>`;
}

function privacyBody(s: Site) {
  const name = nameOf(s);
  const contact = s.business.email || s.business.phone || 'the details on our contact page';
  const tags = !!(s.tracking.ga4 || s.tracking.adsId);
  return `<section class="hero"><div class="wrap"><div class="prose" style="display:grid;gap:16px;max-width:70ch"><p class="eyebrow">Privacy</p><h1>How we look after your information</h1>
<p>${esc(name)} is responsible for the information you give us on this website. Questions about it go to ${esc(contact)}.</p>
<h2 style="font-size:1.4rem">What we collect</h2><p>When you send a message, we receive your name, phone number, and anything else you choose to tell us (email, postcode, what you need and your message). We use it only to reply to you and, if you go ahead, to arrange ${industryOf(s).mobile ? 'the work' : 'your appointment'}.</p>
<h2 style="font-size:1.4rem">Visits to this site</h2><p>We count visits so we know which pages help people. We do this without cookies and without storing anything on your device. We record the page, the website that sent you here, and whether you used a phone or computer. We never record who you are.</p>
${tags ? '<p>If you choose “Accept” on the cookie message, we also use Google tools that set cookies to measure our adverts. If you choose “No thanks”, they are not loaded.</p>' : '<p>This site sets no cookies.</p>'}
<h2 style="font-size:1.4rem">Who sees it</h2><p>Your messages are kept securely by Gainora, who runs this website for us, and are never sold or shared for marketing. We keep enquiries for up to two years unless you ask us to delete them sooner.</p>
<h2 style="font-size:1.4rem">Your rights</h2><p>You can ask to see, correct or delete the information we hold about you by contacting us. If you’re unhappy with how we’ve handled it, you can complain to the Information Commissioner’s Office at ico.org.uk.</p>
</div></div></section>`;
}

function thanksBody(s: Site, o: RenderOptions) {
  return `<section class="hero"><div class="wrap"><div class="stack" style="max-width:640px"><p class="eyebrow">Message sent</p><h1>Thank you</h1><p class="lede">We’ve got your message and will reply as soon as we can${openDays(s) ? `. ${esc(openDays(s))}` : ''}.</p>${s.business.phone ? `<p>If it’s urgent, call <a href="${attr(telHref(s.business.phone))}" data-track="call">${esc(s.business.phone)}</a>.</p>` : ''}<p><a class="btn btn-ghost" href="${attr(o.base)}">Back to the home page</a></p></div></div></section>`;
}

/* ---------- The small script on every page ---------- */

/** Counts the visit, call taps and booking clicks (no cookies, nothing stored on the device), fills the form's
 * hidden fields, and only loads Google's tags if the owner added them and the visitor says yes. */
export function siteScript(s: Site, o: RenderOptions): string {
  if (o.preview) return '';
  const ga = /^G-[A-Z0-9]{4,12}$/.test(s.tracking.ga4.trim()) ? s.tracking.ga4.trim() : '';
  const aw = /^AW-\d{6,12}$/.test(s.tracking.adsId.trim()) ? s.tracking.adsId.trim() : '';
  const label = /^[A-Za-z0-9_-]{4,40}$/.test(s.tracking.adsLabel.trim()) ? s.tracking.adsLabel.trim() : '';
  const tagId = ga || aw;
  return `<script>(function(){var S=${JSON.stringify(o.siteId)},L=location,q=new URLSearchParams(L.search);
function src(){var r=document.referrer,h='';try{h=r?new URL(r).hostname:''}catch(e){}if(q.get('gclid')||q.get('gbraid')||q.get('wbraid'))return'Google Ads';var u=(q.get('utm_source')||'').toLowerCase(),m=(q.get('utm_medium')||'').toLowerCase();if(u){if(/gbp|business|maps/.test(u+(q.get('utm_campaign')||'').toLowerCase()))return'Google Business Profile';if(/cpc|paid|ppc/.test(m))return u.indexOf('facebook')>-1||u.indexOf('instagram')>-1||u.indexOf('meta')>-1?'Facebook and Instagram ads':'Google Ads';return u.charAt(0).toUpperCase()+u.slice(1)}if(!h||h===L.hostname)return h?'This website':'Direct';if(/google\\./.test(h))return'Google search';if(/bing\\.|duckduckgo|yahoo|ecosia/.test(h))return'Other search engines';if(/facebook|instagram|fb\\.|messenger/.test(h))return'Facebook and Instagram';return h.replace(/^www\\./,'')}
function send(k){try{var b=JSON.stringify({s:S,k:k,p:L.pathname,src:src(),d:innerWidth<760?'phone':'computer'});navigator.sendBeacon?navigator.sendBeacon('/api/site-event',b):fetch('/api/site-event',{method:'POST',body:b,keepalive:true})}catch(e){}}
send('view');
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-track]');if(!a)return;var k=a.getAttribute('data-track');send(k);if(window.gtag&&k==='call')gtag('event','phone_call_click')});
document.querySelectorAll('form[data-enquiry]').forEach(function(f){f.page.value=L.pathname;f.source.value=src();f.addEventListener('submit',function(){if(window.gtag){gtag('event','generate_lead');${aw && label ? `gtag('event','conversion',{send_to:'${aw}/${label}'})` : ''}}})});
${tagId ? `var K='gainora-consent';function load(){var t=document.createElement('script');t.async=1;t.src='https://www.googletagmanager.com/gtag/js?id=${tagId}';document.head.appendChild(t);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());${ga ? `gtag('config','${ga}');` : ''}${aw ? `gtag('config','${aw}');` : ''}}
var c=null;try{c=localStorage.getItem(K)}catch(e){}if(c==='yes')load();else if(c!=='no'){var d=document.createElement('div');d.className='consent';d.setAttribute('role','dialog');d.setAttribute('aria-label','Cookies');d.innerHTML='<p>Can we use cookies to see how people find us and measure our adverts? Nothing else changes if you say no.</p><div class="actions"><button class="btn btn-primary" type="button">Accept</button><button class="btn btn-ghost" type="button">No thanks</button></div>';document.body.appendChild(d);var bs=d.querySelectorAll('button');bs[0].onclick=function(){try{localStorage.setItem(K,'yes')}catch(e){}d.remove();load()};bs[1].onclick=function(){try{localStorage.setItem(K,'no')}catch(e){}d.remove()}}` : ''}
})();</script>`;
}

/* ---------- Whole pages ---------- */

export function renderPage(s: Site, path: string, o: RenderOptions): { html: string; page: PageDef } | null {
  const pages = pagesOf(s);
  const clean = path.replace(/^\/+/, '').replace(/index\.html$/, '');
  const page = pages.find((p) => p.path === clean || p.path === `${clean}/`);
  if (!page) return null;
  const copy = copyOf(s);
  const f = fontsOf(s);
  const canonical = `${o.origin.replace(/\/$/, '')}/${page.path}`;
  const body = page.kind === 'home' ? homeBody(s, o, copy)
    : page.kind === 'services' ? servicesBody(s, o, copy)
      : page.kind === 'service' ? serviceBody(s, o, copy, page.service!)
        : page.kind === 'about' ? aboutBody(s, o, copy)
          : page.kind === 'areas' ? areasBody(s, o, copy)
            : page.kind === 'contact' ? contactBody(s, o, copy)
              : page.kind === 'privacy' ? privacyBody(s)
                : thanksBody(s, o);
  const ld: unknown[] = [businessLd(s, o)];
  if (page.kind === 'home') ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqsOf(s).slice(0, 5).map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) });
  const noindex = page.kind === 'thanks' || o.preview;
  const css = siteCss(s);
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(page.title)}</title><meta name="description" content="${attr(page.description)}">${noindex ? '<meta name="robots" content="noindex">' : ''}<link rel="canonical" href="${attr(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${attr(page.title)}"><meta property="og:description" content="${attr(page.description)}"><meta property="og:url" content="${attr(canonical)}">${s.look.hero?.url ? `<meta property="og:image" content="${attr(s.look.hero.url)}">` : ''}
<meta name="theme-color" content="${attr(readableAccent(s.look.accent))}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${f.href}&display=swap">
<style>${css}</style>
${ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join('')}
</head><body>${header(s, o, page, pages)}<main id="main">${body}</main>${footer(s, o, pages)}${mobileBar(s, o)}${siteScript(s, o)}</body></html>`;
  return { html, page };
}

export function sitemap(s: Site, origin: string): string {
  const base = origin.replace(/\/$/, '');
  const urls = pagesOf(s).filter((p) => p.kind !== 'thanks');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${esc(`${base}/${p.path}`)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export const robots = (origin: string, allow: boolean) => (allow ? `User-agent: *\nAllow: /\nDisallow: /thanks/\n\nSitemap: ${origin.replace(/\/$/, '')}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');

/** Plain-English time for the hours, e.g. for the Google profile. */
export const hoursLines = (s: Site) => DAYS.map((d) => { const r = readHours(s.business.hours[d.id]); return `${d.label}: ${r ? `${clock(r[0])} to ${clock(r[1])}` : 'Closed'}`; });
