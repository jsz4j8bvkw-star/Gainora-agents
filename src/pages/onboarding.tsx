import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { BusinessProfile } from '../lib/types';
import { SECTIONS, emptyProfile, getPath, normaliseUrl, sectionComplete, setPath, validateSection, type Field as Q } from '../lib/questions';
import { Button, Choices, Field, Icon } from '../components/ui';

declare const __DEMO__: boolean;
const BASE = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? './' : '/';

// Step 0 is the welcome, 1..n are the sections, n+1 is the review.
const LAST = SECTIONS.length + 1;

export function FieldInput({ f, profile, onChange, error }: { f: Q; profile: BusinessProfile; onChange: (path: string, v: any) => void; error?: string }) {
  const v = getPath(profile, f.path);
  if (f.kind === 'competitors') {
    const list = v as BusinessProfile['competitors']['list'];
    const set = (i: number, key: 'name' | 'url', val: string) => onChange(f.path, list.map((c, k) => (k === i ? { ...c, [key]: val } : c)));
    return (
      <Field label="Competitors" as="group" error={error} className={f.wide ? 'wide' : ''}>
        {() => (
          <div className="comp-list">
            {list.map((c, i) => (
              <div className="comp-row" key={i}>
                <input className="input" aria-label={`Competitor ${i + 1} name`} placeholder="Name" value={c.name} onChange={(e: any) => set(i, 'name', e.target.value)} />
                <input className="input" aria-label={`Competitor ${i + 1} website`} placeholder="Website" inputMode="url" value={c.url}
                  onChange={(e: any) => set(i, 'url', e.target.value)} onBlur={() => c.url && set(i, 'url', normaliseUrl(c.url))} aria-invalid={!!error} />
                <button type="button" className="icon-btn" aria-label={`Remove competitor ${i + 1}`} disabled={list.length === 1}
                  onClick={() => onChange(f.path, list.filter((_, k) => k !== i))}><Icon name="x" /></button>
              </div>
            ))}
            {list.length < 5 && (
              <div><Button kind="quiet" small icon="plus" onClick={() => onChange(f.path, [...list, { name: '', url: '' }])}>Add another competitor</Button></div>
            )}
          </div>
        )}
      </Field>
    );
  }
  const group = f.kind === 'chips' || f.kind === 'multi';
  return (
    <Field label={f.label} help={f.help} error={error} optional={f.optional} className={f.wide ? 'wide' : ''} as={group ? 'group' : 'label'}>
      {(id, d) => {
        const common = { id, 'aria-describedby': d, 'aria-invalid': !!error };
        switch (f.kind) {
          case 'textarea':
            return <textarea {...common} className="textarea" rows={3} placeholder={f.placeholder} value={v ?? ''} onChange={(e: any) => onChange(f.path, e.target.value)} />;
          case 'select':
            return (
              <select {...common} className="select" value={v ?? ''} onChange={(e: any) => onChange(f.path, e.target.value)}>
                <option value="" disabled>Choose one</option>
                {f.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            );
          case 'chips':
            return <Choices name={f.path} options={f.options!} value={v ?? ''} onChange={(x) => onChange(f.path, x)} describedBy={d} />;
          case 'multi':
            return <Choices name={f.path} multi options={f.options!} value={v ?? []} onChange={(x) => onChange(f.path, x)} describedBy={d} />;
          case 'money':
            return <div className="prefix-input"><span aria-hidden="true">£</span><input {...common} className="input" inputMode="decimal" placeholder={f.placeholder} value={v ?? ''} onChange={(e: any) => onChange(f.path, e.target.value)} /></div>;
          case 'number':
            return <input {...common} className="input" inputMode="numeric" placeholder={f.placeholder} value={v ?? ''} onChange={(e: any) => onChange(f.path, e.target.value)} />;
          case 'url':
            return <input {...common} className="input" type="url" inputMode="url" autoComplete="url" placeholder={f.placeholder} value={v ?? ''} onChange={(e: any) => onChange(f.path, e.target.value)} onBlur={() => v && onChange(f.path, normaliseUrl(v))} />;
          case 'email':
            return <input {...common} className="input" type="email" inputMode="email" placeholder={f.placeholder} value={v ?? ''} onChange={(e: any) => onChange(f.path, e.target.value)} />;
          default:
            return <input {...common} className="input" type="text" placeholder={f.placeholder} value={v ?? ''} onChange={(e: any) => onChange(f.path, e.target.value)} />;
        }
      }}
    </Field>
  );
}

function display(v: any): string {
  if (Array.isArray(v)) return v.length ? (typeof v[0] === 'string' ? v.join(', ') : v.filter((c: any) => c.name || c.url).map((c: any) => `${c.name} (${c.url.replace(/^https?:\/\//, '')})`).join(', ')) : '–';
  return String(v ?? '').trim() || '–';
}

export function Onboarding({ initial, onDone }: { initial: BusinessProfile | null; onDone: (p: BusinessProfile) => void }) {
  const [profile, setProfile] = useState<BusinessProfile>(() => ({ ...emptyProfile(), ...(initial ?? {}) }));
  const [step, setStep] = useState(() => {
    if (!initial) return 0;
    const i = SECTIONS.findIndex((s) => !sectionComplete(s, initial));
    return i === -1 ? LAST : i + 1;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const headRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => { headRef.current?.focus(); window.scrollTo({ top: 0 }); }, [step]);

  const change = (path: string, v: any) => {
    setProfile((p) => {
      const next = setPath(p, path, v);
      clearTimeout(timer.current);
      setSaved('saving');
      timer.current = setTimeout(() => { api.saveProfile(next).then(() => setSaved('saved')).catch(() => setSaved('idle')); }, 700);
      return next;
    });
    if (errors[path]) setErrors((e) => { const { [path]: _, ...rest } = e; return rest; });
  };

  const next = () => {
    if (step >= 1 && step <= SECTIONS.length) {
      const errs = validateSection(SECTIONS[step - 1], profile);
      setErrors(errs);
      if (Object.keys(errs).length) {
        setTimeout(() => (document.querySelector('[aria-invalid="true"], .field-error') as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
        return;
      }
    }
    setErrors({});
    setStep((s) => Math.min(LAST, s + 1));
  };

  const finish = async () => {
    const bad = SECTIONS.findIndex((s) => !sectionComplete(s, profile));
    if (bad !== -1) { setStep(bad + 1); setErrors(validateSection(SECTIONS[bad], profile)); return; }
    setFinishing(true); setFinishError(null);
    const done = { ...profile, competitors: { ...profile.competitors, list: profile.competitors.list.filter((c) => c.name.trim() || c.url.trim()) }, completedAt: new Date().toISOString() };
    try { await api.saveProfile(done); onDone(done); }
    catch (e: any) { setFinishError(e?.message || 'We couldn’t save your answers. Check your connection and try again.'); setFinishing(false); }
  };

  const reachable = (i: number) => i === 0 || i <= step || SECTIONS.slice(0, i - 1).every((s) => sectionComplete(s, profile));
  const section = step >= 1 && step <= SECTIONS.length ? SECTIONS[step - 1] : null;
  const pct = Math.round((step / LAST) * 100);

  if (step === 0) {
    const fillSample = api.fillSample ? () => { const smp = api.fillSample!(); setProfile(smp); api.saveProfile(smp); setStep(LAST); } : null;
    return <Welcome headRef={headRef} onBegin={next} onSample={fillSample} />;
  }

  return (
    <div className="ob">
      <aside className="ob-side">
        <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
        <ol className="ob-steps" aria-label="Setup steps">
          {SECTIONS.map((s, i) => {
            const n = i + 1;
            const done = sectionComplete(s, profile) && step > n;
            return (
              <li key={s.id} className={done ? 'done' : ''}>
                <button type="button" disabled={!reachable(n)} aria-current={step === n ? 'step' : undefined} onClick={() => { setErrors({}); setStep(n); }}>
                  <span className="num">{done && <Icon name="check" />}</span>{s.title}
                </button>
              </li>
            );
          })}
          <li className="">
            <button type="button" disabled={!reachable(LAST)} aria-current={step === LAST ? 'step' : undefined} onClick={() => setStep(LAST)}>
              <span className="num" />Review
            </button>
          </li>
        </ol>
        <p className="ob-note">Your answers save as you go. Only you and your agents can see them.</p>
        <span className="xsmall ob-count-m" style={{ color: '#8E8A82' }} aria-hidden="true">{step > 0 && step < LAST ? `${step} of ${SECTIONS.length}` : ''}</span>
      </aside>
      <div className="ob-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>

      <main className="ob-main">
        <div className="ob-inner step-in" key={step}>
          {section && (
            <>
              <div className="ob-count">Step {step} of {SECTIONS.length}: {section.title}</div>
              <h1 className="title ob-q" tabIndex={-1} ref={headRef}>{section.question}</h1>
              <p className="ob-intro">{section.intro}</p>
              {Object.keys(errors).length > 0 && <div className="err mt-24" role="alert">A few answers need attention before you continue.</div>}
              <div className="ob-fields">
                {section.fields.map((f) => <FieldInput key={f.path} f={f} profile={profile} onChange={change} error={errors[f.path]} />)}
              </div>
              <div className="ob-foot">
                <Button kind="secondary" icon="back" onClick={() => { setErrors({}); setStep(step - 1); }}>Back</Button>
                <span className="ob-saved" aria-live="polite">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'All changes saved' : ''}</span>
                <Button onClick={next}>{step === SECTIONS.length ? 'Review answers' : 'Continue'}</Button>
              </div>
            </>
          )}

          {step === LAST && (
            <>
              <div className="ob-count">Last step</div>
              <h1 className="title ob-q" tabIndex={-1} ref={headRef}>Check your answers, {profile.business.ownerName || 'and you’re done'}.</h1>
              <p className="ob-intro">Your agents start as soon as you confirm. You can edit any of this later under Your business.</p>
              <div className="review">
                {SECTIONS.map((s, i) => (
                  <section className="panel review-block" key={s.id} aria-labelledby={`rv-${s.id}`}>
                    <div className="split">
                      <h2 className="subhead" id={`rv-${s.id}`}>{s.title}</h2>
                      <Button kind="quiet" small icon="pencil" onClick={() => setStep(i + 1)}>Edit</Button>
                    </div>
                    <dl>
                      {s.fields.map((f) => <div key={f.path} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{display(getPath(profile, f.path))}</dd></div>)}
                    </dl>
                  </section>
                ))}
              </div>
              {finishError && <div className="err mt-24" role="alert">{finishError}</div>}
              <div className="ob-foot">
                <Button kind="secondary" icon="back" onClick={() => setStep(SECTIONS.length)}>Back</Button>
                <Button busy={finishing} onClick={finish}>Start my agents</Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** The first screen a new client sees: what Gainora will ask, and what happens after. */
function Welcome({ headRef, onBegin, onSample }: { headRef: any; onBegin: () => void; onSample: (() => void) | null }) {
  const total = SECTIONS.reduce((n, sec) => n + sec.fields.length, 0);
  return (
    <div className="welcome">
      <header className="welcome-top">
        <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
        <span className="welcome-save"><Icon name="lock" />Private to your business</span>
      </header>

      <main className="welcome-main">
        <div className="welcome-copy">
          <h1 tabIndex={-1} ref={headRef} className="welcome-title">
            <span className="w-line">Welcome to Gainora.</span>
            <span className="w-line w-sub">Let’s get to know your business.</span>
          </h1>
          <p className="welcome-lede w-fade">Your agents work from what you tell them here: who you sell to, who you compete with and what you want to achieve. The more specific you are, the sharper their work from the first week.</p>
          <div className="welcome-actions w-fade">
            <button type="button" className="btn welcome-cta" onClick={onBegin}>Begin</button>
            <span className="welcome-time">About 8 minutes. Your answers save as you go.</span>
          </div>
          {onSample && <button type="button" className="welcome-sample w-fade" onClick={onSample}>Fill in sample answers instead</button>}
        </div>

        <section className="welcome-plan w-fade" aria-labelledby="w-plan">
          <div className="welcome-plan-head"><h2 id="w-plan">What we’ll cover</h2><span>{total} questions</span></div>
          <ol>
            {SECTIONS.map((sec, i) => (
              <li key={sec.id}>
                <span className="w-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="w-name">{sec.title}</span>
                <span className="w-count">{sec.fields.length} {sec.fields.length === 1 ? 'question' : 'questions'}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="welcome-next w-fade" aria-label="What happens next">
        <div><strong>Today</strong><span>You answer seven short sections. Rough numbers are fine.</span></div>
        <div><strong>Within 24 hours</strong><span>The Watcher runs its first check and The Scout starts its first research.</span></div>
        <div><strong>Every week</strong><span>Your briefing arrives on the day and time you choose.</span></div>
      </footer>
    </div>
  );
}
