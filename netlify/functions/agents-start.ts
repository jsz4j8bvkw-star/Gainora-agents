import { activeAgents, addActions, addNote, callInternal, db, getProfile, handler, insert, json, userFromRequest } from '../lib/core';

// Runs once after onboarding: first Watcher check, a first Scout search and contract match, and a welcome note for The Brief.
export default handler(async (req) => {
  const user = await userFromRequest(req);
  const profile = await getProfile(user.id);
  if (!profile) return json({ ok: false });
  const agents = await activeAgents(user);
  const already = await db<any[]>(`agent_notes?select=id&user_id=eq.${user.id}&limit=1`);
  if (already.length) return json({ ok: true, alreadyStarted: true });

  if (agents.includes('watcher')) await callInternal('watcher-background', { userId: user.id, quiet: false });
  if (agents.includes('scout')) {
    const wholesale = /wholesale|b2b/i.test(profile.goals?.focus || '') || (profile.offer?.salesChannels || []).includes('Wholesale');
    const town = String(profile.business?.location || '').split(',')[0].trim();
    const query = wholesale ? 'Independent shops that could stock our products' : `Businesses near ${town || 'us'} that could refer customers to us`;
    const [row] = await insert('scout_searches', { user_id: user.id, query, area: profile.customers?.areas?.includes('Local') ? (town || 'United Kingdom') : 'United Kingdom', status: 'running', kind: 'customers' });
    await callInternal('scout-background', { id: row.id });
    await callInternal('tenders-background', { userId: user.id }); // first public contracts that fit
  }
  if (agents.includes('brief')) {
    await addNote(user.id, 'brief', `Add this week’s numbers on ${profile.preferences?.reportDay || 'Monday'} and I’ll turn them into three priorities linked to your goal: ${profile.goals?.target}.`);
    await addActions(user.id, 'brief', ['Add this week’s numbers to The Brief']);
  }
  return json({ ok: true }, 202);
});
export const config = { path: '/api/agents-start', method: 'POST' };
