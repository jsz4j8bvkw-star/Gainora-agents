const DAY = 86_400_000;

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function longDate(d: Date | string = new Date()): string {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function relative(d: Date | string, now = Date.now()): string {
  const t = new Date(d).getTime();
  const diff = now - t;
  const future = diff < 0;
  const a = Math.abs(diff);
  const mins = Math.round(a / 60_000);
  if (mins < 1) return 'just now';
  let s: string;
  if (mins < 60) s = `${mins} min`;
  else if (a < DAY) s = `${Math.round(mins / 60)} h`;
  else if (a < 7 * DAY) {
    const days = Math.round(a / DAY);
    if (days === 1) return future ? 'tomorrow' : 'yesterday';
    s = `${days} days`;
  } else return shortDate(d);
  return future ? `in ${s}` : `${s} ago`;
}

export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  return '£' + n.toLocaleString('en-GB', { maximumFractionDigits: n < 100 ? 2 : 0 });
}

export function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  return n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

export function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  return `${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
}

export function mondayOf(d = new Date()): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}
