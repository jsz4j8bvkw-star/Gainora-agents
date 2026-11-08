import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENOUGH_NEARBY, extractOutcode, extractPostcode, locationSourceLabel, MAX_NEARBY_KM, nextRadius, parsePlacesResult, parsePostcodeResult, RADII_KM, rectangleAround, townOf } from '../shared/geo';
import { classifyWebsiteUri, distanceKm, relevanceOf, searchPlan, withinRadius } from '../shared/competitors';

// Crewe town centre and places around it (real-world distances, for the radius tests).
const CREWE = { lat: 53.0979, lng: -2.4406 };
const NANTWICH = { lat: 53.067, lng: -2.522 };      // ~6.5 km
const SANDBACH = { lat: 53.146, lng: -2.364 };      // ~7.5 km
const STOKE = { lat: 53.0027, lng: -2.1794 };       // ~20 km
const CHESTER = { lat: 53.19, lng: -2.89 };         // ~32 km

test('nearby: postcodes, outcodes and towns are read from what the owner typed', () => {
  assert.equal(extractPostcode('Unit 3, Nantwich Road, Crewe CW2 6AF'), 'CW2 6AF');
  assert.equal(extractPostcode('cw26af'), 'CW2 6AF');
  assert.equal(extractPostcode('Crewe, Cheshire'), '');
  assert.equal(extractOutcode('Crewe CW1'), 'CW1');
  assert.equal(extractOutcode('Crewe, Cheshire'), '');
  assert.equal(townOf('Crewe, Cheshire'), 'Crewe');
  assert.equal(townOf('Crewe CW2 6AF, Cheshire'), 'Crewe');
  assert.equal(townOf('Falmouth'), 'Falmouth');
  assert.deepEqual(parsePostcodeResult({ status: 200, result: { postcode: 'CW2 6AF', latitude: 53.0916, longitude: -2.4452 } }), { lat: 53.0916, lng: -2.4452 });
  assert.equal(parsePostcodeResult({ status: 404, error: 'Postcode not found' }), null);
  const places = { status: 200, result: [
    { name_1: 'Crewe', local_type: 'Hamlet', county_unitary: 'Cheshire West and Chester', country: 'England', latitude: 53.17, longitude: -2.6 },
    { name_1: 'Crewe', local_type: 'Town', county_unitary: 'Cheshire East', country: 'England', latitude: 53.0979, longitude: -2.4406 },
    { name_1: 'Crewe Green', local_type: 'Village', county_unitary: 'Cheshire East', country: 'England', latitude: 53.09, longitude: -2.4 },
  ] };
  const hit = parsePlacesResult(places, 'Crewe');
  assert.equal(hit?.lat, 53.0979, 'the town beats the hamlet of the same name');
  assert.equal(hit?.county, 'Cheshire East');
  assert.equal(parsePlacesResult({ result: [{ name_1: 'Somewhere Else', latitude: 1, longitude: 1 }] }, 'Crewe'), null);
  assert.equal(locationSourceLabel('town'), 'the centre of your town');
});

test('nearby: the radius ladder starts tight, widens only when too few are found, and never passes 15 km', () => {
  assert.deepEqual(RADII_KM, [5, 10, 15]);
  assert.equal(MAX_NEARBY_KM, 15);
  assert.equal(nextRadius(null, 0), 5);
  assert.equal(nextRadius(5, ENOUGH_NEARBY), null, 'enough found: stop');
  assert.equal(nextRadius(5, 2), 10);
  assert.equal(nextRadius(10, 3), 15);
  assert.equal(nextRadius(15, 0), null, 'never beyond the last rung');
  const r = rectangleAround(CREWE, 5);
  assert.ok(Math.abs(distanceKm(CREWE, { lat: r.high.lat, lng: CREWE.lng }) - 5) < 0.1);
  assert.ok(Math.abs(distanceKm(CREWE, { lat: CREWE.lat, lng: r.high.lng }) - 5) < 0.1);
  // Real distances from Crewe: Nantwich and Sandbach are "nearby" at 10 km; Stoke and Chester never are.
  assert.ok(distanceKm(CREWE, NANTWICH) > 5 && distanceKm(CREWE, NANTWICH) < 10);
  assert.ok(distanceKm(CREWE, SANDBACH) > 5 && distanceKm(CREWE, SANDBACH) < 10);
  assert.ok(distanceKm(CREWE, STOKE) > MAX_NEARBY_KM);
  assert.ok(distanceKm(CREWE, CHESTER) > MAX_NEARBY_KM);
  const list = [{ name: 'a', distanceKm: 4.2 }, { name: 'b', distanceKm: null }, { name: 'c', distanceKm: 20.1 }, { name: 'd', distanceKm: 9.9 }];
  assert.deepEqual(withinRadius(list, 10).map((x) => x.name), ['a', 'd'], 'no distance means not nearby');
});

test('nearby: the search plan for a clinic lists the right Google types and phrases, and knows a barber is not a competitor', () => {
  const clinic = { business: { industry: 'Hair, beauty and wellbeing', oneLiner: 'Aesthetics clinic in Crewe offering anti-wrinkle injections, lip filler and skin boosters.' }, offer: { products: 'Botox, filler, Profhilo' } };
  const plan = searchPlan(clinic);
  assert.deepEqual(plan.terms, ['aesthetics clinic', 'lip filler and anti-wrinkle injections', 'skin clinic']);
  assert.deepEqual(plan.types, ['beauty_salon', 'skin_care_clinic', 'spa']);
  assert.equal(relevanceOf({ name: 'Glow Aesthetics Crewe', fromTerm: true }, plan), 2);
  assert.equal(relevanceOf({ name: 'Sarah’s Beauty Room', primaryType: 'beauty_salon' }, plan), 2);
  assert.equal(relevanceOf({ name: 'Skin Deep Clinic', primaryType: 'skin_care_clinic' }, plan), 2);
  assert.equal(relevanceOf({ name: 'Willow House', primaryType: 'spa' }, plan), 1, 'listed as a spa but the name says nothing: watch only if nothing better');
  assert.equal(relevanceOf({ name: 'Crewe Barbers', primaryType: 'barber_shop' }, plan), 0);
  assert.equal(relevanceOf({ name: 'Nails by Jo', primaryType: 'beauty_salon' }, plan), 0, 'a nail bar is not an aesthetics competitor');
  assert.equal(relevanceOf({ name: 'The Hair Lounge', primaryType: 'hair_salon' }, plan), 0);
  assert.equal(relevanceOf({ name: 'Hair & Skin Aesthetics', primaryType: 'beauty_salon' }, plan), 2, 'does aesthetics too: comparable');
  assert.equal(relevanceOf({ name: 'Crewe Tyres', primaryType: 'car_repair' }, plan), 0);
  const salon = searchPlan({ business: { industry: 'Hair, beauty and wellbeing', oneLiner: 'Hair salon and nail bar' }, offer: {} });
  assert.deepEqual(salon.types, ['nail_salon', 'hair_salon']);
  assert.deepEqual(searchPlan({ business: { industry: 'Trades and home services', oneLiner: 'We fix things' }, offer: {} }).types, []);
});

test('nearby: a listing’s “website” is often Instagram, Facebook or a booking page, and is sorted accordingly', () => {
  assert.deepEqual(classifyWebsiteUri('https://www.instagram.com/glow.aesthetics.crewe/'), { instagram: 'https://www.instagram.com/glow.aesthetics.crewe/' });
  assert.deepEqual(classifyWebsiteUri('http://facebook.com/GlowAestheticsCrewe'), { facebook: 'https://www.facebook.com/GlowAestheticsCrewe' });
  assert.deepEqual(classifyWebsiteUri('https://www.fresha.com/a/glow-aesthetics-crewe-123#services'), { booking: 'https://www.fresha.com/a/glow-aesthetics-crewe-123' });
  assert.deepEqual(classifyWebsiteUri('https://booksy.com/en-gb/12345_glow_aesthetics_crewe'), { booking: 'https://booksy.com/en-gb/12345_glow_aesthetics_crewe' });
  assert.deepEqual(classifyWebsiteUri('https://linktr.ee/glowaesthetics'), {});
  assert.deepEqual(classifyWebsiteUri('https://www.glowaesthetics.co.uk/'), { url: 'https://www.glowaesthetics.co.uk/' });
  assert.deepEqual(classifyWebsiteUri(''), {});
});

/* ---------- findNearby against a faked Google: a Crewe clinic ---------- */
const place = (id: string, name: string, at: { lat: number; lng: number }, extra: any = {}) => ({ id, displayName: { text: name }, formattedAddress: `${name} address`, rating: 4.8, userRatingCount: 40, location: { latitude: at.lat, longitude: at.lng }, ...extra });
const off = (p: { lat: number; lng: number }, km: number, bearingDeg = 90) => ({ lat: p.lat + (km / 111.32) * Math.cos((bearingDeg * Math.PI) / 180), lng: p.lng + (km / (111.32 * Math.cos((p.lat * Math.PI) / 180))) * Math.sin((bearingDeg * Math.PI) / 180) });

test('nearby: a Crewe clinic gets Crewe competitors, with distances, widening to Nantwich only because the town has few, and never Stoke or Chester', async () => {
  const real = globalThis.fetch;
  const calls: { kind: string; radius?: number; query?: string }[] = [];
  process.env.GOOGLE_API_KEY = 'g';
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url); const body = JSON.parse(init.body);
    if (u.includes('places:searchNearby')) {
      const radius = body.locationRestriction.circle.radius / 1000;
      calls.push({ kind: 'nearby', radius });
      assert.deepEqual(body.includedTypes, ['beauty_salon', 'skin_care_clinic', 'spa']);
      assert.equal(body.rankPreference, 'DISTANCE');
      const all = [
        place('self', 'Willow Skin Clinic', off(CREWE, 0.1), { websiteUri: 'https://willowskin.example', primaryType: 'skin_care_clinic' }),
        place('beauty1', 'Sarah’s Beauty Room', off(CREWE, 1.1), { primaryType: 'beauty_salon', websiteUri: 'https://www.instagram.com/sarahsbeautyroom/' }),
        place('barber', 'Crewe Barbers', off(CREWE, 0.6), { primaryType: 'barber_shop' }),
        place('nails', 'Nails by Jo', off(CREWE, 0.9), { primaryType: 'beauty_salon' }),
        place('spa1', 'Willow House', off(CREWE, 2.4), { primaryType: 'spa', websiteUri: 'https://www.fresha.com/a/willow-house-crewe-999' }),
        place('closed', 'Old Skin Clinic', off(CREWE, 1.5), { primaryType: 'skin_care_clinic', businessStatus: 'CLOSED_PERMANENTLY' }),
        place('nantwich', 'Nantwich Skin Clinic', NANTWICH, { primaryType: 'skin_care_clinic', websiteUri: 'https://nantwichskin.example' }),
        place('sandbach', 'Sandbach Aesthetics', SANDBACH, { primaryType: 'beauty_salon' }),
        place('stoke', 'Stoke Aesthetics', STOKE, { primaryType: 'skin_care_clinic' }),
      ];
      return new Response(JSON.stringify({ places: all.filter((p) => distanceKm(CREWE, { lat: p.location.latitude, lng: p.location.longitude }) <= radius) }), { status: 200 });
    }
    if (u.includes('places:searchText')) {
      const rect = body.locationRestriction.rectangle;
      calls.push({ kind: 'text', query: body.textQuery, radius: Math.round(distanceKm(CREWE, { lat: rect.high.latitude, lng: CREWE.lng })) });
      assert.equal(body.rankPreference, 'DISTANCE');
      if (/aesthetics clinic/.test(body.textQuery)) return new Response(JSON.stringify({ places: [place('glow', 'Glow Aesthetics Crewe', off(CREWE, 1.8), { websiteUri: 'https://glowaesthetics.example', primaryType: 'beauty_salon' }), place('chester', 'Chester Aesthetics', CHESTER, { primaryType: 'beauty_salon' })] }), { status: 200 });
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    }
    throw new Error('unexpected ' + u);
  }) as any;
  try {
    const { findNearby } = await import('../netlify/lib/reach');
    const budget = { n: 0, can() { return this.n < 60; }, spend(k = 1) { this.n += k; } };
    const plan = searchPlan({ business: { industry: 'Hair, beauty and wellbeing', oneLiner: 'Aesthetics clinic in Crewe: anti-wrinkle injections, lip filler, skin boosters.' }, offer: {} });
    const r = await findNearby(CREWE, plan, budget, (p) => p.id === 'self' || /willowskin/.test(p.website || ''));
    const names = r.found.map((f) => `${f.name} ${f.distanceKm}km`);
    // Rung 1 (5 km): Glow, Sarah's and Willow House = 3 comparable, so widen to 10 km, where Nantwich and Sandbach make 5: stop at 10, never 15.
    assert.equal(r.radiusKm, 10, names.join(' | '));
    assert.deepEqual(r.found.map((f) => f.name), ['Sarah’s Beauty Room', 'Glow Aesthetics Crewe', 'Nantwich Skin Clinic', 'Sandbach Aesthetics', 'Willow House'], 'comparable ones first, then closest; the spa with a vague name last');
    assert.ok(r.found.every((f) => f.distanceKm != null && f.distanceKm <= 10), names.join(' | '));
    assert.ok(!r.found.some((f) => /Stoke|Chester|Barber|Nails|Old Skin|Willow Skin/.test(f.name)), 'far, closed, own and other-trade listings are out');
    const sarah = r.found.find((f) => f.name.startsWith('Sarah'))!;
    assert.equal(sarah.url, undefined, 'Instagram is not a website');
    assert.equal(sarah.instagram, 'https://www.instagram.com/sarahsbeautyroom/');
    assert.deepEqual(r.found.find((f) => f.name === 'Willow House')!.booking, ['https://www.fresha.com/a/willow-house-crewe-999']);
    assert.equal(r.found[0].relevance, 2);
    assert.equal(budget.n, 6, 'rung 1: one nearby + three phrases; rung 2: one nearby + one phrase');
    assert.deepEqual(calls.map((c) => `${c.kind}@${c.radius}`), ['nearby@5', 'text@5', 'text@5', 'text@5', 'nearby@10', 'text@10']);
  } finally { globalThis.fetch = real; delete process.env.GOOGLE_API_KEY; }
});
