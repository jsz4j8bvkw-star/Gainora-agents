import { body, db, getProfile, handler, HttpError, json, requireAgent } from '../lib/core';
import { draftReviewReply } from '../lib/agents';

// Drafts a public reply to one of the owner's Google reviews. The owner posts it themselves.
export default handler(async (req) => {
  const user = await requireAgent(req, 'watcher');
  const { reviewId } = await body<{ reviewId: string }>(req);
  const [row] = await db<any[]>(`watcher_state?select=state&user_id=eq.${user.id}`);
  const review = (row?.state?.reviews?.reviews || []).find((r: any) => r.id === reviewId);
  if (!review) throw new HttpError(404, 'That review is no longer on your listing.');
  const profile = await getProfile(user.id);
  return json({ text: await draftReviewReply(user.id, profile, review) });
});
export const config = { path: '/api/review-reply', method: 'POST' };
