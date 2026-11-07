import { callInternal, db, getProfile, requireInternal } from '../lib/core';
import { fetchNewTenders, getJob, matchTendersForUser, openTenders, setJob, storeTenders } from '../lib/contracts';

// Background function (up to 15 minutes).
// {}                 → fetch new public contracts from Contracts Finder, store them, then match each Scout client.
// { userId, since? } → match one client against stored open contracts (straight after onboarding, or from the run above).
const DAY = 86_400_000;

export default async (req: Request) => {
  try {
    requireInternal(req);
    const { userId, since } = await req.json().catch(() => ({} as any));

    if (userId) {
      const profile = await getProfile(userId);
      if (profile) {
        // A little overlap allows for time-zone differences; contracts already matched are skipped.
        let list = await openTenders(since ? new Date(new Date(since).getTime() - DAY / 2).toISOString() : new Date(Date.now() - 21 * DAY).toISOString());
        if (!list.length && !since) {
          // Nothing stored yet (first deployment): fetch the last week now.
          const r = await fetchNewTenders(new Date(Date.now() - 7 * DAY).toISOString(), undefined, 30);
          await storeTenders(r.tenders);
          list = r.tenders;
        }
        await matchTendersForUser(userId, profile, list);
      }
      return new Response(null, { status: 202 });
    }

    const job = await getJob('tenders');
    const to = new Date().toISOString();
    const last = job?.publishedTo && Date.now() - new Date(job.publishedTo).getTime() < 7 * DAY ? job.publishedTo : null;
    const from = last ?? new Date(Date.now() - (job ? 2 : 14) * DAY).toISOString();
    const r = await fetchNewTenders(from, to, job ? 20 : 40);
    await storeTenders(r.tenders);
    // If Contracts Finder stopped us early, keep the window open so tomorrow's run fetches the rest.
    await setJob('tenders', { publishedTo: r.complete ? to : from, fetched: r.tenders.length, complete: r.complete, at: to });

    const ents = await db<any[]>('entitlements?select=user_id&agent=eq.scout&status=in.(active,trialing)&user_id=not.is.null');
    for (const id of new Set(ents.map((e) => e.user_id as string))) await callInternal('tenders-background', { userId: id, since: from });
  } catch (e: any) { console.error('[gainora] tenders-background', e?.message); }
  return new Response(null, { status: 202 });
};
