# Overnight review of Gainora Command Centre

Branch `fable-review` (worktree `/home/claude/gainora-agents-fable`), built from `main` at `0d71961`. Nothing has been pushed, merged or deployed. Type-checks, all 40 tests and the demo build pass. Screenshots before and after are in `/tmp/claude-0/-home-claude/33f7761b-12f0-5a26-b061-cf4a0d30e834/scratchpad/fable-cc/`.

## What I found, in order of how much it hurt

1. **Home never answered "what do I do first?"** The same finding (Mark D.'s review) appeared three times, in the agents' note, the to-do list and the alerts. The to-do list had no order, and ticking an item was all you could do with it: to act on "Reply to Mark D.'s 2-star review" you had to go to The Watcher, find the Reviews tab, find the review and press Draft. On a phone that was four taps and a scroll. For £299 a month the first screen should tell the owner the three things that matter most today and take them there in one tap.
2. **The Brief's priorities were generic.** "Block one hour this week for the task you've been putting off" and "Reply to every open enquiry" could be written for any business. The Brief knew nothing about the leads the Scout had found, the contract closing in three weeks, or the broken contact page, and it never said where the 90-day goal stood. It also mixed two comparisons in one breath ("rose from 28 to 42, 44.8% above your four-week average") while the Trends tiles showed a different percentage (+50%, which is week on week).
3. **Ask answers didn't say where they came from.** An owner can't tell whether "You're on 4.6 stars" is today's figure or last month's, or which agent found it.
4. **Drafts and explanations could be sharper.** Review replies didn't use the business's style, products or edge; Scout reasons weren't required to cite what on the page proved the fit; competitor changes said "why it matters" but not "what to do about it".
5. **Rough edges.** The win-back panel showed a large empty half before any drafts existed; alerts carried links that were never shown; modal footers clipped on phones; the tab row cut off with no hint that it scrolls; the last Ask answer hid behind the input box on phones; the goal tracker on Home counted *saved research results* in the live app but *leads* in the demo; "small businesses" appeared in the package description, prompts and a contract tag.

The onboarding, sign-in, Results page and the Watcher's Overview/Speed tabs are good and I left them alone.

## What I changed

| Commit | What | Why |
| --- | --- | --- |
| `9ac1fcb` | **"Do these today"** on Home: one list built from everything the agents found, ranked by what is most likely to cost or earn money (site down, contact page, lapsing certificate, new 1–3 star review, follow-up due, contract closing, leads waiting, revenue dip, missing numbers). Each item says why, with the real figure where there is one (a contract's published value, days left, the review quote), and its button opens the right tab and, where there is one, the draft itself. To-dos and alerts now link through too. "Done" hides an item on that device for a fortnight. Goal progress now counts stockists won plus "N more in conversation". | Problem 1. Pure, shared logic in `shared/today.ts` with tests, so demo and live agree. |
| `7b2c8a5` | **The Brief knows what the other agents found.** Its three priorities name the real lead to chase, the shops to introduce yourself to, the contract (with published value and days left), the urgent site issue and the low review, ordered by the owner's goal. A goal line reports where the target stands ("1 stockist won and 2 in conversation, 13 weeks left"). The AI Brief receives the same findings, those figures are added to the allowed set so the number guard still holds, and it is told every priority must name a real item. Week-on-week and four-week average now sit in one bracket; the average is left out until it differs from last week. Win-back panel layout fixed; opens from Home. | Problem 2. |
| `f285543` | **Ask cites its sources.** Each context block has a key; the model ends with a `SOURCES:` line which is stripped and stored (existing `sources` column) as links to the page where the finding lives, with the check date ("The Watcher's Google reviews (8 Nov)"). The prompt also asks it to name the agent and end with one next step. | Problem 3. |
| `89d5a14` | **Sharper prompts.** Review replies in the owner's voice (preferred style, products, edge), naming what the reviewer praised or complained about, length scaled to the rating, no invented contact details, no promised outcomes. Scout reasons must point to the evidence on the page and skip national chains unless asked. Competitor changes end with "Worth considering: …". Win-back messages lead with the best seller or edge. "Small business" wording removed. | Problem 4. |
| `a77c865` | **Polish.** Modal footers wrap on phones; scrolling tabs fade at the edge; slow actions say what they're doing ("Writing a reply to Mark…"); the last Ask answer sits above the input; "Add to leads" inside the introduction draft so a result becomes a tracked lead in one step. | Problem 5. |
| `967b88f`, `bdd215e` | Demo sample data made consistent (a won lead no longer reappears as a new result); Ask button hidden on phones where Ask is in the tab bar; shorter button label in the reply modal; README test count. | |

AI cost: no new API calls. The Brief and Ask prompts carry a few hundred extra input tokens on the fast model; everything still goes through the existing cost log and monthly cap.

Compatibility: no API routes, request or response shapes, or stored data shapes changed. `HomeData` gained an optional `today` field and `goalProgress` an optional `detail`; both are computed in the browser from existing tables. Home now makes three extra parallel PostgREST reads (leads, tender matches, competitor changes), all protected by RLS.

## Decisions for you

1. **Goal tracker wording.** The live app used to show "N leads in progress" (counting saved research results). It now shows "N of 6 stockists won" with "N more in conversation" underneath. More honest, but a client at 0 won sees "0 of 6". If you'd rather lead with the softer number, it is one line in `src/lib/live.ts` and `src/lib/demo.ts`.
2. **Weights in `shared/today.ts`.** I set the order (site down > contact page > certificate under 10 days > 1–2 star review > follow-up due > strong-fit contract closing within a fortnight > lead waiting > revenue dip > …) from what usually costs a business most. They are plain numbers at the top of each item; adjust them if your clients' reality differs.
3. **Brief priorities vs Home.** On a day when the agents have found a lot, the Brief's weekly priorities and Home's daily list will overlap. I kept the Brief weekly and goal-led (introductions and follow-ups before a review reply), and Home daily and urgency-led. Tell me if you'd prefer them to never repeat each other.
4. **"Done" on Today items is per device** (browser storage), because there is no table for it and I didn't want a schema change for a convenience. If clients use two devices and find it odd, a tiny `dismissals` table would fix it.

## Database migrations and environment variables

None. No migration files added, no new variables, no edits to old migrations.

## Ideas I didn't do, ranked by value

1. **A Today email.** The daily background function already runs every morning; sending the same three ranked items by email on the client's chosen day (using `planToday` server-side) would make the value visible without opening the app. Needs the server to assemble a `WatcherState`/leads/tenders snapshot the way `live.ts` does; about an hour.
2. **Fit score with reason on Scout leads** (e.g. 4/5, "stocks independents, lists a buyer email, 30 miles away"). The stored shape would gain optional `score` and `scoreWhy`; the prompt change is small. I improved the reasons instead, because the two-tier Strong/Possible is already honest and a score invites false precision.
3. **Week-on-week in the Brief against the same week last year** once clients have a year of numbers; `week_numbers` already holds 26 weeks.
4. **Review reply tone learning.** Store the replies the owner actually posts (they paste them into Google, so we'd need them to paste back) and feed one or two as examples. Not possible without a new input, so left as an idea.
5. **A "what changed since you last looked" strip** at the top of each agent page, using `alerts.read`.
6. **Tests for the Netlify handlers** (`chat.ts`, `brief-run.ts`) with a stubbed `db`; the pure logic is well covered but the glue isn't.
