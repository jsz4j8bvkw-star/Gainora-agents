import { body, db, handler, HttpError, json, requireAgent } from '../lib/core';

// The owner files a matched public contract: to review, saved, applied or not for them.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['new', 'saved', 'dismissed', 'applied'];

export default handler(async (req) => {
  const user = await requireAgent(req, 'scout');
  const { id, status } = await body<{ id: string; status: string }>(req);
  if (!UUID.test(String(id)) || !STATUSES.includes(status)) throw new HttpError(400, 'That change could not be saved.');
  const rows = await db<any[]>(`tender_matches?id=eq.${id}&user_id=eq.${user.id}`, { method: 'PATCH', body: { status }, prefer: 'return=representation' });
  if (!rows?.length) throw new HttpError(404, 'That contract is no longer on your list.');
  return json({ ok: true });
});
export const config = { path: '/api/tenders', method: 'POST' };
