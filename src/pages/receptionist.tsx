import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link, navigate } from '../lib/router';
import { Button, Choices, ErrorNote, Field, Icon, Loading, Modal, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { ScriptPreview } from './setup';
import { relative, shortDate } from '../lib/format';
import { CHANNEL_LABEL, DIRECT_SYSTEMS, isBeauty, packFromSettings } from '../../shared/capture';
import type { Source } from '../lib/types';

type Tab = 'script' | 'connect' | 'test';
const PROVIDERS = ['Retell', 'Trillet', 'My AI Front Desk', 'Other', 'Not set up yet'];

export function Receptionist() {
  const [tab, setTab] = useState<Tab>('script');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">Your receptionist</h1>
          <p className="lede">What it says when it answers, how it reaches your inbox, and how calls get to it. Gainora sets this up with you on your onboarding call.</p>
        </div>
      </div>
      <Tabs label="Receptionist sections" value={tab} onChange={setTab} tabs={[
        { id: 'script', label: 'Script' },
        { id: 'connect', label: 'Connect' },
        { id: 'test', label: 'Test and website form' },
      ]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={tab}>
        {tab === 'script' && <Script />}
        {tab === 'connect' && <Connect />}
        {tab === 'test' && <TestAndForm />}
      </div>
    </div>
  );
}

function Script() {
  const { settings } = useApp();
  const toast = useToast();
  const pack = packFromSettings(settings);
  const download = () => {
    if (api.mode === 'demo') { toast('In your app this downloads the script as a text file. Use Copy script in the demo.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pack.text], { type: 'text/plain' }));
    a.download = `${settings.business.name.replace(/[^\w]+/g, '-').toLowerCase()}-receptionist-script.txt`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <div className="row gap-8 wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="small muted" style={{ maxWidth: '62ch' }}>Written from your answers. Paste it into your receptionist platform’s instructions. When your prices, hours or services change, update your answers and copy it again.</p>
        <div className="row gap-8 wrap">
          <Button kind="secondary" small icon="pencil" onClick={() => navigate('/settings')}>Change answers</Button>
          <Button kind="secondary" small icon="download" onClick={download}>Download</Button>
          <Button small icon="copy" onClick={async () => toast((await copyText(pack.text)) ? 'Script copied.' : 'Download it instead.')}>Copy script</Button>
        </div>
      </div>
      <ScriptPreview s={settings} full />
      <p className="xsmall faint mt-16"><Icon name="info" className="inline-icon" />It never claims to be a person and answers honestly if asked{settings.calls.recording ? ', and the opening line says calls are recorded' : ''}. It never takes card details{isBeauty(settings.business) ? ', and sends every concern after a treatment to your clinic, never to another service' : ' or gives safety advice beyond the emergency numbers'}.</p>
    </>
  );
}

function Connect() {
  const { settings, setSettings } = useApp();
  const sources = useLoad(() => api.listSources());
  const [provider, setProvider] = useState(settings.provider.name || 'Not set up yet');
  const [num, setNum] = useState(settings.provider.aiNumber);
  const [saving, setSaving] = useState(false);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<Source | null>(null);
  const [label, setLabel] = useState('AI receptionist');
  const toast = useToast();

  const saveProvider = async () => {
    setSaving(true);
    try {
      const next = { ...settings, provider: { name: provider === 'Not set up yet' ? '' : provider, aiNumber: num.trim() } };
      await api.saveSettings(next); setSettings(next); toast('Saved.');
    } catch (e: any) { toast(e?.message || 'That didn’t save.'); }
    finally { setSaving(false); }
  };
  const make = async () => {
    setMaking(true);
    try { const s = await api.createSource(label.trim() || 'AI receptionist', 'call'); setMade(s); sources.reload(); }
    catch (e: any) { toast(e?.message || 'Couldn’t make a link. Try again.'); }
    finally { setMaking(false); }
  };

  return (
    <div className="stack gap-24">
      <section className="panel connect-step">
        <span className="step-num">1</span>
        <div className="stack gap-16" style={{ minWidth: 0 }}>
          <div><h2 className="subhead">Your receptionist platform</h2><p className="small muted">The service that answers your calls. Gainora sets this up and runs it for you. We use Retell for its natural British voices.</p></div>
          <div className="form-grid">
            <Field label="Platform" as="group" className="wide">{(_, d) => <Choices name="prov" options={PROVIDERS} value={provider} describedBy={d} onChange={setProvider} />}</Field>
            <Field label="Receptionist number" optional help="The number your calls forward to.">{(id, d) => <input id={id} className="input" type="tel" value={num} aria-describedby={d} onChange={(e: any) => setNum(e.target.value)} placeholder="01872 000001" />}</Field>
          </div>
          <div><Button small busy={saving} onClick={saveProvider}>Save</Button></div>
        </div>
      </section>

      <BookingCard />

      <section className="panel connect-step">
        <span className="step-num">3</span>
        <div className="stack gap-16" style={{ minWidth: 0 }}>
          <div><h2 className="subhead">Send each call to your inbox</h2><p className="small muted">Make a secret link and add it to your platform as a webhook for finished calls (“call analysed” or “call ended with summary”). Each call’s summary, number and transcript then arrive here within seconds.</p></div>
          <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="Name for this link" className="grow">{(id) => <input id={id} className="input" value={label} onChange={(e: any) => setLabel(e.target.value)} />}</Field>
            <Button icon="link" busy={making} onClick={make}>Make a link</Button>
          </div>
          <SourcesList state={sources} />
        </div>
      </section>

      <section className="panel connect-step">
        <span className="step-num">4</span>
        <div className="stack gap-12" style={{ minWidth: 0 }}>
          <div><h2 className="subhead">Forward your calls when you can’t answer</h2><p className="small muted">You keep your number. Calls only go to your receptionist when you don’t pick up, you’re on another call, or your phone is off.</p></div>
          <div className="forward-grid">
            <div>
              <strong className="small">On a mobile</strong>
              <p className="small muted">Most UK networks use these codes. Dial each one, then press call{settings.provider.aiNumber ? <>, using <strong>{settings.provider.aiNumber}</strong></> : ''}:</p>
              <ul className="codes">
                <li><code>**61*{(settings.provider.aiNumber || 'number').replace(/\s/g, '')}#</code><span>when you don’t answer</span></li>
                <li><code>**67*{(settings.provider.aiNumber || 'number').replace(/\s/g, '')}#</code><span>when you’re busy</span></li>
                <li><code>**62*{(settings.provider.aiNumber || 'number').replace(/\s/g, '')}#</code><span>when your phone is off</span></li>
              </ul>
              <p className="xsmall faint">To turn it off again, dial <code>##002#</code>. If a code doesn’t work, your network can switch it on for you.</p>
            </div>
            <div>
              <strong className="small">On a landline or business line</strong>
              <p className="small muted">Ask your phone provider to turn on “divert on no answer” and “divert when busy” to your receptionist number. Most can do it the same day, often from your online account.</p>
              <strong className="small mt-16" style={{ display: 'block' }}>Out of hours</strong>
              <p className="small muted">For calls to go straight to your receptionist when you’re closed, set a schedule in your phone provider’s settings, or forward all calls at the end of the day.</p>
            </div>
          </div>
        </div>
      </section>

      {made && (
        <Modal title="Your new link" onClose={() => setMade(null)} footer={<Button onClick={() => setMade(null)}>Done</Button>}>
          <div className="panel-pad stack gap-16">
            <p className="muted">Copy this now and paste it into your receptionist platform as the webhook address. For your security we only show it once. If you lose it, make a new one and switch this one off.</p>
            <div className="secret"><code>{made.url}</code><Button small icon="copy" onClick={async () => toast((await copyText(made.url!)) ? 'Link copied.' : 'Select it and copy.')}>Copy</Button></div>
            <p className="xsmall faint">Anyone with this link can add enquiries to your inbox, so keep it private.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Where bookings go. Gainora connects the diary with the client on their setup call. */
function BookingCard() {
  const { settings, setSettings } = useApp();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const b = settings.bookings;
  const system = b.system === 'Something else' ? b.systemOther || 'your booking system' : b.system;
  const paper = /paper/i.test(b.system);
  const direct = DIRECT_SYSTEMS.includes(b.system);
  const status = paper ? null : b.status;
  const request = async () => {
    setBusy(true);
    try { const next = { ...settings, bookings: { ...b, status: 'requested' as const } }; await api.saveSettings(next); setSettings(next); toast('Thanks. We’ll connect it with you on your setup call.'); }
    catch (e: any) { toast(e?.message || 'That didn’t save.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel connect-step">
      <span className="step-num">2</span>
      <div className="stack gap-12" style={{ minWidth: 0 }}>
        <div className="split">
          <div><h2 className="subhead">Your diary</h2><p className="small muted">Where your receptionist {b.mode === 'callback' ? 'checks for' : 'books'} appointments.</p></div>
          {status === 'connected' && <span className="tag tag-forest"><Icon name="check" className="tag-ico" />Connected</span>}
          {status === 'requested' && <span className="tag tag-brass">Being connected</span>}
          {status === 'not_connected' && b.system && <span className="tag tag-plain">Not connected yet</span>}
        </div>
        {!b.system ? (
          <p className="small">Tell us which diary you use in <Link to="/settings">Settings → Bookings</Link>.</p>
        ) : (
          <dl className="facts compact">
            <dt>System</dt><dd>{system}{b.account ? ` · ${b.account}` : ''}</dd>
            <dt>When someone wants to book</dt><dd>{b.mode === 'book' ? 'Book them straight in' : b.mode === 'offer' ? 'Offer times, you confirm' : 'Take details, you call back'}</dd>
            {b.types.length > 0 && <><dt>What people can book</dt><dd>{b.types.filter((t) => t.name).map((t) => `${t.name} (${t.minutes} min${t.price ? `, ${t.price}` : ''})`).join(' · ')}</dd></>}
          </dl>
        )}
        {paper && <p className="small muted">With a paper diary your receptionist can’t see free times, so it takes the details and you call back to arrange it. Moving to a free online calendar such as Google Calendar lets it book people straight in.</p>}
        {status === 'connected' && <p className="small muted">Your receptionist {b.mode === 'book' ? 'books straight into' : b.mode === 'offer' ? 'offers free times from' : 'checks'} {system}. To change how it books, edit <Link to="/settings">Settings → Bookings</Link>.</p>}
        {!paper && b.system && !direct && status !== 'connected' && <p className="small muted">We connect {system} with you on your setup call. Until it’s connected, your receptionist takes the details and says you’ll call back, so it never offers a time it can’t see.{b.mode !== 'callback' ? ' Your choice above takes effect the moment we mark it connected.' : ''}</p>}
        {!paper && b.system && direct && status !== 'connected' && <p className="small muted">Your receptionist can book straight into {system}. You’ll sign in to {system} with us on your setup call to give permission. We never see your password. Until then it takes details for a call back.</p>}
        {status === 'not_connected' && b.system && <div><Button small busy={busy} onClick={request}>Ask Gainora to connect it</Button></div>}
      </div>
    </section>
  );
}

function SourcesList({ state }: { state: ReturnType<typeof useLoad<Source[]>> }) {
  const { data, error, loading, reload, setData } = state;
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? 'Links could not load.'} retry={reload} />;
  if (!data.length) return <p className="small faint">No links yet.</p>;
  return (
    <div className="panel rows inset">
      {data.map((s) => (
        <div className={`source-row ${s.active ? '' : 'off'}`} key={s.id}>
          <span className="enq-ico"><Icon name={s.channel === 'call' ? 'phone' : s.channel === 'form' ? 'form' : 'mail'} /></span>
          <span className="stack" style={{ minWidth: 0 }}>
            <span className="small" style={{ fontWeight: 600 }}>{s.label}</span>
            <span className="xsmall faint">{CHANNEL_LABEL[s.channel]} · made {shortDate(s.createdAt)} · {s.active ? (s.lastUsedAt ? `last enquiry ${relative(s.lastUsedAt)}` : 'not used yet') : 'switched off'}</span>
          </span>
          {s.active
            ? <Button kind="quiet" small onClick={async () => { await api.revokeSource(s.id); setData(data.map((x) => (x.id === s.id ? { ...x, active: false } : x))); toast('Link switched off.'); }}>Switch off</Button>
            : <span className="tag tag-plain">Off</span>}
        </div>
      ))}
    </div>
  );
}

function TestAndForm() {
  const { putEnquiry } = useApp();
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState<Source | null>(null);
  const [making, setMaking] = useState(false);
  const toast = useToast();

  const test = async () => {
    setTesting(true);
    try { const e = await api.sendTest(); putEnquiry(e); toast('Test enquiry received.'); navigate(`/enquiries/${e.id}`); }
    catch (e: any) { toast(e?.message || 'The test didn’t go through.'); }
    finally { setTesting(false); }
  };
  const makeForm = async () => {
    setMaking(true);
    try { setForm(await api.createSource('Website contact form', 'form')); }
    catch (e: any) { toast(e?.message || 'Couldn’t make the form link.'); }
    finally { setMaking(false); }
  };
  const snippet = form?.url ? formSnippet(form.url) : '';

  return (
    <div className="stack gap-24">
      <section className="panel panel-pad">
        <h2 className="subhead">Send a test enquiry</h2>
        <p className="small muted mt-8">A sample enquiry goes through the same steps as a real call: it’s sorted, checked for emergencies and added to your inbox. Test enquiries are labelled and left out of your report.</p>
        <Button className="mt-16" icon="play" busy={testing} onClick={test}>Send a test</Button>
      </section>

      <section className="panel panel-pad">
        <h2 className="subhead">Put your website form into the same inbox</h2>
        <p className="small muted mt-8">Website enquiries then get the same emergency alerts, drafted replies and follow-ups as calls. Copy the form below into your website, or send it to whoever looks after your site. It includes a hidden field that stops most spam bots.</p>
        {!form && <Button className="mt-16" kind="secondary" icon="form" busy={making} onClick={makeForm}>Make a website form</Button>}
        {form && (
          <div className="stack gap-12 mt-16">
            <div className="row gap-8 wrap" style={{ justifyContent: 'space-between' }}><span className="small" style={{ fontWeight: 600 }}>Form code for your website</span><Button small icon="copy" onClick={async () => toast((await copyText(snippet)) ? 'Form code copied.' : 'Select it and copy.')}>Copy code</Button></div>
            <pre className="code-block">{snippet}</pre>
            <p className="xsmall faint">This code contains your form’s secret link and is only shown now. You can make a new form any time.</p>
          </div>
        )}
      </section>

      <p className="small muted">Need a hand? <Link to="/settings">Your details</Link> or email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a>.</p>
    </div>
  );
}

function formSnippet(url: string): string {
  return `<form action="${url}" method="post" class="enquiry-form">
  <label>Your name <input name="name" required autocomplete="name"></label>
  <label>Phone <input name="phone" type="tel" required autocomplete="tel"></label>
  <label>Email <input name="email" type="email" autocomplete="email"></label>
  <label>Postcode <input name="postcode" autocomplete="postal-code"></label>
  <label>How can we help? <textarea name="message" required></textarea></label>
  <input name="website_url_confirm" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <!-- Optional: send people to your own thank-you page -->
  <!-- <input type="hidden" name="thanks_url" value="https://yoursite.co.uk/thank-you"> -->
  <p><small>We use your details only to reply to this enquiry.</small></p>
  <button type="submit">Send</button>
</form>`;
}
