import { db, getProfile, requireInternal } from '../lib/core';
import { answer } from '../lib/agents';

// Background function (up to 15 minutes): writes the answer to one saved question and stores it
// as the next agent message. The app finds it by polling the conversation. If the question
// already has an answer (a retry after a network blip), nothing is written twice.
export default async (req: Request) => {
  try {
    requireInternal(req);
    const { userId, questionId } = await req.json();
    if (!userId || !questionId) return new Response(null, { status: 202 });
    const [question] = await db<any[]>(`chat_messages?select=id,text,created_at,role&id=eq.${encodeURIComponent(questionId)}&user_id=eq.${encodeURIComponent(userId)}`);
    if (!question || question.role !== 'user') return new Response(null, { status: 202 });
    const later = await db<any[]>(`chat_messages?select=id&user_id=eq.${encodeURIComponent(userId)}&role=eq.agent&created_at=gt.${encodeURIComponent(question.created_at)}&limit=1`);
    if (later.length) return new Response(null, { status: 202 });
    const profile = await getProfile(userId);
    if (profile) await answer(userId, profile, question);
  } catch (e: any) { console.error('[gainora] chat-background', e?.message); }
  return new Response(null, { status: 202 });
};
