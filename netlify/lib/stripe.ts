// Stripe: webhook signature check and subscription → Capture & Convert access.
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

/**
 * STRIPE_CAPTURE_PRODUCTS lists the Stripe product ids that unlock Capture & Convert, comma-separated:
 * "prod_ABC,prod_DEF" (for example the standard price and a founding price on separate products).
 * Products not on the list are ignored here; Command Centre products are handled by the Gainora Agents app.
 */
export function grantsCapture(productId: string): boolean {
  return env('STRIPE_CAPTURE_PRODUCTS').split(',').map((x) => x.trim()).filter(Boolean).includes(productId);
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

/** Applies a Stripe subscription to the entitlements table. Returns ["capture"] when it grants access. */
export async function syncSubscription(sub: any): Promise<string[]> {
  const customer = typeof sub.customer === 'string' ? await stripeGet(`customers/${sub.customer}`) : sub.customer;
  const email = String(customer?.email || '').toLowerCase();
  if (!email) throw new HttpError(400, 'Subscription has no customer email');
  const status = STATUS[sub.status] ?? 'canceled';
  const agents: string[] = [];
  for (const item of sub.items?.data || []) {
    const product = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
    for (const agent of grantsCapture(product) ? ['capture'] : []) {
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
      const app = env('APP_URL', 'https://capture.gainora.co.uk');
      await sendEmail(email, 'Welcome to Gainora Capture & Convert', [
        'Thank you for choosing Gainora Capture & Convert.',
        `Open ${app} and sign in with this email address. We’ll send you a sign-in link, so there’s no password to remember.`,
        'You’ll answer a few questions about your business and how you want calls handled. It takes about ten minutes. We then set up your AI receptionist with you on your onboarding call.',
        'If you have any questions, just reply to this email.',
        'Gainora',
      ]).catch((e) => console.error('[gainora] welcome email', e?.message));
    }
  }
  return agents;
}
