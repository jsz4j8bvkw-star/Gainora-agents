import { useEffect, useState } from 'react';

declare const __DEMO__: boolean;
// The demo runs inside a hosted preview frame that doesn't allow URL routing, so it keeps the route in memory.
const memory = typeof __DEMO__ !== 'undefined' && __DEMO__;
let memPath = '/';

/**
 * Gainora's admin also runs at app.gainora.co.uk/admin (next to Command Centre), so its routes live under /admin there:
 * a refresh on /admin/clients reopens the admin, not Command Centre. On admin.gainora.co.uk the routes have no prefix.
 * Pages always see and pass plain routes ("/clients"); the prefix is added and removed here.
 */
export function routePrefix(pathname: string, host: string): string {
  return host !== 'admin.gainora.co.uk' && /^\/admin(\.html)?(\/|$)/.test(pathname) ? '/admin' : '';
}
const PREFIX = memory || typeof location === 'undefined' ? '' : routePrefix(location.pathname, location.hostname);
export const toUrl = (to: string) => (PREFIX && to.startsWith('/') ? PREFIX + (to === '/' ? '' : to) || PREFIX : to);
export function fromUrl(pathname: string): string {
  if (!PREFIX) return pathname || '/';
  const rest = pathname.replace(/^\/admin(\.html)?/, '');
  return rest.startsWith('/') ? rest : '/' + rest;
}

function current(): string {
  if (memory) return memPath;
  return fromUrl(location.pathname || '/') + (location.search || '');
}

const listeners = new Set<() => void>();

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (memory) memPath = to;
  else if (opts.replace) history.replaceState(null, '', toUrl(to));
  else history.pushState(null, '', toUrl(to));
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}

// The demo has no URL bar to type into, so it exposes navigation for the hosted preview and for screenshots.
if (memory && typeof window !== 'undefined') (window as any).__nav = navigate;

export function usePath(): string {
  const [path, setPath] = useState(current());
  useEffect(() => {
    const on = () => setPath(current());
    listeners.add(on);
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => {
      listeners.delete(on);
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
    };
  }, []);
  return path;
}

export function href(to: string): string {
  return memory ? '#' : toUrl(to);
}

/** The query string of the current route, so pages can open on a tab or item from a link. */
export function useQuery(): URLSearchParams {
  const path = usePath();
  return new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?')) : '');
}

/** A query value from the current route, read once (used for the first tab or item a page opens on). */
export function queryParam(name: string): string | null {
  const path = current();
  return new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?')) : '').get(name);
}

export function Link(props: { to: string; className?: string; children?: any; 'aria-current'?: any; onClick?: () => void }) {
  const { to, children, onClick, ...rest } = props;
  return (
    <a
      {...rest}
      href={href(to)}
      onClick={(e: any) => {
        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
