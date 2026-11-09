import { useEffect, useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { Locked, useApp } from '../app';
import { Button, ErrorNote, Field, Icon, Loading, Modal, Sparkline, Stars, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { Feedback } from '../components/feedback';
import { hostOf, relative, shortDate } from '../lib/format';
import { Link, queryParam } from '../lib/router';
import { priceValue } from '../../shared/prices';
import { bookingPlatform, distanceLabel, reviewsSince, signalsFor, signalsForYou, sizeVerdict, type SizeSignals } from '../../shared/competitors';
import { locationSourceLabel, RADII_KM, townOf } from '../../shared/geo';
import type { PriceSource } from '../../shared/treatments';
import { socialLabel } from '../../shared/social';
import { safeReply } from '../../shared/drafts';
import { scoreLabel } from '../../shared/speed';
import type { Client, ClientsData, CompetitorChange, CompetitorsState, PlaceSummary, ReachEvent, ReviewItem, TrackedCompetitor, WatcherState } from '../lib/types';
import { emptyClientsData } from '../lib/types';
import { packWorthy, responsePack, type ResponsePack } from '../../shared/responses';
import { canMessage, dueGroups } from '../../shared/clients';
import { uuid } from '../lib/format';
import { makeCtx, SendModal, type Ctx as ClientsCtx, type DraftItem } from './clients';

const KIND: Record<CompetitorChange['kind'], { label: string; cls: string }> = {
  price: { label: 'Price change', cls: 'tag-brass' },
  offer: { label: 'New offer', cls: 'tag-forest' },
  content: { label: 'Page updated', cls: 'tag-plain' },
  'new-page': { label: 'New page', cls: 'tag-plain' },
};

type Tab = 'overview' | 'reviews' | 'speed' | 'competitors' | 'prices' | 'compare';
const TABS: Tab[] = ['overview', 'reviews', 'speed', 'competitors', 'prices', 'compare'];
const initialTab = (): Tab => { const t = queryParam('tab') as Tab | null; return t && TABS.includes(t) ? t : 'overview'; };

export function Watcher() {
  const { plan } = useApp();
  return plan.agents.includes('watcher') ? <WatcherPage /> : <Locked agent="watcher" />;
}

function WatcherPage() {
  const { profile } = useApp();
  const { data, setData, error, loading, reload } = useLoad(() => api.getWatcher());
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error || !data) return <div className="page"><ErrorNote message={error ?? 'The Watcher could not load.'} retry={reload} /></div>;

  const run = async () => {
    setRunning(true);
    try { setData(await api.runWatcher()); toast('Check complete'); }
    catch (e: any) { toast(humanThrown(e, 'The check didn’t finish. Try again in a minute.')); }
    finally { setRunning(false); }
  };

  const newReviews = data.reviews?.reviews.filter((r) => r.isNew).length ?? 0;
  const bigFixes = data.speed?.fixes.filter((f) => f.impact === 'High' && !f.done).length ?? 0;
  const recentChanges = data.changes.filter((c) => Date.now() - new Date(c.at).getTime() < 7 * 86_400_000).length
    + (data.competitors?.events ?? []).filter((e) => Date.now() - new Date(e.at).getTime() < 7 * 86_400_000).length;
  const watched = data.competitors?.list.length ?? profile.competitors.list.filter((c) => c.name).length;
  const cmp = data.competitors?.comparison;
  const gaps = cmp ? cmp.theyOfferYouDont.length : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">The Watcher</h1>
          <p className="lede">Keeps an eye on {(data.site || profile.business.website) ? `${hostOf(data.site || profile.business.website)}, ` : ''}your Google reviews and {watched} competitor{watched === 1 ? '' : 's'} around {townOf(profile.business.location) || 'you'}: their prices, reviews, team and Instagram, and what to do about what it finds.</p>
        </div>
        <div className="stack gap-4" style={{ alignItems: 'flex-end' }}>
          <Button kind="secondary" icon="refresh" busy={running} onClick={run}>{running ? (data.site ? 'Checking your site' : 'Checking') : 'Check now'}</Button>
          {data.lastCheck && <span className="xsmall faint">Last checked {relative(data.lastCheck)}</span>}
        </div>
      </div>

      <Tabs label="Watcher sections" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview', badge: data.issues.filter((i) => i.level === 'urgent').length || null },
        { id: 'reviews', label: 'Reviews', badge: newReviews ? `${newReviews} new` : null },
        { id: 'speed', label: 'Speed and Google', badge: bigFixes || null },
        { id: 'competitors', label: 'Competitors', badge: recentChanges || null },
        { id: 'prices', label: 'Prices', badge: gaps || null },
        { id: 'compare', label: 'You vs them' },
      ]} />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={tab}>
        {tab === 'overview' && <Overview data={data} />}
        {tab === 'reviews' && <Reviews data={data} setData={setData} />}
        {tab === 'speed' && <Speed data={data} setData={setData} />}
        {tab === 'competitors' && <Competitors data={data} setData={setData} />}
        {tab === 'prices' && <PricesView data={data} />}
        {tab === 'compare' && <CompareView data={data} />}
      </div>
    </div>
  );
}

function SocialPages({ data }: { data: WatcherState }) {
  const pages = [
    data.social?.instagram ? { name: 'Instagram', url: data.social.instagram, label: socialLabel('instagram', data.social.instagram) } : null,
    data.social?.facebook ? { name: 'Facebook', url: data.social.facebook, label: socialLabel('facebook', data.social.facebook) } : null,
  ].filter(Boolean) as { name: string; url: string; label: string }[];
  if (!pages.length) return null;
  return (
    <section className="section" aria-labelledby="social-h">
      <div className="section-head"><h2 className="heading" id="social-h">Your social pages</h2></div>
      <div className="panel rows">
        {pages.map((p) => (
          <div className="issue" key={p.name}>
            <span className="issue-mark notice"><Icon name="info" title={p.name} /></span>
            <div className="stack gap-4">
              <h3 className="subhead">{p.name}: {p.label}</h3>
              {p.name === 'Instagram' && data.competitors?.you?.instagram && !data.competitors.you.instagram.error ? (
                <p className="muted" style={{ maxWidth: '68ch' }}>{data.competitors.you.instagram.followers?.toLocaleString('en-GB') ?? '–'} followers{data.competitors.you.instagram.postsLast30 != null ? `, ${data.competitors.you.instagram.postsLast30} posts in the last 30 days` : ''}, read from your public profile {relative(data.competitors.you.instagram.checkedAt)}. {data.site ? 'The Watcher also checks that your website links here.' : ''}</p>
              ) : p.name === 'Instagram' && data.competitors?.you?.instagram?.error === 'not-business' ? (
                <p className="muted" style={{ maxWidth: '68ch' }}>This account is personal or private, so its public posts can’t be read. Switching it to a professional (business or creator) account in Instagram’s settings lets the Watcher follow your followers and posts.</p>
              ) : (
                <p className="muted" style={{ maxWidth: '68ch' }}>{data.site ? 'The Watcher checks that your website links here.' : 'Saved with your business details, so the Brief and Ask can refer to it.'} Public posts and follower counts are read when Instagram reading is switched on for your account.</p>
              )}
              <a className="small mt-8" href={p.url} target="_blank" rel="noreferrer">Open the page<span className="sr-only"> (opens in a new tab)</span></a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Overview({ data }: { data: WatcherState }) {
  const ms = data.history.filter((h) => h.up).map((h) => h.ms);
  const avg = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
  if (!data.site) return (
    <>
      <section className="panel empty" aria-label="Website">
        <h3 className="heading">No website added</h3>
        <p className="muted">That’s fine: the Watcher still tracks your Google reviews and your competitors every day. If you add a website later in Your business, it will check it every morning too.</p>
      </section>
      <SocialPages data={data} />
    </>
  );
  return (
    <>
      <section className="panel" aria-label="Website health">
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Website</span>
            <span className="stat-value" style={{ color: data.up ? 'var(--good)' : 'var(--danger)' }}>{data.up ? 'Online' : 'Down'}</span>
            <span className="stat-note">{data.uptime30d}% uptime, last 30 days</span>
          </div>
          <div className="stat">
            <span className="stat-label">Home page response</span>
            <span className="stat-value tabular">{data.responseMs ? `${(data.responseMs / 1000).toFixed(1)}s` : '–'}</span>
            <span className="stat-note">{avg ? `Average ${(avg / 1000).toFixed(1)}s` : 'Measuring'}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Broken links</span>
            <span className="stat-value tabular" style={{ color: data.brokenLinks.length ? 'var(--danger)' : undefined }}>{data.brokenLinks.length}</span>
            <span className="stat-note">Across {data.pagesChecked} pages</span>
          </div>
          <div className="stat">
            <span className="stat-label">Security certificate</span>
            <span className="stat-value tabular" style={{ color: data.sslDaysLeft != null && data.sslDaysLeft < 14 ? 'var(--danger)' : undefined }}>{data.sslDaysLeft != null ? `${data.sslDaysLeft} days` : '–'}</span>
            <span className="stat-note">Until it needs renewing</span>
          </div>
        </div>
        <div style={{ padding: '4px 24px 18px', borderTop: '1px solid var(--line)' }}>
          <div className="split xsmall faint" style={{ padding: '12px 0 6px' }}><span>Response time, last 30 days</span><span>Lower is better</span></div>
          <Sparkline values={data.history.map((h) => (h.up ? h.ms : null))} label={`Home page response time over 30 days, most recently ${data.responseMs} milliseconds`} />
        </div>
      </section>

      <section className="section" aria-labelledby="issues-h">
        <div className="section-head"><h2 className="heading" id="issues-h">Needs your attention</h2><span className="small faint">{data.issues.length} {data.issues.length === 1 ? 'item' : 'items'}</span></div>
        <div className="panel rows">
          {data.issues.length === 0 && <div className="empty"><h3 className="heading">All clear</h3><p className="muted">Your site passed every check. The Watcher will tell you the moment that changes.</p></div>}
          {data.issues.map((i) => (
            <div className="issue" key={i.id}>
              <span className={`issue-mark ${i.level}`}><Icon name={i.level === 'urgent' ? 'alert' : 'info'} title={i.level === 'urgent' ? 'Urgent' : 'Worth checking'} /></span>
              <div className="stack gap-4">
                <h3 className="subhead">{i.title}</h3>
                <p className="muted" style={{ maxWidth: '68ch' }}>{i.detail}</p>
                {i.link && <a className="small mt-8" href={i.link} target="_blank" rel="noreferrer">Open the page<span className="sr-only"> (opens in a new tab)</span></a>}
              </div>
            </div>
          ))}
          {data.brokenLinks.length > 0 && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Broken links</caption>
                <thead><tr><th>Broken link</th><th>Found on</th><th>Error</th></tr></thead>
                <tbody>
                  {data.brokenLinks.map((b) => (
                    <tr key={b.url}><td style={{ overflowWrap: 'anywhere' }}>{b.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</td><td style={{ overflowWrap: 'anywhere' }}>{b.foundOn.replace(/^https?:\/\/[^/]+/, '') || '/'}</td><td className="tabular">{b.status === 0 ? 'No response' : b.status === 404 ? 'Page not found' : b.status}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <SocialPages data={data} />
    </>
  );
}

/* ---------- Google reviews ---------- */
function Reviews({ data, setData }: { data: WatcherState; setData: (w: WatcherState) => void }) {
  const { profile } = useApp();
  const rv = data.reviews;
  const [changing, setChanging] = useState(!rv);
  const [q, setQ] = useState(`${profile.business.name} ${profile.business.location.split(',')[0]}`.trim());
  const [found, setFound] = useState<PlaceSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [reply, setReply] = useState<{ review: ReviewItem; text: string | null } | null>(null);
  const toast = useToast();

  const search = async (e: any) => {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setSearching(true);
    try { setFound(await api.findPlaces(q.trim())); }
    catch (err: any) { toast(humanThrown(err, 'Google search didn’t work. Try again.')); }
    finally { setSearching(false); }
  };
  const choose = async (id: string) => {
    setChoosing(id);
    try { setData(await api.selectPlace(id)); setChanging(false); toast('Google listing connected. Reviews update every morning.'); }
    catch (err: any) { toast(humanThrown(err, 'That didn’t save. Try again.')); }
    finally { setChoosing(null); }
  };
  const draft = async (r: ReviewItem) => {
    setReply({ review: r, text: null });
    try { setReply({ review: r, text: safeReply(await api.draftReviewReply(r.id)) }); }
    catch { setReply(null); toast('Couldn’t write the reply. Try again.'); }
  };
  // Opened from Home ("Open the drafted reply"): go straight to the draft for that review.
  useEffect(() => {
    const id = queryParam('review');
    const r = id && rv?.reviews.find((x) => x.id === id);
    if (r) draft(r);
  }, []);

  if (changing || !rv) {
    return (
      <section className="panel panel-pad" aria-labelledby="gl-h" style={{ maxWidth: 760 }}>
        <h2 className="heading" id="gl-h">Find your Google listing</h2>
        <p className="muted mt-8">The Watcher reads your public Google reviews and rating, tells you when new ones arrive and drafts replies for you to post. It never posts anything itself.</p>
        <form className="row gap-12 mt-24 wrap" onSubmit={search} style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 320px' }}>
            <Field label="Business name and town">{(id) => <input id={id} className="input" value={q} onChange={(e: any) => setQ(e.target.value)} />}</Field>
          </div>
          <Button type="submit" busy={searching} icon="search">Search Google</Button>
        </form>
        {found && (
          <div className="rows mt-24" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
            {found.length === 0 && <p className="empty muted">No listing found. Try adding your street or postcode.</p>}
            {found.map((pl) => (
              <div className="place-row" key={pl.id}>
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <span className="subhead">{pl.name}</span>
                  <span className="small muted">{pl.address}</span>
                  {pl.rating != null && <span className="row gap-8 small"><Stars value={pl.rating} />{pl.rating.toFixed(1)} from {pl.count} reviews</span>}
                </div>
                <Button kind="secondary" small busy={choosing === pl.id} onClick={() => choose(pl.id)}>This is my business</Button>
              </div>
            ))}
          </div>
        )}
        {rv && <Button kind="quiet" small className="mt-16" onClick={() => setChanging(false)}>Cancel</Button>}
      </section>
    );
  }

  const delta = rv.previousCount != null && rv.count != null ? rv.count - rv.previousCount : 0;
  const everyone = [{ name: `${profile.business.name} (you)`, rating: rv.rating, count: rv.count, you: true }, ...rv.competitors.map((c) => ({ ...c, you: false }))]
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  return (
    <>
      <div className="grid-2">
        <section className="panel panel-pad reviews-score" aria-label="Your Google rating">
          <div className="row gap-16 wrap" style={{ alignItems: 'flex-end' }}>
            <span className="rating-big">{rv.rating != null ? rv.rating.toFixed(1) : '–'}</span>
            <div className="stack gap-4">
              {rv.rating != null && <Stars value={rv.rating} />}
              <span className="small muted">{rv.count ?? 0} reviews on Google{delta > 0 ? `, ${delta} new since last week` : ''}</span>
            </div>
          </div>
          <div className="row gap-16 mt-24 wrap">
            <a className="btn btn-secondary btn-small" href={rv.mapsUrl} target="_blank" rel="noreferrer"><Icon name="external" />Open your Google listing</a>
            <button className="btn btn-quiet btn-small" onClick={() => { setFound(null); setChanging(true); }}>Change listing</button>
          </div>
        </section>
        <section className="panel" aria-labelledby="cmp-h">
          <div className="panel-head"><h2 className="subhead" id="cmp-h">How you compare</h2></div>
          <table>
            <caption className="sr-only">Google ratings compared with competitors</caption>
            <thead><tr><th>Business</th><th>Rating</th><th>Reviews</th></tr></thead>
            <tbody>
              {everyone.map((c) => (
                <tr key={c.name} className={c.you ? 'row-you' : ''}><td>{c.name}</td><td className="tabular">{c.rating != null ? c.rating.toFixed(1) : '–'}</td><td className="tabular">{c.count ?? '–'}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="section" aria-labelledby="rv-h">
        <div className="section-head"><h2 className="heading" id="rv-h">Recent reviews</h2><span className="small faint">Checked {relative(rv.checkedAt)}</span></div>
        <div className="panel rows">
          {rv.reviews.length === 0 && <div className="empty"><p className="muted">Google hasn’t shared any reviews for this listing yet.</p></div>}
          {rv.reviews.map((r) => (
            <article className="rv-item" key={r.id}>
              <div className="row gap-12 wrap">
                <span className="subhead">{r.author}</span>
                <Stars value={r.rating} />
                <span className="small faint">{r.when}</span>
                {r.isNew && <span className={`tag ${r.rating <= 2 ? 'tag-danger' : 'tag-forest'}`}>New</span>}
              </div>
              {r.text && <p className="voice review-text">{r.text}</p>}
              <div className="row gap-12 wrap">
                <Button kind={r.isNew ? 'primary' : 'secondary'} small icon="pencil" onClick={() => draft(r)}>Draft a reply</Button>
              </div>
            </article>
          ))}
        </div>
        <p className="xsmall faint mt-16">Google shares up to five of your most relevant reviews with the Watcher, so older ones may not appear here. Post replies from your Google Business Profile.</p>
      </section>

      {reply && (
        <Modal title={`Reply to ${reply.review.author}`} onClose={() => setReply(null)}
          footer={reply.text && <>
            <a className="btn btn-secondary" href={rv.mapsUrl} target="_blank" rel="noreferrer">Open my listing</a>
            <Button icon="copy" onClick={async () => toast((await copyText(reply.text!)) ? 'Copied. Paste it as your reply on Google.' : 'Select the text and copy it manually.')}>Copy reply</Button>
          </>}>
          {reply.text ? <pre>{reply.text}</pre> : <Loading label={`Writing a reply to ${reply.review.author.split(' ')[0]}`} />}
          {reply.text && <p className="xsmall faint" style={{ padding: '0 28px 20px' }}>Read it through and make it sound like you. Never offer discounts in exchange for changing a review; Google doesn’t allow it.</p>}
        </Modal>
      )}
    </>
  );
}

/* ---------- Speed and Google (PageSpeed) ---------- */
function Speed({ data, setData }: { data: WatcherState; setData: (w: WatcherState) => void }) {
  const sp = data.speed;
  const toast = useToast();
  if (!sp) {
    return <div className="panel empty"><h2 className="heading">Your first speed test is on its way</h2><p className="muted mt-8">The Watcher tests your home page with Google’s own speed test once a week, on a phone connection, and turns the results into a short list of fixes.</p></div>;
  }
  const toggle = async (title: string, done: boolean) => {
    setData({ ...data, speed: { ...sp, fixes: sp.fixes.map((f) => (f.title === title ? { ...f, done } : f)) } });
    try { await api.setFixDone(title, done); if (done) toast('Marked as done. Nice work.'); }
    catch { toast('That didn’t save. Try again.'); }
  };
  const scores: { key: keyof typeof sp.scores; label: string; hint: string }[] = [
    { key: 'performance', label: 'Speed on phones', hint: 'How fast your page shows up and becomes usable' },
    { key: 'seo', label: 'Google basics', hint: 'Whether Google can read and list your page properly' },
    { key: 'accessibility', label: 'Easy to use', hint: 'Readable text, labelled buttons, things people can tap' },
    { key: 'bestPractices', label: 'Trust and security', hint: 'Secure connection and no broken code' },
  ];
  const open = sp.fixes.filter((f) => !f.done);
  const done = sp.fixes.filter((f) => f.done);
  return (
    <>
      <section className="panel" aria-label="Google speed test scores">
        <div className="stats">
          {scores.map((s) => {
            const v = sp.scores[s.key]; const l = scoreLabel(v);
            return (
              <div className="stat" key={s.key}>
                <span className="stat-label">{s.label}</span>
                <span className="stat-value tabular">{v ?? '–'}<span className="stat-of">/100</span></span>
                <span className={`score-tag score-${l.tone}`}>{l.label}</span>
                <span className="stat-note">{s.hint}</span>
              </div>
            );
          })}
        </div>
        {sp.field && (
          <div className="field-data">
            <span className="small muted">What real visitors on phones experienced, from Google’s data:</span>
            <div className="row gap-24 wrap mt-8">
              {sp.field.lcp && <span className="small"><strong>Main content appears</strong> in {sp.field.lcp.value} <span className={`score-tag score-${sp.field.lcp.rating === 'Good' ? 'good' : sp.field.lcp.rating === 'Poor' ? 'bad' : 'mid'}`}>{sp.field.lcp.rating}</span></span>}
              {sp.field.inp && <span className="small"><strong>Responds to taps</strong> in {sp.field.inp.value} <span className={`score-tag score-${sp.field.inp.rating === 'Good' ? 'good' : sp.field.inp.rating === 'Poor' ? 'bad' : 'mid'}`}>{sp.field.inp.rating}</span></span>}
              {sp.field.cls && <span className="small"><strong>Page stability</strong> {sp.field.cls.value} <span className={`score-tag score-${sp.field.cls.rating === 'Good' ? 'good' : sp.field.cls.rating === 'Poor' ? 'bad' : 'mid'}`}>{sp.field.cls.rating}</span></span>}
            </div>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="fix-h">
        <div className="section-head"><h2 className="heading" id="fix-h">What to fix, most important first</h2><span className="small faint">Tested {relative(sp.checkedAt)} on a phone</span></div>
        <div className="panel rows">
          {open.length === 0 && <div className="empty"><h3 className="heading">Nothing important to fix</h3><p className="muted">Your page passed Google’s main checks. The Watcher tests it again every week.</p></div>}
          {open.map((f) => (
            <article className="fix" key={f.title}>
              <div className="row gap-8 wrap">
                <span className={`tag ${f.impact === 'High' ? 'tag-danger' : f.impact === 'Medium' ? 'tag-brass' : 'tag-plain'}`}>{f.impact} impact</span>
                <span className="tag tag-plain">{f.who === 'You' ? 'You can do this' : 'Ask your web person'}</span>
              </div>
              <h3 className="subhead mt-8">{f.title}</h3>
              <p className="muted fix-why">{f.why}</p>
              <p className="fix-how"><strong>How:</strong> {f.how}</p>
              {f.saving && <p className="small up">{f.saving.charAt(0).toUpperCase() + f.saving.slice(1)}.</p>}
              <div className="row gap-16 wrap mt-8">
                <Button kind="secondary" small icon="check" onClick={() => toggle(f.title, true)}>Mark as done</Button>
                <Feedback agent="watcher" kind="fix" id={f.id} text={f.title} />
              </div>
            </article>
          ))}
        </div>
        {done.length > 0 && (
          <details className="done-list mt-16">
            <summary>{done.length} done</summary>
            <ul>{done.map((f) => <li key={f.title}><span>{f.title}</span><button className="btn btn-quiet btn-small" onClick={() => toggle(f.title, false)}>Undo</button></li>)}</ul>
          </details>
        )}
        <p className="xsmall faint mt-16">Scores come from Google’s PageSpeed test of your home page on a simulated mid-range phone. They move a little between tests, so focus on the fixes rather than the exact number.</p>
      </section>
    </>
  );
}

/* ---------- Competitors: who is nearby, what they offer and charge, what changed ---------- */
const REACH_KIND: Record<ReachEvent['kind'], { label: string; cls: string }> = {
  reviews: { label: 'Review surge', cls: 'tag-brass' }, service: { label: 'New service', cls: 'tag-forest' }, price: { label: 'Price change', cls: 'tag-brass' },
  offer: { label: 'New offer', cls: 'tag-forest' }, post: { label: 'Instagram post', cls: 'tag-forest' }, 'new-nearby': { label: 'New nearby', cls: 'tag-danger' }, followers: { label: 'Followers', cls: 'tag-plain' },
};
const n = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('en-GB'));
const money = (v: number | null | undefined) => (v == null ? '–' : `£${Number.isInteger(v) ? v : v.toFixed(2)}`);

type TimelineItem = { id: string; at: string; competitor: string; label: string; cls: string; summary: string; detail?: string; url?: string; changeKind?: string; key?: string };

/** Where the Watcher searched from and how far, in plain words; or why it has not searched yet. */
function searchLine(comps: CompetitorsState | null | undefined, town: string): { text: string; tone: 'ok' | 'wait' | 'warn' } {
  if (!comps) return { text: `The Watcher looks for businesses like yours around ${town || 'your location'} on its first check. Press Check now to run it.`, tone: 'wait' };
  if (comps.foundFrom === 'none') return { text: 'The Watcher could not work out where you are, so it has not searched for businesses nearby yet. Add your postcode under Your business, or connect your Google listing on the Reviews tab, then press Check now.', tone: 'warn' };
  if (!comps.foundAt) return { text: `The first search of businesses around ${town || 'you'} runs with your next check. Press Check now to run it.`, tone: 'wait' };
  const radius = comps.foundRadiusKm ? `within ${comps.foundRadiusKm} km of ${locationSourceLabel(comps.foundFrom)}` : `around ${town || 'you'}`;
  return { text: `Searched Google ${radius}${comps.foundRadiusKm && comps.foundRadiusKm > RADII_KM[0] ? ` (widened because fewer than five comparable businesses were found closer)` : ''}, ${relative(comps.foundAt)}. It searches again every month and whenever you press Find more nearby.`, tone: 'ok' };
}

function Competitors({ data, setData }: { data: WatcherState; setData: (w: WatcherState) => void }) {
  const { profile } = useApp();
  const comps = data.competitors;
  const list = comps?.list ?? [];
  const [filter, setFilter] = useState('All');
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const toast = useToast();
  const you = { rating: data.reviews?.rating ?? null, count: data.reviews?.count ?? null, reviews30: reviewsSince(data.reviews?.history, 30) };
  // The owner's clients, for the response packs' "text to the clients who are due for this treatment".
  const [clientsData, setClientsData] = useState<ClientsData>(emptyClientsData(false));
  useEffect(() => { api.listClients().then(setClientsData).catch(() => {}); }, []);
  const cctx = makeCtx(clientsData, setClientsData, profile, data, toast);

  const timeline: TimelineItem[] = [
    ...(comps?.events ?? []).map((e) => ({ id: e.id, at: e.at, competitor: e.competitor, key: e.key, ...REACH_KIND[e.kind], summary: e.summary, detail: e.detail, url: e.url, changeKind: e.kind === 'price' ? 'price' : e.kind === 'offer' || e.kind === 'post' ? 'offer' : undefined })),
    ...data.changes.map((c) => ({ id: c.id, at: c.at, competitor: c.competitor, ...KIND[c.kind], summary: c.summary, detail: c.detail, url: c.url || undefined, changeKind: c.kind })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const names = ['All', ...new Set(timeline.map((c) => c.competitor))];
  const shown = (filter === 'All' ? timeline : timeline.filter((c) => c.competitor === filter)).filter((c) => !hidden.includes(c.id)).slice(0, 40);
  const town = townOf(profile.business.location);
  const typedN = list.filter((c) => c.source === 'typed').length; const foundN = list.length - typedN;
  const search = searchLine(comps, town);

  const act = async (op: 'dismiss' | 'watch' | 'restore' | 'instagram', key: string, handle?: string, done?: string) => {
    setBusy(key + op);
    try { setData(await api.updateCompetitor(op, key, handle)); if (done) toast(done); }
    catch (e: any) { toast(humanThrown(e, 'That didn’t save. Try again.')); }
    finally { setBusy(null); }
  };
  const find = async () => {
    setFinding(true);
    try { const r = await api.findCompetitors(); toast(r.started ? 'Searching Google for businesses near you. Check back in a few minutes.' : r.message || 'Searched recently.'); }
    catch (e: any) { toast(humanThrown(e, 'That didn’t work. Try again in a minute.')); }
    finally { setFinding(false); }
  };

  return (
    <>
      <section className="panel panel-pad reach-intro" aria-label="Who the Watcher follows">
        <div className="split" style={{ alignItems: 'flex-start' }}>
          <div className="stack gap-8" style={{ maxWidth: '68ch' }}>
            <h2 className="heading">{list.length ? `Watching ${list.length} competitor${list.length === 1 ? '' : 's'}` : 'Finding your competition'}</h2>
            {list.length > 0 && (
              <p className="muted">
                {`${typedN ? `${typedN} you named` : ''}${typedN && foundN ? ' and ' : ''}${foundN ? `${foundN} found on Google near ${town || 'you'}` : ''}. Every day the Watcher reads their websites and public booking pages, follows their Google reviews${list.some((c) => c.social && !c.social.error) ? ' and their public Instagram posts' : ''}, and tells you what changed.`}
                {comps?.checkedAt ? ` Checked ${relative(comps.checkedAt)}.` : ''}
              </p>
            )}
            <p className={`small ${search.tone === 'warn' ? 'reach-warn' : 'muted'}`}>{search.text}</p>
          </div>
          <Button kind="secondary" small icon="search" busy={finding} onClick={find}>Find more nearby</Button>
        </div>
      </section>

      {comps?.advice?.lines.length ? (
        <section className="section" aria-labelledby="advice-h">
          <div className="section-head"><h2 className="heading" id="advice-h">What this means for you</h2><span className="small faint">Updated {relative(comps.advice.at)}</span></div>
          <div className="panel rows">
            {comps.advice.lines.map((l, i) => (
              <article className="advice" key={i}>
                <p className="voice">{l.text}</p>
                <p className="advice-action"><span className="tag tag-forest">Do this</span><span>{l.action}</span></p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section" aria-labelledby="comp-h">
        <div className="section-head">
          <h2 className="heading" id="comp-h">What changed</h2>
          {names.length > 2 && (
            <label className="row gap-8 small">
              <span className="faint">Show</span>
              <select className="select" style={{ minHeight: 36, padding: '4px 34px 4px 10px', width: 'auto' }} value={filter} onChange={(e: any) => setFilter(e.target.value)}>
                {names.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="panel rows">
          {shown.length === 0 && <div className="empty"><p className="muted">No changes spotted yet. The Watcher compares each competitor’s pages, Google listing and public Instagram every day and lists anything new here.</p></div>}
          {shown.map((c) => (
            <article className="change" key={c.id}>
              <div className="change-when"><time dateTime={c.at}>{shortDate(c.at)}</time></div>
              <div className="stack gap-8">
                <div className="row gap-8 wrap"><span className={`tag ${c.cls}`}>{c.label}</span><span className="small faint">{c.competitor}</span></div>
                <p className="voice">{c.summary}</p>
                {c.detail && <p className="muted small" style={{ maxWidth: '68ch' }}>{c.detail}</p>}
                <div className="row gap-16 wrap">
                  {c.url && <a className="small" href={c.url} target="_blank" rel="noreferrer">{/instagram\.com/.test(c.url) ? 'See the post' : /google\.com\/maps/.test(c.url) ? 'See their listing' : 'See their page'}<span className="sr-only"> (opens in a new tab)</span></a>}
                  <Feedback agent="watcher" kind="change" id={c.id} text={c.summary} changeKind={c.changeKind} onNotRelevant={() => setTimeout(() => setHidden((h) => [...h, c.id]), 1200)} />
                </div>
                {packWorthy(c.changeKind ?? '') && <PackView ctx={cctx} event={{ id: c.id, kind: c.changeKind ?? 'offer', competitor: c.competitor, summary: c.summary, detail: c.detail, at: c.at }} comparison={comps?.comparison ?? null} />}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="who-h">
        <div className="section-head"><h2 className="heading" id="who-h">Who you’re up against</h2><span className="small faint">{you.count != null ? `You: ${you.rating?.toFixed(1) ?? '–'} stars, ${n(you.count)} reviews${you.reviews30 != null ? `, ${you.reviews30} new in 30 days` : ''}` : ''}</span></div>
        {list.length === 0 ? (
          <div className="panel empty"><h3 className="heading">Nobody yet</h3><p className="muted mt-8">{search.tone === 'warn' ? search.text : 'Name competitors under Your business, or press Check now and the Watcher searches Google for businesses like yours around you, including ones with no website.'}</p></div>
        ) : (
          <div className="comp-grid">
            {list.map((c) => <CompetitorCard key={c.key} c={c} you={you} busy={busy} act={act} />)}
          </div>
        )}
        <p className="xsmall faint mt-16">Everything here comes from a public page, a public booking page or a Google listing, with the link and the date it was seen. The Watcher never contacts a competitor, never logs in anywhere and never guesses a price. Review counts, team size and followers are signs of how big or busy a business looks, not a count of their bookings.</p>
      </section>

      {(comps?.nearby.length || comps?.dismissed.length) ? (
        <section className="section" aria-labelledby="near-h">
          <div className="section-head"><h2 className="heading" id="near-h">Others nearby</h2><span className="small faint">From Google, around {town || 'you'}</span></div>
          <div className="panel rows">
            {(comps?.nearby ?? []).map((p) => (
              <div className="place-row" key={p.key}>
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <span className="subhead">{p.name}</span>
                  <span className="small muted">{[distanceLabel(p.distanceKm), p.address, !p.url && !p.booking?.length ? (p.instagram ? 'Instagram only' : 'no website') : ''].filter(Boolean).join(' · ')}</span>
                  {p.rating != null && <span className="row gap-8 small"><Stars value={p.rating} />{p.rating.toFixed(1)} from {n(p.count)} reviews</span>}
                </div>
                <div className="row gap-8 wrap">
                  <Button kind="secondary" small busy={busy === p.key + 'watch'} onClick={() => act('watch', p.key, undefined, `Watching ${p.name}. Their pages are read with the next check.`)}>Watch</Button>
                  <Button kind="quiet" small busy={busy === p.key + 'dismiss'} onClick={() => act('dismiss', p.key, undefined, 'Noted: not a competitor.')}>Not a competitor</Button>
                </div>
              </div>
            ))}
            {comps?.nearby.length === 0 && <p className="empty muted small">Nothing else nearby that the Watcher hasn’t shown you.</p>}
          </div>
          {comps?.dismissed.length ? (
            <details className="done-list mt-16">
              <summary>{comps.dismissed.length} marked “not a competitor”</summary>
              <ul>{comps.dismissed.map((d) => <li key={d.key}><span>{d.name}</span><button className="btn btn-quiet btn-small" disabled={busy === d.key + 'restore'} onClick={() => act('restore', d.key, undefined, `${d.name} can be found again.`)}>Undo</button></li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

/** Where a business can be found online, as links: website, booking page, Instagram, Facebook, Google listing. */
function Presence({ c }: { c: TrackedCompetitor }) {
  const items: { label: string; url: string }[] = [];
  if (c.url) items.push({ label: hostOf(c.url), url: c.url });
  for (const b of c.bookingPages.slice(0, 2)) items.push({ label: bookingPlatform(b), url: b });
  if (c.instagram) items.push({ label: socialLabel('instagram', c.instagram), url: c.instagram });
  if (c.facebook) items.push({ label: 'Facebook', url: c.facebook });
  if (c.mapsUrl) items.push({ label: 'Google listing', url: c.mapsUrl });
  return (
    <div className="row gap-8 wrap small comp-presence">
      {!c.url && <span className="tag tag-plain">No website</span>}
      {items.map((i) => <a key={i.url} href={i.url} target="_blank" rel="noreferrer">{i.label}<span className="sr-only"> (opens in a new tab)</span></a>)}
    </div>
  );
}

function CompetitorCard({ c, you, busy, act }: { c: TrackedCompetitor; you: { rating: number | null; count: number | null; reviews30: number | null }; busy: string | null; act: (op: 'dismiss' | 'watch' | 'restore' | 'instagram', key: string, handle?: string, done?: string) => Promise<void> }) {
  const [more, setMore] = useState(false);
  const [editIg, setEditIg] = useState(false);
  const [handle, setHandle] = useState('');
  const theirs30 = reviewsSince(c.history, 30);
  const ig = c.social;
  const services = more ? c.services : c.services.slice(0, 5);
  const igFindings = ig && !ig.error ? ig.findings.slice(0, more ? 8 : 2) : [];
  const unreadable = (c.unreadable ?? []).map(bookingPlatform);
  return (
    <article className="panel comp-card" aria-label={c.name}>
      <div className="comp-head">
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h3 className="subhead">{c.name}</h3>
          <div className="row gap-8 wrap small muted">
            <span className={`tag ${c.source === 'found' ? 'tag-forest' : 'tag-plain'}`}>{c.source === 'found' ? 'Found nearby' : 'You named'}</span>
            {c.distanceKm != null ? <span className="comp-distance">{distanceLabel(c.distanceKm)}</span> : <span className="faint">distance not known</span>}
            {c.address && <span>{c.address}</span>}
          </div>
        </div>
        {c.source === 'found'
          ? <Button kind="quiet" small busy={busy === c.key + 'dismiss'} onClick={() => act('dismiss', c.key, undefined, `${c.name} removed. The Watcher won’t suggest them again.`)}>Not a competitor</Button>
          : <Link to="/business" className="btn btn-quiet btn-small">Edit</Link>}
      </div>
      <Presence c={c} />

      <div className="comp-facts">
        <div className="comp-fact">
          <span className="stat-label">Google reviews</span>
          <span className="comp-fact-value">{c.rating != null ? <><Stars value={c.rating} /> {c.rating.toFixed(1)}</> : <span className="faint">No listing matched</span>}</span>
          <span className="stat-note">{c.count != null ? `${n(c.count)} reviews` : ''}{theirs30 != null ? ` · ${theirs30} new in 30 days${you.reviews30 != null ? ` (you: ${you.reviews30})` : ''}` : ''}</span>
        </div>
        {c.venue ? (
          <div className="comp-fact">
            <span className="stat-label">{c.venue.platform} page</span>
            <span className="comp-fact-value">{c.venue.rating != null ? <>{c.venue.rating.toFixed(1)} <span className="small muted">from {n(c.venue.reviews)} reviews</span></> : <span className="small">{n(c.venue.reviews)} reviews</span>}</span>
            <span className="stat-note">{[c.venue.team != null ? `team of ${c.venue.team}` : '', c.venue.serviceCount != null ? `${c.venue.serviceCount} treatments` : '', c.venue.priceRange ?? ''].filter(Boolean).join(' · ')}</span>
          </div>
        ) : null}
        <div className="comp-fact">
          <span className="stat-label">Instagram</span>
          {ig && !ig.error ? (
            <><span className="comp-fact-value">{n(ig.followers)} <span className="small muted">followers</span></span><span className="stat-note">{ig.postsLast30 != null ? `${ig.postsLast30} post${ig.postsLast30 === 1 ? '' : 's'} in 30 days` : ''}{ig.followersHistory.length > 7 ? ` · ${trend(ig.followersHistory)}` : ''}</span></>
          ) : ig?.error === 'not-business' ? (
            <><span className="comp-fact-value small">{socialLabel('instagram', c.instagram || '')}</span><span className="stat-note">This account is personal or private, so its posts can’t be read.</span></>
          ) : c.instagram ? (
            <><span className="comp-fact-value small">{socialLabel('instagram', c.instagram)}</span><span className="stat-note">{ig?.error === 'unavailable' ? 'Instagram didn’t answer today; trying again tomorrow.' : 'Link only; public posts are read when Instagram reading is switched on.'}</span></>
          ) : (
            <><span className="comp-fact-value small faint">Not found on their pages</span><button type="button" className="link-btn xsmall" onClick={() => setEditIg(true)}>Add their handle</button></>
          )}
        </div>
      </div>
      {editIg && (
        <form className="row gap-8 wrap comp-ig-form" onSubmit={async (e: any) => { e.preventDefault(); await act('instagram', c.key, handle, handle ? 'Saved. Their posts are read with the next check.' : 'Instagram handle removed.'); setEditIg(false); }}>
          <input className="input" aria-label={`Instagram handle for ${c.name}`} placeholder="@theirbusiness" value={handle} onChange={(e: any) => setHandle(e.target.value)} style={{ flex: '1 1 160px', minHeight: 38 }} />
          <Button type="submit" small busy={busy === c.key + 'instagram'}>Save</Button>
          <Button kind="quiet" small onClick={() => setEditIg(false)}>Cancel</Button>
        </form>
      )}

      {c.offers.length > 0 || igFindings.length > 0 ? (
        <div className="comp-block">
          <span className="stat-label">Offers and announcements</span>
          <ul className="comp-list-plain">
            {c.offers.map((o) => <li key={o.url + o.text}><a href={o.url} target="_blank" rel="noreferrer">“{o.text}”</a><span className="xsmall faint"> · their website, seen {shortDate(o.seenAt)}</span></li>)}
            {igFindings.map((o) => <li key={o.url + o.text}><a href={o.url} target="_blank" rel="noreferrer">“{o.text}”</a><span className="xsmall faint"> · Instagram, posted {shortDate(o.seenAt)}</span></li>)}
          </ul>
        </div>
      ) : null}

      <div className="comp-block">
        <span className="stat-label">Treatments and prices{c.bookingPages.length ? ` (${[c.url ? 'website' : '', ...c.bookingPages.map(bookingPlatform)].filter(Boolean).join(', ')})` : ''}</span>
        {c.services.length === 0 ? (
          <p className="small faint">
            {unreadable.length ? `Their ${unreadable.join(' and ')} booking page only shows prices once a browser runs it, so the Watcher can’t read it.`
              : c.url || c.bookingPages.length ? (c.sourcesCheckedAt ? 'No prices published on the pages the Watcher could read.' : 'Pages not read yet; they are read with the next check.')
              : c.instagram ? 'No website or booking page known; prices are only read from public pages, not from Instagram posts.' : 'No website or booking page known, so no prices to read.'}
          </p>
        ) : (
          <table className="comp-services"><tbody>
            {services.map((s) => <tr key={s.url + s.name}><td>{s.name}{s.duration ? <span className="faint"> · {s.duration}</span> : null}</td><td className="tabular"><a href={s.url} target="_blank" rel="noreferrer" title={`${s.via === 'fresha' ? 'Fresha page' : s.via === 'schema' ? 'Page data' : 'Page text'}, seen ${shortDate(s.seenAt)}`}>{s.price}</a></td></tr>)}
          </tbody></table>
        )}
        {c.services.length > 0 && unreadable.length > 0 && <p className="xsmall faint">Their {unreadable.join(' and ')} page could not be read; prices above are from their other pages.</p>}
        {c.venue?.partial && <p className="xsmall faint">Their {c.venue.platform} page lists {c.venue.serviceCount} treatments; the public page shows a selection.</p>}
        {(c.services.length > 5 || (ig && !ig.error && ig.findings.length > 2)) && <button type="button" className="link-btn small" onClick={() => setMore(!more)}>{more ? 'Show less' : `Show all ${c.services.length} treatments`}</button>}
      </div>

      {ig && !ig.error && ig.posts.length > 0 && (
        <details className="comp-posts">
          <summary className="small">Recent Instagram posts ({ig.posts.length})</summary>
          <ul className="comp-list-plain mt-8">
            {ig.posts.slice(0, more ? 12 : 4).map((p) => (
              <li key={p.id}><a href={p.url} target="_blank" rel="noreferrer">{p.caption ? `${p.caption.replace(/\s+/g, ' ').slice(0, 90)}${p.caption.length > 90 ? '…' : ''}` : `${p.type === 'VIDEO' ? 'Video' : 'Post'} without a caption`}</a><span className="xsmall faint"> · {shortDate(p.at)}{p.likes != null ? `, ${n(p.likes)} likes` : ''}{p.comments != null ? `, ${n(p.comments)} comments` : ''}</span></li>
            ))}
          </ul>
        </details>
      )}

      <div className="row gap-16 wrap comp-links">
        {c.instagram && !editIg && <button type="button" className="link-btn small" onClick={() => { setHandle(socialLabel('instagram', c.instagram!)); setEditIg(true); }}>Change Instagram handle</button>}
        {c.sourcesCheckedAt && <span className="xsmall faint">Pages read {relative(c.sourcesCheckedAt)}</span>}
      </div>
    </article>
  );
}

function trend(h: { at: string; n: number }[]): string {
  const first = h[0].n; const last = h[h.length - 1].n;
  const diff = last - first;
  if (!first || Math.abs(diff) < 5) return 'steady';
  return `${diff > 0 ? '+' : ''}${diff.toLocaleString('en-GB')} in ${Math.max(1, Math.round((new Date(h[h.length - 1].at).getTime() - new Date(h[0].at).getTime()) / 86_400_000))} days`;
}

/* ---------- Prices: your prices against theirs, treatment by treatment ---------- */
function PricesView({ data }: { data: WatcherState }) {
  const { profile } = useApp();
  const comps = data.competitors;
  const cmp = comps?.comparison;
  const [group, setGroup] = useState('All');
  const yourLines = comps?.you?.services?.length ?? 0;
  const theirLines = (comps?.list ?? []).reduce((a, c) => a + c.services.length, 0);
  const unreadable = (comps?.list ?? []).filter((c) => c.unreadable?.length).map((c) => `${c.name} (${c.unreadable!.map(bookingPlatform).join(', ')})`);
  const ownUnreadable = comps?.you?.unreadable?.length ? bookingPlatform(comps.you.unreadable[0]) : '';
  const priceEvents = (comps?.events ?? []).filter((e) => e.kind === 'price').slice(0, 12);
  const legacy = data.prices && data.prices.rows.length > 0;

  // Honest states before there is a table.
  if (!cmp || (!cmp.rows.length && !cmp.theyOfferYouDont.length && !cmp.onlyYou.length)) {
    return (
      <>
        <section className="panel panel-pad" aria-label="Prices">
          <h2 className="heading">Your prices against the businesses nearby</h2>
          {!yourLines ? (
            <>
              <p className="muted mt-8" style={{ maxWidth: '68ch' }}>The Watcher has none of your prices yet. {profile.offer.bookingUrl || profile.business.website ? 'It reads your booking page and website on each check; if they publish no prices,' : 'Add your public booking page or'} paste your price list under Your business and every treatment is compared with the clinics nearby, like for like.</p>
              {ownUnreadable && <p className="booking-note is-warn mt-16"><Icon name="alert" /><span>Your {ownUnreadable} booking page only shows prices once a browser runs it, so the Watcher can’t read it. Paste your price list under Your business instead.</span></p>}
              <Link to="/business" className="btn btn-secondary btn-small mt-16">Add my price list</Link>
            </>
          ) : !theirLines ? (
            <p className="muted mt-8" style={{ maxWidth: '68ch' }}>{comps?.list.length ? `The Watcher has your ${yourLines} prices and is watching ${comps.list.length} competitor${comps.list.length === 1 ? '' : 's'}, but has not been able to read a price from any of them yet${unreadable.length ? ` (${unreadable.join('; ')} only show prices in a browser)` : ''}. It tries again on every check.` : 'Once the Watcher has found competitors nearby, their prices appear here next to yours.'}</p>
          ) : (
            <p className="muted mt-8" style={{ maxWidth: '68ch' }}>The Watcher has {yourLines} of your prices and {theirLines} from competitors, but none describe the same treatment at the same amount yet. Lines are matched by rule (1ml with 1ml, one area with one area), so nothing is compared loosely.</p>
          )}
        </section>
        {legacy && <LegacyPrices data={data} />}
      </>
    );
  }

  const groups = ['All', ...new Set(cmp.rows.map((r) => r.group))];
  const rows = group === 'All' ? cmp.rows : cmp.rows.filter((r) => r.group === group);
  const compared = cmp.rows.filter((r) => r.yours && r.listedBy).length;
  const above = cmp.rows.filter((r) => r.yours && r.localAvg != null && r.yours.value > r.localAvg).length;
  const below = cmp.rows.filter((r) => r.yours && r.localAvg != null && r.yours.value < r.localAvg).length;
  return (
    <>
      <section className="panel" aria-label="How your prices sit">
        <div className="stats">
          <div className="stat"><span className="stat-label">Treatments compared</span><span className="stat-value tabular">{compared}</span><span className="stat-note">{cmp.matched.yours} of your {cmp.matched.yoursTotal} prices matched a treatment someone nearby also lists</span></div>
          <div className="stat"><span className="stat-label">Above the local average</span><span className="stat-value tabular">{above}</span><span className="stat-note">of {compared}</span></div>
          <div className="stat"><span className="stat-label">Below the local average</span><span className="stat-value tabular">{below}</span><span className="stat-note">of {compared}</span></div>
          <div className="stat"><span className="stat-label">They list, you don’t</span><span className="stat-value tabular">{cmp.theyOfferYouDont.length}</span><span className="stat-note">treatments priced nearby but not on your list</span></div>
        </div>
      </section>

      <section className="section" aria-labelledby="pt-h">
        <div className="section-head">
          <h2 className="heading" id="pt-h">Treatment by treatment</h2>
          <div className="row gap-12 wrap">
            {groups.length > 2 && (
              <label className="row gap-8 small"><span className="faint">Show</span>
                <select className="select" style={{ minHeight: 36, padding: '4px 34px 4px 10px', width: 'auto' }} value={group} onChange={(e: any) => setGroup(e.target.value)}>{groups.map((g) => <option key={g}>{g}</option>)}</select>
              </label>
            )}
            <span className="small faint">Checked {relative(cmp.checkedAt)}</span>
          </div>
        </div>
        <div className="panel rows">
          {rows.map((r) => (
            <article className={`price-row ${!r.yours ? 'is-gap' : ''}`} key={r.id} aria-label={r.label}>
              <div className="price-row-head">
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <span className="price-item">{r.label}</span>
                  <span className="price-note">{r.group}{r.localAvg != null ? ` · local average ${money(Math.round(r.localAvg))}${r.localMin !== r.localMax ? ` (${money(r.localMin)} to ${money(r.localMax)})` : ''}, ${r.listedBy} nearby` : ' · nobody nearby lists a price'}</span>
                </div>
                <div className="price-row-you">
                  <span className="stat-label">You</span>
                  <span className="price-row-figure tabular">{r.yours ? <PriceCellLink p={r.yours} you /> : <span className="faint" title="You don’t list a price for this">—</span>}</span>
                </div>
                <div className="price-row-pos">
                  {r.position ? <span className={`price-pos ${/above|dearest/.test(r.position) ? 'is-above' : /below|cheapest/.test(r.position) ? 'is-below' : ''}`}>{r.position.charAt(0).toUpperCase() + r.position.slice(1)}</span> : <span className="price-pos">Not on your list</span>}
                </div>
              </div>
              <ul className="price-chips" aria-label={`${r.label}: competitors`}>
                {cmp.competitors.map((c, i) => {
                  const t = r.theirs[i];
                  return (
                    <li key={c.key} className={t ? '' : 'is-none'} title={t ? undefined : `${c.name} lists no price for this treatment on the pages the Watcher could read`}>
                      <span className="price-chip-name">{c.name}</span>
                      <span className="price-chip-value tabular">{t ? <PriceCellLink p={t} /> : '—'}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
        <p className="xsmall faint mt-16">Each price links to the page it was read from (hover for the date). “From” prices are minimums. Only the same treatment at the same amount is compared; consultations, deposits and top-ups never count. Averages are over the businesses nearby that list that treatment.</p>
      </section>

      <div className="grid-2 section">
        <section aria-labelledby="gap-h">
          <div className="section-head"><h2 className="heading" id="gap-h">They offer, you don’t</h2></div>
          <div className="panel rows">
            {cmp.theyOfferYouDont.length === 0 && <div className="empty"><p className="muted">Nothing priced nearby that your list doesn’t cover.</p></div>}
            {cmp.theyOfferYouDont.slice(0, 12).map((t) => (
              <div className="gap-row" key={t.id}>
                <div className="stack gap-4"><span className="subhead">{t.label}</span><span className="small muted">{t.by.map((b) => `${b.name} ${b.price}`).join(' · ')}</span></div>
                <span className="small tabular faint">{t.localAvg != null && t.by.length > 1 ? `avg ${money(t.localAvg)}` : ''}</span>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="only-h">
          <div className="section-head"><h2 className="heading" id="only-h">You offer, nobody nearby lists a price</h2></div>
          <div className="panel rows">
            {cmp.onlyYou.length === 0 && <div className="empty"><p className="muted">Every treatment you price is also priced by someone nearby.</p></div>}
            {cmp.onlyYou.slice(0, 12).map((t) => <div className="gap-row" key={t.id}><span className="subhead">{t.label}</span><span className="tabular">{t.price}</span></div>)}
          </div>
        </section>
      </div>

      <section className="section" aria-labelledby="moves-h">
        <div className="section-head"><h2 className="heading" id="moves-h">Price changes</h2></div>
        <div className="panel rows">
          {priceEvents.length === 0 && <div className="empty"><p className="muted">No competitor price has changed since the Watcher started reading them. Changes appear here with the date and a link to the page.</p></div>}
          {priceEvents.map((e) => (
            <article className="change" key={e.id}>
              <div className="change-when"><time dateTime={e.at}>{shortDate(e.at)}</time></div>
              <div className="stack gap-4"><p className="voice">{e.summary}</p>{e.url && <a className="small" href={e.url} target="_blank" rel="noreferrer">See their page</a>}</div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function PriceCellLink({ p, you }: { p: PriceSource; you?: boolean }) {
  const title = `${p.name}${p.via === 'owner' ? ', from your price list' : p.via === 'fresha' ? ', from their Fresha page' : ''}, read ${shortDate(p.seenAt)}`;
  const inner = <>{p.price}{p.from ? <span className="price-cmp">minimum</span> : null}</>;
  return p.url ? <a href={p.url} target="_blank" rel="noreferrer" title={title} className={you ? 'price-you-link' : undefined}>{inner}</a> : <span title={title}>{inner}</span>;
}

/** The older AI-paired table, shown only when there is no treatment-matched comparison yet (non-beauty businesses). */
function LegacyPrices({ data }: { data: WatcherState }) {
  const pt = data.prices!;
  return (
    <section className="section" aria-labelledby="price-h">
      <div className="section-head"><h2 className="heading" id="price-h">Your prices against theirs</h2><span className="small faint">Checked {relative(pt.checkedAt)}</span></div>
      <div className="panel table-wrap">
        <table className="price-table">
          <caption className="sr-only">Your prices compared with competitors</caption>
          <thead><tr><th>Product or service</th><th>You</th>{pt.competitors.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {pt.rows.map((r) => {
              const mine = r.yours ? priceValue(r.yours.price) : null;
              return (
                <tr key={r.item}>
                  <td><span className="price-item">{r.item}</span>{r.note && <span className="price-note">{r.note}</span>}</td>
                  <td className="tabular price-you">{r.yours ? <a href={r.yours.url} target="_blank" rel="noreferrer">{r.yours.price}</a> : '–'}</td>
                  {r.theirs.map((c, i) => {
                    const v = c ? priceValue(c.price) : null;
                    const cmp = mine != null && v != null ? (v < mine ? 'cheaper than you' : v > mine ? 'dearer than you' : 'same as you') : '';
                    return <td key={i} className="tabular">{c ? <><a href={c.url} target="_blank" rel="noreferrer">{c.price}</a>{cmp && <span className={`price-cmp ${v! < mine! ? 'is-lower' : ''}`}>{cmp}</span>}</> : <span className="faint">–</span>}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- You vs them: the same public figures for you and each competitor ---------- */
function CompareView({ data }: { data: WatcherState }) {
  const { profile } = useApp();
  const comps = data.competitors;
  const list = comps?.list ?? [];
  const you = signalsForYou({ rating: data.reviews?.rating ?? null, count: data.reviews?.count ?? null, history: data.reviews?.history, you: comps?.you, website: profile.business.website, instagram: profile.business.instagram });
  const them = list.map((c) => ({ c, s: signalsFor(c) }));
  const cols = [{ name: `${profile.business.name} (you)`, s: you, you: true, c: null as TrackedCompetitor | null }, ...them.map((t) => ({ name: t.c.name, s: t.s, you: false, c: t.c as TrackedCompetitor | null }))];
  const dash = (why: string) => <span className="faint" title={why}>— <span className="cmp-why">{why}</span></span>;
  const igCell = (s: SizeSignals, isYou: boolean) => s.igFollowers != null ? n(s.igFollowers) : s.igState === 'private' ? dash('personal or private account') : s.igState === 'none' ? dash(isYou ? 'no handle given' : 'no handle found') : dash('not read yet');
  const metrics: { label: string; cell: (s: SizeSignals, isYou: boolean) => any }[] = [
    { label: 'Distance', cell: (s, isYou) => isYou ? <span className="faint">here</span> : s.distanceKm != null ? distanceLabel(s.distanceKm).replace(' away', '') : dash('not known') },
    { label: 'Google rating', cell: (s, isYou) => s.googleRating != null ? <span className="row gap-6"><Stars value={s.googleRating} /> {s.googleRating.toFixed(1)}</span> : dash(isYou ? 'connect your listing on the Reviews tab' : 'no listing matched') },
    { label: 'Google reviews', cell: (s, isYou) => s.googleReviews != null ? n(s.googleReviews) : dash(isYou ? 'listing not connected' : 'no listing matched') },
    { label: 'New Google reviews, 30 days', cell: (s) => s.reviews30 != null ? n(s.reviews30) : dash('needs a few weeks of watching') },
    { label: 'Booking-page rating', cell: (s, isYou) => s.venueRating != null ? `${s.venueRating.toFixed(1)} (${s.venuePlatform})` : s.venueReviews != null ? dash(`${s.venuePlatform} shows no rating`) : dash(isYou ? 'add your booking page under Your business' : 'no booking page found') },
    { label: 'Booking-page reviews', cell: (s, isYou) => s.venueReviews != null ? `${n(s.venueReviews)} (${s.venuePlatform})` : dash(isYou ? 'no booking page given' : 'no booking page found') },
    { label: 'Team size', cell: (s, isYou) => s.team != null ? `${s.team} on ${s.venuePlatform}` : dash(isYou ? (profile.business.teamSize ? `${profile.business.teamSize} (your answer; no public figure)` : 'no public figure') : 'no public figure') },
    { label: 'Treatments listed', cell: (s) => s.treatments != null ? n(s.treatments) : dash('no prices read') },
    { label: 'Starting price', cell: (s) => s.startingPrice != null ? money(s.startingPrice) : dash('no prices read') },
    { label: 'Instagram followers', cell: igCell },
    { label: 'Instagram posts, 30 days', cell: (s) => s.igPosts30 != null ? n(s.igPosts30) : dash(s.igState === 'ok' ? 'not read yet' : 'not readable') },
    { label: 'Website', cell: (s) => s.website ? 'Yes' : <span className="muted">No</span> },
  ];
  if (!list.length) {
    return <section className="panel empty" aria-label="You vs them"><h2 className="heading">Nobody to compare with yet</h2><p className="muted mt-8">{searchLine(comps, townOf(profile.business.location)).text}</p></section>;
  }
  return (
    <>
      <section className="panel table-wrap" aria-label="You against each competitor">
        <table className="cmp-table vs-table">
          <caption className="sr-only">Public figures for you and each competitor</caption>
          <thead><tr><th>Figure</th>{cols.map((c) => <th key={c.name} className={c.you ? 'col-you' : ''}>{c.name}</th>)}</tr></thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.label}><td>{m.label}</td>{cols.map((c) => <td key={c.name} className={`tabular ${c.you ? 'col-you' : ''}`}>{m.cell(c.s, c.you)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="section" aria-labelledby="verdict-h">
        <div className="section-head"><h2 className="heading" id="verdict-h">How each one looks next to you</h2><span className="small faint">From the public figures above, nothing else</span></div>
        <div className="panel rows">
          {them.map(({ c, s }) => {
            const v = sizeVerdict(you, s);
            return (
              <div className="verdict" key={c.key}>
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <span className="subhead">{c.name} <span className="small muted">{c.distanceKm != null ? `· ${distanceLabel(c.distanceKm)}` : ''}</span></span>
                  <p className="voice" style={{ fontSize: '1.0625rem' }}>{v.text}</p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="xsmall faint mt-16">“Looks bigger” means more public reviews, a bigger team shown on their booking page, more followers or more treatments listed. None of these is a count of their bookings or revenue, which no public page shows. Where a figure is missing, the reason is shown in its place.</p>
      </section>
    </>
  );
}

/* ---------- Response packs: answer a competitor's move with your own facts ---------- */
function PackView({ ctx, event, comparison }: { ctx: ClientsCtx; event: { id: string; kind: string; competitor: string; summary: string; detail?: string; at: string }; comparison: CompetitorsState['comparison'] }) {
  const toast = useToast();
  const [sending, setSending] = useState<DraftItem[] | null>(null);
  const due = ctx.data.ready ? dueGroups(ctx.data.clients, ctx.data.visits, ctx.settings).flatMap((g) => g.items) : [];
  const canText = (c: Client) => canMessage(c, 'competitor_response', { visits: ctx.data.visits.filter((v) => v.clientId === c.id).length, sent: ctx.data.actions, settings: ctx.settings }).ok;
  const pack: ResponsePack = responsePack(event, { profile: ctx.profile, comparison, due, canText });
  const copy = async (text: string, channel: 'instagram' | 'website', what: string) => {
    if (!(await copyText(text))) { toast('Select the text and copy it.'); return; }
    toast(`Copied. ${what}`);
    if (ctx.data.ready) api.recordAction({ id: uuid(), clientId: null, kind: 'competitor_response', channel, text, sentAt: new Date().toISOString(), treatmentId: pack.treatmentId, ref: event.id }).then((a) => ctx.setData({ ...ctx.data, actions: [a, ...ctx.data.actions] })).catch(() => {});
  };
  const textItems = (): DraftItem[] => (pack.text ? pack.text.audience.map(({ client, due: d }) => ({ client, kind: 'competitor_response' as const, text: pack.text!.draft.replace(/^Hi [^,]+,/, `Hi ${client.name.split(' ')[0]},`), treatmentId: pack.treatmentId, amountHint: d.lastPrice, ref: event.id })) : []);
  return (
    <details className="pack">
      <summary><Icon name="bolt" />Answer this{pack.label ? `: ${pack.label.toLowerCase()}` : ''}{pack.text ? `, including a text to ${pack.text.audience.length} client${pack.text.audience.length === 1 ? '' : 's'} who ${pack.text.audience.length === 1 ? 'is' : 'are'} due` : ''}</summary>
      <div className="pack-body">
        <p className="xsmall faint" style={{ margin: 0 }}>{pack.rule}</p>
        <div className="pack-item"><span className="field-label">Instagram caption</span><pre>{pack.caption}</pre><div><Button kind="secondary" small icon="copy" onClick={() => copy(pack.caption, 'instagram', 'Paste it into Instagram when you post.')}>Copy caption</Button></div></div>
        <div className="pack-item"><span className="field-label">One line for your website or booking page</span><pre>{pack.whyUs}</pre><div><Button kind="secondary" small icon="copy" onClick={() => copy(pack.whyUs, 'website', 'Add it where your prices are shown.')}>Copy line</Button></div></div>
        {pack.text ? (
          <div className="pack-item"><span className="field-label">Text to the {pack.text.audience.length} client{pack.text.audience.length === 1 ? '' : 's'} due for this ({pack.text.audience.map((a) => a.client.name.split(' ')[0]).slice(0, 4).join(', ')}{pack.text.audience.length > 4 ? '…' : ''})</span><pre>{pack.text.draft}</pre><div><Button small icon="send" onClick={() => setSending(textItems())}>Approve and send, one at a time</Button></div></div>
        ) : pack.treatmentId && ctx.data.ready ? <p className="xsmall faint" style={{ margin: 0 }}>None of your clients who are due had this treatment, so there is no text to send.</p> : null}
        <ul className="pack-facts">{pack.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </div>
      {sending && <SendModal ctx={ctx} items={sending} onClose={() => setSending(null)} />}
    </details>
  );
}
