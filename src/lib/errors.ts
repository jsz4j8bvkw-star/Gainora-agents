// Turning what the network gives back into something a person can read.
//
// The two mistakes this guards against, both seen in the live app:
// 1. Calling res.json() on a body that is not JSON. PostgREST answers a POST upsert with
//    "201 Created" and an EMPTY body unless `Prefer: return=representation` is sent, so
//    res.json() throws "Unexpected end of JSON input" (Safari: "JSON Parse error: Unexpected EOF")
//    even though the save worked. Netlify's own error pages are HTML, not JSON.
// 2. Showing PostgREST or Supabase error text to the owner as if it were written for them.

/** Parses a response body as JSON when it is JSON, and returns undefined for anything else (empty, HTML, plain text). */
export function parseJsonBody(text: string | null | undefined): any {
  const t = (text ?? '').trim();
  if (!t) return undefined;
  if (!/^[[{"]/.test(t) && !/^(true|false|null|-?\d)/.test(t)) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** True when a message looks like it came from a database or a parser, not from a person. */
export function looksTechnical(message: string): boolean {
  return /json|syntax|unexpected (token|end|eof)|pgrst|postgres|relation|violates|constraint|null value|column|schema|duplicate key|jwt|invalid input|permission denied|fetch|network|typeerror|undefined|\bat line\b|stack/i.test(message);
}

export interface HumanErrorInput {
  status: number;
  body?: any;
  /** What the person was doing, in a few words ("saving your details"). */
  doing?: string;
}

/**
 * The sentence the owner reads when a request fails. Our own functions send `{ error }` written
 * for the owner, which is kept. Everything else (PostgREST codes, HTML error pages, timeouts) is
 * translated by status, and anything technical is never shown.
 */
export function humanError(input: HumanErrorInput): string {
  const { status, body } = input;
  const doing = input.doing ? ` ${input.doing}` : '';
  const own = typeof body?.error === 'string' ? body.error.trim() : '';
  if (own && !looksTechnical(own)) return own;
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (status === 403) return `You don’t have permission for that. If you think you should, email hello@gainora.co.uk.`;
  if (status === 404) return 'That no longer exists. Refresh the page and try again.';
  if (status === 409) return 'That clashes with something already saved. Refresh the page and try again.';
  if (status === 413) return 'That is too large to save. Shorten it and try again.';
  if (status === 429) {
    const msg = typeof body?.message === 'string' && !looksTechnical(body.message) ? body.message : '';
    return msg || 'Too many requests in a short time. Wait a minute and try again.';
  }
  if (status === 502 || status === 503 || status === 504) return `That took too long or the service didn’t answer${doing}. Try again in a minute.`;
  if (status >= 500) return `Something went wrong on our side${doing}. Try again in a minute.`;
  if (status === 400 || status === 422) {
    const msg = typeof body?.message === 'string' && !looksTechnical(body.message) ? body.message : '';
    return msg || `Something in what was sent could not be saved${doing}. Check the fields and try again.`;
  }
  if (status === 0) return 'No connection. Check your internet and try again.';
  return `Something went wrong${doing}. Try again.`;
}

/** The message to show for an exception thrown on the way (no response at all). */
export function humanThrown(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  if (!m || looksTechnical(m)) return fallback;
  return m;
}
