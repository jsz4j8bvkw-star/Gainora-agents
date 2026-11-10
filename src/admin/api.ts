// The admin app's calls to /api/admin, and a demo with sample clients for trying it without real data.
import { callFunction } from '../lib/live';
import type { AccountRecord, AccountSummary, AdminTask, CostEntry, LogEntry, Package } from '../../shared/admin/model';
import { board, type Bucket, ukToday } from '../../shared/admin/board';
import { DEFAULT_RATES, monthCosts, type CostLine, type RateCard, type Usage } from '../../shared/admin/money';
import { addDays, tasksFor, withAuto, type AutoCheck } from '../../shared/admin/templates';

declare const __DEMO__: boolean;

export type ClientTask = AdminTask & { client: string };
export interface Request { id: string; at: string; page: string; text: string; email: string; client: string; slug: string }
export interface Overview {
  today: string; me: string; accounts: AccountSummary[]; tasks: ClientTask[]; board: Record<Bucket, ClientTask[]>; requests: Request[];
  totals: { clients: number; monthly: number; overdue: number; notStarted: number; unpaidSetup: number };
}
export interface MonthCost { month: string; usage: Usage; manual: CostEntry[]; lines: CostLine[]; total: number; revenue: number | null; margin: number | null }
export interface AccountDetail {
  account: AccountSummary; record: AccountRecord | null; tasks: ClientTask[]; log: LogEntry[];
  site: { slug: string; domain: string | null; live: boolean; publishedAt: string | null; fixes: number } | null;
  capture: { completed: boolean; business: string; type: string; booking: string } | null;
  enquiries: { id: string; created_at: string; channel: string; name: string; status: string; summary: string; kind: string; urgency: string }[];
  siteEnquiries: { id: string; at: string; name: string; service: string; source: string }[];
  requests: Request[]; costs: MonthCost[];
}
export interface MoneyRow { email: string; name: string; packages: Package[]; revenue: number | null; costs: number; margin: number | null; lines: CostLine[] }
export interface Money { month: string; rows: MoneyRow[]; totals: { revenue: number; costs: number; margin: number } }
export interface KeyRow { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

export interface AdminApi {
  mode: 'live' | 'demo';
  overview(): Promise<Overview>;
  account(email: string): Promise<AccountDetail>;
  saveAccount(email: string, patch: Partial<AccountRecord>): Promise<AccountRecord>;
  start(email: string, pkg: Package, start: string): Promise<number>;
  saveTask(task: Partial<AdminTask>): Promise<AdminTask>;
  deleteTask(id: string): Promise<void>;
  addLog(email: string, kind: LogEntry['kind'], text: string): Promise<void>;
  addCost(email: string, month: string, item: string, amount: number): Promise<void>;
  deleteCost(id: string): Promise<void>;
  money(month: string): Promise<Money>;
  settings(): Promise<{ rates: RateCard; defaults: RateCard; team: string[] }>;
  saveSettings(rates: RateCard): Promise<RateCard>;
  keys(): Promise<KeyRow[]>;
  createKey(label: string): Promise<{ id: string; url: string }>;
  revokeKey(id: string): Promise<void>;
}

const call = <T,>(body: Record<string, unknown>, doing: string) => callFunction<T>('admin', body, { doing });

function liveAdmin(): AdminApi {
  return {
    mode: 'live',
    overview: () => call<Overview>({ op: 'overview' }, 'loading the admin'),
    account: (email) => call<AccountDetail>({ op: 'account', email }, 'loading the client'),
    saveAccount: async (email, patch) => (await call<{ record: AccountRecord }>({ op: 'account-save', email, patch }, 'saving the client')).record,
    start: async (email, pkg, start) => (await call<{ made: number }>({ op: 'start', email, package: pkg, start }, 'starting the set-up')).made,
    saveTask: async (task) => (await call<{ task: AdminTask }>({ op: 'task-save', task }, 'saving the task')).task,
    deleteTask: async (id) => { await call({ op: 'task-delete', id }, 'deleting the task'); },
    addLog: async (email, kind, text) => { await call({ op: 'log-add', email, kind, text }, 'saving the note'); },
    addCost: async (email, month, item, amount) => { await call({ op: 'cost-add', email, month, item, amount }, 'adding the cost'); },
    deleteCost: async (id) => { await call({ op: 'cost-delete', id }, 'deleting the cost'); },
    money: (month) => call<Money>({ op: 'money', month }, 'loading the money'),
    settings: () => call({ op: 'settings' }, 'loading the settings'),
    saveSettings: async (rates) => (await call<{ rates: RateCard }>({ op: 'settings-save', rates }, 'saving the rates')).rates,
    keys: async () => (await call<{ keys: KeyRow[] }>({ op: 'keys' }, 'loading the connector links')).keys,
    createKey: (label) => call({ op: 'key-create', label }, 'making the link'),
    revokeKey: async (id) => { await call({ op: 'key-revoke', id }, 'switching the link off'); },
  };
}

/* ---------- Demo: six sample clients at different stages ---------- */

function demoAdmin(): AdminApi {
  const today = ukToday();
  const ago = (d: number) => addDays(today, -d);
  const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const SAMPLE: { email: string; name: string; contact: string; phone: string; packages: Package[]; monthly: number; started: number | null; fee: number | null; paid: boolean; slug?: string; live?: boolean; requests?: number; checks: AutoCheck[]; plan?: string[] }[] = [
    { email: 'demo@clinic.example', name: 'Willow Aesthetics', contact: 'Hannah Price', phone: '07700 900123', packages: ['command', 'launch'], monthly: 349, started: 9, fee: 499, paid: true, slug: 'willow-aesthetics', live: true, requests: 1, checks: ['cc-profile', 'cc-watcher', 'site-live', 'site-reviewlink'], plan: ['k-call', 'k-gbp', 'k-domain', 'k-reviews', 'w-copy'] },
    { email: 'sam@brightsmile.example', name: 'Bright Smile Dental', contact: 'Sam Patel', phone: '07700 900456', packages: ['capture'], monthly: 249, started: 4, fee: 299, paid: false, checks: ['cap-settings'] },
    { email: 'jo@harbourphysio.example', name: 'Harbour Physio', contact: 'Jo Evans', phone: '07700 900789', packages: ['command', 'capture'], monthly: 398, started: 21, fee: 299, paid: true, checks: ['cc-profile', 'cc-watcher', 'cc-brief', 'cap-settings', 'cap-source', 'cap-call'] },
    { email: 'mike@kmplumbing.example', name: 'K&M Plumbing', contact: 'Mike Kerr', phone: '07700 900321', packages: ['launch', 'capture'], monthly: 498, started: 2, fee: 999, paid: false, checks: [] },
    { email: 'lou@lashstudio.example', name: 'The Lash Studio', contact: 'Lou Grant', phone: '07700 900654', packages: ['command'], monthly: 149, started: null, fee: null, paid: false, checks: [] },
    { email: 'ben@oakbuild.example', name: 'Oak & Stone Builders', contact: 'Ben Hughes', phone: '07700 900987', packages: ['command'], monthly: 149, started: 40, fee: null, paid: false, checks: ['cc-profile', 'cc-watcher', 'cc-brief'] },
  ];
  let n = 0;
  const tasks: AdminTask[] = [];
  for (const c of SAMPLE) {
    if (c.started == null) continue;
    for (const p of c.packages) for (const t of tasksFor(p, c.email, ago(c.started), 'Adelin')) {
      // Steps that should be done by now mostly are; a few are left late so the board has something to show.
      const late = t.due_on! < today;
      const done = late && (n % 5 !== 0);
      tasks.push({ ...t, id: `t${++n}`, created_at: iso(c.started), status: done ? 'done' : t.due_on === today ? 'doing' : 'todo', done_at: done ? iso(1) : null });
    }
  }
  tasks.push({ id: `t${++n}`, email: 'demo@clinic.example', project: 'other', template_key: null, title: 'Write three Instagram captions for the new skin booster offer', detail: '', who: 'claude', due_on: addDays(today, 2), status: 'todo', done_at: null, sort: 99, created_by: 'Adelin', created_at: iso(1) });
  tasks.push({ id: `t${++n}`, email: 'sam@brightsmile.example', project: 'capture', template_key: null, title: 'Send Sam the call-forwarding steps for BT', detail: '', who: 'gainora', due_on: today, status: 'todo', done_at: null, sort: 99, created_by: 'Adelin', created_at: iso(1) });
  const records = new Map<string, AccountRecord>(SAMPLE.map((c) => [c.email, { email: c.email, business_name: c.name, contact_name: c.contact, phone: c.phone, status: c.started == null ? 'onboarding' : c.started > 30 ? 'active' : 'onboarding', started_on: c.started == null ? null : ago(c.started), setup_fee: c.fee, setup_paid: c.paid, notes: '', updated_at: iso(1) }]));
  const logs: LogEntry[] = [
    { id: 'l1', email: 'demo@clinic.example', at: iso(0.2), author: 'Claude', kind: 'work', text: 'Website draft updated: new headline and the skin boosters page.' },
    { id: 'l2', email: 'demo@clinic.example', at: iso(1), author: 'Adelin', kind: 'call', text: 'Called Hannah. Photos of the new room coming Friday; wants plum as the brand colour.' },
    { id: 'l3', email: 'sam@brightsmile.example', at: iso(2), author: 'Adelin', kind: 'note', text: 'Uses Dentally; they don’t allow outside bookings yet, so the receptionist takes requests.' },
  ];
  const costs: CostEntry[] = [{ id: 'c1', email: 'mike@kmplumbing.example', month: `${today.slice(0, 7)}-01`, item: 'Domain (kmplumbing.co.uk)', amount: 11.99 }];
  const requests = (): Request[] => SAMPLE.filter((c) => c.requests).map((c) => ({ id: `r-${c.email}`, at: iso(1), page: 'Home', text: 'Could the main photo be the new treatment room picture I sent over?', email: c.email, client: c.name, slug: c.slug! }));
  let rates: RateCard = { ...DEFAULT_RATES };
  const keys: KeyRow[] = [];
  const usage = (c: typeof SAMPLE[number], m: number): Usage => ({ aiUsd: c.packages.includes('command') ? 6.4 - m * 1.1 : 0.4, calls: c.packages.includes('capture') ? 38 - m * 6 : 0, texts: c.packages.includes('capture') ? 61 : 0, emails: 120, hasNumber: c.packages.includes('capture') && c.checks.includes('cap-source'), siteLive: !!c.live, active: true });
  const withTicks = (list: AdminTask[]) => list.map((t) => {
    const c = SAMPLE.find((x) => x.email === t.email)!;
    return { ...withAuto([t], new Set(c.checks), Object.fromEntries((c.plan ?? []).map((k) => [k, true])))[0], client: c.name };
  });
  const summary = (c: typeof SAMPLE[number]): AccountSummary => {
    const mine = withTicks(tasks.filter((t) => t.email === c.email));
    const open = mine.filter((t) => t.status !== 'done');
    const next = open.filter((t) => t.due_on).sort((a, b) => a.due_on!.localeCompare(b.due_on!))[0];
    const rec = records.get(c.email)!;
    return {
      email: c.email, userId: null, name: c.name, contact: rec.contact_name, phone: rec.phone, packages: c.packages, status: rec.status, billing: 'active',
      monthly: c.monthly, renewsOn: addDays(today, 12), startedOn: rec.started_on, setupStarted: mine.length > 0,
      progress: { done: mine.length - open.length, total: mine.length }, overdue: open.filter((t) => t.due_on! < today).length,
      nextDue: next ? { title: next.title, due_on: next.due_on! } : null, openRequests: c.requests ?? 0,
      site: c.slug ? { slug: c.slug, live: !!c.live, domain: null } : null,
    };
  };
  const monthCost = (c: typeof SAMPLE[number], month: string, m: number): MonthCost => {
    const manual = costs.filter((x) => x.email === c.email && x.month === month);
    const r = monthCosts(usage(c, m), rates, manual);
    return { month, usage: usage(c, m), manual, ...r, revenue: c.monthly, margin: Math.round((c.monthly - r.total) * 100) / 100 };
  };
  const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const find = (ref: string) => SAMPLE.find((c) => c.email === ref || c.slug === ref) ?? SAMPLE[0];
  const lastMonth = () => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
  return {
    mode: 'demo',
    async overview() {
      await wait();
      const open = withTicks(tasks).filter((t) => t.status !== 'done');
      const accounts = SAMPLE.map(summary);
      return { today, me: 'hello@gainora.co.uk', accounts, tasks: open, board: board(open, today), requests: requests(), totals: { clients: accounts.length, monthly: accounts.reduce((a, x) => a + (x.monthly ?? 0), 0), overdue: open.filter((t) => t.due_on! < today).length, notStarted: accounts.filter((a) => !a.setupStarted).length, unpaidSetup: [...records.values()].filter((r) => r.setup_fee && !r.setup_paid).reduce((a, r) => a + (r.setup_fee ?? 0), 0) } };
    },
    async account(ref) {
      await wait();
      const c = find(ref);
      return {
        account: summary(c), record: records.get(c.email)!, tasks: withTicks(tasks.filter((t) => t.email === c.email)), log: logs.filter((l) => l.email === c.email).sort((a, b) => b.at.localeCompare(a.at)),
        site: c.slug ? { slug: c.slug, domain: null, live: !!c.live, publishedAt: c.live ? iso(40) : null, fixes: c.live ? 1 : 4 } : null,
        capture: c.packages.includes('capture') ? { completed: c.checks.includes('cap-settings'), business: c.name, type: 'appointments', booking: c.email.includes('dental') ? 'Dentally' : 'Gainora diary (this app)' } : null,
        enquiries: c.packages.includes('capture') ? [
          { id: 'e1', created_at: iso(0.3), channel: 'call', name: 'Sample caller', status: 'booked', kind: 'booking', urgency: 'normal', summary: 'Wanted a check-up next week; booked Tuesday 10am.' },
          { id: 'e2', created_at: iso(1.2), channel: 'form', name: 'Sample enquiry', status: 'new', kind: 'quote', urgency: 'normal', summary: 'Asked about prices for whitening.' },
        ] : [],
        siteEnquiries: c.live ? [{ id: 's1', at: iso(0.5), name: 'Sample visitor', service: 'Lip filler', source: 'Google Ads' }] : [],
        requests: requests().filter((r) => r.email === c.email),
        costs: [monthCost(c, `${today.slice(0, 7)}-01`, 0), monthCost(c, lastMonth(), 1)],
      };
    },
    async saveAccount(email, patch) { await wait(); const r = { ...records.get(email)!, ...patch, updated_at: new Date().toISOString() } as AccountRecord; records.set(email, r); return r; },
    async start(email, pkg, start) {
      await wait();
      const made = tasksFor(pkg, email, start, 'Adelin').filter((t) => !tasks.some((x) => x.email === email && x.template_key === t.template_key));
      for (const t of made) tasks.push({ ...t, id: `t${++n}`, created_at: new Date().toISOString() });
      const c = find(email); if (c.started == null) c.started = 0;
      const rec = records.get(email)!; if (!rec.started_on) records.set(email, { ...rec, started_on: start });
      logs.push({ id: `l${++n}`, email, at: new Date().toISOString(), author: 'Adelin', kind: 'system', text: `Started set-up (${made.length} steps).` });
      return made.length;
    },
    async saveTask(task) {
      await wait(150);
      if (task.id) { const i = tasks.findIndex((t) => t.id === task.id); tasks[i] = { ...tasks[i], ...task, done_at: task.status === 'done' ? new Date().toISOString() : tasks[i].done_at }; if (task.status === 'done') { const c = SAMPLE.find((x) => x.email === tasks[i].email); const k = tasks[i].template_key?.replace('launch:', ''); if (c && k && tasks[i].template_key?.startsWith('launch:')) c.plan = [...(c.plan ?? []), k]; } return tasks[i]; }
      const t: AdminTask = { id: `t${++n}`, email: task.email!, project: task.project ?? 'other', template_key: null, title: task.title ?? '', detail: task.detail ?? '', who: task.who ?? 'gainora', due_on: task.due_on ?? null, status: 'todo', done_at: null, sort: 99, created_by: 'Adelin', created_at: new Date().toISOString() };
      tasks.push(t); return t;
    },
    async deleteTask(id) { await wait(150); const i = tasks.findIndex((t) => t.id === id); if (i >= 0) tasks.splice(i, 1); },
    async addLog(email, kind, text) { await wait(150); logs.push({ id: `l${++n}`, email, at: new Date().toISOString(), author: 'Adelin', kind, text }); },
    async addCost(email, month, item, amount) { await wait(150); costs.push({ id: `c${++n}`, email, month: `${month.slice(0, 7)}-01`, item, amount }); },
    async deleteCost(id) { await wait(150); const i = costs.findIndex((c) => c.id === id); if (i >= 0) costs.splice(i, 1); },
    async money(month) {
      await wait();
      const m = month.slice(0, 7) === today.slice(0, 7) ? 0 : 1;
      const rows = SAMPLE.map((c) => { const mc = monthCost(c, `${month.slice(0, 7)}-01`, m); return { email: c.email, name: c.name, packages: c.packages, revenue: c.monthly, costs: mc.total, margin: mc.margin, lines: mc.lines }; }).sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0));
      const revenue = rows.reduce((a, r) => a + (r.revenue ?? 0), 0); const total = rows.reduce((a, r) => a + r.costs, 0);
      return { month: `${month.slice(0, 7)}-01`, rows, totals: { revenue, costs: Math.round(total * 100) / 100, margin: Math.round((revenue - total) * 100) / 100 } };
    },
    async settings() { await wait(); return { rates, defaults: DEFAULT_RATES, team: ['hello@gainora.co.uk'] }; },
    async saveSettings(r) { await wait(); rates = r; return rates; },
    async keys() { await wait(); return keys; },
    async createKey(label) { await wait(); const k = { id: `k${++n}`, label, created_at: new Date().toISOString(), last_used_at: null, revoked_at: null }; keys.unshift(k); return { id: k.id, url: 'https://app.gainora.co.uk/api/mcp/this-is-a-demo-link-it-does-nothing' }; },
    async revokeKey(id) { await wait(); const k = keys.find((x) => x.id === id); if (k) k.revoked_at = new Date().toISOString(); },
  };
}

export const admin: AdminApi = typeof __DEMO__ !== 'undefined' && __DEMO__ ? demoAdmin() : liveAdmin();
