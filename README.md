# Gainora Capture & Convert

An AI receptionist for UK trades, run by Gainora as a managed service, plus the app the owner uses
every day: one inbox for every call, form and email, emergencies flagged straight to them, and
follow-ups drafted until the job is booked and paid.

Gainora does not build its own call agent. Calls are answered by a white-label platform
(Trillet first, My AI Front Desk as backup). This app owns everything around it.

Same look as Gainora Command Centre (black and champagne), separate app and site. It uses the
**same Supabase project**, so one Gainora login works in both apps.

## What's in it

| Screen | What the owner does there |
|---|---|
| **Today** | What needs them now (emergencies first, with a Call back button), the last 7 days, follow-ups due, visits coming up. A getting-started checklist until the first real enquiry arrives. |
| **Enquiries** | The inbox: needs a reply, in progress, won, didn’t go ahead, spam. Search, export to CSV, log a call by hand. Each enquiry: summary, transcript, contact buttons, notes, history, and the next step (draft a reply, quote sent, booked in, job done, paid, payment reminder, review request). |
| **Follow-ups** | Quote chasers (day 3 and day 8), payment reminders (due date, +7, +14 days) and review requests (the day after a paid job), each drafted and ready to copy or open in Messages or email. |
| **Receptionist** | The script, written from the owner’s answers (copy or download). Connect: platform, secret enquiry links, call forwarding codes. Test enquiry and a ready-made website form. |
| **Report** | Month by month: enquiries caught, out of hours, emergencies, reply time, quotes, jobs won, paid, still owed, a weekly chart and the enquiry-to-job funnel. Prints to PDF for the monthly review call. |
| **Settings** | Every setup answer, the plan and billing, data download, sign out. |

First sign-in goes through a four-part setup (business, work, calls, follow-ups) and ends by
showing the receptionist’s opening line and rules.

## Safety rules built in

- **Nothing is sent to a customer by Gainora.** Every message is drafted; the owner sends it from
  their own phone or email and taps “I’ve sent it” to log it. The only emails Gainora sends go to
  the owner (emergency alerts, the morning follow-up list, the monthly report).
- The receptionist always says it’s an AI and, when calls are recorded, says so. Gas smells get the
  National Gas Emergency number (0800 111 999). It never takes card details or gives safety advice.
- Review requests are treated as marketing and always carry an opt-out line.
- Enquiry links are secret per source; only a SHA-256 of each token is stored, and any link can be
  switched off. Website forms include a hidden spam-bot trap.
- The owner can delete any enquiry permanently (for data requests).

## How it fits together

- `netlify/functions/enquiry-in.ts` — `POST /api/enquiry-in/<token>`. Takes Retell-style call
  webhooks, flat JSON (Trillet, Zapier, Make) and normal form posts. Sorts urgency and type, marks
  out-of-hours (UK time), ignores platform retries, emails the owner about emergencies.
- `netlify/functions/enquiries.ts` — the owner’s actions: link, revoke, add, update, draft, test, delete.
- `netlify/functions/capture-daily(-background).ts` — 07:00 UTC: the morning email of follow-ups
  due and unanswered enquiries; on the 1st, last month’s report.
- `netlify/functions/stripe-webhook.ts`, `billing-portal.ts` — Capture & Convert subscriptions.
- `shared/capture.ts` — every rule (triage, out of hours, script, follow-up timing, report),
  shared by the server, the app and the demo so they always agree.

## Go live

1. **Database:** in the Supabase SQL editor of the Gainora project, run
   `supabase/migrations/20261108_capture_convert.sql` (rollback file alongside).
2. **Stripe:** create a product “Gainora Capture & Convert” with a £249/month price (and a one-off
   £395 setup price or an invoice). Add a webhook endpoint
   `https://<this site>/api/stripe-webhook` for `checkout.session.completed` and
   `customer.subscription.created/updated/deleted`.
3. **Netlify:** new site from this repo. Environment variables:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (same as Command Centre),
   `APP_URL` (e.g. `https://capture.gainora.co.uk`), `INTERNAL_SECRET` (a new random string),
   `RESEND_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (this endpoint’s),
   `STRIPE_CAPTURE_PRODUCTS` (product ids, comma-separated), and optionally `ANTHROPIC_API_KEY`
   for AI-written first replies (templates are used without it).
4. **Domain:** add `capture.gainora.co.uk` in Netlify and a CNAME in Squarespace DNS.
5. **Supabase auth:** add the new site to Authentication → URL configuration → Redirect URLs.

## Develop

```
npm install
npm run typecheck
npm test
npm run build          # dist/
npm run build:demo     # dist-demo/: runs in the browser with a sample plumbing business
```
