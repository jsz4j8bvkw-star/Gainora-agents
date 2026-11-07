// The value tracker: what the agents have done for a client, counted honestly.
// Money is only ever shown when it comes from a real source: a deal value the owner entered,
// or the published value of a public contract. Time saved is an estimate with its basis shown.

export type ValueKind =
  | 'issue_found' | 'issue_fixed' | 'competitor_change' | 'review_alert' | 'reply_drafted'
  | 'lead_found' | 'lead_contacted' | 'lead_won' | 'tender_found' | 'opportunity_found'
  | 'draft_written' | 'brief_written' | 'price_check';

export interface ValueEvent {
  id: string;
  agent: 'watcher' | 'scout' | 'brief' | 'you';
  kind: ValueKind;
  title: string;
  amount?: number | null;
  at: string;
}

export const VALUE_KINDS: ValueKind[] = [
  'issue_found', 'issue_fixed', 'competitor_change', 'review_alert', 'reply_drafted', 'lead_found', 'lead_contacted',
  'lead_won', 'tender_found', 'opportunity_found', 'draft_written', 'brief_written', 'price_check',
];

/** Typical minutes an owner would spend doing each piece of work themselves. */
export const VALUE_MINUTES: Record<ValueKind, number> = {
  issue_found: 10, issue_fixed: 0, competitor_change: 10, review_alert: 5, reply_drafted: 10,
  lead_found: 15, lead_contacted: 0, lead_won: 0, tender_found: 15, opportunity_found: 15,
  draft_written: 10, brief_written: 30, price_check: 20,
};

export const VALUE_BASIS =
  'Estimated from typical times: 10 minutes per drafted message or review reply, 15 minutes per researched lead, contract or local opportunity, 30 minutes per Brief, 20 minutes per price comparison, 10 minutes per website issue or competitor change found, and 5 minutes per review alert.';

export interface ValueSummary {
  counts: Record<ValueKind, number>;
  minutesSaved: number;
  wonValue: number;      // from deal values the owner entered
  tenderValue: number;   // published values of contracts found
  events: ValueEvent[];  // newest first
}

export function summariseValue(events: ValueEvent[], since?: Date): ValueSummary {
  const list = (since ? events.filter((e) => new Date(e.at).getTime() >= since.getTime()) : events)
    .slice().sort((a, b) => b.at.localeCompare(a.at));
  const counts = Object.fromEntries(VALUE_KINDS.map((k) => [k, 0])) as Record<ValueKind, number>;
  let minutesSaved = 0; let wonValue = 0; let tenderValue = 0;
  for (const e of list) {
    if (!(e.kind in counts)) continue;
    counts[e.kind]++;
    minutesSaved += VALUE_MINUTES[e.kind];
    if (e.kind === 'lead_won' && typeof e.amount === 'number' && e.amount > 0) wonValue += e.amount;
    if (e.kind === 'tender_found' && typeof e.amount === 'number' && e.amount > 0) tenderValue += e.amount;
  }
  return { counts, minutesSaved, wonValue, tenderValue, events: list };
}

export function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function formatMinutes(min: number, compact = false): string {
  if (min < 60) return compact ? `${min}m` : `${min} min`;
  const h = Math.floor(min / 60); const m = min % 60;
  if (compact) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const GROUP_LABEL: Partial<Record<ValueKind, [string, string]>> = {
  lead_found: ['potential customer found', 'potential customers found'],
  opportunity_found: ['local opportunity found', 'local opportunities found'],
  tender_found: ['public contract found', 'public contracts found'],
  issue_found: ['website issue found', 'website issues found'],
  review_alert: ['new review', 'new reviews'],
  competitor_change: ['competitor change', 'competitor changes'],
};

/** Collapses runs of the same kind of event on one day into a single readable line. */
export function groupDay(events: ValueEvent[]): { id: string; agent: ValueEvent['agent']; title: string; amount?: number | null }[] {
  const out: { id: string; agent: ValueEvent['agent']; title: string; amount?: number | null }[] = [];
  const byKind = new Map<string, ValueEvent[]>();
  for (const e of events) byKind.set(`${e.agent}:${e.kind}`, [...(byKind.get(`${e.agent}:${e.kind}`) ?? []), e]);
  const done = new Set<string>();
  for (const e of events) {
    const key = `${e.agent}:${e.kind}`;
    if (done.has(key)) continue;
    const list = byKind.get(key)!;
    const label = GROUP_LABEL[e.kind];
    if (list.length >= 3 && label) {
      done.add(key);
      const names = list.map((x) => x.title.replace(/^[^:]+:\s*/, '').split(',')[0]);
      const total = list.reduce((a, x) => a + (typeof x.amount === 'number' ? x.amount : 0), 0);
      out.push({ id: list[0].id, agent: e.agent, title: `${list.length} ${label[1]}: ${names.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`, amount: total || null });
    } else {
      out.push({ id: e.id, agent: e.agent, title: e.title, amount: e.amount });
    }
  }
  return out;
}

/** One plain sentence describing the period, built only from non-zero counts. */
export function valueSentence(s: ValueSummary, period: string): string {
  const c = s.counts;
  const parts: string[] = [];
  const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  if (c.issue_found) parts.push(n(c.issue_found, 'website issue', 'website issues'));
  if (c.competitor_change) parts.push(n(c.competitor_change, 'competitor change', 'competitor changes'));
  if (c.lead_found) parts.push(n(c.lead_found, 'potential customer', 'potential customers'));
  if (c.tender_found) parts.push(n(c.tender_found, 'public contract', 'public contracts'));
  if (c.opportunity_found) parts.push(n(c.opportunity_found, 'local opportunity', 'local opportunities'));
  if (c.review_alert) parts.push(n(c.review_alert, 'new review', 'new reviews'));
  const drafted = c.draft_written + c.reply_drafted;
  const found = parts.length ? `found ${joinList(parts)}` : '';
  const wrote = drafted ? `drafted ${n(drafted, 'message', 'messages')} for you` : '';
  if (!found && !wrote) return `Your agents are getting started. Their work ${period} will add up here.`;
  return `${capital(period)} your agents ${[found, wrote].filter(Boolean).join(', and ')}.`;
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
