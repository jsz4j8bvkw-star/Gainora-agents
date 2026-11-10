import { db, enc, json } from '../lib/core';
import { hashToken, toRecord, TOKEN, withDefaults } from '../lib/capture';
import { callerLookup, lookupNumber, NO_NUMBER, NO_RECORD, type KnownClient, type KnownVisit } from '../../shared/callers';

// Returning callers. Retell calls this the moment a call comes in (the phone number's "Inbound Webhook URL"),
// with the number that's calling. We answer with a few dynamic variables the receptionist's prompt uses
// (shared/callers.ts says exactly what, and shared/retell.ts how she may use it).
// POST /api/caller-in/<token>, the same secret token as the client's enquiry link.
//
// It always answers 200, fast: if anything goes wrong the call still goes ahead, just without the record.
// Retell gives each attempt 10 seconds and retries twice, which would only delay the caller.
const answer = (variables: Record<string, string>) => json({ call_inbound: { dynamic_variables: variables } });
const nothing = (record: string) => answer({ caller_known: 'no', caller_first_name: '', caller_record: record });
/** Each lookup step gets 2.5 seconds (5 at most in all, inside Retell's 10). A slow database means "nothing on record", never a ringing phone. */
const LIMIT_MS = 2500;
const inTime = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('lookup took too long')), LIMIT_MS).unref?.())]);

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
    // A wrong or switched-off link still answers at once (with nothing), so a caller is never kept waiting
    // while Retell retries. It's logged so the setup can be fixed.
    if (!TOKEN.test(token)) { console.warn('[capture] caller-in: malformed link'); return nothing(NO_RECORD); }
    const raw = await req.text();
    if (raw.length > 64_000) return nothing(NO_RECORD);
    let b: any = null;
    try { b = JSON.parse(raw); } catch { return nothing(NO_RECORD); }
    // Only inbound calls; anything else (an inbound text, a test ping) gets an empty, successful answer.
    if (b?.event && b.event !== 'call_inbound') return json({});

    const [src] = await inTime(db<any[]>(`enquiry_sources?select=id,user_id&token_hash=eq.${hashToken(token)}&active=eq.true`));
    if (!src) { console.warn('[capture] caller-in: unknown or switched-off link'); return nothing(NO_RECORD); }
    const from = lookupNumber(b?.call_inbound?.from_number ?? b?.from_number);
    if (!from) return nothing(NO_NUMBER);
    const userId = src.user_id as string;

    const [srow, rows, client] = await inTime(Promise.all([
      db<any[]>(`capture_settings?select=data&user_id=eq.${userId}`),
      db<any[]>(`enquiries?select=*&user_id=eq.${userId}&phone=eq.${enc(from)}&is_test=eq.false&order=received_at.desc&limit=30`),
      knownClient(userId, from),
    ]));
    const s = withDefaults(srow?.[0]?.data);
    const r = callerLookup({ enquiries: rows.map(toRecord), client: client?.client ?? null, visits: client?.visits ?? [] }, s);
    return answer(r.variables);
  } catch (e: any) {
    console.error('[capture] caller-in', e?.message);
    return nothing(NO_RECORD);
  }
};

/**
 * The client in the owner's Command Centre client list with this mobile, and their last visits. The list
 * belongs to the same Gainora login. If the owner doesn't use it (or it isn't set up yet), there's simply
 * nothing here. Clients the owner marked as not coming back are left out.
 */
async function knownClient(userId: string, phone: string): Promise<{ client: KnownClient; visits: KnownVisit[] } | null> {
  try {
    const [c] = await db<any[]>(`clients?select=id,name&user_id=eq.${userId}&phone=eq.${enc(phone)}&not_coming_back=eq.false&order=updated_at.desc&limit=1`);
    if (!c) return null;
    const v = await db<any[]>(`client_visits?select=visited_on,treatment,practitioner&user_id=eq.${userId}&client_id=eq.${c.id}&order=visited_on.desc&limit=20`);
    return { client: { name: String(c.name || '') }, visits: v.map((x) => ({ visitedOn: String(x.visited_on), treatment: String(x.treatment || ''), practitioner: x.practitioner ?? null })) };
  } catch { return null; }
}

export const config = { path: '/api/caller-in/:token', method: 'POST' };
