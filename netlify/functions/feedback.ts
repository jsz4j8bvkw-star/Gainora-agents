import { body, db, handler, HttpError, json, upsert, userFromRequest } from '../lib/core';
import { REASONS, normHost, type FeedbackKind } from '../../shared/learning';

// "Useful" / "Not relevant" on anything an agent produced. Stored per item (a second answer replaces
// the first) and turned into rules the agents follow. { forget: id } removes one answer.
const AGENTS = new Set(['watcher', 'scout', 'brief']);
const CHANGE_KINDS = new Set(['price', 'offer', 'content', 'new-page']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default handler(async (req) => {
  const user = await userFromRequest(req);
  const f = await body<any>(req);

  if (typeof f.forget === 'string') {
    if (!UUID.test(f.forget)) throw new HttpError(400, 'That answer no longer exists.');
    await db(`feedback?id=eq.${f.forget}&user_id=eq.${user.id}`, { method: 'DELETE' });
    return json({ ok: true });
  }

  const kind = f.itemKind as FeedbackKind;
  if (!AGENTS.has(f.agent) || !Object.keys(REASONS).includes(kind) || !['useful', 'not_relevant'].includes(f.verdict)) throw new HttpError(400, 'That answer could not be saved.');
  const itemId = String(f.itemId || '').slice(0, 120);
  if (!itemId) throw new HttpError(400, 'That answer could not be saved.');
  const reason = f.verdict === 'not_relevant' && REASONS[kind].includes(f.reason) ? f.reason : null;

  await upsert('feedback', {
    user_id: user.id, agent: f.agent, item_kind: kind, item_id: itemId, verdict: f.verdict, reason,
    item_text: String(f.text || '').slice(0, 300), host: normHost(typeof f.host === 'string' ? f.host : '') || null,
    change_kind: CHANGE_KINDS.has(f.changeKind) ? f.changeKind : null, created_at: new Date().toISOString(),
  }, 'user_id,item_kind,item_id');

  // Act on the answer straight away, as the app shows it.
  if (f.verdict === 'not_relevant' && (kind === 'lead' || kind === 'opportunity')) {
    const rows = await db<any[]>(`scout_searches?select=id,results&user_id=eq.${user.id}&results=cs.${encodeURIComponent(JSON.stringify([{ id: itemId }]))}`);
    for (const s of rows) {
      const results = (s.results || []).map((r: any) => (r.id === itemId ? { ...r, dismissed: true } : r));
      await db(`scout_searches?id=eq.${s.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: { results } });
    }
  }
  if (kind === 'tender' && UUID.test(itemId)) {
    const status = f.verdict === 'useful' ? 'saved' : 'dismissed';
    await db(`tender_matches?id=eq.${itemId}&user_id=eq.${user.id}${status === 'saved' ? '&status=eq.new' : ''}`, { method: 'PATCH', body: { status } });
  }
  return json({ ok: true });
});
export const config = { path: '/api/feedback', method: 'POST' };
