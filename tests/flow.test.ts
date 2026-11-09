import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SAMPLE_PROFILE_SHOP as SAMPLE_PROFILE } from '../src/lib/demo';

// A tiny in-memory stand-in for Supabase (auth + the PostgREST filters these functions use),
// so the lead pipeline, feedback and contract functions run end to end without a real database.
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@shop.co.uk' };
const SEARCH_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const db: Record<string, any[]> = {
  entitlements: [{ user_id: USER.id, email: USER.email, agent: 'scout', status: 'active' }, { user_id: USER.id, email: USER.email, agent: 'watcher', status: 'active' }],
  profiles: [{ user_id: USER.id, data: SAMPLE_PROFILE, completed_at: '2026-11-01T10:00:00Z' }],
  scout_searches: [{ id: SEARCH_ID, user_id: USER.id, results: [
    { id: 'r_fern', name: 'Fern & Flint', location: 'Totnes', website: 'https://fernandflint.co.uk', fit: 'strong', reason: 'Stocks local makers.', source: { title: 'Totnes News', url: 'https://news.example/fern' }, saved: false },
    { id: 'r_tide', name: 'Tidewater Home', location: 'Fowey', website: 'https://tidewater.example', fit: 'possible', reason: 'Gift shop.', source: { title: 'x', url: 'https://news.example/tide' }, saved: false },
  ] }],
  leads: [], value_events: [], feedback: [],
  tender_matches: [{ id: MATCH_ID, user_id: USER.id, tender_id: 'ocds-1', fit: 'strong', reason: 'Fits.', status: 'new' }],
};

function parse(url: string) {
  const u = new URL(url, 'http://x');
  const table = u.pathname.replace('/rest/v1/', '');
  const filters: [string, string, string][] = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'on_conflict', 'or'].includes(k)) continue;
    const m = v.match(/^(eq|neq|in|is|gte|lte|lt|gt|cs)\.(.*)$/s);
    if (m) filters.push([k, m[1], m[2]]);
  }
  return { table, filters, onConflict: u.searchParams.get('on_conflict') };
}
const matches = (row: any, filters: [string, string, string][]) => filters.every(([k, op, v]) => {
  if (op === 'eq') return String(row[k]) === v;
  if (op === 'neq') return String(row[k]) !== v;
  if (op === 'is') return v === 'null' ? row[k] == null : row[k] != null;
  if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, '')).includes(String(row[k]));
  if (op === 'cs') { const want = JSON.parse(v); return want.every((w: any) => (row[k] || []).some((x: any) => Object.entries(w).every(([kk, vv]) => x[kk] === vv))); }
  return true;
});

const server = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/auth/v1/user') return res.end(JSON.stringify(USER));
  const { table, filters, onConflict } = parse(req.url!);
  const rows = (db[table] ??= []);
  if (req.method === 'GET') return res.end(JSON.stringify(rows.filter((r) => matches(r, filters))));
  if (req.method === 'POST') {
    const out: any[] = [];
    for (const b of Array.isArray(body) ? body : [body]) {
      const keys = onConflict?.split(',') ?? [];
      const existing = keys.length ? rows.find((r) => keys.every((k) => r[k] === b[k])) : undefined;
      if (existing) {
        if (String(req.headers.prefer).includes('ignore-duplicates')) continue;
        Object.assign(existing, b); out.push(existing); continue;
      }
      const row = { id: uuid(), created_at: new Date().toISOString(), follow_ups: table === 'leads' ? 0 : undefined, ...b };
      rows.push(row); out.push(row);
    }
    return res.end(JSON.stringify(out));
  }
  if (req.method === 'PATCH') {
    const hit = rows.filter((r) => matches(r, filters));
    for (const r of hit) Object.assign(r, body);
    return res.end(JSON.stringify(hit));
  }
  if (req.method === 'DELETE') { db[table] = rows.filter((r) => !matches(r, filters)); res.statusCode = 204; return res.end(); }
  res.statusCode = 405; res.end();
});

const call = async (fn: any, payload: unknown) => {
  const r: Response = await fn(new Request('http://x/api', { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' } }));
  return { status: r.status, body: await r.json() };
};

test('lead pipeline, feedback and contracts work end to end', async () => {
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  Object.assign(process.env, { SUPABASE_URL: base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' });
  try {
    const { default: leads } = await import('../netlify/functions/leads');
    const { default: feedback } = await import('../netlify/functions/feedback');
    const { default: tenders } = await import('../netlify/functions/tenders');

    // Add a research result to the pipeline (twice: no duplicate).
    const added = await call(leads, { op: 'add', searchId: SEARCH_ID, resultId: 'r_fern' });
    assert.equal(added.status, 200);
    assert.equal(added.body.stage, 'to_contact');
    await call(leads, { op: 'add', searchId: SEARCH_ID, resultId: 'r_fern' });
    assert.equal(db.leads.length, 1);
    assert.equal(db.scout_searches[0].results[0].saved, true);
    const id = added.body.id;

    // Contacted: follow-up dates appear and the contact is counted once.
    const contacted = await call(leads, { op: 'update', id, stage: 'contacted' });
    assert.ok(contacted.body.contacted_at);
    assert.ok(contacted.body.next_follow_up_at);
    assert.equal(db.value_events.filter((e) => e.kind === 'lead_contacted').length, 1);

    // Follow-up drafted without AI configured (falls back to a written template), then sent.
    const draft = await call(leads, { op: 'draft', id });
    assert.match(draft.body.text, /^Subject: /);
    assert.match(draft.body.text, /no thanks/);
    const sent = await call(leads, { op: 'update', id, followUpSent: true });
    assert.equal(sent.body.follow_ups, 1);
    assert.notEqual(sent.body.next_follow_up_at, contacted.body.next_follow_up_at);

    // Won, then the owner adds the deal value later: one win, carrying the real amount.
    await call(leads, { op: 'update', id, stage: 'won' });
    assert.equal(db.leads[0].next_follow_up_at, null);
    await call(leads, { op: 'update', id, stage: 'won', value: '1200' });
    const wins = db.value_events.filter((e) => e.kind === 'lead_won');
    assert.equal(wins.length, 1);
    assert.equal(wins[0].amount, 1200);
    assert.equal(wins[0].ref, id);

    // Moved back out of "won": the win is removed from the results.
    await call(leads, { op: 'update', id, stage: 'replied' });
    assert.equal(db.value_events.filter((e) => e.kind === 'lead_won').length, 0);

    // Bad input is refused cleanly.
    assert.equal((await call(leads, { op: 'update', id, stage: 'married' })).status, 400);
    assert.equal((await call(leads, { op: 'update', id: 'not-a-uuid', stage: 'won' })).status, 404);
    assert.equal((await call(leads, { op: 'update', id, value: -5 })).status, 400);

    // "Not relevant" on a research result hides it and is remembered, once per item.
    const nr = await call(feedback, { agent: 'scout', itemKind: 'lead', itemId: 'r_tide', verdict: 'not_relevant', reason: 'Too far away', text: 'Tidewater Home, Fowey', host: 'tidewater.example' }); // the app sends a bare host
    assert.equal(db.feedback[0].host, 'tidewater.example');
    assert.equal(nr.status, 200);
    assert.equal(db.scout_searches[0].results[1].dismissed, true);
    await call(feedback, { agent: 'scout', itemKind: 'lead', itemId: 'r_tide', verdict: 'not_relevant', reason: 'Not our market', text: 'Tidewater Home, Fowey', host: 'https://www.tidewater.example/' });
    assert.equal(db.feedback.length, 1);
    assert.equal(db.feedback[0].reason, 'Not our market');
    assert.equal(db.feedback[0].host, 'tidewater.example');
    assert.equal((await call(feedback, { agent: 'scout', itemKind: 'constructor', itemId: 'x', verdict: 'useful', text: '' })).status, 400);
    const forget = await call(feedback, { forget: db.feedback[0].id });
    assert.equal(forget.status, 200);
    assert.equal(db.feedback.length, 0);

    // Contracts: "Useful" saves it; the owner can file it as applied.
    await call(feedback, { agent: 'scout', itemKind: 'tender', itemId: MATCH_ID, verdict: 'useful', text: 'Visitor centre gifts' });
    assert.equal(db.tender_matches[0].status, 'saved');
    assert.equal((await call(tenders, { id: MATCH_ID, status: 'applied' })).status, 200);
    assert.equal(db.tender_matches[0].status, 'applied');
    assert.equal((await call(tenders, { id: MATCH_ID, status: 'won-it' })).status, 400);
  } finally { server.close(); }
});
