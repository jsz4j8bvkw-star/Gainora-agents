# Gainora Capture & Convert

An AI phone receptionist for beauty and aesthetics clinics and salons (and other appointment and trade
businesses), run by Gainora as a managed service, plus the app the owner uses every day: one inbox for every
call, form and email, concerns flagged straight to them, automatic texts that are polite by design, and a
monthly report that says what to change next.

Calls are answered on **Retell**. The agent is built from the client's own settings (`shared/retell.ts`
and `shared/capture.ts`), so the script in the app and the receptionist on the phone never drift apart.

Same look as Gainora Command Centre (black and champagne), separate app and site. It uses the
**same Supabase project**, so one Gainora login works in both apps.

## Packages

| | Never Miss a Call | Call to Booking | Full Front Desk |
|---|---|---|---|
| Monthly | £249 | £399 | £599 |
| Setup | £595 | £995 | £1,995 |
| Minutes | 300 | 600 | 1,200 |
| Adds | Receptionist day and night, urgent calls to your mobile, inbox, follow-ups, report | Books into the diary and texts a confirmation, recognises returning callers | Several staff, numbers or call transfers |

Founding clients: Call to Booking at £299 a month, £495 setup. Extra minutes £25 per 100.

## What's in it

| Screen | What the owner does there |
|---|---|
| **Today** | One list of what needs them now, in priority order (an emergency, a client waiting on an answer, a new enquiry), each with the next step and a one-tap action. What the receptionist caught while they were closed, valued from their own price list. Coming up, and clients due back. |
| **Enquiries** | The inbox: needs a reply (ordered by who needs you first), in progress, attended or won, didn’t go ahead, spam. Each enquiry: summary, the client's texts, transcript, notes, history, a next step that reads the situation, and a reply drafted from what the client actually said. |
| **Follow-ups** | Clinics and salons: clients due their next treatment (by the interval set for each treatment), enquiries that went quiet, payments. Trades: quote chasers, payment reminders, review requests. Every message is drafted; the owner reads it and sends it. |
| **Receptionist** | The script, written from the owner's answers. Connect: platform, secret enquiry links, call forwarding codes. Test enquiry and a ready-made website form. |
| **Automations** | Messages that go out on their own: thank-you, booking confirmation and reminder, aftercare check-in, rebook reminder, quote chasers, payment reminders, review request. Each can be switched on or off, reworded, retimed, sent by text, email or both, and set to “ask me first”. Also urgent-call texts to the owner, a “waiting for you” queue and a log of everything sent and received. |
| **Report** | Month by month: caught, out of hours, emergencies, reply time, booked and attended (valued from the owner's own prices and fees), no-shows, paid and owed, a weekly chart, the funnel, and “what to change next month” from the month's own numbers. Prints to PDF for the monthly call. |
| **Settings** | Every setup answer (including each treatment's price and “due back” interval), the plan and billing, data download, sign out. |

First sign-in goes through a five-part setup (business, work, bookings, calls, follow-ups) and ends by
showing the receptionist’s opening line and rules.

## The receptionist

- Built for Retell from `shared/retell.ts`: a warm British receptionist, one question at a time, honest if
  asked whether she's an AI, never claiming to be a person. `node scripts/retell-export.mjs [beauty|clinic|trade]`
  writes the LLM and agent bodies and a to-do list to `retell/<sample>-demo/`; `retell/beauty-demo/TEST-CALLS.md`
  is the test script.
- Her post-call analysis (call type, booked, booked_for, appointment type, who with, preferred times, new or
  returning, urgent concern) flows into the inbox. A booking she made on the call, with a sane time, lands as a
  booking and the confirmation text goes out.
- She never offers to check a diary that isn't connected yet: until Gainora marks the diary connected, she takes
  details for a call back whatever booking mode the owner chose.
- **Returning callers** (`shared/callers.ts`, `netlify/functions/caller-in.ts`). When a call comes in, Retell asks
  `POST /api/caller-in/<token>` (same secret as the enquiry link) about the calling number. She is told only a first
  name, how many visits, the last treatment and who did it, the next booking, and an enquiry still waiting for a
  reply. Sources: the inbox, plus the Command Centre client list when the owner keeps one (same login). Never notes,
  summaries, prices paid or anything health-related. A number isn't proof of identity, so she keeps all of it back
  until the caller has given a name that matches. Withheld numbers, errors and a slow database all fall back to
  “nothing on record”: the call never waits or fails because of it.
- **Deposits for new clients:** if the owner sets a deposit and their own payment link (Settings → Bookings), she
  tells new clients when she books them and their confirmation text carries the link. Returning clients, and anyone
  with an attended visit from the same number or email, are never asked. Gainora never takes payments.

## Beauty and aesthetics safety (the owner's decision)

Concerns after a treatment go to the clinic's own emergency line (given to the caller, or transferred when the
line is dialable). The receptionist never directs callers to 999, A&E, NHS 111, a GP or a pharmacy. If a caller
asks about 999 or A&E, she doesn't tell them not to go and doesn't suggest it: she says she can't give medical
advice and gives the clinic line. She never gives medical or aftercare advice, never says whether something is
normal, and never takes card details. Other appointment businesses (physio, dental…) keep their 999 safety rules;
trades keep the National Gas Emergency number (0800 111 999).

## Texts

- Sent through Twilio from each business's own UK number (`texting.number` in their settings, stored as +44…,
  with `texting.status` set to `on` once Gainora has set it up). `TWILIO_FROM` is the fallback number.
- Each number's “A message comes in” webhook: `https://<this site>/api/sms-in` (POST). Requests are checked
  against Twilio's signature; set `TWILIO_WEBHOOK_URL` to that exact address.
- Replies land on the client's latest enquiry, pause chasers and reminders, and show as unread. STOP/START are handled.
- Rules that always apply: quiet hours 8pm–8am (except instant replies), stop when the client replies,
  STOP honoured, at most 4 automatic messages a week per client, review and rebook messages carry an opt-out,
  and switching a message on only affects enquiries from then on.
- `automations-tick` runs every 5 minutes for timed messages; instant ones go when the event happens.

## Safety rules built in

- **Clients only get messages the owner switched on, approved or wrote.** Everything sent is logged
  on the enquiry and in Automations → Sent and received.
- Drafted replies are built from the client's own message and the owner's own details (address, arrival notes,
  listed prices). AI, when a key is set, only polishes that draft; anything that reads as a health concern is never
  sent to the model and is drafted as “I'll call you today”.
- Money shown anywhere comes from the owner's entered values or their own price list; a “from” price is shown as
  “at least”. Nothing is estimated.
- Enquiry links are secret per source; only a SHA-256 of each token is stored, and any link can be switched off.
  Website forms include a hidden spam-bot trap.
- The owner can delete any enquiry permanently (for data requests).

## How it fits together

- `netlify/functions/enquiry-in.ts` — `POST /api/enquiry-in/<token>`. Takes Retell call webhooks (`call_analyzed`),
  flat JSON (Zapier, Make) and normal form posts. Sorts urgency and type, marks out-of-hours (UK time), ignores
  platform retries, emails the owner about emergencies, texts them if they asked.
- `netlify/functions/enquiries.ts` — the owner’s actions: link, revoke, add, update, draft, test, delete, reply,
  approve, skip, read.
- `netlify/functions/sms-in.ts` — Twilio inbound texts. `automations-tick(-background).ts` — timed messages.
- `netlify/functions/capture-daily(-background).ts` — 07:00 UTC: the morning email; on Mondays, the last seven days
  valued at the owner’s own prices, what’s still open and the week ahead; on the 1st, last month’s report.
- `netlify/functions/caller-in.ts` — `POST /api/caller-in/<token>`: Retell's inbound-call webhook for returning callers.
- `netlify/functions/stripe-webhook.ts`, `billing-portal.ts` — subscriptions.
- `shared/capture.ts` — every rule (triage, out of hours, script, prices from the treatment list, report),
  `shared/automations.ts` — the message engine, `shared/insight.ts` — priority, next step, drafted replies,
  clients due back, report advice. All pure, shared by the server, the app and the demo so they always agree.

## Go live

1. **Database:** in the Supabase SQL editor of the Gainora project, run
   `supabase/migrations/20261108_capture_convert.sql` (rollback file alongside). No further migration is needed
   for this version: new settings (treatment intervals) live in the existing `capture_settings.data` JSON, and
   no-shows are recorded in each enquiry's history.
2. **Stripe:** create three products: Never Miss a Call (£249/month, £595 setup), Call to Booking (£399/month,
   £995 setup) and Full Front Desk (£599/month, £1,995 setup). Add a webhook endpoint
   `https://<this site>/api/stripe-webhook` for `checkout.session.completed` and
   `customer.subscription.created/updated/deleted`.
3. **Netlify:** new site from this repo. Environment variables:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (same as Command Centre),
   `APP_URL` (e.g. `https://capture.gainora.co.uk`), `INTERNAL_SECRET` (a new random string),
   `RESEND_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (this endpoint’s),
   `STRIPE_CAPTURE_PRODUCTS` (product id and package, e.g. `prod_A:answer,prod_B:book,prod_C:desk`),
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_WEBHOOK_URL`, and optionally `ANTHROPIC_API_KEY`
   to polish drafted replies (the rule-based drafts are used without it).
4. **Retell:** export the agent for the client (`node scripts/retell-export.mjs` as a starting point), create the LLM
   and agent in Retell, pick the voice and model, paste the enquiry link from Receptionist → Connect as the webhook
   (event `call_analyzed`), attach a UK number. For Call to Booking and up, set that number's **Inbound Webhook URL**
   to the caller lookup link shown with the enquiry link (`/api/caller-in/<token>`). For Never Miss a Call, export
   with `recogniseCallers: false`.
5. **Domain:** add `capture.gainora.co.uk` in Netlify and a CNAME in Squarespace DNS.
6. **Supabase auth:** add the new site to Authentication → URL configuration → Redirect URLs.

## Develop

```
npm install
npm run typecheck
npm test
npm run build          # dist/
npm run build:demo     # dist-demo/: runs in the browser with sample data (a beauty clinic by default; a physio and a plumber too)
node scripts/retell-export.mjs   # retell/beauty-demo/*
```
