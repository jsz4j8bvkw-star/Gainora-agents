import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { Icon } from './ui';

/** A question typed in the palette, picked up by the Ask page when it opens. */
export const pending: { ask: string | null; scout: string | null } = { ask: null, scout: null };

interface Item { id: string; label: string; icon: string; group: 'Ask' | 'Go to'; hint?: string; run: () => void }

const DESTINATIONS = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/clients', label: 'Your clients', icon: 'clients', hint: 'Who is due back, reviews, bookings' },
  { path: '/clients?tab=due', label: 'Due back', icon: 'clock', hint: 'Clients to text this week' },
  { path: '/clients?tab=import', label: 'Import clients', icon: 'download', hint: 'From Fresha, Phorest, Pabau, Booksy, Timely, Treatwell' },
  { path: '/watcher', label: 'The Watcher', icon: 'watcher', hint: 'Website and competitors' },
  { path: '/scout', label: 'The Scout', icon: 'scout', hint: 'Find new customers' },
  { path: '/brief', label: 'The Brief', icon: 'brief', hint: 'Weekly numbers' },
  { path: '/ask', label: 'Ask', icon: 'ask' },
  { path: '/results', label: 'Your results', icon: 'results', hint: 'What your agents have done for you' },
  { path: '/business', label: 'Your business', icon: 'profile', hint: 'Edit your details and goals' },
  { path: '/settings', label: 'Plan and settings', icon: 'settings' },
];

export function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const items = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase();
    const go = DESTINATIONS.filter((d) => !t || d.label.toLowerCase().includes(t) || (d.hint ?? '').toLowerCase().includes(t))
      .map((d) => ({ id: d.path, label: d.label, icon: d.icon, hint: d.hint, group: 'Go to' as const, run: () => navigate(d.path) }));
    const asks: Item[] = q.trim().length > 2 ? [
      { id: 'ask', label: `Ask Gainora: “${q.trim()}”`, icon: 'ask', group: 'Ask', run: () => { pending.ask = q.trim(); navigate('/ask'); } },
      { id: 'scout', label: `Find with The Scout: “${q.trim()}”`, icon: 'scout', group: 'Ask', run: () => { pending.scout = q.trim(); navigate('/scout'); } },
    ] : [];
    return [...asks, ...go];
  }, [q]);

  useEffect(() => { setSel(0); }, [q]);

  const choose = (i: number) => { const it = items[i]; if (!it) return; onClose(); it.run(); };
  const onKey = (e: any) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = '';
  return (
    <div className="palette-back" onClick={(e: any) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and ask">
        <div className="palette-input">
          <Icon name="search" />
          <input ref={inputRef} value={q} onChange={(e: any) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search, or ask about your business" aria-label="Search, or ask about your business"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[sel] ? `pi-${items[sel].id}` : undefined} />
        </div>
        <ul className="palette-list" id="palette-list" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {head && <div className="palette-group" aria-hidden="true">{head}</div>}
                <div id={`pi-${it.id}`} role="option" aria-selected={i === sel} className="palette-item"
                  onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
                  <Icon name={it.icon} /><span>{it.label}</span>{it.hint && <span className="hint">{it.hint}</span>}
                </div>
              </li>
            );
          })}
          {items.length === 0 && <li className="palette-group">Nothing matches. Type a question to ask Gainora.</li>}
        </ul>
        <div className="palette-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
      </div>
    </div>
  );
}

/** Opens the palette with ⌘K or Ctrl+K. */
export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const on = (e: any) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open]);
}
