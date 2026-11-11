import { env, json } from '../lib/core';
import { paymentLinkPaid, proposalPaid } from '../lib/business';
import { stripeGet, syncSubscription, verifyStripeSignature } from '../lib/stripe';

// Stripe → agent access, and proposals paid. Events: checkout.session.completed, customer.subscription.created/updated/deleted.
export default async (req: Request) => {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'))) return json({ error: 'bad signature' }, 400);
  const event = JSON.parse(payload);
  try {
    const obj = event.data?.object;
    if (event.type === 'checkout.session.completed' && obj?.mode === 'subscription' && obj.subscription) {
      const agents = await syncSubscription(await stripeGet(`subscriptions/${obj.subscription}?expand[]=customer`));
      // Bought through a package payment link rather than a proposal: start their set-up the same way.
      if (!obj.metadata?.proposal) await paymentLinkPaid(obj, agents);
    }
    // A proposal from the admin was paid (subscription or one-off): the client's record and set-up start.
    if (event.type === 'checkout.session.completed' && obj?.metadata?.proposal && (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required')) {
      await proposalPaid(String(obj.metadata.proposal), obj);
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
