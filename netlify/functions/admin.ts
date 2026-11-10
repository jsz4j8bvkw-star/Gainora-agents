import { saveSettings } from '../lib/business';
import { randomUUID } from 'node:crypto';
import { body, db, enc, handler, HttpError, insert, json } from '../lib/core';
import {
  costsFor, createKey, findAccount, loadState, log, rateCard, requireGainora, saveRecord, saveTask, startPackage, thisMonth,
} from '../lib/admin';
import { gainoraEmails } from '../lib/sites';
import { board, ukToday } from '../../shared/admin/board';
import { DEFAULT_RATES, monthStart, ratesFrom } from '../../shared/admin/money';
import { normEmail, PACKAGES, type Package } from '../../shared/admin/model';
import { withDefaults } from '../../shared/site/data';
import { checks } from '../../shared/site/kit';

// Gainora's admin (admin.gainora.co.uk). Gainora's team only.
//   POST /api/admin {op: overview | account | account-save | start | task-save | task-delete | log-add |
//                        cost-add | cost-delete | money | settings | settings-save | keys | key-create | key-revoke}
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const me = await requireGainora(req);
  const by = who(me.email);
  const b = await body<any>(req);

  if (b.op === 'overview') {
    const s = await loadState();
    const today = ukToday();
    const open = s.tasks.filter((t) => t.status !== 'done');
    const live = s.accounts.filter((a) => a.status !== 'left' && a.packages.length);
    return json({
      today, me: me.email, accounts: s.accounts, tasks: open, board: board(open, today), requests: s.requests,
      totals: {
        clients: live.length,
        monthly: Math.round(live.reduce((a, x) => a + (x.monthly ?? 0), 0) * 100) / 100,
        overdue: open.filter((t) => t.due_on && t.due_on < today).length,
        notStarted: live.filter((a) => !a.setupStarted).length,
        unpaidSetup: [...s.records.values()].filter((r) => r.setup_fee && !r.setup_paid && r.status !== 'left').reduce((a, r) => a + Number(r.setup_fee), 0),
      },
    });
  }

  if (b.op === 'account') {
    const s = await loadState();
    const acc = findAccount(s, b.email);
    const site = s.sitesByEmail.get(acc.email);
    const uid = acc.userId;
    const [logRows, capture, enquiries, siteEnquiries] = await Promise.all([
      db<any[]>(`admin_log?select=*&email=eq.${enc(acc.email)}&order=at.desc&limit=100`).catch(() => []),
      uid ? db<any[]>(`capture_settings?select=data,completed_at&user_id=eq.${uid}`).catch(() => []) : [],
      uid ? db<any[]>(`enquiries?select=id,created_at,channel,name,status,summary,kind,urgency&user_id=eq.${uid}&order=created_at.desc&limit=25`).catch(() => []) : [],
      site ? db<any[]>(`site_enquiries?select=id,at,name,service,source&site_id=eq.${site.id}&order=at.desc&limit=25`).catch(() => []) : [],
    ]);
    const rates = await rateCard();
    const now = thisMonth();
    const last = (() => { const d = new Date(`${now}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
    const [costNow, costLast] = await Promise.all([costsFor(acc, now, s, rates), costsFor(acc, last, s, rates)]);
    const cs = capture[0];
    return json({
      account: acc, record: s.records.get(acc.email) ?? null,
      tasks: s.tasks.filter((t) => t.email === acc.email),
      log: logRows,
      site: site ? { slug: site.slug, domain: site.domain, live: !!site.published, publishedAt: site.published_at, fixes: checks(withDefaults(site.data)).filter((c) => c.level === 'fix').length } : null,
      capture: cs ? { completed: !!cs.completed_at, business: cs.data?.business?.name ?? '', type: cs.data?.business?.type ?? '', booking: cs.data?.bookings?.system ?? '' } : null,
      enquiries: enquiries.map((e) => ({ ...e, summary: String(e.summary || '').slice(0, 240) })),
      siteEnquiries,
      requests: s.requests.filter((r) => r.email === acc.email),
      costs: [costNow, costLast],
    });
  }

  if (b.op === 'account-save') {
    const email = normEmail(b.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter the email the client subscribed with.');
    const rec = await saveRecord(email, b.patch ?? {});
    if (b.patch?.status) await log(email, by, `Status changed to ${b.patch.status}.`, 'system');
    return json({ record: rec });
  }

  if (b.op === 'start') {
    const pkg = String(b.package) as Package;
    if (!(pkg in PACKAGES)) throw new HttpError(400, 'Unknown package.');
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start)) ? String(b.start) : ukToday();
    const made = await startPackage(b.email, pkg, start, by);
    return json({ made });
  }

  if (b.op === 'task-save') return json({ task: await saveTask(b.task ?? {}, by) });
  if (b.op === 'task-delete') {
    if (!/^[0-9a-f-]{36}$/i.test(String(b.id))) throw new HttpError(400, 'Unknown task.');
    await db(`admin_tasks?id=eq.${b.id}`, { method: 'DELETE' });
    return json({ ok: true });
  }

  if (b.op === 'log-add') {
    const text = String(b.text || '').trim();
    if (!text) throw new HttpError(400, 'Write the note first.');
    await log(b.email, by, text, ['note', 'call', 'email', 'work'].includes(b.kind) ? b.kind : 'note');
    return json({ ok: true });
  }

  if (b.op === 'cost-add') {
    const amount = Number(b.amount);
    const item = String(b.item || '').trim().slice(0, 120);
    if (!item || !Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'Enter what the cost is for and how much.');
    const month = /^\d{4}-\d{2}/.test(String(b.month)) ? `${String(b.month).slice(0, 7)}-01` : thisMonth();
    const [row] = await insert<any>('admin_costs', { id: randomUUID(), email: normEmail(b.email), month, item, amount: Math.round(amount * 100) / 100, created_at: new Date().toISOString() });
    return json({ cost: row });
  }
  if (b.op === 'cost-delete') {
    if (!/^[0-9a-f-]{36}$/i.test(String(b.id))) throw new HttpError(400, 'Unknown cost.');
    await db(`admin_costs?id=eq.${b.id}`, { method: 'DELETE' });
    return json({ ok: true });
  }

  if (b.op === 'money') {
    const s = await loadState();
    const month = /^\d{4}-\d{2}/.test(String(b.month)) ? `${String(b.month).slice(0, 7)}-01` : monthStart();
    const rates = await rateCard();
    const rows = await Promise.all(s.accounts.filter((a) => a.packages.length || a.monthly).map(async (a) => {
      const c = await costsFor(a, month, s, rates);
      return { email: a.email, name: a.name, packages: a.packages, revenue: a.monthly, costs: c.total, margin: c.margin, lines: c.lines };
    }));
    const revenue = rows.reduce((x, r) => x + (r.revenue ?? 0), 0);
    const costs = rows.reduce((x, r) => x + r.costs, 0);
    return json({ month, rows: rows.sort((a, b2) => (a.margin ?? 0) - (b2.margin ?? 0)), totals: { revenue: Math.round(revenue * 100) / 100, costs: Math.round(costs * 100) / 100, margin: Math.round((revenue - costs) * 100) / 100 } });
  }

  if (b.op === 'settings') return json({ rates: await rateCard(), defaults: DEFAULT_RATES, team: gainoraEmails() });
  if (b.op === 'settings-save') {
    const rates = (await saveSettings({ rates: ratesFrom(b.rates) })).rates;
    return json({ rates });
  }

  if (b.op === 'keys') return json({ keys: await db<any[]>('admin_keys?select=id,label,created_at,last_used_at,revoked_at&order=created_at.desc') });
  if (b.op === 'key-create') {
    const { id, key } = await createKey(String(b.label || 'Claude'));
    const origin = new URL(req.url).origin.replace('://admin.', '://app.');
    return json({ id, url: `${origin}/api/mcp/${key}` });
  }
  if (b.op === 'key-revoke') {
    if (!/^[0-9a-f-]{36}$/i.test(String(b.id))) throw new HttpError(400, 'Unknown link.');
    await db(`admin_keys?id=eq.${b.id}`, { method: 'PATCH', body: { revoked_at: new Date().toISOString() } });
    return json({ ok: true });
  }
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/admin', method: 'POST' };
