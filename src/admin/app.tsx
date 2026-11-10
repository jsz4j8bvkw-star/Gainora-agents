import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Link, usePath } from '../lib/router';
import { ErrorNote, Icon, Loading, ToastProvider, useLoad } from '../components/ui';
import { SignIn } from '../pages/signin';
import { SetPassword } from '../pages/password';
import { longDate } from '../lib/format';
import type { User } from '../lib/types';
import { admin } from './api';
import { Today, Clients, Delivery, Requests, Settings } from './pages';
import { Health, Money, Paperwork, Prices } from './business';
import { ProspectPage, Sales } from './sales';
import { ClientPage } from './client';

declare const __DEMO__: boolean;
const BASE = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? './' : '/';

const NAV: { path: string; label: string; icon: string; group?: string; tab?: boolean }[] = [
  { path: '/', label: 'Today', icon: 'home', tab: true },
  { path: '/sales', label: 'Sales', icon: 'send', tab: true },
  { path: '/clients', label: 'Clients', icon: 'clients', group: 'Clients', tab: true },
  { path: '/delivery', label: 'Delivery', icon: 'check', tab: true },
  { path: '/requests', label: 'Requests', icon: 'pencil' },
  { path: '/health', label: 'Health', icon: 'alert' },
  { path: '/money', label: 'Money', icon: 'results', group: 'Business' },
  { path: '/prices', label: 'Prices', icon: 'tag' },
  { path: '/paperwork', label: 'Paperwork', icon: 'contract' },
  { path: '/settings', label: 'Settings', icon: 'settings', group: '' },
];

/** Gainora's admin: sign in with a Gainora team login, then everything about every client in one place. */
export function AdminApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const load = async () => { try { setUser(await api.getUser()); } catch { setUser(null); } };
  useEffect(() => {
    if (api.mode === 'demo') {
      // The demo needs the sample business behind its sample website.
      (async () => { if (api.fillSample) await api.saveProfile(api.fillSample()); setUser({ id: 'demo', email: 'hello@gainora.co.uk' }); })();
    } else load();
  }, []);
  if (user === undefined) return <Loading label="Opening Gainora admin" />;
  if (!user) return <ToastProvider><SignIn onSignedIn={load} /></ToastProvider>;
  if (user.passwordStep) return <ToastProvider><SetPassword user={user} onDone={load} /></ToastProvider>;
  return <ToastProvider><Gate email={user.email} /></ToastProvider>;
}

/** Only Gainora's team: anyone else signed in sees a polite no. */
function Gate({ email }: { email: string }) {
  const { data, error, reload } = useLoad(() => admin.overview().then(() => true).catch((e) => { if (e?.status === 403) return false; throw e; }));
  if (data === undefined && !error) return <Loading label="Opening Gainora admin" />;
  if (error) return <div className="page"><ErrorNote message={/502|503|saved data/i.test(error) ? 'The admin’s database tables aren’t set up yet. Run the admin database update in Supabase.' : error} retry={reload} /></div>;
  if (!data) {
    return (
      <div className="page" style={{ maxWidth: 560, margin: '12vh auto' }}>
        <h1 className="title">This is Gainora’s admin</h1>
        <p className="muted mt-16">{email} isn’t on Gainora’s team. If you’re a client, your apps are at app.gainora.co.uk.</p>
        <div className="row gap-12 mt-24"><a className="btn btn-primary" href="https://app.gainora.co.uk/">Open Command Centre</a><button className="btn btn-secondary" onClick={async () => { await api.signOut(); location.reload(); }}>Sign out</button></div>
      </div>
    );
  }
  return <Shell email={email} />;
}

function Shell({ email }: { email: string }) {
  const path = usePath().split('?')[0];
  const active = (p: string) => (p === '/' ? path === '/' : path.startsWith(p)) ? 'page' : undefined;
  const page = (() => {
    if (path.startsWith('/sales/')) return <ProspectPage id={decodeURIComponent(path.slice('/sales/'.length))} />;
    if (path.startsWith('/sales')) return <Sales />;
    if (path.startsWith('/clients/')) return <ClientPage email={decodeURIComponent(path.slice('/clients/'.length))} />;
    if (path.startsWith('/clients')) return <Clients />;
    if (path.startsWith('/delivery')) return <Delivery />;
    if (path.startsWith('/requests')) return <Requests />;
    if (path.startsWith('/health')) return <Health />;
    if (path.startsWith('/money')) return <Money />;
    if (path.startsWith('/prices')) return <Prices />;
    if (path.startsWith('/paperwork')) return <Paperwork />;
    if (path.startsWith('/more')) return <More />;
    if (path.startsWith('/settings')) return <Settings />;
    return <Today />;
  })();
  return (
    <div className="shell admin-shell">
      <aside className="side" aria-label="Main">
        <div className="side-logo"><img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" /><span className="admin-badge">Admin</span></div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => [n.group !== undefined && <span key={`g-${n.path}`} className="nav-group" aria-hidden={!n.group}>{n.group}</span>, <Link key={n.path} to={n.path} aria-current={active(n.path)}><Icon name={n.icon} />{n.label}</Link>])}
        </nav>
        <div className="side-foot">
          <div className="side-biz">{email}</div>
          {api.mode === 'live' && <button className="side-site linklike" onClick={async () => { await api.signOut(); location.reload(); }}>Sign out</button>}
        </div>
      </aside>
      <div className="main">
        <header className="topbar"><img src={`${BASE}gainora-logo.svg`} alt="Gainora" /><span className="admin-badge dark">Admin</span></header>
        {admin.mode === 'demo' && <div className="demo-flag" role="note">You’re viewing the admin with sample clients.</div>}
        <div className="appbar"><span className="small faint">{longDate()}</span></div>
        <main key={path} className="route-in">{page}</main>
        <nav className="tabbar" aria-label="Sections">
          {NAV.filter((n) => n.tab).map((n) => <Link key={n.path} to={n.path} aria-current={active(n.path)}><Icon name={n.icon} />{n.label}</Link>)}
          <Link to="/more" aria-current={NAV.some((n) => !n.tab && active(n.path)) || path === '/more' ? 'page' : undefined}><Icon name="chevron" />More</Link>
        </nav>
      </div>
    </div>
  );
}

/** On a phone, the sections that don't fit in the tab bar. */
function More() {
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">More</h1></div></div>
      <nav className="panel more-list" aria-label="More sections">
        {NAV.filter((n) => !n.tab).map((n) => <Link key={n.path} to={n.path}><Icon name={n.icon} /><span>{n.label}</span><Icon name="chevron" className="more-chev" /></Link>)}
        {api.mode === 'live' && <button type="button" className="linklike-plain more-out" onClick={async () => { await api.signOut(); location.reload(); }}><Icon name="logout" /><span>Sign out</span></button>}
      </nav>
    </div>
  );
}
