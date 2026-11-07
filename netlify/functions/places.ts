import { body, getProfile, handler, HttpError, json, requireAgent, upsert } from '../lib/core';
import { googleConfigured, placeDetails, searchPlaces } from '../lib/google';
import { runWatcher } from '../lib/watcher';

// The owner finds their own Google listing ({ op: 'find', query }) and confirms it ({ op: 'select', placeId }).
// After that the Watcher reads its public rating and reviews every morning. Nothing is ever posted.
export default handler(async (req) => {
  const user = await requireAgent(req, 'watcher');
  if (!googleConfigured()) throw new HttpError(503, 'Google reviews are not switched on yet. Email hello@gainora.co.uk and we’ll sort it.');
  const b = await body<{ op: 'find' | 'select'; query?: string; placeId?: string }>(req);

  if (b.op === 'find') {
    const q = String(b.query || '').trim();
    if (q.length < 3 || q.length > 200) throw new HttpError(400, 'Type your business name and town.');
    return json({ places: await searchPlaces(q, { pageSize: 5 }) });
  }

  if (b.op === 'select') {
    const placeId = String(b.placeId || '');
    const place = await placeDetails(placeId, false); // checks the listing exists before saving it
    await upsert('watcher_state', { user_id: user.id, place_id: placeId, place_name: place.name || null }, 'user_id');
    const profile = await getProfile(user.id);
    await runWatcher(user.id, profile, { only: 'reviews' });
    return json({ ok: true });
  }
  throw new HttpError(400, 'Unknown request.');
});
export const config = { path: '/api/places', method: 'POST' };
