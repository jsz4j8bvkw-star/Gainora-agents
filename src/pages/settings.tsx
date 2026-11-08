import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Icon, useToast } from '../components/ui';
import { display, QField, SETUP, sectionErrors, setPath, type SetupSection } from './setup';
import { shortDate } from '../lib/format';
import type { CaptureSettings } from '../lib/types';

export function Settings() {
  const { user, plan, settings, enquiries, setSettings } = useApp();
  const [opening, setOpening] = useState(false);
  const toast = useToast();

  const manage = async () => {
    setOpening(true);
    try {
      const url = await api.billingUrl();
      if (url) location.href = url; else toast('Billing is managed through Stripe in the live app.');
    } catch (e: any) { toast(e?.message || 'Couldn’t open billing. Try again.'); }
    finally { setOpening(false); }
  };
  const rerun = async () => {
    const next = { ...settings, completedAt: undefined };
    try { await api.saveSettings(next); setSettings(next); } catch (e: any) { toast(e?.message || 'Couldn’t open setup. Try again.'); }
  };
  const exportData = () => {
    if (api.mode === 'demo') { toast('In your app this downloads a file. Downloads are switched off in the demo.'); return; }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings, enquiries }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gainora-capture-my-data.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page" style={{ maxWidth: 940 }}>
      <div className="page-head"><div><h1 className="title">Settings</h1><p className="lede">Your answers shape what your receptionist says and what Gainora drafts. Change them any time.</p></div></div>

      <section className="panel" aria-labelledby="plan-h">
        <div className="panel-head">
          <div>
            <h2 className="heading" id="plan-h">Gainora Capture &amp; Convert</h2>
            <p className="small faint">AI receptionist, enquiries inbox and follow-ups, managed by Gainora.{plan.renewsOn ? ` Renews ${shortDate(plan.renewsOn)}.` : ''}</p>
          </div>
          <Button kind="secondary" small busy={opening} onClick={manage}>Manage billing</Button>
        </div>
        <div className="plan-includes">
          {['Your receptionist set up, tested and looked after', 'Every enquiry in one inbox, emergencies emailed to you', 'Quote chasers, payment reminders and review requests drafted', 'Monthly report and a 15-minute review call'].map((t) => <span key={t}><Icon name="check" />{t}</span>)}
        </div>
        {plan.alsoCommandCentre
          ? <p className="small muted plan-foot">You also have Gainora Command Centre. <a href="https://app.gainora.co.uk">Open it</a> with the same login.</p>
          : <p className="small muted plan-foot">Want your website watched and new customers found too? <a href="https://gainora.co.uk/">See Gainora Command Centre</a>.</p>}
      </section>

      {SETUP.map((sec) => <SectionEditor key={sec.id} sec={sec} />)}

      <section className="panel review-block section" aria-labelledby="acct-h">
        <h2 className="heading" id="acct-h">Account</h2>
        <dl><dt>Signed in as</dt><dd>{user.email}</dd><dt>Your data</dt><dd>Download your answers and every enquiry as a file.</dd></dl>
        <div className="row gap-12 mt-24 wrap">
          <Button kind="secondary" icon="download" onClick={exportData}>Download my data</Button>
          <Button kind="secondary" icon="refresh" onClick={rerun}>Go through setup again</Button>
          <Button kind="secondary" icon="logout" onClick={async () => { await api.signOut(); location.reload(); }}>Sign out</Button>
        </div>
        <p className="xsmall faint mt-16">You control your customers’ information: delete any enquiry from its page. To close your account and delete everything, email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a>. We delete it within 30 days.</p>
      </section>
    </div>
  );
}

function SectionEditor({ sec }: { sec: SetupSection }) {
  const { settings, setSettings } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CaptureSettings>(settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    const e = sectionErrors(sec, draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await api.saveSettings(draft); setSettings(draft); setEditing(false); toast(sec.id === 'followUps' ? 'Saved.' : 'Saved. Copy your updated script from Receptionist.'); }
    catch (err: any) { toast(err?.message || 'That didn’t save. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel review-block section" aria-labelledby={`s-${sec.id}`}>
      <div className="split">
        <h2 className="heading" id={`s-${sec.id}`}>{sec.title}</h2>
        {!editing && <Button kind="quiet" small icon="pencil" onClick={() => { setDraft(settings); setErrors({}); setEditing(true); }}>Edit</Button>}
      </div>
      {!editing && (
        <dl>{sec.fields.filter((f) => !f.showIf || f.showIf(settings)).map((f) => <div key={f.path} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{display(f, settings)}</dd></div>)}</dl>
      )}
      {editing && (
        <>
          <div className="ob-fields settings-fields">{sec.fields.map((f) => <QField key={f.path} f={f} s={draft} error={errors[f.path]} onChange={(p, v) => setDraft(setPath(draft, p, v))} />)}</div>
          <div className="row gap-8 mt-24" style={{ justifyContent: 'flex-end' }}>
            <Button kind="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button busy={busy} onClick={save}>Save</Button>
          </div>
        </>
      )}
    </section>
  );
}
