import { useState } from 'react';
import { api } from '../lib/api';
import { Button, Field } from '../components/ui';

declare const __DEMO__: boolean;
const BASE = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? './' : '/';

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: any) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter the email address you subscribed with.'); return; }
    setBusy(true); setError(null);
    try {
      await api.requestSignIn(email.trim());
      if (api.mode === 'demo') onSignedIn(); else setSent(true);
    } catch (err: any) {
      setError(err?.status === 422 || err?.status === 400
        ? 'We couldn’t find a subscription for that email. Use the address on your Stripe receipt.'
        : err?.message || 'Sign-in failed. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="signin">
      <section className="signin-art" aria-label="About Gainora">
        <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
        <div>
          <p className="signin-quote">Your business, watched over while you run it.</p>
          <p className="signin-lede">Three agents that check your website, find new customers and turn your numbers into a clear plan for the week.</p>
        </div>
        <div className="signin-agents">
          <div><strong>The Watcher</strong><span>Your website and competitors, every morning</span></div>
          <div><strong>The Scout</strong><span>New customers, each with a source</span></div>
          <div><strong>The Brief</strong><span>Your week in three priorities</span></div>
        </div>
      </section>
      <section className="signin-form">
        {sent ? (
          <div className="signin-card" role="status">
            <h1 className="title">Check your inbox</h1>
            <p className="muted">We’ve sent a sign-in link to <strong style={{ color: '#F6F2EA' }}>{email}</strong>. Open it on this device. It works for one hour.</p>
            <Button kind="secondary" onClick={() => setSent(false)}>Use a different email</Button>
          </div>
        ) : (
          <form className="signin-card" onSubmit={submit} noValidate>
            <div className="stack gap-8">
              <h1 className="title">Sign in</h1>
              <p className="muted">{api.mode === 'demo'
                ? 'This is a demo. Enter any email address to look around.'
                : 'Enter the email you subscribed with. We’ll send you a secure sign-in link.'}</p>
            </div>
            <Field label="Email address" error={error ?? undefined}>
              {(id, d) => <input id={id} className="input" type="email" autoComplete="email" inputMode="email" value={email} aria-describedby={d} aria-invalid={!!error} onChange={(e: any) => setEmail(e.target.value)} placeholder="you@yourbusiness.co.uk" />}
            </Field>
            <Button type="submit" block busy={busy}>{api.mode === 'demo' ? 'Open the demo' : 'Send sign-in link'}</Button>
            <p className="signin-foot">Not a client yet? <a href="https://gainora.co.uk/shop/">See plans</a></p>
          </form>
        )}
      </section>
    </div>
  );
}
