import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { humanThrown } from '../lib/errors';
import { Button, ErrorNote, Field, Icon, Loading, Modal, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { queryParam } from '../lib/router';
import { relative, shortDate } from '../lib/format';
import type { ChangeRequest, WebsiteEnquiry, WebsiteListItem, WebsiteState } from '../lib/types';
import {
  DAYS, DEFAULT_SECTIONS, type Faq, type FontPair, type HeroLayout, hoursLabel, INDUSTRIES, INDUSTRY_LIST, type IndustryId, PALETTES, type Photo,
  type Sections, type Service, type Site, type Style, type Surface, uid, withDefaults,
} from '../../shared/site/data';
import { copyFields, defaultCopy, defaultFaqs, FONTS, pagesOf, renderPage } from '../../shared/site/render';
import { adsCsv, adsPlan, checks, directoriesFor, launchPlan, MONTHLY, napBlock, planProgress, profilePack, reviewKit } from '../../shared/site/kit';
import type { Performance } from '../../shared/site/stats';

type Tab = 'performance' | 'edit' | 'preview' | 'changes' | 'found' | 'plan' | 'settings';
const TABS: Tab[] = ['performance', 'edit', 'preview', 'changes', 'found', 'plan', 'settings'];
/** The client keeps their details up to date; the design, wording, pages and Google work are Gainora's. */
const OWNER_TABS: Tab[] = ['performance', 'edit', 'preview', 'changes', 'plan'];

const pctOf = (n: number | null) => (n == null ? '–' : `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`);
const change = (now: number, before: number) => {
  if (!before) return now ? 'New this period' : 'No change';
  const d = Math.round(((now - before) / before) * 100);
  return d === 0 ? 'Same as the period before' : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)}% on the period before`;
};

/* ---------- The page ---------- */

/** In Command Centre for the client (or Gainora with ?site=), or embedded in Gainora's admin for one client. */
export function Website({ embedded }: { embedded?: { slug: string; hasCapture: boolean } } = {}) {
  const app = useApp() as any;
  const plan = embedded ? { capture: embedded.hasCapture } : (app?.plan ?? {});
  const [client, setClient] = useState<string | null>(() => embedded?.slug ?? queryParam('site'));
  useState(() => { api.setWebsiteClient(embedded?.slug ?? queryParam('site')); if (embedded && api.mode === 'demo') api.setWebsiteRole?.('gainora'); return 0; });
  const { data: loaded, error, loading, reload } = useLoad(() => api.getWebsite(), [client]);
  const [site, setSite] = useState<WebsiteState | null>(null);
  const [draft, setDraft] = useState<Site | null>(null);
  const [tab, setTab] = useState<Tab>(() => { const t = (embedded ? null : queryParam('tab')) as Tab | null; return t && TABS.includes(t) ? t : embedded ? 'edit' : 'performance'; });
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishing, setPublishing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [requestsKey, setRequestsKey] = useState(0);
  const timer = useRef<any>(null);
  const toast = useToast();

  useEffect(() => { if (loaded) { setSite(loaded); setDraft(withDefaults(loaded.data)); if (!loaded.live && !queryParam('tab')) setTab('edit'); } }, [loaded]);
  const gainora = site?.role === 'gainora';
  useEffect(() => { if (site && !gainora && !OWNER_TABS.includes(tab)) setTab('performance'); }, [site?.role]);

  // Every change saves itself a moment later. Visitors only see it after Publish.
  const update = (next: Site) => {
    setDraft(next);
    setSaving('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const s = await api.saveWebsite(next); setSite(s); setSaving('saved'); }
      catch (e) { setSaving('error'); toast(humanThrown(e, 'Your changes didn’t save. Check your connection.')); }
    }, 900);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const switchClient = (slug: string | null) => { clearTimeout(timer.current); api.setWebsiteClient(slug); setSite(null); setDraft(null); setClient(slug); };

  if (loading && !loaded) return <Loading label="Opening the website" />;
  if (error) {
    return <div className="page"><ErrorNote message={/502|503|reach your saved data/i.test(error) ? 'Your website is being set up. Gainora will let you know when it’s ready.' : error} retry={reload} /></div>;
  }
  if (loaded === null) return <WebsiteUpsell hasCapture={!!plan.capture} />;
  if (!site || !draft) return <Loading label="Opening the website" />;

  const publish = async () => {
    clearTimeout(timer.current);
    setPublishing(true);
    try { const s = await api.publishWebsite(draft); setSite(s); setDraft(withDefaults(s.data)); setSaving('saved'); toast('Published. The changes are live.'); }
    catch (e) { toast(humanThrown(e, 'Publishing didn’t work. Try again.')); }
    finally { setPublishing(false); }
  };

  const fixes = checks(draft).filter((c) => c.level === 'fix' && (gainora || OWNER_AREAS.includes(c.where))).length;
  const tabs = ([
    { id: 'performance', label: 'Performance' },
    { id: 'edit', label: gainora ? 'Edit' : 'Your details', badge: fixes || null },
    { id: 'preview', label: 'Preview' },
    { id: 'changes', label: gainora ? 'Change requests' : 'Changes from Gainora' },
    { id: 'found', label: 'Get found' },
    { id: 'plan', label: 'Launch plan', badge: (() => { const p = planProgress(draft); return p.done < p.total ? `${p.done}/${p.total}` : null; })() },
    { id: 'settings', label: 'Address and tracking' },
  ] as { id: Tab; label: string; badge?: any }[]).filter((t) => gainora || OWNER_TABS.includes(t.id));
  return (
    <div className={embedded ? 'website embedded' : 'page website'}>
      {gainora && !embedded && <ClientBar current={client} onPick={switchClient} />}
      {api.mode === 'demo' && api.setWebsiteRole && !embedded && (
        <p className="demo-role small">Demo: <button type="button" className="linklike" onClick={() => { api.setWebsiteRole!(gainora ? 'owner' : 'gainora'); setSite(null); setDraft(null); reload(); }}>{gainora ? 'see it as the client sees it' : 'see it as Gainora sees it'}</button></p>
      )}
      <div className="page-head">
        <div>
          <h1 className="title">{gainora ? (draft.business.name || 'Website') : 'Your website'}</h1>
          <p className="lede">
            {site.live
              ? <>Live at <a href={site.liveUrl} target="_blank" rel="noreferrer">{site.liveUrl.replace(/^https:\/\//, '').replace(/\/$/, '')}</a>{site.publishedAt && <span className="faint"> · published {relative(site.publishedAt)}</span>}</>
              : gainora ? 'Not live yet.' : 'Gainora is building your website. You can keep your details up to date here.'}
          </p>
        </div>
        <div className="row gap-12 wrap">
          <span className="small faint" aria-live="polite">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Changes saved' : saving === 'error' ? 'Not saved' : ''}</span>
          {!gainora && <Button kind="secondary" icon="send" onClick={() => setAsking(true)}>Ask Gainora for a change</Button>}
          {site.live && <a className="btn btn-secondary" href={site.liveUrl} target="_blank" rel="noreferrer"><Icon name="external" />View site</a>}
          {(gainora || site.live) && <PublishButton site={site} fixes={fixes} busy={publishing} onPublish={publish} />}
        </div>
      </div>
      <Tabs<Tab> label="Website" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'performance' && <PerformanceTab site={site} />}
      {tab === 'edit' && <EditTab draft={draft} update={update} gainora={gainora} hasCapture={!!plan.capture} goPreview={() => setTab('preview')} ask={() => setAsking(true)} />}
      {tab === 'preview' && <PreviewTab draft={draft} site={site} />}
      {tab === 'changes' && <RequestsTab key={requestsKey} gainora={gainora} ask={() => setAsking(true)} />}
      {tab === 'found' && gainora && <FoundTab draft={draft} site={site} update={update} />}
      {tab === 'plan' && <PlanTab draft={draft} update={update} gainora={gainora} />}
      {tab === 'settings' && gainora && <SettingsTab site={site} setSite={(s) => { setSite(s); setDraft(withDefaults(s.data)); }} draft={draft} update={update} />}
      {asking && <AskChange draft={draft} onClose={() => setAsking(false)} onSent={() => { setAsking(false); setRequestsKey((k) => k + 1); toast('Sent to Gainora. You’ll get an email when it’s done.'); }} />}
    </div>
  );
}

/** Where on the Edit tab a client can fix something themselves. */
const OWNER_AREAS = ['Services', 'Reviews', 'Contact'];

/* ---------- Gainora's team: which client ---------- */

function ClientBar({ current, onPick }: { current: string | null; onPick: (slug: string | null) => void }) {
  const { data: sites } = useLoad<WebsiteListItem[]>(() => api.listWebsites().catch(() => []));
  return (
    <div className="client-bar">
      <span className="tag tag-forest">Gainora</span>
      <Field label="Working on">
        {(id) => (
          <select id={id} className="select" value={current ?? (api.mode === 'demo' ? sites?.[0]?.slug ?? '' : '')} onChange={(e: any) => onPick(e.target.value || null)}>
            <option value="">Gainora’s own website</option>
            {(sites ?? []).map((x) => <option key={x.slug} value={x.slug}>{x.name}{x.openRequests ? ` (${x.openRequests} to do)` : ''}{x.live ? '' : ' · not live'}</option>)}
          </select>
        )}
      </Field>
      <span className="xsmall faint">Only Gainora’s team sees this.</span>
    </div>
  );
}

/* ---------- Change requests ---------- */

function AskChange({ draft, onClose, onSent }: { draft: Site; onClose: () => void; onSent: () => void }) {
  const pages = pagesOf(draft).filter((p) => p.nav || p.kind === 'service');
  const [page, setPage] = useState('Whole site');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim()) { setErr('Say what you’d like changed.'); return; }
    setBusy(true); setErr(null);
    try { await api.requestWebsiteChange(page, text.trim()); onSent(); } catch (e) { setErr(humanThrown(e, 'That didn’t send. Try again.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Ask Gainora for a change" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={send}>Send to Gainora</Button></>}>
      <div className="stack gap-16">
        <p className="small muted">New photos, different wording, a new page, a change to the look: tell us what you’d like and we’ll do it, usually within two working days. Prices, services and opening hours you can change yourself under Your details.</p>
        <Field label="Which page">{(id) => <select id={id} className="select" value={page} onChange={(e: any) => setPage(e.target.value)}><option>Whole site</option>{pages.map((p) => <option key={p.path}>{p.kind === 'service' ? p.service!.name : p.nav}</option>)}</select>}</Field>
        <Field label="What would you like changed?" error={err ?? undefined}>{(id, d) => <textarea id={id} className="textarea" rows={5} value={text} aria-describedby={d} placeholder="For example: use the new photo of the treatment room at the top of the home page." onChange={(e: any) => setText(e.target.value)} />}</Field>
        <p className="xsmall faint">To send photos, reply to the email we send you when this arrives, or email hello@gainora.co.uk.</p>
      </div>
    </Modal>
  );
}

function RequestsTab({ gainora, ask }: { gainora: boolean; ask: () => void }) {
  const { data, loading, error, reload } = useLoad<ChangeRequest[]>(() => api.websiteRequests());
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (loading && !data) return <Loading label="Loading the change requests" />;
  if (error) return <ErrorNote message={error} retry={reload} />;
  const list = data ?? [];
  const done = async (r: ChangeRequest) => {
    setBusy(r.id);
    try { await api.completeWebsiteRequest(r.id, replies[r.id] || ''); toast('Marked done. The client has been emailed.'); reload(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(null); }
  };
  return (
    <div className="stack gap-16">
      {!gainora && (
        <section className="panel panel-pad row gap-16 wrap" style={{ justifyContent: 'space-between' }}>
          <div className="stack gap-4"><h2 className="heading">Gainora looks after your website</h2><p className="small muted">Ask for anything: new photos, different wording, a new page or a change to the look. Prices, services and hours you can change yourself.</p></div>
          <Button icon="send" onClick={ask}>Ask Gainora for a change</Button>
        </section>
      )}
      {list.length ? (
        <section className="panel" aria-label="Change requests">
          <ul className="requests">{list.map((r) => (
            <li key={r.id}>
              <div className="row gap-8 wrap" style={{ justifyContent: 'space-between' }}>
                <span className="row gap-8"><span className={`tag ${r.status === 'done' ? 'tag-forest' : 'tag-brass'}`}>{r.status === 'done' ? 'Done' : 'With Gainora'}</span><span className="small muted">{r.page}</span></span>
                <span className="xsmall faint">{relative(r.at)}{r.done_at ? ` · done ${relative(r.done_at)}` : ''}</span>
              </div>
              <p>{r.text}</p>
              {r.reply && <p className="small reply">{r.reply}</p>}
              {gainora && r.status === 'open' && (
                <div className="row gap-8 wrap">
                  <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Note for the client (optional)" aria-label="Note for the client" value={replies[r.id] ?? ''} onChange={(e: any) => setReplies({ ...replies, [r.id]: e.target.value })} />
                  <Button small busy={busy === r.id} icon="check" onClick={() => done(r)}>Mark done and tell them</Button>
                </div>
              )}
            </li>
          ))}</ul>
        </section>
      ) : <div className="panel empty"><p className="muted">{gainora ? 'No change requests from this client.' : 'Nothing asked for yet.'}</p></div>}
    </div>
  );
}

function PublishButton({ site, fixes, busy, onPublish }: { site: WebsiteState; fixes: number; busy: boolean; onPublish: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const label = site.live ? (site.changed ? 'Publish changes' : 'Published') : 'Publish website';
  return (
    <>
      <Button busy={busy} disabled={site.live && !site.changed} onClick={() => (fixes ? setConfirm(true) : onPublish())} icon={site.live && !site.changed ? 'check' : 'send'}>{label}</Button>
      {confirm && (
        <Modal title="Publish with things to fix?" onClose={() => setConfirm(false)} footer={<><Button kind="secondary" onClick={() => setConfirm(false)}>Go back and fix</Button><Button onClick={() => { setConfirm(false); onPublish(); }}>Publish anyway</Button></>}>
          <p>The Edit tab lists {fixes} thing{fixes === 1 ? '' : 's'} to fix before this goes in front of customers. You can publish now and fix them after.</p>
        </Modal>
      )}
    </>
  );
}

/* ---------- Not on the plan ---------- */

function WebsiteUpsell({ hasCapture }: { hasCapture: boolean }) {
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Your website</h1><p className="lede">With Launch &amp; Grow, Gainora builds your website, hosts it on your own domain and looks after it, and Command Centre shows you every visit, call and enquiry it brings in.</p></div></div>
      <div className="grid-2">
        <section className="panel panel-pad stack gap-16">
          <h2 className="heading">What you get</h2>
          <ul className="ticklist">
            <li>A five to eight page website written for your customers, fast on a phone, in your name</li>
            <li>Your Google Business Profile set up and posted to every week</li>
            <li>Your details made the same on every listing, so Google trusts them</li>
            <li>A reviews system and one ad channel, managed for you</li>
            <li>Every visit, call tap and enquiry in Command Centre, with where it came from</li>
            {hasCapture && <li>Website enquiries go straight into Capture &amp; Convert and get followed up</li>}
          </ul>
          <div className="row gap-12 wrap"><a className="btn btn-primary" href="https://gainora.co.uk/packages/#launch-grow" target="_blank" rel="noreferrer">See Launch &amp; Grow</a><a className="btn btn-secondary" href="mailto:hello@gainora.co.uk?subject=Launch%20%26%20Grow">Ask Gainora</a></div>
        </section>
        <aside className="panel panel-pad stack gap-12">
          <h2 className="heading">You own all of it</h2>
          <p className="muted">The website, the domain, the Google profile and the ad account are set up in your name. If you ever leave, they stay with you.</p>
        </aside>
      </div>
    </div>
  );
}

/* ---------- Performance ---------- */

function Bars({ values, label, tone }: { values: number[]; label: string; tone: 'ink' | 'gold' }) {
  const max = Math.max(1, ...values);
  const w = 100 / Math.max(1, values.length);
  return (
    <svg className="bars" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={40 - (v / max) * 38} height={(v / max) * 38} className={tone === 'gold' ? 'bar-gold' : 'bar-ink'} />)}
    </svg>
  );
}

function PerformanceTab({ site }: { site: WebsiteState }) {
  const [days, setDays] = useState(28);
  const { data: perf, error, loading, reload } = useLoad<Performance>(() => api.websiteStats(days), [days]);
  const { data: enquiries } = useLoad<WebsiteEnquiry[]>(() => api.websiteEnquiries().catch(() => []));
  if (!site.live) {
    return <div className="panel empty"><h2 className="heading">Numbers start when the site is live</h2><p className="muted">Publish the website and this page fills in with visitors, call taps, booking clicks and enquiries, and where each one came from. No cookies, so no cookie banner.</p></div>;
  }
  if (loading && !perf) return <Loading label="Loading your website numbers" />;
  if (error || !perf) return <ErrorNote message={error ?? 'The numbers could not load.'} retry={reload} />;
  const quiet = perf.people === 0;
  return (
    <div className="stack gap-24">
      <div className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
        <p className="muted small">{quiet ? 'No visits counted yet in this period.' : `The last ${perf.days} days, compared with the ${perf.days} before.`}</p>
        <div className="seg" role="group" aria-label="Period">{[7, 28, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div>
      </div>
      <section className="panel stats" aria-label="Summary">
        <div className="stat"><span className="stat-label">People who visited</span><span className="stat-value">{perf.people}</span><span className="stat-note">{change(perf.people, perf.previous.people)}</span></div>
        <div className="stat"><span className="stat-label">Calls and booking clicks</span><span className="stat-value">{perf.calls + perf.bookings}</span><span className="stat-note">{perf.calls} call taps, {perf.bookings} booking clicks</span></div>
        <div className="stat"><span className="stat-label">Enquiries from the form</span><span className="stat-value">{perf.enquiries}</span><span className="stat-note">{change(perf.actions, perf.previous.actions).replace('the period before', 'before (all contacts)')}</span></div>
        <div className="stat"><span className="stat-label">Visitors who got in touch</span><span className="stat-value">{pctOf(perf.rate)}</span><span className="stat-note">A local business site usually turns 3% to 8% of visitors into contacts</span></div>
      </section>
      <div className="grid-2">
        <section className="panel panel-pad stack gap-16" aria-labelledby="trend-h">
          <h2 className="heading" id="trend-h">Day by day</h2>
          <div className="stack gap-6"><span className="small muted">People a day</span><Bars values={perf.daily.map((d) => d.people)} label={`People a day over ${perf.days} days, up to ${Math.max(...perf.daily.map((d) => d.people))}`} tone="ink" /></div>
          <div className="stack gap-6"><span className="small muted">Calls, bookings and enquiries a day</span><Bars values={perf.daily.map((d) => d.actions)} label={`Contacts a day over ${perf.days} days`} tone="gold" /></div>
          <p className="xsmall faint">{shortDate(perf.daily[0]?.date || perf.from)} to {shortDate(perf.daily[perf.daily.length - 1]?.date || perf.to)}{perf.phoneShare != null && ` · ${Math.round(perf.phoneShare * 100)}% of visits were on a phone`}</p>
        </section>
        <section className="panel" aria-labelledby="src-h">
          <div className="panel-head"><h2 className="heading" id="src-h">Where they came from</h2></div>
          {perf.sources.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Source</th><th className="num">People</th><th className="num">Got in touch</th></tr></thead>
              <tbody>{perf.sources.map((r) => <tr key={r.source}><td>{r.source}</td><td className="num">{r.people}</td><td className="num">{r.actions}{r.people ? <span className="faint"> · {pctOf(r.actions / r.people)}</span> : ''}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="panel-pad muted">Nothing yet.</p>}
        </section>
      </div>
      <div className="grid-2">
        <section className="panel" aria-labelledby="enq-h">
          <div className="panel-head"><h2 className="heading" id="enq-h">Enquiries from the website</h2><span className="small faint">{enquiries?.length ?? 0}</span></div>
          {enquiries?.length ? (
            <ul className="enquiries">{enquiries.slice(0, 20).map((e) => (
              <li key={e.id}>
                <div className="row gap-8 wrap" style={{ justifyContent: 'space-between' }}><strong>{e.name}</strong><span className="xsmall faint">{relative(e.at)}</span></div>
                {e.service && <span className="tag tag-plain">{e.service}</span>}
                {e.message && <p className="small">{e.message}</p>}
                <p className="xsmall muted">{[e.phone, e.email, e.postcode].filter(Boolean).join(' · ')}</p>
                <p className="xsmall faint">Found you through {e.source}{e.forwarded ? ' · also in Capture & Convert' : ''}</p>
              </li>
            ))}</ul>
          ) : <p className="panel-pad muted">Messages sent through the website’s form appear here, and you get an email for each one.</p>}
        </section>
        <section className="panel" aria-labelledby="pages-h">
          <div className="panel-head"><h2 className="heading" id="pages-h">Most-read pages</h2></div>
          {perf.pages.length ? (
            <div className="table-wrap"><table><thead><tr><th>Page</th><th className="num">Views</th></tr></thead>
              <tbody>{perf.pages.map((p) => <tr key={p.path}><td><code>{p.path.replace(/^\/site\/[^/]+/, '') || '/'}</code></td><td className="num">{p.views}</td></tr>)}</tbody></table></div>
          ) : <p className="panel-pad muted">Nothing yet.</p>}
        </section>
      </div>
      <p className="xsmall faint">Counted without cookies: a visitor is counted once a day and can’t be identified. Calls are taps on the phone number on the site; calls from the Google profile or ads show in Google’s own reports.</p>
    </div>
  );
}

/* ---------- Edit ---------- */

const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

function Section({ title, intro, children, open: start = false }: { title: string; intro?: string; children: any; open?: boolean }) {
  return (
    <details className="panel edit-section" open={start}>
      <summary><span className="heading">{title}</span>{intro && <span className="small muted">{intro}</span>}</summary>
      <div className="edit-body">{children}</div>
    </details>
  );
}

function Text({ label, value, onChange, help, placeholder, type = 'text', optional, long }: { label: string; value: string; onChange: (v: string) => void; help?: string; placeholder?: string; type?: string; optional?: boolean; long?: boolean }) {
  return (
    <Field label={label} help={help} optional={optional}>
      {(id, d) => long
        ? <textarea id={id} className="textarea" value={value} placeholder={placeholder} aria-describedby={d} onChange={(e: any) => onChange(e.target.value)} rows={4} />
        : <input id={id} className="input" type={type} value={value} placeholder={placeholder} aria-describedby={d} onChange={(e: any) => onChange(e.target.value)} />}
    </Field>
  );
}

function EditTab({ draft, update, gainora, hasCapture, goPreview, ask }: { draft: Site; update: (s: Site) => void; gainora: boolean; hasCapture: boolean; goPreview: () => void; ask: () => void }) {
  const b = draft.business;
  const set = (patch: Partial<Site['business']>) => update({ ...draft, business: { ...b, ...patch } });
  const list = checks(draft).filter((c) => gainora || c.level === 'good' || OWNER_AREAS.includes(c.where));
  return (
    <div className="stack gap-16">
      <ChecksPanel list={list} />
      {!gainora && (
        <section className="panel panel-pad row gap-16 wrap" style={{ justifyContent: 'space-between' }}>
          <div className="stack gap-4"><h2 className="heading">Design, wording and photos</h2><p className="small muted">Gainora looks after these for you. Tell us what you’d like and we’ll change it.</p></div>
          <Button kind="secondary" icon="send" onClick={ask}>Ask Gainora for a change</Button>
        </section>
      )}
      {gainora && (
        <Section title="The business" intro="Name, kind of business and what sets it apart" open>
          <div className="form-grid">
            <Text label="Business name" value={b.name} onChange={(v) => set({ name: v })} help="Exactly as on the sign and the paperwork." />
            <Field label="Kind of business">
              {(id) => <select id={id} className="select" value={b.industry} onChange={(e: any) => { const ind = INDUSTRIES[e.target.value as IndustryId]; set({ industry: ind.id, trade: ind.trade, showAddress: !ind.mobile }); }}>{INDUSTRY_LIST.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select>}
            </Field>
            <Text label="What customers would call it" value={b.trade} onChange={(v) => set({ trade: v })} help="As people search: “skin clinic”, “plumber”." />
            <Text label="Owner’s name" value={b.owner} onChange={(v) => set({ owner: v })} optional />
            <Text label="Year they started" value={b.founded} onChange={(v) => set({ founded: v.replace(/\D/g, '').slice(0, 4) })} optional />
            <label className="check-row"><input type="checkbox" checked={b.showAddress} onChange={(e: any) => set({ showAddress: e.target.checked })} /> Show the address (customers come to them)</label>
          </div>
          <div className="form-grid">
            <Text long label="Qualifications, memberships and insurance" value={b.credentials.join('\n')} onChange={(v) => set({ credentials: lines(v) })} help="One per line. Only what’s true and they can show." optional />
            <Text long label="What makes them different" value={b.differences.join('\n')} onChange={(v) => set({ differences: lines(v) })} help="One per line. These become the site’s “why us”." optional />
          </div>
        </Section>
      )}
      <Section title="Contact details" intro="Phone, email, address and the areas covered" open={!gainora}>
        <div className="form-grid">
          <Text label="Phone" type="tel" value={b.phone} onChange={(v) => set({ phone: v })} />
          <Text label="Email" type="email" value={b.email} onChange={(v) => set({ email: v })} optional />
          <Text label="Street address" value={b.line1} onChange={(v) => set({ line1: v })} optional={!b.showAddress} />
          <Text label="Address line 2" value={b.line2} onChange={(v) => set({ line2: v })} optional />
          <Text label="Town" value={b.town} onChange={(v) => set({ town: v })} />
          <Text label="Postcode" value={b.postcode} onChange={(v) => set({ postcode: v.toUpperCase() })} />
          <Text label="Towns and areas covered" value={b.areas.join(', ')} onChange={(v) => set({ areas: v.split(',').map((x) => x.trim()).filter(Boolean) })} help="Separate with commas." />
        </div>
        {!gainora && <p className="xsmall faint">Changing your phone or address? Tell Gainora too, so your Google profile and listings are updated to match.</p>}
      </Section>
      <Section title="Opening hours" intro="Shown on the site and in Google">
        <div className="hours-grid">
          {DAYS.map((d) => (
            <Field key={d.id} label={d.label} help={hoursLabel(b.hours[d.id])}>
              {(id, desc) => <input id={id} className="input" value={b.hours[d.id]} placeholder="Closed" aria-describedby={desc} onChange={(e: any) => set({ hours: { ...b.hours, [d.id]: e.target.value } })} />}
            </Field>
          ))}
        </div>
        <p className="xsmall faint">Type times like 9:00-17:30. Leave empty when closed.</p>
      </Section>
      <ServicesEditor draft={draft} update={update} gainora={gainora} />
      {gainora && <WordsEditor draft={draft} update={update} />}
      <Section title="Reviews" intro="Only real reviews, with the name the customer used">
        <Text label="Google review link" value={draft.reviewLink} onChange={(v) => update({ ...draft, reviewLink: v.trim() })} help="From the Google profile: Ask for reviews → copy the link." placeholder="https://g.page/r/…/review" />
        {draft.reviews.map((r, i) => (
          <div key={r.id} className="repeat-row">
            <Text long label={`Review ${i + 1}`} value={r.text} onChange={(v) => update({ ...draft, reviews: draft.reviews.map((x) => (x.id === r.id ? { ...x, text: v } : x)) })} />
            <div className="form-grid">
              <Text label="Their name, as they gave it" value={r.name} onChange={(v) => update({ ...draft, reviews: draft.reviews.map((x) => (x.id === r.id ? { ...x, name: v } : x)) })} />
              <Text label="Where they left it" value={r.source} placeholder="Google" onChange={(v) => update({ ...draft, reviews: draft.reviews.map((x) => (x.id === r.id ? { ...x, source: v } : x)) })} />
            </div>
            <Button kind="quiet" small icon="x" onClick={() => update({ ...draft, reviews: draft.reviews.filter((x) => x.id !== r.id) })}>Remove</Button>
          </div>
        ))}
        {draft.reviews.length < 12 && <div><Button kind="secondary" small icon="plus" onClick={() => update({ ...draft, reviews: [...draft.reviews, { id: uid(), text: '', name: '', source: 'Google' }] })}>Add a review</Button></div>}
      </Section>
      {gainora && <LookEditor draft={draft} update={update} />}
      <Section title="Booking and enquiries" intro="Where the main button goes">
        <div className="form-grid">
          <Text label="Online booking link" value={draft.booking.url} onChange={(v) => update({ ...draft, booking: { ...draft.booking, url: v.trim() } })} placeholder="https://…" help="The booking page (Capture & Convert, Fresha, Phorest…). Empty: the button opens the enquiry form." optional />
          {gainora && <Text label="Button wording" value={draft.booking.label} onChange={(v) => update({ ...draft, booking: { ...draft.booking, label: v } })} placeholder={INDUSTRIES[b.industry].cta.label} optional />}
        </div>
        {hasCapture && <Text label="Capture & Convert website form link" value={draft.captureFormUrl} onChange={(v) => update({ ...draft, captureFormUrl: v.trim() })} help="From Capture & Convert → Receptionist → Website form. Every website enquiry then lands there too, with its follow-ups." placeholder="https://capture.gainora.co.uk/api/enquiry-in/…" optional />}
      </Section>
      <div className="row gap-12"><Button kind="secondary" icon="watcher" onClick={goPreview}>Preview the site</Button></div>
    </div>
  );
}

function ChecksPanel({ list }: { list: ReturnType<typeof checks> }) {
  const fixes = list.filter((c) => c.level === 'fix');
  const notes = list.filter((c) => c.level === 'check');
  if (!fixes.length && !notes.length) return <div className="panel panel-pad row gap-12"><span className="tag tag-forest">Ready</span><span className="small">Nothing needs fixing before it goes live.</span></div>;
  return (
    <section className="panel" aria-labelledby="checks-h">
      <div className="panel-head"><h2 className="heading" id="checks-h">Before it goes live</h2><span className="small faint">{fixes.length} to fix, {notes.length} to check</span></div>
      <ul className="checks">
        {[...fixes, ...notes].map((c, i) => <li key={i}><span className={`tag ${c.level === 'fix' ? 'tag-danger' : 'tag-brass'}`}>{c.level === 'fix' ? 'Fix' : 'Check'}</span><span className="small">{c.text}</span>{c.where && <span className="xsmall faint">{c.where}</span>}</li>)}
      </ul>
    </section>
  );
}

function ServicesEditor({ draft, update, gainora }: { draft: Site; update: (s: Site) => void; gainora: boolean }) {
  const setSvc = (id: string, patch: Partial<Service>) => update({ ...draft, services: draft.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const move = (i: number, dir: -1 | 1) => { const s = [...draft.services]; const j = i + dir; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; update({ ...draft, services: s }); };
  const pages = draft.services.filter((x) => x.page).length;
  return (
    <Section title="Services and prices" intro={`${draft.services.length} on the site · ${Math.min(4, pages)} with their own page`}>
      {draft.services.map((x, i) => (
        <div key={x.id} className="repeat-row">
          <div className="form-grid three">
            <Text label="Name" value={x.name} onChange={(v) => setSvc(x.id, { name: v })} />
            <Text label="Price" value={x.price} onChange={(v) => setSvc(x.id, { price: v })} placeholder="From £50" />
            <Text label="How long" value={x.duration} onChange={(v) => setSvc(x.id, { duration: v })} placeholder="45 minutes" optional />
          </div>
          <Text label="In a sentence" value={x.summary} onChange={(v) => setSvc(x.id, { summary: v })} />
          <div className="row gap-12 wrap">
            {gainora
              ? <label className="check-row"><input type="checkbox" checked={x.page} disabled={!x.page && pages >= 4} onChange={(e: any) => setSvc(x.id, { page: e.target.checked })} /> Its own page (helps it get found on Google)</label>
              : x.page ? <span className="tag tag-plain">Has its own page</span> : null}
            <span className="row gap-4" style={{ marginLeft: 'auto' }}>
              <Button kind="quiet" small onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${x.name} up`}>Up</Button>
              <Button kind="quiet" small onClick={() => move(i, 1)} disabled={i === draft.services.length - 1} aria-label={`Move ${x.name} down`}>Down</Button>
              <Button kind="quiet" small icon="x" onClick={() => update({ ...draft, services: draft.services.filter((s) => s.id !== x.id) })}>Remove</Button>
            </span>
          </div>
        </div>
      ))}
      {draft.services.length < 20 && <div><Button kind="secondary" small icon="plus" onClick={() => update({ ...draft, services: [...draft.services, { id: uid(), name: '', price: '', duration: '', summary: '', page: false }] })}>Add a service</Button></div>}
    </Section>
  );
}

function WordsEditor({ draft, update }: { draft: Site; update: (s: Site) => void }) {
  const fields = copyFields(draft);
  const defaults = defaultCopy(draft);
  const faqs: Faq[] = draft.faqs ?? defaultFaqs(draft);
  const setCopy = (k: string, v: string) => { const c = { ...draft.copy }; if (v.trim() && v !== defaults[k]) c[k] = v; else delete c[k]; update({ ...draft, copy: c }); };
  const setFaqs = (list: Faq[]) => update({ ...draft, faqs: list });
  return (
    <Section title="Words on the site" intro="Written for you from the details above. Change anything.">
      {fields.map((f) => {
        const own = draft.copy[f.key] != null;
        return (
          <div key={f.key} className="stack gap-4">
            <Text long={f.long} label={`${f.label} · ${f.page}`} value={draft.copy[f.key] ?? defaults[f.key] ?? ''} onChange={(v) => setCopy(f.key, v)} help={f.key === 'meta.description' ? `${(draft.copy[f.key] ?? defaults[f.key]).length} characters; Google shows about 155.` : undefined} />
            {own && <div><Button kind="quiet" small onClick={() => setCopy(f.key, '')}>Use Gainora’s wording again</Button></div>}
          </div>
        );
      })}
      <h3 className="subhead">Questions and answers</h3>
      {faqs.map((f, i) => (
        <div key={i} className="repeat-row">
          <Text label="Question" value={f.q} onChange={(v) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, q: v } : x)))} />
          <Text long label="Answer" value={f.a} onChange={(v) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, a: v } : x)))} />
          <Button kind="quiet" small icon="x" onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div className="row gap-12 wrap">
        {faqs.length < 12 && <Button kind="secondary" small icon="plus" onClick={() => setFaqs([...faqs, { q: '', a: '' }])}>Add a question</Button>}
        {draft.faqs && <Button kind="quiet" small onClick={() => update({ ...draft, faqs: null })}>Use the suggested questions</Button>}
      </div>
    </Section>
  );
}

function PhotoPicker({ label, photo, onChange, help }: { label: string; photo: Photo | null; onChange: (p: Photo | null) => void; help?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pick = async (e: any) => {
    const f: File | undefined = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { onChange(await api.uploadSitePhoto(f)); } catch (err) { toast(humanThrown(err, 'The photo didn’t upload.')); } finally { setBusy(false); }
  };
  return (
    <div className="photo-pick">
      <div className="photo-thumb">{photo ? <img src={photo.url} alt="" /> : <Icon name="plus" />}</div>
      <div className="stack gap-8" style={{ minWidth: 0, flex: 1 }}>
        <strong className="small">{label}</strong>
        {help && <span className="xsmall faint">{help}</span>}
        {photo && <input className="input" value={photo.alt} placeholder="Describe the photo, e.g. “The treatment room at Willow”" aria-label={`Describe the ${label.toLowerCase()}`} onChange={(e: any) => onChange({ ...photo, alt: e.target.value })} />}
        <div className="row gap-8">
          <label className={`btn btn-secondary btn-small${busy ? ' is-disabled' : ''}`}>{busy ? 'Uploading…' : photo ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" hidden onChange={pick} /></label>
          {photo && <Button kind="quiet" small onClick={() => onChange(null)}>Remove</Button>}
        </div>
      </div>
    </div>
  );
}

const SHAPES: { id: Style; label: string; note: string }[] = [
  { id: 'calm', label: 'Soft', note: 'Gently rounded corners' },
  { id: 'warm', label: 'Round', note: 'Pill buttons, generous curves' },
  { id: 'bold', label: 'Square', note: 'Crisp edges, direct' },
];
const HEROES: { id: HeroLayout; label: string; note: string }[] = [
  { id: 'split', label: 'Side by side', note: 'Words beside the main photo' },
  { id: 'full', label: 'Full photo', note: 'Words over a full-width photo (needs the main photo)' },
  { id: 'centred', label: 'Centred', note: 'Centred words above a wide photo' },
];
const SURFACES: { id: Surface; label: string; note: string }[] = [
  { id: 'light', label: 'Light', note: 'Clean and bright' },
  { id: 'tinted', label: 'Tinted', note: 'A soft wash of the brand colour' },
  { id: 'deep', label: 'Deep', note: 'Dark top and call-to-action' },
];
const SECTION_LABELS: [keyof Sections, string][] = [['how', 'How it works'], ['why', 'Why choose us'], ['gallery', 'Photo strip (4+ photos)'], ['reviews', 'Reviews'], ['faq', 'Questions']];

/** Loads the site fonts once so the choices can be seen in the editor. */
function useSiteFonts() {
  useEffect(() => {
    if (document.getElementById('site-fonts')) return;
    const l = document.createElement('link');
    l.id = 'site-fonts'; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?${Object.values(FONTS).map((f) => f.href).join('&')}&display=swap`;
    document.head.appendChild(l);
  }, []);
}

function Choice<T extends string>({ label, value, options, onChange, render }: { label: string; value: T; options: { id: T; label: string; note: string }[]; onChange: (v: T) => void; render?: (id: T, label: string) => any }) {
  return (
    <div className="stack gap-8">
      <strong className="small">{label}</strong>
      <div className="style-pick" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className="style-card" onClick={() => onChange(o.id)}>
            {render ? render(o.id, o.label) : <span className="style-name">{o.label}</span>}<span className="xsmall muted">{o.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LookEditor({ draft, update }: { draft: Site; update: (s: Site) => void }) {
  useSiteFonts();
  const look = draft.look;
  const set = (patch: Partial<Site['look']>) => update({ ...draft, look: { ...look, ...patch } });
  const toast = useToast();
  const sections = { ...DEFAULT_SECTIONS, ...look.sections };
  const addGallery = async (e: any) => {
    const files: File[] = Array.from(e.target.files ?? []);
    e.target.value = '';
    const room = 12 - look.gallery.length;
    const added: Photo[] = [];
    for (const f of files.slice(0, room)) { try { added.push(await api.uploadSitePhoto(f)); } catch (err) { toast(humanThrown(err, 'A photo didn’t upload.')); } }
    if (added.length) set({ gallery: [...look.gallery, ...added] });
  };
  return (
    <Section title="Design" intro="Fonts, layout, colour and photos. Only Gainora sees this.">
      <Choice<FontPair> label="Fonts" value={look.fonts} onChange={(v) => set({ fonts: v })}
        options={(Object.keys(FONTS) as FontPair[]).map((k) => ({ id: k, label: FONTS[k].label, note: FONTS[k].display.split(',')[0].replace(/"/g, '') + (FONTS[k].display === FONTS[k].body ? '' : ` with ${FONTS[k].body.split(',')[0].replace(/"/g, '')}`) }))}
        render={(id, label) => <span className="style-name" style={{ fontFamily: FONTS[id].display, fontWeight: FONTS[id].displayWeight }}>{label}</span>} />
      <Choice<HeroLayout> label="Top of the home page" value={look.heroLayout} options={HEROES} onChange={(v) => set({ heroLayout: v })} />
      <Choice<Surface> label="Tone" value={look.surface} options={SURFACES} onChange={(v) => set({ surface: v })} />
      <Choice<Style> label="Shape" value={look.style} options={SHAPES} onChange={(v) => set({ style: v })} />
      <div className="stack gap-8">
        <strong className="small">Brand colour</strong>
        <div className="swatches" role="radiogroup" aria-label="Brand colour">
          {PALETTES.map((p) => <button key={p.accent} type="button" role="radio" aria-checked={look.accent.toLowerCase() === p.accent.toLowerCase()} className="swatch" style={{ background: p.accent }} title={p.name} aria-label={p.name} onClick={() => set({ accent: p.accent })} />)}
        </div>
        <div className="row gap-12"><input type="color" value={look.accent} aria-label="Any colour" onChange={(e: any) => set({ accent: e.target.value })} className="color-input" /><input className="input" style={{ maxWidth: 140 }} value={look.accent} aria-label="Colour code" onChange={(e: any) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && set({ accent: e.target.value })} /><span className="xsmall faint">Match their logo or shop front. Darkened automatically if white text wouldn’t be readable on it.</span></div>
      </div>
      <div className="stack gap-8">
        <strong className="small">Sections on the home page</strong>
        <div className="row gap-16 wrap">{SECTION_LABELS.map(([k, l]) => <label key={k} className="check-row"><input type="checkbox" checked={sections[k]} onChange={(e: any) => set({ sections: { ...sections, [k]: e.target.checked } })} /> {l}</label>)}</div>
      </div>
      <PhotoPicker label="Logo" photo={look.logo} onChange={(p) => set({ logo: p })} help="Without one, the name is set in the heading font." />
      <PhotoPicker label="Main photo" photo={look.hero} onChange={(p) => set({ hero: p })} help={`Top of the home page. Ideas: ${INDUSTRIES[draft.business.industry].photoIdeas[0].toLowerCase()}.`} />
      <PhotoPicker label="About photo" photo={look.about} onChange={(p) => set({ about: p })} help="The owner or team, or where they work." />
      <div className="stack gap-8">
        <strong className="small">More photos ({look.gallery.length} of 12)</strong>
        {look.gallery.length > 0 && <div className="gallery-edit">{look.gallery.map((g) => <figure key={g.id}><img src={g.url} alt={g.alt} /><input className="input" value={g.alt} placeholder="Describe it" aria-label="Describe this photo" onChange={(e: any) => set({ gallery: look.gallery.map((x) => (x.id === g.id ? { ...x, alt: e.target.value } : x)) })} /><Button kind="quiet" small onClick={() => set({ gallery: look.gallery.filter((x) => x.id !== g.id) })}>Remove</Button></figure>)}</div>}
        {look.gallery.length < 12 && <div><label className="btn btn-secondary btn-small">Add photos<input type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={addGallery} /></label></div>}
      </div>
    </Section>
  );
}

/* ---------- Preview ---------- */

function PreviewTab({ draft, site }: { draft: Site; site: WebsiteState }) {
  const pages = pagesOf(draft).filter((p) => p.kind !== 'thanks');
  const [path, setPath] = useState('');
  const [device, setDevice] = useState<'phone' | 'computer'>('phone');
  const frame = useRef<HTMLIFrameElement | null>(null);
  const html = useMemo(() => renderPage(draft, path, { base: '/', siteId: '', origin: site.liveUrl, preview: true })?.html ?? '', [draft, path, site.liveUrl]);
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    const wire = () => {
      const doc = f.contentDocument;
      if (!doc) return;
      // Links between the site's own pages open here; outside links open in a new tab; forms don't send.
      doc.addEventListener('click', (e: any) => {
        const a = e.target.closest?.('a');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        if (href.startsWith('/')) { e.preventDefault(); const p = href.replace(/^\//, '').split('#')[0]; if (pages.some((x) => x.path === p) || p === 'thanks/') setPath(p); }
        else if (/^https?:/.test(href)) { e.preventDefault(); window.open(href, '_blank', 'noopener'); }
        else if (/^(tel|mailto):/.test(href)) e.preventDefault();
      });
      doc.addEventListener('submit', (e: any) => { e.preventDefault(); setPath('thanks/'); });
    };
    f.addEventListener('load', wire);
    return () => f.removeEventListener('load', wire);
  }, [html]);
  return (
    <div className="stack gap-16">
      <div className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
        <Field label="Page">{(id) => <select id={id} className="select" value={path} onChange={(e: any) => setPath(e.target.value)}>{pages.map((p) => <option key={p.path} value={p.path}>{p.nav ? p.nav : p.title.split(' | ')[0]}{p.kind === 'service' ? ` (${p.service!.name})` : ''}</option>)}</select>}</Field>
        <div className="seg" role="group" aria-label="Screen">{(['phone', 'computer'] as const).map((d) => <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>{d === 'phone' ? 'Phone' : 'Computer'}</button>)}</div>
      </div>
      <div className={`preview-stage ${device}`}>
        <iframe ref={frame} title="Website preview" srcDoc={html} className="preview-frame" />
      </div>
      <p className="xsmall faint">This is your draft. Visitors see it after you publish. The form and phone links don’t send anything in the preview.</p>
    </div>
  );
}

/* ---------- Get found ---------- */

function CopyBlock({ label, text, max }: { label: string; text: string; max?: number }) {
  const toast = useToast();
  return (
    <div className="copy-block">
      <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
        <strong className="small">{label}</strong>
        <span className="row gap-8">{max && <span className={`xsmall ${text.length > max ? 'down' : 'faint'}`}>{text.length}/{max}</span>}<Button kind="quiet" small icon="copy" onClick={async () => toast((await copyText(text)) ? 'Copied' : 'Select the text and copy it')}>Copy</Button></span>
      </div>
      <pre className="copy-text">{text}</pre>
    </div>
  );
}

function FoundTab({ draft, site, update }: { draft: Site; site: WebsiteState; update: (s: Site) => void }) {
  const [part, setPart] = useState<'profile' | 'listings' | 'reviews' | 'ads'>('profile');
  const pack = profilePack(draft, site.liveUrl);
  const kit = reviewKit(draft);
  const ads = adsPlan(draft, site.liveUrl);
  const download = () => {
    const url = URL.createObjectURL(new Blob([adsCsv(ads)], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${draft.slug || 'website'}-google-ads-keywords.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="stack gap-16">
      <div className="seg" role="group" aria-label="Part">{([['profile', 'Google profile'], ['listings', 'Listings'], ['reviews', 'Reviews'], ['ads', 'Google Ads plan']] as const).map(([id, l]) => <button key={id} type="button" aria-pressed={part === id} onClick={() => setPart(id)}>{l}</button>)}</div>
      {part === 'profile' && (
        <div className="grid-2">
          <section className="panel panel-pad stack gap-16">
            <h2 className="heading">Google Business Profile</h2>
            <p className="small muted">Everything to paste into the profile, matching the website word for word.</p>
            {pack.nameWarning && <p className="err">{pack.nameWarning}</p>}
            <CopyBlock label="Business name" text={pack.name} />
            <CopyBlock label="Description" text={pack.description} max={750} />
            <CopyBlock label="Website link (tracked, so Performance shows visits from the profile)" text={pack.website} />
            <CopyBlock label="Opening hours" text={pack.hours.join('\n')} />
            {pack.areas.length > 0 && <CopyBlock label="Service areas (up to 20)" text={pack.areas.join('\n')} />}
            <CopyBlock label="Services" text={pack.services.map((s) => `${s.name}${s.price ? ` (${s.price})` : ''}\n${s.description}`).join('\n\n')} />
          </section>
          <aside className="stack gap-16">
            <section className="panel panel-pad stack gap-8">
              <h2 className="heading">Categories</h2>
              {pack.primary ? <><p className="small"><strong>Main:</strong> {pack.primary}</p><p className="small"><strong>Also:</strong> {pack.secondary.join(', ')}</p></> : <p className="small muted">Pick the closest match from Google’s own list.</p>}
              <p className="xsmall faint">Use the closest names in Google’s list; the main category matters most.</p>
            </section>
            <section className="panel panel-pad stack gap-12">
              <h2 className="heading">First four posts</h2>
              {pack.posts.map((p, i) => <CopyBlock key={i} label={`${p.title} · button: ${p.button}`} text={p.text} max={1500} />)}
            </section>
            <section className="panel panel-pad stack gap-8">
              <h2 className="heading">Photos to add</h2>
              <ul className="ticklist small">{pack.photos.map((p) => <li key={p}>{p}</li>)}</ul>
            </section>
          </aside>
        </div>
      )}
      {part === 'listings' && (
        <div className="grid-2">
          <section className="panel">
            <div className="panel-head"><h2 className="heading">Where to list the business</h2></div>
            <div className="table-wrap"><table><thead><tr><th>Site</th><th>Notes</th></tr></thead><tbody>
              {directoriesFor(draft).map((d) => <tr key={d.name}><td><a href={d.url} target="_blank" rel="noreferrer">{d.name}</a></td><td className="small muted">{d.note}</td></tr>)}
            </tbody></table></div>
          </section>
          <aside className="panel panel-pad stack gap-12">
            <h2 className="heading">The same everywhere</h2>
            <p className="small muted">Google trusts a business more when its name, address and phone are identical on every site. Paste exactly this.</p>
            <CopyBlock label="Name, address, phone" text={napBlock(draft)} />
            <p className="xsmall faint">Check each site’s terms before signing up; some charge or take a commission.</p>
          </aside>
        </div>
      )}
      {part === 'reviews' && (
        <div className="grid-2">
          <section className="panel panel-pad stack gap-16">
            <h2 className="heading">Asking for reviews</h2>
            <p className="small"><strong>When to ask:</strong> {kit.when}</p>
            {!draft.reviewLink && <p className="small err">Add the Google review link on the Edit tab and it goes into these messages.</p>}
            <CopyBlock label="Text message" text={kit.sms} />
            <CopyBlock label={`Email · subject: ${kit.email.subject}`} text={kit.email.body} />
          </section>
          <aside className="stack gap-16">
            <section className="panel panel-pad stack gap-12">
              <h2 className="heading">Replying</h2>
              {kit.replies.map((r) => <CopyBlock key={r.label} label={r.label} text={r.text} />)}
            </section>
            <section className="panel panel-pad stack gap-8">
              <h2 className="heading">The rules</h2>
              <ul className="ticklist small">{kit.rules.map((r) => <li key={r}>{r}</li>)}</ul>
            </section>
          </aside>
        </div>
      )}
      {part === 'ads' && (
        <div className="stack gap-16">
          <section className="panel panel-pad stack gap-16">
            <div className="row gap-16 wrap" style={{ alignItems: 'flex-end' }}>
              <Field label="Monthly ad budget (£)">{(id) => <input id={id} className="input" type="number" min={0} step={50} style={{ maxWidth: 160 }} value={draft.ads.monthly} onChange={(e: any) => update({ ...draft, ads: { ...draft.ads, monthly: Number(e.target.value) || 0 } })} />}</Field>
              <Field label="Radius (miles)">{(id) => <input id={id} className="input" type="number" min={1} max={100} style={{ maxWidth: 120 }} value={draft.ads.radiusMiles} onChange={(e: any) => update({ ...draft, ads: { ...draft.ads, radiusMiles: Number(e.target.value) || 1 } })} />}</Field>
              <Button kind="secondary" icon="download" onClick={download}>Keywords as a spreadsheet</Button>
            </div>
            <dl className="facts-list">
              <div><dt>Campaign</dt><dd>{ads.campaign}</dd></div>
              <div><dt>Daily budget</dt><dd>£{ads.daily.toFixed(2)} (paid by the business, straight to Google)</dd></div>
              <div><dt>Where</dt><dd>{ads.location}</dd></div>
              <div><dt>When</dt><dd>{ads.schedule}</dd></div>
            </dl>
            {ads.excluded.map((x) => <p key={x.service} className="err">{x.service}: {x.why}</p>)}
          </section>
          {ads.groups.map((g) => (
            <section key={g.name} className="panel panel-pad stack gap-12">
              <div className="row gap-8 wrap" style={{ justifyContent: 'space-between' }}><h2 className="heading">{g.name}</h2><span className="xsmall faint">Lands on {g.landing.replace(/^https?:\/\/[^/]+/, '')}</span></div>
              <div className="grid-3">
                <CopyBlock label="Keywords" text={g.keywords.join('\n')} />
                <CopyBlock label={`Headlines (${g.headlines.length}, 30 characters max)`} text={g.headlines.join('\n')} />
                <CopyBlock label="Descriptions (90 characters max)" text={g.descriptions.join('\n')} />
              </div>
            </section>
          ))}
          <div className="grid-3">
            <CopyBlock label="Negative keywords (stop wasted clicks)" text={ads.negatives.join('\n')} />
            <CopyBlock label="Sitelinks" text={ads.sitelinks.map((s) => `${s.text}\n${s.url}`).join('\n\n')} />
            <CopyBlock label="Callouts" text={ads.callouts.join('\n')} />
          </div>
          <section className="panel panel-pad stack gap-8"><h2 className="heading">Count what matters</h2><ul className="ticklist small">{ads.conversions.map((c) => <li key={c}>{c}</li>)}</ul></section>
        </div>
      )}
    </div>
  );
}

/* ---------- Launch plan ---------- */

function PlanTab({ draft, update, gainora }: { draft: Site; update: (s: Site) => void; gainora: boolean }) {
  const weeks = launchPlan(draft);
  const p = planProgress(draft);
  const tick = (id: string, v: boolean) => update({ ...draft, plan: { ...draft.plan, [id]: v } });
  const WHO = { gainora: 'Gainora', owner: 'You', both: 'Together' } as const;
  return (
    <div className="stack gap-16">
      <section className="panel panel-pad stack gap-8">
        <div className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}><h2 className="heading">The first six weeks</h2><span className="small muted">{p.done} of {p.total} done</span></div>
        {!gainora && <p className="small muted">What Gainora is doing to get your business found, and the few things we need from you.</p>}
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label="Launch progress"><span style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} /></div>
      </section>
      {weeks.map((w) => (
        <section key={w.title} className="panel" aria-label={w.title}>
          <div className="panel-head"><h3 className="heading">{w.title}</h3><span className="small faint">{w.tasks.filter((t) => draft.plan[t.id]).length}/{w.tasks.length}</span></div>
          <ul className="tasks">{w.tasks.map((t) => (
            <li key={t.id}>
              <label className="check-row"><input type="checkbox" checked={!!draft.plan[t.id]} disabled={!gainora && t.who === 'gainora'} onChange={(e: any) => tick(t.id, e.target.checked)} /><span><span className={draft.plan[t.id] ? 'done' : ''}>{t.text}</span>{t.detail && <span className="xsmall faint task-detail">{t.detail}</span>}</span></label>
              <span className={`tag ${t.who === 'owner' ? 'tag-brass' : t.who === 'both' ? 'tag-forest' : 'tag-plain'}`}>{WHO[t.who]}</span>
            </li>
          ))}</ul>
        </section>
      ))}
      <section className="panel" aria-label="Every month">
        <div className="panel-head"><h3 className="heading">Every month after launch</h3></div>
        <ul className="tasks">{MONTHLY.map((t) => <li key={t.id}><span>{t.text}</span><span className={`tag ${t.who === 'both' ? 'tag-forest' : 'tag-plain'}`}>{WHO[t.who]}</span></li>)}</ul>
      </section>
    </div>
  );
}

/* ---------- Address, domain, tracking ---------- */

function SettingsTab({ site, setSite, draft, update }: { site: WebsiteState; setSite: (s: WebsiteState) => void; draft: Site; update: (s: Site) => void }) {
  const [slug, setSlug] = useState(site.slug);
  const [domain, setDomain] = useState(site.domain ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const toast = useToast();
  const run = async (what: string, fn: () => Promise<WebsiteState>, ok: string) => {
    setBusy(what); setErr(null);
    try { setSite(await fn()); toast(ok); } catch (e) { setErr(humanThrown(e, 'That didn’t save. Try again.')); } finally { setBusy(null); }
  };
  const t = draft.tracking;
  return (
    <div className="stack gap-16">
      {err && <p className="err" role="alert">{err}</p>}
      <section className="panel panel-pad stack gap-12">
        <h2 className="heading">Gainora address</h2>
        <p className="small muted">The site works here straight away, before it has its own domain. Google doesn’t list this address.</p>
        <div className="row gap-12 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="app.gainora.co.uk/site/…">{(id) => <input id={id} className="input" value={slug} onChange={(e: any) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />}</Field>
          <Button kind="secondary" busy={busy === 'slug'} disabled={slug === site.slug} onClick={() => run('slug', () => api.setWebsiteSlug(slug), 'Address changed')}>Change address</Button>
        </div>
        <p className="small"><a href={site.previewUrl} target="_blank" rel="noreferrer">{site.previewUrl}</a></p>
      </section>
      <section className="panel panel-pad stack gap-12">
        <h2 className="heading">Your own domain</h2>
        <div className="row gap-12 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Domain">{(id) => <input id={id} className="input" placeholder="yourbusiness.co.uk" value={domain} onChange={(e: any) => setDomain(e.target.value)} />}</Field>
          <Button kind="secondary" busy={busy === 'domain'} disabled={(site.domain ?? '') === domain.trim()} onClick={() => run('domain', () => api.setWebsiteDomain(domain), domain.trim() ? 'Domain saved' : 'Domain removed')}>{domain.trim() ? 'Connect domain' : 'Remove domain'}</Button>
        </div>
        {site.domain && (
          <div className="stack gap-8">
            <p className="small">Two settings at the company where the domain is registered (GoDaddy, 123 Reg, IONOS…):</p>
            <div className="table-wrap"><table><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>
              <tr><td>A</td><td>@</td><td><code>75.2.60.5</code></td></tr>
              <tr><td>CNAME</td><td>www</td><td><code>gainoraagents.netlify.app</code></td></tr>
            </tbody></table></div>
            <p className="xsmall faint">Then Gainora switches it on at our end, usually the same day, and the padlock (https) is added automatically. Until then the Gainora address keeps working.</p>
          </div>
        )}
      </section>
      <section className="panel panel-pad stack gap-12">
        <h2 className="heading">Google tags (optional)</h2>
        <p className="small muted">Performance already counts visits, calls and enquiries without cookies. Add these only to see visits in Google Analytics or count ad conversions in Google Ads. The site then asks visitors for cookie consent first.</p>
        <div className="form-grid three">
          <Text label="Google Analytics ID" value={t.ga4} placeholder="G-XXXXXXX" onChange={(v) => update({ ...draft, tracking: { ...t, ga4: v.trim().toUpperCase() } })} optional />
          <Text label="Google Ads ID" value={t.adsId} placeholder="AW-123456789" onChange={(v) => update({ ...draft, tracking: { ...t, adsId: v.trim().toUpperCase() } })} optional />
          <Text label="Ads conversion label" value={t.adsLabel} onChange={(v) => update({ ...draft, tracking: { ...t, adsLabel: v.trim() } })} optional />
        </div>
        <p className="xsmall faint">Takes effect when you publish.</p>
      </section>
      <section className="panel panel-pad stack gap-12">
        <h2 className="heading">Notes</h2>
        <Text long label="Private notes about the website" value={draft.notes} onChange={(v) => update({ ...draft, notes: v })} help="Only you and Gainora see these." />
      </section>
      {site.live && (
        <section className="panel panel-pad stack gap-12">
          <h2 className="heading">Take the site offline</h2>
          <p className="small muted">Visitors see “Coming soon” until you publish again. Your draft and numbers are kept.</p>
          <div><Button kind="secondary" className="btn-danger" onClick={() => setOffline(true)}>Take offline</Button></div>
          {offline && <Modal title="Take the website offline?" onClose={() => setOffline(false)} footer={<><Button kind="secondary" onClick={() => setOffline(false)}>Keep it live</Button><Button className="btn-danger" kind="secondary" busy={busy === 'off'} onClick={() => { setOffline(false); run('off', () => api.unpublishWebsite(), 'The website is offline'); }}>Take offline</Button></>}><p>Anyone visiting sees “Coming soon” until you publish again.</p></Modal>}
        </section>
      )}
    </div>
  );
}
