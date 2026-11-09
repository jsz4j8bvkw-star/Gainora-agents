// A real first ten minutes. A new owner who has just finished onboarding should see something
// true about their business straight away: who is around them, where their reviews stand, and
// three things to do now. Pure helpers for Home's getting-started block; the demo and the live app share them.

import type { WatcherState } from '../src/lib/types';
import type { Client, Visit } from './clients';
import { REVIEW_ASK_GAP_DAYS } from './clients';

const DAY = 86_400_000;

export interface FirstAction { id: string; title: string; why: string; cta: string; link: string }

export interface ReviewPosition {
  rating: number | null; count: number | null;
  /** 1 = highest rated of the group; null when there is nothing to compare with. */
  ratingRank: number | null; countRank: number | null; of: number;
  text: string;
}

/** Where the owner's Google rating and review count sit among the competitors the Watcher follows. */
export function reviewPosition(w: WatcherState | null | undefined): ReviewPosition | null {
  const rv = w?.reviews;
  if (!rv || rv.rating == null) return null;
  const others = (w?.competitors?.list ?? []).filter((c) => c.rating != null && c.count != null).map((c) => ({ rating: c.rating!, count: c.count! }));
  const fallback = rv.competitors.filter((c) => c.rating != null && c.count != null).map((c) => ({ rating: c.rating!, count: c.count! }));
  const group = others.length ? others : fallback;
  if (!group.length) return { rating: rv.rating, count: rv.count, ratingRank: null, countRank: null, of: 1, text: `${rv.rating.toFixed(1)} stars from ${rv.count ?? 0} reviews. The Watcher compares this with the businesses nearby once it has found them.` };
  const ratingRank = 1 + group.filter((g) => g.rating > rv.rating!).length;
  const countRank = 1 + group.filter((g) => g.count > (rv.count ?? 0)).length;
  const of = group.length + 1;
  const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const ratingWords = ratingRank === 1 ? `the highest rating of the ${of} nearby` : `${ord(ratingRank)} of ${of} nearby by rating`;
  const countWords = countRank === 1 ? 'and the most reviews' : `but ${ord(countRank)} of ${of} by number of reviews${countRank > 1 ? `; the busiest-looking has ${Math.max(...group.map((g) => g.count))}` : ''}`;
  return { rating: rv.rating, count: rv.count, ratingRank, countRank, of, text: `${rv.rating.toFixed(1)} stars from ${rv.count ?? 0} reviews: ${ratingWords}, ${countWords}.` };
}

export interface FirstInput {
  watcher?: WatcherState | null;
  clientsReady: boolean;        // the tables exist
  clients: Client[];
  visits: Visit[];
  hasBookingSystem: boolean;
  now?: Date;
}

/** The first three things to do, for an account with little in it yet. Each is a real next step, not a tour. */
export function firstActions(i: FirstInput): FirstAction[] {
  const now = i.now ?? new Date();
  const out: FirstAction[] = [];
  const w = i.watcher;
  if (i.clientsReady && !i.clients.length) {
    out.push({ id: 'import', title: i.hasBookingSystem ? 'Import your clients to see who is due back' : 'Add your clients to see who is due back', why: i.hasBookingSystem ? 'Export your clients from your booking system and drop the file here. Gainora works out who is due or overdue, treatment by treatment, and drafts the texts.' : 'Add your regulars by hand (name, mobile, last visit) or import a spreadsheet. Gainora works out who is due back and drafts the texts.', cta: i.hasBookingSystem ? 'Import clients' : 'Add clients', link: '/clients?tab=import' });
  }
  if (!w?.reviews) out.push({ id: 'google', title: 'Connect your Google listing', why: 'Then the Watcher reads your reviews every morning, drafts replies, and your review requests carry your Google review link.', cta: 'Find my listing', link: '/watcher?tab=reviews' });
  const recent = i.visits.filter((v) => now.getTime() - new Date(v.at).getTime() < 60 * DAY);
  const askable = i.clients.filter((c) => c.consent !== 'opted_out' && c.phone && recent.some((v) => v.clientId === c.id) && (!c.lastReviewAskAt || now.getTime() - new Date(c.lastReviewAskAt).getTime() > REVIEW_ASK_GAP_DAYS * DAY));
  if (askable.length && w?.reviews) out.push({ id: 'ask-reviews', title: `Ask your last ${Math.min(10, askable.length)} clients for a Google review`, why: `${askable.length} recent clients can be asked; the texts are drafted with your review link. A handful of new reviews changes how you look next to the clinics nearby.`, cta: 'See the drafts', link: '/clients?tab=reviews' });
  const cmp = w?.competitors?.comparison;
  if (cmp) {
    const gap = cmp.rows.filter((r) => r.yours && r.listedBy >= 2 && r.localAvg != null).map((r) => ({ r, diff: r.yours!.value - r.localAvg! })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    if (gap && Math.abs(gap.diff) >= Math.max(15, gap.r.localAvg! * 0.15)) out.push({ id: `price-${gap.r.id}`, title: `Your ${gap.r.label.charAt(0).toLowerCase()}${gap.r.label.slice(1)} price is £${Math.round(Math.abs(gap.diff))} ${gap.diff > 0 ? 'above' : 'below'} the local average`, why: `You charge ${gap.r.yours!.price}; the ${gap.r.listedBy} nearby businesses that list it average £${Math.round(gap.r.localAvg!)}. ${gap.diff > 0 ? 'A higher price holds when the page says what it includes.' : 'Check it still covers your time and product.'}`, cta: 'See the comparison', link: '/watcher?tab=prices' });
  }
  if (!out.length && w && !w.competitors?.foundAt) out.push({ id: 'wait-nearby', title: 'Your nearby competitors are being found', why: 'The Watcher is searching Google around you now. Their prices, reviews and Instagram appear on the Competitors tab within a few minutes.', cta: 'See the Watcher', link: '/watcher?tab=competitors' });
  return out.slice(0, 3);
}

/** Whether Home should show the getting-started block rather than the usual day. */
export function isNewAccount(profile: { completedAt?: string }, clients: Client[], now = new Date()): boolean {
  const started = profile.completedAt ? new Date(profile.completedAt).getTime() : now.getTime();
  return now.getTime() - started < 7 * DAY && clients.length === 0;
}
