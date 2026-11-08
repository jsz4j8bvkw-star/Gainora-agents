// The Scout, The Brief and Ask, plus the drafting helpers that "do the work" for the owner.
import { addActions, addAlert, addNote, addValue, db, enc, HttpError, insert, learnedFor, upsert } from './core';
import { ai, extractJson, hasBanned, HOUSE_STYLE, profileContext } from './ai';
import { analyseWeeks, findUnsupportedNumbers, metricsFor, type MetricChange } from '../../shared/metrics';
import { writeBrief, type BriefContext } from '../../shared/brief-writer';
import { isDue } from '../../shared/leads';
import { daysLeft } from '../../shared/tenders';
import { fallbackReply, type ReviewItem } from '../../shared/reviews';
import type { Learned } from '../../shared/learning';

const rid = () => 'r_' + Math.random().toString(36).slice(2, 10);
const isHttp = (u: unknown) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|(\+44|0)\s?\d{3,4}\s?\d{3}\s?\d{3,4}|linkedin\.com\/in\//i;
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const learnedLines = (l: Learned | null | undefined) => (l && l.rules.length ? `\n\nWhat the owner has told us about their preferences (follow these):\n- ${l.rules.join('\n- ')}` : '');

/* ---------- The Scout ---------- */
export interface ScoutResultIn {
  name: string; location: string; website: string; fit: 'strong' | 'possible'; reason: string;
  source_url: string; source_title?: string; when?: string; how?: string;
}

/** Keeps only results that are real, sourced, not personal data, and not something the owner has ruled out. */
export function cleanScoutResults(raw: ScoutResultIn[], profile: any, citedHosts: Set<string>, learned?: Learned | null): any[] {
  const own = host(profile?.business?.website || '');
  const comps = new Set((profile?.competitors?.list || []).map((c: any) => host(c.url)));
  const excludedHosts = new Set(learned?.excludedHosts ?? []);
  const excludedNames = new Set(learned?.excludedNames ?? []);
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r.name !== 'string' || !r.name.trim()) continue;
    if (!isHttp(r.source_url)) continue;
    const site = isHttp(r.website) ? r.website : '';
    const h = host(site);
    if (h && (h === own || comps.has(h) || excludedHosts.has(h))) continue;
    if (excludedNames.has(r.name.trim().toLowerCase())) continue;
    const key = (h || r.name).toLowerCase();
    if (seen.has(key)) continue;
    if (PERSONAL.test(`${r.reason} ${r.name}`)) continue;
    if (citedHosts.size && !citedHosts.has(host(r.source_url)) && !(h && citedHosts.has(h))) continue; // must come from what the search actually returned
    if (hasBanned(r.reason)) continue;
    seen.add(key);
    out.push({
      id: rid(), name: r.name.trim().slice(0, 120), location: String(r.location || '').slice(0, 80), website: site,
      fit: r.fit === 'strong' ? 'strong' : 'possible', reason: String(r.reason || '').slice(0, 400),
      // "How to take part" may quote an organiser's email or phone: point to the source page instead.
      ...(r.when ? { when: String(r.when).slice(0, 80) } : {}), ...(r.how ? { how: String(r.how).replace(new RegExp(PERSONAL.source, 'gi'), 'the contact details on the event page').slice(0, 300) } : {}),
      source: { title: String(r.source_title || host(r.source_url)).slice(0, 140), url: r.source_url }, saved: false,
    });
  }
  return out.slice(0, 12);
}

const CUSTOMER_PROMPT = `You are The Scout, a research agent for a UK small business. Use web search to find real businesses or organisations that match the owner's request.
Rules:
- Only businesses and organisations, never private individuals. Do not include personal email addresses, personal phone numbers or LinkedIn profiles.
- Every result must come from a page you actually found in search, and source_url must be that page.
- Never include the owner's own business or their listed competitors.
- "strong" fit means there is clear public evidence they match; otherwise "possible".
- Do not guess revenue, size or contact names.
Finish with JSON only, in this shape:
{"summary": "two sentences on what you found", "results": [{"name": "", "location": "town", "website": "https://", "fit": "strong|possible", "reason": "one or two sentences of evidence-based reasoning", "source_url": "https://", "source_title": ""}]}`;

const LOCAL_PROMPT = `You are The Scout, researching local opportunities for a UK small business: markets, fairs, festivals, networking groups, business awards, trade shows and community events in the coming months where the owner could meet their customers or partners.
Rules:
- Only real, upcoming opportunities you found in search, with the page as source_url. Skip anything that has already happened.
- Say when it happens and how to take part (how to book a stall, enter or attend), using only what the source says. If a cost is published, include it.
- Prefer low-cost opportunities that match the owner's ideal customer and area.
- No personal contact details.
Finish with JSON only, in this shape:
{"summary": "two sentences", "results": [{"name": "", "location": "town", "website": "https:// (organiser or event page)", "fit": "strong|possible", "when": "date or timing as published", "how": "how to take part", "reason": "why it suits this business", "source_url": "https://", "source_title": ""}]}`;

export async function runScout(search: any, profile: any) {
  const local = search.kind === 'local';
  try {
    const learned = await learnedFor(search.user_id);
    const r = await ai({
      userId: search.user_id, agent: 'scout', maxTokens: 4000, webSearch: { maxUses: 8, country: 'GB' },
      system: `${HOUSE_STYLE}\n${local ? LOCAL_PROMPT : CUSTOMER_PROMPT}${learnedLines(learned)}`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nRequest: ${search.query}\nArea: ${search.area}\nFind up to 10 good matches.` }],
    });
    let parsed: any;
    try { parsed = extractJson(r.text); } catch { throw new Error('The research came back in an unexpected format.'); }
    const cited = new Set(r.citations.map((c) => host(c.url)).filter(Boolean));
    const results = cleanScoutResults(parsed.results, profile, cited, learned);
    const strong = results.filter((x) => x.fit === 'strong').length;
    const noun = local ? 'opportunities' : 'matches';
    const summary = typeof parsed.summary === 'string' && !hasBanned(parsed.summary) ? parsed.summary.slice(0, 600) : `${results.length} ${noun} found. ${strong} are a strong fit.`;
    await db(`scout_searches?id=eq.${search.id}`, { method: 'PATCH', body: { status: results.length ? 'ready' : 'failed', results, summary, error: results.length ? null : 'Nothing found with a reliable public source. Try a broader description or area.' } });
    if (results.length) {
      for (const x of results) await addValue(search.user_id, 'scout', local ? 'opportunity_found' : 'lead_found', `${local ? 'Opportunity' : 'Lead'} found: ${x.name}${x.location ? `, ${x.location}` : ''}`);
      await addNote(search.user_id, 'scout', `For “${search.query}” I found ${results.length} ${noun}${strong ? `, ${strong} of them a strong fit` : ''}. The best place to start is ${results[0].name}${results[0].location ? ` in ${results[0].location}` : ''}.`);
      await addAlert(search.user_id, 'scout', 'good', `${results.length} ${noun} found`, `For “${search.query}”. ${strong} strong fit.`);
      if (strong && !local) await addActions(search.user_id, 'scout', [`Add the ${strong} strong-fit match${strong > 1 ? 'es' : ''} from “${search.query.slice(0, 60)}” to your leads`]);
    }
  } catch (e: any) {
    await db(`scout_searches?id=eq.${search.id}`, { method: 'PATCH', body: { status: 'failed', error: e instanceof HttpError ? e.message : 'The research didn’t finish. Try again or reword your request.' } });
  }
}

const OPT_OUT = 'If this isn’t of interest, just reply “no thanks” and I won’t get in touch again.';

export async function draftIntro(userId: string, profile: any, result: { name: string; location?: string; website?: string; reason: string }): Promise<string> {
  const fallback = `Subject: ${profile.business.name} for ${result.name}\n\nHi there,\n\nI run ${profile.business.name}. ${profile.business.oneLiner}\n\nI came across ${result.name} and thought we might be a good fit: ${lower1(result.reason)}\n\nWould you be open to a short chat or to me sending a few details?\n\nBest wishes,\n${profile.business.ownerName}\n${profile.business.name}\n${profile.business.website}\n\n${OPT_OUT}`;
  let text = fallback;
  try {
    const r = await ai({
      userId, agent: 'scout', maxTokens: 600, fast: true,
      system: `${HOUSE_STYLE}\nWrite a short, warm first email from the owner to a business. Under 120 words in the body. Mention one specific, true reason from the research. A soft call to action. Sign off with the owner's first name and business name and website. End with: ${OPT_OUT} Start with "Subject: ". Plain text only.`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nWriting to: ${result.name} (${result.location ?? ''}, ${result.website ?? ''}).\nResearch: ${result.reason}` }],
    });
    const t = r.text.trim();
    if (t.startsWith('Subject:') && !hasBanned(t)) text = t;
  } catch { /* keep the fallback */ }
  await addValue(userId, 'scout', 'draft_written', `Drafted an introduction to ${result.name}`);
  return text;
}

export async function draftFollowUp(userId: string, profile: any, lead: any): Promise<string> {
  const second = (lead.follow_ups ?? 0) >= 1;
  const best = (profile.offer?.bestSeller || 'what we offer').toLowerCase();
  const fallback = second
    ? `Subject: One last note from ${profile.business.name}\n\nHi,\n\nI won’t keep chasing. If ${lower1(profile.business.oneLiner).replace(/\.$/, '')} is ever useful to ${lead.name}, I’d be glad to hear from you.\n\nThank you for your time,\n${profile.business.ownerName}\n${profile.business.name}`
    : `Subject: Re: ${profile.business.name} for ${lead.name}\n\nHi again,\n\nI wanted to check my note reached you. I know it’s a busy time, so I’ll keep it short: I’d be happy to send more details about ${best}, or arrange a quick call at a time that suits you.\n\nWould that be useful?\n\nBest wishes,\n${profile.business.ownerName}\n${profile.business.name}\n\n${OPT_OUT}`;
  let text = fallback;
  try {
    const r = await ai({
      userId, agent: 'scout', maxTokens: 400, fast: true,
      system: `${HOUSE_STYLE}\nWrite a ${second ? 'final, gracious' : 'short, friendly'} follow-up email from the owner to a business that hasn't replied to their introduction. Under ${second ? 60 : 80} words in the body. No guilt, no pressure, no fake urgency. ${second ? 'Make clear this is the last message.' : `End with: ${OPT_OUT}`} Start with "Subject: ". Plain text only.`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nWriting to: ${lead.name} (${lead.location ?? ''}). Why they fit: ${lead.reason ?? ''}\nThis is follow-up number ${(lead.follow_ups ?? 0) + 1}.` }],
    });
    const t = r.text.trim();
    if (t.startsWith('Subject:') && !hasBanned(t)) text = t;
  } catch { /* keep the fallback */ }
  await addValue(userId, 'scout', 'draft_written', `Drafted a follow-up to ${lead.name}`);
  return text;
}

/* ---------- Review replies (The Watcher) ---------- */
export async function draftReviewReply(userId: string, profile: any, review: ReviewItem): Promise<string> {
  const fallback = fallbackReply(review, profile.business.name, profile.business.ownerName);
  let text = fallback;
  try {
    const r = await ai({
      userId, agent: 'watcher', maxTokens: 400, fast: true,
      system: `${HOUSE_STYLE}\nWrite the owner's public reply to a Google review. 40 to 90 words. Thank the reviewer by first name. Refer to something specific they said. For a critical review: apologise sincerely without arguing or blaming, and invite them to get in touch so it can be put right (do not invent contact details). Never offer discounts, refunds or gifts in exchange for changing the review, and never mention other customers. Sign with the owner's first name. Plain text only.`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nReview by ${review.author}, ${review.rating} stars:\n"${review.text || '(no text, rating only)'}"` }],
    });
    const t = r.text.trim();
    if (t.length > 20 && !hasBanned(t) && !/discount|voucher|refund in exchange/i.test(t)) text = t;
  } catch { /* keep the fallback */ }
  await addValue(userId, 'watcher', 'reply_drafted', `Drafted a reply to ${review.author}`);
  return text;
}

/* ---------- Win-back messages (The Brief) ---------- */
export async function draftWinback(userId: string, profile: any, changes: MetricChange[]): Promise<{ email: string; text: string; social: string }> {
  const best = (profile.offer?.bestSeller || 'our best sellers').toLowerCase();
  const fallback = {
    email: `Subject: Something new from ${profile.business.name}\n\nHi {first name},\n\nIt’s been a little while, so I wanted to share what’s new at ${profile.business.name}, including ${best}.\n\n${profile.competitors?.ourEdge ? `${profile.competitors.ourEdge}\n\n` : ''}If there’s anything you need, just reply to this email.\n\nThank you for your support,\n${profile.business.ownerName}`,
    text: `Hi {first name}, it’s ${profile.business.ownerName} from ${profile.business.name}. We’ve got some new things in, including ${best}. Pop in or reply if you’d like details. Reply STOP to opt out.`,
    social: `New at ${profile.business.name}: ${best}. ${profile.competitors?.ourEdge ?? ''} Come and see us.`.trim(),
  };
  const moves = changes.filter((c) => c.current != null).map((c) => `${c.metric.label}: ${c.direction} ${c.changePct ?? ''}%`).join(', ');
  let out = fallback;
  try {
    const r = await ai({
      userId, agent: 'brief', maxTokens: 900, fast: true,
      system: `${HOUSE_STYLE}\nWrite three short messages the owner can send to past customers to bring them back: an email (under 120 words, with a subject line starting "Subject: "), a text message (under 45 words, ending "Reply STOP to opt out."), and a social media post (under 60 words, no hashtags spam, at most two). Use {first name} as a placeholder. Only mention offers, products or facts given in the business profile; never invent a discount, a deadline or a product. Return JSON only: {"email": "", "text": "", "social": ""}`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nThis week's numbers: ${moves || 'not provided'}` }],
    });
    const j = extractJson(r.text);
    if (typeof j.email === 'string' && typeof j.text === 'string' && typeof j.social === 'string' && !hasBanned(j.email + j.text + j.social)) {
      out = { email: j.email.slice(0, 1500), text: j.text.slice(0, 400), social: j.social.slice(0, 700) };
    }
  } catch { /* keep the fallback */ }
  await addValue(userId, 'brief', 'draft_written', 'Drafted win-back messages for past customers');
  return out;
}

/* ---------- The Brief ---------- */
const DAY_MS = 86_400_000;

/** What the other agents found this week, so the Brief's priorities name real leads, contracts and fixes. */
export async function briefContext(userId: string, profile: any, now = new Date()): Promise<BriefContext> {
  const [leads, matches, ws, searches] = await Promise.all([
    db<any[]>(`leads?select=name,stage,next_follow_up_at,value_gbp&user_id=eq.${userId}&order=updated_at.desc&limit=200`).catch(() => []),
    db<any[]>(`tender_matches?select=fit,status,tenders(title,value,deadline)&user_id=eq.${userId}&status=in.(new,saved)&order=created_at.desc&limit=20`).catch(() => []),
    db<any[]>(`watcher_state?select=state&user_id=eq.${userId}`).catch(() => []),
    db<any[]>(`scout_searches?select=results&user_id=eq.${userId}&status=eq.ready&order=created_at.desc&limit=3`).catch(() => []),
  ]);
  const w = ws[0]?.state;
  const leadNames = new Set(leads.map((l) => String(l.name).toLowerCase()));
  const strong = new Set<string>();
  for (const s of searches) for (const r of s.results || []) if (r.fit === 'strong' && !r.dismissed && !leadNames.has(String(r.name).toLowerCase())) strong.add(String(r.name).toLowerCase());
  const tenders = matches.filter((m) => m.tenders).map((m) => ({ title: String(m.tenders.title), value: m.tenders.value != null ? Number(m.tenders.value) : null, deadline: m.tenders.deadline as string | null, fit: m.fit }))
    .map((t) => ({ title: t.title, value: t.value, daysLeft: daysLeft(t.deadline, now), fit: t.fit }))
    .filter((t) => t.daysLeft == null || t.daysLeft > 0)
    .sort((a, b) => (a.fit === b.fit ? (b.value ?? 0) - (a.value ?? 0) : a.fit === 'strong' ? -1 : 1));
  const low = (w?.reviews?.reviews || []).filter((r: any) => r.isNew && r.rating <= 3).sort((a: any, b: any) => a.rating - b.rating)[0];
  const urgent = (w?.issues || []).find((i: any) => i.level === 'urgent');
  const topFix = (w?.speed?.fixes || []).find((f: any) => !f.done && f.impact === 'High');
  const started = profile?.completedAt ? new Date(profile.completedAt).getTime() : null;
  return {
    dueFollowUps: leads.filter((l) => l.stage === 'contacted' && isDue(l.next_follow_up_at, now)).map((l) => l.name),
    leadsToContact: leads.filter((l) => l.stage === 'to_contact').map((l) => l.name),
    strongLeads: strong.size,
    wonLeads: leads.filter((l) => l.stage === 'won').length,
    inConversation: leads.filter((l) => ['contacted', 'replied', 'meeting'].includes(l.stage)).length,
    tenders: tenders.slice(0, 3).map(({ title, value, daysLeft }) => ({ title, value, daysLeft })),
    urgentIssue: urgent?.title ?? null,
    lowReview: low ? { author: low.author, rating: low.rating } : null,
    topFix: topFix ? { title: topFix.title, who: topFix.who } : null,
    weeksLeft: started ? Math.max(0, Math.ceil((started + 90 * DAY_MS - now.getTime()) / (7 * DAY_MS))) : null,
  };
}

/** The same context as plain lines for the model, with the figures it is allowed to repeat. */
export function briefContextLines(ctx: BriefContext): { text: string; numbers: number[] } {
  const lines: string[] = []; const numbers: number[] = [];
  if (ctx.urgentIssue) lines.push(`Website (The Watcher): urgent issue: ${ctx.urgentIssue}.`);
  if (ctx.lowReview) { lines.push(`Google reviews (The Watcher): a new ${ctx.lowReview.rating}-star review from ${ctx.lowReview.author} is waiting for a reply; a reply is drafted.`); numbers.push(ctx.lowReview.rating); }
  if (ctx.topFix) lines.push(`Website speed (The Watcher): biggest fix is "${ctx.topFix.title}" (${ctx.topFix.who === 'You' ? 'the owner can do it' : 'needs their web person'}).`);
  if (ctx.dueFollowUps?.length) lines.push(`Leads (The Scout): follow-ups due now with ${ctx.dueFollowUps.join(', ')}; the notes are drafted.`);
  if (ctx.leadsToContact?.length) { lines.push(`Leads (The Scout): ${ctx.leadsToContact.length} not yet contacted: ${ctx.leadsToContact.slice(0, 5).join(', ')}; introductions are drafted.`); numbers.push(ctx.leadsToContact.length); }
  if (ctx.strongLeads) { lines.push(`Research (The Scout): ${ctx.strongLeads} strong-fit matches not yet added to leads.`); numbers.push(ctx.strongLeads); }
  if (ctx.wonLeads != null || ctx.inConversation != null) { lines.push(`Pipeline: ${ctx.wonLeads ?? 0} won, ${ctx.inConversation ?? 0} in conversation.`); numbers.push(ctx.wonLeads ?? 0, ctx.inConversation ?? 0); }
  for (const t of ctx.tenders ?? []) { lines.push(`Public contract (The Scout): "${t.title}"${t.value ? `, published value £${t.value}` : ''}${t.daysLeft != null ? `, closes in ${t.daysLeft} days` : ''}.`); if (t.value) numbers.push(t.value); if (t.daysLeft != null) numbers.push(t.daysLeft); }
  if (ctx.weeksLeft != null) { lines.push(`${ctx.weeksLeft} weeks left of the 90-day goal.`); numbers.push(ctx.weeksLeft); }
  return { text: lines.join('\n'), numbers };
}

export async function runBrief(userId: string, profile: any, weekOf: string) {
  const rows = await db<any[]>(`week_numbers?select=week_of,values,note&user_id=eq.${userId}&order=week_of.asc&limit=26`);
  const weeks = rows.map((r) => ({ weekOf: r.week_of, values: r.values }));
  const metrics = metricsFor(profile.numbers?.track || []);
  const changes = analyseWeeks(weeks, metrics);
  const ctx = await briefContext(userId, profile).catch(() => ({} as BriefContext));
  let brief = writeBrief(changes, profile, ctx);

  if (weeks.length >= 2) {
    const facts = changes.filter((c) => c.current != null).map((c) =>
      `${c.metric.label} (${c.metric.unit}): this week ${c.current}, last week ${c.previous ?? 'n/a'}, change ${c.change ?? 'n/a'} (${c.changePct ?? 'n/a'}%), 4-week average ${c.average4 ?? 'n/a'} (${c.vsAveragePct ?? 'n/a'}% vs average)`).join('\n');
    const note = rows[rows.length - 1]?.note;
    const found = briefContextLines(ctx);
    const allowed = [...found.numbers, ...changes.flatMap((c) => [c.current, c.previous, c.change, c.changePct, c.average4, c.vsAveragePct].filter((n): n is number => n != null))];
    for (const m of String(profile.goals?.target || '').match(/\d+(\.\d+)?/g) || []) allowed.push(Number(m));
    try {
      const r = await ai({
        userId, agent: 'brief', maxTokens: 900, fast: true,
        system: `${HOUSE_STYLE}\nYou are The Brief. Explain the week's numbers to the owner: what moved against last week and the four-week average, what it most likely means for this business, and where it leaves their 90-day goal. Then set three priorities for the week. Each priority must be one concrete thing the owner can do this week, naming the real lead, contract, review or fix from "What your other agents found" where one applies, and must serve the 90-day goal. No generic advice such as "review your marketing". Use ONLY the numbers provided; do not calculate new figures. Return JSON only: {"headline": "one sentence", "paragraphs": ["2 or 3 short paragraphs"], "actions": ["3 specific actions for this week"]}`,
        messages: [{ role: 'user', content: `${profileContext(profile)}\n\nThis week's figures:\n${facts}\n${note ? `Owner's note: ${note}\n` : ''}${found.text ? `\nWhat your other agents found this week:\n${found.text}` : ''}` }],
      });
      const j = extractJson(r.text);
      const text = [j.headline, ...(j.paragraphs || []), ...(j.actions || [])].join(' ');
      if (typeof j.headline === 'string' && Array.isArray(j.paragraphs) && Array.isArray(j.actions) && !hasBanned(text) && findUnsupportedNumbers(text, allowed).length === 0) {
        brief = { headline: j.headline.slice(0, 200), paragraphs: j.paragraphs.slice(0, 3).map((p: string) => String(p).slice(0, 900)), actions: j.actions.slice(0, 3).map((a: string) => String(a).slice(0, 200)) };
      }
    } catch (e: any) {
      if (e instanceof HttpError && e.status === 429) throw e;
      console.error('[gainora] brief ai', e?.message);
    }
  }
  const saved = await upsert('briefs', { user_id: userId, week_of: weekOf, ...brief, created_at: new Date().toISOString() }, 'user_id,week_of');
  await addNote(userId, 'brief', brief.headline);
  const dip = changes.some((c) => (c.metric.id === 'orders' || c.metric.id === 'revenue') && c.direction === 'down' && (c.changePct ?? 0) <= -10);
  await addActions(userId, 'brief', [...brief.actions, ...(dip ? ['Send a win-back message to past customers (it’s written for you in The Brief)'] : [])]);
  await addValue(userId, 'brief', 'brief_written', 'Weekly Brief written');
  return saved[0];
}

/* ---------- Ask ---------- */
export async function answer(userId: string, profile: any, question: string) {
  const [history, ws, changes, scout, briefs, nums, leads, tenders, learned] = await Promise.all([
    db<any[]>(`chat_messages?select=role,text&user_id=eq.${userId}&order=created_at.desc&limit=16`),
    db<any[]>(`watcher_state?select=state&user_id=eq.${userId}`),
    db<any[]>(`competitor_changes?select=competitor,summary,detail,created_at&user_id=eq.${userId}&order=created_at.desc&limit=6`),
    db<any[]>(`scout_searches?select=query,kind,summary,results,created_at&user_id=eq.${userId}&status=eq.ready&order=created_at.desc&limit=3`),
    db<any[]>(`briefs?select=week_of,headline,paragraphs,actions&user_id=eq.${userId}&order=week_of.desc&limit=1`),
    db<any[]>(`week_numbers?select=week_of,values&user_id=eq.${userId}&order=week_of.desc&limit=4`),
    db<any[]>(`leads?select=name,stage,next_follow_up_at,follow_ups&user_id=eq.${userId}&stage=neq.lost&order=updated_at.desc&limit=20`),
    db<any[]>(`tender_matches?select=fit,reason,status,tenders(title,buyer,value,deadline)&user_id=eq.${userId}&status=in.(new,saved)&order=created_at.desc&limit=5`),
    learnedFor(userId),
  ]);
  const w = ws[0]?.state;
  const rv = w?.reviews;
  const context = [
    profileContext(profile),
    w ? `Website check (${w.lastCheck}): ${w.up ? 'online' : 'DOWN'}, ${w.responseMs}ms, ${w.brokenLinks?.length ?? 0} broken links. Issues: ${(w.issues || []).map((i: any) => i.title).join('; ') || 'none'}.` : 'Website: not checked yet.',
    w?.speed ? `Google speed test (${w.speed.checkedAt.slice(0, 10)}): speed ${w.speed.scores.performance}/100, Google basics ${w.speed.scores.seo}/100. Top fixes: ${w.speed.fixes.filter((f: any) => !f.done).slice(0, 3).map((f: any) => f.title).join('; ') || 'none'}.` : '',
    rv ? `Google reviews: ${rv.rating} stars from ${rv.count} reviews. Recent: ${rv.reviews.slice(0, 5).map((r: any) => `${r.author} ${r.rating}★ "${String(r.text).slice(0, 120)}"`).join(' | ')}. Competitors: ${rv.competitors.map((c: any) => `${c.name} ${c.rating ?? '–'}★ (${c.count ?? '–'})`).join(', ')}.` : 'Google reviews: listing not connected yet.',
    w?.prices?.rows?.length ? `Price comparison: ${w.prices.rows.map((r: any) => `${r.item}: you ${r.yours?.price ?? '–'}; ${w.prices.competitors.map((c: string, i: number) => `${c} ${r.theirs[i]?.price ?? '–'}`).join(', ')}`).join(' | ')}` : '',
    changes.length ? `Competitor changes:\n${changes.map((c) => `- ${c.created_at.slice(0, 10)} ${c.summary} ${c.detail || ''}`).join('\n')}` : 'Competitor changes: none recorded yet.',
    scout.length ? `Scout research:\n${scout.map((s) => `- "${s.query}" (${s.kind ?? 'customers'}): ${s.summary} Top: ${(s.results || []).filter((r: any) => !r.dismissed).slice(0, 5).map((r: any) => `${r.name} (${r.location}, ${r.fit}${r.when ? `, ${r.when}` : ''}): ${r.reason}`).join(' | ')}`).join('\n')}` : 'Scout: no research yet.',
    leads.length ? `Leads: ${leads.map((l) => `${l.name} (${l.stage}${l.next_follow_up_at ? `, follow-up due ${l.next_follow_up_at.slice(0, 10)}` : ''})`).join('; ')}` : 'Leads: none yet.',
    tenders.length ? `Public contracts that fit: ${tenders.map((t) => `${t.tenders?.title} for ${t.tenders?.buyer} (${t.tenders?.value ? `£${t.tenders.value}` : 'value not stated'}, closes ${t.tenders?.deadline?.slice(0, 10) ?? 'n/a'}): ${t.reason}`).join(' | ')}` : '',
    briefs[0] ? `Latest Brief (${briefs[0].week_of}): ${briefs[0].headline} ${briefs[0].paragraphs.join(' ')} Priorities: ${briefs[0].actions.join('; ')}` : 'Brief: none yet.',
    nums.length ? `Recent weekly numbers: ${nums.map((n) => `${n.week_of}: ${JSON.stringify(n.values)}`).join(' | ')}` : '',
    learned.rules.length ? `The owner's stated preferences:\n- ${learned.rules.join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n');

  await insert('chat_messages', { user_id: userId, role: 'user', text: question.slice(0, 2000) });
  const msgs = history.reverse().map((m) => ({ role: m.role === 'agent' ? 'assistant' as const : 'user' as const, content: m.text }));
  const r = await ai({
    userId, agent: 'ask', maxTokens: 900, fast: true,
    system: `${HOUSE_STYLE}\nYou are Gainora, the owner's business assistant. Answer using the business context below and general good business sense. Be concrete: name the lead, contract, review or fix you mean. If the answer depends on something not in the context, say what you'd need. Keep answers short: two to four short paragraphs, or a short list when steps are needed. You cannot send emails, post or change anything; you advise and draft.\n\nCONTEXT\n${context}`,
    messages: [...msgs, { role: 'user', content: question.slice(0, 2000) }],
  });
  const text = hasBanned(r.text) ? r.text.replace(/guarantee(d)?/gi, 'expect') : r.text;
  const rows = await insert('chat_messages', { user_id: userId, role: 'agent', text: text.trim().slice(0, 6000), sources: r.citations.length ? r.citations.slice(0, 5) : null });
  return rows[0];
}

export { enc };
