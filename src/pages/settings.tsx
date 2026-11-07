import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { AGENTS, Button, Icon, useToast } from '../components/ui';
import { SectionEditor } from './profile';
import { SECTIONS } from '../lib/questions';
import { shortDate } from '../lib/format';
import type { AgentId } from '../lib/types';

const PLANS_URL = 'https://gainora.co.uk/shop/';

export function Settings() {
  const { user, profile, plan, setProfile } = useApp();
  const [opening, setOpening] = useState(false);
  const toast = useToast();
  const allOn = (Object.keys(AGENTS) as AgentId[]).every((id) => plan.agents.includes(id));

  const manage = async () => {
    setOpening(true);
    try {
      const url = await api.billingUrl();
      if (url) location.href = url;
      else toast('Billing is managed through Stripe in the live app.');
    } catch (e: any) { toast(e?.message || 'Couldn’t open billing. Try again.'); }
    finally { setOpening(false); }
  };

  const exportData = async () => {
    const [home, watcher, scout, numbers, briefs, chat] = await Promise.all([api.getHome(), api.getWatcher().catch(() => null), api.listScout().catch(() => []), api.getNumbers().catch(() => []), api.listBriefs().catch(() => []), api.getChat().catch(() => [])]);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile, plan, home, watcher, scout, numbers, briefs, chat }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'gainora-my-data.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head"><h1 className="title">Plan and settings</h1></div>

      <section className="panel" aria-labelledby="plan-h">
        <div className="panel-head">
          <div>
            <h2 className="heading" id="plan-h">{allOn ? 'Gainora Command Centre' : 'Your plan'}</h2>
            <p className="small faint">{allOn ? 'All three agents, working together.' : 'Command Centre includes all three agents.'}{plan.renewsOn ? ` Renews ${shortDate(plan.renewsOn)}.` : ''}</p>
          </div>
          <Button kind="secondary" small busy={opening} onClick={manage}>Manage billing</Button>
        </div>
        <div className="rows">
          {(Object.keys(AGENTS) as AgentId[]).map((id) => {
            const on = plan.agents.includes(id);
            return (
              <div key={id} className="agent-row" style={{ cursor: 'default' }}>
                <span className="agent-icon" style={on ? undefined : { background: 'var(--canvas)', color: 'var(--ink-faint)' }}><Icon name={AGENTS[id].icon} /></span>
                <span className="stack gap-4"><span className="subhead">{AGENTS[id].name}</span><span className="small muted">{AGENTS[id].blurb}</span></span>
                {on ? <span className="tag tag-forest">{allOn ? 'Included' : 'Active'}</span> : <span className="tag">In Command Centre</span>}
              </div>
            );
          })}
        </div>
        {!allOn && (
          <div className="panel-pad row gap-12 wrap" style={{ borderTop: '1px solid var(--line)' }}>
            <p className="small muted" style={{ flex: '1 1 260px', margin: 0 }}>Move to Gainora Command Centre to add the agents you don’t have yet. They use the business details you’ve already given.</p>
            <a className="btn btn-primary btn-small" href={PLANS_URL}>See Command Centre</a>
          </div>
        )}
      </section>

      <div className="section">
        <SectionEditor section={SECTIONS.find((s) => s.id === 'preferences')!} profile={profile} onSaved={setProfile} />
      </div>

      <section className="panel review-block section" aria-labelledby="acct-h">
        <h2 className="heading" id="acct-h">Account</h2>
        <dl><dt>Signed in as</dt><dd>{user.email}</dd><dt>Your data</dt><dd>Download everything Gainora holds about your business as a file.</dd></dl>
        <div className="row gap-12 mt-24 wrap">
          <Button kind="secondary" icon="download" onClick={exportData}>Download my data</Button>
          <Button kind="secondary" icon="logout" onClick={async () => { await api.signOut(); location.reload(); }}>Sign out</Button>
        </div>
        <p className="xsmall faint mt-16">To close your account and delete your data, email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a>. We delete everything within 30 days.</p>
      </section>
    </div>
  );
}
