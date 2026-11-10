import { body, db, HttpError, json, requireCapture, getSettings, handler } from '../lib/core';
import { appUrl, withDefaults } from '../lib/capture';
import { sign, verify } from '../lib/secret';
import {
  clinikoAutoMatch, clinikoDiscover, connectionsFor, googleAuthUrl, googleCalendars, googleExchange, googleReady,
  publicConnection, removeConnection, saveConnection,
} from '../lib/connections';
import { GAINORA_DIARY, type CaptureSettings } from '../../shared/capture';

// Connecting the clinic's own calendar or booking system to the Gainora diary.
//   POST /api/connect {op: list | google-start | google-save | cliniko-connect | cliniko-save | disconnect}  (signed in)
//   GET  /api/connect/google/callback   where Google sends the owner back after they allow access
async function saveSettings(userId: string, s: CaptureSettings) {
  await db('capture_settings?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: userId, data: s, updated_at: new Date().toISOString() } });
}

async function callback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(`${appUrl()}/diary?${q}`, 302);
  const state = verify<{ u: string; at: number }>(url.searchParams.get('state') || '');
  if (!state) return back('connect_error=expired');
  if (url.searchParams.get('error')) return back('connect_error=declined');
  try {
    const t = await googleExchange(url.searchParams.get('code') || '', appUrl());
    if (!t.refresh_token) return back('connect_error=no_offline');
    const calendars = await googleCalendars(t.access_token);
    const primary = calendars.find((c: any) => c.primary) ?? calendars[0];
    const s = withDefaults(await getSettings(state.u));
    const system = s.bookings.system;
    // Their calendar is the diary when they keep it in Google (or have nothing else); otherwise it's a copy.
    const mirror = !!system && system !== 'Google Calendar' && system !== GAINORA_DIARY && !/paper/i.test(system);
    await saveConnection(state.u, 'google', t.refresh_token, { calendars, read: primary ? [primary.id] : [], write: primary?.canWrite ? primary.id : '', staff: {}, mirror });
    await saveSettings(state.u, { ...s, bookings: { ...s.bookings, status: 'connected', mirror, ...(system ? {} : { system: 'Google Calendar' }) } });
    return back('connected=google');
  } catch (e: any) {
    console.error('[capture] google connect', e?.message);
    return back('connect_error=google');
  }
}

const actions = handler(async (req) => {
  const user = await requireCapture(req);
  const b = await body<any>(req);
  const s = withDefaults(await getSettings(user.id));
  const all = await connectionsFor(user.id);
  const find = (p: string) => all.find((c) => c.provider === p);

  if (b.op === 'list') {
    return json({ google: { ready: googleReady(), connection: find('google') ? publicConnection(find('google')!) : null }, cliniko: { connection: find('cliniko') ? publicConnection(find('cliniko')!) : null } });
  }
  if (b.op === 'google-start') {
    if (!googleReady()) throw new HttpError(503, 'Google Calendar sign-in isn’t switched on yet. Gainora will connect it with you on your setup call.');
    return json({ url: googleAuthUrl(appUrl(), sign({ u: user.id, at: Date.now() })) });
  }
  if (b.op === 'google-save') {
    const c = find('google');
    if (!c) throw new HttpError(404, 'Connect Google Calendar first.');
    const ids = new Set((c.account?.calendars ?? []).map((x: any) => x.id));
    const read = (Array.isArray(b.read) ? b.read : []).filter((id: string) => ids.has(id));
    const write = ids.has(b.write) && c.account.calendars.find((x: any) => x.id === b.write)?.canWrite ? b.write : '';
    const staff: Record<string, string> = {};
    for (const [id, who] of Object.entries(b.staff ?? {})) if (ids.has(id) && typeof who === 'string') staff[id] = who.slice(0, 40);
    const mirror = !!b.mirror;
    const account = { ...c.account, read, write, staff, mirror };
    await saveConnection(user.id, 'google', null, account);
    await saveSettings(user.id, { ...s, bookings: { ...s.bookings, mirror, status: 'connected' } });
    return json({ connection: { provider: 'google', status: 'connected', account } });
  }
  if (b.op === 'cliniko-connect') {
    const key = String(b.key || '').trim();
    if (key.length < 20) throw new HttpError(400, 'Paste the whole API key from Cliniko.');
    const found = await clinikoDiscover(key);
    if (!found.businesses.length) throw new HttpError(400, 'That Cliniko account has no business set up yet.');
    const account = { ...clinikoAutoMatch(s, found), found };
    await saveConnection(user.id, 'cliniko', key, account);
    await saveSettings(user.id, { ...s, bookings: { ...s.bookings, system: 'Cliniko', status: 'connected', mirror: false } });
    return json({ connection: { provider: 'cliniko', status: 'connected', account } });
  }
  if (b.op === 'cliniko-save') {
    const c = find('cliniko');
    if (!c) throw new HttpError(404, 'Connect Cliniko first.');
    const account = { ...c.account, businessId: String(b.businessId || c.account.businessId), types: b.types ?? c.account.types, practitioners: b.practitioners ?? c.account.practitioners };
    await saveConnection(user.id, 'cliniko', null, account);
    return json({ connection: { provider: 'cliniko', status: 'connected', account } });
  }
  if (b.op === 'disconnect') {
    const p = b.provider === 'cliniko' ? 'cliniko' : 'google';
    await removeConnection(user.id, p);
    const left = all.filter((c) => c.provider !== p);
    if (!left.length && s.bookings.system !== GAINORA_DIARY) await saveSettings(user.id, { ...s, bookings: { ...s.bookings, status: 'not_connected', mirror: false } });
    return json({ ok: true });
  }
  throw new HttpError(400, 'Unknown action.');
});

export default async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/google/callback')) return callback(req);
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  return actions(req);
};
export const config = { path: ['/api/connect', '/api/connect/google/callback'] };
