import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFake } from './fake-db';
import { withDefaults, type EnquiryRecord } from '../shared/capture';
import { BEAUTY_SETTINGS } from '../src/lib/demo';

const s = withDefaults(structuredClone(BEAUTY_SETTINGS));
const won = (over: Partial<EnquiryRecord> = {}): EnquiryRecord => ({
  id: 'e1', channel: 'call', name: 'Chloe Martin', phone: '+447700900410', email: '', postcode: '', summary: '', transcript: '', recordingUrl: '',
  urgency: 'normal', kind: 'booking', reasons: [], status: 'won', afterHours: false, notes: '', history: [{ at: '2026-11-05T11:00:00Z', text: 'Attended' }],
  repliedAt: null, quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: '2026-11-05T10:00:00Z', bookedType: 'Lip filler', bookedWith: 'Amy', jobValue: null,
  invoiceDue: null, paidAt: null, paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: '2026-11-01T09:00:00Z', isTest: false, ...over,
});

test('attended appointments go into Command Centre’s client list, once', async () => {
  const fake = await startFake({ clients: [], client_visits: [] });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  try {
    const { syncVisits, visitFrom } = await import('../netlify/lib/clients-sync');
    const v = visitFrom(won(), s)!;
    assert.deepEqual(v, { name: 'Chloe Martin', phone: '+447700900410', email: '', on: '2026-11-05', treatment: 'Lip filler', amount: 250, who: 'Amy' });
    assert.equal(visitFrom(won({ status: 'booked' }), s), null, 'only attended appointments');
    assert.equal(await syncVisits('u1', [v]), 1);
    assert.equal(await syncVisits('u1', [v]), 0, 'the same visit isn’t added twice');
    assert.equal(await syncVisits('u1', [{ ...v, on: '2026-12-10', treatment: 'Lip filler' }]), 1, 'a later visit joins the same client');
    assert.equal(fake.tables.clients.length, 1);
    assert.equal(fake.tables.clients[0].imported_from, 'Capture & Convert');
    assert.equal(fake.tables.client_visits.length, 2);
    assert.equal(fake.tables.client_visits[0].practitioner, 'Amy');
  } finally { fake.server.close(); }
});

test('no client list set up: nothing breaks', async () => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:1';
  const { syncVisits } = await import('../netlify/lib/clients-sync');
  assert.equal(await syncVisits('u1', [{ name: 'A B', phone: '+447700900410', email: '', on: '2026-11-05', treatment: 'Visit', amount: null, who: '' }]), 0);
});
