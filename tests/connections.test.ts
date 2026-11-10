import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFake } from './fake-db';
import { BEAUTY_SETTINGS } from '../src/lib/demo';
import { londonDate } from '../shared/diary';

const settings = { ...structuredClone(BEAUTY_SETTINGS), page: { on: true, slug: 'willow-skin-beauty', mode: 'book' } };
const openDay = (() => { for (let i = 1; i < 8; i++) { const d = londonDate(new Date(Date.now() + i * 86_400_000)); const wd = ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; if (BEAUTY_SETTINGS.calls.days.includes(wd)) return d; } return ''; })();

test('connections: secrets are sealed, Google busy times block the diary, bookings go into Google', async () => {
  process.env.INTERNAL_SECRET = 'test-secret';
  const { seal, open, sign, verify } = await import('../netlify/lib/secret');
  const sealed = seal('refresh-token-123');
  assert.ok(!sealed.includes('refresh-token-123'));
  assert.equal(open(sealed), 'refresh-token-123');
  assert.equal(verify(sign({ u: 'u1', at: Date.now() }))?.u, 'u1');
  assert.equal(verify(sign({ u: 'u1', at: Date.now() - 3_600_000 })), null, 'old sign-ins expire');
  assert.equal(verify(`${sign({ u: 'u1', at: Date.now() }).split('.')[0]}.forged`), null);

  const busyStart = new Date(`${openDay}T10:00:00Z`).toISOString(), busyEnd = new Date(`${openDay}T12:00:00Z`).toISOString();
  const fake = await startFake({
    capture_settings: [{ user_id: 'u1', data: settings }],
    entitlements: [{ user_id: 'u1', agent: 'capture', status: 'active' }],
    diary_connections: [{ id: 'c1', user_id: 'u1', provider: 'google', secret: sealed, status: 'connected', account: { read: ['cal-amy'], write: 'cal-main', staff: { 'cal-amy': 'Amy' }, mirror: false, calendars: [] } }],
    enquiries: [], messages: [], opt_outs: [],
  });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_SERVICE_ROLE_KEY: 'svc', GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'csec', APP_URL: 'https://capture.gainora.co.uk' });
  const inserted: any[] = [];
  fake.external('oauth2.googleapis.com', () => ({ access_token: 'acc', expires_in: 3600 }));
  fake.external('www.googleapis.com', (method, path, body) => {
    if (path.startsWith('/calendar/v3/freeBusy')) return { calendars: { 'cal-amy': { busy: [{ start: busyStart, end: busyEnd }] } } };
    if (method === 'POST' && path.includes('/events')) { inserted.push({ path, body }); return { id: 'ev1' }; }
    return {};
  });
  try {
    const { timesFor, makeBooking } = await import('../netlify/lib/diary');
    const { withDefaults } = await import('../shared/capture');
    const s = withDefaults(settings);
    const days = await timesFor('u1', s, { type: 'Lip filler', from: openDay, days: 1 });
    const starts = days[0].slots.map((x) => x.start);
    assert.ok(!starts.includes(new Date(`${openDay}T10:30:00Z`).toISOString()), 'Amy’s Google calendar is busy 10–12');
    assert.ok(starts.includes(new Date(`${openDay}T12:00:00Z`).toISOString()));
    const r = await makeBooking('u1', s, { type: 'Lip filler', start: days[0].slots[0].start, name: 'Sam Taylor', phone: '07700 900555', source: 'page' });
    assert.equal(r.ok, true);
    assert.equal(inserted.length, 1, 'the booking is added to the calendar');
    assert.match(inserted[0].path, /cal-amy\/events/, 'Amy’s booking goes into Amy’s calendar');
    assert.match(inserted[0].body.summary, /^Lip filler – Sam Taylor \(Amy\)$/);
    assert.equal(inserted[0].body.start.timeZone, 'Europe/London');
  } finally { fake.server.close(); }
});

test('connections: with Cliniko, free times and bookings come from Cliniko itself', async () => {
  process.env.INTERNAL_SECRET = 'test-secret';
  const { seal } = await import('../netlify/lib/secret');
  const slot = new Date(`${openDay}T14:00:00Z`).toISOString();
  const fake = await startFake({
    capture_settings: [{ user_id: 'u1', data: settings }],
    diary_connections: [{ id: 'c2', user_id: 'u1', provider: 'cliniko', secret: seal('MS0xLWFwaWtleWFwaWtleWFwaWtleQ-uk2'), status: 'connected', account: { businessId: 'b1', types: { 'Lip filler': 't9' }, practitioners: { Amy: 'p1' } } }],
    enquiries: [], messages: [], opt_outs: [],
  });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  const made: any[] = [];
  let auth = '';
  fake.external('api.uk2.cliniko.com', (method, path, body) => {
    if (path.includes('/available_times')) return { available_times: [{ appointment_start: slot }] };
    if (method === 'POST' && path === '/v1/patients') return { id: '555' };
    if (method === 'POST' && path === '/v1/individual_appointments') { made.push(body); return { id: 'a1' }; }
    return { patients: [] };
  });
  try {
    const { timesFor, makeBooking } = await import('../netlify/lib/diary');
    const { clinikoBase } = await import('../netlify/lib/connections');
    assert.equal(clinikoBase('abc-uk2'), 'https://api.uk2.cliniko.com/v1');
    assert.equal(clinikoBase('abc'), 'https://api.au1.cliniko.com/v1');
    const { withDefaults } = await import('../shared/capture');
    const s = withDefaults(settings);
    const days = await timesFor('u1', s, { type: 'Lip filler', from: openDay, days: 1 });
    assert.deepEqual(days[0].slots.map((x) => [x.start, x.who]), [[slot, 'Amy']]);
    const call = fake.calls.find((c) => c.url.includes('/available_times'))!;
    assert.match(call.url, /\/businesses\/b1\/practitioners\/p1\/appointment_types\/t9\/available_times\?from=/);
    const r = await makeBooking('u1', s, { type: 'Lip filler', start: slot, who: 'Amy', name: 'Sam Taylor', phone: '07700 900555', source: 'call', callId: 'call_9' });
    assert.equal(r.ok, true);
    assert.deepEqual({ ...made[0], notes: undefined }, { starts_at: slot, patient_id: '555', practitioner_id: 'p1', appointment_type_id: 't9', business_id: 'b1', notes: undefined });
    // A time Cliniko doesn't offer can't be booked.
    const no = await makeBooking('u1', s, { type: 'Lip filler', start: new Date(`${openDay}T15:00:00Z`).toISOString(), name: 'Sam Taylor', phone: '07700 900555', source: 'page' });
    assert.equal(no.ok, false);
    void auth;
  } finally { fake.server.close(); }
});
