# Gainora Agents

The client app for **Gainora Command Centre**: three AI agents in one installable web app at **app.gainora.co.uk**, sold as one subscription (£299 a month; founding price £199 a month for the first 10 clients, fixed for 12 months; no setup fee, cancel any time).

- **The Watcher**: checks the client's website every morning (uptime, broken links, security certificate, contact page), if they have one. It finds the competition itself: businesses like the client's within 5 km of them (widened to 10 km, then 15 km, only when fewer than five comparable ones are found closer, never further), from Google Places by type (beauty salon, skin clinic, spa… so businesses with no website are found too) and by phrase ("aesthetics clinic", "lip filler and anti-wrinkle injections"), with the distance shown on every one. The client's own coordinates come from their Google listing, else their postcode or town (postcodes.io, free). Up to five the client names are watched alongside. For each competitor it follows the Google rating and review count over time (new reviews as a sign of how busy they look), reads their website and public booking pages (a listing whose "website" is a Fresha, Booksy or Treatwell page, Instagram or Facebook is recorded as that), reads Fresha pages as structured data (every treatment and exact price, team size, rating and review count), says plainly when a booking page (Phorest, Pabau…) only renders in a browser, records Instagram and Facebook links, and, when Instagram reading is switched on (see `META-SETUP.md`), reads public Instagram professional accounts for followers, posting pace and offers in captions. Every service, price and offer must appear word for word on the page, in the page's own data, or in the caption it came from, with a link and date, or it is dropped. **Prices** are compared like for like through a treatment catalogue (anti-wrinkle by area, filler by ml, Profhilo by session, laser hair removal by area, brows, lashes, nails, hair, massage…): your price, each competitor's, the local average and range, your position in plain words, what they offer that you don't, and dated price changes. **You vs them** puts the same public figures side by side (Google rating and reviews, new reviews in 30 days, booking-page rating, reviews and team, treatments listed, starting price, Instagram followers and posts, distance, website) with a dash and the reason wherever a figure is unknown, and a verdict on how each one looks next to you, never a claim about their bookings. It also reads the client's Google reviews daily and drafts replies, and runs Google's speed test weekly.
- **The Scout**: for businesses whose customers are the public (clinics, salons, cafés…) it finds where the next customers already are: public posts where people nearby are asking for exactly this (Reddit, forums, Nextdoor and Q&A pages; linked, with a reply drafted that the owner posts in person), local groups and communities worth joining with an introduction to post, referral partners (hairdressers, bridal shops, gyms, photographers, venues) with an introduction to send, events and seasonal moments, and workplace or wellness tie-ups. Every lead has a source link and a next step. It reads public pages only, never anything behind a login, never names or lists individuals, and never posts for the owner. For businesses that sell to businesses it researches prospects, stockists or partners as before. Leads go into a pipeline with follow-up reminders on day 4 and day 9. Every morning it also matches new UK public contracts from Contracts Finder to the business.
- **The Brief**: turns the client's weekly numbers into a short report with three priorities tied to their 90-day goal. When orders or revenue dip, it writes win-back messages (email, text and social post) for past customers.
- **Your clients** (new): the owner's own past clients, added by hand or imported from their booking system (Fresha, Phorest, Pabau, Booksy, Timely, Treatwell or any CSV/.xlsx; read on the owner's device, columns matched automatically, duplicates merged by mobile then email). From each client's visits and a per-treatment gap (the typical gap, the owner's setting, or the client's own), Gainora works out who is **due back** this week and who is overdue, grouped by treatment with the value at their last prices, and drafts a short personal text for each (the clinic's voice, one way to book, "Reply STOP to opt out"). The owner edits, approves and sends from their phone one at a time (an `sms:` link opens the messages app; a Twilio sender can be connected later, env-gated and off by default). Texts go only to clients who opted in or existing clients under the soft opt-in, never to anyone who opted out, never in quiet hours (20:00 to 08:00 by default), and at most once a week per client. After a visit it suggests asking happy clients for a Google review with the listing's review link (never more than once per client in 90 days, never with an incentive), and drafts replies to new Google reviews in the owner's voice (complaints are taken offline; health details never appear). Every message is recorded; the owner marks "this got a booking" with the amount (pre-filled from the client's last price), and a visit within 21 days of a message is shown as *likely* until confirmed. **The money number** on Home, in the Brief, on Your results and in the monthly email: "This month Gainora helped bring in £X from N bookings you confirmed", from confirmed bookings only. Each client has a next due date, a per-client gap ("comes every 10 weeks"), snooze and "not coming back"; the owner is reminded on Home, by alert and in the Monday digest when clients become due. Consent is recorded per client, STOP is honoured everywhere, and any client (or everything) can be exported or deleted.
- **Ask**: a chat that answers from the client's business profile and everything their agents have found, including the like-for-like prices and size signals. The question is saved first and the answer written in the background, so a reply can never be lost on the way to the screen: the app polls the conversation for it, re-fetches after sending, and offers "Check for an answer" and "Ask again" if anything goes wrong.
- **Your results**: a running record of what the agents found and did, with time saved (an estimate, with its basis shown) and money only where it comes from a real figure. Clients get a "Your month with Gainora" email on the 1st.
- **Learning**: "Useful" / "Not relevant" on anything an agent produces becomes plain rules the agents follow. Clients can see and remove them under Your business.

Every client starts with an onboarding questionnaire (7 sections, autosaved), which all three agents work from. It asks which booking system they use (Fresha, Treatwell, Booksy, Phorest, Pabau, Timely, another, or none), for the link to their public booking page, and for their price list, typed or pasted one line per treatment; all optional, like the website, Instagram and Facebook. Gainora never sends, posts or replies on the client's behalf: it drafts, and the client sends.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Web app (React) | Netlify, `dist/` | Sign-in, onboarding, dashboard, agents, Ask. Installable on phone and desktop (PWA). |
| API | Netlify Functions, `netlify/functions` | Agent runs, chat, leads, feedback, Stripe webhook, billing portal, daily schedules. |
| Data and login | Supabase (new project) | Magic-link sign-in, one row-level-secured table per kind of data. |
| AI | Anthropic API (or OpenAI) | Research with web search (Scout), writing (Brief, Ask, replies, follow-ups, win-back), contract matching and price pairing. Cost logged per client, monthly cap. |
| Google | Places API (New), PageSpeed Insights API | The client's public rating and reviews, the competitors nearby (Nearby Search by type and Text Search by phrase, both restricted to a radius) and their ratings, and the weekly speed test. One API key. |
| Location | postcodes.io | The client's coordinates from their postcode or town when they have no Google listing. Free, no key. |
| Booking pages | Fresha and other public booking pages | Treatments, prices, team size, rating and reviews, read from the public page's own data. No logins. |
| Instagram | Meta Graph API, Business Discovery | Public professional accounts (the client's and competitors'), read with Gainora's own token. Optional; see `META-SETUP.md`. |
| Public contracts | Contracts Finder (gov.uk) | Open tenders, fetched once a day for everyone (no key needed), then matched per client. |
| Payments | Stripe | Payment Link → webhook → agent switched on, login created, welcome email. |
| Email | Resend | Welcome email, the weekly summary on each client's report day, and the monthly results email. |

Clients only see agents they pay for. Others show as "Add to your plan".

## Go live (about an hour, once)

1. **Supabase.** Create a new project called `gainora-agents` (London region). In SQL Editor, run `supabase/migrations/20261102_gainora_agents.sql`, then `supabase/migrations/20261107_gainora_agents_v2.sql`, then `supabase/migrations/20261109_gainora_clients.sql`. In Authentication → URL configuration set Site URL to `https://app.gainora.co.uk`. In Authentication → Providers → Email, turn off "Allow new users to sign up" (subscriptions create logins). In Authentication → SMTP, connect Resend so sign-in emails come from hello@gainora.co.uk.
2. **Resend.** Create a free account, add the domain `gainora.co.uk`, and add the DNS records it shows in Squarespace Domains. Create an API key.
3. **Anthropic.** Create an API key at console.anthropic.com and set a monthly spend limit.
4. **Google.** In Google Cloud Console, create a project called `gainora-agents`, turn on billing, and enable **Places API (New)** and **PageSpeed Insights API**. Create an API key, restrict it to those two APIs, and set a budget alert under Billing → Budgets. This key goes in `GOOGLE_API_KEY`. Without it the rest of the app still works: the Reviews tab says reviews aren't switched on yet, and the speed test runs on Google's small keyless quota.
5. **GitHub + Netlify.** Put this folder in a private GitHub repo. In Netlify: Add new site → Import from GitHub → this repo. Build settings come from `netlify.toml`. Add the environment variables from `.env.example`. Add the domain `app.gainora.co.uk` (CNAME `app` → the new Netlify site in Squarespace DNS).
6. **Stripe.** Developers → Webhooks → Add endpoint `https://app.gainora.co.uk/api/stripe-webhook`, events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Create a restricted secret key with read access to Customers, Subscriptions and Checkout Sessions, and write access to Customer portal, for `STRIPE_SECRET_KEY`. Turn on the Customer portal (Settings → Billing → Customer portal). Create one product, **Gainora Command Centre**, with two monthly prices: £299 (standard) and £199 (founding). Make a Payment Link for each, with the confirmation page set to redirect to `https://app.gainora.co.uk`. Put the product's ID in `STRIPE_AGENT_PRODUCTS` as `"all"` (see `.env.example`); both prices then unlock all three agents. The older single-agent products can stay in the list for anyone already on them.
7. **Test.** Buy Command Centre with a 100% coupon, check the welcome email, sign in, complete the questionnaire, and confirm the first Watcher check appears within a few minutes. On the Watcher's Reviews tab, find and confirm the business's Google listing.

### Already live on the first version?

Run `supabase/migrations/20261107_gainora_agents_v2.sql` in the SQL Editor (it only adds tables and columns), add `GOOGLE_API_KEY` in Netlify, and redeploy. Undo with `20261107_gainora_agents_v2_rollback.sql`, which removes only the new data.

### Already live on the second version?

Run `supabase/migrations/20261109_gainora_clients.sql` in the SQL Editor (it only adds the five client tables, with owner-only row-level security) and redeploy. Until it has run, "Your clients" shows "being set up" and everything else works as before. Undo with `20261109_gainora_clients_rollback.sql`, which deletes every owner's client records: export first.

### My day (Gainora admin)

A private page in the admin at `/me` (first in the menu) for Adelin's own day: the repeating routine with a tick box per block (05:30 coffee and check-in, gym, follow-ups, walk-ins, trading, client work, evening calls, 21:30 bed), today's gym session from the 7-day split, three must-dos, the scoreboard (contacts, owner conversations, sales chats, proposals, new clients, energy 1 to 10), a minimum day and a good day with a streak that a minimum day keeps alive, a personal to-do list (business, trading, gym, personal; repeating tasks move to their next date when ticked), daily notes, a trading journal and written trading rules. My weeks adds up the last eight weeks and warns when energy has averaged under 6 for two weeks running. The Claude connector gets matching tools (`get_my_day`, `update_my_day`, `log_gym`, `update_gym_plan`, `log_trading`, `update_trading_rules`, `get_my_routine`, `update_routine_block`, `list_my_tasks`, `add_my_task`, `update_my_task`, `get_my_week`), so check-ins can be done by talking to Claude.

To switch it on, run `supabase/migrations/20261114_gainora_my_day.sql` in the SQL Editor (it only adds four `me_` tables; nothing about clients changes) and redeploy. The default routine is written the first time the page opens. Only one person sees it: the emails in `MY_DAY_EMAILS`, or if that isn't set, the first email in `GAINORA_ADMIN_EMAILS`. Undo with `20261114_gainora_my_day_rollback.sql`.

### Schedules

| When (UTC) | Function | What it does |
| --- | --- | --- |
| 05:30 daily | `tenders-daily` → `tenders-background` | Fetches new open contracts from Contracts Finder and matches them to each Scout client. |
| 06:00 daily | `daily` → `daily-background` | Starts every Watcher run (site, reviews, competitors; speed test and prices weekly), reminds owners about their own clients who became due back (once per client per due date), sends weekly summaries on each client's report day (with who is due this week and the month's money number so far), follow-up reminders, and the monthly results email on the 1st (with what Gainora's messages brought in). |

## Running costs

- Netlify and Supabase: free tiers are enough for the first ~50 clients.
- Resend: free up to 3,000 emails a month.
- AI: logged per client in `ai_usage`. Each client is capped at `AI_MONTHLY_CAP_USD` (default $8), and the app stops AI work for that client until the 1st. Site checks are plain code; AI is used when a competitor page changes, for the weekly price comparison, for drafts the client asks for, and for the daily contract shortlist (at most 15 notices, on the fast model). A Scout search uses up to 8 web searches.
- Google: the Watcher makes one Place Details request per client per day (rating and reviews). For the competition it uses the smallest field masks and counts every call: the monthly nearby search costs one Nearby Search plus up to three phrase searches at 5 km, and one of each at 10 km and 15 km only if too few were found (at most 8 calls); one Text Search to match each competitor the client named (once); and one Place Details (rating and count only) per watched competitor per week. The total is capped per client per month by `PLACES_MONTHLY_CAP` (default 90; the count is kept in `watcher_state.state.competitors.placesCalls`). Google gives each Places API a monthly free allowance and then charges per request, so check current prices on Google's pricing page and keep the budget alert on. The PageSpeed Insights API and postcodes.io have no charge.
- Instagram: one Business Discovery call per account per day, capped by `META_DAILY_CAP` across all clients (default 150) and `META_PER_CLIENT_CAP` (default 10). Free.
- AI for the competition: the fast model only, and only when a competitor's page text actually changed (hashes are kept per URL) or there are new Instagram posts; Fresha pages are read as data with no AI at all; treatment names are matched by rule, and only the few the rules cannot place go to the fast model once (answers kept); one short advice call a day when something changed, otherwise weekly. The weekly AI price table only runs for businesses whose prices the catalogue cannot match.
- Contracts Finder: free, no key. The app fetches once a day for all clients and backs off when asked to.

## Develop

```
npm install
npm run build:demo   # demo with sample data in dist-demo/
npm run build        # production build in dist/
npm test             # 103 tests: clients (due dates, intervals, snooze, consent and STOP, quiet hours, caps, filters, export),
                     # imports (CSV, .xlsx, header detection for six booking systems, dedupe, caps), drafts (rebook, review request,
                     # replies, health scrub, SMS links and segments), the money number (confirmed vs likely), response packs,
                     # the first ten minutes, reminders and digest lines, graceful behaviour without the client tables,
                     # page parsing and diffing, Brief maths and priorities, the ranked Today list, Ask sources, validation, Stripe signatures, Scout filtering and learning,
                     # results maths, speed-test parsing, contract parsing and matching, price checks, follow-up dates,
                     # review tracking, a real crawl against a local site, the webhook, the lead pipeline end to end,
                     # the competition: postcode and town geocoding, the radius ladder and relevance rules, a faked Crewe search,
                     # the Fresha, schema.org and JavaScript-page readers, the pasted price list, the treatment matcher and the
                     # like-for-like comparison, verbatim checks, change events, Instagram parsing, a full faked day of the reach check
                     # with a Fresha-only competitor, the owner's actions, size verdicts, the Scout's modes and people rules,
                     # Ask's background hand-off and failure paths, and the error messages the owner reads
npm run typecheck
```

## Safety rules built in

- Gainora never sends emails, posts, replies to reviews or contacts anyone for the client. It drafts introductions, follow-ups, review replies and win-back messages; the client sends them.
- Every first email and follow-up ends with an easy way to opt out, and the Scout stops at two follow-ups.
- Texts to the owner's clients: only to clients who opted in or existing clients under the soft opt-in, never to anyone who opted out (STOP is recorded on the client and honoured everywhere), never in quiet hours, at most the weekly cap per client, always with "Reply STOP to opt out", and always approved by the owner one at a time. Review requests never offer anything in return and go to a client at most once in 90 days. Client notes are private to the owner and never reach the AI or a draft; health details never appear in a review reply.
- The money number counts only bookings the owner confirmed came from a message Gainora drafted, at the amount the owner entered. Visits within 21 days of a message are shown as likely until confirmed, and never in the headline.
- Review replies never offer discounts, refunds or gifts in exchange for changing a review.
- The Watcher only reads public pages: websites, public booking pages and Google listings. It never submits forms or logs in anywhere, and never reads Instagram or Facebook without Meta's API. Prices in the comparison, and every competitor service, price and offer, must appear word for word on the page, in the page's own data, or in the Instagram caption they came from, or they are dropped; each is shown with its link and the date seen. Only the same treatment at the same amount is compared; "from" is a minimum; deposits, consultations and top-ups never count.
- Competitors' review counts, team size and followers are described as signs of how big or busy they look, never as bookings or revenue. Nothing further than 15 km is called "nearby". Gainora never contacts a competitor.
- Scout results must cite a page the search actually returned; personal emails, phone numbers, LinkedIn profiles, usernames and anything that names a private individual are dropped, as are posts from pages behind a login, the client's own site, listed competitors and anything the client marked "Not relevant". The owner posts and replies in person; Gainora never posts.
- The Brief may only use numbers the client entered; any AI text with an unsupported figure is replaced by the rule-based Brief.
- Results only show money from real figures: deal values the client entered, and contracts' published values (labelled as such).
- Everything the agents learned is shown to the client in plain words and can be removed.
- Each client's data is protected by row-level security; background functions need `INTERNAL_SECRET`.
