import { body, db, handler, HttpError, json, requireAgent } from '../lib/core';

export default handler(async (req) => {
  const user = await requireAgent(req, 'scout');
  const { searchId, resultId, saved } = await body<{ searchId: string; resultId: string; saved: boolean }>(req);
  const [s] = await db<any[]>(`scout_searches?select=results&id=eq.${encodeURIComponent(searchId)}&user_id=eq.${user.id}`);
  if (!s) throw new HttpError(404, 'That search no longer exists.');
  const results = (s.results || []).map((r: any) => (r.id === resultId ? { ...r, saved: !!saved } : r));
  await db(`scout_searches?id=eq.${encodeURIComponent(searchId)}&user_id=eq.${user.id}`, { method: 'PATCH', body: { results } });
  return json({ ok: true });
});
export const config = { path: '/api/scout-save', method: 'POST' };
