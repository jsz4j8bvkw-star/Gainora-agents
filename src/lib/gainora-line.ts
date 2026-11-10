// Gainora's own phone line: the receptionist answers for Gainora, books the free 15-minute diagnostic call
// with Adelin into hello@'s diary, and can show a caller how she'd answer for their business.
// These are the settings hello@gainora.co.uk's Capture & Convert runs on; the Retell script is built from them
// by shared/retell-gainora.ts (node scripts/retell-export.mjs gainora).
import { defaultAutomations } from '../../shared/automations';
import { GAINORA_DIARY, type CaptureSettings } from '../../shared/capture';
import type { GainoraPrices } from '../../shared/retell-gainora';

export type { GainoraPrices };


/** A copy of the website's prices on 10 November 2026, used when the website repo isn't next to this one. */
export const GAINORA_PRICES: GainoraPrices = {
  audit: '£495', auditCreditDays: '30', commandCentre: '£299',
  launchGrow: { setup: '£1,995', monthly: '£595', minimumMonths: '3' },
  bundle: { setup: '£2,295', monthly: '£795', separateSetup: '£2,590', separateMonthly: '£844' },
  cc: {
    never: { name: 'Never Miss a Call', setup: '£595', monthly: '£249', minutes: '300' },
    booking: { name: 'Call to Booking', setup: '£995', monthly: '£399', minutes: '600' },
    desk: { name: 'Full Front Desk', setup: '£1,995', monthly: '£599', minutes: '1,200' },
    extraMinutes: '£25 per 100 extra minutes', minimumMonths: '3',
  },
  partner: { audit: '£495', focused: '£4,950', core: '£7,500', whole: '£12,500', monthly: '£950', minimumMonths: '3' },
};

/** The one thing people can book with Gainora, by phone or on the booking page. 15 minutes, with 30 kept free after it so nobody is rushed. */
export const DIAGNOSTIC = '15-minute diagnostic call';

export function gainoraLineSettings(since = new Date().toISOString()): CaptureSettings {
  const automations = defaultAutomations('appointments', since);
  // Only the messages a caller expects after ringing: a thank-you, the booking confirmation and the reminder.
  for (const [id, wf] of Object.entries(automations)) wf.on = id === 'ack' || id === 'booking';
  const step = (text: string, subject: string, wait = 0) => ({ on: true, channel: 'text' as const, ask: false, text, subject, wait });
  automations.ack.steps.ack = step('Hi {first name}, thanks for calling Gainora. Your message is with Adelin. If you’d like a free 15-minute call, just reply here or book at gainora.co.uk.', 'Thanks for calling Gainora');
  automations.booking.steps.confirm = step('Hi {first name}, you’re booked in for a free 15-minute call with {who} from Gainora on {day} {date} at {time}. He’ll ring you on this number, or send a video link if you asked for one. Need to move it? Just reply to this message.', 'Your call with Gainora is booked');
  automations.booking.steps.reminder = step('Hi {first name}, a reminder of your free call with {who} from Gainora {when} at {time}. Reply to this message if you need to move it.', 'A reminder of your call with Gainora', 1);

  return {
    business: {
      kind: 'appointments', name: 'Gainora', ownerName: 'Adelin', trade: 'Business growth and automation',
      location: 'United Kingdom', website: 'https://gainora.co.uk', phone: '',
      alertEmail: 'hello@gainora.co.uk', alertMobile: '',
    },
    work: {
      services: 'Capture & Convert: a receptionist that answers every call, and follow-ups that send themselves\nLaunch & Grow: website, Google Business Profile, reviews and ads\nCommand Centre: a weekly watch on the business and a plain-English brief\nGrowth & Operations Partner: fixing how the business runs\nBusiness Audit',
      notDone: 'Legal, accounting, tax or regulatory advice\nMarketing messages to people who haven’t asked for them',
      areas: 'Anywhere in the UK, by phone and video',
    },
    calls: {
      // Diary hours match the website's booking calendar: weekdays, 9am to 4:30pm.
      days: [1, 2, 3, 4, 5], open: '09:00', close: '16:30',
      emergencies: '', transferTo: '', quotePolicy: 'fixed', priceNotes: '',
      booking: 'calendar', gasWork: false, recording: true, notify: 'all',
      greeting: 'Hello, you’re through to Gainora. How can I help?', announceAi: false, safety: '',
      emergencyLine: '', transferEmergency: false, alertText: 'urgent',
    },
    bookings: {
      system: GAINORA_DIARY, systemOther: '', account: 'Gainora', mode: 'book',
      address: 'By phone or video', arrival: '',
      types: [{ name: DIAGNOSTIC, minutes: 15, price: 'Free', who: 'Adelin' }],
      staff: 'Adelin', noticeHours: 2, aheadWeeks: 4,
      cancellation: 'If the time stops working, just reply to your confirmation and we’ll move it.',
      deposit: '', depositLink: '', depositOn: false, status: 'connected',
    },
    followUps: { reviewLink: '', payLink: '', paymentDays: 0 },
    provider: { name: 'Retell', aiNumber: '' },
    automations,
    texting: { number: '', status: 'off' },
    // Gainora's own booking page (capture.gainora.co.uk/book/gainora), shown on gainora.co.uk/book: the same page clients get.
    page: { on: true, slug: 'gainora', mode: 'book', intro: 'A free call about what isn’t working. Adelin asks the questions that matter and tells you honestly which package fits, or whether none does. By phone or video, whichever you prefer.', showPrices: true, types: [], chooseStaff: false, accent: '#7A6436' },
    diary: { step: 30, buffer: 30 },
    completedAt: since,
  };
}
