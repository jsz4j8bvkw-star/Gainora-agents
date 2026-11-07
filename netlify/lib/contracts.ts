// UK public contracts from Contracts Finder (gov.uk), matched to each client's business.
// Public data only: notices are fetched once for everyone, then matched per client.
import { addActions, addAlert, addNote, addValue, db, insert, learnedFor, upsert } from './core';
import { ai, extractJson, hasBanned, HOUSE_STYLE, profileContext } from './ai';
import { daysLeft, parseRelease, shortlist, type Scored, type TenderRecord } from '../../shared/tenders';

const SEARCH = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search';
const UA = 'GainoraScout/1.0 (+https://gainora.co.uk)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoSecs = (d: string) => new Date(d).toISOString().slice(0, 19);

/**
 * Open tenders published in a time window. Follows the result cursor, and stops politely
 * if Contracts Finder rate-limits us (it answers 403 and asks for a 5 minute wait).
 * `complete` is false when we had to stop early, so the caller can retry the same window.
 */
export async function fetchNewTenders(fromIso: string, toIso = new Date().toISOString(), maxPages = 20): Promise<{ tenders: TenderRecord[]; complete: boolean }> {
  const out = new Map<string, TenderRecord>();
  let url: string | null = `${SEARCH}?${new URLSearchParams({ publishedFrom: isoSecs(fromIso), publishedTo: isoSecs(toIso), stages: 'tender', limit: '100' })}`;
  let complete = true;
  for (let page = 0; url; page++) {
    if (page >= maxPages) { complete = false; break; }
    let res: Response;
    try { res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(45_000) }); }
    catch (e: any) { console.error('[gainora] contracts finder', e?.message); complete = false; break; }
    if (res.status === 403 || res.status === 429) { console.warn('[gainora] contracts finder asked us to slow down'); complete = false; break; }
    if (!res.ok) { console.error('[gainora] contracts finder', res.status); complete = false; break; }
    const data: any = await res.json().catch(() => ({}));
    for (const rel of data.releases ?? []) {
      const t = parseRelease(rel);
      if (t) out.set(t.id, t);
    }
    const next = data.links?.next;
    url = typeof next === 'string' && next && (data.releases ?? []).length ? new URL(next, SEARCH).toString() : null;
    if (url) await sleep(1200);
  }
  return { tenders: [...out.values()], complete };
}

export const tenderRow = (t: TenderRecord) => ({
  id: t.id, title: t.title, description: t.description, buyer: t.buyer, value: t.value, currency: t.currency,
  deadline: t.deadline, url: t.url, cpv: t.cpv, region: t.region, sme: t.sme, published_at: t.publishedAt, fetched_at: new Date().toISOString(),
});

export const fromRow = (r: any): TenderRecord => ({
  id: r.id, title: r.title, description: r.description ?? '', buyer: r.buyer ?? '', value: r.value != null ? Number(r.value) : null,
  currency: r.currency ?? 'GBP', deadline: r.deadline ?? null, url: r.url, cpv: r.cpv ?? [], region: r.region ?? null, sme: r.sme ?? null,
  publishedAt: r.published_at ?? r.fetched_at,
});

export async function storeTenders(list: TenderRecord[]) {
  for (let i = 0; i < list.length; i += 200) await upsert('tenders', list.slice(i, i + 200).map(tenderRow), 'id');
}

const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const keywordReason = (s: Scored) => `The notice mentions ${s.matched.slice(0, 3).join(', ')}, which matches what you sell.`;
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Shortlists notices by keywords and industry codes, then asks the AI which ones this business
 * could realistically bid for. Without the AI, only clear keyword matches are kept.
 */
export async function matchTendersForUser(userId: string, profile: any, tenders: TenderRecord[]) {
  if (!tenders.length) return [];
  const learned = await learnedFor(userId);
  // Score everything, then check only the best candidates against what this client has already seen.
  const candidates = shortlist(tenders, profile, learned, 40);
  if (!candidates.length) return [];
  const inList = candidates.map((c) => `"${c.tender.id.replace(/"/g, '')}"`).join(',');
  const have = new Set((await db<any[]>(`tender_matches?select=tender_id&user_id=eq.${userId}&tender_id=in.(${encodeURIComponent(inList)})`)).map((r) => r.tender_id));
  const list = candidates.filter((c) => !have.has(c.tender.id)).slice(0, 15);
  if (!list.length) return [];

  const verdicts = new Map<string, { fit: string; reason: string }>();
  let aiWorked = false;
  try {
    const r = await ai({
      userId, agent: 'scout', maxTokens: 1800, fast: true,
      system: `${HOUSE_STYLE}\nYou check UK public sector contract notices for a small business. For each notice decide whether this business could realistically bid: "strong" (clearly what they sell, at a size they could deliver), "possible" (related and worth a look), or "no". Judge only from the notice and the business profile; don't assume extra capabilities. Give one sentence naming what in the notice fits. Return JSON only: [{"id": "", "fit": "strong|possible|no", "reason": ""}]${learned.rules.length ? `\n\nThe owner's preferences:\n- ${learned.rules.join('\n- ')}` : ''}`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nNotices:\n\n${list.map((s) => [
        `ID: ${s.tender.id}`, `Title: ${s.tender.title}`, `Buyer: ${s.tender.buyer}`,
        `Value: ${s.tender.value ? money(s.tender.value) : 'not stated'}`, `Closes: ${s.tender.deadline?.slice(0, 10) ?? 'not stated'}`,
        `Region: ${s.tender.region ?? 'not stated'}`, `Suitable for small businesses: ${s.tender.sme === true ? 'yes' : s.tender.sme === false ? 'no' : 'not stated'}`,
        `Description: ${s.tender.description.slice(0, 700)}`,
      ].join('\n')).join('\n\n')}` }],
    });
    const arr = extractJson<any[]>(r.text);
    for (const v of Array.isArray(arr) ? arr : []) if (v && typeof v.id === 'string' && typeof v.fit === 'string') verdicts.set(v.id, { fit: v.fit, reason: String(v.reason || '') });
    aiWorked = verdicts.size > 0;
  } catch (e: any) { console.error('[gainora] tender match ai', e?.message); }

  const rows: { user_id: string; tender_id: string; fit: 'strong' | 'possible'; reason: string; status: 'new' }[] = [];
  for (const s of list) {
    let fit: 'strong' | 'possible'; let reason: string;
    if (aiWorked) {
      const v = verdicts.get(s.tender.id);
      if (!v || (v.fit !== 'strong' && v.fit !== 'possible')) continue;
      fit = v.fit;
      reason = v.reason && !hasBanned(v.reason) ? v.reason.slice(0, 300) : keywordReason(s);
    } else {
      if (s.score < 6) continue;
      fit = 'possible'; reason = keywordReason(s);
    }
    rows.push({ user_id: userId, tender_id: s.tender.id, fit, reason, status: 'new' });
  }
  if (!rows.length) return [];
  const saved = await db<any[]>('tender_matches?on_conflict=user_id,tender_id', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=representation' });
  if (!saved?.length) return [];

  const byId = new Map(list.map((s) => [s.tender.id, s.tender]));
  for (const m of saved) {
    const t = byId.get(m.tender_id);
    if (t) await addValue(userId, 'scout', 'tender_found', `Contract found: ${lower1(t.title)}`, t.value);
  }
  const best = saved.map((m) => ({ m, t: byId.get(m.tender_id)! })).filter((x) => x.t)
    .sort((a, b) => (a.m.fit === b.m.fit ? (b.t.value ?? 0) - (a.t.value ?? 0) : a.m.fit === 'strong' ? -1 : 1))[0];
  if (best) {
    const days = daysLeft(best.t.deadline);
    const n = saved.length;
    await addAlert(userId, 'scout', 'good', n === 1 ? 'A public contract that fits you' : `${n} public contracts that fit you`,
      `${best.t.title}${best.t.value ? `, worth ${money(best.t.value)}` : ''}${days != null ? `. Closes in ${days} day${days === 1 ? '' : 's'}` : ''}.`, best.t.url);
    await addNote(userId, 'scout', `I found ${n === 1 ? 'a public contract' : `${n} public contracts`} you could bid for. The best fit is “${best.t.title}” for ${best.t.buyer}${best.t.value ? `, worth ${money(best.t.value)}` : ''}. ${best.m.reason}`);
    await addActions(userId, 'scout', [`Look at the “${best.t.title.slice(0, 80)}” contract${days != null && days <= 21 ? ` before it closes in ${days} days` : ''}`]);
  }
  return saved;
}

/* ---------- Job state (service only) ---------- */
export async function getJob(key: string): Promise<any> {
  const rows = await db<any[]>(`job_state?select=value&key=eq.${key}`).catch(() => []);
  return rows[0]?.value ?? null;
}
export async function setJob(key: string, value: unknown) {
  await upsert('job_state', { key, value, updated_at: new Date().toISOString() }, 'key');
}

/** Open notices already stored, for matching a new client straight after onboarding. */
export async function openTenders(sinceIso: string): Promise<TenderRecord[]> {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10); // a plain date: no reserved characters inside or=()
  const rows = await db<any[]>(`tenders?select=*&published_at=gte.${sinceIso}&or=(deadline.is.null,deadline.gte.${soon})&order=published_at.desc&limit=2000`);
  return rows.map(fromRow);
}

export { insert };
