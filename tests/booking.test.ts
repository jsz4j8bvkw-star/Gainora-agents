import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asText, BOOKING_SYSTEMS, looksJsRendered, parseFresha, parseJsonLd, parsePriceList, platformOf, readBookingPage } from '../shared/booking';
import { FRESHA_PAGE } from './fixtures';

const at = new Date('2026-11-08T06:00:00Z');

test('booking: a Fresha venue page gives every service with its exact price, duration and the team size, and knows when the list is partial', () => {
  const r = parseFresha(FRESHA_PAGE, 'https://www.fresha.com/a/skin-studio-crewe-555', at);
  assert.ok(r);
  assert.deepEqual(r!.services.map((s) => `${s.name} | ${s.price} | ${s.duration}`), [
    'Lip Filler 1ml | £220 | 45 mins',
    'Anti-Wrinkle Injections – 1 area | £150 | 30 mins',
    'Anti-Wrinkle Injections – 2 areas | £200 | 30 mins',
    'Anti-Wrinkle Injections – 3 areas | £240 | 30 mins',
    'Profhilo (2 sessions) | £350 | 30 mins',
    'Dermaplaning | £45 | 45 mins',
  ], 'free consultations skipped; variants become their own lines; a single same-name variant does not double up');
  assert.equal(r!.venue.platform, 'Fresha');
  assert.equal(r!.venue.team, 3);
  assert.equal(r!.venue.rating, 4.9);
  assert.equal(r!.venue.reviews, 212);
  assert.equal(r!.venue.serviceCount, 31);
  assert.equal(r!.venue.partial, true, '31 treatments exist, 5 items were on the page');
  assert.equal(r!.venue.priceRange, '£20 - £450');
  assert.equal(r!.venue.address, '12 Market Street, Crewe, CW1 2EG');
  assert.equal(parseFresha('<html><body>no data</body></html>', 'https://www.fresha.com/a/x', at), null);
  const un = parseFresha(FRESHA_PAGE.replace(/"services":\[[\s\S]*?\]\s*\}\s*\}\s*\}\s*\}/, '"services":[]}}}}'), 'https://www.fresha.com/lvp/some-unclaimed-salon', at);
  assert.equal(un?.venue.unclaimed, true);
  const read = readBookingPage(FRESHA_PAGE, 'https://www.fresha.com/a/skin-studio-crewe-555', at);
  assert.equal(read.platform, 'Fresha');
  assert.equal(read.services.length, 6);
  assert.match(read.text, /Lip Filler 1ml \(45 mins\) £220/);
  assert.equal(asText(read.services).split('\n').length, 6);
});

test('booking: schema.org offers and ratings are read from any page that publishes them', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"BeautySalon","name":"Glow Aesthetics","telephone":"01270 111111","priceRange":"££","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"96"},"employee":[{"@type":"Person","name":"A"},{"@type":"Person","name":"B"}],"hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[{"@type":"OfferCatalog","name":"Face","itemListElement":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"Lip filler 0.5ml"},"price":"160","priceCurrency":"GBP"},{"@type":"Offer","itemOffered":{"@type":"Service","name":"Skin booster"},"priceSpecification":{"@type":"PriceSpecification","minPrice":"180","priceCurrency":"GBP"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"US only"},"price":"100","priceCurrency":"USD"}]}]}}</script></head><body><p>Welcome</p></body></html>`;
  const r = parseJsonLd(html, 'https://glow.example/', at);
  assert.deepEqual(r.services.map((s) => `${s.name} ${s.price}`), ['Lip filler 0.5ml £160', 'Skin booster from £180']);
  assert.equal(r.venue?.platform, 'schema.org');
  assert.equal(r.venue?.rating, 4.8);
  assert.equal(r.venue?.reviews, 96);
  assert.equal(r.venue?.team, 2);
  assert.equal(r.venue?.serviceCount, 2);
  const read = readBookingPage(html, 'https://glow.example/', at);
  assert.equal(read.services.length, 2);
  assert.equal(read.jsRendered, false);
});

test('booking: JavaScript-only booking pages are detected rather than read as “no prices”', () => {
  const shell = `<!doctype html><html><head><title>Online Booking</title></head><body><div id="root"></div><script src="/static/js/main.9f1.js"></script></body></html>`;
  assert.equal(looksJsRendered(shell, 'https://phorest.me/salon/some-clinic'), true);
  assert.equal(looksJsRendered(shell, 'https://some-clinic.pabau.com/'), true);
  assert.equal(looksJsRendered(shell, 'https://example.com/book'), true, 'an empty shell with scripts and no prices');
  assert.equal(looksJsRendered('<html><body><h1>Prices</h1><p>Lip filler £220</p></body></html>', 'https://example.com/prices'), false);
  const read = readBookingPage(shell, 'https://phorest.me/salon/some-clinic', at);
  assert.equal(read.jsRendered, true);
  assert.equal(read.platform, 'Phorest');
  assert.equal(read.services.length, 0);
  assert.equal(platformOf('https://widget.treatwell.co.uk/place/x/'), 'Treatwell');
  assert.equal(platformOf('https://booksy.com/en-gb/123_x'), 'Booksy');
  assert.equal(BOOKING_SYSTEMS.find((b) => b.id === 'Phorest')?.readable, 'no');
  assert.equal(BOOKING_SYSTEMS.find((b) => b.id === 'Fresha')?.readable, 'yes');
});

test('booking: the owner’s pasted price list is turned into rows, however they wrote it', () => {
  const rows = parsePriceList(`Lip filler 1ml £220
Anti-wrinkle – 1 area: £150
Anti-wrinkle 2 areas .... £200
Anti-wrinkle (3 areas) from £240
Profhilo 2 sessions £350 (30 mins)
Dermaplaning 45 mins £45
Consultation FREE
Skin boosters from £180
Microneedling £120; LED facial £40
Deposit £20 required
Hydrafacial £95,
`);
  assert.deepEqual(rows.map((r) => `${r.name} | ${r.price}${r.duration ? ` | ${r.duration}` : ''}`), [
    'Lip filler 1ml | £220',
    'Anti-wrinkle – 1 area | £150',
    'Anti-wrinkle 2 areas | £200',
    'Anti-wrinkle (3 areas) | from £240',
    'Profhilo 2 sessions | £350 | 30 mins',
    'Dermaplaning | £45 | 45 mins',
    'Skin boosters | from £180',
    'Microneedling | £120',
    'LED facial | £40',
    'Deposit required | £20',
    'Hydrafacial | £95',
  ]);
  assert.deepEqual(parsePriceList(''), []);
  assert.deepEqual(parsePriceList('Just words, no prices'), []);
});
