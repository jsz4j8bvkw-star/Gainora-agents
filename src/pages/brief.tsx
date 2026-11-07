import { useState } from 'react';
import { api } from '../lib/api';
import { Locked, useApp } from '../app';
import { Button, ErrorNote, Field, Loading, Sparkline, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { metricsFor, analyseWeeks, isGood } from '../../shared/metrics';
import { money, mondayOf, num, pct, shortDate } from '../lib/format';
import type { BriefReport, MetricDef, WeekNumbers, WinbackDrafts } from '../lib/types';
import type { MetricChange } from '../../shared/metrics';

export function Brief() {
  const { plan } = useApp();
  return plan.agents.includes('brief') ? <BriefPage /> : <Locked agent="brief" />;
}

const show = (m: MetricDef, v: number | null) => (m.unit === 'money' ? money(v) : m.unit === 'percent' ? pct(v) : num(v));

function BriefDoc({ b }: { b: BriefReport }) {
  return (
    <article className="brief-doc">
      <div className="small faint">Week of {shortDate(b.weekOf)}</div>
      <h2 className="heading mt-8">{b.headline}</h2>
      <div className="mt-16">{b.paragraphs.map((p, i) => <p className="voice" key={i}>{p}</p>)}</div>
      {b.actions.length > 0 && (
        <div className="brief-actions">
          <h3 className="subhead">This week’s priorities</h3>
          <ol>{b.actions.map((a) => <li key={a}>{a}</li>)}</ol>
        </div>
      )}
    </article>
  );
}

function BriefPage() {
  const { profile } = useApp();
  const metrics = metricsFor(profile.numbers.track);
  const { data, setData, error, loading, reload } = useLoad(async () => {
    const [weeks, briefs] = await Promise.all([api.getNumbers(), api.listBriefs()]);
    return { weeks, briefs };
  });
  const thisWeek = mondayOf();
  const [form, setForm] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error || !data) return <div className="page"><ErrorNote message={error ?? 'The Brief could not load.'} retry={reload} /></div>;

  const existing = data.weeks.find((w) => w.weekOf === thisWeek);
  const value = (id: string) => form[id] ?? (existing?.values[id] != null ? String(existing.values[id]) : '');

  const submit = async (e: any) => {
    e.preventDefault();
    const values: Record<string, number | null> = {};
    for (const m of metrics) {
      const raw = value(m.id).replace(/[£,%\s]/g, '');
      if (raw && !/^\d+(\.\d+)?$/.test(raw)) { setFormError(`${m.label} needs to be a number.`); return; }
      values[m.id] = raw ? Number(raw) : null;
    }
    if (Object.values(values).every((v) => v == null)) { setFormError('Add at least one number.'); return; }
    setFormError(null); setBusy(true);
    try {
      const w: WeekNumbers = { weekOf: thisWeek, values, note: note.trim() || undefined };
      const b = await api.saveNumbers(w);
      setData({ weeks: [...data.weeks.filter((x) => x.weekOf !== thisWeek), w].sort((a, z) => a.weekOf.localeCompare(z.weekOf)), briefs: [b, ...data.briefs.filter((x) => x.weekOf !== b.weekOf)] });
      setForm({}); setNote('');
      toast('Your Brief is updated');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) { setFormError(err?.message || 'Couldn’t update your Brief. Try again.'); }
    finally { setBusy(false); }
  };

  const changes = analyseWeeks(data.weeks, metrics);
  const latest = data.briefs[0];
  const recent = data.weeks.slice(-12);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">The Brief</h1>
          <p className="lede">Add your numbers once a week. The Brief compares them with previous weeks and your goal, then tells you what matters.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          {latest ? <BriefDoc b={latest} /> : (
            <div className="brief-doc"><h2 className="heading">Your first Brief is one step away</h2><p className="voice mt-16">Add this week’s numbers. From the second week on, the Brief compares each week with the last and with your goal.</p></div>
          )}
        </div>

        <form className="panel panel-pad" onSubmit={submit} noValidate aria-labelledby="nums-h">
          <h2 className="heading" id="nums-h">{existing ? 'Update this week' : 'This week’s numbers'}</h2>
          <p className="small muted mt-8">Week starting {shortDate(thisWeek)}. Rough figures are fine.</p>
          <div className="numbers-form mt-24" style={{ gridTemplateColumns: '1fr' }}>
            {metrics.map((m) => (
              <Field key={m.id} label={m.label}>
                {(id) => m.unit === 'money'
                  ? <div className="prefix-input"><span aria-hidden="true">£</span><input id={id} className="input tabular" inputMode="decimal" value={value(m.id)} onChange={(e: any) => setForm({ ...form, [m.id]: e.target.value })} /></div>
                  : <input id={id} className="input tabular" inputMode="decimal" value={value(m.id)} onChange={(e: any) => setForm({ ...form, [m.id]: e.target.value })} />}
              </Field>
            ))}
            <Field label="Anything unusual this week?" optional>
              {(id) => <textarea id={id} className="textarea" rows={2} value={note} placeholder="A bank holiday, a big order, a post that did well" onChange={(e: any) => setNote(e.target.value)} />}
            </Field>
          </div>
          {formError && <div className="err mt-16" role="alert">{formError}</div>}
          <Button type="submit" block busy={busy} className="mt-24">{busy ? 'Writing your Brief' : existing ? 'Update my Brief' : 'Get my Brief'}</Button>
        </form>
      </div>

      <Winback changes={changes} />

      <section className="section" aria-labelledby="trend-h">
        <div className="section-head"><h2 className="heading" id="trend-h">Trends</h2><span className="small faint">Last {recent.length} weeks</span></div>
        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="charts">
            {changes.map((c) => {
              const good = isGood(c);
              return (
                <div className="chart" key={c.metric.id}>
                  <div className="split"><span className="small muted">{c.metric.label}</span>
                    {c.changePct != null && <span className={`xsmall ${good === true ? 'up' : good === false ? 'down' : 'faint'}`} style={{ fontWeight: 600 }}>{c.changePct > 0 ? '+' : ''}{c.changePct}%</span>}
                  </div>
                  <div className="stat-value mt-8" style={{ fontSize: '1.75rem' }}>{show(c.metric, c.current)}</div>
                  <div className="mt-8"><Sparkline values={recent.map((w) => w.values[c.metric.id] ?? null)} height={48} label={`${c.metric.label} over the last ${recent.length} weeks`} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {data.briefs.length > 1 && (
        <section className="section" aria-labelledby="past-h">
          <div className="section-head"><h2 className="heading" id="past-h">Earlier Briefs</h2></div>
          <div className="panel rows">
            {data.briefs.slice(1).map((b) => (
              <details key={b.id} style={{ padding: '4px 0' }}>
                <summary style={{ padding: '14px 24px', cursor: 'pointer', fontWeight: 600 }}>Week of {shortDate(b.weekOf)}: <span className="muted" style={{ fontWeight: 400 }}>{b.headline}</span></summary>
                <BriefDoc b={b} />
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Ready-to-send messages to past customers, most useful when sales dip. */
function Winback({ changes }: { changes: MetricChange[] }) {
  const [drafts, setDrafts] = useState<WinbackDrafts | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'email' | 'text' | 'social'>('email');
  const toast = useToast();
  const dip = changes.find((c) => (c.metric.id === 'orders' || c.metric.id === 'revenue') && c.direction === 'down' && (c.changePct ?? 0) <= -10);

  const write = async () => {
    setBusy(true);
    try { setDrafts(await api.draftWinback()); }
    catch (e: any) { toast(e?.message || 'Couldn’t write the messages. Try again.'); }
    finally { setBusy(false); }
  };
  const text = drafts ? drafts[tab] : '';

  return (
    <section className="section" aria-labelledby="wb-h">
      <div className="section-head"><h2 className="heading" id="wb-h">Win back past customers</h2></div>
      <div className="panel winback">
        <div className="winback-intro">
          <p className="voice">{dip
            ? `${dip.metric.label} fell ${Math.abs(dip.changePct ?? 0)}% this week. A short, personal note to people who have bought before is usually the quickest way to bring sales back.`
            : 'People who have bought from you before are the easiest sales you will make. A short, personal note every few weeks keeps you in mind.'}</p>
          {!drafts && <Button className="mt-16" busy={busy} icon="send" onClick={write}>{busy ? 'Writing your messages' : 'Write my messages'}</Button>}
        </div>
        {drafts && (
          <div className="winback-drafts">
            <Tabs label="Message type" value={tab} onChange={setTab} tabs={[{ id: 'email', label: 'Email' }, { id: 'text', label: 'Text message' }, { id: 'social', label: 'Social post' }]} />
            <pre className="draft-text" id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>{text}</pre>
            <div className="row gap-12 wrap">
              <Button icon="copy" onClick={async () => toast((await copyText(text)) ? 'Copied' : 'Select the text and copy it manually.')}>Copy</Button>
              <Button kind="secondary" busy={busy} icon="refresh" onClick={write}>Write another version</Button>
            </div>
            <p className="xsmall faint">Only send marketing emails and texts to customers who have agreed to hear from you, and include a way to opt out.</p>
          </div>
        )}
      </div>
    </section>
  );
}
