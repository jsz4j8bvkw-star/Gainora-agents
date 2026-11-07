import type { Api } from './api';
import type {
  Action, AgentId, Alert, BriefReport, BusinessProfile, ChatMessage, FeedbackRecord, HomeData, Lead, PlaceSummary, Plan, ScoutSearch,
  Tender, User, ValueEvent, WatcherState, WeekNumbers, WinbackDrafts,
} from './types';
import { metricsFor } from '../../shared/metrics';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

const URL_ = typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '';
const ANON = typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : '';
const SESSION_KEY = 'gainora.session.v1';
const DAY = 86_400_000;

interface Session { access_token: string; refresh_token: string; expires_at: number; user: User }

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function writeSession(s: Session | null) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

async function authFetch(path: string, body: unknown) {
  const res = await fetch(`${URL_}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.msg || data.error_description || 'Sign-in failed. Try again.', res.status);
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

/** PostgREST call, protected by row-level security. */
async function rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      apikey: ANON, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new ApiError(e.message || 'Something went wrong saving your changes. Try again.', res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Netlify function call for agent work. */
async function fn<T>(name: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'The agent could not finish that. Try again in a minute.', res.status);
  return data as T;
}

const firstNumber = (s: string): number | null => {
  const m = (s || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const mapAction = (r: any): Action => ({ id: r.id, text: r.text, agent: r.agent, done: r.done, createdAt: r.created_at });
const mapAlert = (r: any): Alert => ({ id: r.id, agent: r.agent, level: r.level, title: r.title, body: r.body, link: r.link ?? undefined, at: r.created_at, read: r.read });
const mapBrief = (r: any): BriefReport => ({ id: r.id, weekOf: r.week_of, headline: r.headline, paragraphs: r.paragraphs, actions: r.actions, createdAt: r.created_at });
const mapSearch = (r: any): ScoutSearch => ({ id: r.id, query: r.query, area: r.area, kind: r.kind ?? 'customers', createdAt: r.created_at, status: r.status, summary: r.summary ?? undefined, error: r.error ?? undefined, results: r.results ?? [] });
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
      await rest('profiles?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: s!.user.id, data, completed_at: completedAt ?? null, updated_at: new Date().toISOString() } });
      if (completedAt) fn('agents-start', {}).catch(() => {}); // first runs start in the background
    },
    async getPlan(): Promise<Plan> {
      const rows = await rest<any[]>('entitlements?select=agent,status,current_period_end&status=in.(active,trialing)');
      return { agents: rows.map((r) => r.agent as AgentId), status: rows.length ? 'active' : 'none', renewsOn: rows[0]?.current_period_end ?? undefined };
    },
    async billingUrl() { return (await fn<{ url: string }>('billing-portal', {})).url; },

    async getHome(): Promise<HomeData> {
      const [profile, notes, actions, alerts, watcher, searches, briefs, numbers] = await Promise.all([
        this.getProfile(),
        rest<any[]>('agent_notes?select=agent,body,created_at&order=created_at.desc&limit=12'),
        rest<any[]>('actions?select=*&order=created_at.desc&limit=30'),
        rest<any[]>('alerts?select=*&order=created_at.desc&limit=20'),
        rest<any[]>('watcher_state?select=state,updated_at'),
        rest<any[]>('scout_searches?select=*&order=created_at.desc&limit=5'),
        rest<any[]>('briefs?select=*&order=week_of.desc&limit=1'),
        rest<any[]>('week_numbers?select=week_of,values&order=week_of.desc&limit=1'),
      ]);
      const p = profile!;
      const latestNote: Partial<Record<AgentId, string>> = {};
      for (const n of notes) latestNote[n.agent as AgentId] ??= n.body;
      const ws: WatcherState | undefined = watcher[0]?.state;
      const s0 = searches[0] ? mapSearch(searches[0]) : undefined;
      const strong = s0?.results.filter((r) => r.fit === 'strong').length ?? 0;
      const saved = searches.flatMap((x) => mapSearch(x).results).filter((r) => r.saved).length;
      const isWholesale = /wholesale|b2b/i.test(p.goals.focus);
      const focusMetric = /enquir/i.test(p.goals.focus) ? 'enquiries' : /order value/i.test(p.goals.focus) ? 'revenue' : 'orders';
      const started = new Date(p.completedAt || Date.now()).getTime();
      const urgent = ws?.issues.filter((i) => i.level === 'urgent').length ?? 0;
      return {
        notes: (['watcher', 'scout', 'brief'] as AgentId[]).filter((a) => latestNote[a]).map((a) => ({ agent: a, body: latestNote[a]! })),
        actions: actions.map(mapAction),
        alerts: alerts.map(mapAlert),
        goalProgress: isWholesale
          ? { current: saved, target: firstNumber(p.goals.target), label: 'leads in progress', weeksLeft: Math.max(0, Math.ceil((started + 90 * DAY - Date.now()) / (7 * DAY))) }
          : { current: numbers[0]?.values?.[focusMetric] ?? null, target: firstNumber(p.goals.target), label: metricsFor(p.numbers.track).find((m) => m.id === focusMetric)?.label.toLowerCase() ?? 'this week', weeksLeft: Math.max(0, Math.ceil((started + 90 * DAY - Date.now()) / (7 * DAY))) },
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

    async listLeads() { return (await rest<any[]>('leads?select=*&order=created_at.desc&limit=300')).map(mapLead); },
    async addLead(searchId, resultId) { return mapLead(await fn<any>('leads', { op: 'add', searchId, resultId })); },
    async updateLead(id, patch) { return mapLead(await fn<any>('leads', { op: 'update', id, ...patch })); },
    async draftFollowUp(id) { return (await fn<{ text: string }>('leads', { op: 'draft', id })).text; },

    async listTenders() { return (await rest<any[]>('tender_matches?select=id,tender_id,fit,reason,status,created_at,tenders(*)&status=neq.dismissed&order=created_at.desc&limit=100')).map(mapTender); },
    async updateTender(id, status) { await fn('tenders', { id, status }); },
    async draftWinback(): Promise<WinbackDrafts> { return fn<WinbackDrafts>('winback', {}); },

    async getChat() { return (await rest<any[]>('chat_messages?select=*&order=created_at.asc&limit=100')).map(mapMsg); },
    async sendChat(text) { return mapMsg(await fn<any>('chat', { text })); },
  };
}

export const liveConfigured = Boolean(URL_ && ANON);
export type { BusinessProfile, WeekNumbers };
