import { body, getProfile, handler, HttpError, json, requireAgent, upsert } from '../lib/core';
import { runBrief } from '../lib/agents';

export default handler(async (req) => {
  const user = await requireAgent(req, 'brief');
  const w = await body<{ weekOf: string; values: Record<string, number | null>; note?: string }>(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w.weekOf))) throw new HttpError(400, 'The week is not valid.');
  const values: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(w.values || {})) {
    if (!/^[a-z]{2,20}$/.test(k)) continue;
    if (v === null) { values[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, 'Numbers must be positive.');
    values[k] = n;
  }
  await upsert('week_numbers', { user_id: user.id, week_of: w.weekOf, values, note: w.note ? String(w.note).slice(0, 500) : null }, 'user_id,week_of');
  const profile = await getProfile(user.id);
  return json(await runBrief(user.id, profile, w.weekOf));
});
export const config = { path: '/api/brief-run', method: 'POST' };
