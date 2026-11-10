// What each client pays and what they cost to run. Revenue comes from Stripe. AI costs are recorded exactly by the
// apps; calls, texts and emails are counted and priced with the rate card (Settings), so they're estimates until
// the rate card holds Gainora's real prices.

export interface RateCard {
  gbpPerUsd: number; callMinute: number; avgCallMinutes: number; sms: number; email: number;
  phoneNumberMonthly: number; websiteMonthly: number; platformMonthly: number;
}
export const DEFAULT_RATES: RateCard = {
  gbpPerUsd: 0.79, callMinute: 0.12, avgCallMinutes: 3, sms: 0.04, email: 0.001,
  phoneNumberMonthly: 1.15, websiteMonthly: 1.5, platformMonthly: 2,
};
export const RATE_LABELS: Record<keyof RateCard, { label: string; unit: string }> = {
  callMinute: { label: 'Receptionist call, per minute', unit: '£' },
  avgCallMinutes: { label: 'Average call length', unit: 'minutes' },
  sms: { label: 'Text message', unit: '£' },
  email: { label: 'Email', unit: '£' },
  phoneNumberMonthly: { label: 'Phone number, per month', unit: '£' },
  websiteMonthly: { label: 'Website hosting, per month', unit: '£' },
  platformMonthly: { label: 'Apps hosting and database, per client per month', unit: '£' },
  gbpPerUsd: { label: 'Pounds per US dollar (AI is billed in dollars)', unit: '£' },
};
export function ratesFrom(raw: any): RateCard {
  const out = { ...DEFAULT_RATES };
  for (const k of Object.keys(DEFAULT_RATES) as (keyof RateCard)[]) { const v = Number(raw?.[k]); if (Number.isFinite(v) && v >= 0 && v < 1000) out[k] = v; }
  return out;
}

export interface Usage { aiUsd: number; calls: number; texts: number; emails: number; hasNumber: boolean; siteLive: boolean; active: boolean }
export interface CostLine { item: string; amount: number; estimated: boolean }

const pence = (n: number) => Math.round(n * 100) / 100;

/** One month's running costs for a client. */
export function monthCosts(u: Usage, r: RateCard, manual: { item: string; amount: number }[] = []): { lines: CostLine[]; total: number } {
  const lines: CostLine[] = [];
  if (u.aiUsd > 0) lines.push({ item: 'AI (agents and summaries)', amount: pence(u.aiUsd * r.gbpPerUsd), estimated: false });
  if (u.calls > 0) lines.push({ item: `Receptionist calls (${u.calls} × about ${r.avgCallMinutes} min)`, amount: pence(u.calls * r.avgCallMinutes * r.callMinute), estimated: true });
  if (u.texts > 0) lines.push({ item: `Text messages (${u.texts})`, amount: pence(u.texts * r.sms), estimated: true });
  if (u.emails > 0) lines.push({ item: `Emails (${u.emails})`, amount: pence(u.emails * r.email), estimated: true });
  if (u.hasNumber) lines.push({ item: 'Phone number', amount: r.phoneNumberMonthly, estimated: true });
  if (u.siteLive) lines.push({ item: 'Website hosting', amount: r.websiteMonthly, estimated: true });
  if (u.active) lines.push({ item: 'Apps hosting and database', amount: r.platformMonthly, estimated: true });
  for (const m of manual) lines.push({ item: m.item, amount: pence(m.amount), estimated: false });
  return { lines, total: pence(lines.reduce((a, l) => a + l.amount, 0)) };
}

/** What a Stripe subscription brings in a month, in pounds. Yearly plans count a twelfth; weekly ones ×52/12. */
export function monthlyFromSubscription(sub: any): number {
  if (!sub || !['active', 'trialing', 'past_due'].includes(sub.status)) return 0;
  let total = 0;
  for (const it of sub.items?.data ?? []) {
    const price = it.price ?? it.plan ?? {};
    const amount = Number(price.unit_amount ?? price.amount ?? 0) / 100;
    const qty = Number(it.quantity ?? 1);
    const rec = price.recurring ?? { interval: price.interval, interval_count: price.interval_count };
    const every = Number(rec?.interval_count || 1);
    const perMonth = rec?.interval === 'year' ? 1 / (12 * every) : rec?.interval === 'week' ? 52 / (12 * every) : rec?.interval === 'day' ? 365 / (12 * every) : 1 / every;
    total += amount * qty * perMonth;
  }
  const off = sub.discount?.coupon;
  if (off?.percent_off) total *= 1 - off.percent_off / 100;
  return pence(total);
}

export const gbp = (n: number | null | undefined, whole = false) => (n == null ? '–' : `${n < 0 ? '−' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`);
export const monthStart = (d = new Date()) => `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(d)}-01`;
