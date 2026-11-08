// Capture & Convert server helpers: secret enquiry links and the reply drafter.
import { createHash, randomBytes } from 'node:crypto';
import { addValue } from './core';
import { ai, hasBanned, HOUSE_STYLE, profileContext } from './ai';
import { firstReply, type Channel, type EnquiryKind } from '../../shared/capture';

export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
/** Tokens are 32 URL-safe characters; anything else is refused before touching the database. */
export const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** The owner's first reply to an enquiry. AI-written when available, a plain template otherwise. Never sent by Gainora. */
export async function draftEnquiryReply(userId: string, profile: any, e: any): Promise<string> {
  const channel: Channel = e.email && !e.phone ? 'email' : 'text';
  const ctx = { business: profile.business.name, owner: profile.business.ownerName || profile.business.name, customer: String(e.name || '').split(' ')[0] || undefined };
  const fallback = firstReply(ctx, e.kind as EnquiryKind, channel);
  let text = fallback;
  try {
    const r = await ai({
      userId, agent: 'capture', maxTokens: 300, fast: true,
      system: `${HOUSE_STYLE}\nWrite the owner's first reply to a customer enquiry for a UK trade business. ${channel === 'email' ? 'An email under 90 words in the body; start with "Subject: ".' : 'A text message under 45 words.'} Thank them, show you understood the job in one short phrase, and say what happens next (a call back or a visit). Never give a price, a time slot or technical advice unless the enquiry already contains it from the business. No marketing, no offers. Sign with the owner's first name. Plain text only.`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nEnquiry (${e.channel}) from ${e.name || 'a customer'}${e.postcode ? `, ${e.postcode}` : ''}:\n${String(e.summary || e.transcript || '').slice(0, 1500)}` }],
    });
    const t = r.text.trim();
    if (t && !hasBanned(t) && (channel !== 'email' || t.startsWith('Subject:'))) text = t;
  } catch { /* keep the template */ }
  await addValue(userId, 'capture', 'draft_written', `Drafted a reply to ${e.name || 'an enquiry'}`);
  return text;
}
