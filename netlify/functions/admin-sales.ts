import { randomBytes, randomUUID } from 'node:crypto';
import { body, db, handler, HttpError, insert, json } from '../lib/core';
import { requireGainora } from '../lib/admin';
import {
  blockContact, blockedSet, cleanItems, cleanProspect, draftFor, getSettings, outreachReady, priceBook, proposalUrl, recordStep,
  saveSettings, sendOutreachEmail, sequences, type Proposal,
} from '../lib/business';
import { sendEmail } from '../lib/email';
import { ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import { canEmail, dueFollowUps, funnel, type Prospect, prospectsFromCsv, sameProspect, type Sequence } from '../../shared/admin/sales';
import { proposalTotals, money } from '../../shared/admin/prices';

// Gainora admin → Sales. Gainora's team only.
//   POST /api/admin-sales {op: overview | prospect | prospect-save | prospect-delete | import | start | send | mark-sent |
//     skip | replied | do-not-contact | sequences-save | outreach-settings | proposal-save | proposal-send | proposal-cancel}
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());
const id = (v: unknown) => { const s = String(v || ''); if (!/^[0-9a-f-]{36}$/i.test(s)) throw new HttpError(400, 'Unknown record.'); return s; };

async function prospect(pid: string): Promise<Prospect> {
  const p = (await db<Prospect[]>(`prospects?select=*&id=eq.${id(pid)}`))[0];
  if (!p) throw new HttpError(404, 'That prospect no longer exists.');
  return p;
}

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const me = await requireGainora(req);
  const by = who(me.email);
  const b = await body<any>(req);
  const today = ukToday();

  if (b.op === 'overview') {
    const [list, seqs, messages, proposals, settings, blocked] = await Promise.all([
      db<Prospect[]>('prospects?select=*&order=updated_at.desc&limit=5000'), sequences(),
      db<any[]>(`outreach_messages?select=prospect_id,sent_at,status,channel&sent_at=gte.${addDays(today, -60)}&limit=20000`),
      db<Proposal[]>('proposals?select=*&order=created_at.desc&limit=500'), getSettings(), blockedSet(),
    ]);
    const bySeq = new Map(seqs.map((s) => [s.id, s]));
    const due = dueFollowUps(list, today).map((p) => ({ ...p, draft: draftFor(p, bySeq.get(p.sequence_id ?? ''), settings.outreach), email_ok: canEmail(p, blocked) }));
    return json({
      today, prospects: list, sequences: seqs, due, proposals: proposals.map((x) => ({ ...x, url: proposalUrl(x.token) })), funnel: funnel(list, messages, today),
      calls: list.filter((p) => p.call_at && p.call_at.slice(0, 10) >= today).sort((x, y) => x.call_at!.localeCompare(y.call_at!)),
      outreach: { ...settings.outreach, ready: outreachReady() },
    });
  }

  if (b.op === 'prospect') {
    const p = await prospect(b.id);
    const [msgs, seqs, settings, blocked, proposals] = await Promise.all([
      db<any[]>(`outreach_messages?select=*&prospect_id=eq.${p.id}&order=sent_at.desc`), sequences(), getSettings(), blockedSet(),
      db<Proposal[]>(`proposals?select=*&prospect_id=eq.${p.id}&order=created_at.desc`),
    ]);
    return json({ prospect: p, messages: msgs, draft: draftFor(p, seqs.find((s) => s.id === p.sequence_id), settings.outreach), email_ok: canEmail(p, blocked), proposals: proposals.map((x) => ({ ...x, url: proposalUrl(x.token) })) });
  }

  if (b.op === 'prospect-save') {
    const patch = cleanProspect(b.prospect ?? {});
    if (b.prospect?.id) {
      const [p] = await db<Prospect[]>(`prospects?id=eq.${id(b.prospect.id)}`, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
      return json({ prospect: p });
    }
    if (!patch.business_name) throw new HttpError(400, 'Give the business a name.');
    const existing = await db<Prospect[]>('prospects?select=id,business_name,email,website,phone&limit=5000');
    const dup = existing.find((x) => sameProspect(patch, x));
    if (dup) throw new HttpError(409, `${dup.business_name} is already on your list.`);
    const [p] = await insert<Prospect>('prospects', { id: randomUUID(), stage: 'new', step: 0, ...patch, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return json({ prospect: p });
  }

  if (b.op === 'prospect-delete') { await db(`prospects?id=eq.${id(b.id)}`, { method: 'DELETE' }); return json({ ok: true }); }

  if (b.op === 'import') {
    const { rows, skipped } = prospectsFromCsv(String(b.csv || '').slice(0, 2_000_000));
    const existing = await db<Prospect[]>('prospects?select=id,business_name,email,website,phone&limit=20000');
    const blocked = await blockedSet();
    const fresh: any[] = []; let dupes = 0; let blockedCount = 0;
    for (const r of rows) {
      if ([...existing, ...fresh].some((x) => sameProspect(r, x))) { dupes++; continue; }
      if (r.email && (blocked.has(r.email) || blocked.has(r.email.split('@')[1]))) { blockedCount++; continue; }
      fresh.push({ id: randomUUID(), stage: 'new', step: 0, ...cleanProspect({ ...r, source: r.source || String(b.source || 'Imported list') }), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    for (let i = 0; i < fresh.length; i += 500) await insert('prospects', fresh.slice(i, i + 500));
    return json({ added: fresh.length, duplicates: dupes, skipped, blocked: blockedCount });
  }

  if (b.op === 'start') {
    // Put prospects on a sequence: the first message is due on the start date.
    const seq = (await sequences()).find((s) => s.id === id(b.sequence_id));
    if (!seq) throw new HttpError(404, 'Unknown sequence.');
    const ids: string[] = (Array.isArray(b.ids) ? b.ids : [b.ids]).map(id).slice(0, 500);
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start)) ? String(b.start) : today;
    await db(`prospects?id=in.(${ids.join(',')})`, { method: 'PATCH', body: { sequence_id: seq.id, step: 0, started_on: null, next_on: start, updated_at: new Date().toISOString() } });
    return json({ started: ids.length });
  }

  if (b.op === 'send') {
    const p = await prospect(b.id);
    const seq = (await sequences()).find((s) => s.id === p.sequence_id);
    if (!seq) throw new HttpError(400, 'Put them on a sequence first.');
    const r = await sendOutreachEmail(p, seq, by, undefined, typeof b.body === 'string' ? b.body : undefined);
    if (!r.ok) throw new HttpError(400, r.why ?? 'Not sent.');
    return json({ ok: true });
  }

  if (b.op === 'mark-sent' || b.op === 'skip') {
    const p = await prospect(b.id);
    const seq = (await sequences()).find((s) => s.id === p.sequence_id);
    if (!seq) throw new HttpError(400, 'Put them on a sequence first.');
    const d = draftFor(p, seq, (await getSettings()).outreach);
    if (!d) throw new HttpError(400, 'There’s no next message in this sequence.');
    await recordStep(p, seq, { status: b.op === 'skip' ? 'skipped' : 'sent', by, channel: d.channel, subject: d.subject, body: String(b.body ?? d.body).slice(0, 5000) });
    return json({ ok: true });
  }

  if (b.op === 'replied') {
    const p = await prospect(b.id);
    await db(`prospects?id=eq.${p.id}`, { method: 'PATCH', body: { stage: 'replied', next_on: null, updated_at: new Date().toISOString(), note: b.note ? `${p.note}\n${today}: ${String(b.note).slice(0, 1000)}`.trim() : p.note } });
    return json({ ok: true });
  }

  if (b.op === 'do-not-contact') {
    const p = await prospect(b.id);
    if (p.email) await blockContact(p.email, 'email', 'Asked not to be contacted');
    if (p.phone) await blockContact(p.phone.replace(/\D/g, ''), 'phone', 'Asked not to be contacted');
    await db(`prospects?id=eq.${p.id}`, { method: 'PATCH', body: { unsubscribed_at: new Date().toISOString(), stage: 'lost', lost_reason: 'Asked not to be contacted', next_on: null } });
    return json({ ok: true });
  }

  if (b.op === 'sequences-save') {
    const list: Sequence[] = (Array.isArray(b.sequences) ? b.sequences : []).slice(0, 30);
    for (const s of list) {
      const steps = (Array.isArray(s.steps) ? s.steps : []).slice(0, 10).map((x: any) => ({ day: Math.max(0, Math.min(90, Number(x.day) || 0)), channel: ['email', 'linkedin', 'instagram', 'facebook', 'whatsapp', 'text', 'call'].includes(x.channel) ? x.channel : 'email', subject: String(x.subject || '').slice(0, 200), body: String(x.body || '').slice(0, 5000) }));
      const row = { name: String(s.name || 'Sequence').slice(0, 120), steps, active: s.active !== false };
      if (s.id && /^[0-9a-f-]{36}$/i.test(s.id)) await db(`outreach_sequences?id=eq.${s.id}`, { method: 'PATCH', body: row });
      else await insert('outreach_sequences', { id: randomUUID(), ...row, created_at: new Date().toISOString() });
    }
    return json({ sequences: await sequences() });
  }

  if (b.op === 'outreach-settings') {
    const o = b.outreach ?? {};
    const s = await saveSettings({ outreach: { autoSend: !!o.autoSend, dailyLimit: Number(o.dailyLimit) || 20, myName: String(o.myName || 'Adelin'), bookingLink: String(o.bookingLink || '') } as any });
    return json({ outreach: { ...s.outreach, ready: outreachReady() } });
  }

  if (b.op === 'proposal-save') {
    const x = b.proposal ?? {};
    const items = cleanItems(x.items);
    const row = {
      email: String(x.email || '').trim().toLowerCase().slice(0, 200), business_name: String(x.business_name || '').slice(0, 160), contact_name: String(x.contact_name || '').slice(0, 120),
      items, trial_days: Math.max(0, Math.min(90, Number(x.trial_days) || 0)), note: String(x.note || '').slice(0, 2000),
      expires_on: /^\d{4}-\d{2}-\d{2}$/.test(String(x.expires_on)) ? x.expires_on : addDays(today, 14),
      prospect_id: x.prospect_id && /^[0-9a-f-]{36}$/i.test(x.prospect_id) ? x.prospect_id : null,
    };
    if (!row.business_name) throw new HttpError(400, 'Who is the proposal for?');
    if (x.id) {
      const cur = (await db<Proposal[]>(`proposals?select=status&id=eq.${id(x.id)}`))[0];
      if (cur?.status === 'paid') throw new HttpError(409, 'This proposal is already paid.');
      const [p] = await db<Proposal[]>(`proposals?id=eq.${x.id}`, { method: 'PATCH', body: row, prefer: 'return=representation' });
      return json({ proposal: { ...p, url: proposalUrl(p.token) } });
    }
    const [p] = await insert<Proposal>('proposals', { id: randomUUID(), token: randomBytes(18).toString('base64url'), status: 'draft', created_by: by, created_at: new Date().toISOString(), ...row });
    return json({ proposal: { ...p, url: proposalUrl(p.token) } });
  }

  if (b.op === 'proposal-send') {
    const p = (await db<Proposal[]>(`proposals?select=*&id=eq.${id(b.id)}`))[0];
    if (!p) throw new HttpError(404, 'Unknown proposal.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new HttpError(400, 'Add their email address to the proposal first.');
    const t = proposalTotals(p.items);
    await sendEmail(p.email, `Your Gainora proposal${p.business_name ? ` for ${p.business_name}` : ''}`, [
      `Hi ${(p.contact_name || '').split(' ')[0] || 'there'},`,
      String(b.message || 'Thank you for your time on our call. Here’s the proposal we talked about, with everything included and the prices.').slice(0, 1500),
      `${p.items.map((i) => i.name).join(' and ')}: ${t.today ? `${money(t.today)} to start` : ''}${t.today && t.monthly ? ', then ' : ''}${t.monthly ? `${money(t.monthly)} a month` : ''} (prices exclude VAT).`,
      `You can read it and start whenever you’re ready. The link works until ${new Date(`${p.expires_on}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`,
      'Any questions, just reply.',
      (await getSettings()).outreach.myName,
    ], { label: 'Read the proposal', url: proposalUrl(p.token) });
    await db(`proposals?id=eq.${p.id}`, { method: 'PATCH', body: { status: p.status === 'draft' ? 'sent' : p.status, sent_at: new Date().toISOString() } });
    if (p.prospect_id) await db(`prospects?id=eq.${p.prospect_id}`, { method: 'PATCH', body: { stage: 'proposal', next_on: addDays(today, 3), updated_at: new Date().toISOString() } });
    return json({ ok: true });
  }
  if (b.op === 'proposal-cancel') { await db(`proposals?id=eq.${id(b.id)}&status=neq.paid`, { method: 'PATCH', body: { status: 'cancelled' } }); return json({ ok: true }); }
  if (b.op === 'prices') return json({ prices: await priceBook() });
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/admin-sales', method: 'POST' };
