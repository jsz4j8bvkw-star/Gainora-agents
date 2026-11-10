// Gainora admin: the shapes shared by the admin app, its server and the Claude connector.

export type Package = 'command' | 'capture' | 'launch';
export const PACKAGES: Record<Package, { label: string; short: string }> = {
  command: { label: 'Command Centre', short: 'CC' },
  capture: { label: 'Capture & Convert', short: 'C&C' },
  launch: { label: 'Launch & Grow', short: 'L&G' },
};
export type Project = Package | 'other';
export const PROJECT_LABEL: Record<Project, string> = { ...Object.fromEntries(Object.entries(PACKAGES).map(([k, v]) => [k, v.label])) as Record<Package, string>, other: 'Other' };

export type TaskWho = 'gainora' | 'client' | 'claude';
export const WHO_LABEL: Record<TaskWho, string> = { gainora: 'Gainora', client: 'Client', claude: 'Claude' };
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'Doing', waiting: 'Waiting', done: 'Done' };

export interface AdminTask {
  id: string; email: string; project: Project; template_key: string | null; title: string; detail: string; who: TaskWho;
  due_on: string | null; status: TaskStatus; done_at: string | null; sort: number; created_by: string; created_at: string;
  /** Ticked off by what the apps show (the questionnaire is finished, the site is live…), not by hand. */
  auto?: boolean;
}

export type AccountStatus = 'onboarding' | 'active' | 'paused' | 'left';
export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = { onboarding: 'Setting up', active: 'Active', paused: 'Paused', left: 'Left' };
export interface AccountRecord {
  email: string; business_name: string; contact_name: string; phone: string; status: AccountStatus;
  started_on: string | null; setup_fee: number | null; setup_paid: boolean; notes: string; updated_at: string;
}

export type Billing = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
export interface AccountSummary {
  email: string; userId: string | null; name: string; contact: string; phone: string;
  packages: Package[]; status: AccountStatus; billing: Billing;
  /** What they pay a month, from Stripe. Null when Stripe isn't connected or has nothing for them. */
  monthly: number | null; renewsOn: string | null; startedOn: string | null;
  setupStarted: boolean; progress: { done: number; total: number }; overdue: number; nextDue: { title: string; due_on: string } | null;
  openRequests: number; site: { slug: string; live: boolean; domain: string | null } | null;
}

export interface LogEntry { id: string; email: string; at: string; author: string; kind: 'note' | 'call' | 'email' | 'work' | 'system'; text: string }
export interface CostEntry { id: string; email: string; month: string; item: string; amount: number }

/** One row per subscribed product → the packages a client has. */
export function packagesOf(agents: string[]): Package[] {
  const out: Package[] = [];
  if (agents.some((a) => a === 'watcher' || a === 'scout' || a === 'brief')) out.push('command');
  if (agents.includes('capture')) out.push('capture');
  if (agents.includes('website')) out.push('launch');
  return out;
}

const RANK: Billing[] = ['active', 'trialing', 'past_due', 'canceled', 'none'];
/** The best billing state across their subscriptions: one active product makes the client active. */
export function billingOf(statuses: string[]): Billing {
  const known = statuses.map((s) => (RANK.includes(s as Billing) ? (s as Billing) : s === 'cancelled' ? 'canceled' : 'none'));
  return known.sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] ?? 'none';
}

export const normEmail = (e: string) => String(e || '').trim().toLowerCase();
