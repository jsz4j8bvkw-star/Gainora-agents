// Switching to Gainora: bring appointments over from the old system's spreadsheet export, with a preview first.
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Field, Icon, Modal, useToast } from './ui';
import { COLUMNS, guessColumns, parseCsv, readBookings, type Mapping } from '../../shared/importer';
import { timeLabel } from '../../shared/diary';

const SYSTEMS = ['Fresha', 'Phorest', 'Timely', 'Treatwell', 'Booksy', 'Pabau', 'Cliniko', 'Square', 'A spreadsheet', 'Something else'];

export function ImportCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel wf-card">
      <div className="wf-head">
        <span className="wf-icon"><Icon name="download" /></span>
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h3 className="subhead">Bring your appointments with you</h3>
          <p className="small muted">Switching from another system? Export your appointments as a spreadsheet (CSV) and add it here. Upcoming bookings go into your diary with their reminders; past visits become each client’s history, so regulars are recognised and you know who’s due back. Nothing is sent to anyone when you import.</p>
        </div>
        <div className="wf-controls"><Button small onClick={() => setOpen(true)}>Import</Button></div>
      </div>
      {open && <ImportModal onClose={() => setOpen(false)} />}
    </section>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { settings, reloadEnquiries } = useApp();
  const toast = useToast();
  const [system, setSystem] = useState(SYSTEMS[0]);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const headers = rows?.[0] ?? [];
  const result = useMemo(() => (rows ? readBookings(rows.slice(1), map, settings) : null), [rows, map, settings]);

  const pick = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) return setErr('That’s an Excel file. Open it and use “Save as”, CSV, then add the CSV here.');
    if (f.size > 8_000_000) return setErr('That file is too big. Export a shorter date range.');
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) return setErr('That file has no rows we could read.');
    setRows(parsed); setFileName(f.name); setMap(guessColumns(parsed[0]));
  };
  const go = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const r = await api.importBookings([...result.upcoming, ...result.past], system);
      toast(`Imported ${r.added} ${r.added === 1 ? 'appointment' : 'appointments'}${r.already ? ` (${r.already} were already here)` : ''}.`);
      await reloadEnquiries?.();
      onClose();
    } catch (e: any) { toast(e?.message || 'The import didn’t finish. Try again.'); }
    finally { setBusy(false); }
  };
  const reasons = result ? Object.entries(result.skipped.reduce<Record<string, number>>((a, x) => ({ ...a, [x.why]: (a[x.why] ?? 0) + 1 }), {})) : [];

  return (
    <Modal title="Import appointments" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!result || !(result.upcoming.length + result.past.length)} onClick={go}>{result ? `Import ${result.upcoming.length + result.past.length}` : 'Import'}</Button></>}>
      <div className="panel-pad stack gap-16">
        <div className="form-grid">
          <Field label="Coming from">{(id) => <select id={id} className="select" value={system} onChange={(e: any) => setSystem(e.target.value)}>{SYSTEMS.map((x) => <option key={x}>{x}</option>)}</select>}</Field>
          <Field label="Your export (CSV)" help="Usually under Reports or Data export in your current system. Include past appointments for client history.">{(id, d) => <input id={id} type="file" accept=".csv,text/csv" aria-describedby={d} onChange={(e: any) => pick(e.target.files?.[0])} />}</Field>
        </div>
        {err && <p className="field-error" role="alert">{err}</p>}
        {rows && (
          <>
            <p className="small"><strong>{fileName}</strong>: {rows.length - 1} rows. Check each detail is read from the right column:</p>
            <div className="form-grid">
              {COLUMNS.map((c) => (
                <Field key={c.id} label={c.label}>{(id) => (
                  <select id={id} className="select" value={map[c.id] ?? ''} onChange={(e: any) => setMap({ ...map, [c.id]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                    <option value="">Not in the file</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                )}</Field>
              ))}
            </div>
            {result && (
              <div className="panel rows">
                <div className="mini-row" style={{ gridTemplateColumns: '1fr' }}><span className="small"><strong>{result.upcoming.length}</strong> upcoming {result.upcoming.length === 1 ? 'booking' : 'bookings'} for your diary · <strong>{result.past.length}</strong> past {result.past.length === 1 ? 'visit' : 'visits'} for client history{result.skipped.length ? <> · <strong>{result.skipped.length}</strong> left out</> : ''}</span></div>
                {[...result.upcoming.slice(0, 4), ...result.past.slice(0, 2)].map((b) => (
                  <div key={b.key} className="mini-row" style={{ gridTemplateColumns: '120px minmax(0,1fr)' }}>
                    <span className="xsmall faint">{new Date(b.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, {timeLabel(b.start)}</span>
                    <span className="small">{b.name}{b.type ? ` · ${b.type}` : ''}{b.who ? ` · ${b.who}` : ''}{b.past ? ' · past visit' : ''}</span>
                  </div>
                ))}
                {reasons.length > 0 && <div className="mini-row" style={{ gridTemplateColumns: '1fr' }}><span className="xsmall faint">Left out: {reasons.map(([why, n]) => `${n} × ${why.toLowerCase()}`).join(', ')}.</span></div>}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
