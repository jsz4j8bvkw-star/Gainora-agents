// Instagram, read through Meta's Graph API with ONE token: Gainora's own Instagram professional
// account, connected to Gainora's own Meta app. No client ever logs in to Meta, and nothing is
// posted. The Business Discovery endpoint reads the public profile and recent posts of other
// Instagram Business or Creator accounts by username (see shared/instagram.ts for the request
// shape and the documentation it follows). Personal and private accounts can't be read; the app
// says so plainly.
//
// Environment (all in Netlify; the feature stays hidden when the first two are missing):
//   META_IG_USER_ID     the Instagram professional account id behind the token
//   META_ACCESS_TOKEN   a long-lived User token (about 60 days) or a Page token (no expiry)
//   META_APP_ID, META_APP_SECRET   only needed to refresh a long-lived User token automatically
//   META_DAILY_CAP      optional, how many Business Discovery calls a day across all clients (default 150)
import { db, env, upsert } from './core';
import { DISCOVERY_FIELDS, exchangeTokenUrl, GRAPH_BASE, HANDLE_RE, parseDiscovery, type DiscoveryError, type DiscoveryResult } from '../../shared/instagram';

const DAY = 86_400_000;
const TOKEN_KEY = 'meta_token';
const CALLS_KEY = 'meta_calls';

export const metaConfigured = () => Boolean(env('META_IG_USER_ID') && env('META_ACCESS_TOKEN'));

interface StoredToken { token: string; expiresAt: string | null; refreshedAt: string }

async function jobState<T>(key: string): Promise<T | null> {
  const rows = await db<any[]>(`job_state?select=value&key=eq.${encodeURIComponent(key)}`).catch(() => []);
  return (rows[0]?.value as T) ?? null;
}
const setJobState = (key: string, value: unknown) => upsert('job_state', { key, value, updated_at: new Date().toISOString() }, 'key').catch((e) => console.error('[gainora] job_state', e?.message));

/** The token to use: a refreshed one from job_state when there is one, else the environment variable. */
export async function currentToken(): Promise<string> {
  const stored = await jobState<StoredToken>(TOKEN_KEY);
  if (stored?.token && (!stored.expiresAt || new Date(stored.expiresAt).getTime() > Date.now())) return stored.token;
  return env('META_ACCESS_TOKEN');
}

/**
 * Long-lived User tokens last about 60 days and can be exchanged for a fresh one while still valid
 * (GET /oauth/access_token?grant_type=fb_exchange_token). Runs at most every 20 days, only when the
 * app id and secret are set. A Page token never expires, so the exchange is skipped for it (it fails harmlessly).
 */
export async function refreshTokenIfDue(now = new Date()): Promise<void> {
  if (!metaConfigured() || !env('META_APP_ID') || !env('META_APP_SECRET')) return;
  const stored = await jobState<StoredToken>(TOKEN_KEY);
  const last = stored?.refreshedAt ? new Date(stored.refreshedAt).getTime() : 0;
  if (now.getTime() - last < 20 * DAY) return;
  try {
    const res = await fetch(exchangeTokenUrl(env('META_APP_ID'), env('META_APP_SECRET'), await currentToken()), { signal: AbortSignal.timeout(15_000) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || typeof json?.access_token !== 'string') { console.error('[gainora] meta token refresh', res.status, json?.error?.message); return; }
    const expiresAt = typeof json.expires_in === 'number' ? new Date(now.getTime() + json.expires_in * 1000).toISOString() : null;
    await setJobState(TOKEN_KEY, { token: json.access_token, expiresAt, refreshedAt: now.toISOString() } satisfies StoredToken);
  } catch (e: any) { console.error('[gainora] meta token refresh', e?.message); }
}

/** How many Business Discovery calls are left today, across all clients. */
export async function callsLeftToday(now = new Date()): Promise<number> {
  const cap = Number(env('META_DAILY_CAP', '150'));
  const day = now.toISOString().slice(0, 10);
  const c = await jobState<{ day: string; n: number }>(CALLS_KEY);
  return Math.max(0, cap - (c?.day === day ? c.n : 0));
}
async function countCall(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const c = await jobState<{ day: string; n: number }>(CALLS_KEY);
  await setJobState(CALLS_KEY, { day, n: c?.day === day ? c.n + 1 : 1 });
}

/** Reads one public Instagram professional account by handle. Never throws: errors come back typed. */
export async function discover(handle: string, posts = 12, now = new Date()): Promise<DiscoveryResult | DiscoveryError> {
  if (!HANDLE_RE.test(handle)) return { ok: false, error: 'not-business', message: 'Not a valid Instagram handle.' };
  if (!metaConfigured()) return { ok: false, error: 'token', message: 'Instagram reading is not set up.' };
  if ((await callsLeftToday(now)) <= 0) return { ok: false, error: 'rate-limited', message: 'Daily Instagram allowance used.' };
  try {
    const q = new URLSearchParams({ fields: DISCOVERY_FIELDS(handle, posts), access_token: await currentToken() });
    await countCall(now);
    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(env('META_IG_USER_ID'))}?${q}`, { signal: AbortSignal.timeout(20_000) });
    const json = await res.json().catch(() => ({}));
    const r = parseDiscovery(json, handle);
    if (!r.ok && r.error !== 'not-business') console.error('[gainora] instagram', handle, r.error, r.message);
    return r;
  } catch (e: any) {
    return { ok: false, error: 'unavailable', message: String(e?.message || 'Instagram did not answer.') };
  }
}
