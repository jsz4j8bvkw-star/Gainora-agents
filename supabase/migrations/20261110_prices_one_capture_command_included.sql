-- 10 November 2026: one Capture & Convert price (£399 a month, £595 setup, 600 minutes), Launch & Grow £599,
-- both together £849, and Command Centre included in every package instead of sold on its own.
-- The old single packages are switched off, not deleted, so clients already paying for them are still recognised.
-- Each package keeps its Stripe product. After running this, open Gainora admin → Prices and press
-- "Save and update the website": that updates the Stripe products and rebuilds gainora.co.uk.
insert into public.price_book (key, name, description, setup, monthly, one_off, minimum_months, included, grants, active, sort)
values
  ('command-centre', 'Command Centre (on its own)', 'No longer sold on its own: included in every package. Kept for anyone already paying for it.', 0, 299, 0, 0, '', array['watcher', 'scout', 'brief']::text[], false, 10),
  ('capture-never', 'Capture & Convert: Never Miss a Call (old tier)', 'Replaced by the single Capture & Convert price.', 595, 249, 0, 3, '300', array['capture']::text[], false, 20),
  ('capture-booking', 'Capture & Convert', 'Receptionist, inbox, follow-ups and booking into the diary. Includes Command Centre. Bigger needs are priced on the call.', 595, 399, 0, 3, '600', array['capture', 'watcher', 'scout', 'brief']::text[], true, 21),
  ('capture-desk', 'Capture & Convert: Full Front Desk (old tier)', 'Replaced by the single Capture & Convert price; bigger needs are priced on the call.', 1995, 599, 0, 3, '1,200', array['capture']::text[], false, 22),
  ('capture-founding', 'Capture & Convert, founding offer', 'First 3 clients, fixed for 12 months, in return for a named case study. Includes Command Centre.', 495, 299, 0, 12, '600', array['capture', 'watcher', 'scout', 'brief']::text[], true, 23),
  ('extra-minutes', 'Extra call time, 100 minutes', 'For receptionist calls beyond the minutes included.', 0, 0, 25, 0, '100', array[]::text[], true, 24),
  ('launch-grow', 'Launch & Grow', 'Website, Google profile, listings, reviews and one ad channel, looked after monthly. Includes Command Centre.', 1995, 599, 0, 3, '', array['watcher', 'scout', 'brief', 'website']::text[], true, 30),
  ('launch-grow-founding', 'Launch & Grow, founding offer', 'First 2 to 3 clients, in return for a named case study. Includes Command Centre.', 1495, 599, 0, 3, '', array['watcher', 'scout', 'brief', 'website']::text[], true, 31),
  ('launch-capture-bundle', 'Launch & Grow with Capture & Convert', 'Both packages together, with one Command Centre.', 2295, 849, 0, 3, '600', array['watcher', 'scout', 'brief', 'website', 'capture']::text[], true, 32),
  ('partner-focused', 'Growth & Operations Partner: Focused', 'One area, about 4 weeks, then monthly. Includes Command Centre.', 4950, 950, 0, 3, '', array['watcher', 'scout', 'brief']::text[], true, 40),
  ('partner-core', 'Growth & Operations Partner: Core', 'Two or three areas, about 8 weeks, then monthly. Includes Command Centre.', 7500, 950, 0, 3, '', array['watcher', 'scout', 'brief']::text[], true, 41),
  ('partner-whole', 'Growth & Operations Partner: Whole business', 'About 12 weeks, then monthly. Includes Command Centre.', 12500, 950, 0, 3, '', array['watcher', 'scout', 'brief']::text[], true, 42),
  ('business-audit', 'Business Audit', 'Credited back if they start a package within 30 days.', 0, 0, 495, 0, '', array[]::text[], true, 50)
on conflict (key) do update set name = excluded.name, description = excluded.description, setup = excluded.setup, monthly = excluded.monthly,
  one_off = excluded.one_off, minimum_months = excluded.minimum_months, included = excluded.included, grants = excluded.grants,
  active = excluded.active, sort = excluded.sort, updated_at = now();

select key, name, setup, monthly, active, array_to_string(grants, ',') as switches_on from public.price_book order by sort;
