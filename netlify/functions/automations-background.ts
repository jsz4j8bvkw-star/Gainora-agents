import { db, requireInternal } from '../lib/core';
import { runAutomations } from '../lib/messages';

// Runs each client's automations. Instant messages (thank-yous, confirmations) are also sent the moment
// something happens; this catches everything that's timed.
export default async (req: Request) => {
  try {
    requireInternal(req);
    const ents = await db<any[]>('entitlements?select=user_id&agent=eq.capture&status=in.(active,trialing)&user_id=not.is.null');
    for (const userId of [...new Set(ents.map((e) => e.user_id))]) {
      try { await runAutomations(userId); }
      catch (e: any) { console.error('[capture] automations for client failed', e?.message); }
    }
  } catch (e: any) { console.error('[capture] automations failed', e?.message); }
  return new Response('ok');
};
