import { addValue, body, db, enc, handler, HttpError, json, requireAgent, upsert } from '../lib/core';

// The owner ticks a speed fix as done (or un-ticks it). Counted in their results as a fix.
export default handler(async (req) => {
  const user = await requireAgent(req, 'watcher');
  const { title, done } = await body<{ title: string; done: boolean }>(req);
  const [row] = await db<any[]>(`watcher_state?select=state&user_id=eq.${user.id}`);
  const speed = row?.state?.speed;
  const fix = speed?.fixes?.find((f: any) => f.title === title);
  if (!fix) throw new HttpError(404, 'That fix is no longer on your list.');
  if (!!fix.done === !!done) return json({ ok: true });

  const state = { ...row.state, speed: { ...speed, fixes: speed.fixes.map((f: any) => (f.title === title ? { ...f, done: !!done } : f)) } };
  await upsert('watcher_state', { user_id: user.id, state }, 'user_id');
  const label = `Fixed: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  if (done) await addValue(user.id, 'you', 'issue_fixed', label);
  else await db(`value_events?user_id=eq.${user.id}&kind=eq.issue_fixed&title=eq.${enc(label)}`, { method: 'DELETE' });
  return json({ ok: true });
});
export const config = { path: '/api/fix-done', method: 'POST' };
