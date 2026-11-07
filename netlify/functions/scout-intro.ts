import { body, db, getProfile, handler, HttpError, json, requireAgent } from '../lib/core';
import { draftIntro } from '../lib/agents';

export default handler(async (req) => {
  const user = await requireAgent(req, 'scout');
  const { searchId, resultId } = await body<{ searchId: string; resultId: string }>(req);
  const [s] = await db<any[]>(`scout_searches?select=results&id=eq.${encodeURIComponent(searchId)}&user_id=eq.${user.id}`);
  const result = s?.results?.find((r: any) => r.id === resultId);
  if (!result) throw new HttpError(404, 'That lead no longer exists.');
  const profile = await getProfile(user.id);
  return json({ text: await draftIntro(user.id, profile, result) });
});
export const config = { path: '/api/scout-intro', method: 'POST' };
