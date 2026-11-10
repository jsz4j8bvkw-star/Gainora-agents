import { db } from '../lib/core';
import { checkoutFor, getSettings, priceBook, proposalByToken } from '../lib/business';
import { esc, page } from '../lib/page';
import { proposalTotals, money } from '../../shared/admin/prices';
import { ukToday } from '../../shared/admin/board';

// The proposal a prospect opens from their email: what's included, what it costs, and a button to start.
//   GET  /p/<token>   the proposal
//   POST /p/<token>   start: a fresh Stripe Checkout page, then back here when paid
const dateLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async (req: Request) => {
  const url = new URL(req.url);
  const token = url.pathname.split('/').filter(Boolean).pop() || '';
  const p = await proposalByToken(token).catch(() => null);
  if (!p || p.status === 'cancelled') return page('Proposal not found', `<h1>This proposal isn’t available</h1><p class="muted">It may have been replaced by a newer one. Email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a> and we’ll send you the right link.</p>`, 404);
  const expired = !!p.expires_on && p.expires_on < ukToday() && p.status !== 'paid';

  if (req.method === 'POST') {
    if (p.status === 'paid') return Response.redirect(`${url.origin}/p/${token}`, 303);
    if (expired) return Response.redirect(`${url.origin}/p/${token}`, 303);
    try { return Response.redirect(await checkoutFor(p), 303); }
    catch (e: any) { return page('Payment', `<h1>We couldn’t open the payment page</h1><p class="muted">${esc(e?.message || 'Try again in a minute.')}</p><p><a href="/p/${esc(token)}">Back to the proposal</a></p>`, 503); }
  }

  if (p.status === 'paid' || url.searchParams.get('paid') === '1') {
    return page('Thank you', `<h1>Thank you${p.contact_name ? `, ${esc(p.contact_name.split(' ')[0])}` : ''}</h1>
<div class="card"><p>Your payment is through and we’ve started your set-up.</p><ol><li>Look out for an email with your Gainora login. The first time, choose “Email me a sign-in link”, then set your password.</li><li>We’ll be in touch within one working day to book your set-up call.</li></ol><p class="small muted">Questions any time: <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a></p></div>`);
  }
  if (p.status === 'sent') await db(`proposals?id=eq.${p.id}`, { method: 'PATCH', body: { status: 'viewed', viewed_at: new Date().toISOString() } }).catch(() => {});

  const book = new Map((await priceBook()).map((b) => [b.key, b]));
  const t = proposalTotals(p.items);
  const me = (await getSettings()).outreach.myName;
  const items = p.items.map((i) => {
    const d = book.get(i.key)?.description ?? '';
    const parts = [i.setup ? `${money(i.setup)} set-up` : '', i.one_off ? money(i.one_off) : '', i.monthly ? `${money(i.monthly)} a month` : ''].filter(Boolean).join(', then ');
    return `<div class="item"><div class="row"><strong>${esc(i.name)}</strong><span class="num">${esc(parts)}</span></div>${d ? `<span class="small muted">${esc(d)}</span>` : ''}${i.included && i.grants.includes('capture') ? `<span class="small faint">${esc(i.included)} call minutes a month included</span>` : ''}${i.monthly && i.minimum_months ? `<span class="small faint">${i.minimum_months}-month minimum, then month to month</span>` : ''}</div>`;
  }).join('');
  return page(`Proposal for ${p.business_name}`, `<p class="small faint">Proposal from ${esc(me)}, Gainora${p.expires_on ? ` · valid until ${esc(dateLong(p.expires_on))}` : ''}</p>
<h1>For ${esc(p.business_name)}</h1>
${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
<section class="card" aria-label="What’s included">${items}</section>
<section class="card" aria-label="Price">
  ${t.today ? `<div class="row total"><span>Due today</span><span class="num">${money(t.today)}</span></div>` : ''}
  ${t.monthly ? `<div class="row total"><span>Then each month</span><span class="num">${money(t.monthly)}</span></div>` : ''}
  ${p.trial_days ? `<p class="small muted">The monthly payments start after a ${p.trial_days}-day free trial.</p>` : ''}
  <p class="small faint">Prices exclude VAT. ${t.minimum ? `${t.minimum}-month minimum, then month to month.` : ''}</p>
  ${expired ? `<p><strong>This proposal has expired.</strong> Email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a> and we’ll send a fresh one.</p>` : `<form method="post"><button class="btn" type="submit">Accept and pay securely</button></form>
  <p class="small faint">Payment by card through Stripe. By accepting you agree to <a href="https://gainora.co.uk/terms/">Gainora’s terms</a>, which include how we process your customers’ data on your behalf.</p>`}
</section>
<section class="card" aria-label="What happens next"><h2>What happens next</h2><ol><li>You pay securely and get your Gainora login by email.</li><li>We book your set-up call within one working day.</li><li>Everything is set up in your name, and you can see progress in your app.</li></ol></section>
<p class="small muted">Questions? Reply to the email this came in, or write to <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a>.</p>`);
};
export const config = { path: '/p/*' };
