import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { humanThrown } from '../lib/errors';

/* ---------- Icons (24px stroke) ---------- */
const PATHS: Record<string, string> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  watcher: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  scout: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  brief: 'M6 3.5h8.5L19 8v12.5H6zM14 3.5V8h5M9 13h7M9 16.5h5',
  ask: 'M4.5 5.5h15v10h-8l-4.5 4v-4h-2.5z',
  profile: 'M4 20.5V8l8-4.5 8 4.5v12.5M9 20.5v-6h6v6M8 10.5h.01M12 10.5h.01M16 10.5h.01',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 5.5l6.5 6.5L9 18.5',
  back: 'M15 5.5 8.5 12l6.5 6.5',
  external: 'M14 4.5h5.5V10M19.5 4.5 11 13M18 14v5.5H4.5V6H10',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  alert: 'M12 8v5M12 16.5h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 11v5.5M12 7.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  lock: 'M6.5 10.5h11v9h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  send: 'M4.5 12h13M12 5.5l6.5 6.5-6.5 6.5',
  copy: 'M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 19.5h14',
  bookmark: 'M6.5 4h11v16.5L12 16l-5.5 4.5z',
  logout: 'M14.5 4.5h5v15h-5M10 8l-4 4 4 4M6 12h9.5',
  pencil: 'M4.5 19.5l1-4.5L16 4.5l3.5 3.5L9 18.5zM14 6.5l3.5 3.5',
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM16 16l4.5 4.5',
  thumbUp: 'M7.5 10.5v9H4.5v-9zM7.5 10.5l3.6-6.5c1.3 0 2.2 1 1.9 2.3l-.7 3.2h5.2a1.8 1.8 0 0 1 1.8 2.1l-1.2 6.8a1.8 1.8 0 0 1-1.8 1.6H7.5',
  thumbDown: 'M7.5 13.5v-9H4.5v9zM7.5 13.5l3.6 6.5c1.3 0 2.2-1 1.9-2.3l-.7-3.2h5.2a1.8 1.8 0 0 0 1.8-2.1l-1.2-6.8a1.8 1.8 0 0 0-1.8-1.6H7.5',
  star: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z',
  results: 'M5 19.5V13M10 19.5V9M15 19.5v-4M20 19.5V5.5M3.5 19.5h17',
  contract: 'M7 3.5h7l4 4v13H7zM14 3.5V8h4M10 12h5M10 15.5h5M10 9h1.5',
  pin: 'M12 21s6.5-5.8 6.5-11a6.5 6.5 0 0 0-13 0c0 5.2 6.5 11 6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5.5l3.5 2',
  bolt: 'M13 3.5L5.5 13.5H12l-1 7 7.5-10H12z',
  tag: 'M3.5 12.5V4h8.5l8.5 8.5-8 8zM8 8.5h.01',
  clients: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.7M18.5 14.6c1.8.7 2.8 2.3 3 4.9',
};

export function Icon({ name, title, className }: { name: keyof typeof PATHS | string; title?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

/* ---------- Buttons ---------- */
export function Button(props: {
  kind?: 'primary' | 'secondary' | 'quiet'; small?: boolean; block?: boolean; busy?: boolean; icon?: string;
  type?: 'button' | 'submit'; disabled?: boolean; onClick?: () => void; children?: any; className?: string; 'aria-label'?: string;
}) {
  const { kind = 'primary', small, block, busy, icon, type = 'button', disabled, onClick, children, className } = props;
  const cls = ['btn', `btn-${kind}`, small && 'btn-small', block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || busy} onClick={onClick} aria-busy={busy || undefined} aria-label={props['aria-label']}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/* ---------- Fields ---------- */
export function Field(props: { label: string; help?: string; error?: string; optional?: boolean; className?: string; children: (id: string, describedBy?: string) => any; as?: 'label' | 'group' }) {
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [props.help && helpId, props.error && errId].filter(Boolean).join(' ') || undefined;
  const group = props.as === 'group';
  const Label: any = group ? 'div' : 'label';
  return (
    <div className={`field ${props.className ?? ''}`} role={group ? 'group' : undefined} aria-labelledby={group ? `${id}-l` : undefined}>
      <Label className="field-label" htmlFor={group ? undefined : id} id={`${id}-l`}>
        {props.label}{props.optional && <span className="opt">Optional</span>}
      </Label>
      {props.children(id, describedBy)}
      {props.help && !props.error && <div className="field-help" id={helpId}>{props.help}</div>}
      {props.error && <div className="field-error" id={errId}>{props.error}</div>}
    </div>
  );
}

export function Choices(props: { options: string[]; value: string | string[]; multi?: boolean; onChange: (v: any) => void; name: string; describedBy?: string }) {
  const { options, value, multi, onChange, name } = props;
  const selected = (o: string) => (multi ? (value as string[]).includes(o) : value === o);
  return (
    <div className="choices" aria-describedby={props.describedBy}>
      {options.map((o) => (
        <label key={o} className={`choice ${selected(o) ? 'on' : ''}`}>
          <input
            type={multi ? 'checkbox' : 'radio'} name={name} checked={selected(o)}
            onChange={() => {
              if (multi) {
                const arr = value as string[];
                onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
              } else onChange(o);
            }}
          />
          <svg className="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          {o}
        </label>
      ))}
    </div>
  );
}

/* ---------- Charts ---------- */
export function Sparkline({ values, height = 56, label, tone = 'forest', marker = false }: { values: (number | null)[]; height?: number; label: string; tone?: 'forest' | 'ink'; marker?: boolean }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null) as { v: number; i: number }[];
  if (pts.length < 2) return <div className="faint small" style={{ height }}>Not enough data yet</div>;
  const w = 300;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 8) + 4;
  const y = (v: number) => height - 6 - ((v - min) / span) * (height - 14);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const color = tone === 'forest' ? 'var(--forest)' : 'var(--ink)';
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ height }}>
      <path d={`${d} L${x(last.i)} ${height} L${x(pts[0].i)} ${height} Z`} fill="var(--forest-wash)" stroke="none" />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {marker && <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill={color} />}
    </svg>
  );
}

/* ---------- Data loading ---------- */
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(true);
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await fn(); if (live.current) setData(d); }
    catch (e: any) { if (live.current) setError(humanThrown(e, 'Something went wrong loading this page.')); }
    finally { if (live.current) setLoading(false); }
  }, deps);
  useEffect(() => { live.current = true; reload(); return () => { live.current = false; }; }, [reload]);
  return { data, setData, error, loading, reload };
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  // The label is shown for anything slower than a page load (writing a draft, running a check), so people know what is happening.
  const show = label !== 'Loading';
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" /><span className={show ? undefined : 'sr-only'}>{show ? `${label}…` : label}</span></div>;
}

export function ErrorNote({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="err row gap-12 wrap" role="alert" style={{ justifyContent: 'space-between' }}>
      <span>{message}</span>
      {retry && <button className="btn btn-secondary btn-small" onClick={retry}>Try again</button>}
    </div>
  );
}

/* ---------- Toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children?: any }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const show = useCallback((m: string) => {
    setMsg(m); clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite">{msg && <div className="toast">{msg}</div>}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children?: any; footer?: any }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: any) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-back" onClick={(e: any) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="panel-head"><h2 className="heading">{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
        {footer && <div className="panel-head modal-foot" style={{ borderTop: '1px solid var(--line)', borderBottom: 0, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export const AGENTS = {
  watcher: { name: 'The Watcher', icon: 'watcher', path: '/watcher', blurb: 'Watches your website and competitors' },
  scout: { name: 'The Scout', icon: 'scout', path: '/scout', blurb: 'Finds and researches new customers' },
  brief: { name: 'The Brief', icon: 'brief', path: '/brief', blurb: 'Turns your numbers into weekly priorities' },
} as const;


/* ---------- Tabs ---------- */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; badge?: string | number | null }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`panel-${t.id}`}
          className="tab" onClick={() => onChange(t.id)}>
          {t.label}{t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stars({ value, label }: { value: number; label?: string }) {
  const full = Math.round(value);
  return (
    <span className="stars" role="img" aria-label={label ?? `${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <svg key={i} viewBox="0 0 24 24" aria-hidden="true" className={i <= full ? 'on' : ''}><path d={PATHS.star} /></svg>)}
    </span>
  );
}

/** Copies text, falling back to selecting it when the clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
