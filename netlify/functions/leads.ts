import { addValue, body, db, enc, getProfile, handler, HttpError, json, requireAgent } from '../lib/core';
import { draftFollowUp, draftIntro } from '../lib/agents';
import { followUpSent, moveLead, STAGES, type LeadStage } from '../../shared/leads';

// The Scout's lead pipeline. Ops: add (from a research result), update (stage, deal value, follow-up sent),
// draft (the next follow-up email) and intro (a first introduction). Gainora never sends anything itself.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id));

async function getLead(userId: string, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, 'That lead no longer exists.');
  const [row] = await db<any[]>(`leads?select=*&id=eq.${id}&user_id=eq.${userId}`);
  if (!row) throw new HttpError(404, 'That lead no longer exists.');
  return row;
}

const toLead = (r: any) => ({ stage: r.stage as LeadStage, contactedAt: r.contacted_at as string | null, followUps: Number(r.follow_ups ?? 0), nextFollowUp: r.next_follow_up_at as string | null });

export default handler(async (req) => {
  const user = await requireAgent(req, 'scout');
  const b = await body<any>(req);

  if (b.op === 'add') {
    if (!UUID.test(String(b.searchId))) throw new HttpError(404, 'That search no longer exists.');
    const [s] = await db<any[]>(`scout_searches?select=id,results&id=eq.${b.searchId}&user_id=eq.${user.id}`);
    const r = s?.results?.find((x: any) => x.id === b.resultId);
    if (!r) throw new HttpError(404, 'That lead no longer exists.');
    const name = String(r.name).slice(0, 120);
    const inserted = await db<any[]>('leads?on_conflict=user_id,name', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: { user_id: user.id, name, location: r.location || '', website: r.website || '', reason: r.reason || '', source: r.source ?? null, search_id: s.id, result_id: r.id, stage: 'to_contact' },
    });
    const lead = inserted?.[0] ?? (await db<any[]>(`leads?select=*&user_id=eq.${user.id}&name=eq.${enc(name)}`))[0];
    if (!r.saved) {
      const results = s.results.map((x: any) => (x.id === r.id ? { ...x, saved: true } : x));
      await db(`scout_searches?id=eq.${s.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: { results } });
    }
    return json(lead);
  }

  if (b.op === 'update') {
    const row = await getLead(user.id, String(b.id || ''));
    const was = row.stage as LeadStage;
    let lead = toLead(row);
    const patch: Record<string, unknown> = {};
    if (b.stage !== undefined && b.stage !== was) {
      if (!STAGE_IDS.has(b.stage)) throw new HttpError(400, 'That stage is not valid.');
      lead = moveLead(lead, b.stage as LeadStage);
      patch.last_reminded_at = null;
    }
    if (b.followUpSent) {
      if (lead.stage !== 'contacted') throw new HttpError(400, 'Follow-ups are for leads waiting for a reply.');
      lead = followUpSent(lead);
      patch.last_reminded_at = null;
    }
    let value: number | null | undefined;
    if (b.value !== undefined) {
      if (b.value === null) value = null;
      else {
        const n = Number(b.value);
        if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, 'Enter the deal value in pounds.');
        value = Math.round(n * 100) / 100;
      }
      patch.value_gbp = value;
    }
    Object.assign(patch, { stage: lead.stage, contacted_at: lead.contactedAt ?? null, follow_ups: lead.followUps, next_follow_up_at: lead.nextFollowUp ?? null, updated_at: new Date().toISOString() });
    const [saved] = await db<any[]>(`leads?id=eq.${row.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });

    // Results: first contact, and wins with the value the owner entered.
    if (lead.stage === 'contacted' && !row.contacted_at) await addValue(user.id, 'you', 'lead_contacted', `You contacted ${row.name}`, null, row.id);
    if (lead.stage === 'won') {
      const amount = value !== undefined ? value : row.value_gbp != null ? Number(row.value_gbp) : null;
      const [ev] = await db<any[]>(`value_events?select=id&user_id=eq.${user.id}&kind=eq.lead_won&ref=eq.${row.id}`);
      if (!ev) await addValue(user.id, 'you', 'lead_won', `Won: ${row.name}`, amount, row.id);
      else if (value !== undefined) await db(`value_events?id=eq.${ev.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: { amount: value && value > 0 ? value : null } });
    } else if (was === 'won') {
      await db(`value_events?user_id=eq.${user.id}&kind=eq.lead_won&ref=eq.${row.id}`, { method: 'DELETE' });
    }
    return json(saved);
  }

  if (b.op === 'draft' || b.op === 'intro') {
    const row = await getLead(user.id, String(b.id || ''));
    const profile = await getProfile(user.id);
    if (!profile) throw new HttpError(400, 'Finish setting up your business first.');
    const text = b.op === 'intro'
      ? await draftIntro(user.id, profile, { name: row.name, location: row.location, website: row.website, reason: row.reason })
      : await draftFollowUp(user.id, profile, row);
    return json({ text });
  }
  throw new HttpError(400, 'Unknown request.');
});
export const config = { path: '/api/leads', method: 'POST' };
