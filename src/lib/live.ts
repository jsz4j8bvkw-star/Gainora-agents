import type { Api } from './api';
import type { EnquiryRecord, MessageRecord, Plan, Source, User } from './types';
import { withDefaults } from '../../shared/capture';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

const URL_ = typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '';
const ANON = typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : '';
const SESSION_KEY = 'gainora.session.v1';

interface Session { access_token: string; refresh_token: string; expires_at: number; user: User }

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function writeSession(s: Session | null) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

async function authFetch(path: string, body: unknown) {
  const res = await fetch(`${URL_}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.msg || data.error_description || 'Sign-in failed. Try again.', res.status);
  return data;
}

/** Picks up the tokens Supabase puts in the URL after a magic-link click. */
async function consumeRedirect(): Promise<Session | null> {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const access = h.get('access_token'); const refresh = h.get('refresh_token');
  if (!access || !refresh) return null;
  history.replaceState(null, '', location.pathname);
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${access}` } });
  if (!res.ok) return null;
  const u = await res.json();
  const s: Session = { access_token: access, refresh_token: refresh, expires_at: Date.now() + Number(h.get('expires_in') || 3600) * 1000, user: { id: u.id, email: u.email } };
  writeSession(s);
  return s;
}

let refreshing: Promise<Session | null> | null = null;
async function session(): Promise<Session | null> {
  let s = readSession();
  if (!s) return null;
  if (s.expires_at - Date.now() > 60_000) return s;
  refreshing ??= authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
    .then((d) => {
      const next: Session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + d.expires_in * 1000, user: { id: d.user.id, email: d.user.email } };
      writeSession(next); return next;
    })
    .catch(() => { writeSession(null); return null; })
    .finally(() => { refreshing = null; });
  s = await refreshing;
  return s;
}

async function token(): Promise<string> {
  const s = await session();
  if (!s) { location.reload(); throw new ApiError('Your session has ended. Sign in again.', 401); }
  return s.access_token;
}

/** PostgREST call, protected by row-level security. */
async function rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      apikey: ANON, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new ApiError(e.message || 'Something went wrong saving your changes. Try again.', res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Netlify function call for agent work. */
async function fn<T>(name: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'That didn’t work. Try again in a minute.', res.status);
  return data as T;
}

const mapEnquiry = (r: any): EnquiryRecord => ({
  id: r.id, channel: r.channel, name: r.name ?? '', phone: r.phone ?? '', email: r.email ?? '', postcode: r.postcode ?? '',
  summary: r.summary ?? '', transcript: r.transcript ?? '', recordingUrl: r.recording_url ?? '',
  urgency: r.urgency, kind: r.kind, reasons: r.reasons ?? [], status: r.status, afterHours: !!r.after_hours,
  notes: r.notes ?? '', history: r.history ?? [], repliedAt: r.replied_at ?? null,
  quoteAmount: r.quote_amount != null ? Number(r.quote_amount) : null, quotedAt: r.quoted_at ?? null, chasersSent: Number(r.chasers_sent ?? 0),
  bookedFor: r.booked_for ?? null, bookedType: r.booked_type ?? '', bookedWith: r.booked_with ?? '', jobValue: r.job_value != null ? Number(r.job_value) : null, invoiceDue: r.invoice_due ?? null,
  paidAt: r.paid_at ?? null, paymentRemindersSent: Number(r.payment_reminders_sent ?? 0), reviewAskedAt: r.review_asked_at ?? null,
  receivedAt: r.received_at, isTest: !!r.is_test,
});
export const mapMessage = (r: any): MessageRecord => ({
  id: r.id, enquiryId: r.enquiry_id ?? null, direction: r.direction, audience: r.audience ?? 'customer', channel: r.channel,
  to: r.to_addr ?? '', from: r.from_addr ?? '', subject: r.subject ?? '', body: r.body ?? '', automatic: !!r.automatic,
  workflow: r.workflow ?? null, step: r.step ?? null, key: r.key ?? null, status: r.status, error: r.error ?? null,
  read: r.read !== false, createdAt: r.created_at, sentAt: r.sent_at ?? null,
});
const mapSource = (r: any): Source => ({ id: r.id, label: r.label, channel: r.channel, active: r.active, createdAt: r.created_at, lastUsedAt: r.last_used_at ?? null });

export function createLiveApi(): Api {
  return {
    mode: 'live',
    async getUser() {
      const fromLink = await consumeRedirect();
      return (fromLink ?? (await session()))?.user ?? null;
    },
    async requestSignIn(email) {
      // create_user is false: only people with a subscription (created by the Stripe webhook) can sign in.
      await authFetch(`otp?redirect_to=${encodeURIComponent(location.origin + '/')}`, { email, create_user: false });
    },
    async signOut() {
      const s = readSession();
      writeSession(null);
      if (s) fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
    },

    async getPlan(): Promise<Plan> {
      const rows = await rest<any[]>('entitlements?select=agent,plan,status,current_period_end&status=in.(active,trialing)');
      const cap = rows.find((r) => r.agent === 'capture');
      return { active: !!cap, package: cap?.plan ?? undefined, renewsOn: cap?.current_period_end ?? undefined, alsoCommandCentre: rows.some((r) => r.agent !== 'capture') };
    },
    async billingUrl() { return (await fn<{ url: string }>('billing-portal', {})).url; },
    async getSettings() {
      const rows = await rest<any[]>('capture_settings?select=data,completed_at');
      if (!rows[0]) return null;
      return { ...withDefaults(rows[0].data), completedAt: rows[0].completed_at ?? rows[0].data?.completedAt ?? undefined };
    },
    async saveSettings(s) {
      const ses = await session();
      await rest('capture_settings?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: ses!.user.id, data: s, completed_at: s.completedAt ?? null, updated_at: new Date().toISOString() } });
    },

    async listEnquiries() { return (await rest<any[]>('enquiries?select=*&order=received_at.desc&limit=1000')).map(mapEnquiry); },
    async addEnquiry(e) { return fn<EnquiryRecord>('enquiries', { op: 'add', enquiry: e }); },
    async updateEnquiry(id, patch) { return fn<EnquiryRecord>('enquiries', { op: 'update', id, ...patch }); },
    async deleteEnquiry(id) { await fn('enquiries', { op: 'delete', id }); },
    async draftReply(id) { return (await fn<{ text: string }>('enquiries', { op: 'draft', id })).text; },
    async sendTest() { return fn<EnquiryRecord>('enquiries', { op: 'test' }); },

    async listMessages() { return (await rest<any[]>('messages?select=*&order=created_at.desc&limit=1500')).map(mapMessage); },
    async reply(enquiryId, channel, text, subject) { const r = await fn<any>('enquiries', { op: 'reply', id: enquiryId, channel, text, subject }); return { message: mapMessage(r.message), enquiry: r.enquiry }; },
    async approveMessage(id, text) { await fn('enquiries', { op: 'approve', messageId: id, text }); },
    async skipMessage(id) { await fn('enquiries', { op: 'skip', messageId: id }); },
    async markRead(enquiryId) { await fn('enquiries', { op: 'read', id: enquiryId }); },
    async testText(text) { await fn('enquiries', { op: 'test-text', text }); },

    async listSources() { return (await rest<any[]>('enquiry_sources?select=id,label,channel,active,created_at,last_used_at&order=created_at.desc')).map(mapSource); },
    async createSource(label, channel) { return fn<Source>('enquiries', { op: 'link', label, channel }); },
    async revokeSource(id) { await fn('enquiries', { op: 'revoke', id }); },
    async diaryTimes(type, who, from, days) { return fn('diary', { op: 'times', type, who, from, days }); },
    async diaryBook(b) { return (await fn<{ enquiry: EnquiryRecord }>('diary', { op: 'book', ...b })).enquiry; },
    async slugFree(slug) { return fn('diary', { op: 'slug', slug }); },
    async connect(op, payload = {}) { return fn('connect', { op, ...payload }); },
    async importBookings(bookings, system) { return fn('diary', { op: 'import', bookings, system }); },
  };
}

export const liveConfigured = Boolean(URL_ && ANON);
