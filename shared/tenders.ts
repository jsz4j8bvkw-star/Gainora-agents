// UK public contracts from Contracts Finder (OCDS format), and matching them to a business.
import { keywordsOf, type Learned } from './learning';

export interface TenderRecord {
  id: string;                 // OCDS ocid
  title: string;
  description: string;
  buyer: string;
  value: number | null;
  currency: string;
  deadline: string | null;    // ISO date the bids close
  url: string;
  cpv: string[];
  region: string | null;
  sme: boolean | null;
  publishedAt: string;
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function parseRelease(rel: any): TenderRecord | null {
  const t = rel?.tender ?? {};
  const title = String(t.title || '').trim();
  if (!title || !rel?.ocid) return null;
  const guid = String(rel.ocid).match(GUID)?.[0] ?? String(rel.id || '').match(GUID)?.[0];
  const buyerParty = (rel.parties || []).find((p: any) => (p.roles || []).includes('buyer'));
  const items: any[] = t.items || [];
  const address = items.map((i) => i.deliveryAddresses?.[0] ?? i.deliveryAddress).find(Boolean);
  const cpv = [t.classification?.id, ...items.map((i) => i.classification?.id), ...items.flatMap((i) => (i.additionalClassifications || []).map((c: any) => c.id))]
    .filter((x): x is string => typeof x === 'string' && /^\d{8}/.test(x));
  const amount = t.value?.amount ?? t.maxValue?.amount ?? t.minValue?.amount;
  return {
    id: String(rel.ocid),
    title: title.slice(0, 300),
    description: String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
    buyer: String(rel.buyer?.name || buyerParty?.name || 'Public sector buyer').slice(0, 200),
    value: typeof amount === 'number' && amount > 0 ? amount : null,
    currency: t.value?.currency || 'GBP',
    deadline: t.tenderPeriod?.endDate || null,
    url: guid ? `https://www.contractsfinder.service.gov.uk/Notice/${guid}` : (t.documents?.[0]?.url || 'https://www.contractsfinder.service.gov.uk/'),
    cpv: [...new Set(cpv)],
    region: address?.region || address?.locality || null,
    sme: typeof t.suitability?.sme === 'boolean' ? t.suitability.sme : null,
    publishedAt: rel.date || new Date().toISOString(),
  };
}

/** Two-digit CPV divisions that commonly fit each industry in the questionnaire. */
export const INDUSTRY_CPV: Record<string, string[]> = {
  'Retail and e-commerce': ['39', '18', '22', '30'],
  'Food and drink': ['15', '55'],
  'Hair, beauty and wellbeing': ['33', '85', '98'],
  'Trades and home services': ['45', '50', '90', '44'],
  'Professional services': ['79', '72', '73', '66'],
  'Health and fitness': ['85', '92'],
  'Hospitality and events': ['55', '79', '92'],
  'Creative and design': ['79', '92', '22'],
  'Education and training': ['80'],
  'Manufacturing and wholesale': ['39', '44', '31', '42', '15'],
  'Property': ['70', '45', '71'],
};

export function profileKeywords(p: any): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (text: string, w: number) => { for (const k of keywordsOf(text)) weights.set(k, Math.max(weights.get(k) ?? 0, w)); };
  add(p?.offer?.products ?? '', 3);
  add(p?.offer?.bestSeller ?? '', 3);
  add(p?.business?.oneLiner ?? '', 2);
  add(p?.business?.industry ?? '', 1);
  add(p?.customers?.ideal ?? '', 1);
  return weights;
}

const smallTeam = (p: any) => ['Just me', '2–5'].includes(p?.business?.teamSize);

export interface Scored { tender: TenderRecord; score: number; matched: string[] }

export function scoreTender(t: TenderRecord, p: any, learned?: Learned | null, now = new Date()): Scored {
  if (t.deadline && new Date(t.deadline).getTime() < now.getTime() + 2 * 86_400_000) return { tender: t, score: -100, matched: [] };
  const pk = profileKeywords(p);
  const titleWords = new Set(keywordsOf(t.title));
  const bodyWords = new Set(keywordsOf(t.description));
  const matched: string[] = [];
  let score = 0;
  for (const [k, w] of pk) {
    if (titleWords.has(k)) { score += w * 2; matched.push(k); } else if (bodyWords.has(k)) { score += w; matched.push(k); }
  }
  const divisions = INDUSTRY_CPV[p?.business?.industry] ?? [];
  if (t.cpv.some((c) => divisions.includes(c.slice(0, 2)))) score += 3;
  for (const k of learned?.negativeKeywords ?? []) if (titleWords.has(k) || bodyWords.has(k)) score -= 3;
  for (const k of learned?.positiveKeywords ?? []) if (titleWords.has(k)) score += 1;
  if (t.value != null && smallTeam(p)) {
    if (t.value > 2_000_000) score -= 100;
    else if (t.value > 500_000) score -= 4;
  }
  if (t.sme === true) score += 1;
  return { tender: t, score, matched };
}

export function shortlist(tenders: TenderRecord[], p: any, learned?: Learned | null, n = 15, now = new Date()): Scored[] {
  return tenders.map((t) => scoreTender(t, p, learned, now)).filter((s) => s.score >= 4).sort((a, b) => b.score - a.score).slice(0, n);
}

export function daysLeft(deadline: string | null, now = new Date()): number | null {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - now.getTime()) / 86_400_000);
}
