# Before you publish: owner checklist

These are the things only you can decide or supply. The site builds and passes its checks without them, with safe defaults.

## Business details (site.config.json)
- [ ] Legal name, address and company number, if you have them. Leave them empty if you don't. Never guess them.
- [ ] Contact email is `hello@gainora.co.uk`: confirm it's live and monitored.
- [ ] Reply time is "within one working day": keep it only if you can keep it.
- [x] Booking link: Google Calendar appointment schedule, with 45-minute slots behind the 15-minute diagnostic. Add a line to the appointment description in Google Calendar saying the call is 15 minutes with extra time kept free, since the booking page shows the slot length.
- [ ] Optional: founder name and a short honest bio for the About page (`founder.*`).

## Prices (site.config.json → prices)
- [x] All prices match the Offer Brief of 8 November 2026 and are ex-VAT. Change them in one place if the brief changes.
- [ ] Decide whether to show the founding offers on the site (`founding.show`). Default: off, mentioned on calls.

## Demo receptionist
- [x] Demo number live (13 Nov 2026): `demo.phone` 07414 111875, `demo.phoneHref` +447414111875. The "Ring our receptionist" block shows on the home page.
- [ ] Record a good 90-second call and set `demo.recordingUrl` to show it under the number.

## Legal pages (drafts, marked on the site)
- [ ] Privacy policy: fill in the bracketed details, list the real providers (telephony and receptionist platform, text-message provider, email provider, AI tools), describe international transfers and set retention periods, including for call recordings.
- [ ] Terms: payment stages for Partner fix projects, service levels for the receptionist, liability wording. Have these reviewed by a solicitor.
- [ ] Data processing agreement for Capture & Convert clients (referred to in the terms).
- [ ] Remove the "Draft for review" notices only once the pages are complete and checked.
- [ ] ICO registration, if not already done (ico.org.uk).

## Forms
- [ ] Deploy to Netlify, then add an email notification for the `diagnostic` form (Site configuration → Forms → Form notifications).
- [ ] Send a test booking from the live site and confirm the email and the calendar invitation both arrive.
- [ ] Later: add the Capture & Convert enquiry link as an outgoing webhook in the same screen, so enquiries land in the inbox too.

## Calculator
- [x] Every research figure has an opened, published source, listed on the calculator page.
- [ ] Two figures have no credible published UK source and are shown as estimates: enquiry-to-customer conversion by industry, and callers who go to a competitor after an unanswered call. If you find good sources, add them to `calculator.json`.
- [ ] Review the "assumption" defaults (phone share 60%, conversion 33%, 300 visits a month, £40 an hour) and change any you'd put differently.

## Going live
- [ ] Review the private preview page by page.
- [ ] Deploy (GitHub + Netlify, or drag `dist/` onto Netlify Drop).
- [ ] Check the redirects from the old addresses work on the live site.
- [ ] Submit `sitemap.xml` in Google Search Console.

## After launch
- [ ] Case studies, starting with your own businesses labelled as such, then client pilots with real numbers and written permission. There's no testimonial section yet, on purpose.
