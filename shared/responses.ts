// Answering the competition, not just watching it. When the Watcher records a competitor's price
// change, offer or busy Instagram post, this builds a ready response pack for the owner:
// an Instagram caption, a one-line "why us" for the website or booking page, and, when the event
// is about a treatment the owner's due-back clients had, a text to those clients.
//
// Rules: never suggest matching the price; compare like with like only (the catalogue row);
// only facts that are in the data (the owner's own price, what they include, the local average);
// never name the competitor in anything public.

import type { Comparison, CompareRow } from './treatments';
import { matchTreatment, treatmentById } from './treatments';
import type { Client, DueInfo } from './clients';
import { competitorResponseText, type Voice } from './drafts';

export interface ResponseEvent { id: string; kind: string; competitor: string; summary: string; detail?: string; at: string }

export interface ResponsePack {
  eventId: string;
  treatmentId: string | null;
  label: string | null;
  /** Public caption for Instagram: the owner's own facts, no competitor named, no price cut. */
  caption: string;
  /** One line for the website or booking page. */
  whyUs: string;
  /** A text to the due-back clients who had this treatment, when there are any who may be messaged. */
  text: { audience: { client: Client; due: DueInfo }[]; draft: string } | null;
  /** Where every figure in the pack came from. */
  facts: string[];
  /** What this pack is not: shown to the owner so the rule is visible. */
  rule: string;
}

const pounds = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The catalogue treatment an event is about, from its words. */
export function eventTreatment(e: Pick<ResponseEvent, 'summary' | 'detail'>): string | null {
  return matchTreatment(e.summary)?.id ?? matchTreatment(e.detail || '')?.id ?? null;
}

/** A short clause from the owner's stated edge ("nurse prescriber, 45-minute appointments"). */
function includes(edge: string | undefined): string | null {
  const e = String(edge || '').trim().replace(/\.$/, '');
  if (!e) return null;
  return e.length > 110 ? e.slice(0, 110).replace(/\s+\S*$/, '') : e;
}

export function responsePack(
  e: ResponseEvent,
  ctx: { profile: { business: { name: string; ownerName: string }; competitors?: { ourEdge?: string }; offer?: { bookingUrl?: string }; preferences?: { style?: string } }; comparison?: Comparison | null; due?: { client: Client; due: DueInfo }[]; canText?: (c: Client) => boolean },
): ResponsePack {
  const tid = eventTreatment(e);
  const row: CompareRow | undefined = tid && ctx.comparison ? ctx.comparison.rows.find((r) => r.id === tid) : undefined;
  const label = tid ? treatmentById(tid)?.label ?? null : null;
  const inc = includes(ctx.profile.competitors?.ourEdge);
  const clinic = ctx.profile.business.name;
  const facts: string[] = [];
  if (row?.yours) facts.push(`Your price for ${lower1(row.label)}: ${row.yours.price} (your price list, ${row.yours.seenAt.slice(0, 10)}).`);
  if (row && row.localAvg != null && row.listedBy) facts.push(`Local average ${pounds(row.localAvg)} across ${row.listedBy} nearby ${row.listedBy === 1 ? 'business' : 'businesses'} that list it; you are ${row.position}.`);
  if (inc) facts.push(`What you include, in your words: ${inc}.`);
  facts.push(`What the Watcher saw: ${e.summary} (${e.competitor}, ${e.at.slice(0, 10)}).`);

  const isOffer = e.kind === 'offer' || e.kind === 'post';
  const isPrice = e.kind === 'price';
  const what = label ? lower1(label.replace(/,\s*(\d+ areas?|\d+(\.\d+)?ml|\d+ sessions?|course|.*not stated)\s*$/i, '')) : 'what we do';

  // Caption: our own facts and our own reasons. A price is only quoted when it is the owner's own.
  const price = row?.yours ? ` ${row.label.replace(/\s*\(.*\)$/, '')} is ${row.yours.price} here` : '';
  const incLine = inc ? ` That includes ${lower1(inc)}.` : '';
  const caption = isOffer
    ? `There are a lot of offers around at the moment. Ours is the same every month: ${what} done properly, with time to talk it through first and a review afterwards.${price ? `${price}.` : ''}${incLine} Book through the link in our bio.`
    : isPrice
      ? `A straight answer on price, because people ask.${price ? `${price}, and that is the whole price.` : ` Our prices are on the booking page, and the price you see is the price you pay.`}${incLine} Questions are always welcome; send us a message.`
      : `${what.charAt(0).toUpperCase()}${what.slice(1)} at ${clinic}: ${inc ? lower1(inc) : 'unhurried appointments and honest advice'}.${price ? `${price}.` : ''} Book through the link in our bio.`;

  const whyUs = inc
    ? `${clinic}: ${inc}.${row?.yours ? ` ${row.label.replace(/\s*\(.*\)$/, '')} ${row.yours.price}, nothing added at the till.` : ''}`
    : `${clinic}: the price you see is the price you pay, and every appointment starts with a proper conversation.${row?.yours ? ` ${row.label.replace(/\s*\(.*\)$/, '')} ${row.yours.price}.` : ''}`;

  // Text to the clients who had this treatment and are due: only those who may be messaged.
  let text: ResponsePack['text'] = null;
  if (tid && ctx.due?.length) {
    const audience = ctx.due.filter((d) => d.due.treatmentId === tid && (!ctx.canText || ctx.canText(d.client)));
    if (audience.length) {
      const voice: Voice = { clinic, owner: ctx.profile.business.ownerName.split(' ')[0], style: ctx.profile.preferences?.style, bookingUrl: ctx.profile.offer?.bookingUrl };
      const first = audience[0];
      text = { audience, draft: competitorResponseText(voice, { name: first.client.name, treatment: first.due.treatment, treatmentId: tid }, inc ? `As always: ${lower1(inc)}.` : null) };
    }
  }

  return {
    eventId: e.id, treatmentId: tid, label, caption, whyUs, text, facts,
    rule: isOffer || isPrice ? 'This pack does not match their price or copy their offer. It says what you charge and what that includes, which is the comparison people actually make.' : 'This pack uses only your own figures and your own words about what you include.',
  };
}

/** Whether an event is worth a response pack at all (prices, offers and busy posts; not follower counts or new pages). */
export const packWorthy = (kind: string) => kind === 'price' || kind === 'offer' || kind === 'post' || kind === 'service';
