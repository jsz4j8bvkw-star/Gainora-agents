// Encrypts connection secrets (Google refresh tokens, Cliniko API keys) before they're stored.
// AES-256-GCM. The key is DIARY_SECRET_KEY (any long random string) or, if that isn't set, derived from
// INTERNAL_SECRET, so it works without extra setup. Changing the key means clinics reconnect.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, requireEnv } from './core';

const key = () => {
  const raw = env('DIARY_SECRET_KEY') || env('INTERNAL_SECRET');
  if (!raw) requireEnv('DIARY_SECRET_KEY');
  return createHash('sha256').update(`gainora-diary:${raw}`).digest();
};

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${body.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

export function open(sealed: string): string {
  const [v, iv, body, tag] = String(sealed).split('.');
  if (v !== 'v1' || !iv || !body || !tag) throw new Error('Unreadable secret.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

/** A signed, short-lived value (the OAuth "state"), so a sign-in can't be pointed at someone else's account. */
export function sign(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', key()).update(body).digest('base64url')}`;
}
export function verify<T = any>(signed: string, maxAgeMs = 15 * 60_000): T | null {
  const [body, mac] = String(signed || '').split('.');
  if (!body || !mac) return null;
  const want = createHmac('sha256', key()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof p.at === 'number' && Date.now() - p.at < maxAgeMs ? p : null;
  } catch { return null; }
}
