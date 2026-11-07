# Gainora Agents

The client app for **Gainora Command Centre**: three AI agents in one installable web app at **app.gainora.co.uk**, sold as one subscription (£299 a month; founding price £199 a month for the first 10 clients, fixed for 12 months; no setup fee, cancel any time).

- **The Watcher**: checks the client's website every morning (uptime, broken links, security certificate, contact page) and tracks up to five competitors for price, offer and page changes. It also reads the client's Google reviews daily and drafts replies, runs Google's speed test weekly and turns it into a ranked list of plain-English fixes, and builds a weekly price comparison with competitors (every price is checked against the page it came from).
- **The Scout**: researches public sources for prospects, stockists or partners, or for local opportunities (markets, fairs, awards, networking), and returns a sourced shortlist with a ready-to-edit introduction for each. Leads go into a pipeline with follow-up reminders on day 4 and day 9. Every morning it also matches new UK public contracts from Contracts Finder to the business.
- **The Brief**: turns the client's weekly numbers into a short report with three priorities tied to their 90-day goal. When orders or revenue dip, it writes win-back messages (email, text and social post) for past customers.
- **Ask**: a chat that answers from the client's business profile and everything their agents have found.
- **Your results**: a running record of what the agents found and did, with time saved (an estimate, with its basis shown) and money only where it comes from a real figure. Clients get a "Your month with Gainora" email on the 1st.
- **Learning**: "Useful" / "Not relevant" on anything an agent produces becomes plain rules the agents follow. Clients can see and remove them under Your business.

Every client starts with an onboarding questionnaire (7 sections, autosaved), which all three agents work from. Gainora never sends, posts or replies on the client's behalf: it drafts, and the client sends.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Web app (React) | Netlify, `dist/` | Sign-in, onboarding, dashboard, agents, Ask. Installable on phone and desktop (PWA). |
| API | Netlify Functions, `netlify/functions` | Agent runs, chat, leads, feedback, Stripe webhook, billing portal, daily schedules. |
| Data and login | Supabase (new project) | Magic-link sign-in, one row-level-secured table per kind of data. |
| AI | Anthropic API (or OpenAI) | Research with web search (Scout), writing (Brief, Ask, replies, follow-ups, win-back), contract matching and price pairing. Cost logged per client, monthly cap. |
| Google | Places API (New), PageSpeed Insights API | The client's public rating and reviews, competitors' ratings, and the weekly speed test. One API key. |
| Public contracts | Contracts Finder (gov.uk) | Open tenders, fetched once a day for everyone (no key needed), then matched per client. |
| Payments | Stripe | Payment Link → webhook → agent switched on, login created, welcome email. |
| Email | Resend | Welcome email, the weekly summary on each client's report day, and the monthly results email. |

Clients only see agents they pay for. Others show as "Add to your plan".

## Go live (about an hour, once)

1. **Supabase.** Create a new project called `gainora-agents` (London region). In SQL Editor, run `supabase/migrations/20261102_gainora_agents.sql`, then `supabase/migrations/20261107_gainora_agents_v2.sql`. In Authentication → URL configuration set Site URL to `https://app.gainora.co.uk`. In Authentication → Providers → Email, turn off "Allow new users to sign up" (subscriptions create logins). In Authentication → SMTP, connect Resend so sign-in emails come from hello@gainora.co.uk.
2. **Resend.** Create a free account, add the domain `gainora.co.uk`, and add the DNS records it shows in Squarespace Domains. Create an API key.
3. **Anthropic.** Create an API key at console.anthropic.com and set a monthly spend limit.
4. **Google.** In Google Cloud Console, create a project called `gainora-agents`, turn on billing, and enable **Places API (New)** and **PageSpeed Insights API**. Create an API key, restrict it to those two APIs, and set a budget alert under Billing → Budgets. This key goes in `GOOGLE_API_KEY`. Without it the rest of the app still works: the Reviews tab says reviews aren't switched on yet, and the speed test runs on Google's small keyless quota.
5. **GitHub + Netlify.** Put this folder in a private GitHub repo. In Netlify: Add new site → Import from GitHub → this repo. Build settings come from `netlify.toml`. Add the environment variables from `.env.example`. Add the domain `app.gainora.co.uk` (CNAME `app` → the new Netlify site in Squarespace DNS).
6. **Stripe.** Developers → Webhooks → Add endpoint `https://app.gainora.co.uk/api/stripe-webhook`, events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Create a restricted secret key with read access to Customers, Subscriptions and Checkout Sessions, and write access to Customer portal, for `STRIPE_SECRET_KEY`. Turn on the Customer portal (Settings → Billing → Customer portal). Create one product, **Gainora Command Centre**, with two monthly prices: £299 (standard) and £199 (founding). Make a Payment Link for each, with the confirmation page set to redirect to `https://app.gainora.co.uk`. Put the product's ID in `STRIPE_AGENT_PRODUCTS` as `"all"` (see `.env.example`); both prices then unlock all three agents. The older single-agent products can stay in the list for anyone already on them.
7. **Test.** Buy Command Centre with a 100% coupon, check the welcome email, sign in, complete the questionnaire, and confirm the first Watcher check appears within a few minutes. On the Watcher's Reviews tab, find and confirm the business's Google listing.

### Already live on the first version?

Run `supabase/migrations/20261107_gainora_agents_v2.sql` in the SQL Editor (it only adds tables and columns), add `GOOGLE_API_KEY` in Netlify, and redeploy. Undo with `20261107_gainora_agents_v2_rollback.sql`, which removes only the new data.

### Schedules

| When (UTC) | Function | What it does |
| --- | --- | --- |
| 05:30 daily | `tenders-daily` → `tenders-background` | Fetches new open contracts from Contracts Finder and matches them to each Scout client. |
| 06:00 daily | `daily` → `daily-background` | Starts every Watcher run (site, reviews, competitors; speed test and prices weekly), sends weekly summaries on each client's report day, follow-up reminders, and the monthly results email on the 1st. |

## Running costs

- Netlify and Supabase: free tiers are enough for the first ~50 clients.
- Resend: free up to 3,000 emails a month.
- AI: logged per client in `ai_usage`. Each client is capped at `AI_MONTHLY_CAP_USD` (default $8), and the app stops AI work for that client until the 1st. Site checks are plain code; AI is used when a competitor page changes, for the weekly price comparison, for drafts the client asks for, and for the daily contract shortlist (at most 15 notices, on the fast model). A Scout search uses up to 8 web searches.
- Google: the Watcher makes one Place Details request per client per day (rating and reviews), and up to four Text Search requests per client per week (competitors' ratings). Google gives each Places API a monthly free allowance and then charges per request, so check current prices on Google's pricing page and keep the budget alert on. The PageSpeed Insights API has no charge.
- Contracts Finder: free, no key. The app fetches once a day for all clients and backs off when asked to.

## Develop

```
npm install
npm run build:demo   # demo with sample data in dist-demo/
npm run build        # production build in dist/
npm test             # 33 tests: page parsing and diffing, Brief maths, validation, Stripe signatures, Scout filtering and learning,
                     # results maths, speed-test parsing, contract parsing and matching, price checks, follow-up dates,
                     # review tracking, a real crawl against a local site, the webhook, and the lead pipeline end to end
npm run typecheck
```

## Safety rules built in

- Gainora never sends emails, posts, replies to reviews or contacts anyone for the client. It drafts introductions, follow-ups, review replies and win-back messages; the client sends them.
- Every first email and follow-up ends with an easy way to opt out, and the Scout stops at two follow-ups.
- Review replies never offer discounts, refunds or gifts in exchange for changing a review.
- The Watcher only reads public pages. It never submits forms. Prices in the comparison must appear on the page they came from, or they are dropped.
- Scout results must cite a page the search actually returned; personal emails, phone numbers and LinkedIn profiles are dropped, as are the client's own site, listed competitors and anything the client marked "Not relevant".
- The Brief may only use numbers the client entered; any AI text with an unsupported figure is replaced by the rule-based Brief.
- Results only show money from real figures: deal values the client entered, and contracts' published values (labelled as such).
- Everything the agents learned is shown to the client in plain words and can be removed.
- Each client's data is protected by row-level security; background functions need `INTERNAL_SECRET`.
