// Sending texts on the owner's behalf. Off by default: the app's normal mode is "send from your
// phone" (an sms: link the owner taps, then presses send). This is the place a provider plugs in.
//
// Twilio: set SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (a UK
// number or an alphanumeric sender id such as the clinic's name, up to 11 characters). Nothing is
// sent unless the owner approved the exact text in the app; the function only sends what it is given.
import { env, HttpError } from './core';

export interface SmsProvider {
  name: string;
  send(to: string, text: string): Promise<{ id: string }>;
}

/** Whether a provider is configured. The app reads this to decide what "Send now" means. */
export function smsProviderName(): string | null {
  const p = env('SMS_PROVIDER').toLowerCase();
  if (p === 'twilio' && env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM')) return 'twilio';
  return null;
}

function twilio(): SmsProvider {
  const sid = env('TWILIO_ACCOUNT_SID'); const token = env('TWILIO_AUTH_TOKEN'); const from = env('TWILIO_FROM');
  return {
    name: 'twilio',
    async send(to, text) {
      const body = new URLSearchParams({ To: to, From: from, Body: text });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body, signal: AbortSignal.timeout(15_000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) { console.error('[gainora] twilio', res.status, data?.code, data?.message); throw new HttpError(502, 'The text could not be sent. Try “Send from your phone”.'); }
      return { id: String(data.sid || '') };
    },
  };
}

/** The configured provider, or null when texts are sent from the owner's phone. */
export function smsProvider(): SmsProvider | null {
  return smsProviderName() === 'twilio' ? twilio() : null;
}

/** A UK mobile in E.164, the only kind of number a text may go to. */
export const isUkMobile = (to: string) => /^\+447\d{9}$/.test(to);
