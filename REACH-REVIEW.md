# The Watcher's longer reach: what was built and what you need to do

Branch `watcher-reach` (worktree `/home/claude/gainora-agents-reach`), built from `main` at `532f50d`. Nothing has been pushed, merged or deployed. Both type-checks, all 60 tests (44 before, 16 new) and the demo build pass. Screenshots are in `/tmp/claude-0/-home-claude/33f7761b-12f0-5a26-b061-cf4a0d30e834/scratchpad/reach/` (`v2-desktop-competitors.png`, `v2-phone-competitors.png`, `v2-desktop-home.png`, `v2-phone-home.png`).

## What the Watcher now does

**It finds the competition itself.** From the client's location and what they say they do ("aesthetics clinic", "hair salon", "homeware and gift shop"; worked out from the one-line description, falling back to what they sell, then the industry) it asks Google Places for comparable businesses around the client's own Google listing (within 8 km bias, nothing beyond 25 km) and follows the closest five automatically, next to up to five the client named. Their own listing and website are always excluded. The search repeats monthly, so a new listing nearby produces a "New on Google near you" alert and a Today item. The owner can say **Not a competitor** on any found business (it never comes back unless they undo it), **Watch** any other business from the "Others nearby" list, and press **Find more nearby** (once a week at most). Named competitors are still edited under Your business; naming any is now optional in the questionnaire.

**For every competitor, typed or found:**
- **Google rating and review count over time.** Sampled weekly with the smallest field mask. "New reviews in the last 30 days" is shown next to the client's own figure ("15 new in 30 days (you: 3)") and a surge becomes an event, an alert and a Today item. It is always described as a sign of how busy they look, never as bookings.
- **Services and prices** read from their website (home page plus up to three pages likely to list prices) **and the public booking pages it links to** (Fresha, Treatwell, Booksy, Phorest, Timely, Setmore, Square, Vagaro, Ovatu, Mindbody and others; read-only, never logged in). The AI (fast model) lists services, prices and offers from the price-bearing lines, and then every item is checked: the service name must appear word for word on the page, the price must be one printed on that page, an offer must be quoted verbatim. Anything else is dropped (the same rule as the existing price table). Each line links to the page it came from with the date seen. The AI only runs when a page's text has actually changed.
- **Offers and promotions** ("20% off lip filler in November") from those pages, verbatim-checked and linked.
- **Instagram and Facebook links** found on their website, shown on the card; the owner can type or change an Instagram handle.
- **Instagram itself** when the switch is on (see below): followers and trend, posts in the last 30 days, recent posts, and offers/prices/new treatments pulled from captions, each quoted verbatim from the caption and linked to the post.

**It reports like an adviser.** The Competitors tab now opens with who is watched and why, then "What this means for you": up to three observations with one concrete action each (written by the AI from the facts, checked by the number guard and banned-phrase list, with a rule-based fallback), then "What changed" (website, booking pages, Google reviews, Instagram and the existing page-diff changes in one timeline, with Useful / Not relevant), the price table (now including found competitors and booking-page prices), one card per competitor, and the nearby list. The important changes also go into alerts, the Today list on Home, the Brief's weekly priorities, and Ask's context (source "The Watcher's competitor watch").

**Everything still works with nothing.** No website, no competitors typed, no Google listing, no Instagram: the check runs, reports what it can and says plainly what it can't ("No listing matched", "No website known, so no prices to read", "This account is personal or private, so its posts can't be read").

## Instagram: what is behind the switch

The plan changed mid-way to avoid App Review: **one** Instagram professional account belonging to Gainora, connected to Gainora's own Meta app, reads public professional accounts through the Business Discovery endpoint (`GET /{gainora-ig-user-id}?fields=business_discovery.username(handle){...}`, Graph API v26.0). Because the token belongs to someone with a role on the app, Standard Access applies and no review is needed. Nothing Instagram-related shows until `META_IG_USER_ID` and `META_ACCESS_TOKEN` are set in Netlify. `META-SETUP.md` is the step-by-step for you: create the Business app, add Instagram and Facebook Login for Business, connect Gainora's professional account (linked to a Facebook Page), generate a token in the Graph API Explorer with `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, exchange it for a long-lived token (or take the Page token, which doesn't expire), set the variables. With `META_APP_ID`/`META_APP_SECRET` set, the token is refreshed automatically every 20 days and kept in the service-only `job_state` table.

Limits: one read per account per day, `META_PER_CLIENT_CAP` accounts per client (default 10), `META_DAILY_CAP` calls a day across all clients (default 150; the count lives in `job_state`). Personal and private accounts error on Meta's side and are reported exactly as that, never guessed.

Not done this round, by design: clients connecting their own accounts for private insights (reach, DMs, comments) which needs Facebook Login for Business per client, App Review and business verification; and competitors' Facebook Pages, which need Page Public Content Access (review only). The link is shown.

## Cost

- **Google Places**, per client: 1 call once (own coordinates), 1 or 2 Text Searches a month (nearby), 1 Text Search once per named competitor to match it to a listing (monthly retry if it fails), and 1 Place Details (rating and count only) per watched competitor per week. Up to 9 watched means roughly 40 to 50 calls a month, all with minimal field masks; capped at `PLACES_MONTHLY_CAP` (default 60) and counted in `watcher_state.state.competitors.placesCalls`. The old weekly Text Search per named competitor in the reviews check is skipped in the daily run (the reach step owns ratings now), so the net change is small.
- **AI**: fast model only. One extraction call per competitor site (or own site) when its text changed, one captions call when there are new Instagram posts, one advice call when something changed (else weekly), plus the existing weekly price table which now reuses the pages already read instead of fetching again. All through `ai()`, so the per-client monthly cap and `ai_usage` log apply.
- **Instagram**: free; capped as above.

## Compatibility

No migration. Everything new lives in `watcher_state.state.competitors` (JSON) and the service-only `job_state` table that already exists. No API route, request or response shape changed; `/api/competitors` is new. `WatcherState` gained an optional `competitors` field; `BriefContext` an optional `competitor`; `checkReviews` an optional sixth argument; `checkCompetitors` and `buildPriceTable` optional extra arguments. Old states without `competitors` render exactly as before. Alerts, to-dos and value events use existing kinds (`competitor_change`), so no check constraints are touched.

## Commits

| Commit | What |
| --- | --- |
| `445e5f1` | Shared competitor logic, Google nearby search and coordinates, Instagram Business Discovery parsing, the server-side Meta token, the daily reach check, wiring into the Watcher run |
| `28ca59f` | Competitors tab, owner actions (`/api/competitors`), Today/Brief/Ask hooks, optional competitors in the questionnaire, demo data, 16 tests |
| (this commit) | Recent Instagram posts on the card, README, `.env.example`, `META-SETUP.md`, this file |

## What you must do

1. Review and merge `watcher-reach`; deploy. Nothing breaks if the Meta variables are missing.
2. Optionally set `PLACES_MONTHLY_CAP` in Netlify (default 60 per client per month) and keep the Google budget alert on.
3. For Instagram, follow `META-SETUP.md` (about 30 minutes) and add `META_IG_USER_ID` and `META_ACCESS_TOKEN` (plus `META_APP_ID`/`META_APP_SECRET` if you use a User token). Redeploy.
4. After the first daily run, open a client's Competitors tab and sanity-check the found businesses; "Not a competitor" is one tap.

## Decisions for you

1. **Five found competitors by default** (`MAX_FOUND`), nine watched in total (`MAX_TRACKED`). Both are constants in `shared/competitors.ts`.
2. **What counts as a review surge**: 5 or more new reviews in 30 days, at least twice the client's own, and rising week on week. Also in `shared/competitors.ts` (`diffCompetitor`).
3. **Search radius**: 8 km bias, 25 km hard limit. Rural clients may want more; urban ones less.
4. **Booking pages**: the list of platforms is `BOOKING_HOSTS`. Many are JavaScript apps; where the HTML has no prices the card honestly says "No prices published on the pages the Watcher could read".
5. **Graph API batching**: with one token and up to 150 calls a day, individual calls were simplest and well under Meta's limits. If clients grow past ~20, switch to the Graph batch endpoint (same fields) or raise the cap.

## Tests added (`tests/reach.test.ts`)

Search terms from the profile; distances and name matching; review velocity from sampled counts; booking-page detection (logins excluded); verbatim checks on services, prices, offers and captions (paraphrases and invented prices dropped); the watched-list merge (typed first, closest found fill five, dismissed never return, history carries over); change events (new service, price change, offer, review surge, Instagram post, follower jump; none on first sight); rule-based advice; recorded Business Discovery responses and error classification; a full faked day of the reach check with Google, two competitor sites, a Fresha page, the Graph API, Supabase and the AI all stubbed, then a second week spotting a price rise with no repeat fetch or extraction of unchanged pages; the same check with no keys and no website; the owner's actions through the handler; Today, Brief and questionnaire hooks. Two bugs were found by these tests and fixed before commit (yesterday's list was shared by reference so changes were never spotted; a freshly matched named competitor cost an extra Places call).
