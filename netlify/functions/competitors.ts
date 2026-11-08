import { body, callInternal, db, handler, HttpError, json, requireAgent, upsert } from '../lib/core';
import { emptyCompetitors, MAX_TRACKED, type CompetitorsState, type TrackedCompetitor } from '../../shared/competitors';
import { socialUrl } from '../../shared/social';

// The owner shapes the watched list: "not a competitor" on a found business, "watch" on another
// business nearby, "restore" one they dismissed, set or clear a competitor's Instagram handle, or
// ask for a fresh search of businesses nearby (at most once a week; it costs Google calls).
// Competitors the owner typed are edited under Your business, not here.
type Op = 'dismiss' | 'watch' | 'restore' | 'instagram' | 'find';
const DAY = 86_400_000;

export default handler(async (req) => {
  const user = await requireAgent(req, 'watcher');
  const b = await body<{ op: Op; key?: string; handle?: string }>(req);
  const [row] = await db<any[]>(`watcher_state?select=state&user_id=eq.${user.id}`);
  const state = row?.state ?? {};
  const comps: CompetitorsState = { ...emptyCompetitors(), ...(state.competitors ?? {}) };
  const key = String(b.key || '').slice(0, 200);
  const now = new Date().toISOString();

  if (b.op === 'find') {
    if (comps.foundAt && Date.now() - new Date(comps.foundAt).getTime() < 7 * DAY) {
      return json({ started: false, message: 'The Watcher searched for businesses near you in the last week. It searches again automatically every month.' });
    }
    await callInternal('watcher-background', { userId: user.id, manual: true, quiet: true, findNow: true });
    return json({ started: true }, 202);
  }

  if (!key) throw new HttpError(400, 'Which competitor?');
  if (b.op === 'dismiss') {
    const c = comps.list.find((x) => x.key === key) ?? comps.nearby.find((x) => x.key === key);
    if (!c) throw new HttpError(404, 'That business is no longer on your list.');
    if ((c as TrackedCompetitor).source === 'typed') throw new HttpError(400, 'You added this competitor yourself. Remove it under Your business.');
    comps.list = comps.list.filter((x) => x.key !== key);
    comps.nearby = comps.nearby.filter((x) => x.key !== key);
    if (!comps.dismissed.some((d) => d.key === key)) comps.dismissed = [...comps.dismissed, { key, name: c.name, placeId: c.placeId, at: now }].slice(-50);
    comps.events = comps.events.filter((e) => e.key !== key);
    if (comps.advice) comps.advice = { ...comps.advice, lines: comps.advice.lines.filter((l) => l.key !== key) };
  } else if (b.op === 'watch') {
    const n = comps.nearby.find((x) => x.key === key);
    if (!n) throw new HttpError(404, 'That business is no longer on the nearby list.');
    if (comps.list.length >= MAX_TRACKED) throw new HttpError(400, `The Watcher follows up to ${MAX_TRACKED} competitors. Remove one first.`);
    comps.nearby = comps.nearby.filter((x) => x.key !== key);
    comps.list = [...comps.list, { key: n.key, name: n.name, source: 'found', url: n.url || '', placeId: n.placeId, address: n.address, mapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(n.placeId)}`, distanceKm: n.distanceKm, rating: n.rating, count: n.count, history: [{ at: now, rating: n.rating, count: n.count }], ratingCheckedAt: now, services: [], offers: [], bookingPages: [], social: null, firstSeenAt: now }];
  } else if (b.op === 'restore') {
    comps.dismissed = comps.dismissed.filter((d) => d.key !== key);
  } else if (b.op === 'instagram') {
    const c = comps.list.find((x) => x.key === key);
    if (!c) throw new HttpError(404, 'That business is no longer on your list.');
    const raw = String(b.handle || '').trim();
    const url = raw ? socialUrl('instagram', raw) : '';
    if (raw && !url) throw new HttpError(400, 'Enter an Instagram handle, like @theirbusiness, or a link to their page.');
    c.instagram = url || undefined; c.instagramSetBy = 'owner'; c.social = null;
  } else throw new HttpError(400, 'Unknown request.');

  await upsert('watcher_state', { user_id: user.id, state: { ...state, competitors: comps } }, 'user_id');
  return json({ ok: true });
});
export const config = { path: '/api/competitors', method: 'POST' };
