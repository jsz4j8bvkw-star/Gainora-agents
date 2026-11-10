// Launch & Grow beyond the website: the Google Business Profile text, the listings sheet, the reviews kit, the
// Google Ads starter plan, the launch checklist and the checks. All worked out from the same Site record, so the
// name, address, phone, services and areas match everywhere (which is what Google rewards).

import { areasOf, clock, ctaOf, DAYS, fromPrice, industryOf, nameOf, openDays, personOf, readHours, type Site, townOf, tradeOf } from './data';
import { copyOf, servicePages } from './render';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fit = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/* ---------- Google Business Profile ---------- */

export interface ProfilePack {
  name: string; nameWarning: string | null;
  primary: string; secondary: string[];
  description: string;
  services: { name: string; price: string; description: string }[];
  hours: string[];
  areas: string[];
  website: string;
  posts: { title: string; text: string; button: string }[];
  photos: string[];
}

export function profilePack(s: Site, siteUrl: string): ProfilePack {
  const ind = industryOf(s);
  const name = nameOf(s);
  const town = townOf(s);
  const trade = tradeOf(s);
  const person = personOf(s);
  const diffs = s.business.differences.filter(Boolean);
  const creds = s.business.credentials.filter(Boolean);
  const stuffed = town && name.toLowerCase().includes(town.toLowerCase()) && !/^\s*$/.test(name);
  const description = [
    `${name} is ${/^[aeiou]/i.test(trade) ? 'an' : 'a'} ${trade}${town ? ` in ${town}` : ''}${s.business.founded ? `, looking after ${person}s since ${s.business.founded}` : ''}.`,
    s.services.length ? `We offer ${s.services.slice(0, 5).map((x) => x.name.toLowerCase()).join(', ')}.` : '',
    diffs.length ? `${diffs.slice(0, 2).map((d) => d.replace(/\.$/, '')).join('. ')}.` : '',
    creds.length ? `${creds.slice(0, 2).map((c) => c.replace(/\.$/, '')).join('. ')}.` : '',
    ind.mobile && areasOf(s).length ? `We cover ${areasOf(s).slice(0, 6).join(', ')}.` : '',
    `${ctaOf(s)} through our website or give us a call.`,
  ].filter(Boolean).join(' ');
  const pages = servicePages(s);
  const posts = [
    { title: 'Introduce the business', text: `${diffs[0] ? `${diffs[0].replace(/\.$/, '')}. ` : ''}${name} ${ind.mobile ? `covers ${areasOf(s).slice(0, 3).join(', ') || town}` : `is ${openDays(s).toLowerCase() || 'open'}`}. ${ctaOf(s)} today.`, button: ind.mobile ? 'Call now' : 'Book' },
    ...pages.slice(0, 2).map((x) => ({ title: x.name, text: `${x.summary || x.name}${x.price ? ` ${x.price}.` : ''} ${ind.mobile ? 'Clear price before we start.' : `Every ${person} starts with a proper chat about what they want.`}`, button: 'Learn more' })),
    { title: 'Meet the team', text: `${s.business.owner ? `${s.business.owner.split(' ')[0]} and the team` : 'The team'} at ${name}${creds[0] ? `: ${creds[0].replace(/\.$/, '').toLowerCase()}` : ''}. ${ind.mobile ? 'Local, reliable and tidy.' : 'We’d love to look after you.'}`, button: ind.mobile ? 'Call now' : 'Book' },
  ];
  return {
    name, nameWarning: stuffed ? 'Use the business name exactly as it appears on the sign and paperwork. Adding a town or service to the name breaks Google’s rules and can get the profile suspended.' : null,
    primary: ind.gbp.primary, secondary: ind.gbp.secondary,
    description: fit(description, 750),
    services: s.services.filter((x) => x.name.trim()).map((x) => ({ name: x.name, price: x.price, description: fit(x.summary || `${x.name}${town ? ` in ${town}` : ''}.`, 300) })),
    hours: DAYS.map((d) => { const r = readHours(s.business.hours[d.id]); return `${d.label}: ${r ? `${clock(r[0])} to ${clock(r[1])}` : 'Closed'}`; }),
    areas: ind.mobile ? areasOf(s).slice(0, 20) : [],
    website: `${siteUrl.replace(/\/$/, '')}/?utm_source=google&utm_medium=organic&utm_campaign=gbp`,
    posts: posts.map((p) => ({ ...p, text: fit(p.text, 1500) })),
    photos: ind.photoIdeas,
  };
}

/* ---------- Listings (name, address, phone the same everywhere) ---------- */

export function napBlock(s: Site): string {
  const b = s.business;
  return [nameOf(s), b.showAddress ? [b.line1, b.line2].filter(Boolean).join(', ') : '', [b.town, b.postcode].filter(Boolean).join(' '), b.phone, b.email, b.domain ? `https://${b.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : ''].filter(Boolean).join('\n');
}
export const directoriesFor = (s: Site) => industryOf(s).directories;

/* ---------- Reviews ---------- */

export interface ReviewKit { when: string; sms: string; email: { subject: string; body: string }; replies: { label: string; text: string }[]; rules: string[] }

export function reviewKit(s: Site): ReviewKit {
  const ind = industryOf(s);
  const name = nameOf(s);
  const first = s.business.owner.split(' ')[0] || 'the team';
  const link = s.reviewLink.trim() || '[your Google review link]';
  const health = ind.person === 'patient' || ind.id === 'aesthetics';
  return {
    when: ind.reviewWhen,
    sms: `Hi [name], thank you for choosing ${name}. If you have a minute, a short Google review would really help us: ${link} Thank you! ${first}`,
    email: {
      subject: `Thank you from ${name}`,
      body: `Hi [name],\n\nThank you for choosing ${name}. We hope you’re happy with ${ind.mobile ? 'the work' : 'your visit'}.\n\nIf you have a minute, would you leave us a short review on Google? It helps other people find us, and we read every one.\n\n${link}\n\nThank you,\n${first}\n${name}`,
    },
    replies: [
      { label: '5 stars', text: `Thank you so much for taking the time to leave a review. We really appreciate it and look forward to seeing you again. ${first}, ${name}` },
      { label: 'Mixed', text: `Thank you for your feedback. We’re glad parts of it went well, and we’d like to hear more about what we could do better. Please call us on ${s.business.phone || '[phone]'} and ask for ${first}. ${name}` },
      { label: 'Negative', text: `We’re sorry to read this. It isn’t the experience we want anyone to have. Please call ${first} on ${s.business.phone || '[phone]'} so we can understand what happened and put it right. ${name}` },
    ],
    rules: [
      'Ask everyone, not just the people you expect to be happy. Choosing who to ask is against Google’s rules.',
      'Never offer a discount, gift or prize for a review. Google bans it, and UK consumer law has banned fake reviews and hidden incentives since April 2025.',
      'Reply to every review within a few days, good or bad. Keep replies short and calm.',
      ...(health ? [`Never confirm in a reply that someone is a ${ind.person} or mention their treatment, even if they did. Keep it general and move the conversation to the phone.`] : []),
    ],
  };
}

/* ---------- Google Ads starter plan ---------- */

export interface AdGroup { name: string; keywords: string[]; headlines: string[]; descriptions: string[]; landing: string }
export interface AdsPlan {
  campaign: string; daily: number; monthly: number; location: string; schedule: string;
  groups: AdGroup[]; negatives: string[]; sitelinks: { text: string; url: string }[]; callouts: string[];
  conversions: string[]; excluded: { service: string; why: string }[];
}

export function adsPlan(s: Site, siteUrl: string): AdsPlan {
  const ind = industryOf(s);
  const town = townOf(s);
  const areas = areasOf(s).slice(0, 3);
  const base = siteUrl.replace(/\/$/, '');
  const pom = ind.caution.find((c) => /prescription/i.test(c.why));
  const excluded: AdsPlan['excluded'] = [];
  const services = s.services.filter((x) => x.name.trim() && !/^free consultation$/i.test(x.name.trim())).filter((x) => {
    if (pom && pom.words.test(`${x.name} ${x.summary}`)) { excluded.push({ service: x.name, why: 'Prescription-only medicines can’t be advertised. Advertise the consultation instead.' }); return false; }
    return true;
  });
  const pages = new Map(servicePages(s).map((x) => [x.id, x]));
  const H = (list: string[]) => [...new Set(list.map((h) => h.trim()).filter((h) => h && h.length <= 30))].slice(0, 15);
  const D = (list: string[]) => [...new Set(list.map((d) => d.trim()).filter((d) => d && d.length <= 90))].slice(0, 4);
  const shared = [
    nameOf(s), ctaOf(s), town ? `Local to ${town}` : '', openDays(s), fromPrice(s) ? `Prices From ${fromPrice(s)}` : '',
    ...s.business.credentials.map(cap), ...s.business.differences.map(cap), ind.mobile ? 'Clear Price Before We Start' : 'Friendly, Expert Care',
    ind.mobile ? 'Call For a Quote Today' : 'Book Online in a Minute',
  ];
  const groups: AdGroup[] = services.slice(0, 5).map((x) => {
    const svc = x.name.toLowerCase().replace(/[^a-z0-9 &'-]/g, '').trim();
    const kws = [`"${svc}"`, `"${svc} near me"`, ...areas.map((a) => `"${svc} ${a.toLowerCase()}"`), ...areas.slice(0, 1).map((a) => `[${svc} ${a.toLowerCase()}]`)];
    return {
      name: x.name,
      keywords: [...new Set(kws)],
      headlines: H([`${cap(svc)} ${town ? `in ${town}` : 'Near You'}`, `${cap(svc)}${x.price ? ` ${x.price.replace(/^From /, 'from ')}` : ''}`, cap(svc), ...shared]),
      descriptions: D([
        `${x.summary || cap(svc)}`.replace(/\s+/g, ' '),
        `${ind.mobile ? 'Clear price before we start. Local, reliable and tidy.' : `Every ${personOf(s)} starts with a proper chat. ${ctaOf(s)} today.`}`,
        `${nameOf(s)}${town ? `, ${town}` : ''}. ${openDays(s) || ''}`.trim(),
        s.business.differences[0] ? `${cap(s.business.differences[0]).replace(/\.$/, '')}.` : `${ctaOf(s)} online or call us today.`,
      ]),
      landing: pages.has(x.id) ? `${base}/services/${x.name.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}/` : `${base}/services/`,
    };
  });
  if (ind.keywordExtras.length) {
    groups.push({
      name: cap(tradeOf(s)), keywords: [...new Set(ind.keywordExtras.flatMap((k) => [`"${k} near me"`, ...areas.map((a) => `"${k} ${a.toLowerCase()}"`)]))],
      headlines: H([`${cap(tradeOf(s))}${town ? ` in ${town}` : ''}`, ...shared]), descriptions: D([`${copyOf(s)['home.intro']}`.slice(0, 90), `${ctaOf(s)} online or call us today.`, `${nameOf(s)}${town ? `, ${town}` : ''}. ${openDays(s)}`.trim()]),
      landing: `${base}/`,
    });
  }
  const monthly = Math.max(0, Math.round(s.ads.monthly || 0));
  const hoursOpen = DAYS.filter((d) => readHours(s.business.hours[d.id]));
  return {
    campaign: `Search | ${nameOf(s)} | ${town || 'Local'}`,
    monthly, daily: Math.round((monthly / 30.4) * 100) / 100,
    location: `${s.ads.radiusMiles} miles around ${s.business.postcode || town || 'the business'}, people in (not just interested in) the area`,
    schedule: hoursOpen.length ? `Run ads all day; show the call button only ${hoursOpen.map((d) => `${d.short} ${clock(readHours(s.business.hours[d.id])![0])}–${clock(readHours(s.business.hours[d.id])![1])}`).join(', ')}` : 'All day',
    groups,
    negatives: [...new Set([...ind.negatives, 'free', 'jobs', 'vacancies', 'course'])],
    sitelinks: [
      ...servicePages(s).slice(0, 2).map((x) => ({ text: fit(x.name, 25), url: `${base}/services/${x.name.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}/` })),
      { text: ind.mobile ? 'Services and prices' : 'Treatments and prices', url: `${base}/services/` },
      { text: 'About us', url: `${base}/about/` },
      { text: 'Contact us', url: `${base}/contact/` },
    ].slice(0, 4),
    callouts: [...new Set([...s.business.credentials, ...s.business.differences, openDays(s), ind.mobile ? 'Clear prices' : 'Free consultation'].map((c) => c.trim()).filter((c) => c && c.length <= 25))].slice(0, 6),
    conversions: [
      'Website enquiries: the thank-you page (/thanks/) as a Google Ads conversion, or the Google tag ID and label in Command Centre → Website → Settings',
      'Calls from ads: switch on the call button and count calls of 60 seconds or more',
      'Calls from the website: clicks on the phone number',
      ...(s.booking.url ? ['Online bookings: clicks on the booking button'] : []),
    ],
    excluded,
  };
}

export function adsCsv(p: AdsPlan): string {
  const rows: string[][] = [['Campaign', 'Ad group', 'Keyword', 'Match type', 'Final URL']];
  for (const g of p.groups) for (const k of g.keywords) rows.push([p.campaign, g.name, k.replace(/^["[]|["\]]$/g, ''), k.startsWith('[') ? 'Exact' : 'Phrase', g.landing]);
  for (const n of p.negatives) rows.push([p.campaign, '', n, 'Negative phrase', '']);
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

/* ---------- The launch plan ---------- */

export interface Task { id: string; text: string; who: 'gainora' | 'owner' | 'both'; detail?: string }
export interface Week { title: string; tasks: Task[] }

export function launchPlan(s: Site): Week[] {
  const ind = industryOf(s);
  return [
    { title: 'Week 1: kick-off', tasks: [
      { id: 'k-call', text: 'Kick-off call: go through the website details together in Command Centre', who: 'both' },
      { id: 'k-gbp', text: 'Claim or create the Google Business Profile and start verification', who: 'owner', detail: 'Verification can take several days, so it starts on day one. Add hello@gainora.co.uk as a manager.' },
      { id: 'k-domain', text: 'Choose the domain, registered in the owner’s name', who: 'owner' },
      { id: 'k-photos', text: `Take or collect photos: ${ind.photoIdeas.slice(0, 3).join('; ').toLowerCase()}`, who: 'owner' },
      { id: 'k-reviews', text: 'Copy the Google review link into Command Centre', who: 'gainora' },
    ] },
    { title: 'Week 2: website', tasks: [
      { id: 'w-copy', text: 'Write the words: headline, services, about, questions', who: 'gainora' },
      { id: 'w-photos', text: 'Add photos and the logo', who: 'gainora' },
      { id: 'w-review', text: 'Owner reads every page on their phone and asks for changes', who: 'owner' },
      { id: 'w-checks', text: 'Clear every warning on the Checks list', who: 'gainora' },
    ] },
    { title: 'Week 3: Google profile and listings', tasks: [
      { id: 'g-profile', text: 'Fill in the Google profile: categories, description, services, hours, photos', who: 'gainora' },
      { id: 'g-website', text: 'Set the profile’s website link to the tracked link from the Google profile tab', who: 'gainora' },
      { id: 'g-listings', text: 'List the business on the directories, with the name, address and phone exactly the same everywhere', who: 'gainora' },
      { id: 'g-fix', text: 'Correct any old listings with a different name, address or phone', who: 'gainora' },
    ] },
    { title: 'Week 4: reviews and tracking', tasks: [
      { id: 'r-ask', text: 'Send the review request to recent happy customers', who: 'owner', detail: 'Use the messages on the Reviews tab. Ask everyone; never offer anything in return.' },
      { id: 'r-reply', text: 'Reply to every existing Google review', who: 'owner' },
      { id: 't-tags', text: 'Add the Google tag and Ads conversion in Command Centre (optional)', who: 'gainora' },
      { id: 't-test', text: 'Test: send a form enquiry and tap the phone number on a phone, then check they show in Performance', who: 'gainora' },
    ] },
    { title: 'Week 5: ads', tasks: [
      { id: 'a-account', text: 'Google Ads account set up in the owner’s name, Gainora added as a manager', who: 'both' },
      { id: 'a-build', text: 'Build the campaign from the Ads plan tab', who: 'gainora' },
      { id: 'a-conv', text: 'Check conversions record before spending', who: 'gainora' },
      { id: 'a-live', text: 'Switch the ads on at the agreed budget', who: 'gainora' },
    ] },
    { title: 'Week 6: live and handover', tasks: [
      { id: 'l-domain', text: 'Point the domain at Gainora and check the padlock (https) shows', who: 'gainora' },
      { id: 'l-publish', text: 'Publish the site on its own domain', who: 'gainora' },
      { id: 'l-search', text: 'Add the site to Google Search Console and submit the sitemap', who: 'gainora' },
      { id: 'l-handover', text: 'Handover call: how to read Performance, what happens each month', who: 'both' },
    ] },
  ];
}

export const MONTHLY: Task[] = [
  { id: 'm-ads', text: 'Ads: check search terms, add negatives, adjust budget and bids', who: 'gainora' },
  { id: 'm-posts', text: 'Four Google profile posts (one a week)', who: 'gainora' },
  { id: 'm-reviews', text: 'Reply to new reviews; ask recent customers for one', who: 'both' },
  { id: 'm-site', text: 'Small website changes: prices, photos, new services', who: 'gainora' },
  { id: 'm-call', text: 'Monthly call: enquiries by source, cost per enquiry, what to change', who: 'both' },
];

export function planProgress(s: Site): { done: number; total: number } {
  const all = launchPlan(s).flatMap((w) => w.tasks);
  return { done: all.filter((t) => s.plan[t.id]).length, total: all.length };
}

/* ---------- Checks ---------- */

export interface Check { level: 'fix' | 'check' | 'good'; text: string; where: string }

export function checks(s: Site): Check[] {
  const out: Check[] = [];
  const ind = industryOf(s);
  const b = s.business;
  const copy = copyOf(s);
  const all = [Object.values(copy).join('\n'), s.services.map((x) => `${x.name} ${x.summary}`).join('\n'), b.differences.join('\n'), b.credentials.join('\n'), (s.faqs ?? []).map((f) => `${f.q} ${f.a}`).join('\n')].join('\n');
  if (!b.name.trim()) out.push({ level: 'fix', text: 'Add the business name.', where: 'Details' });
  if (!b.phone.trim()) out.push({ level: 'fix', text: 'Add a phone number. Most enquiries from a local website are calls.', where: 'Contact' });
  else if (!/^(\+44\s?|0)[\d\s]{9,13}$/.test(b.phone.trim())) out.push({ level: 'check', text: 'The phone number doesn’t look like a UK number. Check it.', where: 'Contact' });
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) out.push({ level: 'fix', text: 'The email address isn’t valid.', where: 'Contact' });
  if (!b.town.trim()) out.push({ level: 'fix', text: 'Add the town. Google needs to know where the business is.', where: 'Contact' });
  if (b.showAddress && !b.line1.trim()) out.push({ level: 'fix', text: 'Add the street address, or switch off “Show the address” if customers don’t visit.', where: 'Contact' });
  if (b.postcode && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(b.postcode.trim())) out.push({ level: 'check', text: 'The postcode doesn’t look like a UK postcode.', where: 'Contact' });
  if (ind.mobile && areasOf(s).length < 2) out.push({ level: 'fix', text: 'List the towns and areas covered. It’s how the site and ads find local customers.', where: 'Contact' });
  if (s.services.filter((x) => x.name.trim()).length < 2) out.push({ level: 'fix', text: 'Add at least two services.', where: 'Services' });
  if (s.services.some((x) => x.name.trim() && !x.price.trim())) out.push({ level: 'check', text: 'Some services have no price. Prices (even “from”) get more enquiries.', where: 'Services' });
  if (/£\s*$|From £$/.test(s.services.map((x) => x.price.trim()).join('\n'))) out.push({ level: 'fix', text: 'A price is unfinished (just “£”).', where: 'Services' });
  if (!servicePages(s).length) out.push({ level: 'check', text: 'No service has its own page. Give the main two or three their own page so they can be found on Google.', where: 'Services' });
  for (const c of ind.caution) { const m = all.match(c.words); if (m) out.push({ level: 'fix', text: `“${m[0]}” appears on the site. ${c.why}`, where: 'Words' }); }
  if (s.services.some((x) => /^your (main|second) service$/i.test(x.name.trim()))) out.push({ level: 'fix', text: 'Replace the example services with real ones.', where: 'Services' });
  if (/\b(lorem|\[.*?\])/i.test(all)) out.push({ level: 'fix', text: 'There’s placeholder text in square brackets on the site.', where: 'Words' });
  if (!s.look.hero && !s.look.about) out.push({ level: 'check', text: 'Add a photo. A real photo of the place or the team builds trust far better than none.', where: 'Look' });
  if (s.look.hero && !s.look.hero.alt.trim()) out.push({ level: 'check', text: 'Describe the main photo (for screen readers and Google).', where: 'Look' });
  if (!s.reviews.filter((r) => r.text.trim()).length && !s.reviewLink.trim()) out.push({ level: 'check', text: 'Add the Google review link, and paste in a few real reviews.', where: 'Reviews' });
  if (s.reviews.some((r) => r.text.trim() && !r.name.trim())) out.push({ level: 'fix', text: 'Every review needs the name the customer used. Only real reviews go on the site.', where: 'Reviews' });
  if (s.booking.url && !/^https:\/\//i.test(s.booking.url.trim())) out.push({ level: 'fix', text: 'The booking link must start with https://', where: 'Contact' });
  if (copy['meta.description'].length > 160) out.push({ level: 'check', text: `The Google description is ${copy['meta.description'].length} characters; Google shows about 155.`, where: 'Words' });
  if (s.tracking.ga4 && !/^G-[A-Z0-9]{4,12}$/.test(s.tracking.ga4.trim())) out.push({ level: 'fix', text: 'The Google Analytics ID should look like G-XXXXXXX.', where: 'Settings' });
  if (s.tracking.adsId && !/^AW-\d{6,12}$/.test(s.tracking.adsId.trim())) out.push({ level: 'fix', text: 'The Google Ads ID should look like AW-123456789.', where: 'Settings' });
  if (ind.id === 'plumber' && /\bgas\b|boiler/i.test(all) && !/gas safe/i.test(b.credentials.join(' '))) out.push({ level: 'fix', text: 'Gas work is mentioned. Add the Gas Safe registration number under credentials.', where: 'Details' });
  if (!b.domain.trim()) out.push({ level: 'check', text: 'No domain yet. The site works on its Gainora address until it has one.', where: 'Settings' });
  if (!out.some((c) => c.level === 'fix')) out.push({ level: 'good', text: 'Nothing needs fixing before it goes live.', where: '' });
  return out;
}
