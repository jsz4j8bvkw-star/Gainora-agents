import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { AgentId, BusinessProfile, Plan, User } from './lib/types';
import { Link, navigate, usePath } from './lib/router';
import { AGENTS, Icon, Loading, ToastProvider } from './components/ui';
import { hostOf, longDate } from './lib/format';
import { Palette, usePaletteShortcut } from './components/palette';
import { SignIn } from './pages/signin';
import { Onboarding } from './pages/onboarding';
import { Home } from './pages/home';
import { Watcher } from './pages/watcher';
import { Scout } from './pages/scout';
import { Brief } from './pages/brief';
import { Ask } from './pages/ask';
import { Profile } from './pages/profile';
import { Settings } from './pages/settings';
import { Results } from './pages/results';

interface AppState {
  user: User;
  profile: BusinessProfile;
  plan: Plan;
  setProfile: (p: BusinessProfile) => void;
}
const Ctx = createContext<AppState>(null as any);
export const useApp = () => useContext(Ctx);

declare const __DEMO__: boolean;
const LOGO = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? './' : '/';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const u = await api.getUser();
      setUser(u);
      if (!u) return;
      const [p, pl] = await Promise.all([api.getProfile(), api.getPlan()]);
      setProfile(p); setPlan(pl);
    } catch (e: any) { setError(e?.message || 'Gainora could not load. Check your connection and refresh.'); }
  };
  useEffect(() => { load(); }, []);

  if (error) return <div className="page"><div className="err" role="alert">{error}</div></div>;
  if (user === undefined) return <Loading label="Opening Gainora" />;
  if (!user) return <ToastProvider><SignIn onSignedIn={load} /></ToastProvider>;
  if (profile === undefined || !plan) return <Loading label="Loading your business" />;
  if (!profile?.completedAt) {
    return <ToastProvider><Onboarding initial={profile} onDone={(p) => { setProfile(p); navigate('/', { replace: true }); }} /></ToastProvider>;
  }
  return (
    <ToastProvider>
      <Ctx.Provider value={{ user, profile, plan, setProfile }}>
        <Shell />
      </Ctx.Provider>
    </ToastProvider>
  );
}

const NAV: { path: string; label: string; icon: string; agent?: AgentId }[] = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/watcher', label: 'The Watcher', icon: 'watcher', agent: 'watcher' },
  { path: '/scout', label: 'The Scout', icon: 'scout', agent: 'scout' },
  { path: '/brief', label: 'The Brief', icon: 'brief', agent: 'brief' },
  { path: '/ask', label: 'Ask', icon: 'ask' },
];

function Shell() {
  const path = usePath();
  const { profile, plan } = useApp();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  usePaletteShortcut(openPalette);
  const active = (p: string) => (p === '/' ? path === '/' : path.startsWith(p)) ? 'page' : undefined;
  const page = (() => {
    if (path.startsWith('/watcher')) return <Watcher />;
    if (path.startsWith('/scout')) return <Scout />;
    if (path.startsWith('/brief')) return <Brief />;
    if (path.startsWith('/ask')) return <Ask />;
    if (path.startsWith('/business')) return <Profile />;
    if (path.startsWith('/settings')) return <Settings />;
    if (path.startsWith('/results')) return <Results />;
    return <Home />;
  })();

  return (
    <div className="shell">
      <aside className="side" aria-label="Main">
        <div className="side-logo"><img src={`${LOGO}gainora-logo-reverse.svg`} alt="Gainora" /></div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => (
            <Link key={n.path} to={n.path} aria-current={active(n.path)}>
              <Icon name={n.icon} />{n.label}
              {n.agent && !plan.agents.includes(n.agent) && <span className="lock">Add</span>}
            </Link>
          ))}
          <div className="nav-sep" />
          <Link to="/results" aria-current={active('/results')}><Icon name="results" />Your results</Link>
          <Link to="/business" aria-current={active('/business')}><Icon name="profile" />Your business</Link>
          <Link to="/settings" aria-current={active('/settings')}><Icon name="settings" />Plan and settings</Link>
        </nav>
        <div className="side-foot">
          <div className="side-biz">{profile.business.name}</div>
          <div className="side-site">{hostOf(profile.business.website)}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <img src={`${LOGO}gainora-logo.svg`} alt="Gainora" />
          <div className="row gap-4">
            <button className="btn btn-quiet btn-small" onClick={openPalette} aria-label="Search or ask"><Icon name="search" /></button>
            <Link to="/settings" className="btn btn-quiet btn-small" aria-current={active('/settings')}><Icon name="settings" /><span className="sr-only">Plan and settings</span></Link>
          </div>
        </header>
        {api.mode === 'demo' && (
          <div className="demo-flag" role="note">
            You’re viewing a demo with sample data.
            <button onClick={() => { api.resetDemo?.(); location.reload(); }}>Start over</button>
          </div>
        )}
        <div className="appbar">
          <button className="search-btn" onClick={openPalette}><Icon name="search" />Search or ask Gainora<span className="kbd" aria-hidden="true">⌘K</span></button>
          <span className="small faint">{longDate()}</span>
        </div>
        <main key={path} className="route-in">{page}</main>
        <nav className="tabbar" aria-label="Sections">
          {NAV.map((n) => (
            <Link key={n.path} to={n.path} aria-current={active(n.path)}>
              <Icon name={n.icon} />{n.label.replace('The ', '')}
            </Link>
          ))}
        </nav>
      </div>
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

/** Shown in place of an agent page when it isn't on the client's plan. */
export function Locked({ agent }: { agent: AgentId }) {
  const a = AGENTS[agent];
  return (
    <div className="page">
      <div className="panel panel-pad" style={{ maxWidth: 620 }}>
        <div className="agent-icon" style={{ marginBottom: 18 }}><Icon name={a.icon} /></div>
        <h1 className="title">{a.name} isn’t on your plan yet</h1>
        <p className="muted mt-16" style={{ fontSize: 'var(--t-md)' }}>{a.blurb}. It’s part of Gainora Command Centre, with all three agents. It uses the business details you’ve already given, so it starts working as soon as you move over.</p>
        <div className="row gap-12 mt-24 wrap">
          <a className="btn btn-primary" href="https://gainora.co.uk/shop/">See Command Centre</a>
          <Link to="/" className="btn btn-secondary">Back to Home</Link>
        </div>
      </div>
    </div>
  );
}
