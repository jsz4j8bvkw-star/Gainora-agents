// The Scout's two modes. A clinic's customers are people, not companies, so for consumer-facing
// businesses the Scout looks for legitimate, actionable demand and routes to it: public posts
// where people are asking for exactly this (linked, so the owner replies in person), local groups
// worth joining with a ready-to-post introduction, referral partners, events and seasonal moments,
// and workplace or wellness tie-ups. Businesses that sell to businesses keep the original mode.
//
// Hard limits, which the prompts and the cleaner both enforce: public pages only, nothing behind
// a login (Facebook groups are; they can be recommended by name, never read), no lists of private
// individuals, no usernames, no personal contact details. The owner always does the posting.

export type ScoutMode = 'consumer' | 'b2b';
export type ScoutFocus = 'customers' | 'local' | 'demand' | 'communities' | 'partners' | 'corporate';

/** The focuses each mode offers, in the order shown. */
export const FOCUS_BY_MODE: Record<ScoutMode, ScoutFocus[]> = {
  consumer: ['demand', 'communities', 'partners', 'local', 'corporate'],
  b2b: ['customers', 'local'],
};

export interface FocusMeta {
  label: string; short: string; blurb: string; placeholder: string; suggestions: (town: string, what: string) => string[];
  /** What a result is, in a word, for headings and counts. */
  noun: string; nounPlural: string;
  /** Which button opens the draft, if any. */
  draftLabel?: string;
}

export const FOCUS: Record<ScoutFocus, FocusMeta> = {
  demand: {
    label: 'People asking for recommendations', short: 'Asking now', noun: 'post', nounPlural: 'posts',
    blurb: 'Public posts on Reddit, forums, Nextdoor pages and Q&A sites where someone near you is asking for exactly what you do. You reply in person, as yourself.',
    placeholder: 'For example: people asking where to get lip filler or anti-wrinkle injections near Crewe',
    suggestions: (town, what) => [`People asking for ${what} recommendations near ${town}`, `Questions about prices for ${what} in ${town}`, `People asking who to trust for ${what} locally`],
    draftLabel: 'Draft a reply',
  },
  communities: {
    label: 'Local groups to join', short: 'Groups', noun: 'group', nounPlural: 'groups',
    blurb: 'Local community groups, forums and networks where your customers talk to each other, with a short, honest introduction you can post yourself once you have joined.',
    placeholder: 'For example: local mums’ groups, village groups and women’s networks around Crewe',
    suggestions: (town) => [`Community groups and forums for ${town}`, `Local women’s and mums’ groups near ${town}`, `Business networking groups near ${town}`],
    draftLabel: 'Draft an introduction',
  },
  partners: {
    label: 'Referral partners', short: 'Partners', noun: 'partner', nounPlural: 'partners',
    blurb: 'Nearby businesses whose customers are your customers at the right moment: hairdressers, bridal shops, photographers, wedding venues, gyms, physios, dentists. Each with an introduction to send.',
    placeholder: 'For example: bridal shops and wedding venues within 15 miles of Crewe',
    suggestions: (town) => [`Hairdressers and salons near ${town} that don’t offer aesthetics`, `Bridal shops and wedding venues near ${town}`, `Gyms, PTs and physios near ${town}`, `Wedding and portrait photographers near ${town}`],
    draftLabel: 'Draft an introduction',
  },
  local: {
    label: 'Events and seasonal moments', short: 'Events', noun: 'opportunity', nounPlural: 'opportunities',
    blurb: 'Markets, fairs, wedding fairs, wellness days, awards and seasonal moments in the coming months where you could meet customers.',
    placeholder: 'For example: wedding fairs, wellness events and markets in the next three months',
    suggestions: (town) => ['Wedding fairs in the next three months', `Wellness and beauty events near ${town}`, 'Local awards worth entering', `Markets and fairs near ${town} before Christmas`],
  },
  corporate: {
    label: 'Workplace and wellness tie-ups', short: 'Tie-ups', noun: 'organisation', nounPlural: 'organisations',
    blurb: 'Employers, gyms, hotels and clubs nearby that run staff perks, wellness days or member offers you could be part of. Each with an introduction to send.',
    placeholder: 'For example: large employers and hotels near Crewe with staff wellbeing programmes',
    suggestions: (town) => [`Employers near ${town} with staff wellbeing or perks schemes`, `Hotels and spas near ${town} that work with outside therapists`, `Members’ clubs and gyms near ${town} with partner offers`],
    draftLabel: 'Draft an introduction',
  },
  customers: {
    label: 'Find customers', short: 'Customers', noun: 'match', nounPlural: 'matches',
    blurb: 'Businesses and organisations that fit what you sell, each with a source and a ready-to-edit introduction.',
    placeholder: 'For example: gift shops that stock independent makers',
    suggestions: (town) => [`Businesses near ${town} that could refer customers to us`, 'Independent shops that could stock our products', 'Cafés, hotels and venues that could use what we sell'],
    draftLabel: 'Draft introduction',
  },
};

const CONSUMER_INDUSTRY = /hair, beauty|health and fitness|food and drink|hospitality|retail/i;
const B2B_WORDS = /wholesale|\bb2b\b|trade customers|businesses|companies|organisations|retailers|stockists|procurement|clients are (firms|companies)/i;

/** Which mode fits this business: people as customers, or businesses as customers. */
export function scoutMode(profile: any): ScoutMode {
  const goals = String(profile?.goals?.focus || '');
  if (/wholesale|b2b/i.test(goals) || (profile?.offer?.salesChannels || []).includes('Wholesale')) return 'b2b';
  const industry = String(profile?.business?.industry || '');
  const ideal = String(profile?.customers?.ideal || '');
  if (/manufactur|wholesale|professional services/i.test(industry)) return 'b2b';
  if (B2B_WORDS.test(ideal)) return 'b2b';
  if (CONSUMER_INDUSTRY.test(industry)) return 'consumer';
  if (/women|men|people|families|parents|mums|brides|homeowners|clients aged|aged \d/i.test(ideal)) return 'consumer';
  return 'consumer';
}

/** The focus to open on, per mode. */
export const defaultFocus = (mode: ScoutMode): ScoutFocus => (mode === 'consumer' ? 'demand' : 'customers');

/* ---------- Storing the focus without a schema change ---------- */
// scout_searches.kind is constrained to 'customers' | 'local' in the database. The finer focus is
// kept as a short marker at the front of the query text and stripped before anyone reads it.
const MARK = /^\[(demand|communities|partners|corporate)\]\s*/;

export const dbKindFor = (focus: ScoutFocus): 'customers' | 'local' => (focus === 'local' ? 'local' : 'customers');
export const encodeFocus = (query: string, focus: ScoutFocus): string => (focus === 'customers' || focus === 'local' ? query : `[${focus}] ${query}`);
export function decodeFocus(query: string, kind: string | null | undefined): { query: string; focus: ScoutFocus } {
  const m = String(query || '').match(MARK);
  if (m) return { query: String(query).replace(MARK, ''), focus: m[1] as ScoutFocus };
  return { query: String(query || ''), focus: kind === 'local' ? 'local' : 'customers' };
}

/* ---------- Keeping people out of it ---------- */
const HANDLE = /(^|[\s(])@[A-Za-z0-9_.]{2,30}\b|\bu\/[A-Za-z0-9_-]{2,30}\b/g;
const PERSON_LINE = /\b(posted by|by u\/|user|member|mum of|aged \d{2})\b/i;

/** Strips usernames and handles from text the AI returned about a public post, so no individual is named. */
export function scrubPeople(text: string): string {
  return String(text || '').replace(/\(?\b(posted|asked|shared|written) by\b[^)\n]*\)?/gi, '').replace(HANDLE, '$1').replace(/\s{2,}/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+([?.!,])/g, '$1').trim();
}

/** True when a “name” looks like a person rather than a thread, group, business or event. */
export function looksLikeAPerson(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (PERSON_LINE.test(n)) return true;
  if (/^@|^u\//.test(n)) return true;
  // Two capitalised words and nothing else ("Sarah Jones") with no business-y word.
  return /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(n) && !/clinic|salon|group|shop|studio|ltd|club|gym|hotel|venue|spa|hub|forum|network|fair|market|event|mums|crewe|nantwich/i.test(n);
}

/**
 * Pages that sit behind a login: a public post cited from one would mean the Scout had read a
 * private page, so demand results from these are dropped. A community may still be recommended by
 * its public group link (the Scout never reads inside it).
 */
export const PRIVATE_HOSTS = /instagram\.com|tiktok\.com|linkedin\.com|whatsapp\.com|m\.facebook\.com|facebook\.com\/(login|groups\/[^/]+\/(posts|permalink))/i;

export const FOCUS_IDS: ScoutFocus[] = ['customers', 'local', 'demand', 'communities', 'partners', 'corporate'];
export const isFocus = (x: any): x is ScoutFocus => FOCUS_IDS.includes(x);
