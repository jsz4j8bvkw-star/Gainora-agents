import { env, json } from '../lib/core';
import { stripeGet, syncSubscription, verifyStripeSignature } from '../lib/stripe';

// Stripe → agent access. Events: checkout.session.completed, customer.subscription.created/updated/deleted.
export default async (req: Request) => {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'))) return json({ error: 'bad signature' }, 400);
  const event = JSON.parse(payload);
  try {
    const obj = event.data?.object;
    if (event.type === 'checkout.session.completed' && obj?.mode === 'subscription' && obj.subscription) {
      await syncSubscription(await stripeGet(`subscriptions/${obj.subscription}?expand[]=customer`));
    } else if (/^customer\.subscription\.(created|updated|deleted|paused|resumed)$/.test(event.type)) {
      await syncSubscription(obj);
    }
    return json({ received: true });
  } catch (e: any) {
    console.error('[gainora] webhook', event.type, e?.message);
    return json({ error: 'processing failed' }, 500); // Stripe retries
  }
};
export const config = { path: '/api/stripe-webhook', method: 'POST' };
