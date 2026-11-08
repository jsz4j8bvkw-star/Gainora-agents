import { useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Icon, useLoad, useToast } from '../components/ui';
import { learnFrom } from '../../shared/learning';
import { relative } from '../lib/format';
import { FieldInput } from './onboarding';
import { SECTIONS, getPath, setPath, validateSection, type Section } from '../lib/questions';
import type { BusinessProfile } from '../lib/types';

function show(v: any): string {
  if (Array.isArray(v)) {
    if (!v.length) return '–';
    return typeof v[0] === 'string' ? v.join(', ') : v.filter((c: any) => c.name || c.url).map((c: any) => `${c.name} (${String(c.url).replace(/^https?:\/\//, '')})`).join(', ');
  }
  return String(v ?? '').trim() || '–';
}

export function SectionEditor({ section, profile, onSaved }: { section: Section; profile: BusinessProfile; onSaved: (p: BusinessProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    const errs = validateSection(section, draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try { await api.saveProfile(draft); onSaved(draft); setEditing(false); toast(`${section.title} saved`); }
    catch (e: any) { toast(humanThrown(e, 'Couldn’t save. Try again.')); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel review-block" aria-labelledby={`pf-${section.id}`}>
      <div className="split">
        <h2 className="heading" id={`pf-${section.id}`}>{section.title}</h2>
        {!editing && <Button kind="quiet" small icon="pencil" onClick={() => { setDraft(profile); setErrors({}); setEditing(true); }}>Edit</Button>}
      </div>
      {editing ? (
        <>
          <div className="ob-fields" style={{ marginTop: 24 }}>
            {section.fields.map((f) => <FieldInput key={f.path} f={f} profile={draft} error={errors[f.path]} onChange={(path, v) => setDraft((d) => setPath(d, path, v))} />)}
          </div>
          <div className="row gap-12 mt-24" style={{ justifyContent: 'flex-end' }}>
            <Button kind="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button busy={busy} onClick={save}>Save changes</Button>
          </div>
        </>
      ) : (
        <dl>{section.fields.map((f) => <div key={f.path} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{show(getPath(profile, f.path))}</dd></div>)}</dl>
      )}
    </section>
  );
}

export function Profile() {
  const { profile, setProfile } = useApp();
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1 className="title">Your business</h1>
          <p className="lede">Everything your agents know about {profile.business.name}. Keep it current and their work gets sharper: a new competitor, a new product or a new goal all change what they look for.</p>
        </div>
      </div>
      <div className="row gap-12 small muted" style={{ marginBottom: 20 }}><Icon name="lock" /><span>Private to your account. Gainora never shares your details or numbers.</span></div>
      <div className="review" style={{ marginTop: 0 }}>
        {SECTIONS.filter((s) => s.id !== 'preferences').map((s) => (
          <SectionEditor key={s.id} section={s} profile={profile} onSaved={setProfile} />
        ))}
      </div>
      <Learned />
    </div>
  );
}

/** Shows what the agents have learned from "Useful" and "Not relevant", with a way to undo each answer. */
function Learned() {
  const { data, setData } = useLoad(() => api.listFeedback());
  const toast = useToast();
  if (!data) return null;
  const rules = learnFrom(data).rules;
  const forget = async (id: string) => {
    setData(data.filter((f) => f.id !== id));
    try { await api.forgetFeedback(id); toast('Removed. Your agents will no longer use that answer.'); }
    catch { toast('That didn’t save. Try again.'); }
  };
  return (
    <section className="panel review-block section" aria-labelledby="learn-h">
      <h2 className="heading" id="learn-h">What your agents have learned</h2>
      <p className="small muted mt-8">Every time you mark something “Useful” or “Not relevant”, your agents adjust what they look for. You can remove any answer here.</p>
      {data.length === 0 ? (
        <p className="muted mt-16">Nothing yet. Use the “Useful” and “Not relevant” buttons on leads, contracts and competitor changes to teach your agents what matters to you.</p>
      ) : (
        <>
          {rules.length > 0 && <ul className="learn-rules mt-16">{rules.map((r) => <li key={r}>{r}</li>)}</ul>}
          <ul className="learn-list mt-16">
            {data.slice(0, 30).map((f) => (
              <li key={f.id}>
                <span className={`tag ${f.verdict === 'useful' ? 'tag-forest' : 'tag-plain'}`}>{f.verdict === 'useful' ? 'Useful' : 'Not relevant'}</span>
                <span className="learn-text">{f.text}{f.reason ? <span className="faint"> ({f.reason})</span> : null}</span>
                <span className="xsmall faint">{relative(f.createdAt)}</span>
                <button className="btn btn-quiet btn-small" onClick={() => forget(f.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
