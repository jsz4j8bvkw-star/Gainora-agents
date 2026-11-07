import type { BusinessProfile } from './types';

export type FieldKind = 'text' | 'url' | 'email' | 'textarea' | 'select' | 'chips' | 'multi' | 'number' | 'money' | 'competitors';

export interface Field {
  path: string;              // e.g. "business.name"
  label: string;
  help?: string;
  kind: FieldKind;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  optional?: boolean;
  wide?: boolean;
}

export interface Section {
  id: string;
  title: string;            // short name in the progress list
  question: string;         // the big question at the top of the step
  intro: string;
  fields: Field[];
}

export const INDUSTRIES = [
  'Retail and e-commerce', 'Food and drink', 'Hair, beauty and wellbeing', 'Trades and home services',
  'Professional services', 'Health and fitness', 'Hospitality and events', 'Creative and design',
  'Education and training', 'Manufacturing and wholesale', 'Property', 'Other',
];

export const TRACKABLE = ['Revenue', 'Orders or sales', 'Enquiries', 'Website visitors', 'Conversion rate', 'Repeat customers', 'Ad spend', 'New reviews'];

export const SECTIONS: Section[] = [
  {
    id: 'business', title: 'Your business',
    question: 'Let’s start with the basics.',
    intro: 'This is how your agents introduce your business when they research and write for you.',
    fields: [
      { path: 'business.ownerName', label: 'Your first name', kind: 'text', required: true },
      { path: 'business.name', label: 'Business name', kind: 'text', required: true },
      { path: 'business.website', label: 'Website', kind: 'url', placeholder: 'https://', help: 'The Watcher checks this site for you.', required: true },
      { path: 'business.oneLiner', label: 'What you do, in one sentence', kind: 'textarea', placeholder: 'For example: we sell handmade homeware from Cornish makers, online and in our Falmouth shop.', required: true, wide: true },
      { path: 'business.industry', label: 'Industry', kind: 'select', options: INDUSTRIES, required: true },
      { path: 'business.location', label: 'Where you’re based', kind: 'text', placeholder: 'For example: Falmouth, Cornwall', required: true },
      { path: 'business.tradingSince', label: 'Trading since', kind: 'text', placeholder: '2019', optional: true },
      { path: 'business.teamSize', label: 'Team size', kind: 'chips', options: ['Just me', '2–5', '6–20', '21–50', '50+'], required: true, wide: true },
      { path: 'business.legalForm', label: 'Business type', kind: 'chips', options: ['Limited company', 'Sole trader', 'Partnership', 'Other'], required: true, wide: true },
    ],
  },
  {
    id: 'offer', title: 'What you sell',
    question: 'What do customers buy from you?',
    intro: 'Be specific. The more your agents know about your offer, the better they spot opportunities and threats.',
    fields: [
      { path: 'offer.products', label: 'Your main products or services', kind: 'textarea', placeholder: 'For example: ceramic tableware, linen, candles and gift sets. Wholesale to a few local cafés.', required: true, wide: true },
      { path: 'offer.typicalPrice', label: 'Typical price or order value', kind: 'text', placeholder: 'For example: £35 average order, gift sets £60–£90', required: true },
      { path: 'offer.bestSeller', label: 'Best seller or most profitable line', kind: 'text', placeholder: 'Hand-thrown mugs', optional: true },
      { path: 'offer.salesChannels', label: 'How customers buy', kind: 'multi', options: ['Website', 'In person', 'Phone', 'Email', 'Social media messages', 'Etsy, Amazon or other marketplaces', 'Wholesale'], required: true, wide: true },
    ],
  },
  {
    id: 'customers', title: 'Your customers',
    question: 'Who are your best customers?',
    intro: 'Think of the customers you’d clone if you could.',
    fields: [
      { path: 'customers.ideal', label: 'Describe your ideal customer', kind: 'textarea', placeholder: 'For example: homeowners aged 30–60 who value handmade and buy gifts several times a year.', required: true, wide: true },
      { path: 'customers.sources', label: 'Where new customers come from', kind: 'multi', options: ['Google search', 'Google Maps', 'Instagram', 'Facebook', 'TikTok', 'Word of mouth', 'Referrals', 'Walk-ins', 'Marketplaces', 'Email list', 'Paid ads'], required: true, wide: true },
      { path: 'customers.areas', label: 'Where your customers are', kind: 'multi', options: ['Local', 'Regional', 'Across the UK', 'International'], required: true, wide: true },
      { path: 'customers.repeat', label: 'How many come back', kind: 'chips', options: ['Rarely', 'Some', 'Most'], optional: true, wide: true },
    ],
  },
  {
    id: 'competitors', title: 'Competitors',
    question: 'Who do customers compare you with?',
    intro: 'Add up to five. The Watcher tracks their prices, offers and new pages, and tells you when something changes.',
    fields: [
      { path: 'competitors.list', label: 'Competitors', kind: 'competitors', wide: true },
      { path: 'competitors.ourEdge', label: 'What you do better', kind: 'textarea', placeholder: 'For example: everything is made within 30 miles and we gift-wrap for free.', required: true, wide: true },
      { path: 'competitors.theirEdge', label: 'What they do better', kind: 'textarea', placeholder: 'For example: faster delivery and a bigger range.', optional: true, wide: true },
    ],
  },
  {
    id: 'numbers', title: 'Your numbers',
    question: 'Roughly, how is the business doing?',
    intro: 'Rough numbers are fine, and you can skip any of these. They stay private to your account and set the starting point for The Brief.',
    fields: [
      { path: 'numbers.revenueBand', label: 'Monthly revenue', kind: 'chips', options: ['Under £5k', '£5k–£20k', '£20k–£50k', '£50k–£150k', 'Over £150k', 'Prefer not to say'], optional: true, wide: true },
      { path: 'numbers.enquiriesPerWeek', label: 'Enquiries per week', kind: 'number', placeholder: '25', optional: true },
      { path: 'numbers.salesPerWeek', label: 'Sales or orders per week', kind: 'number', placeholder: '40', optional: true },
      { path: 'numbers.averageOrder', label: 'Average order value', kind: 'money', placeholder: '35', optional: true },
      { path: 'numbers.track', label: 'Numbers you want to follow each week', kind: 'multi', options: TRACKABLE, required: true, wide: true },
    ],
  },
  {
    id: 'goals', title: 'Goals',
    question: 'What would make the next 90 days a success?',
    intro: 'Your agents rank everything they find against this goal, so pick the one that matters most right now.',
    fields: [
      { path: 'goals.focus', label: 'Main focus', kind: 'chips', options: ['More enquiries', 'Convert more enquiries', 'Higher order value', 'Win back past customers', 'Find new wholesale or B2B clients', 'Launch something new', 'Save time'], required: true, wide: true },
      { path: 'goals.target', label: 'Your target', kind: 'text', placeholder: 'For example: 40 enquiries a week by February', help: 'A number and a date work best.', required: true, wide: true },
      { path: 'goals.detail', label: 'Why this matters now', kind: 'textarea', placeholder: 'For example: January is quiet and I want a fuller pipeline before spring.', optional: true, wide: true },
      { path: 'goals.twelveMonth', label: 'Where you want to be in 12 months', kind: 'textarea', placeholder: 'For example: second shop open and wholesale making up a third of sales.', optional: true, wide: true },
      { path: 'goals.obstacle', label: 'The biggest thing in the way', kind: 'textarea', placeholder: 'For example: not enough time. I do the shop, the website and the social posts myself.', required: true, wide: true },
      { path: 'goals.timePerWeek', label: 'Time you can give to growth each week', kind: 'chips', options: ['Under 2 hours', '2–5 hours', '5–10 hours', 'Over 10 hours'], required: true, wide: true },
    ],
  },
  {
    id: 'preferences', title: 'How you work',
    question: 'How should your agents keep you posted?',
    intro: 'You can change any of this later in Settings.',
    fields: [
      { path: 'preferences.reportDay', label: 'Weekly report day', kind: 'chips', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], required: true, wide: true },
      { path: 'preferences.reportTime', label: 'Time of day', kind: 'chips', options: ['7am', 'Midday', '6pm'], required: true, wide: true },
      { path: 'preferences.alerts', label: 'Alerts between reports', kind: 'chips', options: ['Urgent only', 'Daily summary', 'Everything'], required: true, wide: true },
      { path: 'preferences.style', label: 'Writing style', kind: 'chips', options: ['Short and direct', 'Detailed, with reasoning'], required: true, wide: true },
      { path: 'preferences.extraRecipient', label: 'Also send reports to', kind: 'email', placeholder: 'partner@yourbusiness.co.uk', optional: true },
    ],
  },
];

export function emptyProfile(): BusinessProfile {
  return {
    business: { name: '', website: '', oneLiner: '', industry: '', location: '', tradingSince: '', teamSize: '', legalForm: '', ownerName: '' },
    offer: { products: '', typicalPrice: '', salesChannels: [], bestSeller: '' },
    customers: { ideal: '', sources: [], areas: [], repeat: '' },
    competitors: { list: [{ name: '', url: '' }], ourEdge: '', theirEdge: '' },
    numbers: { revenueBand: '', enquiriesPerWeek: '', salesPerWeek: '', averageOrder: '', track: [] },
    goals: { focus: '', detail: '', target: '', twelveMonth: '', obstacle: '', timePerWeek: '' },
    preferences: { reportDay: 'Monday', reportTime: '7am', alerts: 'Urgent only', style: 'Short and direct', extraRecipient: '' },
  };
}

export function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath<T>(obj: T, path: string, value: any): T {
  const keys = path.split('.');
  const copy: any = structuredClone(obj);
  let cur = copy;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] ??= {};
  cur[keys[keys.length - 1]] = value;
  return copy;
}

export function normaliseUrl(v: string): string {
  const t = v.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function isValidUrl(v: string): boolean {
  try {
    const u = new URL(normaliseUrl(v));
    return (u.protocol === 'https:' || u.protocol === 'http:') && /\.[a-z]{2,}$/i.test(u.hostname);
  } catch { return false; }
}

/** Returns a map of field path → error message for one section. */
export function validateSection(section: Section, p: BusinessProfile): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of section.fields) {
    const v = getPath(p, f.path);
    if (f.kind === 'competitors') {
      const list = (v as BusinessProfile['competitors']['list']).filter((c) => c.name.trim() || c.url.trim());
      if (list.length === 0) errors[f.path] = 'Add at least one competitor so The Watcher has someone to watch.';
      else if (list.some((c) => !isValidUrl(c.url))) errors[f.path] = 'Check the competitor websites. Each one needs a full web address.';
      continue;
    }
    const empty = Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim();
    if (f.required && empty) {
      errors[f.path] = f.kind === 'multi' || f.kind === 'chips' ? 'Choose at least one option.' : 'Fill this in to continue.';
      continue;
    }
    if (!empty && f.kind === 'url' && !isValidUrl(String(v))) errors[f.path] = 'Enter a full web address, like yourbusiness.co.uk.';
    if (!empty && f.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) errors[f.path] = 'Enter a valid email address.';
    if (!empty && (f.kind === 'number' || f.kind === 'money') && !/^\d+(\.\d+)?$/.test(String(v).replace(/[£,\s]/g, ''))) errors[f.path] = 'Enter a number.';
  }
  return errors;
}

export function sectionComplete(section: Section, p: BusinessProfile): boolean {
  return Object.keys(validateSection(section, p)).length === 0;
}
