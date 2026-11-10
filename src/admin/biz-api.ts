// The admin's business side: sales (/api/admin-sales) and prices, client care, money and paperwork
// (/api/admin-business). The demo keeps sample prospects, proposals and books in memory.
import { callFunction } from '../lib/live';
import { ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import type { Package } from '../../shared/admin/model';
import {
  afterSend, canEmail, DEFAULT_SEQUENCES, dueFollowUps, fill, funnel, type Channel, type OutreachMessage, type Prospect, prospectsFromCsv, sameProspect,
  type Sequence, type Stage,
} from '../../shared/admin/sales';
import { DEFAULT_PRICE_BOOK, type PriceItem, type ProposalItem, toWebsitePrices } from '../../shared/admin/prices';
import { type Health, type MonthResults, resultsEmail } from '../../shared/admin/care';
import { type Deadline, type Expense, expensesIn, nextOccurrence, SUGGESTED_DEADLINES, sum, VAT_THRESHOLD, vatStatus, dueSoon } from '../../shared/admin/books';

declare const __DEMO__: boolean;

export interface Draft { step: number; channel: Channel; subject: string; body: string }
export interface EmailGate { ok: boolean; why: string }
export type DueProspect = Prospect & { draft: Draft | null; email_ok: EmailGate };
export interface ProposalRow {
  id: string; token: string; prospect_id: string | null; email: string; business_name: string; contact_name: string; items: ProposalItem[];
  trial_days: number; note: string; status: 'draft' | 'sent' | 'viewed' | 'paid' | 'cancelled'; expires_on: string | null;
  sent_at: string | null; viewed_at: string | null; paid_at: string | null; created_by: string; created_at: string; url: string;
}
export interface Funnel { by: Record<Stage, number>; total: number; reached: number; sentThisWeek: number; replyRate: number | null; callRate: number | null; winRate: number | null }
export interface OutreachSettings { autoSend: boolean; dailyLimit: number; myName: string; bookingLink: string; ready: boolean }
export interface SalesOverview { today: string; prospects: Prospect[]; sequences: Sequence[]; due: DueProspect[]; proposals: ProposalRow[]; funnel: Funnel; calls: Prospect[]; outreach: OutreachSettings }
export interface ProspectDetail { prospect: Prospect; messages: OutreachMessage[]; draft: Draft | null; email_ok: EmailGate; proposals: ProposalRow[] }
export interface ImportResult { added: number; duplicates: number; skipped: number; blocked: number }
export interface HealthRow { email: string; name: string; packages: Package[]; monthly: number | null; renewsOn: string | null; level: Health; reasons: string[]; lastSignIn: string | null }
export interface ResultsPreview { results: MonthResults; email: { subject: string; paragraphs: string[] } | null }
export interface Unpaid { id: string; email: string; amount: number; due: string | null; attempts: number; link: string | null; client?: string }
export interface Books {
  month: string; stripe: boolean; revenueFrom: 'invoices' | 'subscriptions'; revenue: number; expenses: Expense[]; expenseTotal: number; profit: number; all: Expense[];
  months: { month: string; revenue: number; expenses: number; profit: number }[]; unpaid: Unpaid[];
  vat: { rolling: number; threshold: number; level: 'fine' | 'near' | 'over'; share: number; note: string };
}
export interface Agreement { email: string; name: string; terms: string | null; dpa: string | null }
export interface Paperwork { today: string; deadlines: Deadline[]; soon: Deadline[]; suggestions: { title: string; category: string; repeat: Deadline['repeat']; note: string; when: string | null }[]; agreements: Agreement[] }
export interface TodayBiz {
  followUps: number; calls: Pick<Prospect, 'id' | 'business_name' | 'contact_name' | 'call_at'>[];
  proposals: { id: string; business_name: string; status: string; sent_at: string | null; viewed_at: string | null; waitingDays: number }[];
  unpaid: Unpaid[]; deadlines: Deadline[];
}
export interface PricesData { prices: PriceItem[]; website: boolean; stripe: boolean }

export interface BizApi {
  today(): Promise<TodayBiz>;
  sales(): Promise<SalesOverview>;
  prospect(id: string): Promise<ProspectDetail>;
  saveProspect(p: Partial<Prospect>): Promise<Prospect>;
  deleteProspect(id: string): Promise<void>;
  importCsv(csv: string, source: string): Promise<ImportResult>;
  startSequence(ids: string[], sequenceId: string, start: string): Promise<number>;
  send(id: string, body?: string): Promise<void>;
  markSent(id: string, body?: string): Promise<void>;
  skip(id: string): Promise<void>;
  replied(id: string, note: string): Promise<void>;
  doNotContact(id: string): Promise<void>;
  saveSequences(list: Sequence[]): Promise<Sequence[]>;
  saveOutreach(o: Omit<OutreachSettings, 'ready'>): Promise<OutreachSettings>;
  saveProposal(p: Partial<ProposalRow>): Promise<ProposalRow>;
  sendProposal(id: string, message: string): Promise<void>;
  cancelProposal(id: string): Promise<void>;
  prices(): Promise<PricesData>;
  savePrices(items: PriceItem[], publish: boolean): Promise<{ prices: PriceItem[]; rebuilt: boolean }>;
  health(): Promise<{ clients: HealthRow[]; settings: { resultsEmails: boolean } }>;
  results(email: string, month?: string): Promise<ResultsPreview>;
  sendResults(email: string, month?: string): Promise<void>;
  careSettings(resultsEmails: boolean): Promise<void>;
  books(month: string): Promise<Books>;
  saveExpense(e: Partial<Expense>): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  paperwork(): Promise<Paperwork>;
  saveDeadline(d: Partial<Deadline>): Promise<void>;
  deadlineDone(id: string): Promise<string | null>;
  deleteDeadline(id: string): Promise<void>;
  saveAgreement(email: string, terms: string | null, dpa: string | null): Promise<void>;
}

const S = <T,>(body: Record<string, unknown>, doing: string) => callFunction<T>('admin-sales', body, { doing });
const B = <T,>(body: Record<string, unknown>, doing: string) => callFunction<T>('admin-business', body, { doing });

function liveBiz(): BizApi {
  return {
    today: () => B({ op: 'today' }, 'loading today'),
    sales: () => S({ op: 'overview' }, 'loading sales'),
    prospect: (id) => S({ op: 'prospect', id }, 'loading the prospect'),
    saveProspect: async (p) => (await S<{ prospect: Prospect }>({ op: 'prospect-save', prospect: p }, 'saving the prospect')).prospect,
    deleteProspect: async (id) => { await S({ op: 'prospect-delete', id }, 'deleting the prospect'); },
    importCsv: (csv, source) => S({ op: 'import', csv, source }, 'importing the list'),
    startSequence: async (ids, sequence_id, start) => (await S<{ started: number }>({ op: 'start', ids, sequence_id, start }, 'starting the messages')).started,
    send: async (id, body) => { await S({ op: 'send', id, body }, 'sending the email'); },
    markSent: async (id, body) => { await S({ op: 'mark-sent', id, body }, 'saving'); },
    skip: async (id) => { await S({ op: 'skip', id }, 'skipping'); },
    replied: async (id, note) => { await S({ op: 'replied', id, note }, 'saving'); },
    doNotContact: async (id) => { await S({ op: 'do-not-contact', id }, 'saving'); },
    saveSequences: async (sequences) => (await S<{ sequences: Sequence[] }>({ op: 'sequences-save', sequences }, 'saving the messages')).sequences,
    saveOutreach: async (outreach) => (await S<{ outreach: OutreachSettings }>({ op: 'outreach-settings', outreach }, 'saving')).outreach,
    saveProposal: async (proposal) => (await S<{ proposal: ProposalRow }>({ op: 'proposal-save', proposal }, 'saving the proposal')).proposal,
    sendProposal: async (id, message) => { await S({ op: 'proposal-send', id, message }, 'sending the proposal'); },
    cancelProposal: async (id) => { await S({ op: 'proposal-cancel', id }, 'cancelling the proposal'); },
    prices: () => B({ op: 'prices' }, 'loading prices'),
    savePrices: (prices, publish) => B({ op: 'prices-save', prices, publish }, 'saving prices'),
    health: () => B({ op: 'health' }, 'checking on clients'),
    results: (email, month) => B({ op: 'results', email, month }, 'working out their results'),
    sendResults: async (email, month) => { await B({ op: 'results-send', email, month }, 'sending the results email'); },
    careSettings: async (resultsEmails) => { await B({ op: 'care-settings', resultsEmails }, 'saving'); },
    books: (month) => B({ op: 'books', month }, 'loading the books'),
    saveExpense: async (expense) => { await B({ op: 'expense-save', expense }, 'saving the expense'); },
    deleteExpense: async (id) => { await B({ op: 'expense-delete', id }, 'deleting the expense'); },
    paperwork: () => B({ op: 'paperwork' }, 'loading paperwork'),
    saveDeadline: async (deadline) => { await B({ op: 'deadline-save', deadline }, 'saving the date'); },
    deadlineDone: async (id) => (await B<{ next: string | null }>({ op: 'deadline-done', id }, 'saving')).next,
    deleteDeadline: async (id) => { await B({ op: 'deadline-delete', id }, 'deleting the date'); },
    saveAgreement: async (email, terms, dpa) => { await B({ op: 'agreement-save', email, terms, dpa }, 'saving'); },
  };
}

/* ---------- Demo ---------- */

function demoBiz(): BizApi {
  const today = ukToday();
  const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));
  let n = 100;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const me = { name: 'Adelin', booking: 'https://calendar.app.google/2nHffNt7oNxPXnB29' };
  let outreach: OutreachSettings = { autoSend: false, dailyLimit: 20, myName: 'Adelin', bookingLink: me.booking, ready: false };
  let sequences: Sequence[] = DEFAULT_SEQUENCES.map((s) => ({ ...s, id: id() }));
  const [byEmail, byLinkedIn, warm] = sequences;
  const base = { role: '', phone: '', instagram: '', linkedin: '', industry: 'Aesthetics clinic', source: 'Clinic outreach list', consent: false, consent_note: '', lost_reason: '', note: '', unsubscribed_at: null, bounced_at: null, client_email: null, unsub_token: null, call_at: null, personal_line: '', started_on: null, next_on: null, sequence_id: null, step: 0, created_at: iso(12), updated_at: iso(1) };
  const P = (p: Partial<Prospect>): Prospect => ({ ...base, id: id(), business_name: '', contact_name: '', email: '', website: '', town: '', company_type: 'unknown', stage: 'new', ...p } as Prospect);
  // Sample businesses: invented names on .example addresses.
  const prospects: Prospect[] = [
    P({ business_name: 'Rose & Birch Aesthetics Ltd', contact_name: 'Dr Priya Shah', role: 'Owner', email: 'priya@roseandbirch.example', website: 'roseandbirch.example', town: 'Crewe', company_type: 'limited', stage: 'new', sequence_id: byEmail.id, next_on: today, personal_line: 'Your before-and-after page for skin boosters is one of the clearest I’ve seen.' }),
    P({ business_name: 'The Skin Room Nantwich', contact_name: 'Kate Moss', email: 'kate@theskinroom.example', website: 'theskinroom.example', town: 'Nantwich', company_type: 'unknown', sequence_id: byEmail.id, next_on: today }),
    P({ business_name: 'Glow Lab Clinic Ltd', contact_name: 'Hayley Ford', email: 'hayley@glowlab.example', town: 'Stoke-on-Trent', company_type: 'limited', stage: 'proposal', sequence_id: byEmail.id, step: 2, started_on: addDays(today, -12), note: 'Call went well; wants the website first.' }),
    P({ business_name: 'Pure Aesthetics by Laura', contact_name: 'Laura Beck', email: 'laura@pureaesthetics.example', linkedin: 'https://www.linkedin.com/in/example', town: 'Sandbach', company_type: 'sole_trader', stage: 'contacted', sequence_id: byLinkedIn.id, step: 1, started_on: addDays(today, -3), next_on: today, industry: 'Aesthetics clinic' }),
    P({ business_name: 'Cheshire Smile Studio Ltd', contact_name: 'Dr Tom Ellis', email: 'tom@cheshiresmile.example', town: 'Congleton', company_type: 'limited', stage: 'call', call_at: `${addDays(today, 1)}T10:30:00.000Z`, industry: 'Dental practice', sequence_id: byEmail.id, step: 1, started_on: addDays(today, -6) }),
    P({ business_name: 'Bloom Hair & Beauty', contact_name: 'Jess Lowe', email: 'jess@bloomhair.example', phone: '07700 900111', town: 'Alsager', company_type: 'partnership', stage: 'contacted', sequence_id: warm.id, step: 1, started_on: addDays(today, -2), next_on: addDays(today, 2), industry: 'Hair salon', source: 'Friend of a friend' }),
    P({ business_name: 'Northwich Physio Ltd', contact_name: 'Sam Reid', email: 'sam@northwichphysio.example', town: 'Northwich', company_type: 'limited', stage: 'replied', sequence_id: byEmail.id, step: 1, started_on: addDays(today, -5), industry: 'Physiotherapy', note: 'Replied: busy until next month, asked to follow up.' }),
    P({ business_name: 'Lumière Skin Clinic Ltd', contact_name: 'Amira Khan', email: 'amira@lumiereskin.example', town: 'Stafford', company_type: 'limited', stage: 'lost', lost_reason: 'Happy with their current receptionist', sequence_id: byEmail.id, step: 2, started_on: addDays(today, -20) }),
    P({ business_name: 'Willow Aesthetics', contact_name: 'Hannah Price', email: 'demo@clinic.example', town: 'Crewe', company_type: 'limited', stage: 'won', client_email: 'demo@clinic.example', sequence_id: byEmail.id, step: 1, started_on: addDays(today, -30) }),
    P({ business_name: 'Velvet Brows & Lashes', contact_name: '', email: '', instagram: 'https://www.instagram.com/example', town: 'Crewe', company_type: 'unknown', industry: 'Brows and lashes' }),
  ];
  const messages: OutreachMessage[] = prospects.filter((p) => p.started_on).flatMap((p) => Array.from({ length: Math.min(p.step, 2) }, (_, i) => ({ id: id(), prospect_id: p.id, sequence_id: p.sequence_id, step: i, channel: 'email' as Channel, subject: i ? 'Re: calls at your clinic' : `Calls at ${p.business_name} while you’re with clients`, body: '…', status: 'sent' as const, sent_at: `${addDays(p.started_on!, i * 4)}T09:30:00.000Z`, by: 'Adelin' })));
  const lg = DEFAULT_PRICE_BOOK.find((x) => x.key === 'launch-grow')!;
  const ctb = DEFAULT_PRICE_BOOK.find((x) => x.key === 'capture-booking')!;
  const item = (x: PriceItem): ProposalItem => ({ key: x.key, name: x.name, setup: x.setup, monthly: x.monthly, one_off: x.one_off, minimum_months: x.minimum_months, grants: x.grants, included: x.included });
  const proposals: ProposalRow[] = [
    { id: id(), token: 'demo-glowlab-proposal', prospect_id: prospects[2].id, email: 'hayley@glowlab.example', business_name: 'Glow Lab Clinic Ltd', contact_name: 'Hayley Ford', items: [item(lg)], trial_days: 0, note: 'As we talked about: the website first, then Google reviews.', status: 'viewed', expires_on: addDays(today, 10), sent_at: iso(4), viewed_at: iso(3), paid_at: null, created_by: 'Adelin', created_at: iso(4), url: 'https://app.gainora.co.uk/p/demo-glowlab-proposal' },
    { id: id(), token: 'demo-willow-proposal', prospect_id: prospects[8].id, email: 'demo@clinic.example', business_name: 'Willow Aesthetics', contact_name: 'Hannah Price', items: [item(lg)], trial_days: 0, note: '', status: 'paid', expires_on: addDays(today, -16), sent_at: iso(30), viewed_at: iso(29), paid_at: iso(28), created_by: 'Adelin', created_at: iso(30), url: 'https://app.gainora.co.uk/p/demo-willow-proposal' },
    { id: id(), token: 'demo-cheshire-proposal', prospect_id: prospects[4].id, email: 'tom@cheshiresmile.example', business_name: 'Cheshire Smile Studio Ltd', contact_name: 'Dr Tom Ellis', items: [item(ctb)], trial_days: 14, note: '', status: 'draft', expires_on: addDays(today, 14), sent_at: null, viewed_at: null, paid_at: null, created_by: 'Claude', created_at: iso(0.2), url: 'https://app.gainora.co.uk/p/demo-cheshire-proposal' },
  ];
  const blocked = new Set<string>(['hello@lumiereskin.example']);
  const seqOf = (p: Prospect) => sequences.find((s) => s.id === p.sequence_id);
  const draftOf = (p: Prospect): Draft | null => { const s = seqOf(p); const st = s?.steps[p.step]; return s && st ? { step: p.step, channel: st.channel, subject: fill(st.subject, p, me), body: fill(st.body, p, me) } : null; };
  const find = (pid: string) => { const p = prospects.find((x) => x.id === pid); if (!p) throw new Error('That prospect no longer exists.'); return p; };
  const step = (p: Prospect, status: 'sent' | 'skipped', body?: string) => {
    const s = seqOf(p)!; const d = draftOf(p)!;
    messages.push({ id: id(), prospect_id: p.id, sequence_id: s.id, step: p.step, channel: d.channel, subject: d.subject, body: body ?? d.body, status, sent_at: new Date().toISOString(), by: 'Adelin' });
    const started = p.started_on ?? today; const next = afterSend(s, p.step, started);
    Object.assign(p, { started_on: started, step: next.step, next_on: next.next_on, stage: p.stage === 'new' ? 'contacted' : p.stage, updated_at: new Date().toISOString() });
  };

  let book: PriceItem[] = DEFAULT_PRICE_BOOK.map((x) => ({ ...x }));
  let resultsOn = false;
  const health: HealthRow[] = [
    { email: 'mike@kmplumbing.example', name: 'K&M Plumbing', packages: ['launch', 'capture'], monthly: 498, renewsOn: addDays(today, 12), level: 'risk', reasons: ['Their last payment failed', 'A change they asked for has waited 5 days'], lastSignIn: iso(3) },
    { email: 'ben@oakbuild.example', name: 'Oak & Stone Builders', packages: ['command'], monthly: 149, renewsOn: addDays(today, 5), level: 'risk', reasons: ['Hasn’t signed in for 34 days', 'Renews in 5 days'], lastSignIn: iso(34) },
    { email: 'sam@brightsmile.example', name: 'Bright Smile Dental', packages: ['capture'], monthly: 249, renewsOn: addDays(today, 12), level: 'watch', reasons: ['Hasn’t signed in for 16 days'], lastSignIn: iso(16) },
    { email: 'demo@clinic.example', name: 'Willow Aesthetics', packages: ['command', 'launch'], monthly: 349, renewsOn: addDays(today, 12), level: 'good', reasons: [], lastSignIn: iso(0.5) },
    { email: 'jo@harbourphysio.example', name: 'Harbour Physio', packages: ['command', 'capture'], monthly: 398, renewsOn: addDays(today, 12), level: 'good', reasons: [], lastSignIn: iso(1) },
    { email: 'lou@lashstudio.example', name: 'The Lash Studio', packages: ['command'], monthly: 149, renewsOn: addDays(today, 12), level: 'good', reasons: [], lastSignIn: null },
  ];
  const lastMonth = (() => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
  const resultsFor = (email: string): MonthResults => {
    const h = health.find((x) => x.email === email);
    return {
      month: lastMonth,
      capture: h?.packages.includes('capture') ? { enquiries: 46, calls: 31, afterHours: 12, booked: 19 } : null,
      website: h?.packages.includes('launch') ? { visitors: 412, contacts: 27 } : null,
      command: h?.packages.includes('command') ? { briefs: 4, leads: 9 } : null,
    };
  };
  const first = (email: string) => ({ 'demo@clinic.example': 'Hannah', 'sam@brightsmile.example': 'Sam', 'jo@harbourphysio.example': 'Jo', 'mike@kmplumbing.example': 'Mike', 'lou@lashstudio.example': 'Lou', 'ben@oakbuild.example': 'Ben' } as Record<string, string>)[email] ?? 'there';

  const m0 = `${today.slice(0, 7)}-01`;
  const expenses: Expense[] = [
    { id: id(), supplier: 'Retell AI', category: 'Phone and calls', amount: 48, recurring: true, starts_on: addDays(m0, -90), ends_on: null, note: 'Receptionist minutes (sample)' },
    { id: id(), supplier: 'Twilio', category: 'Phone and calls', amount: 22, recurring: true, starts_on: addDays(m0, -90), ends_on: null, note: '' },
    { id: id(), supplier: 'Anthropic', category: 'AI', amount: 36, recurring: true, starts_on: addDays(m0, -120), ends_on: null, note: '' },
    { id: id(), supplier: 'Netlify', category: 'Hosting and software', amount: 19, recurring: true, starts_on: addDays(m0, -150), ends_on: null, note: '' },
    { id: id(), supplier: 'Supabase', category: 'Hosting and software', amount: 20, recurring: true, starts_on: addDays(m0, -150), ends_on: null, note: '' },
    { id: id(), supplier: 'Resend', category: 'Email and texts', amount: 16, recurring: true, starts_on: addDays(m0, -120), ends_on: null, note: '' },
    { id: id(), supplier: 'Business insurance', category: 'Insurance', amount: 32, recurring: true, starts_on: addDays(m0, -200), ends_on: null, note: '' },
    { id: id(), supplier: 'Domain for outreach email', category: 'Hosting and software', amount: 9.99, recurring: false, starts_on: addDays(m0, 2), ends_on: null, note: '' },
  ];
  const revenueByMonth = [0, 449, 896, 1294, 1843, 2341];
  const deadlines: Deadline[] = [
    { id: id(), title: 'Professional indemnity and liability insurance renewal', category: 'Insurance', due_on: addDays(today, 9), repeat: 'yearly', note: 'The date is on your policy.', done_at: null },
    { id: id(), title: 'ICO data protection fee', category: 'Data protection', due_on: addDays(today, 41), repeat: 'yearly', note: '', done_at: null },
    { id: id(), title: 'gainora.co.uk domain renewal', category: 'Website', due_on: addDays(today, 120), repeat: 'yearly', note: '', done_at: null },
  ];
  const agreements: Agreement[] = [
    { email: 'demo@clinic.example', name: 'Willow Aesthetics', terms: iso(28), dpa: iso(28) },
    { email: 'sam@brightsmile.example', name: 'Bright Smile Dental', terms: iso(4), dpa: iso(4) },
    { email: 'jo@harbourphysio.example', name: 'Harbour Physio', terms: iso(21), dpa: null },
    { email: 'mike@kmplumbing.example', name: 'K&M Plumbing', terms: null, dpa: null },
    { email: 'lou@lashstudio.example', name: 'The Lash Studio', terms: null, dpa: null },
    { email: 'ben@oakbuild.example', name: 'Oak & Stone Builders', terms: iso(40), dpa: iso(40) },
  ];
  const unpaid: Unpaid[] = [{ id: 'in_demo', email: 'mike@kmplumbing.example', client: 'K&M Plumbing', amount: 498, due: addDays(today, -3), attempts: 2, link: null }];

  return {
    async today() {
      await wait();
      return {
        followUps: dueFollowUps(prospects, today).length,
        calls: prospects.filter((p) => p.call_at && p.call_at.slice(0, 10) >= today).map(({ id: pid, business_name, contact_name, call_at }) => ({ id: pid, business_name, contact_name, call_at })),
        proposals: proposals.filter((p) => p.status === 'sent' || p.status === 'viewed').map((p) => ({ id: p.id, business_name: p.business_name, status: p.status, sent_at: p.sent_at, viewed_at: p.viewed_at, waitingDays: Math.floor((Date.now() - Date.parse(p.viewed_at || p.sent_at!)) / 86_400_000) })),
        unpaid, deadlines: dueSoon(deadlines, today, 14),
      };
    },
    async sales() {
      await wait();
      return {
        today, prospects: [...prospects].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), sequences,
        due: dueFollowUps(prospects, today).map((p) => ({ ...p, draft: draftOf(p), email_ok: canEmail(p, blocked) })),
        proposals: [...proposals].sort((a, b) => b.created_at.localeCompare(a.created_at)), funnel: funnel(prospects, messages, today),
        calls: prospects.filter((p) => p.call_at && p.call_at.slice(0, 10) >= today).sort((a, b) => a.call_at!.localeCompare(b.call_at!)), outreach,
      };
    },
    async prospect(pid) {
      await wait(); const p = find(pid);
      return { prospect: p, messages: messages.filter((m) => m.prospect_id === pid).sort((a, b) => b.sent_at.localeCompare(a.sent_at)), draft: draftOf(p), email_ok: canEmail(p, blocked), proposals: proposals.filter((x) => x.prospect_id === pid) };
    },
    async saveProspect(p) {
      await wait();
      if (p.id) { const cur = find(p.id); Object.assign(cur, p, { updated_at: new Date().toISOString() }); return cur; }
      if (!p.business_name?.trim()) throw new Error('Give the business a name.');
      const dup = prospects.find((x) => sameProspect(p, x)); if (dup) throw new Error(`${dup.business_name} is already on your list.`);
      const row = P({ ...p, source: p.source || 'Added by hand' }); prospects.unshift(row); return row;
    },
    async deleteProspect(pid) { await wait(); const i = prospects.findIndex((x) => x.id === pid); if (i >= 0) prospects.splice(i, 1); },
    async importCsv(csv, source) {
      await wait(400);
      const { rows, skipped } = prospectsFromCsv(csv); let added = 0, duplicates = 0, bl = 0;
      for (const r of rows) {
        if (prospects.some((x) => sameProspect(r, x))) { duplicates++; continue; }
        if (r.email && blocked.has(r.email)) { bl++; continue; }
        prospects.unshift(P({ ...r, source: r.source || source || 'Imported list' })); added++;
      }
      return { added, duplicates, skipped, blocked: bl };
    },
    async startSequence(ids, sequenceId, start) { await wait(); for (const pid of ids) Object.assign(find(pid), { sequence_id: sequenceId, step: 0, started_on: null, next_on: start }); return ids.length; },
    async send(pid, body) {
      await wait(400); const p = find(pid);
      if (!outreach.ready) throw new Error('Outreach email isn’t set up yet (OUTREACH_FROM in Netlify). Copy the message and send it from your own email.');
      const gate = canEmail(p, blocked); if (!gate.ok) throw new Error(gate.why);
      step(p, 'sent', body);
    },
    async markSent(pid, body) { await wait(); step(find(pid), 'sent', body); },
    async skip(pid) { await wait(); step(find(pid), 'skipped'); },
    async replied(pid, note) { await wait(); const p = find(pid); Object.assign(p, { stage: 'replied', next_on: null, note: note ? `${p.note}\n${today}: ${note}`.trim() : p.note }); },
    async doNotContact(pid) { await wait(); const p = find(pid); if (p.email) blocked.add(p.email); Object.assign(p, { unsubscribed_at: new Date().toISOString(), stage: 'lost', lost_reason: 'Asked not to be contacted', next_on: null }); },
    async saveSequences(list) { await wait(); sequences = list.map((s) => ({ ...s, id: s.id || id() })); return sequences; },
    async saveOutreach(o) { await wait(); outreach = { ...o, ready: false, autoSend: o.autoSend }; return outreach; },
    async saveProposal(p) {
      await wait();
      if (!p.business_name?.trim()) throw new Error('Who is the proposal for?');
      if (!p.items?.length) throw new Error('Add at least one package with a price.');
      if (p.id) { const cur = proposals.find((x) => x.id === p.id)!; if (cur.status === 'paid') throw new Error('This proposal is already paid.'); Object.assign(cur, p); return cur; }
      const token = `demo-${Math.random().toString(36).slice(2, 12)}`;
      const row: ProposalRow = { id: id(), token, prospect_id: p.prospect_id ?? null, email: p.email ?? '', business_name: p.business_name, contact_name: p.contact_name ?? '', items: p.items, trial_days: p.trial_days ?? 0, note: p.note ?? '', status: 'draft', expires_on: p.expires_on ?? addDays(today, 14), sent_at: null, viewed_at: null, paid_at: null, created_by: 'Adelin', created_at: new Date().toISOString(), url: `https://app.gainora.co.uk/p/${token}` };
      proposals.unshift(row); return row;
    },
    async sendProposal(pid) {
      await wait(400); const p = proposals.find((x) => x.id === pid)!;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new Error('Add their email address to the proposal first.');
      Object.assign(p, { status: p.status === 'draft' ? 'sent' : p.status, sent_at: new Date().toISOString() });
      if (p.prospect_id) { const pr = prospects.find((x) => x.id === p.prospect_id); if (pr) Object.assign(pr, { stage: 'proposal', next_on: null }); }
    },
    async cancelProposal(pid) { await wait(); const p = proposals.find((x) => x.id === pid); if (p && p.status !== 'paid') p.status = 'cancelled'; },
    async prices() { await wait(); return { prices: book, website: true, stripe: true }; },
    async savePrices(items, publish) { await wait(500); book = items.map((x) => ({ ...x, stripe_product: x.stripe_product ?? `prod_demo_${x.key}` })); void toWebsitePrices(book); return { prices: book, rebuilt: publish }; },
    async health() { await wait(); return { clients: health, settings: { resultsEmails: resultsOn } }; },
    async results(email) { await wait(); const r = resultsFor(email); return { results: r, email: resultsEmail(first(email), r) }; },
    async sendResults() { await wait(400); },
    async careSettings(on) { await wait(); resultsOn = on; },
    async books(month) {
      await wait();
      const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${m0}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 5 + i); return d.toISOString().slice(0, 10); })
        .map((m, i) => { const out = sum(expensesIn(m, expenses)); return { month: m, revenue: revenueByMonth[i], expenses: out, profit: Math.round((revenueByMonth[i] - out) * 100) / 100 }; });
      const row = months.find((m) => m.month === `${month.slice(0, 7)}-01`) ?? months[months.length - 1];
      const monthExp = expensesIn(month, expenses);
      const rolling = revenueByMonth.reduce((a, x) => a + x, 0) + 6 * 1295;
      return { month: row.month, stripe: true, revenueFrom: 'invoices', revenue: row.revenue, expenses: monthExp, expenseTotal: sum(monthExp), profit: Math.round((row.revenue - sum(monthExp)) * 100) / 100, all: expenses, months, unpaid, vat: { rolling, threshold: VAT_THRESHOLD, ...vatStatus(rolling) } };
    },
    async saveExpense(e) {
      await wait();
      if (!e.supplier?.trim()) throw new Error('Who is it paid to?');
      if (e.id) { Object.assign(expenses.find((x) => x.id === e.id)!, e); return; }
      expenses.push({ id: id(), supplier: e.supplier, category: e.category ?? 'Other', amount: Number(e.amount) || 0, recurring: !!e.recurring, starts_on: e.starts_on || today, ends_on: e.ends_on ?? null, note: e.note ?? '' });
    },
    async deleteExpense(eid) { await wait(); const i = expenses.findIndex((x) => x.id === eid); if (i >= 0) expenses.splice(i, 1); },
    async paperwork() {
      await wait();
      const y = Number(today.slice(0, 4));
      return { today, deadlines: [...deadlines].sort((a, b) => a.due_on.localeCompare(b.due_on)), soon: dueSoon(deadlines, today, 30), suggestions: SUGGESTED_DEADLINES.map((x) => ({ ...x, when: x.when ? (x.when(y) < today ? x.when(y + 1) : x.when(y)) : null })), agreements };
    },
    async saveDeadline(d) {
      await wait();
      if (!d.title?.trim() || !d.due_on) throw new Error('Give it a name and a date.');
      if (d.id) { Object.assign(deadlines.find((x) => x.id === d.id)!, d); return; }
      deadlines.push({ id: id(), title: d.title, category: d.category ?? 'Other', due_on: d.due_on, repeat: d.repeat ?? 'none', note: d.note ?? '', done_at: null });
    },
    async deadlineDone(did) { await wait(); const d = deadlines.find((x) => x.id === did)!; const next = nextOccurrence(d.due_on, d.repeat); if (next) d.due_on = next; else d.done_at = new Date().toISOString(); return next; },
    async deleteDeadline(did) { await wait(); const i = deadlines.findIndex((x) => x.id === did); if (i >= 0) deadlines.splice(i, 1); },
    async saveAgreement(email, terms, dpa) { await wait(); const a = agreements.find((x) => x.email === email); if (a) Object.assign(a, { terms: terms ? `${terms}T12:00:00Z` : null, dpa: dpa ? `${dpa}T12:00:00Z` : null }); },
  };
}

export const biz: BizApi = typeof __DEMO__ !== 'undefined' && __DEMO__ ? demoBiz() : liveBiz();
