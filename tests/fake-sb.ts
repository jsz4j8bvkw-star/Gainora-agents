// A small stand-in for Supabase (REST, auth) and outside services, for testing the server functions end to end.
// Supports the filters the functions use: eq, neq, gte, gt, lt, lte, in, is, JSON paths like data->page->>slug,
// on_conflict upserts, PATCH and DELETE.
import { createServer, type Server } from 'node:http';

export type Row = Record<string, any>;
export interface Fake { tables: Record<string, Row[]>; calls: { method: string; url: string; body: any }[]; base: string; server: Server; external: (host: string, handler: (method: string, path: string, body: any) => any) => void }

const get = (row: Row, field: string) => {
  const m = field.match(/^(\w+)((?:->>?\w+)*)$/);
  if (!m) return row[field];
  let v: any = row[m[1]];
  for (const step of m[2].match(/->>?\w+/g) ?? []) v = v?.[step.replace(/^->>?/, '')];
  return v;
};
const test = (v: any, op: string, raw: string): boolean => {
  if (op === 'not') { const i = raw.indexOf('.'); return !test(v, raw.slice(0, i), raw.slice(i + 1)); }
  const val = decodeURIComponent(raw);
  if (op === 'like' || op === 'ilike') return new RegExp(`^${val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, op === 'ilike' ? 'i' : '').test(String(v ?? ''));
  if (op === 'eq') return String(v) === val || (val === 'true' && v === true) || (val === 'false' && v === false);
  if (op === 'neq') return String(v) !== val;
  if (op === 'gte') return v != null && String(v) >= val;
  if (op === 'gt') return v != null && String(v) > val;
  if (op === 'lt') return v != null && String(v) < val;
  if (op === 'lte') return v != null && String(v) <= val;
  if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  if (op === 'is') return val === 'null' ? v == null : String(v) === val;
  return true;
};

export async function startFake(seed: Record<string, Row[]>): Promise<Fake> {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const calls: Fake['calls'] = [];
  const externals: Record<string, (method: string, path: string, body: any) => any> = {};
  let n = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
    const url = new URL(req.url!, 'http://x');
    calls.push({ method: req.method!, url: decodeURIComponent(req.url!), body });
    res.setHeader('Content-Type', 'application/json');
    const host = req.headers['x-fake-host'] as string | undefined;
    if (host) { const out = externals[host]?.(req.method!, url.pathname + url.search, body); res.statusCode = out?.status ?? 200; return res.end(JSON.stringify(out?.body ?? out ?? {})); }
    if (url.pathname === '/auth/v1/user') { const t = String(req.headers.authorization || '').replace(/^Bearer /, ''); const u = (tables.__users ?? []).find((x) => x.token === t); res.statusCode = u ? 200 : 401; return res.end(JSON.stringify(u ? { id: u.id, email: u.email } : {})); }
    if (url.pathname === '/auth/v1/admin/users') {
      const users = (tables.__users ??= []);
      if (req.method === 'POST') {
        if (users.some((u) => u.email === body?.email)) { res.statusCode = 422; return res.end('{}'); }
        const u = { id: `user-${++n}`, email: body?.email, token: `t-${n}` }; users.push(u); return res.end(JSON.stringify(u));
      }
      const e = url.searchParams.get('email');
      return res.end(JSON.stringify({ users: users.filter((u) => !e || u.email === e).map((u) => ({ id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at ?? null })) }));
    }
    if (url.pathname.startsWith('/storage/v1/object/') && req.method === 'POST') {
      const key = url.pathname.replace('/storage/v1/object/', '');
      (tables.__storage ??= []).push({ key, type: req.headers['content-type'], size: raw.length });
      return res.end(JSON.stringify({ Key: key }));
    }
    const admin = url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (admin) { const u = (tables.__users ?? []).find((x) => x.id === admin[1]); res.statusCode = u ? 200 : 404; return res.end(JSON.stringify(u ? { id: u.id, email: u.email } : {})); }
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) { res.statusCode = 404; return res.end('{}'); }
    const table = (tables[m[1]] ??= []);
    const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict', 'or'].includes(k));
    const match = (r: Row) => filters.every(([k, v]) => { const i = v.indexOf('.'); return test(get(r, k), v.slice(0, i), v.slice(i + 1)); });
    const limit = Number(url.searchParams.get('limit')) || Infinity;
    if (req.method === 'GET') return res.end(JSON.stringify(table.filter(match).slice(0, limit)));
    if (req.method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]).map((r: Row) => ({ id: r.id ?? `id-${++n}`, created_at: new Date().toISOString(), ...r }));
      const conflict = url.searchParams.get('on_conflict')?.split(',');
      const prefer = String(req.headers.prefer || '');
      const out: Row[] = [];
      for (const r of rows) {
        const dup = conflict ? table.find((x) => conflict.every((k) => x[k] != null && x[k] === r[k])) : undefined;
        if (dup && /ignore-duplicates/.test(prefer)) continue;
        if (dup && /merge-duplicates/.test(prefer)) { Object.assign(dup, r, { id: dup.id }); out.push(dup); continue; }
        table.push(r); out.push(r);
      }
      res.statusCode = 201;
      return res.end(/return=representation/.test(prefer) ? JSON.stringify(out) : '');
    }
    if (req.method === 'PATCH') { const hit = table.filter(match); for (const r of hit) Object.assign(r, body); return res.end(JSON.stringify(hit)); }
    if (req.method === 'DELETE') { tables[m[1]] = table.filter((r) => !match(r)); res.statusCode = 204; return res.end(); }
    res.statusCode = 405; res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  // Route calls to Google and Cliniko to the same server, marked with the host they were meant for.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init: any = {}) => {
    const u = new URL(String(input));
    if (/googleapis\.com|resend\.com|capture\.gainora\.co\.uk|api\.stripe\.com|api\.netlify\.com/.test(u.hostname)) {
      return realFetch(`${base}${u.pathname}${u.search}`, { ...init, headers: { ...(init.headers ?? {}), 'x-fake-host': u.hostname } });
    }
    return realFetch(input, init);
  }) as any;
  return { tables, calls, base, server, external: (host, handler) => { externals[host] = handler; } };
}
