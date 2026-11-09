import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders, loadClients, monthlyMoneyLines, reminderLine, weeklyClientLines, type ClientsSnapshot } from '../netlify/lib/clients';
import { isMissingTable } from '../src/lib/live';
import { smsProvider, smsProviderName } from '../netlify/lib/sms';
import type { Client, Visit } from '../shared/clients';

const DAY = 86_400_000; const WEEK = 7 * DAY;
const now = new Date('2026-11-09T06:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
const client = (id: string, name: string, over: Partial<Client> = {}): Client => ({ id, name, phone: '+447700900' + id.padStart(3, '0'), email: '', consent: 'soft_opt_in', source: 'import', createdAt: iso(now.getTime() - 100 * DAY), ...over });
const visit = (clientId: string, weeksAgo: number, treatment = 'Anti-wrinkle 2 areas', treatmentId: string | null = 'aw-2', amount = 195): Visit => ({ id: `v${clientId}${weeksAgo}`, clientId, at: iso(now.getTime() - weeksAgo * WEEK).slice(0, 10), treatment, treatmentId, amount, createdAt: iso(now.getTime()) });

test('reminders: the owner is told once per client per due date, with names and the value at last prices; snoozed and gone clients are left out', () => {
  const snap = {
    clients: [client('1', 'Sarah Mitchell'), client('2', 'Gemma Taylor'), client('3', 'Snoozed Sue', { snoozedUntil: iso(now.getTime() + 2 * WEEK) }), client('4', 'Gone Gail', { notComingBack: true })],
    visits: [visit('1', 13.2), visit('2', 13.5, 'Lip filler 1ml', 'lip-1', 220), visit('3', 13.2), visit('4', 13.2)],
  };
  // Gemma's lip filler has a 39-week gap: not due. Sarah became due this week (13 weeks).
  const rs = dueReminders(snap, {}, new Date(now.getTime() - DAY), new Set(), now);
  assert.deepEqual(rs.map((r) => r.name), ['Sarah Mitchell']);
  assert.equal(rs[0].lastPrice, 195); assert.equal(rs[0].dueOn, iso(now.getTime() - 0.2 * WEEK).slice(0, 10));
  assert.equal(reminderLine(rs), 'Sarah is due back: Sarah, worth £195 at their last prices. A text is drafted under Your clients; you approve and send.');
  // Already reminded for that due date: nothing. A different due date (she came in again) would be new.
  assert.deepEqual(dueReminders(snap, {}, new Date(now.getTime() - DAY), new Set([`1:${rs[0].dueOn}`]), now), []);
  // Several clients read as one line with the overdue count.
  const many = dueReminders({ clients: [client('1', 'Sarah Mitchell'), client('2', 'Gemma Taylor'), client('5', 'Rachel Price'), client('6', 'Nicola Shaw')], visits: [visit('1', 14), visit('2', 15), visit('5', 13), visit('6', 13.3)] }, {}, new Date(now.getTime() - 3 * WEEK), new Set(), now);
  assert.equal(many.length, 4);
  assert.equal(reminderLine(many), '4 clients are due back (2 overdue): Sarah, Gemma, Rachel and 1 more, worth £780 at their last prices. Texts are drafted under Your clients; you approve and send.');
  assert.equal(reminderLine([]), null);
});

test('reminders: the weekly digest and the monthly email use the owner’s confirmed bookings only, and say nothing when the tables are not there', () => {
  const snap: ClientsSnapshot = {
    ready: true,
    clients: [client('1', 'Sarah Mitchell'), client('2', 'Gemma Taylor')],
    visits: [visit('1', 13.2), visit('2', 14)],
    actions: [{ id: 'a1', clientId: '1', kind: 'rebook', channel: 'sms_phone', text: 'x', sentAt: iso(now.getTime() - 10 * DAY) }, { id: 'a2', clientId: '2', kind: 'review_request', channel: 'sms_phone', text: 'x', sentAt: iso(now.getTime() - 20 * DAY) }],
    outcomes: [
      { id: 'o1', actionId: 'a1', clientId: '1', amount: 195, status: 'confirmed', at: iso(now.getTime() - 3 * DAY), title: 'Sarah rebooked', createdAt: iso(now.getTime()) },
      { id: 'o2', actionId: 'a2', clientId: '2', amount: 220, status: 'likely', at: iso(now.getTime() - 2 * DAY), title: 'Gemma visited', createdAt: iso(now.getTime()) },
      { id: 'o3', actionId: null, clientId: null, amount: 500, status: 'confirmed', at: '2026-10-12T10:00:00Z', title: 'Walk-in in October', createdAt: '2026-10-12T10:00:00Z' },
    ],
  };
  const weekly = weeklyClientLines(snap, {}, now);
  assert.equal(weekly.length, 2);
  assert.match(weekly[0], /^Your clients: 2 due back this week \(Sarah, Gemma\), worth £390 at their last prices\./);
  assert.equal(weekly[1], 'So far this month Gainora’s messages brought in £195 from 1 booking you confirmed. 1 likely booking waiting for you to confirm.');
  const monthly = monthlyMoneyLines(snap, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
  assert.deepEqual(monthly, ['Gainora helped bring in £500 from 1 booking you confirmed (1 from bookings you added). Only bookings you confirmed are counted.']);
  assert.match(monthlyMoneyLines(snap, new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'))[0], /^No bookings were confirmed/);
  const notReady: ClientsSnapshot = { ready: false, clients: [], visits: [], actions: [], outcomes: [] };
  assert.deepEqual(weeklyClientLines(notReady, {}, now), []);
  assert.deepEqual(monthlyMoneyLines(notReady, new Date(), new Date()), []);
});

test('reminders: without the tables the server reads "not ready" instead of failing, and the app recognises PostgREST’s missing-table answers', async () => {
  // No SUPABASE_URL in tests: db() throws, loadClients() swallows it.
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const snap = await loadClients('u1');
  assert.equal(snap.ready, false); assert.deepEqual(snap.clients, []);
  assert.equal(isMissingTable({ status: 404, code: 'PGRST205', message: 'Could not find the table' }), true);
  assert.equal(isMissingTable({ status: 400, code: '42P01' }), true);
  assert.equal(isMissingTable({ status: 404, code: '' }), true);
  assert.equal(isMissingTable({ status: 500, code: 'XX000' }), false);
  assert.equal(isMissingTable({ status: 401, code: '' }), false);
  assert.equal(isMissingTable(null), false);
});

test('sms: no provider unless SMS_PROVIDER and the Twilio settings are all present, so nothing can be sent by default', () => {
  delete process.env.SMS_PROVIDER; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM;
  assert.equal(smsProviderName(), null); assert.equal(smsProvider(), null);
  process.env.SMS_PROVIDER = 'twilio';
  assert.equal(smsProviderName(), null); // half-configured is still off
  process.env.TWILIO_ACCOUNT_SID = 'AC123'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = 'Willow';
  assert.equal(smsProviderName(), 'twilio'); assert.equal(smsProvider()?.name, 'twilio');
  delete process.env.SMS_PROVIDER; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM;
});
