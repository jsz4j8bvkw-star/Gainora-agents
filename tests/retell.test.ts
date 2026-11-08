import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retellSetup } from '../shared/retell';
import { BEAUTY_SETTINGS, CLINIC_SETTINGS } from '../src/lib/demo';
import { normaliseEnquiry, triage } from '../shared/capture';

test('retell: beauty receptionist is warm, handles every call type, never sends callers to 999', () => {
  const { llm, agent, todo } = retellSetup(BEAUTY_SETTINGS, { demo: { company: 'Gainora', contact: 'Adelin' } });
  const p = String(llm.general_prompt);
  assert.match(p, /warm, friendly woman/);
  assert.match(p, /Oh lovely/);
  assert.match(p, /never claim to be a person/i);
  for (const t of ['patch test', 'Moving an appointment', 'Cancelling', 'Running late', 'Gift vouchers', 'Group bookings', 'Fully booked', 'complaint', 'Sales calls', '18 or over']) assert.ok(p.toLowerCase().includes(t.toLowerCase()), t);
  assert.doesNotMatch(p, /call 999|go to A&E|call NHS 111/i);
  assert.match(p, /This is a demonstration line/);
  // Found in a test chat: telling the model the demo emergency line was "an example number" made it break role and send the caller to 999
  assert.doesNotMatch(p, /example number/);
  assert.match(p, /Stay in role for every kind of call/);
  assert.match(p, /don’t tell them not to go and don’t suggest it yourself/);
  assert.equal(agent.language, 'en-GB');
  // Demo emergency line is an Ofcom drama number: given out, never dialled
  assert.ok(!(llm.general_tools as any[]).some((t) => t.type === 'transfer_call'));
  assert.ok(todo.some((t) => /isn’t a real dialable number/.test(t)));
  const fields = (agent.post_call_analysis_data as any[]).map((f) => f.name);
  for (const f of ['call_summary', 'caller_name', 'callback_number', 'urgent_concern', 'call_type', 'booked', 'demo_lead']) assert.ok(fields.includes(f), f);
});

test('retell: a real clinic line transfers emergencies to the clinic', () => {
  const s = structuredClone(BEAUTY_SETTINGS);
  s.calls.emergencyLine = '07123 456789';
  const { llm } = retellSetup(s, { voiceId: 'v1', webhookUrl: 'https://capture.gainora.co.uk/api/enquiry-in?key=x' });
  const t = (llm.general_tools as any[]).find((x) => x.type === 'transfer_call');
  assert.equal(t.transfer_destination.number, '+447123456789');
  assert.equal(t.transfer_option.type, 'cold_transfer');
  assert.doesNotMatch(String(llm.general_prompt), /demonstration/);
});

test('retell: physio clinics keep 999 safety, no beauty call list', () => {
  const p = String(retellSetup(CLINIC_SETTINGS).llm.general_prompt);
  assert.match(p, /call 999 or go to A&E/);
  assert.doesNotMatch(p, /patch test/);
});

test('retell: a call flagged as an urgent concern lands in the inbox as an emergency', () => {
  const e = normaliseEnquiry({ event: 'call_analyzed', call: { call_id: 'c1', from_number: '+447700900411', transcript: 'Agent: Hello', call_analysis: { call_summary: 'Caller had filler on Tuesday and is worried about her lip.', custom_analysis_data: { caller_name: 'Sophie Reed', urgent_concern: true } } } })!;
  assert.equal(e.name, 'Sophie Reed');
  assert.equal(triage(`${e.summary}\n${e.transcript}`).urgency, 'emergency');
});
