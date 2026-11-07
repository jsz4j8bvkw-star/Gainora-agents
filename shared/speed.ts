// Turns a Google PageSpeed Insights result into a short list of fixes in plain English,
// ranked by how much each one is likely to matter to the business.

export type Impact = 'High' | 'Medium' | 'Low';

export interface Fix {
  id: string;
  title: string;
  why: string;
  how: string;
  who: 'You' | 'Your web person';
  impact: Impact;
  saving?: string;
  done?: boolean;
}

export interface FieldMetric { value: string; rating: 'Good' | 'Needs work' | 'Poor' }

export interface SpeedState {
  checkedAt: string;
  strategy: 'mobile';
  scores: { performance: number | null; accessibility: number | null; seo: number | null; bestPractices: number | null };
  field: { lcp?: FieldMetric; inp?: FieldMetric; cls?: FieldMetric } | null;
  fixes: Fix[];
}

interface Plain { title: string; why: string; how: string; who: 'You' | 'Your web person'; base: Impact }

const IMAGES: Plain = {
  title: 'Shrink your photos', base: 'High', who: 'You',
  why: 'Large images are the most common reason pages are slow on phones, and slow pages lose visitors before they see anything.',
  how: 'Resize photos to no more than 2,000 pixels wide and save them as WebP or compressed JPEG. Most website builders have an image compression setting or app.',
};
const LCP_IMAGE: Plain = {
  title: 'Load your main image first', base: 'High', who: 'Your web person',
  why: 'The biggest image at the top of the page is set to load late, so the page looks empty for longer.',
  how: 'Ask your web person to turn off “lazy loading” for the top banner image and mark it as high priority.',
};
const BLOCKING: Plain = {
  title: 'Stop extra code delaying the page', base: 'Medium', who: 'Your web person',
  why: 'Some style and script files must finish downloading before anything appears on screen.',
  how: 'Ask your web person to load non-essential scripts later (defer them) and to inline the small amount of styling the top of the page needs.',
};
const UNUSED_JS: Plain = {
  title: 'Remove apps and scripts you don’t use', base: 'Medium', who: 'You',
  why: 'Every plug-in, chat widget or tracking script adds code that phones have to download and run.',
  how: 'Go through your website apps and plug-ins and remove any you no longer use. Ask your web person about any you are unsure of.',
};
const SERVER: Plain = {
  title: 'Speed up your website host', base: 'High', who: 'Your web person',
  why: 'Your server takes a long time to start sending the page, which delays everything else.',
  how: 'Ask your host about caching, or consider a faster hosting plan. Shop platforms usually handle this; contact their support if it stays slow.',
};
const CACHE: Plain = {
  title: 'Let browsers remember your files', base: 'Low', who: 'Your web person',
  why: 'Returning visitors download the same images and files again instead of reusing them.',
  how: 'Ask your web person to set longer cache times for images, fonts and scripts.',
};
const SHIFT: Plain = {
  title: 'Stop the page jumping as it loads', base: 'Medium', who: 'Your web person',
  why: 'Content moves around while the page loads, so people tap the wrong thing or lose their place.',
  how: 'Give every image and embedded item a fixed width and height, and reserve space for banners and pop-ups.',
};
const FONTS: Plain = {
  title: 'Show text while fonts load', base: 'Low', who: 'Your web person',
  why: 'Text stays invisible until your custom fonts arrive.',
  how: 'Ask your web person to use “font-display: swap” so text shows straight away in a fallback font.',
};
const THIRD: Plain = {
  title: 'Cut back on outside widgets', base: 'Medium', who: 'You',
  why: 'Chat boxes, review widgets, maps and tracking tools from other companies slow your page down.',
  how: 'Keep the ones that bring you customers and remove the rest. Load maps and videos only when someone clicks them.',
};
const PAGE_SIZE: Plain = {
  title: 'Make the page lighter', base: 'Medium', who: 'Your web person',
  why: 'The page is heavy to download on a phone connection.',
  how: 'Compress images, remove unused apps and avoid autoplay videos on the home page.',
};
const VIEWPORT: Plain = {
  title: 'Make the site fit phone screens', base: 'High', who: 'Your web person',
  why: 'Without this setting, phones show a shrunken desktop page and Google ranks you lower on mobile.',
  how: 'Ask your web person to add the standard mobile “viewport” setting to every page.',
};

const DICTIONARY: Record<string, Plain> = {
  // Performance (older Lighthouse audit names and newer "insight" names)
  'uses-optimized-images': IMAGES, 'modern-image-formats': IMAGES, 'uses-responsive-images': IMAGES, 'offscreen-images': IMAGES,
  'efficient-animated-content': IMAGES, 'image-delivery-insight': IMAGES, 'total-byte-weight': PAGE_SIZE,
  'lcp-lazy-loaded': LCP_IMAGE, 'prioritize-lcp-image': LCP_IMAGE, 'lcp-discovery-insight': LCP_IMAGE,
  'render-blocking-resources': BLOCKING, 'render-blocking-insight': BLOCKING, 'network-dependency-tree-insight': BLOCKING,
  'unused-javascript': UNUSED_JS, 'unused-css-rules': UNUSED_JS, 'legacy-javascript': UNUSED_JS, 'legacy-javascript-insight': UNUSED_JS,
  'duplicated-javascript': UNUSED_JS, 'duplicated-javascript-insight': UNUSED_JS, 'bootup-time': UNUSED_JS, 'mainthread-work-breakdown': UNUSED_JS,
  'server-response-time': SERVER, 'document-latency-insight': SERVER, 'redirects': SERVER,
  'uses-long-cache-ttl': CACHE, 'cache-insight': CACHE,
  'layout-shift-elements': SHIFT, 'unsized-images': SHIFT, 'cls-culprits-insight': SHIFT,
  'font-display': FONTS, 'font-display-insight': FONTS,
  'third-party-summary': THIRD, 'third-parties-insight': THIRD,
  'viewport': VIEWPORT, 'viewport-insight': VIEWPORT,
  // Search engines
  'document-title': { title: 'Give every page a clear title', base: 'Medium', who: 'You', why: 'The page title is what Google shows as the blue link. Without a good one, fewer people click.', how: 'In your website settings, give each page a title that says what it is and where you are, for example “Handmade mugs | Harbour & Home, Falmouth”.' },
  'meta-description': { title: 'Add a description for Google', base: 'Medium', who: 'You', why: 'Google shows this short description under your link. Without one it picks random text from the page.', how: 'In your website’s SEO settings, write one or two sentences for each main page saying what you offer and why to choose you.' },
  'is-crawlable': { title: 'Let Google see this page', base: 'High', who: 'Your web person', why: 'This page is set to be hidden from search engines, so it can’t appear in Google.', how: 'Ask your web person to remove the “noindex” setting, unless the page is meant to be private.' },
  'http-status-code': { title: 'Fix the page error', base: 'High', who: 'Your web person', why: 'The page returns an error code to Google, so it may drop out of search results.', how: 'Ask your web person to check why the page is returning an error.' },
  'link-text': { title: 'Use clearer link wording', base: 'Low', who: 'You', why: 'Links that say “click here” or “read more” don’t tell Google or visitors where they go.', how: 'Change link text to describe the destination, such as “See our gift sets”.' },
  'crawlable-anchors': { title: 'Make your links readable by Google', base: 'Low', who: 'Your web person', why: 'Some links are built in a way search engines can’t follow.', how: 'Ask your web person to use standard links for navigation.' },
  'canonical': { title: 'Fix duplicate page settings', base: 'Medium', who: 'Your web person', why: 'Google is getting mixed signals about which version of a page is the main one.', how: 'Ask your web person to check the “canonical” setting on your pages.' },
  'robots-txt': { title: 'Fix your search engine instructions file', base: 'Medium', who: 'Your web person', why: 'Your robots.txt file has errors, which can stop Google reading your site properly.', how: 'Ask your web person to check and correct robots.txt.' },
  'image-alt': { title: 'Describe your images', base: 'Medium', who: 'You', why: 'Images without descriptions are invisible to Google Images and to people using screen readers.', how: 'Add a short description (alt text) to each product and banner image in your website editor.' },
  // Accessibility and trust
  'color-contrast': { title: 'Make some text easier to read', base: 'Medium', who: 'Your web person', why: 'Some text is too faint against its background, especially on a phone outdoors.', how: 'Darken light grey text or lighten its background until it is easy to read.' },
  'button-name': { title: 'Label your buttons', base: 'Medium', who: 'Your web person', why: 'Some buttons have no readable name, so screen readers announce them as just “button”.', how: 'Ask your web person to add text labels to icon-only buttons.' },
  'link-name': { title: 'Label your icon links', base: 'Low', who: 'Your web person', why: 'Some links have no readable name.', how: 'Ask your web person to add text labels to icon-only links, such as social media icons.' },
  'label': { title: 'Label your form fields', base: 'Medium', who: 'Your web person', why: 'Form fields without labels are hard to fill in and can cost you enquiries.', how: 'Make sure every field on your contact or checkout form has a visible label.' },
  'target-size': { title: 'Make buttons easier to tap', base: 'Medium', who: 'Your web person', why: 'Some buttons and links are too small or too close together to tap accurately on a phone.', how: 'Ask your web person to make tap targets at least 24 pixels and space them apart.' },
  'tap-targets': { title: 'Make buttons easier to tap', base: 'Medium', who: 'Your web person', why: 'Some buttons and links are too small or too close together to tap accurately on a phone.', how: 'Ask your web person to make tap targets larger and space them apart.' },
  'font-size': { title: 'Make text bigger on phones', base: 'Medium', who: 'Your web person', why: 'Some text is too small to read on a phone without zooming.', how: 'Ask your web person to set body text to at least 16 pixels on mobile.' },
  'html-has-lang': { title: 'Set your site’s language', base: 'Low', who: 'Your web person', why: 'Browsers and screen readers don’t know which language the page is in.', how: 'Ask your web person to set the page language to English (UK).' },
  'is-on-https': { title: 'Make every page secure', base: 'High', who: 'Your web person', why: 'Some pages or files load without encryption, so browsers may show a “not secure” warning.', how: 'Ask your web person to make sure every page, image and script uses https.' },
  'errors-in-console': { title: 'Fix errors in the page code', base: 'Low', who: 'Your web person', why: 'The page reports technical errors, which can break features like forms or baskets.', how: 'Ask your web person to check the browser console and fix the errors.' },
};

const IMPACT_RANK: Record<Impact, number> = { High: 3, Medium: 2, Low: 1 };

function savingsMs(a: any): number {
  const d = a?.details?.overallSavingsMs;
  const m = a?.metricSavings ? Math.max(a.metricSavings.LCP ?? 0, a.metricSavings.FCP ?? 0, a.metricSavings.TBT ?? 0) : 0;
  return Math.max(typeof d === 'number' ? d : 0, m || 0);
}

function failing(a: any): boolean {
  if (!a || a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'manual' || a.scoreDisplayMode === 'error') return false;
  if (a.scoreDisplayMode === 'informative') return savingsMs(a) >= 300;
  if (a.score === null || a.score === undefined) return savingsMs(a) >= 300;
  return a.score < 0.9;
}

const pct = (x: any): number | null => (typeof x === 'number' ? Math.round(x * 100) : null);

function fieldMetric(m: any, kind: 'ms' | 'cls'): FieldMetric | undefined {
  if (!m || typeof m.percentile !== 'number') return undefined;
  const rating = m.category === 'FAST' ? 'Good' : m.category === 'AVERAGE' ? 'Needs work' : 'Poor';
  const value = kind === 'cls' ? (m.percentile / 100).toFixed(2)
    : m.percentile >= 1000 ? `${(m.percentile / 1000).toFixed(1)} s` : `${Math.round(m.percentile)} ms`;
  return { value, rating };
}

export function parsePageSpeed(json: any, now = new Date()): SpeedState {
  const lr = json?.lighthouseResult ?? {};
  const cats = lr.categories ?? {};
  const audits: Record<string, any> = lr.audits ?? {};
  const m = json?.loadingExperience?.metrics;

  // One fix per plain-English entry, keeping the largest saving among the audits behind it.
  const byTitle = new Map<string, { plain: Plain; id: string; saving: number }>();
  for (const [id, a] of Object.entries(audits)) {
    const plain = DICTIONARY[id];
    if (!plain || !failing(a)) continue;
    const saving = savingsMs(a);
    const prev = byTitle.get(plain.title);
    if (!prev || saving > prev.saving) byTitle.set(plain.title, { plain, id, saving });
  }
  const fixes: Fix[] = [...byTitle.values()].map(({ plain, id, saving }) => {
    let impact: Impact = plain.base;
    if (saving >= 1500) impact = 'High';
    else if (saving >= 500 && impact === 'Low') impact = 'Medium';
    return {
      id, title: plain.title, why: plain.why, how: plain.how, who: plain.who, impact,
      saving: saving >= 200 ? `could make the page about ${(saving / 1000).toFixed(1)} s faster` : undefined,
    };
  }).sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact]).slice(0, 8);

  const field = m ? {
    lcp: fieldMetric(m.LARGEST_CONTENTFUL_PAINT_MS, 'ms'),
    inp: fieldMetric(m.INTERACTION_TO_NEXT_PAINT, 'ms'),
    cls: fieldMetric(m.CUMULATIVE_LAYOUT_SHIFT_SCORE, 'cls'),
  } : null;

  return {
    checkedAt: now.toISOString(), strategy: 'mobile',
    scores: { performance: pct(cats.performance?.score), accessibility: pct(cats.accessibility?.score), seo: pct(cats.seo?.score), bestPractices: pct(cats['best-practices']?.score) },
    field: field && (field.lcp || field.inp || field.cls) ? field : null,
    fixes,
  };
}

export function scoreLabel(n: number | null): { label: string; tone: 'good' | 'mid' | 'bad' | 'none' } {
  if (n == null) return { label: 'Not measured', tone: 'none' };
  if (n >= 90) return { label: 'Good', tone: 'good' };
  if (n >= 50) return { label: 'Needs work', tone: 'mid' };
  return { label: 'Poor', tone: 'bad' };
}

/** Keeps "done" marks when a new test returns the same fixes. */
export function carryDone(prev: SpeedState | null | undefined, next: SpeedState): SpeedState {
  if (!prev) return next;
  const done = new Set(prev.fixes.filter((f) => f.done).map((f) => f.title));
  return { ...next, fixes: next.fixes.map((f) => (done.has(f.title) ? { ...f, done: true } : f)) };
}
