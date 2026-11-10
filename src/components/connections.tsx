// Connecting the clinic's own calendar or booking system to the Gainora diary: Google Calendar and Cliniko,
// with plain choices for what counts as busy, where new bookings go and who is who.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Field, Icon, useToast } from './ui';
import { Toggle } from './features';
import { teamOf } from '../../shared/diary';
import { GAINORA_DIARY } from '../../shared/capture';

interface Cal { id: string; name: string; primary: boolean; canWrite: boolean }

export function Connections() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  const [state, setState] = useState<any>(null);
  const [failed, setFailed] = useState('');
  const load = () => api.connect('list').then(setState).catch((e: any) => setFailed(e?.message || 'Couldn’t load your connections.'));
  useEffect(() => { load(); }, []);
  // Coming back from Google's sign-in.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('connected') === 'google') toast('Google Calendar is connected. Check the choices below.');
    const err = q.get('connect_error');
    if (err) toast(err === 'declined' ? 'Google Calendar wasn’t connected: access wasn’t allowed.' : err === 'expired' ? 'That took too long. Try connecting again.' : 'Google Calendar didn’t connect. Try again.');
    if (q.get('connected') || err) history.replaceState(null, '', location.pathname);
  }, []);
  const refreshSettings = async () => { const s = await api.getSettings().catch(() => null); if (s) setSettings(s); };

  if (failed) return <p className="small muted">{failed}</p>;
  if (!state) return <p className="small faint">Loading your connections…</p>;
  return (
    <div className="stack gap-16">
      <GoogleCard state={state.google} onChange={() => { load(); refreshSettings(); }} />
      <ClinikoCard state={state.cliniko} onChange={() => { load(); refreshSettings(); }} />
      <p className="small muted"><Icon name="info" className="inline-icon" />Pabau, Phorest and other systems: Gainora connects these with you on your setup call{settings.bookings.system && settings.bookings.system !== GAINORA_DIARY && !/google|cliniko/i.test(settings.bookings.system) ? ` (you use ${settings.bookings.system})` : ''}. Phorest asks for its approval first, which we arrange.</p>
    </div>
  );
}

function GoogleCard({ state, onChange }: { state: any; onChange: () => void }) {
  const { settings } = useApp();
  const toast = useToast();
  const c = state?.connection;
  const cals: Cal[] = c?.account?.calendars ?? [];
  const [read, setRead] = useState<string[]>(c?.account?.read ?? []);
  const [write, setWrite] = useState<string>(c?.account?.write ?? '');
  const [staff, setStaff] = useState<Record<string, string>>(c?.account?.staff ?? {});
  const [mirror, setMirror] = useState<boolean>(!!c?.account?.mirror);
  const [busy, setBusy] = useState('');
  const team = teamOf(settings);
  useEffect(() => { setRead(c?.account?.read ?? []); setWrite(c?.account?.write ?? ''); setStaff(c?.account?.staff ?? {}); setMirror(!!c?.account?.mirror); }, [c]);

  const start = async () => {
    setBusy('start');
    try { const r = await api.connect('google-start'); location.href = r.url; }
    catch (e: any) { toast(e?.message || 'Couldn’t start Google sign-in.'); setBusy(''); }
  };
  const save = async () => {
    setBusy('save');
    try { await api.connect('google-save', { read, write, staff, mirror }); toast('Saved.'); onChange(); }
    catch (e: any) { toast(e?.message || 'That didn’t save.'); }
    finally { setBusy(''); }
  };
  const disconnect = async () => {
    setBusy('off');
    try { await api.connect('disconnect', { provider: 'google' }); toast('Google Calendar disconnected.'); onChange(); }
    catch (e: any) { toast(e?.message || 'That didn’t work.'); }
    finally { setBusy(''); }
  };

  return (
    <section className={`panel wf-card ${c ? 'is-on' : ''}`}>
      <div className="wf-head">
        <span className="wf-icon"><Icon name="calendar" /></span>
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h3 className="subhead">Google Calendar</h3>
          <p className="small muted">{c
            ? c.status === 'error' ? 'Google stopped letting Gainora in. Connect again to carry on.' : mirror ? 'Connected as a copy of your booking system: your busy times count, and clients are offered times you confirm.' : 'Connected: your busy times count, and new bookings are added to your calendar.'
            : 'Your busy times count, so nobody is booked over them, and new bookings appear in your calendar. Using Fresha? Turn on Fresha’s calendar sync to Google, then connect that calendar here.'}</p>
        </div>
        <div className="wf-controls">
          {c ? <Button small kind="secondary" busy={busy === 'off'} onClick={disconnect}>Disconnect</Button> : <Button small busy={busy === 'start'} onClick={start}>Connect</Button>}
        </div>
      </div>
      {c && cals.length > 0 && (
        <div className="wf-steps stack gap-12">
          <div className="cal-table" role="table" aria-label="Your calendars">
            <div className="cal-row head" role="row"><span role="columnheader">Calendar</span><span role="columnheader">Counts as busy</span><span role="columnheader">New bookings go here</span>{team.length > 1 && <span role="columnheader">Whose is it</span>}</div>
            {cals.map((cal) => (
              <div className="cal-row" role="row" key={cal.id}>
                <span role="cell" className="small"><strong>{cal.name}</strong>{cal.primary ? ' (main)' : ''}</span>
                <span role="cell"><input type="checkbox" aria-label={`${cal.name} counts as busy`} checked={read.includes(cal.id)} onChange={(e: any) => setRead(e.target.checked ? [...read, cal.id] : read.filter((x) => x !== cal.id))} /></span>
                <span role="cell">{cal.canWrite ? <input type="radio" name="g-write" aria-label={`New bookings go into ${cal.name}`} checked={write === cal.id} disabled={mirror} onChange={() => setWrite(cal.id)} /> : <span className="xsmall faint">Read only</span>}</span>
                {team.length > 1 && <span role="cell"><select className="select select-inline" aria-label={`Whose calendar is ${cal.name}`} value={staff[cal.id] ?? ''} onChange={(e: any) => setStaff({ ...staff, [cal.id]: e.target.value })}><option value="">Everyone</option>{team.map((t) => <option key={t} value={t}>{t}</option>)}</select></span>}
              </div>
            ))}
          </div>
          <label className="row gap-8 small" style={{ alignItems: 'center' }}><Toggle on={mirror} label="This calendar is a copy of another booking system" onChange={setMirror} />This calendar is a copy of another booking system (like Fresha’s sync), so Gainora shouldn’t book into it</label>
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}><Button small busy={busy === 'save'} onClick={save}>Save</Button></div>
        </div>
      )}
    </section>
  );
}

function ClinikoCard({ state, onChange }: { state: any; onChange: () => void }) {
  const { settings } = useApp();
  const toast = useToast();
  const c = state?.connection;
  const found = c?.account?.found;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const [biz, setBiz] = useState<string>(c?.account?.businessId ?? '');
  const [types, setTypes] = useState<Record<string, string>>(c?.account?.types ?? {});
  const [people, setPeople] = useState<Record<string, string>>(c?.account?.practitioners ?? {});
  useEffect(() => { setBiz(c?.account?.businessId ?? ''); setTypes(c?.account?.types ?? {}); setPeople(c?.account?.practitioners ?? {}); }, [c]);
  const team = teamOf(settings);
  const names = settings.bookings.types.map((t) => t.name).filter(Boolean);

  const connect = async () => {
    setBusy('on');
    try { await api.connect('cliniko-connect', { key }); setKey(''); toast('Cliniko is connected. Check the matches below.'); onChange(); }
    catch (e: any) { toast(e?.message || 'Cliniko didn’t connect.'); }
    finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save');
    try { await api.connect('cliniko-save', { businessId: biz, types, practitioners: people }); toast('Saved.'); onChange(); }
    catch (e: any) { toast(e?.message || 'That didn’t save.'); }
    finally { setBusy(''); }
  };
  const disconnect = async () => {
    setBusy('off');
    try { await api.connect('disconnect', { provider: 'cliniko' }); toast('Cliniko disconnected.'); onChange(); }
    catch (e: any) { toast(e?.message || 'That didn’t work.'); }
    finally { setBusy(''); }
  };

  return (
    <section className={`panel wf-card ${c ? 'is-on' : ''}`}>
      <div className="wf-head">
        <span className="wf-icon"><Icon name="link" /></span>
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h3 className="subhead">Cliniko</h3>
          <p className="small muted">{c ? 'Connected: free times come from Cliniko, and bookings from your page and receptionist are made in Cliniko.' : 'Free times come straight from Cliniko, and bookings are made in Cliniko itself, so there’s one diary.'}</p>
        </div>
        <div className="wf-controls">{c && <Button small kind="secondary" busy={busy === 'off'} onClick={disconnect}>Disconnect</Button>}</div>
      </div>
      {!c && (
        <div className="wf-steps stack gap-12">
          <Field label="Your Cliniko API key" help="In Cliniko: your name (top right), My info, Manage API keys, Add an API key. Paste it here once: it’s stored encrypted and never shown again.">{(id, d) => <input id={id} className="input" type="password" autoComplete="off" value={key} aria-describedby={d} onChange={(e: any) => setKey(e.target.value)} />}</Field>
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}><Button small busy={busy === 'on'} disabled={key.trim().length < 20} onClick={connect}>Connect Cliniko</Button></div>
        </div>
      )}
      {c && found && (
        <div className="wf-steps stack gap-12">
          {found.businesses.length > 1 && <Field label="Which Cliniko business">{(id) => <select id={id} className="select" value={biz} onChange={(e: any) => setBiz(e.target.value)}>{found.businesses.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}</Field>}
          <p className="small"><strong>Your treatments in Cliniko</strong></p>
          <div className="form-grid">
            {names.map((n) => <Field key={n} label={n}>{(id) => <select id={id} className="select" value={types[n] ?? ''} onChange={(e: any) => setTypes({ ...types, [n]: e.target.value })}><option value="">Not booked online</option>{found.types.map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.minutes ? ` (${t.minutes} min)` : ''}</option>)}</select>}</Field>)}
          </div>
          {team.length > 0 && <>
            <p className="small"><strong>Your team in Cliniko</strong></p>
            <div className="form-grid">
              {team.map((p) => <Field key={p} label={p}>{(id) => <select id={id} className="select" value={people[p] ?? ''} onChange={(e: any) => setPeople({ ...people, [p]: e.target.value })}><option value="">Not in Cliniko</option>{found.practitioners.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</Field>)}
            </div>
          </>}
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}><Button small busy={busy === 'save'} onClick={save}>Save</Button></div>
        </div>
      )}
    </section>
  );
}
