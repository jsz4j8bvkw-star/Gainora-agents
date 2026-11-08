// The owner's Instagram and Facebook pages. Both are optional, like the website.
// People type these in many ways ("@willowskin", "instagram.com/willowskin", a full link),
// so everything is turned into one clean link before it's stored or checked.

export type SocialKind = 'instagram' | 'facebook';

const HOSTS: Record<SocialKind, RegExp> = {
  instagram: /^(www\.|m\.)?(instagram\.com|instagr\.am)$/i,
  facebook: /^(www\.|m\.|business\.|web\.)?(facebook\.com|fb\.com|fb\.me)$/i,
};
const BASE: Record<SocialKind, string> = { instagram: 'https://www.instagram.com/', facebook: 'https://www.facebook.com/' };

/** A clean link to the page, or '' if the input can't be a page on that site. Empty input gives ''. */
export function socialUrl(kind: SocialKind, input: string | undefined | null): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  // A bare handle: "@name" or "name".
  if (!/[/.]/.test(raw.replace(/^@/, '')) || /^@/.test(raw)) {
    const handle = raw.replace(/^@/, '');
    if (kind === 'instagram' && /^[A-Za-z0-9._]{1,30}$/.test(handle)) return `${BASE.instagram}${handle}/`;
    if (kind === 'facebook' && /^[A-Za-z0-9.\-]{2,80}$/.test(handle)) return `${BASE.facebook}${handle}`;
    return '';
  }
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return ''; }
  if (!HOSTS[kind].test(u.hostname)) return '';
  const path = u.pathname.replace(/\/+$/, '');
  if (!path || path === '/') return '';
  if (kind === 'instagram') {
    const handle = path.split('/').filter(Boolean)[0];
    return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `${BASE.instagram}${handle}/` : '';
  }
  // Facebook pages come as /name, /pages/Name/123, or /profile.php?id=123.
  if (/^\/profile\.php$/i.test(path)) { const id = u.searchParams.get('id'); return id && /^\d+$/.test(id) ? `${BASE.facebook}profile.php?id=${id}` : ''; }
  return `${BASE.facebook}${path.replace(/^\//, '')}`;
}

/** The page's name as people say it: "@willowskin" or "facebook.com/willowskin". */
export function socialLabel(kind: SocialKind, url: string): string {
  if (!url) return '';
  if (kind === 'instagram') return `@${url.replace(BASE.instagram, '').replace(/\/$/, '')}`;
  return url.replace('https://www.', '');
}

/** True when any of the given links points at the same Instagram or Facebook page. */
export function linksTo(kind: SocialKind, pageUrl: string, links: string[]): boolean {
  if (!pageUrl) return false;
  const want = pageUrl.toLowerCase().replace(/\/$/, '');
  return links.some((l) => socialUrl(kind, l).toLowerCase().replace(/\/$/, '') === want);
}
