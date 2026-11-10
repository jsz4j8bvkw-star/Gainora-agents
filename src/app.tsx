import { DiaryPage } from './pages/diary';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';
import type { CaptureSettings, EnquiryRecord, MessageRecord, Plan, User } from './lib/types';
import { Link, navigate, usePath } from './lib/router';
import { Icon, Loading, ToastProvider } from './components/ui';
import { longDate } from './lib/format';
import { followUps, isBeauty } from '../shared/capture';
import { SignIn } from './pages/signin';
import { Setup } from './pages/setup';
import { Today } from './pages/today';
import { Enquiries, EnquiryDetail } from './pages/enquiries';
import { FollowUps } from './pages/followups';
import { Receptionist } from './pages/receptionist';
import { ReportPage } from './pages/report';
import { Settings } from './pages/settings';
import { AutomationsPage } from './pages/automations';

interface AppState {
  user: User;
  settings: CaptureSettings;
  plan: Plan;
  setSettings: (s: CaptureSettings) => void;
  enquiries: EnquiryRecord[] | undefined;
  enquiriesError: string | null;
  reloadEnquiries: () => Promise<void>;
  putEnquiry: (e: EnquiryRecord) => void;
  dropEnquiry: (id: string) => void;
  messages: MessageRecord[];
  reloadMessages: () => Promise<void>;
  putMessage: (m: MessageRecord) => void;
}
const Ctx = createContext<AppState>(null as any);
export const useApp = () => useContext(Ctx);

declare const __DEMO__: boolean;
export const BASE = (typeof __DEMO__ !== 'undefined' && __DEMO__) ? './' : '/';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [settings, setSettings] = useState<CaptureSettings | null | undefined>(undefined);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const u = await api.getUser();
      setUser(u);
      if (!u) return;
      const [s, p] = await Promise.all([api.getSettings(), api.getPlan()]);
      setSettings(s); setPlan(p);
    } catch (e: any) { setError(e?.message || 'Gainora could not load. Check your connection and refresh.'); }
  };
  useEffect(() => { load(); }, []);

  if (error) return <div className="page"><div className="err" role="alert">{error}</div></div>;
  if (user === undefined) return <Loading label="Opening Gainora" />;
  if (!user) return <ToastProvider><SignIn onSignedIn={load} /></ToastProvider>;
  if (settings === undefined || !plan) return <Loading label="Loading your business" />;
  if (!plan.active) return <NotOnPlan email={user.email} />;
  if (!settings?.completedAt) {
    return <ToastProvider><Setup user={user} initial={settings} onDone={(s) => { setSettings(s); navigate('/receptionist', { replace: true }); }} /></ToastProvider>;
  }
  return (
    <ToastProvider>
      <Store user={user} settings={settings} plan={plan} setSettings={setSettings} />
    </ToastProvider>
  );
}

function Store(props: { user: User; settings: CaptureSettings; plan: Plan; setSettings: (s: CaptureSettings) => void }) {
  const [enquiries, setEnquiries] = useState<EnquiryRecord[] | undefined>(undefined);
  const [enquiriesError, setErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const reloadMessages = useCallback(async () => { try { setMessages(await api.listMessages()); } catch { /* the inbox still works */ } }, []);
  const reloadEnquiries = useCallback(async () => {
    setErr(null);
    try { setEnquiries(await api.listEnquiries()); await reloadMessages(); setEnquiries(await api.listEnquiries()); }
    catch (e: any) { setErr(e?.message || 'Your enquiries could not load.'); }
  }, []);
  useEffect(() => {
    reloadEnquiries();
    // New calls arrive all day: refresh every minute while the app is open and visible.
    const t = setInterval(() => { if (document.visibilityState === 'visible') reloadEnquiries(); }, 60_000);
    return () => clearInterval(t);
  }, []);
  const putEnquiry = useCallback((e: EnquiryRecord) => setEnquiries((list) => {
    const l = list ?? [];
    return l.some((x) => x.id === e.id) ? l.map((x) => (x.id === e.id ? e : x)) : [e, ...l];
  }), []);
  const dropEnquiry = useCallback((id: string) => setEnquiries((l) => (l ?? []).filter((x) => x.id !== id)), []);
  const putMessage = useCallback((m: MessageRecord) => setMessages((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [m, ...l])), []);
  return (
    <Ctx.Provider value={{ ...props, enquiries, enquiriesError, reloadEnquiries, putEnquiry, dropEnquiry, messages, reloadMessages, putMessage }}>
      <Shell />
    </Ctx.Provider>
  );
}

const NAV = [
  { path: '/', label: 'Today', icon: 'home' },
  { path: '/diary', label: 'Diary', icon: 'calendar', appts: true },
  { path: '/enquiries', label: 'Enquiries', icon: 'inbox' },
  { path: '/follow-ups', label: 'Follow-ups', icon: 'repeat' },
  { path: '/automations', label: 'Automations', icon: 'bolt' },
  { path: '/receptionist', label: 'Receptionist', icon: 'headset' },
  { path: '/report', label: 'Report', icon: 'results' },
];
/** On phones the bar has room for five; Receptionist (and, for clinics, Report) move to the top bar. */
const navFor = (appts: boolean) => NAV.filter((n) => !('appts' in n) || appts);
const tabsFor = (appts: boolean) => navFor(appts).filter((n) => n.path !== '/receptionist' && !(appts && n.path === '/report'));

function Shell() {
  const path = usePath();
  const { settings, enquiries, messages } = useApp();
  const active = (p: string) => (p === '/' ? path === '/' : path.startsWith(p)) ? 'page' : undefined;
  const appts = settings.business.kind === 'appointments';
  const counts = useMemo(() => {
    const list = enquiries ?? [];
    return {
      fresh: list.filter((e) => e.status === 'new').length,
      urgent: list.filter((e) => e.status === 'new' && e.urgency !== 'normal').length,
      due: followUps(list).filter((f) => f.due).length,
      unread: new Set(messages.filter((m) => m.direction === 'in' && !m.read).map((m) => m.enquiryId)).size,
      waiting: messages.filter((m) => m.status === 'awaiting_approval').length,
    };
  }, [enquiries, messages]);
  const badge = (p: string) => (p === '/enquiries' ? counts.fresh + counts.unread : p === '/follow-ups' ? counts.due : p === '/automations' ? counts.waiting : 0);

  const page = (() => {
    const m = path.match(/^\/enquiries\/([^/]+)$/);
    if (m && m[1] === 'new') return <Enquiries adding />;
    if (m) return <EnquiryDetail id={m[1]} />;
    if (path.startsWith('/enquiries')) return <Enquiries />;
    if (path.startsWith('/follow-ups')) return <FollowUps />;
    if (path.startsWith('/receptionist')) return <Receptionist />;
    if (path.startsWith('/automations')) return <AutomationsPage />;
    if (path.startsWith('/report')) return <ReportPage />;
    if (path.startsWith('/settings')) return <Settings />;
    if (path.startsWith('/diary') && appts) return <DiaryPage />;
    return <Today />;
  })();

  return (
    <div className="shell">
      <aside className="side" aria-label="Main">
        <div className="side-logo">
          <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
          <span className="side-product">Capture &amp; Convert</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {navFor(appts).map((n) => (
            <Link key={n.path} to={n.path} aria-current={active(n.path)}>
              <Icon name={n.icon} />{n.label}
              {badge(n.path) > 0 && <span className={`nav-badge ${n.path === '/enquiries' && counts.urgent ? 'hot' : ''}`}>{badge(n.path)}<span className="sr-only"> waiting</span></span>}
            </Link>
          ))}
          <div className="nav-sep" />
          <Link to="/settings" aria-current={active('/settings')}><Icon name="settings" />Settings</Link>
        </nav>
        <div className="side-foot">
          <div className="side-biz">{settings.business.name}</div>
          <div className="side-site">{settings.provider.aiNumber ? `Receptionist on ${settings.provider.aiNumber}` : settings.business.location}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar-brand"><img src={`${BASE}gainora-logo.svg`} alt="Gainora" /><span>Capture &amp; Convert</span></span>
          <span className="row gap-4">
            {appts && <Link to="/report" className="btn btn-quiet btn-small" aria-current={active('/report')}><Icon name="results" /><span className="sr-only">Report</span></Link>}
            <Link to="/receptionist" className="btn btn-quiet btn-small" aria-current={active('/receptionist')}><Icon name="headset" /><span className="sr-only">Receptionist</span></Link>
            <Link to="/settings" className="btn btn-quiet btn-small" aria-current={active('/settings')}><Icon name="settings" /><span className="sr-only">Settings</span></Link>
          </span>
        </header>
        {api.mode === 'demo' && (
          <div className="demo-flag" role="note">
            You’re viewing a demo with sample data for {isBeauty(settings.business) ? 'a beauty and aesthetics clinic' : settings.business.kind === 'appointments' ? 'a physio clinic' : 'a plumbing business'}.
            <button onClick={() => { api.resetDemo?.(); location.reload(); }}>Start over</button>
          </div>
        )}
        <div className="appbar">
          <span className="small faint">{longDate()}</span>
          <LiveDot />
        </div>
        <main key={path} className="route-in">{page}</main>
        <nav className="tabbar" aria-label="Sections">
          {tabsFor(appts).map((n) => (
            <Link key={n.path} to={n.path} aria-current={active(n.path)}>
              <span className="tab-ico"><Icon name={n.icon} />{badge(n.path) > 0 && <span className="tab-dot" aria-hidden="true" />}</span>{n.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** A quiet sign that the line is being answered. */
function LiveDot() {
  const { settings } = useApp();
  return (
    <span className="live-dot small">
      <span className="pulse-dot" aria-hidden="true" />
      {settings.provider.name ? `Receptionist answering through ${settings.provider.name}` : 'Receptionist ready to connect'}
    </span>
  );
}

function NotOnPlan({ email }: { email: string }) {
  return (
    <div className="signin">
      <section className="signin-art" aria-label="About Capture & Convert">
        <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
        <p className="signin-quote">Never miss another job because nobody picked up.</p>
        <span />
      </section>
      <section className="signin-form">
        <div className="signin-card">
          <h1 className="title">Capture &amp; Convert isn’t on your plan</h1>
          <p className="muted">You’re signed in as <strong style={{ color: '#F6F2EA' }}>{email}</strong>, but this login doesn’t have Capture &amp; Convert yet. If you’ve just subscribed, give it a minute and refresh.</p>
          <a className="btn btn-primary btn-block" href="https://gainora.co.uk/">See Capture &amp; Convert</a>
          <button className="btn btn-secondary btn-block" onClick={async () => { await api.signOut(); location.reload(); }}>Sign out</button>
        </div>
      </section>
    </div>
  );
}
