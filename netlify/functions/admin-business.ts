import { randomUUID } from 'node:crypto';
import { body, db, enc, handler, HttpError, insert, json } from '../lib/core';
import { findAccount, loadState, log, requireGainora } from '../lib/admin';
import {
  cleanPriceItem, getSettings, healthAll, lastMonth, monthResults, paidInvoices, priceBook, rebuildWebsite, savePriceBook, saveSettings, unpaidInvoices,
} from '../lib/business';
import { ownerEmail } from '../lib/sites';
import { sendEmail } from '../lib/email';
import { ukToday } from '../../shared/admin/board';
import { monthStart } from '../../shared/admin/money';
import { normEmail } from '../../shared/admin/model';
import { resultsEmail } from '../../shared/admin/care';
import { type Deadline, dueSoon, type Expense, expensesIn, nextOccurrence, SUGGESTED_DEADLINES, sum, VAT_THRESHOLD, vatStatus } from '../../shared/admin/books';
import { toWebsitePrices } from '../../shared/admin/prices';
import { addDays } from '../../shared/admin/templates';

// Gainora admin → Prices, Health, Money and Paperwork. Gainora's team only.
//   POST /api/admin-business {op: today | prices | prices-save | health | results | results-send | care-settings |
//     books | expense-save | expense-delete | paperwork | deadline-save | deadline-done | deadline-delete | agreement-save}
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());
const id = (v: unknown) => { const s = String(v || ''); if (!/^[0-9a-f-]{36}$/i.test(s)) throw new HttpError(400, 'Unknown record.'); return s; };
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const me = await requireGainora(req);
  const by = who(me.email);
  const b = await body<any>(req);
  const today = ukToday();

  /* What Today shows from sales and the business: follow-ups, calls, proposals waiting, failed payments, deadlines. */
  if (b.op === 'today') {
    const [prospects, proposals, deadlines, unpaid] = await Promise.all([
      db<any[]>('prospects?select=id,business_name,contact_name,stage,next_on,call_at,unsubscribed_at&limit=5000').catch(() => []),
      db<any[]>('proposals?select=id,business_name,status,sent_at,viewed_at&status=in.(sent,viewed)&limit=500').catch(() => []),
      db<Deadline[]>('business_deadlines?select=*&done_at=is.null&limit=500').catch(() => []),
      unpaidInvoices(),
    ]);
    const due = prospects.filter((p) => p.next_on && p.next_on <= today && (p.stage === 'new' || p.stage === 'contacted') && !p.unsubscribed_at);
    return json({
      followUps: due.length,
      calls: prospects.filter((p) => p.call_at && p.call_at.slice(0, 10) >= today && p.call_at.slice(0, 10) <= addDays(today, 7)).sort((x, y) => x.call_at.localeCompare(y.call_at)),
      proposals: proposals.map((p) => ({ ...p, waitingDays: Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(p.viewed_at || p.sent_at)) / 86_400_000) })),
      unpaid, deadlines: dueSoon(deadlines, today, 14),
    });
  }

  /* Prices */
  if (b.op === 'prices') return json({ prices: await priceBook(), website: !!process.env.WEBSITE_BUILD_HOOK, stripe: !!process.env.STRIPE_SECRET_KEY });
  if (b.op === 'prices-save') {
    const items = (Array.isArray(b.prices) ? b.prices : []).slice(0, 60).map(cleanPriceItem);
    if (new Set(items.map((i: any) => i.key)).size !== items.length) throw new HttpError(400, 'Two prices have the same key.');
    const saved = await savePriceBook(items);
    const rebuilt = b.publish ? await rebuildWebsite() : false;
    return json({ prices: saved, rebuilt, website: toWebsitePrices(saved) });
  }

  /* Client health and monthly results */
  if (b.op === 'health') {
    const s = await loadState();
    return json({ clients: await healthAll(s), settings: (await getSettings()).care });
  }
  if (b.op === 'results' || b.op === 'results-send') {
    const s = await loadState();
    const acc = findAccount(s, b.email);
    const month = isDate(b.month) ? `${String(b.month).slice(0, 7)}-01` : lastMonth(today);
    const site = s.sitesByEmail.get(acc.email);
    const r = await monthResults(acc.userId, site?.published ? site.id : null, month, { capture: acc.packages.includes('capture'), command: acc.packages.includes('command') });
    const first = (s.records.get(acc.email)?.contact_name || '').split(' ')[0] || acc.name;
    const mail = resultsEmail(first, r);
    if (b.op === 'results') return json({ results: r, email: mail });
    if (!mail) throw new HttpError(400, 'There’s nothing to report for that month yet.');
    const to = (acc.userId && (await ownerEmail(acc.userId))) || acc.email;
    await sendEmail(to, mail.subject, mail.paragraphs);
    await log(acc.email, by, `Sent the ${mail.subject.replace('Your ', '').replace(' with Gainora', '')} results email.`, 'email');
    return json({ ok: true });
  }
  if (b.op === 'care-settings') return json({ care: (await saveSettings({ care: { resultsEmails: !!b.resultsEmails } })).care });

  /* Money */
  if (b.op === 'books') {
    const month = isDate(b.month) ? `${String(b.month).slice(0, 7)}-01` : monthStart();
    const [expenses, invoices, unpaid, s] = await Promise.all([
      db<Expense[]>('business_expenses?select=*&order=starts_on.desc&limit=2000').catch(() => []),
      paidInvoices(), unpaidInvoices(), loadState(),
    ]);
    const exp = expenses.map((e) => ({ ...e, amount: Number(e.amount) }));
    const monthExp = expensesIn(month, exp);
    const inMonth = invoices.filter((i) => i.at.slice(0, 7) === month.slice(0, 7));
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const rolling = Math.round(invoices.filter((i) => i.at >= yearAgo).reduce((a, i) => a + i.amount, 0) * 100) / 100;
    const subs = Math.round(s.accounts.filter((a) => a.status !== 'left').reduce((a, x) => a + (x.monthly ?? 0), 0) * 100) / 100;
    const revenue = invoices.length ? Math.round(inMonth.reduce((a, i) => a + i.amount, 0) * 100) / 100 : subs;
    const names = new Map(s.accounts.map((a) => [a.email, a.name]));
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${monthStart()}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 10); }).reverse()
      .map((m) => { const rev = invoices.filter((i) => i.at.slice(0, 7) === m.slice(0, 7)).reduce((a, i) => a + i.amount, 0); const out = sum(expensesIn(m, exp)); return { month: m, revenue: Math.round(rev * 100) / 100, expenses: out, profit: Math.round((rev - out) * 100) / 100 }; });
    return json({
      month, stripe: !!process.env.STRIPE_SECRET_KEY, revenueFrom: invoices.length ? 'invoices' : 'subscriptions',
      revenue, expenses: monthExp, expenseTotal: sum(monthExp), profit: Math.round((revenue - sum(monthExp)) * 100) / 100,
      all: exp, months, unpaid: unpaid.map((u) => ({ ...u, client: names.get(u.email) ?? u.email })),
      vat: { rolling, threshold: VAT_THRESHOLD, ...vatStatus(rolling) },
    });
  }
  if (b.op === 'expense-save') {
    const e = b.expense ?? {};
    const row = { supplier: String(e.supplier || '').trim().slice(0, 120), category: String(e.category || 'Other').slice(0, 60), amount: Math.max(0, Math.round(Number(e.amount || 0) * 100) / 100), recurring: !!e.recurring, starts_on: isDate(e.starts_on) ? e.starts_on : today, ends_on: isDate(e.ends_on) ? e.ends_on : null, note: String(e.note || '').slice(0, 400) };
    if (!row.supplier) throw new HttpError(400, 'Who is it paid to?');
    if (e.id) await db(`business_expenses?id=eq.${id(e.id)}`, { method: 'PATCH', body: row });
    else await insert('business_expenses', { id: randomUUID(), ...row, created_at: new Date().toISOString() });
    return json({ ok: true });
  }
  if (b.op === 'expense-delete') { await db(`business_expenses?id=eq.${id(b.id)}`, { method: 'DELETE' }); return json({ ok: true }); }

  /* Paperwork */
  if (b.op === 'paperwork') {
    const [deadlines, s] = await Promise.all([db<Deadline[]>('business_deadlines?select=*&order=due_on.asc&limit=500').catch(() => []), loadState()]);
    const recs = await db<any[]>('admin_accounts?select=email,terms_accepted_at,dpa_accepted_at').catch(() => []);
    const agreed = new Map(recs.map((r) => [normEmail(r.email), r]));
    return json({
      today, deadlines, soon: dueSoon(deadlines, today, 30), suggestions: SUGGESTED_DEADLINES.map((x) => ({ ...x, when: x.when ? x.when(Number(today.slice(0, 4)) + (x.when(Number(today.slice(0, 4))) < today ? 1 : 0)) : null })),
      agreements: s.accounts.filter((a) => a.packages.length && a.status !== 'left').map((a) => ({ email: a.email, name: a.name, terms: agreed.get(a.email)?.terms_accepted_at ?? null, dpa: agreed.get(a.email)?.dpa_accepted_at ?? null })),
    });
  }
  if (b.op === 'deadline-save') {
    const d = b.deadline ?? {};
    const row = { title: String(d.title || '').trim().slice(0, 160), category: String(d.category || 'Other').slice(0, 60), due_on: isDate(d.due_on) ? d.due_on : null, repeat: ['none', 'monthly', 'quarterly', 'yearly'].includes(d.repeat) ? d.repeat : 'none', note: String(d.note || '').slice(0, 600) };
    if (!row.title || !row.due_on) throw new HttpError(400, 'Give it a name and a date.');
    if (d.id) await db(`business_deadlines?id=eq.${id(d.id)}`, { method: 'PATCH', body: row });
    else await insert('business_deadlines', { id: randomUUID(), ...row, created_at: new Date().toISOString() });
    return json({ ok: true });
  }
  if (b.op === 'deadline-done') {
    const d = (await db<Deadline[]>(`business_deadlines?select=*&id=eq.${id(b.id)}`))[0];
    if (!d) throw new HttpError(404, 'Unknown deadline.');
    const next = nextOccurrence(d.due_on, d.repeat);
    // A repeating date moves to its next time; a one-off is marked done.
    await db(`business_deadlines?id=eq.${d.id}`, { method: 'PATCH', body: next ? { due_on: next, done_at: null } : { done_at: new Date().toISOString() } });
    return json({ next });
  }
  if (b.op === 'deadline-delete') { await db(`business_deadlines?id=eq.${id(b.id)}`, { method: 'DELETE' }); return json({ ok: true }); }
  if (b.op === 'agreement-save') {
    const email = normEmail(b.email);
    const at = (v: unknown) => (v === null ? null : isDate(v) ? `${v}T12:00:00Z` : undefined);
    const patch: Record<string, unknown> = {};
    if (at(b.terms) !== undefined) patch.terms_accepted_at = at(b.terms);
    if (at(b.dpa) !== undefined) patch.dpa_accepted_at = at(b.dpa);
    await db('admin_accounts?on_conflict=email', { method: 'POST', body: { email, ...patch, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
    await log(email, by, `Paperwork updated: ${patch.terms_accepted_at ? 'terms accepted' : ''}${patch.terms_accepted_at && patch.dpa_accepted_at ? ' and ' : ''}${patch.dpa_accepted_at ? 'data processing terms accepted' : ''}`.trim(), 'system');
    return json({ ok: true });
  }
  void enc;
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/admin-business', method: 'POST' };
