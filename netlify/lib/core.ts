// Server helpers for Gainora Capture & Convert: environment, Supabase (service role), auth and HTTP.
// Same Supabase project as Gainora Agents, so one Gainora login works in both apps.
// No third-party packages: everything uses fetch, so Netlify can bundle it as-is.

export const env = (name: string, fallback = ''): string => (process.env[name] ?? fallback).trim();

export function requireEnv(...names: string[]): void {
  const missing = names.filter((n) => !env(n));
  if (missing.length) throw new HttpError(503, `Gainora is not fully set up yet (missing ${missing.join(', ')}).`);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Wraps a handler so thrown HttpErrors become clean JSON responses and nothing leaks. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try { return await fn(req); }
    catch (e: any) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('[gainora] unhandled', e?.message || e);
      return json({ error: 'Something went wrong on our side. Try again in a minute.' }, 500);
    }
  };
}

/* ---------- Supabase (service role) ---------- */
/**
 * Headers for the service role. Works with both kinds of Supabase key: the newer secret keys
 * ("sb_secret_...") go in `apikey` only, while the older service_role JWT also goes in Authorization.
 */
export function sbHeaders(extra: Record<string, string> = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json', ...extra };
}

export async function db<T = any>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: sbHeaders(init.prefer ? { Prefer: init.prefer } : {}),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[gainora] db error', res.status, path.split('?')[0], text.slice(0, 300));
    throw new HttpError(502, 'Could not reach your saved data. Try again in a minute.');
  }
  if (res.status === 204) return undefined as T;
  const t = await res.text();
  return (t ? JSON.parse(t) : undefined) as T;
}

export const insert = <T = any>(table: string, rows: unknown) => db<T[]>(table, { method: 'POST', body: rows, prefer: 'return=representation' });
export const upsert = <T = any>(table: string, rows: unknown, onConflict: string) =>
  db<T[]>(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' });
export const enc = encodeURIComponent;

/* ---------- Auth ---------- */
export interface AuthedUser { id: string; email: string }

export async function userFromRequest(req: Request): Promise<AuthedUser> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sign in to continue.');
  requireEnv('SUPABASE_URL', 'SUPABASE_ANON_KEY');
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(401, 'Your session has ended. Sign in again.');
  const u = await res.json();
  return { id: u.id, email: String(u.email || '').toLowerCase() };
}

/** True when this login has an active Capture & Convert subscription. */
export async function hasCapture(user: AuthedUser): Promise<boolean> {
  const rows = await db<any[]>(`entitlements?select=agent&agent=eq.capture&status=in.(active,trialing)&or=(user_id.eq.${user.id},email.eq.${enc(user.email)})`);
  return rows.length > 0;
}

export async function requireCapture(req: Request): Promise<AuthedUser> {
  const user = await userFromRequest(req);
  if (!(await hasCapture(user))) throw new HttpError(403, 'Capture & Convert isn’t on your plan.');
  return user;
}

export async function getSettings(userId: string): Promise<any | null> {
  const rows = await db<any[]>(`capture_settings?select=data&user_id=eq.${userId}`);
  return rows[0]?.data ?? null;
}

export async function body<T = any>(req: Request): Promise<T> {
  try { return await req.json(); } catch { throw new HttpError(400, 'The request was not readable.'); }
}

/** Calls another function in this site (used to start background work). */
export async function callInternal(name: string, payload: unknown): Promise<void> {
  const base = env('URL') || env('DEPLOY_PRIME_URL');
  const res = await fetch(`${base}/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gainora-internal': env('INTERNAL_SECRET') },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 202) console.error('[gainora] internal call failed', name, res.status);
}

export function requireInternal(req: Request) {
  const secret = env('INTERNAL_SECRET');
  if (!secret || req.headers.get('x-gainora-internal') !== secret) throw new HttpError(403, 'Forbidden');
}

