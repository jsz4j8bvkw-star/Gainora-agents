import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureWeekFrom, priceOf } from '../shared/capture-week';

test('capture week: Capture & Convert’s last seven days, valued at the clinic’s own prices', () => {
  assert.deepEqual(priceOf('£250'), { amount: 250, from: false });
  assert.deepEqual(priceOf('from £180'), { amount: 180, from: true });
  assert.deepEqual(priceOf('Free'), { amount: 0, from: false });
  assert.equal(priceOf('ask'), null);
  const types = [{ name: 'Lip filler', price: '£250' }, { name: 'Anti-wrinkle treatment', price: 'from £180' }];
  const rows = [
    { status: 'booked', after_hours: true, booked_type: 'Lip filler', job_value: null, history: [] },
    { status: 'won', after_hours: false, booked_type: 'Anti-wrinkle treatment', job_value: 210, history: [] },
    { status: 'new', after_hours: true, booked_type: '', job_value: null, history: [] },
    { status: 'spam', after_hours: true, booked_type: '', job_value: null, history: [] },
    { status: 'booked', after_hours: false, booked_type: 'Lip filler', job_value: null, history: [{ text: 'Imported from Fresha' }] },
  ];
  const w = captureWeekFrom(rows, types, '2026-11-03T00:00:00Z', new Date('2026-11-10T00:00:00Z'));
  assert.deepEqual(w, { from: '2026-11-03T00:00:00Z', to: '2026-11-10T00:00:00.000Z', enquiries: 3, afterHours: 2, booked: 2, bookedValue: 460, valueIsMinimum: false });
  const unknown = captureWeekFrom([{ status: 'booked', booked_type: 'Mystery', history: [] }], types, 'x');
  assert.equal(unknown.valueIsMinimum, true);
});
