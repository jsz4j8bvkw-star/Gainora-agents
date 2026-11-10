// The last seven days in Capture & Convert, as numbers for The Brief: enquiries caught, how many came in out of
// hours, how many booked, and what those bookings are worth at the clinic's own prices. Imported history from an
// old booking system doesn't count (it isn't something Gainora caught). Pure, so the app and tests agree.
import type { CaptureWeek } from '../src/lib/types';

/** "£250" → 250, "from £180" → 180 (a minimum), "Free" → 0, anything else → null. */
export function priceOf(raw: string | undefined): { amount: number; from: boolean } | null {
  const s = String(raw ?? '').toLowerCase();
  if (/free/.test(s)) return { amount: 0, from: false };
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? { amount: Number(m[1]), from: /from|\+|-|–/.test(s) } : null;
}

export function captureWeekFrom(rows: any[], types: { name?: string; price?: string }[], since: string, now = new Date()): CaptureWeek {
  const real = rows.filter((r) => r.status !== 'spam' && !(r.history ?? []).some((h: any) => /^Imported from /.test(h?.text ?? '')));
  const booked = real.filter((r) => r.status === 'booked' || r.status === 'won');
  let value = 0, minimum = false;
  for (const r of booked) {
    if (typeof r.job_value === 'number' && r.job_value > 0) { value += r.job_value; continue; }
    const t = types.find((x) => String(x.name ?? '').toLowerCase() === String(r.booked_type ?? '').toLowerCase());
    const p = priceOf(t?.price);
    if (p) { value += p.amount; minimum ||= p.from; } else minimum = true;
  }
  return { from: since, to: now.toISOString(), enquiries: real.length, afterHours: real.filter((r) => r.after_hours).length, booked: booked.length, bookedValue: Math.round(value), valueIsMinimum: minimum };
}
