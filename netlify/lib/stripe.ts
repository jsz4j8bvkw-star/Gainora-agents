// Stripe: webhook signature check and subscription → agent access.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, env, enc, HttpError, sbHeaders, upsert } from './core';
import { sendEmail } from './email';

export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300, now = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]).filter((p) => p.length === 2));
  const t = Number(parts.t);
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(now - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

type Agent = 'watcher' | 'scout' | 'brief' | 'capture';
/** Command Centre ("all") is the three agents. Capture & Convert is sold on its own product: {"prod_X":"capture"}. */
const ALL_AGENTS: Agent[] = ['watcher', 'scout', 'brief'];
const isAgent = (a: unknown): a is Agent => a === 'watcher' || a === 'scout' || a === 'brief' || a === 'capture';

/**
 * STRIPE_AGENT_PRODUCTS maps Stripe products to agents. "all" means Gainora Command Centre (every agent):
 * {"prod_COMMAND":"all"}   or, for the older single-agent products, {"prod_123":"watcher","prod_456":"scout"}.
 * A list also works: {"prod_789":["watcher","brief"]}.
 */
export function agentsForProduct(productId: string): Agent[] {
  try {
    const v = JSON.parse(env('STRIPE_AGENT_PRODUCTS', '{}'))[productId];
    if (v === 'all') return [...ALL_AGENTS];
    if (Array.isArray(v)) return [...new Set(v.filter(isAgent))];
    return isAgent(v) ? [v] : [];
  } catch { return []; }
}

/** The single agent a product unlocks (kept for older single-agent products). */
export function agentForProduct(productId: string): Agent | null {
  const a = agentsForProduct(productId);
  return a.length === 1 ? a[0] : null;
}

export async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}` } });
  if (!res.ok) throw new HttpError(502, `Stripe ${path.split('?')[0]} ${res.status}`);
  return res.json();
}

export async function stripePost(path: string, form: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(502, data?.error?.message || 'Stripe request failed');
  return data;
}

const STATUS: Record<string, string> = { active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'canceled', canceled: 'canceled', incomplete: 'past_due', incomplete_expired: 'canceled', paused: 'canceled' };

/** Ensures a Supabase login exists for this email so the client can sign in with a magic link. */
async function ensureUser(email: string): Promise<boolean> {
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (res.ok) return true;          // new user created
  if (res.status === 422 || res.status === 400) return false; // already exists
  throw new HttpError(502, 'Could not create the login');
}

/** Applies a Stripe subscription to the entitlements table. Returns the agents granted. */
export async function syncSubscription(sub: any): Promise<string[]> {
  const customer = typeof sub.customer === 'string' ? await stripeGet(`customers/${sub.customer}`) : sub.customer;
  const email = String(customer?.email || '').toLowerCase();
  if (!email) throw new HttpError(400, 'Subscription has no customer email');
  const status = STATUS[sub.status] ?? 'canceled';
  const agents: string[] = [];
  for (const item of sub.items?.data || []) {
    const product = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
    for (const agent of agentsForProduct(product)) {
    if (agents.includes(agent)) continue;
    agents.push(agent);
    await upsert('entitlements', {
      email, agent, status, stripe_customer: customer.id, stripe_subscription: sub.id,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : (item.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null),
      updated_at: new Date().toISOString(),
    }, 'email,agent');
    }
  }
  if (agents.length && (status === 'active' || status === 'trialing')) {
    const created = await ensureUser(email);
    // Link the login to the subscription rows (the database trigger also does this for new users).
    const users = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users?email=${enc(email)}`, { headers: sbHeaders() }).then((r) => r.json()).catch(() => null);
    const match = (users?.users || []).find((u: any) => String(u.email).toLowerCase() === email);
    if (match) await db(`entitlements?email=eq.${enc(email)}&user_id=is.null`, { method: 'PATCH', body: { user_id: match.id } });
    if (created) {
      const app = env('APP_URL', 'https://app.gainora.co.uk');
      await sendEmail(email, 'Your Gainora agents are ready to set up', [
        'Thank you for subscribing to Gainora.',
        `Open ${app} and sign in with this email address. We’ll send you a sign-in link, so there’s no password to remember.`,
        'The first thing you’ll see is a short set of questions about your business. It takes about eight minutes, and your agents start work as soon as you finish.',
        'If you have any questions, just reply to this email.',
        'Gainora',
      ]).catch((e) => console.error('[gainora] welcome email', e?.message));
    }
  }
  return agents;
}
