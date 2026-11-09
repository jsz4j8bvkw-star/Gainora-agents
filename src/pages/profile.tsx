import { useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Icon, Stars, useLoad, useToast } from '../components/ui';
import { learnFrom } from '../../shared/learning';
import { hostOf, relative } from '../lib/format';
import { FieldInput, displayAnswer } from './onboarding';
import { SECTIONS, getPath, setPath, validateSection, type Section } from '../lib/questions';
import { reviewsSince } from '../../shared/competitors';
import { parsePriceList, platformOf } from '../../shared/booking';
import { socialLabel, socialUrl } from '../../shared/social';
import { Link } from '../lib/router';
import type { BusinessProfile, WatcherState } from '../lib/types';

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

  const answered = section.fields.filter((f) => { const v = getPath(profile, f.path); return Array.isArray(v) ? v.some((x: any) => (typeof x === 'string' ? x : x?.name)) : String(v ?? '').trim(); }).length;

  return (
    <section className="panel review-block biz-section" aria-labelledby={`pf-${section.id}`}>
      <div className="split">
        <div className="stack gap-4">
          <h2 className="heading" id={`pf-${section.id}`}>{section.title}</h2>
          {!editing && <span className="xsmall faint">{answered} of {section.fields.length} answered</span>}
        </div>
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
        <dl>{section.fields.map((f) => <div key={f.path} style={{ display: 'contents' }}><dt>{f.label}</dt><dd className={!String(getPath(profile, f.path) ?? '').trim() && !(Array.isArray(getPath(profile, f.path)) && getPath(profile, f.path).length) ? 'faint' : ''}>{f.kind === 'pricelist' || f.kind === 'booking' ? displayAnswer(getPath(profile, f.path), f) : show(getPath(profile, f.path))}</dd></div>)}</dl>
      )}
    </section>
  );
}

/** One figure about the business, with where it came from, or a plain reason why it is not known yet. */
function Figure({ label, value, note, link, missing }: { label: string; value?: any; note?: string; link?: string; missing?: string }) {
  return (
    <div className="biz-figure">
      <span className="biz-figure-label">{label}</span>
      {value != null && value !== '' ? <span className="biz-figure-value">{value}</span> : <span className="biz-figure-value is-missing">—</span>}
      <span className="biz-figure-note">{value != null && value !== '' ? note : missing}{link && value != null ? <> · <Link to={link}>see</Link></> : null}{link && (value == null || value === '') && missing ? <> · <Link to={link}>fix</Link></> : null}</span>
    </div>
  );
}

export function Profile() {
  const { profile, setProfile } = useApp();
  const { data: w } = useLoad<WatcherState | null>(() => api.getWatcher().catch(() => null));
  const b = profile.business;
  const town = b.location.split(',')[0].trim();
  const rv = w?.reviews ?? null;
  const comps = w?.competitors ?? null;
  const ig = comps?.you?.instagram ?? null;
  const venue = comps?.you?.venue ?? null;
  const reviews30 = reviewsSince(rv?.history, 30);
  const priceRows = parsePriceList(profile.offer.priceList || '');
  const listed = comps?.you?.services?.length ?? priceRows.length;
  const compared = comps?.comparison ? comps.comparison.rows.filter((r) => r.yours && r.listedBy).length : null;
  const bookingUrl = profile.offer.bookingUrl || '';
  const bookingName = bookingUrl ? (platformOf(bookingUrl) || profile.offer.bookingSystem || 'Booking page') : (profile.offer.bookingSystem && profile.offer.bookingSystem !== 'None' ? profile.offer.bookingSystem : '');
  const links = [
    b.website ? { label: hostOf(b.website), url: b.website } : null,
    bookingUrl ? { label: bookingName, url: bookingUrl } : null,
    socialUrl('instagram', b.instagram) ? { label: socialLabel('instagram', socialUrl('instagram', b.instagram)), url: socialUrl('instagram', b.instagram) } : null,
    socialUrl('facebook', b.facebook) ? { label: 'Facebook', url: socialUrl('facebook', b.facebook) } : null,
    rv?.mapsUrl ? { label: 'Google listing', url: rv.mapsUrl } : null,
  ].filter(Boolean) as { label: string; url: string }[];
  const meta = [b.location, b.tradingSince ? `trading since ${b.tradingSince}` : '', b.teamSize === 'Just me' ? 'just you' : b.teamSize ? `team of ${b.teamSize}` : '', b.legalForm || ''].filter(Boolean);
  const urgent = w?.issues.filter((i) => i.level === 'urgent').length ?? 0;
  const siteValue = !b.website ? null : w?.lastCheck ? (w.up ? 'Online' : 'Down') : null;

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <header className="biz-hero" aria-label={`${b.name} at a glance`}>
        <div className="biz-hero-top">
          <div className="stack gap-8" style={{ minWidth: 0 }}>
            <span className="biz-kicker">Your business</span>
            <h1 className="biz-name">{b.name}</h1>
            {b.oneLiner && <p className="biz-line">{b.oneLiner}</p>}
            <p className="biz-meta">{meta.join(' · ')}</p>
          </div>
          {links.length > 0 && (
            <ul className="biz-links" aria-label="Where you are online">
              {links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.label}<span className="sr-only"> (opens in a new tab)</span></a></li>)}
            </ul>
          )}
        </div>
        <div className="biz-figures">
          <Figure label="Google rating" value={rv?.rating != null ? <span className="row gap-8"><Stars value={rv.rating} /> {rv.rating.toFixed(1)}</span> : undefined} note={rv ? `${rv.count ?? 0} reviews${reviews30 != null ? `, ${reviews30} new in 30 days` : ''}, read ${relative(rv.checkedAt)}` : ''} link="/watcher?tab=reviews" missing={w ? 'Connect your Google listing on the Reviews tab' : 'First check still to run'} />
          <Figure label="Instagram followers" value={ig && !ig.error ? (ig.followers ?? 0).toLocaleString('en-GB') : undefined} note={ig && !ig.error ? `${ig.postsLast30 ?? 0} posts in 30 days, read ${relative(ig.checkedAt)}` : ''} missing={!b.instagram ? 'No handle given' : ig?.error === 'not-business' ? 'Personal or private account, so it can’t be read' : 'Read with the next check'} />
          <Figure label={bookingName ? `${bookingName} rating` : 'Booking page'} value={venue ? (venue.rating != null ? venue.rating.toFixed(1) : `${venue.reviews ?? 0}`) : undefined} note={venue ? `${venue.rating != null ? `${venue.reviews ?? 0} reviews, ` : 'reviews, '}${venue.team != null ? `team of ${venue.team}, ` : ''}${venue.serviceCount ?? listed} treatments, read ${relative(venue.checkedAt)}` : ''} missing={bookingUrl ? (comps?.you?.unreadable?.length ? `Your ${bookingName} page only shows prices in a browser` : 'Read with the next check') : 'Add your booking page below'} />
          <Figure label="Treatments priced" value={listed || undefined} note={compared != null ? `${compared} compared like for like with the clinics nearby` : 'From your price list and booking page'} link="/watcher?tab=prices" missing="Paste your price list below or add your booking page" />
          <Figure label="Competitors watched" value={comps?.list.length || undefined} note={comps?.foundRadiusKm ? `within ${comps.foundRadiusKm} km of ${town || 'you'}, read every day` : 'read every day'} link="/watcher?tab=competitors" missing={comps?.foundFrom === 'none' ? 'Add your postcode below so the Watcher can search around you' : 'Found with the first check'} />
          <Figure label="Website" value={siteValue ?? undefined} note={w?.lastCheck ? `${urgent ? `${urgent} urgent issue${urgent > 1 ? 's' : ''}, ` : ''}${w.uptime30d}% uptime, checked ${relative(w.lastCheck)}` : ''} link="/watcher?tab=overview" missing={b.website ? 'First check still to run' : 'No website, and that’s fine: your listing and booking page do the work'} />
        </div>
      </header>

      <div className="biz-edge">
        <div className="biz-edge-block">
          <span className="biz-kicker">What you do better</span>
          <p className="biz-quote">{profile.competitors.ourEdge || 'Tell your agents what sets you apart, under Competitors below.'}</p>
        </div>
        <div className="biz-edge-block">
          <span className="biz-kicker">Your 90-day goal</span>
          <p className="biz-quote">{profile.goals.target || 'Set a target under Goals below.'}</p>
          {profile.goals.focus && <p className="small muted">Focus: {profile.goals.focus}{profile.goals.timePerWeek ? ` · ${profile.goals.timePerWeek} a week for growth` : ''}</p>}
        </div>
      </div>

      <div className="split" style={{ margin: '36px 0 14px' }}>
        <h2 className="heading">Everything your agents know</h2>
        <span className="small muted row gap-8"><Icon name="lock" className="inline-icon" />Private to your account. Gainora never shares your details or numbers.</span>
      </div>
      <p className="muted" style={{ maxWidth: '68ch', marginBottom: 20 }}>Keep this current and their work gets sharper: a new competitor, a new treatment or price, a new goal all change what they look for.</p>
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
