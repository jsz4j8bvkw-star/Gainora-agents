// Learning from the owner's "Useful" and "Not relevant" answers.
// Everything here is plain, inspectable rules: the owner can see what was learned and remove it.

export type FeedbackKind = 'lead' | 'opportunity' | 'tender' | 'change' | 'fix' | 'review' | 'note' | 'action';

export interface FeedbackRecord {
  id: string;
  agent: 'watcher' | 'scout' | 'brief';
  itemKind: FeedbackKind;
  itemId: string;
  verdict: 'useful' | 'not_relevant';
  reason?: string | null;
  text: string;            // what the item said, so the rule can be explained later
  host?: string | null;    // website of a lead or opportunity
  changeKind?: string | null;
  createdAt: string;
}

export interface Learned {
  excludedHosts: string[];
  excludedNames: string[];
  mutedChangeKinds: string[];
  negativeKeywords: string[];
  positiveKeywords: string[];
  rules: string[];         // plain sentences shown to the owner and given to the agents
}

/** Reasons offered when something is marked "Not relevant", per kind of item. */
export const REASONS: Record<FeedbackKind, string[]> = {
  lead: ['Not our market', 'Too far away', 'Too big for us', 'Already know them'],
  opportunity: ['Not our market', 'Too far away', 'Wrong time of year', 'Too expensive'],
  tender: ['Not our field', 'Too big for us', 'Too far away', 'Deadline too soon'],
  change: ['Not important', 'Wrong competitor', 'Already knew'],
  fix: ['Already done', 'Not possible on our website', 'Not important'],
  review: ['Not important'],
  note: ['Not important', 'Wrong'],
  action: ['Not important', 'Already done'],
};

const REASON_RULES: Record<string, string> = {
  'Too far away': 'Prefer results close to the owner’s area.',
  'Too big for us': 'Prefer smaller organisations and smaller contracts that suit a small team.',
  'Not our market': 'Stick closely to the owner’s described ideal customer.',
  'Not our field': 'Only suggest contracts that match what the business actually sells.',
  'Already know them': 'Skip businesses the owner already knows.',
  'Deadline too soon': 'Prefer contracts with at least two weeks before the deadline.',
  'Wrong time of year': 'Prefer opportunities in the coming season, not ones far ahead or just past.',
  'Too expensive': 'Prefer low-cost opportunities.',
  'Not important': 'Leave out minor items; only flag things that affect sales, prices or reputation.',
};

const STOP = new Set(('a an and are as at be by for from has have in into is it its of on or that the this to with will our your their we you they '
  + 'supply provision services service contract contracts framework lot lots council county borough district city trust nhs agreement '
  + 'requirement requirements tender opportunity notice works work delivery including include various other new uk '
  + 'all any can per not may who via use one two end day set out own off see get but his her was had how etc inc ltd plc lot yes').split(/\s+/));

export function keywordsOf(text: string): string[] {
  const words = (text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)); // 3 letters so "mugs", "cups" and "art" still match
  return [...new Set(words)];
}

export const hostOf = (u?: string | null): string => {
  if (!u) return '';
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};

/** A website's host from either a full address or a bare host name ("shop.co.uk"). */
export const normHost = (h?: string | null): string => (h ? hostOf(h.includes('://') ? h : `https://${h}`) : '');

export function learnFrom(feedback: FeedbackRecord[]): Learned {
  const list = [...feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const excludedHosts = new Set<string>();
  const excludedNames = new Set<string>();
  const changeVotes = new Map<string, { not: number; useful: number }>();
  const tenderNeg = new Map<string, number>();
  const tenderPos = new Set<string>();
  const reasonCounts = new Map<string, number>();

  for (const f of list) {
    if (f.verdict === 'not_relevant' && f.reason) reasonCounts.set(f.reason, (reasonCounts.get(f.reason) ?? 0) + 1);
    if ((f.itemKind === 'lead' || f.itemKind === 'opportunity') && f.verdict === 'not_relevant') {
      const h = normHost(f.host);
      if (h) excludedHosts.add(h);
      excludedNames.add(f.text.split(',')[0].trim().toLowerCase());
    }
    if (f.itemKind === 'change' && f.changeKind) {
      const v = changeVotes.get(f.changeKind) ?? { not: 0, useful: 0 };
      if (f.verdict === 'useful') v.useful++; else v.not++;
      changeVotes.set(f.changeKind, v);
    }
    if (f.itemKind === 'tender') {
      for (const k of keywordsOf(f.text)) {
        if (f.verdict === 'useful') tenderPos.add(k);
        else tenderNeg.set(k, (tenderNeg.get(k) ?? 0) + 1);
      }
    }
  }

  const mutedChangeKinds = [...changeVotes.entries()].filter(([, v]) => v.not >= 2 && v.useful === 0).map(([k]) => k);
  const negativeKeywords = [...tenderNeg.entries()].filter(([k, n]) => n >= 2 && !tenderPos.has(k)).map(([k]) => k);
  const positiveKeywords = [...tenderPos];

  const rules: string[] = [];
  for (const [reason, n] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (n >= 2 && REASON_RULES[reason]) rules.push(REASON_RULES[reason]);
  }
  const CHANGE_LABEL: Record<string, string> = { content: 'general page updates', 'new-page': 'new competitor pages', price: 'competitor price changes', offer: 'competitor offers' };
  for (const k of mutedChangeKinds) rules.push(`Don’t alert the owner about ${CHANGE_LABEL[k] ?? k}.`);
  if (excludedNames.size) rules.push(`Never suggest these again: ${[...excludedNames].slice(0, 12).map(titleCase).join(', ')}.`);
  if (negativeKeywords.length) rules.push(`Contracts about ${negativeKeywords.slice(0, 8).join(', ')} are not a fit.`);
  const liked = list.filter((f) => f.verdict === 'useful').slice(0, 5).map((f) => `“${f.text.slice(0, 90)}”`);
  if (liked.length) rules.push(`The owner found these useful, so look for more like them: ${liked.join('; ')}.`);

  return { excludedHosts: [...excludedHosts], excludedNames: [...excludedNames], mutedChangeKinds, negativeKeywords, positiveKeywords, rules };
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
