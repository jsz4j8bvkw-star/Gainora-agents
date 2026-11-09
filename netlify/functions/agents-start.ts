import { activeAgents, addActions, addNote, callInternal, db, getProfile, handler, insert, json, userFromRequest } from '../lib/core';
import { dbKindFor, encodeFocus, scoutMode } from '../../shared/scout';

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
    const mode = scoutMode(profile);
    const wholesale = /wholesale|b2b/i.test(profile.goals?.focus || '') || (profile.offer?.salesChannels || []).includes('Wholesale');
    const town = String(profile.business?.location || '').split(',')[0].trim();
    const what = String(profile.offer?.bestSeller || profile.offer?.products || 'what we offer').split(/[,.]/)[0].trim().toLowerCase();
    // A clinic's customers are people: the first search looks for people asking for exactly this nearby. Businesses that sell to businesses get the original search.
    const focus = mode === 'consumer' ? 'demand' as const : 'customers' as const;
    const query = mode === 'consumer' ? `People asking for ${what} recommendations near ${town || 'us'}` : wholesale ? 'Independent shops that could stock our products' : `Businesses near ${town || 'us'} that could refer customers to us`;
    const [row] = await insert('scout_searches', { user_id: user.id, query: encodeFocus(query, focus), area: profile.customers?.areas?.includes('Local') || mode === 'consumer' ? (town || 'United Kingdom') : 'United Kingdom', status: 'running', kind: dbKindFor(focus) });
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
