import { useState } from 'react';
import { api } from '../lib/api';
import { BASE } from '../app';
import { Button, Choices, Field } from '../components/ui';

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<'trade' | 'clinic'>('trade');

  const submit = async (e: any) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter the email address you subscribed with.'); return; }
    setBusy(true); setError(null);
    try {
      await api.requestSignIn(email.trim(), sample);
      if (api.mode === 'demo') onSignedIn(); else setSent(true);
    } catch (err: any) {
      setError(err?.status === 422 || err?.status === 400
        ? 'We couldn’t find a subscription for that email. Use the address on your Stripe receipt.'
        : err?.message || 'Sign-in failed. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="signin">
      <section className="signin-art" aria-label="About Capture & Convert">
        <div>
          <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
          <span className="signin-product">Capture &amp; Convert</span>
        </div>
        <div>
          <p className="signin-quote">Every call answered. Every job followed up.</p>
          <p className="signin-lede">Your AI receptionist picks up when you can’t. Gainora puts every enquiry in one place, flags emergencies straight to you, and drafts the follow-ups until the job is booked and paid.</p>
        </div>
        <div className="signin-agents">
          <div><strong>Answered</strong><span>Day and night, in your business name</span></div>
          <div><strong>Flagged</strong><span>Emergencies to your phone in a minute</span></div>
          <div><strong>Followed up</strong><span>Quotes, payments and reviews, drafted for you</span></div>
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
                ? 'This is a demo with sample data. Enter any email address and pick a business to look around.'
                : 'Enter the email you subscribed with. We’ll send you a secure sign-in link. Your Gainora login works here too.'}</p>
            </div>
            <Field label="Email address" error={error ?? undefined}>
              {(id, d) => <input id={id} className="input" type="email" autoComplete="email" inputMode="email" value={email} aria-describedby={d} aria-invalid={!!error} onChange={(e: any) => setEmail(e.target.value)} placeholder="you@yourbusiness.co.uk" />}
            </Field>
            {api.mode === 'demo' && (
              <Field label="Sample business" as="group">
                {(_, d) => <Choices name="sample" options={['A plumber', 'A physio clinic']} value={sample === 'trade' ? 'A plumber' : 'A physio clinic'} describedBy={d} onChange={(v: string) => setSample(v === 'A plumber' ? 'trade' : 'clinic')} />}
              </Field>
            )}
            <Button type="submit" block busy={busy}>{api.mode === 'demo' ? 'Open the demo' : 'Send sign-in link'}</Button>
            <p className="signin-foot">Not a client yet? <a href="https://gainora.co.uk/">Book a free call</a></p>
          </form>
        )}
      </section>
    </div>
  );
}
