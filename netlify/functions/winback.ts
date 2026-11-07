import { db, getProfile, handler, HttpError, json, requireAgent } from '../lib/core';
import { draftWinback } from '../lib/agents';
import { analyseWeeks, metricsFor } from '../../shared/metrics';

// Writes an email, a text and a social post to bring past customers back. The owner sends them.
export default handler(async (req) => {
  const user = await requireAgent(req, 'brief');
  const profile = await getProfile(user.id);
  if (!profile) throw new HttpError(400, 'Finish setting up your business first.');
  const rows = await db<any[]>(`week_numbers?select=week_of,values&user_id=eq.${user.id}&order=week_of.asc&limit=26`);
  const changes = analyseWeeks(rows.map((r) => ({ weekOf: r.week_of, values: r.values })), metricsFor(profile.numbers?.track || []));
  return json(await draftWinback(user.id, profile, changes));
});
export const config = { path: '/api/winback', method: 'POST' };
