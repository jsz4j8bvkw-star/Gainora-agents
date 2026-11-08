// Shared server helpers: environment, Supabase (service role), auth and HTTP.
// No third-party packages: everything uses fetch, so Netlify can bundle it as-is.
import { learnFrom, type FeedbackRecord, type Learned } from '../../shared/learning';
import type { ValueKind } from '../../shared/value';

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
export type AgentId = 'watcher' | 'scout' | 'brief';

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

export async function activeAgents(user: AuthedUser): Promise<AgentId[]> {
  const rows = await db<any[]>(`entitlements?select=agent&status=in.(active,trialing)&or=(user_id.eq.${user.id},email.eq.${enc(user.email)})`);
  return [...new Set(rows.map((r) => r.agent as AgentId))];
}

export async function requireAgent(req: Request, agent: AgentId | null): Promise<AuthedUser> {
  const user = await userFromRequest(req);
  if (agent) {
    const agents = await activeAgents(user);
    if (!agents.includes(agent)) throw new HttpError(403, 'This agent is not on your plan.');
  }
  return user;
}

export async function getProfile(userId: string): Promise<any | null> {
  const rows = await db<any[]>(`profiles?select=data,completed_at&user_id=eq.${userId}`);
  return rows[0]?.data ?? null;
}

export async function body<T = any>(req: Request): Promise<T> {
  try { return await req.json(); } catch { throw new HttpError(400, 'The request was not readable.'); }
}

/** Calls another function in this site (used to start background work). Returns false when the hand-off failed. */
export async function callInternal(name: string, payload: unknown): Promise<boolean> {
  const base = env('URL') || env('DEPLOY_PRIME_URL');
  if (!base || !env('INTERNAL_SECRET')) { console.error('[gainora] internal call skipped', name, 'URL or INTERNAL_SECRET missing'); return false; }
  try {
    const res = await fetch(`${base}/.netlify/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gainora-internal': env('INTERNAL_SECRET') },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok && res.status !== 202) { console.error('[gainora] internal call failed', name, res.status); return false; }
    return true;
  } catch (e: any) { console.error('[gainora] internal call failed', name, e?.message); return false; }
}

export function requireInternal(req: Request) {
  const secret = env('INTERNAL_SECRET');
  if (!secret || req.headers.get('x-gainora-internal') !== secret) throw new HttpError(403, 'Forbidden');
}

/* ---------- Writes shared by agents ---------- */
export async function addNote(userId: string, agent: AgentId, text: string) {
  await insert('agent_notes', { user_id: userId, agent, body: text.slice(0, 1200) });
}
export async function addAlert(userId: string, agent: AgentId, level: 'urgent' | 'notice' | 'good', title: string, text: string, link?: string) {
  await insert('alerts', { user_id: userId, agent, level, title: title.slice(0, 160), body: text.slice(0, 500), link: link ?? null });
}
export async function addActions(userId: string, agent: AgentId, texts: string[]) {
  const clean = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].slice(0, 5);
  if (!clean.length) return;
  // Skip actions that are already open with the same text.
  const open = await db<any[]>(`actions?select=text&user_id=eq.${userId}&done=eq.false`);
  const have = new Set(open.map((o) => o.text.toLowerCase()));
  const rows = clean.filter((t) => !have.has(t.toLowerCase())).map((t) => ({ user_id: userId, agent, text: t.slice(0, 300) }));
  if (rows.length) await insert('actions', rows);
}

/** Records a piece of work for the client's value tracker. Never fails the caller. */
export async function addValue(userId: string, agent: AgentId | 'you', kind: ValueKind, title: string, amount?: number | null, ref?: string) {
  await insert('value_events', { user_id: userId, agent, kind, title: title.slice(0, 200), amount: typeof amount === 'number' && amount > 0 ? amount : null, ref: ref ?? null })
    .catch((e) => console.error('[gainora] value event', e?.message));
}

export const mapFeedbackRow = (r: any): FeedbackRecord => ({
  id: r.id, agent: r.agent, itemKind: r.item_kind, itemId: r.item_id, verdict: r.verdict, reason: r.reason,
  text: r.item_text ?? '', host: r.host, changeKind: r.change_kind, createdAt: r.created_at,
});

/** What this client has taught their agents through "Useful" and "Not relevant". */
export async function learnedFor(userId: string): Promise<Learned> {
  const rows = await db<any[]>(`feedback?select=*&user_id=eq.${userId}&order=created_at.desc&limit=300`).catch(() => []);
  return learnFrom(rows.map(mapFeedbackRow));
}
