import { useEffect, useState } from 'react';

declare const __DEMO__: boolean;
// The demo runs inside a hosted preview frame that doesn't allow URL routing, so it keeps the route in memory.
const memory = typeof __DEMO__ !== 'undefined' && __DEMO__;
let memPath = '/';

function current(): string {
  if (memory) return memPath;
  return (location.pathname || '/') + (location.search || '');
}

const listeners = new Set<() => void>();

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (memory) memPath = to;
  else if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}

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
  return memory ? '#' : to;
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
