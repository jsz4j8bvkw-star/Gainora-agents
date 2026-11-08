# Overnight review: Capture & Convert

Branch `fable-review`, worktree `/home/claude/gainora-capture-fable`. Nothing pushed, nothing deployed, no live
service touched. Type-check, 36 tests, demo build and the Retell export all pass. Before/after screenshots are in
`/tmp/claude-0/-home-claude/33f7761b-12f0-5a26-b061-cf4a0d30e834/scratchpad/fable-capture/` (`before-*.png`,
`after-*.png`, desktop and phone).

## The top problems I found (ranked)

1. **The app didn't tell a clinic owner what to do next.** Today showed "2 enquiries are waiting" without saying
   which, the inbox was in date order, and a client's unanswered text ("Is it OK to wear make-up?") was buried
   in a "Messages for you" list with no action. Sophie Reed's emergency and a sales call sat at the same level.
2. **Follow-ups was empty and spoke trade.** For a salon that is paid on the day, there are no quotes and no
   invoices, so the page said "Nothing to follow up" and talked about jobs. The real follow-up for a clinic is
   clients who are due back, and enquiries that asked a price and went quiet.
3. **No money anywhere for a clinic.** "Attended this month £180" after a week. The treatment list already had
   prices, but nothing used them; out-of-hours calls had no value attached, which is the whole sales story.
4. **"Write it for me" wrote the same text for everyone**: "thanks for getting in touch… I'll call you back today",
   even to a client who was already booked and asking a question. The server prompt said "UK trade business" for
   every client.
5. **The receptionist's own analysis was thrown away.** Retell reports call type, whether it booked, the
   appointment type, preferred times, new or returning. Only the summary and name were used, so a call she booked
   still landed in "Needs a reply", and a sales call she turned down landed as "New".
6. **One rebook timing for every treatment** (6 weeks). Gel nails need 3, anti-wrinkle 12.
7. **No-shows weren't recorded**, so reminders and deposits couldn't be judged.
8. **The report was numbers without a verdict**, with trade tiles ("Quotes sent 0", "From enquiry to job").
9. **A payment reminder could go to a client who paid at the till**: marking "Attended" with a fee for a
   paid-on-the-day clinic set a due date of today, and the "payment due" text would follow at 10am.
10. **The script offered to "check the diary" even when no diary was connected**, which Retell's to-do list
    asked you to remember to switch off by hand.
11. Smaller: spam missed "Instagram marketing"; README still said Trillet and UK trades; "11:00" vs "11am";
    "customer" wording for clinics; duplicate "Booked" tags.

## What I changed, and why

| Commit | What |
|---|---|
| `85d4938` | **Shared logic** (`shared/insight.ts`, new): priority order for the inbox, a suggested next step per enquiry, a reply drafted from what the client actually said, clients due to rebook by treatment interval, and plain-words advice for the report. `shared/capture.ts`: per-treatment "due back" interval, prices parsed from the owner's list ("from £180" counts as a minimum and is shown as "at least"), Retell's post-call analysis read into the enquiry, broader spam detection, no-shows recorded in the history, report additions, and the script never offers a diary it can't see. Tests. |
| `1a45aa9` | **Server**: a booking the receptionist made on the call (with a sane time) lands as "booked" and the confirmation text goes out; triage uses her call type; the drafted reply starts from the rule-based draft that reads the client's last text and your arrival notes and prices, and AI only polishes it with clinic-specific limits (health concerns never go to the model); `update` accepts a reason for "didn't go ahead"; Retell agent gains `booked_for` and `booked_with` analysis fields. End-to-end test. |
| `e726a1e` | **Today**: one priority-ordered "Needs you now" list with why, next step and one-tap actions; stats show what out-of-hours calls were worth by the owner's prices; "Due back" card for clinics; phone layout tightened. Demo data: intervals, a no-show, clients due back, call types. |
| `3b1e67f` | **Inbox and enquiry page**: "Needs a reply" ordered by priority with the reason and next step on each row; the Next step panel reads the situation and offers the one action; "Reply" from Today arrives with the draft written and focused; "Attended" can record "Paid on the day" (fixes problem 9); "Didn't turn up or cancelled" records why; list price shown and offered as the default fee; spam can be undone. |
| `1eb4cda` | **Follow-ups for clinics** (Due back, Went quiet) and a **Report** with clinic wording, value by the owner's prices, no-shows, and "What to change next month" built only from the month's own numbers. |
| `9132e33` | Setup/Settings: "due back" interval per treatment; Receptionist page explains the diary rule; morning and monthly emails in the clinic's words, with due-back clients and the "what to change" points. |
| `57f8459` | README rewritten to match the code; script notes the occasion a client is booking for. |

Every safety rule is intact and tested: honest about being an AI, never a person, no card details, no medical or
aftercare advice, beauty concerns to the clinic line only (never 999/A&E/111/GP/pharmacy, and the "if the caller
asks about 999" rule), 999 rules kept for physio and trades, quiet hours, STOP, weekly cap, "ask me first",
opt-outs, marketing opt-out lines on review and rebook texts. The existing tests for these were not touched;
new tests were added around them.

## Decisions for you

1. **Bookings made on the call now land as bookings and the confirmation text goes out automatically** (if that
   automation is on, which it is by default). I only accept a time when Retell marks the call as booked *and* gives
   a time between one hour and a year ahead. If you'd rather see each one first until you trust it, set the
   "Booking confirmation" step to "Ask me first" for new clients, or tell me and I'll make that the default for
   the first 30 days of a client.
2. **The script falls back to "take details, I call back" until the diary is marked connected** (also for paper
   diaries), whatever booking mode the owner chose. This removes a step from your Retell to-do list, but it means
   you must mark the diary connected in the app (Receptionist → Connect) when you've done it, or she won't book.
3. **"Paid on the day" is ticked by default** when a clinic's payment terms are "paid on the day" and the owner
   marks an appointment attended. Untick it and the payment reminders run as before.
4. **Rebook invitations are treated as marketing** (opt-out line, STOP honoured, weekly cap). I kept that. If a
   client's own lawyer says otherwise, the line is one constant in `shared/automations.ts`.
5. **Wrong numbers are filed under Spam** along with sales calls (the receptionist reports both). The tab now
   says so and anything can be moved back. Rename the tab to "Not enquiries" if you prefer.
6. **"At least" values.** Where a treatment is listed as "from £180", totals say "at least". If you'd rather not
   count "from" prices at all, it's one line in `enquiryValue`.

## Database and environment

- **No migration needed.** Treatment intervals live in the existing `capture_settings.data` JSON; no-shows are a
  history line on the enquiry; everything else reuses existing columns. No new environment variables.
- The Retell agent needs the two new analysis fields (`booked_for`, `booked_with`) added in the dashboard, or
  re-create the LLM/agent from `retell/beauty-demo/*`. Without them, nothing breaks: calls land as "new" as before.

## Not done, ranked by value

1. **Patch-test tracking**: when the receptionist books a patch test, flag the treatment as "patch test due
   48 hours before" and remind. Needs a `patch_test` call type or a treatment flagged as a patch test in the list.
2. **Deposits**: a "deposit for new clients" setting that the script mentions when booking and the confirmation
   text repeats, with a payment link. The clinic's own payment link already exists in settings.
3. **Quiet days to fill**: a "Fill Thursday" draft to the due-back list when the diary has gaps. Needs the diary
   connection (not built) or the owner picking the day by hand.
4. **Returning-client recognition in the inbox**: match by phone across enquiries and show "4th visit, last
   HydraFacial 6 weeks ago" on the enquiry page. The data is there; it's a day's UI work.
5. **Reply time measured per owner, not per receptionist**: a booking made on the call counts as a 0-minute
   reply, which flatters the median. Splitting "answered by the receptionist" from "replied by you" is a small
   report change.
6. **Weekly owner text**: "This week: 9 enquiries, 6 while closed, £335 booked" to the owner's mobile on a Monday.
7. **Export the clinic's client list** (name, phone, last treatment, due back) as CSV for their own marketing.
8. **Retell export is slightly non-deterministic**: the opening line in the prompt uses the current time of
   day, so `prompt.txt` changes between morning and afternoon runs. Harmless, but noisy in git.
