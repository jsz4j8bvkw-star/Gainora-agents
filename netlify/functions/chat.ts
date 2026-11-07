import { body, getProfile, handler, HttpError, json, requireAgent } from '../lib/core';
import { answer } from '../lib/agents';

export default handler(async (req) => {
  const user = await requireAgent(req, null);
  const { text } = await body<{ text: string }>(req);
  const q = String(text || '').trim();
  if (!q) throw new HttpError(400, 'Type a question first.');
  const profile = await getProfile(user.id);
  if (!profile) throw new HttpError(400, 'Finish setting up your business first.');
  return json(await answer(user.id, profile, q));
});
export const config = { path: '/api/chat', method: 'POST' };
