import { body, callInternal, db, handler, HttpError, insert, json, requireAgent } from '../lib/core';
import { dbKindFor, encodeFocus, isFocus, type ScoutFocus } from '../../shared/scout';

export default handler(async (req) => {
  const user = await requireAgent(req, 'scout');
  const { query, area, kind } = await body<{ query: string; area: string; kind?: string }>(req);
  const focus: ScoutFocus = isFocus(kind) ? kind : 'customers';
  const q = String(query || '').trim();
  if (q.length < 8 || q.length > 300) throw new HttpError(400, 'Describe who you’re looking for in a few words.');
  const running = await db<any[]>(`scout_searches?select=id&user_id=eq.${user.id}&status=eq.running&created_at=gte.${new Date(Date.now() - 20 * 60_000).toISOString()}`);
  if (running.length) throw new HttpError(429, 'The Scout is already researching. Wait for that search to finish first.');
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const count = await db<any[]>(`scout_searches?select=id&user_id=eq.${user.id}&created_at=gte.${monthStart.toISOString()}`);
  if (count.length >= Number(process.env.SCOUT_MONTHLY_LIMIT || 20)) throw new HttpError(429, 'You’ve used this month’s searches. They reset on the 1st.');
  // The database knows two kinds; the finer focus travels as a marker at the front of the query (see shared/scout.ts).
  const [row] = await insert('scout_searches', { user_id: user.id, query: encodeFocus(q, focus), area: String(area || 'United Kingdom').slice(0, 80), status: 'running', kind: dbKindFor(focus) });
  await callInternal('scout-background', { id: row.id });
  return json({ ...row, query: q, kind: focus }, 202);
});
export const config = { path: '/api/scout-start', method: 'POST' };
