import { db, enc, HttpError } from '../lib/core';
import { checkKey, findAccount, loadState, log, saveTask, startPackage, type AdminState } from '../lib/admin';
import { cleanSite, liveOrigin, ownerEmail, APP_ORIGIN } from '../lib/sites';
import { sendEmail } from '../lib/email';
import { bucketOf, ukToday } from '../../shared/admin/board';
import { PACKAGES, type Package } from '../../shared/admin/model';
import { type Site, withDefaults } from '../../shared/site/data';
import { checks } from '../../shared/site/kit';
import { pagesOf } from '../../shared/site/render';
import { randomBytes, randomUUID } from 'node:crypto';
import { insert } from '../lib/core';
import { blockedSet, cleanItems, cleanProspect, draftFor, getSettings, priceBook, proposalUrl, sequences } from '../lib/business';
import { dueFollowUps, type Prospect, sameProspect, STAGES } from '../../shared/admin/sales';
import { fromPriceItem, money, proposalTotals } from '../../shared/admin/prices';
import { addDays } from '../../shared/admin/templates';

// The Claude connector for Gainora's admin. Added once in claude.ai (Settings → Connectors → Add custom connector)
// with the link made in admin.gainora.co.uk → Settings. Any chat with Claude can then look up clients, work
// through the delivery checklist, build and edit websites, and leave notes, all recorded as done by Claude.
//   POST /api/mcp/<key>   Model Context Protocol over HTTP (JSON-RPC 2.0, JSON responses)
//
// What Claude can't see here: the client's customers (names, numbers, messages). Only counts.

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CLAUDE = 'Claude';

type Tool = { name: string; description: string; inputSchema: any; run: (args: any, s: AdminState) => Promise<unknown> };
const str = { type: 'string' };
const client = { type: 'string', description: 'The client: their email, business name, or website address (slug).' };

/** Objects merge, anything else (text, numbers, lists) replaces. */
function merge(base: any, patch: any): any {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch) || base === null || typeof base !== 'object' || Array.isArray(base)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base[k], v);
  return out;
}

const siteOf = (s: AdminState, ref: string) => {
  const acc = findAccount(s, ref);
  const row = s.sitesByEmail.get(acc.email);
  if (!row) throw new HttpError(404, `${acc.name} has no website yet. It's created when they open Your website in Command Centre with Launch & Grow on their plan.`);
  return { acc, row };
};
const siteSummary = (row: any) => {
  const data = withDefaults(row.data);
  return {
    live: !!row.published, liveUrl: liveOrigin(row) + '/', previewUrl: `${APP_ORIGIN()}/site/${row.slug}/`,
    unpublishedChanges: !!row.published && JSON.stringify(row.published) !== JSON.stringify(row.data),
    pages: pagesOf(data).map((p) => `/${p.path}`), checks: checks(data).filter((c) => c.level !== 'good'),
  };
};

const TOOLS: Tool[] = [
  {
    name: 'list_clients',
    description: 'Every Gainora client: packages, status, monthly revenue, set-up progress, overdue steps, next deadline and open website change requests. Start here.',
    inputSchema: { type: 'object', properties: { search: { ...str, description: 'Optional: part of a name or email.' } } },
    run: async ({ search }, s) => s.accounts.filter((a) => !search || `${a.name} ${a.email}`.toLowerCase().includes(String(search).toLowerCase())).map((a) => ({
      client: a.name, email: a.email, packages: a.packages.map((p) => PACKAGES[p].label), status: a.status, billing: a.billing, monthly_gbp: a.monthly,
      setup: `${a.progress.done}/${a.progress.total} steps`, overdue_steps: a.overdue, next_due: a.nextDue, open_change_requests: a.openRequests,
      website: a.site ? { address: a.site.slug, live: a.site.live, domain: a.site.domain } : null,
    })),
  },
  {
    name: 'get_client',
    description: 'One client in full: what Gainora knows about them, their packages, the delivery checklist with deadlines, recent notes, their website status and open change requests.',
    inputSchema: { type: 'object', properties: { client }, required: ['client'] },
    run: async ({ client: ref }, s) => {
      const acc = findAccount(s, ref);
      const rec = s.records.get(acc.email);
      const notes = await db<any[]>(`admin_log?select=at,author,kind,text&email=eq.${enc(acc.email)}&order=at.desc&limit=20`).catch(() => []);
      const row = s.sitesByEmail.get(acc.email);
      return {
        ...acc, record: rec ? { contact: rec.contact_name, phone: rec.phone, started_on: rec.started_on, setup_fee: rec.setup_fee, setup_paid: rec.setup_paid, notes: rec.notes } : null,
        tasks: s.tasks.filter((t) => t.email === acc.email).map((t) => ({ id: t.id, package: t.project, title: t.title, who: t.who, due_on: t.due_on, status: t.status, ticked_automatically: !!t.auto })),
        recent_notes: notes, website: row ? siteSummary(row) : null, change_requests: s.requests.filter((r) => r.email === acc.email),
      };
    },
  },
  {
    name: 'list_tasks',
    description: 'Delivery tasks across clients, soonest first. Filter by client, by who does it (gainora, client, claude) and by when (overdue, today, week = this week, all).',
    inputSchema: { type: 'object', properties: { client, who: { type: 'string', enum: ['gainora', 'client', 'claude'] }, when: { type: 'string', enum: ['overdue', 'today', 'week', 'all'] } } },
    run: async ({ client: ref, who, when = 'all' }, s) => {
      const today = ukToday();
      const email = ref ? findAccount(s, ref).email : null;
      return s.tasks.filter((t) => t.status !== 'done' && (!email || t.email === email) && (!who || t.who === who))
        .filter((t) => { const b = bucketOf(t, today); return when === 'all' || (when === 'overdue' ? b === 'overdue' : when === 'today' ? b === 'overdue' || b === 'today' : ['overdue', 'today', 'week'].includes(b)); })
        .map((t) => ({ id: t.id, client: t.client, package: t.project, title: t.title, detail: t.detail, who: t.who, due_on: t.due_on, status: t.status }));
    },
  },
  {
    name: 'update_task',
    description: 'Change a delivery task: mark it doing, waiting or done, move its deadline, or hand it to someone else. Add a note to say what was done.',
    inputSchema: { type: 'object', properties: { task_id: str, status: { type: 'string', enum: ['todo', 'doing', 'waiting', 'done'] }, due_on: { ...str, description: 'YYYY-MM-DD' }, who: { type: 'string', enum: ['gainora', 'client', 'claude'] }, note: str }, required: ['task_id'] },
    run: async ({ task_id, status, due_on, who, note }, s) => {
      const t = await saveTask({ id: task_id, ...(status ? { status } : {}), ...(due_on !== undefined ? { due_on } : {}), ...(who ? { who } : {}) }, CLAUDE, s);
      if (note) await log(t.email, CLAUDE, `${t.title}: ${note}`, 'work');
      return { id: t.id, title: t.title, status: t.status, due_on: t.due_on, who: t.who };
    },
  },
  {
    name: 'add_task',
    description: 'Add a task to a client’s delivery checklist.',
    inputSchema: { type: 'object', properties: { client, title: str, detail: str, due_on: { ...str, description: 'YYYY-MM-DD' }, who: { type: 'string', enum: ['gainora', 'client', 'claude'] }, package: { type: 'string', enum: ['launch', 'capture', 'command', 'other'] } }, required: ['client', 'title'] },
    run: async ({ client: ref, title, detail, due_on, who, package: project }, s) => {
      const acc = findAccount(s, ref);
      const t = await saveTask({ email: acc.email, title, detail, due_on, who: who ?? 'gainora', project: project ?? 'other' }, CLAUDE, s);
      return { id: t.id, client: acc.name, title: t.title, due_on: t.due_on };
    },
  },
  {
    name: 'start_package_setup',
    description: 'Create the set-up checklist for a package a client has bought (launch = Launch & Grow, capture = Capture & Convert, command = Command Centre), with deadlines counted from the start date.',
    inputSchema: { type: 'object', properties: { client, package: { type: 'string', enum: ['launch', 'capture', 'command'] }, start_date: { ...str, description: 'YYYY-MM-DD; today if left out.' } }, required: ['client', 'package'] },
    run: async ({ client: ref, package: pkg, start_date }, s) => {
      const acc = findAccount(s, ref);
      if (!(pkg in PACKAGES)) throw new HttpError(400, 'Unknown package.');
      const made = await startPackage(acc.email, pkg as Package, /^\d{4}-\d{2}-\d{2}$/.test(String(start_date)) ? start_date : ukToday(), CLAUDE);
      return { client: acc.name, steps_created: made };
    },
  },
  {
    name: 'add_note',
    description: 'Write a note on a client’s record (what was discussed, decided or done). Notes are dated and signed by Claude.',
    inputSchema: { type: 'object', properties: { client, text: str, kind: { type: 'string', enum: ['note', 'call', 'email', 'work'] } }, required: ['client', 'text'] },
    run: async ({ client: ref, text, kind }, s) => { const acc = findAccount(s, ref); await log(acc.email, CLAUDE, String(text), kind ?? 'note'); return { ok: true, client: acc.name }; },
  },
  {
    name: 'get_website',
    description: 'A client’s website draft in full (business details, services and prices, every block of wording, questions, reviews, design, booking link) plus its pages, live and preview addresses, and the checks to clear before publishing.',
    inputSchema: { type: 'object', properties: { client }, required: ['client'] },
    run: async ({ client: ref }, s) => { const { acc, row } = siteOf(s, ref); return { client: acc.name, ...siteSummary(row), draft: withDefaults(row.data) }; },
  },
  {
    name: 'update_website',
    description: [
      'Change a client’s website draft. Send only what changes, shaped like the draft from get_website; objects are merged and lists (services, reviews, faqs, areas, credentials) replace the whole list.',
      'Main parts: business {name, trade, phone, email, line1, town, postcode, areas[], hours{mon..sun: "9:00-17:30" or ""}, owner, founded, credentials[], differences[]}; services[{id, name, price, duration, summary, page}];',
      'copy {"home.title", "home.intro", "home.services", "cta.title", "cta.text", "about.title", "about.text", "contact.intro", "meta.description", "svc.<service id>.title", "svc.<service id>.text"}; faqs[{q, a}] or null for the suggested ones;',
      'look {fonts: classic|editorial|grand|friendly|modern|clean|geometric, heroLayout: split|full|centred, surface: light|tinted|deep, style: calm|warm|bold, accent: "#RRGGBB", sections {how, why, reviews, faq, gallery}}; booking {url, label}; reviewLink.',
      'Write in plain British English for the business’s customers. Never invent reviews, numbers, qualifications or claims; aesthetics clinics must not name prescription-only medicines. Visitors only see changes after publish_website.',
    ].join(' '),
    inputSchema: { type: 'object', properties: { client, changes: { type: 'object', description: 'The parts of the draft to change.' }, note: { ...str, description: 'What you changed and why, for the client’s record.' } }, required: ['client', 'changes'] },
    run: async ({ client: ref, changes, note }, s) => {
      const { acc, row } = siteOf(s, ref);
      if (!changes || typeof changes !== 'object') throw new HttpError(400, 'Send the changes as an object.');
      const next: Site = cleanSite({ ...merge(withDefaults(row.data), changes), slug: row.slug });
      const [saved] = await db<any[]>(`sites?id=eq.${row.id}`, { method: 'PATCH', body: { data: next, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
      await log(acc.email, CLAUDE, `Website draft updated${note ? `: ${note}` : '.'}`, 'work');
      return { client: acc.name, saved: true, ...siteSummary(saved) };
    },
  },
  {
    name: 'publish_website',
    description: 'Publish a client’s website draft so visitors see it. Only when the person you’re working with has asked for it to go live.',
    inputSchema: { type: 'object', properties: { client }, required: ['client'] },
    run: async ({ client: ref }, s) => {
      const { acc, row } = siteOf(s, ref);
      const data = cleanSite({ ...row.data, slug: row.slug });
      if (!data.business.name.trim() || (!data.business.phone.trim() && !data.business.email.trim())) throw new HttpError(400, 'The site needs a business name and a phone number or email before it can go live.');
      const at = new Date().toISOString();
      const [saved] = await db<any[]>(`sites?id=eq.${row.id}`, { method: 'PATCH', body: { data, published: data, published_at: at, updated_at: at }, prefer: 'return=representation' });
      await log(acc.email, CLAUDE, 'Website published.', 'work');
      return { client: acc.name, published: true, ...siteSummary(saved) };
    },
  },
  {
    name: 'list_change_requests',
    description: 'Website changes clients have asked Gainora to make and that aren’t done yet.',
    inputSchema: { type: 'object', properties: { client } },
    run: async ({ client: ref }, s) => { const email = ref ? findAccount(s, ref).email : null; return s.requests.filter((r) => !email || r.email === email); },
  },
  {
    name: 'complete_change_request',
    description: 'Mark a client’s change request done once the change is made (and published, if they should see it). The client gets an email with your reply.',
    inputSchema: { type: 'object', properties: { request_id: str, reply: { ...str, description: 'A short, friendly note for the client about what changed.' } }, required: ['request_id'] },
    run: async ({ request_id, reply }, s) => {
      if (!/^[0-9a-f-]{36}$/i.test(String(request_id))) throw new HttpError(400, 'Unknown request.');
      const r = s.requests.find((x) => x.id === request_id);
      if (!r) throw new HttpError(404, 'That request is already done or doesn’t exist.');
      const [done] = await db<any[]>(`site_requests?id=eq.${request_id}`, { method: 'PATCH', body: { status: 'done', done_at: new Date().toISOString(), reply: String(reply ?? '').slice(0, 1000) }, prefer: 'return=representation' });
      const uid = s.userIdByEmail.get(r.email);
      const to = uid ? await ownerEmail(uid) : null;
      if (to) await sendEmail(to, 'Your website change is done', [`Gainora has made the change you asked for: “${done.text}”.`, String(reply ?? '')].filter(Boolean), { label: 'See your website', url: `${APP_ORIGIN()}/website` }).catch(() => {});
      await log(r.email, CLAUDE, `Change request done: ${done.text}`, 'work');
      return { done: true, client: r.client };
    },
  },
  /* ---------- Sales ---------- */
  {
    name: 'list_prospects',
    description: 'Businesses on Gainora’s outreach list, with their stage (new, contacted, replied, call, proposal, won, lost), company type and when the next message is due.',
    inputSchema: { type: 'object', properties: { stage: { ...str, enum: STAGES.map((x) => x.id) }, search: { ...str, description: 'Optional: part of a business name, town or email.' } } },
    run: async ({ stage, search }) => {
      const rows = await db<Prospect[]>('prospects?select=*&order=updated_at.desc&limit=5000');
      const q = String(search || '').toLowerCase();
      return rows.filter((p) => (!stage || p.stage === stage) && (!q || `${p.business_name} ${p.town} ${p.email}`.toLowerCase().includes(q))).slice(0, 200).map((p) => ({
        id: p.id, business: p.business_name, contact: p.contact_name, role: p.role, email: p.email, phone: p.phone, website: p.website, town: p.town, industry: p.industry,
        company_type: p.company_type, stage: p.stage, next_message_due: p.next_on, call_at: p.call_at, personal_line: p.personal_line, note: p.note,
      }));
    },
  },
  {
    name: 'list_followups',
    description: 'Outreach messages due today or earlier, each with the drafted message. You can suggest a better personal line with update_prospect; Adelin sends the messages from the admin (or they go automatically if he switched that on).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [rows, seqs, settings] = await Promise.all([db<Prospect[]>('prospects?select=*&next_on=not.is.null&limit=5000'), sequences(), getSettings()]);
      const bySeq = new Map(seqs.map((x) => [x.id, x]));
      return dueFollowUps(rows, ukToday()).map((p) => ({ id: p.id, business: p.business_name, due: p.next_on, personal_line: p.personal_line, draft: draftFor(p, bySeq.get(p.sequence_id ?? ''), settings.outreach) }));
    },
  },
  {
    name: 'add_prospects',
    description: 'Add businesses to the outreach list (up to 50 at a time). Businesses only, never private individuals, with details from the business’s own public website, its Google listing or Companies House. Set company_type from Companies House: limited and llp can be emailed with an opt-out; sole_trader and partnership need consent first; unknown means check before emailing. personal_line is one true, specific sentence about their business for the first message; leave it empty rather than invent one. Duplicates and do-not-contact addresses are skipped.',
    inputSchema: { type: 'object', properties: { prospects: { type: 'array', maxItems: 50, items: { type: 'object', properties: {
      business_name: str, contact_name: str, role: str, email: str, phone: str, website: str, instagram: str, linkedin: str, town: str, industry: str,
      company_type: { ...str, enum: ['limited', 'llp', 'sole_trader', 'partnership', 'unknown'] }, personal_line: str, note: str, source: { ...str, description: 'Where the details came from.' },
    }, required: ['business_name'] } } }, required: ['prospects'] },
    run: async ({ prospects }) => {
      const list = (Array.isArray(prospects) ? prospects : []).slice(0, 50);
      const existing = await db<Prospect[]>('prospects?select=id,business_name,email,website,phone&limit=20000');
      const blocked = await blockedSet();
      const fresh: any[] = []; const skipped: string[] = [];
      for (const raw of list) {
        const r = cleanProspect({ ...raw, stage: 'new', source: raw?.source || 'Added by Claude' });
        if ([...existing, ...fresh].some((x) => sameProspect(r, x))) { skipped.push(`${r.business_name}: already on the list`); continue; }
        if (r.email && (blocked.has(r.email) || blocked.has(r.email.split('@')[1]))) { skipped.push(`${r.business_name}: asked not to be contacted`); continue; }
        fresh.push({ id: randomUUID(), step: 0, ...r, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
      if (fresh.length) await insert('prospects', fresh);
      return { added: fresh.map((f) => ({ id: f.id, business: f.business_name })), skipped };
    },
  },
  {
    name: 'update_prospect',
    description: 'Update a prospect: their stage, a note, the personal line for their first message, company type, contact details, or a booked call time (ISO date and time). Doesn’t send anything.',
    inputSchema: { type: 'object', properties: {
      id: str, stage: { ...str, enum: STAGES.map((x) => x.id) }, note: str, personal_line: str, company_type: { ...str, enum: ['limited', 'llp', 'sole_trader', 'partnership', 'unknown'] },
      contact_name: str, role: str, email: str, phone: str, call_at: str, lost_reason: str,
    }, required: ['id'] },
    run: async ({ id: pid, ...rest }) => {
      if (!/^[0-9a-f-]{36}$/i.test(String(pid))) throw new HttpError(400, 'Unknown prospect.');
      const allowed = ['stage', 'note', 'personal_line', 'company_type', 'contact_name', 'role', 'email', 'phone', 'call_at', 'lost_reason'];
      const patch = cleanProspect(Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k))));
      if (patch.stage && !['new', 'contacted'].includes(patch.stage)) (patch as any).next_on = null;
      const [p] = await db<Prospect[]>(`prospects?id=eq.${pid}`, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
      if (!p) throw new HttpError(404, 'That prospect no longer exists.');
      return { id: p.id, business: p.business_name, stage: p.stage, personal_line: p.personal_line };
    },
  },
  {
    name: 'get_prices',
    description: 'Gainora’s price book: every package with its set-up, monthly and one-off price (excluding VAT) and minimum term. Use the keys in create_proposal.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await priceBook()).filter((p) => p.active).map((p) => ({ key: p.key, name: p.name, setup_gbp: p.setup, monthly_gbp: p.monthly, one_off_gbp: p.one_off, minimum_months: p.minimum_months, included: p.included, description: p.description })),
  },
  {
    name: 'create_proposal',
    description: 'Draft a proposal from the price book. It is NOT sent: Adelin checks it and sends it from the admin (Sales → Proposals). Returns the link the client will see.',
    inputSchema: { type: 'object', properties: {
      business_name: str, contact_name: str, email: str, prospect_id: { ...str, description: 'Optional: the prospect it’s for (from list_prospects).' },
      packages: { type: 'array', items: str, description: 'Price book keys, e.g. ["launch-grow"].' }, note: { ...str, description: 'A short personal note shown at the top.' }, trial_days: { type: 'number' },
    }, required: ['business_name', 'packages'] },
    run: async ({ business_name, contact_name, email, prospect_id, packages, note, trial_days }) => {
      const book = new Map((await priceBook()).filter((p) => p.active).map((p) => [p.key, p]));
      const unknown = (packages ?? []).filter((k: string) => !book.has(k));
      if (unknown.length) throw new HttpError(400, `Not in the price book: ${unknown.join(', ')}. Use get_prices for the keys.`);
      const items = cleanItems((packages ?? []).map((k: string) => fromPriceItem(book.get(k)!)));
      const [p] = await insert<any>('proposals', {
        id: randomUUID(), token: randomBytes(18).toString('base64url'), status: 'draft', created_by: CLAUDE, created_at: new Date().toISOString(),
        email: String(email || '').trim().toLowerCase().slice(0, 200), business_name: String(business_name).slice(0, 160), contact_name: String(contact_name || '').slice(0, 120),
        items, trial_days: Math.max(0, Math.min(90, Number(trial_days) || 0)), note: String(note || '').slice(0, 2000), expires_on: addDays(ukToday(), 14),
        prospect_id: prospect_id && /^[0-9a-f-]{36}$/i.test(String(prospect_id)) ? prospect_id : null,
      });
      const t = proposalTotals(items);
      return { draft: true, id: p.id, link: proposalUrl(p.token), due_today: money(t.today), monthly: money(t.monthly), note: 'Draft only. Adelin sends it from the admin.' };
    },
  },
];

const INSTRUCTIONS = 'Gainora’s admin: Gainora’s clients (businesses), what they bought, the delivery checklist with deadlines, their websites and change requests; and sales: the outreach list, follow-ups due, the price book and draft proposals. Start with list_clients, list_tasks or list_followups. Everything you change is recorded as done by Claude. Ask before publishing a website or emailing a client (complete_change_request emails them). Nothing here sends outreach or proposals: Adelin does that from the admin.';

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg: any): Promise<any | null> {
  const id = msg?.id;
  const isNotification = id === undefined || id === null;
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isNotification ? null : rpcError(id ?? null, -32600, 'Invalid request');
  if (isNotification) return null;   // notifications/initialized and the like need no answer
  if (msg.method === 'initialize') {
    const asked = String(msg.params?.protocolVersion || '');
    return rpc(id, { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'gainora-admin', version: '1.0.0' }, instructions: INSTRUCTIONS });
  }
  if (msg.method === 'ping') return rpc(id, {});
  if (msg.method === 'tools/list') return rpc(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (msg.method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === msg.params?.name);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${msg.params?.name}`);
    try {
      const out = await tool.run(msg.params?.arguments ?? {}, await loadState());
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], isError: false });
    } catch (e: any) {
      const text = e instanceof HttpError ? e.message : 'That didn’t work. Try again in a minute.';
      if (!(e instanceof HttpError)) console.error('[gainora] mcp', tool.name, e?.message);
      return rpc(id, { content: [{ type: 'text', text }], isError: true });
    }
  }
  return rpcError(id, -32601, `Method not found: ${msg.method}`);
}

export default async (req: Request) => {
  const key = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  if (!(await checkKey(key))) return new Response(JSON.stringify({ error: 'This connector link isn’t valid. Make a new one in Gainora admin → Settings.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if (req.method === 'GET') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  let payload: any;
  try { payload = JSON.parse(await req.text()); } catch { return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 }); }
  const batch = Array.isArray(payload);
  const answers = (await Promise.all((batch ? payload : [payload]).map(handle))).filter((a) => a !== null);
  if (!answers.length) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(batch ? answers : answers[0]), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
export const config = { path: '/api/mcp/*' };
