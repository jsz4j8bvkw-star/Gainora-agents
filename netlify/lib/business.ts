// Gainora admin, the business side: settings, outreach sending, proposals and payment, the price book, client
// health, monthly results, and the books (Stripe invoices, expenses, VAT).
import { randomBytes, randomUUID } from 'node:crypto';
import { db, enc, env, HttpError, insert, upsert } from './core';
import { sendEmail } from './email';
import { stripeGet, stripePost } from './stripe';
import { APP_ORIGIN } from './sites';
import { log, saveRecord, startPackage, type AdminState } from './admin';
import { normEmail } from '../../shared/admin/model';
import { ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import { ratesFrom, type RateCard } from '../../shared/admin/money';
import {
  afterSend, canEmail, DEFAULT_SEQUENCES, emailFooter, fill, type Prospect, type Sequence,
} from '../../shared/admin/sales';
import { DEFAULT_PRICE_BOOK, type Grant, packagesFromGrants, type PriceItem, type ProposalItem } from '../../shared/admin/prices';
import { healthOf, type HealthSignals, type MonthResults } from '../../shared/admin/care';

const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };

/* ---------- Settings ---------- */

export interface AdminSettings {
  rates: RateCard;
  outreach: { autoSend: boolean; dailyLimit: number; myName: string; bookingLink: string };
  care: { resultsEmails: boolean };
}
export async function getSettings(): Promise<AdminSettings> {
  const d = (await safe(db<any[]>('admin_settings?select=data&id=eq.1'), []))[0]?.data ?? {};
  return {
    rates: ratesFrom(d.rates),
    outreach: {
      autoSend: !!d.outreach?.autoSend, dailyLimit: Math.max(1, Math.min(100, Number(d.outreach?.dailyLimit) || 20)),
      myName: String(d.outreach?.myName || 'Adelin').slice(0, 60), bookingLink: String(d.outreach?.bookingLink || 'https://calendar.app.google/2nHffNt7oNxPXnB29').slice(0, 300),
    },
    care: { resultsEmails: !!d.care?.resultsEmails },
  };
}
/** Saves part of the settings, keeping the rest. */
export async function saveSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch, rates: ratesFrom({ ...cur.rates, ...(patch.rates ?? {}) }), outreach: { ...cur.outreach, ...(patch.outreach ?? {}) }, care: { ...cur.care, ...(patch.care ?? {}) } };
  await db('admin_settings?on_conflict=id', { method: 'POST', body: { id: 1, data: next, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
  return getSettings();
}

/** Outreach emails go from their own address (a separate domain keeps hello@gainora.co.uk out of spam folders). */
export const outreachFrom = () => env('OUTREACH_FROM', '');
export const outreachReady = () => !!outreachFrom() && !!env('RESEND_API_KEY', '');

/* ---------- Sequences, prospects, do-not-contact ---------- */

export async function sequences(): Promise<Sequence[]> {
  let rows = await safe(db<Sequence[]>('outreach_sequences?select=id,name,steps,active&order=created_at.asc'), []);
  if (!rows.length) {
    // First time: the messages from Gainora's outreach kit.
    rows = await safe(insert<Sequence>('outreach_sequences', DEFAULT_SEQUENCES.map((s) => ({ ...s, id: randomUUID(), created_at: new Date().toISOString() }))), []);
  }
  return rows;
}
export async function blockedSet(): Promise<Set<string>> {
  return new Set((await safe(db<any[]>('do_not_contact?select=value&limit=20000'), [])).map((r) => String(r.value).toLowerCase()));
}
export async function blockContact(value: string, kind: 'email' | 'domain' | 'phone', reason: string) {
  const v = value.trim().toLowerCase();
  if (!v) return;
  await upsert('do_not_contact', { value: v, kind, reason: reason.slice(0, 200), at: new Date().toISOString() }, 'value');
}

const PROSPECT_FIELDS = ['business_name', 'contact_name', 'role', 'email', 'phone', 'website', 'instagram', 'linkedin', 'town', 'industry', 'source', 'company_type', 'consent', 'consent_note', 'stage', 'lost_reason', 'sequence_id', 'step', 'started_on', 'next_on', 'call_at', 'personal_line', 'note', 'client_email'] as const;
export function cleanProspect(raw: any): Partial<Prospect> {
  const out: Record<string, unknown> = {};
  for (const k of PROSPECT_FIELDS) {
    if (raw?.[k] === undefined) continue;
    const v = raw[k];
    if (k === 'consent') out[k] = !!v;
    else if (k === 'step') out[k] = Math.max(0, Math.min(50, Number(v) || 0));
    else if (k === 'company_type') out[k] = ['limited', 'llp', 'sole_trader', 'partnership', 'unknown'].includes(v) ? v : 'unknown';
    else if (k === 'stage') out[k] = ['new', 'contacted', 'replied', 'call', 'proposal', 'won', 'lost'].includes(v) ? v : 'new';
    else if (k === 'sequence_id') out[k] = v && /^[0-9a-f-]{36}$/i.test(String(v)) ? v : null;
    else if (k === 'started_on' || k === 'next_on') out[k] = v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? v : null;
    else if (k === 'call_at') out[k] = v && !Number.isNaN(Date.parse(String(v))) ? new Date(String(v)).toISOString() : null;
    else if (k === 'email') out[k] = String(v || '').trim().toLowerCase().slice(0, 200);
    else if (k === 'client_email') out[k] = v ? normEmail(String(v)) : null;
    else out[k] = String(v ?? '').slice(0, k === 'note' ? 4000 : 400);
  }
  if (out.business_name !== undefined && !String(out.business_name).trim()) throw new HttpError(400, 'Give the business a name.');
  return out as Partial<Prospect>;
}

/** The person's own words for the next message to a prospect, ready to send or copy. */
export function draftFor(p: Prospect, seq: Sequence | undefined, me: AdminSettings['outreach']) {
  const step = seq?.steps[p.step];
  if (!seq || !step) return null;
  return { step: p.step, channel: step.channel, subject: fill(step.subject, p, { name: me.myName, booking: me.bookingLink }), body: fill(step.body, p, { name: me.myName, booking: me.bookingLink }) };
}

async function ensureToken(p: Prospect): Promise<string> {
  if (p.unsub_token) return p.unsub_token;
  const token = randomBytes(18).toString('base64url');
  await db(`prospects?id=eq.${p.id}`, { method: 'PATCH', body: { unsub_token: token } });
  return token;
}

/** Records a step as done (sent by the admin, sent by hand, or skipped) and moves the prospect on. */
export async function recordStep(p: Prospect, seq: Sequence, how: { status: 'sent' | 'skipped' | 'failed'; by: string; channel: string; subject: string; body: string; providerId?: string; error?: string }) {
  const today = ukToday();
  await insert('outreach_messages', { id: randomUUID(), prospect_id: p.id, sequence_id: seq.id, step: p.step, channel: how.channel, subject: how.subject, body: how.body, status: how.status, sent_at: new Date().toISOString(), by: how.by, provider_id: how.providerId ?? null, error: how.error ?? null });
  if (how.status === 'failed') return;
  const started = p.started_on ?? today;
  const next = afterSend(seq, p.step, started);
  await db(`prospects?id=eq.${p.id}`, { method: 'PATCH', body: { started_on: started, step: next.step, next_on: next.next_on, stage: p.stage === 'new' ? 'contacted' : p.stage, updated_at: new Date().toISOString() } });
}

/** Sends a prospect's next email now, if the rules allow it. */
export async function sendOutreachEmail(p: Prospect, seq: Sequence, by: string, settings?: AdminSettings, bodyOverride?: string): Promise<{ ok: boolean; why?: string }> {
  const s = settings ?? (await getSettings());
  const step = seq.steps[p.step];
  if (!step) return { ok: false, why: 'There’s no next message in this sequence.' };
  if (step.channel !== 'email') return { ok: false, why: 'This step isn’t an email. Copy it and send it yourself.' };
  if (!outreachReady()) return { ok: false, why: 'Outreach email isn’t set up yet (OUTREACH_FROM in Netlify). Copy the message and send it from your own email.' };
  const gate = canEmail(p, await blockedSet());
  if (!gate.ok) return { ok: false, why: gate.why };
  const token = await ensureToken(p);
  const draft = draftFor(p, seq, s.outreach)!;
  // Adelin can edit the message before sending it by hand from Follow-ups.
  const d = { ...draft, body: bodyOverride?.trim() ? bodyOverride.slice(0, 5000) : draft.body };
  const unsub = `${APP_ORIGIN()}/u/${token}`;
  const text = d.body + emailFooter(`${s.outreach.myName}, Gainora · gainora.co.uk`, unsub);
  const html = `<div style="font:15px/1.6 Arial,sans-serif;color:#1A1A1C;max-width:600px">${text.split('\n\n').map((para) => `<p style="margin:0 0 14px">${para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('')}</div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: outreachFrom(), to: [p.email], reply_to: env('OUTREACH_REPLY_TO', 'hello@gainora.co.uk'), subject: d.subject, text, html,
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) {
    await recordStep(p, seq, { status: 'failed', by, channel: 'email', subject: d.subject, body: d.body, error: String(body?.message || 'not sent').slice(0, 300) });
    return { ok: false, why: `The email didn’t send: ${body?.message || 'try again later'}.` };
  }
  await recordStep(p, seq, { status: 'sent', by, channel: 'email', subject: d.subject, body: d.body, providerId: body?.id });
  return { ok: true };
}

/* ---------- The price book ---------- */

export async function priceBook(): Promise<PriceItem[]> {
  const rows = await safe(db<any[]>('price_book?select=*&order=sort.asc'), []);
  if (!rows.length) return DEFAULT_PRICE_BOOK;
  return rows.map((r) => ({ ...r, setup: Number(r.setup), monthly: Number(r.monthly), one_off: Number(r.one_off), grants: r.grants ?? [] }));
}
const GRANTS: Grant[] = ['watcher', 'scout', 'brief', 'capture', 'website'];
export function cleanPriceItem(raw: any): PriceItem {
  const key = String(raw?.key || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  if (key.length < 2) throw new HttpError(400, 'Each price needs a short key, like “command-centre”.');
  const n = (v: unknown) => Math.max(0, Math.min(100_000, Math.round(Number(v || 0) * 100) / 100));
  return {
    key, name: String(raw.name || key).slice(0, 120), description: String(raw.description || '').slice(0, 400),
    setup: n(raw.setup), monthly: n(raw.monthly), one_off: n(raw.one_off), minimum_months: Math.max(0, Math.min(36, Number(raw.minimum_months) || 0)),
    included: String(raw.included || '').slice(0, 60), grants: (Array.isArray(raw.grants) ? raw.grants : []).filter((g: any) => GRANTS.includes(g)),
    stripe_product: raw.stripe_product ? String(raw.stripe_product).slice(0, 60) : null, active: raw.active !== false, sort: Number(raw.sort) || 0,
  };
}
/** Keeps a Stripe product per package, carrying what it switches on in the apps (read by the Stripe webhook). */
export async function syncStripeProduct(p: PriceItem): Promise<string | null> {
  if (!env('STRIPE_SECRET_KEY', '')) return p.stripe_product;
  const form: Record<string, string> = { name: p.name, 'metadata[gainora_key]': p.key, 'metadata[gainora_grants]': p.grants.join(','), active: String(p.active) };
  if (p.description) form.description = p.description;
  try {
    const prod = p.stripe_product ? await stripePost(`products/${p.stripe_product}`, form) : await stripePost('products', form);
    return prod.id;
  } catch (e: any) { console.error('[gainora] stripe product', p.key, e?.message); return p.stripe_product; }
}
export async function savePriceBook(items: PriceItem[]): Promise<PriceItem[]> {
  const out: PriceItem[] = [];
  for (const it of items) out.push({ ...it, stripe_product: await syncStripeProduct(it) });
  await db('price_book?on_conflict=key', { method: 'POST', body: out.map((i) => ({ ...i, updated_at: new Date().toISOString() })), prefer: 'resolution=merge-duplicates' });
  return out;
}
/** Asks Netlify to rebuild gainora.co.uk so it shows the new prices (WEBSITE_BUILD_HOOK). */
export async function rebuildWebsite(): Promise<boolean> {
  const hook = env('WEBSITE_BUILD_HOOK', '');
  if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[A-Za-z0-9]+$/.test(hook)) return false;
  return (await fetch(hook, { method: 'POST', body: '{}' }).catch(() => null))?.ok ?? false;
}

/* ---------- Proposals ---------- */

export interface Proposal {
  id: string; token: string; prospect_id: string | null; email: string; business_name: string; contact_name: string; items: ProposalItem[];
  trial_days: number; note: string; status: 'draft' | 'sent' | 'viewed' | 'paid' | 'cancelled'; expires_on: string | null;
  sent_at: string | null; viewed_at: string | null; paid_at: string | null; stripe_session: string | null; created_by: string; created_at: string;
}
export const proposalUrl = (token: string) => `${APP_ORIGIN()}/p/${token}`;
export async function proposalByToken(token: string): Promise<Proposal | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return (await db<Proposal[]>(`proposals?select=*&token=eq.${token}`))[0] ?? null;
}
export function cleanItems(raw: any): ProposalItem[] {
  const items = (Array.isArray(raw) ? raw : []).slice(0, 8).map((i: any) => {
    const n = (v: unknown) => Math.max(0, Math.min(100_000, Math.round(Number(v || 0) * 100) / 100));
    return { key: String(i.key || 'custom').slice(0, 40), name: String(i.name || 'Gainora').slice(0, 120), setup: n(i.setup), monthly: n(i.monthly), one_off: n(i.one_off), minimum_months: Math.max(0, Math.min(36, Number(i.minimum_months) || 0)), grants: (Array.isArray(i.grants) ? i.grants : []).filter((g: any) => GRANTS.includes(g)), included: String(i.included || '').slice(0, 60) };
  }).filter((i: ProposalItem) => i.setup || i.monthly || i.one_off);
  if (!items.length) throw new HttpError(400, 'Add at least one package with a price.');
  return items;
}

/** A fresh Stripe Checkout page for a proposal (Checkout pages expire after a day, so each click makes a new one). */
export async function checkoutFor(p: Proposal): Promise<string> {
  if (!env('STRIPE_SECRET_KEY', '')) throw new HttpError(503, 'Card payments aren’t switched on yet. Reply to the email and we’ll send an invoice.');
  const book = new Map((await priceBook()).map((b) => [b.key, b]));
  const recurring = p.items.some((i) => i.monthly > 0);
  const f: Record<string, string> = {
    mode: recurring ? 'subscription' : 'payment',
    success_url: `${proposalUrl(p.token)}?paid=1`, cancel_url: proposalUrl(p.token),
    'metadata[proposal]': p.id, allow_promotion_codes: 'true', billing_address_collection: 'auto',
    'custom_text[submit][message]': 'By paying you agree to Gainora’s terms at gainora.co.uk/terms, which include how we process your customers’ data on your behalf.',
  };
  if (p.email) f.customer_email = p.email;
  if (env('STRIPE_TERMS_CONSENT', '') === 'on') f['consent_collection[terms_of_service]'] = 'required';
  if (recurring) { f['subscription_data[metadata][proposal]'] = p.id; if (p.trial_days) f['subscription_data[trial_period_days]'] = String(p.trial_days); }
  let n = 0;
  const line = (name: string, pence: number, grants: Grant[], key: string, monthly: boolean, product?: string | null) => {
    const k = `line_items[${n++}]`;
    f[`${k}[quantity]`] = '1';
    f[`${k}[price_data][currency]`] = 'gbp';
    f[`${k}[price_data][unit_amount]`] = String(Math.round(pence));
    if (monthly) f[`${k}[price_data][recurring][interval]`] = 'month';
    if (product && monthly) f[`${k}[price_data][product]`] = product;
    else {
      f[`${k}[price_data][product_data][name]`] = name;
      f[`${k}[price_data][product_data][metadata][gainora_key]`] = key;
      f[`${k}[price_data][product_data][metadata][gainora_grants]`] = monthly ? grants.join(',') : '';
    }
  };
  for (const i of p.items) {
    if (i.monthly) line(i.name, i.monthly * 100, i.grants, i.key, true, book.get(i.key)?.stripe_product ?? null);
    if (i.setup) line(`${i.name}: set-up`, i.setup * 100, [], `${i.key}-setup`, false);
    if (i.one_off) line(i.name, i.one_off * 100, [], i.key, false);
  }
  const session = await stripePost('checkout/sessions', f);
  await db(`proposals?id=eq.${p.id}`, { method: 'PATCH', body: { stripe_session: session.id } });
  return session.url;
}

/** A paid proposal: the prospect is won, the client gets their record and their set-up starts. Safe to run twice. */
export async function proposalPaid(proposalId: string, session: any): Promise<void> {
  const p = (await db<Proposal[]>(`proposals?select=*&id=eq.${proposalId}`))[0];
  if (!p || p.status === 'paid') return;
  const email = normEmail(session?.customer_details?.email || session?.customer_email || p.email);
  const at = new Date().toISOString();
  await db(`proposals?id=eq.${p.id}`, { method: 'PATCH', body: { status: 'paid', paid_at: at, email } });
  if (p.prospect_id) await db(`prospects?id=eq.${p.prospect_id}`, { method: 'PATCH', body: { stage: 'won', client_email: email, next_on: null, updated_at: at } });
  const setup = p.items.reduce((a, i) => a + i.setup + i.one_off, 0);
  await saveRecord(email, { business_name: p.business_name, contact_name: p.contact_name, status: 'onboarding', setup_fee: setup || null, setup_paid: true });
  await db(`admin_accounts?email=eq.${enc(email)}`, { method: 'PATCH', body: { terms_accepted_at: at, dpa_accepted_at: at } });
  const start = ukToday();
  for (const pkg of packagesFromGrants(p.items.flatMap((i) => i.grants))) await startPackage(email, pkg, start, 'Gainora');
  await log(email, 'Gainora', `Paid proposal: ${p.items.map((i) => i.name).join(', ')}. Terms accepted at checkout.`, 'system');
  const team = env('GAINORA_ADMIN_EMAILS', 'hello@gainora.co.uk').split(',')[0].trim();
  await sendEmail(team, `${p.business_name} just paid`, [`${p.business_name} paid their proposal (${p.items.map((i) => i.name).join(', ')}).`, 'Their set-up checklist has started in the admin.'], { label: 'Open Gainora admin', url: 'https://admin.gainora.co.uk/' }).catch(() => {});
}

/* ---------- Stripe money ---------- */

let invoiceCache: { at: number; rows: any[] } | null = null;
/** Paid invoices over the last 13 months (for profit by month and the VAT threshold). Empty without Stripe. */
export async function paidInvoices(): Promise<{ at: string; amount: number; email: string }[]> {
  if (!env('STRIPE_SECRET_KEY', '')) return [];
  if (invoiceCache && Date.now() - invoiceCache.at < 300_000) return invoiceCache.rows;
  const since = Math.floor((Date.now() - 400 * 86_400_000) / 1000);
  const rows: any[] = [];
  let after = '';
  try {
    for (let page = 0; page < 20; page++) {
      const res = await stripeGet(`invoices?status=paid&limit=100&created[gte]=${since}${after ? `&starting_after=${after}` : ''}`);
      for (const inv of res.data ?? []) rows.push({ at: new Date(((inv.status_transitions?.paid_at ?? inv.created) as number) * 1000).toISOString(), amount: Number(inv.amount_paid || 0) / 100, email: normEmail(inv.customer_email || '') });
      if (!res.has_more || !res.data?.length) break;
      after = res.data[res.data.length - 1].id;
    }
  } catch (e: any) { console.error('[gainora] stripe invoices', e?.message); }
  invoiceCache = { at: Date.now(), rows };
  return rows;
}
/** Invoices Stripe couldn't take payment for. */
export async function unpaidInvoices(): Promise<{ id: string; email: string; amount: number; due: string | null; attempts: number; link: string | null }[]> {
  if (!env('STRIPE_SECRET_KEY', '')) return [];
  try {
    const res = await stripeGet('invoices?status=open&limit=100');
    return (res.data ?? []).filter((i: any) => i.attempt_count > 0 || (i.due_date && i.due_date * 1000 < Date.now())).map((i: any) => ({
      id: i.id, email: normEmail(i.customer_email || ''), amount: Number(i.amount_due || 0) / 100, due: i.due_date ? new Date(i.due_date * 1000).toISOString().slice(0, 10) : null, attempts: i.attempt_count ?? 0, link: i.hosted_invoice_url ?? null,
    }));
  } catch (e: any) { console.error('[gainora] stripe open invoices', e?.message); return []; }
}

/* ---------- Client health and monthly results ---------- */

async function lastSignIns(): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` } }).catch(() => null);
    const d = r?.ok ? await r.json().catch(() => null) : null;
    const users = d?.users ?? [];
    for (const u of users) out.set(u.id, u.last_sign_in_at ?? null);
    if (users.length < 1000) break;
  }
  return out;
}

export async function healthAll(s: AdminState, now = new Date()) {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const ids = [...s.userIdByEmail.values()];
  const sites = [...s.sitesByEmail.values()];
  const [signIns, enq, visits] = await Promise.all([
    safe(lastSignIns(), new Map()),
    ids.length ? safe(db<any[]>(`enquiries?select=user_id&created_at=gte.${since}&user_id=in.(${ids.join(',')})&limit=20000`), []) : [],
    sites.length ? safe(db<any[]>(`site_events?select=site_id,visitor,at&kind=eq.view&at=gte.${since}&site_id=in.(${sites.map((x) => x.id).join(',')})&limit=50000`), []) : [],
  ]);
  return s.accounts.map((a) => {
    const uid = a.userId;
    const site = s.sitesByEmail.get(a.email);
    const oldest = s.requests.filter((r) => r.email === a.email).map((r) => Math.floor((now.getTime() - Date.parse(r.at)) / 86_400_000)).sort((x, y) => y - x)[0] ?? null;
    const signals: HealthSignals = {
      lastSignIn: uid ? signIns.get(uid) ?? null : null,
      startedOn: s.records.get(a.email)?.started_on ?? null,
      enquiries14: a.packages.includes('capture') ? enq.filter((e) => e.user_id === uid).length : null,
      visits14: site?.published ? new Set(visits.filter((v) => v.site_id === site.id).map((v) => `${String(v.at).slice(0, 10)}|${v.visitor}`)).size : null,
      oldestRequestDays: oldest,
    };
    return { email: a.email, name: a.name, packages: a.packages, monthly: a.monthly, renewsOn: a.renewsOn, ...healthOf(a, signals, now), lastSignIn: signals.lastSignIn };
  });
}

/** What happened for one client in a month, for the results email. */
export async function monthResults(userId: string | null, siteId: string | null, month: string, has: { capture: boolean; command: boolean }): Promise<MonthResults> {
  const end = (() => { const d = new Date(`${month}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
  const r: MonthResults = { month, capture: null, website: null, command: null };
  if (userId && has.capture) {
    const rows = await safe(db<any[]>(`enquiries?select=channel,status,after_hours&user_id=eq.${userId}&created_at=gte.${month}&created_at=lt.${end}&limit=20000`), []);
    const real = rows.filter((e) => e.status !== 'spam');
    r.capture = { enquiries: real.length, calls: real.filter((e) => e.channel === 'call').length, afterHours: real.filter((e) => e.after_hours).length, booked: real.filter((e) => e.status === 'booked' || e.status === 'won').length };
  }
  if (siteId) {
    const ev = await safe(db<any[]>(`site_events?select=kind,visitor,at&site_id=eq.${siteId}&at=gte.${month}&at=lt.${end}&limit=100000`), []);
    r.website = { visitors: new Set(ev.filter((e) => e.kind === 'view').map((e) => `${String(e.at).slice(0, 10)}|${e.visitor}`)).size, contacts: ev.filter((e) => e.kind !== 'view').length };
  }
  if (userId && has.command) {
    const [briefs, leads] = await Promise.all([
      safe(db<any[]>(`briefs?select=id&user_id=eq.${userId}&created_at=gte.${month}&created_at=lt.${end}`), []),
      safe(db<any[]>(`leads?select=id&user_id=eq.${userId}&created_at=gte.${month}&created_at=lt.${end}&limit=5000`), []),
    ]);
    r.command = { briefs: briefs.length, leads: leads.length };
  }
  return r;
}
export const lastMonth = (today = ukToday()) => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
export { addDays };
