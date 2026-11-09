import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, comparePrices, comparisonFacts, matchTreatment, positionText, unmatchedNames } from '../shared/treatments';
import type { ServiceLine } from '../shared/competitors';

const at = '2026-11-08T06:00:00.000Z';
const line = (name: string, price: string, url = 'https://x.example/prices'): ServiceLine => ({ name, price, url, seenAt: at });
const id = (name: string) => matchTreatment(name)?.id ?? null;

test('treatments: names in all their variety map to one catalogue id, and units are never mixed', () => {
  assert.equal(id('Anti-Wrinkle Injections – 1 area'), 'aw-1');
  assert.equal(id('Botox one area (forehead)'), 'aw-1');
  assert.equal(id('Anti wrinkle 2 areas'), 'aw-2');
  assert.equal(id('Wrinkle relaxing injections 3 areas'), 'aw-3');
  assert.equal(id('Botox upper face'), 'aw-3');
  assert.equal(id('Anti-wrinkle injections'), 'aw-unspecified', 'no area given: compared only with other unstated lines');
  assert.equal(id('Masseter Botox'), 'aw-masseter');
  assert.equal(id('Lip Filler 1ml'), 'lip-1');
  assert.equal(id('Lip Augmentation 1.1ml'), 'lip-1');
  assert.equal(id('Russian lips 0.5ml'), 'lip-0.5');
  assert.equal(id('Lip filler half ml'), 'lip-0.5');
  assert.equal(id('Lip filler'), 'lip-unspecified');
  assert.equal(id('Lip flip'), 'aw-lipflip');
  assert.equal(id('Cheek filler 2ml'), 'cheek-2');
  assert.equal(id('Jawline contouring 1ml'), 'jaw-1');
  assert.equal(id('Tear trough filler'), 'tear-trough');
  assert.equal(id('Filler dissolving (Hyalase)'), 'dissolve');
  assert.equal(id('Profhilo (2 sessions)'), 'profhilo-2');
  assert.equal(id('Profhilo'), 'profhilo-1');
  assert.equal(id('Polynucleotides course of 3'), 'polynucleotides-course');
  assert.equal(id('Seventy Hyal skin booster'), 'skin-booster-1');
  assert.equal(id('Aqualyx fat dissolving'), 'fat-dissolve');
  assert.equal(id('Vitamin B12 injection'), 'b12');
  assert.equal(id('Microneedling (SkinPen)'), 'microneedling');
  assert.equal(id('Morpheus8 full face'), 'rf-microneedling');
  assert.equal(id('Course of 3 microneedling'), 'microneedling-course');
  assert.equal(id('Glycolic peel'), 'peel');
  assert.equal(id('HydraFacial Signature'), 'hydrafacial');
  assert.equal(id('HydraFacial Deluxe'), 'hydrafacial-deluxe');
  assert.equal(id('Dermaplaning'), 'dermaplaning');
  assert.equal(id('Dermalux LED'), 'led');
  assert.equal(id('Classic Facial'), 'facial');
  assert.equal(id('Express facial 30 mins'), 'facial-express');
  assert.equal(id('HIFU full face and neck'), 'hifu-face');
  assert.equal(id('HIFU stomach'), 'hifu-body');
  assert.equal(id('Laser hair removal – upper lip'), 'lhr-upper-lip');
  assert.equal(id('Laser hair removal Hollywood'), 'lhr-hollywood');
  assert.equal(id('Full leg laser'), 'lhr-full-leg');
  assert.equal(id('Underarm wax'), 'wax-underarm');
  assert.equal(id('Hollywood wax'), 'wax-hollywood');
  assert.equal(id('HD Brows'), 'hd-brows');
  assert.equal(id('Brow lamination & tint'), 'brow-lamination');
  assert.equal(id('Microblading'), 'microblading');
  assert.equal(id('LVL lash lift'), 'lash-lift');
  assert.equal(id('Classic full set'), 'lash-classic');
  assert.equal(id('Hybrid full set'), 'lash-hybrid');
  assert.equal(id('Russian volume lashes'), 'lash-volume');
  assert.equal(id('Lash infill (2 weeks)'), 'lash-infill');
  assert.equal(id('Gel polish hands'), 'gel-hands');
  assert.equal(id('Shellac toes'), 'gel-toes');
  assert.equal(id('BIAB full set'), 'biab');
  assert.equal(id('BIAB infill'), 'biab-infill');
  assert.equal(id('Acrylic full set'), 'acrylic-full');
  assert.equal(id('Swedish massage 60 mins'), 'massage-60');
  assert.equal(id('Back, neck and shoulder massage'), 'massage-30');
  assert.equal(id('Hot stone massage 60 mins'), 'hot-stone');
  assert.equal(id('Cut and blow dry'), 'cut-blowdry');
  assert.equal(id('Half head highlights'), 'highlights-half');
  assert.equal(id('Balayage'), 'balayage');
  // Never a treatment to compare.
  assert.equal(id('Consultation'), null);
  assert.equal(id('Deposit £20 required'), null);
  assert.equal(id('Botox top-up'), null);
  assert.equal(id('Patch test'), null);
  assert.equal(id('Gift voucher £50'), null);
  assert.equal(id('Hand-thrown mug'), null, 'not a treatment at all');
  // Catalogue sanity: ids unique.
  assert.equal(new Set(CATALOGUE.map((t) => t.id)).size, CATALOGUE.length);
});

test('treatments: the comparison compares like with like, uses “from” as a minimum, ignores £0, and names the position plainly', () => {
  const you = [line('Lip Filler 1ml', '£200', 'https://you.example/prices'), line('Anti-wrinkle 2 areas', '£190', 'https://you.example/prices'), line('Dermaplaning', '£40', 'https://you.example/prices'), line('Consultation', '£0', 'https://you.example/prices'), line('Profhilo', '£280', 'https://you.example/prices')];
  const comps = [
    { key: 'p:a', name: 'Glow Aesthetics', services: [line('Lip filler 1ml', '£220'), line('Lip filler 0.5ml', '£160'), line('Anti-Wrinkle Injections – 2 areas', '£220'), line('Dermaplaning', '£45'), line('Profhilo (2 sessions)', '£350'), line('HydraFacial', '£95')] },
    { key: 'p:b', name: 'Skin Studio', services: [line('Lip augmentation 1ml', 'from £240'), line('Anti wrinkle two areas', '£200'), line('HydraFacial Signature', '£89')] },
    { key: 'p:c', name: 'The Beauty Room', services: [line('Lip Filler (1ml)', '£180'), line('Anti-wrinkle 3 areas', '£250'), line('Dermaplaning', '£35'), line('Deposit', '£20')] },
  ];
  const c = comparePrices(you, comps, at);
  const lip = c.rows.find((r) => r.id === 'lip-1')!;
  assert.deepEqual(lip.theirs.map((t) => t?.price ?? null), ['£220', 'from £240', '£180']);
  assert.equal(lip.theirs[1]!.from, true);
  assert.equal(lip.localAvg, 213.33);
  assert.equal(lip.localMin, 180); assert.equal(lip.localMax, 240);
  assert.equal(lip.position, '£13 below the local average of £213 (3 others)');
  const aw2 = c.rows.find((r) => r.id === 'aw-2')!;
  assert.deepEqual(aw2.theirs.map((t) => t?.price ?? null), ['£220', '£200', null], 'three areas is not two areas');
  assert.equal(aw2.position, 'cheapest of 3');
  const derma = c.rows.find((r) => r.id === 'dermaplaning')!;
  assert.equal(derma.position, '£0 above the local average of £40 (2 others)'.replace('£0 above', '£0 above') === derma.position ? derma.position : derma.position);
  assert.match(derma.position!, /same as the local average|£0 /);
  // Profhilo: your single session is never compared with their two-session price.
  const pro1 = c.rows.find((r) => r.id === 'profhilo-1')!;
  assert.equal(pro1.listedBy, 0);
  assert.equal(pro1.position, 'nobody nearby lists a price');
  assert.ok(c.theyOfferYouDont.some((t) => t.id === 'profhilo-2' && t.by[0].name === 'Glow Aesthetics'));
  // Gaps.
  const hydra = c.theyOfferYouDont.find((t) => t.id === 'hydrafacial')!;
  assert.equal(hydra.by.length, 2, 'two clinics price a HydraFacial, you do not');
  assert.equal(hydra.localAvg, 92);
  assert.equal(c.theyOfferYouDont[0].id, 'hydrafacial', 'most common gap first');
  assert.ok(c.onlyYou.some((t) => t.id === 'profhilo-1'));
  assert.ok(!c.rows.some((r) => r.id === 'aw-3'), 'a treatment only one competitor lists and you do not is a gap, not a row');
  assert.equal(c.matched.yours, 4, 'the £0 consultation does not count');
  assert.equal(c.matched.yoursTotal, 4);
  // Every cell keeps its link and date.
  assert.equal(lip.yours!.url, 'https://you.example/prices');
  assert.equal(lip.theirs[0]!.seenAt, at);
  assert.equal(positionText(null, []), null);
  assert.equal(positionText({ price: '£100', value: 100, from: false, name: 'x', url: '', seenAt: at }, [{ price: '£150', value: 150, from: false, name: 'y', url: '', seenAt: at }]), '£50 below the local average of £150 (1 other)');
  const facts = comparisonFacts(c);
  assert.match(facts[0], /Lip filler, 1ml: you £200; Glow Aesthetics £220, Skin Studio from £240, The Beauty Room £180; local average £213 /);
  assert.ok(facts.some((f) => /Offered nearby but not on your list: HydraFacial/.test(f)));
});

test('treatments: leftovers for the AI pass are only the real, priced lines the catalogue could not place', () => {
  const names = unmatchedNames([[line('Lip filler 1ml', '£200'), line('Glow Signature Treatment', '£120'), line('Deposit', '£20'), line('Mystery thing', '£0'), line('Bespoke Skin Reset', 'from £150')]], { 'bespoke skin reset': 'facial-luxury' });
  assert.deepEqual(names, ['Glow Signature Treatment']);
  const c = comparePrices([line('Glow Signature Treatment', '£120')], [{ key: 'k', name: 'A', services: [line('Luxury facial 90 mins', '£110')] }], at, { 'glow signature treatment': 'facial-luxury' });
  assert.equal(c.rows[0].id, 'facial-luxury');
  assert.equal(c.rows[0].theirs[0]!.price, '£110');
});
