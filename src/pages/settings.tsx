import { useMemo, useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { ChangePassword } from './password';
import { useApp } from '../app';
import { AGENTS, Button, Field, Icon, useLoad, useToast } from '../components/ui';
import { SectionEditor } from './profile';
import { SECTIONS } from '../lib/questions';
import { shortDate } from '../lib/format';
import { DEFAULT_SETTINGS, TYPICAL_INTERVAL_WEEKS, type ClientSettings } from '../../shared/clients';
import { CATALOGUE, matchTreatment, treatmentById } from '../../shared/treatments';
import { parsePriceList } from '../../shared/booking';
import type { AgentId, BusinessProfile } from '../lib/types';

const PLANS_URL = 'https://gainora.co.uk/shop/';

export function Settings() {
  const { user, profile, plan, setProfile } = useApp();
  const [opening, setOpening] = useState(false);
  const toast = useToast();
  const allOn = (Object.keys(AGENTS) as AgentId[]).every((id) => plan.agents.includes(id));

  const manage = async () => {
    setOpening(true);
    try {
      const url = await api.billingUrl();
      if (url) location.href = url;
      else toast('Billing is managed through Stripe in the live app.');
    } catch (e: any) { toast(humanThrown(e, 'Couldn’t open billing. Try again.')); }
    finally { setOpening(false); }
  };

  const exportData = async () => {
    const [home, watcher, scout, numbers, briefs, chat, clients] = await Promise.all([api.getHome(), api.getWatcher().catch(() => null), api.listScout().catch(() => []), api.getNumbers().catch(() => []), api.listBriefs().catch(() => []), api.getChat().catch(() => []), api.listClients().catch(() => null)]);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile, plan, home, watcher, scout, numbers, briefs, chat, clients }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'gainora-my-data.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head"><h1 className="title">Plan and settings</h1></div>

      <section className="panel" aria-labelledby="plan-h">
        <div className="panel-head">
          <div>
            <h2 className="heading" id="plan-h">{allOn ? 'Gainora Command Centre' : 'Your plan'}</h2>
            <p className="small faint">{allOn ? 'All three agents, working together.' : 'Command Centre includes all three agents.'}{plan.renewsOn ? ` Renews ${shortDate(plan.renewsOn)}.` : ''}</p>
          </div>
          <Button kind="secondary" small busy={opening} onClick={manage}>Manage billing</Button>
        </div>
        <div className="rows">
          {(Object.keys(AGENTS) as AgentId[]).map((id) => {
            const on = plan.agents.includes(id);
            return (
              <div key={id} className="agent-row" style={{ cursor: 'default' }}>
                <span className="agent-icon" style={on ? undefined : { background: 'var(--canvas)', color: 'var(--ink-faint)' }}><Icon name={AGENTS[id].icon} /></span>
                <span className="stack gap-4"><span className="subhead">{AGENTS[id].name}</span><span className="small muted">{AGENTS[id].blurb}</span></span>
                {on ? <span className="tag tag-forest">{allOn ? 'Included' : 'Active'}</span> : <span className="tag">In Command Centre</span>}
              </div>
            );
          })}
        </div>
        {!allOn && (
          <div className="panel-pad row gap-12 wrap" style={{ borderTop: '1px solid var(--line)' }}>
            <p className="small muted" style={{ flex: '1 1 260px', margin: 0 }}>Move to Gainora Command Centre to add the agents you don’t have yet. They use the business details you’ve already given.</p>
            <a className="btn btn-primary btn-small" href={PLANS_URL}>See Command Centre</a>
          </div>
        )}
      </section>

      <div className="section">
        <SectionEditor section={SECTIONS.find((s) => s.id === 'preferences')!} profile={profile} onSaved={setProfile} />
      </div>

      <ClientSettingsSection profile={profile} onSaved={setProfile} />

      <section className="panel review-block section" aria-labelledby="acct-h">
        <h2 className="heading" id="acct-h">Account</h2>
        <dl><dt>Signed in as</dt><dd>{user.email}</dd><dt>Your data</dt><dd>Download everything Gainora holds about your business as a file.</dd></dl>
        <div className="row gap-12 mt-24 wrap">
          <Button kind="secondary" icon="download" onClick={exportData}>Download my data</Button>
          <Button kind="secondary" icon="logout" onClick={async () => { await api.signOut(); location.reload(); }}>Sign out</Button>
        </div>
        {api.mode === 'live' && (
          <div className="mt-24">
            <p className="small muted" style={{ margin: "0 0 12px" }}>You sign in with your email and password. The same password opens Capture &amp; Convert.</p>
            <ChangePassword email={user.email} />
          </div>
        )}
        <p className="xsmall faint mt-16">To close your account and delete your data, email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a>. We delete everything within 30 days.</p>
      </section>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`;

/** Settings for Your clients: the gap per treatment, quiet hours, the weekly cap, how texts are sent, and deleting everything. */
function ClientSettingsSection({ profile, onSaved }: { profile: BusinessProfile; onSaved: (p: BusinessProfile) => void }) {
  const { data } = useLoad(() => api.listClients().catch(() => null));
  const cs: ClientSettings = profile.clientSettings ?? {};
  const [intervals, setIntervals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(cs.intervals ?? {}).map(([k, v]) => [k, String(v)])));
  const [quietStart, setQuietStart] = useState(cs.quietStart ?? DEFAULT_SETTINGS.quietStart);
  const [quietEnd, setQuietEnd] = useState(cs.quietEnd ?? DEFAULT_SETTINGS.quietEnd);
  const [cap, setCap] = useState(cs.weeklyCap ?? DEFAULT_SETTINGS.weeklyCap);
  const [mode, setMode] = useState<'phone' | 'twilio'>(cs.sendMode ?? DEFAULT_SETTINGS.sendMode);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const toast = useToast();
  // The treatments that matter to this business: the ones in their visits, their price list, and any they add.
  const ids = useMemo(() => {
    const set = new Set<string>(Object.keys(intervals));
    for (const v of data?.visits ?? []) if (v.treatmentId) set.add(v.treatmentId);
    for (const r of parsePriceList(profile.offer?.priceList || '')) { const m = matchTreatment(r.name); if (m) set.add(m.id); }
    return [...set].map((id) => treatmentById(id)!).filter(Boolean).sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }, [data, intervals, profile.offer?.priceList]);
  const save = async () => {
    setBusy(true);
    try {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(intervals)) { const n = Number(v); if (n >= 1 && n <= 156) clean[k] = Math.round(n); }
      const next: BusinessProfile = { ...profile, clientSettings: { ...cs, intervals: clean, quietStart, quietEnd, weeklyCap: cap, sendMode: mode } };
      await api.saveProfile(next); onSaved(next); toast('Client settings saved.');
    } catch (e: any) { toast(humanThrown(e, 'That didn’t save. Try again.')); }
    finally { setBusy(false); }
  };
  const wipe = async () => {
    setBusy(true);
    try { await api.deleteAllClientData(); setConfirm(''); toast('All client data deleted.'); }
    catch (e: any) { toast(humanThrown(e, 'Could not delete. Try again.')); }
    finally { setBusy(false); }
  };
  const addExtra = () => { const m = CATALOGUE.find((t) => t.label === extra) ?? (matchTreatment(extra) ? treatmentById(matchTreatment(extra)!.id) : undefined); if (m) { setIntervals({ ...intervals, [m.id]: String(TYPICAL_INTERVAL_WEEKS[m.id] ?? '') }); setExtra(''); } };
  return (
    <section className="panel section" aria-labelledby="cs-h">
      <div className="panel-head"><div><h2 className="heading" id="cs-h">Your clients</h2><p className="small faint">How reminders and texts work.</p></div><Button small busy={busy} onClick={save}>Save</Button></div>
      <div className="panel-pad stack gap-24">
        <div>
          <h3 className="subhead">How often clients come back, by treatment</h3>
          <p className="small muted mt-8">Weeks between visits. The typical gap is shown; change any to match how you work (a client’s own gap, set on their page, always wins).</p>
          {ids.length === 0 ? <p className="small faint mt-16">Add clients and visits, or a price list under Your business, and the treatments you offer appear here.</p> : (
            <div className="interval-grid mt-16">
              {ids.map((t) => (
                <label key={t.id} className="interval-row">
                  <span>{t.label}<span className="xsmall faint"> · typical {TYPICAL_INTERVAL_WEEKS[t.id] ?? '–'} wk</span></span>
                  <input className="input" inputMode="numeric" aria-label={`${t.label}, weeks between visits`} placeholder={String(TYPICAL_INTERVAL_WEEKS[t.id] ?? '')} value={intervals[t.id] ?? ''} onChange={(e: any) => { const v = e.target.value.replace(/\D/g, ''); const n = { ...intervals }; if (v) n[t.id] = v; else delete n[t.id]; setIntervals(n); }} />
                </label>
              ))}
            </div>
          )}
          <div className="row gap-8 wrap mt-16" style={{ alignItems: 'flex-end' }}>
            <Field label="Add another treatment" optional>{(id) => <><input id={id} className="input" list="all-treatments" value={extra} onChange={(e: any) => setExtra(e.target.value)} style={{ minWidth: 260 }} /><datalist id="all-treatments">{CATALOGUE.map((t) => <option key={t.id} value={t.label} />)}</datalist></>}</Field>
            <Button kind="secondary" small onClick={addExtra} disabled={!extra}>Add</Button>
          </div>
        </div>
        <div className="row gap-16 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="No texts after" help="UK time">{(id) => <select id={id} className="select" style={{ width: 'auto' }} value={quietStart} onChange={(e: any) => setQuietStart(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>}</Field>
          <Field label="or before">{(id) => <select id={id} className="select" style={{ width: 'auto' }} value={quietEnd} onChange={(e: any) => setQuietEnd(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>}</Field>
          <Field label="Texts to one client, per week" help="Of any kind">{(id) => <select id={id} className="select" style={{ width: 'auto' }} value={cap} onChange={(e: any) => setCap(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select>}</Field>
        </div>
        <Field label="How texts are sent" as="group" help="Gainora drafts, you approve. “From your phone” opens your messages app with the text ready. “Gainora sends it” needs a text-message provider connected to your account; until then it says so and nothing is sent.">
          {() => <div className="seg"><button type="button" className="seg-btn" aria-pressed={mode === 'phone'} onClick={() => setMode('phone')}>From my phone</button><button type="button" className="seg-btn" aria-pressed={mode === 'twilio'} onClick={() => setMode('twilio')}>Gainora sends it (when connected)</button></div>}
        </Field>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
          <h3 className="subhead">Delete all client data</h3>
          <p className="small muted mt-8">Removes every client, visit, sent message and booking from Gainora. It cannot be undone. Export anyone you need first from their page.</p>
          <div className="row gap-8 wrap mt-16" style={{ alignItems: 'center' }}>
            <input className="input" style={{ width: 160 }} placeholder="Type DELETE" value={confirm} onChange={(e: any) => setConfirm(e.target.value)} aria-label="Type DELETE to confirm" />
            <Button kind="secondary" small className="btn-danger" disabled={confirm !== 'DELETE'} busy={busy} onClick={wipe}>Delete everything</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
