import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Locked, useApp } from '../app';
import { Button, ErrorNote, Field, Icon, Loading, Modal, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { Feedback } from '../components/feedback';
import { csv, hostOf, money, relative, shortDate } from '../lib/format';
import { queryParam } from '../lib/router';
import { pending } from '../components/palette';
import { isDue } from '../../shared/leads';
import { daysLeft } from '../../shared/tenders';
import type { Lead, LeadStage, ScoutKind, ScoutResult, ScoutSearch, Tender } from '../lib/types';

type Tab = 'research' | 'leads' | 'contracts';
const TABS: Tab[] = ['research', 'leads', 'contracts'];
const initialTab = (): Tab => { const t = queryParam('tab') as Tab | null; return t && TABS.includes(t) ? t : 'research'; };

export function Scout() {
  const { plan } = useApp();
  return plan.agents.includes('scout') ? <ScoutPage /> : <Locked agent="scout" />;
}

function ScoutPage() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const leads = useLoad(() => api.listLeads());
  const tenders = useLoad(() => api.listTenders());
  const due = leads.data?.filter((l) => l.stage === 'contacted' && isDue(l.nextFollowUp)).length ?? 0;
  const newTenders = tenders.data?.filter((t) => t.status === 'new').length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">The Scout</h1>
          <p className="lede">Finds people to sell to: businesses that fit, public contracts you could win and local opportunities. Then it helps you follow up until you hear back.</p>
        </div>
      </div>
      <Tabs label="Scout sections" value={tab} onChange={setTab} tabs={[
        { id: 'research', label: 'Research' },
        { id: 'leads', label: 'Your leads', badge: due ? `${due} due` : null },
        { id: 'contracts', label: 'Public contracts', badge: newTenders ? `${newTenders} new` : null },
      ]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={tab}>
        {tab === 'research' && <Research onLeadAdded={() => leads.reload()} />}
        {tab === 'leads' && <Leads state={leads} goResearch={() => setTab('research')} />}
        {tab === 'contracts' && <Contracts state={tenders} />}
      </div>
    </div>
  );
}

/* ---------- Research ---------- */
function suggestionsFor(p: ReturnType<typeof useApp>['profile'], kind: ScoutKind): string[] {
  const town = p.business.location.split(',')[0].trim() || 'my area';
  if (kind === 'local') return ['Markets and fairs in the next three months', `Business networking near ${town}`, 'Local awards worth entering', 'Events where my customers go'];
  const list: string[] = [];
  if (/wholesale|b2b/i.test(p.goals.focus) || p.offer.salesChannels.includes('Wholesale')) list.push('Independent shops that could stock our products');
  list.push(`Businesses near ${town} that could refer customers to us`);
  if (p.customers.areas.includes('Across the UK')) list.push('UK businesses that buy what we sell for staff or client gifts');
  list.push('Cafés, hotels and venues that could use what we sell');
  return list.slice(0, 4);
}

function Research({ onLeadAdded }: { onLeadAdded: () => void }) {
  const { profile } = useApp();
  const { data, setData, error, loading, reload } = useLoad(() => api.listScout());
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<ScoutKind>('customers');
  const [query, setQuery] = useState(() => { const q = pending.scout ?? ''; pending.scout = null; return q; });
  const [area, setArea] = useState(profile.customers.areas.includes('Local') ? profile.business.location.split(',').slice(-1)[0].trim() : 'United Kingdom');
  const [starting, setStarting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [intro, setIntro] = useState<{ result: ScoutResult; text: string | null } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const toast = useToast();

  const current: ScoutSearch | undefined = data?.find((s) => s.id === selected) ?? data?.[0];

  useEffect(() => {
    if (!current || current.status !== 'running') return;
    const t = setInterval(async () => {
      const s = await api.getScout(current.id).catch(() => null);
      if (s && s.status !== 'running') { setData((d) => d?.map((x) => (x.id === s.id ? s : x))); toast(s.status === 'ready' ? 'Your research is ready' : 'The search didn’t finish'); }
    }, 3000);
    return () => clearInterval(t);
  }, [current?.id, current?.status]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? 'The Scout could not load.'} retry={reload} />;

  const start = async (e?: any) => {
    e?.preventDefault();
    const q = query.trim() || (kind === 'local' ? 'Local events, markets and opportunities for my business' : '');
    if (q.length < 8) { setFormError('Describe who you’re looking for in a few words.'); return; }
    setFormError(null); setStarting(true);
    try {
      const s = await api.startScout(q, area.trim() || 'United Kingdom', kind);
      setData([s, ...data]); setSelected(s.id); setQuery('');
    } catch (err: any) { setFormError(err?.message || 'The search couldn’t start. Try again.'); }
    finally { setStarting(false); }
  };

  const hide = (r: ScoutResult) => current && setData(data.map((s) => (s.id === current.id ? { ...s, results: s.results.map((x) => (x.id === r.id ? { ...x, dismissed: true } : x)) } : s)));

  const addLead = async (r: ScoutResult) => {
    if (!current) return;
    setAdding(r.id);
    try {
      await api.addLead(current.id, r.id);
      setData(data.map((s) => (s.id === current.id ? { ...s, results: s.results.map((x) => (x.id === r.id ? { ...x, saved: true } : x)) } : s)));
      onLeadAdded();
      toast(`${r.name} added to your leads`);
    } catch (err: any) { toast(err?.message || 'That didn’t save. Try again.'); }
    finally { setAdding(null); }
  };

  const saveOpportunity = async (r: ScoutResult) => {
    if (!current) return;
    setData(data.map((s) => (s.id === current.id ? { ...s, results: s.results.map((x) => (x.id === r.id ? { ...x, saved: !x.saved } : x)) } : s)));
    try { await api.setScoutSaved(current.id, r.id, !r.saved); } catch { toast('That didn’t save. Try again.'); }
  };

  const openIntro = async (r: ScoutResult) => {
    setIntro({ result: r, text: null });
    try { setIntro({ result: r, text: await api.draftIntro(current!.id, r.id) }); }
    catch { setIntro(null); toast('Couldn’t write the introduction. Try again.'); }
  };

  const exportCsv = () => {
    if (!current) return;
    const rows = [['Name', 'Location', 'Website', 'Fit', 'Why', 'When', 'How to take part', 'Source'], ...current.results.filter((r) => !r.dismissed).map((r) => [r.name, r.location, r.website, r.fit === 'strong' ? 'Strong fit' : 'Possible fit', r.reason, r.when ?? '', r.how ?? '', r.source.url])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }));
    a.download = `gainora-scout-${current.createdAt.slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const visible = (current?.results ?? []).filter((r) => !r.dismissed);
  const strong = visible.filter((r) => r.fit === 'strong');
  const possible = visible.filter((r) => r.fit !== 'strong');
  const isLocal = current?.kind === 'local';

  const Row = ({ r }: { r: ScoutResult }) => (
    <article className="lead">
      <div className="stack gap-4" style={{ minWidth: 0 }}>
        <h3 className="lead-name">{r.name}</h3>
        <div className="small muted">{r.when ? <><Icon name="clock" className="inline-icon" />{r.when}{r.location ? `, ${r.location}` : ''}</> : <>{r.location}{r.website && <>, <a href={r.website} target="_blank" rel="noreferrer">{hostOf(r.website)}</a></>}</>}</div>
      </div>
      <div className="lead-actions">
        {isLocal
          ? <Button kind={r.saved ? 'primary' : 'secondary'} small icon={r.saved ? 'check' : 'bookmark'} onClick={() => saveOpportunity(r)}>{r.saved ? 'Saved' : 'Save'}</Button>
          : <>
            <Button kind="secondary" small icon="send" onClick={() => openIntro(r)}>Draft introduction</Button>
            <Button kind={r.saved ? 'primary' : 'secondary'} small icon={r.saved ? 'check' : 'plus'} busy={adding === r.id} disabled={r.saved} onClick={() => addLead(r)}>{r.saved ? 'In your leads' : 'Add to leads'}</Button>
          </>}
      </div>
      <p className="lead-reason voice">{r.reason}</p>
      {r.how && <p className="lead-reason small"><strong>How to take part:</strong> {r.how}</p>}
      <div className="lead-foot">
        <span className="xsmall faint">Source: <a href={r.source.url} target="_blank" rel="noreferrer">{r.source.title}</a></span>
        <Feedback agent="scout" kind={isLocal ? 'opportunity' : 'lead'} id={r.id} text={`${r.name}, ${r.location}`} host={hostOf(r.website)} onNotRelevant={() => setTimeout(() => hide(r), 1200)} />
      </div>
    </article>
  );

  return (
    <>
      <form className="panel composer" onSubmit={start} noValidate aria-label="New search">
        <div className="mode-switch" role="radiogroup" aria-label="What to look for">
          {([['customers', 'Find customers'], ['local', 'Local opportunities']] as [ScoutKind, string][]).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className="mode-btn" onClick={() => { setKind(k); setFormError(null); }}>
              <Icon name={k === 'local' ? 'pin' : 'scout'} />{label}
            </button>
          ))}
        </div>
        <div className="composer-row">
          <Field label={kind === 'local' ? 'What kind of opportunities?' : 'Who are you looking for?'} error={formError ?? undefined} optional={kind === 'local'}>
            {(id, d) => <input id={id} className="input" value={query} aria-describedby={d} aria-invalid={!!formError} onChange={(e: any) => setQuery(e.target.value)}
              placeholder={kind === 'local' ? 'For example: markets, fairs and business events' : 'For example: gift shops that stock independent makers'} />}
          </Field>
          <Field label="Where">
            {(id) => <input id={id} className="input" value={area} onChange={(e: any) => setArea(e.target.value)} />}
          </Field>
          <Button type="submit" busy={starting} icon={kind === 'local' ? 'pin' : 'scout'}>Start research</Button>
        </div>
        <div className="suggestions" aria-label="Suggestions">
          {suggestionsFor(profile, kind).map((s) => <button type="button" className="suggestion" key={s} onClick={() => setQuery(s)}>{s}</button>)}
        </div>
      </form>

      {data.length === 0 && <div className="panel empty section"><h2 className="heading">No research yet</h2><p className="muted">Start with one of the suggestions above. Most searches take two to four minutes.</p></div>}

      {data.length > 0 && (
        <section className="section" aria-labelledby="res-h">
          <h2 className="sr-only" id="res-h">Your research</h2>
          {data.length > 1 && (
            <div className="searches" role="group" aria-label="Past searches">
              {data.map((s) => (
                <button key={s.id} className="search-pill" aria-pressed={s.id === current?.id} onClick={() => setSelected(s.id)}>
                  <div className="q">{s.kind === 'local' && <Icon name="pin" className="inline-icon" />}{s.query}</div>
                  <div className="xsmall faint">{s.status === 'running' ? 'Researching now' : `${s.results.filter((r) => !r.dismissed).length} found, ${relative(s.createdAt)}`}</div>
                </button>
              ))}
            </div>
          )}
          {current && (
            <div className="panel">
              <div className="panel-head">
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <h3 className="heading">{current.query}</h3>
                  <span className="small faint">{current.area}, {relative(current.createdAt)}</span>
                </div>
                {current.status === 'ready' && visible.length > 0 && <Button kind="secondary" small icon="download" onClick={exportCsv}>Export</Button>}
              </div>
              {current.status === 'running' && (
                <div className="researching" role="status"><span className="pulse" aria-hidden="true" /><div><div className="subhead">Researching</div><div className="small muted">Reading public websites and listings. You can leave this page; the results will be waiting.</div></div></div>
              )}
              {current.status === 'failed' && <div style={{ padding: 24 }}><ErrorNote message={current.error || 'This search didn’t finish. Try rewording it.'} /></div>}
              {current.status === 'ready' && (
                <>
                  {current.summary && <p className="voice" style={{ padding: '22px 24px 6px', maxWidth: '70ch' }}>{current.summary}</p>}
                  {strong.length > 0 && <div style={{ padding: '18px 24px 0' }}><span className="tag tag-forest">{isLocal ? 'Best for you' : 'Strong fit'}</span></div>}
                  <div className="rows">{strong.map((r) => <Row r={r} key={r.id} />)}</div>
                  {possible.length > 0 && <div style={{ padding: '18px 24px 0', borderTop: '1px solid var(--line)' }}><span className="tag tag-plain">Worth a look</span></div>}
                  <div className="rows">{possible.map((r) => <Row r={r} key={r.id} />)}</div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {intro && (
        <DraftModal title={`Introduction to ${intro.result.name}`} text={intro.text} onClose={() => setIntro(null)}
          note="Read it through and make it sound like you before sending. Gainora never sends emails for you." />
      )}
    </>
  );
}

function DraftModal({ title, text, note, onClose, extra }: { title: string; text: string | null; note: string; onClose: () => void; extra?: any }) {
  const toast = useToast();
  return (
    <Modal title={title} onClose={onClose}
      footer={text && <>
        {extra}
        <Button kind="secondary" onClick={onClose}>Close</Button>
        <Button icon="copy" onClick={async () => toast((await copyText(text)) ? 'Copied. Paste it into your email.' : 'Select the text and copy it manually.')}>Copy text</Button>
      </>}>
      {text ? <pre>{text}</pre> : <Loading label="Writing" />}
      {text && <p className="xsmall faint" style={{ padding: '0 28px 20px' }}>{note}</p>}
    </Modal>
  );
}

/* ---------- Leads ---------- */
const STAGE_TAG: Record<LeadStage, { label: string; cls: string }> = {
  to_contact: { label: 'To contact', cls: 'tag-plain' },
  contacted: { label: 'Waiting for a reply', cls: 'tag-plain' },
  replied: { label: 'Replied', cls: 'tag-forest' },
  meeting: { label: 'Meeting booked', cls: 'tag-forest' },
  won: { label: 'Won', cls: 'tag-forest' },
  lost: { label: 'Not interested', cls: 'tag-plain' },
};

function Leads({ state, goResearch }: { state: ReturnType<typeof useLoad<Lead[]>>; goResearch: () => void }) {
  const { data, setData, error, loading, reload } = state;
  const [draft, setDraft] = useState<{ lead: Lead; kind: 'intro' | 'follow'; text: string | null } | null>(null);
  const [winning, setWinning] = useState<Lead | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const openDraft = async (lead: Lead, kind: 'intro' | 'follow') => {
    setDraft({ lead, kind, text: null });
    try { setDraft({ lead, kind, text: kind === 'intro' ? await api.draftIntro('', lead.id) : await api.draftFollowUp(lead.id) }); }
    catch { setDraft(null); toast('Couldn’t write it. Try again.'); }
  };
  // Opened from Home ("Open the follow-up" / "Open the introduction"): go straight to that lead's draft.
  const wanted = queryParam('lead');
  useEffect(() => {
    if (!wanted || !data) return;
    const l = data.find((x) => x.id === wanted);
    if (!l) return;
    if (l.stage === 'to_contact') openDraft(l, 'intro');
    else if (l.stage === 'contacted' && isDue(l.nextFollowUp)) openDraft(l, 'follow');
    else document.getElementById(`lead-${l.id}`)?.scrollIntoView({ block: 'center' });
  }, [data === undefined]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? 'Your leads could not load.'} retry={reload} />;

  const update = async (lead: Lead, patch: Parameters<typeof api.updateLead>[1], message?: string) => {
    setBusy(lead.id);
    try {
      const next = await api.updateLead(lead.id, patch);
      setData(data.map((l) => (l.id === lead.id ? next : l)));
      if (message) toast(message);
    } catch (e: any) { toast(e?.message || 'That didn’t save. Try again.'); }
    finally { setBusy(null); }
  };
  const groups: { title: string; hint: string; list: Lead[] }[] = [
    { title: 'Follow up today', hint: 'A short, friendly nudge often gets the reply.', list: data.filter((l) => l.stage === 'contacted' && isDue(l.nextFollowUp)) },
    { title: 'To contact', hint: 'Introductions are drafted for you.', list: data.filter((l) => l.stage === 'to_contact') },
    { title: 'In conversation', hint: '', list: data.filter((l) => l.stage === 'replied' || l.stage === 'meeting') },
    { title: 'Waiting for a reply', hint: 'The Scout reminds you when each follow-up is due.', list: data.filter((l) => l.stage === 'contacted' && !isDue(l.nextFollowUp)) },
    { title: 'Won', hint: '', list: data.filter((l) => l.stage === 'won') },
  ];
  const lost = data.filter((l) => l.stage === 'lost');

  if (data.length === 0) {
    return (
      <div className="panel empty">
        <h2 className="heading">No leads yet</h2>
        <p className="muted mt-8">Add businesses from your research and the Scout will draft your introductions, remind you to follow up on day 4 and day 9, and track who replied.</p>
        <Button className="mt-16" icon="scout" onClick={goResearch}>Start researching</Button>
      </div>
    );
  }

  const status = (l: Lead) => {
    if (l.stage === 'contacted') {
      const when = l.contactedAt ? `Contacted ${relative(l.contactedAt)}.` : '';
      if (!l.nextFollowUp) return `${when} No more follow-ups planned.`;
      return isDue(l.nextFollowUp) ? `${when} Follow-up ${l.followUps + 1} is due today.` : `${when} Follow-up ${l.followUps + 1} due ${shortDate(l.nextFollowUp)}.`;
    }
    if (l.stage === 'won') return l.value ? `Won, worth ${money(l.value)}.` : 'Won.';
    return '';
  };

  return (
    <>
      {groups.filter((g) => g.list.length).map((g) => (
        <section className="lead-group" key={g.title} aria-label={g.title}>
          <div className="section-head"><h2 className="heading">{g.title} <span className="count">{g.list.length}</span></h2>{g.hint && <span className="small faint">{g.hint}</span>}</div>
          <div className="panel rows">
            {g.list.map((l) => (
              <article className="pipeline-row" key={l.id} id={`lead-${l.id}`}>
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <div className="row gap-8 wrap"><h3 className="lead-name">{l.name}</h3><span className={`tag ${STAGE_TAG[l.stage].cls}`}>{STAGE_TAG[l.stage].label}</span></div>
                  <span className="small muted">{l.location}{l.website && <>, <a href={l.website} target="_blank" rel="noreferrer">{hostOf(l.website)}</a></>}</span>
                  {status(l) && <span className="small">{status(l)}</span>}
                </div>
                <div className="lead-actions">
                  {l.stage === 'to_contact' && <>
                    <Button kind="secondary" small icon="send" onClick={() => openDraft(l, 'intro')}>Draft introduction</Button>
                    <Button small busy={busy === l.id} onClick={() => update(l, { stage: 'contacted' }, 'Marked as contacted. Follow-up reminders are set.')}>I’ve contacted them</Button>
                  </>}
                  {l.stage === 'contacted' && <>
                    {l.nextFollowUp && isDue(l.nextFollowUp) && <Button kind="secondary" small icon="send" onClick={() => openDraft(l, 'follow')}>Draft follow-up</Button>}
                    {l.nextFollowUp && isDue(l.nextFollowUp) && <Button small busy={busy === l.id} onClick={() => update(l, { followUpSent: true }, 'Follow-up logged.')}>I’ve sent it</Button>}
                    <Button kind="secondary" small onClick={() => update(l, { stage: 'replied' }, 'Great. Moved to In conversation.')}>They replied</Button>
                  </>}
                  {l.stage === 'replied' && <Button kind="secondary" small onClick={() => update(l, { stage: 'meeting' })}>Meeting booked</Button>}
                  {(l.stage === 'replied' || l.stage === 'meeting') && <Button small onClick={() => { setValue(''); setWinning(l); }}>Won</Button>}
                  {l.stage === 'won' && !l.value && <Button kind="secondary" small onClick={() => { setValue(''); setWinning(l); }}>Add deal value</Button>}
                  {l.stage !== 'won' && <button className="btn btn-quiet btn-small" onClick={() => update(l, { stage: 'lost' })}>Not interested</button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {lost.length > 0 && (
        <details className="done-list">
          <summary>{lost.length} not interested</summary>
          <ul>{lost.map((l) => <li key={l.id}><span>{l.name}</span><button className="btn btn-quiet btn-small" onClick={() => update(l, { stage: 'to_contact' })}>Move back</button></li>)}</ul>
        </details>
      )}

      {draft && (
        <DraftModal title={draft.kind === 'intro' ? `Introduction to ${draft.lead.name}` : `Follow-up to ${draft.lead.name}`} text={draft.text} onClose={() => setDraft(null)}
          note="Read it through and make it sound like you. Gainora never sends emails for you." />
      )}
      {winning && (
        <Modal title={`You won ${winning.name}`} onClose={() => setWinning(null)}
          footer={<>
            <Button kind="secondary" onClick={() => { update(winning, { stage: 'won' }, 'Congratulations on the win.'); setWinning(null); }}>Skip</Button>
            <Button onClick={() => { const n = Number(value.replace(/[£,\s]/g, '')); update(winning, { stage: 'won', value: Number.isFinite(n) && n > 0 ? n : null }, 'Congratulations on the win.'); setWinning(null); }}>Save</Button>
          </>}>
          <div className="panel-pad stack gap-16">
            <p className="muted">Congratulations. If you add what the deal is worth, it appears in your results so you can see what Gainora has helped you win. Only you can see it.</p>
            <Field label="Deal value" optional>{(id) => <div className="prefix-input"><span aria-hidden="true">£</span><input id={id} className="input tabular" inputMode="decimal" value={value} onChange={(e: any) => setValue(e.target.value)} placeholder="1,200" /></div>}</Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------- Public contracts ---------- */
function Contracts({ state }: { state: ReturnType<typeof useLoad<Tender[]>> }) {
  const { data, setData, error, loading, reload } = state;
  const [view, setView] = useState<'new' | 'saved' | 'applied'>('new');
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? 'Contracts could not load.'} retry={reload} />;

  const set = async (t: Tender, status: Tender['status'], message?: string) => {
    setData(data.map((x) => (x.id === t.id ? { ...x, status } : x)));
    try { await api.updateTender(t.id, status); if (message) toast(message); }
    catch { toast('That didn’t save. Try again.'); reload(); }
  };
  const list = data.filter((t) => t.status === view);
  const count = (s: Tender['status']) => data.filter((t) => t.status === s).length;

  return (
    <>
      <div className="row gap-12 wrap" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="seg" role="group" aria-label="Show contracts">
          {(['new', 'saved', 'applied'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} className="seg-btn" onClick={() => setView(v)}>
              {v === 'new' ? 'To review' : v === 'saved' ? 'Saved' : 'Applied'} <span className="count">{count(v)}</span>
            </button>
          ))}
        </div>
        <span className="small faint">Checked every morning on Contracts Finder</span>
      </div>
      <div className="panel rows">
        {list.length === 0 && (
          <div className="empty">
            <p className="muted">{view === 'new' ? 'No new contracts that fit you right now. The Scout checks every new UK public contract each morning and lists the ones that match what you sell.' : view === 'saved' ? 'Contracts you save appear here.' : 'Contracts you mark as applied appear here.'}</p>
          </div>
        )}
        {list.map((t) => {
          const d = daysLeft(t.deadline);
          return (
            <article className="tender" key={t.id}>
              <div className="row gap-8 wrap">
                <span className={`tag ${t.fit === 'strong' ? 'tag-forest' : 'tag-plain'}`}>{t.fit === 'strong' ? 'Strong fit' : 'Worth a look'}</span>
                {t.sme && <span className="tag tag-plain">Suitable for small businesses</span>}
                {d != null && <span className={`tag ${d <= 7 ? 'tag-danger' : 'tag-plain'}`}>{d <= 0 ? 'Closes today' : `Closes in ${d} ${d === 1 ? 'day' : 'days'}`}</span>}
              </div>
              <h3 className="tender-title">{t.title}</h3>
              <div className="tender-meta small muted">
                <span>{t.buyer}</span>
                {t.value != null && <span className="tabular">{money(t.value)}</span>}
                {t.region && <span>{t.region}</span>}
              </div>
              <p className="voice">{t.reason}</p>
              {t.summary && <p className="small muted" style={{ maxWidth: '75ch' }}>{t.summary}</p>}
              <div className="row gap-12 wrap mt-8">
                <a className="btn btn-secondary btn-small" href={t.url} target="_blank" rel="noreferrer"><Icon name="external" />View the notice</a>
                {t.status === 'new' && <Button kind="secondary" small icon="bookmark" onClick={() => set(t, 'saved', 'Saved')}>Save</Button>}
                {t.status !== 'applied' && <Button kind="secondary" small icon="check" onClick={() => set(t, 'applied', 'Marked as applied. Good luck.')}>I’ve applied</Button>}
                {t.status === 'new' && <Feedback agent="scout" kind="tender" id={t.id} text={t.title} onNotRelevant={() => setTimeout(() => setData((d) => (d ?? []).map((x) => (x.id === t.id ? { ...x, status: 'dismissed' } : x))), 1200)} />}
              </div>
            </article>
          );
        })}
      </div>
      <p className="xsmall faint mt-16">From Contracts Finder, the UK government’s list of public sector contracts. Values are what the buyer published, not a guarantee of what you would earn.</p>
    </>
  );
}
