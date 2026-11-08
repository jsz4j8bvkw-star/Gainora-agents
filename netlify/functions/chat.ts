import { body, callInternal, getProfile, handler, HttpError, json, requireAgent } from '../lib/core';
import { answer, saveQuestion } from '../lib/agents';

// Ask. The question is saved first, then the answer is written in the background (chat-background,
// which has minutes rather than the 10 seconds a synchronous function gets) and saved as the next
// message. The app polls the conversation for it. If the background hand-off is not possible,
// the answer is written here instead, so Ask works in every setup.
export default handler(async (req) => {
  const user = await requireAgent(req, null);
  const { text } = await body<{ text: string }>(req);
  const q = String(text || '').trim();
  if (!q) throw new HttpError(400, 'Type a question first.');
  const profile = await getProfile(user.id);
  if (!profile) throw new HttpError(400, 'Finish setting up your business first.');
  const question = await saveQuestion(user.id, q);
  const queued = await callInternal('chat-background', { userId: user.id, questionId: question.id });
  if (queued) return json({ queued: true, question }, 202);
  const reply = await answer(user.id, profile, question);
  return json({ queued: false, question, reply });
});
export const config = { path: '/api/chat', method: 'POST' };
