// The clinic's own calendar or booking system, connected to the Gainora diary.
//  - Google Calendar: their busy times count (so nobody is booked over them), and new bookings are added to it.
//    A calendar that's only a copy of another system (Fresha's sync) is read but never written to.
//  - Cliniko: its own free times are used, and bookings are made in Cliniko itself.
// Secrets are sealed (lib/secret.ts) and only ever read here, on the server.
import { db, env, enc, HttpError } from './core';
import { open, seal } from './secret';
import type { CaptureSettings } from '../../shared/capture';
import { dayLabel, findType, londonDate, teamOf, whoDoes, type Busy, type DayTimes, type Slot } from '../../shared/diary';

export interface PushedBooking { start: string; minutes: number; type: string; who: string; name: string; phone: string; email: string; notes: string; enquiryId: string }
export type Provider = 'google' | 'cliniko';
export interface Connection { id: string; provider: Provider; secret: string; account: any; status: string }

const DAY = 86_400_000;
const contact = () => (env('EMAIL_FROM').match(/[^\s<>]+@[^\s<>]+/)?.[0] || 'hello@gainora.co.uk');

export async function connectionsFor(userId: string): Promise<Connection[]> {
  try { return await db<Connection[]>(`diary_connections?select=id,provider,secret,account,status&user_id=eq.${userId}`); }
  catch { return []; }   // not set up yet (the migration hasn't run): no connections
}
export async function saveConnection(userId: string, provider: Provider, secret: string | null, account: any) {
  const row: any = { user_id: userId, provider, account, status: 'connected', last_error: null, updated_at: new Date().toISOString() };
  if (secret !== null) row.secret = seal(secret);
  if (secret === null) {
    await db(`diary_connections?user_id=eq.${userId}&provider=eq.${provider}`, { method: 'PATCH', body: { account, updated_at: row.updated_at } });
    return;
  }
  await db('diary_connections?on_conflict=user_id,provider', { method: 'POST', prefer: 'resolution=merge-duplicates', body: row });
}
export const removeConnection = (userId: string, provider: Provider) => db(`diary_connections?user_id=eq.${userId}&provider=eq.${provider}`, { method: 'DELETE' });
const markError = (c: Connection, message: string) =>
  db(`diary_connections?id=eq.${c.id}`, { method: 'PATCH', body: { status: 'error', last_error: message.slice(0, 300), updated_at: new Date().toISOString() } }).catch(() => {});

/** What the app may see about a connection: never the secret. */
export const publicConnection = (c: Connection) => ({ provider: c.provider, status: c.status, account: c.account });

/* ====================================================================== Google Calendar */

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'];
export const googleReady = () => !!(env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET'));
export const googleRedirect = (appUrl: string) => `${appUrl}/api/connect/google/callback`;

export function googleAuthUrl(appUrl: string, state: string) {
  const p = new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'), redirect_uri: googleRedirect(appUrl), response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function googleToken(body: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_OAUTH_CLIENT_ID'), client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'), ...body }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new HttpError(502, j.error_description || j.error || 'Google didn’t accept that sign-in.');
  return j as { access_token: string; refresh_token?: string; expires_in: number };
}
export const googleExchange = (code: string, appUrl: string) => googleToken({ code, redirect_uri: googleRedirect(appUrl), grant_type: 'authorization_code' });

async function googleApi(access: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method: init.method || 'GET', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `Google Calendar said ${res.status}`);
  return j;
}

export async function googleCalendars(access: string) {
  const j = await googleApi(access, '/users/me/calendarList?minAccessRole=reader&maxResults=100');
  return (j.items ?? []).map((c: any) => ({ id: String(c.id), name: String(c.summaryOverride || c.summary || c.id), primary: !!c.primary, canWrite: ['owner', 'writer'].includes(c.accessRole) }));
}

async function googleAccess(c: Connection): Promise<string> {
  try { return (await googleToken({ refresh_token: open(c.secret), grant_type: 'refresh_token' })).access_token; }
  catch (e: any) { await markError(c, `Google sign-in stopped working: ${e?.message || 'reconnect'}`); throw e; }
}

/** Busy times from the calendars the owner chose. A calendar assigned to a team member blocks only them. */
async function googleBusy(c: Connection, from: Date, to: Date): Promise<Busy[]> {
  const read: string[] = c.account?.read?.length ? c.account.read : c.account?.write ? [c.account.write] : [];
  if (!read.length) return [];
  const access = await googleAccess(c);
  const j = await googleApi(access, '/freeBusy', { method: 'POST', body: { timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: 'Europe/London', items: read.map((id) => ({ id })) } });
  const out: Busy[] = [];
  for (const id of read) for (const b of j.calendars?.[id]?.busy ?? []) out.push({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString(), who: String(c.account?.staff?.[id] || '') });
  return out;
}

async function googleInsert(c: Connection, b: PushedBooking) {
  if (c.account?.mirror) return;   // a copy of another system: never written to
  const staffCal = Object.entries(c.account?.staff ?? {}).find(([, who]) => who && who === b.who)?.[0];
  const cal = staffCal || c.account?.write;
  if (!cal) return;
  const access = await googleAccess(c);
  const end = new Date(new Date(b.start).getTime() + b.minutes * 60_000).toISOString();
  await googleApi(access, `/calendars/${enc(cal)}/events`, { method: 'POST', body: {
    summary: `${b.type} – ${b.name}${b.who ? ` (${b.who})` : ''}`,
    description: [`Booked through Gainora.`, `Phone: ${b.phone}`, b.email && `Email: ${b.email}`, b.notes && `Note: ${b.notes}`].filter(Boolean).join('\n'),
    start: { dateTime: b.start, timeZone: 'Europe/London' }, end: { dateTime: end, timeZone: 'Europe/London' },
  } });
}

/* ====================================================================== Cliniko */

export function clinikoBase(key: string) {
  const shard = key.trim().match(/-(\w{2}\d{1,2})$/i)?.[1]?.toLowerCase() || 'au1';
  return `https://api.${shard}.cliniko.com/v1`;
}
async function clinikoApi(key: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${clinikoBase(key)}${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${key.trim()}:`).toString('base64')}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': `Gainora (${contact()})` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const j: any = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HttpError(400, 'Cliniko didn’t accept that API key. Copy it again from Cliniko, My info, Manage API keys.');
  if (!res.ok) throw new HttpError(502, j?.message || `Cliniko said ${res.status}.`);
  return j;
}

/** Checks a key and reads what's needed to match the clinic's treatments and team to Cliniko's. */
export async function clinikoDiscover(key: string) {
  const [b, p, t] = await Promise.all([clinikoApi(key, '/businesses?per_page=50'), clinikoApi(key, '/practitioners?per_page=100'), clinikoApi(key, '/appointment_types?per_page=100')]);
  return {
    businesses: (b.businesses ?? []).map((x: any) => ({ id: String(x.id), name: String(x.business_name || x.label || x.id) })),
    practitioners: (p.practitioners ?? []).filter((x: any) => x.active !== false).map((x: any) => ({ id: String(x.id), name: `${x.first_name ?? ''} ${x.last_name ?? ''}`.trim(), first: String(x.first_name || '').trim() })),
    types: (t.appointment_types ?? []).map((x: any) => ({ id: String(x.id), name: String(x.name), minutes: Number(x.duration_in_minutes) || 0 })),
  };
}

/** The clinic's matches, made automatically by name when they connect (they can change them). */
export function clinikoAutoMatch(s: CaptureSettings, d: Awaited<ReturnType<typeof clinikoDiscover>>) {
  const types: Record<string, string> = {};
  for (const t of s.bookings.types.filter((x) => x.name.trim())) {
    const hit = d.types.find((x: { name: string }) => x.name.toLowerCase() === t.name.toLowerCase()) ?? d.types.find((x: { name: string }) => x.name.toLowerCase().includes(t.name.toLowerCase()) || t.name.toLowerCase().includes(x.name.toLowerCase()));
    if (hit) types[t.name] = hit.id;
  }
  const team = teamOf(s);
  const practitioners: Record<string, string> = {};
  for (const p of d.practitioners) {
    const name = team.find((t) => t.toLowerCase() === p.first.toLowerCase()) ?? (team.length ? '' : p.first);
    if (name) practitioners[name] = p.id;
  }
  return { businessId: d.businesses[0]?.id ?? '', types, practitioners };
}

async function clinikoTimes(c: Connection, s: CaptureSettings, q: { type: string; who?: string; from: string; days: number; now: Date }): Promise<DayTimes[]> {
  const key = open(c.secret);
  const type = findType(s, q.type);
  const typeId = type ? c.account?.types?.[type.name] : undefined;
  if (!type || !typeId || !c.account?.businessId) return [];
  const mapped: Record<string, string> = c.account?.practitioners ?? {};
  const people = whoDoes(s, type).filter((p) => (p ? mapped[p] : false));
  const pick = q.who ? people.filter((p) => p.toLowerCase() === q.who!.toLowerCase()) : people;
  const earliest = q.now.getTime() + (s.bookings.noticeHours || 0) * 3_600_000;
  const latest = q.now.getTime() + Math.max(1, s.bookings.aheadWeeks || 4) * 7 * DAY;
  const byStart = new Map<string, Slot>();
  for (const who of pick) {
    for (let i = 0; i < q.days; i += 7) {
      const from = new Date(Date.parse(`${q.from}T12:00:00Z`) + i * DAY).toISOString().slice(0, 10);
      const to = new Date(Date.parse(`${q.from}T12:00:00Z`) + Math.min(i + 6, q.days - 1) * DAY).toISOString().slice(0, 10);
      const j = await clinikoApi(key, `/businesses/${c.account.businessId}/practitioners/${mapped[who]}/appointment_types/${typeId}/available_times?from=${from}&to=${to}&per_page=100`);
      for (const t of j.available_times ?? []) {
        const start = new Date(t.appointment_start).toISOString();
        const at = new Date(start).getTime();
        if (at < earliest || at > latest || byStart.has(start)) continue;   // the first person (in the owner's order) keeps the time
        byStart.set(start, { start, end: new Date(at + type.minutes * 60_000).toISOString(), who });
      }
    }
  }
  const days = new Map<string, Slot[]>();
  for (const x of [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start))) {
    const d = londonDate(new Date(x.start));
    days.set(d, [...(days.get(d) ?? []), x]);
  }
  return [...days.entries()].map(([date, slots]) => ({ date, label: dayLabel(date), slots }));
}

async function clinikoBook(c: Connection, s: CaptureSettings, b: PushedBooking) {
  const key = open(c.secret);
  const type = findType(s, b.type)!;
  const [first, ...rest] = b.name.trim().split(/\s+/);
  let patientId = '';
  if (b.email) {
    const found = await clinikoApi(key, `/patients?q[]=${enc(`email:=${b.email}`)}`).catch(() => ({ patients: [] }));
    patientId = String(found.patients?.[0]?.id ?? '');
  }
  if (!patientId) {
    const p = await clinikoApi(key, '/patients', { method: 'POST', body: {
      first_name: first.slice(0, 50), last_name: (rest.join(' ') || '-').slice(0, 255), email: b.email || null,
      patient_phone_numbers: [{ number: b.phone, phone_type: 'Mobile' }],
    } });
    patientId = String(p.id);
  }
  await clinikoApi(key, '/individual_appointments', { method: 'POST', body: {
    starts_at: b.start, patient_id: patientId, practitioner_id: c.account.practitioners[b.who], appointment_type_id: c.account.types[type.name],
    business_id: c.account.businessId, notes: [`Booked through Gainora.`, b.notes].filter(Boolean).join(' '),
  } });
}

/* ====================================================================== Used by the diary */

/** Busy times from a connected Google calendar. Cliniko works differently: its own free times are used instead. */
export async function externalBusy(userId: string, _s: CaptureSettings, from: Date, to: Date): Promise<Busy[]> {
  const g = (await connectionsFor(userId)).find((c) => c.provider === 'google' && c.status === 'connected');
  return g ? googleBusy(g, from, to) : [];
}

/** With Cliniko connected, free times come from Cliniko itself. Null means "use the Gainora diary". */
export async function providerTimes(userId: string, s: CaptureSettings, q: { type: string; who?: string; from: string; days: number; now: Date }): Promise<DayTimes[] | null> {
  const c = (await connectionsFor(userId)).find((x) => x.provider === 'cliniko' && x.status === 'connected');
  return c ? clinikoTimes(c, s, q) : null;
}

/** Puts a booking into the connected system: Cliniko (the booking itself) or Google (an event in their calendar). */
export async function pushBooking(userId: string, s: CaptureSettings, b: PushedBooking): Promise<void> {
  const all = (await connectionsFor(userId)).filter((c) => c.status === 'connected');
  const cliniko = all.find((c) => c.provider === 'cliniko');
  if (cliniko) await clinikoBook(cliniko, s, b);
  const google = all.find((c) => c.provider === 'google');
  if (google) await googleInsert(google, b).catch((e) => console.error('[capture] google insert', e?.message));
}

/** Whether bookings must go into a connected system first (so a failure there means "not booked"). */
export async function bookingSystemFirst(userId: string): Promise<boolean> {
  return (await connectionsFor(userId)).some((c) => c.provider === 'cliniko' && c.status === 'connected');
}
