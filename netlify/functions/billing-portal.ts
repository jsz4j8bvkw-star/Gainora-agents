import { db, enc, env, handler, HttpError, json, userFromRequest } from '../lib/core';
import { stripePost } from '../lib/stripe';

export default handler(async (req) => {
  const user = await userFromRequest(req);
  const rows = await db<any[]>(`entitlements?select=stripe_customer&or=(user_id.eq.${user.id},email.eq.${enc(user.email)})&stripe_customer=not.is.null&limit=1`);
  if (!rows[0]) throw new HttpError(404, 'No billing account found. Email hello@gainora.co.uk and we’ll help.');
  const s = await stripePost('billing_portal/sessions', { customer: rows[0].stripe_customer, return_url: `${env('APP_URL', 'https://app.gainora.co.uk')}/settings` });
  return json({ url: s.url });
});
export const config = { path: '/api/billing-portal', method: 'POST' };
