// The set-up checklist for each package, with deadlines counted from the day set-up starts. Some steps tick
// themselves off from what the apps show, so nobody has to remember to.

import { launchPlan } from '../site/kit';
import { newSite } from '../site/data';
import type { AdminTask, Package, TaskWho } from './model';

/** Things the apps can tell us are done. */
export type AutoCheck =
  | 'cc-profile' | 'cc-watcher' | 'cc-brief'
  | 'cap-settings' | 'cap-source' | 'cap-call'
  | 'site-live' | 'site-domain' | 'site-reviewlink' | 'site-photo';

export interface TaskTemplate { key: string; project: Package; title: string; detail?: string; who: TaskWho; day: number; auto?: AutoCheck }

const COMMAND: TaskTemplate[] = [
  { key: 'cmd:onboarding', project: 'command', title: 'Client finishes onboarding in Command Centre', who: 'client', day: 1, auto: 'cc-profile' },
  { key: 'cmd:watcher', project: 'command', title: 'First Watcher check run and read through', who: 'gainora', day: 3, auto: 'cc-watcher' },
  { key: 'cmd:brief', project: 'command', title: 'First Brief delivered', who: 'gainora', day: 7, auto: 'cc-brief' },
  { key: 'cmd:checkin', project: 'command', title: 'Two-week check-in call', detail: 'What they’ve used, what they haven’t, one thing to do next.', who: 'gainora', day: 14 },
];

const CAPTURE: TaskTemplate[] = [
  { key: 'cap:kickoff', project: 'capture', title: 'Set-up call: go through the questionnaire together', who: 'gainora', day: 0 },
  { key: 'cap:questionnaire', project: 'capture', title: 'Questionnaire finished in Capture & Convert', who: 'client', day: 2, auto: 'cap-settings' },
  { key: 'cap:number', project: 'capture', title: 'Buy their UK phone number and connect it to the receptionist', detail: 'Confirm the price before buying.', who: 'gainora', day: 3 },
  { key: 'cap:receptionist', project: 'capture', title: 'Set up the receptionist: wording, caller lookup and booking tools', who: 'gainora', day: 4, auto: 'cap-source' },
  { key: 'cap:booking', project: 'capture', title: 'Connect their booking system, or set up the Gainora diary', who: 'gainora', day: 5 },
  { key: 'cap:test', project: 'capture', title: 'Test calls: a booking, an urgent one and one out of hours', detail: 'Check each summary and follow-up arrives.', who: 'gainora', day: 6, auto: 'cap-call' },
  { key: 'cap:forward', project: 'capture', title: 'Client forwards missed calls to the new number', who: 'client', day: 7 },
  { key: 'cap:live', project: 'capture', title: 'Go live and tell them what to expect', who: 'gainora', day: 7 },
  { key: 'cap:review', project: 'capture', title: 'Week-one review call', detail: 'Enquiries caught, anything to change in the wording.', who: 'gainora', day: 14 },
];

const LAUNCH_AUTO: Record<string, AutoCheck> = { 'l-publish': 'site-live', 'l-domain': 'site-domain', 'k-reviews': 'site-reviewlink', 'w-photos': 'site-photo' };
/** The Launch & Grow six weeks, the same steps the client sees on their Website page. Due at the end of each week. */
const LAUNCH: TaskTemplate[] = launchPlan(newSite()).flatMap((w, i) => w.tasks.map((t): TaskTemplate => ({
  key: `launch:${t.id}`, project: 'launch', title: t.text, detail: [t.who === 'both' ? 'With the client.' : '', t.detail ?? ''].filter(Boolean).join(' '),
  who: t.who === 'owner' ? 'client' : 'gainora', day: i * 7 + 4, auto: LAUNCH_AUTO[t.id],
})));

export const TEMPLATES: Record<Package, TaskTemplate[]> = { command: COMMAND, capture: CAPTURE, launch: LAUNCH };
const BY_KEY = new Map(Object.values(TEMPLATES).flat().map((t) => [t.key, t]));
export const templateFor = (key: string | null | undefined) => (key ? BY_KEY.get(key) : undefined);
/** The Launch & Grow task's id on the client's own launch plan (site.data.plan). */
export const launchPlanId = (key: string | null | undefined) => (key?.startsWith('launch:') ? key.slice(7) : null);

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The checklist rows for a package, starting on `start` (YYYY-MM-DD). */
export function tasksFor(pkg: Package, email: string, start: string, by = 'Gainora'): Omit<AdminTask, 'id' | 'created_at'>[] {
  return TEMPLATES[pkg].map((t, i) => ({
    email, project: t.project, template_key: t.key, title: t.title, detail: t.detail ?? '', who: t.who,
    due_on: addDays(start, t.day), status: 'todo', done_at: null, sort: i, created_by: by,
  }));
}

/** Marks tasks done that the apps show are done: an automatic check passed, or the client ticked it on their launch plan. */
export function withAuto<T extends AdminTask>(tasks: T[], passed: Set<AutoCheck>, sitePlan: Record<string, boolean> = {}): T[] {
  return tasks.map((t) => {
    if (t.status === 'done') return t;
    const auto = templateFor(t.template_key)?.auto;
    const planId = launchPlanId(t.template_key);
    if ((auto && passed.has(auto)) || (planId && sitePlan[planId])) return { ...t, status: 'done', auto: true };
    return t;
  });
}
