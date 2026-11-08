import { getProfile, requireInternal } from '../lib/core';
import { runWatcher } from '../lib/watcher';

// Background function (up to 15 minutes): one client's full Watcher run.
export default async (req: Request) => {
  try {
    requireInternal(req);
    const { userId, quiet, manual, findNow } = await req.json();
    const profile = await getProfile(userId);
    if (profile) await runWatcher(userId, profile, { quiet, manual: !!manual, findNow: !!findNow });
  } catch (e: any) { console.error('[gainora] watcher-background', e?.message); }
  return new Response(null, { status: 202 });
};
