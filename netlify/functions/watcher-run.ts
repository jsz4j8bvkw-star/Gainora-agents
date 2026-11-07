import { callInternal, db, handler, json, requireAgent } from '../lib/core';

// Starts a fresh Watcher check in the background. Limited to one manual check every 10 minutes.
export default handler(async (req) => {
  const user = await requireAgent(req, 'watcher');
  const rows = await db<any[]>(`watcher_state?select=updated_at&user_id=eq.${user.id}`);
  const last = rows[0]?.updated_at ? new Date(rows[0].updated_at).getTime() : 0;
  if (Date.now() - last < 10 * 60_000) return json({ started: false, message: 'Your site was checked in the last 10 minutes.' });
  await callInternal('watcher-background', { userId: user.id, manual: true });
  return json({ started: true }, 202);
});
export const config = { path: '/api/watcher-run', method: 'POST' };
