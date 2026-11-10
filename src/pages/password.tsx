import { useState } from 'react';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { MAX_PASSWORD, MIN_PASSWORD, passwordProblem, setPasswordError } from '../lib/password';
import { Button, Field, useToast } from '../components/ui';

declare const __DEMO__: boolean;
const BASE = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? './' : '/';

/** A password box with a Show/Hide button, friendly to password managers. */
export function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; autoComplete: 'current-password' | 'new-password'; describedBy?: string; invalid?: boolean; shown: boolean; onToggle: () => void; placeholder?: string }) {
  return (
    <div className="pw-wrap">
      <input
        id={props.id} className="input" type={props.shown ? 'text' : 'password'} autoComplete={props.autoComplete} value={props.value}
        aria-describedby={props.describedBy} aria-invalid={props.invalid || undefined} maxLength={MAX_PASSWORD + 8} spellCheck={false} autoCapitalize="off"
        placeholder={props.placeholder} onChange={(e: any) => props.onChange(e.target.value)}
      />
      <button type="button" className="pw-toggle" aria-pressed={props.shown} aria-label={props.shown ? 'Hide password' : 'Show password'} onClick={props.onToggle}>{props.shown ? 'Hide' : 'Show'}</button>
    </div>
  );
}

/** The two boxes for choosing a password, used straight after a link sign-in and in Settings. */
function NewPasswordFields({ email, onSaved, cta, light }: { email: string; onSaved: () => void; cta: string; light?: boolean }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: any) => {
    e.preventDefault();
    const problem = passwordProblem(pw, again, email);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try { await api.setPassword(pw); onSaved(); } catch (err: any) { setError(setPasswordError(err)); } finally { setBusy(false); }
  };
  return (
    <form className={light ? 'stack gap-16' : 'stack gap-24'} onSubmit={submit} noValidate>
      {/* Lets password managers save the new password against the right email. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label="New password" help={`At least ${MIN_PASSWORD} characters. Three or four words you’ll remember work well.`}>
        {(id, d) => <PasswordInput id={id} value={pw} onChange={setPw} autoComplete="new-password" describedBy={d} shown={shown} onToggle={() => setShown(!shown)} />}
      </Field>
      <Field label="Type it again" error={error ?? undefined}>
        {(id, d) => <PasswordInput id={id} value={again} onChange={setAgain} autoComplete="new-password" describedBy={d} invalid={!!error} shown={shown} onToggle={() => setShown(!shown)} />}
      </Field>
      <div><Button type="submit" block={!light} small={light} busy={busy}>{cta}</Button></div>
    </form>
  );
}

/** Shown before the app opens, straight after an email-link sign-in (or when they've never chosen a password). */
export function SetPassword({ user, onDone }: { user: User; onDone: () => void }) {
  const first = user.passwordStep !== 'new';
  return (
    <div className="signin">
      <section className="signin-art" aria-label="About Gainora">
        <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
        <div>
          <p className="signin-quote">One login for everything Gainora.</p>
          <p className="signin-lede">Your email and password open Command Centre and Capture &amp; Convert. Nobody gets in by knowing your email alone.</p>
        </div>
        <div className="signin-agents">
          <div><strong>Email and password</strong><span>How you sign in from now on</span></div>
          <div><strong>Forgotten it?</strong><span>We email you a link to choose a new one</span></div>
          <div><strong>Both apps</strong><span>The same password works in each</span></div>
        </div>
      </section>
      <section className="signin-form">
        <div className="signin-card">
          <div className="stack gap-8">
            <h1 className="title">{first ? 'Create your password' : 'Choose your password'}</h1>
            <p className="muted">{first
              ? <>You’re signed in as <strong style={{ color: '#F6F2EA' }}>{user.email}</strong>. Choose a password, and from now on you’ll sign in with your email and this password.</>
              : <>You signed in with an email link. Set the password you’ll use from now on for <strong style={{ color: '#F6F2EA' }}>{user.email}</strong>. It can be the one you had before.</>}</p>
          </div>
          <NewPasswordFields email={user.email} onSaved={onDone} cta="Save password and continue" />
          <p className="signin-foot">Not you? <button type="button" className="linklike" onClick={async () => { await api.signOut(); location.reload(); }}>Sign out</button></p>
        </div>
      </section>
    </div>
  );
}

/** Settings → Account: change the password. */
export function ChangePassword({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  if (!open) return <Button kind="secondary" icon="lock" onClick={() => setOpen(true)}>Change password</Button>;
  return (
    <div className="change-pw">
      <NewPasswordFields email={email} light cta="Save new password" onSaved={() => { setOpen(false); toast('Password changed. Use it next time you sign in, in both Gainora apps.'); }} />
      <Button kind="quiet" small onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
