// Passwords for the Gainora login, shared by Command Centre and Capture & Convert (one login, both apps).
// The first sign-in is by an emailed link. Straight after it the client chooses a password, and from then on
// they sign in with their email and that password. A link sign-in (the first time, or a forgotten password)
// always ends with choosing a password, so knowing someone's email is never enough to get in, and a link
// never becomes the everyday way in.

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72;   // Supabase (bcrypt) ignores anything past 72 characters

const TOO_EASY = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890', '87654321',
  'qwerty12', 'qwerty123', 'qwertyuiop', 'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'abc12345', 'abcd1234',
  'gainora1', 'gainora123', 'football', 'sunshine', 'princess', 'baseball', 'trustno1', 'superman', 'whatever',
]);

/** What's wrong with a new password, in plain words, or null when it's fine. */
export function passwordProblem(pw: string, again: string, email = ''): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > MAX_PASSWORD) return `Use ${MAX_PASSWORD} characters or fewer.`;
  const low = pw.trim().toLowerCase();
  const mail = email.trim().toLowerCase();
  const local = mail.split('@')[0];
  if (mail && (low === mail || (local.length >= 4 && low === local))) return 'Choose something other than your email address.';
  if (TOO_EASY.has(low) || /^(.)\1+$/.test(low) || /^(0123456789|1234567890|abcdefgh)/.test(low)) {
    return 'That one is too easy to guess. Three or four words you’ll remember work well.';
  }
  if (pw !== again) return 'The two passwords don’t match.';
  return null;
}

type AuthErr = { status?: number; code?: string; message?: string } | null | undefined;
const codeOf = (e: AuthErr) => String(e?.code || '').toLowerCase();

/** Plain words for a failed email-and-password sign-in. */
export function passwordSignInError(e: AuthErr): string {
  const code = codeOf(e); const msg = String(e?.message || '');
  if (code === 'invalid_credentials' || code === 'invalid_grant' || /invalid login credentials/i.test(msg)) {
    return 'That email and password don’t match. First time here, or forgotten it? Get a sign-in link below.';
  }
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Open the invitation we emailed you first. It signs you in and asks you to choose a password.';
  if (code === 'user_banned') return 'This login has been switched off. Email hello@gainora.co.uk and we’ll sort it out.';
  if (e?.status === 429 || /rate.?limit/.test(code)) return 'Too many tries in a short time. Wait a minute, or get a sign-in link below.';
  if (!e?.status) return 'Gainora couldn’t be reached. Check your connection and try again.';
  return msg && !/json|jwt|token/i.test(msg) ? msg : 'Sign-in didn’t work. Try again.';
}

/** Plain words for a failed attempt to save a password. */
export function setPasswordError(e: AuthErr): string {
  const code = codeOf(e); const msg = String(e?.message || '');
  if (code === 'weak_password') return msg || 'Choose a longer password, with a mix of letters and numbers.';
  if (code === 'reauthentication_needed' || code === 'reauthentication_not_valid') return 'For your security, get a new sign-in link and set your password straight after opening it.';
  if (e?.status === 401 || e?.status === 403) return 'Your sign-in has run out. Get a new sign-in link and set your password straight after opening it.';
  if (e?.status === 429) return 'Too many tries in a short time. Wait a minute and try again.';
  if (!e?.status) return 'Gainora couldn’t be reached. Check your connection and try again.';
  return msg && !/json|jwt|token/i.test(msg) ? msg : 'Your password couldn’t be saved. Try again.';
}

/** Supabase says the new password is the one they already have: that's fine, it's still their password. */
export function isSamePassword(code?: string, message?: string): boolean {
  return String(code || '').toLowerCase() === 'same_password' || /different from the old/i.test(String(message || ''));
}

/**
 * Which password screen comes before the app, if any: 'create' when they've never set one, 'new' straight after
 * an email-link sign-in (first time in this app, or they forgot it). Nothing once they've signed in with it.
 */
export function passwordStep(hasPassword: boolean | undefined, viaLink: boolean | undefined): 'create' | 'new' | undefined {
  if (!hasPassword) return 'create';
  return viaLink ? 'new' : undefined;
}

/** The error Supabase put in the address after a link that has expired or was already used, in plain words. */
export function linkErrorFromHash(hash: string): string | null {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  if (!h.get('error') && !h.get('error_code')) return null;
  const code = h.get('error_code') || '';
  if (/expired/i.test(code) || /expired|invalid/i.test(h.get('error_description') || '')) return 'That sign-in link has expired or was already used. Get a new one below.';
  return 'That sign-in link didn’t work. Get a new one below.';
}
