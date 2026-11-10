// Builds a Retell receptionist from a client's Capture & Convert settings.
// Retell is the phone platform; everything the receptionist knows comes from packFromSettings, so the
// script in the app and the agent on the phone never drift apart. Checked against Retell's API reference
// (create-retell-llm, create-agent) on 8 November 2026. Single-prompt agents are used: Retell stops new
// multi-prompt agents on 15 December 2026.

import { featuresOf, greetingFor, isBeauty, lines, packFromSettings, type CaptureSettings } from './capture';
import { callerRules } from './callers';

export interface RetellSetup {
  /** Body for POST /create-retell-llm */
  llm: Record<string, unknown>;
  /** Body for POST /create-agent, once the LLM exists (llm_id is filled in then) */
  agent: Record<string, unknown>;
  /** What still has to be chosen or checked in the Retell dashboard */
  todo: string[];
}

export interface RetellOptions {
  /** A demonstration line: the receptionist explains it's a Gainora demo if asked, and offers a call back from Gainora. */
  demo?: { company: string; contact: string };
  /** The app's enquiry link (from the Connect tab). Left out, the webhook is added later. */
  webhookUrl?: string;
  /** Voice chosen in the Retell dashboard. Left out, a placeholder is used and listed in todo. */
  voiceId?: string;
  /** Recognise returning callers (Call to Booking and up). Left out, it follows the owner's switch in the app. */
  recogniseCallers?: boolean;
  /** The app's caller lookup link (made with the enquiry link). Goes on the Retell phone number, not the agent. */
  lookupUrl?: string;
}

const e164 = (raw: string) => {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return `+${d.slice(2)}`;
  if (d.startsWith('0')) return `+44${d.slice(1)}`;
  return d;
};

/** Ofcom's drama range (07700 900000–900999) and similar can't be dialled, so they're never used for transfers. */
const dialable = (n: string) => !!n && !/^\+?447700900\d{3}$/.test(e164(n).replace('+', ''));

export function retellSetup(s: CaptureSettings, o: RetellOptions = {}): RetellSetup {
  const beauty = isBeauty(s.business);
  const appts = s.business.kind === 'appointments';
  const name = s.business.name || 'the business';
  const todo: string[] = [];

  const emergency = beauty ? e164(s.calls.emergencyLine) : '';
  const canTransfer = beauty && s.calls.transferEmergency && dialable(s.calls.emergencyLine);
  // The script only promises a transfer the phone line can actually make.
  const pack = packFromSettings({ ...s, calls: { ...s.calls, transferEmergency: canTransfer } });
  if (beauty && s.calls.transferEmergency && !canTransfer) todo.push('The clinic emergency line isn’t a real dialable number yet, so calls are not transferred: the caller is given the number instead.');

  const tools: Record<string, unknown>[] = [
    {
      type: 'end_call', name: 'end_call',
      description: 'End the call politely once the caller has nothing else, after summing up what happens next. Also end it if the caller is abusive, or if it is a sales call for the business.',
    },
  ];
  if (canTransfer) {
    tools.push({
      type: 'transfer_call', name: 'transfer_to_clinic_emergency_line',
      description: `Put the caller straight through to ${name}'s emergency line. Use only for a concern after a treatment from the safety list. Tell the caller you are putting them through first.`,
      transfer_destination: { type: 'predefined', number: emergency },
      transfer_option: { type: 'cold_transfer' },
      speak_during_execution: true,
    });
  }

  const persona = [
    '## How you sound',
    `- You are a warm, friendly woman on the front desk at ${name}: the receptionist everyone likes. Relaxed, kind and quietly confident, never stiff, never salesy.`,
    '- Talk like a person, not a script. Use contractions (I’m, you’re, we’ll, that’s). Keep most replies to one or two short sentences.',
    '- React naturally to what people say, the way a good receptionist would: "Oh lovely", "Ah, I see", "Oh no, that doesn’t sound fun", "Perfect", "No problem at all", "Bear with me one second", "Brilliant". Vary them; never use the same one twice in a row.',
    '- Start most replies with a short reaction to what they just said, then your question. A reply that is only a question sounds like a form.',
    '- Share good news with them: a wedding, a birthday, a holiday ("Oh congratulations, how exciting!", "Ooh, lovely, where are you off to?"). One warm line, then back to helping.',
    '- Match the caller’s mood. Bright and chatty with someone excited about a treatment; calm, slower and gentle with someone worried or upset.',
    '- Don’t ask the same question twice in a row. If they skip one, carry on and come back to it naturally later.',
    '- When the answer is no, say it kindly and say what you can do instead ("Ah, I’m afraid that one’s only for over-18s, but we’d love to see her when she’s older"). Never just list what you can’t do.',
    '- With an unhappy caller, lead with what will happen ("I’ll make sure the team calls you back personally"), not with what you can’t do.',
    '- Say goodbye warmly, for example "Thanks so much for calling, have a lovely day!"',
    '- Use their first name now and then once you know it, not in every sentence.',
    '- Small, natural fillers are fine when you are checking something ("Let me just have a look… okay"), but don’t overdo them.',
    '- Never sound like a menu or a form. Don’t say "please provide", "your request", "I have noted" or "is there anything else I can assist you with". Say "Can I grab your name?", "Lovely, I’ve got that", "Anything else I can help with?"',
    '- If the caller laughs or jokes, it’s fine to be light and warm back. Stay professional.',
    '- Being natural never means pretending: you never claim to be a person, and if asked whether you’re a real person or an AI, you say honestly and kindly that you’re the clinic’s AI assistant, then carry on helping.',
  ];

  const retellRules = [
    '## How you work on this phone line',
    '- Speak naturally, in short sentences. Never read out lists, headings, symbols or web addresses unless asked.',
    '- Say phone numbers in groups, the British way, for example "oh seven seven, double oh, nine double oh, four four four".',
    '- Spell names back letter by letter when you check them.',
    '- Ask one question at a time and wait for the answer.',
    '- Never put more than two pieces of information in one reply. When you confirm a booking, give the day, date, time and who it’s with first and check that’s right; then, in the next replies, the address and arrival tip, then the cancellation policy.',
    ...(beauty ? [
      '- For a concern after a treatment, stay with the safety steps however the caller pushes: the clinic’s emergency line is how they get help, so read it out slowly, ask them to ring it now, and read it again if they ask.',
      '- The details of an urgent call reach the team as an emergency alert the moment the call ends, so you can truthfully say you’re letting the team know straight away.',
      '- If the caller asks about 999 or A&E, don’t tell them not to go and don’t suggest it yourself. Say kindly that you can’t give medical advice, that the quickest help with a treatment concern is the clinic’s emergency line, and ask them to ring it now.',
    ] : []),
    '- It is now {{current_time_Europe/London}} (UK time). Use it to work out dates such as "next Tuesday", and always say the day and the date together.',
    '- The caller is ringing from {{user_number}}. To check it, read back only the last three digits ("is the number ending four one one the best one to reach you?"). If it shows as unknown or withheld, ask for their number and read it all back.',
    `- When the caller is done, sum up in one sentence what happens next, thank them, then use end_call.`,
    ...(canTransfer ? ['- For a concern after a treatment, say "I’m putting you straight through to the clinic now", then use transfer_to_clinic_emergency_line. If the transfer fails, give them the emergency line number and say the team is being alerted.'] : []),
    '- If you cannot do something, say so plainly and offer to pass a message on.',
  ];

  const demoRules = o.demo ? [
    '## This is a demonstration line',
    `- This number is a working demonstration of ${o.demo.company}'s receptionist for ${beauty ? 'beauty and aesthetics clinics' : 'businesses'}. ${name} is a sample business made up for the demo: its treatments, team, prices and address are examples.`,
    '- Act exactly as you would for a real clinic. Do not mention the demo unless the caller asks whether the business is real, asks about the demo, or asks how they could get this for their own business.',
    `- If they ask, say it is a demonstration of ${o.demo.company}'s receptionist, set up as a sample clinic. Offer to take their name, business name and number so ${o.demo.contact} at ${o.demo.company} can call them back, and say they can also book a 15-minute call at gainora.co.uk.`,
    '- Bookings on this line are examples: offer realistic free times within the opening hours and confirm them as you would for real, then say they’ll get a text confirming the details.',
    '- Never claim the clinic or its team are real if asked directly.',
    '- Stay in role for every kind of call, including concerns after a treatment: follow the safety steps exactly as you would for the real clinic, so the caller hears how it works. Only mention the demo when one of the questions above is asked.',
  ] : [];

  const recognise = o.recogniseCallers ?? featuresOf(s).callers.on;
  const general_prompt = [
    persona.join('\n'),
    '',
    pack.text,
    '',
    ...(recognise ? [callerRules(s), ''] : []),
    retellRules.join('\n'),
    ...(demoRules.length ? ['', demoRules.join('\n')] : []),
  ].join('\n');

  const llm = {
    start_speaker: 'agent',
    // Retell can't tell morning from evening on an inbound call, so the spoken greeting is a warm "Hello".
    begin_message: greetingFor(s).replace(/^Good (morning|afternoon|evening)/, 'Hello'),
    general_prompt,
    general_tools: tools,
    model_config: { type: 'cascading', primary: { model: 'CHOOSE_IN_DASHBOARD' }, temperature: 0.3 },
  };
  todo.push('Model: pick Retell’s recommended fast model for phone calls in the dashboard (the API value changes as Retell adds models).');

  const analysis: Record<string, unknown>[] = [
    { type: 'system-presets', name: 'call_summary' },
    { type: 'string', name: 'caller_name', description: 'The caller’s full name, as they spelled it.', examples: ['Chloe Martin'], required: false },
    { type: 'string', name: 'callback_number', description: 'The best number to call the caller back on, if different from the number they called from.', required: false },
    { type: 'string', name: 'email', description: 'The caller’s email address, only if they gave one.', required: false },
    { type: 'enum', name: 'new_or_returning', description: `Whether the caller is a new or returning ${appts ? 'client' : 'customer'}${recognise ? ' (returning if they said so, or their name matched the record for their number)' : ''}.`, choices: ['new', 'returning', 'unknown'], required: false },
    { type: 'string', name: 'appointment_type', description: appts ? `What they wanted to book, using the business's appointment names: ${s.bookings.types.map((t) => t.name).join(', ') || 'none listed'}.` : 'What the job is.', required: false },
    { type: 'string', name: 'preferred_times', description: 'The days and times that suit them, in their words.', required: false },
    { type: 'enum', name: 'call_type', description: 'The main reason for the call.', choices: beauty
      ? ['new booking', 'consultation', 'patch test', 'returning client booking', 'move appointment', 'cancel appointment', 'running late', 'price or treatment question', 'medical question', 'aftercare question', 'concern after treatment', 'complaint', 'gift voucher', 'group booking', 'waiting list', 'message for the team', 'opening hours or directions', 'job, supplier or delivery', 'sales call', 'wrong number', 'other']
      : ['new enquiry', 'booking', 'move or cancel', 'question', 'urgent', 'complaint', 'message', 'sales call', 'wrong number', 'other'], required: false },
    { type: 'boolean', name: 'booked', description: 'True only if a specific day and time was agreed on the call.', required: false },
    { type: 'string', name: 'booked_for', description: 'If booked: the agreed date and time as ISO 8601 with the UK offset, for example 2026-11-14T10:00:00+00:00. Leave empty if no exact time was agreed.', required: false },
    { type: 'string', name: 'booked_with', description: 'If booked: the first name of the team member the appointment is with, if one was agreed.', required: false },
    { type: 'boolean', name: 'urgent_concern', description: beauty ? 'True if the caller described any concern after a treatment from the safety list.' : 'True if the call was urgent or an emergency.', required: false },
    ...(o.demo ? [{ type: 'boolean', name: 'demo_lead', description: `True if the caller asked about getting this receptionist for their own business.`, required: false }] : []),
  ];

  const keywords = [name, ...s.bookings.types.map((t) => t.name), ...lines(s.bookings.staff).map((n) => n.split(' ')[0])].filter(Boolean).slice(0, 40);

  const agent: Record<string, unknown> = {
    agent_name: `${name} receptionist${o.demo ? ' (demo)' : ''}`,
    response_engine: { type: 'retell-llm', llm_id: 'FILLED_IN_AFTER_CREATING_THE_LLM' },
    voice_id: o.voiceId || 'CHOOSE_IN_DASHBOARD',
    language: 'en-GB',
    // Sounding like a person (Retell create-agent settings, checked 8 Nov 2026). Starting points to audition, not final.
    voice_temperature: 1.1,
    voice_speed: 1,
    enable_dynamic_voice_speed: true,       // follows the caller's pace
    responsiveness: 0.85,                   // a beat before replying, like a person thinking
    enable_dynamic_responsiveness: true,
    interruption_sensitivity: 0.7,          // stops when the caller talks over her, but not at every cough
    begin_message_delay_ms: 600,            // the half-second pause of someone picking up the phone
    enable_backchannel: true,
    backchannel_frequency: 0.5,             // people don't "mm-hmm" at every pause
    backchannel_words: ['mm-hmm', 'yeah', 'right', 'okay'],
    boosted_keywords: keywords,
    ambient_sound: null,                    // try 'call-center' at volume 0.3 in the test calls; keep only if it sounds better
    end_call_after_silence_ms: 30000,
    max_call_duration_ms: 900000,
    data_storage_setting: s.calls.recording ? 'everything' : 'everything_except_pii',
    post_call_analysis_data: analysis,
    voicemail_option: null,
    ...(o.webhookUrl ? { webhook_url: o.webhookUrl, webhook_events: ['call_analyzed'] } : {}),
  };
  todo.push('Sounding real: in the dashboard, turn on the Colloquial model, and Expressive mode with only the empathetic, happy and pause tags (Expressive mode works with Retell platform voices only, so audition 2–3 British female platform voices). Then one test call per change, keeping only what sounds better.');
  if (!o.voiceId) todo.push('Voice: a British woman’s voice. Audition the British female voices in the dashboard (the expressive, conversational ones, not the newsreader ones) with the test calls, and pick the one that sounds most like a friendly receptionist. Keep the speed at 1, or just under if she sounds rushed.');
  if (!o.webhookUrl) todo.push('Webhook: paste the enquiry link from the app’s Receptionist → Connect tab into the agent’s webhook URL, with only the call_analyzed event, so every call lands in the inbox.');
  if (!s.calls.recording) todo.push('Recording is off for this client: check the data storage setting in the dashboard matches.');
  if (!o.demo && appts && s.bookings.mode !== 'callback' && s.bookings.status !== 'connected') todo.push(`Diary: connect ${s.bookings.system || 'the booking system'} and mark it connected in the app, so the receptionist can see free times${s.bookings.mode === 'book' ? ' and book them' : ''}. Until then the script makes her take details for a call back, so she never offers times she can't see.`);
  todo.push('Phone number: buy or connect a UK number in Retell and attach this agent to it for inbound calls.');
  if (recognise) todo.push(`Returning callers: on that phone number in Retell, set the Inbound Webhook URL to ${o.lookupUrl ? o.lookupUrl : 'the caller lookup link from the app (shown with the enquiry link when it is made)'}. Then ring from a number that has an enquiry in the inbox and check she asks your name first and then knows you.`);

  return { llm, agent, todo };
}
