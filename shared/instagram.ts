// Instagram through Meta's Graph API, Business Discovery endpoint. Pure parsing only; the request
// itself lives in netlify/lib/meta.ts.
//
// Business Discovery lets one Instagram professional account (Gainora's own) read the public
// profile and recent posts of OTHER Instagram Business or Creator accounts by username:
//   GET https://graph.facebook.com/v26.0/{gainora-ig-user-id}
//       ?fields=business_discovery.username({handle}){followers_count,media_count,media{...}}
// Reference: developers.facebook.com → Instagram Platform → Instagram API with Facebook Login →
// Business Discovery (examples use v25.0/v26.0), and the IG User reference, which lists
// followers_count, media_count, username, website and biography as the public fields.
// Personal and private accounts are not returned (the call errors), so the app says so plainly
// rather than guessing.

import type { InstaPost } from './competitors';

export const GRAPH_VERSION = 'v26.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Fields we ask for: the public counts and the most recent posts with their captions and public counts. */
export const DISCOVERY_FIELDS = (handle: string, posts = 12) =>
  `business_discovery.username(${handle}){username,followers_count,media_count,website,media.limit(${posts}){id,caption,timestamp,like_count,comments_count,permalink,media_type}}`;

export const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

export interface DiscoveryResult {
  ok: true;
  handle: string;
  followers: number | null;
  mediaCount: number | null;
  website?: string;
  posts: InstaPost[];
}
export type DiscoveryErrorKind = 'not-business' | 'rate-limited' | 'token' | 'unavailable';
export interface DiscoveryError { ok: false; error: DiscoveryErrorKind; message: string }

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turns a Business Discovery response (or a Graph API error body) into something the app can store. */
export function parseDiscovery(json: any, handle: string): DiscoveryResult | DiscoveryError {
  const err = json?.error;
  if (err) return { ok: false, error: classifyGraphError(err), message: String(err.message || 'Instagram did not answer.').slice(0, 200) };
  const b = json?.business_discovery;
  if (!b || typeof b !== 'object') return { ok: false, error: 'unavailable', message: 'Instagram returned no profile.' };
  const posts: InstaPost[] = ((b.media?.data as any[]) || []).map((m) => ({
    id: String(m.id || ''),
    caption: String(m.caption || '').slice(0, 2200),
    at: typeof m.timestamp === 'string' ? isoFromGraph(m.timestamp) : '',
    likes: num(m.like_count),
    comments: num(m.comments_count),
    url: typeof m.permalink === 'string' ? m.permalink : '',
    type: typeof m.media_type === 'string' ? m.media_type : undefined,
  })).filter((p) => p.id && p.url);
  return { ok: true, handle: String(b.username || handle), followers: num(b.followers_count), mediaCount: num(b.media_count), website: typeof b.website === 'string' ? b.website : undefined, posts };
}

/** Graph timestamps look like "2026-11-01T10:00:00+0000"; make them real ISO strings. */
export function isoFromGraph(ts: string): string {
  const fixed = ts.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Graph API error codes: 110 "Business Discovery: User not found" is what comes back for personal,
 * private, age-gated or non-existent accounts; 4/17/32/613 are rate limits; 190 is a bad or expired token.
 */
export function classifyGraphError(err: any): DiscoveryErrorKind {
  const code = Number(err?.code);
  const msg = String(err?.message || '');
  if (code === 110 || code === 100 && /business discovery/i.test(msg) || /not found|not a business|professional account/i.test(msg) && /business discovery|user/i.test(msg)) return 'not-business';
  if ([4, 17, 32, 613].includes(code) || /rate limit|too many calls/i.test(msg)) return 'rate-limited';
  if (code === 190 || /access token/i.test(msg)) return 'token';
  return 'unavailable';
}

/** What the owner reads when an account can't be read. Plain, and never a guess. */
export const discoveryErrorText: Record<DiscoveryErrorKind, string> = {
  'not-business': 'This account is personal or private, so its posts can’t be read.',
  'rate-limited': 'Instagram limited how much we could read today. The Watcher will try again tomorrow.',
  token: 'Instagram reading is not connected right now.',
  unavailable: 'Instagram didn’t answer. The Watcher will try again tomorrow.',
};

/** The long-lived token exchange (server only; needs the app secret). Returns the request URL. */
export function exchangeTokenUrl(appId: string, appSecret: string, token: string): string {
  const q = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token });
  return `${GRAPH_BASE}/oauth/access_token?${q}`;
}
