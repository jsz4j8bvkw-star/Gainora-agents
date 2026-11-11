import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFake } from './fake-sb';
import {
  anchorFor, applyDayPatch, blocksFor, cleanBlock, cleanSettings, DEFAULT_ROUTINE, DEFAULT_SETTINGS, daysLabel, emptyDay, energyWarning, gymFor, levelOf,
  type MeDay, nextDue, type RoutineBlock, streakOf, taskGroups, weekday, weeksOf, type MeTask,
} from '../shared/admin/me';
import { addDays } from '../shared/admin/templates';

const ROUTINE: RoutineBlock[] = DEFAULT_ROUTINE.map((b, i) => ({ ...b, id: `b${i}`, active: true }));
const S = { ...DEFAULT_SETTINGS };
const WED = '2026-11-11';
const idOf = (kind: string) => ROUTINE.find((b) => b.kind === kind)!.id;
/** A day that reaches the minimum: follow-ups, contacts, gym and bed. */
const minimumDay = (date: string, contacts = 10): MeDay => ({ ...emptyDay(date), contacts, ticks: { [idOf('followups')]: true, [idOf('gym')]: true, [idOf('sleep')]: true } });

test('my day: dates, the routine by weekday and the gym rotation', () => {
  assert.equal(weekday(WED), 3);
  assert.equal(weekday('2026-11-15'), 7);
  assert.equal(daysLabel([1, 2, 3, 4, 5, 6, 7]), 'Every day');
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Mon to Fri');
  assert.equal(daysLabel([6, 7]), 'Sat and Sun');
  assert.equal(daysLabel([1, 3]), 'Mon and Wed');
  assert.equal(daysLabel([1, 3, 5]), 'Mon, Wed, Fri');
  const wed = blocksFor(ROUTINE, WED);
  assert.equal(wed.length, 14);
  assert.deepEqual(wed.map((b) => b.start).slice(0, 5), ['05:30', '06:15', '08:45', '09:15', '09:45']);
  assert.ok(wed.some((b) => /Walk-ins/.test(b.title)) && !wed.some((b) => /Add 50 clinics/.test(b.title)));
  const sat = blocksFor(ROUTINE, '2026-11-14');
  assert.ok(sat.every((b) => ['checkin', 'gym', 'meal', 'sleep'].includes(b.kind)), 'weekends: no work blocks');
  assert.ok(blocksFor(ROUTINE, '2026-11-16').some((b) => /Add 50 clinics/.test(b.title)), 'Monday builds the list');

  assert.equal(gymFor(S, WED).label, 'Chest, then heavy bag');
  assert.equal(gymFor(S, addDays(WED, 3)).session, 'Legs');
  assert.equal(gymFor(S, addDays(WED, 6)).session, 'Shoulders');
  assert.equal(gymFor(S, addDays(WED, 7)).session, 'Chest');
  assert.equal(gymFor(S, addDays(WED, -1)).session, 'Shoulders', 'counts backwards too');
  const anchor = anchorFor(S.gymSplit, '2026-11-20', 3);
  assert.equal(gymFor({ ...S, gymAnchor: anchor }, '2026-11-20').session, 'Legs');

  assert.equal(nextDue('2026-11-13', 'weekdays'), '2026-11-16', 'Friday to Monday');
  assert.equal(nextDue('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextDue('2026-12-15', 'monthly'), '2027-01-15');
  assert.equal(nextDue(WED, 'weekly'), '2026-11-18');
  assert.equal(nextDue(WED, 'none'), null);
});

test('my day: minimum day, good day and the streak', () => {
  const blocks = blocksFor(ROUTINE, WED);
  assert.equal(levelOf(emptyDay(WED), blocks, S, WED).level, 'open');
  assert.equal(levelOf(emptyDay(WED), blocks, S, '2026-11-12').level, 'missed');
  assert.equal(levelOf(minimumDay(WED, 9), blocks, S, WED).level, 'open', '9 contacts is under the minimum');
  assert.equal(levelOf(minimumDay(WED), blocks, S, WED).level, 'minimum');
  const all = { ...minimumDay(WED, 20), ticks: Object.fromEntries(blocks.map((b) => [b.id, true])) };
  assert.equal(levelOf(all, blocks, S, WED).level, 'good');
  assert.equal(levelOf({ ...all, contacts: 19 }, blocks, S, WED).level, 'minimum');
  const sat = '2026-11-14';
  const weekend: MeDay = { ...emptyDay(sat), ticks: { [idOf('gym')]: true, [idOf('sleep')]: true } };
  assert.equal(levelOf(weekend, blocksFor(ROUTINE, sat), S, sat).level, 'minimum', 'weekends: gym and bed');
  assert.equal(levelOf({ ...emptyDay(sat), gym: { done: true, minutes: 70, session: '', note: '' }, ticks: { [idOf('sleep')]: true } }, blocksFor(ROUTINE, sat), S, sat).level, 'minimum', 'gym logged without ticking the block counts');

  const days = new Map<string, MeDay>();
  for (const d of ['2026-11-08', '2026-11-09', '2026-11-10']) days.set(d, d === '2026-11-08' ? { ...emptyDay(d), ticks: { [idOf('gym')]: true, [idOf('sleep')]: true } } : minimumDay(d));
  assert.equal(streakOf(days, ROUTINE, S, WED), 3, 'today still open: the streak runs to yesterday');
  days.set(WED, minimumDay(WED));
  assert.equal(streakOf(days, ROUTINE, S, WED), 4);
  days.delete('2026-11-09');
  assert.equal(streakOf(days, ROUTINE, S, WED), 2, 'a missed day breaks it');
});

test('my day: weekly totals and the burnout warning', () => {
  const days = new Map<string, MeDay>();
  const put = (d: string, energy: number, contacts = 20) => days.set(d, { ...minimumDay(d, contacts), energy });
  ['2026-11-02', '2026-11-03', '2026-11-04'].forEach((d) => put(d, 5));
  ['2026-11-09', '2026-11-10', '2026-11-11'].forEach((d) => put(d, 5, 25));
  const weeks = weeksOf(days, ROUTINE, S, WED, 3);
  assert.equal(weeks[0].week, '2026-11-09');
  assert.equal(weeks[0].contacts, 75);
  assert.equal(weeks[0].contactsTarget, 100);
  assert.equal(weeks[0].minimumDays, 3);
  assert.equal(weeks[1].energyAvg, 5);
  assert.match(energyWarning(weeks)!, /under 6 for two weeks running/);
  put('2026-11-11', 9);
  assert.equal(energyWarning(weeksOf(days, ROUTINE, S, WED, 3)), null, 'this week averages 6.3');
  assert.equal(energyWarning(weeksOf(new Map([...days].filter(([d]) => d >= '2026-11-09')), ROUTINE, S, WED, 3)), null, 'one week is not two');
});

test('my day: cleaning what comes in', () => {
  const d = applyDayPatch(emptyDay(WED), { ticks: { b1: true, b2: true }, energy: 14, contacts: -3 as any, must_dos: ['a', 'b', 'c', 'd'], append_note: 'Gym took 70 minutes' }, '07:45');
  assert.equal(d.energy, 10);
  assert.equal(d.contacts, 0);
  assert.deepEqual(d.must_dos, ['a', 'b', 'c']);
  assert.equal(d.notes, '07:45 Gym took 70 minutes');
  const e = applyDayPatch(d, { ticks: { b1: false }, append_note: 'Rang 12 clinics', trading: { news_day: true } }, '19:30');
  assert.deepEqual(Object.keys(e.ticks), ['b2']);
  assert.equal(e.notes, '07:45 Gym took 70 minutes\n19:30 Rang 12 clinics');
  assert.equal(e.trading.news_day, true);
  assert.equal(e.trading.traded, null);
  assert.throws(() => cleanBlock({ start: '9:30', title: 'X' }), /start time/);
  assert.throws(() => cleanBlock({ start: '10:00', finish: '09:00', title: 'X' }), /after the start/);
  assert.equal(cleanBlock({ start: '07:00', title: 'Walk', days: [7, 6, 6, 9] }).days.join(), '6,7');
  const s = cleanSettings({ minimum: { contacts: 30 }, good: { contacts: 15 }, gymSplit: ['Push', ' ', 'Pull'] }, DEFAULT_SETTINGS);
  assert.equal(s.good.contacts, 30, 'good can’t be below minimum');
  assert.deepEqual(s.gymSplit, ['Push', 'Pull']);
  const t = (title: string, due_on: string | null, done = false) => ({ id: title, title, due_on, done, created_at: '' } as MeTask);
  assert.deepEqual(taskGroups([t('a', '2026-11-10'), t('b', WED), t('c', '2026-11-14'), t('d', '2026-11-20'), t('e', null), t('f', WED, true)], WED).map((g) => `${g.id}:${g.tasks.map((x) => x.title)}`), ['late:a', 'today:b', 'week:c', 'later:d', 'undated:e']);
});

test('my day: the admin page and the Claude connector end to end', async () => {
  const ADMIN = { id: '22222222-2222-4222-8222-222222222222', email: 'hello@gainora.co.uk', token: 'admin' };
  const TEAM = { id: '55555555-5555-4555-8555-555555555555', email: 'sales@gainora.co.uk', token: 'team' };
  const fake = await startFake({
    __users: [ADMIN, TEAM],
    entitlements: [], admin_accounts: [], admin_tasks: [], admin_log: [], admin_keys: [], sites: [], site_requests: [], profiles: [],
    prospects: [{ id: '66666666-6666-4666-8666-666666666666', business_name: 'Glow Clinic', stage: 'contacted', next_on: '2026-11-10', unsubscribed_at: null }],
    me_settings: [], me_routine: [], me_days: [], me_tasks: [],
  });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', INTERNAL_SECRET: 's', APP_URL: 'https://app.gainora.co.uk', GAINORA_ADMIN_EMAILS: 'hello@gainora.co.uk,sales@gainora.co.uk' });
  delete process.env.STRIPE_SECRET_KEY; delete process.env.MY_DAY_EMAILS;
  try {
    const { default: page } = await import('../netlify/functions/admin-me');
    const { default: admin } = await import('../netlify/functions/admin');
    const { default: mcp } = await import('../netlify/functions/mcp');
    const call = async (b: any, token = 'admin') => page(new Request('https://admin.gainora.co.uk/api/admin-me', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));

    // Private to the first admin email, even for the rest of the team.
    assert.equal((await call({ op: 'today' }, 'team')).status, 403);

    // First open: the default routine is written, once.
    let p = (await (await call({ op: 'today', date: WED })).json()).plan;
    assert.equal(fake.tables.me_routine.length, DEFAULT_ROUTINE.length);
    assert.equal(p.blocks.length, 14);
    assert.equal(p.gym.label, 'Chest, then heavy bag');
    assert.equal(p.followUpsDue, 1, 'sales follow-ups due show here');
    assert.equal(p.status.level === 'open' || p.status.level === 'missed', true);
    await call({ op: 'today', date: WED });
    assert.equal(fake.tables.me_routine.length, DEFAULT_ROUTINE.length, 'not written twice');

    // Tick the blocks and fill in the scoreboard from the page.
    const id = (kind: string) => p.blocks.find((b: any) => b.kind === kind).id;
    p = (await (await call({ op: 'day-save', date: WED, patch: { ticks: { [id('gym')]: true, [id('sleep')]: true, [id('followups')]: true }, contacts: 11, energy: 7, must_dos: ['Clear follow-ups', 'Walk into 8 clinics', 'Mirela brief'] } })).json()).plan;
    assert.equal(p.status.level, 'minimum');
    assert.equal(p.day.energy, 7);
    assert.equal(fake.tables.me_days.length, 1);
    p = (await (await call({ op: 'day-save', date: WED, patch: { contacts: 12 } })).json()).plan;
    assert.equal(p.day.must_dos.length, 3, 'only what’s sent changes');
    assert.equal(fake.tables.me_days.length, 1, 'one row per day');

    // Personal tasks, including a repeating one.
    const t = (await (await call({ op: 'task-save', task: { title: 'Weekly trading review', due_on: '2026-11-13', category: 'trading', repeat: 'weekly' } })).json()).task;
    const ticked = (await (await call({ op: 'task-save', task: { id: t.id, done: true } })).json()).task;
    assert.equal(ticked.next_due, '2026-11-20');
    assert.equal(ticked.done, false);
    assert.equal((await (await call({ op: 'task-save', task: { title: '' } })).json()).error, 'Give the task a title.');

    // A routine block and the settings.
    const bad = await call({ op: 'block-save', block: { start: '25:00', title: 'X' } });
    assert.equal(bad.status, 400);
    await call({ op: 'settings-save', settings: { gymMinutes: 75, tradingRules: 'No trades on news days.' } });
    const r = await (await call({ op: 'routine' })).json();
    assert.equal(r.settings.gymMinutes, 75);
    assert.equal(r.routine.length, DEFAULT_ROUTINE.length);

    // The connector: a key, then the My day tools.
    const { url } = await (await admin(new Request('https://admin.gainora.co.uk/api/admin', { method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'key-create', label: 'Claude' }) }))).json();
    const key = url.split('/').pop();
    const rpc = async (method: string, params?: any) => (await mcp(new Request(`https://app.gainora.co.uk/api/mcp/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))).json();
    const names = (await rpc('tools/list')).result.tools.map((x: any) => x.name);
    for (const n of ['get_my_day', 'update_my_day', 'log_gym', 'update_gym_plan', 'log_trading', 'update_trading_rules', 'get_my_routine', 'update_routine_block', 'list_my_tasks', 'add_my_task', 'update_my_task', 'get_my_week']) assert.ok(names.includes(n), n);
    assert.ok(names.includes('list_clients'), 'the client tools are still there');
    const use = async (name: string, args: any) => { const res = (await rpc('tools/call', { name, arguments: args })).result; return { ...res, data: res.isError ? null : JSON.parse(res.content[0].text) }; };

    const day = await use('get_my_day', { date: WED });
    assert.equal(day.data.level, 'Minimum done');
    assert.equal(day.data.scoreboard.contacts, 12);

    const upd = await use('update_my_day', { date: WED, tick: ['walk-ins', 'lunch'], append_note: 'Gym took 70 minutes', sales_chats: 1 });
    assert.equal(upd.data.routine.find((b: any) => /Walk-ins/.test(b.title)).done, true);
    assert.equal(upd.data.scoreboard.sales_chats, 1);
    assert.match(upd.data.notes, /Gym took 70 minutes/);
    const vague = await use('update_my_day', { date: WED, tick: ['clinics'] });
    assert.equal(vague.isError, true, 'a title that matches two blocks is refused');
    assert.match(vague.content[0].text, /More than one block/);

    assert.equal((await use('log_gym', { date: WED, minutes: 70, done: true })).data.gym.minutes, 70);
    const plan = await use('update_gym_plan', { today_session: 4, usual_minutes: 70 });
    assert.equal(plan.data.usual_minutes, 70);
    assert.match(plan.data.today, /^Legs/);
    assert.equal((await use('log_trading', { date: WED, news_day: true, traded: false, notes: 'CPI day, watched only' })).data.trading.traded, false);
    assert.match((await use('update_trading_rules', { rules: 'No trades on news days.\nStop at 15:30.' })).data.rules, /Stop at 15:30/);

    const added = await use('add_my_task', { title: 'Print 30 one-page notes', due_on: '2026-11-12', category: 'business' });
    assert.equal(added.data.title, 'Print 30 one-page notes');
    assert.equal(fake.tables.me_tasks.find((x) => x.title === 'Print 30 one-page notes').created_by, 'Claude');
    assert.equal((await use('update_my_task', { task: 'one-page', done: true })).data.done, true);
    const list = await use('list_my_tasks', {});
    assert.ok(list.data.groups.every((g: any) => g.tasks.every((x: any) => x.title !== 'Print 30 one-page notes')), 'done tasks drop off the list');

    const moved = await use('update_routine_block', { block: 'In bed', start: '21:45' });
    assert.equal(moved.data.start, '21:45');
    const routine = await use('get_my_routine', {});
    assert.equal(routine.data.blocks.find((b: any) => b.title === 'In bed').start, '21:45');
    assert.match(routine.data.trading_rules, /No trades on news days/);

    const week = await use('get_my_week', { weeks: 2 });
    assert.equal(week.data.weeks.length, 2);
    assert.equal(typeof week.data.streak, 'number');
    assert.ok(!JSON.stringify(fake.tables.admin_log).includes('Gym took'), 'My day never lands on a client’s record');
  } finally { fake.server.close(); delete process.env.GAINORA_ADMIN_EMAILS; }
});
