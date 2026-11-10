// Writes the Retell setup for a sample business, or for Gainora's own line:
//   node scripts/retell-export.mjs [beauty|clinic|trade|gainora]
// gainora also writes settings.sql: hello@gainora.co.uk's Capture & Convert settings, for the owner to run in Supabase.
// Its prices come from the website's site.config.json when the website repo sits next to this one.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { retellSetup, type RetellSetup } from '../shared/retell';
import { gainoraLineSetup } from '../shared/retell-gainora';
import { BEAUTY_SETTINGS, CLINIC_SETTINGS, DEMO_SETTINGS } from '../src/lib/demo';
import { GAINORA_PRICES, gainoraLineSettings, type GainoraPrices } from '../src/lib/gainora-line';

const which = process.argv[2] || 'beauty';
const out = which === 'gainora' ? 'retell/gainora-line' : `retell/${which}-demo`;
mkdirSync(out, { recursive: true });

let r: RetellSetup;
if (which === 'gainora') {
  const web = '../gainora-web/site.config.json';
  let prices: GainoraPrices = GAINORA_PRICES;
  if (existsSync(web)) prices = { ...GAINORA_PRICES, ...JSON.parse(readFileSync(web, 'utf8')).prices };
  else console.warn(`No ${web}: using the prices copied on 10 November 2026.`);
  // A fixed date keeps the export the same from run to run; the SQL stamps the real time.
  const s = gainoraLineSettings('2026-11-10T00:00:00.000Z');
  r = gainoraLineSetup(s, prices);
  const json = JSON.stringify(s);
  if (json.includes('$gainora$')) throw new Error('Settings contain the SQL quote marker.');
  writeFileSync(`${out}/settings.sql`, [
    '-- Gainora’s own Capture & Convert: hello@gainora.co.uk’s settings (src/lib/gainora-line.ts).',
    '-- The receptionist answers for Gainora, and the free 15-minute diagnostic call is booked into this diary with Adelin,',
    '-- by phone or on the booking page (capture.gainora.co.uk/book/gainora, shown on gainora.co.uk/book). Only the',
    '-- thank-you, booking confirmation and reminder texts are on. Also makes sure hello@ has Capture & Convert switched on.',
    '-- The previous settings, if any, come back in the result.',
    "with u as (select id from auth.users where lower(email) = 'hello@gainora.co.uk'),",
    'old as (select s.data from public.capture_settings s join u on s.user_id = u.id),',
    // Gainora's own account needs Capture & Convert switched on, or the booking page and texts don't run for it.
    'access as (',
    "  insert into public.entitlements (email, user_id, agent, status, plan)",
    "  select 'hello@gainora.co.uk', id, 'capture', 'active', 'book' from u",
    "  on conflict (email, agent) do update set user_id = excluded.user_id, status = 'active', plan = coalesce(public.entitlements.plan, excluded.plan), updated_at = now()",
    '  returning id',
    '),',
    'saved as (',
    '  insert into public.capture_settings (user_id, data, completed_at, updated_at)',
    `  select id, jsonb_set($gainora$${json}$gainora$::jsonb, '{completedAt}', to_jsonb(now())), now(), now() from u`,
    '  on conflict (user_id) do update set data = excluded.data, completed_at = excluded.completed_at, updated_at = now()',
    '  returning user_id',
    ')',
    'select (select count(*) from u) as account_found, (select count(*) from access) as access_on, (select count(*) from saved) as saved, (select data from old) as previous_settings;',
    '',
  ].join('\n'));
} else {
  const s = which === 'clinic' ? CLINIC_SETTINGS : which === 'trade' ? DEMO_SETTINGS : BEAUTY_SETTINGS;
  r = retellSetup(s, { demo: { company: 'Gainora', contact: 'Adelin' } });
}
writeFileSync(`${out}/llm.json`, JSON.stringify(r.llm, null, 2));
writeFileSync(`${out}/agent.json`, JSON.stringify(r.agent, null, 2));
writeFileSync(`${out}/prompt.txt`, String(r.llm.general_prompt));
writeFileSync(`${out}/begin-message.txt`, String(r.llm.begin_message));
writeFileSync(`${out}/todo.txt`, r.todo.map((t) => `- ${t}`).join('\n'));
console.log(`Wrote ${out}`);
