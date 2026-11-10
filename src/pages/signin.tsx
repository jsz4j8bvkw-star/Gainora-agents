import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { BASE } from '../app';
import { linkErrorFromHash, passwordSignInError } from '../lib/password';
import { Button, Choices, Field } from '../components/ui';
import { PasswordInput } from './password';

const SAMPLES: { id: 'trade' | 'clinic' | 'beauty'; label: string }[] = [{ id: 'beauty', label: 'A beauty and aesthetics clinic' }, { id: 'clinic', label: 'A physio clinic' }, { id: 'trade', label: 'A plumber' }];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email and password, every time. The first time in (or after forgetting the password) they ask for an emailed
 * link instead; opening it signs them in and asks them to choose a password before the app opens.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const demo = api.mode === 'demo';
  const [mode, setMode] = useState<'password' | 'link' | 'sent'>(demo ? 'link' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [sample, setSample] = useState<'trade' | 'clinic' | 'beauty'>('beauty');

  // A link that expired or was already used lands back here with the reason in the address.
  useEffect(() => {
    if (demo) return;
    const why = linkErrorFromHash(location.hash);
    if (why) { setMode('link'); setError(why); history.replaceState(null, '', location.pathname); }
  }, []);

  const signIn = async (e: any) => {
    e.preventDefault();
    setError(null); setPwError(null);
    if (!EMAIL.test(email.trim())) { setError('Enter the email address you subscribed with.'); return; }
    if (!password) { setPwError('Enter your password.'); return; }
    setBusy(true);
    try { await api.signInWithPassword(email.trim(), password); onSignedIn(); }
    catch (err: any) { setPwError(passwordSignInError(err)); }
    finally { setBusy(false); }
  };

  const sendLink = async (e: any) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL.test(email.trim())) { setError('Enter the email address you subscribed with.'); return; }
    setBusy(true);
    try {
      await api.requestSignIn(email.trim(), sample);
      if (demo) onSignedIn(); else setMode('sent');
    } catch (err: any) {
      setError(err?.status === 422 || err?.status === 400
        ? 'We couldn’t find a subscription for that email. Use the address on your Stripe receipt.'
        : err?.message || 'Sign-in failed. Try again.');
    } finally { setBusy(false); }
  };

  const go = (m: 'password' | 'link') => { setMode(m); setError(null); setPwError(null); };
  const emailField = (
    <Field label="Email address" error={error ?? undefined}>
      {(id, d) => <input id={id} className="input" type="email" name="username" autoComplete="username" inputMode="email" value={email} aria-describedby={d} aria-invalid={!!error} onChange={(e: any) => setEmail(e.target.value)} placeholder="you@yourbusiness.co.uk" />}
    </Field>
  );

  return (
    <div className="signin">
      <section className="signin-art" aria-label="About Capture & Convert">
        <div>
          <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
          <span className="signin-product">Capture &amp; Convert</span>
        </div>
        <div>
          <p className="signin-quote">Every call answered. Every enquiry followed up.</p>
          <p className="signin-lede">Your AI receptionist picks up when you can’t. Gainora puts every enquiry in one place, flags emergencies straight to you, and drafts the follow-ups until they’re booked in.</p>
        </div>
        <div className="signin-agents">
          <div><strong>Answered</strong><span>Day and night, in your business name</span></div>
          <div><strong>Flagged</strong><span>Anything urgent sent to you straight away</span></div>
          <div><strong>Followed up</strong><span>Confirmations, reminders and reviews, drafted for you</span></div>
        </div>
      </section>
      <section className="signin-form">
        {mode === 'sent' ? (
          <div className="signin-card" role="status">
            <h1 className="title">Check your inbox</h1>
            <p className="muted">We’ve sent a sign-in link to <strong style={{ color: '#F6F2EA' }}>{email}</strong>. Open it on this device. It works for one hour.</p>
            <p className="muted">When it opens, you’ll choose your password. From then on you sign in here with your email and password.</p>
            <Button kind="secondary" onClick={() => go('password')}>Back to sign in</Button>
          </div>
        ) : mode === 'link' ? (
          <form className="signin-card" onSubmit={sendLink} noValidate>
            <div className="stack gap-8">
              <h1 className="title">{demo ? 'Sign in' : 'Get a sign-in link'}</h1>
              <p className="muted">{demo
                ? 'This is a demo with sample data. Enter any email address and pick a business to look around.'
                : 'First time here, or forgotten your password? We’ll email you a secure link. Opening it signs you in and asks you to choose a password.'}</p>
            </div>
            {emailField}
            {demo && (
              <Field label="Sample business" as="group">
                {(_, d) => <Choices name="sample" options={SAMPLES.map((x) => x.label)} value={SAMPLES.find((x) => x.id === sample)!.label} describedBy={d} onChange={(v: string) => setSample(SAMPLES.find((x) => x.label === v)!.id)} />}
              </Field>
            )}
            <Button type="submit" block busy={busy}>{demo ? 'Open the demo' : 'Email me a link'}</Button>
            {!demo && <p className="signin-foot">Got a password? <button type="button" className="linklike" onClick={() => go('password')}>Sign in with it</button></p>}
            <p className="signin-foot">Not a client yet? <a href="https://gainora.co.uk/">Book a free call</a></p>
          </form>
        ) : (
          <form className="signin-card" onSubmit={signIn} noValidate>
            <div className="stack gap-8">
              <h1 className="title">Sign in</h1>
              <p className="muted">Your email and Gainora password. The same login works in Command Centre.</p>
            </div>
            {emailField}
            <Field label="Password" error={pwError ?? undefined}>
              {(id, d) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" describedBy={d} invalid={!!pwError} shown={shown} onToggle={() => setShown(!shown)} />}
            </Field>
            <Button type="submit" block busy={busy}>Sign in</Button>
            <p className="signin-foot">First time here, or forgotten your password? <button type="button" className="linklike" onClick={() => go('link')}>Email me a sign-in link</button></p>
            <p className="signin-foot">Not a client yet? <a href="https://gainora.co.uk/">Book a free call</a></p>
          </form>
        )}
      </section>
    </div>
  );
}
