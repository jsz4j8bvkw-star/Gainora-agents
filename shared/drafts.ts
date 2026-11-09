// The texts Gainora drafts for the owner to send: a rebook nudge to a client who is due, a request
// for a Google review after a good visit, a note to fill a quiet day, and the public reply to a
// Google review. Rule-based, so nothing private is sent to an AI and every draft is the same in
// the demo, the tests and the app. The owner reads, edits and sends every one.
//
// Rules: every marketing text ends with the opt-out line; a review request never offers anything
// in return; replies to reviews never mention health details and move complaints offline.

import { firstNameOf } from './clients';
import { treatmentById } from './treatments';
import type { ReviewItem } from './reviews';

export const OPT_OUT_LINE = 'Reply STOP to opt out.';

export interface Voice {
  clinic: string;
  owner: string;             // first name
  style?: string;            // the profile's preferred style ("Short and direct", "Warm and friendly"…)
  bookingUrl?: string;       // the public booking page, when there is one
}

const warm = (v: Voice) => /warm|friendly|chatty|relaxed/i.test(v.style || '');
const bookLine = (v: Voice) => (v.bookingUrl ? `Book here: ${v.bookingUrl}` : 'Reply to this text to book.');

/** A treatment's name as the owner would say it in a text ("your anti-wrinkle top-up", "your lip filler"). */
export function treatmentPhrase(treatment: string | null, treatmentId: string | null): string {
  const label = (treatmentId && treatmentById(treatmentId)?.label) || treatment || 'your next appointment';
  const l = label.replace(/,\s*(\d+ areas?|\d+(\.\d+)?ml|\d+ sessions?|course|amount not stated|areas not stated|area not stated)\s*$/i, '').replace(/\s*\((.*?)\)\s*$/, '');
  if (/anti-wrinkle/i.test(l)) return 'your anti-wrinkle top-up';
  if (/^lip filler/i.test(l)) return 'your lip filler';
  if (/filler|profhilo|skin booster|polynucleotide/i.test(l)) return `your ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
  if (/^your /i.test(l)) return l;
  return `your ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
}

/** Weeks since a visit, in words the owner would use. */
export function sinceWords(lastVisitAt: string | null, now = new Date()): string {
  if (!lastVisitAt) return 'a while';
  const weeks = Math.round((now.getTime() - new Date(lastVisitAt).getTime()) / (7 * 86_400_000));
  if (weeks < 5) return `${Math.max(1, weeks)} week${weeks === 1 ? '' : 's'}`;
  const months = Math.round(weeks / 4.345);
  return months <= 1 ? 'about a month' : months < 12 ? `about ${months} months` : 'about a year';
}

/** A personal text to a client who is due back. Short enough for two SMS segments at most. */
export function rebookText(v: Voice, c: { name: string; treatment: string | null; treatmentId: string | null; lastVisitAt: string | null }, now = new Date()): string {
  const first = firstNameOf(c.name);
  const what = treatmentPhrase(c.treatment, c.treatmentId);
  const since = sinceWords(c.lastVisitAt, now);
  const body = warm(v)
    ? `Hi ${first}, it’s ${v.owner} from ${v.clinic}. It’s been ${since} since ${what}, so you’re about due. I’ve got a few spaces this fortnight if you’d like one. ${bookLine(v)}`
    : `Hi ${first}, it’s ${v.owner} at ${v.clinic}. It’s been ${since} since ${what}, so you’re due about now. ${bookLine(v)}`;
  return `${body} ${OPT_OUT_LINE}`;
}

/** The Google review link for a listing. */
export const reviewLink = (placeId: string) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

/** A request for a Google review after a visit. No offer, discount or gift is ever attached. */
export function reviewRequestText(v: Voice, c: { name: string; treatment?: string | null; treatmentId?: string | null }, link: string): string {
  const first = firstNameOf(c.name);
  const what = c.treatment || c.treatmentId ? treatmentPhrase(c.treatment ?? null, c.treatmentId ?? null).replace(/^your /, 'your ') : 'your visit';
  const body = warm(v)
    ? `Hi ${first}, ${v.owner} here from ${v.clinic}. Thank you for coming in for ${what}. If you were happy with it, a Google review would mean a lot to a small clinic like ours: ${link}`
    : `Hi ${first}, it’s ${v.owner} at ${v.clinic}. Thank you for coming in for ${what}. If you were happy, would you leave us a Google review? ${link}`;
  return `${body} ${OPT_OUT_LINE}`;
}

/** Words that would make a review request an incentive, which Google does not allow. */
export const INCENTIVE = /\b(\d+\s?%|percent|discount|money off|£\s?\d+\s?off|free\b|voucher|gift|prize|raffle|draw|in return|in exchange|reward)/i;
export const hasIncentive = (text: string) => INCENTIVE.test(text);

/** A note to the clients who fit a quiet day: due or nearly due, with a specific slot to offer. */
export function quietDayText(v: Voice, c: { name: string; treatment: string | null; treatmentId: string | null }, slot: { dayLabel: string; timeLabel?: string }): string {
  const first = firstNameOf(c.name);
  const what = treatmentPhrase(c.treatment, c.treatmentId);
  const when = slot.timeLabel ? `${slot.dayLabel} ${slot.timeLabel}` : slot.dayLabel;
  return `Hi ${first}, it’s ${v.owner} at ${v.clinic}. I’ve had a space come up on ${when} if you’d like to get ${what} booked in. ${bookLine(v)} ${OPT_OUT_LINE}`;
}

/* ---------- Competitor response: text to the right due-back clients ---------- */
export function competitorResponseText(v: Voice, c: { name: string; treatment: string | null; treatmentId: string | null }, include: string | null): string {
  const first = firstNameOf(c.name);
  const what = treatmentPhrase(c.treatment, c.treatmentId);
  const inc = include ? ` ${include}` : '';
  return `Hi ${first}, it’s ${v.owner} at ${v.clinic}. You’re about due for ${what}.${inc} ${bookLine(v)} ${OPT_OUT_LINE}`;
}

/* ---------- Sending ---------- */
/** A link that opens the phone's messaging app with the text ready to send. The owner presses send. */
export function smsLink(phone: string, text: string): string {
  return `sms:${phone}?body=${encodeURIComponent(text)}`;
}

const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r^{}\\[~\]|€]*$/;

/** How many SMS segments a text takes, so the owner sees when a draft runs long. */
export function smsSegments(text: string): { segments: number; chars: number; encoding: 'GSM-7' | 'Unicode' } {
  const plain = text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
  const gsm = GSM.test(plain);
  const chars = plain.length;
  const single = gsm ? 160 : 70; const multi = gsm ? 153 : 67;
  return { segments: chars <= single ? 1 : Math.ceil(chars / multi), chars, encoding: gsm ? 'GSM-7' : 'Unicode' };
}

/** Curly quotes and the ellipsis become plain characters so a text stays in the cheaper GSM-7 encoding. */
export const forSms = (text: string) => text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/–/g, '-');

/* ---------- Health details ---------- */
const HEALTH = /\b(allerg\w*|medication\w*|medicine\w*|prescription\w*|prescribed|pregnan\w*|breast.?feed\w*|diagnos\w*|condition\w*|disease\w*|infection\w*|diabet\w*|epilep\w*|thyroid|autoimmune|lupus|cancer|chemo\w*|anxiety|depress\w*|mental health|antidepressant\w*|blood thinner\w*|warfarin|roaccutane|isotretinoin|botulinum dose|units? of|reaction\w*|bruis\w*|swell\w*|lump\w*|cold sore\w*|herpes|hiv|hepatitis|surgery|operation|medical history|gp\b|doctor|nurse said|clinical notes?)\b/i;

/** True when a text mentions something that reads as health information. */
export const mentionsHealth = (text: string) => HEALTH.test(text);

/** Drops sentences that mention health details, so none reach a public reply or a draft. */
export function scrubHealth(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !HEALTH.test(s));
  return (kept.length ? kept : []).join(' ').trim();
}

/* ---------- Review replies ---------- */
const COMPLAINT = /\b(wait|waited|waiting|ignored|no reply|didn'?t reply|never (replied|got back)|rude|late|cancel\w*|refund|overcharg\w*|expensive|disappoint\w*|unhappy|uneven|botched|lumpy|pain\w*|worst|avoid|terrible|awful|poor|not happy|let down)\b/i;

/**
 * A public reply the owner can paste on Google. Written in the business's voice: warm for praise,
 * calm and brief for complaints, always taking the detail offline. Never argues, never offers
 * anything for a changed review, never repeats or adds anything about the reviewer's health or
 * treatment details beyond what they praised in general terms.
 */
export function reviewReplyDraft(r: ReviewItem, v: Voice & { edge?: string }): string {
  const first = firstNameOf(r.author);
  const text = r.text || '';
  const complaint = r.rating <= 3 || (r.rating === 4 && COMPLAINT.test(text));
  const praised = /natural|subtle|listen|talk(ed)? me through|nervous|gentle|professional|lovely|friendly|clean|calm|results?|skin|glow|happy|recommend/i.test(text);
  if (!complaint) {
    const thanks = praised
      ? `Thank you, ${first}. It means a great deal to hear that${/natural|subtle/i.test(text) ? ' the result looks natural' : /nervous|talk(ed)? me through|listen/i.test(text) ? ' you felt looked after' : ' you were happy'}; that is exactly what we set out to do at ${v.clinic}.`
      : `Thank you so much, ${first}. We’re really glad you were happy with your visit to ${v.clinic}.`;
    const edge = v.edge ? ` ${v.edge.replace(/\.$/, '')} is how we like to work, so it is lovely to hear it landed.` : '';
    return `${thanks}${edge} We look forward to seeing you next time.\n\n${v.owner}`;
  }
  // Complaints: acknowledge the specific service point if they named one (never a medical detail), apologise once, move it offline.
  const point = /wait|waited|waiting|ignored|no reply|didn'?t reply|never (replied|got back)|message/i.test(text) ? 'that you waited so long for a reply'
    : /late|cancel/i.test(text) ? 'about the timing of your appointment'
    : /price|charg|expensive|refund/i.test(text) ? 'that the cost did not feel clear'
    : /rude|unfriendly/i.test(text) ? 'that you did not feel welcome'
    : 'that part of your visit fell short';
  const glad = r.rating >= 3 && praised ? ` I’m glad you were happy with the result itself, and` : '';
  return `${first}, thank you for taking the time to tell us this.${glad} I’m sorry ${point}; that is not the standard we want for anyone at ${v.clinic}. I’d like to put it right and talk it through properly, so please message or call me directly and I’ll come back to you myself.\n\n${v.owner}, ${v.clinic}`;
}

/** The final check on any reply before it is shown: no health details, no incentives, no arguing phrases. */
export function safeReply(text: string): string {
  const sentences = scrubHealth(text).split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => !(/\b(discount|voucher|refund|free treatment|gift)\b/i.test(s) && /\b(change|amend|remove|update|edit|revise)\b/i.test(s))).join(' ').trim();
}
