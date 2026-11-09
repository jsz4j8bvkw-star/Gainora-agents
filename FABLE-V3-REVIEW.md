# Fable v3: from an app that reports to one that brings in bookings

Branch `fable-v3`, built from `main` at `4034157` (what is live). Nothing has been pushed, merged or deployed; no live service, key or database was touched. Both type-checks pass, all 103 tests pass (83 before, 20 new), and both builds (`dist/`, `dist-demo/`) build. Screenshots of the demo build, desktop (1280) and phone (390), are in `/tmp/claude-0/-home-claude/33f7761b-12f0-5a26-b061-cf4a0d30e834/scratchpad/fable-v3/`.

## The test the product must pass

At the end of the month Home says, from bookings the owner confirmed: **"November: Gainora helped bring in £365 from 2 bookings you confirmed."** Only confirmed bookings count. A visit logged within 21 days of a Gainora text is shown as *likely* in a separate list and never in the headline until the owner says yes. The Bookings tab, the monthly email, the Brief and Your results all use the same list, and nothing is estimated anywhere.

## ⚠️ The migration (please run it)

**`supabase/migrations/20261109_gainora_clients.sql`** creates five tables: `clients`, `client_visits`, `client_actions` (every message the owner approved and sent, or pack they used), `client_outcomes` (bookings, confirmed or likely) and `client_reminders` (service-only, so the owner is reminded once per client per due date). Owner-only row-level security on the first four (`for all to authenticated using (user_id = auth.uid())`), service-only on the fifth; indexes on user, phone, email and dates; `updated_at` trigger; deleting a client cascades to everything about them; deleting the user cascades to everything.

**How to run:** Supabase → SQL Editor → paste the file → Run. It is additive and idempotent (I ran it twice against a local Postgres 16 with a stub `auth` schema, after the two existing migrations, and checked the RLS: one owner cannot read or insert another's rows, the reminders table is invisible to clients, cascades work). Until it has run, the app shows "Your clients is being set up" on the Clients page and Home, and nothing else changes: every read of the new tables catches PostgREST's missing-table answer (`PGRST205` / `42P01`) and returns "not ready" (tested).

**Rollback:** `20261109_gainora_clients_rollback.sql` drops the five tables and the trigger function. **It deletes every owner's client records.** Export first (each client's page, or Plan and settings → Download my data, which now includes clients).

**No new environment variables are required.** The Twilio ones (below) are optional and off by default.

## What I built, in the order of the brief

### 0. Your clients (the foundation)

A new section in the sidebar and the phone tab bar (now six tabs; Ask stays, reached by the search button too).

- **Add by hand**: name, mobile (normalised to +447…; landlines are kept for display and marked "not a mobile", since texts need a mobile), email, consent (existing client / opted in / not asked yet), and the last visit in the same form.
- **Add a visit, two taps on a phone**: the "+ Visit" button on the row opens a sheet with the client's last treatment selected, today's date, the amount pre-filled from what they paid last time for that treatment (else your price list), and the practitioner. Save is the second tap; changing the treatment is a third. Afterwards it offers "Ask for a review" when the client can be asked.
- **Import**: CSV or `.xlsx` (the first sheet, read straight from the zip in the browser; nothing uploaded until you press Import), or a pasted list. Headers from Fresha, Phorest, Pabau, Booksy, Timely and Treatwell are recognised (tested against each one's usual column names) and any column can be re-matched by hand. Dates read in the ways exports write them (day-first, ISO, "12 Mar 2026", Excel serials), prices as £, consent columns as yes/no. Rows for the same person merge by mobile, then email, then name; existing clients gain visits; skipped rows are listed with the reason; a preview and summary (clients, visits, with a mobile, opted out) come before anything is saved. Caps: 5 MB and 5,000 rows.
- **A client's page**: visits (add, delete), total spent, last visit, next due date with the gap and where it came from, per-client gap ("comes back every 10 weeks"), snooze (2 or 6 weeks), "not coming back", consent with "They opted in" / "Existing client" / "Replied STOP", private notes (never sent anywhere, never shown to the AI), messages sent and their bookings, "This got a booking", export (JSON) and delete.
- **Search and filters**: by name, mobile or treatment; Due back, Lapsed, Top spenders, No consent, Opted out, by treatment.
- **GDPR**: export and delete per client; "Delete all client data" under Plan and settings (type DELETE).

### 1. Bring back clients who are due (with the owner's addition: reminders)

- **Due dates** come from each client's last visit of each treatment and the gap that applies, in this order: the client's own gap, your setting for that treatment (Plan and settings → Your clients), the typical gap (`TYPICAL_INTERVAL_WEEKS` in `shared/clients.ts`, about 120 treatments, labelled "the typical gap" wherever shown). A treatment with no known gap gives no due date rather than a guess. Due = within 7 days; overdue = past by N weeks; **lapsed** = overdue by more than 8 weeks or one whole gap (a year-old HydraFacial client is a win-back, not this week's text).
- **Due back tab**: grouped by treatment, the value at their last prices, a draft per client in the clinic's voice ("Hi Sarah, it's Hannah at Willow Aesthetics. It's been about 3 months since your anti-wrinkle top-up, so you're due about now. Book here: … Reply STOP to opt out."), editable, with the character and segment count, approve individually or "Send all", one at a time.
- **Sending**: "Send from my phone" opens the phone's messages app with the text ready (`sms:` link); the owner presses send, comes back and taps "I sent it", which records it. There is also Copy and "Mark as sent". A **Twilio sender** plugs in behind `netlify/lib/sms.ts` (`SmsProvider` interface) and `/api/sms-send`: env-gated (`SMS_PROVIDER=twilio` plus the three Twilio values; all four or nothing is sent), it re-checks consent, STOP, quiet hours and the cap on the server, and requires the opt-out line. Without it, "Gainora sends it" in settings says so and sends nothing.
- **Rules**: never to opted-out clients (STOP is recorded on the client; `canMessage` refuses everywhere, including the server); only to clients who opted in or existing clients (at least one visit) under the soft opt-in; quiet hours 20:00 to 08:00 UK time by default (BST handled); at most one text of any kind per client per week by default; all three adjustable in settings.
- **Reminders to the owner**: Home shows "7 clients due back this week, 5 overdue · Sarah, Gemma, Rachel and 4 more · £1,515 at their last prices" with one tap to the drafts, and a "Message N clients due back this week" item in Do these today. The daily job (`daily-background`) finds clients who became due since yesterday and adds one alert and one to-do, once per client per due date (`client_reminders`). The Monday digest includes who is due this week and the month's money number so far. The Brief's context and priorities include the due clients and what Gainora brought in. Per client: the next due date, "overdue by N weeks", snooze, "not coming back".

### 2. More Google reviews

- **Requests**: the Reviews tab lists clients seen in the last 14 days who can be texted and were not asked in 90 days, each with a drafted text carrying the listing's review link (`https://search.google.com/local/writereview?placeid=<id>`). Never incentivised: if an edit adds "10% off" or "free", the draft is flagged and cannot be sent. Sending uses the same modes and records `last_review_ask_at`.
- **Replies**: for each review Google shares, a reply drafted in the owner's voice to copy and paste: praise thanked by first name for the specific thing praised (the edge only when the review touches on how they work); complaints answered calmly, with one apology for the specific service point and the conversation moved offline; never an offer for a changed review; **no health details** (`scrubHealth` drops any sentence that reads as medical, and `safeReply` runs on every AI-written reply on both the server and the client; the AI prompt now says the same). "Write it with AI" is there for the live app; the rule-based draft shows immediately.

### 3. Answer competitors

Under each competitor price change, offer or busy Instagram post on the Watcher's Competitors tab, "Answer this" opens a response pack built only from the owner's facts: an Instagram caption (names no competitor, quotes only the owner's own price and what it includes), a one-line "why us" for the website or booking page, and, when the event is about a treatment some due-back clients had, a text to exactly those clients (filtered by `canMessage`) through the same approve-and-send flow. The pack lists every fact and its source and states the rule: it does not match the price or copy the offer. Copying a caption or line is recorded as an action, so a booking can be attributed to it.

### 4. The money number

`shared/money.ts`. Every approved message and used pack is a `client_action`. "This got a booking" (on the client's page, on each sent message, on the Bookings tab) creates a confirmed `client_outcome` with the amount pre-filled from the client's last price for that treatment. Logging a visit within 21 days of a message to that client creates a *likely* outcome; the Bookings tab asks "Did the text bring them in?" with Yes (amount editable) or No. Home, Bookings, Your results (now the lead tile), the Brief and the monthly email show confirmed money only, with the list behind it. The demo's £365 is two confirmed rebooks (£195 + £170) with one likely (£180) waiting.

### 5. A real first ten minutes

For an account less than a week old with no clients, Home opens with "Your first ten minutes": three real actions (`shared/firstten.ts`: import your clients, connect your Google listing, add your price list, ask your last N clients for a review, your price for X is £Y above the local average, or "your nearby competitors are being found"), a panel showing the first competitor search in progress (polled every 15 s for up to six minutes; the first Watcher check already starts at the end of onboarding) and then the businesses found with distances, and "Your reviews next to theirs" (rating rank and review-count rank among the nearby businesses). Empty states on the Clients page are two guided cards (import, add by hand) and a list of what you get. The demo behaves like a new account for 90 seconds after onboarding so this can be seen.

### 6. Fill quiet days

On the Due back tab: pick a day and time, and Gainora drafts a note offering that slot to up to eight clients who are due or due within three weeks and can be texted, sent one at a time.

## What stays the same

Sign-in, onboarding, the three agents, Ask, Your business, Your results' timeline, the lead pipeline, public contracts, the Stripe webhook, email, the daily schedules, the design language. No existing API route, request or response shape changed. The only existing table touched is none: client settings live in `profiles.data.clientSettings` (optional; defaults apply). Alerts about due clients use the existing `alerts`/`actions` tables under the Brief's name (the alerts table only allows the three agents). All 83 earlier tests pass unchanged; the 20 new ones are in `clients`, `import`, `drafts` and `reminders`.

## Legal assumptions for you to check (not legal advice)

1. **Soft opt-in (PECR reg. 22(3))**: clients imported from your booking system, or added with a visit, are treated as existing customers who may be texted about similar treatments as long as every text offers an opt-out and they were given the chance to refuse when their details were collected. The app assumes the booking system or the clinic did that; an imported client with no visit and no stated consent is "No consent recorded" and cannot be texted until you log a visit or record an opt-in. If your booking system's marketing-consent column exists, map it: a stated "no" is honoured as opted out.
2. **Review requests count as marketing here**: they go through the same consent, STOP, quiet-hour and cap rules. That is the cautious reading; the ICO treats a review request that promotes the business as marketing.
3. **STOP handling is manual**: the owner records a STOP on the client's page (or imports an opt-out). Inbound STOP replies to a Twilio number are not yet read automatically (listed under not done); with "send from your phone" the reply arrives on the owner's phone.
4. **You are the data controller** for your clients' records in Gainora; Gainora is a processor. Your privacy notice should mention that client records are held in the app (Supabase, London) to send appointment reminders and marketing texts. Export and delete per client are built for access and erasure requests.
5. **Health data**: treatment names and visit dates are stored (they are needed for due dates); they are "data concerning health" under UK GDPR Article 9, so the lawful basis for holding them is the one the clinic already relies on for its records. Notes are owner-only and never leave the account; nothing about a client is sent to the AI by the new features (drafts are rule-based).
6. **Google review requests**: never incentivised (the app refuses to send one that mentions a discount, gift or prize) and never gated on the client being happy in a way that filters reviews, which Google forbids; the owner chooses who to ask.

## Decisions for you

1. **Typical gaps** (`TYPICAL_INTERVAL_WEEKS`): anti-wrinkle 13 weeks, lip filler 30 to 39 weeks by amount, Profhilo course 26 weeks, skin boosters and polynucleotides 4 weeks between sessions then 26 after a course, microneedling 6, HydraFacial and dermaplaning 4, laser hair removal 6 to 8, lashes and nails 3, brows 4, hair 6 to 14. Change any in the file or per treatment in settings.
2. **Lapsed after 8 weeks or one gap** (`LAPSED_AFTER_WEEKS`): keeps the due list about this week. Lapsed clients are a filter and a natural win-back audience; a lapsed text is not drafted yet.
3. **Quiet hours 20:00 to 08:00, one text per client per week, 90 days between review asks, 21-day attribution window** (`DEFAULT_SETTINGS`, `REVIEW_ASK_GAP_DAYS`, `LIKELY_WINDOW_DAYS`). The first two are per account in settings.
4. **Drafts are rule-based, not AI**: the same text in the demo, the tests and the app; no client data reaches the AI. The cost is some sameness across a day's texts. An AI "make it sound more like me" pass on the draft (sending only the draft, never the notes) is a small addition if you want it.
5. **Phone-first sending** (`sms:` links) is deliberate: it is free, it uses the clinic's own number clients recognise, and it needs no registration. With Twilio, an alphanumeric sender id (the clinic's name) cannot receive replies, so STOP replies would not arrive; a UK number can. Check Twilio's current UK pricing and sender rules before switching it on, and make the "Reply to this text to book" line a link.
6. **Alerts from the daily job are filed under The Brief** because the alerts table only knows three agents. If you would rather have a fourth ("Your clients"), that is a one-line constraint change in a migration.
7. **The demo's first 90 seconds** behave like a new account (`DEMO_FIRST_MINUTES_MS` in `src/lib/demo.ts`). Set it to 0 if you prefer the demo to open fully populated.
8. **The soft opt-in default for imports** (decision 1 above) is the one most clinics will want; the alternative is to import everyone as "No consent recorded" and ask them, which is safer and slower. One constant in `shared/import.ts` (`buildImport`, the line that sets `soft_opt_in`).

## What's not done, ranked by value

1. **Inbound STOP for a connected Twilio number** (a webhook that marks the client opted out) and delivery receipts. Needed before Twilio is switched on for anyone.
2. **Lapsed win-back texts** (a gentler draft for clients not seen in six months), from the Lapsed filter.
3. **An AI "in my voice" pass on drafts**, sending only the draft text.
4. **Ask** does not yet know about clients ("who is due this week?"). A short context block in `netlify/lib/agents.ts` from `loadClients`, with names only.
5. **Reading the STOP/consent columns of more export formats** and Fresha's two-file structure (clients in one, sales in another): the mapping handles either file, but merging two files in one go is not built; import them one after the other (the second import matches existing clients by mobile or email).
6. **Per-practitioner views** for clinics with a team (the practitioner is stored).
7. **Tests through the React pages** (the logic is tested; the pages are checked by type and by the screenshots).

## Tests added (20)

`tests/clients.test.ts` (6): phone normalisation and dedupe keys; due dates with the client/setting/typical order, the earliest treatment, no guess without a gap; snooze, not coming back, STOP; grouping and the Home line, newly-due since a time, the Today item; consent and opt-out rules, the weekly cap, the 90-day review gap, quiet hours including BST; history, filters, lapsed, amount suggestions and the export. `tests/import.test.ts` (4): CSV edge cases, dates, amounts, consent; headers from six booking systems; merging, existing clients, landlines, skipped rows, the summary and the saved records; caps and a real `.xlsx` through the zip. `tests/drafts.test.ts` (6): rebook texts in two voices with the opt-out line and segments; review requests, incentives, quiet-day and competitor texts; review replies for praise and complaints, the health scrub and `safeReply`; the money number (confirmed vs likely, cover line, attribution window, one link per visit); response packs (no competitor named, no price matched, audience filtered); the first ten minutes (review position, first actions, new-account rule). `tests/reminders.test.ts` (4): reminders once per due date with the line, weekly and monthly lines from confirmed bookings only, "not ready" without the tables and PostgREST's missing-table codes, the SMS provider off unless fully configured.
