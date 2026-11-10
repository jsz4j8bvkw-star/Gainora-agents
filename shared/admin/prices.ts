// Gainora's price book: one list of packages and prices, used by proposals (what clients are charged) and published
// to gainora.co.uk (what the website shows). Starts from the prices on the website today. All prices exclude VAT.

/** What a package switches on in the apps (the entitlement rows the Stripe webhook writes). */
export type Grant = 'watcher' | 'scout' | 'brief' | 'capture' | 'website';
export const CC: Grant[] = ['watcher', 'scout', 'brief'];
export const GRANT_LABEL: Record<Grant, string> = { watcher: 'The Watcher', scout: 'The Scout', brief: 'The Brief', capture: 'Capture & Convert', website: 'Website (Launch & Grow)' };

export interface PriceItem {
  key: string; name: string; description: string;
  setup: number; monthly: number; one_off: number; minimum_months: number;
  included: string; grants: Grant[]; stripe_product: string | null; active: boolean; sort: number;
}

const item = (key: string, name: string, p: Partial<PriceItem>, sort: number): PriceItem => ({
  key, name, description: '', setup: 0, monthly: 0, one_off: 0, minimum_months: 0, included: '', grants: [], stripe_product: null, active: true, sort, ...p,
});

// 10 November 2026: one Capture & Convert price, and Command Centre comes with every package instead of being sold on
// its own. The old single packages stay in the book, switched off, so clients already paying for them are still recognised.
export const DEFAULT_PRICE_BOOK: PriceItem[] = [
  item('command-centre', 'Command Centre (on its own)', { monthly: 299, grants: CC, active: false, description: 'No longer sold on its own: included in every package. Kept for anyone already paying for it.' }, 10),
  item('capture-never', 'Capture & Convert: Never Miss a Call (old tier)', { setup: 595, monthly: 249, minimum_months: 3, included: '300', grants: ['capture'], active: false, description: 'Replaced by the single Capture & Convert price.' }, 20),
  item('capture-booking', 'Capture & Convert', { setup: 595, monthly: 399, minimum_months: 3, included: '600', grants: ['capture', ...CC], description: 'Receptionist, inbox, follow-ups and booking into the diary. Includes Command Centre. Bigger needs are priced on the call.' }, 21),
  item('capture-desk', 'Capture & Convert: Full Front Desk (old tier)', { setup: 1995, monthly: 599, minimum_months: 3, included: '1,200', grants: ['capture'], active: false, description: 'Replaced by the single Capture & Convert price; bigger needs are priced on the call.' }, 22),
  item('capture-founding', 'Capture & Convert, founding offer', { setup: 495, monthly: 299, minimum_months: 12, included: '600', grants: ['capture', ...CC], description: 'First 3 clients, fixed for 12 months, in return for a named case study. Includes Command Centre.' }, 23),
  item('extra-minutes', 'Extra call time, 100 minutes', { one_off: 25, included: '100', description: 'For receptionist calls beyond the minutes included.' }, 24),
  item('launch-grow', 'Launch & Grow', { setup: 1995, monthly: 599, minimum_months: 3, grants: [...CC, 'website'], description: 'Website, Google profile, listings, reviews and one ad channel, looked after monthly. Includes Command Centre.' }, 30),
  item('launch-grow-founding', 'Launch & Grow, founding offer', { setup: 1495, monthly: 599, minimum_months: 3, grants: [...CC, 'website'], description: 'First 2 to 3 clients, in return for a named case study. Includes Command Centre.' }, 31),
  item('launch-capture-bundle', 'Launch & Grow with Capture & Convert', { setup: 2295, monthly: 849, minimum_months: 3, included: '600', grants: [...CC, 'website', 'capture'], description: 'Both packages together, with one Command Centre.' }, 32),
  item('partner-focused', 'Growth & Operations Partner: Focused', { setup: 4950, monthly: 950, minimum_months: 3, grants: CC, description: 'One area, about 4 weeks, then monthly. Includes Command Centre.' }, 40),
  item('partner-core', 'Growth & Operations Partner: Core', { setup: 7500, monthly: 950, minimum_months: 3, grants: CC, description: 'Two or three areas, about 8 weeks, then monthly. Includes Command Centre.' }, 41),
  item('partner-whole', 'Growth & Operations Partner: Whole business', { setup: 12500, monthly: 950, minimum_months: 3, grants: CC, description: 'About 12 weeks, then monthly. Includes Command Centre.' }, 42),
  item('business-audit', 'Business Audit', { one_off: 495, description: 'Credited back if they start a package within 30 days.' }, 50),
];

export const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/** The prices in the shape gainora.co.uk's site.config.json uses, so the website can show the price book's numbers. */
export function toWebsitePrices(items: PriceItem[]): Record<string, any> {
  const by = new Map(items.filter((i) => i.active).map((i) => [i.key, i]));
  const get = (k: string) => by.get(k) ?? DEFAULT_PRICE_BOOK.find((d) => d.key === k)!;
  const launch = get('launch-grow'); const cc = get('capture-booking'); const bundle = get('launch-capture-bundle');
  const founding = get('capture-founding'); const partner = get('partner-core');
  return {
    audit: money(get('business-audit').one_off),
    launchGrow: { setup: money(launch.setup), monthly: money(launch.monthly), foundingSetup: money(get('launch-grow-founding').setup), minimumMonths: String(launch.minimum_months || 3) },
    bundle: { setup: money(bundle.setup), monthly: money(bundle.monthly), separateSetup: money(launch.setup + cc.setup), separateMonthly: money(launch.monthly + cc.monthly) },
    cc: {
      setup: money(cc.setup), monthly: money(cc.monthly), minutes: cc.included || '',
      extraMinutes: `${money(get('extra-minutes').one_off)} per ${get('extra-minutes').included || '100'} extra minutes`,
      minimumMonths: String(cc.minimum_months || 3),
      founding: { setup: money(founding.setup), monthly: money(founding.monthly), months: String(founding.minimum_months || 12) },
    },
    partner: { audit: money(get('business-audit').one_off), focused: money(get('partner-focused').setup), core: money(get('partner-core').setup), whole: money(get('partner-whole').setup), monthly: money(partner.monthly), minimumMonths: String(partner.minimum_months || 3) },
  };
}

/* ---------- Proposals ---------- */

export interface ProposalItem { key: string; name: string; setup: number; monthly: number; one_off: number; minimum_months: number; grants: Grant[]; included: string }
export const fromPriceItem = (p: PriceItem): ProposalItem => ({ key: p.key, name: p.name, setup: p.setup, monthly: p.monthly, one_off: p.one_off, minimum_months: p.minimum_months, grants: p.grants, included: p.included });

export function proposalTotals(items: ProposalItem[]) {
  const monthly = items.reduce((a, i) => a + i.monthly, 0);
  const today = items.reduce((a, i) => a + i.setup + i.one_off, 0);
  const minimum = Math.max(0, ...items.map((i) => (i.monthly ? i.minimum_months : 0)));
  return { monthly, today, minimum, firstYear: today + monthly * 12 };
}

/** Which packages (for the delivery checklists) the items in a proposal start. */
export function packagesFromGrants(grants: Grant[]): ('command' | 'capture' | 'launch')[] {
  const out: ('command' | 'capture' | 'launch')[] = [];
  if (grants.some((g) => g === 'watcher' || g === 'scout' || g === 'brief')) out.push('command');
  if (grants.includes('capture')) out.push('capture');
  if (grants.includes('website')) out.push('launch');
  return out;
}
