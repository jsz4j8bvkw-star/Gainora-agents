// The lead pipeline: from "found by the Scout" to "won", with follow-up dates.

export type LeadStage = 'to_contact' | 'contacted' | 'replied' | 'meeting' | 'won' | 'lost';

export const STAGES: { id: LeadStage; label: string }[] = [
  { id: 'to_contact', label: 'To contact' },
  { id: 'contacted', label: 'Waiting for a reply' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting', label: 'Meeting booked' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Not interested' },
];

/** Days after first contact when each follow-up is due. */
export const FOLLOW_UP_DAYS = [4, 9];

function skipWeekend(d: Date): Date {
  const x = new Date(d);
  if (x.getDay() === 6) x.setDate(x.getDate() + 2);
  else if (x.getDay() === 0) x.setDate(x.getDate() + 1);
  return x;
}

export function nextFollowUp(stage: LeadStage, contactedAt?: string | null, followUpsSent = 0): string | null {
  if (stage !== 'contacted' || !contactedAt) return null;
  const days = FOLLOW_UP_DAYS[followUpsSent];
  if (days == null) return null;
  const d = new Date(contactedAt);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return skipWeekend(d).toISOString();
}

export function isDue(nextFollowUpAt: string | null | undefined, now = new Date()): boolean {
  if (!nextFollowUpAt) return false;
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return new Date(nextFollowUpAt).getTime() <= end.getTime();
}

/** Applies a stage change and works out what happens next. */
export function moveLead<T extends { stage: LeadStage; contactedAt?: string | null; followUps: number; nextFollowUp?: string | null }>(lead: T, stage: LeadStage, now = new Date()): T {
  const next = { ...lead, stage };
  if (stage === 'contacted' && !lead.contactedAt) { next.contactedAt = now.toISOString(); next.followUps = 0; }
  next.nextFollowUp = nextFollowUp(stage, next.contactedAt, next.followUps);
  return next;
}

/** Records that a follow-up was sent and schedules the next one, if any. */
export function followUpSent<T extends { stage: LeadStage; contactedAt?: string | null; followUps: number; nextFollowUp?: string | null }>(lead: T): T {
  const followUps = lead.followUps + 1;
  return { ...lead, followUps, nextFollowUp: nextFollowUp(lead.stage, lead.contactedAt, followUps) };
}
