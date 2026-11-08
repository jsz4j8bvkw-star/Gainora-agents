import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Locked, useApp } from '../app';
import { Button, ErrorNote, Field, Icon, Loading, Modal, Sparkline, Stars, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { Feedback } from '../components/feedback';
import { hostOf, relative, shortDate } from '../lib/format';
import { queryParam } from '../lib/router';
import { priceValue } from '../../shared/prices';
import { bookingPlatform, distanceLabel, reviewsSince } from '../../shared/competitors';
import { socialLabel } from '../../shared/social';
import { scoreLabel } from '../../shared/speed';
import type { CompetitorChange, PlaceSummary, ReachEvent, ReviewItem, TrackedCompetitor, WatcherState } from '../lib/types';

const KIND: Record<CompetitorChange['kind'], { label: string; cls: string }> = {
  price: { label: 'Price change', cls: 'tag-brass' },
  offer: { label: 'New offer', cls: 'tag-forest' },
  content: { label: 'Page updated', cls: 'tag-plain' },
  'new-page': { label: 'New page', cls: 'tag-plain' },
};

type Tab = 'overview' | 'reviews' | 'speed' | 'competitors';
const TABS: Tab[] = ['overview', 'reviews', 'speed', 'competitors'];
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
    catch (e: any) { toast(e?.message || 'The check didn’t finish. Try again in a minute.'); }
    finally { setRunning(false); }
  };

  const newReviews = data.reviews?.reviews.filter((r) => r.isNew).length ?? 0;
  const bigFixes = data.speed?.fixes.filter((f) => f.impact === 'High' && !f.done).length ?? 0;
  const recentChanges = data.changes.filter((c) => Date.now() - new Date(c.at).getTime() < 7 * 86_400_000).length
    + (data.competitors?.events ?? []).filter((e) => Date.now() - new Date(e.at).getTime() < 7 * 86_400_000).length;
  const watched = data.competitors?.list.length ?? profile.competitors.list.filter((c) => c.name).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">The Watcher</h1>
          <p className="lede">Keeps an eye on {(data.site || profile.business.website) ? `${hostOf(data.site || profile.business.website)}, ` : ''}your Google reviews and {watched} competitor{watched === 1 ? '' : 's'}, and tells you what to do about what it finds.</p>
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
      ]} />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={tab}>
        {tab === 'overview' && <Overview data={data} />}
        {tab === 'reviews' && <Reviews data={data} setData={setData} />}
        {tab === 'speed' && <Speed data={data} setData={setData} />}
        {tab === 'competitors' && <Competitors data={data} setData={setData} />}
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
    catch (err: any) { toast(err?.message || 'Google search didn’t work. Try again.'); }
    finally { setSearching(false); }
  };
  const choose = async (id: string) => {
    setChoosing(id);
    try { setData(await api.selectPlace(id)); setChanging(false); toast('Google listing connected. Reviews update every morning.'); }
    catch (err: any) { toast(err?.message || 'That didn’t save. Try again.'); }
    finally { setChoosing(null); }
  };
  const draft = async (r: ReviewItem) => {
    setReply({ review: r, text: null });
    try { setReply({ review: r, text: await api.draftReviewReply(r.id) }); }
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

type TimelineItem = { id: string; at: string; competitor: string; label: string; cls: string; summary: string; detail?: string; url?: string; changeKind?: string; key?: string };

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

  const timeline: TimelineItem[] = [
    ...(comps?.events ?? []).map((e) => ({ id: e.id, at: e.at, competitor: e.competitor, key: e.key, ...REACH_KIND[e.kind], summary: e.summary, detail: e.detail, url: e.url, changeKind: e.kind === 'price' ? 'price' : e.kind === 'offer' || e.kind === 'post' ? 'offer' : undefined })),
    ...data.changes.map((c) => ({ id: c.id, at: c.at, competitor: c.competitor, ...KIND[c.kind], summary: c.summary, detail: c.detail, url: c.url || undefined, changeKind: c.kind })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const names = ['All', ...new Set(timeline.map((c) => c.competitor))];
  const shown = (filter === 'All' ? timeline : timeline.filter((c) => c.competitor === filter)).filter((c) => !hidden.includes(c.id)).slice(0, 40);
  const pt = data.prices;
  const town = profile.business.location.split(',')[0].trim();
  const typedN = list.filter((c) => c.source === 'typed').length; const foundN = list.length - typedN;

  const act = async (op: 'dismiss' | 'watch' | 'restore' | 'instagram', key: string, handle?: string, done?: string) => {
    setBusy(key + op);
    try { setData(await api.updateCompetitor(op, key, handle)); if (done) toast(done); }
    catch (e: any) { toast(e?.message || 'That didn’t save. Try again.'); }
    finally { setBusy(null); }
  };
  const find = async () => {
    setFinding(true);
    try { const r = await api.findCompetitors(); toast(r.started ? 'Searching Google for businesses near you. Check back in a few minutes.' : r.message || 'Searched recently.'); }
    catch (e: any) { toast(e?.message || 'That didn’t work. Try again in a minute.'); }
    finally { setFinding(false); }
  };

  return (
    <>
      <section className="panel panel-pad reach-intro" aria-label="Who the Watcher follows">
        <div className="split" style={{ alignItems: 'flex-start' }}>
          <div className="stack gap-4" style={{ maxWidth: '68ch' }}>
            <h2 className="heading">{list.length ? `Watching ${list.length} competitor${list.length === 1 ? '' : 's'}` : 'Finding your competition'}</h2>
            <p className="muted">
              {list.length
                ? `${typedN ? `${typedN} you named` : ''}${typedN && foundN ? ' and ' : ''}${foundN ? `${foundN} found on Google near ${town || 'you'}` : ''}. Every day the Watcher reads their websites and public booking pages, follows their Google reviews${comps?.list.some((c) => c.social && !c.social.error) ? ' and their public Instagram posts' : ''}, and tells you what changed.`
                : `The Watcher looks for businesses like yours around ${town || 'your location'} on Google and follows the closest ones, alongside any you name under Your business. The first search runs with your next check.`}
              {comps?.checkedAt ? ` Checked ${relative(comps.checkedAt)}.` : ''}
            </p>
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
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="price-h">
        <div className="section-head"><h2 className="heading" id="price-h">Your prices against theirs</h2>{pt && <span className="small faint">Checked {relative(pt.checkedAt)}</span>}</div>
        {!pt || pt.rows.length === 0 ? (
          <div className="panel empty"><p className="muted">The Watcher compares your prices with your competitors’ once a week. It only shows prices it found on their websites or public booking pages, with a link to each one.</p></div>
        ) : (
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
        )}
      </section>

      <section className="section" aria-labelledby="who-h">
        <div className="section-head"><h2 className="heading" id="who-h">Who you’re up against</h2><span className="small faint">{you.count != null ? `You: ${you.rating?.toFixed(1) ?? '–'} stars, ${n(you.count)} reviews${you.reviews30 != null ? `, ${you.reviews30} new in 30 days` : ''}` : ''}</span></div>
        {list.length === 0 ? (
          <div className="panel empty"><p className="muted">Nobody yet. Name competitors under Your business, or wait for the Watcher’s first search of businesses near you.</p></div>
        ) : (
          <div className="comp-grid">
            {list.map((c) => <CompetitorCard key={c.key} c={c} you={you} busy={busy} act={act} />)}
          </div>
        )}
        <p className="xsmall faint mt-16">Everything here comes from a public page or a Google listing, with the link and the date it was seen. The Watcher never contacts a competitor, never logs in anywhere and never guesses a price. New Google reviews are a sign of how busy a business looks, not a count of their bookings.</p>
      </section>

      {(comps?.nearby.length || comps?.dismissed.length) ? (
        <section className="section" aria-labelledby="near-h">
          <div className="section-head"><h2 className="heading" id="near-h">Others nearby</h2><span className="small faint">From Google, around {town || 'you'}</span></div>
          <div className="panel rows">
            {(comps?.nearby ?? []).map((p) => (
              <div className="place-row" key={p.key}>
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <span className="subhead">{p.name}</span>
                  <span className="small muted">{[p.address, distanceLabel(p.distanceKm)].filter(Boolean).join(' · ')}</span>
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

function CompetitorCard({ c, you, busy, act }: { c: TrackedCompetitor; you: { rating: number | null; count: number | null; reviews30: number | null }; busy: string | null; act: (op: 'dismiss' | 'watch' | 'restore' | 'instagram', key: string, handle?: string, done?: string) => Promise<void> }) {
  const [more, setMore] = useState(false);
  const [editIg, setEditIg] = useState(false);
  const [handle, setHandle] = useState('');
  const theirs30 = reviewsSince(c.history, 30);
  const ig = c.social;
  const services = more ? c.services : c.services.slice(0, 5);
  const igFindings = ig && !ig.error ? ig.findings.slice(0, more ? 8 : 2) : [];
  return (
    <article className="panel comp-card" aria-label={c.name}>
      <div className="comp-head">
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h3 className="subhead">{c.name}</h3>
          <div className="row gap-8 wrap small muted">
            <span className={`tag ${c.source === 'found' ? 'tag-forest' : 'tag-plain'}`}>{c.source === 'found' ? 'Found nearby' : 'You named'}</span>
            {(c.distanceKm != null || c.address) && <span>{[distanceLabel(c.distanceKm), c.address].filter(Boolean).join(' · ')}</span>}
          </div>
        </div>
        {c.source === 'found'
          ? <Button kind="quiet" small busy={busy === c.key + 'dismiss'} onClick={() => act('dismiss', c.key, undefined, `${c.name} removed. The Watcher won’t suggest them again.`)}>Not a competitor</Button>
          : <a className="btn btn-quiet btn-small" href="/business">Edit</a>}
      </div>

      <div className="comp-facts">
        <div className="comp-fact">
          <span className="stat-label">Google reviews</span>
          <span className="comp-fact-value">{c.rating != null ? <><Stars value={c.rating} /> {c.rating.toFixed(1)}</> : <span className="faint">No listing matched</span>}</span>
          <span className="stat-note">{c.count != null ? `${n(c.count)} reviews` : ''}{theirs30 != null ? ` · ${theirs30} new in 30 days${you.reviews30 != null ? ` (you: ${you.reviews30})` : ''}` : ''}</span>
        </div>
        <div className="comp-fact">
          <span className="stat-label">Instagram</span>
          {ig && !ig.error ? (
            <><span className="comp-fact-value">{n(ig.followers)} <span className="small muted">followers</span></span><span className="stat-note">{ig.postsLast30 != null ? `${ig.postsLast30} post${ig.postsLast30 === 1 ? '' : 's'} in 30 days` : ''}{ig.followersHistory.length > 7 ? ` · ${trend(ig.followersHistory)}` : ''}</span></>
          ) : ig?.error === 'not-business' ? (
            <><span className="comp-fact-value small">{socialLabel('instagram', c.instagram || '')}</span><span className="stat-note">This account is personal or private, so its posts can’t be read.</span></>
          ) : c.instagram ? (
            <><span className="comp-fact-value small">{socialLabel('instagram', c.instagram)}</span><span className="stat-note">{ig?.error === 'unavailable' ? 'Instagram didn’t answer today; trying again tomorrow.' : 'Link only; public posts are read when Instagram reading is switched on.'}</span></>
          ) : (
            <><span className="comp-fact-value small faint">Not found on their website</span><button type="button" className="link-btn xsmall" onClick={() => setEditIg(true)}>Add their handle</button></>
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
        <span className="stat-label">Services and prices{c.bookingPages.length ? ` (website and ${c.bookingPages.map(bookingPlatform).join(', ')})` : ''}</span>
        {c.services.length === 0 ? (
          <p className="small faint">{c.url ? (c.sourcesCheckedAt ? 'No prices published on the pages the Watcher could read.' : 'Pages not read yet; they are read with the next check.') : 'No website known, so no prices to read.'}</p>
        ) : (
          <table className="comp-services"><tbody>
            {services.map((s) => <tr key={s.url + s.name}><td>{s.name}</td><td className="tabular"><a href={s.url} target="_blank" rel="noreferrer">{s.price}</a></td></tr>)}
          </tbody></table>
        )}
        {(c.services.length > 5 || (ig && !ig.error && ig.findings.length > 2)) && <button type="button" className="link-btn small" onClick={() => setMore(!more)}>{more ? 'Show less' : `Show all ${c.services.length} services`}</button>}
      </div>

      <div className="row gap-16 wrap comp-links">
        {c.url && <a className="small" href={c.url} target="_blank" rel="noreferrer">Website<span className="sr-only"> (opens in a new tab)</span></a>}
        {c.mapsUrl && <a className="small" href={c.mapsUrl} target="_blank" rel="noreferrer">Google listing</a>}
        {c.instagram && <a className="small" href={c.instagram} target="_blank" rel="noreferrer">Instagram</a>}
        {c.facebook && <a className="small" href={c.facebook} target="_blank" rel="noreferrer">Facebook</a>}
        {c.instagram && !editIg && <button type="button" className="link-btn small" onClick={() => { setHandle(socialLabel('instagram', c.instagram!)); setEditIg(true); }}>Change handle</button>}
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
