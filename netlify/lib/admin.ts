// Gainora admin on the server: who's on the team, every client in one list, what's done, what's due, what each
// client brings in and costs. Shared by /api/admin (the admin app), /api/mcp (the Claude connector) and the
// morning email.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, enc, HttpError, insert, userFromRequest, type AuthedUser } from './core';
import { stripeGet } from './stripe';
import { isGainora, siteFor, type SiteRow } from './sites';
import {
  type AccountRecord, type AccountSummary, type AdminTask, billingOf, type LogEntry, normEmail, type Package, packagesOf,
} from '../../shared/admin/model';
import { type AutoCheck, launchPlanId, tasksFor, withAuto } from '../../shared/admin/templates';
import { progress, ukToday } from '../../shared/admin/board';
import { monthCosts, monthlyFromSubscription, monthStart, ratesFrom, type RateCard, type Usage } from '../../shared/admin/money';

/** Signed in and on Gainora's team (GAINORA_ADMIN_EMAILS). Everyone else gets nothing back. */
export async function requireGainora(req: Request): Promise<AuthedUser> {
  const user = await userFromRequest(req);
  if (!isGainora(user)) throw new HttpError(403, 'This is Gainora’s admin. Sign in with a Gainora team email.');
  return user;
}

const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };

/* ---------- Stripe: what each client pays ---------- */

let stripeCache: { at: number; byCustomer: Map<string, { monthly: number; status: string; renewsOn: string | null }> } | null = null;
/** Monthly revenue per Stripe customer, from their subscriptions. Cached for five minutes. Empty without Stripe. */
export async function stripeRevenue(): Promise<Map<string, { monthly: number; status: string; renewsOn: string | null }>> {
  if (stripeCache && Date.now() - stripeCache.at < 300_000) return stripeCache.byCustomer;
  const byCustomer = new Map<string, { monthly: number; status: string; renewsOn: string | null }>();
  if (!process.env.STRIPE_SECRET_KEY) return byCustomer;
  try {
    let after = '';
    for (let page = 0; page < 10; page++) {
      const res = await stripeGet(`subscriptions?status=all&limit=100${after ? `&starting_after=${after}` : ''}`);
      for (const sub of res.data ?? []) {
        const c = String(sub.customer?.id ?? sub.customer ?? '');
        const prev = byCustomer.get(c) ?? { monthly: 0, status: 'canceled', renewsOn: null };
        const live = ['active', 'trialing', 'past_due'].includes(sub.status);
        byCustomer.set(c, {
          monthly: Math.round((prev.monthly + monthlyFromSubscription(sub)) * 100) / 100,
          status: live ? sub.status : prev.status,
          renewsOn: live && sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString().slice(0, 10) : prev.renewsOn,
        });
      }
      if (!res.has_more || !res.data?.length) break;
      after = res.data[res.data.length - 1].id;
    }
    stripeCache = { at: Date.now(), byCustomer };
  } catch (e: any) { console.error('[gainora] admin stripe', e?.message); }
  return byCustomer;
}

/* ---------- Everything about every client ---------- */

export interface AdminState {
  accounts: AccountSummary[];
  records: Map<string, AccountRecord>;
  tasks: (AdminTask & { client: string })[];
  requests: { id: string; at: string; page: string; text: string; email: string; client: string; slug: string }[];
  sitesByEmail: Map<string, SiteRow>;
  userIdByEmail: Map<string, string>;
}

/** What the apps can tell us is done, per user: used to tick off checklist steps automatically. */
async function autoChecks(userIds: string[], sites: SiteRow[]): Promise<Map<string, Set<AutoCheck>>> {
  const out = new Map<string, Set<AutoCheck>>();
  const add = (u: string | null | undefined, c: AutoCheck) => { if (!u) return; if (!out.has(u)) out.set(u, new Set()); out.get(u)!.add(c); };
  for (const s of sites) {
    if (s.published) add(s.user_id, 'site-live');
    if (s.published && s.domain) add(s.user_id, 'site-domain');
    if (s.data?.reviewLink) add(s.user_id, 'site-reviewlink');
    if (s.data?.look?.hero || s.data?.look?.about) add(s.user_id, 'site-photo');
  }
  if (!userIds.length) return out;
  const ids = `in.(${userIds.join(',')})`;
  const [profiles, watcher, briefs, capture, sources, calls] = await Promise.all([
    safe(db<any[]>(`profiles?select=user_id,completed_at&user_id=${ids}`), []),
    safe(db<any[]>(`watcher_state?select=user_id&user_id=${ids}`), []),
    safe(db<any[]>(`briefs?select=user_id&user_id=${ids}&limit=2000`), []),
    safe(db<any[]>(`capture_settings?select=user_id,completed_at&user_id=${ids}`), []),
    safe(db<any[]>(`enquiry_sources?select=user_id&channel=eq.call&active=eq.true&user_id=${ids}`), []),
    safe(db<any[]>(`enquiries?select=user_id&channel=eq.call&user_id=${ids}&limit=5000`), []),
  ]);
  for (const r of profiles) if (r.completed_at) add(r.user_id, 'cc-profile');
  for (const r of watcher) add(r.user_id, 'cc-watcher');
  for (const r of briefs) add(r.user_id, 'cc-brief');
  for (const r of capture) if (r.completed_at) add(r.user_id, 'cap-settings');
  for (const r of sources) add(r.user_id, 'cap-source');
  for (const r of calls) add(r.user_id, 'cap-call');
  return out;
}

export async function loadState(): Promise<AdminState> {
  const [ents, records, tasksRaw, sites, reqs, profiles] = await Promise.all([
    db<any[]>('entitlements?select=email,user_id,agent,status,stripe_customer,current_period_end&limit=5000'),
    safe(db<AccountRecord[]>('admin_accounts?select=*&limit=5000'), []),
    safe(db<AdminTask[]>('admin_tasks?select=*&order=due_on.asc.nullslast&limit=10000'), []),
    safe(db<SiteRow[]>('sites?select=id,user_id,slug,domain,data,published,published_at,updated_at&limit=5000'), []),
    safe(db<any[]>('site_requests?select=id,site_id,at,page,text&status=eq.open&order=at.asc&limit=1000'), []),
    safe(db<any[]>('profiles?select=user_id,data&limit=5000'), []),
  ]);
  const revenue = await stripeRevenue();
  const recordMap = new Map(records.map((r) => [normEmail(r.email), r]));
  const byEmail = new Map<string, any[]>();
  for (const e of ents) { const k = normEmail(e.email); if (!byEmail.has(k)) byEmail.set(k, []); byEmail.get(k)!.push(e); }
  for (const k of recordMap.keys()) if (!byEmail.has(k)) byEmail.set(k, []);
  const userIdByEmail = new Map<string, string>();
  for (const [k, rows] of byEmail) { const u = rows.find((r) => r.user_id)?.user_id; if (u) userIdByEmail.set(k, u); }
  const emailByUser = new Map([...userIdByEmail].map(([e, u]) => [u, e]));
  const sitesByEmail = new Map<string, SiteRow>();
  for (const s of sites) { const e = emailByUser.get(s.user_id); if (e) sitesByEmail.set(e, s); }
  const profileName = new Map(profiles.map((p) => [p.user_id, String(p.data?.business?.name || '')]));
  const checks = await autoChecks([...userIdByEmail.values()], sites);

  const nameOf = (email: string) => recordMap.get(email)?.business_name || profileName.get(userIdByEmail.get(email) ?? '') || sitesByEmail.get(email)?.data?.business?.name || email;
  const today = ukToday();
  const tasks = tasksRaw.map((t) => {
    const email = normEmail(t.email);
    const uid = userIdByEmail.get(email);
    const [done] = withAuto([t], checks.get(uid ?? '') ?? new Set(), sitesByEmail.get(email)?.data?.plan ?? {});
    return { ...done, email, client: nameOf(email) };
  });
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const requests = reqs.map((r) => {
    const s = siteById.get(r.site_id);
    const email = s ? emailByUser.get(s.user_id) ?? '' : '';
    return { id: r.id, at: r.at, page: r.page, text: r.text, email, client: email ? nameOf(email) : (s?.data?.business?.name ?? ''), slug: s?.slug ?? '' };
  });

  const accounts: AccountSummary[] = [...byEmail.entries()].map(([email, rows]) => {
    const rec = recordMap.get(email);
    const mine = tasks.filter((t) => t.email === email);
    const open = mine.filter((t) => t.status !== 'done');
    const next = open.filter((t) => t.due_on).sort((a, b) => a.due_on!.localeCompare(b.due_on!))[0];
    const customers = [...new Set(rows.map((r) => r.stripe_customer).filter(Boolean))];
    const money = customers.map((c) => revenue.get(c)).filter(Boolean) as { monthly: number; status: string; renewsOn: string | null }[];
    const site = sitesByEmail.get(email);
    const live = rows.filter((r) => ['active', 'trialing', 'past_due'].includes(r.status));
    return {
      email, userId: userIdByEmail.get(email) ?? null, name: nameOf(email), contact: rec?.contact_name ?? '', phone: rec?.phone ?? '',
      packages: packagesOf(live.map((r) => r.agent)),
      status: rec?.status ?? (live.length ? 'onboarding' : 'left'),
      billing: billingOf(rows.map((r) => r.status)),
      monthly: money.length ? Math.round(money.reduce((a, m) => a + m.monthly, 0) * 100) / 100 : null,
      renewsOn: money.map((m) => m.renewsOn).filter(Boolean).sort()[0] ?? (rows.map((r) => r.current_period_end).filter(Boolean).sort()[0]?.slice(0, 10) ?? null),
      startedOn: rec?.started_on ?? null,
      setupStarted: mine.length > 0,
      progress: progress(mine),
      overdue: open.filter((t) => t.due_on && t.due_on < today).length,
      nextDue: next ? { title: next.title, due_on: next.due_on! } : null,
      openRequests: requests.filter((r) => r.email === email).length,
      site: site ? { slug: site.slug, live: !!site.published, domain: site.domain } : null,
    };
  }).sort((a, b) => b.overdue - a.overdue || Number(b.status !== 'left') - Number(a.status !== 'left') || a.name.localeCompare(b.name));
  return { accounts, records: recordMap, tasks, requests, sitesByEmail, userIdByEmail };
}

/** Finds a client by email, website address or (unique) business name, as people and Claude refer to them. */
export function findAccount(state: AdminState, ref: string): AccountSummary {
  const q = String(ref || '').trim().toLowerCase();
  if (!q) throw new HttpError(400, 'Say which client.');
  const exact = state.accounts.find((a) => a.email === q || a.site?.slug === q || a.name.toLowerCase() === q);
  if (exact) return exact;
  const hits = state.accounts.filter((a) => a.name.toLowerCase().includes(q) || a.email.includes(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new HttpError(404, `No client matches “${ref}”.`);
  throw new HttpError(409, `More than one client matches “${ref}”: ${hits.slice(0, 6).map((h) => h.name).join(', ')}.`);
}

/* ---------- Writing ---------- */

export async function saveRecord(email: string, patch: Partial<AccountRecord>): Promise<AccountRecord> {
  const e = normEmail(email);
  const clean: Record<string, unknown> = { email: e, updated_at: new Date().toISOString() };
  if (patch.business_name !== undefined) clean.business_name = String(patch.business_name).slice(0, 120);
  if (patch.contact_name !== undefined) clean.contact_name = String(patch.contact_name).slice(0, 120);
  if (patch.phone !== undefined) clean.phone = String(patch.phone).slice(0, 40);
  if (patch.status !== undefined && ['onboarding', 'active', 'paused', 'left'].includes(patch.status)) clean.status = patch.status;
  if (patch.started_on !== undefined) clean.started_on = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.started_on)) ? patch.started_on : null;
  if (patch.setup_fee !== undefined) clean.setup_fee = patch.setup_fee == null || (patch.setup_fee as any) === '' ? null : Math.max(0, Math.min(100_000, Number(patch.setup_fee) || 0));
  if (patch.setup_paid !== undefined) clean.setup_paid = !!patch.setup_paid;
  if (patch.notes !== undefined) clean.notes = String(patch.notes).slice(0, 8000);
  const [row] = await db<AccountRecord[]>('admin_accounts?on_conflict=email', { method: 'POST', body: clean, prefer: 'resolution=merge-duplicates,return=representation' });
  return row;
}

export async function log(email: string, author: string, text: string, kind: LogEntry['kind'] = 'note') {
  await safe(insert('admin_log', { id: randomUUID(), email: normEmail(email), at: new Date().toISOString(), author: author.slice(0, 80), kind, text: text.slice(0, 4000) }), null);
}

/** Creates a package's set-up checklist (skipping steps already there) and marks the client as being set up. */
export async function startPackage(email: string, pkg: Package, start: string, by: string): Promise<number> {
  const e = normEmail(email);
  const rows = tasksFor(pkg, e, start, by).map((t) => ({ ...t, id: randomUUID(), created_at: new Date().toISOString() }));
  const made = await db<any[]>('admin_tasks?on_conflict=email,template_key', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=representation' });
  const rec = (await safe(db<AccountRecord[]>(`admin_accounts?select=started_on&email=eq.${enc(e)}`), []))[0];
  await saveRecord(e, { ...(rec?.started_on ? {} : { started_on: start }), ...(rec ? {} : { status: 'onboarding' as const }) });
  await log(e, by, `Started ${pkg === 'launch' ? 'Launch & Grow' : pkg === 'capture' ? 'Capture & Convert' : 'Command Centre'} set-up (${made?.length ?? rows.length} steps).`, 'system');
  return made?.length ?? rows.length;
}

const TASK_FIELDS = ['title', 'detail', 'who', 'due_on', 'status', 'project'] as const;
export async function saveTask(input: Partial<AdminTask> & { email?: string }, by: string, state?: AdminState): Promise<AdminTask> {
  const patch: Record<string, unknown> = {};
  for (const k of TASK_FIELDS) if ((input as any)[k] !== undefined) patch[k] = (input as any)[k];
  if (patch.title !== undefined) { patch.title = String(patch.title).trim().slice(0, 300); if (!patch.title) throw new HttpError(400, 'Give the task a title.'); }
  if (patch.detail !== undefined) patch.detail = String(patch.detail).slice(0, 2000);
  if (patch.who !== undefined && !['gainora', 'client', 'claude'].includes(String(patch.who))) throw new HttpError(400, 'Who is Gainora, client or Claude.');
  if (patch.status !== undefined && !['todo', 'doing', 'waiting', 'done'].includes(String(patch.status))) throw new HttpError(400, 'Unknown status.');
  if (patch.project !== undefined && !['launch', 'capture', 'command', 'other'].includes(String(patch.project))) patch.project = 'other';
  if (patch.due_on !== undefined) patch.due_on = patch.due_on && /^\d{4}-\d{2}-\d{2}$/.test(String(patch.due_on)) ? patch.due_on : null;
  if (patch.status !== undefined) patch.done_at = patch.status === 'done' ? new Date().toISOString() : null;

  let task: AdminTask;
  if (input.id) {
    if (!/^[0-9a-f-]{36}$/i.test(input.id)) throw new HttpError(400, 'Unknown task.');
    [task] = await db<AdminTask[]>(`admin_tasks?id=eq.${input.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    if (!task) throw new HttpError(404, 'That task no longer exists.');
  } else {
    if (!input.email) throw new HttpError(400, 'Say which client the task is for.');
    if (!patch.title) throw new HttpError(400, 'Give the task a title.');
    [task] = await insert<AdminTask>('admin_tasks', { id: randomUUID(), email: normEmail(input.email), template_key: null, created_by: by, created_at: new Date().toISOString(), sort: 999, status: 'todo', who: 'gainora', project: 'other', detail: '', ...patch });
  }
  // A Launch & Grow step done here is also ticked on the client's own launch plan, and the other way round.
  const planId = launchPlanId(task.template_key);
  if (planId && patch.status !== undefined) {
    const uid = state?.userIdByEmail.get(normEmail(task.email)) ?? (await safe(db<any[]>(`entitlements?select=user_id&email=eq.${enc(normEmail(task.email))}&user_id=not.is.null&limit=1`), []))[0]?.user_id;
    const site = uid ? await siteFor(uid) : null;
    if (site) await db(`sites?id=eq.${site.id}`, { method: 'PATCH', body: { data: { ...site.data, plan: { ...(site.data?.plan ?? {}), [planId]: patch.status === 'done' } } } });
  }
  if (patch.status === 'done') await log(task.email, by, `Done: ${task.title}`, 'work');
  return task;
}

/* ---------- Costs ---------- */

export async function rateCard(): Promise<RateCard> {
  const row = (await safe(db<any[]>('admin_settings?select=data&id=eq.1'), []))[0];
  return ratesFrom(row?.data?.rates);
}

/** A client's usage in the month starting `month` (YYYY-MM-01). */
export async function usageFor(userId: string | null, month: string, site: SiteRow | undefined, active: boolean): Promise<Usage> {
  const end = (() => { const d = new Date(`${month}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
  if (!userId) return { aiUsd: 0, calls: 0, texts: 0, emails: 0, hasNumber: false, siteLive: !!site?.published, active };
  const range = `created_at=gte.${month}&created_at=lt.${end}`;
  const [ai, calls, msgs, number] = await Promise.all([
    safe(db<any[]>(`ai_usage?select=cost_usd&user_id=eq.${userId}&${range}&limit=20000`), []),
    safe(db<any[]>(`enquiries?select=id&user_id=eq.${userId}&channel=eq.call&${range}&limit=20000`), []),
    safe(db<any[]>(`messages?select=channel&user_id=eq.${userId}&direction=eq.out&${range}&limit=20000`), []),
    safe(db<any[]>(`enquiry_sources?select=id&user_id=eq.${userId}&channel=eq.call&active=eq.true&limit=1`), []),
  ]);
  return {
    aiUsd: ai.reduce((a, r) => a + Number(r.cost_usd || 0), 0),
    calls: calls.length, texts: msgs.filter((m) => m.channel === 'text').length, emails: msgs.filter((m) => m.channel === 'email').length,
    hasNumber: number.length > 0, siteLive: !!site?.published, active,
  };
}

export async function costsFor(acc: AccountSummary, month: string, state: AdminState, rates?: RateCard) {
  const r = rates ?? (await rateCard());
  const usage = await usageFor(acc.userId, month, state.sitesByEmail.get(acc.email), acc.packages.length > 0);
  const manual = await safe(db<any[]>(`admin_costs?select=id,item,amount,month&email=eq.${enc(acc.email)}&month=eq.${month}`), []);
  const c = monthCosts(usage, r, manual.map((m) => ({ item: m.item, amount: Number(m.amount) })));
  return { month, usage, manual, ...c, revenue: acc.monthly, margin: acc.monthly == null ? null : Math.round((acc.monthly - c.total) * 100) / 100 };
}

export const thisMonth = () => monthStart();

/* ---------- The Claude connector's links ---------- */

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');
export async function createKey(label: string): Promise<{ id: string; key: string }> {
  const key = randomBytes(24).toString('base64url');
  const id = randomUUID();
  await insert('admin_keys', { id, label: label.slice(0, 60) || 'Claude', key_hash: hashKey(key), created_at: new Date().toISOString() });
  return { id, key };
}
export async function checkKey(key: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(key)) return false;
  const row = (await safe(db<any[]>(`admin_keys?select=id,revoked_at,last_used_at&key_hash=eq.${hashKey(key)}`), []))[0];
  if (!row || row.revoked_at) return false;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 600_000) await safe(db(`admin_keys?id=eq.${row.id}`, { method: 'PATCH', body: { last_used_at: new Date().toISOString() } }), null);
  return true;
}
