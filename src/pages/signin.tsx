import { useEffect, useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { linkErrorFromHash, passwordSignInError } from '../lib/password';
import { Button, Field } from '../components/ui';
import { PasswordInput } from './password';

declare const __DEMO__: boolean;
const BASE = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? './' : '/';
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
      await api.requestSignIn(email.trim());
      if (demo) onSignedIn(); else setMode('sent');
    } catch (err: any) {
      setError(err?.status === 422 || err?.status === 400
        ? 'We couldn’t find a subscription for that email. Use the address on your Stripe receipt.'
        : humanThrown(err, 'Sign-in failed. Try again.'));
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
                ? 'This is a demo. Enter any email address to look around.'
                : 'First time here, or forgotten your password? We’ll email you a secure link. Opening it signs you in and asks you to choose a password.'}</p>
            </div>
            {emailField}
            <Button type="submit" block busy={busy}>{demo ? 'Open the demo' : 'Email me a link'}</Button>
            {!demo && <p className="signin-foot">Got a password? <button type="button" className="linklike" onClick={() => go('password')}>Sign in with it</button></p>}
            <p className="signin-foot">Not a client yet? <a href="https://gainora.co.uk/shop/">See plans</a></p>
          </form>
        ) : (
          <form className="signin-card" onSubmit={signIn} noValidate>
            <div className="stack gap-8">
              <h1 className="title">Sign in</h1>
              <p className="muted">Your email and Gainora password. The same login works in Capture &amp; Convert.</p>
            </div>
            {emailField}
            <Field label="Password" error={pwError ?? undefined}>
              {(id, d) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" describedBy={d} invalid={!!pwError} shown={shown} onToggle={() => setShown(!shown)} />}
            </Field>
            <Button type="submit" block busy={busy}>Sign in</Button>
            <p className="signin-foot">First time here, or forgotten your password? <button type="button" className="linklike" onClick={() => go('link')}>Email me a sign-in link</button></p>
            <p className="signin-foot">Not a client yet? <a href="https://gainora.co.uk/shop/">See plans</a></p>
          </form>
        )}
      </section>
    </div>
  );
}
