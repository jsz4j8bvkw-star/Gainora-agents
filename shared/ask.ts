// Ask: which agent findings an answer drew on.
// The model is given each block of context under a short key and asked to end its answer with
// "SOURCES: key, key". That line is stripped from what the owner reads and turned into links to
// the page in the app where the finding lives, so every answer says where it came from.

export interface AskSource { key: string; title: string; url: string }

export const ASK_SOURCE_LINE = 'End your answer with one line: "SOURCES: " followed by the keys of the context blocks you drew on (comma-separated, in square brackets above each block). Only keys you actually used; "SOURCES: none" if the answer is general advice.';

/** Human titles and in-app links for each context block. Dates make it clear how fresh a finding is. */
export function sourceCatalogue(dates: Partial<Record<string, string>> = {}): AskSource[] {
  const when = (k: string) => (dates[k] ? ` (${dates[k]})` : '');
  return [
    { key: 'profile', title: 'Your business profile', url: '/business' },
    { key: 'site', title: `The Watcher’s website check${when('site')}`, url: '/watcher?tab=overview' },
    { key: 'speed', title: `The Watcher’s speed test${when('speed')}`, url: '/watcher?tab=speed' },
    { key: 'reviews', title: `The Watcher’s Google reviews${when('reviews')}`, url: '/watcher?tab=reviews' },
    { key: 'prices', title: `The Watcher’s price comparison${when('prices')}`, url: '/watcher?tab=competitors' },
    { key: 'changes', title: 'The Watcher’s competitor changes', url: '/watcher?tab=competitors' },
    { key: 'competitors', title: 'The Watcher’s competitor watch', url: '/watcher?tab=competitors' },
    { key: 'scout', title: 'The Scout’s research', url: '/scout?tab=research' },
    { key: 'leads', title: 'The Scout’s lead pipeline', url: '/scout?tab=leads' },
    { key: 'tenders', title: 'The Scout’s public contracts', url: '/scout?tab=contracts' },
    { key: 'brief', title: `The Brief${when('brief')}`, url: '/brief' },
    { key: 'numbers', title: 'Your weekly numbers', url: '/brief' },
    { key: 'learned', title: 'What you’ve taught your agents', url: '/business' },
  ];
}

/** Splits the SOURCES line off a reply. Unknown keys are ignored; the answer text is never lost. */
export function parseSources(reply: string, catalogue: AskSource[]): { text: string; sources: { title: string; url: string }[] } {
  const m = reply.match(/(?:^|\n)\s*\**\s*SOURCES?\s*:?\**\s*:?\s*(.*)\s*$/i);
  if (!m) return { text: reply.trim(), sources: [] };
  const text = reply.slice(0, m.index).trim();
  const keys = m[1].toLowerCase().replace(/[[\]*]/g, '').split(/[,;\s]+/).map((k) => k.trim()).filter(Boolean);
  const seen = new Set<string>();
  const sources: { title: string; url: string }[] = [];
  for (const k of keys) {
    const s = catalogue.find((c) => c.key === k);
    if (s && !seen.has(s.key)) { seen.add(s.key); sources.push({ title: s.title, url: s.url }); }
  }
  return { text: text || reply.trim(), sources };
}

/** A context block with its key, as the model sees it. */
export const block = (key: string, body: string) => `[${key}]\n${body}`;
