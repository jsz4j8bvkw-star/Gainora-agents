import { captureWeekFrom } from '../../shared/capture-week';
import type { Api } from './api';
import type {
  Action, AgentId, Alert, BriefReport, BusinessProfile, ChatMessage, Client, ClientAction, ClientsData, FeedbackRecord, HomeData, Lead, Outcome, PlaceSummary, Plan, ScoutSearch,
  Tender, User, ValueEvent, Visit, WatcherState, WeekNumbers, WinbackDrafts,
} from './types';
import { emptyClientsData } from './types';
import { analyseWeeks, metricsFor } from '../../shared/metrics';
import { planToday } from '../../shared/today';
import { humanError, parseJsonBody } from './errors';
import { POLL_DELAYS_MS } from '../../shared/chat';
import { decodeFocus } from '../../shared/scout';
import { likelyOutcomes } from '../../shared/money';
import { uuid } from './format';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

const URL_ = typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '';
const ANON = typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : '';
const SESSION_KEY = 'gainora.session.v1';
const enc = encodeURIComponent;
const DAY = 86_400_000;

interface Session { access_token: string; refresh_token: string; expires_at: number; user: User }

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = '') { super(message); }
}

/**
 * True when PostgREST says a table is not there: the migration for it has not been run yet.
 * The app then shows a "being set up" state instead of an error. (PGRST205: not in the schema
 * cache; 42P01: undefined table.)
 */
export function isMissingTable(e: unknown): boolean {
  const err = e as Partial<ApiError> | undefined;
  return !!err && (err.code === 'PGRST205' || err.code === '42P01' || (err.status === 404 && !err.code));
}

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function writeSession(s: Session | null) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

/** Reads a body that may be JSON, empty (PostgREST's 201/204) or an HTML error page, without ever throwing. */
async function readBody(res: Response): Promise<any> {
  const text = await res.text().catch(() => '');
  return parseJsonBody(text);
}

async function authFetch(path: string, body: unknown) {
  const res = await fetch(`${URL_}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = (await readBody(res)) ?? {};
  if (!res.ok) {
    const m = typeof data.msg === 'string' ? data.msg : typeof data.error_description === 'string' ? data.error_description : '';
    throw new ApiError(m && !/json|token|jwt/i.test(m) ? m : humanError({ status: res.status, doing: 'signing in' }), res.status);
  }
  return data;
}

/** Picks up the tokens Supabase puts in the URL after a magic-link click. */
async function consumeRedirect(): Promise<Session | null> {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const access = h.get('access_token'); const refresh = h.get('refresh_token');
  if (!access || !refresh) return null;
  history.replaceState(null, '', location.pathname);
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${access}` } });
  if (!res.ok) return null;
  const u = await res.json();
  const s: Session = { access_token: access, refresh_token: refresh, expires_at: Date.now() + Number(h.get('expires_in') || 3600) * 1000, user: { id: u.id, email: u.email } };
  writeSession(s);
  return s;
}

let refreshing: Promise<Session | null> | null = null;
async function session(): Promise<Session | null> {
  let s = readSession();
  if (!s) return null;
  if (s.expires_at - Date.now() > 60_000) return s;
  refreshing ??= authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
    .then((d) => {
      const next: Session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + d.expires_in * 1000, user: { id: d.user.id, email: d.user.email } };
      writeSession(next); return next;
    })
    .catch(() => { writeSession(null); return null; })
    .finally(() => { refreshing = null; });
  s = await refreshing;
  return s;
}

async function token(): Promise<string> {
  const s = await session();
  if (!s) { location.reload(); throw new ApiError('Your session has ended. Sign in again.', 401); }
  return s.access_token;
}

/**
 * PostgREST call, protected by row-level security. A write without `return=representation`
 * comes back as 201 or 204 with an empty body, which is success, not an error; and PostgREST's
 * own error text is logged, never shown.
 */
async function rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string; doing?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${URL_}/rest/v1/${path}`, {
      method: init.method || 'GET',
      headers: {
        apikey: ANON, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json',
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(humanError({ status: 0, doing: init.doing }), 0);
  }
  const data = await readBody(res);
  if (!res.ok) {
    console.error('[gainora] data error', res.status, path.split('?')[0], data?.message || data?.code || '');
    throw new ApiError(humanError({ status: res.status, body: data, doing: init.doing ?? (init.method && init.method !== 'GET' ? 'saving your changes' : 'loading your data') }), res.status, typeof data?.code === 'string' ? data.code : '');
  }
  return (data === undefined ? undefined : data) as T;
}

/** Netlify function call for agent work. `timeoutMs` gives up with a plain message rather than hanging. */
async function fn<T>(name: string, body?: unknown, opts: { timeoutMs?: number; doing?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${name}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ApiError(`That took too long${opts.doing ? ` ${opts.doing}` : ''}. Try again.`, 504);
    throw new ApiError(humanError({ status: 0, doing: opts.doing }), 0);
  }
  const data = (await readBody(res)) ?? {};
  if (!res.ok) throw new ApiError(humanError({ status: res.status, body: data, doing: opts.doing ?? 'running that' }), res.status);
  return data as T;
}

const firstNumber = (s: string): number | null => {
  const m = (s || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const mapAction = (r: any): Action => ({ id: r.id, text: r.text, agent: r.agent, done: r.done, createdAt: r.created_at });
const mapAlert = (r: any): Alert => ({ id: r.id, agent: r.agent, level: r.level, title: r.title, body: r.body, link: r.link ?? undefined, at: r.created_at, read: r.read });
const mapBrief = (r: any): BriefReport => ({ id: r.id, weekOf: r.week_of, headline: r.headline, paragraphs: r.paragraphs, actions: r.actions, createdAt: r.created_at });
const mapSearch = (r: any): ScoutSearch => { const d = decodeFocus(r.query, r.kind); return { id: r.id, query: d.query, area: r.area, kind: d.focus, createdAt: r.created_at, status: r.status, summary: r.summary ?? undefined, error: r.error ?? undefined, results: r.results ?? [] }; };
const mapMsg = (r: any): ChatMessage => ({ id: r.id, role: r.role, text: r.text, at: r.created_at, sources: r.sources ?? undefined });
const mapLead = (r: any): Lead => ({
  id: r.id, name: r.name, location: r.location ?? '', website: r.website ?? '', reason: r.reason ?? '', source: r.source ?? { title: '', url: '' },
  stage: r.stage, contactedAt: r.contacted_at, nextFollowUp: r.next_follow_up_at, followUps: r.follow_ups ?? 0,
  value: r.value_gbp != null ? Number(r.value_gbp) : null, createdAt: r.created_at,
});
const mapTender = (r: any): Tender => ({
  id: r.id, tenderId: r.tenders?.id ?? r.tender_id, title: r.tenders?.title ?? '', buyer: r.tenders?.buyer ?? '', summary: (r.tenders?.description ?? '').slice(0, 400),
  value: r.tenders?.value != null ? Number(r.tenders.value) : null, deadline: r.tenders?.deadline ?? null, url: r.tenders?.url ?? 'https://www.contractsfinder.service.gov.uk/',
  region: r.tenders?.region ?? null, sme: r.tenders?.sme ?? null, fit: r.fit, reason: r.reason, status: r.status, foundAt: r.created_at,
});
/* Your clients: rows ↔ records (shared/clients.ts and shared/money.ts shapes). */
const mapClient = (r: any): Client => ({
  id: r.id, name: r.name, phone: r.phone ?? '', phoneRaw: r.phone_raw ?? undefined, email: r.email ?? '', consent: r.consent, consentAt: r.consent_at, consentSource: r.consent_source,
  intervalWeeks: r.interval_weeks, snoozedUntil: r.snoozed_until, notComingBack: !!r.not_coming_back, lastReviewAskAt: r.last_review_ask_at, notes: r.notes ?? undefined,
  source: r.source, importedFrom: r.imported_from, createdAt: r.created_at,
});
const clientRow = (c: Client, userId: string) => ({
  id: c.id, user_id: userId, name: c.name.slice(0, 160), phone: c.phone || '', phone_raw: c.phoneRaw ?? null, email: c.email || '', consent: c.consent, consent_at: c.consentAt ?? null, consent_source: c.consentSource ?? null,
  interval_weeks: c.intervalWeeks ?? null, snoozed_until: c.snoozedUntil ?? null, not_coming_back: !!c.notComingBack, last_review_ask_at: c.lastReviewAskAt ?? null, notes: c.notes ?? null,
  source: c.source, imported_from: c.importedFrom ?? null,
});
const mapVisit = (r: any): Visit => ({ id: r.id, clientId: r.client_id, at: r.visited_on, treatment: r.treatment, treatmentId: r.treatment_id, amount: r.amount != null ? Number(r.amount) : null, practitioner: r.practitioner, createdAt: r.created_at });
const visitRow = (v: Visit, userId: string) => ({ id: v.id, user_id: userId, client_id: v.clientId, visited_on: v.at.slice(0, 10), treatment: v.treatment.slice(0, 200), treatment_id: v.treatmentId, amount: v.amount, practitioner: v.practitioner ?? null });
const mapClientAction = (r: any): ClientAction => ({ id: r.id, clientId: r.client_id, kind: r.kind, channel: r.channel, text: r.text, sentAt: r.sent_at, treatmentId: r.treatment_id, amountHint: r.amount_hint != null ? Number(r.amount_hint) : null, ref: r.ref });
const actionRow = (a: ClientAction, userId: string) => ({ id: a.id, user_id: userId, client_id: a.clientId, kind: a.kind, channel: a.channel, text: a.text.slice(0, 2000), treatment_id: a.treatmentId ?? null, amount_hint: a.amountHint ?? null, ref: a.ref ?? null, sent_at: a.sentAt });
const mapOutcome = (r: any): Outcome => ({ id: r.id, actionId: r.action_id, clientId: r.client_id, visitId: r.visit_id, amount: r.amount != null ? Number(r.amount) : null, status: r.status, at: r.happened_at, title: r.title, createdAt: r.created_at });
const outcomeRow = (o: Outcome, userId: string) => ({ id: o.id, user_id: userId, action_id: o.actionId, client_id: o.clientId, visit_id: o.visitId ?? null, amount: o.amount, status: o.status, happened_at: o.at, title: o.title.slice(0, 200) });

const mapFeedback = (r: any): FeedbackRecord => ({
  id: r.id, agent: r.agent, itemKind: r.item_kind, itemId: r.item_id, verdict: r.verdict, reason: r.reason, text: r.item_text,
  host: r.host, changeKind: r.change_kind, createdAt: r.created_at,
});

export function createLiveApi(): Api {
  return {
    mode: 'live',
    async getUser() {
      const fromLink = await consumeRedirect();
      return (fromLink ?? (await session()))?.user ?? null;
    },
    async requestSignIn(email) {
      // create_user is false: only people with a subscription (created by the Stripe webhook) can sign in.
      await authFetch(`otp?redirect_to=${encodeURIComponent(location.origin + '/')}`, { email, create_user: false });
    },
    async signOut() {
      const s = readSession();
      writeSession(null);
      if (s) fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
    },

    async getProfile() {
      const rows = await rest<any[]>('profiles?select=data,completed_at');
      if (!rows[0]) return null;
      return { ...rows[0].data, completedAt: rows[0].completed_at ?? undefined };
    },
    async saveProfile(p) {
      const s = await session();
      const { completedAt, ...data } = p;
      // return=minimal: PostgREST answers 201 with no body, which readBody treats as success.
      await rest('profiles?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', doing: 'saving your details', body: { user_id: s!.user.id, data, completed_at: completedAt ?? null, updated_at: new Date().toISOString() } });
      if (completedAt) fn('agents-start', {}).catch(() => {}); // first runs start in the background
    },
    async getPlan(): Promise<Plan> {
      const rows = await rest<any[]>('entitlements?select=agent,status,current_period_end&status=in.(active,trialing)');
      const mine = rows.filter((r) => r.agent !== 'capture');
      return { agents: mine.map((r) => r.agent as AgentId), status: mine.length ? 'active' : 'none', renewsOn: mine[0]?.current_period_end ?? undefined, capture: rows.some((r) => r.agent === 'capture') };
    },
    async billingUrl() { return (await fn<{ url: string }>('billing-portal', {})).url; },

    async getHome(): Promise<HomeData> {
      const [profile, plan, notes, actions, alerts, watcher, changeRows, searches, briefs, numbers, leads, tenders, clientsData] = await Promise.all([
        this.getProfile(),
        this.getPlan(),
        rest<any[]>('agent_notes?select=agent,body,created_at&order=created_at.desc&limit=12'),
        rest<any[]>('actions?select=*&order=created_at.desc&limit=30'),
        rest<any[]>('alerts?select=*&order=created_at.desc&limit=20'),
        rest<any[]>('watcher_state?select=state,updated_at'),
        rest<any[]>('competitor_changes?select=*&order=created_at.desc&limit=10').catch(() => [] as any[]),
        rest<any[]>('scout_searches?select=*&order=created_at.desc&limit=5'),
        rest<any[]>('briefs?select=*&order=week_of.desc&limit=1'),
        rest<any[]>('week_numbers?select=week_of,values&order=week_of.desc&limit=6'),
        rest<any[]>('leads?select=*&order=created_at.desc&limit=300').catch(() => [] as any[]),
        rest<any[]>('tender_matches?select=id,tender_id,fit,reason,status,created_at,tenders(*)&status=in.(new,saved)&order=created_at.desc&limit=50').catch(() => [] as any[]),
        this.listClients().catch(() => emptyClientsData(false)),
      ]);
      const p = profile!;
      const latestNote: Partial<Record<AgentId, string>> = {};
      for (const n of notes) latestNote[n.agent as AgentId] ??= n.body;
      const ws: WatcherState | undefined = watcher[0]?.state;
      const s0 = searches[0] ? mapSearch(searches[0]) : undefined;
      const strong = s0?.results.filter((r) => r.fit === 'strong').length ?? 0;
      const leadList = leads.map(mapLead);
      const won = leadList.filter((l) => l.stage === 'won').length;
      const inProgress = leadList.filter((l) => l.stage === 'contacted' || l.stage === 'replied' || l.stage === 'meeting').length;
      const isWholesale = /wholesale|b2b/i.test(p.goals.focus);
      const focusMetric = /enquir/i.test(p.goals.focus) ? 'enquiries' : /order value/i.test(p.goals.focus) ? 'revenue' : 'orders';
      const started = new Date(p.completedAt || Date.now()).getTime();
      const urgent = ws?.issues.filter((i) => i.level === 'urgent').length ?? 0;
      const metrics = metricsFor(p.numbers.track);
      const weeks = numbers.map((n) => ({ weekOf: n.week_of, values: n.values })).reverse();
      const thisWeek = (() => { const x = new Date(); const d = (x.getDay() + 6) % 7; x.setDate(x.getDate() - d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10); })();
      const today = planToday({
        profile: p, agents: plan.agents,
        watcher: ws ? { ...ws, changes: changeRows.map((c) => ({ id: c.id, competitor: c.competitor, url: c.url, at: c.created_at, kind: c.kind, summary: c.summary, detail: c.detail ?? undefined })) } : null,
        leads: leadList, tenders: tenders.map(mapTender), searches: searches.length,
        changes: weeks.length ? analyseWeeks(weeks, metrics) : [], hasThisWeeksNumbers: weeks.some((w) => w.weekOf === thisWeek),
        clients: clientsData.ready ? { clients: clientsData.clients, visits: clientsData.visits, settings: p.clientSettings } : null,
      });
      return {
        today,
        clients: clientsData,
        notes: (['watcher', 'scout', 'brief'] as AgentId[]).filter((a) => latestNote[a]).map((a) => ({ agent: a, body: latestNote[a]! })),
        actions: actions.map(mapAction),
        alerts: alerts.map(mapAlert),
        goalProgress: isWholesale
          ? { current: won, target: firstNumber(p.goals.target), label: 'stockists won', weeksLeft: Math.max(0, Math.ceil((started + 90 * DAY - Date.now()) / (7 * DAY))), detail: inProgress ? `${inProgress} more in conversation` : undefined }
          : { current: numbers[0]?.values?.[focusMetric] ?? null, target: firstNumber(p.goals.target), label: metrics.find((m) => m.id === focusMetric)?.label.toLowerCase() ?? 'this week', weeksLeft: Math.max(0, Math.ceil((started + 90 * DAY - Date.now()) / (7 * DAY))) },
        agentStatus: {
          watcher: { line: ws ? (urgent ? `${urgent} urgent issue${urgent > 1 ? 's' : ''} to fix` : 'Your site looks healthy') : 'First check in progress', lastRun: ws?.lastCheck, nextRun: ws?.nextCheck },
          scout: { line: s0 ? (s0.status === 'running' ? 'Researching now' : `${strong} strong-fit leads ready`) : 'Start your first search', lastRun: s0?.createdAt },
          brief: { line: briefs[0]?.headline ?? 'Waiting for this week’s numbers', lastRun: briefs[0]?.created_at },
        },
      };
    },
    async setActionDone(id, done) { await rest(`actions?id=eq.${id}`, { method: 'PATCH', body: { done } }); },
    async addAction(text) {
      const s = await session();
      const rows = await rest<any[]>('actions', { method: 'POST', prefer: 'return=representation', body: { user_id: s!.user.id, text, agent: 'you' } });
      return mapAction(rows[0]);
    },
    async markAlertsRead() { await rest('alerts?read=eq.false', { method: 'PATCH', body: { read: true } }); },

    async getWatcher() {
      const [state, changes] = await Promise.all([
        rest<any[]>('watcher_state?select=state'),
        rest<any[]>('competitor_changes?select=*&order=created_at.desc&limit=40'),
      ]);
      const ws: WatcherState = state[0]?.state ?? { site: '', up: true, responseMs: 0, uptime30d: 100, sslDaysLeft: null, pagesChecked: 0, brokenLinks: [], issues: [], history: [], changes: [] };
      ws.changes = changes.map((c) => ({ id: c.id, competitor: c.competitor, url: c.url, at: c.created_at, kind: c.kind, summary: c.summary, detail: c.detail ?? undefined }));
      return ws;
    },
    async runWatcher() {
      const stamp = async () => (await rest<any[]>('watcher_state?select=updated_at'))[0]?.updated_at;
      const before = await stamp();
      const r = await fn<{ started: boolean }>('watcher-run', {});
      if (r.started) {
        // The check runs in the background; wait for it to land (up to 3 minutes).
        for (let i = 0; i < 45; i++) {
          await new Promise((res) => setTimeout(res, 4000));
          const now = await stamp();
          if (now && now !== before) break;
        }
      }
      return this.getWatcher();
    },

    async listScout() { return (await rest<any[]>('scout_searches?select=*&order=created_at.desc&limit=20')).map(mapSearch); },
    async startScout(query, area, kind = 'customers') { return mapSearch(await fn<any>('scout-start', { query, area, kind })); },
    async getScout(id) { return mapSearch((await rest<any[]>(`scout_searches?select=*&id=eq.${id}`))[0]); },
    async setScoutSaved(searchId, resultId, saved) { await fn('scout-save', { searchId, resultId, saved }); },
    async draftIntro(searchId, resultId) {
      // From the Leads tab there is no search id: the second argument is the lead's id.
      if (!searchId) return (await fn<{ text: string }>('leads', { op: 'intro', id: resultId })).text;
      return (await fn<{ text: string }>('scout-intro', { searchId, resultId })).text;
    },

    async getCaptureWeek() {
      // Read straight from Capture & Convert's inbox (same login, the owner's own rows).
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const [rows, settings] = await Promise.all([
        rest<any[]>(`enquiries?select=status,after_hours,booked_type,job_value,history&is_test=eq.false&received_at=gte.${since}&limit=2000`),
        rest<any[]>('capture_settings?select=data&limit=1'),
      ]).catch(() => [null, null] as const);
      if (!rows) return null;
      return captureWeekFrom(rows, settings?.[0]?.data?.bookings?.types ?? [], since);
    },

    async getNumbers() {
      const rows = await rest<any[]>('week_numbers?select=week_of,values,note&order=week_of.asc&limit=26');
      return rows.map((r) => ({ weekOf: r.week_of, values: r.values, note: r.note ?? undefined }));
    },
    async saveNumbers(w) { return mapBrief(await fn<any>('brief-run', w)); },
    async listBriefs() { return (await rest<any[]>('briefs?select=*&order=week_of.desc&limit=26')).map(mapBrief); },

    async listValue(): Promise<ValueEvent[]> {
      const rows = await rest<any[]>('value_events?select=id,agent,kind,title,amount,created_at&order=created_at.desc&limit=1000');
      return rows.map((r) => ({ id: r.id, agent: r.agent, kind: r.kind, title: r.title, amount: r.amount != null ? Number(r.amount) : null, at: r.created_at }));
    },
    async sendFeedback(f) { await fn('feedback', f); },
    async listFeedback() { return (await rest<any[]>('feedback?select=*&order=created_at.desc&limit=200')).map(mapFeedback); },
    async forgetFeedback(id) { await fn('feedback', { forget: id }); },

    async findPlaces(query): Promise<PlaceSummary[]> { return (await fn<{ places: PlaceSummary[] }>('places', { op: 'find', query })).places; },
    async selectPlace(placeId) { await fn('places', { op: 'select', placeId }); return this.getWatcher(); },
    async draftReviewReply(reviewId) { return (await fn<{ text: string }>('review-reply', { reviewId })).text; },
    async setFixDone(title, done) { await fn('fix-done', { title, done }); },
    async updateCompetitor(op, key, handle) { await fn('competitors', { op, key, handle }); return this.getWatcher(); },
    async findCompetitors() { return fn<{ started: boolean; message?: string }>('competitors', { op: 'find' }); },

    async listLeads() { return (await rest<any[]>('leads?select=*&order=created_at.desc&limit=300')).map(mapLead); },
    async addLead(searchId, resultId) { return mapLead(await fn<any>('leads', { op: 'add', searchId, resultId })); },
    async updateLead(id, patch) { return mapLead(await fn<any>('leads', { op: 'update', id, ...patch })); },
    async draftFollowUp(id) { return (await fn<{ text: string }>('leads', { op: 'draft', id })).text; },

    async listTenders() { return (await rest<any[]>('tender_matches?select=id,tender_id,fit,reason,status,created_at,tenders(*)&status=neq.dismissed&order=created_at.desc&limit=100')).map(mapTender); },
    async updateTender(id, status) { await fn('tenders', { id, status }); },
    async draftWinback(): Promise<WinbackDrafts> { return fn<WinbackDrafts>('winback', {}); },

    // Your clients. The tables may not exist yet (the migration is the owner's to run): then `ready` is false.
    async listClients(): Promise<ClientsData> {
      try {
        const [clients, visits, actions, outcomes] = await Promise.all([
          rest<any[]>('clients?select=*&order=created_at.desc&limit=5000', { doing: 'loading your clients' }),
          rest<any[]>('client_visits?select=*&order=visited_on.desc&limit=20000', { doing: 'loading your clients' }),
          rest<any[]>('client_actions?select=*&order=sent_at.desc&limit=5000', { doing: 'loading your clients' }),
          rest<any[]>('client_outcomes?select=*&order=happened_at.desc&limit=5000', { doing: 'loading your clients' }),
        ]);
        return { ready: true, clients: clients.map(mapClient), visits: visits.map(mapVisit), actions: actions.map(mapClientAction), outcomes: outcomes.map(mapOutcome) };
      } catch (e) {
        if (isMissingTable(e)) return emptyClientsData(false);
        throw e;
      }
    },
    async saveClient(c) {
      const s = await session();
      const rows = await rest<any[]>('clients?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', doing: 'saving the client', body: clientRow(c, s!.user.id) });
      return rows[0] ? mapClient(rows[0]) : c;
    },
    async deleteClient(id) { await rest(`clients?id=eq.${enc(id)}`, { method: 'DELETE', doing: 'deleting the client' }); },
    async addVisit(v) {
      const s = await session();
      const rows = await rest<any[]>('client_visits', { method: 'POST', prefer: 'return=representation', doing: 'saving the visit', body: visitRow(v, s!.user.id) });
      const visit = rows[0] ? mapVisit(rows[0]) : v;
      // A visit within 21 days of a Gainora message to this client becomes a "likely" outcome for the owner to confirm.
      let likely: Outcome[] = [];
      try {
        const [actions, outcomes] = await Promise.all([
          rest<any[]>(`client_actions?select=*&client_id=eq.${enc(v.clientId)}&order=sent_at.desc&limit=50`),
          rest<any[]>(`client_outcomes?select=*&client_id=eq.${enc(v.clientId)}&limit=200`),
        ]);
        likely = likelyOutcomes(actions.map(mapClientAction), [visit], outcomes.map(mapOutcome), uuid);
        if (likely.length) await rest('client_outcomes', { method: 'POST', prefer: 'return=minimal', body: likely.map((o) => outcomeRow(o, s!.user.id)) });
      } catch (e) { console.error('[gainora] likely outcome', (e as Error)?.message); }
      return { visit, likely };
    },
    async deleteVisit(id) { await rest(`client_visits?id=eq.${enc(id)}`, { method: 'DELETE', doing: 'deleting the visit' }); },
    async importClients(clients, visits, optOutIds) {
      const s = await session(); const uid = s!.user.id;
      // In batches, so a 5,000-row import is several small requests rather than one huge one.
      for (let i = 0; i < clients.length; i += 200) await rest('clients?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', doing: 'saving your clients', body: clients.slice(i, i + 200).map((c) => clientRow(c, uid)) });
      for (let i = 0; i < visits.length; i += 500) await rest('client_visits', { method: 'POST', prefer: 'return=minimal', doing: 'saving the visits', body: visits.slice(i, i + 500).map((v) => visitRow(v, uid)) });
      for (const id of optOutIds) await rest(`clients?id=eq.${enc(id)}`, { method: 'PATCH', body: { consent: 'opted_out', consent_at: new Date().toISOString(), consent_source: 'import' } });
    },
    async recordAction(a) {
      const s = await session();
      const rows = await rest<any[]>('client_actions', { method: 'POST', prefer: 'return=representation', doing: 'recording the message', body: actionRow(a, s!.user.id) });
      if (a.kind === 'review_request' && a.clientId) await rest(`clients?id=eq.${enc(a.clientId)}`, { method: 'PATCH', body: { last_review_ask_at: a.sentAt } }).catch(() => {});
      return rows[0] ? mapClientAction(rows[0]) : a;
    },
    async saveOutcome(o) {
      const s = await session();
      const rows = await rest<any[]>('client_outcomes?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', doing: 'saving the booking', body: outcomeRow(o, s!.user.id) });
      return rows[0] ? mapOutcome(rows[0]) : o;
    },
    async deleteOutcome(id) { await rest(`client_outcomes?id=eq.${enc(id)}`, { method: 'DELETE' }); },
    async deleteAllClientData() {
      const s = await session(); const uid = s!.user.id;
      // Outcomes and actions first (they reference clients), then clients (visits cascade).
      await rest(`client_outcomes?user_id=eq.${uid}`, { method: 'DELETE', doing: 'deleting your client data' });
      await rest(`client_actions?user_id=eq.${uid}`, { method: 'DELETE', doing: 'deleting your client data' });
      await rest(`client_visits?user_id=eq.${uid}`, { method: 'DELETE', doing: 'deleting your client data' });
      await rest(`clients?user_id=eq.${uid}`, { method: 'DELETE', doing: 'deleting your client data' });
    },
    async sendSms(action, phone) {
      return fn<{ sent: boolean; message?: string }>('sms-send', { actionId: action.id, to: phone, text: action.text, kind: action.kind }, { timeoutMs: 20_000, doing: 'sending the text' });
    },

    // The newest 100, oldest first (asc+limit would return the OLDEST 100 and hide new replies).
    async getChat() { return (await rest<any[]>('chat_messages?select=*&order=created_at.desc&limit=100')).map(mapMsg).reverse(); },
    async sendChat(text) {
      const r = await fn<{ queued: boolean; question: any; reply?: any }>('chat', { text }, { timeoutMs: 25_000, doing: 'sending your question' });
      if (!r.queued && r.reply) return mapMsg(r.reply);
      const question = mapMsg(r.question);
      // The answer is written in the background and saved to the conversation: poll for it.
      for (const delay of POLL_DELAYS_MS) {
        await new Promise((res) => setTimeout(res, delay));
        const rows = await rest<any[]>(`chat_messages?select=*&role=eq.agent&created_at=gt.${encodeURIComponent(question.at)}&order=created_at.asc&limit=1`).catch(() => [] as any[]);
        if (rows[0]) return mapMsg(rows[0]);
      }
      throw new ApiError('The answer is taking longer than usual. It is saved to this conversation when it is ready; check again in a moment.', 504);
    },
  };
}

export const liveConfigured = Boolean(URL_ && ANON);
export type { BusinessProfile, WeekNumbers };
