// Writes the Retell setup for a sample business: node scripts/retell-export.mjs [beauty|clinic|trade]
import { writeFileSync, mkdirSync } from 'node:fs';
import { retellSetup } from '../shared/retell';
import { BEAUTY_SETTINGS, CLINIC_SETTINGS, DEMO_SETTINGS } from '../src/lib/demo';
const which = process.argv[2] || 'beauty';
const s = which === 'clinic' ? CLINIC_SETTINGS : which === 'trade' ? DEMO_SETTINGS : BEAUTY_SETTINGS;
const out = `retell/${which}-demo`;
mkdirSync(out, { recursive: true });
const r = retellSetup(s, { demo: { company: 'Gainora', contact: 'Adelin' } });
writeFileSync(`${out}/llm.json`, JSON.stringify(r.llm, null, 2));
writeFileSync(`${out}/agent.json`, JSON.stringify(r.agent, null, 2));
writeFileSync(`${out}/prompt.txt`, String(r.llm.general_prompt));
writeFileSync(`${out}/begin-message.txt`, String(r.llm.begin_message));
writeFileSync(`${out}/todo.txt`, r.todo.map((t) => `- ${t}`).join('\n'));
console.log(`Wrote ${out}`);
