import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startFake } from './fake-sb';
import { ukToday } from '../shared/admin/board';
import { addDays } from '../shared/admin/templates';
import { DEFAULT_PRICE_BOOK, fromPriceItem } from '../shared/admin/prices';

// The business side of the admin end to end: outreach (import, sequence, automatic email, unsubscribe), a proposal
// paid through Stripe becoming a client with their set-up started, the price book feeding the website, the books,
// paperwork, the morning email and the monthly results email.
test('sales, proposals, prices, books and paperwork end to end', async () => {
  const ADMIN = { id: '22222222-2222-4222-8222-222222222222', email: 'hello@gainora.co.uk', token: 'admin' };
  const fake = await startFake({
    __users: [ADMIN],
    prospects: [], outreach_sequences: [], outreach_messages: [], do_not_contact: [], proposals: [], price_book: [],
    admin_settings: [{ id: 1, data: { outreach: { autoSend: true, dailyLimit: 5, myName: 'Adelin' } } }],
    admin_accounts: [], admin_tasks: [], admin_log: [], admin_costs: [], admin_keys: [], business_expenses: [], business_deadlines: [],
    entitlements: [], profiles: [], sites: [], site_requests: [], site_events: [], enquiries: [], briefs: [], leads: [], ai_usage: [],
  });
  Object.assign(process.env, {
    SUPABASE_URL: fake.base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', INTERNAL_SECRET: 's', APP_URL: 'https://app.gainora.co.uk',
    RESEND_API_KEY: 'k', OUTREACH_FROM: 'Adelin at Gainora <adelin@hello-gainora.co.uk>', OUTREACH_REPLY_TO: 'hello@gainora.co.uk',
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_t', WEBSITE_BUILD_HOOK: 'https://api.netlify.com/build_hooks/abc123',
  });
  delete process.env.STRIPE_AGENT_PRODUCTS;
  const emails: any[] = [];
  fake.external('api.resend.com', (_m, _p, b) => { emails.push(b); return { id: `e${emails.length}` }; });
  const stripe: { method: string; path: string; form: URLSearchParams }[] = [];
  const now = Math.floor(Date.now() / 1000);
  fake.external('api.stripe.com', (method, path, body) => {
    const form = new URLSearchParams(typeof body === 'string' ? body : '');
    stripe.push({ method, path, form });
    if (method === 'POST' && path === '/v1/checkout/sessions') return { id: `cs_${stripe.length}`, url: `https://checkout.stripe.com/c/pay/cs_${stripe.length}` };
    if (method === 'POST' && path.startsWith('/v1/products')) return { id: path.split('/')[3] || `prod_${stripe.length}` };
    if (path.startsWith('/v1/subscriptions/sub_9')) return { status: 200, body: { id: 'sub_9', status: 'active', current_period_end: now + 30 * 86400, customer: { id: 'cus_9', email: 'Sam@CrewePhysio.example' }, items: { data: [{ price: { product: 'prod_LG' } }] } } };
    if (path.startsWith('/v1/products/prod_LG')) return { id: 'prod_LG', metadata: { gainora_key: 'launch-grow', gainora_grants: 'watcher,scout,brief,website' } };
    if (path.startsWith('/v1/invoices?status=paid')) return { data: [{ status_transitions: { paid_at: now - 3600 }, amount_paid: 259000, customer_email: 'sam@crewephysio.example' }], has_more: false };
    if (path.startsWith('/v1/invoices?status=open')) return { data: [{ id: 'in_1', attempt_count: 2, amount_due: 29900, customer_email: 'late@clinic.example', hosted_invoice_url: 'https://invoice.stripe.com/i/1' }] };
    if (path.startsWith('/v1/subscriptions')) return { data: [], has_more: false };
    return { status: 404, body: { error: { message: 'not faked' } } };
  });
  let builds = 0;
  fake.external('api.netlify.com', () => { builds++; return {}; });

  try {
    const { default: sales } = await import('../netlify/functions/admin-sales');
    const { default: business } = await import('../netlify/functions/admin-business');
    const { default: admin } = await import('../netlify/functions/admin');
    const { default: mcp } = await import('../netlify/functions/mcp');
    const { default: proposalPage } = await import('../netlify/functions/proposal');
    const { default: unsubscribe } = await import('../netlify/functions/unsubscribe');
    const { default: prices } = await import('../netlify/functions/prices');
    const { default: webhook } = await import('../netlify/functions/stripe-webhook');
    const { default: daily } = await import('../netlify/functions/admin-daily');
    const { runOutreach } = await import('../netlify/functions/outreach-daily');
    const { runResults } = await import('../netlify/functions/results-monthly');
    const post = (fn: any, path: string) => async (b: any, token = 'admin') => fn(new Request(`https://admin.gainora.co.uk${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));
    const S = post(sales, '/api/admin-sales'); const B = post(business, '/api/admin-business'); const A = post(admin, '/api/admin');
    const ok = async (r: Response | Promise<Response>) => { const res = await r; const j = await res.json(); assert.equal(res.status, 200, JSON.stringify(j)); return j; };
    const today = ukToday();

    // Only Gainora's team.
    assert.equal((await S({ op: 'overview' }, 'nobody')).status, 401);

    /* ---------- Outreach ---------- */
    const csv = [
      'Business,Contact,Email,Website,Town,Company type,Personal line',
      'Willow Aesthetics Ltd,Amy Walker,amy@willow.example,https://willow.example,Crewe,,"Your new lip filler page reads really well, especially the aftercare part."',
      'Bloom Beauty,Jo Smith,jo@bloom.example,bloom.example,Nantwich,Sole trader,',
      'Willow again,,AMY@willow.example,,,,',
      ',No Business,nobody@nowhere.example,,,,',
    ].join('\n');
    const imp = await ok(S({ op: 'import', csv, source: 'Clinic list' }));
    assert.deepEqual([imp.added, imp.duplicates, imp.skipped], [2, 1, 1]);
    let o = await ok(S({ op: 'overview' }));
    assert.equal(o.sequences.length, 3, 'the outreach kit’s sequences are there from the start');
    const willow = o.prospects.find((p: any) => p.email === 'amy@willow.example');
    const bloom = o.prospects.find((p: any) => p.email === 'jo@bloom.example');
    assert.equal(willow.company_type, 'limited');
    assert.equal(bloom.company_type, 'sole_trader');
    const byEmail = o.sequences.find((s: any) => s.name === 'Clinics by email');
    await ok(S({ op: 'start', ids: [willow.id, bloom.id], sequence_id: byEmail.id, start: today }));
    o = await ok(S({ op: 'overview' }));
    assert.equal(o.due.length, 2);
    const wDue = o.due.find((p: any) => p.id === willow.id);
    const bDue = o.due.find((p: any) => p.id === bloom.id);
    assert.match(wDue.draft.body, /^Hi Amy,/);
    assert.match(wDue.draft.body, /aftercare part/);
    assert.ok(!/\{personal_line\}|\n\n\n/.test(bDue.draft.body), 'no personal line means the line is left out, not invented');
    assert.equal(bDue.email_ok.ok, false, 'a sole trader isn’t emailed without consent');
    assert.equal(wDue.email_ok.ok, true);

    // The weekday job sends what's due and allowed: Willow, not Bloom.
    assert.deepEqual((await runOutreach(today)).sent, 1);
    const first = emails.find((e) => e.to[0] === 'amy@willow.example');
    assert.equal(first.from, process.env.OUTREACH_FROM);
    assert.equal(first.reply_to, 'hello@gainora.co.uk');
    assert.match(first.headers['List-Unsubscribe'], /^<https:\/\/app\.gainora\.co\.uk\/u\/[A-Za-z0-9_-]{20,}>$/);
    assert.equal(first.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.match(first.text, /unsubscribe|stop/i);
    let w = fake.tables.prospects.find((p) => p.id === willow.id);
    assert.deepEqual([w.step, w.next_on, w.stage], [1, addDays(today, 4), 'contacted']);
    assert.equal((await runOutreach(today)).sent, 0, 'nothing twice');
    // Bloom: Adelin messages them another way, then marks it sent.
    await ok(S({ op: 'mark-sent', id: bloom.id }));
    assert.equal(fake.tables.prospects.find((p) => p.id === bloom.id).step, 1);

    // Unsubscribing: a confirm page (so mail scanners can't unsubscribe people), then off the list for good.
    const token = w.unsub_token;
    assert.equal((await unsubscribe(new Request(`https://app.gainora.co.uk/u/not-a-real-token-at-all`))).status, 404);
    assert.match(await (await unsubscribe(new Request(`https://app.gainora.co.uk/u/${token}`))).text(), /Stop emails from Gainora\?/);
    assert.equal(fake.tables.prospects.find((p) => p.id === willow.id).unsubscribed_at ?? null, null);
    assert.match(await (await unsubscribe(new Request(`https://app.gainora.co.uk/u/${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }))).text(), /won’t hear from us again/);
    w = fake.tables.prospects.find((p) => p.id === willow.id);
    assert.ok(w.unsubscribed_at);
    assert.equal(w.stage, 'lost');
    assert.ok(fake.tables.do_not_contact.some((d) => d.value === 'amy@willow.example'));
    assert.equal((await runOutreach(addDays(today, 4))).sent, 0, 'unsubscribed and sole traders get nothing');
    assert.equal((await S({ op: 'send', id: willow.id })).status, 400);

    /* ---------- The Claude connector: sales tools ---------- */
    const { url } = await ok(A({ op: 'key-create', label: 'Claude' }));
    const key = url.split('/').pop();
    const use = async (name: string, args: any) => { const r = (await (await mcp(new Request(`https://app.gainora.co.uk/api/mcp/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }))).json()).result; return { ...r, data: r.isError ? null : JSON.parse(r.content[0].text) }; };
    const added = await use('add_prospects', { prospects: [
      { business_name: 'Crewe Physio Ltd', contact_name: 'Sam Patel', email: 'sam@crewephysio.example', company_type: 'limited', town: 'Crewe', source: 'Their website and Companies House' },
      { business_name: 'Willow (again)', email: 'amy@willow.example' },
    ] });
    assert.equal(added.data.added.length, 1);
    assert.match(added.data.skipped[0], /already on the list|asked not to be contacted/);
    const physio = fake.tables.prospects.find((p) => p.email === 'sam@crewephysio.example');
    assert.equal(physio.source, 'Their website and Companies House');
    const draft = await use('create_proposal', { business_name: 'Crewe Physio Ltd', packages: ['launch-grow', 'not-a-package'] });
    assert.equal(draft.isError, true);
    const cDraft = await use('create_proposal', { business_name: 'Crewe Physio Ltd', email: 'sam@crewephysio.example', packages: ['launch-grow'], prospect_id: physio.id });
    assert.equal(cDraft.data.draft, true);
    assert.equal(cDraft.data.due_today, '£1,995');
    assert.ok(!emails.some((e) => e.to[0] === 'sam@crewephysio.example'), 'Claude drafts, it doesn’t send');
    await use('update_prospect', { id: physio.id, stage: 'call', call_at: `${today}T15:30:00Z`, note: 'Wants the website first' });
    assert.equal(fake.tables.prospects.find((p) => p.id === physio.id).stage, 'call');

    /* ---------- Proposal → Stripe → client ---------- */
    const lg = fromPriceItem(DEFAULT_PRICE_BOOK.find((p) => p.key === 'launch-grow')!);
    const { proposal } = await ok(S({ op: 'proposal-save', proposal: { business_name: 'Crewe Physio Ltd', contact_name: 'Sam Patel', email: 'sam@crewephysio.example', items: [lg], note: 'As we talked about: website first, then reviews.', prospect_id: physio.id } }));
    assert.match(proposal.url, /^https:\/\/app\.gainora\.co\.uk\/p\/[A-Za-z0-9_-]{20,}$/);
    await ok(S({ op: 'proposal-send', id: proposal.id }));
    const sent = emails.find((e) => e.to[0] === 'sam@crewephysio.example');
    assert.match(sent.subject, /Your Gainora proposal for Crewe Physio Ltd/);
    assert.ok(sent.html.includes(proposal.url));
    assert.equal(fake.tables.prospects.find((p) => p.id === physio.id).stage, 'proposal');

    const page = await proposalPage(new Request(proposal.url));
    const html = await page.text();
    assert.equal(page.status, 200);
    for (const bit of ['For Crewe Physio Ltd', '£1,995', '£595', 'Accept and pay securely', 'website first, then reviews', '3-month minimum']) assert.ok(html.includes(bit), bit);
    assert.equal(fake.tables.proposals.find((p) => p.id === proposal.id).status, 'viewed');
    const pay = await proposalPage(new Request(proposal.url, { method: 'POST' }));
    assert.equal(pay.status, 303);
    assert.match(pay.headers.get('location')!, /^https:\/\/checkout\.stripe\.com\//);
    const checkout = stripe.find((c) => c.path === '/v1/checkout/sessions')!.form;
    assert.equal(checkout.get('mode'), 'subscription');
    assert.equal(checkout.get('metadata[proposal]'), proposal.id);
    assert.equal(checkout.get('customer_email'), 'sam@crewephysio.example');
    assert.equal(checkout.get('line_items[0][price_data][unit_amount]'), '59500');
    assert.equal(checkout.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(checkout.get('line_items[0][price_data][product_data][metadata][gainora_grants]'), 'watcher,scout,brief,website');
    assert.equal(checkout.get('line_items[1][price_data][unit_amount]'), '199500');
    assert.equal(checkout.get('line_items[1][price_data][recurring][interval]'), null, 'the set-up fee is paid once');
    assert.match(checkout.get('success_url')!, /\?paid=1$/);

    // Stripe says it's paid.
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_9', payment_status: 'paid', metadata: { proposal: proposal.id }, customer_details: { email: 'Sam@CrewePhysio.example' } } } };
    const payload = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'whsec_t').update(`${t}.${payload}`).digest('hex');
    const hook = () => webhook(new Request('https://app.gainora.co.uk/api/stripe-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${sig}` } }));
    assert.equal((await hook()).status, 200);
    assert.deepEqual(fake.tables.entitlements.filter((e) => e.email === 'sam@crewephysio.example').map((e) => e.agent).sort(), ['brief', 'scout', 'watcher', 'website'], 'the product says what it switches on');
    const sam = fake.tables.__users.find((u) => u.email === 'sam@crewephysio.example');
    assert.ok(sam, 'their login is made');
    assert.equal(fake.tables.proposals.find((p) => p.id === proposal.id).status, 'paid');
    const won = fake.tables.prospects.find((p) => p.id === physio.id);
    assert.deepEqual([won.stage, won.client_email], ['won', 'sam@crewephysio.example']);
    const rec = fake.tables.admin_accounts.find((a) => a.email === 'sam@crewephysio.example');
    assert.equal(rec.business_name, 'Crewe Physio Ltd');
    assert.ok(rec.terms_accepted_at && rec.dpa_accepted_at, 'terms and data processing terms recorded at checkout');
    assert.equal(rec.setup_paid, true);
    const tasks = fake.tables.admin_tasks.filter((x) => x.email === 'sam@crewephysio.example').length;
    assert.ok(tasks >= 29, 'Command Centre and Launch & Grow set-up started');
    const welcome = emails.find((e) => e.to[0] === 'sam@crewephysio.example' && /ready to set up/.test(e.subject));
    assert.match(welcome.text, /choose a password/);
    assert.ok(emails.some((e) => e.to[0] === 'hello@gainora.co.uk' && /Crewe Physio Ltd just paid/.test(e.subject)));
    assert.equal((await hook()).status, 200);
    assert.equal(fake.tables.admin_tasks.filter((x) => x.email === 'sam@crewephysio.example').length, tasks, 'Stripe sending it twice changes nothing');
    assert.match(await (await proposalPage(new Request(`${proposal.url}?paid=1`))).text(), /Thank you, Sam/);
    assert.equal((await proposalPage(new Request(proposal.url, { method: 'POST' }))).status, 303, 'a paid proposal goes back to the thank-you page');
    assert.equal(stripe.filter((c) => c.path === '/v1/checkout/sessions').length, 1);

    // The funnel counts it.
    o = await ok(S({ op: 'overview' }));
    assert.equal(o.funnel.won ?? o.funnel.stages?.won ?? o.prospects.filter((p: any) => p.stage === 'won').length, 1);

    /* ---------- Prices: one book for proposals and the website ---------- */
    const book = (await ok(B({ op: 'prices' }))).prices;
    const edited = book.map((p: any) => (p.key === 'launch-grow' ? { ...p, monthly: 649 } : p));
    const saved = await ok(B({ op: 'prices-save', prices: edited, publish: true }));
    assert.equal(saved.rebuilt, true);
    assert.equal(builds, 1, 'the website rebuilds with the new prices');
    assert.equal(saved.website.launchGrow.monthly, '£649');
    assert.ok(stripe.some((c) => c.method === 'POST' && c.path === '/v1/products' && c.form.get('metadata[gainora_key]') === 'launch-grow' && c.form.get('metadata[gainora_grants]') === 'watcher,scout,brief,website'));
    assert.ok(fake.tables.price_book.find((p) => p.key === 'launch-grow').stripe_product, 'each package keeps its Stripe product');
    const feed = await (await prices(new Request('https://app.gainora.co.uk/api/prices'))).json();
    assert.equal(feed.prices.launchGrow.monthly, '£649');
    assert.equal(feed.prices.commandCentre, '£299');

    /* ---------- Money and paperwork ---------- */
    await ok(B({ op: 'expense-save', expense: { supplier: 'Retell AI', category: 'AI', amount: 40, recurring: true, starts_on: `${today.slice(0, 7)}-01` } }));
    await ok(B({ op: 'expense-save', expense: { supplier: 'Laptop stand', category: 'Equipment', amount: 35.5, recurring: false, starts_on: today } }));
    const books = await ok(B({ op: 'books' }));
    assert.equal(books.revenueFrom, 'invoices');
    assert.equal(books.revenue, 2590);
    assert.equal(books.expenseTotal, 75.5);
    assert.equal(books.profit, 2514.5);
    assert.equal(books.vat.level, 'fine');
    assert.equal(books.unpaid[0].amount, 299);
    assert.equal(books.unpaid[0].attempts, 2);

    await ok(B({ op: 'deadline-save', deadline: { title: 'ICO data protection fee', category: 'Data protection', due_on: addDays(today, 5), repeat: 'yearly' } }));
    await ok(B({ op: 'deadline-save', deadline: { title: 'Insurance renewal', category: 'Insurance', due_on: addDays(today, 3), repeat: 'none' } }));
    let pw = await ok(B({ op: 'paperwork' }));
    assert.equal(pw.soon.length, 2);
    assert.ok(pw.suggestions.some((s: any) => /ICO/.test(s.title)));
    assert.ok(pw.agreements.find((a: any) => a.email === 'sam@crewephysio.example').terms);
    const ico = pw.deadlines.find((d: any) => /ICO/.test(d.title));
    const done = await ok(B({ op: 'deadline-done', id: ico.id }));
    assert.equal(done.next, addDays(today, 5).replace(/^\d{4}/, (y) => String(Number(y) + 1)).replace(/-02-29$/, '-02-28'));
    pw = await ok(B({ op: 'paperwork' }));
    assert.equal(pw.soon.length, 1, 'a yearly deadline moves to next year when done');

    const health = await ok(B({ op: 'health' }));
    assert.ok(health.clients.some((c: any) => c.email === 'sam@crewephysio.example'));

    /* ---------- The morning email ---------- */
    assert.equal(await (await daily()).text(), 'sent');
    const morning = emails.filter((e) => /^Gainora today/.test(e.subject)).pop();
    assert.match(morning.subject, /1 failed payment/);
    assert.match(morning.text, /Payments that failed \(1\):\n• late@clinic\.example: £299, 2 attempts/);
    assert.match(morning.text, /Business deadlines this week:\n• Insurance renewal/);
    assert.match(morning.text, /Sales calls today:\n• \d\d:30 Crewe Physio Ltd \(Sam Patel\)/);

    /* ---------- Monthly results ---------- */
    assert.equal((await runResults(today)).sent, 0, 'off until switched on');
    await ok(B({ op: 'care-settings', resultsEmails: true }));
    const lastMonthMid = (() => { const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString(); })();
    fake.tables.briefs.push({ id: 'b1', user_id: sam.id, created_at: lastMonthMid }, { id: 'b2', user_id: sam.id, created_at: lastMonthMid });
    fake.tables.leads.push({ id: 'l1', user_id: sam.id, created_at: lastMonthMid });
    assert.equal((await runResults(today)).sent, 1);
    const results = emails.filter((e) => /^Your \w+ with Gainora$/.test(e.subject)).pop();
    assert.equal(results.to[0], 'sam@crewephysio.example');
    assert.match(results.text, /Command Centre wrote 2 weekly briefs and found 1 new potential customer/);
    assert.equal((await runResults(today)).sent, 0, 'once a month');
    // The other settings survive saving the rate card.
    await ok(A({ op: 'settings-save', rates: { sms: 0.05 } }));
    const kept = fake.tables.admin_settings[0].data;
    assert.equal(kept.care.resultsEmails, true);
    assert.equal(kept.outreach.autoSend, true);
    assert.equal(kept.rates.sms, 0.05);
  } finally { fake.server.close(); }
});
