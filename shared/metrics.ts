import type { MetricDef, WeekNumbers } from '../src/lib/types';

export const METRICS: Record<string, MetricDef> = {
  'Revenue': { id: 'revenue', label: 'Revenue', unit: 'money' },
  'Orders or sales': { id: 'orders', label: 'Orders', unit: 'count' },
  'Enquiries': { id: 'enquiries', label: 'Enquiries', unit: 'count' },
  'Website visitors': { id: 'visitors', label: 'Website visitors', unit: 'count' },
  'Conversion rate': { id: 'conversion', label: 'Conversion rate', unit: 'percent' },
  'Repeat customers': { id: 'repeat', label: 'Repeat customers', unit: 'count' },
  'Ad spend': { id: 'adspend', label: 'Ad spend', unit: 'money' },
  'New reviews': { id: 'reviews', label: 'New reviews', unit: 'count' },
};

export function metricsFor(track: string[]): MetricDef[] {
  const list = track.map((t) => METRICS[t]).filter(Boolean);
  return list.length ? list : [METRICS['Revenue'], METRICS['Orders or sales'], METRICS['Enquiries']];
}

export interface MetricChange {
  metric: MetricDef;
  current: number | null;
  previous: number | null;
  change: number | null;      // absolute
  changePct: number | null;   // percent vs previous
  average4: number | null;    // average of the 4 weeks before current
  vsAveragePct: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Week-on-week analysis. `weeks` sorted oldest → newest; the last one is "this week". */
export function analyseWeeks(weeks: WeekNumbers[], metrics: MetricDef[]): MetricChange[] {
  const sorted = [...weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  const cur = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const before = sorted.slice(-5, -1);
  return metrics.map((metric) => {
    const current = cur?.values[metric.id] ?? null;
    const previous = prev?.values[metric.id] ?? null;
    const hist = before.map((w) => w.values[metric.id]).filter((v): v is number => typeof v === 'number');
    const average4 = hist.length ? round1(hist.reduce((a, b) => a + b, 0) / hist.length) : null;
    const change = current != null && previous != null ? round1(current - previous) : null;
    const changePct = change != null && previous ? round1((change / previous) * 100) : null;
    const vsAveragePct = current != null && average4 ? round1(((current - average4) / average4) * 100) : null;
    let direction: MetricChange['direction'] = 'unknown';
    if (changePct != null) direction = Math.abs(changePct) < 3 ? 'flat' : changePct > 0 ? 'up' : 'down';
    else if (change != null) direction = change === 0 ? 'flat' : change > 0 ? 'up' : 'down';
    return { metric, current, previous, change, changePct, average4, vsAveragePct, direction };
  });
}

/** Metrics where "down" is good news. */
export const LOWER_IS_BETTER = new Set(['adspend']);

export function isGood(c: MetricChange): boolean | null {
  if (c.direction === 'unknown' || c.direction === 'flat') return null;
  const up = c.direction === 'up';
  return LOWER_IS_BETTER.has(c.metric.id) ? !up : up;
}

/** Every number that appears in a sentence must exist in the allowed set (guards AI from inventing figures). */
export function findUnsupportedNumbers(text: string, allowed: number[]): string[] {
  const allowedSet = new Set<string>();
  for (const n of allowed) {
    if (n == null || Number.isNaN(n)) continue;
    const a = Math.abs(n);
    [a, Math.round(a), round1(a), Math.round(a * 100) / 100].forEach((v) => allowedSet.add(String(v)));
  }
  const found = text.match(/£?\d[\d,]*(\.\d+)?%?/g) || [];
  return found.filter((raw) => {
    const n = raw.replace(/[£,%]/g, '');
    if (/^(19|20)\d\d$/.test(n)) return false; // years
    if (Number(n) <= 10 && !raw.includes('£') && !raw.includes('%')) return false; // small counts like "3 actions"
    return !allowedSet.has(String(Number(n)));
  });
}
