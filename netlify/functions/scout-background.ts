import { db, getProfile, requireInternal } from '../lib/core';
import { runScout } from '../lib/agents';

export default async (req: Request) => {
  try {
    requireInternal(req);
    const { id } = await req.json();
    const [search] = await db<any[]>(`scout_searches?select=*&id=eq.${id}`);
    if (search && search.status === 'running') {
      const profile = await getProfile(search.user_id);
      if (profile) await runScout(search, profile);
    }
  } catch (e: any) { console.error('[gainora] scout-background', e?.message); }
  return new Response(null, { status: 202 });
};
