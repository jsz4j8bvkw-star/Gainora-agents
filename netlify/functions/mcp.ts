import { db, enc, HttpError } from '../lib/core';
import { checkKey, findAccount, loadState, log, saveRecord, saveTask, startPackage, type AdminState } from '../lib/admin';
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
import { askUrl, saveAsk } from '../lib/asks';
import { answersText, ASK_TEMPLATES, type Ask, MAX_QUESTIONS, progressOf, templateFor } from '../../shared/admin/asks';
import { addDays } from '../../shared/admin/templates';
import { deleteBlock, deleteTask as deleteMeTask, findBlock, findTask, getRoutine, getSettings as getMeSettings, getTasks, plan as dayPlan, saveBlock, saveDay, saveSettings as saveMeSettings, saveTask as saveMeTask, weeks as myWeeks } from '../lib/me';
import { anchorFor, BLOCK_KINDS, blocksFor, daysLabel, isDate, type MeTask, type Plan, REPEATS, SCORE_FIELDS, TASK_CATEGORIES, taskGroups } from '../../shared/admin/me';

// The Claude connector for Gainora's admin. Added once in claude.ai (Settings → Connectors → Add custom connector)
// with the link made in admin.gainora.co.uk → Settings. Any chat with Claude can then look up clients, work
// through the delivery checklist, build and edit websites, and leave notes, all recorded as done by Claude.
//   POST /api/mcp/<key>   Model Context Protocol over HTTP (JSON-RPC 2.0, JSON responses)
//
// What Claude can't see here: the client's customers (names, numbers, messages). Only counts.

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CLAUDE = 'Claude';

/** light: the tool never looks at clients, so the whole admin state isn't loaded for it. */
type Tool = { name: string; description: string; inputSchema: any; light?: boolean; run: (args: any, s: AdminState) => Promise<unknown> };
const str = { type: 'string' };
const QUESTION_ITEM = { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, type: { type: 'string', enum: ['text', 'long', 'links', 'photos', 'yesno', 'choice', 'multi'] }, options: { type: 'array', items: { type: 'string' }, maxItems: 12 }, help: { type: 'string' }, group: { type: 'string' } }, required: ['label'] };
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
    // For a site built with Claude Code and hosted elsewhere: what it pastes in so visits, taps and enquiries reach Command Centre.
    claudeCode: {
      siteId: row.id,
      trackingTag: `<script src="${APP_ORIGIN()}/api/site-track/${row.id}.js" defer></script>`,
      enquiryFormAction: `${APP_ORIGIN()}/api/site-enquiry/${row.id}`,
      note: 'Tracking and enquiries only work once the site is published in the admin. Set external.url to the live address, then publish.',
    },
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
        questions_sent: (await db<Ask[]>(`client_asks?select=*&email=eq.${enc(acc.email)}&status=neq.cancelled&order=created_at.desc&limit=20`).catch(() => [])).map(askSummary),
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
    name: 'update_client',
    description: 'Update what Gainora keeps about a client: their business name, contact name (used to greet them in emails), phone, status (onboarding, active, paused, left), start date, set-up fee and whether it’s paid. Only what you send changes.',
    inputSchema: { type: 'object', properties: {
      client, business_name: str, contact_name: str, phone: str, status: { type: 'string', enum: ['onboarding', 'active', 'paused', 'left'] },
      started_on: { ...str, description: 'YYYY-MM-DD' }, setup_fee: { type: 'number', description: '£, 0 for no charge' }, setup_paid: { type: 'boolean' },
    }, required: ['client'] },
    run: async ({ client: ref, ...patch }, s) => {
      const acc = findAccount(s, ref);
      const keys = ['business_name', 'contact_name', 'phone', 'status', 'started_on', 'setup_fee', 'setup_paid'].filter((k) => patch[k] !== undefined);
      if (!keys.length) throw new HttpError(400, 'Nothing to change.');
      const rec = await saveRecord(acc.email, Object.fromEntries(keys.map((k) => [k, patch[k]])));
      await log(acc.email, CLAUDE, `Updated their details: ${keys.map((k) => k.replace(/_/g, ' ')).join(', ')}.`, 'work');
      return { client: rec.business_name || acc.name, contact: rec.contact_name, phone: rec.phone, status: rec.status, started_on: rec.started_on, setup_fee: rec.setup_fee, setup_paid: rec.setup_paid };
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
      'look {fonts: classic|editorial|grand|friendly|modern|clean|geometric, heroLayout: split|full|centred, surface: light|tinted|deep, style: calm|warm|bold, accent: "#RRGGBB", sections {how, why, reviews, faq, gallery}}; booking {url, label}; reviewLink; external {url} = the address of a site Gainora built with Claude Code and hosts elsewhere (its builder copy then forwards there; empty = the builder renders the site).',
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
  /* ---------- Asking clients for details ---------- */
  {
    name: 'list_client_questions',
    description: 'Questions Gainora has sent clients (for example the website questions) and where each stands: draft, sent, opened, answered. Answered ones include every answer and the photo links, ready to build from.',
    inputSchema: { type: 'object', properties: { client: { ...client, description: 'Optional: one client.' }, status: { type: 'string', enum: ['waiting', 'answered', 'all'] } } },
    run: async ({ client: ref, status = 'all' }, s) => {
      const email = ref ? findAccount(s, ref).email : null;
      const rows = await db<Ask[]>(`client_asks?select=*&status=neq.cancelled${email ? `&email=eq.${enc(email)}` : ''}&order=created_at.desc&limit=100`);
      const names = new Map(s.accounts.map((a) => [a.email, a.name]));
      return rows.filter((a) => status === 'all' || (status === 'answered' ? a.status === 'answered' : a.status === 'sent' || a.status === 'opened'))
        .map((a) => ({ client: names.get(a.email) ?? a.email, ...askSummary(a) }));
    },
  },
  {
    name: 'draft_client_questions',
    description: `Prepare questions for a client: a template (${ASK_TEMPLATES.map((t) => t.key).join(', ')}) or your own questions, plus extra_questions added after the template's. answers fills in what the client already told you (question id → answer), for them to check. It is NOT sent: Adelin checks it and sends it from the client's page in the admin (Questions). Each question: {id?, label, type: text | long | links | photos | yesno | choice | multi, options? (for choice and multi), help?, group?}. The website template's question ids: ${templateFor('website').questions.map((q) => q.id).join(', ')}.`,
    inputSchema: { type: 'object', properties: {
      client, template: { type: 'string', enum: ASK_TEMPLATES.map((t) => t.key) }, title: str, intro: str,
      questions: { type: 'array', maxItems: MAX_QUESTIONS, items: QUESTION_ITEM, description: 'Replaces the template’s questions.' },
      extra_questions: { type: 'array', maxItems: 20, items: QUESTION_ITEM, description: 'Added after the template’s questions.' },
      answers: { type: 'object', description: 'Answers to fill in already: question id → answer. For multi, separate the ticked options with a new line.' },
      due_on: { ...str, description: 'YYYY-MM-DD; a week from today if left out.' },
    }, required: ['client'] },
    run: async ({ client: ref, template, title, intro, questions, extra_questions, answers, due_on }, s) => {
      const acc = findAccount(s, ref);
      const a = await saveAsk({ email: acc.email, template: template || (questions?.length ? 'custom' : 'website'), title, intro, questions, extra_questions, answers, due_on }, CLAUDE);
      await log(acc.email, CLAUDE, `Drafted questions for them: ${a.title} (${a.questions.length}). Not sent yet.`, 'work');
      return { draft: true, client: acc.name, title: a.title, questions: a.questions.length, filled_in: Object.keys(a.answers).length, due_on: a.due_on, note: 'Draft only. Adelin sends it from their client page in the admin (Questions).' };
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
      // The database takes a batch only when every row has the same fields, so fill the gaps.
      const keys = [...new Set(fresh.flatMap((f) => Object.keys(f)))];
      const rows = fresh.map((f) => Object.fromEntries(keys.map((k) => [k, f[k] ?? (k === 'company_type' ? 'unknown' : '')])));
      if (rows.length) await insert('prospects', rows);
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
    description: 'Gainora’s price book: every package with its set-up, monthly and one-off price (full prices: Gainora isn’t VAT-registered) and minimum term. Use the keys in create_proposal.',
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


/* ---------- My day: Adelin's own routine, check-ins, to-do list, gym and trading journal ---------- */

const day = { ...str, description: 'YYYY-MM-DD; today (UK) if left out.' };
const dayOf = (d: unknown) => (isDate(d) ? d : ukToday());
const planSummary = (p: Plan) => ({
  date: p.date, day: p.dayName, level: p.status.label, minimum_day: p.status.minimum.map((c) => `${c.ok ? 'done' : 'not yet'}: ${c.label}`), good_day: p.status.good.map((c) => `${c.ok ? 'done' : 'not yet'}: ${c.label}`),
  streak_days: p.streak, gym: { session: p.gym.label, done: p.gym.done, minutes: p.gym.minutes, usual_minutes: p.gym.usualMinutes },
  routine: p.blocks.map((b) => ({ id: b.id, time: b.finish ? `${b.start}-${b.finish}` : b.start, title: b.title, kind: b.kind, done: b.ticked })),
  must_dos: p.day.must_dos, scoreboard: { ...Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, p.day[f.key]])), energy: p.day.energy, followups_cleared: p.day.followups_cleared },
  targets: { minimum_contacts: p.settings.minimum.contacts, good_contacts: p.settings.good.contacts, weekly_contacts: p.settings.weeklyContacts },
  this_week: p.week, energy_warning: p.energyWarning, notes: p.day.notes, trading: p.day.trading,
  sales_followups_due: p.followUpsDue, client_steps_due: p.clientTasks.map((t) => `${t.client}: ${t.title} (due ${t.due_on})`),
  my_tasks_due: p.tasks.due.map(taskOut), my_tasks_open: p.tasks.open, my_tasks_without_date: p.tasks.undated,
});
const taskOut = (t: MeTask & { next_due?: string | null }) => ({ id: t.id, title: t.title, category: t.category, due_on: t.due_on, repeat: t.repeat, done: t.done, notes: t.notes || undefined, ...(t.next_due !== undefined ? { next_due: t.next_due } : {}) });
const SCORE_PROPS = Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, { type: 'number', description: `${f.label} that day (the total, not an increase).` }]));

const ME_TOOLS: Tool[] = [
  {
    name: 'get_my_day', light: false,
    description: 'Adelin’s day: the routine blocks with what’s ticked, today’s gym session, the three must-dos, the scoreboard, whether the minimum and good day are reached, the streak, this week’s totals, the energy warning, notes, trading journal, sales follow-ups due, client steps due and his personal tasks due. Use it first in a morning or evening check-in.',
    inputSchema: { type: 'object', properties: { date: day } },
    run: async ({ date }, s) => planSummary(await dayPlan(dayOf(date), s)),
  },
  {
    name: 'update_my_day', light: true,
    description: 'Log Adelin’s check-in for a day: the three must-dos (morning), scoreboard numbers and energy 1 to 10 (evening), follow-ups cleared, routine blocks done (tick, by block id or part of the title, e.g. "gym", "in bed", "walk-ins"), and notes. Only what you send changes. Numbers are the day’s totals. append_note adds a timed line to the day’s notes; notes replaces them.',
    inputSchema: { type: 'object', properties: {
      date: day, must_dos: { type: 'array', items: str, maxItems: 3 }, ...SCORE_PROPS, energy: { type: 'number', description: '1 to 10.' }, followups_cleared: { type: 'boolean' },
      tick: { type: 'array', items: str, description: 'Blocks done.' }, untick: { type: 'array', items: str, description: 'Blocks not done after all.' },
      append_note: str, notes: { ...str, description: 'Replaces the day’s notes.' },
    } },
    run: async ({ date, tick, untick, ...rest }) => {
      const d = dayOf(date);
      const routine = blocksFor(await getRoutine(), d);
      const ticks: Record<string, boolean> = {};
      for (const ref of Array.isArray(tick) ? tick : []) ticks[findBlock(routine, ref).id] = true;
      for (const ref of Array.isArray(untick) ? untick : []) ticks[findBlock(routine, ref).id] = false;
      const keys = ['must_dos', ...SCORE_FIELDS.map((f) => f.key), 'energy', 'followups_cleared', 'append_note', 'notes'];
      const patch: any = Object.fromEntries(keys.filter((k) => rest[k] !== undefined).map((k) => [k, rest[k]]));
      if (Object.keys(ticks).length) patch.ticks = ticks;
      if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change.');
      await saveDay(d, patch);
      return planSummary(await dayPlan(d, null));
    },
  },
  {
    name: 'log_gym', light: true,
    description: 'Log a gym session: done or not, minutes in the gym (not travel), and a note. session overrides the split’s session for that day only (e.g. if he trained legs instead).',
    inputSchema: { type: 'object', properties: { date: day, done: { type: 'boolean' }, minutes: { type: 'number' }, session: str, note: str } },
    run: async ({ date, done, minutes, session, note }) => {
      const d = dayOf(date);
      const gym = Object.fromEntries(Object.entries({ done, minutes, session, note }).filter(([, v]) => v !== undefined));
      if (!Object.keys(gym).length) throw new HttpError(400, 'Nothing to log.');
      const saved = await saveDay(d, { gym });
      return { date: d, gym: saved.gym };
    },
  },
  {
    name: 'update_gym_plan', light: true,
    description: 'Change the gym plan: the split (one session a day, in order, repeating), which session today is (1 = the first in the split), the usual session length in minutes, and what ends every session (e.g. heavy bag).',
    inputSchema: { type: 'object', properties: { split: { type: 'array', items: str, maxItems: 14 }, today_session: { type: 'number', description: 'Position in the split, from 1.' }, usual_minutes: { type: 'number' }, finisher: str } },
    run: async ({ split, today_session, usual_minutes, finisher }) => {
      const cur = await getMeSettings();
      const nextSplit = Array.isArray(split) && split.length ? split.map(String) : cur.gymSplit;
      const patch: any = { gymSplit: nextSplit };
      if (today_session !== undefined) patch.gymAnchor = anchorFor(nextSplit, ukToday(), Math.max(1, Math.round(Number(today_session))) - 1);
      if (usual_minutes !== undefined) patch.gymMinutes = usual_minutes;
      if (finisher !== undefined) patch.finisher = finisher;
      const s = await saveMeSettings(patch);
      return { split: s.gymSplit, usual_minutes: s.gymMinutes, finisher: s.finisher, today: (await dayPlan(ukToday(), null)).gym.label };
    },
  },
  {
    name: 'log_trading', light: true,
    description: 'Add to Adelin’s trading journal for a day: news day (no trading, watch only), traded or not, the setup, the result and notes. Only what you send changes. Write what he tells you; never give trading advice or predictions.',
    inputSchema: { type: 'object', properties: { date: day, news_day: { type: 'boolean' }, traded: { type: 'boolean' }, setup: str, result: str, notes: str } },
    run: async ({ date, ...t }) => {
      const trading = Object.fromEntries(['news_day', 'traded', 'setup', 'result', 'notes'].filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
      if (!Object.keys(trading).length) throw new HttpError(400, 'Nothing to log.');
      const saved = await saveDay(dayOf(date), { trading });
      return { date: dayOf(date), trading: saved.trading };
    },
  },
  {
    name: 'update_trading_rules', light: true,
    description: 'Replace Adelin’s written trading rules (what counts as a news day, setups, risk, when he stops). Send the whole text, one rule a line. Write his rules in his words; don’t add your own.',
    inputSchema: { type: 'object', properties: { rules: str }, required: ['rules'] },
    run: async ({ rules }) => ({ rules: (await saveMeSettings({ tradingRules: String(rules ?? '') })).tradingRules }),
  },
  {
    name: 'get_my_routine', light: true,
    description: 'Adelin’s repeating day: every routine block with its time, days and kind, plus the gym split, minimum and good day targets and his trading rules.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const settings = await getMeSettings();
      const routine = await getRoutine(settings);
      return {
        blocks: routine.sort((a, b) => a.start.localeCompare(b.start) || a.sort - b.sort).map((b) => ({ id: b.id, start: b.start, end: b.finish, title: b.title, detail: b.detail || undefined, days: daysLabel(b.days), day_numbers: b.days, kind: b.kind })),
        gym: { split: settings.gymSplit, usual_minutes: settings.gymMinutes, finisher: settings.finisher },
        targets: { minimum_contacts: settings.minimum.contacts, good_contacts: settings.good.contacts, weekly_contacts: settings.weeklyContacts },
        trading_rules: settings.tradingRules,
      };
    },
  },
  {
    name: 'update_routine_block', light: true,
    description: `Add, change or delete a block of Adelin’s routine. Without block, a new block is added (start and title needed). Times are 24-hour HH:MM. days: 1 = Monday … 7 = Sunday. kind is one of ${BLOCK_KINDS.map((k) => k.id).join(', ')}; gym, sleep and followups blocks count towards the minimum day. Moving the gym or breakfast once the session length is known is a typical use.`,
    inputSchema: { type: 'object', properties: {
      block: { ...str, description: 'The block’s id or part of its title. Leave out to add a new block.' }, start: str, end: { ...str, description: 'HH:MM, or empty for none.' }, title: str, detail: str,
      days: { type: 'array', items: { type: 'number' } }, kind: { ...str, enum: BLOCK_KINDS.map((k) => k.id) }, delete: { type: 'boolean' },
    } },
    run: async ({ block, start, end, title, detail, days, kind, delete: del }) => {
      const routine = await getRoutine();
      const target = block ? findBlock(routine, block) : null;
      if (del) { if (!target) throw new HttpError(400, 'Say which block to delete.'); await deleteBlock(target.id); return { deleted: `${target.start} ${target.title}` }; }
      const input: any = { ...(target ? { id: target.id } : {}) };
      if (start !== undefined) input.start = start;
      if (end !== undefined) input.finish = end === '' ? null : end;
      if (title !== undefined) input.title = title;
      if (detail !== undefined) input.detail = detail;
      if (days !== undefined) input.days = days;
      if (kind !== undefined) input.kind = kind;
      const b = await saveBlock(input);
      return { id: b.id, start: b.start, end: b.finish, title: b.title, days: daysLabel(b.days), kind: b.kind };
    },
  },
  {
    name: 'list_my_tasks', light: true,
    description: 'Adelin’s personal to-do list (business, trading, gym, personal), grouped: late, today, this week, later, no date.',
    inputSchema: { type: 'object', properties: { category: { ...str, enum: TASK_CATEGORIES.map((c) => c.id) }, include_done: { type: 'boolean' } } },
    run: async ({ category, include_done }) => {
      const all = (await getTasks(!!include_done)).filter((t) => !category || t.category === category);
      return { groups: taskGroups(all, ukToday()).map((g) => ({ group: g.label, tasks: g.tasks.map(taskOut) })), ...(include_done ? { done: all.filter((t) => t.done).slice(0, 50).map(taskOut) } : {}) };
    },
  },
  {
    name: 'add_my_task', light: true,
    description: `Add a task to Adelin’s personal to-do list. repeat: ${REPEATS.map((r) => r.id).join(', ')} (a repeating task moves to its next date when ticked).`,
    inputSchema: { type: 'object', properties: { title: str, notes: str, due_on: { ...str, description: 'YYYY-MM-DD, optional.' }, category: { ...str, enum: TASK_CATEGORIES.map((c) => c.id) }, repeat: { ...str, enum: REPEATS.map((r) => r.id) } }, required: ['title'] },
    run: async (args) => taskOut(await saveMeTask(args, CLAUDE)),
  },
  {
    name: 'update_my_task', light: true,
    description: 'Change or complete one of Adelin’s personal tasks (by id or part of its title): done true/false, title, notes, due date (null for none), category, repeat, or delete.',
    inputSchema: { type: 'object', properties: { task: { ...str, description: 'The task’s id or part of its title.' }, done: { type: 'boolean' }, title: str, notes: str, due_on: { type: ['string', 'null'] }, category: { ...str, enum: TASK_CATEGORIES.map((c) => c.id) }, repeat: { ...str, enum: REPEATS.map((r) => r.id) }, delete: { type: 'boolean' } }, required: ['task'] },
    run: async ({ task, delete: del, ...rest }) => {
      const t = findTask(await getTasks(true), task);
      if (del) { await deleteMeTask(t.id); return { deleted: t.title }; }
      const patch = Object.fromEntries(Object.entries(rest).filter(([k, v]) => v !== undefined && ['done', 'title', 'notes', 'due_on', 'category', 'repeat'].includes(k)));
      if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change.');
      return taskOut(await saveMeTask({ id: t.id, ...patch }, CLAUDE));
    },
  },
  {
    name: 'get_my_week', light: true,
    description: 'Adelin’s last few weeks: contacts against the weekly target, conversations, sales chats, proposals, new clients, days at minimum and good, average energy; the last two weeks day by day; the streak; and a warning if energy has averaged under 6 for two weeks running.',
    inputSchema: { type: 'object', properties: { weeks: { type: 'number', description: '1 to 26, default 4.' } } },
    run: async ({ weeks: n }) => myWeeks(Number(n) || 4),
  },
];

const INSTRUCTIONS = 'Gainora’s admin: Gainora’s clients (businesses), what they bought, the delivery checklist with deadlines, their websites and change requests; and sales: the outreach list, follow-ups due, the price book and draft proposals. Start with list_clients, list_tasks, list_client_questions or list_followups. Everything you change is recorded as done by Claude. Ask before publishing a website or emailing a client (complete_change_request emails them). Nothing here sends outreach, proposals or questions to clients: Adelin does that from the admin. My day is Adelin’s own routine, check-ins, scoreboard, to-do list, gym and trading journal: start with get_my_day, and log what he tells you (update_my_day, log_gym, log_trading, add_my_task). Measure what he did, not results; on a bad day, the minimum day is the goal.';

function askSummary(a: Ask) {
  const p = progressOf(a);
  return {
    id: a.id, title: a.title, status: a.status, due_on: a.due_on, sent_to: a.sent_to || null, sent_at: a.sent_at, answered_at: a.answered_at,
    progress: `${p.answered} of ${p.total} answered`, link: a.status === 'draft' ? null : askUrl(a.token),
    answers: a.status === 'answered' || p.answered ? answersText(a) : null,
    photos: a.files.map((f) => f.url),
  };
}

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
  if (msg.method === 'tools/list') return rpc(id, { tools: [...TOOLS, ...ME_TOOLS].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (msg.method === 'tools/call') {
    const tool = [...TOOLS, ...ME_TOOLS].find((t) => t.name === msg.params?.name);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${msg.params?.name}`);
    try {
      const out = await tool.run(msg.params?.arguments ?? {}, tool.light ? (null as unknown as AdminState) : await loadState());
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
  // A wrong or revoked link looks like any address that doesn't exist: it says nothing about what's behind it.
  if (!(await checkKey(key))) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
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
