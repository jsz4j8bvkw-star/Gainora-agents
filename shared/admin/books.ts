// Gainora's own books: what the business spends, what it made, the VAT threshold and the dates that matter.
import { addDays } from './templates';

export interface Expense { id: string; supplier: string; category: string; amount: number; recurring: boolean; starts_on: string; ends_on: string | null; note: string }
export const EXPENSE_CATEGORIES = ['Phone and calls', 'AI', 'Hosting and software', 'Email and texts', 'Insurance', 'Accountant and legal', 'Marketing', 'Equipment', 'Other'];

/** What Gainora pays in a month: recurring costs running that month, plus one-offs dated in it. */
export function expensesIn(month: string, list: Expense[]): Expense[] {
  const start = month.slice(0, 7);
  return list.filter((e) => {
    const from = e.starts_on.slice(0, 7);
    if (!e.recurring) return from === start;
    return from <= start && (!e.ends_on || e.ends_on.slice(0, 7) >= start);
  });
}
export const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((a, x) => a + Number(x.amount || 0), 0) * 100) / 100;

/** The VAT registration threshold (taxable turnover over any rolling 12 months). From 1 April 2024: £90,000. */
export const VAT_THRESHOLD = 90_000;
export function vatStatus(rolling12: number): { level: 'fine' | 'near' | 'over'; share: number; note: string } {
  const share = rolling12 / VAT_THRESHOLD;
  if (share >= 1) return { level: 'over', share, note: 'Over the VAT threshold. You must register for VAT within 30 days of the end of the month you went over. Talk to your accountant now.' };
  if (share >= 0.75) return { level: 'near', share, note: `${Math.round(share * 100)}% of the VAT threshold. Plan with your accountant now: your prices don’t include VAT, so registering means deciding whether to add it on top or absorb it.` };
  return { level: 'fine', share, note: `${Math.round(share * 100)}% of the VAT threshold over the last 12 months.` };
}

export type Repeat = 'none' | 'monthly' | 'quarterly' | 'yearly';
export interface Deadline { id: string; title: string; category: string; due_on: string; repeat: Repeat; note: string; done_at: string | null }

/** When a repeating deadline is done, the next one: the same date next month, quarter or year. */
export function nextOccurrence(due: string, repeat: Repeat): string | null {
  if (repeat === 'none') return null;
  const d = new Date(`${due}T12:00:00Z`);
  const months = repeat === 'monthly' ? 1 : repeat === 'quarterly' ? 3 : 12;
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export const dueSoon = (list: Deadline[], today: string, days = 14) => list.filter((d) => !d.done_at && d.due_on <= addDays(today, days)).sort((a, b) => a.due_on.localeCompare(b.due_on));

/** Common deadlines for a UK service business, to add with your own dates (they depend on how Gainora is set up). */
export const SUGGESTED_DEADLINES: { title: string; category: string; repeat: Repeat; note: string; when?: (year: number) => string }[] = [
  { title: 'ICO data protection fee', category: 'Data protection', repeat: 'yearly', note: 'Gainora handles clients’ customers’ details, so the fee is required. The date is on your ICO certificate.' },
  { title: 'Self Assessment tax return and payment', category: 'Tax', repeat: 'yearly', note: 'If you’re a sole trader. Online returns are due by 31 January.', when: (y) => `${y}-01-31` },
  { title: 'Self Assessment second payment on account', category: 'Tax', repeat: 'yearly', note: 'If you make payments on account.', when: (y) => `${y}-07-31` },
  { title: 'Companies House confirmation statement', category: 'Company', repeat: 'yearly', note: 'If Gainora is a limited company. Due within 14 days of the review date on Companies House.' },
  { title: 'Annual accounts to Companies House', category: 'Company', repeat: 'yearly', note: 'If Gainora is a limited company. Usually 9 months after the end of the financial year.' },
  { title: 'Corporation Tax payment', category: 'Tax', repeat: 'yearly', note: 'If Gainora is a limited company. Usually 9 months and 1 day after the end of the accounting period.' },
  { title: 'Professional indemnity and liability insurance renewal', category: 'Insurance', repeat: 'yearly', note: 'The date is on your policy.' },
  { title: 'gainora.co.uk domain renewal', category: 'Website', repeat: 'yearly', note: 'Check the date at your domain company; switch on auto-renew.' },
  { title: 'Review terms, privacy notice and data processing terms', category: 'Data protection', repeat: 'yearly', note: 'Check they still match what Gainora does.' },
];
