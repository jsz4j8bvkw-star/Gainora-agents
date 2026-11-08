# Before you publish: owner checklist

These are the things I couldn't, and shouldn't, decide or invent for you.

## Business details (site.config.json)
- [ ] Final company name (`brand.name`). Currently "Gainora".
- [ ] Legal name, address and company number, if you have them. Leave them empty if you don't. Never guess them.
- [ ] Contact email on your own domain.
- [ ] Your real reply time (`contact.responseTime`).
- [ ] Live site address (`site.url`), once you have a domain.
- [ ] Optional: call-booking link.
- [ ] Optional: founder name and a short honest bio for the About page.

## Prices
- [ ] Confirm the public starting prices: diagnosis £495, website £1,500, automation £950, ongoing support £750/month.
- [ ] Decide what a £495 diagnosis includes in practice (one business area, report format, walkthrough call), so your proposals match the site.
- [ ] Decide whether prices include VAT, and state it in the terms.

## Legal pages (drafts, marked on the site)
- [ ] Privacy policy: fill in the bracketed details, list your real providers (host, email, any AI tools used for client work), describe international transfers and set retention periods.
- [ ] Terms: payment, cancellation and refund terms, report usage rights, and liability wording. Have these reviewed by a solicitor.
- [ ] Cookies page: keep it accurate if you ever add analytics.
- [ ] Remove the "Draft for review" notices only once the pages are complete and checked.
- [ ] Consider registering with the ICO, which is required for most businesses processing personal data (check ico.org.uk).

## Forms
- [ ] Choose Netlify Forms or Formspree and connect it (see README).
- [ ] Add email notifications.
- [ ] Send a test from both forms (enquiry and shop sign-up) and confirm the emails arrive.

## Shop (course, agents, digital products)
- [ ] Confirm prices and features for each item in `site.config.json` → `shop.items`.
- [ ] Right now every item has a free sign-up button (pilot, early access or waitlist), so nothing takes payment yet.
- [ ] When an item is ready: create a Stripe Payment Link, set up delivery (download, course access or agent account), paste the link into `checkoutUrl`, set `status` to `available` and rebuild.
- [ ] To take money before something exists, use `preorder` with a real `deliveryNote`, and be ready to refund if you miss it.
- [ ] Add digital-content and subscription terms (cancellation rights, renewals) to the terms page before the first sale.
- [ ] When the course pilot has a date and content, update `src/pages/ai-training.html`.

## After launch
- [ ] Add real testimonials or case studies only with written client permission, and only once they exist.
- [ ] Submit `sitemap.xml` in Google Search Console after `site.url` is set.
